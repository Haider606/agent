const { autoUpdater } = require("electron-updater");
const logger = require("../logs/logger");

let mainWindow = null;
let updateDownloaded = false;

function init(win) {
  mainWindow = win;

  // Disable auto-download so we can notify user first
  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    logger.info("[Updater] Checking for update…");
    send("update-checking");
  });

  autoUpdater.on("update-available", (info) => {
    logger.info(`[Updater] Update available: ${info.version}`);
    send("update-available", info);
  });

  autoUpdater.on("update-not-available", () => {
    logger.info("[Updater] No update available");
    send("update-not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    send("update-progress", progress);
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateDownloaded = true;
    logger.info(`[Updater] Update downloaded: ${info.version}`);
    send("update-downloaded", info);
  });

  autoUpdater.on("error", (err) => {
    logger.logError("[Updater] Error", err);
    send("update-error", err.message);
  });
}

function check() {
  if (!autoUpdater.isUpdaterActive()) {
    logger.warn("[Updater] Updater not active (dev mode or no publish config)");
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    logger.logError("[Updater] Check failed", err);
  });
}

function install() {
  if (updateDownloaded) {
    autoUpdater.quitAndInstall(false, true);
  }
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

module.exports = { init, check, install };