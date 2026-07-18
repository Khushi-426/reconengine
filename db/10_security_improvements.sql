-- =====================================================================
-- Phase 3: Security Improvements (Sessions, Lockouts, Tokens)
-- =====================================================================

-- 1. Stateful Sessions Table
CREATE TABLE user_sessions (
    session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of rotating refresh token
    ip_address         VARCHAR(45),
    user_agent         TEXT,
    is_revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON user_sessions(refresh_token_hash);

-- 2. Brute-Force Lockout Columns on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Grant access to all tables and sequences created in subsequent migrations (06 to 10)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reconengine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reconengine_app;
