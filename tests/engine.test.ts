import { describe, expect, it } from "vitest";
import { aggregatePurchase, reconcile } from "../backend/src/engine.js";
import type {
  B2BRecord,
  ParsedGstr2B,
  ParsedPurchase,
  PurchaseLine,
} from "../shared/types.js";

const line = (changes: Partial<PurchaseLine> = {}): PurchaseLine => ({
  sourceRow: 2,
  invoice: "INV/001",
  invoiceDate: "01-08-26",
  supplierName: "Fixture Supplier",
  supplierGstin: "27AAAAA0000A1Z5",
  gstBaseAmount: "100",
  igst: "0",
  cgst: "9",
  sgst: "9",
  ...changes,
});

const b2b = (changes: Partial<B2BRecord> = {}): B2BRecord => ({
  sourceRow: 2,
  supplierGstin: "27AAAAA0000A1Z5",
  supplierName: "Fixture Supplier",
  invoice: "INV/001",
  invoiceType: "Regular",
  invoiceDate: "01/08/2026",
  invoiceValue: 118,
  placeOfSupply: "Haryana",
  reverseCharge: "No",
  taxableValue: 100,
  igst: "0",
  cgst: "9",
  sgst: "9",
  totalTax: "18",
  returnPeriod: "Aug'26",
  filingDate: "07/09/2026",
  itcAvailability: "Yes",
  reason: null,
  applicableTaxRate: "100%",
  source: null,
  irn: null,
  irnDate: null,
  ...changes,
});

function run(lines: PurchaseLine[], records: B2BRecord[] = []) {
  const purchase: ParsedPurchase = {
    filename: "pr.xlsx",
    hash: "p",
    sourceSheet: { name: "PR", headerRow: 1, values: [] },
    lines,
  };
  const gst: ParsedGstr2B = {
    filename: "2b.xlsx",
    hash: "g",
    records,
  };
  return reconcile(purchase, gst);
}

describe("reference-compatible reconciliation engine", () => {
  it("aggregates PR lines by exactly invoice, date, supplier name and GSTIN", () => {
    const groups = aggregatePurchase([
      line(),
      line({ sourceRow: 3, gstBaseAmount: "0.1", cgst: "0.1", sgst: "0.2" }),
      line({ sourceRow: 4, invoiceDate: "02-08-26" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((x) => x.invoiceDate === "01-08-26")).toMatchObject({
      gstBaseAmount: "100.1",
      cgst: "9.1",
      sgst: "9.2",
      sourceRows: [2, 3],
    });
  });

  it("matches only GSTIN plus invoice and sums multiple B2B rows", () => {
    const result = run(
      [line()],
      [b2b({ cgst: "4", sgst: "5", totalTax: "9" }), b2b({ sourceRow: 3, cgst: "5", sgst: "4", totalTax: "9" })],
    ).reconciliation[0];
    expect(result.total2B).toBe("18");
    expect(result.b2bMatchCount).toBe(2);
    expect(result.remarks).toBe("Matched 2 B2B rows; PR and 2B tax amounts agree.");
  });

  it("reuses the same 2B sum for duplicate PR lookup keys", () => {
    const result = run(
      [line(), line({ sourceRow: 3, invoiceDate: "02-08-26" })],
      [b2b()],
    );
    expect(result.summary.duplicateLookupKeys).toBe(1);
    expect(result.reconciliation.map((x) => x.total2B)).toEqual(["18", "18"]);
  });

  it("uses Excel-compatible equality for digit-only text but preserves numeric/text type", () => {
    expect(run([line({ invoice: "001" })], [b2b({ invoice: "1" })]).reconciliation[0].total2B).toBe("18");
    expect(run([line({ invoice: "1" })], [b2b({ invoice: 1 })]).reconciliation[0].total2B).toBe("0");
  });

  it("does not remove punctuation or use date, supplier name or amounts as match keys", () => {
    const result = run(
      [line({ invoice: "INV/001", invoiceDate: "31-08-26", supplierName: "Different" })],
      [b2b({ invoice: "INV-001", totalTax: "999" })],
    ).reconciliation[0];
    expect(result.total2B).toBe("0");
    expect(result.diagnosticCode).toBe("invoice_not_found");
    expect(result.remarks).toContain("No exact B2B match");
  });

  it("explains tax, taxable-value and date differences from matched source rows", () => {
    const result = run(
      [line({ invoiceDate: "01-08-26", gstBaseAmount: "110", cgst: "10" })],
      [b2b({ invoiceDate: "02/08/2026", taxableValue: 100, cgst: "9", totalTax: "18" })],
    ).reconciliation[0];
    expect(result.diagnosticCode).toBe("matched_with_differences");
    expect(result.remarks).toContain("CGST differs (PR ₹10.00, 2B ₹9.00; PR higher by ₹1.00)");
    expect(result.remarks).toContain("GST base/taxable value differs");
    expect(result.remarks).toContain("Invoice date differs");
  });

  it("does not infer filing, debit-note, credit-note, SEZ or eligibility causes", () => {
    const result = run([
      line({ gstBaseAmount: "-100", cgst: "-9", sgst: "-9" }),
    ]).reconciliation[0];
    expect(result.diagnosticCode).toBe("invoice_not_found");
    expect(result.remarks).toContain("negative tax amounts");
    expect(result.remarks).toContain("do not identify the document as a debit or credit note");
    expect(result.remarks).not.toMatch(/filed|SEZ|in-eligible/i);
  });

  it("flags a strong invoice-number candidate without treating it as an exact match", () => {
    const result = run([line({ invoice: "INV/001" })], [b2b({ invoice: "INV-001" })])
      .reconciliation[0];
    expect(result.total2B).toBe("0");
    expect(result.diagnosticCode).toBe("possible_invoice_mismatch");
    expect(result.remarks).toContain("Possible 2B invoice INV-001");
    expect(result.remarks).toContain("verify the invoice number");
  });
});
