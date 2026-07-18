import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { runReconciliation } from "../src/services/matchingService.js";
import { testPool, cleanDb, createTestUser, seedFixture } from "./helper.js";

describe("matchingService integration", () => {
  let userId;
  let accountId;
  let accountRef = "ACC-TEST";

  beforeAll(async () => {
    // Clean DB and seed static role/user data
    await cleanDb();
    userId = await createTestUser({
      email: "matching-test@reconengine.local",
      password: "password123",
      fullName: "Matching Tester",
      roleId: 1, // ADMIN
    });
  });

  afterAll(async () => {
    await testPool.end();
  });

  beforeEach(async () => {
    // Truncate tables except users and roles
    const tables = [
      "report_snapshots",
      "daily_close_signoffs",
      "sla_definitions",
      "audit_log",
      "reconciliation_exceptions",
      "match_group_external_lines",
      "match_group_ledger_lines",
      "match_groups",
      "reconciliation_runs",
      "external_statement_lines",
      "import_batches",
      "ledger_transactions",
      "accounts",
      "clients",
      "branches",
    ];
    await testPool.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

    // Reseed accounts/batches
    const fixtures = await seedFixture(userId);
    accountId = fixtures.accountId;
  });

  it("performs exact matches correctly (1:1 same ref, amount, currency, and date within 2 days)", async () => {
    // Seed one matching pair
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-EX-1', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-EX-1', $1, 100.00, 'GBP', '2026-07-18', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({
      runDate: "2026-07-18",
      triggeredBy: userId,
    });

    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);

    const matches = await testPool.query("SELECT * FROM match_groups WHERE run_id = $1", [result.runId]);
    expect(matches.rowCount).toBe(1);
  });

  it("performs tolerance matches correctly (FX rounding, fee deltas, within rules limits)", async () => {
    // Insert a tolerance rule (amount_tolerance = 1%, date_window_days = 3)
    await testPool.query(
      `INSERT INTO match_rules (rule_name, rule_type, amount_tolerance, date_window_days, priority)
       VALUES ('FX rounding 1%', 'TOLERANCE', 0.01, 3, 20)
       ON CONFLICT DO NOTHING`
    );

    // Ledger = 100.00, External = 100.50 (diff is 0.50 which is <= 1.00 (1% of 100))
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-TOL-1', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-TOL-1', $1, 100.50, 'GBP', '2026-07-18', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({
      runDate: "2026-07-18",
      triggeredBy: userId,
    });

    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);
  });

  it("performs batch-settlement matcher (many ledger -> 1 external batch line)", async () => {
    // Ledger: 10.00, 20.00, 30.00 (total = 60.00)
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-BS-1', 'CREDIT', 10.00, 'GBP', '2026-07-18'),
              ($1, 'LDG-BS-2', 'CREDIT', 20.00, 'GBP', '2026-07-18'),
              ($1, 'LDG-BS-3', 'CREDIT', 30.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    // External: 60.00 is_batched_settlement = true
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-BS-1', $1, 60.00, 'GBP', '2026-07-18', TRUE)`,
      [accountRef]
    );

    const result = await runReconciliation({
      runDate: "2026-07-18",
      triggeredBy: userId,
    });

    // stats.matchedCount is incremented by 1 for each batch match group
    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);

    const matches = await testPool.query("SELECT * FROM match_groups WHERE run_id = $1", [result.runId]);
    expect(matches.rowCount).toBe(1);

    const matchId = matches.rows[0].match_id;
    const ledgerLines = await testPool.query("SELECT * FROM match_group_ledger_lines WHERE match_id = $1", [matchId]);
    expect(ledgerLines.rowCount).toBe(3); // 3 ledger lines linked!
  });
});
