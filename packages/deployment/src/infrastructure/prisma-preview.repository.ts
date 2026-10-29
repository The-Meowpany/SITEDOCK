import { randomUUID } from "node:crypto";
import { prisma } from "@sitedock/database";
import { WebsiteId } from "@sitedock/shared";
import { Preview } from "../domain/preview.entity";
import { PreviewRevision } from "../domain/preview.entity";
import { PreviewRepository } from "../domain/ports";

type PreviewRow = {
  id: string;
  websiteId: string;
  branch: string;
  commitSha: string;
  status: string;
  hostname: string | null;
  deploymentId: string | null;
  cleanupStatus: string;
  cleanupError: string | null;
  cleanupRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RevisionRow = {
  id: string;
  previewId: string;
  commitSha: string;
  sequence: number;
  status: string;
  imageId: string | null;
  imageDigest: string | null;
  containerId: string | null;
  hostPort: number | null;
  containerPort: number;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

function toPreview(row: PreviewRow): Preview {
  return Preview.hydrate({
    id: row.id,
    websiteId: WebsiteId(row.websiteId),
    branch: row.branch,
    commitSha: row.commitSha,
    status: row.status as Preview["status"],
    hostname: row.hostname,
    deploymentId: row.deploymentId,
    cleanupStatus: row.cleanupStatus as Preview["cleanupStatus"],
    cleanupError: row.cleanupError,
    cleanupRequestedAt: row.cleanupRequestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRevision(row: RevisionRow): PreviewRevision {
  return PreviewRevision.hydrate({
    id: row.id,
    previewId: row.previewId,
    commitSha: row.commitSha,
    sequence: row.sequence,
    status: row.status as PreviewRevision["status"],
    imageId: row.imageId,
    imageDigest: row.imageDigest,
    containerId: row.containerId,
    hostPort: row.hostPort,
    containerPort: row.containerPort,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    claimedBy: row.claimedBy,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt,
    nextRetryAt: row.nextRetryAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
}

/** Raw SQL date bindings must be UTC ISO strings (schema columns are UTC). */
function utcParam(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class PrismaPreviewRepository implements PreviewRepository {
  async findById(id: string): Promise<Preview | null> {
    const row = await prisma.preview.findUnique({ where: { id } });
    return row ? toPreview(row as PreviewRow) : null;
  }

  async findByWebsiteAndBranch(websiteId: WebsiteId, branch: string): Promise<Preview | null> {
    const row = await prisma.preview.findUnique({
      where: { websiteId_branch: { websiteId: String(websiteId), branch } },
    });
    return row ? toPreview(row as PreviewRow) : null;
  }

  async findByWebsite(websiteId: WebsiteId): Promise<Preview[]> {
    const rows = await prisma.preview.findMany({
      where: { websiteId: String(websiteId) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => toPreview(row as PreviewRow));
  }

  async findByCommitSha(commitSha: string): Promise<Preview | null> {
    const row = await prisma.preview.findFirst({ where: { commitSha } });
    return row ? toPreview(row as PreviewRow) : null;
  }

  async findByHostname(hostname: string): Promise<Preview | null> {
    const row = await prisma.preview.findUnique({ where: { hostname } });
    return row ? toPreview(row as PreviewRow) : null;
  }

  async save(preview: Preview): Promise<void> {
    await prisma.preview.upsert({
      where: { id: preview.id },
      create: {
        id: preview.id,
        websiteId: String(preview.websiteId),
        branch: preview.branch,
        commitSha: preview.commitSha,
        status: preview.status,
        hostname: preview.hostname,
        deploymentId: preview.deploymentId,
        cleanupStatus: preview.cleanupStatus,
        cleanupError: preview.cleanupError,
        cleanupRequestedAt: preview.cleanupRequestedAt,
        createdAt: preview.createdAt,
        updatedAt: preview.updatedAt,
      },
      update: {
        commitSha: preview.commitSha,
        status: preview.status,
        hostname: preview.hostname,
        deploymentId: preview.deploymentId,
        cleanupStatus: preview.cleanupStatus,
        cleanupError: preview.cleanupError,
        cleanupRequestedAt: preview.cleanupRequestedAt,
        updatedAt: preview.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.preview.delete({ where: { id } });
  }

  // ── Durable queue ────────────────────────────────────────────────────────

  async enqueueRevision(input: {
    previewId: string;
    websiteId: WebsiteId;
    branch: string;
    commitSha: string;
    hostname: string;
  }): Promise<PreviewRevision> {
    return prisma.$transaction(async (tx) => {
      const preview = await tx.preview.upsert({
        where: {
          websiteId_branch: { websiteId: String(input.websiteId), branch: input.branch },
        },
        create: {
          id: input.previewId,
          websiteId: String(input.websiteId),
          branch: input.branch,
          commitSha: input.commitSha,
          status: "PENDING",
          hostname: input.hostname,
        },
        update: {
          commitSha: input.commitSha,
          status: "PENDING",
          cleanupStatus: "NONE",
          cleanupError: null,
          cleanupRequestedAt: null,
          // Keep an existing (collision-checked) hostname stable across revisions.
          ...(input.hostname ? { hostname: input.hostname } : {}),
        },
      });

      // Idempotent enqueue: an unfinished attempt for the same commit is reused.
      const existing = await tx.previewRevision.findFirst({
        where: {
          previewId: preview.id,
          commitSha: input.commitSha,
          status: { in: ["PENDING", "BUILDING", "READY"] },
        },
        orderBy: { sequence: "desc" },
      });
      if (existing) return toRevision(existing as RevisionRow);

      const latest = await tx.previewRevision.findFirst({
        where: { previewId: preview.id },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });

      const created = await tx.previewRevision.create({
        data: {
          id: randomUUID(),
          previewId: preview.id,
          commitSha: input.commitSha,
          sequence: (latest?.sequence ?? 0) + 1,
          status: "PENDING",
        },
      });
      return toRevision(created as RevisionRow);
    });
  }

  async findRevisionById(id: string): Promise<PreviewRevision | null> {
    const row = await prisma.previewRevision.findUnique({ where: { id } });
    return row ? toRevision(row as RevisionRow) : null;
  }

  async listRevisions(previewId: string): Promise<PreviewRevision[]> {
    const rows = await prisma.previewRevision.findMany({
      where: { previewId },
      orderBy: { sequence: "desc" },
    });
    return rows.map((row) => toRevision(row as RevisionRow));
  }

  async findLatestRevision(previewId: string): Promise<PreviewRevision | null> {
    const row = await prisma.previewRevision.findFirst({
      where: { previewId },
      orderBy: { sequence: "desc" },
    });
    return row ? toRevision(row as RevisionRow) : null;
  }

  async claimNextRevision(workerId: string, now: Date, leaseMs: number): Promise<PreviewRevision | null> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT r.id
        FROM preview_revisions r
        JOIN previews p ON p.id = r.preview_id
        WHERE p.cleanup_status IN ('NONE', 'FAILED')
          AND r.status <> 'CANCELED'
          AND r.attempts < r.max_attempts
          AND (r.next_retry_at IS NULL OR r.next_retry_at <= ${utcParam(now)}::timestamp)
          AND (
            r.status = 'PENDING'
            OR (r.status = 'BUILDING' AND r.lease_expires_at IS NOT NULL AND r.lease_expires_at < ${utcParam(now)}::timestamp)
          )
        ORDER BY r.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;

      const updated = await tx.previewRevision.update({
        where: { id: rows[0]!.id },
        data: {
          status: "BUILDING",
          claimedBy: workerId,
          leaseGeneration: { increment: 1 },
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          startedAt: now,
          attempts: { increment: 1 },
        },
      });
      return toRevision(updated as RevisionRow);
    });
  }

  async saveRevisionWithLease(
    revision: PreviewRevision,
    workerId: string,
    leaseGeneration: number
  ): Promise<void> {
    const count = await prisma.$executeRaw`
      UPDATE preview_revisions
      SET
        status = ${revision.status}::"PreviewStatus",
        image_id = ${revision.imageId},
        image_digest = ${revision.imageDigest},
        container_id = ${revision.containerId},
        host_port = ${revision.hostPort},
        container_port = ${revision.containerPort},
        error_message = ${revision.errorMessage},
        attempts = ${revision.attempts},
        max_attempts = ${revision.maxAttempts},
        claimed_by = ${revision.claimedBy},
        lease_generation = ${revision.leaseGeneration},
        lease_expires_at = ${utcParam(revision.leaseExpiresAt)}::timestamp,
        next_retry_at = ${utcParam(revision.nextRetryAt)}::timestamp,
        started_at = ${utcParam(revision.startedAt)}::timestamp,
        completed_at = ${utcParam(revision.completedAt)}::timestamp
      WHERE id = ${revision.id}
        AND claimed_by = ${workerId}
        AND lease_generation = ${leaseGeneration}
    `;
    if (count === 0) {
      throw new Error(`Stale lease mutation rejected for preview revision ${revision.id}`);
    }
  }

  async renewRevisionLease(
    revisionId: string,
    workerId: string,
    leaseGeneration: number,
    leaseMs: number,
    now: Date = new Date()
  ): Promise<boolean> {
    const count = await prisma.$executeRaw`
      UPDATE preview_revisions
      SET lease_expires_at = ${utcParam(new Date(now.getTime() + leaseMs))}::timestamp
      WHERE id = ${revisionId}
        AND claimed_by = ${workerId}
        AND lease_generation = ${leaseGeneration}
    `;
    return count > 0;
  }

  async activateRevisionWithLease(
    revision: PreviewRevision,
    previewId: string,
    workerId: string,
    leaseGeneration: number
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE preview_revisions
        SET
          status = 'READY'::"PreviewStatus",
          image_id = ${revision.imageId},
          image_digest = ${revision.imageDigest},
          container_id = ${revision.containerId},
          host_port = ${revision.hostPort},
          container_port = ${revision.containerPort},
          error_message = NULL,
          claimed_by = ${revision.claimedBy},
          lease_generation = ${revision.leaseGeneration},
          lease_expires_at = ${utcParam(revision.leaseExpiresAt)}::timestamp,
          completed_at = ${utcParam(revision.completedAt ?? new Date())}::timestamp
        WHERE id = ${revision.id}
          AND preview_id = ${previewId}
          AND claimed_by = ${workerId}
          AND lease_generation = ${leaseGeneration}
      `;
      if (updated === 0) {
        throw new Error(`Stale lease activation rejected for preview revision ${revision.id}`);
      }

      // Atomic routing switchover: production tables are never touched.
      const switched = await tx.$executeRaw`
        UPDATE previews
        SET
          deployment_id = ${revision.id},
          commit_sha = ${revision.commitSha},
          status = 'READY'::"PreviewStatus",
          updated_at = ${utcParam(new Date())}::timestamp
        WHERE id = ${previewId}
          AND cleanup_status IN ('NONE', 'FAILED')
      `;
      if (switched === 0) {
        throw new Error(`Preview ${previewId} disappeared or entered cleanup during activation`);
      }
    });
  }

  async retryRevision(previewId: string, revisionId: string): Promise<PreviewRevision> {
    return prisma.$transaction(async (tx) => {
      const revision = await tx.previewRevision.findFirst({
        where: { id: revisionId, previewId },
      });
      if (!revision) throw new Error(`Preview revision ${revisionId} not found`);
      if (revision.status !== "FAILED" && revision.status !== "CANCELED") {
        throw new Error(
          `Only FAILED or CANCELED revisions can be retried (current: ${revision.status})`
        );
      }

      const updated = await tx.previewRevision.update({
        where: { id: revisionId },
        data: {
          status: "PENDING",
          attempts: 0,
          claimedBy: null,
          leaseExpiresAt: null,
          nextRetryAt: null,
          errorMessage: null,
          completedAt: null,
          // A failed attempt never replaced the healthy container; if the retry
          // was canceled during cleanup there is nothing to reuse.
          containerId: null,
          hostPort: null,
        },
      });

      const preview = await tx.preview.findUnique({ where: { id: previewId } });
      await tx.preview.update({
        where: { id: previewId },
        data: {
          commitSha: revision.commitSha,
          // Keep READY when an older healthy revision is still serving.
          status: preview?.deploymentId ? "READY" : "PENDING",
          updatedAt: new Date(),
        },
      });

      return toRevision(updated as RevisionRow);
    });
  }

  async listCleanupRequests(limit: number = 20): Promise<Preview[]> {
    const rows = await prisma.preview.findMany({
      where: { cleanupStatus: "REQUESTED" },
      orderBy: { cleanupRequestedAt: "asc" },
      take: limit,
    });
    return rows.map((row) => toPreview(row as PreviewRow));
  }

  async claimCleanup(previewId: string): Promise<boolean> {
    const count = await prisma.$executeRaw`
      UPDATE previews
      SET cleanup_status = 'RUNNING'::"PreviewCleanupStatus", updated_at = ${utcParam(new Date())}::timestamp
      WHERE id = ${previewId}
        AND cleanup_status = 'REQUESTED'
    `;
    return count > 0;
  }

  async completeCleanup(previewId: string, error: string | null = null): Promise<void> {
    if (error === null) {
      // Successful cleanup removes routing and the active revision pointer, but
      // keeps the tombstone so cleanup status stays observable/retryable.
      await prisma.$executeRaw`
        UPDATE previews
        SET
          cleanup_status = 'COMPLETED'::"PreviewCleanupStatus",
          cleanup_error = NULL,
          hostname = NULL,
          deployment_id = NULL,
          status = 'CANCELED'::"PreviewStatus",
          updated_at = ${utcParam(new Date())}::timestamp
        WHERE id = ${previewId}
      `;
      return;
    }

    await prisma.$executeRaw`
      UPDATE previews
      SET
        cleanup_status = 'FAILED'::"PreviewCleanupStatus",
        cleanup_error = ${error},
        updated_at = ${utcParam(new Date())}::timestamp
      WHERE id = ${previewId}
    `;
  }

  async stopPreviewContainer(previewId: string): Promise<string | null> {
    const preview = await prisma.preview.findUnique({
      where: { id: previewId },
      select: { deploymentId: true },
    });
    if (!preview?.deploymentId) return null;
    const revision = await prisma.previewRevision.findUnique({
      where: { id: preview.deploymentId },
      select: { containerId: true },
    });
    return revision?.containerId ?? null;
  }

  async deleteRevisions(previewId: string): Promise<void> {
    await prisma.previewRevision.deleteMany({ where: { previewId } });
  }
}
