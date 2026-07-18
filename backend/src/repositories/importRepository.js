import { AppError } from "../utils/AppError.js";
import { query } from "../config/db.js";

const BATCH_INSERT_CHUNK_SIZE = 1000;

/**
 * Registers an import batch. Relies on the UNIQUE (source_id, file_hash)
 * constraint in the schema to make re-uploading the exact same file a no-op
 * (idempotency) rather than double-importing — a common real-world bug when
 * an ops analyst accidentally uploads the same statement file twice.
 */
export async function createImportBatch(client, { sourceId, fileName, fileHash, uploadedBy }) {
  const existing = await client.query(
    `SELECT batch_id, status FROM import_batches WHERE source_id = $1 AND file_hash = $2`,
    [sourceId, fileHash]
  );
  if (existing.rowCount > 0) {
    throw new AppError(
      409,
      `This exact file was already imported (batch #${existing.rows[0].batch_id}, status: ${existing.rows[0].status}).`,
      "DUPLICATE_IMPORT"
    );
  }

  const result = await client.query(
    `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, started_at)
     VALUES ($1,$2,$3,$4,'PROCESSING', now())
     RETURNING batch_id`,
    [sourceId, fileName, fileHash, uploadedBy]
  );
  return result.rows[0].batch_id;
}

export async function markBatchCompleted(client, batchId, rowCount) {
  await client.query(
    `UPDATE import_batches SET status = 'COMPLETED', row_count = $1, completed_at = now() WHERE batch_id = $2`,
    [rowCount, batchId]
  );
}

export async function markBatchFailed(client, batchId, errorMessage) {
  await client.query(
    `UPDATE import_batches SET status = 'FAILED', error_message = $1, completed_at = now() WHERE batch_id = $2`,
    [errorMessage, batchId]
  );
}

/**
 * Bulk-inserts external statement lines in chunks using a single multi-row
 * INSERT per chunk (far faster than row-by-row inserts, while still running
 * inside the caller's transaction so a failure partway through rolls back
 * everything already inserted for this batch — no partial imports ever persist).
 */
export async function bulkInsertExternalLines(client, batchId, sourceId, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BATCH_INSERT_CHUNK_SIZE);
    const values = [];
    const placeholders = chunk
      .map((row, idx) => {
        const base = idx * 8;
        values.push(
          batchId,
          sourceId,
          row.externalRef,
          row.accountRef,
          row.amount,
          row.currency,
          row.valueDate,
          row.isBatchedSettlement || false
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
      })
      .join(",");

    await client.query(
      `INSERT INTO external_statement_lines
         (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
       VALUES ${placeholders}`,
      values
    );
    inserted += chunk.length;
  }
  return inserted;
}

export async function findImportBatches({ page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize;
  const sql = `
    SELECT
      ib.batch_id,
      ib.source_id,
      ib.file_name,
      ib.file_hash,
      ib.uploaded_by,
      ib.row_count,
      ib.status,
      ib.error_message,
      ib.started_at,
      ib.completed_at,
      ib.created_at,
      src.source_name,
      u.full_name AS uploaded_by_name,
      COUNT(*) OVER() AS total_count
    FROM import_batches ib
    JOIN import_sources src ON src.source_id = ib.source_id
    JOIN users u ON u.user_id = ib.uploaded_by
    ORDER BY ib.created_at DESC
    LIMIT $1 OFFSET $2
  `;
  const result = await query(sql, [pageSize, offset]);
  const total = result.rows[0]?.total_count ? parseInt(result.rows[0].total_count, 10) : 0;
  return {
    data: result.rows.map(({ total_count, ...row }) => row),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
