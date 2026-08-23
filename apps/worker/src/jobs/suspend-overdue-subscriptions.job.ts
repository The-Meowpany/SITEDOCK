import {
  PrismaSubscriptionRepository,
  SuspendOverdueSubscriptionsUseCase,
} from "@sitedock/billing";
import { MarkWebsiteGracePeriodUseCase, PrismaWebsiteRepository, SuspendWebsiteUseCase } from "@sitedock/website";
import { PrismaClientRepository } from "@sitedock/client";
import { NotificationService, PrismaNotificationLogRepository, createEmailProviderFromEnv } from "@sitedock/notification";
import { RetryPolicy, WebsiteId, runWithRetry } from "@sitedock/shared";
import { logger } from "../logger";

const subscriptions = new PrismaSubscriptionRepository();
const websites = new PrismaWebsiteRepository();
const clients = new PrismaClientRepository();

const suspendOverdueSubscriptions = new SuspendOverdueSubscriptionsUseCase(subscriptions);
const markWebsiteGracePeriod = new MarkWebsiteGracePeriodUseCase(websites);
const suspendWebsite = new SuspendWebsiteUseCase(websites);

// Same demo-mode wiring pattern as apps/api/src/notifications.ts — swapped for
// a real EmailProvider in production without touching this job.
const notificationService = new NotificationService(createEmailProviderFromEnv().provider, new PrismaNotificationLogRepository());

// Short retry policy for transient infra blips (a DB connection hiccup) within a
// single job run — distinct from the job's own 15-minute interval, which is the
// outer retry loop for anything that fails all these attempts (docs/ARCHITECTURE.md §30).
const perItemRetryPolicy = RetryPolicy.create({ maxAttempts: 2, backoffMs: [2_000] });

/**
 * Scheduled job (docs/ARCHITECTURE.md §17/§31): finds every subscription whose
 * grace period has elapsed, suspends the subscription, then drives the
 * corresponding Website through GRACE_PERIOD → SUSPENDED via its own bounded
 * context's use cases — Billing never mutates Website state directly
 * (docs/ARCHITECTURE.md §67). Idempotent: a subscription already suspended on
 * a previous run simply won't be returned by listByStatus("GRACE_PERIOD")
 * again, so re-running this job on a schedule is always safe.
 */
export async function runSuspendOverdueSubscriptionsJob(): Promise<{ suspendedCount: number }> {
  const startedAt = Date.now();
  const suspended = await suspendOverdueSubscriptions.execute();

  for (const { subscriptionId, websiteId } of suspended) {
    const outcome = await runWithRetry(async () => {
      const website = await websites.findById(WebsiteId(websiteId));
      if (!website) {
        logger.warn({ subscriptionId, websiteId }, "Overdue subscription references a website that no longer exists");
        return;
      }

      // Website may already be in GRACE_PERIOD (set when the subscription first
      // entered it) — bring it to SUSPENDED regardless of which exact prior
      // state it was in, catching a same-state mismatch rather than retrying it.
      if (website.status !== "GRACE_PERIOD") {
        try {
          await markWebsiteGracePeriod.execute(websiteId, website.workspaceId);
        } catch {
          /* already past GRACE_PERIOD or in an unexpected state — suspend() below will validate */
        }
      }
      await suspendWebsite.execute(websiteId, website.workspaceId);

      if (website.clientId) {
        const client = await clients.findById(website.clientId);
        if (client) {
          await notificationService.notify({ type: "website_suspended", recipientEmail: client.email.value, websiteName: website.name });
        }
      }
    }, perItemRetryPolicy);

    if (outcome.succeeded) {
      logger.info({ subscriptionId, websiteId }, "Suspended overdue subscription and website");
    } else {
      logger.error({ err: outcome.error, subscriptionId, websiteId, attempts: outcome.attempts }, "Failed to suspend website for overdue subscription after retries");
    }
  }

  logger.info({ suspendedCount: suspended.length, durationMs: Date.now() - startedAt }, "SuspendOverdueSubscriptionsJob run complete");
  return { suspendedCount: suspended.length };
}

