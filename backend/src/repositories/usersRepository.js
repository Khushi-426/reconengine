import { query } from "../config/db.js";

export async function findUserByEmail(email) {
  const result = await query(
    `SELECT u.user_id, u.email, u.password_hash, u.full_name, u.is_active, r.role_name,
            u.failed_login_attempts, u.locked_until
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.email = $1 AND u.deleted_at IS NULL`,
    [email]
  );
  return result.rows[0] || null;
}

export async function findUserById(userId) {
  const result = await query(
    `SELECT u.user_id, u.email, u.full_name, r.role_name
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function incrementFailedAttempts(userId) {
  await query(
    `UPDATE users
     SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= 5 THEN 0 ELSE failed_login_attempts + 1 END,
         locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + INTERVAL '15 minutes' ELSE NULL END
     WHERE user_id = $1`,
    [userId]
  );
}

export async function resetFailedAttempts(userId) {
  await query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL
     WHERE user_id = $1`,
    [userId]
  );
}

export async function createUserSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
  const result = await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING session_id`,
    [userId, tokenHash, ipAddress, userAgent, expiresAt]
  );
  return result.rows[0].session_id;
}

export async function findValidSession(tokenHash) {
  const result = await query(
    `SELECT s.session_id, s.user_id, u.email, r.role_name, u.is_active
     FROM user_sessions s
     JOIN users u ON u.user_id = s.user_id
     JOIN roles r ON r.role_id = u.role_id
     WHERE s.refresh_token_hash = $1 AND s.is_revoked = FALSE AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function rotateUserSession({ sessionId, oldTokenHash, newTokenHash, expiresAt }) {
  await query(
    `UPDATE user_sessions
     SET refresh_token_hash = $1, expires_at = $2, updated_at = now()
     WHERE session_id = $3 AND refresh_token_hash = $4`,
    [newTokenHash, expiresAt, sessionId, oldTokenHash]
  );
}

export async function revokeSessionByHash(tokenHash) {
  await query(
    `UPDATE user_sessions SET is_revoked = TRUE, updated_at = now() WHERE refresh_token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeAllUserSessions(userId) {
  await query(
    `UPDATE user_sessions SET is_revoked = TRUE, updated_at = now() WHERE user_id = $1`,
    [userId]
  );
}
