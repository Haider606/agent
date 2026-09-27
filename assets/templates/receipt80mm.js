const PDFDocument = require("pdfkit");
const fs = require("fs");

/**
 * Builds an 80mm thermal-style receipt PDF for STORE (retail).
 * No GST/VAT/Tax sections — clean Sub Total + Grand Total only.
 */
async function buildReceipt(filePath, order = {}, receipt = {}) {
  return new Promise((resolve, reject) => {
    const PAGE_WIDTH = 226;          // 80mm in points
    const MARGIN = 12;               // safe margin to avoid printer dead-zone
    const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

    const doc = new PDFDocument({
      size: [PAGE_WIDTH, 2000],      // tall page, cropped later
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: "Receipt",
        Author: order.shopName || "Store Receipt",
      },
    });

    const stream = fs.createWriteStream(filePath);
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    const left = MARGIN;

    // ── Helpers ─────────────────────────────────────────────

    const hr = () => {
      doc
        .moveDown(0.3)
        .font("Helvetica")
        .fontSize(9)
        .text("-".repeat(38), left, doc.y, { width: USABLE_WIDTH, align: "center" })
        .moveDown(0.3);
    };

    const centerText = (text, opts = {}) => {
      const { size = 10, bold = false, extraDown = 0.2 } = opts;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      doc.text(text || "", left, doc.y, { width: USABLE_WIDTH, align: "center" });
      doc.moveDown(extraDown);
    };

    const rowLR = (leftText, rightText, opts = {}) => {
      const { boldLeft = false, boldRight = false, size = 10, extraDown = 0.25 } = opts;
      const y = doc.y;
      const leftW = USABLE_WIDTH * 0.45;
      const rightW = USABLE_WIDTH * 0.45;
      const rightX = left + leftW;

      doc.font(boldLeft ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      doc.text(leftText || "", left, y, { width: leftW, align: "left" });

      doc.font(boldRight ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      doc.text(rightText || "", rightX, y, { width: rightW, align: "right" });

      doc.moveDown(extraDown);
    };

    // ── HEADER ──────────────────────────────────────────────

    centerText(order.shopName || "FIFTH AVENUE", { size: 16, bold: true, extraDown: 0.1 });
    centerText("PIZZA CO", { size: 12, bold: true });

    if (order.address) centerText(order.address, { size: 9, extraDown: 0.15 });
    if (order.phone)   centerText(order.phone,   { size: 9, extraDown: 0.15 });

    centerText(order.status || "Unpaid", { size: 11, bold: true, extraDown: 0.3 });

    hr();

    // ── ORDER META ──────────────────────────────────────────

    rowLR("Order ID: " + (order.orderId || ""), "Date: " + (order.date || ""), { size: 9 });
    if (order.time) rowLR("", order.time, { size: 9 });

    rowLR(
      "Invoice#: " + (order.invoice || ""),
      "User: " + (order.user || ""),
      { boldRight: true, size: 9 }
    );

    hr();

    // ── ORDER DETAIL TABLE ──────────────────────────────────

    centerText("Order Detail", { size: 11, bold: true, extraDown: 0.3 });

    const colItemW  = USABLE_WIDTH * 0.44;
    const colQtyW   = USABLE_WIDTH * 0.13;
    const colRateW  = USABLE_WIDTH * 0.21;
    const colTotalW = USABLE_WIDTH * 0.22;

    const colItemX  = left;
    const colQtyX   = left + colItemW;
    const colRateX  = left + colItemW + colQtyW;
    const colTotalX = left + colItemW + colQtyW + colRateW;

    const headerY = doc.y;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Item",  colItemX,  headerY, { width: colItemW,  align: "left" });
    doc.text("Qty",   colQtyX,   headerY, { width: colQtyW,   align: "right" });
    doc.text("Rate",  colRateX,  headerY, { width: colRateW,  align: "right" });
    doc.text("Total", colTotalX, headerY, { width: colTotalW, align: "right" });
    doc.moveDown(0.35);

    hr();

    // ── ITEMS ───────────────────────────────────────────────

    const items = Array.isArray(receipt.items) ? receipt.items : [];
    let computedSubTotal = 0;

    items.forEach((item) => {
      const qty   = item.qty ?? 0;
      const rate  = item.rate ?? 0;
      const total = item.total ?? qty * rate;
      computedSubTotal += total;

      const rowY = doc.y;
      let itemName = item.name || "";
      if (item.modified) itemName += " (Mod)";

      doc.font("Helvetica").fontSize(9);
      doc.text(itemName, colItemX, rowY, { width: colItemW, align: "left" });
      doc.text(String(qty),   colQtyX,   rowY, { width: colQtyW,   align: "right" });
      doc.text(String(rate),  colRateX,  rowY, { width: colRateW,  align: "right" });
      doc.font("Helvetica-Bold").text(String(total), colTotalX, rowY, {
        width: colTotalW,
        align: "right",
      });
      doc.moveDown(0.3);
    });

    hr();

    // ── TOTALS (CLEAN — NO GST/VAT/TAX) ─────────────────────

    const subTotal   = receipt.subTotal ?? computedSubTotal;
    const grandTotal = receipt.grandTotal ?? subTotal;

    rowLR("Sub Total", `${subTotal} Rs`, { size: 10, boldRight: true });
    doc.moveDown(0.2);

    // Single clean Grand Total — no tax/gst/vat blocks
    doc.font("Helvetica-Bold").fontSize(11);
    const gtY = doc.y;
    doc.text("GRAND TOTAL", left, gtY, { width: USABLE_WIDTH * 0.50, align: "left" });
    doc.text(`${grandTotal} Rs`, left + USABLE_WIDTH * 0.50, gtY, {
      width: USABLE_WIDTH * 0.50,
      align: "right",
    });
    doc.moveDown(0.3);

    hr();

   // ── CUSTOMER DETAIL ─────────────────────────────────────

centerText("Customer Detail", { 
  size: 11, 
  bold: true, 
  extraDown: 0.3 
});

centerText(
  receipt.customerName || "Walk-in Customer",
  {
    size: 10,
    bold: true
  }
);

if (receipt.customerPhone) {
  centerText(
    "Phone: " + receipt.customerPhone,
    {
      size: 9
    }
  );
}

if (receipt.deliveryAddress) {
  centerText(
    "Address: " + receipt.deliveryAddress,
    {
      size: 9
    }
  );
}
if (receipt.department) {
  centerText("Department: " + receipt.department, {
    size: 9
  });
}

if (receipt.status) {
  centerText("Status: " + receipt.status, {
    size: 9
  });
}

if (receipt.createdBy) {
  centerText("Created By: " + receipt.createdBy, {
    size: 9
  });
}

if (receipt.fulfilledBy) {
  centerText("Fulfilled By: " + receipt.fulfilledBy, {
    size: 9
  });
}
    // ── PRINTED TIMESTAMP ───────────────────────────────────

    if (order.printedDate || order.printedTime) {
      rowLR(
        "",
        "Printed: " + (order.printedDate || "") + " " + (order.printedTime || ""),
        { size: 9 }
      );
    }

    doc.moveDown(0.3);
    hr();

    // ── COMPLAINT & FOOTER ──────────────────────────────────

    centerText("For any Complaint & Suggestions", { size: 9, extraDown: 0.15 });
    centerText(
      `Please Contact us @ ${order.complaintPhone || order.phone || ""}`,
      { size: 9, extraDown: 0.3 }
    );

    hr();

    centerText("Software By Stocko", { size: 9, extraDown: 0.15 });
    centerText("Thank You!", { size: 10, bold: true });

    doc.moveDown(0.5);

    // ── AUTO-CROP HEIGHT ────────────────────────────────────
    doc.page.height = doc.y + MARGIN;

    doc.end();
  });
}

module.exports = buildReceipt;