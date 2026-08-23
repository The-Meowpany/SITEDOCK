import { ClientId, NotFoundError, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { WebsiteRepository } from "../domain/ports";

/** Links a Website to the Client who will pay for it — required before checkout. */
export class AssignClientToWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}

  async execute(params: { websiteId: string; workspaceId: string; clientId: string }): Promise<void> {
    const website = await this.websites.findByIdInWorkspace(WebsiteId(params.websiteId), WorkspaceId(params.workspaceId));
    if (!website) throw new NotFoundError("Website", params.websiteId);

    website.assignClient(ClientId(params.clientId));
    await this.websites.save(website);
  }
}
