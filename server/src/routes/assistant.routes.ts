import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/index.js";
import { requireAuth } from "../middleware/auth.js";

/** Global & project-aware AI assistants. */
export function assistantRoutes(svc: Services): Router {
  const r = Router();
  const uid = (res: any) => res.locals.userId;
  r.use(requireAuth(svc.auth));
  const A = svc.assistant;

  r.post("/ask", async (req, res, next) => {
    try {
      const b = z.object({ question: z.string().min(1), projectId: z.string().nullable().optional(), kind: z.enum(["global", "project"]).default("global") }).parse(req.body);
      res.json(await A.ask(uid(res), { projectId: b.projectId ?? null, question: b.question, kind: b.kind }));
    } catch (e) { next(e); }
  });

  r.get("/conversations", async (req, res, next) => {
    try { res.json({ conversations: await A.listConversations(uid(res), (req.query.projectId as string) || undefined) }); } catch (e) { next(e); }
  });

  r.get("/conversations/:id/messages", async (req, res, next) => {
    try { res.json({ messages: await A.messages(uid(res), req.params.id) }); } catch (e) { next(e); }
  });

  return r;
}