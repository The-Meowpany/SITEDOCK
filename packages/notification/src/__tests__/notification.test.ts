import { describe, expect, it } from "vitest";
import { InfrastructureError } from "@sitedock/shared";
import { renderEmail } from "../domain/templates";
import { NotificationLogRepository, EmailProvider } from "../domain/ports";
import { NotificationService } from "../application/notification.service";
import { MockEmailProvider } from "../infrastructure/mock-email.provider";

describe("renderEmail", () => {
  it("renders a welcome email", () => {
    const email = renderEmail({ type: "welcome", recipientEmail: "dev@example.com", fullName: "Jane" });
    expect(email.to).toBe("dev@example.com");
    expect(email.subject).toMatch(/Welcome/);
    expect(email.body).toContain("Jane");
  });

  it("renders a checkout_created email with price and link", () => {
    const email = renderEmail({
      type: "checkout_created",
      recipientEmail: "client@example.com",
      websiteName: "Restaurante Pérez",
      checkoutUrl: "https://pay.sitedock.demo/checkout/xyz",
      priceDecimal: "29.00",
      currency: "USD",
    });
    expect(email.subject).toContain("Restaurante Pérez");
    expect(email.subject).toContain("29.00 USD");
    expect(email.body).toContain("https://pay.sitedock.demo/checkout/xyz");
  });

  it("renders a website_suspended email", () => {
    const email = renderEmail({ type: "website_suspended", recipientEmail: "client@example.com", websiteName: "Restaurante Pérez" });
    expect(email.subject).toContain("suspended");
  });

  it("renders every event type without throwing", () => {
    const events: Parameters<typeof renderEmail>[0][] = [
      { type: "welcome", recipientEmail: "a@b.com", fullName: "A" },
      { type: "client_invited", recipientEmail: "a@b.com", clientName: "A", workspaceName: "W", inviteUrl: "https://x" },
      { type: "checkout_created", recipientEmail: "a@b.com", websiteName: "W", checkoutUrl: "https://x", priceDecimal: "1.00", currency: "USD" },
      { type: "payment_succeeded", recipientEmail: "a@b.com", websiteName: "W", amountDecimal: "1.00", currency: "USD" },
      { type: "payment_failed", recipientEmail: "a@b.com", websiteName: "W", reason: "insufficient_funds" },
      { type: "invoice_created", recipientEmail: "a@b.com", websiteName: "W", amountDecimal: "1.00", currency: "USD", dueDate: "2026-09-01" },
      { type: "subscription_canceled", recipientEmail: "a@b.com", websiteName: "W" },
      { type: "website_suspended", recipientEmail: "a@b.com", websiteName: "W" },
      { type: "website_reactivated", recipientEmail: "a@b.com", websiteName: "W" },
      { type: "deployment_ready", recipientEmail: "a@b.com", websiteName: "W", previewUrl: "https://x", version: 2 },
      { type: "deployment_failed", recipientEmail: "a@b.com", websiteName: "W", errorMessage: "boom" },
      { type: "domain_expiring", recipientEmail: "a@b.com", hostname: "x.com", daysRemaining: 5, domainId: "dom-1" },
      { type: "renewal_reminder", recipientEmail: "a@b.com", websiteName: "W", amountDecimal: "29.00", currency: "USD", renewalDate: "2026-08-25", subscriptionId: "sub-1" },
    ];

    for (const event of events) {
      const email = renderEmail(event);
      expect(email.to).toBe("a@b.com");
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.body.length).toBeGreaterThan(0);
    }
  });
  it("renders a renewal_reminder email with date and price", () => {
    const email = renderEmail({
      type: "renewal_reminder",
      recipientEmail: "client@example.com",
      websiteName: "Restaurante Pérez",
      amountDecimal: "29.00",
      currency: "USD",
      renewalDate: "2026-08-25",
      subscriptionId: "sub-1",
    });
    expect(email.subject).toContain("renews on 2026-08-25");
    expect(email.body).toContain("29.00 USD");
  });
});

interface LogEntry {
  recipient: string;
  type: string;
  payload: unknown;
  sentAt: Date | null;
}

class InMemoryNotificationLog implements NotificationLogRepository {
  records: LogEntry[] = [];
  async record(params: { recipient: string; type: string; payload: unknown; sentAt: Date | null }) {
    this.records.push({ ...params });
  }
  async hasEntrySince(params: {
    type: string;
    recipient: string;
    since: Date;
    payloadMatches?: Record<string, unknown>;
  }) {
    return this.records.some((r) => {
      if (r.type !== params.type || r.recipient !== params.recipient) return false;
      const at = r.sentAt ?? new Date(0); // failed sends still count as attempts
      if (at < params.since) return false;
      if (!params.payloadMatches) return true;
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      return Object.entries(params.payloadMatches).every(([key, value]) => payload[key] === value);
    });
  }
}

class FailingEmailProvider implements EmailProvider {
  async send(): Promise<void> {
    throw new Error("SMTP timeout");
  }
}

describe("NotificationService", () => {
  it("sends the email and logs it as sent", async () => {
    const provider = new MockEmailProvider();
    const log = new InMemoryNotificationLog();
    const service = new NotificationService(provider, log);

    const result = await service.notify({ type: "welcome", recipientEmail: "dev@example.com", fullName: "Jane" });

    expect(result.sent).toBe(true);
    expect(provider.sentEmails).toHaveLength(1);
    expect(log.records).toHaveLength(1);
    expect(log.records[0]).toMatchObject({ recipient: "dev@example.com", type: "welcome" });
    expect(log.records[0]!.sentAt).not.toBeNull();
  });

  it("logs a failed send with sentAt: null and surfaces an InfrastructureError, without throwing raw provider errors", async () => {
    const provider = new FailingEmailProvider();
    const log = new InMemoryNotificationLog();
    const service = new NotificationService(provider, log);

    await expect(service.notify({ type: "welcome", recipientEmail: "dev@example.com", fullName: "Jane" })).rejects.toThrow(
      InfrastructureError
    );

    expect(log.records).toHaveLength(1);
    expect(log.records[0]!.sentAt).toBeNull();
  });

  it("deduplicates: hasLoggedSince matches entries recorded by notify(), scoped by subscription", async () => {
    const service = new NotificationService(new MockEmailProvider(), new InMemoryNotificationLog());
    const log = (service as unknown as { log: InMemoryNotificationLog }).log;

    await service.notify({
      type: "renewal_reminder",
      recipientEmail: "client@example.com",
      websiteName: "Site A",
      amountDecimal: "29.00",
      currency: "USD",
      renewalDate: "2026-08-25",
      subscriptionId: "sub-1",
    });

    const since = new Date("2026-08-01T00:00:00Z");
    expect(
      await service.hasLoggedSince({ type: "renewal_reminder", recipient: "client@example.com", since, payloadMatches: { subscriptionId: "sub-1" } })
    ).toBe(true);
    // A second subscription for the same client must not be suppressed…
    expect(
      await service.hasLoggedSince({ type: "renewal_reminder", recipient: "client@example.com", since, payloadMatches: { subscriptionId: "sub-2" } })
    ).toBe(false);
    // …nor must another recipient see this entry.
    expect(
      await service.hasLoggedSince({ type: "renewal_reminder", recipient: "other@example.com", since, payloadMatches: { subscriptionId: "sub-1" } })
    ).toBe(false);
    // Entries from before the cutoff don't count.
    expect(
      await service.hasLoggedSince({ type: "renewal_reminder", recipient: "client@example.com", since: new Date("2030-01-01T00:00:00Z"), payloadMatches: { subscriptionId: "sub-1" } })
    ).toBe(false);
    expect(log.records).toHaveLength(1);
  });
});
