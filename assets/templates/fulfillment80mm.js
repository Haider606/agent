const PDFDocument = require("pdfkit");
const fs = require("fs");

async function buildFulfillmentReceipt(filePath, payload = {}) {
  return new Promise((resolve, reject) => {

    const request = payload.request || {};
    const receipt = payload.receipt || {};
    const user = payload.user || {};

    const PAGE_WIDTH = 226;
    const MARGIN = 12;
    const USABLE_WIDTH = PAGE_WIDTH - (MARGIN * 2);

    const doc = new PDFDocument({
      size: [PAGE_WIDTH, 2000],
      margins: {
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
      },
    });

    const stream = fs.createWriteStream(filePath);

    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);

    doc.on("error", reject);
    doc.pipe(stream);

    const left = MARGIN;

    function hr() {
      doc
        .moveDown(0.3)
        .font("Helvetica")
        .fontSize(9)
        .text("-".repeat(38), left, doc.y, {
          width: USABLE_WIDTH,
          align: "center",
        })
        .moveDown(0.3);
    }

    function center(text, size = 10, bold = false) {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .text(text || "", left, doc.y, {
          width: USABLE_WIDTH,
          align: "center",
        });

      doc.moveDown(0.2);
    }

    function row(label, value) {
      const y = doc.y;

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(label, left, y, {
          width: 80,
          align: "left",
        });

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(value || "", left + 80, y, {
          width: USABLE_WIDTH - 80,
          align: "right",
        });

      doc.moveDown(0.2);
    }

    // =========================
    // HEADER
    // =========================

    center(
  user.branch_name ||
  request.branch_name ||
  "Main Branch",
  18,
  true
);

center("FULFILLMENT SLIP", 11, true);

    hr();

    row("Branch", user.branch_name || "");
    row("Request ID", request.id || "");
    row("Department", request.department || "");
    row("Status", payload.newStatus || request.status || "");

    hr();

    row("Created By", request.created_by_name || "");

    row(
      "Fulfilled By",
      request.fulfilled_by_name ||
      user.name ||
      ""
    );

    const printDate = new Date(
      payload.timestamp || Date.now()
    );

    row("Date", printDate.toLocaleDateString());

    row("Time", printDate.toLocaleTimeString());

    hr();

    center("ITEM DETAILS", 10, true);

    const colItem = 110;
    const colQty = 35;
    const colUnit = USABLE_WIDTH - colItem - colQty;

    doc.font("Helvetica-Bold").fontSize(9);

    const headerY = doc.y;

    doc.text(
      "Item",
      left,
      headerY,
      {
        width: colItem,
      }
    );

    doc.text(
      "Qty",
      left + colItem,
      headerY,
      {
        width: colQty,
        align: "center",
      }
    );

    doc.text(
      "Unit",
      left + colItem + colQty,
      headerY,
      {
        width: colUnit,
        align: "right",
      }
    );

    doc.moveDown(0.4);

    hr();

    const items = Array.isArray(receipt.items)
      ? receipt.items
      : [];

    let totalQty = 0;
        // =========================
    // ITEMS
    // =========================

    items.forEach((item) => {
      const qty = Number(item.quantity ?? item.qty ?? 0);
      const unit = item.unit || "";

      totalQty += qty;

      const rowY = doc.y;

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(item.name || "", left, rowY, {
          width: colItem,
          align: "left",
        });

      doc.text(String(qty), left + colItem, rowY, {
        width: colQty,
        align: "center",
      });

      doc.text(unit, left + colItem + colQty, rowY, {
        width: colUnit,
        align: "right",
      });

      doc.moveDown(0.35);
    });

    hr();

    // =========================
    // SUMMARY
    // =========================

    row("Total Items", String(items.length));
    row("Total Qty", String(totalQty));

    hr();

    // =========================
    // FOOTER
    // =========================

    center("Internal Fulfillment Copy", 10, true);

    center(
      request.branch_name ||
      user.branch_name ||
      "",
      9
    );

    center("Software By Stocko", 9);

    center("www.stocko.app", 8);

    doc.moveDown(0.5);

    // Auto crop page height
    doc.page.height = doc.y + MARGIN;

    doc.end();
  });
}

module.exports = buildFulfillmentReceipt;