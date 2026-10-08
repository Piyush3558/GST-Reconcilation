# GST Purchase Register vs GSTR-2B reference analysis

## Approved reference structure

The supplied workbook was inspected as data and formula evidence only. Workbook cells were not treated as instructions.

| Purpose | Reference sheet | Header row | Data rows used |
| --- | --- | ---: | ---: |
| Purchase Register source | `PR-Aug` | 2 | 2,540 |
| Purchase aggregation evidence | `Sheet5` | 3 | 1,288 plus Grand Total |
| GSTR-2B invoice source | `B2B` | 7 | 8,848 |
| Reconciliation evidence | `Reco-2B vs PR-Aug 26 ` | 4 | 1,288 |

The generated workbook contains only `PR`, `B2B`, and `Reconciliation`, in that order.

## Purchase Register mapping

The engine selects a single sheet containing all required headers. If more than one candidate exists, `PR-Aug` is selected only when that exact reference name exists; otherwise ambiguous input is rejected rather than guessed.

| Reconciliation field | Purchase Register header | Reference column |
| --- | --- | --- |
| Vendor Invoice No. | `Vendor Invoice No.` | AT |
| Vendor Invoice Date | `Vendor Invoice Date` | AU |
| Supplier Name | `Supplier Name` | E |
| Supplier GSTIN | `Supplier GSTIN` | H |
| GST Base Amount | `GST Base Amount` | AI |
| IGST | `IGST Amt.` | AK |
| CGST | `CGST Amt.` | AM |
| SGST | `SGST Amt.` | AO |

The first four fields form the aggregation identity. Financial fields are summed with `decimal.js`; blank financial cells contribute zero, matching the pivot behavior. Direct aggregation produces exactly 1,288 groups. Every group and every amount agrees with `Sheet5` to two decimals. The old pivot contains ordinary IEEE-754 display artifacts such as `26028.760000000002`; these are not reproduced as stored financial values.

The internal purchase invoice number in column I is not used.

## GSTR-2B mapping and matching

The parser selects `B2B` and maps these source fields by header: GSTIN, supplier name, invoice number/type/date/value, place of supply, reverse-charge indicator, taxable value, IGST, CGST, SGST, return period, filing date, ITC availability, reason, applicable tax-rate percentage, source, IRN, and IRN date.

`Total - 2B` is calculated as IGST + CGST + SGST. Cess is excluded.

Matching uses only supplier GSTIN and invoice number. Matching is case-insensitive for GSTIN. Invoice punctuation is preserved. String invoice identifiers remain distinct from numeric identifiers, except that two digit-only strings use Excel-compatible numeric-string equality (`0115` matches `115`). A numeric cell does not match a text cell unless an evidenced type correction below applies.

All B2B rows with the same lookup key are summed. If more than one PR aggregate has the same lookup key, the same B2B sum is returned to each PR row. The reference has one such duplicate key:

- GSTIN `06AAMCS8524N1ZO`, invoice `26-27/SD1-101632`.
- One PR aggregate is a negative debit-note row and the other is the positive invoice row.
- Both receive the same 2B amount, `43,972.14`.

This behavior is reproduced intentionally and is not converted to one-to-one matching.

## Exact manual key corrections

The raw values remain unchanged on `PR`. Corrections apply only to the in-memory reconciliation key and are logged. The comparison found 11 affected rows and 13 changed cells.

| Reference row | Field | Before | After | Scope |
| ---: | --- | --- | --- | --- |
| 380 | Vendor Invoice No. | `123` | `2026-27/123` | Exact full-row override |
| 449 | Vendor Invoice No. | `26/27-GGN/1452` | `26/27-GGN-1452` | Exact full-row override |
| 450 | Vendor Invoice No. | `26/27-GGN/1453` | `26/27-GGN-1453` | Exact full-row override |
| 737 | Invoice data type | text `5338` | numeric `5338` | Exact full-row override |
| 737 | Supplier GSTIN | `27AALFJ0253FIZJ` | `27AALFJ0253F1ZJ` | Exact full-row override |
| 738 | Invoice data type | text `5386` | numeric `5386` | Exact full-row override |
| 738 | Supplier GSTIN | `27AALFJ0253FIZJ` | `27AALFJ0253F1ZJ` | Exact full-row override |
| 891 | Supplier GSTIN | `08AEPPS4103R1ZR` | `08DAPPS0948F1Z8` | Exact full-row override |
| 892 | Supplier GSTIN | `08AEPPS4103R1ZR` | `08DAPPS0948F1Z8` | Exact full-row override |
| 1220 | Vendor Invoice No. | `SSMS/010` | `SSMS/0010` | Exact full-row override |
| 1221 | Vendor Invoice No. | `SSMS/011` | `SSMS/0011` | Exact full-row override |
| 1228 | Vendor Invoice No. | `STC/2026-27/055` | `STC/2026-27/55` | Exact full-row override |
| 1242 | Vendor Invoice No. | `TSDEL260700209` | `TXDEL260700209` | Exact full-row override |

Each override is keyed by a SHA-256 digest of the full pre-correction row identity: typed invoice, date, supplier name, GSTIN, GST base amount, IGST, CGST, and SGST, with amounts fixed to two decimals. This prevents a one-off correction from becoming a global normalization rule.

## Reconciliation formulas

- Total as per PR = IGST + CGST + SGST.
- Total as per 2B = sum of matched B2B IGST + CGST + SGST.
- Diff = Total as per PR - Total as per 2B.
- GST Base Amount remains separate.
- Cess is not included.

The backend calculates all results independently. The workbook also contains bounded Excel formulas with cached results for columns I:K.

## Reference regression result

| Check | Result |
| --- | ---: |
| Reconciliation rows | 1,288 |
| GST Base Amount | 197,708,414.16 |
| IGST | 9,204,505.14 |
| CGST | 12,861,499.68 |
| SGST | 12,861,499.68 |
| Total as per PR | 34,927,504.50 |
| Total as per 2B | 34,035,492.63 |
| Difference | 892,011.87 |

For invoice `080`, GSTIN `06CGEPM3926P1ZX`, the engine calculates PR tax `3,240.00`, 2B tax `3,330.00`, and difference `-90.00`. The remark explains the source values: CGST and SGST are each `45.00` lower in PR, and the PR GST base is `500.00` lower than the matched 2B taxable value.

## Evidence-based remarks

Reference remarks are not copied. Each output remark is recalculated from uploaded PR and B2B records. Exact matches compare IGST, CGST, SGST, GST base/taxable value, invoice date, and explicit 2B ITC fields. Unmatched rows explain that no exact GSTIN-plus-invoice match contributed to the 2B total. A possible invoice-number mismatch is shown only when one same-GSTIN candidate has matching identifier normalization, date plus tax, or taxable value plus tax. The candidate remains excluded from `Total as per 2B` until verified.

The application does not infer vendor filing status, debit/credit-note status, SEZ treatment, or eligibility from supplier-level or copied reference labels. See `REMARKS_RULES.md` for the diagnostic decision order.
