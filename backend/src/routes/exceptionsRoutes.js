import { Router } from "express";
import {
  listExceptionsHandler,
  resolveExceptionHandler,
  assignExceptionHandler,
  trendReportHandler,
} from "../controllers/exceptionsController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  listExceptionsQuerySchema,
  resolveExceptionSchema,
  assignExceptionSchema,
  exceptionIdParamSchema,
} from "../utils/schemas.js";

const router = Router();

router.use(authenticate); // every route below requires a valid JWT

router.get("/", validate({ query: listExceptionsQuerySchema }), listExceptionsHandler);
router.get("/reports/trend", trendReportHandler);

router.patch(
  "/:exceptionId/resolve",
  authorize("ANALYST", "APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: resolveExceptionSchema }),
  resolveExceptionHandler
);

router.patch(
  "/:exceptionId/assign",
  authorize("APPROVER", "ADMIN"),
  validate({ params: exceptionIdParamSchema, body: assignExceptionSchema }),
  assignExceptionHandler
);

export default router;
