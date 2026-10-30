import { randomUUID } from "node:crypto";
import { ClientId, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { Client } from "../domain/client.entity";
import { ClientRepository } from "../domain/ports";

export interface EnsureClientForUserCommand {
  workspaceId: string;
  userId: string;
  fullName: string;
  email: string;
}

export class EnsureClientForUserUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async execute(command: EnsureClientForUserCommand): Promise<{ clientId: string; created: boolean }> {
    const workspaceId = WorkspaceId(command.workspaceId);
    const userId = UserId(command.userId);
    const email = EmailAddress.create(command.email);

    const existing = await this.clients.findByEmailInWorkspace(email, workspaceId);
    if (existing) {
      if (existing.userId !== userId) {
        existing.linkToUserAccount(userId);
        await this.clients.save(existing);
      }
      return { clientId: existing.id, created: false };
    }

    const client = Client.create({
      id: ClientId(randomUUID()),
      workspaceId,
      fullName: command.fullName,
      email: command.email,
    });
    client.linkToUserAccount(userId);
    await this.clients.save(client);

    return { clientId: client.id, created: true };
  }
}
