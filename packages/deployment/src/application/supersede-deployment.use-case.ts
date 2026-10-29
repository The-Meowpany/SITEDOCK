import { DeploymentRepository } from "../domain/ports";

/** Supersedes an old deployment - sets its status to CANCELED. */
export class SupersedeDeploymentUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(deploymentId: string): Promise<void> {
    const deployment = await this.deployments.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    deployment.cancel();
    await this.deployments.save(deployment);
  }
}