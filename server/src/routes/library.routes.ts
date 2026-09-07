import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/index.js";
import { requireAuth } from "../middleware/auth.js";

/** Ideas, prompts, creative memory (bible), notes. */
export function libraryRoutes(svc: Services): Router {
  const r = Router();
  const uid = (res: any) => res.locals.userId;
  r.use(requireAuth(svc.auth));
  const L = svc.library;

  // ---- Ideas ----
  r.get("/ideas", async (_req, res, next) => { try { res.json({ ideas: await L.listIdeas(uid(res)) }); } catch (e) { next(e); } });
  r.post("/ideas", async (req, res, next) => {
    try { const b = z.object({ title: z.string().min(1), body: z.string().optional(), type: z.string().optional() }).parse(req.body); res.status(201).json({ idea: await L.captureIdea(uid(res), b) }); } catch (e) { next(e); }
  });
  r.patch("/ideas/:id", async (req, res, next) => { try { res.json({ idea: await L.updateIdea(uid(res), req.params.id, req.body) }); } catch (e) { next(e); } });
  r.delete("/ideas/:id", async (req, res, next) => { try { await L.deleteIdea(uid(res), req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });

  // ---- Prompts ----
  r.get("/prompts", async (_req, res, next) => { try { res.json({ prompts: await L.listPrompts(uid(res)) }); } catch (e) { next(e); } });
  r.post("/prompts", async (req, res, next) => {
    try { const b = z.object({ title: z.string().optional(), body: z.string().min(1), category: z.string().optional(), projectId: z.string().nullable().optional() }).parse(req.body); res.status(201).json({ prompt: await L.savePrompt(uid(res), { title: b.title ?? "", body: b.body, category: b.category, projectId: b.projectId ?? null }) }); } catch (e) { next(e); }
  });
  r.post("/prompts/:id/improve", async (req, res, next) => { try { res.json({ prompt: await L.improvePrompt(uid(res), req.params.id) }); } catch (e) { next(e); } });
  r.delete("/prompts/:id", async (req, res, next) => { try { await L.deletePrompt(uid(res), req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });

  // ---- Memory ----
  r.get("/memory", async (req, res, next) => { try { res.json({ memory: await L.listMemory(uid(res), (req.query.projectId as string) || undefined) }); } catch (e) { next(e); } });
  r.post("/memory", async (req, res, next) => {
    try { const b = z.object({ label: z.string().min(1), body: z.string().optional(), category: z.string().optional(), projectId: z.string().nullable().optional() }).parse(req.body); res.status(201).json({ entry: await L.saveMemory(uid(res), { label: b.label, body: b.body, category: b.category ?? "fact", projectId: b.projectId ?? null }) }); } catch (e) { next(e); }
  });
  r.patch("/memory/:id", async (req, res, next) => { try { res.json({ entry: await L.updateMemory(uid(res), req.params.id, req.body) }); } catch (e) { next(e); } });
  r.delete("/memory/:id", async (req, res, next) => { try { await L.deleteMemory(uid(res), req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });

  // ---- Notes ----
  r.get("/notes/:projectId", async (req, res, next) => { try { res.json({ note: await L.getNote(uid(res), req.params.projectId) }); } catch (e) { next(e); } });
  r.put("/notes/:projectId", async (req, res, next) => {
    try { const b = z.object({ body: z.string() }).parse(req.body); res.json({ note: await L.upsertNote(uid(res), req.params.projectId, b.body) }); } catch (e) { next(e); }
  });

  return r;
}