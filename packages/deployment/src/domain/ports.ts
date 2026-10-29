import { WebsiteId } from "@sitedock/shared";
import { Deployment } from "./deployment.entity";
import { Preview, PreviewRevision } from "./preview.entity";
import { WebsiteBackup } from "./backup.entity";
import { Service } from "./service.entity";
import { ServiceDeployment } from "./service-deployment.entity";
import { ContainerInstance } from "./container-instance.entity";
import { DeploymentLog } from "./deployment-log.entity";

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
export interface PreviewRepository {
  findById(id: string): Promise<Preview | null>;
  findByWebsiteAndBranch(websiteId: WebsiteId, branch: string): Promise<Preview | null>;
  findByWebsite(websiteId: WebsiteId): Promise<Preview[]>;
  findByCommitSha(commitSha: string): Promise<Preview | null>;
  findByHostname(hostname: string): Promise<Preview | null>;
  save(preview: Preview): Promise<void>;
  delete(id: string): Promise<void>;

  // ── Durable preview queue (lease-generation fenced) ──
  /** Atomically creates/updates a preview and appends its next revision. */
  enqueueRevision(input: {
    previewId: string;
    websiteId: WebsiteId;
    branch: string;
    commitSha: string;
    hostname: string;
  }): Promise<PreviewRevision>;
  findRevisionById(id: string): Promise<PreviewRevision | null>;
  listRevisions(previewId: string): Promise<PreviewRevision[]>;
  findLatestRevision(previewId: string): Promise<PreviewRevision | null>;
  claimNextRevision(workerId: string, now: Date, leaseMs: number): Promise<PreviewRevision | null>;
  saveRevisionWithLease(revision: PreviewRevision, workerId: string, leaseGeneration: number): Promise<void>;
  renewRevisionLease(
    revisionId: string,
    workerId: string,
    leaseGeneration: number,
    leaseMs: number,
    now?: Date
  ): Promise<boolean>;
  /** Atomically publishes a healthy revision and swaps the routing pointer. */
  activateRevisionWithLease(
    revision: PreviewRevision,
    previewId: string,
    workerId: string,
    leaseGeneration: number
  ): Promise<void>;
  /** Requeues a FAILED revision with its original commit SHA. */
  retryRevision(previewId: string, revisionId: string): Promise<PreviewRevision>;
  listCleanupRequests(limit?: number): Promise<Preview[]>;
  claimCleanup(previewId: string): Promise<boolean>;
  completeCleanup(previewId: string, error?: string | null): Promise<void>;

  // ── Preview-local container state (no production tables are touched) ──
  stopPreviewContainer(previewId: string): Promise<string | null>;
  deleteRevisions(previewId: string): Promise<void>;
}

export interface ServiceRepository {
  findById(id: string): Promise<Service | null>;
  findByIdForProject(id: string, projectId: string): Promise<Service | null>;
  findByIdForWorkspace(id: string, workspaceId: string): Promise<Service | null>;
  findByHostname(hostname: string): Promise<Service | null>;
  listByProject(projectId: string): Promise<Service[]>;
  getNextVersion(projectId: string): Promise<number>;
  save(service: Service): Promise<void>;
}

export interface ServiceDeploymentRepository {
  findById(id: string): Promise<ServiceDeployment | null>;
  findByIdForService(id: string, serviceId: string): Promise<ServiceDeployment | null>;
  findByIdempotencyKey(key: string, serviceId: string): Promise<ServiceDeployment | null>;
  listClaimable(now: Date): Promise<ServiceDeployment[]>;
  claimNext(workerId: string, now: Date, leaseMs: number): Promise<ServiceDeployment | null>;
  listByService(serviceId: string): Promise<ServiceDeployment[]>;
  listByStatus(status: string): Promise<ServiceDeployment[]>;
  listLiveByService(serviceId: string): Promise<ServiceDeployment | null>;
  getNextVersion(serviceId: string): Promise<number>;
  save(deployment: ServiceDeployment): Promise<void>;
  saveWithLease(deployment: ServiceDeployment, workerId: string, leaseGeneration: number): Promise<void>;
  renewLease(
    deploymentId: string,
    workerId: string,
    leaseGeneration: number,
    leaseMs: number,
    now?: Date
  ): Promise<boolean>;
  activateWithLease(
    deployment: ServiceDeployment,
    service: Service,
    workerId: string,
    leaseGeneration: number
  ): Promise<void>;
}

export interface ContainerInstanceRepository {
  findById(id: string): Promise<ContainerInstance | null>;
  findByIdForDeployment(id: string, deploymentId: string): Promise<ContainerInstance | null>;
  listByDeployment(deploymentId: string): Promise<ContainerInstance[]>;
  listLiveByDeployment(deploymentId: string): Promise<ContainerInstance | null>;
  save(instance: ContainerInstance): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DeploymentLogRepository {
  create(
    deploymentId: string,
    level: string,
    message: string,
    metadata?: Record<string, unknown> | null
  ): Promise<DeploymentLog>;
  listByDeployment(deploymentId: string): Promise<DeploymentLog[]>;
}

export interface StorageProvider {
  put(path: string, content: Buffer, contentType?: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
