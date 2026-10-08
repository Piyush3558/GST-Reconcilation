import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { Decimal } from "decimal.js";
import type {
  B2BRecord,
  CellValue,
  ParsedGstr2B,
  ParsedPurchase,
  SourceSheet,
} from "../../shared/types.js";

export function validateArchive(bytes: Buffer): Promise<void> {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("Workbook exceeds 20 MB limit.");
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(new Error("Upload must be a valid XLSX workbook."));
      let total = 0;
      let count = 0;
      let workbook = false;
      let stopped = false;
      const fail = (message: string) => {
        if (stopped) return;
        stopped = true;
        zip.close();
        reject(new Error(message));
      };
      zip.on("error", () => fail("Invalid workbook archive."));
      zip.on("entry", (entry: yauzl.Entry) => {
        total += entry.uncompressedSize;
        count++;
        if (entry.fileName === "xl/workbook.xml") workbook = true;
        if (total > 100 * 1024 * 1024 || count > 5000)
          return fail("Expanded workbook exceeds processing limits.");
        if (/vbaProject|embeddings\//i.test(entry.fileName))
          return fail("Macros and embedded objects are not supported.");
        zip.readEntry();
      });
      zip.on("end", () => {
        if (stopped) return;
        if (!workbook) reject(new Error("Not an XLSX workbook."));
        else resolve();
      });
      zip.readEntry();
    }),
  );
}

export function cellValue(cell: ExcelJS.Cell): CellValue {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (["string", "number", "boolean"].includes(typeof value))
    return value as CellValue;
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value)
      return cell.result === undefined ? null : primitive(cell.result);
    if ("richText" in value)
      return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) throw new Error(`Cell ${cell.address} contains ${value.error}.`);
  }
  return String(value);
}

export const value = cellValue;

function primitive(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return ["string", "number", "boolean"].includes(typeof value)
    ? (value as CellValue)
    : String(value);
}

function display(cell: ExcelJS.Cell): string {
  const value = cellValue(cell);
  if (typeof value === "number" && /^0+$/.test(cell.numFmt) && Number.isInteger(value))
    return String(value).padStart(cell.numFmt.length, "0");
  return value === null ? "" : cell.text || String(value);
}

const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/₹/g, "").replace(/[^a-z0-9]/g, "");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const readOptions: Partial<ExcelJS.XlsxReadOptions> = {
  ignoreNodes: [
    "dataValidations",
    "conditionalFormatting",
    "drawing",
    "picture",
    "table",
    "pivotTable",
    "sheetProtection",
    "pageMargins",
    "pageSetup",
    "headerFooter",
    "printOptions",
    "rowBreaks",
    "colBreaks",
  ],
};
const money = (value: unknown, label: string): string => {
  if (value === null || value === undefined || String(value).trim() === "") return "0";
  const raw = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Invalid ${label} amount: ${String(value)}`);
  const decimal = new Decimal(raw);
  if (!decimal.isFinite()) throw new Error(`Invalid ${label} amount: ${String(value)}`);
  return decimal.toString();
};

interface LocatedSheet {
  sheet: ExcelJS.Worksheet;
  headerRow: number;
  columns: Map<string, number>;
}

function columnsAt(sheet: ExcelJS.Worksheet, row: number): Map<string, number> {
  const columns = new Map<string, number>();
  for (let col = 1; col <= sheet.columnCount; col++) {
    const key = normalizeHeader(display(sheet.getCell(row, col)));
    if (key && !columns.has(key)) columns.set(key, col);
  }
  return columns;
}

function findCandidates(
  book: ExcelJS.Workbook,
  required: string[],
): LocatedSheet[] {
  const candidates: LocatedSheet[] = [];
  for (const sheet of book.worksheets) {
    for (let row = 1; row <= Math.min(sheet.rowCount, 30); row++) {
      const columns = columnsAt(sheet, row);
      if (required.every((name) => columns.has(normalizeHeader(name)))) {
        candidates.push({ sheet, headerRow: row, columns });
        break;
      }
    }
  }
  return candidates;
}

function choose(
  candidates: LocatedSheet[],
  preferredName: string,
  label: string,
): LocatedSheet {
  const preferred = candidates.find(
    ({ sheet }) => sheet.name.trim().toLowerCase() === preferredName.toLowerCase(),
  );
  if (preferred) return preferred;
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error(`No supported ${label} sheet found.`);
  throw new Error(
    `Multiple possible ${label} sheets found (${candidates.map((x) => x.sheet.name).join(", ")}). Rename the intended sheet ${preferredName}.`,
  );
}

function copySource(sheet: ExcelJS.Worksheet, headerRow: number): SourceSheet {
  const rows = Math.max(sheet.rowCount, headerRow);
  const cols = Math.max(sheet.actualColumnCount, sheet.getRow(headerRow).actualCellCount);
  const values: CellValue[][] = [];
  for (let row = 1; row <= rows; row++) {
    const output: CellValue[] = [];
    for (let col = 1; col <= cols; col++) output.push(cellValue(sheet.getCell(row, col)));
    values.push(output);
  }
  return { name: sheet.name, headerRow, values };
}

const rawIdentifier = (cell: ExcelJS.Cell): string | number => {
  const value = cellValue(cell);
  return typeof value === "number" ? value : display(cell).trim();
};

export function extractPurchaseFromWorkbook(
  book: ExcelJS.Workbook,
  bytes: Buffer,
  filename: string,
): ParsedPurchase {
  const located = choose(
    findCandidates(book, [
      "Supplier Name",
      "Supplier GSTIN",
      "Vendor Invoice No.",
      "Vendor Invoice Date",
      "GST Base Amount",
      "IGST Amt.",
      "CGST Amt.",
      "SGST Amt.",
    ]),
    "PR-Aug",
    "Purchase Register",
  );
  const col = (name: string) => located.columns.get(normalizeHeader(name))!;
  const lines = [];
  const lastRow = located.sheet.rowCount;
  for (let row = located.headerRow + 1; row <= lastRow; row++) {
    const invoiceCell = located.sheet.getCell(row, col("Vendor Invoice No."));
    const supplier = display(located.sheet.getCell(row, col("Supplier Name"))).trim();
    const gstin = display(located.sheet.getCell(row, col("Supplier GSTIN"))).trim();
    const date = display(located.sheet.getCell(row, col("Vendor Invoice Date"))).trim();
    const amounts = ["GST Base Amount", "IGST Amt.", "CGST Amt.", "SGST Amt."].map(
      (name) => cellValue(located.sheet.getCell(row, col(name))),
    );
    if (!display(invoiceCell).trim() && !supplier && !gstin && !date && amounts.every((x) => x === null))
      continue;
    lines.push({
      sourceRow: row,
      invoice: rawIdentifier(invoiceCell),
      invoiceDate: date,
      supplierName: supplier,
      supplierGstin: gstin,
      gstBaseAmount: money(amounts[0], "GST Base Amount"),
      igst: money(amounts[1], "IGST"),
      cgst: money(amounts[2], "CGST"),
      sgst: money(amounts[3], "SGST"),
    });
  }
  if (!lines.length) throw new Error("No Purchase Register rows found.");
  return {
    filename: basename(filename),
    hash: sha(bytes),
    sourceSheet: copySource(located.sheet, located.headerRow),
    lines,
  };
}

export async function parsePurchase(
  bytes: Buffer,
  filename: string,
): Promise<ParsedPurchase> {
  await validateArchive(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never, readOptions);
  return extractPurchaseFromWorkbook(book, bytes, filename);
}

const optionalColumn = (columns: Map<string, number>, ...names: string[]) => {
  for (const name of names) {
    const found = columns.get(normalizeHeader(name));
    if (found) return found;
  }
  return 0;
};

export function extractGstr2BFromWorkbook(
  book: ExcelJS.Workbook,
  bytes: Buffer,
  filename: string,
): ParsedGstr2B {
  const located = choose(
    findCandidates(book, [
      "GSTIN of supplier",
      "Invoice number",
      "Integrated Tax(₹)",
      "Central Tax(₹)",
      "State/UT Tax(₹)",
    ]),
    "B2B",
    "GSTR-2B B2B",
  );
  const c = (...names: string[]) => optionalColumn(located.columns, ...names);
  const records: B2BRecord[] = [];
  const get = (row: number, col: number): CellValue =>
    col ? cellValue(located.sheet.getCell(row, col)) : null;
  const text = (row: number, col: number) =>
    col ? display(located.sheet.getCell(row, col)).trim() : "";
  const lastRow = located.sheet.rowCount;
  for (let row = located.headerRow + 1; row <= lastRow; row++) {
    const invoiceCol = c("Invoice number");
    const gstinCol = c("GSTIN of supplier");
    if (!text(row, invoiceCol) && !text(row, gstinCol)) continue;
    const igst = money(get(row, c("Integrated Tax(₹)")), "Integrated Tax");
    const cgst = money(get(row, c("Central Tax(₹)")), "Central Tax");
    const sgst = money(get(row, c("State/UT Tax(₹)")), "State/UT Tax");
    records.push({
      sourceRow: row,
      supplierGstin: text(row, gstinCol),
      supplierName: text(row, c("Supplier name", "Trade/Legal name")),
      invoice: rawIdentifier(located.sheet.getCell(row, invoiceCol)),
      invoiceType: get(row, c("Invoice type")),
      invoiceDate: get(row, c("Invoice Date")),
      invoiceValue: get(row, c("Invoice Value(₹)", "Invoice Value")),
      placeOfSupply: get(row, c("Place of supply")),
      reverseCharge: get(row, c("Supply Attract Reverse Charge")),
      taxableValue: get(row, c("Taxable Value (₹)", "Taxable Value")),
      igst,
      cgst,
      sgst,
      totalTax: new Decimal(igst).plus(cgst).plus(sgst).toString(),
      returnPeriod: get(row, c("GSTR-1/IFF/GSTR-5 Period")),
      filingDate: get(row, c("GSTR-1/IFF/GSTR-5 Filing Date")),
      itcAvailability: get(row, c("ITC Availability")),
      reason: get(row, c("Reason")),
      applicableTaxRate: get(row, c("Applicable % of Tax Rate")),
      source: get(row, c("Source")),
      irn: get(row, c("IRN")),
      irnDate: get(row, c("IRN Date")),
    });
  }
  if (!records.length) throw new Error("No GSTR-2B B2B rows found.");
  return {
    filename: basename(filename),
    hash: sha(bytes),
    records,
  };
}

export async function parseGstr2B(
  bytes: Buffer,
  filename: string,
): Promise<ParsedGstr2B> {
  await validateArchive(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never, readOptions);
  return extractGstr2BFromWorkbook(book, bytes, filename);
}

export async function parseReferenceWorkbook(
  bytes: Buffer,
  filename: string,
): Promise<{ purchase: ParsedPurchase; gst: ParsedGstr2B }> {
  await validateArchive(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never, readOptions);
  return {
    purchase: extractPurchaseFromWorkbook(book, bytes, filename),
    gst: extractGstr2BFromWorkbook(book, bytes, filename),
  };
}
