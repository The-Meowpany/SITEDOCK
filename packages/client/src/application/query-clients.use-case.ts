import { ClientId, NotFoundError, WorkspaceId } from "@sitedock/shared";
import { ClientRepository } from "../domain/ports";

export class ListClientsUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async execute(workspaceId: string) {
    const list = await this.clients.listByWorkspace(WorkspaceId(workspaceId));
    return list.map((c) => ({ id: c.id, fullName: c.fullName, email: c.email.value, createdAt: c.createdAt }));
  }
}

export class GetClientUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async execute(clientId: string, workspaceId: string) {
    const client = await this.clients.findByIdInWorkspace(ClientId(clientId), WorkspaceId(workspaceId));
    if (!client) throw new NotFoundError("Client", clientId);
    return { id: client.id, fullName: client.fullName, email: client.email.value, createdAt: client.createdAt };
  }
}
