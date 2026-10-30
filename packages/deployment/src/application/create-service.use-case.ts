import { randomUUID } from "node:crypto";
import { ApplicationError } from "@sitedock/shared";
import { Service } from "../domain/service.entity";
import { ServiceRepository } from "../domain/ports";
import { ServiceType } from "../domain/service-status";

export interface CreateServiceInput {
  projectId: string;
  environmentId?: string | null;
  name: string;
  type?: ServiceType;
  hostname?: string;
  sourceType?: string;
  sourceUrl?: string | null;
  sourceBranch?: string | null;
  sourcePath?: string | null;
  dockerfile?: string | null;
  contextFiles?: Record<string, string> | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  port?: number;
  env?: Record<string, unknown> | null;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  pidsLimit?: number | null;
  readonlyRoot?: boolean;
}

export class CreateServiceUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(input: CreateServiceInput): Promise<{ serviceId: string; hostname: string }> {
    const name = input.name?.trim();
    if (!name) throw new ApplicationError("Service name is required", "MISSING_SERVICE_NAME");

    // Slugify without `replace(/^-+|-+$/g, "")`: trimming dashes with an
    // unanchored `-+$` is quadratic on a dash-heavy name (CWE-1333). Splitting
    // on the separator we just inserted is linear and equivalent.
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .split("-")
        .filter(Boolean)
        .join("-")
        .slice(0, 40) || "service";
    const hostname = input.hostname?.trim() || `${slug}-${randomUUID().slice(0, 8)}`;

    // A service created with an inline Dockerfile/build context is not a git
    // source. Defaulting it to "github" made every deploy try to clone a
    // repository the customer never supplied, so infer the inline source.
    const sourceType =
      input.sourceType?.trim() ||
      (!input.sourceUrl && (input.dockerfile || input.contextFiles) ? "local" : undefined);

    const service = Service.create({
      id: randomUUID(),
      projectId: input.projectId,
      environmentId: input.environmentId ?? null,
      name,
      type: input.type ?? "WEB",
      hostname,
      sourceType,
      sourceUrl: input.sourceUrl,
      sourceBranch: input.sourceBranch,
      sourcePath: input.sourcePath,
      dockerfile: input.dockerfile,
      contextFiles: input.contextFiles,
      buildCommand: input.buildCommand,
      startCommand: input.startCommand,
      port: input.port,
      env: input.env,
      cpuLimit: input.cpuLimit,
      memoryLimit: input.memoryLimit,
      pidsLimit: input.pidsLimit,
      readonlyRoot: input.readonlyRoot,
    });

    await this.services.save(service);
    return { serviceId: service.id, hostname: service.hostname };
  }
}
