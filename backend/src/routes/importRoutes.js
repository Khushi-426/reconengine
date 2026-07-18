import { Router } from "express";
import multer from "multer";
import { idempotencyKeyGuard } from "../middleware/idempotencyMiddleware.js";
import { uploadStatementHandler, uploadInternalLedgerHandler, listImportBatchesHandler } from "../controllers/importController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { bulkImportLimiter } from "../middleware/rateLimiter.js";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const upload = multer({
  storage: multer.memoryStorage(), // never write untrusted files to disk unparsed
  limits: { fileSize: config.upload.maxFileSizeBytes },
  fileFilter: (req, file, cb) => {
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      return cb(new AppError(422, `Unsupported file type: ${file.mimetype}. Only CSV is accepted.`));
    }
    cb(null, true);
  },
});

const router = Router();

router.use(authenticate);
router.use(idempotencyKeyGuard);

router.post(
  "/statements",
  authorize("ANALYST", "APPROVER", "ADMIN"),
  bulkImportLimiter,
  upload.single("file"),
  uploadStatementHandler
);

router.post(
  "/ledger",
  authorize("ADMIN"),
  bulkImportLimiter,
  upload.single("file"),
  uploadInternalLedgerHandler
);

router.get(
  "/batches",
  authorize("ANALYST", "APPROVER", "ADMIN", "AUDITOR"),
  listImportBatchesHandler
);

export default router;
