import pg from "pg";
import { config } from "./env.js";
import { logger } from "./logger.js";

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: 2000,
  maxUses: 7500,
  statement_timeout: config.db.statementTimeoutMillis, // guards against runaway queries
});

pool.on("error", (err) => {
  // unexpected errors on idle clients — log and let the pool recover
  logger.error({ err }, "Unexpected PG pool error");
});

/**
 * Simple query helper — use for single statements outside a transaction.
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 200) {
    logger.warn({ text, duration, rows: result.rowCount }, "Slow query");
  }
  return result;
}

/**
 * Transaction helper — guarantees BEGIN/COMMIT/ROLLBACK correctness.
 * Callback receives a `client` — all queries inside MUST use this client,
 * not the shared pool, or they will run outside the transaction.
 *
 * Also sets the Postgres session variable app.current_user_id so the
 * audit-log trigger (fn_audit_trigger) can attribute every change to a user,
 * and app.current_user_role for row-level security policies.
 */
export async function withTransaction(fn, { userId, userRole, isolationLevel } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isolationLevel) {
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    }
    if (userId) {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    }
    if (userRole) {
      await client.query("SELECT set_config('app.current_user_role', $1, true)", [userRole]);
    }

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
