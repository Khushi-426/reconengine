import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testPool, cleanDb, createTestUser, seedFixture } from "./helper.js";

const app = createApp();

describe("ReconEngine integration flow", () => {
  let userId;
  let token;
  let accountId;
  let accountRef = "ACC-TEST";

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

  afterAll(async () => {
    await testPool.end();
  });

  it("1. logs in successfully and returns JWT token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "approver@reconengine.local", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    token = res.body.accessToken;
  });

  it("2. uploads a statement CSV file", async () => {
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

  it("3. triggers a reconciliation run", async () => {
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

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("runId");
  });

  it("4. lists reconciliation exceptions and handles resolution with optimistic locking", async () => {
    // List exceptions
    const listRes = await request(app)
      .get("/api/exceptions?status=OPEN")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);

    const exception = listRes.body.data[0];
    const exceptionId = exception.exception_id;
    const version = exception.version;

    // First resolve succeeds
    const resolveRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version,
        resolutionNote: "Matched manually after audit confirmation",
        decision: "RESOLVED",
      });

    expect(resolveRes.status).toBe(200);

    // Stale resolve fails with 409 conflict
    const staleRes = await request(app)
      .patch(`/api/exceptions/${exceptionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        expectedVersion: version, // using the stale version
        resolutionNote: "Another concurrent resolve attempt",
        decision: "RESOLVED",
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe("OPTIMISTIC_LOCK_CONFLICT");
  });
});
