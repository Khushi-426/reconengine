import crypto from "crypto";

/**
 * Middleware to trace requests using Correlation IDs.
 * If the incoming request has a correlation ID, we preserve it;
 * otherwise we generate a new UUID and inject it.
 */
export function correlationIdMiddleware(req, res, next) {
  const correlationId =
    req.headers["x-correlation-id"] ||
    req.headers["x-request-id"] ||
    crypto.randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-ID", correlationId);

  next();
}
