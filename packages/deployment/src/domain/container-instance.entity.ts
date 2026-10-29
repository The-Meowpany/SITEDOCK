import { ContainerInstanceStatus, containerInstanceStateMachine } from "./container-instance-status";

export interface ContainerInstanceProps {
  id: string;
  serviceId: string;
  deploymentId: string | null;
  containerId: string;
  status: ContainerInstanceStatus;
  hostPort: number | null;
  containerPort: number;
  startedAt: Date;
  stoppedAt: Date | null;
  restartCount: number;
  lastHealthCheck: Date | null;
}

/**
 * ContainerInstance represents one running container for a service deployment.
 * Each service can have multiple container instances (for scaling), though
 * currently SiteDock runs one instance per service deployment.
 */
export class ContainerInstance {
  private constructor(private props: ContainerInstanceProps) {}

  static create(params: {
    id: string;
    serviceId: string;
    deploymentId: string | null;
    containerId: string;
    hostPort: number | null;
    containerPort: number;
  }): ContainerInstance {
    const now = new Date();
    return new ContainerInstance({
      id: params.id,
      serviceId: params.serviceId,
      deploymentId: params.deploymentId,
      containerId: params.containerId,
      status: "RUNNING",
      hostPort: params.hostPort,
      containerPort: params.containerPort,
      startedAt: now,
      stoppedAt: null,
      restartCount: 0,
      lastHealthCheck: now,
    });
  }

  static hydrate(props: ContainerInstanceProps): ContainerInstance {
    return new ContainerInstance(props);
  }

  private transitionTo(next: ContainerInstanceStatus): void {
    containerInstanceStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
  }

  markStopped(): void {
    this.transitionTo("STOPPED");
    this.props.stoppedAt = new Date();
  }

  markFailed(): void {
    this.transitionTo("FAILED");
    this.props.stoppedAt = new Date();
  }

  markRunning(): void {
    this.transitionTo("RUNNING");
    this.props.stoppedAt = null;
    this.props.restartCount = (this.props.restartCount || 0) + 1;
    this.props.lastHealthCheck = new Date();
  }

  updateHealthCheck(): void {
    this.props.lastHealthCheck = new Date();
  }

  get id() { return this.props.id; }
  get serviceId() { return this.props.serviceId; }
  get deploymentId() { return this.props.deploymentId; }
  get containerId() { return this.props.containerId; }
  get status() { return this.props.status; }
  get hostPort() { return this.props.hostPort; }
  get containerPort() { return this.props.containerPort; }
  get startedAt() { return this.props.startedAt; }
  get stoppedAt() { return this.props.stoppedAt; }
  get restartCount() { return this.props.restartCount; }
  get lastHealthCheck() { return this.props.lastHealthCheck; }
}
