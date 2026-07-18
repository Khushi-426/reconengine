import crypto from "crypto";
import { query } from "../config/db.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";

/**
 * Express middleware to enforce request idempotency.
 * Intercepts duplicate POST/PATCH/PUT requests containing the Idempotency-Key header.
 */
export async function idempotencyKeyGuard(req, res, next) {
  const key = req.headers["idempotency-key"];
  
  // Non-mutating methods or requests missing the key are bypassed
  if (!key || !["POST", "PATCH", "PUT"].includes(req.method)) {
    return next();
  }

  const userId = req.user?.userId || "anonymous";
  const path = req.originalUrl;
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${req.method}:${path}:${key}`)
    .digest("hex");

  try {
    // Check if key hash is already in progress or completed
    const existing = await query(
      "SELECT status, response_code, response_body FROM idempotency_keys WHERE key_hash = $1",
      [hash]
    );

    if (existing.rowCount > 0) {
      const record = existing.rows[0];
      if (record.status === "PROCESSING") {
        logger.warn({ key, path }, "Duplicate request detected - in progress");
        return next(
          new AppError(
            409,
            "A request with this idempotency key is already being processed.",
            "IDEMPOTENCY_IN_PROGRESS"
          )
        );
      }

      if (record.status === "COMPLETED") {
        logger.info({ key, path }, "Duplicate request detected - returning cached response");
        return res
          .status(record.response_code)
          .set("X-Cache-Idempotency", "true")
          .json(record.response_body);
      }
    }

    // Insert key in PROCESSING status
    await query(
      "INSERT INTO idempotency_keys (key_hash, status, created_at) VALUES ($1, 'PROCESSING', now())",
      [hash]
    );

    // Intercept response methods to cache result on completion
    const originalJson = res.json;
    res.json = function (body) {
      const statusCode = res.statusCode;

      // Only cache successful or client validation responses (avoid caching server error states)
      if (statusCode < 500) {
        query(
          "UPDATE idempotency_keys SET status = 'COMPLETED', response_code = $1, response_body = $2::jsonb, completed_at = now() WHERE key_hash = $3",
          [statusCode, JSON.stringify(body), hash]
        ).catch((err) => {
          logger.error({ err, key }, "Failed to complete idempotency cache write");
        });
      } else {
        // If server failed, clear key so user can try again
        query("DELETE FROM idempotency_keys WHERE key_hash = $1", [hash]).catch((err) => {
          logger.error({ err, key }, "Failed to clear failed request idempotency key");
        });
      }

      return originalJson.apply(this, arguments);
    };

    next();
  } catch (err) {
    logger.error({ err, key }, "Idempotency check error");
    next(err);
  }
}
