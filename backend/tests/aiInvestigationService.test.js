import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { testPool, cleanDb, createTestUser, seedFixture } from "./helper.js";
import {
  investigateException,
  recordInvestigationFeedback,
} from "../src/services/aiInvestigationService.js";
import {
  computeDeterministicHints,
} from "../src/services/aiEvidenceService.js";
import {
  sanitizeAndValidateModelOutput,
  buildInvestigationPrompt,
} from "../src/services/aiPromptService.js";

describe("AI Investigation Assistant Backend Unit & Security Suite", () => {
  let adminId;
  let analystId;
  let otherAnalystId;
  let accountId;
  let externalBatchId;

  beforeAll(async () => {
    await cleanDb();
    adminId = await createTestUser({
      email: "ai-admin@reconengine.local",
      password: "password123",
      fullName: "AI Admin",
      roleId: 1, // ADMIN
    });
    analystId = await createTestUser({
      email: "ai-analyst@reconengine.local",
      password: "password123",
      fullName: "AI Assigned Analyst",
      roleId: 3, // ANALYST
    });
    otherAnalystId = await createTestUser({
      email: "ai-other@reconengine.local",
      password: "password123",
      fullName: "AI Other Analyst",
      roleId: 3, // ANALYST
    });

    const fixtures = await seedFixture(adminId);
    accountId = fixtures.accountId;
    externalBatchId = fixtures.externalBatchId;
  });

  beforeEach(async () => {
    const tables = [
      "ai_investigation_feedback",
      "ai_investigations",
      "reconciliation_exceptions",
      "reconciliation_runs",
      "external_statement_lines",
      "ledger_transactions",
    ];
    await testPool.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  });

  it("1. builds grounded evidence and computes authoritative deterministic hints for AMOUNT_MISMATCH", async () => {
    // 1. Create run
    const runRes = await testPool.query(
      `INSERT INTO reconciliation_runs (run_date, source_batch_id, status)
       VALUES ('2026-07-20', $1, 'COMPLETED') RETURNING run_id`,
      [externalBatchId]
    );
    const runId = runRes.rows[0].run_id;

    // 2. Insert ledger & statement line
    const ldgRes = await testPool.query(
      `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date)
       VALUES ($1, 'TXN-DISC-1', 'CREDIT', 100.50, 'GBP', '2026-07-20') RETURNING ledger_txn_id`,
      [accountId]
    );
    const extRes = await testPool.query(
      `INSERT INTO external_statement_lines (batch_id, source_id, external_ref, account_ref, amount, currency, value_date)
       VALUES ($1, 2, 'EXT-DISC-1', 'ACC-TEST', 100.00, 'GBP', '2026-07-20') RETURNING ext_line_id`,
      [externalBatchId]
    );

    // 3. Insert exception
    const exRes = await testPool.query(
      `INSERT INTO reconciliation_exceptions (run_id, ledger_txn_id, ext_line_id, exception_type, amount_diff, status, assigned_to)
       VALUES ($1, $2, $3, 'AMOUNT_MISMATCH', 0.50, 'ASSIGNED', $4) RETURNING exception_id`,
      [runId, ldgRes.rows[0].ledger_txn_id, extRes.rows[0].ext_line_id, analystId]
    );
    const exceptionId = exRes.rows[0].exception_id;

    const result = await investigateException({
      exceptionId,
      userId: analystId,
      userRole: "ANALYST",
      correlationId: "test-corr-1",
    });

    expect(result.status).toBe("FALLBACK_DETERMINISTIC");
    expect(result.deterministicHints.category).toBe("AMOUNT_MISMATCH");
    expect(result.deterministicHints.amountDiffFormatted).toBe("0.50");
    expect(result.aiAnalysis.disclaimer).toBe("AI-generated suggestion. Requires analyst judgment. No financial action taken.");

    // Check investigation was recorded in append-only table
    const auditRes = await testPool.query(
      `SELECT * FROM ai_investigations WHERE exception_id = $1`,
      [exceptionId]
    );
    expect(auditRes.rowCount).toBe(1);
    expect(auditRes.rows[0].requester_id).toBe(analystId);
  });

  it("2. enforces security boundary: denies analyst from investigating an exception assigned to another analyst", async () => {
    const runRes = await testPool.query(
      `INSERT INTO reconciliation_runs (run_date, source_batch_id, status)
       VALUES ('2026-07-20', $1, 'COMPLETED') RETURNING run_id`,
      [externalBatchId]
    );
    const exRes = await testPool.query(
      `INSERT INTO reconciliation_exceptions (run_id, exception_type, status, assigned_to)
       VALUES ($1, 'MISSING_EXTERNAL', 'ASSIGNED', $2) RETURNING exception_id`,
      [runRes.rows[0].run_id, analystId] // assigned to analystId
    );
    const exceptionId = exRes.rows[0].exception_id;

    // otherAnalyst attempts to investigate
    await expect(
      investigateException({
        exceptionId,
        userId: otherAnalystId,
        userRole: "ANALYST",
        correlationId: "test-corr-denied",
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });

  it("3. rejects and sanitizes model hallucinations citing invalid evidence IDs", () => {
    const validEvidenceIds = ["EXCEPTION_1", "LEDGER_10", "EXT_20"];

    const rawHallucinatedJson = {
      summary: "Simulated hallucinated response",
      suspected_category: "AMOUNT_MISMATCH",
      evidence_considered: ["EXCEPTION_1", "FAKE_DOC_999"],
      field_level_comparisons: [
        {
          field_name: "amount",
          ledger_value: "100.00",
          external_value: "105.00",
          observation: "Variance of 5.00",
          evidence_ids: ["LEDGER_10", "GHOST_ID_404"],
        },
      ],
      possible_explanations: [
        {
          hypothesis: "Legitimate hypothesis with valid evidence",
          supporting_evidence_ids: ["LEDGER_10"],
          confidence: "HIGH",
        },
        {
          hypothesis: "Hallucinated explanation with no grounding",
          supporting_evidence_ids: ["FAKE_INVOICE_XYZ"],
          confidence: "LOW",
        },
      ],
      recommended_next_checks: ["Verify SWIFT logs"],
      uncertainty: "Moderate uncertainty",
      missing_evidence: [],
      disclaimer: "AI-generated suggestion. Requires analyst judgment. No financial action taken.",
    };

    const { validatedOutput, droppedClaimsCount } = sanitizeAndValidateModelOutput(
      rawHallucinatedJson,
      validEvidenceIds
    );

    expect(droppedClaimsCount).toBe(1);
    expect(validatedOutput.possible_explanations.length).toBe(1);
    expect(validatedOutput.possible_explanations[0].supporting_evidence_ids).toEqual(["LEDGER_10"]);
    expect(validatedOutput.evidence_considered).toEqual(["EXCEPTION_1"]);
  });

  it("4. records analyst feedback without modifying exception state", async () => {
    const runRes = await testPool.query(
      `INSERT INTO reconciliation_runs (run_date, source_batch_id, status)
       VALUES ('2026-07-20', $1, 'COMPLETED') RETURNING run_id`,
      [externalBatchId]
    );
    const exRes = await testPool.query(
      `INSERT INTO reconciliation_exceptions (run_id, exception_type, status, assigned_to)
       VALUES ($1, 'MISSING_EXTERNAL', 'ASSIGNED', $2) RETURNING exception_id`,
      [runRes.rows[0].run_id, analystId]
    );
    const exceptionId = exRes.rows[0].exception_id;

    // Run investigation
    const inv = await investigateException({
      exceptionId,
      userId: analystId,
      userRole: "ANALYST",
    });

    // Submit feedback
    const feedback = await recordInvestigationFeedback({
      investigationId: inv.investigationId,
      userId: analystId,
      userRole: "ANALYST",
      isUseful: true,
      comment: "Identified correct clearing window delay.",
    });

    expect(feedback.feedback_id).toBeDefined();

    // Verify exception was not mutated in any way
    const exCheck = await testPool.query(
      `SELECT status, version FROM reconciliation_exceptions WHERE exception_id = $1`,
      [exceptionId]
    );
    expect(exCheck.rows[0].status).toBe("ASSIGNED");
    expect(exCheck.rows[0].version).toBe(1);
  });
});

