export const amounts = [
  "taxableValue",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "totalTax",
  "invoiceValue",
] as const;
export type AmountField = (typeof amounts)[number];
export type Money = Record<AmountField, string | null>;
export interface Issue {
  code: string;
  message: string;
  severity: "error" | "warning";
  field?: string;
}
export interface Document extends Money {
  id: string;
  source: "PURCHASE" | "GSTR2B";
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRows: number[];
  supplierGstinRaw: string;
  supplierGstinNormalized: string;
  supplierNameRaw: string;
  invoiceNumberRaw: string;
  invoiceNumberExact: string;
  invoiceNumberNormalized: string;
  invoiceDate: string | null;
  postingId: string;
  documentType: string;
  sourceSection: string;
  itcAvailability: string;
  itcReason: string;
  billOfEntryNumber: string;
  portCode: string;
  issues: Issue[];
  raw: Record<string, unknown>[];
}
export interface Parsed {
  documents: Document[];
  issues: Issue[];
  sheets: { name: string; headerRow: number; records: number }[];
  hash: string;
  filename: string;
}
export interface Policy {
  version: string;
  totalTolerance: string;
  componentTolerance: string;
  taxableTolerance: string;
  invoiceValueTolerance: string;
  punctuationMatching: boolean;
}
export interface Candidate {
  purchaseId: string;
  gstId: string;
  score: number;
  reason: string;
}
export interface Result {
  id: string;
  purchase: Document | null;
  gst: Document | null;
  primaryStatus: string;
  flags: string[];
  matchRule: string;
  statusReason: string;
  differences: Money;
  matchedFields: string[];
  differentFields: string[];
  candidates: Candidate[];
}
export interface Audit {
  at: string;
  actor: string;
  action: string;
  detail: string;
}
export interface Run {
  id: string;
  createdAt: string;
  policy: Policy;
  inputs: {
    purchase: Omit<Parsed, "documents">;
    gst: Omit<Parsed, "documents">;
  };
  purchase: Document[];
  gst: Document[];
  results: Result[];
  audit: Audit[];
  summary: Summary;
}
export interface Summary {
  purchaseRows: number;
  purchaseDocuments: number;
  gstDocuments: number;
  results: number;
  paired: number;
  purchaseOnly: number;
  gstOnly: number;
  statuses: Record<string, number>;
  purchaseTax: string;
  gstTax: string;
  difference: string;
  baseline: {
    exactTax: number;
    withinTolerance: number;
    purchaseOnly: number;
    gstOnly: number;
  };
  checks: { name: string; passed: boolean }[];
}
