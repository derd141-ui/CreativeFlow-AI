import { Router } from "express";
import type { Services } from "../services/index.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Demo seeding (spec §65): builds the four sample projects — Frozen Wasteland
 * (video), Dark Industrial Track (music), Gothic Detective (character), and
 * the AI Creator YouTube Channel (content) — with tasks, prompts, creative
 * memory, and notes. Demo data only ever lands in the account that requested it.
 */
export function demoRoutes(svc: Services): Router {
  const r = Router();
  const uid = (res: any) => res.locals.userId;
  r.use(requireAuth(svc.auth));

  r.post("/seed", async (req, res, next) => {
    try {
      const ownerId = uid(res);
      // Demo accounts get Pro so the four seeded sample projects are explorable
      // (the Free plan caps active projects at 3). Demo data only lives here.
      await svc.billing.completeMock(ownerId, "pro");
      const seeded = await seedDemoData(svc, ownerId);
      res.json({ seeded, projects: seeded });
    } catch (e) { next(e); }
  });

  return r;
}

async function seedDemoData(svc: Services, ownerId: string): Promise<unknown[]> {
  const P = svc.projects;
  const L = svc.library;
  const made: unknown[] = [];

  const defs = [
    {
      title: "Frozen Wasteland", type: "video",
      summary: "A dark cinematic music video of a Viking warrior fighting supernatural creatures in a frozen wasteland.",
      goal: "Produce a 90-second cinematic music film with a strong central character.",
      direction: "Moody, high-contrast, desaturated blues and greys, slow-crawl camerawork.",
      workflow: [
        { id: "stage_1", name: "Concept & Story", tasks: ["Write the creative brief", "Draft the logline", "Outline the story beats", "Lock the visual mood"] },
        { id: "stage_2", name: "Pre-Production", tasks: ["Write the script", "Build a shot list", "Plan locations", "Cast the warrior"] },
        { id: "stage_3", name: "Production", tasks: ["Capture primary footage", "Capture b-roll", "Record foley"] },
        { id: "stage_4", name: "Post-Production", tasks: ["Assemble the rough cut", "Add sound design", "Color grade"] },
        { id: "stage_5", name: "Deliver", tasks: ["Export at 1080p", "Create a thumbnail", "Publish"] },
      ],
      memory: [{ category: "character", label: "The Warrior", body: "Broken, stoic, fights through the storm." }, { category: "location", label: "The Wasteland", body: "Endless frozen plain, jagged ice, red-grey sky." }, { category: "style", label: "Palette", body: "Desaturated blue-greys with a single cold accent." }],
      prompts: [{ title: "Frozen wasteland plate", body: "A vast frozen wasteland, a lone warrior silhouette, cinematic lighting, highly detailed, desaturated." }],
      idea: "Music video: Viking warrior vs supernatural creatures in a frozen wasteland.",
    },
    {
      title: "Dark Industrial Track", type: "music",
      summary: "A heavy industrial electronic track with driving percussion and a dark atmosphere.",
      goal: "Write, produce, and mix a finished industrial track.",
      direction: "Dark, driving, layered percussion, minor key, huge low-end.",
      workflow: [
        { id: "stage_1", name: "Compose", tasks: ["Write the chord progression", "Set the tempo and key", "Draft the arrangement"] },
        { id: "stage_2", name: "Produce", tasks: ["Design the sound palette", "Program the drums", "Layer the textures"] },
        { id: "stage_3", name: "Mix", tasks: ["Balance the mix", "Add automation"] },
        { id: "stage_4", name: "Master & Release", tasks: ["Master to target loudness", "Create cover art", "Upload to distribution"] },
      ],
      memory: [{ category: "preference", label: "Reference", body: "Massive Attack meets Nine Inch Nails texture." }],
      prompts: [{ title: "industrial kick", body: "Distorted, punchy industrial kick with a long sub tail." }],
      ideas: "Dark industrial track with a driving, hypnotic rhythm.",
    },
    {
      title: "Gothic Detective", type: "character",
      summary: "A gothic noir detective character design: trench coat, fedora, occult symbols.",
      goal: "Produce a complete character reference pack.",
      direction: "Gothic noir, muted blacks with emerald and gold accents, high-detail linework.",
      workflow: [
        { id: "stage_1", name: "Concept", tasks: ["Write the character bio", "Define personality", "Sketch silhouettes"] },
        { id: "stage_2", name: "Design", tasks: ["Lock the face", "Design the wardrobe", "Build the turnaround"] },
        { id: "stage_3", name: "Deliver", tasks: ["Produce the expression sheet", "Produce action poses", "Package the pack"] },
      ],
      memory: [{ category: "character", label: "The Detective", body: "Jaded, sharp, keeps a silver pocket watch." }],
      prompts: [],
      ideas: "Gothic detective OC with an occult twist.",
    },
    {
      title: "AI Creator YouTube Channel", type: "content",
      summary: "A channel teaching AI-assisted creativity: workflows, tools and case studies.",
      goal: "Launch a channel that publishes a consistent weekly tutorial.",
      direction: "Clear, energetic, studio-lighting, helpful and structured content.",
      workflow: [
        { id: "stage_1", name: "Position", tasks: ["Define the channel", "Define the value promise", "Define the content pillars"] },
        { id: "stage_2", name: "Build", tasks: ["Design the branding", "Set up the pipeline", "Write three pilots"] },
        { id: "stage_3", name: "Publish", tasks: ["Produce the first three videos", "Set the cadence", "Launch"] },
        { id: "stage_4", name: "Grow", tasks: ["Review analytics", "Double down", "Plan the next batch"] },
      ],
      memory: [],
      prompts: [],
      ideas: "YouTube channel teaching AI creativity workflows.",
    },
  ];

  for (const d of defs) {
    const project = await P.createProject(ownerId, { title: d.title, type: d.type, summary: d.summary, goal: d.goal, direction: d.direction, workflow: d.workflow });
    for (const m of d.memory) { await L.saveMemory(ownerId, { projectId: project.id, ...m }); }
    for (const p of d.prompts ?? []) { await L.savePrompt(ownerId, { title: p.title, body: p.body, projectId: project.id }); }
    if (d.ideas) await L.captureIdea(ownerId, { title: d.ideas, projectId: project.id });
    made.push(project);
  }
  return made;
}