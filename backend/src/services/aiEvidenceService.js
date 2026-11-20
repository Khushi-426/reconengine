import { query } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

/**
 * Gathers the minimal authorized evidence package for an exception break.
 * Respects RLS and requesting user context (userId, userRole).
 */
export async function getExceptionEvidence(client, { exceptionId, userId, userRole }) {
  const db = client || query;

  // 1. Fetch the exception (guarded by RLS session vars if in client session)
  const exSql = `
    SELECT 
      e.exception_id, e.run_id, e.ledger_txn_id, e.ext_line_id, e.exception_type,
      e.amount_diff, e.status, e.assigned_to, e.version, e.created_at, e.sla_deadline
    FROM reconciliation_exceptions e
    WHERE e.exception_id = $1
  `;
  const exRes = await db.query(exSql, [exceptionId]);
  if (exRes.rowCount === 0) {
    throw new AppError(404, "Exception not found", "EXCEPTION_NOT_FOUND");
  }

  const exception = exRes.rows[0];

  // RBAC / Ownership check defense-in-depth:
  if (userRole === "ANALYST" && exception.assigned_to && exception.assigned_to !== userId) {
    throw new AppError(403, "You do not have permission to view or investigate this exception", "FORBIDDEN");
  }

  // 2. Fetch internal ledger transaction if linked
  let ledgerTxn = null;
  if (exception.ledger_txn_id) {
    const ldgRes = await db.query(
      `SELECT lt.ledger_txn_id, lt.txn_ref, lt.txn_type, lt.amount, lt.currency, lt.value_date, lt.posted_at
       FROM ledger_transactions lt
       WHERE lt.ledger_txn_id = $1`,
      [exception.ledger_txn_id]
    );
    if (ldgRes.rowCount > 0) {
      const r = ldgRes.rows[0];
      ledgerTxn = {
        evidenceId: `LEDGER_${r.ledger_txn_id}`,
        id: r.ledger_txn_id,
        ref: r.txn_ref,
        type: r.txn_type,
        amount: String(r.amount),
        currency: r.currency,
        valueDate: r.value_date ? new Date(r.value_date).toISOString().slice(0, 10) : null,
      };
    }
  }

  // 3. Fetch external statement line if linked
  let externalLine = null;
  if (exception.ext_line_id) {
    const extRes = await db.query(
      `SELECT ex.ext_line_id, ex.batch_id, ex.external_ref, ex.account_ref, ex.amount, ex.currency,
              ex.value_date, ex.is_batched_settlement
       FROM external_statement_lines ex
       WHERE ex.ext_line_id = $1`,
      [exception.ext_line_id]
    );
    if (extRes.rowCount > 0) {
      const r = extRes.rows[0];
      externalLine = {
        evidenceId: `EXT_${r.ext_line_id}`,
        id: r.ext_line_id,
        ref: r.external_ref,
        accountRef: r.account_ref,
        amount: String(r.amount),
        currency: r.currency,
        valueDate: r.value_date ? new Date(r.value_date).toISOString().slice(0, 10) : null,
        isBatchedSettlement: r.is_batched_settlement,
      };
    }
  }

  // 4. Fetch reconciliation run context
  let runContext = null;
  if (exception.run_id) {
    const runRes = await db.query(
      `SELECT run_id, run_date, source_batch_id, status FROM reconciliation_runs WHERE run_id = $1`,
      [exception.run_id]
    );
    if (runRes.rowCount > 0) {
      const r = runRes.rows[0];
      runContext = {
        evidenceId: `RUN_${r.run_id}`,
        runId: r.run_id,
        runDate: r.run_date ? new Date(r.run_date).toISOString().slice(0, 10) : null,
        status: r.status,
      };
    }
  }

  // 5. Check for duplicate candidate items (same amount & account or ref)
  const candidateDuplicates = [];
  if (ledgerTxn && !externalLine) {
    // Missing external line — search external statement lines around same date & amount
    const dupRes = await db.query(
      `SELECT ex.ext_line_id, ex.external_ref, ex.amount, ex.currency, ex.value_date
       FROM external_statement_lines ex
       WHERE ex.amount = $1 AND ex.value_date BETWEEN $2::date - INTERVAL '7 days' AND $2::date + INTERVAL '7 days'
       LIMIT 3`,
      [ledgerTxn.amount, ledgerTxn.valueDate]
    );
    dupRes.rows.forEach((r) => {
      candidateDuplicates.push({
        evidenceId: `CANDIDATE_EXT_${r.ext_line_id}`,
        ref: r.external_ref,
        amount: String(r.amount),
        currency: r.currency,
        valueDate: r.value_date ? new Date(r.value_date).toISOString().slice(0, 10) : null,
      });
    });
  } else if (externalLine && !ledgerTxn) {
    // Missing internal line — search ledger around same date & amount
    const dupRes = await db.query(
      `SELECT lt.ledger_txn_id, lt.txn_ref, lt.amount, lt.currency, lt.value_date
       FROM ledger_transactions lt
       WHERE lt.amount = $1 AND lt.value_date BETWEEN $2::date - INTERVAL '7 days' AND $2::date + INTERVAL '7 days'
       LIMIT 3`,
      [externalLine.amount, externalLine.valueDate]
    );
    dupRes.rows.forEach((r) => {
      candidateDuplicates.push({
        evidenceId: `CANDIDATE_LEDGER_${r.ledger_txn_id}`,
        ref: r.txn_ref,
        amount: String(r.amount),
        currency: r.currency,
        valueDate: r.value_date ? new Date(r.value_date).toISOString().slice(0, 10) : null,
      });
    });
  }

  const evidenceIds = [
    `EXCEPTION_${exception.exception_id}`,
    ...(ledgerTxn ? [ledgerTxn.evidenceId] : []),
    ...(externalLine ? [externalLine.evidenceId] : []),
    ...(runContext ? [runContext.evidenceId] : []),
    ...candidateDuplicates.map((d) => d.evidenceId),
  ];

  return {
    exceptionRecord: {
      evidenceId: `EXCEPTION_${exception.exception_id}`,
      id: exception.exception_id,
      exceptionType: exception.exception_type,
      status: exception.status,
      amountDiff: exception.amount_diff != null ? String(exception.amount_diff) : null,
    },
    ledgerTxn,
    externalLine,
    runContext,
    candidateDuplicates,
    evidenceIds,
  };
}

/**
 * Computes deterministic discrepancy comparisons without any model call.
 */
export function computeDeterministicHints(bundle) {
  const { ledgerTxn, externalLine, candidateDuplicates } = bundle;

  let amountDiffCents = 0;
  let hasAmountDiff = false;
  let dateDiffDays = null;
  let currencyMatch = null;
  let referenceMatch = false;

  if (ledgerTxn && externalLine) {
    const ldgCents = Math.round(Number(ledgerTxn.amount) * 100);
    const extCents = Math.round(Number(externalLine.amount) * 100);
    amountDiffCents = Math.abs(ldgCents - extCents);
    hasAmountDiff = amountDiffCents !== 0;

    if (ledgerTxn.valueDate && externalLine.valueDate) {
      const d1 = new Date(ledgerTxn.valueDate);
      const d2 = new Date(externalLine.valueDate);
      dateDiffDays = Math.round(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
    }

    currencyMatch = ledgerTxn.currency === externalLine.currency;
    referenceMatch =
      ledgerTxn.ref &&
      externalLine.ref &&
      (ledgerTxn.ref.toLowerCase().includes(externalLine.ref.toLowerCase()) ||
        externalLine.ref.toLowerCase().includes(ledgerTxn.ref.toLowerCase()));
  }

  // Authoritative deterministic classification
  let category = "UNKNOWN_INSUFFICIENT_EVIDENCE";

  if (!ledgerTxn && externalLine) {
    if (candidateDuplicates.length > 0) {
      category = "DUPLICATE";
    } else {
      category = "MISSING_INTERNAL";
    }
  } else if (ledgerTxn && !externalLine) {
    if (candidateDuplicates.length > 0) {
      category = "DUPLICATE";
    } else {
      category = "MISSING_EXTERNAL";
    }
  } else if (ledgerTxn && externalLine) {
    if (currencyMatch === false) {
      category = "CURRENCY_MISMATCH";
    } else if (externalLine.isBatchedSettlement) {
      category = "BATCH_SETTLEMENT_DISCREPANCY";
    } else if (hasAmountDiff && dateDiffDays !== null && dateDiffDays > 3) {
      category = "TIMING";
    } else if (hasAmountDiff) {
      category = "AMOUNT_MISMATCH";
    } else if (dateDiffDays !== null && dateDiffDays > 2) {
      category = "TIMING";
    }
  }

  return {
    category,
    amountDiffCents,
    amountDiffFormatted: (amountDiffCents / 100).toFixed(2),
    dateDiffDays,
    currencyMatch,
    referenceMatch,
    candidateCount: candidateDuplicates.length,
  };
}
