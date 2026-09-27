const path = require("path");
const dotenv = require("dotenv");

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
} = require("electron");

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, ".env")
  : path.join(__dirname, ".env");

dotenv.config({ path: envPath });

const logger = require("./logs/logger");
const heartbeat = require("./services/heartbeat");
const queue = require("./storage/queue");
const updater = require("./services/updater");
const cloudQueue = require("./services/cloudQueue");

// Start the Express server
let server;
try {
  server = require("./server");
  logger.info("[Main] Express server started");
} catch (err) {
  logger.error("[Main] Failed to start server: " + err.message);
}

let mainWindow = null;
let tray = null;
let trayApi = null;
let queueAlertInterval = null;
const IS_DEV = !app.isPackaged;

// ═══════════════════════════════════════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════════════════════════════════════

ipcMain.handle("get-version", () => require("./config").APP_VERSION);

ipcMain.on("check-for-updates", () => updater.check());
ipcMain.on("restart-app", () => updater.install());
ipcMain.on("install-update", () => updater.install());

// ═══════════════════════════════════════════════════════════════════════════
// Safe renderer communication
// ═══════════════════════════════════════════════════════════════════════════

function sendToRenderer(channel, ...args) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isDestroyed()
  ) {
    try {
      mainWindow.webContents.send(channel, ...args);
    } catch (err) {
      logger.warn(`[Main] Failed to send to renderer: ${err.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Window
// ═══════════════════════════════════════════════════════════════════════════

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
  width: 1100,
  height: 720,
  minWidth: 900,
  minHeight: 600,
  title: "Stocko Print Agent",
  icon: path.join(__dirname, "assets", "icon.ico"),
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, "ui", "preload.js"),
  },
  show: false,
  backgroundColor: "#0f172a",
});
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (IS_DEV) mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      logger.info("[Main] Window hidden to tray");
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Let updater know about the new window reference
  if (updater.setWindow) {
    updater.setWindow(mainWindow);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tray
// ═══════════════════════════════════════════════════════════════════════════

function createTray() {
  if (tray) return trayApi;

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(
      path.join(__dirname, "assets", "logo.png")
    );
    if (trayIcon.isEmpty()) throw new Error("Empty icon");
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Stocko Print Agent");

  let lastOnlineStatus = null;
  let lastQueueStats = null;

  function buildMenu(onlineStatus, queueStats) {
    const statusLabel =
      onlineStatus === true ? "Status: Online" : "Status: Offline";

    const pendingLabel = queueStats
      ? `Queue: ${queueStats.pending} pending · ${queueStats.failed} failed`
      : "Queue: —";

    return Menu.buildFromTemplate([
      {
        label: "Open Stocko Print Agent",
        click: () => createWindow(),
      },
      { type: "separator" },
      { label: statusLabel, enabled: false },
      { label: pendingLabel, enabled: false },
      { type: "separator" },
      { label: "Check for Updates", click: () => updater.check() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]);
  }

  function updateMenu(onlineStatus, queueStats) {
    const statsChanged =
      lastOnlineStatus !== onlineStatus ||
      JSON.stringify(lastQueueStats) !== JSON.stringify(queueStats);
    if (!statsChanged) return;

    lastOnlineStatus = onlineStatus;
    lastQueueStats = queueStats;
    tray.setContextMenu(buildMenu(onlineStatus, queueStats));
  }

  tray.setContextMenu(buildMenu(null, null));

  tray.on("double-click", () => createWindow());

  trayApi = {
    setOnline: (online) => {
      const stats = queue.getStats();
      updateMenu(online, stats);
      tray.setToolTip(`Stocko Print Agent — ${online ? "Online" : "Offline"}`);
    },
    setQueueAlert: (stats) => {
      if (stats.dead > 0 && !app.deadNotified) {
        app.deadNotified = true;
        if (Notification.isSupported()) {
          try {
            const notif = new Notification({
              title: "Stocko Print Agent",
              body: `${stats.dead} print job(s) failed permanently. Open app to review.`,
              icon: path.join(__dirname, "assets", "logo.png"),
            });
            notif.show();
            // Auto-close after 10 s to prevent native notification leaks
            setTimeout(() => notif.close(), 10000);
          } catch (err) {
            logger.warn(`[Main] Notification error: ${err.message}`);
          }
        }
      }
      if (stats.dead === 0) app.deadNotified = false;
    },
  };

  return trayApi;
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-start
// ═══════════════════════════════════════════════════════════════════════════

function setAutoLaunch(enable) {
  if (process.platform !== "win32") return;
  const { exec } = require("child_process");
  const appPath = app.getPath("exe");
  const appName = "StockoPrintAgent";

  if (enable) {
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /t REG_SZ /d "\\"${appPath}\\"" /f`;
    exec(cmd, (err) => {
      if (err)
        logger.error(`[Main] Auto-start registration failed: ${err.message}`);
      else logger.info("[Main] Auto-start enabled");
    });
  } else {
    const cmd = `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /f`;
    exec(cmd, (err) => {
      if (err)
        logger.error(`[Main] Auto-start removal failed: ${err.message}`);
      else logger.info("[Main] Auto-start disabled");
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue alerts
// ═══════════════════════════════════════════════════════════════════════════

function startQueueAlerts(trayApi) {
  if (queueAlertInterval) clearInterval(queueAlertInterval);
  queueAlertInterval = setInterval(() => {
    try {
      const stats = queue.getStats();
      trayApi.setQueueAlert(stats);
    } catch (err) {
      logger.warn(`[Main] Queue alert error: ${err.message}`);
    }
  }, 10000);
}

// ═══════════════════════════════════════════════════════════════════════════
// App lifecycle
// ═══════════════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  logger.info("[Main] App ready");
  createWindow();

  // ── Updater ──
  updater.init(mainWindow);
  if (!IS_DEV) {
    setTimeout(() => updater.check(), 5000);
  }

  // ── Tray + Heartbeat ──
  trayApi = createTray();
  heartbeat.setTrayUpdater((status) => {
    if (trayApi) trayApi.setOnline(status.online);
    sendToRenderer("cloud-status", status);
  });
  heartbeat.start();
  logger.info("[Main] Heartbeat started");

  // ── Cloud Queue ──
  cloudQueue.start();
  logger.info("[Main] Cloud queue polling started");

  // ── Queue dead-job alerts ──
  startQueueAlerts(trayApi);

  // ── First-run auto-start ──
  const settings = require("./storage/settings");
  const all = settings.getAll();
  if (all.app.firstRun) {
    setAutoLaunch(true);
    const updated = settings.getAll();
    updated.app.firstRun = false;
    require("fs").writeFileSync(
      require("./config").SETTINGS_FILE,
      JSON.stringify(updated, null, 2)
    );
  }
});

app.on("activate", () => {
  createWindow();
});

app.on("window-all-closed", () => {
  // Keep running in background on Windows
});

app.on("before-quit", () => {
  app.isQuiting = true;
});

app.on("will-quit", () => {
  heartbeat.gracefulShutdown();
  cloudQueue.stop();

  if (queueAlertInterval) {
    clearInterval(queueAlertInterval);
    queueAlertInterval = null;
  }

  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (server && server.forceClose) {
    server.forceClose(() => {
      logger.info("[Main] Server closed gracefully");
    }, 3000);
  } else if (server) {
    server.close(() => {
      logger.info("[Main] Server closed gracefully");
    });
  }
});

process.on("uncaughtException", (err) => {
  logger.logError("[Main] Uncaught exception", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`[Main] Unhandled rejection: ${reason}`);
});