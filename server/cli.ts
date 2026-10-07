import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { parse } from "./parser.js";
import { reconcile, defaultPolicy } from "./engine.js";
import { exportWorkbook } from "./workbook.js";
import { configuredPolicy } from "./config.js";
const { values } = parseArgs({
  options: {
    purchase: { type: "string" },
    gst2b: { type: "string" },
    reference: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.purchase || !values.gst2b || !values.output)
  throw new Error("Required: --purchase --gst2b --output");
const paths = [
  values.purchase,
  values.gst2b,
  ...(values.reference ? [values.reference] : []),
];
if (paths.some((p) => resolve(p) === resolve(values.output!)))
  throw new Error("Output must not overwrite a source workbook.");
const before = await Promise.all(paths.map((p) => readFile(p)));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const [p, g] = await Promise.all([
  parse(before[0], basename(paths[0]), "PURCHASE"),
  parse(before[1], basename(paths[1]), "GSTR2B"),
]);
const run = reconcile(p, g, configuredPolicy);
await mkdir(dirname(resolve(values.output)), { recursive: true });
await writeFile(values.output, await exportWorkbook(run));
await writeFile(
  values.output.replace(/\.xlsx$/i, "") + ".json",
  JSON.stringify(run, null, 2),
);
for (let i = 0; i < paths.length; i++)
  if (sha(await readFile(paths[i])) !== sha(before[i]))
    throw new Error("Source file changed during processing.");
console.log(JSON.stringify(run.summary, null, 2));
