import { defineConfig } from "vitest/config";

/**
 * Smoke tests de contrato HTTP: levantan createApp() en un puerto efímero y
 * ejercitan middleware/seguridad/errores por rutas que NO requieren base de
 * datos. DATABASE_URL es un placeholder válido — PrismaClient se instancia
 * lazy y nunca conecta en estas pruebas.
 */
export default defineConfig({
  test: {
    environment: "node",
    resolve: {
      alias: {
        "@sitedock/github": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/github/src",
        "@sitedock/shared": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/shared/src",
        "@sitedock/auth": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/auth/src",
        "@sitedock/database": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/database/src",
        "@sitedock/deployment": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/deployment/src",
        "@sitedock/notification": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/notification/src",
        "@sitedock/audit": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/audit/src",
        "@sitedock/service": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/service/src",
      },
    },
    env: {
      DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:5432/smoke",
      NODE_ENV: "development",
    },
    testTimeout: 15_000,
    // Workaround for esbuild parsing issues in github-auth.service.ts
    // esbuild: { skipLibCheck: true },
  },
});