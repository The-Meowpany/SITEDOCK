import { randomUUID } from "node:crypto";
import { ApplicationError } from "@sitedock/shared";
import { ServiceDeployment } from "../domain/service-deployment.entity";
import { ServiceDeploymentRepository, ServiceRepository } from "../domain/ports";

export interface EnqueueServiceDeploymentResult {
  deploymentId: string;
  version: number;
  status: string;
}

/**
 * Enqueue a service deployment using the durable queue. Idempotency keys are
 * scoped to the service, so replaying a webhook never creates a second build.
 */
export class EnqueueServiceDeploymentUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly deployments: ServiceDeploymentRepository
  ) {}

  async execute(input: {
    serviceId: string;
    idempotencyKey?: string | null;
  }): Promise<EnqueueServiceDeploymentResult> {
    const service = await this.services.findById(input.serviceId);
    if (!service) {
      throw new ApplicationError(`Service ${input.serviceId} not found`, "SERVICE_NOT_FOUND");
    }

    if (input.idempotencyKey) {
      const existing = await this.deployments.findByIdempotencyKey(input.idempotencyKey, service.id);
      if (existing) {
        return {
          deploymentId: existing.id,
          version: existing.version,
          status: existing.status,
        };
      }
    }

    const version = await this.deployments.getNextVersion(service.id);
    const deployment = ServiceDeployment.create({
      id: randomUUID(),
      serviceId: service.id,
      version,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await this.deployments.save(deployment);

    return {
      deploymentId: deployment.id,
      version: deployment.version,
      status: deployment.status,
    };
  }
}
