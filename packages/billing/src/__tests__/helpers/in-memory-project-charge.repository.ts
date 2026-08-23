import { ProjectCharge } from "../../domain/project-charge.entity";
import { ProjectChargeRepository } from "../../domain/ports";

/** Shared in-memory ProjectChargeRepository for billing tests. */
export class InMemoryProjectChargeRepository implements ProjectChargeRepository {
  store = new Map<string, ProjectCharge>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdInWorkspace(id: string, workspaceId: string) {
    const charge = this.store.get(id);
    return charge && (charge.workspaceId as string) === workspaceId ? charge : null;
  }
  async findByExternalCheckoutId(provider: string, externalCheckoutId: string) {
    return (
      [...this.store.values()].find(
        (c) => c.provider === provider && c.externalCheckoutId === externalCheckoutId
      ) ?? null
    );
  }
  async listByWebsite(websiteId: string) {
    return [...this.store.values()].filter((c) => (c.websiteId as string) === websiteId);
  }
  async save(charge: ProjectCharge) {
    this.store.set(charge.id, charge);
  }
}

