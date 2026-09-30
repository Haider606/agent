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

router.post("/test", allowLocalOrAuth, async (req, res) => {
  try {
    const targetPrinter = req.body?.printer || settings.getPrinters().receipt;
    if (!targetPrinter) return res.status(400).json({ success: false, error: "Select a receipt printer first." });

    const now = new Date();
    const order = {
      shopName: "STOCKO", status: "PRINT CALIBRATION", orderId: "TEST-80MM",
      date: now.toLocaleDateString(), time: now.toLocaleTimeString(), invoice: "TEST", user: "Print Agent"
    };
    const receipt = {
      items: [
        { name: "LEFT / RIGHT EDGE TEST", qty: 1, rate: 100, total: 100 },
        { name: "Long item name checks wrapping safely", qty: 2, rate: 50, total: 100 }
      ],
      subTotal: 200, grandTotal: 200, customerName: "Calibration Test"
    };
    await executePrint({ printer: targetPrinter, order, receipt });
    res.json({ success: true, message: "Calibration test sent to printer" });
  } catch (error) {
    logger.logError("[Print] Test failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;