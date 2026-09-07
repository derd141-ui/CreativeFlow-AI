import type {
  AiUsage, Asset, Conversation, Idea, MemoryEntry, Message, Note, Project,
  Prompt, SessionRow, Task, Template, User,
} from "../lib/types.js";

/** A slice of user data returned to the client (never includes password hash). */
export interface UserPatch {
  name?: string;
  plan?: User["plan"];
  planStatus?: User["planStatus"];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  aiUsedMonth?: number;
  aiResetMonth?: number;
  onboardingDone?: boolean;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  userAgent?: string | null;
  ip?: string | null;
  expiresAt: Date;
}

export interface NewProject {
  ownerId: string;
  title: string;
  type: string;
  summary: string;
  goal: string;
  direction: string;
  workflow: Project["workflow"];
  creativeDirection?: Project["creativeDirection"];
}

export interface NewTask {
  ownerId: string;
  projectId: string;
  stageId: string;
  title: string;
  priority: number;
  weight: number;
  sortOrder: number;
  dependsOn: string[];
  dueDate: Date | null;
}

export interface NewAsset {
  ownerId: string;
  projectId: string | null;
  name: string;
  kind: string;
  mime: string;
  size: number;
  bucketKey: string;
  sha: string;
  tags: string[];
}

export interface NewAiUsage {
  ownerId: string;
  projectId: string | null;
  action: string;
  month: number;
  tokens: number;
}

export interface ProjectPatch {
  title?: string;
  summary?: string;
  goal?: string;
  direction?: string;
  stage?: string;
  stageIndex?: number;
  stageCount?: number;
  status?: Project["status"];
  progress?: number;
  finishedAt?: Date | null;
  workflow?: Project["workflow"];
  creativeDirection?: Project["creativeDirection"];
}

export interface TaskPatch {
  stageId?: string;
  title?: string;
  status?: Task["status"];
  priority?: number;
  weight?: number;
  sortOrder?: number;
  dependsOn?: string[];
  dueDate?: Date | null;
}

export interface IdeaPatch { title?: string; body?: string; type?: string; status?: string; tags?: string[]; projectId?: string | null }
export interface PromptPatch { title?: string; body?: string; category?: string; tags?: string[]; aiImproved?: boolean }
export interface MemoryPatch { category?: string; label?: string; body?: string; tags?: string[] }
export interface AssetPatch { name?: string; tags?: string[]; bucketKey?: string; mime?: string; size?: number; sha?: string; kind?: string; projectId?: string | null }

/**
 * The persistence boundary. Every multi-tenant method takes the acting
 * `ownerId` and returns null / empty when the row is not owned by that user —
 * this is the application-level enforcement of row-level authorization that
 * mirrors the PostgreSQL RLS policies in db/rls.sql.
 */
export interface Store {
  // Users ------------------------------------------------------------------
  createUser(data: { email: string; emailNormalized: string; passwordHash: string; name: string }): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmailNormalized(emailNormalized: string): Promise<User | null>;
  getUserByStripeCustomer(customerId: string): Promise<User | null>;
  updateUser(id: string, patch: UserPatch): Promise<User | null>;
  activeProjectCount(ownerId: string): Promise<number>;

  // Sessions -----------------------------------------------------------------
  createSession(input: NewSession): Promise<SessionRow>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(id: string): Promise<void>;
  revokeAllSessionsForUser(userId: string): Promise<void>;
  cleanupExpiredSessions(now: Date): Promise<void>;

  // Projects -----------------------------------------------------------------
  createProject(input: NewProject): Promise<Project>;
  getProject(ownerId: string, projectId: string): Promise<Project | null>;
  listProjects(ownerId: string): Promise<Project[]>;
  updateProject(ownerId: string, projectId: string, patch: ProjectPatch): Promise<Project | null>;
  deleteProject(ownerId: string, projectId: string): Promise<boolean>;

  // Tasks ------------------------------------------------------------------------
  createTask(input: NewTask): Promise<Task>;
  getTask(ownerId: string, taskId: string): Promise<Task | null>;
  listTasksByProject(ownerId: string, projectId: string): Promise<Task[]>;
  updateTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<Task | null>;
  deleteTask(ownerId: string, taskId: string): Promise<boolean>;

  // Ideas --------------------------------------------------------------------------
  createIdea(input: Omit<Idea, "id" | "createdAt">): Promise<Idea>;
  getIdea(ownerId: string, ideaId: string): Promise<Idea | null>;
  listIdeas(ownerId: string): Promise<Idea[]>;
  updateIdea(ownerId: string, ideaId: string, patch: IdeaPatch): Promise<Idea | null>;
  deleteIdea(ownerId: string, ideaId: string): Promise<boolean>;

  // Prompts -------------------------------------------------------------------------
  createPrompt(input: Omit<Prompt, "id" | "createdAt" | "updatedAt">): Promise<Prompt>;
  getPrompt(ownerId: string, promptId: string): Promise<Prompt | null>;
  listPrompts(ownerId: string): Promise<Prompt[]>;
  updatePrompt(ownerId: string, promptId: string, patch: PromptPatch): Promise<Prompt | null>;
  deletePrompt(ownerId: string, promptId: string): Promise<boolean>;

  // Memory (Creative Bible) -----------------------------------------------------------------
  createMemory(input: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry>;
  getMemory(ownerId: string, memoryId: string): Promise<MemoryEntry | null>;
  listMemory(ownerId: string, projectId?: string): Promise<MemoryEntry[]>;
  updateMemory(ownerId: string, memoryId: string, patch: MemoryPatch): Promise<MemoryEntry | null>;
  deleteMemory(ownerId: string, memoryId: string): Promise<boolean>;

  // Notes ---------------------------------------------------------------------------------
  getNote(ownerId: string, projectId: string): Promise<Note | null>;
  upsertNote(ownerId: string, projectId: string, body: string): Promise<Note>;

  // Conversations & messages --------------------------------------------------------------
  createConversation(input: { ownerId: string; projectId: string | null; title: string; kind: string }): Promise<Conversation>;
  listConversations(ownerId: string, projectId?: string): Promise<Conversation[]>;
  getConversation(ownerId: string, conversationId: string): Promise<Conversation | null>;
  appendMessage(ownerId: string, conversationId: string, role: Message["role"], content: string): Promise<Message>;
  listMessages(ownerId: string, conversationId: string): Promise<Message[]>;

  // Assets ------------------------------------------------------------------------------
  createAsset(input: NewAsset): Promise<Asset>;
  getAsset(ownerId: string, assetId: string): Promise<Asset | null>;
  listAssets(ownerId: string, projectId?: string): Promise<Asset[]>;
  updateAsset(ownerId: string, assetId: string, patch: AssetPatch): Promise<Asset | null>;
  deleteAsset(ownerId: string, assetId: string): Promise<boolean>;

  // AI usage ------------------------------------------------------------------------
  recordAiUsage(input: NewAiUsage): Promise<AiUsage>;
  countAiUsage(ownerId: string, month: number): Promise<number>;

  // Templates ------------------------------------------------------------------------
  createTemplate(input: Omit<Template, "id" | "createdAt">): Promise<Template>;
  listTemplates(ownerId: string): Promise<Template[]>;
}

// Re-export patch types for consumers.