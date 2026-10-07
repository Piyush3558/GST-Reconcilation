import ExcelJS from "exceljs";
import { readFile, writeFile } from "node:fs/promises";
import { Decimal } from "decimal.js";
import { value } from "./parser.js";
const book = new ExcelJS.Workbook();
if (!process.env.GST_REFERENCE_PATH) throw new Error("Set GST_REFERENCE_PATH to the private reference workbook.");
await book.xlsx.load(
  (await readFile(
    process.env.GST_REFERENCE_PATH,
  )) as never,
);
const reco = book.getWorksheet("Reco")!,
  b2b = book.getWorksheet("2B")!,
  pivot = book.getWorksheet("Pivot")!,
  pr = book.getWorksheet("PR-for reco")!;
const text = (s: ExcelJS.Worksheet, r: number, c: number) =>
  String(value(s.getCell(r, c)) ?? "");
const num = (s: ExcelJS.Worksheet, r: number, c: number) =>
  new Decimal(String(value(s.getCell(r, c)) ?? 0));
const index = new Map<string, Decimal>();
const key = (a: string, b: string) =>
  JSON.stringify([a.toUpperCase(), b.toUpperCase()]);
for (let r = 2; r <= b2b.rowCount; r++) {
  const k = key(text(b2b, r, 1), text(b2b, r, 3));
  index.set(
    k,
    (index.get(k) ?? new Decimal(0))
      .plus(num(b2b, r, 10))
      .plus(num(b2b, r, 11))
      .plus(num(b2b, r, 12)),
  );
}
let arithmetic = 0,
  lookups = 0,
  edits = 0,
  ok = 0,
  okWithin = 0;
const discrepancies: string[] = [];
for (let r = 4; r <= reco.rowCount; r++) {
  const calculated = num(reco, r, 6)
    .plus(num(reco, r, 7))
    .plus(num(reco, r, 8));
  if (
    calculated
      .minus(num(reco, r, 9))
      .abs()
      .lt(".00001")
  )
    arithmetic++;
  const expected =
    index.get(key(text(reco, r, 4), text(reco, r, 1))) ?? new Decimal(0);
  if (
    expected
      .minus(num(reco, r, 10))
      .abs()
      .lt(".00001")
  )
    lookups++;
  else
    discrepancies.push(
      `Reco!J${r}: literal text-key sum ${expected.toFixed(2)}, cached Excel result ${num(reco, r, 10).toFixed(2)}; invoice ${text(reco, r, 1)}. Excel numeric/text criteria coercion or a stale cached result may explain this; not treated as an approved alias.`,
    );
  if (text(reco, r, 1) !== text(pivot, r, 1)) edits++;
  if (text(reco, r, 12) === "ok") {
    ok++;
    if (num(reco, r, 11).abs().lte(1.000001)) okWithin++;
  }
}
const aggregates = new Map<string, Decimal[]>();
for (let r = 3; r <= pr.rowCount; r++) {
  const k = JSON.stringify([46, 47, 5, 8].map((c) => text(pr, r, c)));
  const a = aggregates.get(k) ?? [
    new Decimal(0),
    new Decimal(0),
    new Decimal(0),
    new Decimal(0),
  ];
  [35, 37, 39, 41].forEach((c, i) => (a[i] = a[i].plus(num(pr, r, c))));
  aggregates.set(k, a);
}
let pivotVerified = 0;
const pivotDiffs: string[] = [];
for (let r = 4; r < pivot.rowCount; r++) {
  const k = JSON.stringify([1, 2, 3, 4].map((c) => text(pivot, r, c)));
  const a = aggregates.get(k);
  if (
    a &&
    a.every((v, i) =>
      v
        .minus(num(pivot, r, i + 5))
        .abs()
        .lt(".005"),
    )
  )
    pivotVerified++;
  else
    pivotDiffs.push(
      `Pivot row ${r} cannot be reproduced exactly by a literal four-field group of PR-for reco.`,
    );
}
const summary = {
  recoRows: reco.rowCount - 3,
  arithmeticVerified: arithmetic,
  literalLookupVerified: lookups,
  invoiceEdits: edits,
  ok,
  okWithin,
  pivotGroups: aggregates.size,
  pivotRowsVerified: pivotVerified,
  lookupDiscrepancies: discrepancies,
  pivotDiscrepancies: pivotDiffs,
};
await writeFile("HISTORICAL_VALIDATION.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
