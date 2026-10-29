import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { InfrastructureError } from "@sitedock/shared";
import { Service } from "../domain/service.entity";
import { ServiceDeployment } from "../domain/service-deployment.entity";
import { CreateServiceUseCase } from "../application/create-service.use-case";
import { BuildAndDeployServiceUseCase } from "../application/build-and-deploy-service.use-case";
import type {
  ContainerInstanceRepository,
  DeploymentLogRepository,
  ServiceDeploymentRepository,
  ServiceRepository,
} from "../domain/ports";
import type { ContainerInstance } from "../domain/container-instance.entity";
import type { DeploymentLog } from "../domain/deployment-log.entity";
import type { ContainerService } from "../infrastructure/container-service";

/**
 * Regression coverage for the first-deployment failure path of a service.
 *
 * These defects were found by driving the real pipeline (API → worker → runtime
 * agent → podman): a service created with an inline Dockerfile was treated as a
 * git source, and the resulting failure was replaced by a state-transition
 * error that also left the service stuck in PENDING with no customer-visible
 * error log.
 */

function makeService(overrides: Partial<Parameters<typeof Service.create>[0]> = {}): Service {
  return Service.create({
    id: randomUUID(),
    projectId: randomUUID(),
    name: "inline-app",
    type: "WEB",
    hostname: "inline-app-test",
    sourceType: "local",
    dockerfile: "FROM node:22-alpine\nCMD node server.js\n",
    port: 3000,
    ...overrides,
  });
}

class FakeServiceRepository implements ServiceRepository {
  readonly saved: Service[] = [];
  constructor(private readonly service: Service) {}
  async findById() { return this.service; }
  async findByIdForProject() { return this.service; }
  async findByIdForWorkspace() { return this.service; }
  async findByHostname() { return this.service; }
  async listByProject() { return [this.service]; }
  async getNextVersion() { return 1; }
  async save(service: Service) { this.saved.push(service); }
}

class FakeDeploymentRepository implements ServiceDeploymentRepository {
  constructor(private readonly deployment: ServiceDeployment) {}
  async findById() { return this.deployment; }
  async findByIdForService() { return this.deployment; }
  async findByIdempotencyKey() { return null; }
  async listClaimable() { return [this.deployment]; }
  async claimNext() { return this.deployment; }
  async listByService() { return [this.deployment]; }
  async listByStatus() { return [this.deployment]; }
  async listLiveByService() { return null; }
  async getNextVersion() { return this.deployment.version + 1; }
  async save() {}
  async saveWithLease() {}
  async renewLease() { return true; }
  async activateWithLease() {}
}

class FakeContainerInstanceRepository implements ContainerInstanceRepository {
  async findById() { return null; }
  async findByIdForDeployment() { return null; }
  async listByDeployment() { return []; }
  async listLiveByDeployment() { return null; }
  async save(_instance: ContainerInstance) {}
  async delete() {}
}

class FakeLogRepository implements DeploymentLogRepository {
  readonly entries: Array<{ level: string; message: string }> = [];
  async create(_deploymentId: string, level: string, message: string) {
    this.entries.push({ level, message });
    return { id: randomUUID(), level, message } as unknown as DeploymentLog;
  }
  async listByDeployment() { return []; }
}

describe("Service lifecycle — first deployment failure", () => {
  it("allows PENDING → FAILED so a service whose first build fails is visibly FAILED", () => {
    const service = makeService();
    expect(service.status).toBe("PENDING");

    expect(() => service.markFailed("build failed")).not.toThrow();
    expect(service.status).toBe("FAILED");
  });

  it("surfaces the original build error, records it for the customer, and marks the service FAILED", async () => {
    const service = makeService();
    const deployment = ServiceDeployment.create({
      id: randomUUID(),
      serviceId: service.id,
      version: 1,
    });
    deployment.claim("worker-test", 60_000);

    const services = new FakeServiceRepository(service);
    const logs = new FakeLogRepository();
    const containerService = {
      buildFromDockerfile: async () => {
        throw new InfrastructureError("podman build failed: RUN exit 1", "RUNTIME_COMMAND_FAILED");
      },
    } as unknown as ContainerService;

    const useCase = new BuildAndDeployServiceUseCase(
      services,
      new FakeDeploymentRepository(deployment),
      new FakeContainerInstanceRepository(),
      logs,
      containerService
    );

    const error = await useCase
      .execute({
        serviceId: service.id,
        deploymentId: deployment.id,
        workerId: "worker-test",
        leaseGeneration: deployment.leaseGeneration,
      })
      .catch((err: Error) => err);

    // The failure reason must be the build failure, never a lifecycle message.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("podman build failed: RUN exit 1");

    // The customer must be able to see why the deployment failed.
    expect(logs.entries.filter((e) => e.level === "error").map((e) => e.message)).toContain(
      "podman build failed: RUN exit 1"
    );

    // And the service must not stay silently PENDING forever.
    expect(service.status).toBe("FAILED");
  });

  it("keeps a previously LIVE service routable when a new deployment fails", async () => {
    const service = makeService();
    // Walk the real lifecycle to the LIVE state with an active release.
    service.startBuilding();
    service.startDeploying();
    service.activate("previous-deployment");
    expect(service.status).toBe("LIVE");

    const deployment = ServiceDeployment.create({
      id: randomUUID(),
      serviceId: service.id,
      version: 2,
    });
    deployment.claim("worker-test", 60_000);

    const containerService = {
      buildFromDockerfile: async () => {
        throw new InfrastructureError("podman build failed: RUN exit 1", "RUNTIME_COMMAND_FAILED");
      },
    } as unknown as ContainerService;

    const useCase = new BuildAndDeployServiceUseCase(
      new FakeServiceRepository(service),
      new FakeDeploymentRepository(deployment),
      new FakeContainerInstanceRepository(),
      new FakeLogRepository(),
      containerService
    );

    await useCase
      .execute({
        serviceId: service.id,
        deploymentId: deployment.id,
        workerId: "worker-test",
        leaseGeneration: deployment.leaseGeneration,
      })
      .catch(() => undefined);

    expect(service.status).toBe("LIVE");
    expect(service.activeDeploymentId).toBe("previous-deployment");
  });
});

describe("CreateServiceUseCase — source inference", () => {
  class CapturingServiceRepository implements ServiceRepository {
    saved: Service | null = null;
    async findById() { return this.saved; }
    async findByIdForProject() { return null; }
    async findByIdForWorkspace() { return null; }
    async findByHostname() { return this.saved; }
    async listByProject() { return []; }
    async getNextVersion() { return 1; }
    async save(service: Service) { this.saved = service; }
  }

  it("treats an inline Dockerfile with no sourceUrl as an inline (local) source", async () => {
    const repository = new CapturingServiceRepository();
    const useCase = new CreateServiceUseCase(repository);

    await useCase.execute({
      projectId: randomUUID(),
      name: "inline",
      dockerfile: "FROM node:22-alpine\n",
      contextFiles: { "server.js": Buffer.from("// app").toString("base64") },
      port: 3000,
    });

    expect(repository.saved?.sourceType).toBe("local");
  });

  it("keeps a git source when a repository URL is supplied", async () => {
    const repository = new CapturingServiceRepository();
    const useCase = new CreateServiceUseCase(repository);

    await useCase.execute({
      projectId: randomUUID(),
      name: "from-git",
      sourceUrl: "https://github.com/example/app.git",
      sourceBranch: "main",
    });

    expect(repository.saved?.sourceType).toBe("github");
  });

  it("never overrides an explicitly requested sourceType", async () => {
    const repository = new CapturingServiceRepository();
    const useCase = new CreateServiceUseCase(repository);

    await useCase.execute({
      projectId: randomUUID(),
      name: "explicit",
      sourceType: "git",
      sourceUrl: "https://github.com/example/app.git",
      dockerfile: "FROM node:22-alpine\n",
    });

    expect(repository.saved?.sourceType).toBe("git");
  });
});
