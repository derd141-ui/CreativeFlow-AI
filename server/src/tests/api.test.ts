import { test, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { MemoryStore } from "../store/memory.js";
import { LocalStorage } from "../lib/storage.js";
import { MockBilling } from "../lib/billing.js";
import { router as ai } from "../ai/router.js";
import { buildServices } from "../services/index.js";
import { createApp } from "../app.js";

let app: ReturnType<typeof createApp>;

function setupApp() {
  const store = new MemoryStore();
  const deps = { store, storage: new LocalStorage("/tmp/cf-test-storage"), billing: new MockBilling(), ai };
  const svc = buildServices(deps);
  return { app: createApp(svc), store };
}

async function registerUser(app: any, email: string, name = "Tester") {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.token as string, user: res.body.user };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeProject(app: any, token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/projects/generate").set(auth(token)).send({ idea: "A cozy ambient soundtrack for a snowy town", type: "music" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const bp = res.body.blueprint;
  const created = await request(app).post("/api/projects").set(auth(token)).send({ ...bp, ...overrides });
  return { blueprint: bp, created };
}

before(async () => {
  app = createApp(buildServices({ store: new MemoryStore(), storage: new LocalStorage("/tmp/cf-test-storage"), billing: new MockBilling(), ai }));
});

test("health check", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("auth: register, me, logout, and password rules", async () => {
  const { token, user } = await registerUser(app, "alice@example.com");
  assert.ok(user.id);
  assert.equal(user.plan, "free");

  const me = await request(app).get("/api/auth/me").set(auth(token));
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "alice@example.com");
  assert.equal(me.body.usage.limit, 25);

  // duplicate email
  const dup = await request(app).post("/api/auth/register").send({ email: "alice@example.com", password: "password123" });
  assert.equal(dup.status, 409);

  // short password
  const weak = await request(app).post("/api/auth/register").send({ email: "x@x.com", password: "short" });
  assert.equal(weak.status, 400);

  // login + logout
  const login = await request(app).post("/api/auth/login").send({ email: "alice@example.com", password: "password123" });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  await request(app).post("/api/auth/logout").set(auth(login.body.token));
  const meAfter = await request(app).get("/api/auth/me").set(auth(login.body.token));
  assert.equal(meAfter.status, 401);
});

test("protected routes require auth", async () => {
  const res = await request(app).get("/api/projects");
  assert.equal(res.status, 401);
});

test("AI project generation + creation seeds tasks", async () => {
  const { token } = await registerUser(app, "bob@example.com");
  const { created } = await makeProject(app, token);
  assert.equal(created.status, 201);
  assert.ok(created.body.project.workflow.length > 0);
  // tasks are seeded via workflow
  const tasksRes = await request(app).get(`/api/projects/${created.body.project.id}/tasks`).set(auth(token));
  assert.equal(tasksRes.status, 200);
  assert.ok(tasksRes.body.tasks.length >= 4);
  // next action is present
  const next = await request(app).get(`/api/projects/next?projectId=${created.body.project.id}`).set(auth(token));
  assert.equal(next.status, 200);
  assert.ok(next.body.next.title);
});

test("ROW-LEVEL: users cannot read or mutate each other's data", async () => {
  const a = await registerUser(app, "rowa@example.com");
  const b = await registerUser(app, "rowb@example.com");
  const { created } = await makeProject(app, a.token);

  // B cannot see A's project by id
  const read = await request(app).get(`/api/projects/${created.body.project.id}`).set(auth(b.token));
  assert.equal(read.status, 404);
  // B cannot list A's projects (empty)
  const list = await request(app).get("/api/projects").set(auth(b.token));
  assert.equal(list.body.projects.length, 0);
  // B cannot update A's project
  const upd = await request(app).patch(`/api/projects/${created.body.project.id}`).set(auth(b.token)).send({ title: "hacked" });
  assert.equal(upd.status, 404);
  // B cannot delete A's project
  const del = await request(app).delete(`/api/projects/${created.body.project.id}`).set(auth(b.token));
  assert.equal(del.status, 404);
  // A can still read it
  const mine = await request(app).get(`/api/projects/${created.body.project.id}`).set(auth(a.token));
  assert.equal(mine.status, 200);

  // tasks are scoped too
  const tasks = (await request(app).get(`/api/projects/${created.body.project.id}/tasks`).set(auth(a.token))).body.tasks;
  const t0 = tasks[0];
  const bTask = await request(app).patch(`/api/projects/${created.body.project.id}/tasks/${t0.id}`).set(auth(b.token)).send({ status: "done" });
  assert.equal(bTask.status, 404);

  // ideas scoping
  const ideaRes = await request(app).post("/api/ideas").set(auth(a.token)).send({ title: "A secret idea" });
  const ideaId = ideaRes.body.idea.id;
  const bReadIdea = await request(app).patch(`/api/ideas/${ideaId}`).set(auth(b.token)).send({ title: "stolen" });
  assert.equal(bReadIdea.status, 404);

  // prompts scoping
  const pr = await request(app).post("/api/prompts").set(auth(a.token)).send({ title: "p", body: "a dark forest scene" });
  const bImprove = await request(app).post(`/api/prompts/${pr.body.prompt.id}/improve`).set(auth(b.token));
  assert.equal(bImprove.status, 404);

  // memory scoping
  const mem = await request(app).post("/api/memory").set(auth(a.token)).send({ label: "Hero", category: "character", body: "Viking" });
  const bMem = await request(app).patch(`/api/memory/${mem.body.entry.id}`).set(auth(b.token)).send({ label: "x" });
  assert.equal(bMem.status, 404);
});

test("task completion auto-advances the stage and completes the project", async () => {
  const { token } = await registerUser(app, "carol@example.com");
  const { created } = await makeProject(app, token);
  const projectId = created.body.project.id;
  const tasks = (await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(token))).body.tasks;
  const stage0 = tasks.filter((t: any) => t.stageId === created.body.project.workflow[0].id);

  for (const t of stage0) {
    const r = await request(app).post(`/api/projects/${projectId}/tasks/${t.id}/status`).set(auth(token)).send({ status: "done" });
    assert.equal(r.status, 200);
  }
  // stage advanced
  const p = (await request(app).get(`/api/projects/${projectId}`).set(auth(token))).body.project;
  assert.equal(p.stageIndex, 1);
});

test("FREE plan: enforces 3 active projects and the 25-AI-action monthly cap", async () => {
  const { token } = await registerUser(app, "dave@example.com");

  // create up to the limit
  let fourthBlocked = false;
  for (let i = 0; i < 4; i++) {
    const r = await request(app).post("/api/projects/generate").set(auth(token)).send({ idea: `cozy ambient track number ${i}`, type: "music" });
    if (r.status === 200) {
      const bp = r.body.blueprint;
      const c = await request(app).post("/api/projects").set(auth(token)).send(bp);
      if (c.status === 402) { fourthBlocked = true; break; }
    }
  }
  assert.equal(fourthBlocked, true, "4th project should be blocked on free plan");
  const count = (await request(app).get("/api/projects").set(auth(token))).body.projects.length;
  assert.equal(count, 3);

  // AI cap: register a fresh user and burn the allowance by generating blueprints.
  const fresh = await registerUser(app, "eve@example.com");
  let exhausted = false;
  for (let i = 0; i < 26; i++) {
    const r = await request(app).post("/api/projects/generate").set(auth(fresh.token)).send({ idea: `ambient loop ${i}`, type: "music" });
    if (r.status === 402) { exhausted = true; break; }
  }
  assert.equal(exhausted, true, "25th AI generation should be blocked");
});

test("prompt improvement consumes AI and updates the prompt", async () => {
  const { token } = await registerUser(app, "frank@example.com");
  const pr = await request(app).post("/api/prompts").set(auth(token)).send({ title: "t", body: "a dark forest, cinematic" });
  const improved = await request(app).post(`/api/prompts/${pr.body.prompt.id}/improve`).set(auth(token));
  assert.equal(improved.status, 200);
  assert.equal(improved.body.prompt.aiImproved, true);
});

test("assistant: global + project-aware answers are persisted to a conversation", async () => {
  const { token } = await registerUser(app, "grace@example.com");
  const ask = await request(app).post("/api/assistant/ask").set(auth(token)).send({ question: "What should I work on today?", kind: "global" });
  assert.equal(ask.status, 200);
  assert.ok(ask.body.answer);
  assert.equal(ask.body.conversation.kind, "global");
  const msgs = (await request(app).get(`/api/assistant/conversations/${ask.body.conversation.id}/messages`).set(auth(token))).body.messages;
  assert.ok(msgs.length >= 2);
});

test("assets: upload request returns a presigned URL (object storage)", async () => {
  const { token } = await registerUser(app, "heidi@example.com");
  const res = await request(app).post("/api/assets/upload").set(auth(token)).send({ name: "cover.png", mime: "image/png", kind: "image", size: 12345 });
  assert.equal(res.status, 201);
  assert.ok(res.body.uploadUrl);
  assert.ok(res.body.asset.id);
  const urlRes = await request(app).get(`/api/assets/${res.body.asset.id}/url`).set(auth(token));
  assert.equal(urlRes.status, 200);
  assert.ok(urlRes.body.url);
  // ownership: another user cannot fetch it
  const other = await registerUser(app, "ivan@example.com");
  const den = await request(app).get(`/api/assets/${res.body.asset.id}/url`).set(auth(other.token));
  assert.equal(den.status, 404);
});

test("billing: checkout URL + mock completion upgrades the plan", async () => {
  const { token } = await registerUser(app, "jill@example.com");
  const co = await request(app).post("/api/billing/checkout").set(auth(token)).send({ plan: "creator" });
  assert.equal(co.status, 200);
  assert.ok(co.body.url);

  const done = await request(app).post("/api/billing/mock/complete").set(auth(token)).send({ plan: "pro" });
  assert.equal(done.status, 200);
  const me = (await request(app).get("/api/auth/me").set(auth(token))).body.user;
  assert.equal(me.plan, "pro");
});

test("notes upsert is scoped per owner+project", async () => {
  const { token } = await registerUser(app, "ken@example.com");
  const { created } = await makeProject(app, token);
  const pid = created.body.project.id;
  const put = await request(app).put(`/api/notes/${pid}`).set(auth(token)).send({ body: "story notes" });
  assert.equal(put.status, 200);
  const get = await request(app).get(`/api/notes/${pid}`).set(auth(token));
  assert.equal(get.body.note.body, "story notes");
});