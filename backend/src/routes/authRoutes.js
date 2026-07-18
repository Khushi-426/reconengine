import { Router } from "express";
import { loginHandler, refreshHandler, logoutHandler } from "../controllers/authController.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { loginSchema } from "../utils/schemas.js";

const router = Router();

router.post("/login", authLimiter, validate({ body: loginSchema }), loginHandler);
router.post("/refresh", refreshHandler);
router.post("/logout", logoutHandler);

export default router;
