const fs = require("fs");
const path = require("path");
const { LOG_DIR } = require("../config");

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  console.error("[Logger] Could not create log directory:", err.message);
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = process.env.NODE_ENV === "production" ? 1 : 0;

let writeBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL_MS = 1000;
const BUFFER_SIZE_LIMIT = 50;

function flushBuffer() {
  if (writeBuffer.length === 0) return;

  const lines = writeBuffer.join("");
  writeBuffer = [];

  try {
    const date = new Date().toISOString().split("T")[0];
    const filePath = path.join(LOG_DIR, `stocko-${date}.log`);
    fs.appendFile(filePath, lines, { encoding: "utf8" }, (err) => {
      if (err) console.error("[Logger] Async file write failed:", err.message);
    });
  } catch (err) {
    console.error("[Logger] File write failed:", err.message);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

function formatMessage(level, message) {
  const ts = new Date().toISOString();
  return `${ts} [${level.toUpperCase()}] ${message}`;
}

function log(level, message) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

  const formatted = formatMessage(level, message);

  // Console output restricted in production
  if (process.env.NODE_ENV !== "production" || level === "error" || level === "warn") {
    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  writeBuffer.push(formatted + "\n");
  if (writeBuffer.length >= BUFFER_SIZE_LIMIT) {
    flushBuffer();
  } else {
    scheduleFlush();
  }
}

process.on("exit", flushBuffer);
process.on("SIGINT", () => {
  flushBuffer();
  process.exit(0);
});

module.exports = {
  info: (msg) => log("info", msg),
  warn: (msg) => log("warn", msg),
  error: (msg) => log("error", msg),
  debug: (msg) => log("debug", msg),
  logError: (context, error) => {
    const msg = `${context} — ${error.message}\n${error.stack || ""}`;
    log("error", msg);
  },
};