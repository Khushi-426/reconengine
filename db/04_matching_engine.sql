-- =====================================================================
-- Matching Engine — the core SQL logic of ReconEngine
-- These are run inside a single transaction from the Node matching service.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) EXACT MATCH PASS
-- Matches internal ledger rows to external lines 1:1 on account+amount+ref,
-- within a configurable date window. Uses ROW_NUMBER() to prevent one
-- external line being greedily matched to multiple ledger rows.
-- ---------------------------------------------------------------------
WITH candidate_pairs AS (
    SELECT
        lt.ledger_txn_id,
        ex.ext_line_id,
        ABS(lt.amount - ex.amount) AS amount_diff,
        ABS(lt.value_date - ex.value_date) AS day_diff,
        ROW_NUMBER() OVER (
            PARTITION BY lt.ledger_txn_id
            ORDER BY ABS(lt.amount - ex.amount), ABS(lt.value_date - ex.value_date)
        ) AS ledger_rank,
        ROW_NUMBER() OVER (
            PARTITION BY ex.ext_line_id
            ORDER BY ABS(lt.amount - ex.amount), ABS(lt.value_date - ex.value_date)
        ) AS ext_rank
    FROM ledger_transactions lt
    JOIN accounts a ON a.account_id = lt.account_id
    JOIN external_statement_lines ex
        ON ex.account_ref = a.external_ref
       AND ex.currency = lt.currency
       AND ex.value_date BETWEEN lt.value_date - INTERVAL '2 days' AND lt.value_date + INTERVAL '2 days'
    WHERE lt.amount = ex.amount              -- exact amount for this pass
      AND lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
      AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
)
SELECT ledger_txn_id, ext_line_id, amount_diff, day_diff
FROM candidate_pairs
WHERE ledger_rank = 1 AND ext_rank = 1;   -- mutual best match only (stable matching)


-- ---------------------------------------------------------------------
-- B) TOLERANCE MATCH PASS (handles FX rounding / fee deduction differences)
-- Same idea, but allows a percentage tolerance defined in match_rules.
-- ---------------------------------------------------------------------
WITH active_rule AS (
    SELECT amount_tolerance, date_window_days
    FROM match_rules
    WHERE rule_type = 'TOLERANCE' AND is_active = TRUE
    ORDER BY priority LIMIT 1
),
candidate_pairs AS (
    SELECT
        lt.ledger_txn_id,
        ex.ext_line_id,
        ABS(lt.amount - ex.amount) AS amount_diff,
        ROW_NUMBER() OVER (PARTITION BY lt.ledger_txn_id ORDER BY ABS(lt.amount - ex.amount)) AS ledger_rank,
        ROW_NUMBER() OVER (PARTITION BY ex.ext_line_id ORDER BY ABS(lt.amount - ex.amount)) AS ext_rank
    FROM ledger_transactions lt
    JOIN accounts a ON a.account_id = lt.account_id
    JOIN external_statement_lines ex ON ex.account_ref = a.external_ref AND ex.currency = lt.currency
    CROSS JOIN active_rule r
    WHERE ex.value_date BETWEEN lt.value_date - (r.date_window_days || ' days')::INTERVAL
                             AND lt.value_date + (r.date_window_days || ' days')::INTERVAL
      AND ABS(lt.amount - ex.amount) <= (lt.amount * r.amount_tolerance)
      AND lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
      AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
)
SELECT ledger_txn_id, ext_line_id, amount_diff
FROM candidate_pairs
WHERE ledger_rank = 1 AND ext_rank = 1;


-- ---------------------------------------------------------------------
-- C) BATCH SETTLEMENT MATCH (many ledger rows -> 1 external "batched" line)
-- Uses a window function running-sum to find a contiguous subset of
-- unmatched ledger transactions whose amounts sum to the external batch total.
-- This models real settlement files where a bank wires one lump sum for
-- hundreds of underlying customer transactions.
-- ---------------------------------------------------------------------
WITH unmatched_ledger AS (
    SELECT
        lt.ledger_txn_id,
        lt.account_id,
        lt.amount,
        lt.value_date,
        SUM(lt.amount) OVER (
            PARTITION BY lt.account_id
            ORDER BY lt.value_date, lt.ledger_txn_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_total
    FROM ledger_transactions lt
    JOIN accounts a ON a.account_id = lt.account_id
    WHERE lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
),
batch_candidates AS (
    SELECT ex.ext_line_id, ex.account_ref, ex.amount AS batch_total, ex.value_date
    FROM external_statement_lines ex
    WHERE ex.is_batched_settlement = TRUE
      AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
)
SELECT
    bc.ext_line_id,
    ul.ledger_txn_id,
    bc.batch_total,
    ul.running_total
FROM batch_candidates bc
JOIN accounts a ON a.external_ref = bc.account_ref
JOIN unmatched_ledger ul ON ul.account_id = a.account_id
WHERE ul.running_total <= bc.batch_total
ORDER BY bc.ext_line_id, ul.value_date;
-- (Application service groups these rows per ext_line_id and confirms the
--  subset whose sum == batch_total, then inserts one match_group with N ledger lines.)


-- ---------------------------------------------------------------------
-- D) RECURSIVE QUERY: reversal / correction chain traversal.
-- Some ledger transactions reference a prior transaction they reverse or
-- correct (self-referencing via narrative-parsed original_txn_id in a real
-- system; here modelled via a companion table for clarity). This recursively
-- walks a chain of corrections to find the *net effective* transaction —
-- needed because a reconciliation exception on an original txn should
-- resolve automatically once its full reversal chain is matched.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS txn_reversal_links (
    child_txn_id    BIGINT PRIMARY KEY REFERENCES ledger_transactions(ledger_txn_id),
    parent_txn_id   BIGINT NOT NULL REFERENCES ledger_transactions(ledger_txn_id)
);

WITH RECURSIVE reversal_chain AS (
    -- anchor: original transactions (no parent)
    SELECT lt.ledger_txn_id AS root_txn_id, lt.ledger_txn_id AS current_txn_id, 0 AS depth
    FROM ledger_transactions lt
    WHERE lt.ledger_txn_id NOT IN (SELECT child_txn_id FROM txn_reversal_links)

    UNION ALL

    SELECT rc.root_txn_id, trl.child_txn_id, rc.depth + 1
    FROM reversal_chain rc
    JOIN txn_reversal_links trl ON trl.parent_txn_id = rc.current_txn_id
    WHERE rc.depth < 20   -- guard against runaway recursion
)
SELECT root_txn_id, MAX(depth) AS chain_length, ARRAY_AGG(current_txn_id ORDER BY depth) AS chain
FROM reversal_chain
GROUP BY root_txn_id
HAVING MAX(depth) > 0;


-- ---------------------------------------------------------------------
-- E) QUERY OPTIMIZATION EXAMPLE — before/after, for the interview walkthrough
-- ---------------------------------------------------------------------
-- BEFORE (no composite index): full scan + sort, ~4200ms on 1M rows
-- EXPLAIN ANALYZE
-- SELECT * FROM reconciliation_exceptions
-- WHERE status = 'OPEN' AND assigned_to = '<uuid>'
-- ORDER BY created_at DESC LIMIT 50;

-- Composite index (already created in 01_schema.sql):
--   idx_exceptions_status_assignee_created ON reconciliation_exceptions(status, assigned_to, created_at DESC)

-- AFTER: Index Scan using idx_exceptions_status_assignee_created, ~2-8ms
-- Run this yourself post-seed to capture real before/after numbers for your resume bullet.
EXPLAIN ANALYZE
SELECT exception_id, exception_type, amount_diff, created_at
FROM reconciliation_exceptions
WHERE status = 'OPEN' AND assigned_to = (SELECT user_id FROM users LIMIT 1)
ORDER BY created_at DESC
LIMIT 50;
