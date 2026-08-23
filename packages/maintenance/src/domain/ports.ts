import { DomainError, WebsiteId } from "@sitedock/shared";
import { MaintenanceRequest } from "./maintenance-request.entity";

export interface MaintenanceCommentProps {
  id: string;
  maintenanceRequestId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export class MaintenanceComment {
  private constructor(private props: MaintenanceCommentProps) {}

  static create(params: { id: string; maintenanceRequestId: string; authorId: string; body: string }): MaintenanceComment {
    if (params.body.trim().length === 0) {
      throw new DomainError("Comment body cannot be empty", "EMPTY_COMMENT");
    }
    return new MaintenanceComment({ ...params, body: params.body.trim(), createdAt: new Date() });
  }

  static hydrate(props: MaintenanceCommentProps): MaintenanceComment {
    return new MaintenanceComment(props);
  }

  get id() { return this.props.id; }
  get maintenanceRequestId() { return this.props.maintenanceRequestId; }
  get authorId() { return this.props.authorId; }
  get body() { return this.props.body; }
  get createdAt() { return this.props.createdAt; }
}

export interface MaintenanceRequestRepository {
  findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<MaintenanceRequest | null>;
  listByWebsite(websiteId: WebsiteId): Promise<MaintenanceRequest[]>;
  /** Used by the maintenance-tier allowance: requests created inside a billing period. */
  countCreatedBetween(websiteId: WebsiteId, from: Date, to: Date): Promise<number>;
  save(request: MaintenanceRequest): Promise<void>;
}

export interface MaintenanceCommentRepository {
  listByRequest(requestId: string): Promise<MaintenanceComment[]>;
  save(comment: MaintenanceComment): Promise<void>;
}
