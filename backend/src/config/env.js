import "dotenv/config";

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  db: {
    host: required("DB_HOST", "localhost"),
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: required("DB_NAME", "reconengine"),
    user: required("DB_USER", "reconengine_app"),
    password: required("DB_PASSWORD", "change_me_in_env"),
    poolMax: parseInt(process.env.DB_POOL_MAX || "20", 10),
    idleTimeoutMillis: 30000,
    statementTimeoutMillis: 10000,
  },
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
    refreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
    accessExpiresIn: "15m",
    refreshExpiresInDays: 7,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 300,
    bulkImportWindowMs: 60 * 60 * 1000,
    bulkImportMax: 10,
  },
  upload: {
    maxFileSizeBytes: 25 * 1024 * 1024, // 25MB
    allowedMimeTypes: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  },
};
