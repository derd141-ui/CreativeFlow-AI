import { limitsFor, assertAiAllowance } from "../lib/limits.js";
import { currentMonth, type Deps } from "./context.js";

/** AI usage allowance. Free = 25/month, Creator = 200/month, Pro = unlimited. */
export function usageService({ store }: Deps) {
  /** Reset the monthly counter if the month rolled over. */
  async function maybeReset(userId: string): Promise<void> {
    const user = await store.getUserById(userId);
    if (!user) return;
    const month = currentMonth(new Date());
    if (user.aiResetMonth !== month) {
      await store.updateUser(userId, { aiUsedMonth: 0, aiResetMonth: month });
    }
  }

  /** Consume `n` AI actions. Throws 402 (PLAN_REQUIRED) if the allowance is exhausted. */
  async function consume(userId: string, projectId: string | null, action: string, n = 1): Promise<void> {
    await maybeReset(userId);
    const user = await store.getUserById(userId);
    if (!user) throw new Error("no user");
    assertAiAllowance(user.plan, user.aiUsedMonth);
    const month = currentMonth(new Date());
    await store.recordAiUsage({ ownerId: userId, projectId, action, month, tokens: 0 });
    await store.updateUser(userId, { aiUsedMonth: user.aiUsedMonth + n });
  }

  /** Summary for the usage meter. */
  async function summary(userId: string) {
    await maybeReset(userId);
    const user = await store.getUserById(userId);
    if (!user) return { used: 0, limit: 0, remaining: 0, unlimited: true };
    const limit = limitsFor(user.plan).aiActionsPerMonth;
    return { used: user.aiUsedMonth, limit, remaining: limit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - user.aiUsedMonth), unlimited: limit === 0 };
  }

  return { consume, summary };
}

export type UsageService = ReturnType<typeof usageService>;