import { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { UnauthorizedError } from "@sitedock/shared";
import { PrismaSessionRepository, PrismaUserRepository } from "@sitedock/auth";

const sessions = new PrismaSessionRepository();
const users = new PrismaUserRepository();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      /** Correlation id for structured logs — set by apps/api/src/app.ts. */
      requestId?: string;
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves the `sid` httpOnly cookie into req.userId, or rejects with 401.
 *
 * Re-validates the ACCOUNT on every request (not just at login): a user
 * suspended or deleted after the session was issued loses access immediately,
 * instead of keeping a valid session for up to its full 7-day TTL. The extra
 * primary-key lookup per request is negligible next to every route's own
 * workspace query — and it is the price of fail-closed authorization.
 */
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.sid;
  if (!token) {
    next(new UnauthorizedError("Not authenticated"));
    return;
  }

  const session = await sessions.findByTokenHash(hashToken(token));
  if (!session || session.expiresAt < new Date()) {
    next(new UnauthorizedError("Session expired or invalid"));
    return;
  }

  const user = await users.findById(session.userId);
  if (!user || user.isSuspended()) {
    next(new UnauthorizedError("This account is no longer active"));
    return;
  }

  req.userId = session.userId;
  next();
}
