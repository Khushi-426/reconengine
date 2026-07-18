import { Router } from "express";
import { triggerRunHandler, listRunsHandler } from "../controllers/reconciliationController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { triggerRunSchema } from "../utils/schemas.js";

const router = Router();

router.post(
  "/runs",
  authenticate,
  authorize("APPROVER", "ADMIN"),
  validate({ body: triggerRunSchema }),
  triggerRunHandler
);

router.get(
  "/runs",
  authenticate,
  authorize("ANALYST", "APPROVER", "ADMIN", "AUDITOR"),
  listRunsHandler
);

export default router;
