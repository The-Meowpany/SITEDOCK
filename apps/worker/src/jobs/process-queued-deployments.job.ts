import os from "node:os";
import {
  BuildAndDeployServiceUseCase,
  ContainerService,
  PrismaContainerInstanceRepository,
  PrismaServiceDeploymentLogRepository,
  PrismaServiceDeploymentRepository,
  PrismaServiceRepository,
} from "@sitedock/deployment";
import { SecretCipher } from "@sitedock/shared";
import { logger } from "../logger";

const serviceRepository = new PrismaServiceRepository();
const serviceDeploymentRepository = new PrismaServiceDeploymentRepository();
const containerInstanceRepository = new PrismaContainerInstanceRepository();
const deploymentLogRepository = new PrismaServiceDeploymentLogRepository();
const containerService = new ContainerService();
const secretCipher = SecretCipher.fromEnv(process.env);

const buildAndDeployService = new BuildAndDeployServiceUseCase(
  serviceRepository,
  serviceDeploymentRepository,
  containerInstanceRepository,
  deploymentLogRepository,
  containerService,
  secretCipher
);

const LEASE_MS = 300_000;

export function defaultWorkerId(): string {
  return process.env.WORKER_ID ?? `worker-${os.hostname()}-${process.pid}`;
}

export async function runProcessQueuedDeploymentsJob(
  workerId: string = defaultWorkerId()
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Drain the queue one atomically-claimed deployment at a time.
  while (true) {
    const deployment = await serviceDeploymentRepository.claimNext(workerId, new Date(), LEASE_MS);
    if (!deployment) break;

    logger.info(
      {
        deploymentId: deployment.id,
        serviceId: deployment.serviceId,
        version: deployment.version,
        workerId,
        leaseGeneration: deployment.leaseGeneration,
        attempts: deployment.attempts,
      },
      "Claimed queued service deployment"
    );

    try {
      const service = await serviceRepository.findById(deployment.serviceId);
      if (!service) {
        const message = `Service ${deployment.serviceId} referenced by deployment ${deployment.id} not found`;
        logger.error({ deploymentId: deployment.id, serviceId: deployment.serviceId }, message);
        if (deployment.hasRetriesRemaining()) {
          deployment.scheduleRetry(30_000);
        } else {
          deployment.markFailed(message);
        }
        await serviceDeploymentRepository.saveWithLease(deployment, workerId, deployment.leaseGeneration);
        failed += 1;
        continue;
      }

      const result = await buildAndDeployService.execute({
        serviceId: service.id,
        deploymentId: deployment.id,
        workerId,
        leaseGeneration: deployment.leaseGeneration,
      });
      processed += 1;
      logger.info(
        {
          deploymentId: deployment.id,
          version: result.version,
          containerId: result.containerId,
          hostPort: result.hostPort,
        },
        "Service deployment successfully processed and activated"
      );
    } catch (err) {
      failed += 1;
      logger.error(
        { deploymentId: deployment.id, err: { name: (err as Error).name, message: (err as Error).message, code: (err as { code?: string }).code } },
        "Failed to process service deployment"
      );
      // Failure/retry state is persisted with lease fencing inside the use case.
    }
  }

  return { processed, failed };
}
