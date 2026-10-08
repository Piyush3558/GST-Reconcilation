export type CellValue = string | number | boolean | null;

export interface Issue {
  code: string;
  message: string;
  severity: "error" | "warning";
  field?: string;
}

export type DiagnosticCode =
  | "matched"
  | "matched_with_differences"
  | "possible_invoice_mismatch"
  | "invoice_not_found"
  | "missing_match_key";

export interface SourceSheet {
  name: string;
  headerRow: number;
  values: CellValue[][];
}

export interface PurchaseLine {
  sourceRow: number;
  invoice: string | number;
  invoiceDate: string;
  supplierName: string;
  supplierGstin: string;
  gstBaseAmount: string;
  igst: string;
  cgst: string;
  sgst: string;
}

export interface B2BRecord {
  sourceRow: number;
  supplierGstin: string;
  supplierName: string;
  invoice: string | number;
  invoiceType: CellValue;
  invoiceDate: CellValue;
  invoiceValue: CellValue;
  placeOfSupply: CellValue;
  reverseCharge: CellValue;
  taxableValue: CellValue;
  igst: string;
  cgst: string;
  sgst: string;
  totalTax: string;
  returnPeriod: CellValue;
  filingDate: CellValue;
  itcAvailability: CellValue;
  reason: CellValue;
  applicableTaxRate: CellValue;
  source: CellValue;
  irn: CellValue;
  irnDate: CellValue;
}

export interface ParsedPurchase {
  filename: string;
  hash: string;
  sourceSheet: SourceSheet;
  lines: PurchaseLine[];
}

export interface ParsedGstr2B {
  filename: string;
  hash: string;
  records: B2BRecord[];
}

export interface PurchaseAggregate {
  rawInvoice: string | number;
  invoice: string | number;
  invoiceDate: string;
  supplierName: string;
  rawSupplierGstin: string;
  supplierGstin: string;
  gstBaseAmount: string;
  igst: string;
  cgst: string;
  sgst: string;
  sourceRows: number[];
}

export interface CorrectionLog {
  referenceRow: number;
  field: "Vendor Invoice No." | "Supplier GSTIN" | "Invoice number data type";
  before: string;
  after: string;
  reason: string;
}

export interface ReconciliationRow extends PurchaseAggregate {
  totalPr: string;
  total2B: string;
  difference: string;
  remarks: string;
  diagnosticCode: DiagnosticCode;
  b2bMatchCount: number;
}

export interface Summary {
  purchaseSourceRows: number;
  reconciliationRows: number;
  b2bRows: number;
  gstBaseAmount: string;
  igst: string;
  cgst: string;
  sgst: string;
  totalPr: string;
  total2B: string;
  difference: string;
  remarks: Record<string, number>;
  unresolvedRemarks: number;
  duplicateLookupKeys: number;
}

export interface Run {
  id: string;
  createdAt: string;
  ruleVersion: string;
  inputs: {
    purchaseFilename: string;
    purchaseHash: string;
    purchaseSheet: SourceSheet;
    gstFilename: string;
    gstHash: string;
  };
  b2b: B2BRecord[];
  reconciliation: ReconciliationRow[];
  corrections: CorrectionLog[];
  summary: Summary;
}

export type RunResponse = Pick<Run, "id" | "createdAt" | "ruleVersion" | "summary">;
