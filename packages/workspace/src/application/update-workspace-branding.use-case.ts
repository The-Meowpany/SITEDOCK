import { NotFoundError, WorkspaceId } from "@sitedock/shared";
import { WorkspaceRepository } from "../domain/ports";

export interface UpdateBrandingCommand {
  workspaceId: string;
  /** NULL = limpiar branding (volver a SiteDock default). */
  branding: Record<string, unknown> | null;
}

/**
 * White-label step 1 (docs/WHITE_LABEL_ARCHITECTURE.md): actualiza el
 * branding del workspace (nombre visible, color primario, logo URL).
 * La autorización OWNER/ADMIN se resuelve en la capa interfaces.
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
