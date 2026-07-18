-- =====================================================================
-- Views & Materialized Views
-- =====================================================================

-- Regular view: live exception queue with joined context (used by ops dashboard).
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
    -- SLA breach flag using window-free correlated logic
    CASE
        WHEN e.status = 'OPEN' AND e.created_at < now() - INTERVAL '24 hours' THEN TRUE
        ELSE FALSE
    END AS is_sla_breached
FROM reconciliation_exceptions e
LEFT JOIN ledger_transactions lt ON lt.ledger_txn_id = e.ledger_txn_id
LEFT JOIN external_statement_lines ex ON ex.ext_line_id = e.ext_line_id
LEFT JOIN users u ON u.user_id = e.assigned_to
WHERE e.status IN ('OPEN', 'IN_REVIEW');

-- Materialized view: daily reconciliation summary per account.
-- Refreshed after each reconciliation run (see fn_refresh_daily_summary).
-- This is the query that would be slow to compute live at scale — hence materialized.
CREATE MATERIALIZED VIEW mv_daily_reconciliation_summary AS
WITH ledger_agg AS (
    SELECT
        a.account_id,
        lt.value_date,
        COUNT(*)                                   AS internal_txn_count,
        SUM(lt.amount) FILTER (WHERE lt.txn_type = 'CREDIT') AS internal_credits,
        SUM(lt.amount) FILTER (WHERE lt.txn_type = 'DEBIT')  AS internal_debits
    FROM ledger_transactions lt
    JOIN accounts a ON a.account_id = lt.account_id
    GROUP BY a.account_id, lt.value_date
),
external_agg AS (
    SELECT
        a.account_id,
        ex.value_date,
        COUNT(*)            AS external_line_count,
        SUM(ex.amount)       AS external_total
    FROM external_statement_lines ex
    JOIN accounts a ON a.external_ref = ex.account_ref
    GROUP BY a.account_id, ex.value_date
),
exception_agg AS (
    SELECT
        lt.account_id,
        e.created_at::DATE AS exception_date,
        COUNT(*) AS exception_count
    FROM reconciliation_exceptions e
    LEFT JOIN ledger_transactions lt ON lt.ledger_txn_id = e.ledger_txn_id
    GROUP BY lt.account_id, e.created_at::DATE
)
SELECT
    COALESCE(l.account_id, x.account_id)           AS account_id,
    COALESCE(l.value_date, x.value_date)           AS summary_date,
    COALESCE(l.internal_txn_count, 0)              AS internal_txn_count,
    COALESCE(l.internal_credits, 0) - COALESCE(l.internal_debits, 0) AS internal_net,
    COALESCE(x.external_line_count, 0)             AS external_line_count,
    COALESCE(x.external_total, 0)                  AS external_total,
    COALESCE(exc.exception_count, 0)                AS exception_count,
    -- Rolling 7-day exception trend using a window function
    AVG(COALESCE(exc.exception_count, 0)) OVER (
        PARTITION BY COALESCE(l.account_id, x.account_id)
        ORDER BY COALESCE(l.value_date, x.value_date)
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS rolling_7d_avg_exceptions
FROM ledger_agg l
FULL OUTER JOIN external_agg x
    ON l.account_id = x.account_id AND l.value_date = x.value_date
LEFT JOIN exception_agg exc
    ON exc.account_id = COALESCE(l.account_id, x.account_id)
   AND exc.exception_date = COALESCE(l.value_date, x.value_date);

CREATE UNIQUE INDEX idx_mv_daily_summary_pk
    ON mv_daily_reconciliation_summary(account_id, summary_date);

-- Refresh function — called via REFRESH MATERIALIZED VIEW CONCURRENTLY after each run,
-- so reads against the view are never blocked during refresh.
CREATE OR REPLACE FUNCTION fn_refresh_daily_summary() RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_reconciliation_summary;
END;
$$ LANGUAGE plpgsql;

-- View: ops-user workload (used by "assign exceptions" feature)
CREATE OR REPLACE VIEW v_analyst_workload AS
SELECT
    u.user_id,
    u.full_name,
    COUNT(e.exception_id) FILTER (WHERE e.status = 'OPEN')       AS open_count,
    COUNT(e.exception_id) FILTER (WHERE e.status = 'IN_REVIEW')  AS in_review_count,
    COUNT(e.exception_id) FILTER (
        WHERE e.status = 'RESOLVED' AND e.resolved_at::DATE = CURRENT_DATE
    ) AS resolved_today
FROM users u
LEFT JOIN reconciliation_exceptions e ON e.assigned_to = u.user_id
WHERE u.deleted_at IS NULL
GROUP BY u.user_id, u.full_name;
