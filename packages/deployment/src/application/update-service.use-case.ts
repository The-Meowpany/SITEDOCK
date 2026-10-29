import { ApplicationError } from "@sitedock/shared";
import { ServiceRepository } from "../domain/ports";

export interface UpdateServiceInput {
  serviceId: string;
  dockerfile?: string | null;
  contextFiles?: Record<string, string> | null;
  sourceType?: string;
  sourceUrl?: string | null;
  sourceBranch?: string | null;
  sourcePath?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  port?: number;
  env?: Record<string, unknown> | null;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  pidsLimit?: number | null;
  readonlyRoot?: boolean;
}

export class UpdateServiceUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(input: UpdateServiceInput): Promise<{ serviceId: string }> {
    const service = await this.services.findById(input.serviceId);
    if (!service) throw new ApplicationError(`Service ${input.serviceId} not found`, "SERVICE_NOT_FOUND");

    service.updateConfiguration({
      sourceType: input.sourceType,
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
    return { serviceId: service.id };
  }
}
