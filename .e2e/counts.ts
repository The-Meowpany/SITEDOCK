import { prisma } from "@sitedock/database";

async function main() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "public";
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       (SELECT count(*) FROM "${schema}".users) AS users,
       (SELECT count(*) FROM "${schema}".workspaces) AS workspaces,
       (SELECT count(*) FROM "${schema}".websites) AS websites,
       (SELECT count(*) FROM "${schema}".services) AS services,
       (SELECT count(*) FROM "${schema}".service_deployments) AS service_deployments,
       (SELECT count(*) FROM "${schema}".deployments) AS static_deployments`
  );
  console.log(
    JSON.stringify(rows[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});
