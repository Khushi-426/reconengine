import { query } from "../config/db.js";

/**
 * Retrieves high-level operational KPIs for the executive operations dashboard.
 */
export async function getOperationsKpis() {
  // 1. Average Resolution Time (in hours)
  const resolutionTimeRes = await query(`
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, approved_at, closed_at) - created_at)) / 3600), 0) AS avg_hours
    FROM reconciliation_exceptions
    WHERE resolved_at IS NOT NULL OR approved_at IS NOT NULL OR closed_at IS NOT NULL
  `);

  // 2. SLA Compliance Rate (percentage resolved/closed within SLA deadline)
  const slaComplianceRes = await query(`
    SELECT 
      CASE WHEN COUNT(*) = 0 THEN 100.0 ELSE
        (COUNT(*) FILTER (WHERE COALESCE(resolved_at, approved_at, closed_at) <= sla_deadline OR (resolved_at IS NULL AND approved_at IS NULL AND closed_at IS NULL AND now() <= sla_deadline)) * 100.0) / COUNT(*)
      END AS compliance_pct
    FROM reconciliation_exceptions
  `);

  // 3. Auto Match Rate (percentage of ledger matching runs resolved automatically)
  const autoMatchRes = await query(`
    SELECT 
      CASE WHEN SUM(matched_count + exception_count) = 0 THEN 0.0 ELSE
        (SUM(matched_count)::NUMERIC * 100.0) / SUM(matched_count + exception_count)
      END AS match_rate
    FROM reconciliation_runs
  `);

  // 4. Ingestion Batch Success Rate
  const importSuccessRes = await query(`
    SELECT 
      CASE WHEN COUNT(*) = 0 THEN 100.0 ELSE
        (COUNT(*) FILTER (WHERE status = 'COMPLETED') * 100.0) / COUNT(*)
      END AS success_rate
    FROM import_batches
  `);

  // 5. Active exceptions size in queue
  const activeQueueRes = await query(`
    SELECT COUNT(*) AS active_count
    FROM reconciliation_exceptions
    WHERE status IN ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS')
  `);

  return {
    avgResolutionTimeHours: Math.round(Number(resolutionTimeRes.rows[0].avg_hours) * 10) / 10,
    slaComplianceRate: Math.round(Number(slaComplianceRes.rows[0].compliance_pct) * 10) / 10,
    autoMatchRate: Math.round(Number(autoMatchRes.rows[0].match_rate) * 10) / 10,
    importSuccessRate: Math.round(Number(importSuccessRes.rows[0].success_rate) * 10) / 10,
    activeQueueSize: parseInt(activeQueueRes.rows[0].active_count, 10),
  };
}

/**
 * Retrieves the distribution of breaks (exceptions) broken down by state and category.
 */
export async function getQueueStatus() {
  const statusBreakdown = await query(`
    SELECT status, COUNT(*) AS count
    FROM reconciliation_exceptions
    GROUP BY status
  `);

  const typeBreakdown = await query(`
    SELECT exception_type, COUNT(*) AS count
    FROM reconciliation_exceptions
    GROUP BY exception_type
  `);

  return {
    byStatus: statusBreakdown.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count, 10);
      return acc;
    }, {}),
    byType: typeBreakdown.rows.reduce((acc, row) => {
      acc[row.exception_type] = parseInt(row.count, 10);
      return acc;
    }, {}),
  };
}

/**
 * Monitors background job scheduler states, DLQs, and running node thread pools.
 */
export async function getWorkerStatus() {
  // Background Job counts
  const jobCounts = await query(`
    SELECT status, COUNT(*) AS count
    FROM background_jobs
    GROUP BY status
  `);

  // Active worker threads (with heartbeats within the last 30 seconds)
  const activeWorkers = await query(`
    SELECT COUNT(DISTINCT worker_id) AS count
    FROM (
      SELECT payload->>'workerId' AS worker_id
      FROM background_jobs
      WHERE status = 'RUNNING' AND last_heartbeat > now() - INTERVAL '30 seconds'
    ) w
  `);

  // Active schedulers
  const activeSchedulers = await query(`
    SELECT COUNT(*) AS count
    FROM scheduler_configs
    WHERE is_active = TRUE
  `);

  // DLQ count
  const dlqCount = await query(`
    SELECT COUNT(*) AS count FROM dead_letter_jobs
  `);

  return {
    jobsByStatus: jobCounts.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count, 10);
      return acc;
    }, {}),
    activeWorkerThreads: parseInt(activeWorkers.rows[0].count, 10),
    activeSchedulers: parseInt(activeSchedulers.rows[0].count, 10),
    deadLetterQueueSize: parseInt(dlqCount.rows[0].count, 10),
  };
}
