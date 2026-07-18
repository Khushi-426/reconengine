-- =====================================================================
-- Phase 1, Step 1 & 2: Background Jobs & Retry/DLQ Tables
-- =====================================================================

CREATE TABLE background_jobs (
    job_id         BIGSERIAL PRIMARY KEY,
    job_type       VARCHAR(50) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED')),
    payload        JSONB NOT NULL DEFAULT '{}'::JSONB,
    priority       INT NOT NULL DEFAULT 20, -- 10 = HIGH, 20 = MEDIUM, 30 = LOW
    attempts       INT NOT NULL DEFAULT 0,
    max_attempts   INT NOT NULL DEFAULT 3,
    run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    worker_owner   VARCHAR(50),
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    last_heartbeat TIMESTAMPTZ,
    error_message  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast priority enqueuing
CREATE INDEX idx_jobs_pending_priority 
    ON background_jobs(priority ASC, created_at ASC) 
    WHERE status IN ('PENDING', 'RETRYING');

-- Index for heartbeat recovery check
CREATE INDEX idx_jobs_running_heartbeat 
    ON background_jobs(last_heartbeat) 
    WHERE status = 'RUNNING';

CREATE TABLE dead_letter_jobs (
    job_id         BIGINT PRIMARY KEY,
    job_type       VARCHAR(50) NOT NULL,
    payload        JSONB NOT NULL,
    priority       INT NOT NULL,
    attempts       INT NOT NULL,
    last_error     TEXT,
    failed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Phase 1, Step 3: Scheduler Configuration Table
-- =====================================================================

CREATE TABLE scheduler_configs (
    config_id       SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    cron_expression VARCHAR(50) NOT NULL,
    job_type        VARCHAR(50) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::JSONB,
    priority        INT NOT NULL DEFAULT 20,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial scheduler configurations
INSERT INTO scheduler_configs (name, cron_expression, job_type, payload, priority) VALUES
('Daily Reconciliation Run', '5 0 * * *', 'RECONCILIATION_RUN', '{}'::JSONB, 20),
('Materialized View Refresh', '15 0 * * *', 'REFRESH_DAILY_SUMMARY', '{}'::JSONB, 30),
('Job Archive and Cleanup', '0 1 * * *', 'ARCHIVE_CLEANUP_JOBS', '{}'::JSONB, 30)
ON CONFLICT (name) DO NOTHING;
