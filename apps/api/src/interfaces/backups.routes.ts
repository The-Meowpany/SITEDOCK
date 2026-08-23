import { Router } from "express";
import { z } from "zod";
import { ApplicationError, NotFoundError, WebsiteId } from "@sitedock/shared";
import {
  CreateWebsiteBackupUseCase,
  DEFAULT_BACKUP_RETENTION_DAYS,
  ListBackupsUseCase,
  MockStorageProvider,
  PrismaDeploymentRepository,
  PrismaWebsiteBackupRepository,
  RestoreWebsiteBackupUseCase,
} from "@sitedock/deployment";
import { GetWebsiteUseCase, PrismaWebsiteRepository } from "@sitedock/website";
import { assertWebsiteAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

// Same demo-mode wiring pattern as deployment.routes.ts — swapped for an
// S3StorageProvider in production without touching these routes.
const storage = new MockStorageProvider();
const deployments = new PrismaDeploymentRepository();
const backups = new PrismaWebsiteBackupRepository();
const getWebsite = new GetWebsiteUseCase(new PrismaWebsiteRepository());
const listBackups = new ListBackupsUseCase(backups);
const createBackup = new CreateWebsiteBackupUseCase(deployments, backups, storage);
const restoreBackup = new RestoreWebsiteBackupUseCase(backups, deployments, storage);

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type BackupParams = WebsiteScopedParams & { backupId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/backups
export const backupsRouter = Router({ mergeParams: true });
backupsRouter.use(requireSession);

backupsRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    // ListBackupsUseCase never exposes storagePath (internal object-storage layout).
    res.json(await listBackups.execute(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

/**
 * Manual backup. Backs up the website's current production deployment by
 * default; a specific READY/PUBLISHED deployment can be named in the body.
 * Idempotent per source deployment.
 */
const createBackupSchema = z.object({ deploymentId: z.string().uuid().optional() });

backupsRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const body = createBackupSchema.parse(req.body ?? {});

    let sourceDeploymentId: string;
    if (body.deploymentId) {
      sourceDeploymentId = body.deploymentId;
    } else {
      const website = await getWebsite.execute(req.params.websiteId, req.params.workspaceId);
      if (!website.productionDeploymentId) {
        throw new ApplicationError(
          "This website has no production deployment to back up yet",
          "NOTHING_TO_BACKUP"
        );
      }
      sourceDeploymentId = website.productionDeploymentId;
    }

    // Tenant check happens implicitly: findByIdForWebsite returns null for
    // deployments of other websites, and the website itself was verified above.
    const deployment = await deployments.findByIdForWebsite(sourceDeploymentId, WebsiteId(req.params.websiteId));
    if (!deployment) throw new NotFoundError("Deployment", sourceDeploymentId);

    const result = await createBackup.execute({
      websiteId: req.params.websiteId,
      sourceDeploymentId,
      sourceStoragePath: deployment.storagePath,
      retentionDays: DEFAULT_BACKUP_RETENTION_DAYS,
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "BACKUP_CREATED",
      resourceType: "WebsiteBackup",
      resourceId: result.backupId,
      metadata: { websiteId: req.params.websiteId, sourceDeploymentId, alreadyExisted: !result.created },
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Restore-as-new-version: materializes the backup as a NEW immutable
 * deployment (READY), which the developer can then publish explicitly.
 */
backupsRouter.post<BackupParams>("/:backupId/restore", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });

    const result = await restoreBackup.execute({ websiteId: req.params.websiteId, backupId: req.params.backupId });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "BACKUP_RESTORED",
      resourceType: "Deployment",
      resourceId: result.deploymentId,
      metadata: { websiteId: req.params.websiteId, restoredFromBackupId: result.restoredFromBackupId },
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

