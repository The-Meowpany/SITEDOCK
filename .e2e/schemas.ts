import { prisma } from "@sitedock/database";

async function main() {
  for (const schema of ["public", "sitedock_test", "verify_1792980128", "verify_1792980335"]) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ services: bigint; deployments: bigint }>>(
        `SELECT (SELECT count(*) FROM "${schema}".services) AS services,
                (SELECT count(*) FROM "${schema}".service_deployments) AS deployments`
      );
      console.log(schema, JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
    } catch (err) {
      console.log(schema, "ERR", (err as Error).message.slice(0, 120));
    }
  }
  await prisma.$disconnect();
}

main();
