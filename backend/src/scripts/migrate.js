import pg from "pg";
import dotenv from "dotenv";
import { applyMigrations } from "./migrationRunner.js";

dotenv.config();

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
    await applyMigrations(client);

    console.log("All migrations applied successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
