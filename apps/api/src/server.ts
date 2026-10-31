import { createApp } from "./app";
import { config, validateProductionConfig } from "./config";
import { logger } from "./logger";

const errors = validateProductionConfig(process.env, config.isProduction);
if (errors.length > 0) {
  // Phase 19 §7 — fail closed: production with a requested provider
  // configuration that is incomplete does NOT start with silent mocks.
  for (const e of errors) logger.fatal({ configError: e }, "Invalid production configuration");
  process.exit(1);
}

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, "SiteDock API listening");
});
