import type { Store } from "../store/store.js";
import type { Storage } from "../lib/storage.js";
import type { Billing } from "../lib/billing.js";
import type { AiProvider } from "../ai/router.js";

/** Services share this container so tests can inject fakes. */
export interface Deps {
  store: Store;
  storage: Storage;
  billing: Billing;
  ai: AiProvider;
  clock?: () => Date;
}

export function currentMonth(d: Date): number {
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}