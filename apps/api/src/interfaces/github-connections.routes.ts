import { Router } from "express";
import { z } from "zod";
import { prisma } from "@sitedock/database";
import { ConflictError, NotFoundError } from "@sitedock/shared";
import { createInstallationToken, fetchRepositories, fetchRepository } from "@sitedock/github";
import { requireSession } from "../middleware/require-session";
import { assertWebsiteAccess } from "../middleware/access-control";
import { auditBestEffort } from "../audit";

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type ConnectionParams = WebsiteScopedParams & { connectionId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/github
export const githubConnectionsRouter = Router({ mergeParams: true });
githubConnectionsRouter.use(requireSession);

const connectSchema = z.object({
  installationId: z.string().min(1).max(64),
  repositoryId: z.string().min(1).max(64),
  repositoryFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Expected owner/repo"),
  defaultBranch: z.string().min(1).max(255).optional(),
  serviceId: z.string().uuid().nullish(),
});

function serialize(connection: {
  id: string;
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  defaultBranch: string;
  serviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    installationId: connection.installationId,
    repositoryId: connection.repositoryId,
    repositoryName: connection.repositoryName,
    repositoryFullName: connection.repositoryFullName,
    defaultBranch: connection.defaultBranch,
    serviceId: connection.serviceId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

githubConnectionsRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ ...req.params, userId: req.userId! });
    const connections = await prisma.gitHubRepositoryConnection.findMany({
      where: { websiteId: req.params.websiteId },
      orderBy: { createdAt: "desc" },
    });
    res.json(connections.map(serialize));
  } catch (err) {
    next(err);
  }
});

githubConnectionsRouter.get<WebsiteScopedParams>("/repositories", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      ...req.params,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const installationId =
      typeof req.query.installationId === "string" ? req.query.installationId.trim() : "";
    if (!/^\d{1,20}$/.test(installationId)) {
      res.status(400).json({ code: "INVALID_INSTALLATION_ID", message: "installationId is required" });
      return;
    }
    if (!process.env.GITHUB_APP_PRIVATE_KEY) {
      res.status(503).json({
        code: "GITHUB_APP_NOT_CONFIGURED",
        message: "GITHUB_APP_PRIVATE_KEY is not configured",
      });
      return;
    }

    const installation = await createInstallationToken(installationId);
    const repositories = await fetchRepositories(installationId, installation.token);
    res.json({ installationId, repositories });
  } catch (err) {
    next(err);
  }
});

githubConnectionsRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      ...req.params,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const body = connectSchema.parse(req.body ?? {});

    const website = await prisma.website.findFirst({
      where: { id: req.params.websiteId, workspaceId: req.params.workspaceId },
      select: { id: true, organizationId: true, workspaceId: true },
    });
    if (!website) throw new NotFoundError("Website", req.params.websiteId);

    if (body.serviceId) {
      const service = await prisma.service.findFirst({
        where: {
          id: body.serviceId,
          project: { websites: { some: { id: req.params.websiteId } } },
        },
        select: { id: true },
      });
      if (!service) throw new NotFoundError("Service", body.serviceId);
    }

    if (!process.env.GITHUB_APP_PRIVATE_KEY) {
      res.status(503).json({
        code: "GITHUB_APP_NOT_CONFIGURED",
        message: "GITHUB_APP_PRIVATE_KEY is required to verify repositories",
      });
      return;
    }

    const installation = await createInstallationToken(body.installationId);
    const repository = await fetchRepository(body.repositoryId, installation.token);
    if (repository.fullName.toLowerCase() !== body.repositoryFullName.toLowerCase()) {
      res.status(400).json({
        code: "REPOSITORY_MISMATCH",
        message: "The repository does not belong to the provided installation",
      });
      return;
    }

    const existing = await prisma.gitHubRepositoryConnection.findUnique({
      where: {
        installationId_repositoryId: {
          installationId: body.installationId,
          repositoryId: body.repositoryId,
        },
      },
    });
    if (existing && existing.websiteId !== req.params.websiteId) {
      throw new ConflictError("This repository is already connected to another website");
    }

    const connection = await prisma.gitHubRepositoryConnection.upsert({
      where: {
        installationId_repositoryId: {
          installationId: body.installationId,
          repositoryId: body.repositoryId,
        },
      },
      create: {
        organizationId: website.organizationId ?? website.workspaceId,
        websiteId: website.id,
        serviceId: body.serviceId ?? null,
        installationId: body.installationId,
        repositoryId: body.repositoryId,
        repositoryName: repository.name,
        repositoryFullName: repository.fullName,
        defaultBranch: body.defaultBranch ?? repository.defaultBranch,
        webhookSecret: null,
      },
      update: {
        serviceId: body.serviceId ?? null,
        repositoryName: repository.name,
        repositoryFullName: repository.fullName,
        defaultBranch: body.defaultBranch ?? repository.defaultBranch,
      },
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "GitHubConnection",
      resourceId: connection.id,
      metadata: { operation: "GITHUB_CONNECTED", repository: repository.fullName },
    });

    res.status(201).json(serialize(connection));
  } catch (err) {
    next(err);
  }
});

githubConnectionsRouter.delete<ConnectionParams>("/:connectionId", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      ...req.params,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const deleted = await prisma.gitHubRepositoryConnection.deleteMany({
      where: { id: req.params.connectionId, websiteId: req.params.websiteId },
    });
    if (deleted.count === 0) throw new NotFoundError("GitHubConnection", req.params.connectionId);

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "GitHubConnection",
      resourceId: req.params.connectionId,
      metadata: { operation: "GITHUB_DISCONNECTED" },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
