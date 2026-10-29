import os from "node:os";
import { prisma } from "@sitedock/database";
import {
  CleanupPreviewUseCase,
  ContainerService,
  ExecutePreviewRevisionUseCase,
  PrismaPreviewRepository,
  type PreviewBuildSource,
} from "@sitedock/deployment";
import { SecretCipher } from "@sitedock/shared";
import { logger } from "../logger";

const LEASE_MS = 300_000;

const previews = new PrismaPreviewRepository();
const containerService = new ContainerService();
const secretCipher = SecretCipher.fromEnv(process.env);
const executePreviewRevision = new ExecutePreviewRevisionUseCase(previews, containerService, secretCipher);
const cleanupPreview = new CleanupPreviewUseCase(previews, containerService);

export function defaultWorkerId(): string {
  return process.env.WORKER_ID ?? `worker-preview-${os.hostname()}-${process.pid}`;
}

/**
 * Resolve the runtime source for a website's preview.
 *
 * Previews reuse the project's runtime service definition (Dockerfile/build
 * context, port and resource limits) — they never invent a second build system.
 * The build itself is pinned to the revision's commit SHA by the use case.
 */
async function resolvePreviewSource(websiteId: string): Promise<PreviewBuildSource> {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { projectId: true },
  });
  if (!website) {
    throw new Error(`Website ${websiteId} not found for preview`);
  }

  const service = await prisma.service.findFirst({
    where: { projectId: website.projectId },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });
  if (!service) {
    throw new Error(
      `Project ${website.projectId} has no runtime service configured; a preview cannot be built`
    );
  }

  return {
    serviceId: service.id,
    sourceType: service.sourceType,
    sourceUrl: service.sourceUrl,
    sourcePath: service.sourcePath,
    dockerfile: service.dockerfile,
    contextFiles: (service.contextFiles as Record<string, string> | null) ?? null,
    port: service.port,
    env: (service.env as Record<string, unknown> | null) ?? null,
    secrets: (service.secrets as Record<string, unknown> | null) ?? null,
    cpuLimit: service.cpuLimit,
    memoryLimit: service.memoryLimit,
    pidsLimit: service.pidsLimit,
    readonlyRoot: service.readonlyRoot,
  };
}

export async function runProcessQueuedPreviewDeploymentsJob(
  workerId: string = defaultWorkerId()
): Promise<{ processed: number; failed: number; cleanupRequests: number }> {
  let processed = 0;
  let failed = 0;

  // 1. Durable cleanup first: a deleted preview must stop routing before its
  // containers are removed, and cleanup must not wait behind builds.
  const cleanupRequests = await previews.listCleanupRequests(20);
  for (const preview of cleanupRequests) {
    const result = await cleanupPreview.execute(preview.id);
    logger.info(
      { previewId: preview.id, stoppedContainers: result.stopped, error: result.error },
      result.error ? "Preview cleanup failed (will be retried)" : "Preview cleanup completed"
    );
  }

  // 2. Drain claimed revisions one at a time. claimNextRevision is the same
  // durable, lease-generation-fenced claim used by service deployments.
  while (true) {
    const revision = await previews.claimNextRevision(workerId, new Date(), LEASE_MS);
    if (!revision) break;

    logger.info(
      {
        revisionId: revision.id,
        previewId: revision.previewId,
        commitSha: revision.commitSha,
        sequence: revision.sequence,
        attempts: revision.attempts,
        leaseGeneration: revision.leaseGeneration,
        workerId,
      },
      "Claimed preview revision"
    );

    try {
      const preview = await previews.findById(revision.previewId);
      if (!preview) {
        const message = `Preview ${revision.previewId} referenced by revision ${revision.id} not found`;
        const failedRevision = revision.markFailed(message);
        await previews.saveRevisionWithLease(failedRevision, workerId, revision.leaseGeneration);
        failed += 1;
        continue;
      }

      const source = await resolvePreviewSource(String(preview.websiteId));
      const result = await executePreviewRevision.execute({
        revisionId: revision.id,
        workerId,
        leaseGeneration: revision.leaseGeneration,
        source,
      });

      processed += 1;
      logger.info(
        {
          previewId: result.previewId,
          revisionId: result.revisionId,
          commitSha: revision.commitSha,
          imageDigest: result.imageDigest,
          containerId: result.containerId,
          hostPort: result.hostPort,
        },
        "Preview revision healthy and published"
      );
    } catch (err) {
      failed += 1;
      logger.error(
        {
          revisionId: revision.id,
          previewId: revision.previewId,
          err: { name: (err as Error).name, message: (err as Error).message, code: (err as { code?: string }).code },
        },
        "Preview revision processing failed"
      );
      // Failure/retry state is persisted with lease fencing inside the use case.
    }
  }

  return { processed, failed, cleanupRequests: cleanupRequests.length };
}
