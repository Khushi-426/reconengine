import { withTransaction } from "../config/db.js";
import { getInvestigation } from "./investigation/orchestrator.js";
import { AppError } from "../utils/AppError.js";

export async function enqueueInvestigation({ exceptionId, userId, userRole }) {
  try {
    return await withTransaction(async (client) => {
      const exception = await client.query(`SELECT exception_id,assigned_to FROM reconciliation_exceptions WHERE exception_id=$1`, [exceptionId]);
      if (!exception.rowCount) throw new AppError(404, "Exception not found", "EXCEPTION_NOT_FOUND");
      if (userRole === "ANALYST" && exception.rows[0].assigned_to && exception.rows[0].assigned_to !== userId) throw new AppError(403, "You do not have permission to investigate this exception", "FORBIDDEN");
      const inserted = await client.query(`INSERT INTO investigations(exception_id,requested_by,status)
        VALUES ($1,$2,'QUEUED') ON CONFLICT (exception_id) WHERE status IN ('QUEUED','RUNNING') DO NOTHING
        RETURNING investigation_id`, [exceptionId, userId]);
      if (!inserted.rowCount) {
        const active = await client.query(`SELECT investigation_id,job_id,status FROM investigations WHERE exception_id=$1 AND status IN ('QUEUED','RUNNING')`, [exceptionId]);
        return { ...active.rows[0], investigationId: String(active.rows[0].investigation_id), jobId: String(active.rows[0].job_id), reused: true };
      }
      const investigationId = inserted.rows[0].investigation_id;
      const job = await client.query(`INSERT INTO background_jobs(job_type,status,payload,priority,max_attempts)
        VALUES ('INVESTIGATION_RUN','PENDING',$1::jsonb,10,3) RETURNING job_id`, [JSON.stringify({ investigationId: String(investigationId), exceptionId: String(exceptionId), userId, userRole })]);
      await client.query(`UPDATE investigations SET job_id=$2 WHERE investigation_id=$1`, [investigationId, job.rows[0].job_id]);
      await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'INITIATED',$2::jsonb)`, [investigationId, JSON.stringify({ requestedBy: userId, jobId: String(job.rows[0].job_id) })]);
      return { investigationId: String(investigationId), exceptionId: String(exceptionId), jobId: String(job.rows[0].job_id), status: "QUEUED", reused: false };
    }, { userId, userRole });
  } catch (error) {
    if (error.code !== "23505") throw error;
    const active = await withTransaction(async (client) => client.query(`SELECT investigation_id,job_id,status FROM investigations WHERE exception_id=$1 AND status IN ('QUEUED','RUNNING')`, [exceptionId]), { userId, userRole });
    if (!active.rowCount) throw error;
    return { ...active.rows[0], investigationId: String(active.rows[0].investigation_id), jobId: String(active.rows[0].job_id), reused: true };
  }
}

export async function getInvestigationForUser({ investigationId, userId, userRole }) {
  const result = await getInvestigation(investigationId, { userId, userRole });
  if (!result) throw new AppError(404, "Investigation not found", "INVESTIGATION_NOT_FOUND");
  return result;
}

export async function recordInvestigationFeedback({ investigationId, userId, userRole, isUseful, comment }) {
  return withTransaction(async (client) => {
    const inv = await client.query(`SELECT investigation_id FROM investigations WHERE investigation_id=$1`, [investigationId]);
    if (!inv.rowCount) throw new AppError(404, "Investigation not found", "INVESTIGATION_NOT_FOUND");
    const result = await client.query(`INSERT INTO investigation_feedback(investigation_id,analyst_id,is_useful,comments)
      VALUES ($1,$2,$3,$4) RETURNING feedback_id,created_at`, [investigationId, userId, isUseful, comment?.trim() || null]);
    await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'ANALYST_FEEDBACK',$2::jsonb)`, [investigationId, JSON.stringify({ analystId: userId, isUseful })]);
    return result.rows[0];
  }, { userId, userRole });
}
