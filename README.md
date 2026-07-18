# ReconEngine

ReconEngine reconciles the internal bank ledger against uploaded settlement statements. It is a Node.js/Express API, PostgreSQL database, background worker, and React dashboard.

## Data flow

```text
Internal Berka/demo seed -> ledger_transactions
External CSV upload      -> import_batches (PROCESSING)
                         -> CSV validation + external_statement_lines
                         -> import_batches (COMPLETED)
                         -> reconciliation job (one completed external batch)
                         -> match_groups
                         -> reconciliation_exceptions
```

Internal ledger data comes from the Berka CSV seed (`db/seed/data/trans.csv`) or the small demo seed. It is recorded as `ledger_transactions` and is never uploaded through the statement endpoint.

External settlement data comes only from the authenticated CSV upload endpoint. Files are held in memory while parsed; the app does not watch a local folder or require an external filesystem mount. `db/seed/data/external_statement_to_upload.csv` is a generated sample upload, not an automatically imported data source.

Administrators can also upload a new internal ledger batch. This preserves auditability: it creates a new `INTERNAL_LEDGER` import batch and appends validated `ledger_transactions`; it never overwrites rows already used by reconciliation.

## Clean setup

Prerequisites: Docker Desktop, Node.js 20+, and npm. On PowerShell systems where `npm` scripts are blocked, use `npm.cmd` as shown below.

```powershell
docker compose up -d db
Copy-Item backend/.env.example backend/.env
Set-Location backend
npm.cmd install
npm.cmd run migrate
npm.cmd run seed:users
npm.cmd run seed:demo
```

In two additional terminals, start the API worker and frontend:

```powershell
Set-Location backend
npm.cmd run dev
```

```powershell
Set-Location backend
npm.cmd run worker
```

```powershell
Set-Location frontend
npm.cmd install
npm.cmd run dev
```

The API is at `http://localhost:4000`; the dashboard is at `http://localhost:5173`.

Demo credentials are `approver@reconengine.local` / `Password123!`. The `seed:demo` command creates four internal ledger entries for account `ACC-TEST` and prints a compatible statement CSV. To seed the larger Berka subset and generate a compatible external CSV instead, use `npm.cmd run seed:csv` after `seed:users`.

## Import an external settlement file

CSV fields required by the upload API are:

```csv
external_ref,account_ref,amount,currency,value_date,settlement_date,is_batched_settlement
EXT-1001,ACC-TEST,100.00,GBP,2026-07-18,2026-07-18,false
```

`settlement_date` and `is_batched_settlement` are optional. `account_ref` must already exist in `accounts.external_ref`; amount must be positive; currency must be a three-letter code. Choose SWIFT (source `2`) or Card Network (source `3`) in the Upload Statement page, or call the API directly:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"approver@reconengine.local","password":"Password123!"}'

curl -X POST http://localhost:4000/api/imports/statements \
  -H "Authorization: Bearer <access-token>" \
  -F "sourceId=2" \
  -F "file=@statement.csv"
```

The upload creates an `import_batches` row, validates the complete file in a transaction, inserts `external_statement_lines`, and marks the batch `COMPLETED`. Invalid files are marked `FAILED`; an identical already-completed file is rejected as a duplicate.

### Import internal ledger data (admin only)

Use the **Internal ledger (new batch)** option in the upload screen, or `POST /api/imports/ledger`. Required columns are:

```csv
txn_ref,account_ref,txn_type,amount,currency,value_date,counterparty,narrative
LDG-1001,ACC-TEST,CREDIT,100.00,GBP,2026-07-18,Example customer,Initial posting
```

`txn_type` must be `CREDIT`, `DEBIT`, `FEE`, `TAX`, or `REVERSAL`; `counterparty` and `narrative` are optional. The account must already exist. To correct a ledger feed, supply a new adjustment batch rather than modifying historical rows.

## Trigger reconciliation

Run the worker before triggering a reconciliation. An approver or admin can queue a run for the statement value date:

```bash
curl -X POST http://localhost:4000/api/recon/runs \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"runDate":"2026-07-18"}'

curl -H "Authorization: Bearer <access-token>" \
  http://localhost:4000/api/recon/jobs/<job-id>
```

The API selects the newest completed external batch with lines and stores its `batchId` in the job. The matching engine scopes exact, tolerance, batch-settlement, and exception generation to that batch and the requested internal-ledger date. It creates `match_groups` for matches and `reconciliation_exceptions` for unmatched ledger or external lines.

## Folder structure

```text
db/                         PostgreSQL schema, migrations, and seed data
db/seed/data/               bundled Berka input and sample external CSV
backend/src/scripts/        migration and seed commands
backend/src/services/       CSV import and reconciliation orchestration
backend/src/jobs/           scheduler and async worker
frontend/                   React dashboard
```

No upload directory is required: files are streamed from the request into a temporary database staging table.

## Troubleshooting

- **“No external settlement batch available for reconciliation.”** Import a valid external CSV first. A completed internal ledger batch does not qualify, nor does an empty or failed external batch.
- **Job remains PENDING.** Start `npm.cmd run worker`.
- **CSV validation says an account is unknown.** Seed or create the internal account first, then use its exact `external_ref` as `account_ref`.
- **Duplicate import error.** Change the file contents or use the previously completed batch; duplicate file hashes are intentionally rejected.
- **Database connection fails.** Start `docker compose up -d db`, then verify `backend/.env` matches the password in `docker-compose.yml`.

## Verification

The test suite starts an isolated PostgreSQL instance, runs every migration, and exercises login, upload, reconciliation, worker execution, and exception handling:

```powershell
Set-Location backend
npm.cmd test
```
