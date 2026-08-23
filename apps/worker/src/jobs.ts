import { runSuspendOverdueSubscriptionsJob } from "./jobs/suspend-overdue-subscriptions.job";
import { runNotifyUpcomingRenewalsJob } from "./jobs/notify-upcoming-renewals.job";
import { runNotifyExpiringSslDomainsJob } from "./jobs/notify-expiring-ssl-domains.job";
import { runBackupLiveWebsitesJob } from "./jobs/backup-live-websites.job";
import { runCleanupExpiredBackupsJob } from "./jobs/cleanup-expired-backups.job";

export interface ScheduledJob {
  name: string;
  /** Interval in milliseconds between runs when running as a long-lived process. */
  intervalMs: number;
  run: () => Promise<unknown>;
}

/**
 * Job registry (docs/ARCHITECTURE.md §29/§31 "Scheduled Jobs"). Each job here
 * must be idempotent — re-running it twice in a row (e.g. after a crash/restart)
 * must never double-apply an effect. New jobs get added here as their own file
 * under ./jobs, following the same shape.
 */
export const scheduledJobs: ScheduledJob[] = [
  {
    name: "suspend-overdue-subscriptions",
    intervalMs: 15 * 60 * 1000, // every 15 minutes
    run: runSuspendOverdueSubscriptionsJob,
  },
  {
    // Reminders don't need fine granularity: at most one email per client per
    // billing period (enforced by the notification ledger dedup).
    name: "notify-upcoming-renewals",
    intervalMs: 6 * 60 * 60 * 1000, // every 6 hours
    run: runNotifyUpcomingRenewalsJob,
  },
  {
    name: "notify-expiring-ssl-domains",
    intervalMs: 24 * 60 * 60 * 1000, // daily — renews certs, alerts on failures
    run: runNotifyExpiringSslDomainsJob,
  },
  {
    // Idempotent per production deployment (unique pair), so hourly is cheap.
    name: "backup-live-websites",
    intervalMs: 60 * 60 * 1000, // every hour
    run: runBackupLiveWebsitesJob,
  },
  {
    name: "cleanup-expired-backups",
    intervalMs: 24 * 60 * 60 * 1000, // daily
    run: runCleanupExpiredBackupsJob,
  },
];
