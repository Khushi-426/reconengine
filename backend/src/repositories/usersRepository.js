import { query } from "../config/db.js";

export async function findUserByEmail(email) {
  const result = await query(
    `SELECT u.user_id, u.email, u.password_hash, u.full_name, u.is_active, r.role_name
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

export async function createRefreshToken({ userId, tokenHash, expiresAt }) {
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function findValidRefreshToken(tokenHash) {
  const result = await query(
    `SELECT rt.token_id, rt.user_id, u.email, r.role_name
     FROM refresh_tokens rt
     JOIN users u ON u.user_id = rt.user_id
     JOIN roles r ON r.role_id = u.role_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function revokeRefreshToken(tokenHash) {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [tokenHash]);
}
