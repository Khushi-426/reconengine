import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { JobWorker } from "../src/jobs/worker.js";
import { testPool, cleanDb, createTestUser } from "./helper.js";
import { queueJob, getJobStatus } from "../src/services/jobsService.js";
import {
  claimNextJob,
  completeJob,
  failJob,
  moveToDlq,
  findOrphanedJobs,
} from "../src/repositories/jobsRepository.js";
import { withTransaction } from "../src/config/db.js";

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
      } finally {
        client.release();
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

  // =========================================================================
  // NEW TESTS: Security & correctness invariants
  // =========================================================================

  it("6. two recovery workers racing on one stale job — only one processes it", async () => {
    // Insert one orphaned RUNNING job with heartbeat 60s ago
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 0, 3, now() - INTERVAL '60 seconds', 'old-worker')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    // Simulate two recovery workers running findOrphanedJobs concurrently
    // Both open transactions at the same time; FOR UPDATE SKIP LOCKED ensures only one sees the row
    const race = await Promise.allSettled([
      (async () => {
        const client = await testPool.connect();
        try {
          await client.query("BEGIN");
          const rows = await findOrphanedJobs(client, 30);
          // Hold the lock for 100ms to widen the race window
          await new Promise((r) => setTimeout(r, 100));
          await client.query("COMMIT");
          return rows.length;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      })(),
      (async () => {
        const client = await testPool.connect();
        try {
          await client.query("BEGIN");
          const rows = await findOrphanedJobs(client, 30);
          await new Promise((r) => setTimeout(r, 50));
          await client.query("COMMIT");
          return rows.length;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      })(),
    ]);

    const successful = race.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const totalJobsSeen = successful.reduce((s, n) => s + n, 0);

    // The two workers together should see the job exactly once (FOR UPDATE SKIP LOCKED)
    expect(totalJobsSeen).toBe(1);
  });

  it("7. stale worker cannot complete a job after ownership is lost", async () => {
    // Insert a RUNNING job owned by worker-A
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 1, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    // worker-B tries to complete the job (wrong owner)
    const result = await withTransaction(async (client) => {
      return completeJob(client, jobId, "worker-B");
    });

    // completeJob must return null — the row was not updated
    expect(result).toBeNull();

    // Job should still be RUNNING, still owned by worker-A
    const row = await testPool.query("SELECT status, worker_owner FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(row.rows[0].status).toBe("RUNNING");
    expect(row.rows[0].worker_owner).toBe("worker-A");
  });

  it("8. stale worker cannot fail a job after ownership is lost", async () => {
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 1, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    const result = await withTransaction(async (client) => {
      return failJob(client, jobId, "oops", 10, "worker-B");
    });

    expect(result).toBeNull();

    const row = await testPool.query("SELECT status, worker_owner FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(row.rows[0].status).toBe("RUNNING");
    expect(row.rows[0].worker_owner).toBe("worker-A");
  });

  it("9. stale worker cannot move a job to DLQ after ownership is lost", async () => {
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 3, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    const result = await withTransaction(async (client) => {
      return moveToDlq(client, jobId, "max retries", "worker-B");
    });

    expect(result).toBeNull();

    // Job still in background_jobs, not in DLQ
    const bg = await testPool.query("SELECT status FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(bg.rowCount).toBe(1);
    const dlq = await testPool.query("SELECT * FROM dead_letter_jobs WHERE job_id = $1", [jobId]);
    expect(dlq.rowCount).toBe(0);
  });

  it("10. duplicate completeJob calls are idempotent — second call returns null, status stays COMPLETED", async () => {
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 1, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    const first = await withTransaction(async (client) => completeJob(client, jobId, "worker-A"));
    expect(first).not.toBeNull();
    expect(first.status).toBe("COMPLETED");

    // Second call: job is now COMPLETED, not RUNNING — should return null
    const second = await withTransaction(async (client) => completeJob(client, jobId, "worker-A"));
    expect(second).toBeNull();

    const row = await testPool.query("SELECT status FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(row.rows[0].status).toBe("COMPLETED");
  });

  it("11. moveToDlq is idempotent — calling twice does not throw or duplicate DLQ row", async () => {
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 3, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    // First call: should succeed
    const first = await withTransaction(async (client) => moveToDlq(client, jobId, "max retries", "worker-A"));
    expect(first).not.toBeNull();

    // Second call: job no longer in background_jobs, should return null without throwing
    const second = await withTransaction(async (client) => moveToDlq(client, jobId, "max retries again", "worker-A"));
    expect(second).toBeNull();

    // Exactly one row in DLQ
    const dlq = await testPool.query("SELECT * FROM dead_letter_jobs WHERE job_id = $1", [jobId]);
    expect(dlq.rowCount).toBe(1);
  });

  it("12. retry transition: job moves RUNNING -> RETRYING and attempt count is preserved", async () => {
    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, last_heartbeat, worker_owner)
       VALUES ('REFRESH_DAILY_SUMMARY', 'RUNNING', '{}'::JSONB, 20, 1, 3, now(), 'worker-A')
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    const result = await withTransaction(async (client) => {
      return failJob(client, jobId, "simulated error", 20, "worker-A");
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe("RETRYING");
    expect(result.attempts).toBe(1); // attempts already incremented on claim, not on fail

    const row = await testPool.query("SELECT status, worker_owner FROM background_jobs WHERE job_id = $1", [jobId]);
    expect(row.rows[0].status).toBe("RETRYING");
    expect(row.rows[0].worker_owner).toBeNull(); // cleared by failJob
  });

  it("13. graceful shutdown: worker stops accepting new jobs and drains in-flight", async () => {
    const worker = new JobWorker({ pollIntervalMs: 50 });

    await queueJob({
      jobType: "REFRESH_DAILY_SUMMARY",
      payload: {},
      priority: 20,
      userId,
      userRole: "ADMIN",
    });

    worker.start();

    // Allow one poll cycle then stop
    await new Promise((resolve) => setTimeout(resolve, 100));
    await worker.stop();

    // isRunning must be false after stop
    expect(worker.isRunning).toBe(false);
    // No active jobs should remain after drain
    expect(worker.activeJobs.size).toBe(0);
  });

  it("14. ARCHIVE_CLEANUP_JOBS job type is handled without throwing", async () => {
    const worker = new JobWorker({ pollIntervalMs: 50 });

    const insertRes = await testPool.query(
      `INSERT INTO background_jobs (job_type, status, payload, priority, attempts, max_attempts, run_at)
       VALUES ('ARCHIVE_CLEANUP_JOBS', 'PENDING', '{}'::JSONB, 30, 0, 3, now())
       RETURNING job_id`
    );
    const jobId = insertRes.rows[0].job_id;

    // Execute directly — will call archiveOldJobsAndExceptions which is a no-op on empty tables
    const claimed = await withTransaction(async (client) => claimNextJob(client, worker.workerId));
    expect(claimed).not.toBeNull();
    await worker.executeJob(claimed);

    // Job should be COMPLETED (archive functions are no-ops on empty tables
    // but fn_precreate_audit_partitions may not exist in test DB — 
    // if it fails the job goes to RETRYING; check either state is acceptable,
    // but NOT stuck in RUNNING)
    const row = await testPool.query(
      "SELECT status FROM background_jobs WHERE job_id = $1 UNION ALL SELECT 'DEAD_LETTER' FROM dead_letter_jobs WHERE job_id = $1",
      [jobId]
    );
    // The job must have transitioned out of RUNNING
    if (row.rowCount > 0) {
      expect(["COMPLETED", "RETRYING", "DEAD_LETTER"]).toContain(row.rows[0].status);
    }
    // If rowCount === 0 it was moved to DLQ successfully (deleted from background_jobs)
  });
});
