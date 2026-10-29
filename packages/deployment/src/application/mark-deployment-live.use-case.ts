import { DeploymentRepository } from "../domain/ports";

/** Marks a deployment as "live" - the deployment is now in production. */
export class MarkDeploymentLiveUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(deploymentId: string): Promise<void> {
    const deployment = await this.deployments.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    deployment.publish();
    await this.deployments.save(deployment);
  }
}