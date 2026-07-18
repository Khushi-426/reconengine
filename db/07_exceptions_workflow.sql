-- =====================================================================
-- Phase 1, Step 4 & 5: Exception Assignment Workflow & SLA Tracking
-- =====================================================================

-- 1. Create SLA Rules Table
CREATE TABLE IF NOT EXISTS sla_rules (
    rule_id              SERIAL PRIMARY KEY,
    exception_type       VARCHAR(30) UNIQUE NOT NULL,
    max_resolution_hours INT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default SLA rules
INSERT INTO sla_rules (exception_type, max_resolution_hours) VALUES
('MISSING_EXTERNAL', 24),
('MISSING_INTERNAL', 24),
('AMOUNT_MISMATCH', 48),
('DUPLICATE', 12),
('TIMING', 72)
ON CONFLICT (exception_type) DO NOTHING;

-- 2. Alter reconciliation_exceptions to support new workflow + SLA deadlines
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS in_progress_at TIMESTAMPTZ;
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(user_id);
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(user_id);
ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;

-- Drop old views that depend on status values or need updates
DROP VIEW IF EXISTS v_open_exceptions CASCADE;
DROP VIEW IF EXISTS v_analyst_workload CASCADE;

-- Drop old status check constraint
ALTER TABLE reconciliation_exceptions DROP CONSTRAINT IF EXISTS reconciliation_exceptions_status_check;

-- Update existing records to new statuses
UPDATE reconciliation_exceptions SET status = 'UNASSIGNED' WHERE status = 'OPEN';
UPDATE reconciliation_exceptions SET status = 'IN_PROGRESS' WHERE status = 'IN_REVIEW';

-- Add new status check constraint
ALTER TABLE reconciliation_exceptions ADD CONSTRAINT reconciliation_exceptions_status_check 
    CHECK (status IN ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'APPROVED', 'CLOSED'));

-- Alter default status to UNASSIGNED
ALTER TABLE reconciliation_exceptions ALTER COLUMN status SET DEFAULT 'UNASSIGNED';

-- Trigger function to automatically calculate SLA deadline based on exception type rules

CREATE OR REPLACE FUNCTION fn_set_sla_deadline() RETURNS TRIGGER AS $$
DECLARE
    v_hours INT;
BEGIN
    SELECT max_resolution_hours INTO v_hours FROM sla_rules WHERE exception_type = NEW.exception_type;
    IF v_hours IS NOT NULL THEN
        NEW.sla_deadline := NEW.created_at + (v_hours || ' hours')::INTERVAL;
    ELSE
        NEW.sla_deadline := NEW.created_at + INTERVAL '24 hours'; -- default fallback
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exceptions_sla_deadline ON reconciliation_exceptions;
CREATE TRIGGER trg_exceptions_sla_deadline
    BEFORE INSERT ON reconciliation_exceptions
    FOR EACH ROW EXECUTE FUNCTION fn_set_sla_deadline();

-- Update any existing exceptions to have a computed SLA deadline
UPDATE reconciliation_exceptions e
SET sla_deadline = e.created_at + (COALESCE((SELECT max_resolution_hours FROM sla_rules WHERE exception_type = e.exception_type), 24) || ' hours')::INTERVAL
WHERE e.sla_deadline IS NULL;

-- 3. Recreate views with updated status constraints
CREATE OR REPLACE VIEW v_open_exceptions AS
SELECT
    e.exception_id,
    e.run_id,
    e.exception_type,
    e.amount_diff,
    e.status,
    e.version,
    lt.txn_ref        AS ledger_ref,
    lt.amount         AS ledger_amount,
    lt.value_date      AS ledger_value_date,
    ex.external_ref    AS external_ref,
    ex.amount          AS external_amount,
    ex.value_date      AS external_value_date,
    u.full_name         AS assigned_to_name,
    e.created_at,
    e.sla_deadline,
    CASE
        WHEN e.status NOT IN ('APPROVED', 'CLOSED') AND e.sla_deadline < now() THEN TRUE
        ELSE FALSE
    END AS is_sla_breached
FROM reconciliation_exceptions e
LEFT JOIN ledger_transactions lt ON lt.ledger_txn_id = e.ledger_txn_id
LEFT JOIN external_statement_lines ex ON ex.ext_line_id = e.ext_line_id
LEFT JOIN users u ON u.user_id = e.assigned_to
WHERE e.status IN ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'APPROVED');

CREATE OR REPLACE VIEW v_analyst_workload AS
SELECT
    u.user_id,
    u.full_name,
    COUNT(e.exception_id) FILTER (WHERE e.status IN ('ASSIGNED', 'IN_PROGRESS')) AS open_count,
    COUNT(e.exception_id) FILTER (WHERE e.status = 'RESOLVED') AS in_review_count,
    COUNT(e.exception_id) FILTER (
        WHERE e.status = 'APPROVED' AND e.approved_at::DATE = CURRENT_DATE
    ) AS resolved_today
FROM users u
LEFT JOIN reconciliation_exceptions e ON e.assigned_to = u.user_id
WHERE u.deleted_at IS NULL
GROUP BY u.user_id, u.full_name;
