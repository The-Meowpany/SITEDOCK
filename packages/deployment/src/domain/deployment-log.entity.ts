/**
 * DeploymentLog represents a single log entry for a deployment.
 * Logs are append-only and provide observability into the deployment lifecycle.
 */
export class DeploymentLog {
  private constructor(private props: DeploymentLogProps) {}

  static create(params: {
    id: string;
    deploymentId: string;
    level: "info" | "warn" | "error";
    message: string;
    metadata?: Record<string, unknown> | null;
  }): DeploymentLog {
    return new DeploymentLog({
      id: params.id,
      deploymentId: params.deploymentId,
      level: params.level,
      message: params.message,
      timestamp: new Date(),
      metadata: params.metadata ?? null,
    });
  }

  static hydrate(props: DeploymentLogProps): DeploymentLog {
    return new DeploymentLog(props);
  }

  /** Flat DTO for API responses (see ServiceDeployment.toJSON). */
  toJSON(): DeploymentLogProps {
    return { ...this.props };
  }

  get id() { return this.props.id; }
  get deploymentId() { return this.props.deploymentId; }
  get level() { return this.props.level; }
  get message() { return this.props.message; }
  get timestamp() { return this.props.timestamp; }
  get metadata() { return this.props.metadata; }
}

export interface DeploymentLogProps {
  id: string;
  deploymentId: string;
  level: string;
  message: string;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
}
