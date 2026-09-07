import { api, setToken, clearToken, getToken, putObject, ApiError } from "./api.js";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $root = document.getElementById("root");
const $toasts = document.getElementById("toasts");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const TYPES = { video: "Video", music: "Music", image: "Image", writing: "Writing", character: "Character / Art", game: "Game", content: "Content", other: "Project" };
const typeLabel = (t) => TYPES[t] || t || "Project";
const CATEGORIES = ["character", "location", "object", "style", "story", "theme", "preference", "fact", "technique", "other"];
const STATUS_LABEL = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done" };

function render(html) { $root.innerHTML = html; }
function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function guessKind(mime) {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || mime.includes("word") || mime.includes("text")) return "document";
  return "other";
}

function pickAsset() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}
function navLink(href, label, active) {
  return `<a class="nav-link ${active ? "active" : ""}" href="#${href}" data-nav>${label}</a>`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = { user: null, usage: null, project: null, tasks: [], draft: null };

async function refreshMe() {
  const data = await api.me();
  S.user = data.user;
  S.usage = data.usage;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route() {
  const h = location.hash.replace(/^#/, "") || "/app/dashboard";
  try {
    if (!getToken()) {
      if (h === "/register") return viewRegister();
      return viewLogin();
    }
    if (!S.user) await refreshMeOrLogout();
    if (h === "/login" || h === "/register") { location.hash = "/app/dashboard"; return; }
    await routeApp(h);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { clearToken(); S.user = null; viewLogin(); }
    else { toast(e.message || "Something went wrong", "error"); }
  }
}

async function refreshMeOrLogout() {
  try { await refresh(); }
  catch { clearToken(); S.user = null; }
}

// ---------------------------------------------------------------------------
// App shell + nav
// ---------------------------------------------------------------------------
function shell(active, inner) {
  const u = S.user || {};
  const items = [
    ["/app/dashboard", "Dashboard"],
    ["/app/projects", "Projects"],
    ["/app/ideas", "Ideas"],
    ["/app/prompts", "Prompts"],
    ["/app/assistant", "Assistant"],
    ["/app/settings", "Settings"],
    ["/app/billing", "Billing"],
  ];
  return `<div class="shell">
    <aside class="side">
      <div class="brand">✦ CreativeFlow</div>
      <nav>${items.map(([h, l]) => navLink(h, l, h === active)).join("")}</nav>
      <div class="side-foot">
        <div class="plan-chip">${esc(u.plan || "free")} plan</div>
        ${u.plan === "free" ? `<a class="mini-cta" href="#/app/billing">Upgrade</a>` : ""}
        <button class="btn btn-ghost btn-sm" onclick="signOut()">Sign out</button>
      </div>
    </aside>
    <main class="main">${inner}</main>
  </div>`;
}

async function hmmApp(h) {
  if (h.startsWith("/app/projects/")) { const raw = h.split("/")[3]; const id = raw.split("?")[0]; return viewProject(id); }
  if (h.startsWith("/app/projects")) return viewProjects();
  if (h.startsWith("/app/dashboard")) return viewDashboard();
  if (h.startsWith("/app/ideas")) return viewIdeas();
  if (h.startsWith("/app/prompts")) return viewPrompts();
  if (h.startsWith("/app/assistant")) return viewAssistant();
  if (h.startsWith("/app/billing")) return viewBilling();
  if (h.startsWith("/app/settings")) return viewSettings();
  return viewDashboard();
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => { route(); });

// ---------------------------------------------------------------------------
// Auth views
// ---------------------------------------------------------------------------
function viewLogin() {
  render(`<div class="auth-wrap">
    <div class="auth-card">
      <div class="brand brand-lg">✦ CreativeFlow AI</div>
      <p class="muted" style="text-align:center">Turn your creative ideas into finished projects.</p>
      <form onsubmit="doLogin(event)">
        <label>Email<input name="email" type="email" required /></label>
        <label>Password<input name="password" type="password" required /></label>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      <p class="muted center">New here? <a href="#/register">Create an account</a></p>
    </div>
  </div>`);
}
function viewRegister() {
  render(`<div class="auth-wrap">
    <div class="auth-card">
      <div class="brand brand-lg">✦ CreativeFlow AI</div>
      <form onsubmit="doRegister(event)">
        <label>Name<input name="name" type="text" /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Password<input name="password" type="password" minlength="8" required /></label>
        <button class="btn btn-primary btn-block" type="submit">Create account</button>
      </form>
      <p class="muted center">Have an account? <a href="#/login">Sign in</a></p>
    </div>
  </div>`);
}

window.doLogin = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { const out = await api.login(f.get("email"), f.get("password")); setToken(out.token); S.user = out.user; toast("Welcome back!"); location.hash = "/app/dashboard"; route(); }
  catch (err) { toast(err.message, "error"); }
};
window.doRegister = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const out = await api.register(f.get("email"), f.get("password"), f.get("name") || "");
    setToken(out.token); S.user = out.user;
    const seeded = confirm("Want to explore with demo projects (Frozen Wasteland, etc.)?");
    if (seeded) await api.demoSeed();
    location.hash = "/app/dashboard"; route();
  } catch (err) { toast(err.message, "error"); }
};
window.signOut = async () => { try { await api.logout(); } catch {} clearToken(); S.user = null; location.hash = "/login"; route(); };

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function viewDashboard() {
  render(shell("/app/dashboard", `<div class="loading">Loading…</div>`));
  const [projects, ideas] = await Promise.all([api.listProjects(), api.listIdeas()]);
  const active = projects.filter((p) => p.status === "active");
  const cards = projects.slice(0, 6).map(projectCard).join("") || `<div class="empty"><h3>No projects yet</h3><p>Turn an idea into your first project.</p><button class="btn btn-primary" onclick="location.hash='/app/projects'">Create a project</button></div>`;
  render(shell("/app/dashboard", `
    <div class="page-head"><div><h1>Welcome back, ${esc(S.user?.name?.split(" ")[0] || "creator")}</h1><p class="muted">Here's what matters today.</p></div><button class="btn btn-primary" onclick="location.hash='/app/projects'">+ New project</button></div>
    ${active[0] ? nextHero(active[0]) : ""}
    <div class="section-title">Active projects</div>
    <div class="grid g2">${cards}</div>
    <div class="grid" style="margin-top:16px">
      <div class="card"><div class="section-title" style="margin-top:0">Quick capture</div>
        <form onsubmit="quickIdea(event)"><input name="idea" placeholder="What's the idea? Type it fast…" required /><button class="btn btn-primary">Capture</button></form>
      </div>
      <div class="card"><div class="section-title" style="margin-top:0">AI usage</div>${usageBar(S.usage)}</div>
    </div>
  `));
}

function nextHero(p) {
  return `<div class="next-hero">
    <div class="next-kicker">NEXT ACTION</div>
    <h2>${esc(p.nextAction?.title ?? "What should I do next?")}</h2>
    <p class="muted">${esc(p.nextAction?.reason ?? "")}</p>
    <div class="next-actions">
      <button class="btn btn-primary" onclick="go.completeNext('${p.id}')">✓ Mark done</button>
      <a class="btn btn-ghost" href="#/app/projects/${p.id}">Open project</a>
    </div>
  </div>`;
}

function usageHtml(u) {
  if (!u) return `<p class="muted">Loading usage…</p>`;
  if (u.unlimited) return `<p class="muted">Unlimited AI actions on your plan.</p>`;
  const pct = Math.min(100, (u.used / u.limit) * 100);
  return `<div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
    <p class="muted">${u.used} / ${u.limit} AI actions used this month</p>`;
}

function projectCard(p) {
  return `<a class="card project-card" href="#/app/projects/${p.id}">
    <div class="pc-top"><span class="badge">${esc(typeLabel(p.type))}</span><span class="dim">${p.status}</span></div>
    <div class="pc-title">${esc(p.title)}</div>
    <div class="pc-stage muted">${esc(p.stage || p.workflow?.[p.stageIndex]?.name || "Getting started")}</div>
    <div class="meter"><div class="meter-fill" style="width:${p.progress}%"></div></div>
  </a>`;
}

// ---------------------------------------------------------------------------
// Projects list + create
// ---------------------------------------------------------------------------
async function viewProjects() {
  render(shell("/app/projects", `<div class="loading">Loading…</div>`));
  const projects = await api.listProjects();
  render(shell("/app/projects", `
    <div class="page-head"><div><h1>Projects</h1><p class="muted">${projects.length} total</p></div><button class="btn btn-primary" onclick="go.create()">+ New project</button></div>
    <div class="grid m2">${projects.map(projectCard).join("") || `<div class="empty">No projects yet.<button class="btn btn-primary" onclick="go.create()">Create a project</button></div>`}</div>
  `));
}

window.go = {
  new: () => {
    render(shell("/app/projects", newProjectForm()));
    document.getElementById("ideaInput")?.focus();
  },
  create: () => { render(shell("/app/projects", newProjectForm())); },
};

function newProjectForm() {
  return `<div class="page-head"><h1>New project</h1></div>
    <div class="card">
      <div class="section-title" style="margin-top:0">Describe your idea</div>
      <p class="muted">The AI builds a title, goal, and a full workflow with tasks from your idea.</p>
      <form onsubmit="go.generate(event)">
        <textarea id="ideaInput" class="input" rows="4" placeholder="e.g. A cozy ambient soundtrack for a snowy town…" required></textarea>
        <div class="type-row">${Object.entries(TYPES).map(([k, v]) => `<label class="type-pill"><input type="radio" name="type" value="${k}" ${k === "music" ? "checked" : ""} /> ${esc(v)}</label>`).join("")}</div>
        <button class="btn btn-primary btn-block" type="submit">✦ Build my project with AI</button>
      </form>
    </div>`;
}
const TYPES = { video: "Video", music: "Music", image: "Image", writing: "Writing", character: "Character / Art", game: "Game", content: "Content", other: "Other" };

window.go.generate = async (e) => {
  e.preventDefault();
  const idea = document.getElementById("ideaInput")?.value;
  const type = document.querySelector('input[name="type"]:checked')?.value || "music";
  if (!idea) return;
  render(shell("/app/projects", `<div class="loading">Understanding your idea…</div>`));
  try {
    const { blueprint } = await api.generate(idea, type);
    S.draft = blueprint;
    render(shell("/app/projects", reviewBlueprint(blueprint)));
  } catch (err) { toast(err.message, "error"); render(shell("/app/projects", newProjectForm())); }
};

function reviewBlueprint(bp) {
  return `<div class="page-head"><h1>Review your blueprint</h1><p class="muted">CreativeFlow built this from your idea. You can edit or regenerate.</p></div>
    <div class="card"><div class="section-title" style="margin-top:0">${esc(bp.title)}</div>
      <p>${esc(bp.summary)}</p>
      <p class="muted"><b>Goal:</b> ${esc(bp.goal)}</p>
      <p class="muted"><b>Direction:</b> ${esc(bp.direction)}</p>
    </div>
    <div class="section-title">Workflow (${bp.workflow.length} stages)</div>
    <div class="grid g3">${bp.workflow.map((s) => `<div class="card"><div class="card-title">${esc(s.name)}</div><ul>${s.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("")}</div>
    <div class="row" style="gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="go.confirm()">Create project</button>
      <button class="btn btn-ghost" onclick="location.hash='/app/projects'">Discard</button>
    </div>`;
}

window.go.confirm = async () => {
  if (!S.draft) return;
  try {
    const { project } = await api.createProject(S.draft);
    S.draft = null;
    toast("Project created!");
    location.hash = `/app/projects/${project.id}`;
  } catch (err) { toast(err.message, "error"); }
};

// ---------------------------------------------------------------------------
// Project detail
// ---------------------------------------------------------------------------
async function viewProject(id) {
  render(shell("", `<div class="loading">Loading…</div>`));
  const [p, tasks, memory, prompts, notes, assets] = await Promise.all([
    api.getProject(id), api.projectTasks(id), api.listMemory(id), api.listPrompts(), api.getNote(id), api.listAssets(id),
  ]);
  S.project = p.project; S.tasks = tasks;
  render(shell("", projectShell(p.project)));
  await mountProject(p.project, tasks, memory, prompts, notes, assets);
}

function projectShell(p) {
  return `<div class="page-head"><div><span class="badge">${esc(typeLabel(p.type))}</span><h1>${esc(p.title)}</h1><p class="muted">${esc(p.stage || "Getting started")} · ${p.progress}%</p></div></div>
    <div class="meter"><div class="meter-fill" style="width:${p.progress}%"></div></div>
    <nav class="tabs">${["overview", "tasks", "workflow", "bible", "memory", "notes", "assets"].map((t) => `<a class="tab ${t === "overview" ? "active" : ""}" href="#/app/projects/${p.id}?tab=${t}">${t}</a>`).join("")}</nav>
    <div id="tab" class="tab-content">…</div>`;
}

async function mountProject(p, tasks, memo, prompts, notes, assets) {
  const tab = new URLSearchParams(location.hash.split("?")[1] || "").get("tab") || "overview";
  const host = document.getElementById("tab");
  if (tab === "tasks") host.innerHTML = tasksHtml(p, tasks);
  else if (tab === "workflow") host.innerHTML = workflowHtml(p, tasks);
  else if (tab === "bible") host.innerHTML = bibleHtml(memo);
  else if (tab === "memory") host.innerHTML = memoryHtml(memo);
  else if (tab === "notes") host.innerHTML = notesHtml(p, notes?.note);
  else if (tab === "assets") host.innerHTML = await assetsHtml(p, assets);
  else host.innerHTML = overviewHtml(p, tasks, memo);
}

function overviewHtml(p, tasks, memo) {
  const next = p.nextAction?.title ?? "—";
  return `<div class="grid" style="margin-bottom:16px">
    <div class="card next-card"><div class="section-title" style="margin-top:0">What should I do next?</div><div class="next-title">${esc(next)}</div>
      ${p.nextAction?.taskId ? `<button class="btn btn-primary" onclick="p.doNext('${p.id}','${p.nextAction.taskId}')">Mark done</button>` : ""}</div>
    <div class="card"><div class="section-title" style="margin-top:0">Goal</div><p class="muted">${esc(p.goal)}</p></div>
  </div>
  <div class="grid g3">${p.workflow.map((s) => `<div class="card"><div class="card-title">${esc(s.name)}</div><div class="stage-progress">${s.tasks.length} tasks</div></div>`).join("")}</div>`;
}

function tasksHtml(p, tasks) {
  const byStage = {};
  for (const s of p.workflow) byStage[s.id] = [];
  for (const t of tasks) (byStage[t.stageId] ||= []).push(t);
  return `<div class="row" style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="p.addTask('${p.id}')">+ Add task</button></div>
  <div class="grid">${p.workflow.map((s) => `<div class="card"><div class="card-title">${esc(s.name)}</div>${(byStage[s.id] || []).map((t) => taskRow(p, t)).join("") || `<p class="muted">No tasks</p>`}</div>`).join("")}</div>`;
}
function taskRow(p, t) {
  const done = t.status === "done";
  return `<div class="task-row ${done ? "done" : ""}">
    <button class="check ${done ? "checked" : ""}" onclick="p.toggleTask('${p.id}','${t.id}',${done})">${done ? "✓" : ""}</button>
    <div class="task-body"><div class="task-title">${esc(t.title)}</div><div class="dim">${esc(STATUS_LABEL[t.status] || t.status)}</div></div>
    <button class="icon-btn" onclick="p.delTask('${p.id}','${t.id}')">🗑</button>
  </div>`;
}
function workflowHtml(p, tasks) {
  return `<div class="workflow"><div class="wf-progress">Stage ${p.stageIndex + 1} of ${p.workflow.length}</div>
    ${p.workflow.map((s, i) => `<div class="wf-step ${i < p.stageIndex ? "past" : i === p.stageIndex ? "current" : ""}" onclick="p.setStage('${p.id}',${i})">
      <div class="wf-num">${i + 1}</div><div class="wf-name">${esc(s.name)}</div><div class="wf-done muted">${tasks.filter((t) => t.stageId === s.id && t.status === "done").length}/${tasks.filter((t) => t.stageId === s.id).length}</div>
    </div>`).join("")}</div>`;
}
function bibleHtml(memo) {
  return `<div class="row" style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="p.addMem()">+ Add to creative bible</button></div>
    <div class="grid g2">${memo.map((m) => memoryCard(m)).join("") || `<div class="empty">No creative bible entries yet.</div>`}</div>`;
}
function memoryHtml(memo) {
  return `<div class="row" style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="p.addMem()">+ Remember</button></div>
    <div class="grid g2">${memo.map(memoryCard).join("") || `<div class="empty">Creative memory is empty.</div>`}</div>`;
}
function memoryCard(m) {
  return `<div class="card"><span class="badge badge-gray">${esc(m.category)}</span><div class="card-title" style="margin-top:6px">${esc(m.label)}</div><p class="muted">${esc(m.body)}</p><button class="btn btn-ghost btn-sm" onclick="p.delMem('${m.id}')">Delete</button></div>`;
}
function notesHtml(p, note) {
  return `<div class="card"><div class="section-title" style="margin-top:0">Project notes</div><textarea id="noteBody" class="input" style="min-height:280px" oninput="p.saveNotes('${p.id}', this.value)" placeholder="Write notes… (auto-saved)">${esc(note?.body || "")}</textarea></div>`;
}
async function assetsHtml(p, assets) {
  const cards = [];
  for (const a of assets) {
    let url = "#";
    try { url = (await api.assetUrl(a.id)).url; } catch {}
    cards.push(`<div class="card"><b>${esc(a.name)}</b><div class="muted">${esc(a.kind)} · ${a.size} bytes</div><a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Open</a><button class="icon-btn" onclick="p.delAsset('${a.id}')">🗑</button></div>`);
  }
  return `${cards.join("")}<div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="p.upload('${p.id}')">+ Upload asset</button></div>`;
}

window.p = {
  toggleTask: async (pid, tid, done) => { await api.setTaskStatus(pid, tid, done ? "todo" : "done"); location.reload(); },
  delTask: async (pid, tid) => { await api.deleteTask(pid, tid); location.reload(); },
  setStage: async (pid, idx) => { await api.setStage(pid, idx); location.reload(); },
  doNext: async (pid, tid) => { await api.setTaskStatus(pid, tid, "done"); location.reload(); },
  completeNext: async (pid) => { const p = (await api.getProject(pid)); location.hash = `/app/projects/${pid}`; },
  addTask: async (pid) => {
    const title = prompt("New task:");
    if (!title) return;
    await api.addTask(pid, { title });
    location.reload();
  },
  delMem: async (id) => { await api.deleteMemory(id); location.reload(); },
  addMem: async () => {
    const label = prompt("Memory label:");
    if (!label) return;
    const category = prompt("Category (character/location/style/…):", "fact") || "fact";
    const body = prompt("Details:") || "";
    await api.addMemory({ projectId: S.project.id, label, category, body });
    location.reload();
  },
  saveNotes: async (pid, body) => { await api.saveNote(pid, body); },
  delAsset: async (id) => { await api.deleteAsset(id); location.reload(); },
  delIdea: async (id) => { await api.deleteIdea(id); location.reload(); },
  delPrompt: async (id) => { await api.deletePrompt(id); location.reload(); },
  improve: async (id) => { try { await api.improvePrompt(id); toast("Prompt improved"); location.hash = "/app/prompts"; route(); } catch (e) { toast(e.message, "error"); } },
  upload: async (pid) => {
    const file = window.__pickFile ? await window.__pickFile() : await pickAsset();
    if (!file) return;
    try {
      const { uploadUrl, asset } = await api.createUpload({ name: file.name, mime: file.type || "application/octet-stream", kind: guessKind(file.type), projectId: pid, size: file.size });
      await putObject(uploadUrl, file);
      toast("Uploaded " + asset.name);
      location.reload();
    } catch (e) { toast(e.message, "error"); }
  },
  ask: async (e) => {
    e.preventDefault();
    const box = document.getElementById("chat-box");
    const inp = document.getElementById("askInput");
    const q = inp.value; inp.value = "";
    box.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
    try {
      const out = await api.ask(q, null, "global");
      box.insertAdjacentHTML("beforeend", `<div class="msg ai">${esc(out.answer)}</div>`);
    } catch (err) { box.insertAdjacentHTML("beforeend", `<div class="msg ai error">${esc(err.message)}</div>`); }
    box.scrollTop = box.scrollHeight;
  },
  upgrade: async (plan) => {
    if (plan === "free") { try { await api.cancel(); } catch {} toast("Cancellation scheduled"); return; }
    try {
      const { url } = await api.checkout(plan);
      if (url.includes("/api/billing/mock/")) { await api.mockComplete(plan); toast(`Upgraded to ${plan} (local demo)`); location.hash = "/app/billing"; route(); }
      else { window.location.href = url; }
    } catch (err) { toast(err.message, "error"); }
  },
};

async function viewIdeas() {
  render(shell("/app/ideas", `<div class="loading">Loading…</div>`));
  const ideas = await api.listIdeas();
  render(shell("/app/ideas", `
    <div class="page-head"><div><h1>Ideas</h1><p class="muted">${ideas.length}</p></div><button class="btn btn-primary" onclick="go.capture()">+ Capture idea</button></div>
    <div class="grid g2">${ideas.map((i) => `<div class="card"><div class="card-title">${esc(i.title)}</div><p class="muted">${esc(i.body)}</p><button class="btn btn-ghost btn-sm" onclick="p.delIdea('${i.id}')">Delete</button></div>`).join("") || `<div class="empty">No ideas yet.<button class="btn btn-primary" onclick="go.capture()">Capture an idea</button></div>`}</div>
  `));
}
window.go.capture = () => render(shell("/app/ideas", `
  <div class="page-head"><h1>Capture an idea</h1></div>
  <div class="card"><form onsubmit="go.captureSave(event)">
    <label>Title<input name="title" required /></label>
    <label>Details<textarea name="body" class="textarea"></textarea></label>
    <button class="btn btn-primary btn-block">Save idea</button>
  </form></div>`));
window.go.captureSave = async (e) => { e.preventDefault(); const f = new FormData(e.target); await api.addIdea({ title: f.get("title"), body: f.get("body") }); toast("Idea captured"); location.hash = "/app/ideas"; route(); };

async function viewPrompts() {
  render(shell("/app/prompts", `<div class="loading">Loading…</div>`));
  const prompts = await api.listPrompts();
  render(shell("/app/prompts", `
    <div class="page-head"><div><h1>Prompts</h1><p class="muted">${prompts.length}</p></div><button class="btn btn-primary" onclick="go.prompt()">+ New prompt</button></div>
    <div class="grid g2">${prompts.map((p2) => `<div class="card"><div class="card-title">${esc(p2.title)}</div><p class="muted prewrap">${esc(p2.body)}</p><div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" onclick="p.improve('${p2.id}')">Improve with AI</button><button class="btn btn-danger btn-sm" onclick="p.delPrompt('${p2.id}')">Delete</button></div></div>`).join("") || `<div class="empty">No prompts yet.<button class="btn btn-primary" onclick="go.prompt()">Create a prompt</button></div>`}</div>
  `));
}
window.go.prompt = () => render(shell("/app/prompts", `<form class="card" onsubmit="go.promptSave(event)">
  <label>Title<input name="title" /></label>
  <label>Prompt<textarea name="body" class="textarea" required></textarea></label>
  <button class="btn btn-primary btn-block">Save prompt</button></form>`));
window.go.promptSave = async (e) => { e.preventDefault(); const f = new FormData(e.target); await api.addPrompt({ title: f.get("title"), body: f.get("body") }); toast("Saved"); location.hash = "/app/prompts"; route(); };

async function viewAssistant() {
  render(shell("/app/assistant", `
    <div class="page-head"><h1>AI Assistant</h1><p class="muted">Ask about any project or your whole creative life.</p></div>
    <div class="chat"><div id="chat-box" class="chatlog"></div>
      <form class="chat-input" onsubmit="p.ask(event)">
        <input name="q" placeholder="Ask your assistant…" autocomplete="off" required />
        <button class="btn btn-primary">Send</button>
      </form></div>`));
}
window.p.ask = async (e) => {
  e.preventDefault();
  const box = document.getElementById("chat-box");
  const q = e.target.q.value;
  e.target.q.value = "";
  box.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
  try {
    const out = await api.ask(q, null, "global");
    box.insertAdjacentHTML("beforeend", `<div class="msg ai">${esc(out.answer)}</div>`);
  } catch (err) { box.insertAdjacentHTML("beforeend", `<div class="msg ai error">${esc(err.message)}</div>`); }
  box.scrollTop = box.scrollHeight;
};

async function viewSettings() {
  const u = S.user || {};
  render(shell("/app/settings", `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="card"><div class="section-title" style="margin-top:0">Account</div>
      <div class="kv"><span>Email</span><b>${esc(u.email)}</b></div>
      <div class="kv"><span>Name</span><b>${esc(u.name || "—")}</b></div>
      <div class="kv"><span>Plan</span><b>${esc(u.plan)}</b></div>
    </div>
    <div class="card"><div class="section-title" style="margin-top:0">AI usage this month</div>${usageHtml(S.usage)}</div>
    <div class="card"><button class="btn btn-ghost" onclick="signOut()">Sign out</button></div>
  `));
}

async function viewBilling() {
  render(shell("/app/billing", `
    <div class="page-head"><h1>Billing</h1><p class="muted">Choose a plan. Upgrade anytime.</p></div>
    <div class="grid g3">${plans().map((pl) => planCard(pl, S.user?.plan)).join("")}</div>
  `));
}
function plans() {
  return [
    { id: "free", name: "Free", price: "$0", note: "3 projects · 25 AI actions/mo" },
    { id: "creator", name: "Creator", price: "$9", note: "Unlimited projects · 200 AI/mo" },
    { id: "pro", name: "Pro", price: "$19", note: "Unlimited everything" },
  ];
}
function planCard(p, current) {
  const isCurrent = current === p.id;
  return `<div class="card plan-card">
    <div class="plan-name">${esc(p.name)}</div><div class="plan-price">${esc(p.price)}<span>/mo</span></div>
    <p class="muted">${esc(p.note)}</p>
    ${isCurrent ? `<button class="btn btn-ghost btn-block" disabled>Current plan</button>` : `<button class="btn btn-primary btn-block" onclick="p.upgrade('${p.id}')">${p.id === "free" ? "Downgrade" : "Upgrade"}</button>`}
  </div>`;
}
window.p.upgrade = async (plan) => {
  if (plan === "free") { try { await api.cancel(); } catch {} toast("Cancellation scheduled"); return; }
  try {
    const { url } = await api.checkout(plan);
    if (url.includes("/api/billing/mock/")) {
      // local mock mode: complete immediately
      await api.mockComplete(plan);
      toast(`Upgraded to ${plan} (local demo)`);
      location.hash = "/app/billing"; route();
    } else {
      window.location.href = url;
    }
  } catch (err) { toast(err.message, "error"); }
};

route();