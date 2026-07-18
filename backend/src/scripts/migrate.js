import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sqlFiles = [
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

async function run() {
  const client = new pg.Client({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: "postgres",
    password: process.env.DB_PASSWORD || "change_me_in_env",
    database: process.env.DB_NAME || "reconengine",
  });

  try {
    await client.connect();
    console.log("Connected to dev database. Applying migrations...");

    for (const file of sqlFiles) {
      const filePath = path.resolve(__dirname, file);
      console.log(`Applying ${path.basename(filePath)}...`);
      const sqlContent = fs.readFileSync(filePath, "utf8");
      await client.query(sqlContent);
    }

    console.log("All migrations applied successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
