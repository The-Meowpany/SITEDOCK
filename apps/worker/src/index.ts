import { scheduledJobs } from "./jobs";
import { logger } from "./logger";

/**
 * Long-lived worker process — runs every registered job on its own interval.
 * No external queue/scheduler dependency for MVP (docs/ARCHITECTURE.md §95:
 * no Kafka, no Kubernetes CronJobs required yet); `run-once.ts` is the
 * alternative entrypoint for driving jobs from an external cron/CI schedule
 * instead of keeping a process alive.
 */
async function runJobSafely(job: (typeof scheduledJobs)[number]) {
  const startedAt = Date.now();
  try {
    const result = await job.run();
    logger.info({ job: job.name, durationMs: Date.now() - startedAt, result }, "Job completed");
  } catch (err) {
    logger.error({ job: job.name, err }, "Job failed");
  }
}

function start() {
  logger.info({ jobCount: scheduledJobs.length }, "SiteDock worker starting");

  for (const job of scheduledJobs) {
    // Run once immediately on boot, then on its own interval.
    runJobSafely(job);
    setInterval(() => runJobSafely(job), job.intervalMs);
  }
}

start();
