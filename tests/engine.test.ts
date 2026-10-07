import { describe, it, expect } from "vitest";
import {
  aggregate,
  approveCandidate,
  defaultPolicy,
  reconcile,
} from "../backend/src/engine.js";
import {
  dateValue,
  exactInvoice,
  money,
  normalizedInvoice,
  rounded,
  sum,
  validGstin,
} from "../backend/src/normalize.js";
import type { Document, Issue, Parsed } from "../shared/types.js";
function doc(
  id: string,
  source: "PURCHASE" | "GSTR2B",
  changes: Partial<Document> = {},
): Document {
  return {
    id,
    source,
    sourceWorkbook: "fixture.xlsx",
    sourceSheet: "B2B",
    sourceRows: [Number(id.replace(/\D/g, "")) || 1],
    supplierGstinRaw: "27AAAAA0000A1Z5",
    supplierGstinNormalized: "27AAAAA0000A1Z5",
    supplierNameRaw: "Fixture supplier",
    invoiceNumberRaw: "INV/001",
    invoiceNumberExact: "INV/001",
    invoiceNumberNormalized: "INV001",
    invoiceDate: "2026-08-01",
    postingId: "POST1",
    documentType: "INVOICE",
    sourceSection: source === "PURCHASE" ? "PURCHASE" : "B2B",
    itcAvailability: "Yes",
    itcReason: "",
    billOfEntryNumber: "",
    portCode: "",
    taxableValue: "100",
    igst: "0",
    cgst: "9",
    sgst: "9",
    cess: "0",
    totalTax: "18",
    invoiceValue: "118",
    issues: [],
    raw: [{ A1: id }],
    ...changes,
  };
}
function parsed(documents: Document[]): Parsed {
  return {
    documents,
    issues: [],
    sheets: [{ name: "fixture", headerRow: 1, records: documents.length }],
    hash: "fixture",
    filename: "fixture.xlsx",
  };
}
const run = (p: Document[], g: Document[]) => reconcile(parsed(p), parsed(g));
describe("normalization", () => {
  it("handles the pre-March-1900 Excel leap-year offset and the 1904 epoch", () => {
    expect(dateValue(1)).toBe("1900-01-01");
    expect(dateValue(59)).toBe("1900-02-28");
    expect(dateValue(61)).toBe("1900-03-01");
    expect(dateValue(0, true)).toBe("1904-01-01");
  });
  it("preserves leading zeros and raw punctuation separately", () => {
    expect(exactInvoice(" 0001/a ")).toBe("0001/A");
    expect(normalizedInvoice(" 0001/a ")).toBe("0001A");
  });
  it("validates GSTIN", () => {
    expect(validGstin("27AAAAA0000A1Z5")).toBe(true);
    expect(validGstin("bad")).toBe(false);
  });
  it("does exact decimal addition", () =>
    expect(sum(["0.1", "0.2"])).toBe("0.3"));
  it("rounds half up at comparison precision", () =>
    expect(rounded("1.005")).toBe("1.01"));
  it("does not convert invalid/absent numbers to zero", () => {
    const issues: Issue[] = [];
    expect(money("invalid", "igst", issues)).toBeNull();
    expect(money(null, "igst", issues)).toBeNull();
    expect(issues).toHaveLength(1);
  });
  it("supports Indian grouped amounts", () =>
    expect(money("1,23,456.78", "igst", [])).toBe("123456.78"));
  it("parses day-first and rejects impossible dates", () => {
    expect(dateValue("04/08/26")).toBe("2026-08-04");
    expect(dateValue("31/02/26")).toBeNull();
    expect(dateValue(60)).toBeNull();
    expect(dateValue(1, true)).toBe("1904-01-02");
  });
  it("preserves unknown amount when summing", () =>
    expect(sum(["10", null])).toBeNull());
});
describe("reconciliation", () => {
  it("matches exact identities and money", () =>
    expect(
      run([doc("p1", "PURCHASE")], [doc("g1", "GSTR2B")]).summary.statuses,
    ).toEqual({ MATCHED_EXACT: 1 }));
  it("matches punctuation only when unique", () =>
    expect(
      run(
        [doc("p1", "PURCHASE")],
        [doc("g1", "GSTR2B", { invoiceNumberExact: "INV-001" })],
      ).results[0].primaryStatus,
    ).toBe("MATCHED_NORMALIZED"));
  it("aggregates lines and retains origins", () => {
    const ds = aggregate([
      doc("p1", "PURCHASE", { raw: [{ B1: "item A" }] }),
      doc("p2", "PURCHASE", { raw: [{ B2: "item B" }] }),
    ]);
    expect(ds).toHaveLength(1);
    expect(ds[0].totalTax).toBe("36");
    expect(ds[0].sourceRows).toEqual([1, 2]);
  });
  it("quarantines repeated identical source lines", () => {
    const ds = aggregate([
      doc("p1", "PURCHASE", { raw: [{ B1: "same" }] }),
      doc("p2", "PURCHASE", { raw: [{ B2: "same" }] }),
    ]);
    expect(ds[0].issues.some((i) => i.code === "REPEATED_SOURCE_LINE")).toBe(
      true,
    );
  });
  it("does not combine separate postings with same invoice", () => {
    const r = run(
      [doc("p1", "PURCHASE"), doc("p2", "PURCHASE", { postingId: "POST2" })],
      [doc("g1", "GSTR2B")],
    );
    expect(r.summary.paired).toBe(0);
    expect(r.summary.statuses.DUPLICATE_PURCHASE_KEY).toBe(2);
  });
  it("does not consume one duplicate 2B record", () => {
    const r = run(
      [doc("p1", "PURCHASE")],
      [doc("g1", "GSTR2B"), doc("g2", "GSTR2B")],
    );
    expect(r.summary.paired).toBe(0);
    expect(r.summary.statuses.DUPLICATE_2B_KEY).toBe(2);
  });
  it("keeps different suppliers distinct", () => {
    const r = run(
      [doc("p1", "PURCHASE")],
      [doc("g1", "GSTR2B", { supplierGstinNormalized: "27BBBBB1111B1Z5" })],
    );
    expect(r.summary.paired).toBe(0);
  });
  it("applies inclusive one rupee total tolerance", () => {
    const r = run(
      [doc("p1", "PURCHASE", { totalTax: "19", cgst: "10" })],
      [doc("g1", "GSTR2B")],
    );
    expect(r.results[0].primaryStatus).toBe("MATCHED_WITHIN_TOLERANCE");
    expect(r.results[0].flags).toContain("TAX_COMPONENT_MISMATCH");
  });
  it("catches component offsets with equal totals", () => {
    const r = run(
      [doc("p1", "PURCHASE", { igst: "18", cgst: "0", sgst: "0" })],
      [doc("g1", "GSTR2B")],
    );
    expect(r.results[0].primaryStatus).toBe("TAX_COMPONENT_MISMATCH");
  });
  it("compares Cess and total", () => {
    const r = run(
      [doc("p1", "PURCHASE", { cess: "5", totalTax: "23" })],
      [doc("g1", "GSTR2B")],
    );
    expect(r.results[0].differences.cess).toBe("5.00");
    expect(r.results[0].primaryStatus).toBe("TAX_COMPONENT_MISMATCH");
  });
  it("marks missing Cess as not comparable", () =>
    expect(
      run([doc("p1", "PURCHASE", { cess: null })], [doc("g1", "GSTR2B")])
        .results[0].flags,
    ).toContain("CESS_NOT_COMPARABLE"));
  it("retains taxable, invoice value and date mismatches", () => {
    const r = run(
      [
        doc("p1", "PURCHASE", {
          taxableValue: "90",
          invoiceValue: "108",
          invoiceDate: "2026-08-02",
        }),
      ],
      [doc("g1", "GSTR2B")],
    );
    expect(r.results[0].flags).toEqual(
      expect.arrayContaining([
        "TAXABLE_VALUE_MISMATCH",
        "INVOICE_VALUE_MISMATCH",
        "DATE_MISMATCH",
      ]),
    );
  });
  it("suggests typos without pairing them", () => {
    const r = run(
      [
        doc("p1", "PURCHASE", {
          invoiceNumberExact: "INV/002",
          invoiceNumberNormalized: "INV002",
        }),
      ],
      [doc("g1", "GSTR2B")],
    );
    expect(r.summary.paired).toBe(0);
    expect(r.results[0].candidates).toHaveLength(1);
    const approved = approveCandidate(
      r,
      "p1",
      "g1",
      "reviewer",
      "Checked original invoice",
    );
    expect(approved.summary.paired).toBe(1);
    expect(approved.audit.at(-1)?.actor).toBe("reviewer");
    expect(() =>
      approveCandidate(approved, "p1", "g1", "reviewer", "Again"),
    ).toThrow();
  });
  it("rejects manual pairing not suggested", () =>
    expect(() =>
      approveCandidate(
        run([doc("p1", "PURCHASE")], [doc("g1", "GSTR2B")]),
        "p1",
        "g1",
        "reviewer",
        "reason",
      ),
    ).toThrow());
  it.each([
    "AMENDMENT",
    "REVERSED_OR_REJECTED",
    "ITC_NOT_AVAILABLE",
    "CREDIT_NOTE",
    "DEBIT_NOTE",
  ])("preserves %s for review", (status) => {
    const changes: Partial<Document> =
      status === "AMENDMENT"
        ? { sourceSection: "B2BA" }
        : status === "REVERSED_OR_REJECTED"
          ? { sourceSection: "B2B(Rejected)" }
          : status === "ITC_NOT_AVAILABLE"
            ? { itcAvailability: "No" }
            : { documentType: status };
    const r = run([], [doc("g1", "GSTR2B", changes)]);
    expect(r.results[0].primaryStatus).toBe(status);
  });
  it("retains credit note amounts without inventing a sign policy", () => {
    const r = run(
      [],
      [doc("g1", "GSTR2B", { documentType: "CREDIT_NOTE", totalTax: "18" })],
    );
    expect(r.gst[0].totalTax).toBe("18");
    expect(r.results[0].primaryStatus).toBe("CREDIT_NOTE");
  });
  it("requires port and date evidence for imports", () => {
    const ch = {
      documentType: "IMPORT",
      billOfEntryNumber: "123",
      portCode: "INBOM4",
    };
    expect(
      run([doc("p1", "PURCHASE", ch)], [doc("g1", "GSTR2B", ch)]).results[0]
        .primaryStatus,
    ).toBe("IMPORT_MATCHED");
    expect(
      run(
        [doc("p1", "PURCHASE", { ...ch, portCode: "" })],
        [doc("g1", "GSTR2B", ch)],
      ).summary.paired,
    ).toBe(0);
  });
  it("quarantines invalid identities", () =>
    expect(
      run(
        [
          doc("p1", "PURCHASE", {
            issues: [
              { code: "INVALID_GSTIN", severity: "error", message: "Invalid" },
            ],
          }),
        ],
        [],
      ).results[0].primaryStatus,
    ).toBe("INVALID_SOURCE_RECORD"));
  it("maintains one-to-one accounting including exceptions", () => {
    const r = run(
      [doc("p1", "PURCHASE")],
      [
        doc("g1", "GSTR2B"),
        doc("g2", "GSTR2B", {
          invoiceNumberExact: "Z",
          invoiceNumberNormalized: "Z",
        }),
      ],
    );
    expect(r.summary.checks.every((c) => c.passed)).toBe(true);
  });
});
