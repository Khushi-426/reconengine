-- =====================================================================
-- Phase 1, Step 6: Notification System Table
-- =====================================================================

CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    message         TEXT NOT NULL,
    link            VARCHAR(200),
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for retrieving unread notifications quickly
CREATE INDEX idx_notifications_user_unread 
    ON notifications(user_id) 
    WHERE is_read = FALSE;
