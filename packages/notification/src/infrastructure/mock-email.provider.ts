import { EmailProvider } from "../domain/ports";
import { RenderedEmail } from "../domain/templates";

/**
 * Demo/mock EmailProvider (docs/ARCHITECTURE.md §45 "Demo Mode"). Captures
 * every "sent" email in memory instead of calling a real provider — swappable
 * 1:1 with a ResendEmailProvider without touching NotificationService.
 */
export class MockEmailProvider implements EmailProvider {
  readonly sentEmails: RenderedEmail[] = [];

  async send(email: RenderedEmail): Promise<void> {
    this.sentEmails.push(email);
  }
}
