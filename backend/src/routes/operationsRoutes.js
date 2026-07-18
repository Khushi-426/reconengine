import { Router } from "express";
import {
  getOperationsKpisHandler,
  getQueueStatusHandler,
  getWorkerStatusHandler,
} from "../controllers/operationsController.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

// Dashboard views require valid authentication and appropriate user roles
router.use(authenticate);
router.use(authorize("ANALYST", "APPROVER", "ADMIN", "AUDITOR"));

router.get("/kpis", getOperationsKpisHandler);
router.get("/queue-status", getQueueStatusHandler);
router.get("/worker-status", getWorkerStatusHandler);

export default router;
