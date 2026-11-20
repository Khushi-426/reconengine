-- Deterministic investigation lifecycle, attached to the existing PostgreSQL queue.
CREATE TABLE IF NOT EXISTS investigations (
  investigation_id BIGSERIAL PRIMARY KEY,
  exception_id BIGINT NOT NULL REFERENCES reconciliation_exceptions(exception_id),
  requested_by UUID NOT NULL REFERENCES users(user_id),
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
  discrepancy_category VARCHAR(64),
  result JSONB,
  job_id BIGINT REFERENCES background_jobs(job_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_investigations_exception ON investigations(exception_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_investigation_active_exception ON investigations(exception_id)
  WHERE status IN ('QUEUED','RUNNING');

CREATE TABLE IF NOT EXISTS investigation_agent_executions (
  execution_id BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT NOT NULL REFERENCES investigations(investigation_id) ON DELETE CASCADE,
  agent_name VARCHAR(40) NOT NULL CHECK (agent_name IN ('EVIDENCE_RETRIEVAL','FINANCIAL_ANALYSIS','INVESTIGATION','VERIFICATION_REPORTING')),
  attempt INT NOT NULL CHECK (attempt > 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  input_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  output JSONB,
  error_details TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(investigation_id, agent_name, attempt)
);
CREATE TABLE IF NOT EXISTS investigation_evidence (
  investigation_id BIGINT NOT NULL REFERENCES investigations(investigation_id) ON DELETE CASCADE,
  evidence_type VARCHAR(40) NOT NULL,
  source_record_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(investigation_id, evidence_type, source_record_id)
);
CREATE TABLE IF NOT EXISTS investigation_feedback (
  feedback_id BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT NOT NULL REFERENCES investigations(investigation_id),
  analyst_id UUID NOT NULL REFERENCES users(user_id),
  is_useful BOOLEAN NOT NULL,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS investigation_audit_history (
  audit_id BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT NOT NULL REFERENCES investigations(investigation_id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investigation_audit ON investigation_audit_history(investigation_id, created_at);

ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY investigations_access_policy ON investigations FOR SELECT USING (
  current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN') OR
  EXISTS (SELECT 1 FROM reconciliation_exceptions e WHERE e.exception_id = investigations.exception_id
    AND (e.assigned_to::text = current_setting('app.current_user_id', true) OR e.assigned_to IS NULL))
);
CREATE POLICY investigations_insert_policy ON investigations FOR INSERT WITH CHECK (
  requested_by::text = current_setting('app.current_user_id', true)
);
CREATE POLICY investigations_update_policy ON investigations FOR UPDATE USING (
  current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN') OR
  EXISTS (SELECT 1 FROM reconciliation_exceptions e WHERE e.exception_id = investigations.exception_id
    AND (e.assigned_to::text = current_setting('app.current_user_id', true) OR e.assigned_to IS NULL))
) WITH CHECK (
  current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN') OR
  EXISTS (SELECT 1 FROM reconciliation_exceptions e WHERE e.exception_id = investigations.exception_id
    AND (e.assigned_to::text = current_setting('app.current_user_id', true) OR e.assigned_to IS NULL))
);
ALTER TABLE investigation_agent_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY investigation_execution_access ON investigation_agent_executions FOR SELECT USING (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_agent_executions.investigation_id)
);
CREATE POLICY investigation_execution_insert ON investigation_agent_executions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_agent_executions.investigation_id)
);
CREATE POLICY investigation_execution_update ON investigation_agent_executions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_agent_executions.investigation_id)
) WITH CHECK (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_agent_executions.investigation_id)
);
ALTER TABLE investigation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY investigation_evidence_access ON investigation_evidence FOR SELECT USING (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_evidence.investigation_id)
);
CREATE POLICY investigation_evidence_insert ON investigation_evidence FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_evidence.investigation_id)
);
ALTER TABLE investigation_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY investigation_feedback_access ON investigation_feedback FOR SELECT USING (
  analyst_id::text = current_setting('app.current_user_id', true) OR
  current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN')
);
CREATE POLICY investigation_feedback_insert ON investigation_feedback FOR INSERT WITH CHECK (
  analyst_id::text = current_setting('app.current_user_id', true) OR
  current_setting('app.current_user_role', true) IN ('APPROVER','AUDITOR','ADMIN')
);
ALTER TABLE investigation_audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY investigation_audit_access ON investigation_audit_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_audit_history.investigation_id)
);
CREATE POLICY investigation_audit_insert ON investigation_audit_history FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM investigations i WHERE i.investigation_id = investigation_audit_history.investigation_id)
);

GRANT SELECT, INSERT, UPDATE ON investigations, investigation_agent_executions, investigation_evidence,
  investigation_feedback, investigation_audit_history TO reconengine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reconengine_app;
