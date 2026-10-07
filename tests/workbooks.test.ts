import { beforeAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { parse } from "../backend/src/parser.js";
import { reconcile } from "../backend/src/engine.js";
import { exportWorkbook } from "../backend/src/workbook.js";
import type { Run } from "../shared/types.js";
const p = process.env.GST_PURCHASE_PATH!,
  g = process.env.GST_2B_PATH!;
let run: Run;
let hashes: string[];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
beforeAll(async () => {
  if (!p || !g) return;
  const buffers = await Promise.all([readFile(p), readFile(g)]);
  hashes = buffers.map(sha);
  run = reconcile(
    await parse(buffers[0], "Book1.xlsx", "PURCHASE"),
    await parse(buffers[1], "GSTR2B.xlsx", "GSTR2B"),
  );
}, 30000);
describe.skipIf(!p || !g)("private reference workbooks", () => {
  it("reads 92 lines and all 24 transaction sections", () => {
    expect(run.summary.purchaseRows).toBe(92);
    expect(run.inputs.gst.sheets).toHaveLength(24);
    expect(run.gst).toHaveLength(63);
    expect(run.gst.filter((d) => d.documentType === "IMPORT")).toHaveLength(2);
  });
  it("reproduces observed normalized tax baseline", () =>
    expect(run.summary.baseline).toEqual({
      exactTax: 36,
      withinTolerance: 1,
      purchaseOnly: 23,
      gstOnly: 24,
    }));
  it("records exact 40 paise tolerance example", () => {
    const r = run.results.find((r) => r.primaryStatus === "MATCHED_WITHIN_TOLERANCE")!;
    expect(r.differences.totalTax).toBe("0.40");
    expect(r.primaryStatus).toBe("MATCHED_WITHIN_TOLERANCE");
  });
  it("retains all records and raw origins", () => {
    expect(run.summary.checks.every((c) => c.passed)).toBe(true);
    expect(run.purchase.flatMap((d) => d.sourceRows)).toHaveLength(92);
    expect(
      run.purchase.every((d) => d.raw.length === d.sourceRows.length),
    ).toBe(true);
  });
  it("generates all required sheets with typed amounts and no formulas from source strings", async () => {
    const bytes = await exportWorkbook(run);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    expect(wb.worksheets).toHaveLength(16);
    expect(wb.getWorksheet("All Results")!.rowCount).toBe(
      run.results.length + 1,
    );
    expect(typeof wb.getWorksheet("Summary")!.getCell("B12").value).toBe(
      "number",
    );
    for (const ws of wb.worksheets)
      ws.eachRow((row) =>
        row.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Error)),
      );
  }, 30000);
  it("preserves source bytes", async () =>
    expect((await Promise.all([readFile(p), readFile(g)])).map(sha)).toEqual(
      hashes,
    ));
});
describe("parser fixtures", () => {
  it("rejects invalid XLSX archive", async () =>
    await expect(
      parse(Buffer.from("bad"), "bad.xlsx", "PURCHASE"),
    ).rejects.toThrow());
  it("detects moved headers and preserves zero-padded numeric invoice", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Changed");
    ws.getRow(4).values = [
      "Supplier GSTIN",
      "Vendor Invoice No.",
      "GST Base Amount",
      "IGST Amt.",
      "CGST Amt.",
      "SGST Amt.",
    ];
    ws.getRow(5).values = ["27AAAAA0000A1Z5", 12, 100, 18, 0, 0];
    ws.getCell("B5").numFmt = "000000";
    const result = await parse(
      Buffer.from(await wb.xlsx.writeBuffer()),
      "fixture.xlsx",
      "PURCHASE",
    );
    expect(result.documents[0].invoiceNumberRaw).toBe("000012");
    expect(result.sheets[0].headerRow).toBe(4);
  });
  it("rejects missing required financial columns", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bad");
    ws.addRow(["Supplier GSTIN", "Vendor Invoice No."]);
    ws.addRow(["27AAAAA0000A1Z5", "1"]);
    await expect(
      parse(Buffer.from(await wb.xlsx.writeBuffer()), "bad.xlsx", "PURCHASE"),
    ).rejects.toThrow("Required columns");
  });
});
