import { Router } from "express";
import { idempotencyKeyGuard } from "../middleware/idempotencyMiddleware.js";
import {
  listExceptionsHandler,
  resolveExceptionHandler,
  assignExceptionHandler,
  trendReportHandler,
  startWorkExceptionHandler,
  approveExceptionHandler,
  closeExceptionHandler,
} from "../controllers/exceptionsController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  listExceptionsQuerySchema,
  resolveExceptionSchema,
  assignExceptionSchema,
  exceptionIdParamSchema,
  workflowActionSchema,
} from "../utils/schemas.js";

const router = Router();

router.use(authenticate); // every route below requires a valid JWT
router.use(idempotencyKeyGuard);

router.get("/", validate({ query: listExceptionsQuerySchema }), listExceptionsHandler);
router.get("/reports/trend", trendReportHandler);

router.patch(
  "/:exceptionId/start-work",
  authorize("ANALYST", "APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema }),
  startWorkExceptionHandler
);

router.patch(
  "/:exceptionId/resolve",
  authorize("ANALYST", "APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: resolveExceptionSchema }),
  resolveExceptionHandler
);

router.patch(
  "/:exceptionId/approve",
  authorize("APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: workflowActionSchema }),
  approveExceptionHandler
);

router.patch(
  "/:exceptionId/close",
  authorize("APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: workflowActionSchema }),
  closeExceptionHandler
);

router.patch(
  "/:exceptionId/assign",
  authorize("APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: assignExceptionSchema }),
  assignExceptionHandler
);

export default router;
