import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@sitedock/database";
import { ForbiddenError, NotFoundError } from "@sitedock/shared";
import { requireSession } from "../middleware/require-session";
import { resolveWorkspaceAccess } from "../middleware/access-control";
import { auditBestEffort } from "../audit";

type WorkspaceParams = { workspaceId: string };
type TokenParams = WorkspaceParams & { tokenId: string };

const TOKEN_PREFIX = "sitedock_pat_";
const TOKEN_SCOPES = ["read", "write"] as const;

export const apiTokensRouter = Router({ mergeParams: true });
apiTokensRouter.use(requireSession);

apiTokensRouter.use((req, _res, next) => {
  if (req.apiToken) {
    next(new ForbiddenError("API tokens cannot manage API tokens"));
    return;
  }
  next();
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(2).optional(),
  expiresAt: z.string().datetime().optional(),
});

function serialize(token: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
  };
}

apiTokensRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await resolveWorkspaceAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const tokens = await prisma.apiToken.findMany({
      where: { workspaceId: req.params.workspaceId },
      orderBy: { createdAt: "desc" },
    });
    res.json(tokens.map(serialize));
  } catch (err) {
    next(err);
  }
});

apiTokensRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await resolveWorkspaceAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const body = createSchema.parse(req.body ?? {});
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      res.status(400).json({ code: "INVALID_EXPIRY", message: "expiresAt must be in the future" });
      return;
    }

    const secret = randomBytes(32).toString("base64url");
    const plaintext = `${TOKEN_PREFIX}${secret}`;
    const token = await prisma.apiToken.create({
      data: {
        workspaceId: req.params.workspaceId,
        name: body.name,
        tokenHash: createHash("sha256").update(plaintext).digest("hex"),
        prefix: plaintext.slice(0, 24),
        scopes: body.scopes ?? [...TOKEN_SCOPES],
        createdById: req.userId!,
        expiresAt,
      },
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "API_TOKEN_CREATED",
      resourceType: "ApiToken",
      resourceId: token.id,
      metadata: { scopes: token.scopes },
    });

    res.status(201).json({ ...serialize(token), token: plaintext });
  } catch (err) {
    next(err);
  }
});

apiTokensRouter.delete<TokenParams>("/:tokenId", async (req, res, next) => {
  try {
    await resolveWorkspaceAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const revoked = await prisma.apiToken.updateMany({
      where: {
        id: req.params.tokenId,
        workspaceId: req.params.workspaceId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new NotFoundError("ApiToken", req.params.tokenId);

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "API_TOKEN_REVOKED",
      resourceType: "ApiToken",
      resourceId: req.params.tokenId,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
