import { describe, expect, it, beforeEach } from "vitest";
import { DomainError, WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { DeploymentRepository, StorageProvider } from "../domain/ports";
import { CreateDeploymentUseCase, UploadedFile } from "../application/create-deployment.use-case";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

class InMemoryDeploymentRepository implements DeploymentRepository {
  store = new Map<string, Deployment>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForWebsite(id: string, websiteId: string) {
    const d = this.store.get(id);
    return d && d.websiteId === websiteId ? d : null;
  }
  async listByWebsite(websiteId: string) {
    return [...this.store.values()].filter((d) => d.websiteId === websiteId);
  }
  async getNextVersion(websiteId: string) {
    const existing = [...this.store.values()].filter((d) => d.websiteId === websiteId);
    return existing.length === 0 ? 1 : Math.max(...existing.map((d) => d.version)) + 1;
  }
  async save(deployment: Deployment) {
    this.store.set(deployment.id, deployment);
  }
}

class InMemoryStorageProvider implements StorageProvider {
  files = new Map<string, Buffer>();
  async put(path: string, content: Buffer) {
    this.files.set(path, content);
  }
  async get(path: string) {
    const c = this.files.get(path);
    if (!c) throw new Error("not found");
    return c;
  }
  async delete(path: string) {
    this.files.delete(path);
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix));
  }
  async exists(path: string) {
    return this.files.has(path);
  }
}

function file(path: string, content: string): UploadedFile {
  return { path, content: Buffer.from(content, "utf-8") };
}

describe("CreateDeploymentUseCase", () => {
  let deployments: InMemoryDeploymentRepository;
  let storage: InMemoryStorageProvider;
  let useCase: CreateDeploymentUseCase;

  beforeEach(() => {
    deployments = new InMemoryDeploymentRepository();
    storage = new InMemoryStorageProvider();
    useCase = new CreateDeploymentUseCase(deployments, storage);
  });

  it("stores files and creates a READY deployment as version 1", async () => {
    const result = await useCase.execute({
      websiteId: WEBSITE,
      uploadedById: "user-1",
      files: [file("index.html", "<h1>Hi</h1>"), file("styles.css", "body{}")],
    });

    expect(result.version).toBe(1);
    const deployment = await deployments.findById(result.deploymentId);
    expect(deployment?.status).toBe("READY");
    expect(deployment?.fileCount).toBe(2);

    const stored = await storage.get(`${result.previewPath}/index.html`);
    expect(stored.toString("utf-8")).toBe("<h1>Hi</h1>");
  });

  it("increments version numbers across successive deployments", async () => {
    await useCase.execute({ websiteId: WEBSITE, uploadedById: "user-1", files: [file("index.html", "v1")] });
    const second = await useCase.execute({ websiteId: WEBSITE, uploadedById: "user-1", files: [file("index.html", "v2")] });
    expect(second.version).toBe(2);
  });

  it("rejects an upload with path traversal before writing anything to storage", async () => {
    await expect(
      useCase.execute({
        websiteId: WEBSITE,
        uploadedById: "user-1",
        files: [file("index.html", "hi"), file("../../etc/passwd", "evil")],
      })
    ).rejects.toThrow(DomainError);

    expect(storage.files.size).toBe(0); // nothing was ever stored
    expect(deployments.store.size).toBe(0); // no deployment record created for a rejected upload
  });

  it("rejects an upload with a disallowed file type", async () => {
    await expect(
      useCase.execute({
        websiteId: WEBSITE,
        uploadedById: "user-1",
        files: [file("index.html", "hi"), file("shell.php", "<?php ?>")],
      })
    ).rejects.toThrow(DomainError);
  });
});
