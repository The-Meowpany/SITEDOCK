import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError, UserId } from "@sitedock/shared";
import { PrismaUserRepository } from "@sitedock/auth";

const users = new PrismaUserRepository();

/**
 * Second gate for platform administration routes (brief §27). requireSession
 * must run FIRST (it sets req.userId); this middleware then verifies the
 * account is PLATFORM_ADMIN. Two extra hardenings beyond a plain role check:
 * - a suspended admin loses access immediately, even with a live session;
 * - the check hits the DB on every request, so role revocation takes effect
 *   without waiting for session expiry.
 */
export async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.userId) {
    next(new UnauthorizedError("Not authenticated"));
    return;
  }

  const user = await users.findById(UserId(req.userId));
  if (!user) {
    next(new UnauthorizedError("Account no longer exists"));
    return;
  }
  if (user.suspendedAt) {
    next(new UnauthorizedError("This account has been suspended."));
    return;
  }
  if (user.platformRole !== "PLATFORM_ADMIN") {
    next(new ForbiddenError("Platform administrator access required"));
    return;
  }

  next();
}
