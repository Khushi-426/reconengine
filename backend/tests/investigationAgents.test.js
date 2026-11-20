import { describe, expect, it } from "vitest";
import { analyzeFinancials } from "../src/services/investigation/financialAnalysisAgent.js";
import { investigateDeterministically } from "../src/services/investigation/investigationAgent.js";
import { verifyAndReport } from "../src/services/investigation/verificationReportingAgent.js";
import { retrieveEvidence } from "../src/services/investigation/evidenceRetrievalAgent.js";

const pair = (overrides = {}) => ({
  exception: { id: "5", type: "AMOUNT_MISMATCH", status: "OPEN", amountDifference: "0.50" },
  account: { evidenceId: "ACCOUNT_1", id: "1", currency: "GBP" },
  evidenceIds: ["EXCEPTION_5", "ACCOUNT_1", "LEDGER_10", "EXTERNAL_20"],
  ledger: { evidenceId: "LEDGER_10", reference: "ABC-123", amount: "100.50", currency: "GBP", date: "2026-07-20" },
  external: { evidenceId: "EXTERNAL_20", reference: "ABC123", amount: "100.00", currency: "GBP", date: "2026-07-20", isBatchedSettlement: false },
  duplicateCandidates: [], missingEvidence: [],
  ...overrides,
});

describe("deterministic investigation agents", () => {
  it("retrieves only account and currency scoped duplicate candidates", async () => {
    const base = {
      exception_id: "5", run_id: "3", ledger_txn_id: "10", ext_line_id: "20", exception_type: "AMOUNT_MISMATCH", status: "OPEN", assigned_to: "analyst",
      run_date: "2026-07-20", run_status: "COMPLETED", source_batch_id: "8", account_id: 1, txn_ref: "ABC", txn_type: "CREDIT", ledger_amount: "10.00", ledger_currency: "GBP", ledger_date: "2026-07-20", posted_at: null,
      linked_account_id: 1, ledger_account_ref: "ACC-1", account_currency: "GBP", account_status: "ACTIVE", external_account_id: 1, external_account_currency: "GBP", external_account_status: "ACTIVE",
      ext_batch_id: "9", account_ref: "ACC-1", external_ref: "ABC", external_amount: "10.00", external_currency: "GBP", external_date: "2026-07-20", settlement_date: null, is_batched_settlement: false,
    };
    const calls = [];
    const client = { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM reconciliation_exceptions e")) return { rowCount: 1, rows: [base] };
      return { rowCount: 0, rows: [] };
    } };
    const evidence = await retrieveEvidence(client, { exceptionId: 5, userId: "analyst", userRole: "ANALYST" });
    expect(evidence.evidenceIds).toContain("ACCOUNT_1");
    expect(calls[1].params.slice(0, 3)).toEqual(["ACC-1", "GBP", "20"]);
    expect(calls[2].params.slice(0, 3)).toEqual([1, "GBP", "10"]);
  });

  it("stops evidence retrieval when linked records cross account boundaries", async () => {
    const client = { query: async () => ({ rowCount: 1, rows: [{ exception_id: "5", ledger_txn_id: "10", ext_line_id: "20", assigned_to: null, ledger_account_ref: "ACC-A", account_ref: "ACC-B" }] }) };
    await expect(retrieveEvidence(client, { exceptionId: 5, userId: "analyst", userRole: "ANALYST" })).rejects.toMatchObject({ code: "ACCOUNT_BOUNDARY_MISMATCH" });
  });

  it("calculates exact decimal amount differences and normalized references", () => {
    const result = analyzeFinancials(pair());
    expect(result.category).toBe("AMOUNT_MISMATCH");
    expect(result.calculations.amountDifference).toBe("0.50");
    expect(result.calculations.percentageDifference).toBe("0.50");
    expect(result.calculations.referenceMatch).toBe(true);
  });

  it("honors amount tolerance boundary without float arithmetic", () => {
    const evidence = pair({ ledger: { ...pair().ledger, amount: "100.01" } });
    expect(analyzeFinancials(evidence, { amountTolerance: "0.01", dateToleranceDays: 2 }).category).toBe("UNCLASSIFIED");
  });

  it("classifies currency mismatch and keeps causes as hypotheses", () => {
    const evidence = pair({ external: { ...pair().external, currency: "EUR" } });
    const analysis = analyzeFinancials(evidence);
    expect(analysis.category).toBe("CURRENCY_MISMATCH");
    const result = investigateDeterministically(evidence, analysis);
    expect(result.hypotheses[0].confirmed).toBe(false);
  });

  it("classifies a bounded batched settlement shortfall and rejects invalid currency precision", () => {
    const partial = pair({ external: { ...pair().external, amount: "90.00", isBatchedSettlement: true } });
    expect(analyzeFinancials(partial).category).toBe("PARTIAL_SETTLEMENT");
    const yen = pair({ ledger: { ...pair().ledger, currency: "JPY", amount: "100.50" }, external: { ...pair().external, currency: "JPY", amount: "100.00" }, account: { currency: "JPY" } });
    const precision = analyzeFinancials(yen);
    expect(precision.category).toBe("CURRENCY_MISMATCH");
    expect(precision.appliedRules).toContain("CURRENCY_PRECISION_INVALID");
  });

  it("flags date mismatch and verifies only known evidence references", () => {
    const evidence = pair({ external: { ...pair().external, amount: "100.50", date: "2026-07-25" } });
    const analysis = analyzeFinancials(evidence);
    expect(analysis.category).toBe("DATE_MISMATCH");
    const investigation = investigateDeterministically(evidence, analysis);
    const verified = verifyAndReport({ investigationId: "8", exceptionId: "5", evidence, analysis, investigation });
    expect(verified.verification.status).toBe("VERIFIED_WITH_DISCLOSED_LIMITATIONS");
  });

  it("checks settlement date against the internal value date", () => {
    const evidence = pair({ external: { ...pair().external, amount: "100.50", settlementDate: "2026-07-25" } });
    const analysis = analyzeFinancials(evidence);
    expect(analysis.category).toBe("DATE_MISMATCH");
    expect(analysis.calculations.settlementDateDifferenceDays).toBe(5);
  });

  it("rejects unsupported evidence references during report verification", () => {
    const evidence = pair();
    const analysis = analyzeFinancials(evidence);
    const investigation = { hypotheses: [{ confirmed: false, supportingEvidence: ["GHOST"], rule: "TEST" }], nextSteps: [], missingInformation: [] };
    expect(verifyAndReport({ investigationId: "8", exceptionId: "5", evidence, analysis, investigation }).verification.status).toBe("FAILED");
  });
});
