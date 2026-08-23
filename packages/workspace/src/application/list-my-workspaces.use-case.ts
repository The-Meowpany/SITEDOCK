import { UserId } from "@sitedock/shared";
import { WorkspaceRepository } from "../domain/ports";

export class ListMyWorkspacesUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(userId: string) {
    const list = await this.workspaces.listForUser(UserId(userId));
    return list.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: w.roleOf(UserId(userId)),
    }));
  }
}
