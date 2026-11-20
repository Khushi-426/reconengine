-- =====================================================================
-- Migration 11: AI Investigation Assistant & Analyst Feedback Tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS ai_investigations (
    investigation_id    BIGSERIAL PRIMARY KEY,
    exception_id        BIGINT NOT NULL REFERENCES reconciliation_exceptions(exception_id) ON DELETE CASCADE,
    requester_id        UUID NOT NULL REFERENCES users(user_id),
    prompt_version      VARCHAR(32) NOT NULL,
    provider            VARCHAR(64) NOT NULL,
    model               VARCHAR(64) NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'SUCCESS'
                            CHECK (status IN ('SUCCESS', 'FALLBACK_DETERMINISTIC', 'PROVIDER_ERROR', 'VALIDATION_FAILED')),
    discrepancy_category VARCHAR(64) NOT NULL,
    result_payload      JSONB NOT NULL,
    deterministic_hints JSONB NOT NULL DEFAULT '{}'::JSONB,
    evidence_ids        JSONB NOT NULL DEFAULT '[]'::JSONB,
    tokens_prompt       INT DEFAULT 0,
    tokens_completion   INT DEFAULT 0,
    latency_ms          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for retrieving recent investigations for an exception
CREATE INDEX IF NOT EXISTS idx_ai_investigations_exception ON ai_investigations(exception_id, created_at DESC);

-- Analyst Feedback on AI Investigations (append-only)
CREATE TABLE IF NOT EXISTS ai_investigation_feedback (
    feedback_id         BIGSERIAL PRIMARY KEY,
    investigation_id    BIGINT NOT NULL REFERENCES ai_investigations(investigation_id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(user_id),
    is_useful           BOOLEAN NOT NULL,
    comment             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_investigation ON ai_investigation_feedback(investigation_id);

-- Enable RLS to match security standards
ALTER TABLE ai_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_investigation_feedback ENABLE ROW LEVEL SECURITY;

-- Investigation access policy: Users can see investigations for exceptions they are authorized to see
DROP POLICY IF EXISTS ai_investigations_access_policy ON ai_investigations;
CREATE POLICY ai_investigations_access_policy ON ai_investigations
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) IN ('APPROVER', 'AUDITOR', 'ADMIN')
        OR EXISTS (
            SELECT 1 FROM reconciliation_exceptions e
            WHERE e.exception_id = ai_investigations.exception_id
              AND (e.assigned_to::TEXT = current_setting('app.current_user_id', true) OR e.assigned_to IS NULL)
        )
    );

DROP POLICY IF EXISTS app_can_insert_ai_investigations ON ai_investigations;
CREATE POLICY app_can_insert_ai_investigations ON ai_investigations
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS ai_feedback_access_policy ON ai_investigation_feedback;
CREATE POLICY ai_feedback_access_policy ON ai_investigation_feedback
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) IN ('APPROVER', 'AUDITOR', 'ADMIN')
        OR user_id::TEXT = current_setting('app.current_user_id', true)
    );

DROP POLICY IF EXISTS app_can_insert_ai_feedback ON ai_investigation_feedback;
CREATE POLICY app_can_insert_ai_feedback ON ai_investigation_feedback
    FOR INSERT
    WITH CHECK (true);
