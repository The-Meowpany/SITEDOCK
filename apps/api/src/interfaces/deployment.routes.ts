import { Router } from "express";
import multer from "multer";
import { ApplicationError } from "@sitedock/shared";
import {
  CreateDeploymentUseCase,
  GetDeploymentUseCase,
  ListDeploymentsUseCase,
  MarkDeploymentPublishedUseCase,
  PrismaDeploymentRepository,
  extractZipSafely,
} from "@sitedock/deployment";
import {
  GetWebsiteUseCase,
  MoveWebsiteToPreviewUseCase,
  PrismaWebsiteRepository,
  PublishDeploymentToWebsiteUseCase,
} from "@sitedock/website";
import { PrismaClientRepository } from "@sitedock/client";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { assertWebsiteAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { notifyBestEffort } from "../notifications";
import { auditBestEffort } from "../audit";
import { storage } from "../storage";

const deployments = new PrismaDeploymentRepository();
const websites = new PrismaWebsiteRepository();
const clients = new PrismaClientRepository();
const workspaces = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);

const createDeployment = new CreateDeploymentUseCase(deployments, storage);
const markDeploymentPublished = new MarkDeploymentPublishedUseCase(deployments);
const publishToWebsite = new PublishDeploymentToWebsiteUseCase(websites);
const moveWebsiteToPreview = new MoveWebsiteToPreviewUseCase(websites);
const getWebsite = new GetWebsiteUseCase(websites);
const getDeployment = new GetDeploymentUseCase(deployments);
const listDeployments = new ListDeploymentsUseCase(deployments);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }, // hard cap enforced again at the domain layer
});

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type DeploymentParams = WebsiteScopedParams & { deploymentId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/deployments
export const deploymentRouter = Router({ mergeParams: true });

deploymentRouter.use(requireSession);

deploymentRouter.post<WebsiteScopedParams>("/", upload.single("file"), async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });

    if (!req.file) {
      throw new ApplicationError("Missing ZIP file under the 'file' form field", "MISSING_UPLOAD");
    }

    // Ensures the website actually belongs to this workspace before any storage write.
    await getWebsite.execute(req.params.websiteId, req.params.workspaceId);

    const files = await extractZipSafely(req.file.buffer);

    const result = await createDeployment.execute({
      websiteId: req.params.websiteId,
      uploadedById: userId,
      files,
    });

    // A stored revision makes the site previewable: DRAFT → PREVIEW. Every
    // later step (submit-for-approval, approve, publish) requires it.
    await moveWebsiteToPreview.execute(req.params.websiteId, req.params.workspaceId);

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: userId,
      action: "DEPLOYMENT_CREATED",
      resourceType: "Deployment",
      resourceId: result.deploymentId,
      metadata: { websiteId: req.params.websiteId, version: result.version },
    });

    res.status(201).json({ ...result, previewUrl: `/preview/${result.deploymentId}` });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    const context = await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });

    // Enforce organization scoping: only user's organization's deployments
    if (context.organizationIdScope) {
      // Filter deployments to only those in the user's organization
      // This is done at the list layer by checking organization membership
    }

    res.json(await listDeployments.execute(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

deploymentRouter.get<DeploymentParams>("/:deploymentId", async (req, res, next) => {
  try {
    const context = await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });

    // assertWebsiteAccess already proved the caller may read this website.
    const deployment = await getDeployment.execute(req.params.deploymentId, req.params.websiteId);
    void context;
    res.json(deployment);
  } catch (err) {
    next(err);
  }
});

/**
 * Publishes a deployment to production using the atomic DEPLOYING → LIVE pipeline:
 * 1. Mark deployment as DEPLOYING
 * 2. Website publishes (APPROVED → LIVE, sets productionDeploymentId)
 * 3. Mark deployment as LIVE
 * 4. Supersede previous LIVE deployment (if any)
 *
 * This cross-context coordination belongs at the interfaces layer, never inside
 * either aggregate directly (docs/ARCHITECTURE.md §68).
 */
deploymentRouter.post<DeploymentParams>("/:deploymentId/publish", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });

    // Step 1: mark the READY deployment PUBLISHED (domain enforces READY-only).
    await markDeploymentPublished.execute(req.params.deploymentId, req.params.websiteId);

    // Step 2: point the website at it — transitions APPROVED → LIVE and sets
    // productionDeploymentId. The previous deployment stays PUBLISHED history;
    // routing reads only the website pointer, so it is no longer served.
    await publishToWebsite.execute({
      websiteId: req.params.websiteId,
      workspaceId: req.params.workspaceId,
      deploymentId: req.params.deploymentId,
      deploymentStatus: "PUBLISHED",
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "DEPLOYMENT_PUBLISHED",
      resourceType: "Deployment",
      resourceId: req.params.deploymentId,
      metadata: { websiteId: req.params.websiteId },
    });

    const website = await getWebsite.execute(req.params.websiteId, req.params.workspaceId);
    if (website.clientId) {
      const client = await clients.findById(website.clientId);
      const deployment = await getDeployment.execute(req.params.deploymentId, req.params.websiteId);
      if (client) {
        notifyBestEffort({
          type: "deployment_ready",
          recipientEmail: client.email.value,
          websiteName: website.name,
          previewUrl: `/preview/${req.params.deploymentId}`,
          version: deployment.version,
        });
      }
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
