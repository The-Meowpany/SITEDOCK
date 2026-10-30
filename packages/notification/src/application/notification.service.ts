import { InfrastructureError } from "@sitedock/shared";
import { NotificationEvent } from "../domain/notification-event";
import { renderEmail } from "../domain/templates";
import { EmailProvider, NotificationLogRepository } from "../domain/ports";

/**
 * Single entry point every other bounded context uses to notify a person by
 * email (docs/ARCHITECTURE.md §24). Rendering is pure/synchronous; only the
 * actual send is async and can fail — a failed send is logged with
 * sentAt: null rather than throwing, so a flaky EmailProvider never blocks
 * the use case that triggered the notification (e.g. a payment webhook ACK).
 */
export class NotificationService {
  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly log: NotificationLogRepository
  ) {}

  async notify(event: NotificationEvent): Promise<{ sent: boolean }> {
    const email = renderEmail(event);
    const payload =
      event.type === "password_reset"
        ? { type: event.type, recipientEmail: event.recipientEmail }
        : event;

    try {
      await this.emailProvider.send(email);
      await this.log.record({ recipient: email.to, type: event.type, payload, sentAt: new Date() });
      return { sent: true };
    } catch (err) {
      await this.log.record({ recipient: email.to, type: event.type, payload, sentAt: null });
      if (err instanceof InfrastructureError) throw err;
      throw new InfrastructureError(
        `Failed to send "${event.type}" notification to ${email.to}`,
        "EMAIL_SEND_FAILED"
      );
    }
  }

  /**
   * Read-side deduplication check used by scheduled jobs before calling
   * notify() — e.g. the renewal reminder job runs every few hours and must
   * only ever send one reminder per billing period (docs/ARCHITECTURE.md §31).
   */
  async hasLoggedSince(params: {
    type: string;
    recipient: string;
    since: Date;
    payloadMatches?: Record<string, unknown>;
  }): Promise<boolean> {
    return this.log.hasEntrySince(params);
  }
}
