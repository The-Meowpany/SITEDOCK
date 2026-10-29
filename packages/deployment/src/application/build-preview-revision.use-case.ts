import { DomainError, InfrastructureError, SecretCipher } from "@sitedock/shared";
import { ContainerService } from "../infrastructure/container-service";
import { PreviewRepository } from "../domain/ports";
import {
  decodeContextFiles,
  decryptSecrets,
  materializeGitSource,
  pollHealth,
  stringifyEnv,
  validateDockerfile,
} from "./build-and-deploy-service.use-case";

const LEASE_MS = 300_000;

/** Everything the preview builder needs from the project's runtime service. */
export interface PreviewBuildSource {
  serviceId: string | null;
  sourceType: string;
  sourceUrl: string | null;
  sourcePath: string | null;
  dockerfile: string | null;
  contextFiles: Record<string, string> | null;
  port: number;
  env: Record<string, unknown> | null;
  secrets: Record<string, unknown> | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
  pidsLimit: number | null;
  readonlyRoot: boolean;
}

export interface PreviewRevisionResult {
  revisionId: string;
  previewId: string;
  imageId: string;
  imageDigest: string;
  containerId: string;
  hostPort: number;
  containerPort: number;
}

/**
 * Executes one claimed PreviewRevision through SiteDock's existing secure build
 * system and trusted runtime agent.
 *
 * Guarantees:
 * - the build is pinned to the revision's exact commit SHA;
 * - the immutable image digest is persisted before any container starts;
 * - routing is switched only after a real health check succeeds;
 * - a failed build/runtime never touches `deployments` or
 *   `websites.production_deployment_id` (the production routing tables);
 * - a failed revision leaves the preview's previously healthy revision live.
 */
export class ExecutePreviewRevisionUseCase {
  constructor(
    private readonly previews: PreviewRepository,
    private readonly containerService: ContainerService,
    private readonly secretCipher: SecretCipher | null = null
  ) {}

  async execute(params: {
    revisionId: string;
    workerId: string;
    leaseGeneration: number;
    source: PreviewBuildSource;
  }): Promise<PreviewRevisionResult> {
    const { revisionId, workerId, leaseGeneration } = params;

    const revision = await this.previews.findRevisionById(revisionId);
    if (!revision) {
      throw new DomainError(`Preview revision ${revisionId} not found`, "REVISION_NOT_FOUND");
    }
    if (revision.status !== "BUILDING" || revision.claimedBy !== workerId) {
      throw new DomainError(
        `Revision ${revisionId} is not claimed by ${workerId}`,
        "REVISION_NOT_CLAIMED"
      );
    }
    revision.assertLeaseOwner(workerId, leaseGeneration);

    const preview = await this.previews.findById(revision.previewId);
    if (!preview) {
      throw new DomainError(`Preview ${revision.previewId} not found`, "PREVIEW_NOT_FOUND");
    }
    if (preview.cleanupStatus === "REQUESTED" || preview.cleanupStatus === "RUNNING") {
      throw new DomainError(
        `Preview ${preview.id} is being cleaned up; refusing to build revision ${revision.id}`,
        "PREVIEW_CLEANUP_REQUESTED"
      );
    }

    const assertLease = async () => {
      const owned = await this.previews.renewRevisionLease(revision.id, workerId, leaseGeneration, LEASE_MS);
      if (!owned) {
        throw new DomainError(
          `Stale lease: preview revision ${revision.id} is no longer owned by ${workerId}/${leaseGeneration}`,
          "STALE_LEASE"
        );
      }
    };

    let containerId: string | null = null;
    let activated = false;

    try {
      const source = params.source;

      // 1. Materialize the build context at the exact pinned commit SHA.
      let dockerfile: string;
      let contextFiles: Record<string, Buffer>;
      if (source.sourceType === "git" || source.sourceType === "github" || source.sourceType === "local-git") {
        if (!source.sourceUrl) {
          throw new DomainError("Preview source has no repository URL", "MISSING_SOURCE_URL");
        }
        const materialized = await materializeGitSource(
          {
            sourceUrl: source.sourceUrl,
            sourcePath: source.sourcePath,
            dockerfile: source.dockerfile,
          },
          revision.commitSha
        );
        dockerfile = validateDockerfile(source.sourceType, materialized.dockerfile);
        contextFiles = materialized.contextFiles;
      } else {
        dockerfile = validateDockerfile(source.sourceType, source.dockerfile ?? "");
        contextFiles = decodeContextFiles(source.contextFiles);
      }

      await assertLease();

      // 2. Build the immutable image through the runtime agent.
      const imageTag = `sitedock-preview-${preview.id}-r${revision.sequence}`;
      const artifact = await this.containerService.buildFromDockerfile(
        dockerfile,
        contextFiles,
        imageTag
      );

      // 3. Persist build identity. The digest is immutable evidence of exactly
      // which bytes this revision produced, pinned to revision.commitSha.
      let building = revision.markBuilding(artifact.imageId, artifact.digest);
      await this.previews.saveRevisionWithLease(building, workerId, leaseGeneration);

      // 4. Start an isolated preview container. Preview labels let cleanup and
      // reconciliation act on preview-owned resources only.
      await assertLease();
      const containerPort = source.port > 0 && source.port <= 65535 ? source.port : 8080;
      const running = await this.containerService.runContainer(artifact.imageId, {
        name: `sitedock-${imageTag}`,
        env: {
          ...stringifyEnv(source.env),
          ...decryptSecrets(source.secrets ?? null, this.secretCipher),
          SITEDOCK_PREVIEW_ID: preview.id,
          SITEDOCK_PREVIEW_BRANCH: preview.branch,
          SITEDOCK_PREVIEW_COMMIT_SHA: revision.commitSha,
          SITEDOCK_PREVIEW_REVISION: String(revision.sequence),
        },
        ports: { [String(containerPort)]: "0" },
        memoryLimit: source.memoryLimit || undefined,
        cpuLimit: source.cpuLimit || undefined,
        pidsLimit: source.pidsLimit ?? undefined,
        readonlyRoot: source.readonlyRoot,
        labels: {
          "sitedock.preview.id": preview.id,
          "sitedock.revision.id": revision.id,
          "sitedock.website.id": String(preview.websiteId),
          "sitedock.commit.sha": revision.commitSha,
        },
      });
      containerId = running.id;

      // 5. Real health check against the running container.
      const healthy = await pollHealth(this.containerService, running.id, "/health");
      if (!healthy) {
        throw new InfrastructureError(
          `Health verification failed for preview revision ${revision.id} (container ${running.id})`,
          "HEALTH_CHECK_FAILED"
        );
      }

      // 6. Publish only after health succeeded, with generation fencing.
      await assertLease();
      building = building.markReady({
        imageId: artifact.imageId,
        imageDigest: artifact.digest,
        containerId: running.id,
        hostPort: running.hostPort,
        containerPort,
      });
      await this.previews.activateRevisionWithLease(building, preview.id, workerId, leaseGeneration);
      activated = true;

      // 7. Retire previous preview containers only after the pointer switched.
      await this.stopSupersededContainers(preview.id, revision.id);

      return {
        revisionId: revision.id,
        previewId: preview.id,
        imageId: artifact.imageId,
        imageDigest: artifact.digest,
        containerId: running.id,
        hostPort: running.hostPort,
        containerPort,
      };
    } catch (err) {
      if (!activated) {
        if (containerId) {
          try {
            await this.containerService.stopContainer(containerId);
          } catch {
            // Best effort: the container is not routing traffic yet.
          }
        }

        const message = (err as Error).message.slice(0, 1000);
        const isStale = err instanceof DomainError && (err.code === "STALE_LEASE" || err.code === "LEASE_EXPIRED");
        if (isStale) throw err;

        const failed = revision.markFailed(message);
        if (failed.hasRetriesRemaining()) {
          const retry = failed.scheduleRetry(5_000 * Math.pow(2, Math.max(0, failed.attempts - 1)));
          await this.previews.saveRevisionWithLease(retry, workerId, leaseGeneration);
        } else {
          await this.previews.saveRevisionWithLease(failed, workerId, leaseGeneration);
        }

        // Keep the last healthy revision routable if one exists.
        const latestPreview = await this.previews.findById(preview.id);
        if (latestPreview && latestPreview.cleanupStatus === "NONE") {
          await this.previews.save(
            latestPreview.withStatus(latestPreview.deploymentId ? "READY" : "FAILED")
          );
        }
      }
      throw err;
    }
  }

  private async stopSupersededContainers(previewId: string, keepRevisionId: string): Promise<void> {
    const revisions = await this.previews.listRevisions(previewId);
    for (const revision of revisions) {
      if (revision.id === keepRevisionId) continue;
      if (revision.status !== "READY" || !revision.containerId) continue;
      try {
        await this.containerService.stopContainer(revision.containerId);
      } catch {
        // Reconciliation removes orphans by label; routing already moved on.
      }
    }
  }
}

/** Backwards-compatible alias for the previous placeholder name. */
export { ExecutePreviewRevisionUseCase as BuildPreviewRevisionUseCase };
