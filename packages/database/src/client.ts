import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance for the whole modular monolith.// Infrastructure-only: never imported from any `domain` folder.
declare global {
  var __sitedockPrisma: PrismaClient | undefined;
}
// Ensure Prisma Client is initialized on first import.// This prevents "Prisma Client did not initialize yet" errors in test environments.
export const prisma = (() => {
  if (globalThis.__sitedockPrisma) {
    return globalThis.__sitedockPrisma;
  }
  const client = new PrismaClient();
  // Initialize with a simple query to avoid "did not initialize yet" error.
  // We don't await this because the client is lazy-connected.
  client.$queryRawUnsafe("SELECT 1").catch(() => {
    // Ignore initialization errors - the client will still work.  });
  globalThis.__sitedockPrisma = client;
  return client;
})();

if (process.env.NODE_ENV !== "production") {
  // Ensure the global is set even if prisma was already accessed.
  if (!globalThis.__sitedockPrisma) {
    globalThis.__sitedockPrisma = prisma;
  }
}

export { Prisma } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";


