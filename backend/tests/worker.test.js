import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { JobWorker } from "../src/jobs/worker.js";
import { testPool, cleanDb, createTestUser } from "./helper.js";
import { queueJob, getJobStatus } from "../src/services/jobsService.js";

describe("JobWorker background processor", () => {
  let userId;

  beforeAll(async () => {
    await cleanDb();
    userId = await createTestUser({
      email: "worker-test@reconengine.local",
      password: "password123",
      fullName: "Worker Tester",
      roleId: 1, // ADMIN
    });
  });

  afterAll(async () => {
    await testPool.end();
  });

  beforeEach(async () => {
    const tables = [
      "dead_letter_jobs",
      "background_jobs",
      "reconciliation_runs",
    ];
    await testPool.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  });

  it("1. prioritizes and claims jobs correctly (high priority first)", async () => {
    const worker = new JobWorker();
    
    // Queue low priority job (30)
    const lowJob = await queueJob({
      jobType: "REFRESH_DAILY_SUMMARY",
      payload: { id: "low" },
      priority: 30,
      userId,
      userRole: "ADMIN",
    });

    // Queue high priority job (10)
    const highJob = await queueJob({
      jobType: "REFRESH_DAILY_SUMMARY",
      payload: { id: "high" },
      priority: 10,
      userId,
      userRole: "ADMIN",
    });

    // Manually claim next job and verify the high priority one is returned
    const claimed = await testPool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const job = await import("../src/repositories/jobsRepository.js").then((repo) =>
          repo.claimNextJob(client, worker.workerId)
        );
        await client.query("COMMIT");
        return job;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });

    expect(claimed).not.toBeNull();
    expect(claimed.job_id).toBe(highJob.job_id);
    expect(claimed.priority).toBe(10);
  });

  it("2. executes successful jobs and updates heartbeat/status", async () => {
    // We use a small poll interval for fast test runs
    const worker = new JobWorker({
      pollIntervalMs: 50,
      heartbeatIntervalMs: 100,
      recoveryIntervalMs: 500,
    });

    const job = await queueJob({
      jobType: "REFRESH_DAILY_SUMMARY",
      payload: {},
      priority: 20,
      userId,
      userRole: "ADMIN",
    });

    worker.start();

    // Wait a brief moment for the worker to claim and complete the job
    await new Promise((resolve) => setTimeout(resolve, 300));
    await worker.stop();

    const status = await getJobStatus(job.job_id);
    expect(status.status).toBe("COMPLETED");
    expect(status.completed_at).not.toBeNull();
  });

  it("3. reschedules failed jobs using exponential backoff (RETRYING state)", async () => {
    const worker = new JobWorker({
      pollIntervalMs: 50,
    });

    // Enqueue an invalid job that throws an error (e.g. unknown job type)
    const job = await queueJob({
      jobType: "INVALID_JOB_TYPE",
      payload: {},
      priority: 20,
      userId,
      userRole: "ADMIN",
    });

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await worker.stop();

    const status = await getJobStatus(job.job_id);
    expect(status.status).toBe("RETRYING");
    expect(status.attempts).toBe(1);
    expect(status.error_message).toContain("Unsupported job type");
    expect(new Date(status.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("4. moves jobs to Dead Letter Queue (DLQ) after exceeding max attempts", async () => {
    const worker = new JobWorker({
      pollIntervalMs: 50,
    });

    // Pre-insert a job with attempts = 2, max_attempts = 2 (so the next run is the last)
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, run_at)
       VALUES ('INVALID_JOB_TYPE', 'PENDING', '{}'::JSONB, 20, 2, 2, now())
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await worker.stop();

    // The job should be deleted from background_jobs and moved to dead_letter_jobs
    const bgStatus = await testPool.query("SELECT * FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(bgStatus.rowCount).toBe(0);

    const dlqStatus = await testPool.query("SELECT * FROM dead_letter_jobs WHERE job_id = $1", [jobId]);
    expect(dlqStatus.rowCount).toBe(1);
    expect(dlqStatus.rows[0].last_error).toContain("Unsupported job type");
  });

  it("5. recovers orphaned jobs when heartbeat times out", async () => {
    const worker = new JobWorker({
      pollIntervalMs: 1000, // disable polling to test recovery loop isolation
      recoveryIntervalMs: 100,
    });

    // Manually insert an orphaned running job (heartbeat is 60s ago)
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 1, 3, now() - INTERVAL '60 seconds', 'stale-worker')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await worker.stop();

    const status = await getJobStatus(jobId);
    // Should be recovered and set to RETRYING
    expect(status.status).toBe("RETRYING");
    expect(status.worker_owner).toBeNull();
  });
});
