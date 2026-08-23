import { randomUUID } from "node:crypto";
import { Money, NotFoundError, WebsiteId } from "@sitedock/shared";
import { MaintenanceRequest } from "../domain/maintenance-request.entity";
import { MaintenanceComment } from "../domain/ports";
import { MaintenanceCommentRepository, MaintenanceRequestRepository } from "../domain/ports";

export class CreateMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}

  async execute(command: { websiteId: string; title: string; description: string }): Promise<{ requestId: string }> {
    const request = MaintenanceRequest.create({
      id: randomUUID(),
      websiteId: WebsiteId(command.websiteId),
      title: command.title,
      description: command.description,
    });
    await this.requests.save(request);
    return { requestId: request.id };
  }
}

async function loadOrThrow(requests: MaintenanceRequestRepository, id: string, websiteId: string) {
  const request = await requests.findByIdForWebsite(id, WebsiteId(websiteId));
  if (!request) throw new NotFoundError("MaintenanceRequest", id);
  return request;
}

export class QuoteMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(params: { requestId: string; websiteId: string; priceCents: number; currency: string }) {
    const request = await loadOrThrow(this.requests, params.requestId, params.websiteId);
    request.quotePrice(Money.fromCents(params.priceCents, params.currency));
    await this.requests.save(request);
  }
}

export class MarkMaintenanceRequestPaidUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.markPaid();
    await this.requests.save(request);
  }
}

export class StartMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.start();
    await this.requests.save(request);
  }
}

export class CompleteMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.complete();
    await this.requests.save(request);
  }
}

export class ApproveMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.approve();
    await this.requests.save(request);
  }
}

export class RequestChangesOnMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.requestChanges();
    await this.requests.save(request);
  }
}

export class CancelMaintenanceRequestUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(requestId: string, websiteId: string) {
    const request = await loadOrThrow(this.requests, requestId, websiteId);
    request.cancel();
    await this.requests.save(request);
  }
}

export class ListMaintenanceRequestsUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}
  async execute(websiteId: string) {
    const list = await this.requests.listByWebsite(WebsiteId(websiteId));
    return list.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priceCents: r.price?.amountCents ?? null,
      currency: r.price?.currency ?? null,
      createdAt: r.createdAt,
    }));
  }
}

export class AddMaintenanceCommentUseCase {
  constructor(
    private readonly requests: MaintenanceRequestRepository,
    private readonly comments: MaintenanceCommentRepository
  ) {}

  async execute(params: { requestId: string; websiteId: string; authorId: string; body: string }): Promise<{ commentId: string }> {
    await loadOrThrow(this.requests, params.requestId, params.websiteId); // ensures tenant-scoped existence
    const comment = MaintenanceComment.create({
      id: randomUUID(),
      maintenanceRequestId: params.requestId,
      authorId: params.authorId,
      body: params.body,
    });
    await this.comments.save(comment);
    return { commentId: comment.id };
  }
}

export class ListMaintenanceCommentsUseCase {
  constructor(
    private readonly requests: MaintenanceRequestRepository,
    private readonly comments: MaintenanceCommentRepository
  ) {}

  async execute(requestId: string, websiteId: string) {
    await loadOrThrow(this.requests, requestId, websiteId);
    const list = await this.comments.listByRequest(requestId);
    return list.map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, createdAt: c.createdAt }));
  }
}
