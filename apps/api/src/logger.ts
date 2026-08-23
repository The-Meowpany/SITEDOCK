import pino from "pino";
import { config } from "./config";

// Structured JSON logging. Never log passwords, tokens, payment secrets or card data
// (see docs/ARCHITECTURE.md section on observability).
export const logger = pino({
  level: config.isProduction ? "info" : "debug",
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.token"],
  transport: config.isProduction ? undefined : { target: "pino-pretty" },
});
