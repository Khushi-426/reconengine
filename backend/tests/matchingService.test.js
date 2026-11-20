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

  it("rejects rerunning the same completed batch/date combination", async () => {
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-RERUN-1', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-RERUN-1', $1, 100.00, 'GBP', '2026-07-18', FALSE)`,
      [accountRef]
    );

    await runReconciliation({
      runDate: "2026-07-18",
      triggeredBy: userId,
    });

    await expect(
      runReconciliation({
        runDate: "2026-07-18",
        triggeredBy: userId,
      })
    ).rejects.toMatchObject({ code: "RECONCILIATION_ALREADY_EXISTS", statusCode: 409 });
  });

  // =========================================================================
  // NEW TESTS: pass overlap, precision, duplicate candidates, edge amounts
  // =========================================================================

  it("exact match pass does not consume the same ledger row twice across two runs", async () => {
    // Insert one ledger and one external line — they should match exactly once.
    // A second run on the same batch+date is rejected by assertNoCompletedRunForBatch.
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-ONCE-1', 'CREDIT', 50.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-ONCE-1', $1, 50.00, 'GBP', '2026-07-18', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });
    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);

    // Verify only one entry exists in match_group_ledger_lines for this ledger row
    const ledgerLine = await testPool.query(
      "SELECT COUNT(*) AS cnt FROM match_group_ledger_lines mgl JOIN match_groups mg ON mg.match_id = mgl.match_id WHERE mg.run_id = $1",
      [result.runId]
    );
    expect(parseInt(ledgerLine.rows[0].cnt, 10)).toBe(1);
  });

  it("duplicate external lines produce a unique exception per line, not one merged exception", async () => {
    // Two external lines with the same amount and account, one ledger line
    // — the unmatched external line should become its own MISSING_INTERNAL exception.
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-DUP-1', 'CREDIT', 75.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES
         ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-DUP-1', $1, 75.00, 'GBP', '2026-07-18', FALSE),
         ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-DUP-2', $1, 75.00, 'GBP', '2026-07-18', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });

    // 1 exact match + 1 unmatched external → 1 MISSING_INTERNAL exception
    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(1);

    const exceptions = await testPool.query(
      "SELECT exception_type FROM reconciliation_exceptions WHERE run_id = $1",
      [result.runId]
    );
    expect(exceptions.rows[0].exception_type).toBe("MISSING_INTERNAL");
  });

  it("unmatched ledger rows produce MISSING_EXTERNAL exceptions", async () => {
    // Insert only a ledger transaction; we still need a valid external batch,
    // so insert an external line on a DIFFERENT date so it doesn't match the run.
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-MISS-1', 'CREDIT', 200.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    // External line on a future date — different amount and date, ensures no match
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-MISS-X', $1, 999.00, 'GBP', '2026-08-01', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });

    expect(result.stats.matchedCount).toBe(0);
    // One MISSING_EXTERNAL for the unmatched ledger row on 2026-07-18
    expect(result.stats.exceptionCount).toBe(1);

    const ex = await testPool.query(
      "SELECT exception_type FROM reconciliation_exceptions WHERE run_id = $1",
      [result.runId]
    );
    expect(ex.rows[0].exception_type).toBe("MISSING_EXTERNAL");
  });

  it("batch-settlement pass: each ledger row is consumed at most once per run (no double-match)", async () => {
    // Three ledger rows sum to 60. One batched external line of 60.
    // After matching, all three ledger rows should appear in exactly one match group.
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-BS-NR-1', 'CREDIT', 10.00, 'GBP', '2026-07-18'),
              ($1, 'LDG-BS-NR-2', 'CREDIT', 20.00, 'GBP', '2026-07-18'),
              ($1, 'LDG-BS-NR-3', 'CREDIT', 30.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-BS-NR-1', $1, 60.00, 'GBP', '2026-07-18', TRUE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });
    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);

    // Verify each ledger ID appears exactly once across all match groups in this run
    const rows = await testPool.query(
      `SELECT mgl.ledger_txn_id, COUNT(*) AS appearances
       FROM match_group_ledger_lines mgl
       JOIN match_groups mg ON mg.match_id = mgl.match_id
       WHERE mg.run_id = $1
       GROUP BY mgl.ledger_txn_id
       HAVING COUNT(*) > 1`,
      [result.runId]
    );
    expect(rows.rowCount).toBe(0); // no ledger row appears more than once
  });

  it("currency mismatch: GBP ledger row does not match USD external line", async () => {
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-CCY-1', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-CCY-1', $1, 100.00, 'USD', '2026-07-18', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });

    // Neither should match — both become exceptions
    expect(result.stats.matchedCount).toBe(0);
    expect(result.stats.exceptionCount).toBe(2);
  });

  it("date boundary: ledger date exactly 2 days before external date — still exact matches", async () => {
    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-DATE-1', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    // External date is ledger date + 2 days — within the INTERVAL '2 days' window
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-DATE-1', $1, 100.00, 'GBP', '2026-07-20', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });
    expect(result.stats.matchedCount).toBe(1);
    expect(result.stats.exceptionCount).toBe(0);
  });

  it("date boundary: external date 4 days away from ledger — no match (outside both exact and tolerance windows)", async () => {
    // Delete any tolerance rules to test purely date-outside boundary
    await testPool.query("DELETE FROM match_rules");

    await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'LDG-DATE-2', 'CREDIT', 100.00, 'GBP', '2026-07-18')`,
      [accountId]
    );
    // External date is ledger date + 4 days — outside exact (2 days) and default tolerance
    await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ((SELECT MAX(batch_id) FROM import_batches), 2, 'EXT-DATE-2', $1, 100.00, 'GBP', '2026-07-22', FALSE)`,
      [accountRef]
    );

    const result = await runReconciliation({ runDate: "2026-07-18", triggeredBy: userId });
    expect(result.stats.matchedCount).toBe(0);
    // Unmatched ledger row on 2026-07-18 becomes MISSING_EXTERNAL exception
    expect(result.stats.exceptionCount).toBe(1);
  });
});
