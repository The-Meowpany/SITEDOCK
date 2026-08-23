import { DomainError, WebsiteId } from "@sitedock/shared";
import { DeploymentStatus, deploymentStateMachine } from "./deployment-status";

export interface DeploymentProps {
  id: string;
  websiteId: WebsiteId;
  version: number;
  status: DeploymentStatus;
  storagePath: string;
  fileCount: number | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  uploadedById: string;
  createdAt: Date;
  publishedAt: Date | null;
}

/**
 * Deployment aggregate. Represents one immutable version of a website's static
 * files. Deployment never knows about billing or payments — the relationship to
 * Website/Subscription is established at the application layer only
 * (docs/ARCHITECTURE.md §68).
 */
export class Deployment {
  private constructor(private props: DeploymentProps) {}

  static create(params: { id: string; websiteId: WebsiteId; version: number; storagePath: string; uploadedById: string }): Deployment {
    const now = new Date();
    return new Deployment({
      id: params.id,
      websiteId: params.websiteId,
      version: params.version,
      status: "QUEUED",
      storagePath: params.storagePath,
      fileCount: null,
      sizeBytes: null,
      errorMessage: null,
      uploadedById: params.uploadedById,
      createdAt: now,
      publishedAt: null,
    });
  }

  static hydrate(props: DeploymentProps): Deployment {
    return new Deployment(props);
  }

  private transitionTo(next: DeploymentStatus): void {
    deploymentStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
  }

  startBuilding(): void {
    this.transitionTo("BUILDING");
  }

  markReady(stats: { fileCount: number; sizeBytes: number }): void {
    this.transitionTo("READY");
    this.props.fileCount = stats.fileCount;
    this.props.sizeBytes = stats.sizeBytes;
  }

  markFailed(errorMessage: string): void {
    this.transitionTo("FAILED");
    this.props.errorMessage = errorMessage;
  }

  cancel(): void {
    this.transitionTo("CANCELED");
  }

  /** Can only publish a READY deployment — protects the core invariant of the pipeline. */
  publish(): void {
    if (this.props.status !== "READY") {
      throw new DomainError(
        `Cannot publish deployment ${this.props.id} because it is ${this.props.status}, not READY`,
        "DEPLOYMENT_NOT_READY"
      );
    }
    this.transitionTo("PUBLISHED");
    this.props.publishedAt = new Date();
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get version() { return this.props.version; }
  get status() { return this.props.status; }
  get storagePath() { return this.props.storagePath; }
  get fileCount() { return this.props.fileCount; }
  get sizeBytes() { return this.props.sizeBytes; }
  get errorMessage() { return this.props.errorMessage; }
  get uploadedById() { return this.props.uploadedById; }
  get createdAt() { return this.props.createdAt; }
  get publishedAt() { return this.props.publishedAt; }
}
