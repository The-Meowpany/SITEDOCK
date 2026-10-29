import { prisma } from "@sitedock/database";
import { ContainerService } from "@sitedock/deployment";
import { readFileSync } from "node:fs";

async function main() {
  const containerId = process.argv[2]!;
  const serviceId = readFileSync(".e2e/svcid2.txt", "utf8").trim();

  const agent = new ContainerService({
    baseUrl: process.env.RUNTIME_AGENT_URL,
    token: process.env.RUNTIME_AGENT_TOKEN,
  });
  const summary = (await agent.inspectContainer(containerId)) as Record<string, any>;
  const runningImage = summary?.Image;

  const deployments = await prisma.serviceDeployment.findMany({
    where: { serviceId },
    orderBy: { version: "asc" },
    select: { version: true, imageId: true, status: true },
  });

  console.log("running image: " + String(runningImage).slice(0, 30));
  for (const d of deployments) {
    console.log(
      `v${d.version} status=${d.status} image=${String(d.imageId).slice(0, 30)} match=${d.imageId === runningImage}`
    );
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});
