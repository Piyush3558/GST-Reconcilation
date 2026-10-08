import { beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { Decimal } from "decimal.js";
import {
  cellValue,
  extractGstr2BFromWorkbook,
  extractPurchaseFromWorkbook,
} from "../backend/src/parser.js";
import { reconcile, rowIdentity } from "../backend/src/engine.js";
import { exportWorkbook } from "../backend/src/workbook.js";
import type { Run } from "../shared/types.js";

const fallback = "/home/piyush/Downloads/Reco_2B vs PR_26- 27__Aug.xlsx";
const referencePath = process.env.GST_REFERENCE_PATH || (existsSync(fallback) ? fallback : "");
let run: Run;
let source: ExcelJS.Workbook;
const fixed = (value: unknown) => new Decimal(String(value ?? 0)).toFixed(2);
const raw = (cell: ExcelJS.Cell) => cellValue(cell);

beforeAll(async () => {
  if (!referencePath) return;
  const bytes = await readFile(referencePath);
  source = new ExcelJS.Workbook();
  await source.xlsx.load(bytes as never, {
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
    ],
  });
  run = reconcile(
    extractPurchaseFromWorkbook(source, bytes, referencePath),
    extractGstr2BFromWorkbook(source, bytes, referencePath),
  );
}, 120000);

describe.skipIf(!referencePath)("supplied reference workbook", () => {
  it("reproduces every reference financial row by full identity", () => {
    const expectedSheet = source.getWorksheet("Reco-2B vs PR-Aug 26 ")!;
    const actual = new Map(run.reconciliation.map((row) => [rowIdentity(row), row]));
    const seen = new Set<string>();
    for (let sourceRow = 5; sourceRow <= 1292; sourceRow++) {
      const invoice = raw(expectedSheet.getCell(sourceRow, 1));
      const expected = {
        invoice: typeof invoice === "number" ? invoice : String(invoice ?? ""),
        invoiceDate: expectedSheet.getCell(sourceRow, 2).text,
        supplierName: expectedSheet.getCell(sourceRow, 3).text,
        supplierGstin: expectedSheet.getCell(sourceRow, 4).text,
        gstBaseAmount: fixed(raw(expectedSheet.getCell(sourceRow, 5))),
        igst: fixed(raw(expectedSheet.getCell(sourceRow, 6))),
        cgst: fixed(raw(expectedSheet.getCell(sourceRow, 7))),
        sgst: fixed(raw(expectedSheet.getCell(sourceRow, 8))),
      };
      const identity = rowIdentity(expected);
      const row = actual.get(identity);
      expect(row, `missing reference row ${sourceRow}`).toBeDefined();
      expect(fixed(row!.totalPr), `PR total row ${sourceRow}`).toBe(
        fixed(expectedSheet.getCell(sourceRow, 9).result ?? raw(expectedSheet.getCell(sourceRow, 9))),
      );
      expect(fixed(row!.total2B), `2B total row ${sourceRow}`).toBe(
        fixed(expectedSheet.getCell(sourceRow, 10).result ?? raw(expectedSheet.getCell(sourceRow, 10))),
      );
      expect(fixed(row!.difference), `difference row ${sourceRow}`).toBe(
        fixed(expectedSheet.getCell(sourceRow, 11).result ?? raw(expectedSheet.getCell(sourceRow, 11))),
      );
      seen.add(identity);
    }
    expect(seen.size).toBe(1288);
    expect(actual.size).toBe(1288);
  });

  it("reproduces the verified totals, corrections and duplicate behavior", () => {
    expect(run.summary).toMatchObject({
      reconciliationRows: 1288,
      gstBaseAmount: "197708414.16",
      igst: "9204505.14",
      cgst: "12861499.68",
      sgst: "12861499.68",
      totalPr: "34927504.50",
      total2B: "34035492.63",
      difference: "892011.87",
      unresolvedRemarks: 31,
      duplicateLookupKeys: 1,
      remarks: {
        matched: 860,
        matched_with_differences: 391,
        invoice_not_found: 29,
        missing_match_key: 2,
        possible_invoice_mismatch: 6,
      },
    });
    expect(run.corrections).toHaveLength(13);
    const duplicate = run.reconciliation.filter(
      (row) => row.supplierGstin === "06AAMCS8524N1ZO" && String(row.invoice) === "26-27/SD1-101632",
    );
    expect(duplicate).toHaveLength(2);
    expect(duplicate.map((row) => fixed(row.total2B))).toEqual(["43972.14", "43972.14"]);
  });

  it("reproduces the required invoice 080 example", () => {
    const row = run.reconciliation.find(
      (item) => String(item.invoice) === "080" && item.supplierGstin === "06CGEPM3926P1ZX",
    );
    expect(row).toMatchObject({
      totalPr: "3240",
      total2B: "3330",
      difference: "-90",
      diagnosticCode: "matched_with_differences",
    });
    expect(row!.remarks).toContain("CGST differs (PR ₹1620.00, 2B ₹1665.00");
    expect(row!.remarks).toContain("GST base/taxable value differs (PR ₹18000.00, 2B ₹18500.00");
  });

  it("derives every remark from uploaded values without copied classifications", () => {
    const remarks = run.reconciliation.map((row) => row.remarks).join("\n");
    expect(remarks).not.toMatch(
      /credit note filed by vendor|invoice not filed by vendor|debit note filed by us|sez input|in-eligible|minor difference/i,
    );
    const cmr = run.reconciliation.find(
      (row) => String(row.invoice) === "1200S0170121895",
    )!;
    expect(cmr.remarks).toContain("CGST differs");
    expect(cmr.remarks).toContain("GST base/taxable value differs");
  });

  it("exports exactly PR, B2B and Reconciliation with the required layout", async () => {
    const bytes = await exportWorkbook(run);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "PR",
      "B2B",
      "Reconciliation",
    ]);
    const reconciliation = workbook.getWorksheet("Reconciliation")!;
    expect(reconciliation.getRow(1).values).toEqual([
      ,
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
    expect(reconciliation.rowCount).toBe(1289);
    expect(reconciliation.columnCount).toBe(12);
    expect(reconciliation.getCell("I2").formula).toBe("SUM(F2:H2)");
    expect(reconciliation.getCell("J2").formula).toContain("SUMIFS(B2B!$M$2:$M$");
    expect(workbook.getWorksheet("PR")!.getCell("AT2542").text).toBe("26-27/SD-101580");
    expect(workbook.getWorksheet("B2B")!.rowCount).toBe(8849);
  }, 120000);
});
