# Deterministic investigation engine

## Architecture and workflow

Exception detail submits an authenticated request. A short database transaction checks exception access, creates an investigation, and enqueues `INVESTIGATION_RUN` on `background_jobs`. The API returns immediately. Workers claim the job with the existing `FOR UPDATE SKIP LOCKED` queue and process the investigation outside long database transactions. Each agent's status and output are persisted in a short transaction. Worker ownership and attempt count are checked under a row lock before each persistence step, so a stale attempt cannot overwrite a newer attempt.

The orchestrator executes exactly four agents, in this order:

1. **Evidence retrieval** reads the linked exception, ledger transaction, external record, reconciliation run, account and account/currency scoped duplicate candidates. It records evidence IDs and explicitly lists missing linked evidence. Cross-account linked records stop processing.
2. **Financial analysis** compares amounts using integer minor units and PostgreSQL `NUMERIC` source values, compares normalized references and dates, and applies configured amount and date tolerances. It records the classification and rule identifiers.
3. **Investigation** applies fixed root cause rules and, when at least three comparable prior cases exist, reports that pattern as a hypothesis. Hypotheses remain explicitly unconfirmed and include evidence IDs and next steps.
4. **Verification and reporting** checks evidence references and exception identity, marks report verification, and emits a structured deterministic report. Unsupported conclusions fail verification.

Source financial records are read-only. No investigation approves, closes, reconciles, or adjusts transactions. The analyst remains responsible for decisions.

## Persistence

Migration `13_deterministic_investigations.sql` adds `investigations`, `investigation_agent_executions`, `investigation_evidence`, `investigation_feedback`, and `investigation_audit_history`. Agent executions are retained per queue attempt. Existing `ai_investigations` history and feedback tables are left in place for backward-compatible audit retention; new work uses only the deterministic tables. The new investigation's queue row is linked by `job_id` and can be archived without deleting its report.

## API

- `POST /api/exceptions/:exceptionId/investigate` — enqueue or return the active investigation (`202` for new, `200` when reused).
- `GET /api/exceptions/investigations/:investigationId` — view status, four stage records, and final result subject to existing exception access rules.
- `POST /api/exceptions/investigations/:investigationId/feedback` — record analyst usefulness feedback.

## Configuration and limitations

- `INVESTIGATION_AMOUNT_TOLERANCE` is a non-negative decimal amount, default `0.00`.
- `INVESTIGATION_DATE_TOLERANCE_DAYS` is the allowed value-date difference, default `2`.
- Existing ledger and external amount columns are `NUMERIC(18,2)`, so stored amounts have a two-decimal scale. Analysis includes a deterministic precision map for common zero-decimal and three-decimal currencies and defaults other codes to two decimals. The source schema cannot preserve non-zero third decimal places, so currencies requiring that scale need a schema and ingestion enhancement before those amounts can be represented safely.
- Historical pattern support is intentionally limited to completed investigations for the same exception and requires at least three comparable prior cases. It is contextual evidence, not confirmation.
- Queue retries replay the deterministic pipeline. Stage upserts and evidence primary keys make persistence idempotent; final status transitions are guarded by the queue attempt fence.

## Validation

Run backend checks from `backend/` with `npm test`. The dedicated deterministic agent suite can be run with `npx vitest run tests/investigationAgents.test.js`.
