import { Router } from "express";
import {
  listNotificationsHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
} from "../controllers/notificationsController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate); // Enforce JWT for all alert actions

router.get("/", listNotificationsHandler);
router.get("/unread-count", unreadCountHandler);
router.patch("/:notificationId/read", markReadHandler);
router.post("/read-all", markAllReadHandler);

export default router;
