import { z } from "zod";

/**
 * Strict Zod Schema for Structured AI Investigation Assistant Output
 */
export const aiInvestigationResponseSchema = z.object({
  summary: z.string().min(5),
  suspected_category: z.enum([
    "MISSING_EXTERNAL",
    "MISSING_INTERNAL",
    "AMOUNT_MISMATCH",
    "TIMING",
    "DUPLICATE",
    "CURRENCY_MISMATCH",
    "BATCH_SETTLEMENT_DISCREPANCY",
    "UNKNOWN_INSUFFICIENT_EVIDENCE",
  ]),
  evidence_considered: z.array(z.string()).min(1),
  field_level_comparisons: z.array(
    z.object({
      field_name: z.string(),
      ledger_value: z.string().nullable(),
      external_value: z.string().nullable(),
      observation: z.string(),
      evidence_ids: z.array(z.string()),
    })
  ),
  possible_explanations: z.array(
    z.object({
      hypothesis: z.string(),
      supporting_evidence_ids: z.array(z.string()),
      confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    })
  ),
  recommended_next_checks: z.array(z.string()).min(1),
  uncertainty: z.string(),
  missing_evidence: z.array(z.string()),
  disclaimer: z.literal("AI-generated suggestion. Requires analyst judgment. No financial action taken."),
});
