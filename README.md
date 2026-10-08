# GST Reconciliation Portal

Upload a Purchase Register and GSTR-2B Excel file, then click **Generate reconciled Excel**. The result downloads automatically. Built with React, TypeScript, Express, ExcelJS and optional MongoDB.

## Run locally

Requires Node.js 22 or later.

```bash
npm ci
cp -n backend/.env.example backend/.env
npm run build
npm start
```

Open http://127.0.0.1:5000 for the production build.

For development, run `npm install` once from the project root, then open two terminals:

**Backend**

```bash
cd backend
npm run dev
```

**Frontend**

```bash
cd frontend
npm run dev
```

Open http://127.0.0.1:5173. The frontend forwards API requests to the backend at http://127.0.0.1:5000. Alternatively, `npm run dev` from the root starts both. Stop old servers first to avoid occupied ports.

Each folder has its own package and scripts. npm workspaces share the root lockfile and installation. Keep the `shared/` folder beside them for common TypeScript types. Backend settings are in `backend/.env`, and default local run storage is `backend/data/`.

Set `MONGODB_URI` in your private `.env` to enable MongoDB. URL-encode special characters in credentials. Without MongoDB, runs persist in private files in `data/`. If the database is unavailable, the portal displays a warning and falls back to local storage. Local runs are not automatically migrated. Never commit credentials or financial workbooks.

This single-process localhost portal has no login screen. Public deployment requires authentication, TLS and a deployment review. The API supports a Bearer token through `APP_ACCESS_TOKEN`; non-local binding requires a strong token. MongoDB stores metadata and immutable snapshots through GridFS. Configure backups and retention before operational use.

## Matching and output

- Read Purchase Register and B2B columns by their approved headers.
- Aggregate PR lines by vendor invoice number, vendor invoice date, supplier name and supplier GSTIN.
- Sum GST Base Amount, IGST, CGST and SGST with decimal arithmetic.
- Match B2B rows only by supplier GSTIN plus vendor invoice number and sum duplicate B2B rows.
- Calculate tax totals as IGST + CGST + SGST. Taxable value and Cess are excluded from tax totals.
- Explain each difference from uploaded evidence: tax-component amounts, GST-base versus 2B-taxable-value amounts, dates, exact-match status, and strong invoice-number candidates.
- Do not copy reference remarks or infer filing, debit/credit-note, SEZ, or eligibility status without document-level evidence. There is no numeric tolerance.
- Preserve the reference behavior when multiple PR aggregates share one lookup key: each row receives the same summed B2B amount.

The downloaded workbook contains exactly three sheets in this order: `PR`, `B2B`, and `Reconciliation`. `Reconciliation` contains only the requested A:L business fields. See [RECONCILIATION_ANALYSIS.md](RECONCILIATION_ANALYSIS.md) and [REMARKS_RULES.md](REMARKS_RULES.md) for the verified mappings, corrections, rule priority and unresolved-data policy.

## CLI

```bash
npm run reconcile -- --purchase=/path/purchase.xlsx --gst2b=/path/gstr2b.xlsx --output=/path/Reconciled.xlsx
```

Writes the three-sheet Excel workbook and a companion JSON run. Optional `--reference=/path/reference.xlsx` verifies the reference file remains unchanged; it does not dynamically infer business rules.

## Verification

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit, synthetic parser and temporary MongoDB tests run without confidential workbooks. The MongoDB test may download a server binary. Set `CHROME_PATH` to use an existing browser.

The supplied reference regression runs when `GST_REFERENCE_PATH` points to the workbook. In this workspace it also recognizes the supplied Downloads path. The test compares all 1,288 rows by full identity and financial amounts, verifies evidence-derived remarks, then checks the three-sheet export. Synthetic unit, API and browser tests do not require private workbooks.

## GitHub build and security checks

GitHub Actions runs the following checks on every push, pull request, merge-queue run and manual dispatch:

- `Build and unit tests`
- `Browser workflow tests`
- `Production dependency audit`
- `Secret scan`

The GitGuardian workflow needs an API key with the `scan` scope. Create the key in GitGuardian, then add it in GitHub under **Settings → Secrets and variables → Actions → New repository secret** with the name `GITGUARDIAN_API_KEY`. Never commit the key to this repository.

To prevent an untested pull request from being merged, protect the `main` branch in GitHub and require these four status checks. Also enable **Require branches to be up to date before merging**. GitHub only lists a new check after its workflow has run at least once, so push this workflow branch before selecting the checks.

## Layout and API

`frontend/src/` contains the portal; `backend/src/` contains parsing, matching, export, CLI and storage; `shared/` contains record contracts; `tests/` and `e2e/` contain verification. Production frontend files are built into `frontend/dist/` and served by the backend.

The API exposes health, run listing/retrieval/download, multipart validation and run creation (`purchase` and `gst2b` fields). Uploads are capped at 20 MB each and 100 MB expanded. Macros and embedded objects are rejected. User cell values are not executed as formulas.

Use the committed lockfile with `npm ci`. ExcelJS's transitive UUID dependency is overridden to patched version 11.1.1.
