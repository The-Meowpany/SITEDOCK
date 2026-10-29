import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, assertDedicatedTestDatabase } from "@sitedock/database";
import { deleteOwnFixtures, purgeStaleFixtureWorkspaces } from "./support/test-fixtures";
import {
  PrismaServiceRepository,
  PrismaServiceDeploymentRepository,
  EnqueueServiceDeploymentUseCase,
  Service,
  ServiceDeployment,
} from "../index";
import { DomainError } from "@sitedock/shared";

describe("Worker Concurrency, Stale-Lease Safety, and Queue Reliability Integration Tests", () => {
  const serviceRepo = new PrismaServiceRepository();
  const deploymentRepo = new PrismaServiceDeploymentRepository();
  const enqueueDeployment = new EnqueueServiceDeploymentUseCase(serviceRepo, deploymentRepo);

  let testWorkspaceId: string;
  let testProjectId: string;
  let testServiceId: string;

  beforeAll(async () => {
    // Fail closed: refuse to write fixtures unless the live connection is the
    // dedicated test schema (never the development/production schema).
    await assertDedicatedTestDatabase(prisma, "worker-concurrency-and-stale-lease");
    await prisma.$queryRaw`SELECT 1`;

    // Recover from an interrupted previous run. Scoped to fixture workspace
    // slugs created by these suites; unrelated rows are never touched.
    await purgeStaleFixtureWorkspaces();

    const ws = await prisma.workspace.create({
      data: {
        id: crypto.randomUUID(),
        name: `Concurrency Test WS ${Date.now()}`,
        slug: `concurrency-test-ws-${Date.now()}`,
      },
    });
    testWorkspaceId = ws.id;

    const proj = await prisma.project.create({
      data: {
        id: crypto.randomUUID(),
        workspaceId: testWorkspaceId,
        name: "Concurrency Test Project",
      },
    });
    testProjectId = proj.id;

    testServiceId = crypto.randomUUID();
    const service = Service.create({
      id: testServiceId,
      projectId: testProjectId,
      name: "concurrency-service",
      hostname: `concurrency-${testServiceId.slice(0, 8)}`,
      type: "WEB",
      dockerfile: "FROM alpine\nCMD [\"sleep\", \"1\"]",
    });
    await serviceRepo.save(service);
  });

  afterAll(async () => {
    // Scoped cleanup: only ids this suite actually created. If `beforeAll`
    // failed there is nothing to remove, and the helper never falls back to an
    // unscoped delete.
    try {
      await deleteOwnFixtures({
        serviceIds: [testServiceId],
        projectIds: [testProjectId],
        workspaceIds: [testWorkspaceId],
      });
    } catch {}
  });

  it("handles concurrent claims safely with FOR UPDATE SKIP LOCKED: exactly 1 worker claims each job", async () => {
    // Fail closed: never issue an update whose id filter could be undefined.
    if (!testServiceId) throw new Error("fixture service was not created; refusing to run a queue update");

    // `claimNext` is intentionally global (oldest eligible deployment regardless
    // of which suite created it, see test-fixtures.ts). Earlier suites in the
    // shared test schema can leave QUEUED/BUILDING rows behind, and those older
    // rows would win `ORDER BY created_at ASC` and steal this suite's claims.
    // Clear only THIS suite's abandoned queue work-in-progress so our two jobs
    // are the only claimable rows from our service. We never cancel jobs owned
    // by other suites — that would violate test isolation and data safety.
    await prisma.serviceDeployment.updateMany({
      where: { serviceId: testServiceId, status: { in: ["QUEUED", "BUILDING"] } },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    // Enqueue 2 deployments
    const dep1 = await enqueueDeployment.execute({ serviceId: testServiceId });
    const dep2 = await enqueueDeployment.execute({ serviceId: testServiceId });

    // Race 5 workers simultaneously to claim the 2 jobs
    const workers = ["worker-alpha", "worker-beta", "worker-gamma", "worker-delta", "worker-epsilon"];
    const now = new Date();
    const claims = await Promise.all(
      workers.map((workerId) => deploymentRepo.claimNext(workerId, now, 60_000))
    );

    const nonNullClaims = claims.filter((c): c is ServiceDeployment => c !== null && (c.id === dep1.deploymentId || c.id === dep2.deploymentId));

    // Exactly 2 claims succeeded across the 5 concurrent workers for our jobs
    expect(nonNullClaims.length).toBe(2);

    // Each claimed deployment has a distinct ID and unique claiming worker
    const claimedIds = new Set(nonNullClaims.map((c) => c.id));
    const claimingWorkers = new Set(nonNullClaims.map((c) => c.claimedBy));

    expect(claimedIds.size).toBe(2);
    expect(claimingWorkers.size).toBe(2);
    expect(claimedIds.has(dep1.deploymentId)).toBe(true);
    expect(claimedIds.has(dep2.deploymentId)).toBe(true);
  });

  it("enforces the stale-worker sequence: Worker A lease expires, Worker B reclaims and completes, Worker A stale mutations are rejected", async () => {
    // 1. Create and enqueue deployment D
    const enqueued = await enqueueDeployment.execute({ serviceId: testServiceId });
    const deploymentId = enqueued.deploymentId;

    // 2. Worker A claims deployment D with a lease that expires 50ms in the future
    const claimTimeA = new Date();
    const leaseMs = 50;
    const workerAClaim = await deploymentRepo.claimNext("worker-A", claimTimeA, leaseMs);

    expect(workerAClaim).not.toBeNull();
    expect(workerAClaim?.id).toBe(deploymentId);
    expect(workerAClaim?.claimedBy).toBe("worker-A");
    expect(workerAClaim?.leaseGeneration).toBe(1);

    // 3. Wait for Worker A's lease to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 4. Worker B reclaims deployment D with a newer lease generation
    const claimTimeB = new Date(Date.now() + 500);
    const workerBClaim = await deploymentRepo.claimNext("worker-B", claimTimeB, 60_000);

    expect(workerBClaim).not.toBeNull();
    expect(workerBClaim?.id).toBe(deploymentId);
    expect(workerBClaim?.claimedBy).toBe("worker-B");
    expect(workerBClaim?.leaseGeneration).toBe(2); // Generation incremented
    expect(workerBClaim?.status).toBe("BUILDING");

    // 5. Worker B finishes build and persists its authoritative state
    workerBClaim?.markBuilt("image-b-digest", "sha256:image-b-digest", "Built by Worker B");
    await deploymentRepo.saveWithLease(workerBClaim!, "worker-B", 2);

    const stateAfterB = await deploymentRepo.findById(deploymentId);
    expect(stateAfterB?.status).toBe("READY");
    expect(stateAfterB?.claimedBy).toBe("worker-B");
    expect(stateAfterB?.leaseGeneration).toBe(2);
    expect(stateAfterB?.imageId).toBe("image-b-digest");

    // 6. Worker A resumes and attempts stale state mutations using generation 1
    workerAClaim?.markBuilt("image-a-stale", "sha256:image-a-stale", "Built by Worker A (stale)");

    // 7. Atomic database update MUST reject Worker A's mutation
    await expect(
      deploymentRepo.saveWithLease(workerAClaim!, "worker-A", 1)
    ).rejects.toThrow(DomainError);

    await expect(
      deploymentRepo.saveWithLease(workerAClaim!, "worker-A", 1)
    ).rejects.toMatchObject({ code: "STALE_LEASE" });

    // 8. Worker B's successful state remains completely authoritative and untouched
    const stateAfterAAttempt = await deploymentRepo.findById(deploymentId);
    expect(stateAfterAAttempt?.status).toBe("READY");
    expect(stateAfterAAttempt?.claimedBy).toBe("worker-B");
    expect(stateAfterAAttempt?.leaseGeneration).toBe(2);
    expect(stateAfterAAttempt?.imageId).toBe("image-b-digest");
    expect(stateAfterAAttempt?.buildLog).toBe("Built by Worker B");
  });

  it("enforces idempotency keys: duplicate enqueues return the existing deployment", async () => {
    const key = `idempotency-key-${Date.now()}`;

    const first = await enqueueDeployment.execute({
      serviceId: testServiceId,
      idempotencyKey: key,
    });

    const second = await enqueueDeployment.execute({
      serviceId: testServiceId,
      idempotencyKey: key,
    });

    expect(first.deploymentId).toBe(second.deploymentId);
    expect(first.version).toBe(second.version);
    expect(first.status).toBe(second.status);
  });

  it("respects deployment cancellation: canceled deployments are never claimed", async () => {
    const enqueued = await enqueueDeployment.execute({ serviceId: testServiceId });
    const dep = await deploymentRepo.findById(enqueued.deploymentId);
    expect(dep).not.toBeNull();

    dep?.cancel();
    await deploymentRepo.save(dep!);

    const claim = await deploymentRepo.claimNext("worker-cancel-test", new Date(), 60_000);
    // Either null or a different deployment — never the canceled one
    if (claim) {
      expect(claim.id).not.toBe(enqueued.deploymentId);
      expect(claim.canceledAt).toBeNull();
    }
  });

  it("enforces retry exhaustion: deployments reaching max_attempts are not reclaimed", async () => {
    const enqueued = await enqueueDeployment.execute({ serviceId: testServiceId });
    const dep = await deploymentRepo.findById(enqueued.deploymentId);
    expect(dep).not.toBeNull();

    // Simulate exhausting max attempts
    await prisma.serviceDeployment.update({
      where: { id: enqueued.deploymentId },
      data: {
        attempts: 3,
        maxAttempts: 3,
        status: "QUEUED",
        claimedBy: null,
        nextRetryAt: null,
      },
    });

    // Worker attempts to claim; should skip because attempts >= max_attempts
    const claim = await deploymentRepo.claimNext("worker-retry-test", new Date(), 60_000);
    if (claim) {
      expect(claim.id).not.toBe(enqueued.deploymentId);
    }
  });
});
