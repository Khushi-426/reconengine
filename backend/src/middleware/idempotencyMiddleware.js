import crypto from "crypto";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
} from "../repositories/idempotencyRepository.js";

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return value.map(stableSerialize);
  }
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSerialize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function buildRequestFingerprint(req) {
  const payload = {
    body: stableSerialize(req.body || {}),
    query: stableSerialize(req.query || {}),
    file: req.file
      ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          bufferHash: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
        }
      : null,
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

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
  const fingerprint = buildRequestFingerprint(req);
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${req.method}:${path}:${key}`)
    .digest("hex");

  try {
    const { inserted, record } = await claimIdempotencyKey({
      keyHash: hash,
      userId,
      requestMethod: req.method,
      requestPath: path,
      requestFingerprint: fingerprint,
    });

    if (!inserted && record) {
      if (record.request_fingerprint !== fingerprint) {
        return next(
          new AppError(
            409,
            "This idempotency key has already been used with a different request payload.",
            "IDEMPOTENCY_PAYLOAD_MISMATCH"
          )
        );
      }

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

    // Intercept response methods to cache result on completion
    const originalJson = res.json;
    res.json = function (body) {
      const statusCode = res.statusCode;

      // Only cache successful or client validation responses (avoid caching server error states)
      if (statusCode < 500) {
        completeIdempotencyKey({
          keyHash: hash,
          responseCode: statusCode,
          responseBody: body,
        }).catch((err) => {
          logger.error({ err, key }, "Failed to complete idempotency cache write");
        });
      } else {
        // If server failed, clear key so user can try again
        releaseIdempotencyKey(hash).catch((err) => {
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
