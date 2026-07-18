import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { query } from "../config/db.js";

/**
 * Verifies the JWT access token and validates the stateful session in DB.
 * Rejects expired/invalid/revoked sessions with 401.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing or malformed Authorization header"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    
    // Validate session state in DB (for real-time revocation support)
    if (payload.sid) {
      const sessionCheck = await query(
        "SELECT session_id FROM user_sessions WHERE session_id = $1 AND is_revoked = FALSE AND expires_at > now()",
        [payload.sid]
      );
      if (sessionCheck.rowCount === 0) {
        return next(new AppError(401, "Session has been revoked or expired", "SESSION_REVOKED"));
      }
    }

    req.user = { userId: payload.sub, role: payload.role, email: payload.email, sessionId: payload.sid };
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
