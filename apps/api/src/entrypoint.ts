#!/usr/bin/env node
// Entrypoint de la API: corre migraciones antes de arrancar el servidor.
import { execSync } from "child_process";
import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 4000;

// 1. Ejecutar migraciones de Prisma (idempotente, seguro en cada arranque)
try {
  console.log("[api] Ejecutando migraciones de base de datos...");
  execSync("npx prisma migrate deploy --schema packages/database/schema.prisma", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  console.log("[api] Migraciones aplicadas.");
} catch (err) {
  console.error("[api] Error ejecutando migraciones:", err);
  process.exit(1);
}

// 2. Generar cliente de Prisma si no existe
try {
  execSync("npx prisma generate --schema packages/database/schema.prisma", {
    stdio: "inherit",
  });
} catch (err) {
  console.error("[api] Error generando cliente Prisma:", err);
  process.exit(1);
}

// 3. Arrancar el servidor
const app = createApp();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[api] Escuchando en http://0.0.0.0:${PORT}`);
});
