import { notFound, badRequest } from "../lib/errors.js";
import type { Deps } from "./context.js";
import type { UsageService } from "./usageService.js";

/** Project-aware and global AI assistants, backed by conversation history. */
export function assistantService(deps: Deps, usage: UsageService) {
  const { store, ai } = deps;

  async function requireConversation(ownerId: string, convId: string) {
    const c = await store.getConversation(ownerId, convId);
    if (!c) throw notFound("Conversation not found.");
    return c;
  }

  async function listConversations(ownerId: string, projectId?: string) {
    return store.listConversations(ownerId, projectId);
  }
  async function messages(ownerId: string, convId: string) {
    await requireConversation(ownerId, convId);
    return store.listMessages(ownerId, convId);
  }

  /** Ask the AI with project context (project + tasks + creative memory + prompts). */
  async function ask(ownerId: string, opts: { projectId?: string | null; question: string; kind: "global" | "project" }) {
    if (!opts.question?.trim()) throw badRequest("Ask a question first.");

    // Gather context.
    let ctx: Record<string, unknown> = {};
    if (opts.projectId) {
      const project = await store.getProject(ownerId, opts.projectId);
      if (!project) throw notFound("Project not found.");
      const tasks = await store.listTasksByProject(ownerId, opts.projectId);
      const memory = await store.listMemory(ownerId, opts.projectId);
      const prompts = await store.listPrompts(ownerId);
      ctx = {
        project: { title: project.title, type: project.type, summary: project.summary, goal: project.goal, direction: project.direction, stage: project.stage },
        tasks: tasks.map((t) => ({ title: t.title, status: t.status, stageId: t.stageId, priority: t.priority })),
        memory: memory.slice(0, 12).map((m) => ({ category: m.category, label: m.label, body: m.body })),
        relevantPrompts: prompts.filter((p) => p.projectId === opts.projectId).slice(0, 5).map((p) => p.body),
      };
    } else {
      const projects = await store.listProjects(ownerId);
      ctx = {
        projects: projects.map((p) => ({ title: p.title, type: p.type, status: p.status, stage: p.stage, goal: p.goal })),
        ideas: (await store.listIdeas(ownerId)).slice(0, 5).map((i) => ({ title: i.title })),
        memory: (await store.listMemory(ownerId)).slice(0, 8).map((m) => ({ label: m.label, body: m.body })),
      };
    }

    await usage.consume(ownerId, opts.projectId ?? null, "assistant");

    // Ensure a conversation exists to record history.
    let conv = opts.projectId
      ? (await store.listConversations(ownerId, opts.projectId))[0]
      : (await store.listConversations(ownerId))[0];
    if (!conv) {
      conv = await store.createConversation({ ownerId, projectId: opts.projectId ?? null, title: opts.projectId ? "Project chat" : "Assistant", kind: opts.kind });
    }
    await store.appendMessage(ownerId, conv.id, "user", opts.question);
    const answer = await ai.assistant(opts.question, ctx);
    await store.appendMessage(ownerId, conv.id, "assistant", answer);
    const history = await store.listMessages(ownerId, conv.id);
    return { conversation: conv, answer, history };
  }

  return { ask, listConversations, messages };
}

export type AssistantService = ReturnType<typeof assistantService>;