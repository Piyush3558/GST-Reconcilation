import ExcelJS from "exceljs";
import type { Result, Run } from "../../shared/types.js";
import { amounts } from "../../shared/types.js";

export async function exportWorkbook(run: Run): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "GST Reconciliation";
  book.created = new Date(run.createdAt);
  const headers = [
    "Status",
    "Match rule",
    "Supplier GSTIN",
    "Purchase invoice",
    "2B invoice",
    "Purchase date",
    "2B date",
    "Supplier",
    ...amounts.flatMap((f) => [`Purchase ${f}`, `2B ${f}`, `Difference ${f}`]),
    "Flags",
    "Reason",
    "Purchase source",
    "2B source",
  ];
  const numeric = (v: string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  const date = (v: string | null | undefined) =>
    v ? new Date(`${v}T00:00:00Z`) : null;
  function style(ws: ExcelJS.Worksheet) {
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: ws.rowCount, column: ws.columnCount },
    };
    ws.getRow(1).height = 34;
    ws.getRow(1).eachCell((c) => {
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF173D49" },
      };
      c.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      c.alignment = { wrapText: true, vertical: "middle" };
    });
    ws.eachRow((row, i) => {
      if (i > 1) {
        row.height = 30;
        row.eachCell((c) => {
          c.font = { name: "Calibri", size: 11 };
          c.alignment = { vertical: "middle", wrapText: true };
          if (i % 2 === 0)
            c.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF1F5F7" },
            };
        });
      }
    });
    ws.columns.forEach((c, i) => {
      c.width = i < 8 ? 22 : i < 29 ? 19 : 48;
    });
  }
  function resultsSheet(name: string, rows: Result[]) {
    const ws = book.addWorksheet(name);
    ws.addRow(headers);
    for (const r of rows) {
      ws.addRow([
        r.primaryStatus,
        r.matchRule,
        r.purchase?.supplierGstinRaw || r.gst?.supplierGstinRaw || null,
        r.purchase?.invoiceNumberRaw,
        r.gst?.invoiceNumberRaw,
        date(r.purchase?.invoiceDate),
        date(r.gst?.invoiceDate),
        r.purchase?.supplierNameRaw || r.gst?.supplierNameRaw || null,
        ...amounts.flatMap((f) => [
          numeric(r.purchase?.[f]),
          numeric(r.gst?.[f]),
          numeric(r.differences[f]),
        ]),
        r.flags.join("; "),
        r.statusReason,
        r.purchase
          ? `${r.purchase.sourceWorkbook} / ${r.purchase.sourceSheet} / rows ${r.purchase.sourceRows.join(", ")}`
          : "",
        r.gst
          ? `${r.gst.sourceWorkbook} / ${r.gst.sourceSheet} / rows ${r.gst.sourceRows.join(", ")}`
          : "",
      ]);
    }
    style(ws);
    ws.getColumn(6).numFmt = "dd-mmm-yyyy";
    ws.getColumn(7).numFmt = "dd-mmm-yyyy";
    for (let c = 9; c <= 29; c++)
      ws.getColumn(c).numFmt = "#,##0.00;[Red](#,##0.00);0.00";
    if (rows.length)
      ws.addConditionalFormatting({
        ref: `A2:A${rows.length + 1}`,
        rules: [
          {
            type: "containsText",
            operator: "containsText",
            text: "MISMATCH",
            priority: 1,
            style: { font: { color: { argb: "FF9C2525" }, bold: true } },
          },
        ],
      });
  }
  const summary = book.addWorksheet("Summary");
  summary.addRow(["Metric", "Value"]);
  summary.addRows([
    ["Run ID", run.id],
    ["Created", new Date(run.createdAt)],
    ["Rule version", run.policy.version],
    ["Purchase rows", run.summary.purchaseRows],
    ["Purchase documents", run.summary.purchaseDocuments],
    ["2B documents (includes imports)", run.summary.gstDocuments],
    ["Matched document pairs", run.summary.paired],
    ["Purchase-only result rows", run.summary.purchaseOnly],
    ["2B-only result rows", run.summary.gstOnly],
    ["Total result rows", run.results.length],
    ["Purchase known tax", Number(run.summary.purchaseTax)],
    ["2B known tax", Number(run.summary.gstTax)],
    ["Known tax difference", Number(run.summary.difference)],
    ["Total tax tolerance", Number(run.policy.totalTolerance)],
    ["Component tolerance", Number(run.policy.componentTolerance)],
    ["Taxable tolerance", Number(run.policy.taxableTolerance)],
    ["Invoice value tolerance", Number(run.policy.invoiceValueTolerance)],
    [
      "Important",
      "Tax matches describe available tax amounts; review flags for invoice details, absent Cess and policy exceptions.",
    ],
    [
      "Category sheets",
      "Filtered views overlap. All Results is the unique result register.",
    ],
    ["Missing amounts", "Blank means unavailable, never an implied zero."],
    [
      "Minor difference policy",
      "No automatic ₹1,000 threshold; finance approval remains outstanding.",
    ],
    ...Object.entries(run.summary.statuses).map(([k, v]) => [k, v]),
    ...run.summary.checks.map((c) => [c.name, c.passed ? "Passed" : "Failed"]),
    ["PR file SHA-256", run.inputs.purchase.hash],
    ["2B file SHA-256", run.inputs.gst.hash],
  ]);
  style(summary);
  summary.getColumn(1).width = 44;
  summary.getColumn(2).width = 95;
  summary.getCell("B3").numFmt = "dd-mmm-yyyy hh:mm";
  resultsSheet("All Results", run.results);
  resultsSheet(
    "Exact Matches",
    run.results.filter((r) =>
      ["MATCHED_EXACT", "MATCHED_NORMALIZED"].includes(r.primaryStatus),
    ),
  );
  resultsSheet(
    "Within Tolerance",
    run.results.filter((r) => r.primaryStatus === "MATCHED_WITHIN_TOLERANCE"),
  );
  resultsSheet(
    "Tax Mismatches",
    run.results.filter(
      (r) =>
        r.primaryStatus === "TAX_COMPONENT_MISMATCH" ||
        r.flags.includes("TAX_COMPONENT_MISMATCH"),
    ),
  );
  resultsSheet(
    "Purchase Only",
    run.results.filter((r) => r.purchase && !r.gst),
  );
  resultsSheet(
    "2B Only",
    run.results.filter((r) => !r.purchase && r.gst),
  );
  resultsSheet(
    "Possible Typos",
    run.results.filter((r) => r.candidates.length > 0),
  );
  resultsSheet(
    "Duplicates-Ambiguous",
    run.results.filter((r) => /DUPLICATE|AMBIGUOUS/.test(r.primaryStatus)),
  );
  resultsSheet(
    "Credit-Debit Notes",
    run.results.filter(
      (r) =>
        /CREDIT_NOTE|DEBIT_NOTE/.test(r.primaryStatus) ||
        r.flags.includes("DOCUMENT_TYPE_REVIEW"),
    ),
  );
  resultsSheet(
    "Amendments",
    run.results.filter((r) => r.primaryStatus === "AMENDMENT"),
  );
  resultsSheet(
    "Imports",
    run.results.filter((r) => (r.purchase ?? r.gst)?.documentType === "IMPORT"),
  );
  resultsSheet(
    "ITC Exceptions",
    run.results.filter((r) =>
      ["ITC_NOT_AVAILABLE", "REVERSED_OR_REJECTED", "MANUAL_REVIEW"].includes(
        r.primaryStatus,
      ),
    ),
  );
  const validation = book.addWorksheet("Validation Issues");
  validation.addRow(["Source", "Sheet", "Rows", "Code", "Severity", "Message"]);
  for (const d of [...run.purchase, ...run.gst])
    for (const issue of d.issues)
      validation.addRow([
        d.source,
        d.sourceSheet,
        d.sourceRows.join(", "),
        issue.code,
        issue.severity,
        issue.message,
      ]);
  for (const input of Object.values(run.inputs))
    for (const issue of input.issues)
      validation.addRow([
        input.filename,
        "",
        "",
        issue.code,
        issue.severity,
        issue.message,
      ]);
  style(validation);
  validation.getColumn(6).width = 90;
  const audit = book.addWorksheet("Audit Log");
  audit.addRow(["When", "Actor", "Action", "Detail"]);
  for (const a of run.audit)
    audit.addRow([new Date(a.at), a.actor, a.action, a.detail]);
  style(audit);
  audit.getColumn(1).numFmt = "dd-mmm-yyyy hh:mm:ss";
  audit.getColumn(4).width = 110;
  const candidates = book.addWorksheet("Candidate Evidence");
  candidates.addRow([
    "Purchase ID",
    "2B ID",
    "Score (heuristic)",
    "Reason",
    "Approval",
  ]);
  for (const r of run.results.filter((r) => r.purchase))
    for (const c of r.candidates)
      candidates.addRow([
        c.purchaseId,
        c.gstId,
        c.score,
        c.reason,
        "Suggested; not applied",
      ]);
  style(candidates);
  candidates.getColumn(4).width = 90;
  for (let r = 12; r <= 18; r++)
    summary.getCell(r, 2).numFmt = "#,##0.00;[Red](#,##0.00);0.00";
  // Size wrapped text after all column widths are final; keep audit and flags readable.
  for (const sheet of book.worksheets) {
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      let lines = 1;
      row.eachCell((cell) => {
        if (typeof cell.value === "string")
          lines = Math.max(
            lines,
            Math.ceil(
              cell.value.length /
                Math.max(
                  8,
                  (sheet.getColumn(Number(cell.col)).width ?? 20) - 4,
                ),
            ),
          );
      });
      row.height = Math.max(30, lines * 15 + 10);
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
