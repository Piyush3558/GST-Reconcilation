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
console.log(
  JSON.stringify(
    {
      purchaseSheet: purchase.sourceSheet.name,
      purchaseRows: purchase.lines.length,
      b2bRows: gst.records.length,
      corrections: run.corrections,
      summary: run.summary,
    },
    null,
    2,
  ),
);
