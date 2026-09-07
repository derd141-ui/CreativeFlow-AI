import type { Deps } from "./context.js";
import { authService } from "./authService.js";
import { usageService } from "./usageService.js";
import { projectService } from "./projectService.js";
import { libraryService } from "./libraryService.js";
import { assetService } from "./assetService.js";
import { assistantService } from "./assistantService.js";
import { billingService } from "./billingService.js";

/** Builds every service once and shares them across routes. */
export function buildServices(deps: Deps) {
  const auth = authService(deps);
  const usage = usageService(deps);
  const projects = projectService(deps, usage);
  const library = libraryService(deps, usage);
  const assets = assetService(deps);
  const assistant = assistantService(deps, usage);
  const billing = billingService(deps);
  return { auth, usage, projects, library, assets, assistant, billing };
}

export type Services = ReturnType<typeof buildServices>;