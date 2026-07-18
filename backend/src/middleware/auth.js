import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

/**
 * Verifies the JWT access token and attaches { userId, role } to req.user.
 * Rejects expired/invalid tokens with 401.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing or malformed Authorization header"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { userId: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new AppError(401, "Access token expired", "TOKEN_EXPIRED"));
    }
    return next(new AppError(401, "Invalid access token"));
  }
}

/**
 * Role-based authorization. Usage: authorize('ADMIN', 'APPROVER')
 * Must run after authenticate().
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, "Not authenticated"));
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(403, `Role '${req.user.role}' is not permitted to perform this action`)
      );
    }
    next();
  };
}
