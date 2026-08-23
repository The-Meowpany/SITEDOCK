import { ClientId, DomainError, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { WebsiteStatus, websiteStateMachine } from "./website-status";

export interface WebsiteProps {
  id: WebsiteId;
  workspaceId: WorkspaceId;
  projectId: string;
  clientId: ClientId | null;
  name: string;
  subdomain: string;
  status: WebsiteStatus;
  productionDeploymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function slugifySubdomain(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base}-${suffix}`.slice(0, 63);
}

/**
 * Website aggregate. Owns its lifecycle state machine and protects the core
 * invariant: a website can never become LIVE without a READY deployment
 * (docs/ARCHITECTURE.md §5 "Aggregates").
 */
export class Website {
  private constructor(private props: WebsiteProps) {}

  static create(params: { id: WebsiteId; workspaceId: WorkspaceId; projectId: string; name: string }): Website {
    if (params.name.trim().length < 2) {
      throw new DomainError("Website name must have at least 2 characters", "INVALID_WEBSITE_NAME");
    }
    const subdomain = slugifySubdomain(params.name, params.id.slice(0, 8));
    if (!SUBDOMAIN_RE.test(subdomain)) {
      throw new DomainError(`Generated subdomain "${subdomain}" is invalid`, "INVALID_SUBDOMAIN");
    }
    const now = new Date();
    return new Website({
      id: params.id,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      clientId: null,
      name: params.name.trim(),
      subdomain,
      status: "DRAFT",
      productionDeploymentId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: WebsiteProps): Website {
    return new Website(props);
  }

  private transitionTo(next: WebsiteStatus): void {
    websiteStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
    this.props.updatedAt = new Date();
  }

  assignClient(clientId: ClientId): void {
    this.props.clientId = clientId;
    this.props.updatedAt = new Date();
  }

  /** Called once the first deployment has been stored and a preview URL exists. */
  moveToPreview(): void {
    this.transitionTo("PREVIEW");
  }

  submitForClientApproval(): void {
    this.transitionTo("PENDING_APPROVAL");
  }

  approve(): void {
    this.transitionTo("APPROVED");
  }

  rejectApproval(): void {
    this.transitionTo("PREVIEW");
  }

  /**
   * Publishes a READY deployment to production. Requires the website to be
   * APPROVED for the first publish; once LIVE, publishing again (redeploy or
   * rollback) does not change the website status, only the pointer.
   */
  publish(deploymentId: string, deploymentStatus: "READY" | "PUBLISHED"): void {
    if (deploymentStatus !== "READY" && deploymentStatus !== "PUBLISHED") {
      throw new DomainError("Cannot publish a deployment that is not READY", "DEPLOYMENT_NOT_READY");
    }
    if (this.props.status === "APPROVED") {
      this.transitionTo("LIVE");
    } else if (this.props.status !== "LIVE") {
      throw new DomainError(
        `Cannot publish a deployment while website is ${this.props.status}`,
        "INVALID_STATE_TRANSITION"
      );
    }
    this.props.productionDeploymentId = deploymentId;
    this.props.updatedAt = new Date();
  }

  /** Rollback to a previously published deployment. Website must already be LIVE. */
  rollbackTo(deploymentId: string): void {
    if (this.props.status !== "LIVE" && this.props.status !== "SUSPENDED") {
      throw new DomainError("Can only roll back a LIVE or SUSPENDED website", "INVALID_STATE_TRANSITION");
    }
    this.props.productionDeploymentId = deploymentId;
    this.props.updatedAt = new Date();
  }

  markPastDue(): void {
    this.transitionTo("PAST_DUE");
  }

  markGracePeriod(): void {
    this.transitionTo("GRACE_PERIOD");
  }

  suspend(): void {
    this.transitionTo("SUSPENDED");
  }

  /** Payment recovered — valid from PAST_DUE, GRACE_PERIOD, or SUSPENDED. */
  reactivate(): void {
    this.transitionTo("LIVE");
  }

  archive(): void {
    this.transitionTo("ARCHIVED");
  }

  markDeleted(): void {
    this.transitionTo("DELETED");
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get projectId() { return this.props.projectId; }
  get clientId() { return this.props.clientId; }
  get name() { return this.props.name; }
  get subdomain() { return this.props.subdomain; }
  get status() { return this.props.status; }
  get productionDeploymentId() { return this.props.productionDeploymentId; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
}
