const path = require("path");

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
} = require("electron");

// Load environment before importing any service that creates a Supabase client.
// Supports both SUPABASE_* and the VITE_SUPABASE_* names used by Stocko.
const { loadEnvironment } = require("./config/env");
loadEnvironment({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname,
});

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
const STARTED_AT_LOGIN = process.argv.includes("--autostart");

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
      // At Windows login the agent starts quietly in the tray.
      // A normal/manual launch still opens the dashboard.
      if (!STARTED_AT_LOGIN) {
        mainWindow.show();
      }
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
// Auto-start with Windows
// ═══════════════════════════════════════════════════════════════════════════

function setAutoLaunch(enable) {
  if (process.platform !== "win32") return;

  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      path: app.getPath("exe"),
      args: enable ? ["--autostart"] : [],
    });

    const state = app.getLoginItemSettings({
      path: app.getPath("exe"),
      args: ["--autostart"],
    });
    logger.info(`[Main] Windows auto-start ${state.openAtLogin ? "enabled" : "disabled"}`);
  } catch (err) {
    logger.error(`[Main] Auto-start registration failed: ${err.message}`);
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

app.whenReady().then(async () => {
  logger.info("[Main] App ready");

  // Always keep the installed agent registered to start with Windows.
  // It launches quietly in the tray when Windows starts.
  setAutoLaunch(true);

  // Restore/refresh the saved login before heartbeat and cloud printing start.
  try {
    const { validateSession } = require("./auth/supabase");
    const restored = await validateSession();
    if (restored.valid) {
      logger.info("[Main] Saved login restored successfully");
    } else {
      logger.info(`[Main] No restorable login session: ${restored.error || "not logged in"}`);
    }
  } catch (err) {
    logger.warn(`[Main] Saved session restore failed: ${err.message}`);
  }

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

  // Auto-start is intentionally enforced for the installed print agent.
  // Login credentials are never stored; only the Supabase session tokens are persisted.
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