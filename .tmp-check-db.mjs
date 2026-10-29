import { PrismaClient } from "@prisma/client";

async function main() {
  const c = new PrismaClient();
  try {
    const rows = await c.$queryRawUnsafe(`SELECT current_database() AS database, current_schema() AS schema`);
    console.log("Connected to:", JSON.stringify(rows[0]));
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    await c.$disconnect();
  }
}

main();
