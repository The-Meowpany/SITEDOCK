import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance for the whole modular monolith.
// Infrastructure-only: never imported from any `domain` folder.
declare global {
  var __sitedockPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__sitedockPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__sitedockPrisma = prisma;
}

export { Prisma } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";

