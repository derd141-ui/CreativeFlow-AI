# CreativeFlow AI — Deployable SaaS

CreativeFlow AI turns messy creative ideas into finished projects. This is the
**deployable SaaS** implementation of the product spec — a real backend,
relational database with row-level security, real authentication, object
storage for assets, and Stripe billing with the **Free / Creator / Pro** plans.

> It replaces the earlier single-file localStorage MVP. The same product loop is
> now served by a real API with per-user, row-level authorization.

```
CAPTURE IDEA → AI builds workflow → tasks → creative memory → next action → finished project
```

---

## Architecture

```
Browser (web/dist SPA)
   │  fetch JSON + pre-signed uploads
   ▼
Express API  (server/src)
   ├─ Auth        (bcrypt password hash + revocable opaque sessions)
   ├─ Projects    (AI blueprint generation, CRUD, tasks, next-action)
   ├─ Library     (ideas, prompts, creative memory, notes)
   ├─ Assets      (pre-signed object-storage uploads)
   ├─ Assistant   (global + project-aware AI chat)
   └─ Billing     (Stripe Checkout + webhooks; mock mode for local dev)
   │
   ├─ PostgreSQL  (relational schema + ROW-LEVEL SECURITY, db/schema.sql, db/rls.sql)
   ├─ Object storage (S3-compatible: AWS S3 / MinIO / R2 — pre-signed uploads)
   └─ AI model router  (engine by default; OpenAI-compatible adapter optional)
```

### The four sample projects (spec §65)
`POST /api/demo/seed` creates **Frozen Wasteland** (video), **Dark Industrial
Track** (music), **Gothic Detective** (character) and **AI Creator YouTube
Channel** (content) with tasks, prompts, creative memory and notes. Demo data
only ever lands in the requesting account.

---

## Requirements

- Node.js ≥ 20
- PostgreSQL 15+ (or Docker)
- For object storage: AWS S3, MinIO, or any S3-compatible provider

## Run it

```bash
# 1. Install
npm run setup

# 2. Infrastructure (Postgres + MinIO) — or point DATABASE_URL at your own DB
npm run db:up
npm run db:migrate      # applies schema.sql + rls.sql

# 3. Configure
cp server/.env.example server/.env
#   - For a quick local demo you can leave S3/Stripe OFF (see below);
#   - set DATABASE_URL to use Postgres.

# 4. Start
npm run dev             # or: npm run build && npm start
# open http://localhost:8080
```

### Quick local demo (no Postgres, no S3, no Stripe)

The server falls back to in-memory storage, disk-backed storage, the
deterministic AI engine, and mock billing automatically when env vars are
unset. Register an account, then:

- **Create a project** → type an idea → “Build with AI” → review → create.
- **Demo data** → Settings → Seed demo projects (also offered at signup).

## Test suite

```
cd server && npm test        # supertest + node:test against the in-memory store
```

The tests assert the security-critical behavior:

- **Row-level authorization** — user B cannot read, list, update, or delete
  user A's projects, tasks, ideas, prompts, memory, or assets (404 / empty).
- **Plan enforcement** — Free plan caps at 3 active projects and 25 AI actions
  per month (402 on exceed).
- **Billing** — checkout URL + plan upgrade via the mock / live webhook path.
- **Object storage** — upload returns a pre-signed URL; cross-owner access is
  denied.
- **AI loop** — blueprint generation, seeded tasks, auto-advancing stages,
  next-action ranking, prompt improvement, assistant history.

## Row-level security (defense in depth)

Authorization is enforced **twice**:

1. **Application layer** — every service method scopes its queries by the
   acting `owner_id`; rows not owned return null/404 (see
   `server/src/store/*` and `server/src/services/*`).
2. **Database layer** — PostgreSQL RLS policies (`server/db/rls.sql`) reject
   any row whose `owner_id` isn't the caller. The app connects as the
   NON-owner role `cf_app`; each request sets the session GUC
   `cf.current_user` inside the same transaction.

## Object storage

Assets upload **directly** to object storage via pre-signed URLs — large files
never transit the API server. The DB stores only metadata
(`server/src/lib/storage.ts`). Swap in MinIO, R2 or S3 by setting the `S3_*`
env vars.

## Billing (Stripe)

- `Free`  — 3 active projects, 25 AI actions/mo
- `Creator` — unlimited projects, 200 AI actions/mo, $9
- `Pro`   — unlimited everything, $19

`server/src/lib/billing.ts` abstracts Stripe behind an interface with a
`MockBilling` for local development (no keys). In production set
`STRIPE_ENABLED=true` and the webhook secret; `POST /api/billing/webhook`
reconciles subscription events into the user's plan.

## AI model router

`server/src/ai/router.ts` routes every AI feature through one interface:
- `AI_PROVIDER=engine` (default) — deterministic offline engine, no key.
- `AI_PROVIDER=openai` + `OPENAI_API_KEY` — real LLM provider.

Add another provider by implementing the `AiProvider` interface.

## Deploying

- Build with `npm run build` → `server/dist` is the entry point.
- Set `NODE_ENV=production`, `DATABASE_URL`, `S3_*`, and `STRIPE_*`.
- Run migrations once, then scale the stateless server horizontally.
- The frontend is served from `server/web/dist`; swap in a CDN/static host and
  point the API at your origin if preferred.

## Project layout

```
server/            TypeScript API (Express)
  src/             config, store (pg+memory), services, routes, ai, middleware, tests
  db/schema.sql    relational schema (users, projects, tasks, ideas, prompts, memory_entries, assets, notes, conversations, messages, ai_usage, templates)
  db/rls.sql       row-level security policies
  .env.example
web/dist/          the SPA (vanilla ES modules; talks to /api)
docker-compose.yml Postgres + MinIO for local dev
```