import { withTransaction, query } from "../config/db.js";
import { logger } from "../config/logger.js";
import {
  createRun,
  findExactMatches,
  findToleranceMatches,
  findBatchSettlementCandidates,
  insertMatchGroup,
  generateExceptionsForUnmatched,
  completeRun,
  findReconciliationRuns,
  requireExternalSettlementBatch,
} from "../repositories/matchingRepository.js";

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
    const runId = await createRun(client, { runDate, triggeredBy });

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
      const confidence = 100 - Math.min(20, Number(m.amount_diff) * 100); // rough confidence heuristic
      await insertMatchGroup(client, {
        runId,
        ruleId: null,
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
      let currentSum = 0;
      const subset = [];
      let matched = false;

      for (const txn of ledgerTxns) {
        if (matchedLedgerIds.has(txn.ledgerTxnId)) {
          continue;
        }
        currentSum += txn.amount;
        subset.push(txn.ledgerTxnId);

        if (Math.abs(currentSum - batchTotal) < 0.005) {
          matched = true;
          break;
        }
        if (currentSum > batchTotal) {
          break;
        }
      }

      if (matched && subset.length > 0) {
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
