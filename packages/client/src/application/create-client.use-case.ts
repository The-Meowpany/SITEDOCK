import { randomUUID } from "node:crypto";
import { ClientId, ConflictError, EmailAddress, WorkspaceId } from "@sitedock/shared";
import { Client } from "../domain/client.entity";
import { ClientRepository } from "../domain/ports";

export interface CreateClientCommand {
  workspaceId: string;
  fullName: string;
  email: string;
}

/**
 * Creates a client scoped to a workspace. Enforces uniqueness of email within
 * the workspace (not globally — the same person can be a client of two different
 * freelancers, each in their own tenant).
 */
export class CreateClientUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async execute(command: CreateClientCommand): Promise<{ clientId: string }> {
    const workspaceId = WorkspaceId(command.workspaceId);
    const email = EmailAddress.create(command.email);

    const existing = await this.clients.findByEmailInWorkspace(email, workspaceId);
    if (existing) {
      throw new ConflictError("A client with this email already exists in this workspace");
    }

    const client = Client.create({
      id: ClientId(randomUUID()),
      workspaceId,
      fullName: command.fullName,
      email: command.email,
    });

    await this.clients.save(client);
    return { clientId: client.id };
  }
}
