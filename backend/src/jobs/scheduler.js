import cron from "node-cron";
import { findActiveSchedulerConfigs } from "../repositories/jobsRepository.js";
import { queueJob } from "../services/jobsService.js";
import { getAvailableExternalSettlementBatch } from "../services/matchingService.js";
import { logger } from "../config/logger.js";

export class JobScheduler {
  constructor() {
    this.scheduledTasks = [];
  }

  async start() {
    logger.info("Starting cron job scheduler...");
    try {
      const configs = await findActiveSchedulerConfigs();
      logger.info({ count: configs.length }, "Loaded active scheduler configurations");

      for (const config of configs) {
        const { name, cron_expression, job_type, payload, priority } = config;

        logger.info({ name, cron: cron_expression, type: job_type }, "Scheduling task");

        const task = cron.schedule(cron_expression, async () => {
          logger.info({ schedulerName: name, jobType: job_type }, "Cron trigger fired");
          try {
            let resolvedPayload = { ...payload };
            if (job_type === "RECONCILIATION_RUN") {
              if (!resolvedPayload.runDate || resolvedPayload.runDate === "$TODAY") {
                resolvedPayload.runDate = new Date().toISOString().slice(0, 10);
              }
              try {
                const batch = await getAvailableExternalSettlementBatch();
                resolvedPayload.batchId = batch.batch_id;
              } catch (err) {
                if (err.code === "NO_EXTERNAL_SETTLEMENT_BATCH") {
                  logger.info({ schedulerName: name }, "Skipping scheduled reconciliation: no external settlement batch is available");
                  return;
                }
                throw err;
              }
            }

            const queued = await queueJob({
              jobType: job_type,
              payload: resolvedPayload,
              priority,
            });
            logger.info({ jobId: queued.job_id, type: job_type }, "Enqueued scheduled job successfully");
          } catch (err) {
            logger.error({ err, name }, "Failed to enqueue scheduled job");
          }
        });

        this.scheduledTasks.push({ name, task });
      }
    } catch (err) {
      logger.error({ err }, "Failed to initialize scheduler tasks");
    }
  }

  stop() {
    logger.info("Stopping cron job scheduler...");
    for (const { name, task } of this.scheduledTasks) {
      logger.info({ name }, "Stopping scheduled task");
      task.stop();
    }
    this.scheduledTasks = [];
  }
}
