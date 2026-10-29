import { prisma } from "@sitedock/database";

async function main() {
  const deployments = await prisma.serviceDeployment.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, serviceId: true, version: true, status: true, attempts: true, maxAttempts: true, nextRetryAt: true, imageId: true },
  });
  console.log("DEPLOYMENTS " + JSON.stringify(deployments, null, 2));

  for (const d of deployments) {
    const logs = await prisma.serviceDeploymentLog.findMany({ where: { deploymentId: d.id }, orderBy: { timestamp: "asc" } });
    console.log(`LOGS[${d.version}] ` + JSON.stringify(logs.map((l) => ({ level: l.level, message: l.message, metadata: l.metadata })), null, 2));
  }

  const services = await prisma.service.findMany({
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, name: true, status: true, port: true, sourceType: true, dockerfile: true, contextFiles: true, activeDeploymentId: true },
  });
  console.log("SERVICES " + JSON.stringify(services, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});
