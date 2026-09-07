import type {
  AiUsage, Asset, Conversation, Idea, MemoryEntry, Message, Note, Project,
  Prompt, SessionRow, Task, Template, User,
} from "../lib/types.js";
import { uuid } from "../lib/tokens.js";
import type {
  AssetPatch, IdeaPatch, MemoryPatch, NewAiUsage, NewAsset, NewProject, NewSession, NewTask,
  ProjectPatch, PromptPatch, Store, TaskPatch, UserPatch,
} from "./store.js";

/**
 * In-memory Store. Enforces the SAME row-level ownership rules as the
 * Postgres store (methods return null/empty for rows not owned by the actor).
 * Used for automated tests and local dev without a database.
 */
export class MemoryStore implements Store {
  users: Record<string, User> = {};
  sessions: Record<string, SessionRow> = {};
  projects: Record<string, Project> = {};
  tasks: Record<string, Task> = {};
  ideas: Record<string, Idea> = {};
  prompts: Record<string, Prompt> = {};
  memory: Record<string, MemoryEntry> = {};
  notes: Record<string, Note> = {};
  conversations: Record<string, Conversation> = {};
  messages: Record<string, Message> = {};
  assets: Record<string, Asset> = {};
  aiUsage: Record<string, AiUsage> = {};
  templates: Record<string, Template> = {};

  private gen(prefix: string): string {
    return `${prefix}_${uuid()}`;
  }

  // Users -------------------------------------------------------------
  async createUser(d: { email: string; emailNormalized: string; passwordHash: string; name: string }): Promise<User> {
    const u: User = {
      id: this.gen("usr"), ...d, plan: "free", planStatus: "active",
      stripeCustomerId: null, stripeSubscriptionId: null,
      aiUsedMonth: 0, aiResetMonth: 0, onboardingDone: false,
      createdAt: new Date(), updatedAt: new Date(),
    };
    this.users[u.id] = u;
    return { ...u };
  }
  async getUserById(id: string): Promise<User | null> {
    const u = this.users[id]; return u ? { ...u } : null;
  }
  async getUserByEmailNormalized(n: string): Promise<User | null> {
    const u = Object.values(this.users).find((x) => x.emailNormalized === n);
    return u ? { ...u } : null;
  }
  async getUserByStripeCustomer(customerId: string): Promise<User | null> {
    const u = Object.values(this.users).find((x) => x.stripeCustomerId === customerId);
    return u ? { ...u } : null;
  }
  async updateUser(id: string, patch: UserPatch): Promise<User | null> {
    const u = this.users[id]; if (!u) return null;
    Object.assign(u, patch, { updatedAt: new Date() });
    return { ...u };
  }
  async activeProjectCount(ownerId: string): Promise<number> {
    return Object.values(this.projects).filter((p) => p.ownerId === ownerId && p.status === "active").length;
  }

  // Sessions ---------------------------------------------------------
  async createSession(input: NewSession): Promise<SessionRow> {
    const s: SessionRow = { id: this.gen("ses"), createdAt: new Date(), revokedAt: null, ...input };
    this.sessions[s.id] = s; return { ...s };
  }
  async getSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const s = Object.values(this.sessions).find((x) => x.tokenHash === hash && !x.revokedAt);
    return s ? { ...s } : null;
  }
  async deleteSession(id: string): Promise<void> { delete this.sessions[id]; }
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    for (const s of Object.values(this.sessions)) if (s.userId === userId) s.revokedAt = new Date();
  }
  async cleanupExpiredSessions(now: Date): Promise<void> {
    for (const [id, s] of Object.entries(this.sessions)) if (s.expiresAt < now) delete this.sessions[id];
  }

  // Projects ---------------------------------------------------------------
  async createProject(input: NewProject): Promise<Project> {
    const p: Project = {
      id: this.gen("prj"), ownerId: input.ownerId, title: input.title, type: input.type,
      summary: input.summary, goal: input.goal, direction: input.direction,
      stage: "", stageIndex: 0, stageCount: input.workflow.length, status: "active", progress: 0,
      finishedAt: null, workflow: input.workflow, creativeDirection: input.creativeDirection ?? {},
      createdAt: new Date(), updatedAt: new Date(),
    };
    this.projects[p.id] = p; return { ...p };
  }
  async getProject(ownerId: string, projectId: string): Promise<Project | null> {
    const p = this.projects[projectId]; if (!p || p.ownerId !== ownerId) return null;
    return { ...p, workflow: [...p.workflow], creativeDirection: { ...p.creativeDirection } };
  }
  async listProjects(ownerId: string): Promise<Project[]> {
    return Object.values(this.projects).filter((p) => p.ownerId === ownerId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async updateProject(ownerId: string, id: string, patch: ProjectPatch): Promise<Project | null> {
    const p = this.projects[id]; if (!p || p.ownerId !== ownerId) return null;
    Object.assign(p, patch, { updatedAt: new Date() });
    return { ...p, workflow: [...p.workflow], creativeDirection: { ...p.creativeDirection } };
  }
  async deleteProject(ownerId: string, id: string): Promise<boolean> {
    const p = this.projects[id]; if (!p || p.ownerId !== ownerId) return false;
    delete this.projects[id];
    for (const [k, t] of Object.entries(this.tasks)) if (t.projectId === id) delete this.tasks[k];
    return true;
  }

  // Tasks -----------------------------------------------------------------
  async createTask(input: NewTask): Promise<Task> {
    const t: Task = {
      id: this.gen("tsk"), ownerId: input.ownerId, projectId: input.projectId, stageId: input.stageId,
      title: input.title, status: "todo", priority: input.priority, weight: input.weight,
      sortOrder: input.sortOrder, dependsOn: input.dependsOn, dueDate: input.dueDate,
      createdAt: new Date(), updatedAt: new Date(),
    };
    this.tasks[t.id] = t; return { ...t, dependsOn: [...t.dependsOn] };
  }
  async getTask(ownerId: string, taskId: string): Promise<Task | null> {
    const t = this.tasks[taskId]; if (!t || t.ownerId !== ownerId) return null;
    return { ...t, dependsOn: [...t.dependsOn] };
  }
  async listTasksByProject(ownerId: string, projectId: string): Promise<Task[]> {
    return Object.values(this.tasks).filter((t) => t.ownerId === ownerId && t.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async updateTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<Task | null> {
    const t = this.tasks[taskId]; if (!t || t.ownerId !== ownerId) return null;
    Object.assign(t, patch, { updatedAt: new Date() });
    return { ...t, dependsOn: [...t.dependsOn] };
  }
  async deleteTask(ownerId: string, taskId: string): Promise<boolean> {
    const t = this.tasks[taskId]; if (!t || t.ownerId !== ownerId) return false;
    delete this.tasks[taskId]; return true;
  }

  // Ideas ------------------------------------------------------------------
  async createIdea(input: Omit<Idea, "id" | "createdAt">): Promise<Idea> {
    const i: Idea = { id: this.gen("idea"), createdAt: new Date(), ...input, tags: [...input.tags] };
    this.ideas[i.id] = i; return { ...i, tags: [...i.tags] };
  }
  async getIdea(ownerId: string, ideaId: string): Promise<Idea | null> {
    const i = this.ideas[ideaId]; if (!i || i.ownerId !== ownerId) return null; return { ...i, tags: [...i.tags] };
  }
  async listIdeas(ownerId: string): Promise<Idea[]> {
    return Object.values(this.ideas).filter((i) => i.ownerId === ownerId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async updateIdea(ownerId: string, ideaId: string, patch: IdeaPatch): Promise<Idea | null> {
    const i = this.ideas[ideaId]; if (!i || i.ownerId !== ownerId) return null;
    Object.assign(i, patch); return { ...i, tags: [...i.tags] };
  }
  async deleteIdea(ownerId: string, ideaId: string): Promise<boolean> {
    const i = this.ideas[ideaId]; if (!i || i.ownerId !== ownerId) return false; delete this.ideas[ideaId]; return true;
  }

  // Prompts -------------------------------------------------------------------
  async createPrompt(input: Omit<Prompt, "id" | "createdAt" | "updatedAt">): Promise<Prompt> {
    const p: Prompt = { id: this.gen("pr"), createdAt: new Date(), updatedAt: new Date(), ...input, tags: [...input.tags] };
    this.prompts[p.id] = p; return { ...p, tags: [...p.tags] };
  }
  async getPrompt(ownerId: string, promptId: string): Promise<Prompt | null> {
    const p = this.prompts[promptId]; if (!p || p.ownerId !== ownerId) return null; return { ...p, tags: [...p.tags] };
  }
  async listPrompts(ownerId: string): Promise<Prompt[]> {
    return Object.values(this.prompts).filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async updatePrompt(ownerId: string, promptId: string, patch: any): Promise<Prompt | null> {
    const p = this.prompts[promptId]; if (!p || p.ownerId !== ownerId) return null;
    Object.assign(p, patch, { updatedAt: new Date() }); return { ...p, tags: [...p.tags] };
  }
  async deletePrompt(ownerId: string, promptId: string): Promise<boolean> {
    const p = this.prompts[promptId]; if (!p || p.ownerId !== ownerId) return false; delete this.prompts[promptId]; return true;
  }

  // Memory ----------------------------------------------------------------
  async createMemory(input: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
    const m: MemoryEntry = { id: this.gen("mem"), createdAt: new Date(), updatedAt: new Date(), ...input, tags: [...input.tags] };
    this.memory[m.id] = m; return { ...m, tags: [...m.tags] };
  }
  async getMemory(ownerId: string, memoryId: string): Promise<MemoryEntry | null> {
    const m = this.memory[memoryId]; if (!m || m.ownerId !== ownerId) return null; return { ...m, tags: [...m.tags] };
  }
  async listMemory(ownerId: string, projectId?: string): Promise<MemoryEntry[]> {
    return Object.values(this.memory).filter((m) => m.ownerId === ownerId && (projectId ? m.projectId === projectId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async updateMemory(ownerId: string, memoryId: string, patch: any): Promise<MemoryEntry | null> {
    const m = this.memory[memoryId]; if (!m || m.ownerId !== ownerId) return null;
    Object.assign(m, patch, { updatedAt: new Date() }); return { ...m, tags: [...m.tags] };
  }
  async deleteMemory(ownerId: string, memoryId: string): Promise<boolean> {
    const m = this.memory[memoryId]; if (!m || m.ownerId !== ownerId) return false; delete this.memory[memoryId]; return true;
  }

  // Notes ----------------------------------------------------------------------
  async getNote(ownerId: string, projectId: string): Promise<Note | null> {
    const n = Object.values(this.notes).find((x) => x.ownerId === ownerId && x.projectId === projectId);
    return n ? { ...n } : null;
  }
  async upsertNote(ownerId: string, projectId: string, body: string): Promise<Note> {
    const existing = Object.values(this.notes).find((x) => x.ownerId === ownerId && x.projectId === projectId);
    if (existing) { existing.body = body; existing.updatedAt = new Date(); return { ...existing }; }
    const n: Note = { id: this.gen("nt"), ownerId, projectId, body, updatedAt: new Date() };
    this.notes[n.id] = n; return { ...n };
  }

  // Conversations -------------------------------------------------------------------
  async createConversation(input: { ownerId: string; projectId: string | null; title: string; kind: string }): Promise<Conversation> {
    const c: Conversation = { id: this.gen("conv"), createdAt: new Date(), updatedAt: new Date(), ...input };
    this.conversations[c.id] = c; return { ...c };
  }
  async listConversations(ownerId: string, projectId?: string): Promise<Conversation[]> {
    return Object.values(this.conversations).filter((c) => c.ownerId === ownerId && (projectId ? c.projectId === projectId : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async getConversation(ownerId: string, conversationId: string): Promise<Conversation | null> {
    const c = this.conversations[conversationId]; if (!c || c.ownerId !== ownerId) return null; return { ...c };
  }
  async appendMessage(ownerId: string, conversationId: string, role: Message["role"], content: string): Promise<Message> {
    const c = this.conversations[conversationId]; if (!c || c.ownerId !== ownerId) throw new Error("not_owned");
    const m: Message = { id: this.gen("msg"), conversationId, role, content, createdAt: new Date() };
    this.messages[m.id] = m;
    c.updatedAt = new Date();
    return { ...m };
  }
  async listMessages(ownerId: string, conversationId: string): Promise<Message[]> {
    const c = this.conversations[conversationId]; if (!c || c.ownerId !== ownerId) return [];
    return Object.values(this.messages).filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // Assets ------------------------------------------------------------------------
  async createAsset(input: NewAsset): Promise<Asset> {
    const a: Asset = { id: this.gen("ast"), createdAt: new Date(), ...input, tags: [...input.tags] };
    this.assets[a.id] = a; return { ...a, tags: [...a.tags] };
  }
  async getAsset(ownerId: string, assetId: string): Promise<Asset | null> {
    const a = this.assets[assetId]; if (!a || a.ownerId !== ownerId) return null; return { ...a, tags: [...a.tags] };
  }
  async listAssets(ownerId: string, projectId?: string): Promise<Asset[]> {
    return Object.values(this.assets).filter((a) => a.ownerId === ownerId && (projectId ? a.projectId === projectId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async updateAsset(ownerId: string, assetId: string, patch: AssetPatch): Promise<Asset | null> {
    const a = this.assets[assetId]; if (!a || a.ownerId !== ownerId) return null;
    Object.assign(a, patch); return { ...a, tags: [...a.tags] };
  }
  async deleteAsset(ownerId: string, assetId: string): Promise<boolean> {
    const a = this.assets[assetId]; if (!a || a.ownerId !== ownerId) return false; delete this.assets[assetId]; return true;
  }

  // AI usage -------------------------------------------------------------------------
  async recordAiUsage(input: NewAiUsage): Promise<AiUsage> {
    const u: AiUsage = { id: this.gen("ai"), createdAt: new Date(), ...input };
    this.aiUsage[u.id] = u; return { ...u };
  }
  async countAiUsage(ownerId: string, month: number): Promise<number> {
    return Object.values(this.aiUsage).filter((u) => u.ownerId === ownerId && u.month === month).length;
  }

  // Templates -----------------------------------------------------------------------------
  async createTemplate(input: Omit<Template, "id" | "createdAt">): Promise<Template> {
    const t: Template = { id: this.gen("tpl"), createdAt: new Date(), ...input, workflow: [...input.workflow] };
    this.templates[t.id] = t; return { ...t, workflow: [...t.workflow] };
  }
  async listTemplates(ownerId: string): Promise<Template[]> {
    return Object.values(this.templates).filter((t) => t.ownerId === ownerId || t.ownerId === null);
  }

  private uid(): string { return this.gen("id"); }
}

