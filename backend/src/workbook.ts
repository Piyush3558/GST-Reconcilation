import ExcelJS from "exceljs";
import type { CellValue, Run } from "../../shared/types.js";

const moneyFormat = "#,##0.00;[Red](#,##0.00);0.00";
const headerFill = "FF173D49";
const headerFont = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const bodyFont = { name: "Arial", size: 10, color: { argb: "FF1F2937" } };

function safeValue(value: CellValue): CellValue {
  // A source string that starts with '=' remains a literal string in ExcelJS.
  return value;
}

function styleHeader(sheet: ExcelJS.Worksheet, rowNumber: number) {
  const row = sheet.getRow(rowNumber);
  row.height = 32;
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
    cell.font = headerFont;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      right: { style: "thin", color: { argb: "FFFFFFFF" } },
      bottom: { style: "thin", color: { argb: "FFB7C7CE" } },
    };
  });
}

function styleBody(sheet: ExcelJS.Worksheet, startRow: number, endRow: number) {
  for (let row = startRow; row <= endRow; row++) {
    const target = sheet.getRow(row);
    target.height = 19;
    target.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = bodyFont;
      cell.alignment = { vertical: "middle" };
    });
  }
}

function addPurchase(book: ExcelJS.Workbook, run: Run) {
  const sheet = book.addWorksheet("PR", { views: [{ state: "frozen", ySplit: run.inputs.purchaseSheet.headerRow }] });
  for (const row of run.inputs.purchaseSheet.values)
    sheet.addRow(row.map(safeValue));
  const headerRow = run.inputs.purchaseSheet.headerRow;
  styleHeader(sheet, headerRow);
  styleBody(sheet, headerRow + 1, sheet.rowCount);
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: sheet.rowCount, column: sheet.columnCount },
  };
  for (let column = 1; column <= sheet.columnCount; column++) {
    let width = 10;
    for (let row = 1; row <= Math.min(sheet.rowCount, 250); row++)
      width = Math.max(width, String(sheet.getCell(row, column).text ?? "").length + 2);
    sheet.getColumn(column).width = Math.min(width, 38);
  }
}

const b2bHeaders = [
  "GSTIN of supplier",
  "Supplier name",
  "Invoice number",
  "Invoice type",
  "Invoice Date",
  "Invoice Value",
  "Place of supply",
  "Supply Attract Reverse Charge",
  "Taxable Value",
  "Integrated Tax",
  "Central Tax",
  "State/UT Tax",
  "Total - 2B",
  "GSTR-1/IFF/GSTR-5 Period",
  "GSTR-1/IFF/GSTR-5 Filing Date",
  "ITC Availability",
  "Reason",
  "Applicable % of Tax Rate",
  "Source",
  "IRN",
  "IRN Date",
];

function addB2B(book: ExcelJS.Workbook, run: Run) {
  const sheet = book.addWorksheet("B2B", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(b2bHeaders);
  for (const record of run.b2b)
    sheet.addRow([
      record.supplierGstin,
      record.supplierName,
      record.invoice,
      record.invoiceType,
      record.invoiceDate,
      record.invoiceValue,
      record.placeOfSupply,
      record.reverseCharge,
      record.taxableValue === null ? null : Number(record.taxableValue),
      Number(record.igst),
      Number(record.cgst),
      Number(record.sgst),
      Number(record.totalTax),
      record.returnPeriod,
      record.filingDate,
      record.itcAvailability,
      record.reason,
      record.applicableTaxRate,
      record.source,
      record.irn,
      record.irnDate,
    ]);
  styleHeader(sheet, 1);
  styleBody(sheet, 2, sheet.rowCount);
  sheet.autoFilter = { from: "A1", to: `U${sheet.rowCount}` };
  [9, 10, 11, 12, 13].forEach((column) => (sheet.getColumn(column).numFmt = moneyFormat));
  const widths = [20, 34, 24, 15, 14, 16, 18, 19, 16, 15, 15, 15, 15, 19, 19, 16, 28, 16, 16, 42, 16];
  widths.forEach((width, index) => (sheet.getColumn(index + 1).width = width));
}

function addReconciliation(book: ExcelJS.Workbook, run: Run) {
  const sheet = book.addWorksheet("Reconciliation", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 4 }],
  });
  sheet.addRow([
    "Vendor Invoice No.",
    "Vendor Invoice Date",
    "Supplier Name",
    "Supplier GSTIN",
    "Sum of GST Base Amount",
    "Sum of IGST Amt.",
    "Sum of CGST Amt.",
    "Sum of SGST Amt.",
    "Total as per PR",
    "Total as per 2B",
    "Diff",
    "Remarks",
  ]);
  const b2bEnd = Math.max(2, run.b2b.length + 1);
  for (const [index, item] of run.reconciliation.entries()) {
    const rowNumber = index + 2;
    const row = sheet.addRow([
      item.invoice,
      item.invoiceDate || null,
      item.supplierName,
      item.supplierGstin || null,
      Number(item.gstBaseAmount),
      Number(item.igst),
      Number(item.cgst),
      Number(item.sgst),
      { formula: `SUM(F${rowNumber}:H${rowNumber})`, result: Number(item.totalPr) },
      {
        formula: `SUMIFS(B2B!$M$2:$M$${b2bEnd},B2B!$C$2:$C$${b2bEnd},A${rowNumber},B2B!$A$2:$A$${b2bEnd},D${rowNumber})`,
        result: Number(item.total2B),
      },
      { formula: `I${rowNumber}-J${rowNumber}`, result: Number(item.difference) },
      item.remarks || null,
    ]);
    row.height = 20;
  }
  styleHeader(sheet, 1);
  styleBody(sheet, 2, sheet.rowCount);
  for (let row = 2; row <= sheet.rowCount; row++) {
    sheet.getCell(row, 12).alignment = {
      vertical: "top",
      wrapText: true,
    };
    if (run.reconciliation[row - 2].diagnosticCode !== "matched")
      sheet.getRow(row).height = 48;
  }
  sheet.autoFilter = { from: "A1", to: `L${sheet.rowCount}` };
  for (let column = 5; column <= 11; column++) sheet.getColumn(column).numFmt = moneyFormat;
  [22, 18, 38, 20, 22, 18, 18, 18, 18, 18, 16, 72].forEach(
    (width, index) => (sheet.getColumn(index + 1).width = width),
  );
}

export async function exportWorkbook(run: Run): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "GST Reconciliation";
  book.created = new Date(run.createdAt);
  book.calcProperties.fullCalcOnLoad = true;
  addPurchase(book, run);
  addB2B(book, run);
  addReconciliation(book, run);
  return Buffer.from(await book.xlsx.writeBuffer());
}
