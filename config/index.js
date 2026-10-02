const path = require("path");

let electronApp = null;
try {
  const electron = require("electron");
  electronApp = electron.app || (electron.remote && electron.remote.app);
} catch {
  electronApp = null;
}

const IS_PACKAGED = !!electronApp;

const BASE_DIR = IS_PACKAGED
  ? path.join(electronApp.getPath("userData"))
  : path.join(__dirname, "..", "storage");

module.exports = {
  PORT: 3001,
  HOST: "127.0.0.1",
  APP_NAME: "Stocko Print Agent",
  APP_VERSION: "2.2.1",
  IS_PACKAGED,
  BASE_DIR,
  OUTPUT_DIR: path.join(BASE_DIR, "receipts"),
  LOG_DIR: path.join(BASE_DIR, "logs"),
  SETTINGS_FILE: path.join(BASE_DIR, "settings.json"),
  QUEUE_FILE: path.join(BASE_DIR, "queue.json"),
  MAX_RETRIES: 5,
  HEARTBEAT_INTERVAL_MS: 30000,
  CLOUD_BASE_URL: process.env.STOCKO_CLOUD_URL || "https://api.stocko.app",
};