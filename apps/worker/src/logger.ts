import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Same redaction policy as apps/api — never log secrets (docs/ARCHITECTURE.md §32/§82).
export const logger = pino({
  level: isProduction ? "info" : "debug",
  redact: ["*.password", "*.passwordHash", "*.token"],
  transport: isProduction ? undefined : { target: "pino-pretty" },
});
