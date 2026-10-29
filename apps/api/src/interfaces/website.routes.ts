import { Router } from "express";
import { z } from "zod";
import { NotFoundError, WebsiteId } from "@sitedock/shared";
import {
  ApproveWebsiteUseCase,
  CreateProjectUseCase,
  CreateWebsiteUseCase,
  GetWebsiteUseCase,
  ListProjectsUseCase,
  ListWebsitesUseCase,
  PrismaProjectRepository,
  PrismaWebsiteRepository,
  RejectWebsiteApprovalUseCase,
  RollbackWebsiteUseCase,
  SubmitWebsiteForApprovalUseCase,
} from "@sitedock/website";
import {
  DeletePreviewUseCase,
  EnqueuePreviewDeploymentUseCase,
  EnqueueServiceDeploymentUseCase,
  PrismaPreviewRepository,
  PrismaServiceDeploymentRepository,
  PrismaServiceRepository,
  RetryPreviewUseCase,
} from "@sitedock/deployment";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { assertWebsiteAccess, resolveWorkspaceAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

const websites = new PrismaWebsiteRepository();
const projects = new PrismaProjectRepository();
const previews = new PrismaPreviewRepository();
const enqueuePreview = new EnqueuePreviewDeploymentUseCase(previews);
const retryPreview = new RetryPreviewUseCase(previews);
const deletePreview = new DeletePreviewUseCase(previews);
const workspaces = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);

const createProject = new CreateProjectUseCase(projects);
const listProjects = new ListProjectsUseCase(projects);
const createWebsite = new CreateWebsiteUseCase(websites, projects);
const getWebsite = new GetWebsiteUseCase(websites);
const listWebsites = new ListWebsitesUseCase(websites);
const submitForApproval = new SubmitWebsiteForApprovalUseCase(websites);
const approveWebsite = new ApproveWebsiteUseCase(websites);
const rejectApproval = new RejectWebsiteApprovalUseCase(websites);
const rollbackWebsite = new RollbackWebsiteUseCase(websites);

const createProjectSchema = z.object({ name: z.string().min(2) });
const createWebsiteSchema = z.object({ projectId: z.string().uuid(), name: z.string().min(2) });

type WorkspaceParams = { workspaceId: string };
type WebsiteParams = WorkspaceParams & { websiteId: string };

// Mounted at /api/v1/workspaces/:workspaceId/projects and .../websites
export const projectRouter = Router({ mergeParams: true });
export const websiteRouter = Router({ mergeParams: true });

projectRouter.use(requireSession);
websiteRouter.use(requireSession);

projectRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId! });
    res.json(await listProjects.execute(req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});

projectRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createProjectSchema.parse(req.body);
    res.status(201).json(await createProject.execute({ workspaceId: req.params.workspaceId, ...body }));
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createWebsiteSchema.parse(req.body);
    const result = await createWebsite.execute({ workspaceId: req.params.workspaceId, ...body });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WEBSITE_CREATED", resourceType: "Website", resourceId: result.websiteId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

websiteRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    const { clientIdScope } = await resolveWorkspaceAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
    });
    const list = await listWebsites.execute(req.params.workspaceId);
    // CLIENT-role members only ever see their own website(s) — never another
    // client's, even inside the same workspace.
    res.json(clientIdScope ? list.filter((w) => w.clientId === clientIdScope) : list);
  } catch (err) {
    next(err);
  }
});

websiteRouter.get<WebsiteParams>("/:websiteId", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    res.json(await getWebsite.execute(req.params.websiteId, req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WebsiteParams>("/:websiteId/submit-for-approval", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    await submitForApproval.execute(req.params.websiteId, req.params.workspaceId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Client approval flow: any member may act, but CLIENT-role members ONLY on
// their own website (assertWebsiteAccess enforces ownership for them).
websiteRouter.post<WebsiteParams>("/:websiteId/approve", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    await approveWebsite.execute(req.params.websiteId, req.params.workspaceId);
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WEBSITE_APPROVED", resourceType: "Website", resourceId: req.params.websiteId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WebsiteParams>("/:websiteId/reject-approval", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    await rejectApproval.execute(req.params.websiteId, req.params.workspaceId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});// Manual GitHub deployment initiation: connect repository and trigger deployment
// without waiting for a webhook. User provides branch/ref and commit SHA.
websiteRouter.post<WorkspaceParams & { websiteId: string }>(
  "/:websiteId/github-deploy",
  async (req, res, next) => {    try {      // Resolve workspace access and organization scope      const context = await resolveWorkspaceAccess({        workspaceId: req.params.workspaceId,        userId: req.userId!,      });            await assertWorkspaceAccess.execute({        workspaceId: req.params.workspaceId,userId: req.userId!,        requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],      });      const { repositoryFullName, branch, commitSha } = req.body;      if (!repositoryFullName || !branch || !commitSha) {        throw new Error("Missing required fields: repositoryFullName, branch, commitSha");      }      // Verify the repository belongs to the user's organization via an authorized      // GitHub repository connection. Client-supplied repository names are never sufficient.      const prisma = (await import("@sitedock/database")).prisma;      if (!context.organizationIdScope) { throw new Error("No organization scope for this request"); } const connections = await prisma.gitHubRepositoryConnection.findMany({        where: {          organizationId: context.organizationIdScope,          repositoryFullName,        },      });      if (connections.length === 0) {        throw new Error("No authorized GitHub repository connection found for this organization and repository");      }      const connection = connections[0]!;      // Verify the connection's organization matches the caller's scope      if (connection.organizationId !== context.organizationIdScope) {        throw new Error("Repository connection does not belong to user's organization");      }      // Enqueue deployment through the existing deployment queue.
      const enqueueServiceDeployment = new EnqueueServiceDeploymentUseCase(
        new PrismaServiceRepository(),
        new PrismaServiceDeploymentRepository()
      );
      const deployment = await enqueueServiceDeployment.execute({
        serviceId: (connection as { serviceId?: string }).serviceId ?? "",
        idempotencyKey: crypto.randomUUID(),
      });      res.json({
        success: true,
        deploymentId: deployment.deploymentId,
        version: deployment.version,
        status: deployment.status,
        repository: repositoryFullName,
        branch,
        commitSha,
      });
    } catch (err) {
      next(err);
    }
  }
);

  const serializePreview = (p: Awaited<ReturnType<typeof previews.findById>>) => {
    if (!p) return null;
    return {
      id: p.id,
      websiteId: String(p.websiteId),
      branch: p.branch,
      commitSha: p.commitSha,
      status: p.status,
      hostname: p.hostname,
      deploymentId: p.deploymentId,
      cleanupStatus: p.cleanupStatus,
      cleanupError: p.cleanupError,
      cleanupRequestedAt: p.cleanupRequestedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  };

  async function loadAuthorizedPreview(websiteId: string, previewId: string) {
    const preview = await previews.findById(previewId);
    // Cross-tenant or unknown ids are indistinguishable (404, no enumeration).
    if (!preview || String(preview.websiteId) !== websiteId) {
      throw new NotFoundError("Preview", previewId);
    }
    return preview;
  }

  // List previews for a website
  websiteRouter.get<WorkspaceParams & { websiteId: string }>(
    "/:websiteId/previews",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        const list = await previews.findByWebsite(WebsiteId(req.params.websiteId));
        res.json(list.map((p) => serializePreview(p)));
      } catch (err) {
        next(err);
      }
    }
  );

  // Enqueue a preview revision for a branch + exact commit SHA.
  websiteRouter.post<WorkspaceParams & { websiteId: string }>(
    "/:websiteId/previews",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        await assertWorkspaceAccess.execute({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
        });
        const body = z
          .object({
            branch: z.string().trim().min(1).max(200),
            commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
          })
          .parse(req.body);
        const result = await enqueuePreview.execute({
          websiteId: req.params.websiteId,
          branch: body.branch,
          commitSha: body.commitSha,
        });
        auditBestEffort({
          workspaceId: req.params.workspaceId,
          actorId: req.userId!,
          action: "PREVIEW_ENQUEUED",
          resourceType: "Preview",
          resourceId: result.previewId,
          metadata: { branch: body.branch, commitSha: body.commitSha },
        });
        res.status(202).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Read a preview and its deployment (revision) history.
  websiteRouter.get<WorkspaceParams & { websiteId: string; previewId: string }>(
    "/:websiteId/previews/:previewId",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        const preview = await loadAuthorizedPreview(req.params.websiteId, req.params.previewId);
        const revisions = await previews.listRevisions(preview.id);
        res.json({
          ...serializePreview(preview),
          revisions: revisions.map((r) => r.toJSON()),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Deployment history and status for a preview.
  websiteRouter.get<WorkspaceParams & { websiteId: string; previewId: string }>(
    "/:websiteId/previews/:previewId/deployments",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        const preview = await loadAuthorizedPreview(req.params.websiteId, req.params.previewId);
        const revisions = await previews.listRevisions(preview.id);
        res.json({
          previewId: preview.id,
          activeRevisionId: preview.deploymentId,
          hostname: preview.hostname,
          revisions: revisions.map((r) => r.toJSON()),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Retry the latest failed/canceled revision with its original commit SHA.
  websiteRouter.post<WorkspaceParams & { websiteId: string; previewId: string }>(
    "/:websiteId/previews/:previewId/retry",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        await assertWorkspaceAccess.execute({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
        });
        const preview = await loadAuthorizedPreview(req.params.websiteId, req.params.previewId);
        const revision = await retryPreview.execute({
          previewId: preview.id,
          websiteId: req.params.websiteId,
        });
        auditBestEffort({
          workspaceId: req.params.workspaceId,
          actorId: req.userId!,
          action: "PREVIEW_RETRIED",
          resourceType: "Preview",
          resourceId: preview.id,
          metadata: { revisionId: revision.id, commitSha: revision.commitSha },
        });
        res.status(202).json({ previewId: preview.id, revision: revision.toJSON() });
      } catch (err) {
        next(err);
      }
    }
  );

  // Request cleanup. Routing is disabled immediately; the worker removes only
  // preview-owned runtime resources. READY previews are deletable.
  websiteRouter.delete<WorkspaceParams & { websiteId: string; previewId: string }>(
    "/:websiteId/previews/:previewId",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        await assertWorkspaceAccess.execute({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
        });
        const preview = await loadAuthorizedPreview(req.params.websiteId, req.params.previewId);
        const requested = await deletePreview.execute({
          previewId: preview.id,
          websiteId: req.params.websiteId,
        });
        auditBestEffort({
          workspaceId: req.params.workspaceId,
          actorId: req.userId!,
          action: "PREVIEW_CLEANUP_REQUESTED",
          resourceType: "Preview",
          resourceId: preview.id,
        });
        res.status(202).json({
          previewId: requested.id,
          cleanupStatus: requested.cleanupStatus,
          cleanupError: requested.cleanupError,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cleanup status and failure reporting (retryable).
  websiteRouter.get<WorkspaceParams & { websiteId: string; previewId: string }>(
    "/:websiteId/previews/:previewId/cleanup",
    async (req, res, next) => {
      try {
        await assertWebsiteAccess({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          websiteId: req.params.websiteId,
        });
        const preview = await loadAuthorizedPreview(req.params.websiteId, req.params.previewId);
        res.json({
          previewId: preview.id,
          cleanupStatus: preview.cleanupStatus,
          cleanupError: preview.cleanupError,
          cleanupRequestedAt: preview.cleanupRequestedAt,
          status: preview.status,
        });
      } catch (err) {
        next(err);
      }
    }
  );

websiteRouter.post<WebsiteParams>("/:websiteId/rollback", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { targetDeploymentId } = z.object({ targetDeploymentId: z.string().uuid() }).parse(req.body);
    await rollbackWebsite.execute({ websiteId: req.params.websiteId, workspaceId: req.params.workspaceId, targetDeploymentId });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "DEPLOYMENT_ROLLBACK", resourceType: "Website", resourceId: req.params.websiteId, metadata: { targetDeploymentId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
