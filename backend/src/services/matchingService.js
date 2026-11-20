import { withTransaction, query } from "../config/db.js";
import { logger } from "../config/logger.js";
import {
  createRun,
  assertNoCompletedRunForBatch,
  findExactMatches,
  findToleranceMatches,
  findBatchSettlementCandidates,
  insertMatchGroup,
  generateExceptionsForUnmatched,
  completeRun,
  findReconciliationRuns,
  requireExternalSettlementBatch,
} from "../repositories/matchingRepository.js";

const MAX_BATCH_GREEDY_CANDIDATES = 50;

export function calculateToleranceConfidence({ amountDiff, toleranceAmount, dayDiff = 0 }) {
  const safeToleranceAmount = Number(toleranceAmount);
  if (!Number.isFinite(safeToleranceAmount) || safeToleranceAmount <= 0) {
    return 100;
  }

  const ratio = Math.min(1, Number(amountDiff) / safeToleranceAmount);
  const amountPenalty = ratio * 25;
  const datePenalty = Math.min(10, Number(dayDiff) * 2);

  return Number(Math.max(70, 100 - amountPenalty - datePenalty).toFixed(2));
}

/**
 * Precision-safe batch subset selection.
 *
 * All amounts from PostgreSQL NUMERIC(18,2) have at most 2 decimal places.
 * We convert to integer cents (multiply by 100 and round) so all arithmetic
 * is exact integer arithmetic — no floating-point drift or epsilon comparisons.
 *
 * Returns an ordered array of ledgerTxnIds whose amounts sum to batchTotal,
 * or [] if no such prefix-sum subset exists within the candidate set.
 *
 * When more than MAX_BATCH_GREEDY_CANDIDATES candidates exist the function
 * returns [] — the caller MUST surface this as a visible exception, not silently drop work.
 */
export function chooseBatchSettlementSubset(ledgerTxns, batchTotal) {
  // Convert to integer cents to avoid floating-point imprecision
  const toCents = (v) => Math.round(Number(v) * 100);

  const batchCents = toCents(batchTotal);

  const orderedTxns = [...ledgerTxns]
    .map((t) => ({ ...t, amountCents: toCents(t.amount) }))
    .sort((a, b) => {
      if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents;
      // Deterministic tie-break: lower ledgerTxnId first
      return a.ledgerTxnId - b.ledgerTxnId;
    });

  if (orderedTxns.length > MAX_BATCH_GREEDY_CANDIDATES) {
    return [];
  }

  let currentCents = 0;
  const subset = [];
  for (const txn of orderedTxns) {
    currentCents += txn.amountCents;
    subset.push(txn.ledgerTxnId);

    if (currentCents === batchCents) {
      return subset;
    }
    if (currentCents > batchCents) {
      // Overshoot — greedy prefix cannot match; return empty
      return [];
    }
  }

  return [];
}

/**
 * Runs a full reconciliation pass: exact match -> tolerance match -> exception
 * generation for anything left over. The ENTIRE run is one transaction:
 * if the exact-match pass succeeds but the tolerance pass throws, we roll back
 * BOTH — a reconciliation run is either fully applied or not applied at all,
 * never left half-matched (which would corrupt exception counts and audit trail).
 */
export async function getAvailableExternalSettlementBatch(batchId) {
  return requireExternalSettlementBatch(batchId);
}

export async function runReconciliation({ runDate, triggeredBy, batchId }) {
  const stats = { totalInternal: 0, totalExternal: 0, matchedCount: 0, exceptionCount: 0 };
  const batch = await requireExternalSettlementBatch(batchId);

  const runId = await withTransaction(async (client) => {
    await assertNoCompletedRunForBatch(client, { runDate, batchId: batch.batch_id });
    const runId = await createRun(client, { runDate, triggeredBy, batchId: batch.batch_id });

    const totals = await client.query(
      `SELECT (SELECT COUNT(*) FROM ledger_transactions WHERE value_date = $1) AS internal_count,
              (SELECT COUNT(*) FROM external_statement_lines WHERE batch_id = $2 AND value_date = $1) AS external_count`,
      [runDate, batch.batch_id]
    );
    stats.totalInternal = parseInt(totals.rows[0].internal_count, 10);
    stats.totalExternal = parseInt(totals.rows[0].external_count, 10);

    // Pass 1: exact matches
    const exactMatches = await findExactMatches(client, { batchId: batch.batch_id, runDate });
    for (const m of exactMatches) {
      await insertMatchGroup(client, {
        runId,
        ruleId: null,
        matchType: "AUTO",
        confidence: 100.0,
        matchedBy: triggeredBy,
        ledgerTxnIds: [m.ledger_txn_id],
        extLineIds: [m.ext_line_id],
      });
    }
    stats.matchedCount += exactMatches.length;
    logger.info({ runId, count: exactMatches.length }, "Exact match pass complete");

    // Pass 2: tolerance matches (FX rounding, fee deltas)
    const toleranceMatches = await findToleranceMatches(client, { batchId: batch.batch_id, runDate });
    for (const m of toleranceMatches) {
      const toleranceAmount = Number(m.ledger_amount) * Number(m.amount_tolerance);
      const confidence = calculateToleranceConfidence({
        amountDiff: Number(m.amount_diff),
        toleranceAmount,
        dayDiff: Number(m.day_diff),
      });
      await insertMatchGroup(client, {
        runId,
        ruleId: m.rule_id ?? null,
        matchType: "AUTO",
        confidence,
        matchedBy: triggeredBy,
        ledgerTxnIds: [m.ledger_txn_id],
        extLineIds: [m.ext_line_id],
      });
    }
    stats.matchedCount += toleranceMatches.length;
    logger.info({ runId, count: toleranceMatches.length }, "Tolerance match pass complete");

    // Pass 3: batch-settlement matches (many ledger rows -> 1 external line)
    const batchCandidates = await findBatchSettlementCandidates(client, { batchId: batch.batch_id, runDate });
    const groups = {};
    for (const row of batchCandidates) {
      if (!groups[row.ext_line_id]) {
        groups[row.ext_line_id] = {
          extLineId: row.ext_line_id,
          batchTotal: Number(row.batch_total),
          ledgerTxns: [],
        };
      }
      groups[row.ext_line_id].ledgerTxns.push({
        ledgerTxnId: row.ledger_txn_id,
        amount: Number(row.amount),
      });
    }

    const matchedLedgerIds = new Set();
    for (const extLineId in groups) {
      const { batchTotal, ledgerTxns } = groups[extLineId];
      const availableLedger = ledgerTxns.filter((txn) => !matchedLedgerIds.has(txn.ledgerTxnId));
      const subset = chooseBatchSettlementSubset(availableLedger, batchTotal);

      if (subset.length > 0) {
        await insertMatchGroup(client, {
          runId,
          ruleId: null,
          matchType: "AUTO",
          confidence: 100.0,
          matchedBy: triggeredBy,
          ledgerTxnIds: subset,
          extLineIds: [Number(extLineId)],
        });
        subset.forEach(id => matchedLedgerIds.add(id));
        stats.matchedCount += 1;
      } else if (availableLedger.length > MAX_BATCH_GREEDY_CANDIDATES) {
        // The cap was hit: the external line will fall through to pass 4
        // and become a MISSING_INTERNAL exception, surfacing it for analyst review.
        logger.warn(
          { runId, extLineId: Number(extLineId), candidateCount: availableLedger.length, batchTotal },
          "Batch-settlement candidate count exceeds safety limit — ext line will produce MISSING_INTERNAL exception for analyst review"
        );
      }
    }
    logger.info({ runId, count: matchedLedgerIds.size }, "Batch settlement match pass complete");

    // Pass 4: everything unmatched becomes an exception
    const exceptionCount = await generateExceptionsForUnmatched(client, runId, { batchId: batch.batch_id, runDate });
    stats.exceptionCount = exceptionCount;

    await completeRun(client, runId, stats);
    return runId;
  }, { userId: triggeredBy });

  // Refresh the reporting materialized view AFTER commit, outside the main
  // transaction (CONCURRENTLY can't run inside one anyway) so dashboard
  // reads reflect the new run without ever blocking on a read lock.
  try {
    await query("SELECT fn_refresh_daily_summary()");
  } catch (err) {
    logger.warn({ err }, "Materialized view refresh failed — will retry on next scheduled refresh");
  }

  return { runId, batchId: batch.batch_id, stats };
}

export async function listReconciliationRuns(filters) {
  return findReconciliationRuns(filters);
}
