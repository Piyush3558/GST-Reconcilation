import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { Document, Issue, Parsed } from "../shared/types.js";
import {
  dateValue,
  exactInvoice,
  gstin,
  money,
  normalizedInvoice,
  sum,
  validGstin,
} from "./normalize.js";

export function validateArchive(bytes: Buffer): Promise<void> {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("Workbook exceeds 20 MB limit.");
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(new Error("Upload must be a valid XLSX workbook."));
      let total = 0,
        count = 0,
        workbook = false;
      let stopped = false;
      const fail = (message: string) => {
        if (stopped) return;
        stopped = true;
        zip.close();
        reject(new Error(message));
      };
      zip.on("error", () => fail("Invalid workbook archive."));
      zip.on("entry", (e: yauzl.Entry) => {
        total += e.uncompressedSize;
        count++;
        if (e.fileName === "xl/workbook.xml") workbook = true;
        if (total > 100 * 1024 * 1024 || count > 5000)
          return fail("Expanded workbook exceeds processing limits.");
        if (/vbaProject|embeddings\//i.test(e.fileName))
          return fail("Macros and embedded objects are not supported.");
        zip.readEntry();
      });
      zip.on("end", () => {
        if (!stopped) {
          if (!workbook) reject(new Error("Not an XLSX workbook."));
          else resolve();
        }
      });
      zip.readEntry();
    }),
  );
}
export function value(c: ExcelJS.Cell): unknown {
  const v = c.value;
  if (v === null) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v)
      return c.result !== undefined
        ? c.result
        : "ERROR:FORMULA_WITHOUT_CACHED_RESULT";
    if ("richText" in v) return v.richText.map((x) => x.text).join("");
    if ("text" in v) return v.text;
    if ("error" in v) return `ERROR:${v.error}`;
  }
  return v;
}
const text = (c: ExcelJS.Cell) => {
  const v = value(c);
  if (typeof v === "number" && /^0+$/.test(c.numFmt) && Number.isInteger(v))
    return String(v).padStart(c.numFmt.length, "0");
  return v === null || v === undefined ? "" : String(v);
};
const h = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const known =
  /^(B2B|B2BA|B2B-CDNR|B2B-CDNRA|ECO|ECOA|ISD|ISDA|IMPG|IMPGA|IMPGSEZ|IMPGSEZA|B2B-DNR|B2B-DNRA)(\s*\((?:ITC Reversal|Rejected)\))?$/i;

export async function parse(
  bytes: Buffer,
  filename: string,
  source: "PURCHASE" | "GSTR2B",
): Promise<Parsed> {
  await validateArchive(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  const out: Parsed = {
    documents: [],
    issues: [],
    sheets: [],
    hash: hash(bytes),
    filename: basename(filename),
  };
  for (const ws of book.worksheets) {
    if (source === "GSTR2B" && !known.test(ws.name)) {
      if (
        ![
          "Read me",
          "ITC Available",
          "ITC not available",
          "ITC Reversal",
          "ITC Rejected",
        ].includes(ws.name) &&
        ws.actualRowCount > 0
      )
        out.issues.push({
          code: "UNSUPPORTED_SHEET",
          message: `Unrecognized populated sheet ${ws.name}; review separately.`,
          severity: "warning",
        });
      continue;
    }
    const isImport = source === "GSTR2B" && ws.name.startsWith("IMP");
    let header = 0;
    for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
      const labels: string[] = [];
      ws.getRow(r).eachCell((c) => labels.push(h(text(c))));
      if (
        source === "PURCHASE"
          ? labels.includes("suppliergstin") &&
            labels.includes("vendorinvoiceno")
          : isImport
            ? labels.includes("portcode")
            : labels.includes("gstinofsupplier") ||
              labels.includes("gstinofisd") ||
              labels.includes("gstinofeco")
      ) {
        header = r;
        break;
      }
    }
    if (!header) {
      if (source === "GSTR2B")
        out.issues.push({
          code: "UNKNOWN_HEADERS",
          message: `Cannot identify headers in ${ws.name}`,
          severity: "error",
        });
      continue;
    }
    const depth = source === "PURCHASE" ? 1 : 2;
    const columns = new Map<string, number[]>();
    for (let c = 1; c <= ws.columnCount; c++)
      for (let r = header; r < header + depth; r++) {
        const cell = ws.getCell(r, c);
        if (cell.isMerged && Number(cell.master.col) !== c) continue;
        const key = h(text(cell));
        if (key) {
          const cols = columns.get(key) ?? [];
          if (!cols.includes(c)) cols.push(c);
          columns.set(key, cols);
        }
      }
    const col = (...names: string[]) => {
      for (const name of names) {
        const a = columns.get(h(name));
        if (a?.length) return a[0];
      }
      return 0;
    };
    // Revised invoice fields take precedence over the original-details columns in amendment sheets.
    const lastCol = (...names: string[]) => {
      for (const name of names) {
        const a = columns.get(h(name));
        if (a?.length) return a[a.length - 1];
      }
      return 0;
    };
    const p = source === "PURCHASE";
    const map = {
      gst: col(p ? "Supplier GSTIN" : "GSTIN of supplier", "GSTIN of ISD"),
      name: col(p ? "Supplier Name" : "Trade/Legal name"),
      invoice: p
        ? col("Vendor Invoice No.")
        : isImport
          ? col("Number")
          : lastCol("Invoice number", "Note number", "Document number"),
      date: p
        ? col("Vendor Invoice Date")
        : isImport
          ? col("Date")
          : lastCol("Invoice Date", "Note date", "Document date"),
      base: col(p ? "GST Base Amount" : "Taxable Value (₹)", "Taxable Value"),
      igst: col(p ? "IGST Amt." : "Integrated Tax(₹)"),
      cgst: col(p ? "CGST Amt." : "Central Tax(₹)"),
      sgst: col(p ? "SGST Amt." : "State/UT Tax(₹)"),
      cess: col("Cess(₹)", "GST Cess", "Cess Amt."),
      value: p
        ? col("Amount To Vendor")
        : col("Invoice Value(₹)", "Note Value (₹)", "Document value (₹)"),
      posting: col("Invoice No. / Credit Memo No."),
      type: col("Note type", "Document type", "Invoice type"),
      avail: col("ITC Availability"),
      reason: col("Reason"),
      boe: col("Bill OF Entry No"),
      port: col("Port Code"),
      importTax: col("Import IGST"),
      trade: col("Type (Import/Inter/Intra)"),
    };
    if (ws.name.startsWith("ECO")) map.gst = col("GSTIN of ECO");
    if (ws.name.startsWith("ISD")) {
      map.invoice = lastCol("ISD Document number", "Document number");
      map.date = lastCol("ISD Document date", "Document date");
      map.type = lastCol("ISD Document type");
    }
    const required = p
      ? [map.gst, map.invoice, map.base, map.igst, map.cgst, map.sgst]
      : isImport
        ? [map.invoice, map.igst]
        : [map.gst, map.invoice, map.igst, map.cgst, map.sgst];
    if (required.some((x) => !x)) {
      out.issues.push({
        code: "MISSING_COLUMNS",
        message: `Required columns missing from ${ws.name}`,
        severity: "error",
      });
      continue;
    }
    const start = header + depth;
    let records = 0;
    for (let r = start; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const get = (c: number) => (c ? text(row.getCell(c)) : "");
      const val = (c: number) => (c ? value(row.getCell(c)) : null);
      if (/^grand total|^total$/i.test(get(map.invoice).trim())) continue;
      const raw: Record<string, unknown> = {};
      row.eachCell((c) => {
        raw[c.address] = value(c);
      });
      const issues: Issue[] = [];
      const domesticImport = p && get(map.trade).toUpperCase() === "IMPORT";
      const importDoc = isImport || domesticImport;
      const inv = importDoc && p ? get(map.boe) : get(map.invoice);
      const gin = get(map.gst);
      let docType = importDoc ? "IMPORT" : get(map.type) || "INVOICE";
      if (/credit/i.test(docType)) docType = "CREDIT_NOTE";
      else if (/debit/i.test(docType)) docType = "DEBIT_NOTE";
      else if (!importDoc) docType = "INVOICE";
      if (!inv.trim())
        issues.push({
          code: "MISSING_INVOICE",
          message: importDoc
            ? "Missing bill of entry number"
            : "Missing supplier invoice number",
          severity: "error",
        });
      if (!importDoc && !validGstin(gstin(gin)))
        issues.push({
          code: "INVALID_GSTIN",
          message: "Supplier GSTIN missing or malformed",
          severity: "error",
        });
      if (
        typeof val(map.invoice) === "number" &&
        !/^0+$/.test(row.getCell(map.invoice).numFmt)
      )
        issues.push({
          code: "NUMERIC_INVOICE",
          message:
            "Numeric invoice identifier; any lost leading zeros cannot be recovered.",
          severity: "warning",
        });
      const dt = dateValue(val(map.date), book.properties.date1904);
      if (val(map.date) && !dt)
        issues.push({
          code: "INVALID_DATE",
          message: "Unrecognized or impossible invoice date",
          severity: "warning",
        });
      const financial = (c: number, label: string, blank = false) =>
        money(val(c), label, issues, !!c && blank);
      const igst = financial(
        domesticImport ? map.importTax : map.igst,
        "igst",
        true,
      );
      const cgst = importDoc ? "0" : financial(map.cgst, "cgst", true);
      const sgst = importDoc ? "0" : financial(map.sgst, "sgst", true);
      const cess = financial(map.cess, "cess", true);
      if (cess === null)
        issues.push({
          code: "CESS_NOT_PROVIDED",
          message:
            "Source has no comparable GST Cess field; known-tax total excludes unknown Cess.",
          severity: "warning",
        });
      if (p && [igst, cgst, sgst].some((x) => x !== null && Number(x) < 0))
        issues.push({
          code: "NEGATIVE_DOCUMENT_REVIEW",
          message:
            "Negative Purchase tax requires credit/reversal classification review.",
          severity: "warning",
        });
      const invoiceDate = dt;
      const section = p ? (domesticImport ? "IMPORT" : "PURCHASE") : ws.name;
      if (p && map.value)
        issues.push({
          code: "INVOICE_VALUE_BASIS_UNCONFIRMED",
          message:
            "Amount To Vendor may be net of deductions. Difference from portal invoice value is diagnostic, not proof of a gross invoice error.",
          severity: "warning",
        });
      if (p && /^DN[/-]/i.test(inv))
        issues.push({
          code: "DOCUMENT_TYPE_REVIEW",
          message:
            "Invoice prefix suggests debit note but source provides no explicit note type.",
          severity: "warning",
        });
      out.documents.push({
        id: `${source}:${ws.name}:${r}`,
        source,
        sourceWorkbook: out.filename,
        sourceSheet: ws.name,
        sourceRows: [r],
        supplierGstinRaw: gin,
        supplierGstinNormalized: gstin(gin),
        supplierNameRaw: get(map.name),
        invoiceNumberRaw: inv,
        invoiceNumberExact: exactInvoice(inv),
        invoiceNumberNormalized: normalizedInvoice(inv),
        invoiceDate,
        postingId: get(map.posting),
        documentType: docType,
        sourceSection: section,
        itcAvailability: get(map.avail),
        itcReason: get(map.reason),
        billOfEntryNumber: importDoc ? inv : "",
        portCode: get(map.port),
        taxableValue: financial(map.base, "taxableValue"),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: sum([igst, cgst, sgst, cess ?? "0"]),
        invoiceValue: financial(map.value, "invoiceValue"),
        issues,
        raw: [raw],
      });
      records++;
    }
    out.sheets.push({ name: ws.name, headerRow: header, records });
  }
  if (out.issues.some((x) => x.severity === "error"))
    throw new Error(
      out.issues
        .filter((x) => x.severity === "error")
        .map((x) => x.message)
        .join("; "),
    );
  if (!out.sheets.length)
    throw new Error(
      `No supported ${source === "PURCHASE" ? "Purchase Register" : "GSTR-2B"} sheets found.`,
    );
  if (!out.documents.length) throw new Error("No transaction records found.");
  return out;
}
