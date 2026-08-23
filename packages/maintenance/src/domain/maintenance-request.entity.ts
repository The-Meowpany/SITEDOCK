import { DomainError, Money, WebsiteId } from "@sitedock/shared";
import { MaintenanceStatus, maintenanceStateMachine } from "./maintenance-status";

export interface MaintenanceRequestProps {
  id: string;
  websiteId: WebsiteId;
  title: string;
  description: string;
  status: MaintenanceStatus;
  price: Money | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MaintenanceRequest aggregate. Covers both free support requests (client asks
 * for a small change, developer marks it done, client approves) and paid work
 * orders (developer quotes a price, client pays, then work starts) —
 * docs/ARCHITECTURE.md §16 "Maintenance Requests" / §69.
 */
export class MaintenanceRequest {
  private constructor(private props: MaintenanceRequestProps) {}

  static create(params: { id: string; websiteId: WebsiteId; title: string; description: string }): MaintenanceRequest {
    if (params.title.trim().length < 3) {
      throw new DomainError("Maintenance request title must have at least 3 characters", "INVALID_TITLE");
    }
    const now = new Date();
    return new MaintenanceRequest({
      id: params.id,
      websiteId: params.websiteId,
      title: params.title.trim(),
      description: params.description.trim(),
      status: "OPEN",
      price: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: MaintenanceRequestProps): MaintenanceRequest {
    return new MaintenanceRequest(props);
  }

  private transitionTo(next: MaintenanceStatus): void {
    maintenanceStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
    this.props.updatedAt = new Date();
  }

  /** Developer quotes a price for extra work — request must still be OPEN. */
  quotePrice(price: Money): void {
    this.props.price = price;
    this.transitionTo("PENDING_PAYMENT");
  }

  markPaid(): void {
    this.transitionTo("PAID");
  }

  start(): void {
    this.transitionTo("IN_PROGRESS");
  }

  waitForClient(): void {
    this.transitionTo("WAITING_CLIENT");
  }

  resume(): void {
    this.transitionTo("IN_PROGRESS");
  }

  complete(): void {
    this.transitionTo("COMPLETED");
  }

  approve(): void {
    this.transitionTo("APPROVED");
  }

  /** Client rejects completed work — sends it back for rework. */
  requestChanges(): void {
    this.transitionTo("IN_PROGRESS");
  }

  cancel(): void {
    this.transitionTo("CANCELED");
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get title() { return this.props.title; }
  get description() { return this.props.description; }
  get status() { return this.props.status; }
  get price() { return this.props.price; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
}
