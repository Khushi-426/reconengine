import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testPool, cleanDb, createTestUser, seedFixture } from "./helper.js";
import { JobWorker } from "../src/jobs/worker.js";
import { claimNextJob } from "../src/repositories/jobsRepository.js";
import { withTransaction } from "../src/config/db.js";

const app = createApp();

describe("ReconEngine integration flow", () => {
  let userId;
  let token;
  let accountId;

  beforeAll(async () => {
    await cleanDb();
    userId = await createTestUser({
      email: "approver@reconengine.local",
      password: "password123",
      fullName: "Test Approver",
      roleId: 2, // APPROVER
    });

    const fixtures = await seedFixture(userId);
    accountId = fixtures.accountId;
  });



  it("1. logs in successfully and returns JWT token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "approver@reconengine.local", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    token = res.body.accessToken;
  });

  it("2. rejects reconciliation before an external settlement batch is imported", async () => {
    const res = await request(app)
      .post("/api/recon/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ runDate: "2026-07-18" });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("No external settlement batch available for reconciliation.");
    expect(res.body.error.code).toBe("NO_EXTERNAL_SETTLEMENT_BATCH");
  });

  it("3. uploads a statement CSV file", async () => {
    const csvContent =
      "external_ref,account_ref,amount,currency,value_date,is_batched_settlement\n" +
      "EXT-INT-1,ACC-TEST,150.00,GBP,2026-07-18,false\n";

    const res = await request(app)
      .post("/api/imports/statements")
      .set("Authorization", `Bearer ${token}`)
      .field("sourceId", "2")
      .attach("file", Buffer.from(csvContent), "statement.csv");

    expect(res.status).toBe(201);
    expect(res.body.rowsImported).toBe(1);
  });

  it("4. triggers a reconciliation run (async job) and runs it with worker", async () => {
    // Add an unmatched ledger line to produce an exception
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-INT-1', 'CREDIT', 200.00, 'GBP', '2026-07-18')`,
      [accountId]
    );

    const res = await request(app)
      .post("/api/recon/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ runDate: "2026-07-18" });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("jobId");

    // Execute the job synchronously in-process
    const worker = new JobWorker();
    const claimed = await withTransaction(async (client) => {
      return claimNextJob(client, worker.workerId);
    });

    expect(claimed).not.toBeNull();
    await worker.executeJob(claimed);
  });

  it("5. processes exception through assignment, start work, resolve, approve, and close workflow", async () => {
    // 1. List exceptions in UNASSIGNED state
    const listRes = await request(app)
      .get("/api/exceptions?status=UNASSIGNED")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);

    const exception = listRes.body.data[0];
    const exceptionId = exception.exception_id;
    let version = exception.version;

    // 2. Assign exception to user
    const assignRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignTo: userId });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe("ASSIGNED");

    // 3. Start work on the exception
    const startRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/start-work`)
      .set("Authorization", `Bearer ${token}`);

    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe("IN_PROGRESS");
    version = startRes.body.version;

    // 4. Resolve the exception
    const resolveRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version,
        resolutionNote: "Matched manually after audit confirmation",
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe("RESOLVED");
    version = resolveRes.body.version;

    // 5. Stale resolution attempt fails with 409 conflict
    const staleRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version - 1, // stale
        resolutionNote: "Another concurrent resolve attempt",
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe("OPTIMISTIC_LOCK_CONFLICT");

    // 6. Approve the resolution
    const approveRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version,
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
    version = approveRes.body.version;

    // 7. Close the exception
    const closeRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version,
      });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");
  });
});
