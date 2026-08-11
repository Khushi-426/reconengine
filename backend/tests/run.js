import { execSync } from "child_process";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { applyMigrations } from "../src/scripts/migrationRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitAndMigrate() {
  const dbConfig = {
    host: "127.0.0.1",
    port: 5433,
    user: "postgres",
    password: "change_me_in_env",
    database: "reconengine_test",
  };

  let connected = false;
  let retries = 120; // Allow up to 60 seconds for initialization

  console.log("Waiting for test database to accept connections...");
  while (!connected && retries > 0) {
    const tempClient = new pg.Client(dbConfig);
    try {
      await tempClient.connect();
      connected = true;
      await tempClient.end();
    } catch (err) {
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!connected) {
    throw new Error("Could not connect to test database.");
  }

  const client = new pg.Client(dbConfig);
  await client.connect();

  console.log("Connected. Applying migrations...");
  await applyMigrations(client, { databaseNameOverride: "reconengine_test" });

  await client.end();
  console.log("Migrations applied successfully!");
}

async function run() {
  const composePath = path.join(__dirname, "../../docker-compose.test.yml");
  let startedContainer = false;

  try {
    // 1. Spin up postgres test container
    console.log("Starting Postgres test container...");
    try {
      execSync(`docker compose -f "${composePath}" up -d`, { stdio: "inherit" });
    } catch (e) {
      execSync(`docker-compose -f "${composePath}" up -d`, { stdio: "inherit" });
    }
    startedContainer = true;

    // 2. Wait for db and migrate
    await waitAndMigrate();

    // 3. Run tests using vitest
    console.log("Running test suite...");
    execSync("npx vitest run --no-file-parallelism --sequence.concurrent=false", {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DB_HOST: "127.0.0.1",
        DB_PORT: "5433",
        DB_NAME: "reconengine_test",
        DB_USER: "reconengine_app",
        DB_PASSWORD: "change_me_in_env",
        JWT_ACCESS_SECRET: "test-access-secret-for-jwt-token-very-long",
        JWT_REFRESH_SECRET: "test-refresh-secret-for-jwt-token-very-long",
      },
    });

    console.log("Tests completed successfully!");
  } catch (error) {
    console.error("Test execution failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (startedContainer) {
      console.log("Tearing down Postgres test container...");
      try {
        execSync(`docker compose -f "${composePath}" down -v`, { stdio: "inherit" });
      } catch (e) {
        execSync(`docker-compose -f "${composePath}" down -v`, { stdio: "inherit" });
      }
    }
  }
}

run();
