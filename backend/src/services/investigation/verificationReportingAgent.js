import { EVIDENCE_RETRIEVAL } from "./evidenceRetrievalAgent.js";
import { FINANCIAL_ANALYSIS } from "./financialAnalysisAgent.js";
import { INVESTIGATION } from "./investigationAgent.js";
import { analyzeFinancials } from "./financialAnalysisAgent.js";

export const VERIFICATION_REPORTING = "VERIFICATION_REPORTING";

export function verifyAndReport({ investigationId, exceptionId, evidence, analysis, investigation, rules = { amountTolerance: "0.00", dateToleranceDays: 2 } }) {
  const known = new Set(evidence.evidenceIds);
  const errors = [];
  const recalculated = analyzeFinancials(evidence, rules);
  if (recalculated.category !== analysis.category || JSON.stringify(recalculated.calculations) !== JSON.stringify(analysis.calculations)) errors.push("Financial analysis could not be reproduced from the evidence and configured rules.");
  for (const hypothesis of investigation.hypotheses) {
    if (hypothesis.confirmed) errors.push("Root cause marked confirmed without a verification rule.");
    for (const id of hypothesis.supportingEvidence) if (!known.has(id) && !id.startsWith("INVESTIGATION_")) errors.push(`Unknown evidence reference ${id}.`);
  }
  for (const finding of analysis.findings) if (!finding.rule) errors.push("An observation has no supporting business rule.");
  if (evidence.exception.id !== String(exceptionId)) errors.push("Investigation exception identifier does not match.");
  if (analysis.calculations.amountDifference !== null && !analysis.calculations.currency) errors.push("Amount calculation has no currency.");
  return {
    verification: { status: errors.length ? "FAILED" : "VERIFIED_WITH_DISCLOSED_LIMITATIONS", errors, missingEvidenceDisclosed: true, financialCalculationsReproduced: !errors.some((error) => error.startsWith("Financial analysis")) },
    report: {
      title: `Investigation report for exception ${exceptionId}`,
      exceptionSummary: evidence.exception,
      classification: analysis.category,
      financialCalculations: analysis.calculations,
      evidence: evidence.evidenceIds,
      observations: analysis.findings,
      rootCauseHypotheses: investigation.hypotheses,
      missingEvidence: evidence.missingEvidence,
      recommendedNextSteps: investigation.nextSteps,
      executionHistory: [EVIDENCE_RETRIEVAL, FINANCIAL_ANALYSIS, INVESTIGATION, VERIFICATION_REPORTING],
    },
  };
}
