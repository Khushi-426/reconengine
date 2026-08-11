import { query } from "../config/db.js";

export async function claimIdempotencyKey({
  keyHash,
  userId,
  requestMethod,
  requestPath,
  requestFingerprint,
}) {
  const insertResult = await query(
    `INSERT INTO idempotency_keys (
       key_hash, user_id, request_method, request_path, request_fingerprint, status, created_at
     )
     VALUES ($1, $2, $3, $4, $5, 'PROCESSING', now())
     ON CONFLICT (key_hash) DO NOTHING
     RETURNING key_hash, status, response_code, response_body, request_fingerprint`,
    [keyHash, userId, requestMethod, requestPath, requestFingerprint]
  );

  if (insertResult.rowCount > 0) {
    return { inserted: true, record: insertResult.rows[0] };
  }

  const existing = await query(
    `SELECT key_hash, status, response_code, response_body, request_fingerprint
     FROM idempotency_keys
     WHERE key_hash = $1`,
    [keyHash]
  );

  return { inserted: false, record: existing.rows[0] || null };
}

export async function completeIdempotencyKey({ keyHash, responseCode, responseBody }) {
  await query(
    `UPDATE idempotency_keys
     SET status = 'COMPLETED',
         response_code = $1,
         response_body = $2::jsonb,
         completed_at = now()
     WHERE key_hash = $3`,
    [responseCode, JSON.stringify(responseBody), keyHash]
  );
}

export async function releaseIdempotencyKey(keyHash) {
  await query("DELETE FROM idempotency_keys WHERE key_hash = $1 AND status = 'PROCESSING'", [keyHash]);
}
