import { PrismaWebsiteRepository } from "@sitedock/website";
import {
  CreateWebsiteBackupUseCase,
  createStorageProviderFromEnv,
  DEFAULT_BACKUP_RETENTION_DAYS,
  PrismaDeploymentRepository,
  PrismaWebsiteBackupRepository,
} from "@sitedock/deployment";
import { RetryPolicy, runWithRetry } from "@sitedock/shared";
import { logger } from "../logger";

const websites = new PrismaWebsiteRepository();
const deployments = new PrismaDeploymentRepository();
const backups = new PrismaWebsiteBackupRepository();
const storage = createStorageProviderFromEnv().storage;

const createBackup = new CreateWebsiteBackupUseCase(deployments, backups, storage);

// Same demo-mode storage wiring as apps/api deployment routes — swapped for an
// S3StorageProvider in production without touching this job.
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? DEFAULT_BACKUP_RETENTION_DAYS);

const perItemRetryPolicy = RetryPolicy.create({ maxAttempts: 2, backoffMs: [2_000] });

/**
 * Scheduled job (brief §29 "backup automático"): every LIVE website must have
 * a backup of its current production artifacts.
 *
 * Idempotent via the (websiteId, sourceDeploymentId) unique pair: a website
 * whose production deployment is already backed up short-circuits inside the
 * use case (`created: false`), so running hourly never duplicates work. A new
 * publish changes productionDeploymentId, which makes exactly one new backup
 * on the next run.
 */
export async function runBackupLiveWebsitesJob(): Promise<{ createdCount: number; alreadyBackedUpCount: number }> {
  const startedAt = Date.now();
  const liveWebsites = await websites.listByStatus("LIVE");

  let createdCount = 0;
  let alreadyBackedUpCount = 0;

  for (const website of liveWebsites) {
    if (!website.productionDeploymentId) continue;

    const outcome = await runWithRetry(async () => {
      const deployment = await deployments.findById(website.productionDeploymentId!);
      if (!deployment) return "skipped" as const;

      const result = await createBackup.execute({
        websiteId: website.id,
        sourceDeploymentId: deployment.id,
        sourceStoragePath: deployment.storagePath,
        retentionDays,
      });
      return result.created ? ("created" as const) : ("already" as const);
    }, perItemRetryPolicy);

    if (!outcome.succeeded) {
      logger.error(
        { err: outcome.error, websiteId: website.id, attempts: outcome.attempts },
        "Failed to back up live website after retries"
      );
      continue;
    }
    if (outcome.result === "created") createdCount++;
    else if (outcome.result === "already") alreadyBackedUpCount++;
  }

  logger.info(
    { createdCount, alreadyBackedUpCount, candidates: liveWebsites.length, durationMs: Date.now() - startedAt },
    "BackupLiveWebsitesJob run complete"
  );
  return { createdCount, alreadyBackedUpCount };
}

