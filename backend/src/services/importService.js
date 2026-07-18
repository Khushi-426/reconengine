import crypto from "crypto";
import { parse } from "csv-parse";
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import { withTransaction } from "../config/db.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";
import {
  createImportBatch,
  assertExternalImportSource,
  markBatchCompleted,
  markBatchFailed,
  findImportBatches,
  createLedgerStagingTable,
  validateLedgerStagingRecords,
  insertLedgerFromStaging,
} from "../repositories/importRepository.js";

const MAX_ROWS_PER_IMPORT = 100000;
const REQUIRED_HEADERS = ["external_ref", "account_ref", "amount", "currency", "value_date"];
const LEDGER_REQUIRED_HEADERS = ["txn_ref", "account_ref", "txn_type", "amount", "currency", "value_date"];

function assertRequiredHeaders(record) {
  const headers = Object.keys(record || {}).map((header) => header.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new AppError(422, `CSV is missing required column(s): ${missing.join(", ")}`, "CSV_HEADER_ERROR");
  }
}

function assertLedgerHeaders(record) {
  const headers = Object.keys(record || {}).map((header) => header.trim().toLowerCase());
  const missing = LEDGER_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new AppError(422, `Ledger CSV is missing required column(s): ${missing.join(", ")}`, "CSV_HEADER_ERROR");
  }
}

/**
 * Ingests an external statement CSV using streaming COPY protocol.
 * High-performance database-driven validation over temporary staging table.
 */
export async function importExternalStatement({ fileBuffer, fileName, sourceId, uploadedBy }) {
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  // Check duplicate import batch hash first
  let batchId;
  try {
    batchId = await withTransaction(async (client) => {
      await assertExternalImportSource(client, sourceId);
      return createImportBatch(client, { sourceId, fileName, fileHash, uploadedBy });
    }, { userId: uploadedBy });
  } catch (err) {
    throw err;
  }

  try {
    const result = await withTransaction(async (client) => {
      // 1. Create temporary staging table (dropped on commit/rollback automatically)
      await import("../repositories/importRepository.js").then((r) => r.createStagingTable(client));

      // 2. Obtain standard CSV streaming pipeline target
      const copyStream = client.query(
        copyFrom(
          `COPY staging_statement_lines (external_ref, account_ref, amount, currency, value_date, settlement_date, is_batched_settlement)
           FROM STDIN WITH (FORMAT CSV, NULL '\\N')`
        )
      );

      // 3. Streaming CSV parsing & transformation to raw values
      const parser = parse({ columns: (headers) => headers.map((header) => header.trim().toLowerCase()), skip_empty_lines: true, trim: true });
      let rowCount = 0;
      const formatter = new Transform({
        objectMode: true,
        transform(row, encoding, callback) {
          if (rowCount === 0) {
            try {
              assertRequiredHeaders(row);
            } catch (err) {
              callback(err);
              return;
            }
          }
          rowCount++;
          if (rowCount > MAX_ROWS_PER_IMPORT) {
            callback(new AppError(422, `File exceeds maximum of ${MAX_ROWS_PER_IMPORT} rows per import`));
            return;
          }

          const extRef = row.external_ref ? row.external_ref.trim() : "";
          const accRef = row.account_ref ? row.account_ref.trim() : "";
          const amount = row.amount ? row.amount.trim() : "";
          const curr = row.currency ? row.currency.trim() : "";
          const valDate = row.value_date ? row.value_date.trim() : "";
          const settlementDate = row.settlement_date ? row.settlement_date.trim() : "";
          const isBatched = String(row.is_batched_settlement).toLowerCase() === "true" ? "true" : "false";

          const escapeCsv = (str) => {
            if (str == null || str === "") return "\\N";
            return str.replace(/"/g, '""');
          };
          const csvText = (str) => (str === "\\N" ? str : `"${str}"`);

          const line = `${csvText(escapeCsv(extRef))},${csvText(escapeCsv(accRef))},${amount || "\\N"},${csvText(escapeCsv(curr))},${csvText(escapeCsv(valDate))},${csvText(escapeCsv(settlementDate))},${isBatched}\n`;
          callback(null, line);
        }
      });

      // 4. Run stream pipeline
      try {
        await pipeline(Readable.from(fileBuffer), parser, formatter, copyStream);
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        throw new AppError(422, `Malformed CSV file: ${err.message}`);
      }

      if (rowCount === 0) {
        throw new AppError(422, "CSV file contains no data rows");
      }

      // 5. Run bulk set-based DB validations
      const validationErrors = await import("../repositories/importRepository.js").then((r) => r.validateStagingRecords(client));
      if (validationErrors.length > 0) {
        const errorMsg = `CSV validation failed:\n${validationErrors.slice(0, 50).join("\n")}`;
        throw new AppError(422, "CSV validation failed", "CSV_VALIDATION_ERROR", validationErrors.slice(0, 50));
      }

      // 6. Insert from staging to main statement lines table
      const inserted = await import("../repositories/importRepository.js").then((r) => r.insertFromStagingToMain(client, batchId, sourceId));
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

/** Imports ledger data as a new immutable internal batch. Existing ledger rows
 * are deliberately never overwritten: adjustments must be supplied as a new
 * file so completed reconciliations remain auditable. */
export async function importInternalLedger({ fileBuffer, fileName, uploadedBy }) {
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const batchId = await withTransaction(
    (client) => createImportBatch(client, { sourceId: 1, fileName, fileHash, uploadedBy }),
    { userId: uploadedBy }
  );

  try {
    const result = await withTransaction(async (client) => {
      await createLedgerStagingTable(client);
      const copyStream = client.query(copyFrom(
        `COPY staging_ledger_transactions (txn_ref, account_ref, txn_type, amount, currency, value_date, counterparty, narrative)
         FROM STDIN WITH (FORMAT CSV, NULL '\\N')`
      ));
      const parser = parse({ columns: (headers) => headers.map((header) => header.trim().toLowerCase()), skip_empty_lines: true, trim: true });
      let rowCount = 0;
      const formatter = new Transform({
        objectMode: true,
        transform(row, encoding, callback) {
          if (rowCount === 0) {
            try { assertLedgerHeaders(row); } catch (err) { callback(err); return; }
          }
          rowCount++;
          if (rowCount > MAX_ROWS_PER_IMPORT) {
            callback(new AppError(422, `File exceeds maximum of ${MAX_ROWS_PER_IMPORT} rows per import`));
            return;
          }
          const value = (input) => {
            const text = input == null ? "" : String(input).trim();
            return text === "" ? "\\N" : `"${text.replace(/"/g, '""')}"`;
          };
          callback(null, `${value(row.txn_ref)},${value(row.account_ref)},${value(row.txn_type)},${row.amount ? String(row.amount).trim() : "\\N"},${value(row.currency)},${value(row.value_date)},${value(row.counterparty)},${value(row.narrative)}\n`);
        },
      });

      try {
        await pipeline(Readable.from(fileBuffer), parser, formatter, copyStream);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(422, `Malformed ledger CSV file: ${err.message}`);
      }
      if (rowCount === 0) throw new AppError(422, "CSV file contains no data rows");

      const validationErrors = await validateLedgerStagingRecords(client);
      if (validationErrors.length) throw new AppError(422, "Ledger CSV validation failed", "CSV_VALIDATION_ERROR", validationErrors.slice(0, 50));
      const rowsImported = await insertLedgerFromStaging(client, batchId);
      await markBatchCompleted(client, batchId, rowsImported);
      return { batchId, rowsImported };
    }, { userId: uploadedBy });
    return result;
  } catch (err) {
    await withTransaction((client) => markBatchFailed(client, batchId, err.message), { userId: uploadedBy }).catch((failedErr) => {
      logger.error({ failedErr, batchId }, "Failed to mark internal ledger batch as failed");
    });
    throw err;
  }
}
