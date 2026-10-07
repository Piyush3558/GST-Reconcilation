import ExcelJS from "exceljs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";

export const sourcePaths = [
  process.env.GST_PURCHASE_PATH!,
  process.env.GST_2B_PATH!,
  process.env.GST_REFERENCE_PATH!,
];
if (sourcePaths.some((path) => !path)) throw new Error("Set GST_PURCHASE_PATH, GST_2B_PATH and GST_REFERENCE_PATH to your private workbooks.");
export const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const report: string[] = [
  "# Source workbook inspection",
  "",
  "Generated from the supplied workbooks. Originals are read only. Cached Excel formula results are evidence, not recalculated truth.",
  "",
];
const manifest: Record<string, string> = {};
for (const path of sourcePaths) {
  const bytes = await readFile(path);
  manifest[basename(path)] = hash(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  report.push(
    `## ${basename(path)}`,
    "",
    `SHA-256: ${manifest[basename(path)]}`,
    "",
    `Defined names: ${JSON.stringify(book.definedNames.model)}`,
    "",
  );
  for (const sheet of book.worksheets) {
    const formulas = new Map<string, { count: number; sample: string }>();
    const errors: string[] = [];
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) {
          const f = cell.formula;
          const normalized = f.replace(/([A-Z]+)\d+/g, "$1#");
          const group = formulas.get(normalized) ?? {
            count: 0,
            sample: `${cell.address}: =${f}`,
          };
          group.count++;
          formulas.set(normalized, group);
        }
        if (cell.type === ExcelJS.ValueType.Error) errors.push(cell.address);
      }),
    );
    report.push(
      `### ${sheet.name}`,
      "",
      `Rows: ${sheet.rowCount}; columns: ${sheet.columnCount}; state: ${sheet.state}; merged ranges: ${JSON.stringify(sheet.model.merges)}; filter: ${JSON.stringify(sheet.autoFilter)}.`,
      "",
    );
    report.push("Header/intro rows:", "```text");
    for (let r = 1; r <= Math.min(7, sheet.rowCount); r++) {
      const cells: string[] = [];
      sheet.getRow(r).eachCell((c) => {
        if (c.value !== null) {
          const s = c.text;
          if (s) cells.push(`${c.address}: ${s.replace(/\n/g, " ")}`);
        }
      });
      report.push(cells.join(" | "));
    }
    report.push("```", "");
    for (const { count, sample } of formulas.values())
      report.push(`- ${sample} — ${count} occurrences in family.`);
    if (!formulas.size) report.push("No cell formulas.");
    if (errors.length) report.push(`Error cells: ${errors.join(", ")}`);
    report.push("");
  }
  if (book.getWorksheet("Reco")) {
    const reco = book.getWorksheet("Reco")!;
    const pivot = book.getWorksheet("Pivot")!;
    const changes: string[] = [];
    for (let r = 4; r <= reco.rowCount; r++)
      for (let c = 1; c <= 8; c++)
        if (reco.getCell(r, c).text !== pivot.getCell(r, c).text)
          changes.push(
            `Row ${r}, col ${c}: ${pivot.getCell(r, c).text} → ${reco.getCell(r, c).text}`,
          );
    report.push(
      "## Historical edits",
      "",
      `${changes.length} cell differences between Pivot and Reco A:H.`,
      "",
      ...changes.map((x) => `- ${x}`),
    );
  }
}
await writeFile("SOURCE_MANIFEST.json", JSON.stringify(manifest, null, 2));
await writeFile("RECONCILIATION_ANALYSIS.md", report.join("\n"));
console.log(
  "Inspected every sheet, header area, defined name and formula family; source hashes recorded.",
);
