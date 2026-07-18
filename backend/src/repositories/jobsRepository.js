import { query, pool } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

/**
 * Enqueues a job into the queue.
 */
export async function enqueueJob(client, { jobType, payload = {}, priority = 20, maxAttempts = 3, runAt = new Date() }) {
  const db = client || pool;
  const sql = `
    INSERT INTO background_jobs (job_type, status, payload, priority, max_attempts, run_at)
    VALUES ($1, 'PENDING', $2, $3, $4, $5)
    RETURNING job_id, job_type, status, priority, attempts, max_attempts, run_at, created_at
  `;
  const result = await db.query(sql, [jobType, JSON.stringify(payload), priority, maxAttempts, runAt]);
  return result.rows[0];
}

/**
 * Claims the next available high-priority job.
 * Employs SELECT ... FOR UPDATE SKIP LOCKED to ensure multiple concurrent
 * worker processes can safely claim separate jobs without blocking or race conditions.
 *
 * Runs inside withTransaction().
 */
export async function claimNextJob(client, workerOwner) {
  const selectSql = `
    UPDATE background_jobs
    SET status = 'RUNNING', worker_owner = $1, started_at = now(), last_heartbeat = now(), attempts = attempts + 1
    WHERE job_id = (
      SELECT job_id FROM background_jobs
      WHERE status IN ('PENDING', 'RETRYING') AND run_at <= now()
      ORDER BY priority ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING job_id, job_type, payload, attempts, max_attempts, priority
  `;
  const result = await client.query(selectSql, [workerOwner]);
  return result.rows[0] || null;
}

/**
 * Updates the heartbeat timestamp for a worker's active running jobs.
 */
export async function updateJobHeartbeat(client, jobId, workerOwner) {
  const sql = `
    UPDATE background_jobs
    SET last_heartbeat = now()
    WHERE job_id = $1 AND worker_owner = $2 AND status = 'RUNNING'
  `;
  await client.query(sql, [jobId, workerOwner]);
}

/**
 * Marks a job as completed.
 */
export async function completeJob(client, jobId) {
  const sql = `
    UPDATE background_jobs
    SET status = 'COMPLETED', completed_at = now(), updated_at = now()
    WHERE job_id = $1
    RETURNING job_id, status
  `;
  const result = await client.query(sql, [jobId]);
  return result.rows[0];
}

/**
 * Marks a job execution as failed, reschedules it with exponential backoff if possible.
 */
export async function failJob(client, jobId, errorMessage, nextRunDelaySeconds) {
  const runAt = new Date(Date.now() + nextRunDelaySeconds * 1000);
  const sql = `
    UPDATE background_jobs
    SET status = 'RETRYING', error_message = $1, run_at = $2, worker_owner = NULL, updated_at = now()
    WHERE job_id = $3
    RETURNING job_id, status, attempts, max_attempts
  `;
  const result = await client.query(sql, [errorMessage, runAt, jobId]);
  return result.rows[0];
}

/**
 * Moves a job into the Dead Letter Queue (dead_letter_jobs) and deletes it from active queue.
 */
export async function moveToDlq(client, jobId, errorMessage) {
  // 1. Move to dead_letter_jobs
  const insertSql = `
    INSERT INTO dead_letter_jobs (job_id, job_type, payload, priority, attempts, last_error, failed_at)
    SELECT job_id, job_type, payload, priority, attempts, $1, now()
    FROM background_jobs
    WHERE job_id = $2
  `;
  await client.query(insertSql, [errorMessage, jobId]);

  // 2. Remove from background_jobs
  const deleteSql = `
    DELETE FROM background_jobs
    WHERE job_id = $1
  `;
  await client.query(deleteSql, [jobId]);
}

/**
 * Finds running jobs that have timed out (no heartbeat update for threshold).
 */
export async function findOrphanedJobs(client, timeoutSeconds) {
  const sql = `
    SELECT job_id, job_type, payload, attempts, max_attempts, priority, worker_owner
    FROM background_jobs
    WHERE status = 'RUNNING' AND last_heartbeat < now() - ($1 || ' seconds')::INTERVAL
  `;
  const result = await client.query(sql, [timeoutSeconds]);
  return result.rows;
}

/**
 * Fetches details about a single job.
 */
export async function findJobById(jobId) {
  const sql = `
    SELECT job_id, job_type, status, priority, attempts, max_attempts, run_at, started_at, completed_at, last_heartbeat, error_message, created_at
    FROM background_jobs
    WHERE job_id = $1
    UNION ALL
    SELECT job_id, job_type, 'DEAD_LETTER' AS status, priority, attempts, attempts AS max_attempts, failed_at AS run_at, NULL AS started_at, failed_at AS completed_at, NULL AS last_heartbeat, last_error AS error_message, failed_at AS created_at
    FROM dead_letter_jobs
    WHERE job_id = $1
  `;
  const result = await query(sql, [jobId]);
  if (result.rowCount === 0) {
    throw new AppError(404, `Job #${jobId} not found`);
  }
  return result.rows[0];
}

/**
 * Fetches all active scheduler configurations.
 */
export async function findActiveSchedulerConfigs() {
  const sql = `
    SELECT config_id, name, cron_expression, job_type, payload, priority
    FROM scheduler_configs
    WHERE is_active = TRUE
  `;
  const result = await query(sql);
  return result.rows;
}

/**
 * Archives closed exceptions and completed background jobs older than retention limit,
 * and pre-creates audit partitions.
 */
export async function archiveOldJobsAndExceptions(client, retentionDays = 30) {
  // 1. Archive closed exceptions
  const exArchiveSql = `
    INSERT INTO archived_reconciliation_exceptions (
      exception_id, run_id, ledger_txn_id, ext_line_id, exception_type, amount_diff, status,
      resolution_note, resolved_by, resolved_at, assigned_to, assigned_at, in_progress_at,
      approved_at, approved_by, closed_at, closed_by, sla_deadline, created_at
    )
    SELECT
      exception_id, run_id, ledger_txn_id, ext_line_id, exception_type, amount_diff, status,
      resolution_note, resolved_by, resolved_at, assigned_to, assigned_at, in_progress_at,
      approved_at, approved_by, closed_at, closed_by, sla_deadline, created_at
    FROM reconciliation_exceptions
    WHERE status = 'CLOSED' AND closed_at < now() - ($1 || ' days')::INTERVAL
    ON CONFLICT (exception_id) DO NOTHING
  `;
  await client.query(exArchiveSql, [retentionDays]);

  const exDeleteSql = `
    DELETE FROM reconciliation_exceptions
    WHERE status = 'CLOSED' AND closed_at < now() - ($1 || ' days')::INTERVAL
  `;
  const deletedExceptions = await client.query(exDeleteSql, [retentionDays]);

  // 2. Archive completed background jobs
  const jobsArchiveSql = `
    INSERT INTO archived_background_jobs (
      job_id, job_type, status, payload, priority, attempts, max_attempts,
      started_at, completed_at, error_message, created_at
    )
    SELECT
      job_id, job_type, status, payload, priority, attempts, max_attempts,
      started_at, completed_at, error_message, created_at
    FROM background_jobs
    WHERE status = 'COMPLETED' AND completed_at < now() - ($1 || ' days')::INTERVAL
    ON CONFLICT (job_id) DO NOTHING
  `;
  await client.query(jobsArchiveSql, [retentionDays]);

  const jobsDeleteSql = `
    DELETE FROM background_jobs
    WHERE status = 'COMPLETED' AND completed_at < now() - ($1 || ' days')::INTERVAL
  `;
  const deletedJobs = await client.query(jobsDeleteSql, [retentionDays]);

  // 3. Pre-create audit log partitions for next month
  await client.query("SELECT fn_precreate_audit_partitions()");

  return {
    archivedExceptions: deletedExceptions.rowCount,
    archivedJobs: deletedJobs.rowCount,
  };
}
