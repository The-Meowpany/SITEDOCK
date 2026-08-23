import { DomainError } from "@sitedock/shared";

export type BackupStatus = "READY" | "FAILED";

export interface WebsiteBackupProps {
  id: string;
  websiteId: string;
  sourceDeploymentId: string;
  status: BackupStatus;
  storagePath: string;
  sizeBytes: number | null;
  createdAt: Date;
  /** Retention policy materialized — the cleanup job deletes past this. */
  expiresAt: Date;
}

/**
 * Immutable copy of one deployment's artifacts (brief §29). Invariants:
 * - one backup per (websiteId, sourceDeploymentId) — enforced again by a
 *   unique constraint in the schema, which is what actually makes the
 *   scheduled backup job idempotent under concurrency;
 * - restoring NEVER overwrites the backup or any deployment — restore
 *   materializes a NEW deployment version instead.
 */
export class WebsiteBackup {
  private constructor(private props: WebsiteBackupProps) {}

  static create(params: {
    id: string;
    websiteId: string;
    sourceDeploymentId: string;
    storagePath: string;
    retentionDays: number;
    now?: Date;
  }): WebsiteBackup {
    const now = params.now ?? new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + params.retentionDays);
    return new WebsiteBackup({
      id: params.id,
      websiteId: params.websiteId,
      sourceDeploymentId: params.sourceDeploymentId,
      status: "READY",
      storagePath: params.storagePath,
      sizeBytes: null,
      createdAt: now,
      expiresAt,
    });
  }

  static hydrate(props: WebsiteBackupProps): WebsiteBackup {
    return new WebsiteBackup(props);
  }

  markFailed(): void {
    if (this.props.status !== "READY") {
      throw new DomainError("Backup is already FAILED", "BACKUP_ALREADY_FAILED");
    }
    this.props.status = "FAILED";
  }

  recordSize(sizeBytes: number): void {
    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
      throw new DomainError("Backup size must be a non-negative integer", "INVALID_BACKUP_SIZE");
    }
    this.props.sizeBytes = sizeBytes;
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get sourceDeploymentId() { return this.props.sourceDeploymentId; }
  get status() { return this.props.status; }
  get storagePath() { return this.props.storagePath; }
  get sizeBytes() { return this.props.sizeBytes; }
  get createdAt() { return this.props.createdAt; }
  get expiresAt() { return this.props.expiresAt; }
}
