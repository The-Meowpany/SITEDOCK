import { describe, expect, it } from "vitest";
import { SecretCipher } from "@sitedock/shared";
import { Service } from "../domain/service.entity";
import type { ServiceRepository } from "../domain/ports";
import { ServiceEnvironmentUseCase } from "../application/service-environment.use-case";
import { decryptSecrets } from "../application/build-and-deploy-service.use-case";

const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const KEY = Buffer.alloc(32, 3);

class InMemoryServices {
  store = new Map<string, Service>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForProject() {
    return null;
  }
  async findByIdForWorkspace() {
    return null;
  }
  async findByHostname() {
    return null;
  }
  async listByProject() {
    return [...this.store.values()];
  }
  async getNextVersion() {
    return 1;
  }
  async save(service: Service) {
    this.store.set(service.id, service);
  }
}

function seed() {
  const services = new InMemoryServices();
  const service = Service.create({
    id: SERVICE_ID,
    projectId: "project-1",
    name: "api",
    type: "WEB",
    hostname: "api.example.test",
  });
  services.store.set(service.id, service);
  return services;
}

describe("ServiceEnvironmentUseCase", () => {
  it("replaces plain variables and returns them sorted", async () => {
    const services = seed();
    const useCase = new ServiceEnvironmentUseCase(services as unknown as ServiceRepository, null);

    const result = await useCase.update({
      serviceId: SERVICE_ID,
      variables: { NODE_ENV: "production", API_URL: "https://api.example.test" },
    });

    expect(result.variables).toEqual([
      { key: "API_URL", value: "https://api.example.test" },
      { key: "NODE_ENV", value: "production" },
    ]);
    expect(result.secrets).toEqual([]);
  });

  it("encrypts secrets and never returns their values", async () => {
    const services = seed();
    const cipher = new SecretCipher(KEY);
    const useCase = new ServiceEnvironmentUseCase(services as unknown as ServiceRepository, cipher);

    const result = await useCase.update({
      serviceId: SERVICE_ID,
      secrets: { DATABASE_URL: "postgres://user:pass@db/app" },
    });

    expect(result.secrets).toEqual([{ key: "DATABASE_URL", configured: true }]);
    expect(JSON.stringify(result)).not.toContain("postgres");

    const stored = services.store.get(SERVICE_ID)!;
    expect(stored.secrets?.DATABASE_URL).toMatch(/^enc:v1:/);
    expect(decryptSecrets(stored.secrets ?? null, cipher)).toEqual({
      DATABASE_URL: "postgres://user:pass@db/app",
    });
  });

  it("updates and deletes individual secrets without clearing other keys", async () => {
    const services = seed();
    const cipher = new SecretCipher(KEY);
    const useCase = new ServiceEnvironmentUseCase(services as unknown as ServiceRepository, cipher);

    await useCase.update({ serviceId: SERVICE_ID, secrets: { A: "one", B: "two" } });
    await useCase.update({ serviceId: SERVICE_ID, secrets: { A: null, B: "updated" } });

    const stored = services.store.get(SERVICE_ID)!;
    expect(stored.secrets).not.toHaveProperty("A");
    expect(decryptSecrets(stored.secrets ?? null, cipher)).toEqual({ B: "updated" });
  });

  it("rejects invalid variable names", async () => {
    const services = seed();
    const useCase = new ServiceEnvironmentUseCase(services as unknown as ServiceRepository, null);

    await expect(
      useCase.update({ serviceId: SERVICE_ID, variables: { "BAD-KEY": "value" } })
    ).rejects.toThrow(/Invalid environment variable name/);
  });

  it("refuses secrets when no encryption key is configured", async () => {
    const services = seed();
    const useCase = new ServiceEnvironmentUseCase(services as unknown as ServiceRepository, null);

    await expect(
      useCase.update({ serviceId: SERVICE_ID, secrets: { TOKEN: "secret" } })
    ).rejects.toThrow(/SITEDOCK_SECRETS_KEY/);
  });

  it("refuses to deploy plaintext secret payloads", () => {
    const cipher = new SecretCipher(KEY);
    expect(() => decryptSecrets({ TOKEN: "plaintext" }, cipher)).toThrow(/not encrypted/);
  });

  it("refuses to deploy encrypted secrets without a key", () => {
    const cipher = new SecretCipher(KEY);
    const encrypted = cipher.encrypt("secret");
    expect(() => decryptSecrets({ TOKEN: encrypted }, null)).toThrow(/SITEDOCK_SECRETS_KEY/);
  });
});
