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
    env: {
      DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:5432/smoke",
      NODE_ENV: "development",
    },
    testTimeout: 15_000,
  },
});
