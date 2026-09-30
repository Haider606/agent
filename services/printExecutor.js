const fs = require("fs");
const path = require("path");
const { print } = require("pdf-to-printer");
const { OUTPUT_DIR } = require("../config");
const logger = require("../logs/logger");
const settings = require("../storage/settings");

let buildPOSReceipt = null;
let buildFulfillmentReceipt = null;

try {
  buildPOSReceipt = require("../assets/templates/receipt80mm");
} catch (err) {
  logger.warn("[PrintExecutor] POS template not found.");
}

try {
  buildFulfillmentReceipt = require("../assets/templates/fulfillment80mm");
} catch (err) {
  logger.warn("[PrintExecutor] Fulfillment template not found.");
}

function normalizeReceipt(rawReceipt) {
  if (Array.isArray(rawReceipt)) {
    const items = rawReceipt.map((i) => {
      const qty = Number(i.qty ?? i.quantity ?? 0);
      const rate = Number(i.rate ?? i.price ?? 0);
      return {
        name: i.name ?? "",
        qty,
        rate,
        total: i.total != null ? Number(i.total) : qty * rate,
      };
    });
    const subTotal = items.reduce((sum, i) => sum + i.total, 0);
    return { items, subTotal, grandTotal: subTotal };
  }
  if (rawReceipt && Array.isArray(rawReceipt.items)) {
    return rawReceipt;
  }
  return null;
}

async function cleanupOldTempFiles() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return;
    const files = await fs.promises.readdir(OUTPUT_DIR);
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      if (!file.startsWith("receipt-") || !file.endsWith(".pdf")) continue;
      const filePath = path.join(OUTPUT_DIR, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
          logger.info(`[PrintExecutor] Cleaned up old temp file: ${file}`);
        }
      } catch (err) {
        // Ignore individual cleanup errors
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

async function executePrint({
  printer,
  order = {},
  receipt,
  type,
  payload,
}) {
  if (!printer || typeof printer !== "string") {
    throw new Error("Printer name is required");
  }

  const normalized = normalizeReceipt(receipt);
  if (
    !normalized ||
    !Array.isArray(normalized.items) ||
    normalized.items.length === 0
  ) {
    throw new Error("receipt.items array is required");
  }

  try {
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (err) {
    logger.logError("[PrintExecutor] Could not create output directory", err);
    throw new Error("Failed to prepare output directory");
  }

  const fileName = `receipt-${Date.now()}.pdf`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  try {
    if (type === "fulfillment") {
      if (!buildFulfillmentReceipt) {
        throw new Error("Fulfillment template not loaded");
      }
      await buildFulfillmentReceipt(filePath, payload, settings.getPrint());
    } else {
      if (!buildPOSReceipt) {
        throw new Error("POS template not loaded");
      }
      await buildPOSReceipt(filePath, order, normalized, settings.getPrint());
    }

    logger.info(`[PrintExecutor] PDF built: ${fileName}`);

    const printProfile = settings.getPrint();
    const printOptions = { printer };
    // "fit" is safer for thermal drivers whose physical printable area is narrower than the roll.
    // Users can switch to noscale from Print Calibration if their driver already handles margins correctly.
    if (printProfile.driverScale) printOptions.scale = printProfile.driverScale;

    await print(filePath, printOptions);

    logger.info(`[PrintExecutor] Sent to printer "${printer}" successfully`);

    // Async cleanup of old files — don't block return
    cleanupOldTempFiles().catch(() => {});

    return { success: true, message: "Printed successfully" };
  } catch (err) {
    logger.logError(`[PrintExecutor] Print failed on "${printer}"`, err);
    throw err;
  } finally {
    // Guaranteed deletion regardless of success or failure
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        logger.warn(
          `[PrintExecutor] Could not delete temp file: ${unlinkErr.message}`
        );
        // Fallback async attempt
        fs.unlink(filePath, () => {});
      }
    }
  }
}

module.exports = { executePrint, normalizeReceipt };