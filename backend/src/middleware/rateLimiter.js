import rateLimit from "express-rate-limit";
import { config } from "../config/env.js";

export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests. Please slow down." } },
});

// Bulk import (CSV upload / statement ingestion) is expensive and abusable —
// much stricter limit, keyed by authenticated user rather than IP alone.
export const bulkImportLimiter = rateLimit({
  windowMs: config.rateLimit.bulkImportWindowMs,
  max: config.rateLimit.bulkImportMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.ip,
  message: { error: { message: "Bulk import rate limit exceeded. Try again later." } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // brute-force login protection
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Try again later." } },
});
