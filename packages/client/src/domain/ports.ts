import { ClientId, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { Client } from "./client.entity";

export interface ClientRepository {
  findById(id: ClientId): Promise<Client | null>;
  /** Tenant-scoped lookup — never look up a client by id alone, always with workspaceId. */
  findByIdInWorkspace(id: ClientId, workspaceId: WorkspaceId): Promise<Client | null>;
  findByEmailInWorkspace(email: EmailAddress, workspaceId: WorkspaceId): Promise<Client | null>;
  listByWorkspace(workspaceId: WorkspaceId): Promise<Client[]>;
  /** Resolves which client record a logged-in CLIENT-role user belongs to (portal scoping). */
  findByUserIdInWorkspace(userId: UserId, workspaceId: WorkspaceId): Promise<Client | null>;
  save(client: Client): Promise<void>;
}

