import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const migrationFiles = [
  "../../../db/01_schema.sql",
  "../../../db/02_triggers.sql",
  "../../../db/03_views.sql",
  "../../../db/04_matching_engine.sql",
  "../../../db/05_security_grants.sql",
  "../../../db/06_jobs.sql",
  "../../../db/07_exceptions_workflow.sql",
  "../../../db/08_notifications.sql",
  "../../../db/09_partitioning_and_tuning.sql",
  "../../../db/10_security_improvements.sql",
];

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version        VARCHAR(32) PRIMARY KEY,
      file_name      VARCHAR(255) NOT NULL,
      checksum       CHAR(64) NOT NULL,
      applied_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(client, { databaseNameOverride } = {}) {
  await client.query("SELECT pg_advisory_lock(94827421)");
  try {
    await ensureMigrationsTable(client);

    for (const file of migrationFiles) {
      const filePath = path.resolve(__dirname, file);
      const fileName = path.basename(filePath);
      const version = fileName.slice(0, 2);

      let sqlContent = fs.readFileSync(filePath, "utf8");
      if (databaseNameOverride) {
        sqlContent = sqlContent.replace(/DATABASE\s+reconengine\b/gi, `DATABASE ${databaseNameOverride}`);
      }
      const fileChecksum = checksum(sqlContent);

      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [version]
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== fileChecksum) {
          throw new Error(`Migration ${fileName} was already applied with a different checksum.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sqlContent);
        await client.query(
          `INSERT INTO schema_migrations (version, file_name, checksum)
           VALUES ($1, $2, $3)`,
          [version, fileName, fileChecksum]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Failed applying ${fileName}: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(94827421)");
  }
}
