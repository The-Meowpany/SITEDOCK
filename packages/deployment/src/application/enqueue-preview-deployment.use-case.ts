import { randomBytes, randomUUID, createHash } from "node:crypto";
import { ApplicationError, WebsiteId } from "@sitedock/shared";
import { PreviewRepository } from "../domain/ports";

/** Preview hostnames are DNS labels: lowercase, alnum/dash, max 63 chars. */
export function previewHostnameFor(websiteId: string, branch: string, suffix?: string): string {
  // No `replace(/^-+|-+$/g, "")`: trimming dashes with an unanchored `-+$` is
  // quadratic on a dash-heavy branch name (CWE-1333). Split/join is linear.
  const branchSlug =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .split("-")
      .filter(Boolean)
      .join("-")
      .slice(0, 28) || "branch";
  const hash = createHash("sha256")
    .update(`${websiteId}:${branch}`)
    .digest("hex")
    .slice(0, 8);
  const extra = suffix ? `-${suffix}` : "";
  return `preview-${branchSlug}-${hash}${extra}`;
}

/**
 * Enqueue a preview revision for a branch + exact commit SHA.
 *
 * The preview (routing identity) is created/reused atomically with its next
 * revision, so concurrent webhooks for the same branch converge on one preview
 * and the same commit is only built once while an attempt is still in flight.
 */
export class EnqueuePreviewDeploymentUseCase {
  constructor(private readonly previews: PreviewRepository) {}

  async execute(input: {
    websiteId: string;
    branch: string;
    commitSha: string;
  }): Promise<{ previewId: string; revisionId: string; hostname: string; status: string }> {
    const branch = input.branch.trim();
    if (!branch) throw new ApplicationError("Branch is required", "INVALID_BRANCH");
    if (!/^[0-9a-f]{7,64}$/i.test(input.commitSha)) {
      throw new ApplicationError("commitSha must be a hexadecimal Git SHA", "INVALID_COMMIT_SHA");
    }
    const websiteId = WebsiteId(input.websiteId);

    const existing = await this.previews.findByWebsiteAndBranch(websiteId, branch);
    const hostname = existing?.hostname ?? previewHostnameFor(input.websiteId, branch);

    try {
      const revision = await this.previews.enqueueRevision({
        previewId: existing?.id ?? randomUUID(),
        websiteId,
        branch,
        commitSha: input.commitSha.toLowerCase(),
        hostname,
      });
      const preview = await this.previews.findById(revision.previewId);
      return {
        previewId: revision.previewId,
        revisionId: revision.id,
        hostname: preview?.hostname ?? hostname,
        status: revision.status,
      };
    } catch (err) {
      // Hostname/index collision: retry once with a random, still DNS-safe suffix.
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        const retryHostname = previewHostnameFor(
          input.websiteId,
          branch,
          randomBytes(3).toString("hex")
        );
        const revision = await this.previews.enqueueRevision({
          previewId: existing?.id ?? randomUUID(),
          websiteId,
          branch,
          commitSha: input.commitSha.toLowerCase(),
          hostname: retryHostname,
        });
        return {
          previewId: revision.previewId,
          revisionId: revision.id,
          hostname: retryHostname,
          status: revision.status,
        };
      }
      throw err;
    }
  }
}
