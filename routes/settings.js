const express = require("express");
const printerModule = require("../services/printer");
const settings = require("../storage/settings");
const { requireAuth, requireManager } = require("../middleware/auth");
const logger = require("../logs/logger");

// Bulletproof: handle every possible export shape
let listPrinters;
if (typeof printerModule.listPrinters === "function") {
  listPrinters = printerModule.listPrinters;
} else if (typeof printerModule === "function") {
  listPrinters = printerModule;
} else if (printerModule.default && typeof printerModule.default.listPrinters === "function") {
  listPrinters = printerModule.default.listPrinters;
} else {
  logger.error("[Settings] Could not find listPrinters. Module keys: " + Object.keys(printerModule).join(", "));
}

const router = express.Router();

router.get("/printers", requireAuth, async (req, res) => {
  try {
    if (!listPrinters) {
      return res.status(500).json({
        success: false,
        error: "Printer service not available. Check server logs.",
      });
    }

    const printers = await listPrinters();
    const assigned = settings.getPrinters();

    res.json({
      success: true,
      availablePrinters: printers.map((p) => p.name || p),
      assigned,
      isManager: req.user.role === "Manager",
    });
  } catch (error) {
    logger.logError("[Settings] Failed to load printers", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/printers", requireAuth, requireManager, async (req, res) => {
  try {
    const { receipt, dispatch, label } = req.body || {};

    if (!listPrinters) {
      return res.status(500).json({
        success: false,
        error: "Printer service not available",
      });
    }

    const printers = await listPrinters();
    const availableNames = printers.map((p) => p.name || p);

    const updates = {};
    const errors = [];

    if (receipt !== undefined) {
      if (receipt === null || availableNames.includes(receipt)) {
        updates.receipt = receipt;
      } else {
        errors.push(`Receipt printer "${receipt}" not found`);
      }
    }

    if (dispatch !== undefined) {
      if (dispatch === null || availableNames.includes(dispatch)) {
        updates.dispatch = dispatch;
      } else {
        errors.push(`Dispatch printer "${dispatch}" not found`);
      }
    }

    if (label !== undefined) {
      if (label === null || availableNames.includes(label)) {
        updates.label = label;
      } else {
        errors.push(`Label printer "${label}" not found`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors.join("; "),
      });
    }

    settings.setPrinters(updates);
    logger.info(`[Settings] Printers updated by ${req.user.email}: ${JSON.stringify(updates)}`);

    res.json({
      success: true,
      message: "Printer settings saved",
      assigned: settings.getPrinters(),
    });
  } catch (error) {
    logger.logError("[Settings] Failed to save printers", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;