import { config } from "./config.js";
import { MemoryStore } from "./store/memory.js";
import { PgStore } from "./store/pg.js";
import { makeStorage } from "./lib/storage.js";
import { makeBilling } from "./lib/billing.js";
import { router as ai } from "./ai/router.js";
import { buildServices } from "./services/index.js";
import { createApp } from "./app.js";

async function main() {
  // In production a real database is required (never silently fall back to the
  // in-memory store, which does not survive restarts or scale).
  if (config.env === "production" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production.");
  }
  // Choose the store: Postgres when a DATABASE_URL is set (production),
  // otherwise the in-memory store (local dev / quick start).
  const store = config.databaseUrl ? new PgStore(config.databaseUrl) : new MemoryStore();
  const deps = { store, storage: makeStorage(), billing: makeBilling(), ai };
  const svc = buildServices(deps);
  const app = createApp(svc);

  app.listen(config.port, () => {
    console.log(`[creativeflow] listening on http://localhost:${config.port} (env=${config.env}, ai=${config.ai.provider}, storage=${config.s3.enabled ? "s3" : "local"})`);
  });

  const shutdown = async () => {
    if (store instanceof PgStore) await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });