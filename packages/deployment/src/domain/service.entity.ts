import { DomainError } from "@sitedock/shared";
import { ServiceType, ServiceStatus, serviceStateMachine } from "./service-status";

export interface ServiceProps {
  id: string;
  projectId: string;
  environmentId?: string | null;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  hostname: string;
  activeDeploymentId: string | null;
  sourceType: string;
  sourceUrl: string | null;
  sourceBranch: string | null;
  sourcePath: string | null;
  dockerfile: string | null;
  contextFiles: Record<string, string> | null;
  buildCommand: string | null;
  startCommand: string | null;
  port: number;
  env: Record<string, unknown> | null;
  secrets?: Record<string, unknown> | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
  pidsLimit: number | null;
  readonlyRoot: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service aggregate. Represents one service within a project - e.g. a frontend,
 * backend API, background worker, database, or scheduled task. Each service has
 * its own deployment lifecycle independent of other services in the project.
 */
export class Service {
  private constructor(private props: ServiceProps) {}

  static create(params: {
    id: string;
    projectId: string;
    environmentId?: string | null;
    name: string;
    type: ServiceType;
    hostname: string;
    sourceType?: string;
    sourceUrl?: string | null;
    sourceBranch?: string | null;
    sourcePath?: string | null;
    dockerfile?: string | null;
    contextFiles?: Record<string, string> | null;
    buildCommand?: string | null;
    startCommand?: string | null;
    port?: number;
    env?: Record<string, unknown> | null;
    secrets?: Record<string, unknown> | null;
    cpuLimit?: string | null;
    memoryLimit?: string | null;
    pidsLimit?: number | null;
    readonlyRoot?: boolean;
  }): Service {
    const now = new Date();
    return new Service({
      id: params.id,
      projectId: params.projectId,
      environmentId: params.environmentId ?? null,
      name: params.name.trim(),
      type: params.type,
      status: "PENDING",
      hostname: params.hostname,
      activeDeploymentId: null,
      sourceType: params.sourceType ?? "github",
      sourceUrl: params.sourceUrl ?? null,
      sourceBranch: params.sourceBranch ?? null,
      sourcePath: params.sourcePath ?? null,
      dockerfile: params.dockerfile ?? null,
      contextFiles: params.contextFiles ?? null,
      buildCommand: params.buildCommand ?? null,
      startCommand: params.startCommand ?? null,
      port: params.port ?? 8080,
      env: params.env ?? null,
      secrets: params.secrets ?? null,
      cpuLimit: params.cpuLimit ?? null,
      memoryLimit: params.memoryLimit ?? null,
      pidsLimit: params.pidsLimit ?? null,
      readonlyRoot: params.readonlyRoot ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: ServiceProps): Service {
    return new Service(props);
  }

  private transitionTo(next: ServiceStatus): void {
    serviceStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
    this.props.updatedAt = new Date();
  }

  startBuilding(): void {
    this.transitionTo("BUILDING");
  }

  startDeploying(): void {
    this.transitionTo("DEPLOYING");
  }

  markLive(): void {
    this.transitionTo("LIVE");
  }

  /**
   * Activates an already healthy deployment. The active deployment id is the
   * authoritative routing pointer; failed or merely READY versions are never
   * selected.
   */
  activate(deploymentId: string): void {
    if (this.props.status !== "LIVE") this.transitionTo("LIVE");
    this.props.activeDeploymentId = deploymentId;
    this.props.updatedAt = new Date();
  }

  /**
   * Restores the previous LIVE status after a *new* deployment failed while an
   * older healthy deployment is still serving traffic. Direct assignment is
   * intentional: the transitional states BUILDING/DEPLOYING are not valid
   * sources for the LIVE transition, but rolling back to the existing live
   * version is exactly the desired recovery.
   */
  restorePreviousLive(): void {
    if (!this.props.activeDeploymentId) {
      throw new DomainError(
        `Cannot restore service ${this.props.id} to LIVE without an active deployment`,
        "NO_ACTIVE_DEPLOYMENT"
      );
    }
    this.props.status = "LIVE";
    this.props.updatedAt = new Date();
  }

  updateConfiguration(params: {
    name?: string;
    sourceType?: string;
    sourceUrl?: string | null;
    sourceBranch?: string | null;
    sourcePath?: string | null;
    dockerfile?: string | null;
    contextFiles?: Record<string, string> | null;
    buildCommand?: string | null;
    startCommand?: string | null;
    port?: number;
    env?: Record<string, unknown> | null;
    secrets?: Record<string, unknown> | null;
    cpuLimit?: string | null;
    memoryLimit?: string | null;
    pidsLimit?: number | null;
    readonlyRoot?: boolean;
  }): void {
    if (params.name !== undefined) this.props.name = params.name.trim();
    if (params.sourceType !== undefined) this.props.sourceType = params.sourceType;
    if (params.sourceUrl !== undefined) this.props.sourceUrl = params.sourceUrl;
    if (params.sourceBranch !== undefined) this.props.sourceBranch = params.sourceBranch;
    if (params.sourcePath !== undefined) this.props.sourcePath = params.sourcePath;
    if (params.dockerfile !== undefined) this.props.dockerfile = params.dockerfile;
    if (params.contextFiles !== undefined) this.props.contextFiles = params.contextFiles;
    if (params.buildCommand !== undefined) this.props.buildCommand = params.buildCommand;
    if (params.startCommand !== undefined) this.props.startCommand = params.startCommand;
    if (params.port !== undefined) this.props.port = params.port;
    if (params.env !== undefined) this.props.env = params.env;
    if (params.secrets !== undefined) this.props.secrets = params.secrets;
    if (params.cpuLimit !== undefined) this.props.cpuLimit = params.cpuLimit;
    if (params.memoryLimit !== undefined) this.props.memoryLimit = params.memoryLimit;
    if (params.pidsLimit !== undefined) this.props.pidsLimit = params.pidsLimit;
    if (params.readonlyRoot !== undefined) this.props.readonlyRoot = params.readonlyRoot;
    this.props.updatedAt = new Date();
  }

  markFailed(_errorMessage: string): void {
    this.transitionTo("FAILED");
    this.props.status = "FAILED";
    this.props.updatedAt = new Date();
  }

  stop(): void {
    this.transitionTo("STOPPED");
  }

  supersede(): void {
    if (this.props.status !== "LIVE") {
      throw new DomainError(
        `Cannot supersede service ${this.props.id} because it is ${this.props.status}, not LIVE`,
        "SERVICE_NOT_LIVE"
      );
    }
    this.transitionTo("SUPERSEDED");
  }

  get id() { return this.props.id; }
  get projectId() { return this.props.projectId; }
  get name() { return this.props.name; }
  get type() { return this.props.type; }
  get status() { return this.props.status; }
  get hostname() { return this.props.hostname; }
  get activeDeploymentId() { return this.props.activeDeploymentId; }
  get sourceType() { return this.props.sourceType; }
  get sourceUrl() { return this.props.sourceUrl; }
  get sourceBranch() { return this.props.sourceBranch; }
  get sourcePath() { return this.props.sourcePath; }
  get dockerfile() { return this.props.dockerfile; }
  get contextFiles() { return this.props.contextFiles; }
  get buildCommand() { return this.props.buildCommand; }
  get startCommand() { return this.props.startCommand; }
  get port() { return this.props.port; }
  get env() { return this.props.env; }
  get environmentId() { return this.props.environmentId; }
  get secrets() { return this.props.secrets; }
  get cpuLimit() { return this.props.cpuLimit; }
  get memoryLimit() { return this.props.memoryLimit; }
  get pidsLimit() { return this.props.pidsLimit; }
  get readonlyRoot() { return this.props.readonlyRoot; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  toJSON(): Omit<ServiceProps, "secrets"> {
    const { secrets: _secrets, ...safe } = this.props;
    return safe;
  }
}
