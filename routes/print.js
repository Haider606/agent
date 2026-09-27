const express = require("express");
const { executePrint } = require("../services/printExecutor");
const settings = require("../storage/settings");
const logger = require("../logs/logger");

const router = express.Router();

function isLocal(req) {
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1")
  );
}

// Local requests bypass auth (same machine is safe)
function allowLocalOrAuth(req, res, next) {
  if (isLocal(req)) {
    req.user = { role: "Manager", email: "local@pos" };
    return next();
  }
  const { requireAuth } = require("../middleware/auth");
  return requireAuth(req, res, next);
}

router.post("/", allowLocalOrAuth, async (req, res) => {
  try {
    const { printer, order, receipt } = req.body || {};
    const targetPrinter = printer || settings.getPrinters().receipt;

    if (!targetPrinter) {
      return res.status(400).json({
        success: false,
        error: "No printer assigned. Go to Settings and select a receipt printer.",
      });
    }

    logger.info(`[Print] Printing to ${targetPrinter}`);
    await executePrint({ printer: targetPrinter, order, receipt });

    res.json({ success: true, message: "Printed successfully" });
  } catch (error) {
    logger.logError("[Print] Failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;