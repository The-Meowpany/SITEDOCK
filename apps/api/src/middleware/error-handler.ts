import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ApplicationError, DomainError, InfrastructureError } from "@sitedock/shared";
import { logger } from "../logger";

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  SECRETS_KEY_NOT_CONFIGURED: 503,
};

/**
 * Maps DomainError/ApplicationError/InfrastructureError to structured HTTP
 * responses. Never leaks stack traces to the client (rule #21/#50 of the brief).
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId ?? randomUUID();

  if (err instanceof DomainError || err instanceof ApplicationError) {
    const status = STATUS_BY_CODE[err.code] ?? 400;
    res.status(status).json({ code: err.code, message: err.message, details: null, requestId });
    return;
  }

  if (err instanceof InfrastructureError) {
    logger.error({ err, requestId }, "Infrastructure error");
    res.status(502).json({ code: "INFRASTRUCTURE_ERROR", message: "A downstream dependency failed", details: null, requestId });
    return;
  }

  logger.error({ err, requestId }, "Unhandled error");
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong", details: null, requestId });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found", details: null, requestId: randomUUID() });
}
