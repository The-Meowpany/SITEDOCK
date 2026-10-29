import { runProcessQueuedDeploymentsJob } from "../apps/worker/src/jobs/process-queued-deployments.job";

async function main() {
  const result = await runProcessQueuedDeploymentsJob();
  console.log("JOB_RESULT " + JSON.stringify(result));
  process.exit(0);
}

main().catch((err) => {
  console.error("JOB_ERROR", err);
  process.exit(1);
});
