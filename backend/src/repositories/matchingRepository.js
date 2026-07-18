/**
 * These queries are the executable counterpart of db/04_matching_engine.sql.
 * They run inside a single DB transaction owned by matchingService, so a
 * failure at any stage rolls back the entire reconciliation run cleanly.
 */
import { query } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

/**
 * Returns the newest completed, non-ledger import that actually contains
 * statement lines. A reconciliation run must always be tied to this batch;
 * importing a file is the only supported way external settlement data enters
 * the application.
 */
export async function findLatestExternalSettlementBatch() {
  const result = await query(`
    SELECT ib.batch_id, ib.source_id, ib.file_name, ib.completed_at
    FROM import_batches ib
    JOIN import_sources src ON src.source_id = ib.source_id
    WHERE ib.status = 'COMPLETED'
      AND src.file_format <> 'DATABASE'
      AND EXISTS (
        SELECT 1 FROM external_statement_lines ex WHERE ex.batch_id = ib.batch_id
      )
    ORDER BY ib.completed_at DESC NULLS LAST, ib.batch_id DESC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

export async function requireExternalSettlementBatch(batchId) {
  if (batchId) {
    const result = await query(`
      SELECT ib.batch_id, ib.source_id, ib.file_name, ib.completed_at
      FROM import_batches ib
      JOIN import_sources src ON src.source_id = ib.source_id
      WHERE ib.batch_id = $1
        AND ib.status = 'COMPLETED'
        AND src.file_format <> 'DATABASE'
        AND EXISTS (SELECT 1 FROM external_statement_lines ex WHERE ex.batch_id = ib.batch_id)
    `, [batchId]);
    if (result.rowCount > 0) return result.rows[0];
  } else {
    const batch = await findLatestExternalSettlementBatch();
    if (batch) return batch;
  }

  throw new AppError(
    409,
    "No external settlement batch available for reconciliation.",
    "NO_EXTERNAL_SETTLEMENT_BATCH"
  );
}

export async function createRun(client, { runDate, triggeredBy }) {
  const result = await client.query(
    `INSERT INTO reconciliation_runs (run_date, triggered_by) VALUES ($1,$2) RETURNING run_id`,
    [runDate, triggeredBy]
  );
  return result.rows[0].run_id;
}

export async function findExactMatches(client, { batchId, runDate }) {
  const sql = `
    WITH candidate_pairs AS (
      SELECT
        lt.ledger_txn_id, ex.ext_line_id,
        ROW_NUMBER() OVER (PARTITION BY lt.ledger_txn_id ORDER BY ABS(lt.value_date - ex.value_date)) AS ledger_rank,
        ROW_NUMBER() OVER (PARTITION BY ex.ext_line_id ORDER BY ABS(lt.value_date - ex.value_date)) AS ext_rank
      FROM ledger_transactions lt
      JOIN accounts a ON a.account_id = lt.account_id
      JOIN external_statement_lines ex
        ON ex.account_ref = a.external_ref
       AND ex.currency = lt.currency
       AND ex.batch_id = $1
       AND ex.value_date BETWEEN lt.value_date - INTERVAL '2 days' AND lt.value_date + INTERVAL '2 days'
      WHERE lt.value_date = $2
        AND lt.amount = ex.amount
        AND lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
        AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
    )
    SELECT ledger_txn_id, ext_line_id FROM candidate_pairs WHERE ledger_rank = 1 AND ext_rank = 1;
  `;
  const result = await client.query(sql, [batchId, runDate]);
  return result.rows;
}

export async function findToleranceMatches(client, { batchId, runDate }) {
  const sql = `
    WITH active_rule AS (
      SELECT amount_tolerance, date_window_days FROM match_rules
      WHERE rule_type = 'TOLERANCE' AND is_active = TRUE ORDER BY priority LIMIT 1
    ),
    candidate_pairs AS (
      SELECT
        lt.ledger_txn_id, ex.ext_line_id, ABS(lt.amount - ex.amount) AS amount_diff,
        ROW_NUMBER() OVER (PARTITION BY lt.ledger_txn_id ORDER BY ABS(lt.amount - ex.amount)) AS ledger_rank,
        ROW_NUMBER() OVER (PARTITION BY ex.ext_line_id ORDER BY ABS(lt.amount - ex.amount)) AS ext_rank
      FROM ledger_transactions lt
      JOIN accounts a ON a.account_id = lt.account_id
      JOIN external_statement_lines ex ON ex.account_ref = a.external_ref AND ex.currency = lt.currency AND ex.batch_id = $1
      CROSS JOIN active_rule r
      WHERE lt.value_date = $2
        AND ex.value_date BETWEEN lt.value_date - (r.date_window_days || ' days')::INTERVAL
                               AND lt.value_date + (r.date_window_days || ' days')::INTERVAL
        AND ABS(lt.amount - ex.amount) <= (lt.amount * r.amount_tolerance)
        AND lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
        AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
    )
    SELECT ledger_txn_id, ext_line_id, amount_diff FROM candidate_pairs WHERE ledger_rank = 1 AND ext_rank = 1;
  `;
  const result = await client.query(sql, [batchId, runDate]);
  return result.rows;
}

export async function findBatchSettlementCandidates(client, { batchId, runDate }) {
  const sql = `
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
      WHERE lt.value_date = $2
        AND lt.ledger_txn_id NOT IN (SELECT ledger_txn_id FROM match_group_ledger_lines)
    ),
    batch_candidates AS (
      SELECT ex.ext_line_id, ex.account_ref, ex.amount AS batch_total, ex.value_date
      FROM external_statement_lines ex
      WHERE ex.batch_id = $1
        AND ex.is_batched_settlement = TRUE
        AND ex.ext_line_id NOT IN (SELECT ext_line_id FROM match_group_external_lines)
    )
    SELECT
      bc.ext_line_id,
      ul.ledger_txn_id,
      bc.batch_total,
      ul.running_total,
      ul.amount
    FROM batch_candidates bc
    JOIN accounts a ON a.external_ref = bc.account_ref
    JOIN unmatched_ledger ul ON ul.account_id = a.account_id
    WHERE ul.running_total <= bc.batch_total
    ORDER BY bc.ext_line_id, ul.value_date
  `;
  const result = await client.query(sql, [batchId, runDate]);
  return result.rows;
}

export async function insertMatchGroup(client, { runId, ruleId, matchType, confidence, matchedBy, ledgerTxnIds, extLineIds }) {
  const matchResult = await client.query(
    `INSERT INTO match_groups (run_id, rule_id, match_type, confidence_score, matched_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING match_id`,
    [runId, ruleId, matchType, confidence, matchedBy]
  );
  const matchId = matchResult.rows[0].match_id;

  for (const ledgerTxnId of ledgerTxnIds) {
    await client.query(
      `INSERT INTO match_group_ledger_lines (match_id, ledger_txn_id) VALUES ($1,$2)`,
      [matchId, ledgerTxnId]
    );
  }
  for (const extLineId of extLineIds) {
    await client.query(
      `INSERT INTO match_group_external_lines (match_id, ext_line_id) VALUES ($1,$2)`,
      [matchId, extLineId]
    );
  }
  return matchId;
}

/**
 * Anything left unmatched after all passes becomes an exception.
 * Uses NOT EXISTS anti-joins (generally faster than NOT IN for large sets
 * since NOT IN has null-handling pitfalls and poor plan choices at scale).
 */
export async function generateExceptionsForUnmatched(client, runId, { batchId, runDate }) {
  const missingExternal = await client.query(
    `INSERT INTO reconciliation_exceptions (run_id, ledger_txn_id, exception_type)
     SELECT $1, lt.ledger_txn_id, 'MISSING_EXTERNAL'
     FROM ledger_transactions lt
     WHERE lt.value_date = $2
       AND NOT EXISTS (SELECT 1 FROM match_group_ledger_lines mgl WHERE mgl.ledger_txn_id = lt.ledger_txn_id)
       AND NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e WHERE e.ledger_txn_id = lt.ledger_txn_id)
     RETURNING exception_id`,
    [runId, runDate]
  );

  const missingInternal = await client.query(
    `INSERT INTO reconciliation_exceptions (run_id, ext_line_id, exception_type)
     SELECT $1, ex.ext_line_id, 'MISSING_INTERNAL'
     FROM external_statement_lines ex
     WHERE ex.batch_id = $2
       AND ex.value_date = $3
       AND NOT EXISTS (SELECT 1 FROM match_group_external_lines mgl WHERE mgl.ext_line_id = ex.ext_line_id)
       AND NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e WHERE e.ext_line_id = ex.ext_line_id)
     RETURNING exception_id`,
    [runId, batchId, runDate]
  );

  return missingExternal.rowCount + missingInternal.rowCount;
}

export async function completeRun(client, runId, stats) {
  await client.query(
    `UPDATE reconciliation_runs
     SET status = 'COMPLETED', total_internal = $1, total_external = $2,
         matched_count = $3, exception_count = $4, completed_at = now()
     WHERE run_id = $5`,
    [stats.totalInternal, stats.totalExternal, stats.matchedCount, stats.exceptionCount, runId]
  );
}

export async function findReconciliationRuns({ page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize;
  const sql = `
    SELECT
      r.run_id,
      r.run_date,
      r.triggered_by,
      r.status,
      r.total_internal,
      r.total_external,
      r.matched_count,
      r.exception_count,
      r.started_at,
      r.completed_at,
      u.full_name AS triggered_by_name,
      COUNT(*) OVER() AS total_count
    FROM reconciliation_runs r
    LEFT JOIN users u ON u.user_id = r.triggered_by
    ORDER BY r.started_at DESC
    LIMIT $1 OFFSET $2
  `;
  const result = await query(sql, [pageSize, offset]);
  const total = result.rows[0]?.total_count ? parseInt(result.rows[0].total_count, 10) : 0;
  return {
    data: result.rows.map(({ total_count, ...row }) => row),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
