import crypto from "crypto";
import { withTransaction, query } from "../config/db.js";
import { logger } from "../config/logger.js";
import { runReconciliation } from "../services/matchingService.js";
import {
  claimNextJob,
  updateJobHeartbeat,
  completeJob,
  failJob,
  moveToDlq,
  findOrphanedJobs,
  archiveOldJobsAndExceptions,
} from "../repositories/jobsRepository.js";

export class JobWorker {
  constructor({ maxConcurrency = 3, pollIntervalMs = 2000, recoveryIntervalMs = 15000, heartbeatIntervalMs = 10000 } = {}) {
    this.workerId = `worker-${crypto.randomUUID()}`;
    this.maxConcurrency = maxConcurrency;
    this.pollIntervalMs = pollIntervalMs;
    this.recoveryIntervalMs = recoveryIntervalMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;

    this.activeJobs = new Map();
    this.isRunning = false;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.recoveryTimer = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, "Starting background job worker");

    this.poll();
    this.startHeartbeatLoop();
    this.startRecoveryLoop();
  }

  async stop() {
    this.isRunning = false;
    logger.info({ workerId: this.workerId }, "Stopping background job worker, waiting for active jobs to drain...");

    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);

    // Wait for in-flight jobs to complete
    let retries = 30;
    while (this.activeJobs.size > 0 && retries > 0) {
      logger.info({ activeJobs: this.activeJobs.size }, "Waiting for jobs to drain...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries--;
    }

    logger.info("Worker stopped cleanly.");
  }

  async poll() {
    if (!this.isRunning) return;

    if (this.activeJobs.size >= this.maxConcurrency) {
      // Queue is full, check back later
      this.pollTimer = setTimeout(() => this.poll(), 500);
      return;
    }

    try {
      const job = await withTransaction(async (client) => {
        return claimNextJob(client, this.workerId);
      });

      if (job) {
        this.executeJob(job).catch((err) => {
          logger.error({ err, jobId: job.job_id }, "Unhandled exception in job execution wrapper");
        });
        // Immediately check if we have more capacity
        setImmediate(() => this.poll());
      } else {
        this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
      }
    } catch (err) {
      logger.error({ err }, "Error polling for next background job");
      this.pollTimer = setTimeout(() => this.poll(), 5000); // back off on DB errors
    }
  }

  async executeJob(job) {
    const jobId = job.job_id;
    this.activeJobs.set(jobId, job);
    logger.info({ jobId, type: job.job_type }, "Executing background job");

    try {
      if (job.job_type === "RECONCILIATION_RUN") {
        const { runDate, triggeredBy } = job.payload;
        if (!runDate) throw new Error("Reconciliation runDate is required in job payload");
        await runReconciliation({ runDate, triggeredBy });
      } else if (job.job_type === "REFRESH_DAILY_SUMMARY") {
        logger.info("Refreshing daily reconciliation summary materialized view...");
        await query("SELECT fn_refresh_daily_summary()");
      } else if (job.job_type === "ARCHIVE_CLEANUP_JOBS") {
        logger.info("Archiving closed exceptions and completed jobs...");
        await withTransaction(async (client) => {
          const result = await archiveOldJobsAndExceptions(client, 30);
          logger.info(result, "Archiving and partition pre-creation completed");
        });
      } else {
        throw new Error(`Unsupported job type: ${job.job_type}`);
      }

      // Mark completed
      await withTransaction(async (client) => {
        await completeJob(client, jobId);
      });
      logger.info({ jobId }, "Job completed successfully");
    } catch (err) {
      logger.error({ err, jobId }, "Background job failed execution");
      const attempts = job.attempts;
      const maxAttempts = job.max_attempts;

      try {
        if (attempts < maxAttempts) {
          // Exponential backoff
          const delaySeconds = Math.pow(2, attempts) * 10;
          await withTransaction(async (client) => {
            await failJob(client, jobId, err.message, delaySeconds);
          });
          logger.info({ jobId, retryInSeconds: delaySeconds }, "Job failed, rescheduled for retry");
        } else {
          // Move to DLQ
          await withTransaction(async (client) => {
            await moveToDlq(client, jobId, err.message);
          });
          logger.warn({ jobId }, "Job exceeded max attempts, moved to Dead Letter Queue (DLQ)");
        }
      } catch (dbErr) {
        logger.error({ dbErr, jobId }, "Error recording job failure status");
      }
    } finally {
      this.activeJobs.delete(jobId);
      // Check for next job immediately
      setImmediate(() => this.poll());
    }
  }

  startHeartbeatLoop() {
    this.heartbeatTimer = setInterval(async () => {
      if (this.activeJobs.size === 0) return;
      try {
        await withTransaction(async (client) => {
          for (const jobId of this.activeJobs.keys()) {
            await updateJobHeartbeat(client, jobId, this.workerId);
          }
        });
      } catch (err) {
        logger.error({ err }, "Failed to update job heartbeats");
      }
    }, this.heartbeatIntervalMs);
  }

  startRecoveryLoop() {
    this.recoveryTimer = setInterval(async () => {
      try {
        await withTransaction(async (client) => {
          // Find running jobs with no heartbeat for 30s
          const orphaned = await findOrphanedJobs(client, 30);
          for (const job of orphaned) {
            logger.warn({ jobId: job.job_id, worker: job.worker_owner }, "Orphaned job found, resetting/DLQing...");
            if (job.attempts < job.max_attempts) {
              const delaySeconds = Math.pow(2, job.attempts) * 10;
              await failJob(client, job.job_id, "Worker heartbeat timed out", delaySeconds);
            } else {
              await moveToDlq(client, job.job_id, "Worker heartbeat timed out (Max retries exceeded)");
            }
          }
        });
      } catch (err) {
        logger.error({ err }, "Failed during worker recovery supervisor check");
      }
    }, this.recoveryIntervalMs);
  }
}
