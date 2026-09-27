const { sendHeartbeat, getBackoffMs } = require("./cloudSync");
const { processQueue } = require("./queueProcessor");
const logger = require("../logs/logger");

let timeoutId = null;
let isRunning = false;
let isTicking = false;
let trayMenuUpdater = null;

function setTrayUpdater(updaterFn) {
  trayMenuUpdater = updaterFn;
}

function updateTrayStatus(result) {
  if (typeof trayMenuUpdater === "function") {
    try {
      trayMenuUpdater(result || { online: false });
    } catch (err) {
      logger.warn(`[Heartbeat] Tray update failed: ${err.message}`);
    }
  }
}

async function tick() {
  if (isTicking) {
    logger.warn("[Heartbeat] Tick already in progress, skipping");
    return;
  }
  isTicking = true;

  try {
    const result = await sendHeartbeat();
    const safeResult = result || { online: false };

    updateTrayStatus(safeResult);

    if (safeResult.online) {
      await processQueue();
    }
  } catch (err) {
    logger.logError("[Heartbeat] Tick failed", err);
    updateTrayStatus({ online: false, lastError: err.message });
  } finally {
    isTicking = false;
  }
}

function scheduleNext() {
  if (!isRunning) return;

  // Ensure only one timeout is ever pending
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  const delay = getBackoffMs();
  timeoutId = setTimeout(async () => {
    if (!isRunning) return;
    await tick();
    scheduleNext();
  }, delay);
}

function start() {
  if (isRunning) return;
  isRunning = true;
  logger.info("[Heartbeat] Starting");

  // Run first tick immediately, then schedule the rest
  tick()
    .then(() => {
      if (isRunning) scheduleNext();
    })
    .catch((err) => {
      logger.logError("[Heartbeat] Initial tick failed", err);
      if (isRunning) scheduleNext();
    });
}

function stop() {
  isRunning = false;
  isTicking = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  logger.info("[Heartbeat] Stopped");
}

function gracefulShutdown() {
  stop();
}

module.exports = {
  start,
  stop,
  running: () => isRunning,
  setTrayUpdater,
  gracefulShutdown,
};