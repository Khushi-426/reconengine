import { describe, it, expect } from "vitest";
import pg from "pg";
import { applyMigrations, migrationFiles } from "../src/scripts/migrationRunner.js";

const dbConfig = {
  host: "127.0.0.1",
  port: 5433,
  user: "postgres",
  password: "change_me_in_env",
  database: "reconengine_test",
};

describe("migration runner", () => {
  it("replays deterministically without duplicating migration records", async () => {
    const client = new pg.Client(dbConfig);
    await client.connect();

    try {
      await applyMigrations(client, { databaseNameOverride: "reconengine_test" });
      await applyMigrations(client, { databaseNameOverride: "reconengine_test" });

      const result = await client.query("SELECT COUNT(*)::INT AS count FROM schema_migrations");
      expect(result.rows[0].count).toBe(migrationFiles.length);
    } finally {
      await client.end();
    }
  });
});
