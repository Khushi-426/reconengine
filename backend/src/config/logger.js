import pino from "pino";
import { config } from "./env.js";

export const logger = pino({
  level: config.env === "production" ? "info" : "debug",
  transport:
    config.env === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
  redact: ["req.headers.authorization", "*.password", "*.password_hash"],
});
