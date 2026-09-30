const express = require("express");
const printerModule = require("../services/printer");
const settings = require("../storage/settings");
const { requireAuth, requirePrinterAdmin, requireDeveloper } = require("../middleware/auth");
const logger = require("../logs/logger");

// Bulletproof import
let listPrinters;
if (typeof printerModule.listPrinters === "function") {
  listPrinters = printerModule.listPrinters;
} else if (typeof printerModule === "function") {
  listPrinters = printerModule;
} else if (printerModule.default && typeof printerModule.default.listPrinters === "function") {
  listPrinters = printerModule.default.listPrinters;
} else {
  logger.error("[Printers] listPrinters not found. Keys: " + Object.keys(printerModule).join(", "));
}

const router = express.Router();

// GET /printers
router.get("/", requireAuth, async (req, res) => {
  try {
    if (!listPrinters) {
      return res.status(500).json({ success: false, error: "Printer service unavailable" });
    }

    const printers = await listPrinters();
    const names = printers.map((p) => (typeof p === "string" ? p : p.name)).filter(Boolean);

    logger.info(`[Printers] Found ${names.length} printers for ${req.user.email}`);

    res.json({
      success: true,
      availablePrinters: names,
      assigned: settings.getPrinters(),
      canManagePrinters: ["Manager", "Developer"].includes(req.user.role),
      isDeveloper: req.user.role === "Developer",
    });
  } catch (error) {
    logger.logError("[Printers] List failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /printers
router.post("/", requireAuth, requirePrinterAdmin, async (req, res) => {
  try {
    const { receipt, dispatch, label } = req.body || {};
    const printers = await listPrinters();
    const availableNames = printers.map((p) => (typeof p === "string" ? p : p.name)).filter(Boolean);

    const updates = {};
    const errors = [];

    ["receipt", "dispatch", "label"].forEach((key) => {
      const val = req.body[key];
      if (val !== undefined) {
        if (val === null || availableNames.includes(val)) {
          updates[key] = val;
        } else {
          errors.push(`${key} printer "${val}" not found`);
        }
      }
    });

    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join("; ") });
    }

    settings.setPrinters(updates);
    logger.info(`[Printers] Saved by ${req.user.email}: ${JSON.stringify(updates)}`);

    res.json({ success: true, assigned: settings.getPrinters() });
  } catch (error) {
    logger.logError("[Printers] Save failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;