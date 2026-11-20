import { AppError } from "../../utils/AppError.js";

export const EVIDENCE_RETRIEVAL = "EVIDENCE_RETRIEVAL";

export async function retrieveEvidence(client, { exceptionId, userId, userRole }) {
  const ex = await client.query(`
    SELECT e.exception_id,e.run_id,e.ledger_txn_id,e.ext_line_id,e.exception_type,e.amount_diff,e.status,e.assigned_to,
      r.run_date,r.status AS run_status,r.source_batch_id,
      l.account_id,l.txn_ref,l.txn_type,l.amount AS ledger_amount,l.currency AS ledger_currency,l.value_date AS ledger_date,l.posted_at,
      al.account_id AS linked_account_id,al.external_ref AS ledger_account_ref,al.currency AS account_currency,al.status AS account_status,
      ax.account_id AS external_account_id,ax.currency AS external_account_currency,ax.status AS external_account_status,
      x.batch_id AS ext_batch_id,x.account_ref,x.external_ref,x.amount AS external_amount,x.currency AS external_currency,x.value_date AS external_date,
      x.settlement_date,x.is_batched_settlement
    FROM reconciliation_exceptions e
    LEFT JOIN reconciliation_runs r ON r.run_id=e.run_id
    LEFT JOIN ledger_transactions l ON l.ledger_txn_id=e.ledger_txn_id
    LEFT JOIN accounts al ON al.account_id=l.account_id
    LEFT JOIN external_statement_lines x ON x.ext_line_id=e.ext_line_id
    LEFT JOIN accounts ax ON ax.external_ref=x.account_ref
    WHERE e.exception_id=$1`, [exceptionId]);
  if (!ex.rowCount) throw new AppError(404, "Exception not found", "EXCEPTION_NOT_FOUND");
  const row = ex.rows[0];
  if (userRole === "ANALYST" && row.assigned_to && row.assigned_to !== userId) {
    throw new AppError(403, "You do not have permission to investigate this exception", "FORBIDDEN");
  }
  if (row.ledger_txn_id && row.ext_line_id && row.ledger_account_ref && row.ledger_account_ref !== row.account_ref) {
    throw new AppError(409, "Linked ledger and external records belong to different accounts; investigation stopped to protect account isolation", "ACCOUNT_BOUNDARY_MISMATCH");
  }
  const ledger = row.ledger_txn_id ? {
    evidenceId: `LEDGER_${row.ledger_txn_id}`, id: String(row.ledger_txn_id), accountId: row.account_id,
    reference: row.txn_ref, type: row.txn_type, amount: String(row.ledger_amount), currency: row.ledger_currency,
    date: row.ledger_date?.toISOString?.().slice(0, 10) || row.ledger_date,
    postedAt: row.posted_at,
  } : null;
  const external = row.ext_line_id ? {
    evidenceId: `EXTERNAL_${row.ext_line_id}`, id: String(row.ext_line_id), batchId: String(row.ext_batch_id), accountRef: row.account_ref,
    reference: row.external_ref, amount: String(row.external_amount), currency: row.external_currency,
    date: row.external_date?.toISOString?.().slice(0, 10) || row.external_date,
    settlementDate: row.settlement_date?.toISOString?.().slice(0, 10) || row.settlement_date,
    isBatchedSettlement: row.is_batched_settlement,
  } : null;
  const account = row.ledger_txn_id ? { evidenceId: `ACCOUNT_${row.linked_account_id}`, id: String(row.linked_account_id), externalReference: row.ledger_account_ref, currency: row.account_currency, status: row.account_status }
    : (row.external_account_id ? { evidenceId: `ACCOUNT_${row.external_account_id}`, id: String(row.external_account_id), externalReference: external?.accountRef, currency: row.external_account_currency, status: row.external_account_status } : (external ? { externalReference: external.accountRef } : null));
  const missingEvidence = [];
  if (row.ledger_txn_id && !ledger) missingEvidence.push("Linked ledger transaction could not be retrieved");
  if (row.ext_line_id && !external) missingEvidence.push("Linked external record could not be retrieved");
  if (!ledger) missingEvidence.push("No linked internal ledger transaction");
  if (!external) missingEvidence.push("No linked external settlement record");
  if (external && !account) missingEvidence.push("External account reference does not map to a known account");
  if (!row.run_id || !row.run_date) missingEvidence.push("Reconciliation run details are unavailable");

  const candidates = [];
  // Candidate search is strictly within the account represented by this exception and same currency.
  if (ledger && !external) {
    const result = await client.query(`
      SELECT x.ext_line_id,x.external_ref,x.amount,x.currency,x.value_date
      FROM external_statement_lines x JOIN accounts a ON a.external_ref=x.account_ref
      WHERE a.account_id=$1 AND x.currency=$2 AND x.amount=$3::numeric
        AND x.value_date BETWEEN $4::date-INTERVAL '7 days' AND $4::date+INTERVAL '7 days'
      ORDER BY abs(x.value_date-$4::date),x.ext_line_id LIMIT 10`,
    [ledger.accountId, ledger.currency, ledger.amount, ledger.date]);
    result.rows.forEach((r) => candidates.push({ evidenceId: `CANDIDATE_EXTERNAL_${r.ext_line_id}`, type: "EXTERNAL_CANDIDATE", id: String(r.ext_line_id), reference: r.external_ref, amount: String(r.amount), currency: r.currency, date: r.value_date.toISOString().slice(0, 10) }));
  } else if (external && !ledger) {
    const result = await client.query(`
      SELECT l.ledger_txn_id,l.txn_ref,l.amount,l.currency,l.value_date
      FROM ledger_transactions l JOIN accounts a ON a.account_id=l.account_id
      WHERE a.external_ref=$1 AND l.currency=$2 AND l.amount=$3::numeric
        AND l.value_date BETWEEN $4::date-INTERVAL '7 days' AND $4::date+INTERVAL '7 days'
      ORDER BY abs(l.value_date-$4::date),l.ledger_txn_id LIMIT 10`,
    [external.accountRef, external.currency, external.amount, external.date]);
    result.rows.forEach((r) => candidates.push({ evidenceId: `CANDIDATE_LEDGER_${r.ledger_txn_id}`, type: "LEDGER_CANDIDATE", id: String(r.ledger_txn_id), reference: r.txn_ref, amount: String(r.amount), currency: r.currency, date: r.value_date.toISOString().slice(0, 10) }));
  } else if (ledger && external) {
    const [externalDuplicates, ledgerDuplicates] = await Promise.all([
      client.query(`SELECT ext_line_id,external_ref,amount,currency,value_date FROM external_statement_lines
        WHERE account_ref=$1 AND currency=$2 AND ext_line_id<>$3
          AND (external_ref=$4 OR (amount=$5::numeric AND value_date BETWEEN $6::date-INTERVAL '1 day' AND $6::date+INTERVAL '1 day'))
        ORDER BY ext_line_id LIMIT 10`, [external.accountRef, external.currency, external.id, external.reference, external.amount, external.date]),
      client.query(`SELECT ledger_txn_id,txn_ref,amount,currency,value_date FROM ledger_transactions
        WHERE account_id=$1 AND currency=$2 AND ledger_txn_id<>$3
          AND (txn_ref=$4 OR (amount=$5::numeric AND value_date BETWEEN $6::date-INTERVAL '1 day' AND $6::date+INTERVAL '1 day'))
        ORDER BY ledger_txn_id LIMIT 10`, [ledger.accountId, ledger.currency, ledger.id, ledger.reference, ledger.amount, ledger.date]),
    ]);
    externalDuplicates.rows.forEach((r) => candidates.push({ evidenceId: `CANDIDATE_EXTERNAL_${r.ext_line_id}`, type: "EXTERNAL_CANDIDATE", id: String(r.ext_line_id), reference: r.external_ref, amount: String(r.amount), currency: r.currency, date: r.value_date.toISOString().slice(0, 10) }));
    ledgerDuplicates.rows.forEach((r) => candidates.push({ evidenceId: `CANDIDATE_LEDGER_${r.ledger_txn_id}`, type: "LEDGER_CANDIDATE", id: String(r.ledger_txn_id), reference: r.txn_ref, amount: String(r.amount), currency: r.currency, date: r.value_date.toISOString().slice(0, 10) }));
  }
  const evidenceIds = [`EXCEPTION_${row.exception_id}`, ...(account?.evidenceId ? [account.evidenceId] : []), ...(row.run_id ? [`RUN_${row.run_id}`] : []), ...(ledger ? [ledger.evidenceId] : []), ...(external ? [external.evidenceId] : []), ...candidates.map((c) => c.evidenceId)];
  return {
    exception: { id: String(row.exception_id), type: row.exception_type, status: row.status, amountDifference: row.amount_diff == null ? null : String(row.amount_diff) },
    account,
    run: row.run_id ? { evidenceId: `RUN_${row.run_id}`, id: String(row.run_id), date: row.run_date?.toISOString?.().slice(0, 10) || row.run_date, sourceBatchId: String(row.source_batch_id), status: row.run_status } : null,
    ledger, external, duplicateCandidates: candidates, evidenceIds, missingEvidence,
  };
}
