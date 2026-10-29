import { ApplicationError } from "@sitedock/shared";
import { PreviewRepository } from "../domain/ports";
import { Preview } from "../domain/preview.entity";

/**
 * Request cleanup of a preview.
 *
 * Cleanup is a durable, retryable workflow handled by the worker: the request
 * immediately disables preview routing (the hostname middleware refuses a
 * preview whose cleanup is REQUESTED/RUNNING/COMPLETED), then the worker stops
 * only preview-owned containers and removes the revision records. Production
 * deployment/routing tables are never referenced. READY previews are deletable.
 */
export class DeletePreviewUseCase {
  constructor(private readonly previews: PreviewRepository) {}

  async execute(input: { previewId: string; websiteId: string }): Promise<Preview> {
    const preview = await this.previews.findById(input.previewId);
    if (!preview || String(preview.websiteId) !== input.websiteId) {
      throw new ApplicationError("Preview not found", "PREVIEW_NOT_FOUND");
    }

    if (preview.cleanupStatus === "COMPLETED") {
      return preview;
    }
    if (preview.cleanupStatus === "REQUESTED" || preview.cleanupStatus === "RUNNING") {
      return preview;
    }

    const requested = preview.requestCleanup();
    await this.previews.save(requested);
    return requested;
  }
}
