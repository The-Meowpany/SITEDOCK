import { scheduledJobs } from "./jobs";
import { logger } from "./logger";

/**
 * Runs every registered job exactly once, then exits. Intended to be invoked
 * by an external scheduler (system cron, a platform's scheduled task feature,
 * a CI pipeline) rather than keeping a Node process alive — a valid
 * alternative to index.ts's long-lived loop, useful in serverless/ephemeral
 * hosting where a persistent worker process isn't available.
 */
async function main() {
  logger.info({ jobCount: scheduledJobs.length }, "Running all scheduled jobs once");

  let hadFailure = false;

  for (const job of scheduledJobs) {
    const startedAt = Date.now();
    try {
      const result = await job.run();
      logger.info({ job: job.name, durationMs: Date.now() - startedAt, result }, "Job completed");
    } catch (err) {
      hadFailure = true;
      logger.error({ job: job.name, err }, "Job failed");
    }
  }

  process.exit(hadFailure ? 1 : 0);
}

main();
