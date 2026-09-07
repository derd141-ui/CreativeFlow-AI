import dotenv from "dotenv";
dotenv.config();

function int(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(v: string | undefined, d = false): boolean {
  if (v == null) return d;
  return v === "1" || v === "true" || v === "TRUE";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: int(process.env.PORT, 8080),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:8080",

  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseOwnerUrl: process.env.DATABASE_OWNER_URL ?? "",

  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 30),
  appSecret: process.env.APP_SECRET ?? "dev-only-secret",

  s3: {
    enabled: bool(process.env.S3_DISABLED) === false && !!process.env.S3_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "creativeflow-assets",
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    localDir: process.env.STORAGE_LOCAL_DIR ?? "./storage",
  },

  stripe: {
    enabled: bool(process.env.STRIPE_ENABLED),
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      free: process.env.STRIPE_PRICE_FREE ?? "price_free",
      creator: process.env.STRIPE_PRICE_CREATOR ?? "price_creator",
      pro: process.env.STRIPE_PRICE_PRO ?? "price_pro",
    },
    successUrl: process.env.STRIPE_SUCCESS_URL ?? "http://localhost:8080/app/billing",
    cancelUrl: process.env.STRIPE_CANCEL_URL ?? "http://localhost:8080/app/billing",
  },

  ai: {
    provider: process.env.AI_PROVIDER ?? "engine",
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@creativeflow.ai",
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "change-me-admin-password",
    demoAccount: bool(process.env.SEED_DEMO_ACCOUNT),
  },
} as const;

export type Config = typeof config;