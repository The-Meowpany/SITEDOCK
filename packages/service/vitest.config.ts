import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    resolve: {
      alias: {
        "@sitedock/database": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/database/src",
        "@sitedock/shared": "/c/Users/filip/OneDrive/Documentos/SiteDock/packages/shared/src",
      },
    },
    env: {
      DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:5432/smoke",
      NODE_ENV: "development",
    },
    testTimeout: 15_000,
  },
});