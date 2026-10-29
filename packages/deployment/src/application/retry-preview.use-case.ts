import { ApplicationError } from "@sitedock/shared";
import { PreviewRepository } from "../domain/ports";
import { PreviewRevision } from "../domain/preview.entity";

/**
 * Retry the latest failed/canceled revision with its original commit SHA.
 * A manual retry resets the attempt budget but keeps the same immutable commit,
 * so retrying can never silently deploy a different revision.
 */
export class RetryPreviewUseCase {
  constructor(private readonly previews: PreviewRepository) {}

  async execute(input: { previewId: string; websiteId: string }): Promise<PreviewRevision> {
    const preview = await this.previews.findById(input.previewId);
    if (!preview || String(preview.websiteId) !== input.websiteId) {
      throw new ApplicationError("Preview not found", "PREVIEW_NOT_FOUND");
    }
    if (preview.cleanupStatus !== "NONE" && preview.cleanupStatus !== "FAILED") {
      throw new ApplicationError(
        `Preview ${preview.id} is being cleaned up (${preview.cleanupStatus})`,
        "PREVIEW_CLEANUP_IN_PROGRESS"
      );
    }

    const latest = await this.previews.findLatestRevision(preview.id);
    if (!latest) {
      throw new ApplicationError("Preview has no revision to retry", "PREVIEW_NO_REVISION");
    }
    if (latest.status !== "FAILED" && latest.status !== "CANCELED") {
      throw new ApplicationError(
        `Only FAILED or CANCELED revisions can be retried (current: ${latest.status})`,
        "PREVIEW_NOT_RETRYABLE"
      );
    }

    return this.previews.retryRevision(preview.id, latest.id);
  }
}
