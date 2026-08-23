import {
  FindUpcomingRenewalsUseCase,
  PrismaSubscriptionRepository,
  previousPeriodStart,
} from "@sitedock/billing";
import { PrismaWebsiteRepository } from "@sitedock/website";
import { PrismaClientRepository } from "@sitedock/client";
import { NotificationService, PrismaNotificationLogRepository, createEmailProviderFromEnv } from "@sitedock/notification";
import { RetryPolicy, WebsiteId, runWithRetry } from "@sitedock/shared";
import { logger } from "../logger";

const subscriptions = new PrismaSubscriptionRepository();
const websites = new PrismaWebsiteRepository();
const clients = new PrismaClientRepository();

const findUpcomingRenewals = new FindUpcomingRenewalsUseCase(subscriptions);

// Same demo-mode wiring pattern as apps/api/src/notifications.ts and the
// suspend job — swapped for a real EmailProvider in production without
// touching this job.
const notificationService = new NotificationService(createEmailProviderFromEnv().provider, new PrismaNotificationLogRepository());

// Short retry policy for transient infra blips within a single run; the job's
// own interval is the outer retry loop (docs/ARCHITECTURE.md §30).
const perItemRetryPolicy = RetryPolicy.create({ maxAttempts: 2, backoffMs: [2_000] });

type ReminderOutcome = "reminded" | "already-notified" | "skipped";

/**
 * Scheduled job (docs/ARCHITECTURE.md §17/§31): reminds ACTIVE clients a few
 * days before their next charge — fewer failed payments means less involuntary
 * churn downstream (PAST_DUE → GRACE_PERIOD → SUSPENDED never fires at all).
 *
 * Idempotency lives in the Notification ledger: before sending, the job asks
 * whether a reminder for this exact subscription was already logged during
 * the CURRENT billing period (`since` = period start, mirrored backwards from
 * nextBillingDate). Running every few hours therefore sends at most one
 * reminder per subscription per period, even across restarts.
 */
export async function runNotifyUpcomingRenewalsJob(): Promise<{
  remindedCount: number;
  alreadyNotifiedCount: number;
  skippedCount: number;
}> {
  const startedAt = Date.now();
  const candidates = await findUpcomingRenewals.execute();

  let remindedCount = 0;
  let alreadyNotifiedCount = 0;
  let skippedCount = 0;

  for (const renewal of candidates) {
    const outcome = await runWithRetry<ReminderOutcome>(async () => {
      const website = await websites.findById(WebsiteId(renewal.websiteId));
      if (!website) {
        logger.warn(
          { subscriptionId: renewal.subscriptionId, websiteId: renewal.websiteId },
          "Upcoming renewal references a website that no longer exists"
        );
        return "skipped";
      }
      if (!website.clientId) {
        // No client attached yet (e.g. pre-checkout subscription) — nothing to remind.
        return "skipped";
      }
      const client = await clients.findById(website.clientId);
      if (!client) return "skipped";

      const since = previousPeriodStart(renewal.nextBillingDate, renewal.billingInterval);
      const alreadyNotified = await notificationService.hasLoggedSince({
        type: "renewal_reminder",
        recipient: client.email.value,
        since,
        payloadMatches: { subscriptionId: renewal.subscriptionId },
      });
      if (alreadyNotified) return "already-notified";

      await notificationService.notify({
        type: "renewal_reminder",
        recipientEmail: client.email.value,
        websiteName: website.name,
        amountDecimal: renewal.amountDecimal,
        currency: renewal.currency,
        renewalDate: renewal.nextBillingDate.toISOString().slice(0, 10),
        subscriptionId: renewal.subscriptionId,
      });
      return "reminded";
    }, perItemRetryPolicy);

    // A failed send is still recorded (sentAt: null) inside NotificationService,
    // so the next scheduled run re-attempts it safely — hasLoggedSince counts
    // attempts too. One client's SMTP hiccup never aborts the whole batch.
    if (!outcome.succeeded) {
      logger.error(
        { err: outcome.error, subscriptionId: renewal.subscriptionId, attempts: outcome.attempts },
        "Failed to process renewal reminder after retries"
      );
      continue;
    }

    if (outcome.result === "reminded") remindedCount++;
    else if (outcome.result === "already-notified") alreadyNotifiedCount++;
    else skippedCount++;
  }

  logger.info(
    { remindedCount, alreadyNotifiedCount, skippedCount, candidates: candidates.length, durationMs: Date.now() - startedAt },
    "NotifyUpcomingRenewalsJob run complete"
  );
  return { remindedCount, alreadyNotifiedCount, skippedCount };
}

