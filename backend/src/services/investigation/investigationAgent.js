export const INVESTIGATION = "INVESTIGATION";

export function investigateDeterministically(evidence, analysis, historical = []) {
  const hypotheses = [];
  const push = (cause, explanation, supportingEvidence, rule) => hypotheses.push({ cause, explanation, supportingEvidence, rule, confirmed: false });
  if (analysis.category === "PARTIAL_SETTLEMENT") push("PARTIAL_SETTLEMENT", "The external record is marked as a batched settlement and its amount is lower than the ledger amount; this is consistent with a partial settlement but does not confirm it.", [evidence.ledger?.evidenceId, evidence.external?.evidenceId].filter(Boolean), "BATCHED_AMOUNT_SHORTFALL");
  if (analysis.category === "DATE_MISMATCH") push("SETTLEMENT_TIMING_DIFFERENCE", "The linked records have matching normalized references and amounts within configured tolerance, with a date gap beyond the configured window.", [evidence.ledger?.evidenceId, evidence.external?.evidenceId].filter(Boolean), "MATCHED_VALUES_DATE_GAP");
  if (analysis.category === "DUPLICATE_TRANSACTION") push("POSSIBLE_DUPLICATE", `${analysis.duplicateCandidates.length} account and currency scoped candidate record(s) were found. Review them before concluding a duplicate occurred.`, analysis.duplicateCandidates.map((c) => c.evidenceId), "MULTIPLE_OR_POTENTIAL_CANDIDATES");
  if (analysis.category === "MISSING_INTERNAL") push("MISSING_LEDGER_POSTING", "An external record is linked to the exception and no internal ledger entry is linked. Candidate ledger records are listed separately for review.", [evidence.external?.evidenceId, ...analysis.duplicateCandidates.map((c) => c.evidenceId)].filter(Boolean), "EXTERNAL_WITHOUT_LINKED_LEDGER");
  if (analysis.category === "MISSING_EXTERNAL") push("MISSING_EXTERNAL_SETTLEMENT", "A ledger record is linked to the exception and no external settlement record is linked. Candidate external records are listed separately for review.", [evidence.ledger?.evidenceId, ...analysis.duplicateCandidates.map((c) => c.evidenceId)].filter(Boolean), "LEDGER_WITHOUT_LINKED_EXTERNAL");
  if (analysis.category === "AMOUNT_MISMATCH") push("AMOUNT_DISCREPANCY", "The linked records are in the same currency and their calculated amount difference exceeds configured tolerance.", [evidence.ledger?.evidenceId, evidence.external?.evidenceId].filter(Boolean), "AMOUNT_TOLERANCE_EXCEEDED");
  if (analysis.category === "CURRENCY_MISMATCH") push("SOURCE_CURRENCY_OR_MAPPING_ISSUE", "The linked records use different currencies. Confirm source data and account currency mapping before comparing amounts.", [evidence.ledger?.evidenceId, evidence.external?.evidenceId].filter(Boolean), "CURRENCY_MUST_MATCH");
  if (analysis.category === "REFERENCE_MISMATCH") push("REFERENCE_MAPPING_ISSUE", "Amounts are within tolerance but normalized references differ. Confirm reference mapping across the source systems.", [evidence.ledger?.evidenceId, evidence.external?.evidenceId].filter(Boolean), "NORMALIZED_REFERENCE_DIFFERENCE");
  if (historical.length) {
    const matches = historical.filter((item) => item.discrepancy_category === analysis.category);
    if (matches.length >= 3) push("RECURRING_HISTORICAL_PATTERN", `${matches.length} prior investigations share this classification. This is a recurring pattern, not proof of the current cause.`, matches.map((m) => `INVESTIGATION_${m.investigation_id}`), "AT_LEAST_THREE_SAME_CATEGORY_CASES");
  }
  const nextSteps = [];
  if (evidence.missingEvidence.length) nextSteps.push("Obtain or restore the missing linked records listed in the evidence section.");
  if (analysis.category === "CURRENCY_MISMATCH") nextSteps.push("Confirm the expected account currency and source currency mapping.");
  if (analysis.category === "AMOUNT_MISMATCH" || analysis.category === "PARTIAL_SETTLEMENT") nextSteps.push("Compare the settlement advice or remittance breakdown with the ledger posting.");
  if (analysis.category === "DATE_MISMATCH") nextSteps.push("Check the settlement calendar and posting window for the recorded dates.");
  if (analysis.category === "DUPLICATE_TRANSACTION") nextSteps.push("Review each candidate record and confirm whether it represents the same underlying payment.");
  if (analysis.category === "REFERENCE_MISMATCH") nextSteps.push("Verify the source reference mapping and any documented reference transformations.");
  if (!nextSteps.length) nextSteps.push("Review the source records and confirm whether further supporting documents are needed.");
  return { hypotheses, nextSteps, missingInformation: evidence.missingEvidence, historicalSampleCount: historical.length };
}
