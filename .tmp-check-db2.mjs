import { PrismaClient } from "@prisma/client";

async function main() {
  const c = new PrismaClient();
  try {
    const rows = await c.$queryRawUnsafe(`SELECT current_database() AS database, current_user AS user`);
    console.log("Connected to:", JSON.stringify(rows[0]));
    // Check if we can create databases
    const cr = await c.$queryRawUnsafe(`SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user`);
    console.log("Can create DB:", JSON.stringify(cr[0]));
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    await c.$disconnect();
  }
}

main();
