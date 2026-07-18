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
  markBatchCompleted,
  markBatchFailed,
  findImportBatches,
} from "../repositories/importRepository.js";

const MAX_ROWS_PER_IMPORT = 100000;

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
          `COPY staging_statement_lines (external_ref, account_ref, amount, currency, value_date, is_batched_settlement)
           FROM STDIN WITH CSV`
        )
      );

      // 3. Streaming CSV parsing & transformation to raw values
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
      let rowCount = 0;
      const formatter = new Transform({
        objectMode: true,
        transform(row, encoding, callback) {
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
          const isBatched = String(row.is_batched_settlement).toLowerCase() === "true" ? "true" : "false";

          const escapeCsv = (str) => {
            if (str == null || str === "") return "\\N";
            return str.replace(/"/g, '""');
          };

          const line = `"${escapeCsv(extRef)}","${escapeCsv(accRef)}",${amount ? amount : "\\N"},"${escapeCsv(curr)}","${escapeCsv(valDate)}",${isBatched}\n`;
          callback(null, line);
        }
      });

      // 4. Run stream pipeline
      try {
        await pipeline(Readable.from(fileBuffer), parser, formatter, copyStream);
      } catch (err) {
        if (err.message && err.message.includes("File exceeds maximum")) {
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
