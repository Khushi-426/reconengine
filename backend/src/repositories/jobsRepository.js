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
  try {
    const result = await db.query(sql, [jobType, JSON.stringify(payload), priority, maxAttempts, runAt]);
    return result.rows[0];
  } catch (err) {
    if (err.code === "23505" && err.constraint === "uq_recon_jobs_active") {
      throw new AppError(
        409,
        `A reconciliation job is already queued for ${payload.runDate} and batch #${payload.batchId}.`,
        "RECONCILIATION_JOB_ALREADY_QUEUED"
      );
    }
    throw err;
  }
}

export async function findActiveReconciliationJob(client, { runDate, batchId }) {
  const db = client || pool;
  const result = await db.query(
    `SELECT job_id, status
     FROM background_jobs
     WHERE job_type = 'RECONCILIATION_RUN'
       AND status IN ('PENDING', 'RUNNING', 'RETRYING')
       AND payload->>'runDate' = $1
       AND (payload->>'batchId')::BIGINT = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [runDate, batchId]
  );
  return result.rows[0] || null;
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
 * Guards on worker_owner AND status to prevent a stale worker from
 * refreshing a heartbeat it no longer owns.
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
 * Guards on worker_owner AND status = 'RUNNING' so a stale worker cannot
 * complete a job that has already been reclaimed by another worker or recovery.
 * Returns null if the row was not updated (ownership lost).
 */
export async function completeJob(client, jobId, workerOwner) {
  const sql = `
    UPDATE background_jobs
    SET status = 'COMPLETED', completed_at = now(), updated_at = now()
    WHERE job_id = $1
      AND status = 'RUNNING'
      AND worker_owner = $2
    RETURNING job_id, status
  `;
  const result = await client.query(sql, [jobId, workerOwner]);
  return result.rows[0] || null;
}

/**
 * Marks a job execution as failed, reschedules it with exponential backoff.
 *
 * When called by a live worker (workerOwner is provided), guards on
 * worker_owner AND status = 'RUNNING' so a stale worker cannot reschedule
 * a job it no longer owns.
 *
 * When called by the recovery path (workerOwner is null/undefined), only
 * guards on status = 'RUNNING' because the original owner is gone.
 *
 * Returns null if the row was not updated (ownership lost or wrong status).
 */
export async function failJob(client, jobId, errorMessage, nextRunDelaySeconds, workerOwner) {
  const runAt = new Date(Date.now() + nextRunDelaySeconds * 1000);

  let sql, params;
  if (workerOwner !== undefined && workerOwner !== null) {
    sql = `
      UPDATE background_jobs
      SET status = 'RETRYING', error_message = $1, run_at = $2, worker_owner = NULL, updated_at = now()
      WHERE job_id = $3
        AND status = 'RUNNING'
        AND worker_owner = $4
      RETURNING job_id, status, attempts, max_attempts
    `;
    params = [errorMessage, runAt, jobId, workerOwner];
  } else {
    // Recovery path: guard only on status
    sql = `
      UPDATE background_jobs
      SET status = 'RETRYING', error_message = $1, run_at = $2, worker_owner = NULL, updated_at = now()
      WHERE job_id = $3
        AND status = 'RUNNING'
      RETURNING job_id, status, attempts, max_attempts
    `;
    params = [errorMessage, runAt, jobId];
  }

  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Moves a job into the Dead Letter Queue atomically.
 *
 * Strategy: DELETE ... RETURNING from background_jobs (guards on status = 'RUNNING'
 * and optionally worker_owner), then INSERT INTO dead_letter_jobs ON CONFLICT DO NOTHING.
 * This guarantees atomicity within one transaction and idempotency against duplicate calls.
 *
 * Returns null if the job was not in the expected state (already moved or ownership lost).
 */
export async function moveToDlq(client, jobId, errorMessage, workerOwner) {
  let deleteSql, deleteParams;

  if (workerOwner !== undefined && workerOwner !== null) {
    deleteSql = `
      DELETE FROM background_jobs
      WHERE job_id = $1
        AND status = 'RUNNING'
        AND worker_owner = $2
      RETURNING job_id, job_type, payload, priority, attempts
    `;
    deleteParams = [jobId, workerOwner];
  } else {
    // Recovery path
    deleteSql = `
      DELETE FROM background_jobs
      WHERE job_id = $1
        AND status = 'RUNNING'
      RETURNING job_id, job_type, payload, priority, attempts
    `;
    deleteParams = [jobId];
  }

  const deleted = await client.query(deleteSql, deleteParams);
  if (deleted.rowCount === 0) {
    // Ownership already lost or job no longer in RUNNING — idempotent no-op
    return null;
  }

  const { job_type, payload, priority, attempts } = deleted.rows[0];

  // ON CONFLICT DO NOTHING makes this idempotent if somehow called twice
  const insertSql = `
    INSERT INTO dead_letter_jobs (job_id, job_type, payload, priority, attempts, last_error, failed_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (job_id) DO NOTHING
  `;
  await client.query(insertSql, [jobId, job_type, payload, priority, attempts, errorMessage]);

  return deleted.rows[0];
}

/**
 * Finds running jobs that have timed out (no heartbeat update for threshold).
 *
 * Uses FOR UPDATE SKIP LOCKED so two simultaneous recovery workers cannot
 * process the same orphaned job — identical to how claimNextJob prevents
 * double-claim on PENDING jobs.
 */
export async function findOrphanedJobs(client, timeoutSeconds) {
  const sql = `
    SELECT job_id, job_type, payload, attempts, max_attempts, priority, worker_owner
    FROM background_jobs
    WHERE status = 'RUNNING' AND last_heartbeat < now() - ($1 || ' seconds')::INTERVAL
    FOR UPDATE SKIP LOCKED
  `;
  const result = await client.query(sql, [timeoutSeconds]);
  return result.rows;
}

/**
 * Fetches details about a single job.
 */
export async function findJobById(jobId) {
  const sql = `
    SELECT job_id, job_type, status, priority, attempts, max_attempts, run_at, started_at, completed_at, last_heartbeat, error_message, created_at, worker_owner
    FROM background_jobs
    WHERE job_id = $1
    UNION ALL
    SELECT job_id, job_type, 'DEAD_LETTER' AS status, priority, attempts, attempts AS max_attempts, failed_at AS run_at, NULL AS started_at, failed_at AS completed_at, NULL AS last_heartbeat, last_error AS error_message, failed_at AS created_at, NULL AS worker_owner
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
