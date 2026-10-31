import { describe, expect, it } from "vitest";
import { WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { WebsiteBackup } from "../domain/backup.entity";
import { BackupRowSnapshot, DeploymentRepository, StorageProvider, WebsiteBackupRepository } from "../domain/ports";
import {
  CleanupExpiredBackupsUseCase,
  CreateWebsiteBackupUseCase,
  RestoreWebsiteBackupUseCase,
} from "../application/backup.use-cases";

const WEBSITE = "11111111-1111-1111-1111-111111111111";
const DEP_V1 = "dep-v1-id";
const DEP_SOURCE_PATH = `websites/${WEBSITE}/deployments/${DEP_V1}`;

class FakeStorage implements StorageProvider {
  files = new Map<string, Buffer>();
  deletedPaths: string[] = [];

  async put(path: string, content: Buffer) {
    this.files.set(path, content);
  }
  async get(path: string) {
    const c = this.files.get(path);
    if (!c) throw new Error(`not found: ${path}`);
    return c;
  }
  async delete(path: string) {
    this.files.delete(path);
    this.deletedPaths.push(path);
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix));
  }
  async exists(path: string) {
    return this.files.has(path);
  }
}

class InMemoryBackupRepository implements WebsiteBackupRepository {
  store = new Map<string, WebsiteBackup>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForWebsite(id: string) {
    return this.store.get(id) ?? null;
  }
  async existsForSource(_websiteId: WebsiteId, sourceDeploymentId: string) {
    return [...this.store.values()].some((b) => b.sourceDeploymentId === sourceDeploymentId);
  }
  async listByWebsite() {
    return [...this.store.values()];
  }
  async listExpired(before: Date): Promise<BackupRowSnapshot[]> {
    return [...this.store.values()]
      .filter((b) => b.expiresAt <= before)
      .map((b) => ({ backupId: b.id, websiteId: b.websiteId, sourceDeploymentId: b.sourceDeploymentId }));
  }
  async save(backup: WebsiteBackup) {
    this.store.set(backup.id, backup);
  }
  async delete(backupId: string) {
    this.store.delete(backupId);
  }
}

function readyDeployment(id: string, version: number): Deployment {
  const d = Deployment.create({
    id,
    websiteId: WebsiteId(WEBSITE),
    version,
    storagePath: `websites/${WEBSITE}/deployments/${id}`,
    uploadedById: "user-1",
  });
  d.startBuilding();
  d.markReady({ fileCount: 2, sizeBytes: 12 });
  return d;
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  store = new Map<string, Deployment>();
  nextVersion = 2;

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForWebsite(id: string) {
    return this.store.get(id) ?? null;
  }
  async listByWebsite() {
    return [...this.store.values()];
  }
  async getNextVersion() {
    return this.nextVersion++;
  }
  async save(d: Deployment) {
    this.store.set(d.id, d);
  }
}

async function seedWorld() {
  const storage = new FakeStorage();
  await storage.put(`${DEP_SOURCE_PATH}/index.html`, Buffer.from("<html></html>"));
  await storage.put(`${DEP_SOURCE_PATH}/styles.css`, Buffer.from("body{}"));

  const deployments = new InMemoryDeploymentRepository();
  deployments.store.set(DEP_V1, readyDeployment(DEP_V1, 1));

  const backups = new InMemoryBackupRepository();
  return { storage, deployments, backups };
}

describe("CreateWebsiteBackupUseCase", () => {
  it("copies artifacts into an immutable backup prefix and records the total size", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const useCase = new CreateWebsiteBackupUseCase(deployments, backups, storage);

    const result = await useCase.execute({
      websiteId: WEBSITE,
      sourceDeploymentId: DEP_V1,
      sourceStoragePath: DEP_SOURCE_PATH,
      retentionDays: 30,
    });

    expect(result.created).toBe(true);
    const saved = [...backups.store.values()][0]!;
    expect(saved.status).toBe("READY");
    expect(saved.sizeBytes).toBe(13 + 6); // "<html></html>" + "body{}"
    expect(await storage.exists(`websites/${WEBSITE}/backups/${saved.id}/index.html`)).toBe(true);
    expect(await storage.exists(`websites/${WEBSITE}/backups/${saved.id}/styles.css`)).toBe(true);
  });

  it("is idempotent per source deployment — a second run does not duplicate anything", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const useCase = new CreateWebsiteBackupUseCase(deployments, backups, storage);

    const first = await useCase.execute({ websiteId: WEBSITE, sourceDeploymentId: DEP_V1, sourceStoragePath: DEP_SOURCE_PATH });
    const second = await useCase.execute({ websiteId: WEBSITE, sourceDeploymentId: DEP_V1, sourceStoragePath: DEP_SOURCE_PATH });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.backupId).toBe(first.backupId);
    expect(backups.store.size).toBe(1);
  });

  it("refuses to back up deployments that are not READY/PUBLISHED", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const queued = Deployment.create({
      id: "dep-queued",
      websiteId: WebsiteId(WEBSITE),
      version: 2,
      storagePath: `websites/${WEBSITE}/deployments/dep-queued`,
      uploadedById: "user-1",
    }); // stays QUEUED
    deployments.store.set("dep-queued", queued);

    const useCase = new CreateWebsiteBackupUseCase(deployments, backups, storage);
    await expect(
      useCase.execute({ websiteId: WEBSITE, sourceDeploymentId: "dep-queued", sourceStoragePath: "websites/x/deployments/dep-queued" })
    ).rejects.toThrow(/BACKUPPABLE|only READY/i);
    expect(backups.store.size).toBe(0);
  });

  it("fails loudly when the source artifacts are gone", async () => {
    const { deployments, backups } = await seedWorld();
    const emptyStorage = new FakeStorage();
    const useCase = new CreateWebsiteBackupUseCase(deployments, backups, emptyStorage);

    await expect(
      useCase.execute({ websiteId: WEBSITE, sourceDeploymentId: DEP_V1, sourceStoragePath: DEP_SOURCE_PATH })
    ).rejects.toThrow(/SOURCE_EMPTY|artifacts not found/i);
  });
});

describe("RestoreWebsiteBackupUseCase", () => {
  it("materializes a NEW READY deployment version from the backup without touching it", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const create = new CreateWebsiteBackupUseCase(deployments, backups, storage);
    const { backupId } = await create.execute({ websiteId: WEBSITE, sourceDeploymentId: DEP_V1, sourceStoragePath: DEP_SOURCE_PATH });

    const restore = new RestoreWebsiteBackupUseCase(backups, deployments, storage);
    const result = await restore.execute({ websiteId: WEBSITE, backupId });

    // New immutable version, READY, at its own path.
    const restored = await deployments.findById(result.deploymentId);
    expect(restored!.status).toBe("READY");
    expect(restored!.version).toBe(2);
    expect(restored!.fileCount).toBe(2);
    expect(restored!.storagePath).toContain(`/deployments/${result.deploymentId}`);
    expect(await storage.exists(`${restored!.storagePath}/index.html`)).toBe(true);

    // Original backup untouched.
    const original = await backups.findById(backupId);
    expect(original!.storagePath).toContain("/backups/");
    expect(await storage.list(original!.storagePath)).toHaveLength(2);
  });

  it("fails clearly when backup artifacts are missing from storage", async () => {
    const { deployments, backups } = await seedWorld();
    const orphan = WebsiteBackup.create({
      id: "orphan",
      websiteId: WEBSITE,
      sourceDeploymentId: DEP_V1,
      storagePath: `websites/${WEBSITE}/backups/orphan`,
      retentionDays: 30,
    });
    backups.store.set("orphan", orphan);

    const restore = new RestoreWebsiteBackupUseCase(backups, deployments, new FakeStorage());
    await expect(restore.execute({ websiteId: WEBSITE, backupId: "orphan" })).rejects.toThrow(/artifacts missing/i);
  });
});

describe("Backup integrity (Fase 19 �14)", () => {
  it("restore verifica el hash y rechaza un backup corrupto", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const create = new CreateWebsiteBackupUseCase(deployments, backups, storage);
    const { backupId } = await create.execute({ websiteId: WEBSITE, sourceDeploymentId: DEP_V1, sourceStoragePath: DEP_SOURCE_PATH });

    // Silent corruption: someone modifies ONE file inside the backup.
    await storage.put(`websites/${WEBSITE}/backups/${backupId}/index.html`, Buffer.from("<html>HACKED</html>"));

    const restore = new RestoreWebsiteBackupUseCase(backups, deployments, storage);
    await expect(restore.execute({ websiteId: WEBSITE, backupId })).rejects.toThrow(/integrity check failed/i);

    // No corrupt deployment was created.
    expect(deployments.store.size).toBe(1);
  });

  it("un backup sin hash (legacy) se restaura sin bloqueo", async () => {
    const { storage, deployments, backups } = await seedWorld();
    const orphan = WebsiteBackup.create({
      id: "bk-legacy",
      websiteId: WEBSITE,
      sourceDeploymentId: DEP_V1,
      storagePath: `websites/${WEBSITE}/backups/bk-legacy`,
      retentionDays: 30,
    });
    backups.store.set("bk-legacy", orphan);
    await storage.put(`websites/${WEBSITE}/backups/bk-legacy/index.html`, Buffer.from("old"));

    const restore = new RestoreWebsiteBackupUseCase(backups, deployments, storage);
    const result = await restore.execute({ websiteId: WEBSITE, backupId: "bk-legacy" });
    expect(result.deploymentId).toBeTruthy();
  });
});

describe("CleanupExpiredBackupsUseCase", () => {
  it("deletes storage objects and rows for expired backups only", async () => {
    const { storage, backups } = await seedWorld();
    const NOW = new Date();

    const expired = WebsiteBackup.create({
      id: "expired-bk",
      websiteId: WEBSITE,
      sourceDeploymentId: DEP_V1,
      storagePath: `websites/${WEBSITE}/backups/expired-bk`,
      retentionDays: 30,
      now: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
    });
    const fresh = WebsiteBackup.create({
      id: "fresh-bk",
      websiteId: WEBSITE,
      sourceDeploymentId: `${DEP_V1}-b`,
      storagePath: `websites/${WEBSITE}/backups/fresh-bk`,
      retentionDays: 30,
      now: NOW,
    });
    backups.store.set(expired.id, expired);
    backups.store.set(fresh.id, fresh);
    await storage.put(`websites/${WEBSITE}/backups/expired-bk/index.html`, Buffer.from("x"));
    await storage.put(`websites/${WEBSITE}/backups/fresh-bk/index.html`, Buffer.from("y"));

    const cleanup = new CleanupExpiredBackupsUseCase(backups, storage);
    const result = await cleanup.execute({ now: NOW });

    expect(result.deleted).toBe(1);
    expect(backups.store.has("expired-bk")).toBe(false);
    expect(backups.store.has("fresh-bk")).toBe(true);
    expect(storage.deletedPaths).toEqual([`websites/${WEBSITE}/backups/expired-bk/index.html`]);
    expect(await storage.exists(`websites/${WEBSITE}/backups/fresh-bk/index.html`)).toBe(true);
  });
});


