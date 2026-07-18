-- =====================================================================
-- Triggers: generic audit logging + updated_at maintenance
-- =====================================================================

-- Generic audit trigger function — works on any table with a single PK column.
-- Uses row_to_json to capture full before/after state as JSONB.
CREATE OR REPLACE FUNCTION fn_audit_trigger() RETURNS TRIGGER AS $$
DECLARE
    v_record_id TEXT;
    v_user_id UUID;
BEGIN
    -- app sets this per-connection via SET LOCAL app.current_user_id = '<uuid>'
    BEGIN
        v_user_id := current_setting('app.current_user_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    IF TG_OP = 'DELETE' THEN
        v_record_id := OLD.*::TEXT;
        INSERT INTO audit_log(table_name, record_id, action, changed_by, old_values, new_values)
        VALUES (TG_TABLE_NAME, COALESCE((row_to_json(OLD)->>'exception_id'), (row_to_json(OLD)->>'match_id'), (row_to_json(OLD)->>'user_id'), 'unknown'),
                'DELETE', v_user_id, row_to_json(OLD)::JSONB, NULL);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log(table_name, record_id, action, changed_by, old_values, new_values)
        VALUES (TG_TABLE_NAME, COALESCE((row_to_json(NEW)->>'exception_id'), (row_to_json(NEW)->>'match_id'), (row_to_json(NEW)->>'user_id'), 'unknown'),
                'UPDATE', v_user_id, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB);
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log(table_name, record_id, action, changed_by, old_values, new_values)
        VALUES (TG_TABLE_NAME, COALESCE((row_to_json(NEW)->>'exception_id'), (row_to_json(NEW)->>'match_id'), (row_to_json(NEW)->>'user_id'), 'unknown'),
                'INSERT', v_user_id, NULL, row_to_json(NEW)::JSONB);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_exceptions
    AFTER INSERT OR UPDATE OR DELETE ON reconciliation_exceptions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_match_groups
    AFTER INSERT OR UPDATE OR DELETE ON match_groups
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_users
    AFTER UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Optimistic-lock version bump — auto-increments version on every UPDATE
-- so application code can check WHERE version = :expectedVersion and detect conflicts.
CREATE OR REPLACE FUNCTION fn_bump_version() RETURNS TRIGGER AS $$
BEGIN
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_exceptions_version
    BEFORE UPDATE ON reconciliation_exceptions
    FOR EACH ROW EXECUTE FUNCTION fn_bump_version();

CREATE TRIGGER trg_match_groups_version
    BEFORE UPDATE ON match_groups
    FOR EACH ROW EXECUTE FUNCTION fn_bump_version();

-- Prevent a ledger transaction being included in two CONFIRMED match groups
-- (data-integrity guard beyond what FKs alone can express)
CREATE OR REPLACE FUNCTION fn_prevent_double_match() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM match_group_ledger_lines mgl
        JOIN match_groups mg ON mg.match_id = mgl.match_id
        WHERE mgl.ledger_txn_id = NEW.ledger_txn_id
          AND mg.status = 'CONFIRMED'
    ) THEN
        RAISE EXCEPTION 'ledger_txn_id % is already part of a confirmed match group', NEW.ledger_txn_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_double_match
    BEFORE INSERT ON match_group_ledger_lines
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_double_match();
