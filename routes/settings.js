const express = require("express");
const printerModule = require("../services/printer");
const settings = require("../storage/settings");
const { requireAuth, requirePrinterAdmin, requireDeveloper } = require("../middleware/auth");
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
      canManagePrinters: ["Manager", "Developer"].includes(req.user.role),
      isDeveloper: req.user.role === "Developer",
    });
  } catch (error) {
    logger.logError("[Settings] Failed to load printers", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/printers", requireAuth, requirePrinterAdmin, async (req, res) => {
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

router.get("/print", requireAuth, (req, res) => {
  res.json({ success: true, print: settings.getPrint(), canCalibratePrint: req.user.role === "Developer" });
});

router.post("/print", requireAuth, requireDeveloper, (req, res) => {
  try {
    const body = req.body || {};
    const num = (key, min, max) => {
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${key} must be between ${min} and ${max}`);
      }
      return value;
    };

    const paperWidthMm = num("paperWidthMm", 48, 100);
    const printableWidthMm = num("printableWidthMm", 30, 90);
    const marginLeftMm = num("marginLeftMm", 0, 15);
    const marginRightMm = num("marginRightMm", 0, 15);
    const fontScale = num("fontScale", 0.75, 1.25);
    const driverScale = ["fit", "noscale", "shrink"].includes(body.driverScale) ? body.driverScale : "fit";

    if (marginLeftMm + printableWidthMm + marginRightMm > paperWidthMm + 0.01) {
      throw new Error("Left margin + printable width + right margin cannot exceed paper width");
    }

    settings.setPrint({ paperWidthMm, printableWidthMm, marginLeftMm, marginRightMm, fontScale, driverScale });
    logger.info(`[Settings] Print calibration updated by ${req.user.email}`);
    res.json({ success: true, message: "Print calibration saved", print: settings.getPrint() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;