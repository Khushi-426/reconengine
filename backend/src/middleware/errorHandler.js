import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";
import { config } from "../config/env.js";

// Maps known Postgres error codes to safe, user-facing messages.
// Never leak raw DB error text (schema names, constraint internals) to the client.
const PG_ERROR_MAP = {
  "23505": { status: 409, message: "A record with these details already exists." }, // unique_violation
  "23503": { status: 409, message: "This action references a record that does not exist." }, // fk_violation
  "23514": { status: 422, message: "The submitted data violates a business rule." }, // check_violation
  "40001": { status: 409, message: "The record was modified concurrently. Please retry." }, // serialization_failure
};

export function notFoundHandler(req, res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let code = err.code;

  if (err.code && PG_ERROR_MAP[err.code]) {
    statusCode = PG_ERROR_MAP[err.code].status;
    message = PG_ERROR_MAP[err.code].message;
    code = err.code;
  }

  const logPayload = {
    err,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.userId,
  };

  if (statusCode >= 500) {
    logger.error(logPayload, "Unhandled server error");
  } else {
    logger.warn(logPayload, "Request error");
  }

  res.status(statusCode).json({
    error: {
      message,
      code: code || undefined,
      details: err.isOperational ? err.details : undefined,
      // stack only ever shown outside production, and only for real bugs
      stack: config.env !== "production" && statusCode >= 500 ? err.stack : undefined,
    },
  });
}
