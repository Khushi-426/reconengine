import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import crypto from "crypto";
import { correlationIdMiddleware } from "./middleware/correlationMiddleware.js";
import { logger } from "./config/logger.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

import authRoutes from "./routes/authRoutes.js";
import exceptionsRoutes from "./routes/exceptionsRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import reconciliationRoutes from "./routes/reconciliationRoutes.js";
import notificationsRoutes from "./routes/notificationsRoutes.js";
import operationsRoutes from "./routes/operationsRoutes.js";

export function createApp() {
  const app = express();

  // --- security & platform middleware -------------------------------
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(correlationIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.correlationId || crypto.randomUUID(),
      customAttributeKeys: {
        reqId: "correlationId",
      },
    })
  );
  app.use(generalLimiter);

  // --- health check (no auth — used by load balancer) -----------------
  app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

  // --- routes -----------------------------------------------------------
  app.use("/api/auth", authRoutes);
  app.use("/api/exceptions", exceptionsRoutes);
  app.use("/api/imports", importRoutes);
  app.use("/api/recon", reconciliationRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/operations", operationsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
