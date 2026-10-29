import { NotFoundError } from "@sitedock/shared";
import { ServiceRepository } from "../domain/ports";

export class GetServiceUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(serviceId: string) {
    const service = await this.services.findById(serviceId);
    if (!service) throw new NotFoundError("Service", serviceId);
    return service.toJSON();
  }
}
