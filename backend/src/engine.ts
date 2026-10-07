import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  amounts,
  type Document,
  type Parsed,
  type Policy,
  type Result,
  type Run,
  type Summary,
  type Money,
} from "../../shared/types.js";
import { distance, rounded, sum } from "./normalize.js";

export const defaultPolicy: Policy = {
  version: "1.0.0",
  totalTolerance: "1",
  componentTolerance: "0",
  taxableTolerance: "0",
  invoiceValueTolerance: "0",
  punctuationMatching: true,
};
const emptyMoney = (): Money =>
  Object.fromEntries(amounts.map((f) => [f, null])) as Money;
const key = (d: Document, normalized = false) =>
  JSON.stringify([
    d.documentType,
    d.supplierGstinNormalized,
    normalized ? d.invoiceNumberNormalized : d.invoiceNumberExact,
  ]);
export function aggregate(docs: Document[]): Document[] {
  const groups = new Map<string, Document[]>();
  for (const d of docs) {
    // Preserve distinct postings, dates and exact invoice identities; normalized collisions are reviewed later.
    const k = JSON.stringify([
      key(d),
      d.postingId,
      d.invoiceDate,
      d.portCode,
      d.issues.some((x) => x.severity === "error") ? d.id : "",
    ]);
    const a = groups.get(k) ?? [];
    a.push(d);
    groups.set(k, a);
  }
  return [...groups.values()].map((group) => {
    const d = structuredClone(group[0]);
    d.sourceRows = group.flatMap((x) => x.sourceRows);
    d.raw = group.flatMap((x) => x.raw);
    d.issues = group.flatMap((x) => x.issues);
    for (const f of amounts) d[f] = sum(group.map((x) => x[f]));
    const fingerprints = group.map((x) =>
      JSON.stringify(
        x.raw.map((r) =>
          Object.entries(r)
            .filter(([k]) => !/^A\d+$/.test(k))
            .map(([, v]) => v),
        ),
      ),
    );
    if (new Set(fingerprints).size < group.length)
      d.issues.push({
        code: "REPEATED_SOURCE_LINE",
        message:
          "Identical line content repeated within a posting; automatic matching withheld.",
        severity: "error",
      });
    return d;
  });
}
function exceptional(d: Document): string | null {
  if (d.issues.some((x) => x.severity === "error"))
    return "INVALID_SOURCE_RECORD";
  if (/rejected|reversal|B2B-DNR/i.test(d.sourceSection))
    return "REVERSED_OR_REJECTED";
  if (/^(B2BA|B2B-CDNRA|ECOA|ISDA|IMPGA|IMPGSEZA)/i.test(d.sourceSection))
    return "AMENDMENT";
  if (d.itcAvailability && d.itcAvailability.toLowerCase() !== "yes")
    return "ITC_NOT_AVAILABLE";
  if (d.documentType === "CREDIT_NOTE" || d.documentType === "DEBIT_NOTE")
    return d.documentType;
  if (
    /^(ISD|ECO)/i.test(d.sourceSection) ||
    d.issues.some((x) => x.code === "NEGATIVE_DOCUMENT_REVIEW")
  )
    return "MANUAL_REVIEW";
  return null;
}
export function compare(
  p: Document | null,
  g: Document | null,
  policy: Policy,
  rule: string,
  status?: string,
): Result {
  const differences = emptyMoney();
  const flags: string[] = [];
  const matchedFields: string[] = [];
  const differentFields: string[] = [];
  if (p && g) {
    for (const f of amounts) {
      if (p[f] !== null && g[f] !== null) {
        const delta = new Decimal(rounded(p[f]!)).minus(rounded(g[f]!));
        differences[f] = delta.toFixed(2);
        (delta.isZero() ? matchedFields : differentFields).push(f);
      } else flags.push(`${f.toUpperCase()}_NOT_COMPARABLE`);
    }
    if (p.invoiceDate && g.invoiceDate && p.invoiceDate !== g.invoiceDate)
      flags.push("DATE_MISMATCH");
    else if (!p.invoiceDate || !g.invoiceDate)
      flags.push("DATE_NOT_COMPARABLE");
    else matchedFields.push("invoiceDate");
    if (
      differences.taxableValue !== null &&
      new Decimal(differences.taxableValue).abs().gt(policy.taxableTolerance)
    )
      flags.push("TAXABLE_VALUE_MISMATCH");
    if (
      differences.invoiceValue !== null &&
      new Decimal(differences.invoiceValue)
        .abs()
        .gt(policy.invoiceValueTolerance)
    )
      flags.push("INVOICE_VALUE_MISMATCH");
    const comp = ["igst", "cgst", "sgst", "cess"] as const;
    const componentMismatch = comp.some(
      (f) =>
        differences[f] !== null &&
        new Decimal(differences[f]!).abs().gt(policy.componentTolerance),
    );
    if (componentMismatch) flags.push("TAX_COMPONENT_MISMATCH");
    const taxKnown = differences.totalTax !== null;
    const taxExact =
      taxKnown &&
      new Decimal(differences.totalTax!).isZero() &&
      comp.every(
        (f) => differences[f] === null || new Decimal(differences[f]!).isZero(),
      );
    const within =
      taxKnown &&
      new Decimal(differences.totalTax!).abs().lte(policy.totalTolerance);
    const offset = comp.some(
      (f) =>
        differences[f] !== null &&
        new Decimal(differences[f]!).abs().gt(policy.totalTolerance),
    );
    status ??= !taxKnown
      ? "MANUAL_REVIEW"
      : taxExact
        ? rule === "NORMALIZED"
          ? "MATCHED_NORMALIZED"
          : "MATCHED_EXACT"
        : within && !offset
          ? "MATCHED_WITHIN_TOLERANCE"
          : "TAX_COMPONENT_MISMATCH";
    if (p.documentType === "IMPORT" && status.startsWith("MATCHED"))
      status = "IMPORT_MATCHED";
  } else
    status ??=
      exceptional((p ?? g)!) ??
      ((p ?? g)!.documentType === "IMPORT"
        ? "IMPORT_UNMATCHED"
        : p
          ? "NOT_IN_2B"
          : "NOT_IN_PURCHASE_REGISTER");
  for (const d of [p, g]) if (d) flags.push(...d.issues.map((x) => x.code));
  const reason =
    p && g
      ? `${rule} identity match. Known-tax comparison: Purchase minus 2B = ${differences.totalTax ?? "unavailable"}. ${flags.length ? "Review listed flags; tax equality is not full invoice clearance." : "All available comparisons agree."}`
      : status?.startsWith("NOT_IN")
        ? "No unique counterpart in the supplied period. This is a file-presence result, not proof of non-filing."
        : `Document requires ${status?.toLowerCase().replaceAll("_", " ")} review.`;
  return {
    id: randomUUID(),
    purchase: p,
    gst: g,
    primaryStatus: status!,
    flags: [...new Set(flags)],
    matchRule: rule,
    statusReason: reason,
    differences,
    matchedFields,
    differentFields,
    candidates: [],
  };
}
function index(docs: Document[], normalized: boolean) {
  const m = new Map<string, Document[]>();
  for (const d of docs) {
    const k = key(d, normalized);
    const a = m.get(k) ?? [];
    a.push(d);
    m.set(k, a);
  }
  return m;
}
export function summarize(run: Omit<Run, "summary"> | Run): Summary {
  const { results, purchase, gst } = run;
  const statuses: Record<string, number> = {};
  for (const r of results)
    statuses[r.primaryStatus] = (statuses[r.primaryStatus] ?? 0) + 1;
  const total = (ds: Document[]) =>
    sum(ds.map((x) => x.totalTax ?? "0")) ?? "0";
  const pi = index(
    purchase.filter((d) => d.documentType !== "IMPORT"),
    true,
  );
  const gi = index(
    gst.filter((d) => d.sourceSection === "B2B"),
    true,
  );
  const baseline = {
    exactTax: 0,
    withinTolerance: 0,
    purchaseOnly: 0,
    gstOnly: 0,
  };
  for (const [k, p] of pi) {
    const g = gi.get(k);
    if (!g) baseline.purchaseOnly++;
    else if (
      p.length === 1 &&
      g.length === 1 &&
      p[0].totalTax !== null &&
      g[0].totalTax !== null
    ) {
      const dt = new Decimal(rounded(p[0].totalTax))
        .minus(rounded(g[0].totalTax))
        .abs();
      const componentExact = ["igst", "cgst", "sgst"].every((f) =>
        new Decimal(p[0][f as keyof Money] ?? "0")
          .minus(g[0][f as keyof Money] ?? "0")
          .abs()
          .lt("0.005"),
      );
      if (dt.isZero() && componentExact) baseline.exactTax++;
      else if (dt.lte(run.policy.totalTolerance)) baseline.withinTolerance++;
    }
  }
  for (const k of gi.keys()) if (!pi.has(k)) baseline.gstOnly++;
  const pids = results.flatMap((r) => (r.purchase ? [r.purchase.id] : []));
  const gids = results.flatMap((r) => (r.gst ? [r.gst.id] : []));
  const purchaseTax = rounded(total(purchase)),
    gstTax = rounded(total(gst));
  const checks = [
    {
      name: "Every Purchase aggregate accounted once",
      passed:
        pids.length === purchase.length && new Set(pids).size === pids.length,
    },
    {
      name: "Every 2B document accounted once",
      passed: gids.length === gst.length && new Set(gids).size === gids.length,
    },
    {
      name: "Status totals equal result rows",
      passed:
        Object.values(statuses).reduce((a, b) => a + b, 0) === results.length,
    },
    {
      name: "Source Purchase rows preserved",
      passed:
        purchase.reduce((a, d) => a + d.sourceRows.length, 0) ===
        run.inputs.purchase.sheets.reduce((a, s) => a + s.records, 0),
    },
  ];
  return {
    purchaseRows: purchase.reduce((a, d) => a + d.sourceRows.length, 0),
    purchaseDocuments: purchase.length,
    gstDocuments: gst.length,
    results: results.length,
    paired: results.filter((r) => r.purchase && r.gst).length,
    purchaseOnly: results.filter((r) => r.purchase && !r.gst).length,
    gstOnly: results.filter((r) => !r.purchase && r.gst).length,
    statuses,
    purchaseTax,
    gstTax,
    difference: new Decimal(purchaseTax).minus(gstTax).toFixed(2),
    baseline,
    checks,
  };
}
export function reconcile(
  pr: Parsed,
  gb: Parsed,
  policy: Policy = defaultPolicy,
): Run {
  const purchase = aggregate(pr.documents);
  const gst = structuredClone(gb.documents);
  const results: Result[] = [];
  const usedP = new Set<string>(),
    usedG = new Set<string>();
  const add = (
    p: Document | null,
    g: Document | null,
    rule: string,
    status?: string,
  ) => {
    if (p) usedP.add(p.id);
    if (g) usedG.add(g.id);
    results.push(compare(p, g, policy, rule, status));
  };
  for (const d of purchase)
    if (exceptional(d)) add(d, null, "EXCEPTION", exceptional(d)!);
  for (const d of gst)
    if (exceptional(d)) add(null, d, "EXCEPTION", exceptional(d)!);
  // Review all normalized collisions before exact matching to prevent partially consuming ambiguous groups.
  const ps = index(
      purchase.filter((d) => !usedP.has(d.id)),
      true,
    ),
    gs = index(
      gst.filter((d) => !usedG.has(d.id)),
      true,
    );
  for (const k of new Set([...ps.keys(), ...gs.keys()])) {
    const pp = ps.get(k) ?? [],
      gg = gs.get(k) ?? [];
    if (pp.length > 1 || gg.length > 1) {
      for (const p of pp)
        add(
          p,
          null,
          "COLLISION",
          pp.length > 1 ? "DUPLICATE_PURCHASE_KEY" : "AMBIGUOUS_MATCH",
        );
      for (const g of gg)
        add(
          null,
          g,
          "COLLISION",
          gg.length > 1 ? "DUPLICATE_2B_KEY" : "AMBIGUOUS_MATCH",
        );
    }
  }
  for (const normalized of [false, true]) {
    if (normalized && !policy.punctuationMatching) continue;
    const gi = index(
      gst.filter((d) => !usedG.has(d.id) && d.documentType !== "IMPORT"),
      normalized,
    );
    for (const p of purchase) {
      if (usedP.has(p.id) || p.documentType === "IMPORT") continue;
      const candidates = gi.get(key(p, normalized));
      if (candidates?.length === 1 && !usedG.has(candidates[0].id))
        add(p, candidates[0], normalized ? "NORMALIZED" : "EXACT");
    }
  }
  for (const p of purchase.filter(
    (x) => x.documentType === "IMPORT" && !usedP.has(x.id),
  )) {
    const matches = gst.filter(
      (g) =>
        !usedG.has(g.id) &&
        g.documentType === "IMPORT" &&
        g.billOfEntryNumber === p.billOfEntryNumber &&
        p.portCode &&
        p.portCode === g.portCode &&
        p.invoiceDate === g.invoiceDate,
    );
    if (matches.length === 1) add(p, matches[0], "BILL_OF_ENTRY");
  }
  for (const p of purchase) if (!usedP.has(p.id)) add(p, null, "UNMATCHED");
  for (const g of gst) if (!usedG.has(g.id)) add(null, g, "UNMATCHED");
  const bySupplier = new Map<string, Result[]>();
  for (const r of results)
    if (r.primaryStatus === "NOT_IN_PURCHASE_REGISTER") {
      const a = bySupplier.get(r.gst!.supplierGstinNormalized) ?? [];
      a.push(r);
      bySupplier.set(r.gst!.supplierGstinNormalized, a);
    }
  for (const r of results.filter((r) => r.primaryStatus === "NOT_IN_2B")) {
    const p = r.purchase!;
    for (const other of bySupplier.get(p.supplierGstinNormalized) ?? []) {
      const g = other.gst!;
      if (
        p.totalTax === null ||
        g.totalTax === null ||
        !p.invoiceDate ||
        !g.invoiceDate
      )
        continue;
      const edit = distance(
        p.invoiceNumberNormalized,
        g.invoiceNumberNormalized,
      );
      const days =
        Math.abs(Date.parse(p.invoiceDate) - Date.parse(g.invoiceDate)) /
        86400000;
      const delta = new Decimal(p.totalTax).minus(g.totalTax).abs();
      if (edit <= 3 && days <= 31 && delta.lte(policy.totalTolerance)) {
        const candidate = {
          purchaseId: p.id,
          gstId: g.id,
          score: Math.max(0, 100 - edit * 10 - Math.min(20, days)),
          reason: `Same GSTIN; invoice edit distance ${edit}; date gap ${days} days; known-tax delta ${delta.toFixed(2)}. Suggestion only.`,
        };
        r.candidates.push(candidate);
        other.candidates.push(candidate);
        r.flags.push("POSSIBLE_INVOICE_NUMBER_TYPO");
        other.flags.push("POSSIBLE_INVOICE_NUMBER_TYPO");
      }
    }
  }
  const { documents: ignoredP, ...purchaseInput } = pr;
  const { documents: ignoredG, ...gstInput } = gb;
  for (const r of results) r.flags = [...new Set(r.flags)];
  const run: Run = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    policy: { ...policy },
    inputs: { purchase: purchaseInput, gst: gstInput },
    purchase,
    gst,
    results,
    audit: [
      {
        at: new Date().toISOString(),
        actor: "engine",
        action: "RECONCILED",
        detail:
          "Deterministic reconciliation; originals retained by caller; suggestions unapproved.",
      },
    ],
    summary: null!,
  };
  run.summary = summarize(run);
  if (run.summary.checks.some((x) => !x.passed))
    throw new Error("Reconciliation accounting invariant failed.");
  return run;
}
export function approveCandidate(
  run: Run,
  purchaseId: string,
  gstId: string,
  actor: string,
  reason: string,
): Run {
  const next = structuredClone(run);
  const p = next.results.find(
    (r) =>
      r.purchase?.id === purchaseId &&
      !r.gst &&
      r.primaryStatus === "NOT_IN_2B",
  );
  const g = next.results.find(
    (r) =>
      r.gst?.id === gstId &&
      !r.purchase &&
      r.primaryStatus === "NOT_IN_PURCHASE_REGISTER",
  );
  if (!p || !g || !p.candidates.some((c) => c.gstId === gstId))
    throw new Error("Candidate is no longer available or was never suggested.");
  const merged = compare(p.purchase, g.gst, next.policy, "MANUAL_APPROVAL");
  merged.flags.push("MANUALLY_APPROVED");
  merged.statusReason += ` Approved by ${actor}: ${reason}`;
  next.results = next.results.filter((r) => r.id !== p.id && r.id !== g.id);
  next.results.push(merged);
  for (const r of next.results) {
    r.candidates = r.candidates.filter(
      (c) => c.purchaseId !== purchaseId && c.gstId !== gstId,
    );
    if (!r.candidates.length)
      r.flags = r.flags.filter((f) => f !== "POSSIBLE_INVOICE_NUMBER_TYPO");
  }
  next.audit.push({
    at: new Date().toISOString(),
    actor,
    action: "CANDIDATE_APPROVED",
    detail: JSON.stringify({ purchaseId, gstId, reason }),
  });
  next.summary = summarize(next);
  return next;
}
