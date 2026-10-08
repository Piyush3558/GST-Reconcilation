# Reconciliation remarks rules

## Principle

Remarks describe only evidence calculated from the uploaded Purchase Register and GSTR-2B. The application does not copy the reference workbook's remarks and does not infer filing status, credit notes, debit notes, SEZ treatment, or ITC eligibility without document-level evidence.

The financial difference remains:

`PR tax (IGST + CGST + SGST) − matched 2B tax (IGST + CGST + SGST)`

## Exact invoice match

An exact match uses Supplier GSTIN plus Vendor Invoice Number. Duplicate B2B rows for that key are summed before comparison.

For a matched invoice, the remark reports:

- each differing tax component: IGST, CGST, and SGST;
- the PR and 2B values and whether PR is higher or lower;
- a GST-base versus 2B-taxable-value difference when all matched taxable values are available;
- an invoice-date difference when the dates do not represent the same calendar date;
- the exact 2B ITC Availability and Reason fields when 2B explicitly marks ITC unavailable.

If none of those values differ, the remark states that the matched tax amounts agree. No rupee tolerance is applied.

## No exact invoice match

When GSTIN plus invoice number does not match, the remark states that 2B contributes zero to the matched total and therefore the full PR tax remains as the difference. It does not claim that the vendor failed to file the invoice.

The engine searches only the same supplier GSTIN for a strong candidate and reports a possible invoice-number mismatch when exactly one 2B invoice meets one of these evidence tests:

1. the invoice identifiers differ only in case, punctuation, spacing, or numeric leading zeros;
2. invoice date and total tax both agree; or
3. taxable value and total tax both agree.

The candidate is not included in `Total as per 2B`; the user must verify the invoice number first. If several candidates satisfy a test, none is selected.

When no candidate is reliable, the remark reports either:

- no B2B records exist for the supplier GSTIN; or
- other B2B invoices exist for that GSTIN, but none can be linked reliably.

Negative PR tax components are reported as negative amounts. The application explicitly says that the uploaded files do not identify the document as a debit or credit note.

## Diagnostic codes

The API summary counts these evidence states:

- `matched`
- `matched_with_differences`
- `possible_invoice_mismatch`
- `invoice_not_found`
- `missing_match_key`

These codes are internal summary categories. The Excel `Remarks` column contains the detailed evidence and amounts.

## Claims deliberately removed

The following copied or supplier-level labels are no longer generated:

- `minor difference`
- `credit note filed by vendor`
- `invoice not filed by vendor`
- `debit note filed by us`
- `sez input`
- `in-eligible`

Those descriptions require document-level evidence not present in an exact PR-to-B2B comparison. A separate credit-note or import sheet containing the same supplier is not enough to assign that cause to a specific invoice.
