import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/index.js";
import { requireAuth } from "../middleware/auth.js";

export function projectRoutes(svc: Services): Router {
  const r = Router();
  const uid = (res: any) => res.locals.userId;

  r.use(requireAuth(svc.auth));

  // Generate an AI blueprint (consumes 1 AI action).
  r.post("/generate", async (req, res, next) => {
    try {
      const b = z.object({ idea: z.string().min(3), type: z.string().optional() }).parse(req.body);
      const blueprint = await svc.projects.generateBlueprint(uid(res), b.idea, b.type ?? "");
      res.json({ blueprint });
    } catch (e) { next(e); }
  });

  r.get("/", async (req, res, next) => {
    try { res.json({ projects: await svc.projects.listProjects(uid(res)) }); }
    catch (e) { next(e); }
  });

  r.post("/", async (req, res, next) => {
    try {
      const b = z.object({
        title: z.string().min(1), type: z.string(), summary: z.string().optional(),
        goal: z.string().optional(), direction: z.string().optional(),
        workflow: z.array(z.object({ id: z.string(), name: z.string(), tasks: z.array(z.string()) })).default([]),
      }).parse(req.body);
      const project = await svc.projects.createProject(uid(res), { ...b, summary: b.summary ?? "", goal: b.goal ?? "", direction: b.direction ?? "" });
      res.status(201).json({ project });
    } catch (e) { next(e); }
  });

  r.get("/next", async (req, res, next) => {
    try {
      const projectId = z.string().parse(req.query.projectId);
      res.json({ next: await svc.projects.nextAction(uid(res), projectId) });
    } catch (e) { next(e); }
  });

  r.get("/:id", async (req, res, next) => {
    try { res.json({ project: await svc.projects.getProject(uid(res), req.params.id) }); }
    catch (e) { next(e); }
  });

  r.patch("/:id", async (req, res, next) => {
    try { res.json({ project: await svc.projects.updateProject(uid(res), req.params.id, req.body) }); }
    catch (e) { next(e); }
  });

  r.delete("/:id", async (req, res, next) => {
    try { await svc.projects.deleteProject(uid(res), req.params.id); res.json({ ok: true }); }
    catch (e) { next(e); }
  });

  r.post("/:id/stage", async (req, res, next) => {
    try {
      const b = z.object({ index: z.number().int().min(0) }).parse(req.body);
      res.json({ project: await svc.projects.advanceStage(uid(res), req.params.id, b.index) });
    } catch (e) { next(e); }
  });

  // Tasks -----------------------------------------------------------------
  r.get("/:id/tasks", async (req, res, next) => {
    try {
      const project = await svc.projects.getProject(uid(res), req.params.id);
      const tasks = await svc.projects.tasksForProject(uid(res), req.params.id);
      res.json({ project, tasks });
    } catch (e) { next(e); }
  });

  r.post("/:id/tasks", async (req, res, next) => {
    try {
      const b = z.object({ title: z.string().min(1), stageId: z.string().optional(), priority: z.number().optional() }).parse(req.body);
      res.status(201).json({ task: await svc.projects.addTask(uid(res), req.params.id, b) });
    } catch (e) { next(e); }
  });

  r.patch("/:id/tasks/:taskId", async (req, res, next) => {
    try {
      const task = await svc.projects.updateTask(uid(res), req.params.id, req.params.taskId, req.body);
      res.json({ task });
    } catch (e) { next(e); }
  });

  r.delete("/:id/tasks/:taskId", async (req, res, next) => {
    try { await svc.projects.deleteTask(uid(res), req.params.id, req.params.taskId); res.json({ ok: true }); }
    catch (e) { next(e); }
  });

  // Quick complete (sets status + auto-advance + next action)
  r.post("/:id/tasks/:taskId/status", async (req, res, next) => {
    try {
      const b = z.object({ status: z.enum(["todo", "doing", "blocked", "done"]) }).parse(req.body);
      const r2 = await svc.projects.setTaskStatus(uid(res), req.params.id, req.params.taskId, b.status);
      res.json(r2);
    } catch (e) { next(e); }
  });

  return r;
}