import crypto, { createHmac } from "node:crypto";
import { DomainError } from "@sitedock/shared";

export interface GitHubRepositoryConnectionProps {
  id: string;
  organizationId: string;
  installationId: string;
  repositoryId: string; // "owner/repo" format, stable identity
  repositoryName: string; // display name
  repositoryFullName: string; // "owner/repo" format
  defaultBranch: string;
  pinnedCommitSha: string | null; // immutable once set
  webhookSecret: string; // for this specific connection's webhook validation
  createdAt: Date;
  updatedAt: Date;
}

/** 
 * GitHub repository connection aggregate.
 * Associates a SiteDock organization with an authorized GitHub installation
 * and a stable repository identity. Used for tenant isolation and webhook routing.
 */
export class GitHubRepositoryConnection {
  private constructor(private props: GitHubRepositoryConnectionProps) {}

  static create(params: {
    organizationId: string;
    installationId: string;
    repositoryId: string; // "owner/repo" stable identity
    repositoryName: string;
    repositoryFullName: string;
    defaultBranch: string;
  }): GitHubRepositoryConnection {
    const now = new Date();
    return new GitHubRepositoryConnection({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      installationId: params.installationId,
      repositoryId: params.repositoryId,
      repositoryName: params.repositoryName,
      repositoryFullName: params.repositoryFullName,
      defaultBranch: params.defaultBranch,
      pinnedCommitSha: null,
      webhookSecret: crypto.randomBytes(32).toString("hex"),
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Get the stable repository identity (never mutable repository name) */
  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get installationId(): string { return this.props.installationId; }
  get repositoryId(): string { return this.props.repositoryId; } // "owner/repo" - stable
  get repositoryName(): string { return this.props.repositoryName; }
  get repositoryFullName(): string { return this.props.repositoryFullName; }
  get defaultBranch(): string { return this.props.defaultBranch; }
  get pinnedCommitSha(): string | null { return this.props.pinnedCommitSha; }
  get webhookSecret(): string { return this.props.webhookSecret; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Pin the exact commit SHA - immutable after first set */
  pinCommitSha(sha: string): void {
    if (this.props.pinnedCommitSha !== null) {
      throw new DomainError(
        `Cannot re-pin commit SHA for connection ${this.props.id}: already pinned to "${this.props.pinnedCommitSha}"`,
        "COMMIT_ALREADY_PINNED"
      );
    }
    // Note: we directly mutate the private prop since this is an aggregate root
    // and we control all writes. In a real repository, this would be via a repository.
    ;(this.props as { pinnedCommitSha: string | null }).pinnedCommitSha = sha;
    this.props.updatedAt = new Date();
  }

  /** Update the default branch (e.g., after repository rename) */
  updateDefaultBranch(branch: string): void {
    ;(this.props as { defaultBranch: string }).defaultBranch = branch;
    this.props.updatedAt = new Date();
  }

  /** Webhook secret validation */
  validateWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!signature.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.props.webhookSecret)
      .update(payload)
      .digest("hex");
    const signatureMatch = signature.slice(7);
    if (expected.length !== signatureMatch.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureMatch)
    );
  }
}