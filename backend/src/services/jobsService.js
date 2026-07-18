import { withTransaction } from "../config/db.js";
import { enqueueJob, findJobById } from "../repositories/jobsRepository.js";

/**
 * Enqueues a job inside a transaction, applying the user's audit logging context if present.
 */
export async function queueJob({ jobType, payload, priority, maxAttempts, runAt, userId, userRole }) {
  return withTransaction(
    (client) => enqueueJob(client, { jobType, payload, priority, maxAttempts, runAt }),
    { userId, userRole }
  );
}

/**
 * Inspects a single job details (status, attempts, etc.).
 */
export async function getJobStatus(jobId) {
  return findJobById(jobId);
}
