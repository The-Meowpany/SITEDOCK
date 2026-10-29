import { DomainError, WebsiteId } from "@sitedock/shared";

export type PreviewStatus = "PENDING" | "BUILDING" | "READY" | "FAILED" | "CANCELED";
export type PreviewCleanupStatus = "NONE" | "REQUESTED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface PreviewProps {
  id: string;
  websiteId: WebsiteId;
  branch: string;
  commitSha: string;
  status: PreviewStatus;
  hostname: string | null;
  deploymentId: string | null;
  cleanupStatus: PreviewCleanupStatus;
  cleanupError: string | null;
  cleanupRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Preview — branch-scoped routing identity.
 *
 * `deploymentId` is the currently published (last healthy) revision. It is only
 * swapped by a worker that still owns the revision lease and only after the new
 * container passed its health check, so a failed build never disturbs the
 * revision that is already serving traffic.
 */
export class Preview {
  private constructor(private props: PreviewProps) {}

  static create(params: {
    id: string;
    websiteId: WebsiteId;
    branch: string;
    commitSha: string;
    status?: PreviewStatus;
    hostname?: string | null;
    deploymentId?: string | null;
    cleanupStatus?: PreviewCleanupStatus;
    cleanupError?: string | null;
    cleanupRequestedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  }): Preview {
    const now = new Date();
    return new Preview({
      id: params.id,
      websiteId: params.websiteId,
      branch: params.branch,
      commitSha: params.commitSha,
      status: params.status ?? "PENDING",
      hostname: params.hostname ?? null,
      deploymentId: params.deploymentId ?? null,
      cleanupStatus: params.cleanupStatus ?? "NONE",
      cleanupError: params.cleanupError ?? null,
      cleanupRequestedAt: params.cleanupRequestedAt ?? null,
      createdAt: params.createdAt ?? now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(props: PreviewProps): Preview {
    return new Preview(props);
  }

  get id(): string { return this.props.id; }
  get websiteId(): WebsiteId { return this.props.websiteId; }
  get branch(): string { return this.props.branch; }
  get commitSha(): string { return this.props.commitSha; }
  get status(): PreviewStatus { return this.props.status; }
  get hostname(): string | null { return this.props.hostname; }
  get deploymentId(): string | null { return this.props.deploymentId; }
  get cleanupStatus(): PreviewCleanupStatus { return this.props.cleanupStatus; }
  get cleanupError(): string | null { return this.props.cleanupError; }
  get cleanupRequestedAt(): Date | null { return this.props.cleanupRequestedAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  withStatus(status: PreviewStatus): Preview {
    return new Preview({ ...this.props, status, updatedAt: new Date() });
  }

  withHostname(hostname: string | null): Preview {
    return new Preview({ ...this.props, hostname, updatedAt: new Date() });
  }

  withDeploymentId(deploymentId: string | null): Preview {
    return new Preview({ ...this.props, deploymentId, updatedAt: new Date() });
  }

  withCommitSha(commitSha: string): Preview {
    return new Preview({ ...this.props, commitSha, updatedAt: new Date() });
  }

  requestCleanup(): Preview {
    return new Preview({
      ...this.props,
      cleanupStatus: "REQUESTED",
      cleanupError: null,
      cleanupRequestedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  withCleanupStatus(status: PreviewCleanupStatus, error: string | null = null): Preview {
    return new Preview({ ...this.props, cleanupStatus: status, cleanupError: error, updatedAt: new Date() });
  }

  toJSON(): Omit<PreviewProps, "websiteId"> & { websiteId: string } {
    return { ...this.props, websiteId: String(this.props.websiteId) };
  }
}

export interface PreviewRevisionProps {
  id: string;
  previewId: string;
  commitSha: string;
  sequence: number;
  status: PreviewStatus;
  imageId: string | null;
  imageDigest: string | null;
  containerId: string | null;
  hostPort: number | null;
  containerPort: number;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * PreviewRevision — one immutable build attempt pinned to an exact commit SHA.
 *
 * Lease semantics are identical to ServiceDeployment: claiming increments
 * `leaseGeneration`, and every mutation is conditional on
 * (claimedBy, leaseGeneration). A worker that lost its lease can never publish
 * a revision or overwrite another worker's state.
 */
export class PreviewRevision {
  private constructor(private props: PreviewRevisionProps) {}

  static create(params: {
    id: string;
    previewId: string;
    commitSha: string;
    sequence: number;
    status?: PreviewStatus;
    maxAttempts?: number;
  }): PreviewRevision {
    return new PreviewRevision({
      id: params.id,
      previewId: params.previewId,
      commitSha: params.commitSha,
      sequence: params.sequence,
      status: params.status ?? "PENDING",
      imageId: null,
      imageDigest: null,
      containerId: null,
      hostPort: null,
      containerPort: 8080,
      errorMessage: null,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      claimedBy: null,
      leaseGeneration: 0,
      leaseExpiresAt: null,
      nextRetryAt: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    });
  }

  static hydrate(props: PreviewRevisionProps): PreviewRevision {
    return new PreviewRevision(props);
  }

  get id() { return this.props.id; }
  get previewId() { return this.props.previewId; }
  get commitSha() { return this.props.commitSha; }
  get sequence() { return this.props.sequence; }
  get status() { return this.props.status; }
  get imageId() { return this.props.imageId; }
  get imageDigest() { return this.props.imageDigest; }
  get containerId() { return this.props.containerId; }
  get hostPort() { return this.props.hostPort; }
  get containerPort() { return this.props.containerPort; }
  get errorMessage() { return this.props.errorMessage; }
  get attempts() { return this.props.attempts; }
  get maxAttempts() { return this.props.maxAttempts; }
  get claimedBy() { return this.props.claimedBy; }
  get leaseGeneration() { return this.props.leaseGeneration; }
  get leaseExpiresAt() { return this.props.leaseExpiresAt; }
  get nextRetryAt() { return this.props.nextRetryAt; }
  get createdAt() { return this.props.createdAt; }
  get startedAt() { return this.props.startedAt; }
  get completedAt() { return this.props.completedAt; }

  isLeaseExpired(): boolean {
    return this.props.leaseExpiresAt !== null && this.props.leaseExpiresAt.getTime() < Date.now();
  }

  hasRetriesRemaining(): boolean {
    return this.props.attempts < this.props.maxAttempts;
  }

  assertLeaseOwner(workerId: string, generation: number): void {
    if (this.props.claimedBy !== workerId || this.props.leaseGeneration !== generation) {
      throw new DomainError(
        `Stale lease: expected ${workerId}/${generation}, got ${this.props.claimedBy}/${this.props.leaseGeneration}`,
        "STALE_LEASE"
      );
    }
    if (this.isLeaseExpired()) {
      throw new DomainError(`Lease expired for preview revision ${this.props.id}`, "LEASE_EXPIRED");
    }
  }

  markBuilding(imageId: string, imageDigest: string): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "BUILDING",
      imageId,
      imageDigest,
      errorMessage: null,
    });
  }

  markReady(params: {
    imageId: string;
    imageDigest: string;
    containerId: string;
    hostPort: number;
    containerPort: number;
  }): PreviewRevision {
    if (this.props.status !== "BUILDING") {
      throw new DomainError(
        `Cannot ready revision ${this.props.id} because it is ${this.props.status}, not BUILDING`,
        "REVISION_NOT_BUILDING"
      );
    }
    return new PreviewRevision({
      ...this.props,
      status: "READY",
      imageId: params.imageId,
      imageDigest: params.imageDigest,
      containerId: params.containerId,
      hostPort: params.hostPort,
      containerPort: params.containerPort,
      errorMessage: null,
      completedAt: new Date(),
    });
  }

  markFailed(errorMessage: string): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "FAILED",
      errorMessage,
      completedAt: new Date(),
    });
  }

  scheduleRetry(delayMs: number): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "PENDING",
      claimedBy: null,
      leaseExpiresAt: null,
      nextRetryAt: new Date(Date.now() + delayMs),
      errorMessage: null,
    });
  }

  /** Manual retry: requeue whatever the last attempt produced, same commit SHA. */
  requeue(): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "PENDING",
      attempts: 0,
      claimedBy: null,
      leaseExpiresAt: null,
      nextRetryAt: null,
      errorMessage: null,
      completedAt: null,
    });
  }

  cancel(): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "CANCELED",
      claimedBy: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
    });
  }

  withLease(workerId: string, leaseGeneration: number, leaseExpiresAt: Date, attempts: number): PreviewRevision {
    return new PreviewRevision({
      ...this.props,
      status: "BUILDING",
      claimedBy: workerId,
      leaseGeneration,
      leaseExpiresAt,
      attempts,
      startedAt: this.props.startedAt ?? new Date(),
    });
  }

  toJSON(): PreviewRevisionProps {
    return { ...this.props };
  }
}
