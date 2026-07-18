import * as importService from "../services/importService.js";
import { AppError } from "../utils/AppError.js";

export async function uploadStatementHandler(req, res, next) {
  try {
    if (!req.file) throw new AppError(400, "No file uploaded (expected field name 'file')");

    const { sourceId } = req.body;
    if (!sourceId) throw new AppError(422, "sourceId is required");
    const parsedSourceId = Number(sourceId);
    if (!Number.isInteger(parsedSourceId)) throw new AppError(422, "sourceId must be an integer");

    const result = await importService.importExternalStatement({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      sourceId: parsedSourceId,
      uploadedBy: req.user.userId,
    });

    res.status(201).json({
      message: `Successfully imported ${result.rowsImported} rows`,
      batchId: result.batchId,
      rowsImported: result.rowsImported,
    });
  } catch (err) {
    next(err);
  }
}

export async function listImportBatchesHandler(req, res, next) {
  try {
    const { page, pageSize } = req.query;
    const result = await importService.listImportBatches({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 25,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function uploadInternalLedgerHandler(req, res, next) {
  try {
    if (!req.file) throw new AppError(400, "No file uploaded (expected field name 'file')");
    const result = await importService.importInternalLedger({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      uploadedBy: req.user.userId,
    });
    res.status(201).json({
      message: `Successfully imported ${result.rowsImported} internal ledger rows`,
      batchId: result.batchId,
      rowsImported: result.rowsImported,
    });
  } catch (err) {
    next(err);
  }
}
