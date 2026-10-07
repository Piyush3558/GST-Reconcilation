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

## Matching and limitations

- Read headers by name and preserve source rows and raw values. Use decimal arithmetic for amounts.
- Aggregate Purchase lines by supplier, invoice, date and posting. Quarantine identical repeated lines and ambiguous normalized identities.
- Match unique supplier/invoice identities exactly, then using punctuation normalization. Preserve leading zeros; never arbitrarily select duplicates.
- Compare taxable value, individual tax components, total tax and invoice value independently. Default total-tax tolerance is 1; other tolerances default to zero and are configurable.
- Suggest possible invoice typos without automatically applying them. Review requires an explicit actor and reason through the API.
- Keep notes, amendments, imports, ITC exceptions and unsupported sign/offset cases visible for manual review.

An exact tax match does not mean full invoice clearance or ITC eligibility. Unknown amounts stay blank, not zero. Customs cess is not assumed to be GST cess. Amount To Vendor may be net of deductions, making invoice-value comparison provisional. Confirm business rules before relying on results for filing.

The workbook has 16 sheets including Summary, All Results, match categories, exceptions, Audit Log and Candidate Evidence. Category sheets intentionally overlap; All Results is the unique result register. Originals are never modified. Stored extracted evidence remains confidential.

## CLI

```bash
npm run reconcile -- --purchase=/path/purchase.xlsx --gst2b=/path/gstr2b.xlsx --output=/path/Reconciled.xlsx
```

Writes Excel and a companion JSON run. Optional `--reference=/path/reference.xlsx` verifies the reference file remains unchanged; it does not dynamically infer business rules.

## Verification

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit, synthetic parser and temporary MongoDB tests run without confidential workbooks. The MongoDB test may download a server binary. Set `CHROME_PATH` to use an existing browser.

Private baseline workbook/API tests and the full browser upload/download test are skipped unless `GST_PURCHASE_PATH` and `GST_2B_PATH` point to the original approved fixtures. Those tests assert dataset-specific counts, not arbitrary workbook results. Private fixtures and generated reports are deliberately excluded.

`npm run analyze` additionally requires `GST_REFERENCE_PATH` and generates a private formula inventory and source manifest. `npm run validate:history` requires `GST_REFERENCE_PATH` and checks the original historical template specifically. Set these environment variables in your shell. Generated reports are ignored by Git.

## Layout and API

`frontend/src/` contains the portal; `backend/src/` contains parsing, matching, export, CLI and storage; `shared/` contains record contracts; `tests/` and `e2e/` contain verification. Production frontend files are built into `frontend/dist/` and served by the backend.

The API exposes health, run listing/retrieval/download, multipart validation and run creation (`purchase` and `gst2b` fields), and audited candidate approval. Uploads are capped at 20 MB each and 100 MB expanded. Macros and embedded objects are rejected. User cell values are not executed as formulas.

Use the committed lockfile with `npm ci`. ExcelJS's transitive UUID dependency is overridden to patched version 11.1.1.
