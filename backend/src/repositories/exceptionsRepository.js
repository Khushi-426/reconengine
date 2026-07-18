import { query } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

/**
 * Repository layer talks to Postgres directly with parameterized raw SQL.
 * No ORM here deliberately — this is where SQL competency is demonstrated:
 * dynamic filtering, keyset-friendly pagination, and window-function totals
 * in a single round trip.
 */

export async function findExceptions({ status, assignedTo, exceptionType, search, page = 1, pageSize = 25 }) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (assignedTo) {
    params.push(assignedTo);
    conditions.push(`e.assigned_to = $${params.length}`);
  }
  if (exceptionType) {
    params.push(exceptionType);
    conditions.push(`e.exception_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(lt.txn_ref ILIKE $${params.length} OR ex.external_ref ILIKE $${params.length})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);

  // COUNT(*) OVER() gives total row count in the same query as the page of
  // results — avoids a second round-trip query just to compute pagination metadata.
  const sql = `
    SELECT
      e.exception_id, e.run_id, e.exception_type, e.amount_diff, e.status,
      e.version, e.assigned_to, e.created_at, e.resolved_at,
      e.assigned_at, e.in_progress_at, e.approved_at, e.approved_by, e.closed_at, e.closed_by, e.sla_deadline,
      CASE WHEN e.status NOT IN ('APPROVED', 'CLOSED') AND now() > e.sla_deadline THEN TRUE ELSE FALSE END AS is_sla_breached,
      EXTRACT(EPOCH FROM (e.sla_deadline - now()))::INT AS time_remaining_seconds,
      lt.txn_ref  AS ledger_ref, lt.amount AS ledger_amount, lt.value_date AS ledger_value_date,
      ex.external_ref, ex.amount AS external_amount, ex.value_date AS external_value_date,
      u.full_name AS assigned_to_name,
      COUNT(*) OVER() AS total_count
    FROM reconciliation_exceptions e
    LEFT JOIN ledger_transactions lt ON lt.ledger_txn_id = e.ledger_txn_id
    LEFT JOIN external_statement_lines ex ON ex.ext_line_id = e.ext_line_id
    LEFT JOIN users u ON u.user_id = e.assigned_to
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const result = await query(sql, params);
  const total = result.rows[0]?.total_count ? parseInt(result.rows[0].total_count, 10) : 0;

  return {
    data: result.rows.map(({ total_count, ...row }) => row),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * Start work on an exception — moves it from ASSIGNED to IN_PROGRESS.
 */
export async function startWorkOnException(client, { exceptionId, analystId }) {
  const result = await client.query(
    `UPDATE reconciliation_exceptions
     SET status = 'IN_PROGRESS', in_progress_at = now()
     WHERE exception_id = $1 AND assigned_to = $2 AND status = 'ASSIGNED'
     RETURNING exception_id, version, status`,
    [exceptionId, analystId]
  );
  if (result.rowCount === 0) {
    throw new AppError(400, "Cannot start work. Exception must be assigned to you and in ASSIGNED status.");
  }
  return result.rows[0];
}

/**
 * Resolve an exception using OPTIMISTIC LOCKING.
 */
export async function resolveExceptionWithLock(client, { exceptionId, expectedVersion, resolvedBy, resolutionNote }) {
  const result = await client.query(
    `UPDATE reconciliation_exceptions
       SET status = 'RESOLVED', resolution_note = $1, resolved_by = $2, resolved_at = now()
     WHERE exception_id = $3 AND version = $4
     RETURNING exception_id, version, status`,
    [resolutionNote, resolvedBy, exceptionId, expectedVersion]
  );

  if (result.rowCount === 0) {
    const existing = await client.query(
      `SELECT exception_id, version, status FROM reconciliation_exceptions WHERE exception_id = $1`,
      [exceptionId]
    );
    if (existing.rowCount === 0) {
      throw new AppError(404, "Exception not found");
    }
    throw new AppError(
      409,
      "This exception was modified by another user since you loaded it. Refresh and try again.",
      "OPTIMISTIC_LOCK_CONFLICT",
      { currentVersion: existing.rows[0].version, currentStatus: existing.rows[0].status }
    );
  }

  return result.rows[0];
}

/**
 * Approve an exception resolution using OPTIMISTIC LOCKING.
 */
export async function approveExceptionWithLock(client, { exceptionId, expectedVersion, approvedBy }) {
  const result = await client.query(
    `UPDATE reconciliation_exceptions
       SET status = 'APPROVED', approved_by = $1, approved_at = now()
     WHERE exception_id = $2 AND version = $3
     RETURNING exception_id, version, status`,
    [approvedBy, exceptionId, expectedVersion]
  );

  if (result.rowCount === 0) {
    const existing = await client.query(
      `SELECT exception_id, version, status FROM reconciliation_exceptions WHERE exception_id = $1`,
      [exceptionId]
    );
    if (existing.rowCount === 0) {
      throw new AppError(404, "Exception not found");
    }
    throw new AppError(
      409,
      "This exception was modified by another user since you loaded it. Refresh and try again.",
      "OPTIMISTIC_LOCK_CONFLICT",
      { currentVersion: existing.rows[0].version, currentStatus: existing.rows[0].status }
    );
  }

  return result.rows[0];
}

/**
 * Close an approved exception using OPTIMISTIC LOCKING.
 */
export async function closeExceptionWithLock(client, { exceptionId, expectedVersion, closedBy }) {
  const result = await client.query(
    `UPDATE reconciliation_exceptions
       SET status = 'CLOSED', closed_by = $1, closed_at = now()
     WHERE exception_id = $2 AND version = $3
     RETURNING exception_id, version, status`,
    [closedBy, exceptionId, expectedVersion]
  );

  if (result.rowCount === 0) {
    const existing = await client.query(
      `SELECT exception_id, version, status FROM reconciliation_exceptions WHERE exception_id = $1`,
      [exceptionId]
    );
    if (existing.rowCount === 0) {
      throw new AppError(404, "Exception not found");
    }
    throw new AppError(
      409,
      "This exception was modified by another user since you loaded it. Refresh and try again.",
      "OPTIMISTIC_LOCK_CONFLICT",
      { currentVersion: existing.rows[0].version, currentStatus: existing.rows[0].status }
    );
  }

  return result.rows[0];
}

/**
 * Assign an exception to an analyst — uses SELECT ... FOR UPDATE (pessimistic
 * locking) because assignment is a short, high-contention operation where we'd
 * rather block briefly than retry on conflict.
 */
export async function assignExceptionPessimistic(client, { exceptionId, assignTo }) {
  const locked = await client.query(
    `SELECT exception_id, status FROM reconciliation_exceptions WHERE exception_id = $1 FOR UPDATE`,
    [exceptionId]
  );
  if (locked.rowCount === 0) throw new AppError(404, "Exception not found");
  if (['RESOLVED', 'APPROVED', 'CLOSED'].includes(locked.rows[0].status)) {
    throw new AppError(409, "Cannot reassign a resolved, approved, or closed exception");
  }

  const updated = await client.query(
    `UPDATE reconciliation_exceptions 
     SET assigned_to = $1, status = 'ASSIGNED', assigned_at = now() 
     WHERE exception_id = $2 
     RETURNING *`,
    [assignTo, exceptionId]
  );
  return updated.rows[0];
}

/**
 * Exception summary report — CTE + window function.
 * Shows exception counts by type with a running percentage of total,
 * and a comparison to the prior day using LAG().
 */
export async function getExceptionTrendReport({ fromDate, toDate }) {
  const sql = `
    WITH daily_counts AS (
      SELECT created_at::DATE AS day, exception_type, COUNT(*) AS cnt
      FROM reconciliation_exceptions
      WHERE created_at::DATE BETWEEN $1 AND $2
      GROUP BY created_at::DATE, exception_type
    ),
    with_trend AS (
      SELECT
        day, exception_type, cnt,
        LAG(cnt) OVER (PARTITION BY exception_type ORDER BY day) AS prev_day_cnt,
        SUM(cnt) OVER (PARTITION BY day) AS day_total,
        ROUND(100.0 * cnt / NULLIF(SUM(cnt) OVER (PARTITION BY day), 0), 1) AS pct_of_day
      FROM daily_counts
    )
    SELECT
      day, exception_type, cnt, prev_day_cnt,
      cnt - COALESCE(prev_day_cnt, 0) AS delta_vs_prev_day,
      pct_of_day
    FROM with_trend
    ORDER BY day DESC, cnt DESC;
  `;
  const result = await query(sql, [fromDate, toDate]);
  return result.rows;
}
