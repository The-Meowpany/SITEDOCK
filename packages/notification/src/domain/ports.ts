import { RenderedEmail } from "./templates";

/**
 * EmailProvider abstraction (docs/ARCHITECTURE.md §24). NotificationService
 * never imports Resend/SES/Postmark directly — only this port.
 */
export interface EmailProvider {
  send(email: RenderedEmail): Promise<void>;
}

export interface NotificationLogRepository {
  record(params: { recipient: string; type: string; payload: unknown; sentAt: Date | null }): Promise<void>;
  /**
   * Deduplication query for scheduled jobs (docs/ARCHITECTURE.md §31 "these
   * jobs must be idempotent"): did we already log an entry of this type for
   * this recipient on or after `since`? `payloadMatches` narrows by top-level
   * payload keys (e.g. { subscriptionId }) so two subscriptions sharing a
   * recipient never suppress each other's reminders.
   */
  hasEntrySince(params: {
    type: string;
    recipient: string;
    since: Date;
    payloadMatches?: Record<string, unknown>;
  }): Promise<boolean>;
}
