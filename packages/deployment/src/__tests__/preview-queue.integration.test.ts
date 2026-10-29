import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, assertDedicatedTestDatabase } from "@sitedock/database";
import { WebsiteId } from "@sitedock/shared";
import {
  CleanupPreviewUseCase,
  DeletePreviewUseCase,
  EnqueuePreviewDeploymentUseCase,
  PrismaPreviewRepository,
  RetryPreviewUseCase,
} from "../index";
import type { ContainerService } from "../infrastructure/container-service";

const previews = new PrismaPreviewRepository();

describe("Preview queue, lease fencing and cleanup (integration)", () => {
  let workspaceId: string;
  let organizationId: string;
  let projectId: string;
  let websiteId: string;

  beforeAll(async () => {
    await assertDedicatedTestDatabase(prisma, "preview-queue");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    organizationId = randomUUID();
    await prisma.organization.create({
      data: { id: organizationId, name: `Preview Org ${suffix}`, slug: `preview-org-${suffix}` },
    });

    workspaceId = randomUUID();
    await prisma.workspace.create({
      data: { id: workspaceId, name: `Preview WS ${suffix}`, slug: `preview-ws-${suffix}` },
    });

    projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: "Preview Project",
        organizationId,
      },
    });

    websiteId = randomUUID();
    await prisma.website.create({
      data: {
        id: websiteId,
        workspaceId,
        projectId,
        organizationId,
        name: "Preview Website",
        subdomain: `preview-site-${suffix}`,
        status: "DRAFT",
      },
    });
  });

  afterAll(async () => {
    // Scoped cleanup only; previews/revisions cascade from the website.
    try {
      await prisma.website.delete({ where: { id: websiteId } });
    } catch {}
    try {
      await prisma.project.delete({ where: { id: projectId } });
    } catch {}
    try {
      await prisma.workspace.delete({ where: { id: workspaceId } });
    } catch {}
    try {
      await prisma.organization.delete({ where: { id: organizationId } });
    } catch {}
  });

  it("allocates one collision-safe preview per branch and reuses it across commits", async () => {
    const enqueue = new EnqueuePreviewDeploymentUseCase(previews);
    const a1 = await enqueue.execute({ websiteId, branch: "feature/a", commitSha: "a".repeat(40) });
    const b1 = await enqueue.execute({ websiteId, branch: "feature/b", commitSha: "b".repeat(40) });

    expect(a1.hostname).not.toBe(b1.hostname);
    expect(a1.hostname).toMatch(/^preview-feature-a-[0-9a-f]{8}$/);

    // Same commit while the first attempt is pending is idempotent.
    const a1again = await enqueue.execute({ websiteId, branch: "feature/a", commitSha: "a".repeat(40) });
    expect(a1again.revisionId).toBe(a1.revisionId);

    // New commit on the same branch appends a revision on the same preview.
    const a2 = await enqueue.execute({ websiteId, branch: "feature/a", commitSha: "c".repeat(40) });
    expect(a2.previewId).toBe(a1.previewId);
    expect(a2.hostname).toBe(a1.hostname);
    expect(a2.revisionId).not.toBe(a1.revisionId);
  });

  it("claims with generation fencing, publishes atomically and preserves the healthy revision on failure", async () => {
    // Older pending revisions belong to other branches; cancel them so this
    // test's assertions are about its own job (claimNext is intentionally global).
    await prisma.previewRevision.updateMany({
      where: { preview: { websiteId }, status: "PENDING" },
      data: { status: "CANCELED" },
    });

    const enqueue = new EnqueuePreviewDeploymentUseCase(previews);
    const first = await enqueue.execute({ websiteId, branch: "feature/fenced", commitSha: "d".repeat(40) });

    const claimed = await previews.claimNextRevision("preview-worker-A", new Date(), 60_000);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(first.revisionId);
    expect(claimed!.claimedBy).toBe("preview-worker-A");
    expect(claimed!.leaseGeneration).toBe(1);

    // A stale generation cannot mutate the claimed revision.
    await expect(
      previews.saveRevisionWithLease(claimed!.markFailed("stale write"), "preview-worker-A", 0)
    ).rejects.toThrow(/Stale lease/);

    const ready = claimed!.markReady({
      imageId: "sha256:preview-image",
      imageDigest: "sha256:preview-digest",
      containerId: "container-first",
      hostPort: 41001,
      containerPort: 8080,
    });
    await previews.activateRevisionWithLease(ready, first.previewId, "preview-worker-A", 1);

    const published = await previews.findById(first.previewId);
    expect(published?.deploymentId).toBe(first.revisionId);
    expect(published?.status).toBe("READY");
    expect(published?.hostname).toBe(first.hostname);

    // A newer revision that fails must not disturb the healthy pointer.
    const second = await enqueue.execute({ websiteId, branch: "feature/fenced", commitSha: "e".repeat(40) });
    const claimedSecond = await previews.claimNextRevision("preview-worker-B", new Date(), 60_000);
    expect(claimedSecond!.id).toBe(second.revisionId);
    const failed = claimedSecond!.markFailed("build failed");
    await previews.saveRevisionWithLease(failed, "preview-worker-B", claimedSecond!.leaseGeneration);

    const afterFailure = await previews.findById(first.previewId);
    expect(afterFailure?.deploymentId).toBe(first.revisionId);
    expect((await previews.findRevisionById(second.revisionId))?.status).toBe("FAILED");
    expect((await previews.findRevisionById(second.revisionId))?.commitSha).toBe("e".repeat(40));
  });

  it("retries a failed revision with its original commit SHA", async () => {
    const preview = await previews.findByWebsiteAndBranch(WebsiteId(websiteId), "feature/fenced");
    expect(preview).not.toBeNull();
    const failed = (await previews.listRevisions(preview!.id)).find((r) => r.status === "FAILED");
    expect(failed).toBeDefined();

    const retry = new RetryPreviewUseCase(previews);
    const requeued = await retry.execute({ previewId: preview!.id, websiteId });

    expect(requeued.id).toBe(failed!.id);
    expect(requeued.status).toBe("PENDING");
    expect(requeued.commitSha).toBe(failed!.commitSha);
    expect(requeued.attempts).toBe(0);
  });

  it("requests and completes retryable cleanup without touching production routing", async () => {
    const preview = await previews.findByWebsiteAndBranch(WebsiteId(websiteId), "feature/fenced");
    expect(preview).not.toBeNull();

    const productionBefore = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { productionDeploymentId: true },
    });

    const deletePreview = new DeletePreviewUseCase(previews);
    const requested = await deletePreview.execute({ previewId: preview!.id, websiteId });
    expect(requested.cleanupStatus).toBe("REQUESTED");

    // Idempotent request.
    const again = await deletePreview.execute({ previewId: preview!.id, websiteId });
    expect(again.cleanupStatus).toBe("REQUESTED");

    const stopped: string[] = [];
    const fakeContainerService = {
      stopContainer: async (id: string) => {
        stopped.push(id);
      },
    } as unknown as ContainerService;

    const cleanup = new CleanupPreviewUseCase(previews, fakeContainerService);
    const result = await cleanup.execute(preview!.id);
    expect(result.error).toBeNull();
    expect(stopped).toContain("container-first");

    const tombstone = await previews.findById(preview!.id);
    expect(tombstone?.cleanupStatus).toBe("COMPLETED");
    expect(tombstone?.status).toBe("CANCELED");
    expect(tombstone?.hostname).toBeNull();
    expect(tombstone?.deploymentId).toBeNull();
    expect(await previews.listRevisions(preview!.id)).toHaveLength(0);

    const productionAfter = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { productionDeploymentId: true },
    });
    expect(productionAfter?.productionDeploymentId).toBe(productionBefore?.productionDeploymentId ?? null);
  });
});
