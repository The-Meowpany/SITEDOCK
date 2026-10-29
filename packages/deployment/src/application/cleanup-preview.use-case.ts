import { ContainerService } from "../infrastructure/container-service";
import { PreviewRepository } from "../domain/ports";

/**
 * Execute durable preview cleanup. Only preview-owned containers are stopped
 * (identified from preview revisions, never from production tables), then the
 * revision rows are removed and the preview tombstone reports the outcome.
 * Re-running after a crash is safe: stopped/missing containers are tolerated.
 */
export class CleanupPreviewUseCase {
  constructor(
    private readonly previews: PreviewRepository,
    private readonly containerService: ContainerService
  ) {}

  async execute(previewId: string): Promise<{ stopped: number; error: string | null }> {
    const claimed = await this.previews.claimCleanup(previewId);
    if (!claimed) {
      const preview = await this.previews.findById(previewId);
      if (!preview) return { stopped: 0, error: null };
      if (preview.cleanupStatus === "COMPLETED") return { stopped: 0, error: null };
      // Another worker owns the cleanup or it must be retried later.
      return { stopped: 0, error: preview.cleanupError };
    }

    let stopped = 0;
    try {
      const revisions = await this.previews.listRevisions(previewId);
      for (const revision of revisions) {
        if (!revision.containerId) continue;
        try {
          await this.containerService.stopContainer(revision.containerId);
          stopped += 1;
        } catch (err) {
          throw new Error(
            `Failed to stop preview container ${revision.containerId}: ${(err as Error).message}`
          );
        }
      }
      await this.previews.deleteRevisions(previewId);
      await this.previews.completeCleanup(previewId, null);
      return { stopped, error: null };
    } catch (err) {
      await this.previews.completeCleanup(previewId, (err as Error).message.slice(0, 1000));
      return { stopped, error: (err as Error).message };
    }
  }
}
