import { DomainError } from "@sitedock/shared";
import { ServiceDeploymentStatus, serviceDeploymentStateMachine } from "./service-deployment-status";

export interface ServiceDeploymentProps {
  id: string;
  serviceId: string;
  version: number;
  status: ServiceDeploymentStatus;
  imageId: string | null;
  imageDigest: string | null;
  buildLog: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  idempotencyKey: string | null;
  canceledAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * ServiceDeployment aggregate. Represents one build/deploy cycle of a service.
 * Each deployment has a unique version number within its service and produces
 * an immutable container image that can be served publicly.
 */
export class ServiceDeployment {
  private constructor(private props: ServiceDeploymentProps) {}

  static create(params: {
    id: string;
    serviceId: string;
    version: number;
    idempotencyKey?: string | null;
  }): ServiceDeployment {
    const now = new Date();
    return new ServiceDeployment({
      id: params.id,
      serviceId: params.serviceId,
      version: params.version,
      status: "QUEUED",
      imageId: null,
      imageDigest: null,
      buildLog: null,
      errorMessage: null,
      attempts: 0,
      maxAttempts: 3,
      claimedBy: null,
      leaseGeneration: 0,
      leaseExpiresAt: null,
      nextRetryAt: null,
      idempotencyKey: params.idempotencyKey ?? null,
      canceledAt: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });
  }

  claim(workerId: string, leaseMs: number): void {
    if (this.props.status !== "QUEUED" && this.props.status !== "BUILDING") {
      throw new DomainError(`Cannot claim deployment ${this.props.id} in state ${this.props.status}`, "DEPLOYMENT_NOT_QUEUED");
    }
    if (this.props.canceledAt) {
      throw new DomainError(`Deployment ${this.props.id} is canceled`, "DEPLOYMENT_CANCELED");
    }
    if (this.props.status === "BUILDING" && this.props.leaseExpiresAt && this.props.leaseExpiresAt.getTime() >= Date.now()) {
      throw new DomainError(`Cannot claim deployment ${this.props.id} with an active lease`, "LEASE_ACTIVE");
    }
    this.props.status = "BUILDING";
    this.props.claimedBy = workerId;
    this.props.leaseGeneration += 1;
    this.props.leaseExpiresAt = new Date(Date.now() + leaseMs);
    this.props.startedAt = new Date();
    this.props.attempts += 1;
  }

  renewLease(leaseMs: number): void {
    this.props.leaseExpiresAt = new Date(Date.now() + leaseMs);
  }

  releaseLease(): void {
    this.props.claimedBy = null;
    this.props.leaseExpiresAt = null;
  }

  cancel(): void {
    this.props.canceledAt = new Date();
    if (this.props.status === "QUEUED") {
      this.props.status = "CANCELED";
    }
  }

  isCanceled(): boolean {
    return this.props.canceledAt !== null;
  }

  isLeaseExpired(): boolean {
    return this.props.leaseExpiresAt !== null && this.props.leaseExpiresAt.getTime() < Date.now();
  }

  scheduleRetry(delayMs: number): void {
    this.props.status = "QUEUED";
    this.props.claimedBy = null;
    this.props.leaseExpiresAt = null;
    this.props.nextRetryAt = new Date(Date.now() + delayMs);
  }

  hasRetriesRemaining(): boolean {
    return this.props.attempts < this.props.maxAttempts;
  }

  static hydrate(props: ServiceDeploymentProps): ServiceDeployment {
    return new ServiceDeployment(props);
  }

  private transitionTo(next: ServiceDeploymentStatus): void {
    serviceDeploymentStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
  }

  startBuilding(): void {
    this.transitionTo("BUILDING");
  }

  markBuilt(imageId: string, imageDigest: string, buildLog: string): void {
    if (this.props.status !== "BUILDING") {
      throw new DomainError(
        `Cannot mark deployment ${this.props.id} as built because it is ${this.props.status}, not BUILDING`,
        "DEPLOYMENT_NOT_BUILDING"
      );
    }
    this.transitionTo("READY");
    this.props.imageId = imageId;
    this.props.imageDigest = imageDigest;
    this.props.buildLog = buildLog;
    this.props.completedAt = new Date();
  }

  markFailed(errorMessage: string): void {
    this.transitionTo("FAILED");
    this.props.errorMessage = errorMessage;
    this.props.completedAt = new Date();
  }

  get id() { return this.props.id; }
  get serviceId() { return this.props.serviceId; }
  get version() { return this.props.version; }
  get status() { return this.props.status; }
  get imageId() { return this.props.imageId; }
  get imageDigest() { return this.props.imageDigest; }
  get buildLog() { return this.props.buildLog; }
  get errorMessage() { return this.props.errorMessage; }
  get attempts() { return this.props.attempts; }
  get maxAttempts() { return this.props.maxAttempts; }
  get claimedBy() { return this.props.claimedBy; }
  get leaseGeneration() { return this.props.leaseGeneration; }
  get leaseExpiresAt() { return this.props.leaseExpiresAt; }

  assertLeaseOwner(workerId: string, generation: number): void {
    if (this.props.claimedBy !== workerId || this.props.leaseGeneration !== generation) {
      throw new DomainError(
        `Stale lease: expected ${workerId}/${generation}, got ${this.props.claimedBy}/${this.props.leaseGeneration}`,
        "STALE_LEASE"
      );
    }
    if (this.isLeaseExpired()) {
      throw new DomainError(`Lease expired for deployment ${this.props.id}`, "LEASE_EXPIRED");
    }
  }
  /**
   * Flat DTO for API responses. Without this, JSON.stringify would serialize
   * the private `props` field, leaking `{props:{...}}` instead of the entity
   * fields (clients could not read `id`/`status`).
   */
  toJSON(): ServiceDeploymentProps {
    return { ...this.props };
  }

  get nextRetryAt() { return this.props.nextRetryAt; }
  get idempotencyKey() { return this.props.idempotencyKey; }
  get canceledAt() { return this.props.canceledAt; }
  get createdAt() { return this.props.createdAt; }
  get startedAt() { return this.props.startedAt; }
  get completedAt() { return this.props.completedAt; }
}
