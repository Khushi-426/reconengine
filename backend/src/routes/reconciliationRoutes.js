import { Router } from "express";
import { triggerRunHandler, listRunsHandler, getJobStatusHandler } from "../controllers/reconciliationController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { triggerRunSchema } from "../utils/schemas.js";
import { idempotencyKeyGuard } from "../middleware/idempotencyMiddleware.js";

const router = Router();

router.use(authenticate);
router.use(idempotencyKeyGuard);

router.post(
  "/runs",
  authorize("APPROVER", "ADMIN"),
  validate({ body: triggerRunSchema }),
  triggerRunHandler
);

router.get(
  "/runs",
  authorize("ANALYST", "APPROVER", "ADMIN", "AUDITOR"),
  listRunsHandler
);

router.get(
  "/jobs/:jobId",
  getJobStatusHandler
);

export default router;
