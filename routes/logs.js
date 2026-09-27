

const express = require("express");
const fs = require("fs");
const path = require("path");
const { LOG_DIR } = require("../config");
const { requireAuth } = require("../middleware/auth");
const logger = require("../logs/logger");

const router = express.Router();

/**
 * Get the most recent log file in the log directory.
 */
function getLatestLogFile() {
  if (!fs.existsSync(LOG_DIR)) return null;

  const files = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith("stocko-") && f.endsWith(".log"))
    .sort()
    .reverse();

  return files.length > 0 ? path.join(LOG_DIR, files[0]) : null;
}

/**
 * Read the last N lines from a file.
 */
function readLastLines(filePath, maxLines = 100) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\\n").filter((l) => l.trim() !== "");
    return lines.slice(-maxLines);
  } catch (err) {
    return [];
  }
}

/**
 * Parse a log line into structured data.
 * Format: 2026-07-26T18:45:00.123Z [INFO] Message
 */
function parseLogLine(line) {
  const match = line.match(/^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z) \\[(\\w+)\\] (.+)$/);
  if (!match) return { raw: line, timestamp: null, level: "UNKNOWN", message: line };

  return {
    raw: line,
    timestamp: match[1],
    level: match[2],
    message: match[3],
  };
}

/**
 * GET /logs?lines=100
 */
router.get("/", requireAuth, (req, res) => {
  try {
    const maxLines = parseInt(req.query.lines, 10) || 100;
    const filePath = getLatestLogFile();

    if (!filePath) {
      return res.json({ success: true, logs: [], file: null });
    }

    const lines = readLastLines(filePath, maxLines);
    const parsed = lines.map(parseLogLine);

    res.json({
      success: true,
      logs: parsed,
      file: path.basename(filePath),
      total: parsed.length,
    });
  } catch (error) {
    logger.logError("[Logs] Failed to read logs", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
