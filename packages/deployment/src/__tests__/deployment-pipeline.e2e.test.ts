import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, assertDedicatedTestDatabase } from "@sitedock/database";
import {
  BuildAndDeployServiceUseCase,
  ContainerService,
  EnqueueServiceDeploymentUseCase,
  PrismaContainerInstanceRepository,
  PrismaServiceDeploymentLogRepository,
  PrismaServiceDeploymentRepository,
  PrismaServiceRepository,
  Service,
} from "../index";

/**
 * Real deployment pipeline test: API-layer use cases → runtime agent → podman →
 * container → HTTP.
 *
 * Unlike the other suites here this one needs a live container runtime, so it
 * only runs when explicitly enabled:
 *
 *   SITEDOCK_E2E_RUNTIME=1 \
 *   SITEDOCK_TEST_DATABASE_URL=... \
 *   RUNTIME_AGENT_URL=http://127.0.0.1:4011 \
 *   RUNTIME_AGENT_TOKEN=... \
 *   npx vitest run src/__tests__/deployment-pipeline.e2e.test.ts
 *
 * It builds a tiny Node image, starts it, asserts a real HTTP response from the
 * published port, then removes every resource it created.
 */

const ENABLED = process.env.SITEDOCK_E2E_RUNTIME === "1";

const server = `const http=require("http");
http.createServer((req,res)=>{
  if(req.url==="/health"){res.writeHead(200,{"content-type":"text/plain"});res.end("ok");return;}
  res.writeHead(200,{"content-type":"text/plain"});
  res.end("e2e-ok");
}).listen(3000,"0.0.0.0");
`;

const dockerfile = [
  "FROM node:22-alpine",
  "WORKDIR /app",
  "COPY server.js /app/server.js",
  "EXPOSE 3000",
  'CMD ["node","/app/server.js"]',
  "",
].join("\n");

describe.skipIf(!ENABLED)("Deployment pipeline — real runtime agent", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const containerService = new ContainerService();
  const services = new PrismaServiceRepository();
  const deployments = new PrismaServiceDeploymentRepository();
  const instances = new PrismaContainerInstanceRepository();
  const logs = new PrismaServiceDeploymentLogRepository();

  let organizationId: string;
  let workspaceId: string;
  let projectId: string;
  let serviceId: string;
  let containerId: string | null = null;

  beforeAll(async () => {
    await assertDedicatedTestDatabase(prisma, "deployment-pipeline-e2e");

    organizationId = randomUUID();
    await prisma.organization.create({
      data: { id: organizationId, name: `E2E Org ${suffix}`, slug: `e2e-org-${suffix}` },
    });
    workspaceId = randomUUID();
    await prisma.workspace.create({
      data: { id: workspaceId, name: `E2E WS ${suffix}`, slug: `e2e-ws-${suffix}` },
    });
    projectId = randomUUID();
    await prisma.project.create({ data: { id: projectId, workspaceId, name: `E2E Project ${suffix}` } });

    const service = Service.create({
      id: randomUUID(),
      projectId,
      name: `e2e-pipeline-${suffix}`,
      type: "WEB",
      hostname: `e2e-pipeline-${suffix}`,
      sourceType: "local",
      dockerfile,
      contextFiles: { "server.js": Buffer.from(server).toString("base64") },
      port: 3000,
    });
    serviceId = service.id;
    await services.save(service);
  }, 60_000);

  afterAll(async () => {
    if (containerId) {
      await containerService.stopContainer(containerId).catch(() => undefined);
    }
    if (serviceId) {
      await prisma.serviceDeploymentLog.deleteMany({ where: { deployment: { serviceId } } }).catch(() => undefined);
      await prisma.containerInstance.deleteMany({ where: { serviceId } }).catch(() => undefined);
      await prisma.serviceDeployment.deleteMany({ where: { serviceId } }).catch(() => undefined);
      await prisma.service.deleteMany({ where: { id: serviceId } }).catch(() => undefined);
    }
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => undefined);
    if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } }).catch(() => undefined);
  }, 120_000);

  it("deploys the service and serves its application over HTTP", async () => {
    const enqueue = new EnqueueServiceDeploymentUseCase(services, deployments);
    const queued = await enqueue.execute({ serviceId });
    expect(queued.status).toBe("QUEUED");

    const claimed = await deployments.claimNext(`e2e-worker-${suffix}`, new Date(), 300_000);
    expect(claimed?.id).toBe(queued.deploymentId);

    const useCase = new BuildAndDeployServiceUseCase(services, deployments, instances, logs, containerService);
    const result = await useCase.execute({
      serviceId,
      deploymentId: queued.deploymentId,
      workerId: `e2e-worker-${suffix}`,
      leaseGeneration: claimed!.leaseGeneration,
    });
    containerId = result.containerId;

    expect(result.hostPort).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${result.hostPort}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("e2e-ok");

    const reloaded = await services.findById(serviceId);
    expect(reloaded?.status).toBe("LIVE");
    expect(reloaded?.activeDeploymentId).toBe(result.deploymentId);
  }, 600_000);
});
