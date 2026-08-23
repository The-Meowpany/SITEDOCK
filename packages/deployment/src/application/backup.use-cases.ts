import { randomUUID } from "node:crypto";
import { ApplicationError, NotFoundError, WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { WebsiteBackup } from "../domain/backup.entity";
import { DeploymentRepository, StorageProvider, WebsiteBackupRepository } from "../domain/ports";

export const DEFAULT_BACKUP_RETENTION_DAYS = 30;

function backupStoragePath(websiteId: string, backupId: string): string {
  return `websites/${websiteId}/backups/${backupId}`;
}

export class ListBackupsUseCase {
  constructor(private readonly backups: WebsiteBackupRepository) {}

  async execute(websiteId: string) {
    return (await this.backups.listByWebsite(WebsiteId(websiteId))).map((b) => ({
      id: b.id,
      sourceDeploymentId: b.sourceDeploymentId,
      status: b.status,
      sizeBytes: b.sizeBytes,
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
    }));
  }
}

/**
 * Copies one deployment's immutable artifacts into a backup prefix
 * (brief §29). Idempotent per source deployment: an existing backup for the
 * same (websiteId, sourceDeploymentId) short-circuits — this is what lets the
 * scheduled job run as often as it wants.
 *
 * The caller supplies the deployment's storagePath explicitly (cross-context
 * orchestration convention of this codebase, cf. PublishDeploymentToWebsiteUseCase).
 */
export class CreateWebsiteBackupUseCase {
  constructor(
    private readonly deployments: DeploymentRepository,
    private readonly backups: WebsiteBackupRepository,
    private readonly storage: StorageProvider
  ) {}

  async execute(params: {
    websiteId: string;
    sourceDeploymentId: string;
    sourceStoragePath: string;
    retentionDays?: number;
  }): Promise<{ backupId: string; created: boolean }> {
    const websiteId = WebsiteId(params.websiteId);

    if (await this.backups.existsForSource(websiteId, params.sourceDeploymentId)) {
      const existing = (await this.backups.listByWebsite(websiteId)).find(
        (b) => b.sourceDeploymentId === params.sourceDeploymentId
      );
      return { backupId: existing!.id, created: false };
    }

    // Only READY/PUBLISHED deployments have complete artifact sets worth copying.
    const deployment = await this.deployments.findByIdForWebsite(params.sourceDeploymentId, websiteId);
    if (!deployment) throw new NotFoundError("Deployment", params.sourceDeploymentId);
    if (deployment.status !== "READY" && deployment.status !== "PUBLISHED") {
      throw new ApplicationError(
        `Cannot back up a ${deployment.status} deployment — only READY/PUBLISHED artifacts are complete`,
        "DEPLOYMENT_NOT_BACKUPPABLE"
      );
    }

    const backupId = randomUUID();
    const fullPath = backupStoragePath(params.websiteId, backupId);
    const backup = WebsiteBackup.create({
      id: backupId,
      websiteId: params.websiteId,
      sourceDeploymentId: params.sourceDeploymentId,
      storagePath: fullPath,
      retentionDays: params.retentionDays ?? DEFAULT_BACKUP_RETENTION_DAYS,
    });

    await this.copyPrefix(params.sourceStoragePath, fullPath);

    let totalBytes = 0;
    for (const path of await this.storage.list(fullPath)) {
      totalBytes += (await this.storage.get(path)).length;
    }
    backup.recordSize(totalBytes);

    await this.backups.save(backup);
    return { backupId: backup.id, created: true };
  }

  private async copyPrefix(sourcePrefix: string, destPrefix: string): Promise<void> {
    const files = await this.storage.list(sourcePrefix);
    if (files.length === 0) {
      throw new ApplicationError(`Source artifacts not found at "${sourcePrefix}"`, "BACKUP_SOURCE_EMPTY");
    }
    for (const path of files) {
      const content = await this.storage.get(path);
      await this.storage.put(`${destPrefix}${path.slice(sourcePrefix.length)}`, content);
    }
  }
}

/**
 * Restore-as-new-version (brief §13/§29): copies the backup's files into a
 * fresh immutable deployment directory and registers it as a READY deployment
 * at the next version number. Nothing is overwritten and nothing goes live by
 * itself — publishing stays the explicit next step.
 */
export class RestoreWebsiteBackupUseCase {
  constructor(
    private readonly backups: WebsiteBackupRepository,
    private readonly deployments: DeploymentRepository,
    private readonly storage: StorageProvider
  ) {}

  async execute(params: { websiteId: string; backupId: string }): Promise<{
    deploymentId: string;
    version: number;
    restoredFromBackupId: string;
  }> {
    const websiteId = WebsiteId(params.websiteId);
    const backup = await this.backups.findByIdForWebsite(params.backupId, websiteId);
    if (!backup) throw new NotFoundError("Backup", params.backupId);

    const version = await this.deployments.getNextVersion(websiteId);
    const deploymentId = randomUUID();
    const destPath = `websites/${params.websiteId}/deployments/${deploymentId}`;

    const files = await this.storage.list(backup.storagePath);
    if (files.length === 0) {
      throw new ApplicationError(`Backup artifacts missing at "${backup.storagePath}"`, "BACKUP_ARTIFACTS_MISSING");
    }
    let totalBytes = 0;
    let fileCount = 0;
    for (const path of files) {
      const content = await this.storage.get(path);
      await this.storage.put(`${destPath}${path.slice(backup.storagePath.length)}`, content);
      totalBytes += content.length;
      fileCount++;
    }

    const deployment = Deployment.create({
      id: deploymentId,
      websiteId,
      version,
      storagePath: destPath,
      uploadedById: "system:restore",
    });
    deployment.startBuilding();
    deployment.markReady({ fileCount, sizeBytes: totalBytes });
    await this.deployments.save(deployment);

    return { deploymentId, version, restoredFromBackupId: backup.id };
  }
}

/**
 * Retention enforcement (brief §29 "retención configurable"): deletes expired
 * backups' storage objects FIRST, then their rows — a crash between the two
 * leaves an orphan row whose objects are gone, which is detectable on restore
 * (BACKUP_ARTIFACTS_MISSING), never a dangling storage object nobody owns.
 */
export class CleanupExpiredBackupsUseCase {
  constructor(
    private readonly backups: WebsiteBackupRepository,
    private readonly storage: StorageProvider
  ) {}

  async execute(options: { now?: Date } = {}): Promise<{ deleted: number }> {
    const now = options.now ?? new Date();
    const expired = await this.backups.listExpired(now);

    let deleted = 0;
    for (const snapshot of expired) {
      await this.deletePrefix(`websites/${snapshot.websiteId}/backups/${snapshot.backupId}`);
      await this.backups.delete(snapshot.backupId);
      deleted++;
    }
    return { deleted };
  }

  private async deletePrefix(prefix: string): Promise<void> {
    for (const path of await this.storage.list(prefix)) {
      await this.storage.delete(path);
    }
  }
}

