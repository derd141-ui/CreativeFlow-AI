// CreativeFlow AI — API client.
// Thin typed wrapper around the backend REST API. Stores the bearer token in
// localStorage and attaches it to every request.

export const TOKEN_KEY = "cf_token";

export function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }
export function getToken() { return localStorage.getItem(TOKEN_KEY); }

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function http(method, path, body, opts = {}) {
  const headers = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error ?? { code: "ERROR", message: res.statusText };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return data;
}

export const api = {
  // Auth
  register: (email, password, name) => http("POST", "/auth/register", { email, password, name }),
  login: (email, password) => http("POST", "/auth/login", { email, password }),
  logout: () => http("POST", "/auth/logout"),
  me: () => http("GET", "/auth/me"),

  // Projects
  listProjects: () => http("GET", "/projects"),
  getProject: (id) => http("GET", `/projects/${id}`),
  generate: (idea, type) => http("POST", "/projects/generate", { idea, type }),
  createProject: (bp) => http("POST", "/projects", bp),
  updateProject: (id, patch) => http("PATCH", `/projects/${id}`, patch),
  deleteProject: (id) => http("DELETE", `/projects/${id}`),
  nextAction: (projectId) => http("GET", `/projects/next?projectId=${encodeURIComponent(projectId)}`),
  setStage: (id, index) => http("POST", `/projects/${id}/stage`, { index }),

  // Tasks
  projectTasks: (id) => http("GET", `/projects/${id}/tasks`),
  addTask: (id, t) => http("POST", `/projects/${id}/tasks`, t),
  updateTask: (id, taskId, patch) => http("PATCH", `/projects/${id}/tasks/${taskId}`, patch),
  deleteTask: (id, taskId) => http("DELETE", `/projects/${id}/tasks/${taskId}`),
  setTaskStatus: (id, taskId, status) => http("POST", `/projects/${id}/tasks/${taskId}/status`, { status }),

  // Ideas
  listIdeas: () => http("GET", "/ideas"),
  addIdea: (idea) => http("POST", "/ideas", idea),
  updateIdea: (id, patch) => http("PATCH", `/ideas/${id}`, patch),
  deleteIdea: (id) => http("DELETE", `/ideas/${id}`),

  // Prompts
  listPrompts: () => http("GET", "/prompts"),
  addPrompt: (p) => http("POST", "/prompts", p),
  improvePrompt: (id) => http("POST", `/prompts/${id}/improve`),
  deletePrompt: (id) => http("DELETE", `/prompts/${id}`),

  // Memory
  listMemory: (projectId) => http("GET", `/memory${projectId ? `?projectId=${projectId}` : ""}`),
  addMemory: (m) => http("POST", "/memory", m),
  updateMemory: (id, patch) => http("PATCH", `/memory/${id}`, patch),
  deleteMemory: (id) => http("DELETE", `/memory/${id}`),

  // Notes
  getNote: (projectId) => http("GET", `/notes/${projectId}`),
  saveNote: (projectId, body) => http("PUT", `/notes/${projectId}`, { body }),

  // Assets
  listAssets: (projectId) => http("GET", `/assets${projectId ? `?projectId=${projectId}` : ""}`),
  createUpload: (p) => http("POST", "/assets/upload", p),
  assetUrl: (id) => http("GET", `/assets/${id}/url`),
  renameAsset: (id, name) => http("PATCH", `/assets/${id}`, { name }),
  deleteAsset: (id) => http("DELETE", `/assets/${id}`),

  // Assistant
  ask: (question, projectId, kind) => http("POST", "/assistant/ask", { question, projectId, kind }),
  conversations: (projectId) => http("GET", `/assistant/conversations${projectId ? `?projectId=${projectId}` : ""}`),
  messages: (id) => http("GET", `/assistant/conversations/${id}/messages`),

  // Billing
  checkout: (plan) => http("POST", "/billing/checkout", { plan }),
  mockComplete: (plan) => http("POST", "/billing/mock/complete", { plan }),
  portal: () => http("GET", "/billing/portal"),
  cancel: () => http("POST", "/billing/cancel"),

  // Demo
  demoSeed: () => http("POST", "/demo/seed"),
};

/** Upload a file's bytes to the pre-signed URL (or local fallback). */
export async function putObject(url, file) {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return true;
}