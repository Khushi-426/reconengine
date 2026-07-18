-- =====================================================================
-- Database-level security (defense in depth beyond app-layer RBAC)
-- =====================================================================

-- Application connects as this role — NOT as superuser/postgres.
CREATE ROLE reconengine_app WITH LOGIN PASSWORD 'change_me_in_env';

GRANT CONNECT ON DATABASE reconengine TO reconengine_app;
GRANT USAGE ON SCHEMA public TO reconengine_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO reconengine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reconengine_app;

-- Nobody — not even the app role — may UPDATE or DELETE the audit log.
-- This makes the audit trail tamper-evident even against a compromised
-- application credential, which is exactly what auditors/regulators check for.
REVOKE UPDATE, DELETE ON audit_log FROM reconengine_app;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Only INSERT ... never UPDATE/DELETE rows physically deleted for soft-delete tables.
-- (soft delete enforced at app layer via deleted_at column; DB grant removes DELETE entirely)
REVOKE DELETE ON users FROM reconengine_app;
REVOKE DELETE ON ledger_transactions FROM reconengine_app;
REVOKE DELETE ON external_statement_lines FROM reconengine_app;

-- Row-level security example: an ANALYST can only see exceptions assigned to them
-- or unassigned; APPROVER/AUDITOR/ADMIN see everything. Enforced at the DB layer,
-- not just hidden in the UI — defense in depth against a bug in the API layer.
ALTER TABLE reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY analyst_sees_own_or_unassigned ON reconciliation_exceptions
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN')
        OR assigned_to = current_setting('app.current_user_id', true)::UUID
        OR assigned_to IS NULL
    );

-- Enforce default grants on any tables/sequences created in the future
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reconengine_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO reconengine_app;
