import { withTransaction } from "../config/db.js";
import { enqueueJob, findJobById, findActiveReconciliationJob } from "../repositories/jobsRepository.js";
import { assertNoCompletedRunForBatch } from "../repositories/matchingRepository.js";
import { AppError } from "../utils/AppError.js";

/**
 * Enqueues a job inside a transaction, applying the user's audit logging context if present.
 */
export async function queueJob({ jobType, payload, priority, maxAttempts, runAt, userId, userRole }) {
  return withTransaction(async (client) => {
    if (jobType === "RECONCILIATION_RUN") {
      const activeJob = await findActiveReconciliationJob(client, {
        runDate: payload.runDate,
        batchId: payload.batchId,
      });
      if (activeJob) {
        throw new AppError(
          409,
          `A reconciliation job is already queued for ${payload.runDate} and batch #${payload.batchId}.`,
          "RECONCILIATION_JOB_ALREADY_QUEUED"
        );
      }

      await assertNoCompletedRunForBatch(client, {
        runDate: payload.runDate,
        batchId: payload.batchId,
      });
    }

    return enqueueJob(client, { jobType, payload, priority, maxAttempts, runAt });
  }, { userId, userRole });
}

/**
 * Inspects a single job details (status, attempts, etc.).
 */
export async function getJobStatus(jobId) {
  return findJobById(jobId);
}
