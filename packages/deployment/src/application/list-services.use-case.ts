import { ServiceRepository } from "../domain/ports";

export class ListServicesUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(projectId: string) {
    const services = await this.services.listByProject(projectId);
    return services.map((service) => service.toJSON());
  }
}
