const MM_TO_PT = 72 / 25.4;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function getPrintLayout(settings = {}) {
  const paperWidthMm = clamp(settings.paperWidthMm, 48, 100, 80);
  const marginLeftMm = clamp(settings.marginLeftMm, 0, 15, 4);
  const marginRightMm = clamp(settings.marginRightMm, 0, 15, 6);
  const maxPrintable = Math.max(30, paperWidthMm - marginLeftMm - marginRightMm);
  const printableWidthMm = clamp(settings.printableWidthMm, 30, maxPrintable, Math.min(70, maxPrintable));
  const fontScale = clamp(settings.fontScale, 0.75, 1.25, 1);

  const pageWidth = paperWidthMm * MM_TO_PT;
  const left = marginLeftMm * MM_TO_PT;
  const usableWidth = printableWidthMm * MM_TO_PT;
  const rightEdge = left + usableWidth;

  return { paperWidthMm, printableWidthMm, marginLeftMm, marginRightMm, fontScale, pageWidth, left, usableWidth, rightEdge, top: 10, bottom: 10 };
}

module.exports = { getPrintLayout, MM_TO_PT };
