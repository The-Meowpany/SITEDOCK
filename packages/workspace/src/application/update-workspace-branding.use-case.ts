import { NotFoundError, WorkspaceId } from "@sitedock/shared";
import { WorkspaceRepository } from "../domain/ports";

export interface UpdateBrandingCommand {
  workspaceId: string;
  /** NULL = clear branding (revert to the SiteDock default). */
  branding: Record<string, unknown> | null;
}

/**
 * White-label step 1 (docs/WHITE_LABEL_ARCHITECTURE.md): updates the
 * workspace branding (display name, primary color, logo URL).
 * OWNER/ADMIN authorization is resolved in the interfaces layer.
 */
export class UpdateWorkspaceBrandingUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(command: UpdateBrandingCommand): Promise<{ workspaceId: string; branding: Record<string, unknown> | null }> {
    const workspace = await this.workspaces.findById(WorkspaceId(command.workspaceId));
    if (!workspace) throw new NotFoundError("Workspace", command.workspaceId);

    workspace.updateBranding(command.branding);
    await this.workspaces.save(workspace);
    return { workspaceId: workspace.id, branding: workspace.branding };
  }
}
