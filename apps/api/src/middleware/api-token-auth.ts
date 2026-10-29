import { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { ForbiddenError, UnauthorizedError, UserId } from "@sitedock/shared";
import { prisma } from "@sitedock/database";
import { PrismaUserRepository } from "@sitedock/auth";

const users = new PrismaUserRepository();
const TOKEN_PREFIX = "sitedock_pat_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Authenticates `Authorization: Bearer sitedock_pat_...` requests. Session
 * cookies keep working untouched. The token is hashed before lookup, so the
 * database never stores a usable credential; the plaintext is shown once at
 * creation time.
 */
export async function authenticateApiToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    next();
    return;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    next();
    return;
  }

  const raw = match[1]!.trim();
  if (!raw.startsWith(TOKEN_PREFIX)) {
    next(new UnauthorizedError("Invalid API token"));
    return;
  }

  try {
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < new Date())) {
      next(new UnauthorizedError("API token is invalid or expired"));
      return;
    }

    const user = await users.findById(UserId(token.createdById));
    if (!user || user.suspendedAt) {
      next(new UnauthorizedError("API token owner is not active"));
      return;
    }

    req.userId = token.createdById;
    req.apiToken = {
      id: token.id,
      workspaceId: token.workspaceId,
      scopes: token.scopes,
    };

    void prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * API tokens are machine credentials for exactly one workspace. They cannot
 * browse other workspaces, create workspaces, accept invitations, use platform
 * administration or call installation-wide GitHub endpoints.
 */
export function apiTokenPathGuard(req: Request, _res: Response, next: NextFunction) {
  const token = req.apiToken;
  if (!token) {
    next();
    return;
  }

  const path = req.path;
  if (path === "/auth/me") {
    next();
    return;
  }

  if (path === "/workspaces" && req.method === "GET") {
    next();
    return;
  }

  const workspacePrefix = `/workspaces/${token.workspaceId}`;
  if (path === workspacePrefix || path.startsWith(`${workspacePrefix}/`)) {
    next();
    return;
  }

  next(new ForbiddenError("API token can only access its own workspace"));
}

export function apiTokenScopeGuard(req: Request, _res: Response, next: NextFunction) {
  const token = req.apiToken;
  if (!token) {
    next();
    return;
  }

  if (req.params.workspaceId !== token.workspaceId) {
    next(new ForbiddenError("API token is scoped to a different workspace"));
    return;
  }

  const requiredScope = req.method === "GET" || req.method === "HEAD" ? "read" : "write";
  if (!token.scopes.includes(requiredScope)) {
    next(new ForbiddenError(`API token is missing the '${requiredScope}' scope`));
    return;
  }

  next();
}
