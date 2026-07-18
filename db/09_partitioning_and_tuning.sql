-- =====================================================================
-- Phase 2: Database Improvements (Partitioning, Archiving, Idempotency)
-- =====================================================================

-- 1. Enable pg_trgm for high-speed reference text searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Range-partitioned Audit Logs table
-- Drop dependent items
DROP TRIGGER IF EXISTS trg_audit_ledger ON ledger_transactions;
DROP TRIGGER IF EXISTS trg_audit_statement ON external_statement_lines;
DROP TRIGGER IF EXISTS trg_audit_exceptions ON reconciliation_exceptions;
DROP TABLE IF EXISTS audit_logs CASCADE;

CREATE TABLE audit_logs (
    audit_id     BIGSERIAL,
    user_id      UUID,
    action       VARCHAR(100) NOT NULL,
    table_name   VARCHAR(100),
    row_id       VARCHAR(100),
    old_values   JSONB,
    new_values   JSONB,
    ip_address   VARCHAR(45),
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (audit_id, created_at)
) PARTITION BY RANGE (created_at);

-- Create default fallback partition
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Function to dynamically pre-create future partitions (run by scheduler)
CREATE OR REPLACE FUNCTION fn_precreate_audit_partitions() RETURNS VOID AS $$
DECLARE
    v_date DATE := CURRENT_DATE;
    v_next DATE;
    v_part_name TEXT;
    v_start TEXT;
    v_end TEXT;
BEGIN
    FOR i IN 0..2 LOOP
        v_next := v_date + (i || ' month')::INTERVAL;
        v_part_name := 'audit_logs_y' || TO_CHAR(v_next, 'YYYY') || 'm' || TO_CHAR(v_next, 'MM');
        v_start := TO_CHAR(v_next, 'YYYY-MM-01');
        v_end := TO_CHAR(v_next + INTERVAL '1 month', 'YYYY-MM-01');
        
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_part_name) THEN
            EXECUTE format('CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)', v_part_name, v_start, v_end);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Initial execution of partition pre-creation
SELECT fn_precreate_audit_partitions();

-- Re-establish audit triggers from 02_triggers.sql
CREATE TRIGGER trg_audit_ledger
    AFTER INSERT OR UPDATE OR DELETE ON ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_statement
    AFTER INSERT OR UPDATE OR DELETE ON external_statement_lines
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_exceptions
    AFTER INSERT OR UPDATE OR DELETE ON reconciliation_exceptions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();


-- 3. Archive Tables
CREATE TABLE archived_background_jobs (
    job_id         BIGINT PRIMARY KEY,
    job_type       VARCHAR(50) NOT NULL,
    status         VARCHAR(20) NOT NULL,
    payload        JSONB,
    priority       INT,
    attempts       INT,
    max_attempts   INT,
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    error_message  TEXT,
    created_at     TIMESTAMPTZ,
    archived_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE archived_reconciliation_exceptions (
    exception_id     BIGINT PRIMARY KEY,
    run_id           BIGINT,
    ledger_txn_id    BIGINT,
    ext_line_id      BIGINT,
    exception_type   VARCHAR(30),
    amount_diff      NUMERIC(15,2),
    status           VARCHAR(20),
    resolution_note  TEXT,
    resolved_by      UUID,
    resolved_at      TIMESTAMPTZ,
    assigned_to      UUID,
    assigned_at      TIMESTAMPTZ,
    in_progress_at   TIMESTAMPTZ,
    approved_at      TIMESTAMPTZ,
    approved_by      UUID,
    closed_at        TIMESTAMPTZ,
    closed_by        UUID,
    sla_deadline     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ,
    archived_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 4. Idempotency Keys table for duplicate submission lockouts
CREATE TABLE idempotency_keys (
    key_hash       VARCHAR(64) PRIMARY KEY,
    status         VARCHAR(20) NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED')),
    response_code  INT,
    response_body  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ
);


-- 5. Trigram indexes for fast Dashboard text matching
CREATE INDEX IF NOT EXISTS idx_ledger_txn_ref_trgm ON ledger_transactions USING gin (txn_ref gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ext_ref_trgm ON external_statement_lines USING gin (external_ref gin_trgm_ops);
