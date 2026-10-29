import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, assertDedicatedTestDatabase } from "@sitedock/database";
import { deleteOwnFixtures, purgeStaleFixtureWorkspaces } from "./support/test-fixtures";
import {
  PrismaServiceRepository,
  PrismaServiceDeploymentRepository,
  PrismaContainerInstanceRepository,
  PrismaServiceDeploymentLogRepository,
  EnqueueServiceDeploymentUseCase,
  Service,
  ContainerInstance,
} from "../index";

describe("Real PostgreSQL Prisma Mappings Integration Tests", () => {
  const serviceRepo = new PrismaServiceRepository();
  const deploymentRepo = new PrismaServiceDeploymentRepository();
  const containerInstanceRepo = new PrismaContainerInstanceRepository();
  const logRepo = new PrismaServiceDeploymentLogRepository();
  const enqueueDeployment = new EnqueueServiceDeploymentUseCase(serviceRepo, deploymentRepo);

  let testWorkspaceId: string;
  let testProjectId: string;
  const testServiceIds: string[] = [];

  beforeAll(async () => {
    // Fail closed: refuse to write fixtures unless the live connection is the
    // dedicated test schema (never the development/production schema).
    await assertDedicatedTestDatabase(prisma, "prisma-service-mappings");
    await prisma.$queryRaw`SELECT 1`;

    // Recover from an interrupted previous run. Scoped to fixture workspace
    // slugs created by these suites; unrelated rows are never touched.
    await purgeStaleFixtureWorkspaces();

    // Create an isolated workspace and project for this integration test suite
    const ws = await prisma.workspace.create({
      data: {
        id: crypto.randomUUID(),
        name: `Mapping Test WS ${Date.now()}`,
        slug: `mapping-test-ws-${Date.now()}`,
      },
    });
    testWorkspaceId = ws.id;

    const proj = await prisma.project.create({
      data: {
        id: crypto.randomUUID(),
        workspaceId: testWorkspaceId,
        name: "Mapping Test Project",
      },
    });
    testProjectId = proj.id;
  });

  afterAll(async () => {
    // Scoped cleanup: only ids this suite actually created. If `beforeAll`
    // failed there is nothing to remove, and the helper never falls back to an
    // unscoped delete.
    try {
      await deleteOwnFixtures({
        serviceIds: testServiceIds,
        projectIds: [testProjectId],
        workspaceIds: [testWorkspaceId],
      });
    } catch {
      // Best-effort cleanup
    }
  });

  it("persists and retrieves a service with all source configuration mapped correctly", async () => {
    const serviceId = crypto.randomUUID();
    testServiceIds.push(serviceId);

    const service = Service.create({
      id: serviceId,
      projectId: testProjectId,
      name: "integration-test-service",
      hostname: `integration-test-${serviceId.slice(0, 8)}`,
      type: "WEB",
      sourceType: "dockerfile",
      sourceUrl: "https://github.com/sitedock/test-repo",
      sourceBranch: "main",
      sourcePath: "/app",
      dockerfile: "FROM node:20-alpine\nCMD [\"node\", \"-e\", \"console.log(1)\"]",
      buildCommand: "npm run build",
      startCommand: "npm start",
      port: 8080,
      env: { NODE_ENV: "production", APP_PORT: "8080" },
      cpuLimit: "0.5",
      memoryLimit: "256m",
      pidsLimit: 100,
      readonlyRoot: true,
    });

    await serviceRepo.save(service);

    const retrieved = await serviceRepo.findById(serviceId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(serviceId);
    expect(retrieved?.projectId).toBe(testProjectId);
    expect(retrieved?.name).toBe("integration-test-service");
    expect(retrieved?.type).toBe("WEB");
    expect(retrieved?.status).toBe("PENDING");
    expect(retrieved?.sourceType).toBe("dockerfile");
    expect(retrieved?.sourceUrl).toBe("https://github.com/sitedock/test-repo");
    expect(retrieved?.sourceBranch).toBe("main");
    expect(retrieved?.sourcePath).toBe("/app");
    expect(retrieved?.dockerfile).toContain("FROM node:20-alpine");
    expect(retrieved?.buildCommand).toBe("npm run build");
    expect(retrieved?.startCommand).toBe("npm start");
    expect(retrieved?.port).toBe(8080);
    expect(retrieved?.env).toEqual({ NODE_ENV: "production", APP_PORT: "8080" });
    expect(retrieved?.cpuLimit).toBe("0.5");
    expect(retrieved?.memoryLimit).toBe("256m");
    expect(retrieved?.pidsLimit).toBe(100);
    expect(retrieved?.readonlyRoot).toBe(true);
  });

  it("enqueues a deployment and verifies service-to-deployment relationship", async () => {
    const serviceId = testServiceIds[0]!;
    const idempotencyKey = `idemp-${Date.now()}`;

    const enqueued = await enqueueDeployment.execute({
      serviceId,
      idempotencyKey,
    });

    expect(enqueued.deploymentId).toBeDefined();
    expect(enqueued.version).toBe(1);
    expect(enqueued.status).toBe("QUEUED");

    const retrieved = await deploymentRepo.findById(enqueued.deploymentId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(enqueued.deploymentId);
    expect(retrieved?.serviceId).toBe(serviceId);
    expect(retrieved?.version).toBe(1);
    expect(retrieved?.status).toBe("QUEUED");
    expect(retrieved?.idempotencyKey).toBe(idempotencyKey);
    expect(retrieved?.attempts).toBe(0);
    expect(retrieved?.maxAttempts).toBe(3);
    expect(retrieved?.claimedBy).toBeNull();
    expect(retrieved?.leaseGeneration).toBe(0);
  });

  it("executes atomic queue claim, lease generation increment, and worker transition", async () => {
    const workerId = "test-worker-1";
    const now = new Date();
    const leaseMs = 60_000;

    const claimed = await deploymentRepo.claimNext(workerId, now, leaseMs);
    expect(claimed).not.toBeNull();
    expect(claimed?.claimedBy).toBe(workerId);
    expect(claimed?.status).toBe("BUILDING");
    expect(claimed?.leaseGeneration).toBe(1);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.leaseExpiresAt).not.toBeNull();
    expect(claimed?.leaseExpiresAt!.getTime()).toBeGreaterThanOrEqual(now.getTime() + leaseMs - 1000);

    // Save with lease generation verification
    claimed?.markBuilt("test-img-123", "sha256:test-img-123", "Build output test log");
    await deploymentRepo.saveWithLease(claimed!, workerId, 1);

    const afterSave = await deploymentRepo.findById(claimed!.id);
    expect(afterSave?.status).toBe("READY");
    expect(afterSave?.imageId).toBe("test-img-123");
    expect(afterSave?.imageDigest).toBe("sha256:test-img-123");
    expect(afterSave?.buildLog).toBe("Build output test log");
    expect(afterSave?.leaseGeneration).toBe(1);
  });

  it("persists and queries container instance and deployment logs", async () => {
    const serviceId = testServiceIds[0]!;
    const deployments = await deploymentRepo.listByService(serviceId);
    const deployment = deployments[0]!;

    const instanceId = crypto.randomUUID();
    // container_id is globally unique: never hardcode it or a leftover row from
    // a previous run makes this suite fail for the wrong reason.
    const containerId = `podman-container-${instanceId.slice(0, 12)}`;
    const instance = ContainerInstance.create({
      id: instanceId,
      serviceId,
      deploymentId: deployment.id,
      containerId,
      hostPort: 38080,
      containerPort: 8080,
    });

    await containerInstanceRepo.save(instance);

    const retrievedInstance = await containerInstanceRepo.findById(instanceId);
    expect(retrievedInstance).not.toBeNull();
    expect(retrievedInstance?.id).toBe(instanceId);
    expect(retrievedInstance?.serviceId).toBe(serviceId);
    expect(retrievedInstance?.deploymentId).toBe(deployment.id);
    expect(retrievedInstance?.containerId).toBe(containerId);
    expect(retrievedInstance?.hostPort).toBe(38080);
    expect(retrievedInstance?.containerPort).toBe(8080);
    expect(retrievedInstance?.status).toBe("RUNNING");

    // Persist log
    const log = await logRepo.create(deployment.id, "info", "Health check OK", { hostPort: 38080 });
    expect(log.id).toBeDefined();
    expect(log.deploymentId).toBe(deployment.id);
    expect(log.level).toBe("info");
    expect(log.message).toBe("Health check OK");

    const logs = await logRepo.listByDeployment(deployment.id);
    expect(logs.some((l) => l.message === "Health check OK")).toBe(true);
  });
});
