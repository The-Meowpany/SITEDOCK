import { randomUUID } from "node:crypto";
import { UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";
import { WorkspaceRepository } from "../domain/ports";

export interface CreateWorkspaceCommand {
  name: string;
  ownerId: string;
}

export class CreateWorkspaceUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(command: CreateWorkspaceCommand): Promise<{ workspaceId: string; slug: string }> {
    const workspace = Workspace.create({
      id: WorkspaceId(randomUUID()),
      name: command.name,
      ownerId: UserId(command.ownerId),
    });

    await this.workspaces.save(workspace);

    return { workspaceId: workspace.id, slug: workspace.slug };
  }
}
