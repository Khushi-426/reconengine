import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./config/logger.js";
import { pool } from "./config/db.js";

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`ReconEngine API listening on port ${config.port} [${config.env}]`);
});

// Graceful shutdown — stop accepting new connections, let in-flight requests
// finish, then close the DB pool cleanly. Important in production so a
// deploy/restart never kills a request mid-transaction.
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    logger.info("Shutdown complete");
    process.exit(0);
  });
  // force-exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
