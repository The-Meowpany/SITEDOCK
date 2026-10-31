import {
  CleanupExpiredBackupsUseCase,
  createStorageProviderFromEnv,
  PrismaWebsiteBackupRepository,
} from "@sitedock/deployment";
import { logger } from "../logger";

const backups = new PrismaWebsiteBackupRepository();
const storage = createStorageProviderFromEnv().storage;

const cleanup = new CleanupExpiredBackupsUseCase(backups, storage);

/**
 * Scheduled job (brief §29 "configurable retention" + "secure deletion"):
 * deletes expired backups' storage objects first, then their rows. Safe to
 * re-run — expired rows disappear on the first successful pass, so the next
 * run finds nothing.
 */
export async function runCleanupExpiredBackupsJob(): Promise<{ deleted: number }> {
  const result = await cleanup.execute();
  logger.info({ deletedCount: result.deleted }, "CleanupExpiredBackupsJob run complete");
  return { deleted: result.deleted };
}

