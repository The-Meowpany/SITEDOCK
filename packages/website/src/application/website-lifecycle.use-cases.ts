import { NotFoundError, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { WebsiteRepository } from "../domain/ports";

async function loadOrThrow(websites: WebsiteRepository, websiteId: string, workspaceId: string) {
  const website = await websites.findByIdInWorkspace(WebsiteId(websiteId), WorkspaceId(workspaceId));
  if (!website) throw new NotFoundError("Website", websiteId);
  return website;
}

export class SubmitWebsiteForApprovalUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.submitForClientApproval();
    await this.websites.save(website);
  }
}

export class ApproveWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.approve();
    await this.websites.save(website);
  }
}

export class RejectWebsiteApprovalUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.rejectApproval();
    await this.websites.save(website);
  }
}

/**
 * Website suspension/reactivation driven by the Billing bounded context via
 * integration events (SubscriptionPastDue, SubscriptionSuspended, PaymentSucceeded).
 * These use cases are the only legal entry point for that transition — Billing
 * never mutates Website state directly.
 */
export class MarkWebsitePastDueUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.markPastDue();
    await this.websites.save(website);
  }
}

export class MarkWebsiteGracePeriodUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.markGracePeriod();
    await this.websites.save(website);
  }
}

export class SuspendWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.suspend();
    await this.websites.save(website);
  }
}

export class ReactivateWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}
  async execute(websiteId: string, workspaceId: string) {
    const website = await loadOrThrow(this.websites, websiteId, workspaceId);
    website.reactivate();
    await this.websites.save(website);
  }
}
