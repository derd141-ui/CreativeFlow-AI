import { notFound, badRequest } from "../lib/errors.js";
import type { Deps } from "./context.js";
import type { UsageService } from "./usageService.js";

/** Ideas, prompts, creative memory (bible), notes. */
export function libraryService(deps: Deps, usage: UsageService) {
  const { store } = deps;

  const own = <T>(v: T | null): T => { if (v == null) throw notFound(); return v; };

  // ---- Ideas ---------------------------------------------------------------------
  async function captureIdea(ownerId: string, input: { title: string; body?: string; type?: string; projectId?: string | null }) {
    if (!input.title?.trim()) throw badRequest("An idea needs a title.");
    return store.createIdea({ ownerId, projectId: input.projectId ?? null, title: input.title.trim(), body: input.body ?? "", type: input.type ?? "other", status: "vault", tags: [] });
  }
  const listIdeas = (ownerId: string) => store.listIdeas(ownerId);
  async function getIdea(ownerId: string, id: string) { return own(await store.getIdea(ownerId, id)); }
  async function updateIdea(ownerId: string, id: string, patch: any) { return own(await store.updateIdea(ownerId, id, patch)); }
  async function deleteIdea(ownerId: string, id: string) { await store.deleteIdea(ownerId, id); }

  // ---- Prompts --------------------------------------------------------------------
  async function savePrompt(ownerId: string, input: { title: string; body: string; category?: string; projectId?: string | null }) {
    if (!input.body?.trim()) throw badRequest("A prompt needs its text.");
    return store.createPrompt({ ownerId, projectId: input.projectId ?? null, title: input.title?.trim() || input.body.slice(0, 40), body: input.body, category: input.category ?? "general", tags: [], aiImproved: false });
  }
  const listPrompts = (ownerId: string) => store.listPrompts(ownerId);
  async function improvePrompt(ownerId: string, promptId: string) {
    const p = own(await store.getPrompt(ownerId, promptId));
    await usage.consume(ownerId, p.projectId, "improve_prompt");
    const improved = await deps.ai.improvePrompt(p.body);
    return own(await store.updatePrompt(ownerId, promptId, { body: improved, aiImproved: true }));
  }
  async function deletePrompt(ownerId: string, id: string) { await store.deletePrompt(ownerId, id); }

  // ---- Creative Memory (bible) -----------------------------------------------------
  async function saveMemory(ownerId: string, input: { projectId?: string | null; category: string; label: string; body?: string; source?: string }) {
    if (!input.label?.trim()) throw badRequest("A memory needs a label.");
    return store.createMemory({ ownerId, projectId: input.projectId ?? null, category: input.category || "fact", label: input.label.trim(), body: input.body ?? "", tags: [], source: input.source ?? "manual" });
  }
  const listMemory = (ownerId: string, projectId?: string) => store.listMemory(ownerId, projectId);
  async function updateMemory(ownerId: string, id: string, patch: any) { return own(await store.updateMemory(ownerId, id, patch)); }
  async function deleteMemory(ownerId: string, id: string) { await store.deleteMemory(ownerId, id); }

  // ---- Notes -------------------------------------------------------------------------
  const getNote = (ownerId: string, projectId: string) => store.getNote(ownerId, projectId);
  const upsertNote = (ownerId: string, projectId: string, body: string) => store.upsertNote(ownerId, projectId, body);

  return {
    captureIdea, listIdeas, getIdea, updateIdea, deleteIdea,
    savePrompt, listPrompts, improvePrompt, deletePrompt,
    saveMemory, listMemory, updateMemory, deleteMemory,
    getNote, upsertNote,
  };
}

export type LibraryService = ReturnType<typeof libraryService>;