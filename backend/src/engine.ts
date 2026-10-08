import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type {
  B2BRecord,
  CorrectionLog,
  DiagnosticCode,
  ParsedGstr2B,
  ParsedPurchase,
  PurchaseAggregate,
  PurchaseLine,
  ReconciliationRow,
  Run,
  Summary,
} from "../../shared/types.js";
import { keyCorrections } from "./reference-overrides.js";

export const ruleVersion = "evidence-diagnostics-2026-10-v2";
const fixed = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const identityTyped = (value: string | number) =>
  typeof value === "number" ? `n:${value}` : `s:${value.trim()}`;
const matchTyped = (value: string | number) => {
  if (typeof value === "number") return `n:${value}`;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed)
    ? `snum:${new Decimal(trimmed).toFixed(0)}`
    : `s:${trimmed}`;
};
const normalizedGstin = (value: string) => value.trim().toUpperCase();
const matchKey = (gstin: string, invoice: string | number) =>
  JSON.stringify([normalizedGstin(gstin), matchTyped(invoice)]);

export function rowIdentity(row: {
  invoice: string | number;
  invoiceDate: string;
  supplierName: string;
  supplierGstin: string;
  gstBaseAmount: string;
  igst: string;
  cgst: string;
  sgst: string;
}): string {
  const canonical = JSON.stringify([
    identityTyped(row.invoice),
    row.invoiceDate.trim(),
    row.supplierName.trim(),
    normalizedGstin(row.supplierGstin),
    fixed(row.gstBaseAmount),
    fixed(row.igst),
    fixed(row.cgst),
    fixed(row.sgst),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

const groupKey = (line: PurchaseLine) =>
  JSON.stringify([
    identityTyped(line.invoice),
    line.invoiceDate,
    line.supplierName,
    line.supplierGstin,
  ]);

export function aggregatePurchase(lines: PurchaseLine[]): PurchaseAggregate[] {
  const groups = new Map<string, PurchaseAggregate>();
  for (const line of lines) {
    const key = groupKey(line);
    let group = groups.get(key);
    if (!group) {
      group = {
        rawInvoice: line.invoice,
        invoice: line.invoice,
        invoiceDate: line.invoiceDate,
        supplierName: line.supplierName,
        rawSupplierGstin: line.supplierGstin,
        supplierGstin: line.supplierGstin,
        gstBaseAmount: "0",
        igst: "0",
        cgst: "0",
        sgst: "0",
        sourceRows: [],
      };
      groups.set(key, group);
    }
    group.gstBaseAmount = new Decimal(group.gstBaseAmount).plus(line.gstBaseAmount).toString();
    group.igst = new Decimal(group.igst).plus(line.igst).toString();
    group.cgst = new Decimal(group.cgst).plus(line.cgst).toString();
    group.sgst = new Decimal(group.sgst).plus(line.sgst).toString();
    group.sourceRows.push(line.sourceRow);
  }
  return [...groups.values()].sort((a, b) => {
    const invoice = String(a.invoice).localeCompare(String(b.invoice), "en", {
      sensitivity: "base",
    });
    if (invoice) return invoice;
    return (
      a.invoiceDate.localeCompare(b.invoiceDate) ||
      a.supplierName.localeCompare(b.supplierName) ||
      a.supplierGstin.localeCompare(b.supplierGstin)
    );
  });
}

function applyCorrections(rows: PurchaseAggregate[]) {
  const byHash = new Map(keyCorrections.map((item) => [item.hash, item]));
  const log: CorrectionLog[] = [];
  for (const row of rows) {
    const correction = byHash.get(rowIdentity(row));
    if (!correction) continue;
    if (correction.invoice !== undefined) {
      if (String(row.invoice) !== String(correction.invoice))
        log.push({
          referenceRow: correction.referenceRow,
          field: "Vendor Invoice No.",
          before: String(row.invoice),
          after: String(correction.invoice),
          reason: correction.reason,
        });
      else if (typeof row.invoice !== typeof correction.invoice)
        log.push({
          referenceRow: correction.referenceRow,
          field: "Invoice number data type",
          before: typeof row.invoice,
          after: typeof correction.invoice,
          reason: correction.reason,
        });
      row.invoice = correction.invoice;
    }
    if (correction.supplierGstin !== undefined && row.supplierGstin !== correction.supplierGstin) {
      log.push({
        referenceRow: correction.referenceRow,
        field: "Supplier GSTIN",
        before: row.supplierGstin,
        after: correction.supplierGstin,
        reason: correction.reason,
      });
      row.supplierGstin = correction.supplierGstin;
    }
  }
  return { rows, log };
}

interface B2BMatch {
  supplierGstin: string;
  invoice: string | number;
  total: Decimal;
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  taxableValue: Decimal;
  taxableKnown: boolean;
  dates: string[];
  itcAvailability: string[];
  reasons: string[];
  count: number;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function decimalValue(value: unknown): Decimal | null {
  const raw = textValue(value).replace(/,/g, "");
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = new Decimal(raw);
  return parsed.isFinite() ? parsed : null;
}

function pushUnique(values: string[], value: unknown) {
  const text = textValue(value);
  if (text && !values.includes(text)) values.push(text);
}

function indexB2B(records: B2BRecord[]) {
  const byKey = new Map<string, B2BMatch>();
  const byGstin = new Map<string, B2BMatch[]>();
  for (const record of records) {
    const key = matchKey(record.supplierGstin, record.invoice);
    let current = byKey.get(key);
    if (!current) {
      current = {
        supplierGstin: normalizedGstin(record.supplierGstin),
        invoice: record.invoice,
        total: new Decimal(0),
        igst: new Decimal(0),
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        taxableValue: new Decimal(0),
        taxableKnown: true,
        dates: [],
        itcAvailability: [],
        reasons: [],
        count: 0,
      };
      byKey.set(key, current);
      const supplierRows = byGstin.get(current.supplierGstin) ?? [];
      supplierRows.push(current);
      byGstin.set(current.supplierGstin, supplierRows);
    }
    current.total = current.total.plus(record.totalTax);
    current.igst = current.igst.plus(record.igst);
    current.cgst = current.cgst.plus(record.cgst);
    current.sgst = current.sgst.plus(record.sgst);
    const taxable = decimalValue(record.taxableValue);
    if (taxable) current.taxableValue = current.taxableValue.plus(taxable);
    else current.taxableKnown = false;
    pushUnique(current.dates, record.invoiceDate);
    pushUnique(current.itcAvailability, record.itcAvailability);
    pushUnique(current.reasons, record.reason);
    current.count++;
  }
  return { byKey, byGstin };
}

function dateKey(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(text);
  if (!local) return text.toUpperCase();
  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
}

function amount(value: Decimal.Value): string {
  return `₹${new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}`;
}

function differenceText(label: string, pr: Decimal, b2b: Decimal): string {
  const difference = pr.minus(b2b);
  const direction = difference.isPositive() ? "higher" : "lower";
  return `${label} differs (PR ${amount(pr)}, 2B ${amount(b2b)}; PR ${direction} by ${amount(difference.abs())}).`;
}

function diagnoseMatched(
  row: PurchaseAggregate,
  match: B2BMatch,
): { code: DiagnosticCode; remark: string } {
  const issues: string[] = [];
  const prComponents: Array<[string, Decimal, Decimal]> = [
    ["IGST", new Decimal(row.igst), match.igst],
    ["CGST", new Decimal(row.cgst), match.cgst],
    ["SGST", new Decimal(row.sgst), match.sgst],
  ];
  for (const [label, pr, b2b] of prComponents)
    if (!pr.eq(b2b)) issues.push(differenceText(label, pr, b2b));
  if (match.taxableKnown) {
    const prBase = new Decimal(row.gstBaseAmount);
    if (!prBase.eq(match.taxableValue))
      issues.push(differenceText("GST base/taxable value", prBase, match.taxableValue));
  }
  if (
    row.invoiceDate &&
    match.dates.length &&
    !match.dates.some((date) => dateKey(date) === dateKey(row.invoiceDate))
  )
    issues.push(
      `Invoice date differs (PR ${row.invoiceDate}; 2B ${match.dates.join(", ")}).`,
    );
  const unavailable = match.itcAvailability.filter((value) =>
    /^(no|not available|ineligible|in-eligible)$/i.test(value),
  );
  if (unavailable.length) {
    const reason = match.reasons.length ? ` Reason in 2B: ${match.reasons.join(", ")}.` : "";
    issues.push(`2B ITC Availability is ${unavailable.join(", ")}.${reason}`);
  }
  if (!issues.length)
    return {
      code: "matched",
      remark: `Matched ${match.count} B2B row${match.count === 1 ? "" : "s"}; PR and 2B tax amounts agree.`,
    };
  return {
    code: "matched_with_differences",
    remark: `Matched ${match.count} B2B row${match.count === 1 ? "" : "s"}. ${issues.join(" ")}`,
  };
}

function normalizedInvoice(value: string | number): string {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function diagnoseUnmatched(
  row: PurchaseAggregate,
  totalPr: Decimal,
  supplierMatches: B2BMatch[],
): { code: DiagnosticCode; remark: string } {
  const amountEvidence = ` Because no exact match was found, 2B contributes ₹0.00 and the PR tax ${amount(totalPr)} is the difference.`;
  if (!row.supplierGstin.trim() || String(row.invoice).trim() === "")
    return {
      code: "missing_match_key",
      remark: `Cannot match to B2B: ${!row.supplierGstin.trim() ? "supplier GSTIN" : "invoice number"} is missing in PR.`,
    };
  const sameFormat = supplierMatches.filter(
    (item) => normalizedInvoice(item.invoice) === normalizedInvoice(row.invoice),
  );
  const sameDateAndTax = supplierMatches.filter(
    (item) =>
      item.total.eq(totalPr) &&
      item.dates.some((date) => dateKey(date) === dateKey(row.invoiceDate)),
  );
  const sameBaseAndTax = supplierMatches.filter(
    (item) =>
      item.taxableKnown &&
      item.total.eq(totalPr) &&
      item.taxableValue.eq(row.gstBaseAmount),
  );
  const candidates = sameFormat.length
    ? sameFormat
    : sameDateAndTax.length
      ? sameDateAndTax
      : sameBaseAndTax;
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const evidence = sameFormat.length
      ? "the invoice differs only by formatting"
      : sameDateAndTax.length
        ? "the invoice date and tax total agree"
        : "the taxable value and tax total agree";
    return {
      code: "possible_invoice_mismatch",
      remark: `No exact invoice match. Possible 2B invoice ${String(candidate.invoice)} for the same GSTIN because ${evidence}; verify the invoice number.${amountEvidence}`,
    };
  }
  const negativeComponents = [
    ["IGST", new Decimal(row.igst)],
    ["CGST", new Decimal(row.cgst)],
    ["SGST", new Decimal(row.sgst)],
  ]
    .filter(([, value]) => (value as Decimal).isNegative())
    .map(([label, value]) => `${label} ${amount(value as Decimal)}`);
  const negativeNote = negativeComponents.length
    ? ` PR contains negative tax amounts (${negativeComponents.join(", ")}); the files do not identify the document as a debit or credit note.`
    : "";
  if (!supplierMatches.length)
    return {
      code: "invoice_not_found",
      remark: `No B2B records found for supplier GSTIN ${normalizedGstin(row.supplierGstin)}; filing status or eligibility cannot be determined from these files.${amountEvidence}${negativeNote}`,
    };
  return {
    code: "invoice_not_found",
    remark: `No exact B2B match for GSTIN + invoice number. 2B contains ${supplierMatches.length} other invoice${supplierMatches.length === 1 ? "" : "s"} for this GSTIN, but none can be linked reliably.${amountEvidence}${negativeNote}`,
  };
}

function summarize(
  purchaseRows: number,
  b2bRows: number,
  rows: ReconciliationRow[],
): Summary {
  type TotalField = "gstBaseAmount" | "igst" | "cgst" | "sgst" | "totalPr" | "total2B" | "difference";
  const total = (field: TotalField) =>
    fixed(rows.reduce((sum, row) => sum.plus(row[field]), new Decimal(0)));
  const remarks: Record<string, number> = {};
  for (const row of rows)
    remarks[row.diagnosticCode] = (remarks[row.diagnosticCode] ?? 0) + 1;
  const duplicateCounts = new Map<string, number>();
  for (const row of rows) {
    const key = matchKey(row.supplierGstin, row.invoice);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  return {
    purchaseSourceRows: purchaseRows,
    reconciliationRows: rows.length,
    b2bRows,
    gstBaseAmount: total("gstBaseAmount"),
    igst: total("igst"),
    cgst: total("cgst"),
    sgst: total("sgst"),
    totalPr: total("totalPr"),
    total2B: total("total2B"),
    difference: total("difference"),
    remarks,
    unresolvedRemarks:
      (remarks.invoice_not_found ?? 0) + (remarks.missing_match_key ?? 0),
    duplicateLookupKeys: [...duplicateCounts.values()].filter((count) => count > 1).length,
  };
}

export function reconcile(purchaseInput: ParsedPurchase, gstInput: ParsedGstr2B): Run {
  const corrected = applyCorrections(aggregatePurchase(purchaseInput.lines));
  const b2b = indexB2B(gstInput.records);
  const reconciliation: ReconciliationRow[] = corrected.rows.map((row) => {
    const totalPr = new Decimal(row.igst).plus(row.cgst).plus(row.sgst);
    const match = b2b.byKey.get(matchKey(row.supplierGstin, row.invoice));
    const total2B = match?.total ?? new Decimal(0);
    const diagnosis = match
      ? diagnoseMatched(row, match)
      : diagnoseUnmatched(
          row,
          totalPr,
          b2b.byGstin.get(normalizedGstin(row.supplierGstin)) ?? [],
        );
    return {
      ...row,
      totalPr: totalPr.toString(),
      total2B: total2B.toString(),
      difference: totalPr.minus(total2B).toString(),
      remarks: diagnosis.remark,
      diagnosticCode: diagnosis.code,
      b2bMatchCount: match?.count ?? 0,
    };
  });
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ruleVersion,
    inputs: {
      purchaseFilename: purchaseInput.filename,
      purchaseHash: purchaseInput.hash,
      purchaseSheet: purchaseInput.sourceSheet,
      gstFilename: gstInput.filename,
      gstHash: gstInput.hash,
    },
    b2b: gstInput.records,
    reconciliation,
    corrections: corrected.log,
    summary: summarize(purchaseInput.lines.length, gstInput.records.length, reconciliation),
  };
}
