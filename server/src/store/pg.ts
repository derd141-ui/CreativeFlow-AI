import pg from "pg";
import type {
  AiUsage, Asset, Conversation, Idea, MemoryEntry, Message, Note, Project,
  Prompt, SessionRow, Task, Template, User,
} from "../lib/types.js";
import { uuid } from "../lib/tokens.js";
import type {
  AssetPatch, IdeaPatch, MemoryPatch, NewAiUsage, NewAsset, NewProject, NewSession, NewTask,
  ProjectPatch, PromptPatch, Store, TaskPatch, UserPatch,
} from "./store.js";

const { Pool } = pg;

/**
 * Postgres Store backed by a real connection pool.
 *
 * Row-level authorization:
 *   - SQL is written to ALWAYS filter by owner_id / user_id.
 *   - On top of that, each request sets the session GUC `cf.current_user` and
 *     the RLS policies in db/rls.sql reject any row that isn't owned by the
 *     caller. The app connects as the NON-owner role `cf_app`.
 *
 * To guarantee RLS runs in the same transaction as the user's statement, each
 * operation acquires a dedicated client, sets the GUC, runs in a transaction,
 * and releases the client — so `current_setting` is always visible.
 */
export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new Pool({ connectionString, max });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Run `fn` scoped to a user: sets cf.current_user and runs in a transaction. */
  private async run<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('cf.current_user', $1, true)", [userId]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- mappers -------------------------------------------------------------
  private u(row: any): User { return row && { id: row.id, email: row.email, emailNormalized: row.email_normalized, name: row.name, plan: row.plan, planStatus: row.plan_status, stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id, aiUsedMonth: row.ai_used_month, aiResetMonth: row.ai_reset_month, onboardingDone: row.onboarding_done, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private s(row: any): SessionRow { return row && { id: row.id, userId: row.user_id, tokenHash: row.token_hash, userAgent: row.user_agent, ip: row.ip, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at }; }
  private p(row: any): Project { return row && { id: row.id, ownerId: row.owner_id, title: row.title, type: row.type, summary: row.summary, goal: row.goal, direction: row.direction, stage: row.stage, stageIndex: row.stage_index, stageCount: row.stage_count, status: row.status, progress: row.progress, finishedAt: row.finished_at, workflow: row.workflow ?? [], creativeDirection: row.creative_direction ?? {}, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private t(row: any): Task { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, stageId: row.stage_id, title: row.title, status: row.status, priority: row.priority, weight: row.weight, sortOrder: row.sort_order, dependsOn: (row.depends_on ?? "").split(",").filter(Boolean), dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private i(row: any): Idea { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, title: row.title, body: row.body, type: row.type, status: row.status, tags: row.tags ?? [], createdAt: row.created_at }; }
  private pr(row: any): Prompt { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, title: row.title, body: row.body, category: row.category, tags: row.tags ?? [], aiImproved: row.ai_improved, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private m(row: any): MemoryEntry { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, category: row.category, label: row.label, body: row.body, tags: row.tags ?? [], source: row.source, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private a(row: any): Asset { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, name: row.name, kind: row.kind, mime: row.mime, size: Number(row.size ?? 0), bucketKey: row.bucket_key, sha: row.sha, tags: row.tags ?? [], createdAt: row.created_at }; }
  private n(row: any): Note { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, body: row.body, updatedAt: row.updated_at }; }
  private c(row: any): Conversation { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, title: row.title, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private msg(row: any): Message { return row && { id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, createdAt: row.created_at }; }
  private au(row: any): AiUsage { return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, action: row.action, month: row.month, tokens: row.tokens, createdAt: row.created_at }; }

  // Users ---------------------------------------------------------------
  async createUser(d: { email: string; emailNormalized: string; passwordHash: string; name: string }): Promise<User> {
    const id = uuid();
    const r = await this.pool.query(
      `insert into users (id,email,email_normalized,password_hash,name) values ($1,$2,$3,$4,$5) returning *`,
      [id, d.email, d.emailNormalized, d.passwordHash, d.name],
    );
    return this.u(r.rows[0]);
  }
  async getUserById(id: string): Promise<User | null> {
    const r = await this.pool.query(`select * from users where id=$1`, [id]);
    return this.u(r.rows[0]);
  }
  async getUserByEmailNormalized(n: string): Promise<User | null> {
    const r = await this.pool.query(`select * from users where email_normalized=$1`, [n]);
    return this.u(r.rows[0]);
  }
  async getUserByStripeCustomer(customerId: string): Promise<User | null> {
    const r = await this.pool.query(`select * from users where stripe_customer_id=$1`, [customerId]);
    return this.u(r.rows[0]);
  }
  async updateUser(id: string, patch: UserPatch): Promise<User | null> {
    const sets: string[] = []; const args: unknown[] = []; let i = 1;
    const map: Record<string, string> = { name: "name", plan: "plan", planStatus: "plan_status", stripeCustomerId: "stripe_customer_id", stripeSubscriptionId: "stripe_subscription_id", aiUsedMonth: "ai_used_month", aiResetMonth: "ai_reset_month", onboardingDone: "onboarding_done" };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const col = map[k]; if (!col) continue;
      sets.push(`${col} = $${i++}`); args.push(v);
    }
    if (!sets.length) return this.getUserById(id);
    sets.push("updated_at = now()");
    const r = await this.pool.query(`update users set ${sets.join(",")} where id=$${i} returning *`, [...args, id]);
    return this.u(r.rows[0]);
  }
  async activeProjectCount(ownerId: string): Promise<number> {
    const r = await this.pool.query(`select count(*)::int as c from projects where owner_id=$1 and status='active'`, [ownerId]);
    return r.rows[0].c;
  }

  // Sessions ------------------------------------------------------------
  async createSession(input: NewSession): Promise<SessionRow> {
    const id = uuid();
    const r = await this.pool.query(
      `insert into sessions (id,user_id,token_hash,user_agent,ip,expires_at) values ($1,$2,$3,$4,$5,$6) returning *`,
      [id, input.userId, input.tokenHash, input.userAgent ?? null, input.ip ?? null, input.expiresAt],
    );
    return this.s(r.rows[0]);
  }
  async getSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const r = await this.pool.query(`select * from sessions where token_hash=$1 and revoked_at is null and expires_at > now()`, [hash]);
    return this.s(r.rows[0]);
  }
  async deleteSession(id: string): Promise<void> {
    await this.pool.query(`update sessions set revoked_at=now() where id=$1`, [id]);
  }
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.pool.query(`update sessions set revoked_at=now() where user_id=$1`, [userId]);
  }
  async cleanupExpiredSessions(now: Date): Promise<void> {
    await this.pool.query(`delete from sessions where expires_at < $1`, [now]);
  }

  // Projects -----------------------------------------------------------------
  async createProject(input: NewProject): Promise<Project> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(
        `insert into projects (id,owner_id,title,type,summary,goal,direction,stage_count,workflow,creative_direction)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) returning *`,
        [id, input.ownerId, input.title, input.type, input.summary, input.goal, input.direction, input.workflow.length, JSON.stringify(input.workflow), JSON.stringify(input.creativeDirection ?? {})],
      );
      return this.p(r.rows[0]);
    });
  }
  async getProject(ownerId: string, projectId: string): Promise<Project | null> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`select * from projects where id=$1 and owner_id=$2`, [projectId, ownerId]);
      return this.p(r.rows[0]);
    });
  }
  async listProjects(ownerId: string): Promise<Project[]> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`select * from projects where owner_id=$1 order by created_at asc`, [ownerId]);
      return r.rows.map(this.p);
    });
  }
  async updateProject(ownerId: string, projectId: string, patch: ProjectPatch): Promise<Project | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { title: "title", summary: "summary", goal: "goal", direction: "direction", stage: "stage", stageIndex: "stage_index", stageCount: "stage_count", status: "status", progress: "progress", finishedAt: "finished_at", workflow: "workflow", creativeDirection: "creative_direction" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        const col = map[k]; if (!col) continue;
        if (k === "workflow") { sets.push(`workflow=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        if (k === "creativeDirection") { sets.push(`creative_direction=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return this.p((await c.query(`select * from projects where id=$1 and owner_id=$2`, [projectId, ownerId])).rows[0]);
      sets.push("updated_at = now()");
      const r = await c.query(`update projects set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, projectId, ownerId]);
      return this.p(r.rows[0]);
    });
  }
  async deleteProject(ownerId: string, projectId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`delete from projects where id=$1 and owner_id=$2 returning id`, [projectId, ownerId]);
      return r.rowCount === 1;
    });
  }

  // Tasks ------------------------------------------------------------------
  async createTask(input: NewTask): Promise<Task> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(
        `insert into tasks (id,owner_id,project_id,stage_id,title,priority,weight,sort_order,depends_on,due_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [id, input.ownerId, input.projectId, input.stageId, input.title, input.priority, input.weight, input.sortOrder, input.dependsOn.join(","), input.dueDate],
      );
      return this.t(r.rows[0]);
    });
  }
  async getTask(ownerId: string, taskId: string): Promise<Task | null> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`select * from tasks where id=$1 and owner_id=$2`, [taskId, ownerId]);
      return this.t(r.rows[0]);
    });
  }
  async listTasksByProject(ownerId: string, projectId: string): Promise<Task[]> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`select * from tasks where owner_id=$1 and project_id=$2 order by sort_order asc, created_at asc`, [ownerId, projectId]);
      return r.rows.map(this.t);
    });
  }
  async updateTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<Task | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { stageId: "stage_id", title: "title", status: "status", priority: "priority", weight: "weight", sortOrder: "sort_order", dependsOn: "depends_on", dueDate: "due_date" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue; const col = map[k]; if (!col) continue;
        if (k === "dependsOn") { sets.push(`depends_on=$${i++}`); args.push((v as string[]).join(",")); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return this.getTask(ownerId, taskId);
      sets.push("updated_at = now()");
      const r = await c.query(`update tasks set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, taskId, ownerId]);
      return this.t(r.rows[0]);
    });
  }
  async deleteTask(ownerId: string, taskId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(`delete from tasks where id=$1 and owner_id=$2 returning id`, [taskId, ownerId]);
      return r.rowCount === 1;
    });
  }

  // Ideas ----------------------------------------------------------------
  async createIdea(input: Omit<Idea, "id" | "createdAt">): Promise<Idea> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into ideas (id,owner_id,project_id,title,body,type,status,tags) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning *`,
        [id, input.ownerId, input.projectId, input.title, input.body, input.type, input.status, JSON.stringify(input.tags ?? [])]);
      return this.i(r.rows[0]);
    });
  }
  async getIdea(ownerId: string, ideaId: string): Promise<Idea | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from ideas where id=$1 and owner_id=$2`, [ideaId, ownerId]); return this.i(r.rows[0]); });
  }
  async listIdeas(ownerId: string): Promise<Idea[]> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from ideas where owner_id=$1 order by created_at desc`, [ownerId]); return r.rows.map(this.i); });
  }
  async updateIdea(ownerId: string, ideaId: string, patch: IdeaPatch): Promise<Idea | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { title: "title", body: "body", type: "type", status: "status", projectId: "project_id" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue; const col = map[k]; if (!col) continue;
        if (k === "tags") { sets.push(`tags=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return (await this.getIdea(ownerId, ideaId));
      const r = await c.query(`update ideas set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, ideaId, ownerId]);
      return this.i(r.rows[0]);
    });
  }
  async deleteIdea(ownerId: string, ideaId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => { const r = await c.query(`delete from ideas where id=$1 and owner_id=$2 returning id`, [ideaId, ownerId]); return r.rowCount === 1; });
  }

  // Prompts --------------------------------------------------------------
  async createPrompt(input: Omit<Prompt, "id" | "createdAt" | "updatedAt">): Promise<Prompt> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into prompts (id,owner_id,project_id,title,body,category,tags,ai_improved) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) returning *`,
        [id, input.ownerId, input.projectId, input.title, input.body, input.category, JSON.stringify(input.tags ?? []), input.aiImproved ?? false]);
      return this.pr(r.rows[0]);
    });
  }
  async getPrompt(ownerId: string, promptId: string): Promise<Prompt | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from prompts where id=$1 and owner_id=$2`, [promptId, ownerId]); return this.pr(r.rows[0]); });
  }
  async listPrompts(ownerId: string): Promise<Prompt[]> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from prompts where owner_id=$1 order by created_at desc`, [ownerId]); return r.rows.map(this.pr); });
  }
  async updatePrompt(ownerId: string, promptId: string, patch: PromptPatch): Promise<Prompt | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { title: "title", body: "body", category: "category", aiImproved: "ai_improved" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue; const col = map[k]; if (!col) continue;
        if (k === "tags") { sets.push(`tags=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return (await this.getPrompt(ownerId, promptId));
      sets.push("updated_at = now()");
      const r = await c.query(`update prompts set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, promptId, ownerId]);
      return this.pr(r.rows[0]);
    });
  }
  async deletePrompt(ownerId: string, promptId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => { const r = await c.query(`delete from prompts where id=$1 and owner_id=$2 returning id`, [promptId, ownerId]); return r.rowCount === 1; });
  }

  // Memory -----------------------------------------------------------------
  async createMemory(input: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into memory_entries (id,owner_id,project_id,category,label,body,tags,source) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) returning *`,
        [id, input.ownerId, input.projectId, input.category, input.label, input.body, JSON.stringify(input.tags ?? []), input.source]);
      return this.m(r.rows[0]);
    });
  }
  async getMemory(ownerId: string, memoryId: string): Promise<MemoryEntry | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from memory_entries where id=$1 and owner_id=$2`, [memoryId, ownerId]); return this.m(r.rows[0]); });
  }
  async listMemory(ownerId: string, projectId?: string): Promise<MemoryEntry[]> {
    return this.run(ownerId, async (c) => {
      const r = projectId
        ? await c.query(`select * from memory_entries where owner_id=$1 and project_id=$2 order by created_at desc`, [ownerId, projectId])
        : await c.query(`select * from memory_entries where owner_id=$1 order by created_at desc`, [ownerId]);
      return r.rows.map(this.m);
    });
  }
  async updateMemory(ownerId: string, memoryId: string, patch: MemoryPatch): Promise<MemoryEntry | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { category: "category", label: "label", body: "body" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue; const col = map[k]; if (!col) continue;
        if (k === "tags") { sets.push(`tags=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return (await this.getMemory(ownerId, memoryId));
      sets.push("updated_at = now()");
      const r = await c.query(`update memory_entries set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, memoryId, ownerId]);
      return this.m(r.rows[0]);
    });
  }
  async deleteMemory(ownerId: string, memoryId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => { const r = await c.query(`delete from memory_entries where id=$1 and owner_id=$2 returning id`, [memoryId, ownerId]); return r.rowCount === 1; });
  }

  // Notes --------------------------------------------------------------------
  async getNote(ownerId: string, projectId: string): Promise<Note | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from notes where owner_id=$1 and project_id=$2`, [ownerId, projectId]); return this.n(r.rows[0]); });
  }
  async upsertNote(ownerId: string, projectId: string, body: string): Promise<Note> {
    return this.run(ownerId, async (c) => {
      const r = await c.query(
        `insert into notes (owner_id,project_id,body) values ($1,$2,$3)
         on conflict on constraint notes_owner_project_key do update set body=excluded.body, updated_at=now()
         returning *`, [ownerId, projectId, body]);
      return this.n(r.rows[0]);
    });
  }

  // Conversations ---------------------------------------------------------------------
  async createConversation(x: { ownerId: string; projectId: string | null; title: string; kind: string }): Promise<Conversation> {
    return this.run(x.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into conversations (id,owner_id,project_id,title,kind) values ($1,$2,$3,$4,$5) returning *`, [id, x.ownerId, x.projectId, x.title, x.kind]);
      return this.c(r.rows[0]);
    });
  }
  async listConversations(ownerId: string, projectId?: string): Promise<Conversation[]> {
    return this.run(ownerId, async (c) => {
      const r = projectId
        ? await c.query(`select * from conversations where owner_id=$1 and project_id=$2 order by updated_at desc`, [ownerId, projectId])
        : await c.query(`select * from conversations where owner_id=$1 order by updated_at desc`, [ownerId]);
      return r.rows.map(this.c);
    });
  }
  async getConversation(ownerId: string, conversationId: string): Promise<Conversation | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from conversations where id=$1 and owner_id=$2`, [conversationId, ownerId]); return this.c(r.rows[0]); });
  }
  async appendMessage(ownerId: string, conversationId: string, role: Message["role"], content: string): Promise<Message> {
    return this.run(ownerId, async (c) => {
      const conv = await c.query(`select id from conversations where id=$1 and owner_id=$2`, [conversationId, ownerId]);
      if (conv.rowCount !== 1) return null as unknown as Message;
      const r = await c.query(
        `with ins as (insert into messages (conversation_id,role,content) values ($1,$2,$3) returning *)
         update conversations set updated_at=now() where id=$1 and owner_id=$2
         select * from ins`,
        [conversationId, role, content, ownerId]);
      return this.msg(r.rows[0]);
    });
  }
  async listMessages(ownerId: string, conversationId: string): Promise<Message[]> {
    return this.run(ownerId, async (c) => {
      const conv = await c.query(`select id from conversations where id=$1 and owner_id=$2`, [conversationId, ownerId]);
      if (conv.rowCount !== 1) return [];
      const r = await c.query(`select * from messages where conversation_id=$1 order by created_at asc`, [conversationId]);
      return r.rows.map(this.msg);
    });
  }

  // Assets ------------------------------------------------------------------
  async createAsset(input: NewAsset): Promise<Asset> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into assets (id,owner_id,project_id,name,kind,mime,size,bucket_key,sha,tags) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning *`,
        [id, input.ownerId, input.projectId, input.name, input.kind, input.mime, input.size, input.bucketKey, input.sha, JSON.stringify(input.tags ?? [])]);
      return this.a(r.rows[0]);
    });
  }
  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    return this.run(ownerId, async (c) => { const r = await c.query(`select * from assets where id=$1 and owner_id=$2`, [assetId, ownerId]); return this.a(r.rows[0]); });
  }
  async listAssets(ownerId: string, projectId?: string): Promise<Asset[]> {
    return this.run(ownerId, async (c) => {
      const r = projectId
        ? await c.query(`select * from assets where owner_id=$1 and project_id=$2 order by created_at desc`, [ownerId, projectId])
        : await c.query(`select * from assets where owner_id=$1 order by created_at desc`, [ownerId]);
      return r.rows.map(this.a);
    });
  }
  async updateAsset(ownerId: string, assetId: string, patch: AssetPatch): Promise<Asset | null> {
    return this.run(ownerId, async (c) => {
      const map: Record<string, string> = { name: "name" };
      const sets: string[] = []; const args: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue; const col = map[k]; if (!col) continue;
        if (k === "tags") { sets.push(`tags=$${i++}::jsonb`); args.push(JSON.stringify(v)); continue; }
        sets.push(`${col}=$${i++}`); args.push(v);
      }
      if (!sets.length) return (await this.getAsset(ownerId, assetId));
      const r = await c.query(`update assets set ${sets.join(",")} where id=$${i} and owner_id=$${i + 1} returning *`, [...args, assetId, ownerId]);
      return this.a(r.rows[0]);
    });
  }
  async deleteAsset(ownerId: string, assetId: string): Promise<boolean> {
    return this.run(ownerId, async (c) => { const r = await c.query(`delete from assets where id=$1 and owner_id=$2 returning id`, [assetId, ownerId]); return r.rowCount === 1; });
  }

  // AI usage -----------------------------------------------------------------
  async recordAiUsage(input: NewAiUsage): Promise<AiUsage> {
    return this.run(input.ownerId, async (c) => {
      const id = uuid();
      const r = await c.query(`insert into ai_usage (id,owner_id,project_id,action,month,tokens) values ($1,$2,$3,$4,$5,$6) returning *`,
        [id, input.ownerId, input.projectId, input.action, input.month, input.tokens]);
      return this.au(r.rows[0]);
    });
  }
  async countAiUsage(ownerId: string, month: number): Promise<number> {
    const r = await this.pool.query(`select count(*)::int as c from ai_usage where owner_id=$1 and month=$2`, [ownerId, month]);
    return r.rows[0].c;
  }

  // Templates --------------------------------------------------------------------
  async createTemplate(input: Omit<Template, "id" | "createdAt">): Promise<Template> {
    return this.run(input.ownerId ?? "00000000-0000-0000-0000-000000000000", async (c) => {
      const id = uuid();
      const r = await c.query(`insert into templates (id,owner_id,name,type,workflow,scope) values ($1,$2,$3,$4,$5::jsonb,$6) returning *`,
        [id, input.ownerId, input.name, input.type, JSON.stringify(input.workflow), input.scope]);
      return { ...(r.rows[0]), workflow: r.rows[0].workflow ?? [] } as Template;
    });
  }
  async listTemplates(ownerId: string): Promise<Template[]> {
    const r = await this.pool.query(`select * from templates where owner_id=$1 or owner_id is null`, [ownerId]);
    return r.rows.map((x) => ({ ...x, workflow: x.workflow ?? [] }) as Template);
  }
}