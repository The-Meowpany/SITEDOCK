import {
  MockDomainProvider,
  PrismaCustomDomainRepository,
  RenewExpiringCertificatesUseCase,
} from "@sitedock/domains";
import { PrismaWorkspaceStaffDirectory } from "@sitedock/workspace";
import { NotificationService, createEmailProviderFromEnv, PrismaNotificationLogRepository } from "@sitedock/notification";
import { WorkspaceId } from "@sitedock/shared";
import { logger } from "../logger";

const domains = new PrismaCustomDomainRepository();
const provider = new MockDomainProvider();
const staffDirectory = new PrismaWorkspaceStaffDirectory();

const renewCertificates = new RenewExpiringCertificatesUseCase(domains, provider);
const notificationService = new NotificationService(createEmailProviderFromEnv().provider, new PrismaNotificationLogRepository());

const RENEWAL_WINDOW_DAYS = 30;
const ALERT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function deadlineFromNow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + RENEWAL_WINDOW_DAYS);
  return d;
}

/**
 * Scheduled job (brief §17): VERIFIED domains whose SSL certificate expires
 * inside the window get it renewed AUTOMATICALLY through the DomainProvider.
 *
 * Flow:
 *   1. batch-renew every expiring domain via RenewExpiringCertificatesUseCase
 *   2. whatever is STILL expiring afterwards failed to renew → alert the
 *      workspace's staff (`domain_expiring`, one email per domain per day,
 *      deduplicated against the notification ledger)
 *
 * The email is the fallback for a failed automation, not the happy path.
 * Idempotent: successful renewals push sslExpiresAt beyond the window so they
 * stop matching; failure alerts are deduped per (recipient, domainId) per day.
 */
export async function runNotifyExpiringSslDomainsJob(): Promise<{
  renewedCount: number;
  alertedDomainsCount: number;
}> {
  const startedAt = Date.now();

  // 1. Renew everything we can in one pass.
  const renewed = await renewCertificates.execute({ windowDays: RENEWAL_WINDOW_DAYS });

  // 2. Whatever still matches is a renewal failure — alert the humans.
  const stillExpiring = await domains.listSslExpiringBefore(deadlineFromNow());
  let alertedDomainsCount = 0;

  for (const snapshot of stillExpiring) {
    try {
      const emails = await staffDirectory.listStaffEmails(WorkspaceId(snapshot.workspaceId));
      const since = new Date(Date.now() - ALERT_DEDUP_WINDOW_MS);
      const daysRemaining = Math.max(
        0,
        Math.ceil((snapshot.sslExpiresAt.getTime() - Date.now()) / 86_400_000)
      );

      for (const email of emails) {
        const alreadyAlerted = await notificationService.hasLoggedSince({
          type: "domain_expiring",
          recipient: email,
          since,
          payloadMatches: { domainId: snapshot.domainId },
        });
        if (alreadyAlerted) continue;

        await notificationService.notify({
          type: "domain_expiring",
          recipientEmail: email,
          hostname: snapshot.hostname,
          daysRemaining,
          domainId: snapshot.domainId,
        });
      }
      alertedDomainsCount++;
    } catch (err) {
      logger.error(
        { err, domainId: snapshot.domainId },
        "Failed to alert staff about expiring SSL after renewal failure"
      );
    }
  }

  logger.info(
    { renewedCount: renewed.length, alertedDomainsCount, durationMs: Date.now() - startedAt },
    "NotifyExpiringSslDomainsJob run complete"
  );
  return { renewedCount: renewed.length, alertedDomainsCount };
}


