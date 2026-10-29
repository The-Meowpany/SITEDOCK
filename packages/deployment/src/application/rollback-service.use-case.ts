import { randomUUID } from "node:crypto";
import { ApplicationError, InfrastructureError, SecretCipher } from "@sitedock/shared";
import { ContainerInstance } from "../domain/container-instance.entity";
import {
  ContainerInstanceRepository,
  DeploymentLogRepository,
  ServiceDeploymentRepository,
  ServiceRepository,
} from "../domain/ports";
import { ContainerService } from "../infrastructure/container-service";
import { decryptSecrets, pollHealth, stringifyEnv } from "./build-and-deploy-service.use-case";

/**
 * Roll a service back to an earlier READY deployment.
 *
 * The previous immutable image is re-run in a new container and must pass its
 * health check before the service's active deployment pointer moves. If health
 * fails, the currently serving deployment is untouched.
 */
export class RollbackServiceUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly deployments: ServiceDeploymentRepository,
    private readonly instances: ContainerInstanceRepository,
    private readonly logs: DeploymentLogRepository,
    private readonly containerService: ContainerService,
    private readonly secretCipher: SecretCipher | null = null
  ) {}

  async execute(input: { serviceId: string; targetVersion: number }): Promise<{
    deploymentId: string;
    version: number;
    containerId: string;
    hostPort: number;
  }> {
    const service = await this.services.findById(input.serviceId);
    if (!service) throw new ApplicationError(`Service ${input.serviceId} not found`, "SERVICE_NOT_FOUND");

    const deployments = await this.deployments.listByService(service.id);
    const target = deployments.find((d) => d.version === input.targetVersion);
    if (!target) {
      throw new ApplicationError(
        `Version ${input.targetVersion} does not exist for service ${service.id}`,
        "TARGET_VERSION_NOT_FOUND"
      );
    }
    if (target.status !== "READY" || !target.imageId) {
      throw new ApplicationError(
        `Version ${target.version} is ${target.status} and has no runnable immutable image`,
        "TARGET_VERSION_NOT_READY"
      );
    }

    const containerPort = service.port;
    const running = await this.containerService.runContainer(target.imageId, {
      name: `sitedock-${service.id}-rollback-v${target.version}`,
      env: {
        ...stringifyEnv(service.env),
        ...decryptSecrets(service.secrets ?? null, this.secretCipher),
      },
      ports: { [String(containerPort)]: "0" },
      memoryLimit: service.memoryLimit || undefined,
      cpuLimit: service.cpuLimit || undefined,
      pidsLimit: service.pidsLimit ?? undefined,
      readonlyRoot: service.readonlyRoot,
      labels: {
        "sitedock.deployment.id": target.id,
        "sitedock.service.id": service.id,
        "sitedock.version": String(target.version),
        "sitedock.rollback": "true",
      },
    });

    try {
      const healthy = await pollHealth(this.containerService, running.id, "/health");
      if (!healthy) {
        throw new InfrastructureError(
          `Rollback health check failed for deployment ${target.id}`,
          "HEALTH_CHECK_FAILED"
        );
      }

      const instance = ContainerInstance.create({
        id: randomUUID(),
        serviceId: service.id,
        deploymentId: target.id,
        containerId: running.id,
        hostPort: running.hostPort,
        containerPort,
      });
      await this.instances.save(instance);

      service.activate(target.id);
      await this.services.save(service);
      await this.logs.create(target.id, "info", "Rollback activated after health verification", {
        containerId: running.id,
        hostPort: running.hostPort,
        version: target.version,
      });

      // Retire previous runtime instances only after the pointer moved.
      for (const deployment of deployments) {
        if (deployment.id === target.id) continue;
        for (const previous of await this.instances.listByDeployment(deployment.id)) {
          if (previous.status !== "RUNNING") continue;
          try {
            previous.markStopped();
            await this.instances.save(previous);
            await this.containerService.stopContainer(previous.containerId);
          } catch {
            // Best effort; the active pointer is already correct.
          }
        }
      }

      return {
        deploymentId: target.id,
        version: target.version,
        containerId: running.id,
        hostPort: running.hostPort,
      };
    } catch (err) {
      try {
        await this.containerService.stopContainer(running.id);
      } catch {
        // Ignore cleanup failure; the old deployment is still serving.
      }
      throw err;
    }
  }
}
