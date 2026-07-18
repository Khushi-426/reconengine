import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";
import {
  findUserByEmail,
  incrementFailedAttempts,
  resetFailedAttempts,
  createUserSession,
  findValidSession,
  rotateUserSession,
  revokeSessionByHash,
  revokeAllUserSessions,
} from "../repositories/usersRepository.js";
import { query } from "../config/db.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: user.user_id, role: user.role_name, email: user.email, sid: sessionId },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
}

async function issueSession(userId, ipAddress, userAgent) {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000);
  const sessionId = await createUserSession({ userId, tokenHash, expiresAt, ipAddress, userAgent });
  return { raw, sessionId, expiresAt };
}

export async function login(email, password, ipAddress, userAgent) {
  const user = await findUserByEmail(email);

  // 1. Account Lockout Check
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    const waitMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    logger.warn({ email, waitMin }, "Security lockout block triggered");
    throw new AppError(423, `Account temporarily locked due to failed attempts. Try again in ${waitMin} minutes.`, "ACCOUNT_LOCKED");
  }

  const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h6PGZm4Q0Ib3Rv3.p9v2rQ6f6Yz3S";
  const passwordMatches = await bcrypt.compare(password, user?.password_hash || dummyHash);

  // 2. Authentication failure path
  if (!user || !user.is_active || !passwordMatches) {
    if (user && user.is_active) {
      await incrementFailedAttempts(user.user_id);
      logger.warn({ email, userId: user.user_id }, "Failed login attempt logged");
    }
    throw new AppError(401, "Invalid email or password");
  }

  // 3. Success path: Reset failed counter
  await resetFailedAttempts(user.user_id);

  // 4. Create stateful session
  const { raw: refreshToken, sessionId } = await issueSession(user.user_id, ipAddress, userAgent);
  const accessToken = issueAccessToken(user, sessionId);

  logger.info({ email, userId: user.user_id, sessionId }, "Stateful user session established");

  return {
    accessToken,
    refreshToken,
    user: { id: user.user_id, email: user.email, fullName: user.full_name, role: user.role_name },
  };
}

export async function refresh(rawRefreshToken, ipAddress, userAgent) {
  const tokenHash = hashToken(rawRefreshToken);
  const session = await findValidSession(tokenHash);

  if (!session) {
    // Replay attack check: if token was used but is now invalid/revoked
    const reused = await query("SELECT user_id, session_id FROM user_sessions WHERE refresh_token_hash = $1", [tokenHash]);
    if (reused.rowCount > 0) {
      const row = reused.rows[0];
      logger.fatal({ userId: row.user_id, sessionId: row.session_id }, "Refresh token reuse detected! Replay attack alert: revoking all active sessions.");
      await revokeAllUserSessions(row.user_id);
    }
    throw new AppError(401, "Invalid or expired refresh token");
  }

  // Rotate token: generate new token, update session hash
  const raw = crypto.randomBytes(48).toString("hex");
  const newTokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000);

  await rotateUserSession({
    sessionId: session.session_id,
    oldTokenHash: tokenHash,
    newTokenHash,
    expiresAt,
  });

  const user = { user_id: session.user_id, email: session.email, role_name: session.role_name };
  const accessToken = issueAccessToken(user, session.session_id);

  logger.info({ userId: session.user_id, sessionId: session.session_id }, "Session rotated successfully");

  return { accessToken, refreshToken: raw };
}

export async function logout(rawRefreshToken) {
  await revokeSessionByHash(hashToken(rawRefreshToken));
}

export async function hashPassword(plain) {
  // Complex password regex check
  const complex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  if (!complex.test(plain)) {
    throw new AppError(422, "Password must be at least 8 characters, and contain at least one uppercase letter, one lowercase letter, one number, and one special character.", "PASSWORD_COMPLEXITY_FAILED");
  }
  return bcrypt.hash(plain, 12);
}
