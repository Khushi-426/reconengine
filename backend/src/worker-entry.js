import "dotenv/config";
import { JobWorker } from "./jobs/worker.js";
import { JobScheduler } from "./jobs/scheduler.js";
import { pool } from "./config/db.js";
import { logger } from "./config/logger.js";

const worker = new JobWorker();
const scheduler = new JobScheduler();

async function start() {
  logger.info("Initializing worker process components...");
  worker.start();
  await scheduler.start();
}

async function shutdown(signal) {
  logger.info({ signal }, "Graceful shutdown signal received");

  try {
    scheduler.stop();
    await worker.stop();
    await pool.end();
    logger.info("Worker process terminated cleanly.");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection in worker process");
});

start().catch((err) => {
  logger.fatal({ err }, "Failed to start worker process");
  process.exit(1);
});
