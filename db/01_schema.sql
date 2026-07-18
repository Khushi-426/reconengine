-- =====================================================================
-- ReconEngine Database Schema
-- PostgreSQL 15+
-- Normalized to 3NF. Every table maps to a real business entity.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. ORGANIZATION / IDENTITY DOMAIN
-- ---------------------------------------------------------------------

CREATE TABLE roles (
    role_id         SMALLINT PRIMARY KEY,
    role_name       VARCHAR(30) NOT NULL UNIQUE,   -- ANALYST, APPROVER, AUDITOR, ADMIN
    description     TEXT
);

CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    role_id         SMALLINT NOT NULL REFERENCES roles(role_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ NULL                -- soft delete
);
CREATE INDEX idx_users_role ON users(role_id) WHERE deleted_at IS NULL;

CREATE TABLE refresh_tokens (
    token_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    token_hash      TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. CORE BANKING DOMAIN (internal ledger — "system of record")
-- ---------------------------------------------------------------------

CREATE TABLE branches (
    branch_id       SERIAL PRIMARY KEY,
    branch_code     VARCHAR(10) NOT NULL UNIQUE,
    district_name   VARCHAR(100),
    region          VARCHAR(100)
);

CREATE TABLE clients (
    client_id       SERIAL PRIMARY KEY,
    external_ref    VARCHAR(50) UNIQUE,             -- Berka client_id
    full_name       VARCHAR(150) NOT NULL,
    birth_date      DATE,
    branch_id       INT REFERENCES branches(branch_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    account_id      SERIAL PRIMARY KEY,
    external_ref    VARCHAR(50) UNIQUE,             -- Berka account_id
    client_id       INT NOT NULL REFERENCES clients(client_id),
    branch_id       INT NOT NULL REFERENCES branches(branch_id),
    account_type    VARCHAR(20) NOT NULL DEFAULT 'CURRENT'
                        CHECK (account_type IN ('CURRENT','SAVINGS','LOAN')),
    currency        CHAR(3) NOT NULL DEFAULT 'GBP',
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','DORMANT','CLOSED')),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ NULL
);
CREATE INDEX idx_accounts_client ON accounts(client_id);

-- Internal ledger transactions (source system A)
CREATE TABLE ledger_transactions (
    ledger_txn_id   BIGSERIAL PRIMARY KEY,
    account_id      INT NOT NULL REFERENCES accounts(account_id),
    txn_ref         VARCHAR(64) NOT NULL,           -- internal reference number
    txn_type        VARCHAR(20) NOT NULL
                        CHECK (txn_type IN ('CREDIT','DEBIT','FEE','TAX','REVERSAL')),
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'GBP',
    value_date      DATE NOT NULL,
    posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    counterparty    VARCHAR(150),
    narrative       TEXT,
    batch_id        BIGINT,                          -- FK added after import_batches is created below
    is_reversed     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. IMPORT / INGESTION DOMAIN
-- ---------------------------------------------------------------------

CREATE TABLE import_sources (
    source_id       SMALLINT PRIMARY KEY,
    source_name     VARCHAR(50) NOT NULL UNIQUE,    -- INTERNAL_LEDGER, SWIFT_MT940, CARD_NETWORK, CSV_STATEMENT
    file_format     VARCHAR(20) NOT NULL
);

CREATE TABLE import_batches (
    batch_id        BIGSERIAL PRIMARY KEY,
    source_id       SMALLINT NOT NULL REFERENCES import_sources(source_id),
    file_name       VARCHAR(255) NOT NULL,
    file_hash       CHAR(64) NOT NULL,               -- SHA-256, enforces idempotent re-upload
    uploaded_by     UUID NOT NULL REFERENCES users(user_id),
    row_count       INT NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','ROLLED_BACK')),
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, file_hash)                    -- idempotency: same file can't be reprocessed
);

-- External settlement/statement lines (source system B — SWIFT/card network/bank statement)
CREATE TABLE external_statement_lines (
    ext_line_id     BIGSERIAL PRIMARY KEY,
    batch_id        BIGINT NOT NULL REFERENCES import_batches(batch_id),
    source_id       SMALLINT NOT NULL REFERENCES import_sources(source_id),
    external_ref    VARCHAR(64) NOT NULL,
    account_ref     VARCHAR(50) NOT NULL,            -- maps to accounts.external_ref
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL,
    value_date      DATE NOT NULL,
    settlement_date DATE,
    raw_narrative   TEXT,
    is_batched_settlement BOOLEAN NOT NULL DEFAULT FALSE,  -- true = 1 line covers many internal txns
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ext_lines_batch ON external_statement_lines(batch_id);
CREATE INDEX idx_ext_lines_account_date ON external_statement_lines(account_ref, value_date);

ALTER TABLE ledger_transactions
    ADD CONSTRAINT fk_ledger_batch FOREIGN KEY (batch_id) REFERENCES import_batches(batch_id);

-- ---------------------------------------------------------------------
-- 4. RECONCILIATION DOMAIN (the heart of the system)
-- ---------------------------------------------------------------------

CREATE TABLE match_rules (
    rule_id         SERIAL PRIMARY KEY,
    rule_name       VARCHAR(100) NOT NULL,
    rule_type       VARCHAR(20) NOT NULL CHECK (rule_type IN ('EXACT','TOLERANCE','FUZZY_REF','BATCH_SUM')),
    amount_tolerance NUMERIC(6,4) NOT NULL DEFAULT 0,   -- e.g. 0.01 = 1% tolerance
    date_window_days SMALLINT NOT NULL DEFAULT 0,
    priority        SMALLINT NOT NULL DEFAULT 100,      -- lower = tried first
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- One reconciliation "run" over a date range / account set
CREATE TABLE reconciliation_runs (
    run_id          BIGSERIAL PRIMARY KEY,
    run_date        DATE NOT NULL,
    triggered_by    UUID REFERENCES users(user_id),
    status          VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                        CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
    total_internal  INT DEFAULT 0,
    total_external  INT DEFAULT 0,
    matched_count   INT DEFAULT 0,
    exception_count INT DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

-- Many-to-many bridge: one match can link many ledger txns to many external lines
-- (handles batched settlements and split fees correctly — this is the key modelling decision)
CREATE TABLE match_groups (
    match_id        BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES reconciliation_runs(run_id),
    rule_id         INT REFERENCES match_rules(rule_id),
    match_type      VARCHAR(20) NOT NULL CHECK (match_type IN ('AUTO','MANUAL')),
    confidence_score NUMERIC(5,2) NOT NULL DEFAULT 100.00,
    status          VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
                        CHECK (status IN ('CONFIRMED','REVERSED')),
    matched_by      UUID REFERENCES users(user_id),
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INT NOT NULL DEFAULT 1              -- optimistic locking
);

CREATE TABLE match_group_ledger_lines (
    match_id        BIGINT NOT NULL REFERENCES match_groups(match_id) ON DELETE CASCADE,
    ledger_txn_id   BIGINT NOT NULL REFERENCES ledger_transactions(ledger_txn_id),
    PRIMARY KEY (match_id, ledger_txn_id)
);

CREATE TABLE match_group_external_lines (
    match_id        BIGINT NOT NULL REFERENCES match_groups(match_id) ON DELETE CASCADE,
    ext_line_id     BIGINT NOT NULL REFERENCES external_statement_lines(ext_line_id),
    PRIMARY KEY (match_id, ext_line_id)
);

-- Every unmatched item becomes an exception row that ops must resolve.
CREATE TABLE reconciliation_exceptions (
    exception_id    BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES reconciliation_runs(run_id),
    ledger_txn_id   BIGINT REFERENCES ledger_transactions(ledger_txn_id),
    ext_line_id     BIGINT REFERENCES external_statement_lines(ext_line_id),
    exception_type  VARCHAR(30) NOT NULL
                        CHECK (exception_type IN ('MISSING_EXTERNAL','MISSING_INTERNAL','AMOUNT_MISMATCH','DUPLICATE','TIMING')),
    amount_diff     NUMERIC(18,2),
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','WRITTEN_OFF')),
    assigned_to     UUID REFERENCES users(user_id),
    resolution_note TEXT,
    resolved_by     UUID REFERENCES users(user_id),
    resolved_at     TIMESTAMPTZ,
    version         INT NOT NULL DEFAULT 1,              -- optimistic locking to prevent double-resolution
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ledger_txn_id IS NOT NULL OR ext_line_id IS NOT NULL)
);
CREATE INDEX idx_exceptions_status ON reconciliation_exceptions(status) WHERE status IN ('OPEN','IN_REVIEW');
CREATE INDEX idx_exceptions_run ON reconciliation_exceptions(run_id);
-- composite index supporting the most common ops dashboard filter: status + assignee + date
CREATE INDEX idx_exceptions_status_assignee_created
    ON reconciliation_exceptions(status, assigned_to, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. AUDIT / COMPLIANCE DOMAIN
-- ---------------------------------------------------------------------

-- Append-only audit log. No UPDATE/DELETE grants issued on this table (enforced in 03_grants.sql).
CREATE TABLE audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    table_name      VARCHAR(64) NOT NULL,
    record_id       VARCHAR(64) NOT NULL,
    action          VARCHAR(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    changed_by      UUID REFERENCES users(user_id),
    old_values      JSONB,
    new_values      JSONB,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_changed_at ON audit_log(changed_at DESC);

CREATE TABLE sla_definitions (
    sla_id          SERIAL PRIMARY KEY,
    exception_type  VARCHAR(30) NOT NULL,
    max_resolution_hours SMALLINT NOT NULL
);

CREATE TABLE daily_close_signoffs (
    signoff_id      SERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES reconciliation_runs(run_id),
    signed_off_by   UUID NOT NULL REFERENCES users(user_id),
    open_exceptions_at_signoff INT NOT NULL,
    notes           TEXT,
    signed_off_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. REPORTING SUPPORT
-- ---------------------------------------------------------------------

CREATE TABLE report_snapshots (
    snapshot_id     BIGSERIAL PRIMARY KEY,
    report_type     VARCHAR(50) NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    generated_by    UUID REFERENCES users(user_id),
    payload         JSONB NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table count: roles, users, refresh_tokens, branches, clients, accounts,
-- ledger_transactions, import_sources, import_batches, external_statement_lines,
-- match_rules, reconciliation_runs, match_groups, match_group_ledger_lines,
-- match_group_external_lines, reconciliation_exceptions, audit_log,
-- sla_definitions, daily_close_signoffs, report_snapshots  = 20 tables
