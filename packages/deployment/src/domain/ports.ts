import { WebsiteId } from "@sitedock/shared";
import { Deployment } from "./deployment.entity";
import { WebsiteBackup } from "./backup.entity";

export interface DeploymentRepository {
  findById(id: string): Promise<Deployment | null>;
  findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<Deployment | null>;
  listByWebsite(websiteId: WebsiteId): Promise<Deployment[]>;
  getNextVersion(websiteId: WebsiteId): Promise<number>;
  save(deployment: Deployment): Promise<void>;
}

export interface BackupRowSnapshot {
  backupId: string;
  websiteId: string;
  sourceDeploymentId: string;
}

export interface WebsiteBackupRepository {
  findById(id: string): Promise<WebsiteBackup | null>;
  findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<WebsiteBackup | null>;
  /** Idempotency check for the scheduled backup job. */
  existsForSource(websiteId: WebsiteId, sourceDeploymentId: string): Promise<boolean>;
  listByWebsite(websiteId: WebsiteId): Promise<WebsiteBackup[]>;
  /** System-level scheduled-job query (docs/ARCHITECTURE.md §31). */
  listExpired(before: Date): Promise<BackupRowSnapshot[]>;
  save(backup: WebsiteBackup): Promise<void>;
  delete(backupId: string): Promise<void>;
}

/**
 * StorageProvider abstraction (docs/ARCHITECTURE.md §22/§26). Deployment domain
 * never imports an S3 SDK directly — infrastructure implements this port with
 * either a MockStorageProvider (MVP/demo) or an S3StorageProvider (production).
 */
export interface StorageProvider {
  put(path: string, content: Buffer, contentType?: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
