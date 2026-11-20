import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  buildInvestigationPrompt,
  sanitizeAndValidateModelOutput,
  generateDeterministicFallback,
} from "./aiPromptService.js";

/**
 * Model provider adapter with bounded timeout, retries, and strict feature flag isolation.
 */
export async function callModelProvider({ evidenceBundle, deterministicHints, correlationId }) {
  if (!config.ai.enabled || config.ai.provider === "mock") {
    logger.info({ correlationId, aiEnabled: config.ai.enabled, provider: config.ai.provider }, "Using deterministic fallback assistant");
    return {
      status: config.ai.enabled ? "SUCCESS" : "FALLBACK_DETERMINISTIC",
      provider: config.ai.provider,
      model: config.ai.model,
      promptVersion: config.ai.promptVersion,
      result: generateDeterministicFallback(evidenceBundle, deterministicHints),
      tokensPrompt: 120,
      tokensCompletion: 85,
      latencyMs: 15,
      droppedClaimsCount: 0,
    };
  }

  const { systemInstructions, userContext, version } = buildInvestigationPrompt(
    evidenceBundle,
    deterministicHints
  );

  const startTime = Date.now();
  let attempts = 0;
  const maxRetries = config.ai.maxRetries;

  while (attempts <= maxRetries) {
    attempts++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.ai.timeoutMs);

    try {
      let rawJson = null;
      let promptTokens = 0;
      let completionTokens = 0;

      if (config.ai.provider === "gemini") {
        // Direct HTTPS call to Gemini API endpoint
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.model}:generateContent?key=${config.ai.apiKey}`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${systemInstructions}\n\n${userContext}` }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 1200,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Gemini HTTP error ${response.status}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        promptTokens = data?.usageMetadata?.promptTokenCount || 0;
        completionTokens = data?.usageMetadata?.candidatesTokenCount || 0;
        rawJson = JSON.parse(text);
      } else {
        throw new Error(`Unsupported AI provider: ${config.ai.provider}`);
      }

      // Validate & Ground claims
      const { validatedOutput, droppedClaimsCount } = sanitizeAndValidateModelOutput(
        rawJson,
        evidenceBundle.evidenceIds
      );

      const latencyMs = Date.now() - startTime;
      logger.info(
        {
          correlationId,
          provider: config.ai.provider,
          model: config.ai.model,
          promptVersion: version,
          tokensPrompt: promptTokens,
          tokensCompletion: completionTokens,
          latencyMs,
          droppedClaimsCount,
        },
        "AI investigation completed successfully"
      );

      return {
        status: "SUCCESS",
        provider: config.ai.provider,
        model: config.ai.model,
        promptVersion: version,
        result: validatedOutput,
        tokensPrompt: promptTokens,
        tokensCompletion: completionTokens,
        latencyMs,
        droppedClaimsCount,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      logger.warn(
        { correlationId, attempt: attempts, err: err.message },
        "AI provider request failed or timed out"
      );

      if (attempts > maxRetries) {
        const latencyMs = Date.now() - startTime;
        logger.error({ correlationId, latencyMs }, "Falling back to authoritative deterministic breakdown");
        return {
          status: "PROVIDER_ERROR",
          provider: config.ai.provider,
          model: config.ai.model,
          promptVersion: version,
          result: generateDeterministicFallback(evidenceBundle, deterministicHints),
          tokensPrompt: 0,
          tokensCompletion: 0,
          latencyMs,
          droppedClaimsCount: 0,
        };
      }
    }
  }
}
