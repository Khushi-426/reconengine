import crypto from "crypto";
import { parse } from "csv-parse/sync";
import { withTransaction } from "../config/db.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";
import {
  createImportBatch,
  markBatchCompleted,
  markBatchFailed,
  bulkInsertExternalLines,
  findImportBatches,
} from "../repositories/importRepository.js";

const REQUIRED_COLUMNS = ["external_ref", "account_ref", "amount", "currency", "value_date"];
const MAX_ROWS_PER_IMPORT = 100000;

function validateRow(row, lineNumber) {
  const errors = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!row[col] || String(row[col]).trim() === "") {
      errors.push(`Row ${lineNumber}: missing required column '${col}'`);
    }
  }
  if (row.amount && (isNaN(Number(row.amount)) || Number(row.amount) <= 0)) {
    errors.push(`Row ${lineNumber}: amount must be a positive number, got '${row.amount}'`);
  }
  if (row.value_date && isNaN(Date.parse(row.value_date))) {
    errors.push(`Row ${lineNumber}: invalid value_date '${row.value_date}'`);
  }
  if (row.currency && !/^[A-Z]{3}$/.test(row.currency)) {
    errors.push(`Row ${lineNumber}: currency must be a 3-letter ISO code, got '${row.currency}'`);
  }
  return errors;
}

/**
 * Ingests an external statement CSV as a SINGLE ATOMIC TRANSACTION.
 *
 * Guarantees (this is the ACID centerpiece of the whole system):
 *  - Atomicity: if row 40,000 of 50,000 fails validation, or the DB throws
 *    partway through, NOTHING from this file is persisted — no partial imports.
 *  - Consistency: FK constraints (account_ref must resolve) + CHECK constraints
 *    (amount > 0, currency format) are enforced by the schema itself, not just app code.
 *  - Isolation: runs at the pool's default (READ COMMITTED); concurrent imports
 *    of different files don't block each other, but two imports of the *same*
 *    file hash correctly conflict via the DB unique constraint (idempotency).
 *  - Durability: once markBatchCompleted commits, the data survives a crash.
 */
export async function importExternalStatement({ fileBuffer, fileName, sourceId, uploadedBy }) {
  const csvText = fileBuffer.toString("utf-8");
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  let records;
  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    const errorMsg = `Malformed CSV file: ${err.message}`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, now(), now())`,
        [sourceId, fileName, fileHash, uploadedBy, errorMsg]
      );
    }, { userId: uploadedBy });
    throw new AppError(422, errorMsg);
  }

  if (records.length === 0) {
    const errorMsg = "CSV file contains no data rows";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, now(), now())`,
        [sourceId, fileName, fileHash, uploadedBy, errorMsg]
      );
    }, { userId: uploadedBy });
    throw new AppError(422, errorMsg);
  }

  if (records.length > MAX_ROWS_PER_IMPORT) {
    const errorMsg = `File exceeds maximum of ${MAX_ROWS_PER_IMPORT} rows per import`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, now(), now())`,
        [sourceId, fileName, fileHash, uploadedBy, errorMsg]
      );
    }, { userId: uploadedBy });
    throw new AppError(422, errorMsg);
  }

  const allErrors = [];
  records.forEach((row, idx) => allErrors.push(...validateRow(row, idx + 2)));
  if (allErrors.length > 0) {
    const errorMsg = `CSV validation failed:\n${allErrors.slice(0, 50).join("\n")}`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, now(), now())`,
        [sourceId, fileName, fileHash, uploadedBy, errorMsg]
      );
    }, { userId: uploadedBy });
    throw new AppError(422, "CSV validation failed", "CSV_VALIDATION_ERROR", allErrors.slice(0, 50));
  }

  let batchId;
  try {
    batchId = await withTransaction(async (client) => {
      return createImportBatch(client, { sourceId, fileName, fileHash, uploadedBy });
    }, { userId: uploadedBy });
  } catch (err) {
    throw err;
  }

  try {
    const result = await withTransaction(async (client) => {
      const rows = records.map((r) => ({
        externalRef: r.external_ref,
        accountRef: r.account_ref,
        amount: Number(r.amount),
        currency: r.currency.toUpperCase(),
        valueDate: r.value_date,
        isBatchedSettlement: String(r.is_batched_settlement).toLowerCase() === "true",
      }));

      const inserted = await bulkInsertExternalLines(client, batchId, sourceId, rows);
      await markBatchCompleted(client, batchId, inserted);

      return { batchId, rowsImported: inserted };
    }, { userId: uploadedBy });

    return result;
  } catch (err) {
    logger.error({ err, fileName }, "Import transaction failed and was rolled back");
    try {
      await withTransaction(async (client) => {
        await markBatchFailed(client, batchId, err.message);
      }, { userId: uploadedBy });
    } catch (failedErr) {
      logger.error({ failedErr }, "Failed to mark batch as failed in DB");
    }
    throw err;
  }
}

export async function listImportBatches(filters) {
  return findImportBatches(filters);
}
