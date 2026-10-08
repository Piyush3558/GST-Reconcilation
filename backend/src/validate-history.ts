import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseReferenceWorkbook } from "./parser.js";
import { reconcile } from "./engine.js";

const path = process.env.GST_REFERENCE_PATH;
if (!path) throw new Error("Set GST_REFERENCE_PATH to the supplied reference workbook.");
const bytes = await readFile(path);
const { purchase, gst } = await parseReferenceWorkbook(bytes, basename(path));
const run = reconcile(purchase, gst);
const expected = {
  reconciliationRows: 1288,
  gstBaseAmount: "197708414.16",
  igst: "9204505.14",
  cgst: "12861499.68",
  sgst: "12861499.68",
  totalPr: "34927504.50",
  total2B: "34035492.63",
  difference: "892011.87",
  unresolvedRemarks: 31,
};
for (const [field, value] of Object.entries(expected)) {
  const actual = run.summary[field as keyof typeof expected];
  if (actual !== value) throw new Error(`${field}: expected ${value}, received ${actual}`);
}
console.log(JSON.stringify({ passed: true, summary: run.summary }, null, 2));
