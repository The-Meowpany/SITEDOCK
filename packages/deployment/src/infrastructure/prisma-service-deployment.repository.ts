import { prisma } from "@sitedock/database";
import { Prisma } from "@prisma/client";
import { DomainError } from "@sitedock/shared";
import { ServiceDeployment } from "../domain/service-deployment.entity";
import { Service } from "../domain/service.entity";
import { ServiceDeploymentRepository } from "../domain/ports";

/**
 * Prisma serializes JavaScript Date values bound to raw SQL parameters using
 * the process LOCAL timezone, but the schema columns are `timestamp(3)
 * without time zone` written in UTC by the typed client. Passing raw Date
 * objects therefore shifts every lease/completion timestamp by the local UTC
 * offset (e.g. leases stored 3h in the past on UTC-3 hosts, breaking
 * stale-lease fencing). All raw SQL date bindings MUST go through this helper.
 */
function utcParam(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

type ServiceDeploymentRow = {
  id: string;
  serviceId: string;
  version: number;
  status: string;
  imageId: string | null;
  imageDigest: string | null;
  buildLog: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  idempotencyKey: string | null;
  canceledAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

function toDomain(row: ServiceDeploymentRow): ServiceDeployment {
  return ServiceDeployment.hydrate({
    id: row.id,
    serviceId: row.serviceId,
    version: row.version,
    status: row.status as ServiceDeployment["status"],
    imageId: row.imageId,
    imageDigest: row.imageDigest,
    buildLog: row.buildLog,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    claimedBy: row.claimedBy,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt,
    nextRetryAt: row.nextRetryAt,
    idempotencyKey: row.idempotencyKey,
    canceledAt: row.canceledAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
}

export class PrismaServiceDeploymentRepository implements ServiceDeploymentRepository {
  async findById(id: string): Promise<ServiceDeployment | null> {
    const row = await prisma.serviceDeployment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForService(id: string, serviceId: string): Promise<ServiceDeployment | null> {
    const row = await prisma.serviceDeployment.findFirst({ where: { id, serviceId } });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(key: string, serviceId: string): Promise<ServiceDeployment | null> {
    const row = await prisma.serviceDeployment.findFirst({ where: { idempotencyKey: key, serviceId } });
    return row ? toDomain(row) : null;
  }

  async listClaimable(now: Date): Promise<ServiceDeployment[]> {
    const rows = await prisma.serviceDeployment.findMany({
      where: {
        OR: [
          { status: "QUEUED", nextRetryAt: null },
          { status: "QUEUED", nextRetryAt: { lte: now } },
        ],
        canceledAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async claimNext(workerId: string, now: Date, leaseMs: number): Promise<ServiceDeployment | null> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM service_deployments
        WHERE canceled_at IS NULL
          AND attempts < max_attempts
          AND (next_retry_at IS NULL OR next_retry_at <= ${utcParam(now)}::timestamp)
          AND (
            status = 'QUEUED'
            OR (status = 'BUILDING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${utcParam(now)}::timestamp)
          )
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      const id = rows[0]!.id;
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const updated = await tx.serviceDeployment.update({
        where: { id },
        data: {
          status: "BUILDING",
          claimedBy: workerId,
          leaseGeneration: { increment: 1 },
          leaseExpiresAt,
          startedAt: new Date(now.getTime()),
          attempts: { increment: 1 },
        },
      });
      return toDomain(updated as unknown as ServiceDeploymentRow);
    });
  }

  async listByService(serviceId: string): Promise<ServiceDeployment[]> {
    const rows = await prisma.serviceDeployment.findMany({
      where: { serviceId },
      orderBy: { version: "desc" },
    });
    return rows.map(toDomain);
  }

  async listByStatus(status: string): Promise<ServiceDeployment[]> {
    const rows = await prisma.serviceDeployment.findMany({
      where: { status: status as never },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async listLiveByService(serviceId: string): Promise<ServiceDeployment | null> {
    const row = await prisma.serviceDeployment.findFirst({
      where: { serviceId, status: "READY" },
      orderBy: { version: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async getNextVersion(serviceId: string): Promise<number> {
    const latest = await prisma.serviceDeployment.findFirst({
      where: { serviceId },
      orderBy: { version: "desc" },
    });
    return (latest?.version ?? 0) + 1;
  }

  async save(deployment: ServiceDeployment): Promise<void> {
    try {
      await prisma.serviceDeployment.upsert({
        where: { id: deployment.id },
      create: {
        id: deployment.id,
        serviceId: deployment.serviceId,
        version: deployment.version,
        status: deployment.status,
        imageId: deployment.imageId,
        imageDigest: deployment.imageDigest,
        buildLog: deployment.buildLog,
        errorMessage: deployment.errorMessage,
        attempts: deployment.attempts,
        maxAttempts: deployment.maxAttempts,
        claimedBy: deployment.claimedBy,
        leaseGeneration: deployment.leaseGeneration,
        leaseExpiresAt: deployment.leaseExpiresAt,
        nextRetryAt: deployment.nextRetryAt,
        idempotencyKey: deployment.idempotencyKey,
        canceledAt: deployment.canceledAt,
      },
      update: {
        status: deployment.status,
        imageId: deployment.imageId,
        imageDigest: deployment.imageDigest,
        buildLog: deployment.buildLog,
        errorMessage: deployment.errorMessage,
        attempts: deployment.attempts,
        maxAttempts: deployment.maxAttempts,
        claimedBy: deployment.claimedBy,
        leaseGeneration: deployment.leaseGeneration,
        leaseExpiresAt: deployment.leaseExpiresAt,
        nextRetryAt: deployment.nextRetryAt,
        idempotencyKey: deployment.idempotencyKey,
        canceledAt: deployment.canceledAt,
      },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new DomainError(
          `Deployment version or idempotency key conflict for service ${deployment.serviceId}`,
          "VERSION_CONFLICT"
        );
      }
      throw err;
    }
  }

  async saveWithLease(deployment: ServiceDeployment, workerId: string, leaseGeneration: number): Promise<void> {
    const count = await prisma.$executeRaw`
      UPDATE service_deployments
      SET
        status = ${deployment.status}::"ServiceDeploymentStatus",
        image_id = ${deployment.imageId},
        image_digest = ${deployment.imageDigest},
        build_log = ${deployment.buildLog},
        error_message = ${deployment.errorMessage},
        attempts = ${deployment.attempts},
        max_attempts = ${deployment.maxAttempts},
        claimed_by = ${deployment.claimedBy},
        lease_generation = ${deployment.leaseGeneration},
        lease_expires_at = ${utcParam(deployment.leaseExpiresAt)}::timestamp,
        next_retry_at = ${utcParam(deployment.nextRetryAt)}::timestamp,
        completed_at = ${utcParam(deployment.completedAt)}::timestamp
      WHERE id = ${deployment.id}
        AND claimed_by = ${workerId}
        AND lease_generation = ${leaseGeneration}
    `;
    if (count === 0) {
      throw new DomainError(
        `Stale lease mutation rejected: deployment ${deployment.id} is no longer owned by ${workerId}/${leaseGeneration}`,
        "STALE_LEASE"
      );
    }
  }

  async renewLease(
    deploymentId: string,
    workerId: string,
    leaseGeneration: number,
    leaseMs: number,
    now: Date = new Date()
  ): Promise<boolean> {
    // Fencing relies solely on (claimed_by, lease_generation): reclaiming a
    // stale deployment increments leaseGeneration, so a previous holder can
    // never extend a lease it no longer owns. The `completed_at IS NULL`
    // guard previously here was actively harmful: `markBuilt` legitimately
    // persists completed_at (build finished) while the same worker still owns
    // the claim for the runtime/activation stages, so every renewal between
    // build and activation failed with STALE_LEASE and stalled deployments.
    const count = await prisma.$executeRaw`
      UPDATE service_deployments
      SET lease_expires_at = ${utcParam(new Date(now.getTime() + leaseMs))}::timestamp
      WHERE id = ${deploymentId}
        AND claimed_by = ${workerId}
        AND lease_generation = ${leaseGeneration}
        AND canceled_at IS NULL
    `;
    return count > 0;
  }

  /**
   * Atomically marks the deployment READY and switches the service's
   * authoritative active_deployment_id, but only while the caller still owns
   * the claim. A stale worker can never activate routing after another worker
   * reclaimed the deployment.
   */
  async activateWithLease(
    deployment: ServiceDeployment,
    service: Service,
    workerId: string,
    leaseGeneration: number
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE service_deployments
        SET
          status = ${deployment.status}::"ServiceDeploymentStatus",
          image_id = ${deployment.imageId},
          image_digest = ${deployment.imageDigest},
          build_log = ${deployment.buildLog},
          error_message = ${deployment.errorMessage},
          attempts = ${deployment.attempts},
          max_attempts = ${deployment.maxAttempts},
          claimed_by = ${deployment.claimedBy},
          lease_generation = ${deployment.leaseGeneration},
          lease_expires_at = ${utcParam(deployment.leaseExpiresAt)}::timestamp,
          next_retry_at = ${utcParam(deployment.nextRetryAt)}::timestamp,
          completed_at = ${utcParam(deployment.completedAt)}::timestamp
        WHERE id = ${deployment.id}
          AND claimed_by = ${workerId}
          AND lease_generation = ${leaseGeneration}
          AND canceled_at IS NULL
      `;
      if (updated === 0) {
        throw new DomainError(
          `Stale lease activation rejected: deployment ${deployment.id} is no longer owned by ${workerId}/${leaseGeneration}`,
          "STALE_LEASE"
        );
      }

      const switched = await tx.$executeRaw`
        UPDATE services
        SET status = 'LIVE'::"ServiceStatus",
            active_deployment_id = ${deployment.id},
            updated_at = ${utcParam(new Date())}::timestamp
        WHERE id = ${service.id}
      `;
      if (switched === 0) {
        throw new DomainError(`Service ${service.id} disappeared during activation`, "SERVICE_NOT_FOUND");
      }
    });
  }
}
