import { withTransaction } from "../config/db.js";
import { getExceptionEvidence, computeDeterministicHints } from "./aiEvidenceService.js";
import { callModelProvider } from "./aiClientService.js";
import { AppError } from "../utils/AppError.js";

/**
 * Investigates an exception break under the requesting user's security context.
 * Performs deterministic hint calculations and optional model synthesis.
 * Records the investigation in the audit trail.
 */
export async function investigateException({ exceptionId, userId, userRole, correlationId }) {
  return withTransaction(
    async (client) => {
      // 1. Fetch authorized evidence
      const evidenceBundle = await getExceptionEvidence(client, {
        exceptionId,
        userId,
        userRole,
      });

      // 2. Authoritative deterministic hint calculations
      const deterministicHints = computeDeterministicHints(evidenceBundle);

      // 3. AI Model / Fallback Call
      const aiOutcome = await callModelProvider({
        evidenceBundle,
        deterministicHints,
        correlationId,
      });

      // 4. Record investigation result in append-only table
      const insertSql = `
        INSERT INTO ai_investigations (
          exception_id, requester_id, prompt_version, provider, model, status,
          discrepancy_category, result_payload, deterministic_hints, evidence_ids,
          tokens_prompt, tokens_completion, latency_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING investigation_id, created_at
      `;
      const insertRes = await client.query(insertSql, [
        exceptionId,
        userId,
        aiOutcome.promptVersion,
        aiOutcome.provider,
        aiOutcome.model,
        aiOutcome.status,
        aiOutcome.result.suspected_category,
        JSON.stringify(aiOutcome.result),
        JSON.stringify(deterministicHints),
        JSON.stringify(evidenceBundle.evidenceIds),
        aiOutcome.tokensPrompt,
        aiOutcome.tokensCompletion,
        aiOutcome.latencyMs,
      ]);

      const investigationId = insertRes.rows[0].investigation_id;

      return {
        investigationId,
        exceptionId,
        status: aiOutcome.status,
        provider: aiOutcome.provider,
        model: aiOutcome.model,
        promptVersion: aiOutcome.promptVersion,
        deterministicHints,
        evidenceBundle: {
          evidenceIds: evidenceBundle.evidenceIds,
          ledgerTxn: evidenceBundle.ledgerTxn,
          externalLine: evidenceBundle.externalLine,
          candidateDuplicates: evidenceBundle.candidateDuplicates,
        },
        aiAnalysis: aiOutcome.result,
        latencyMs: aiOutcome.latencyMs,
        createdAt: insertRes.rows[0].created_at,
      };
    },
    { userId, userRole }
  );
}

/**
 * Records analyst usefulness feedback on an AI investigation.
 */
export async function recordInvestigationFeedback({ investigationId, userId, userRole, isUseful, comment }) {
  return withTransaction(
    async (client) => {
      // Confirm existence & access
      const invRes = await client.query(
        `SELECT investigation_id, exception_id FROM ai_investigations WHERE investigation_id = $1`,
        [investigationId]
      );
      if (invRes.rowCount === 0) {
        throw new AppError(404, "Investigation not found", "INVESTIGATION_NOT_FOUND");
      }

      const insertSql = `
        INSERT INTO ai_investigation_feedback (investigation_id, user_id, is_useful, comment)
        VALUES ($1, $2, $3, $4)
        RETURNING feedback_id, created_at
      `;
      const res = await client.query(insertSql, [
        investigationId,
        userId,
        isUseful,
        comment ? comment.trim() : null,
      ]);

      return res.rows[0];
    },
    { userId, userRole }
  );
}
