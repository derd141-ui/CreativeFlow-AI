import { notFound, badRequest } from "../lib/errors.js";
import { assertActiveProjectAllowance } from "../lib/limits.js";
import type { Deps } from "./context.js";
import type { UsageService } from "./usageService.js";
import type { Project, ProjectStatus, Task, WorkflowStage } from "../lib/types.js";
import type { ProjectPatch, TaskPatch } from "../store/store.js";

export interface ProjectBlueprint {
  title: string;
  type: string;
  summary: string;
  goal: string;
  direction: string;
  workflow: WorkflowStage[];
}

export function projectService(deps: Deps, usage: UsageService) {
  const { store, ai } = deps;

  async function requireProject(ownerId: string, projectId: string): Promise<Project> {
    const p = await store.getProject(ownerId, projectId);
    if (!p) throw notFound("Project not found.");
    return p;
  }
  async function requireTask(ownerId: string, taskId: string): Promise<Task> {
    const t = await store.getTask(ownerId, taskId);
    if (!t) throw notFound("Task not found.");
    return t;
  }

  // ---- AI generation ----------------------------------------------------
  async function generateBlueprint(userId: string, idea: string, type: string): Promise<ProjectBlueprint> {
    await usage.consume(userId, null, "generate_project");
    return ai.generate({ idea, type });
  }

  // ---- CRUD ---------------------------------------------------------------
  async function listProjects(ownerId: string) {
    const projects = await store.listProjects(ownerId);
    const tasks = await Promise.all(projects.map((p) => store.listTasksByProject(ownerId, p.id)));
    return projects.map((p, i) => withProgress(p, tasks[i]));
  }

  async function getProject(ownerId: string, projectId: string) {
    const p = await requireProject(ownerId, projectId);
    const tasks = await store.listTasksByProject(ownerId, projectId);
    return withProgress(p, tasks);
  }

  async function createProject(ownerId: string, bp: ProjectBlueprint) {
    const active = await store.activeProjectCount(ownerId);
    assertActiveProjectAllowance((await store.getUserById(ownerId))?.plan ?? "free", active);
    const project = await store.createProject({
      ownerId, title: bp.title, type: bp.type, summary: bp.summary, goal: bp.goal,
      direction: bp.direction, workflow: bp.workflow, creativeDirection: {},
    });
    // Seed tasks from the workflow blueprint.
    let order = 0;
    for (const stage of bp.workflow) {
      for (const title of stage.tasks) {
        await store.createTask({ ownerId, projectId: project.id, stageId: stage.id, title, priority: 1, weight: 1, sortOrder: order++, dependsOn: [], dueDate: null });
      }
    }
    const tasks = await store.listTasksByProject(ownerId, project.id);
    return withProgress(project, tasks);
  }

  async function deleteProject(ownerId: string, projectId: string): Promise<void> {
    await requireProject(ownerId, projectId);
    await store.deleteProject(ownerId, projectId);
  }

  async function updateProject(ownerId: string, projectId: string, patch: ProjectPatch) {
    await requireProject(ownerId, projectId);
    const p = await store.updateProject(ownerId, projectId, patch);
    if (!p) throw notFound("Project not found.");
    return p;
  }

  // ---- tasks ----------------------------------------------------------
  async function tasksForProject(ownerId: string, projectId: string) {
    await requireProject(ownerId, projectId);
    return store.listTasksByProject(ownerId, projectId);
  }

  async function addTask(ownerId: string, projectId: string, input: { title: string; stageId?: string; priority?: number; dependsOn?: string[] }) {
    const p = await requireProject(ownerId, projectId);
    const stageId = input.stageId || p.workflow[p.stageIndex]?.id || p.workflow[0]?.id || "";
    const tasks = await store.listTasksByProject(ownerId, projectId);
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.sortOrder), -1);
    const t = await store.createTask({
      ownerId, projectId, stageId, title: input.title, priority: input.priority ?? 1, weight: 1,
      sortOrder: maxOrder + 1, dependsOn: input.dependsOn ?? [], dueDate: null,
    });
    return t;
  }

  async function updateTask(ownerId: string, projectId: string, taskId: string, patch: TaskPatch) {
    await requireProject(ownerId, projectId);
    const task = await requireTask(ownerId, taskId);
    if (task.projectId !== projectId) throw notFound("Task not found in this project.");
    const t = await store.updateTask(ownerId, taskId, patch);
    if (!t) throw notFound("Task not found.");
    return t;
  }

  async function deleteTask(ownerId: string, projectId: string, taskId: string) {
    await requireProject(ownerId, projectId);
    await requireTask(ownerId, taskId);
    await store.deleteTask(ownerId, taskId);
  }

  async function setTaskStatus(ownerId: string, projectId: string, taskId: string, status: Task["status"]) {
    const task = await requireTask(ownerId, taskId);
    if (task.projectId !== projectId) throw notFound("Task not found in this project.");
    const t = await store.updateTask(ownerId, taskId, { status });
    if (!t) throw notFound("Task not found.");
    // Advance project stage automatically when the whole current stage is done.
    const project = await requireProject(ownerId, projectId);
    const tasks = await store.listTasksByProject(ownerId, projectId);
    const currentStageId = project.workflow[project.stageIndex]?.id;
    const stageTasks = tasks.filter((x) => x.stageId === currentStageId);
    if (stageTasks.length && stageTasks.every((x) => x.status === "done")) {
      const nextIdx = Math.min(project.stageIndex + 1, Math.max(0, project.workflow.length - 1));
      if (nextIdx !== project.stageIndex) {
        await store.updateProject(ownerId, projectId, { stageIndex: nextIdx, stage: project.workflow[nextIdx]?.name ?? "" });
      }
    }
    // Mark project finished when all tasks done.
    const allDone = tasks.length > 0 && tasks.every((x) => x.status === "done");
    if (allDone && project.status !== "finished") {
      await store.updateProject(ownerId, projectId, { status: "finished", finishedAt: new Date() });
    }
    return { task: t, projectId };
  }

  async function advanceStage(ownerId: string, projectId: string, targetIdx: number) {
    const p = await requireProject(ownerId, projectId);
    const idx = Math.max(0, Math.min(targetIdx, p.workflow.length - 1));
    const updated = await store.updateProject(ownerId, projectId, { stageIndex: idx, stage: p.workflow[idx]?.name ?? "" });
    return updated;
  }

  // ---- Next action ------------------------------------------------------
  async function nextAction(ownerId: string, projectId: string) {
    const p = await requireProject(ownerId, projectId);
    const tasks = await store.listTasksByProject(ownerId, projectId);
    const result = await ai.nextAction(
      { stageIndex: p.stageIndex, stages: p.workflow },
      tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, stageId: t.stageId, priority: t.priority, dueDate: t.dueDate, createdAt: t.createdAt, dependsOn: t.dependsOn })),
    );
    return { ...result, projectTitle: p.title, projectId };
  }

  return {
    generateBlueprint, createProject, listProjects, getProject, deleteProject, updateProject,
    addTask, tasksForProject, updateTask, deleteTask, setTaskStatus, advanceStage, nextAction,
  };
}

export type ProjectService = ReturnType<typeof projectService>;

function withProgress(p: Project, tasks: Task[]): Project & { progress: number; taskCount: number; doneCount: number } {
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  return { ...p, progress, taskCount: tasks.length, doneCount };
}