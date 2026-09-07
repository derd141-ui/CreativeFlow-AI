import { unauthorized, badRequest } from "../lib/errors.js";
import { limitsFor } from "../lib/limits.js";
import { toAuthUser, type Plan } from "../lib/types.js";
import type { Deps } from "./context.js";

/** Stripe billing: checkout, portal, cancel, and webhook reconciliation. */
export function billingService(deps: Deps) {
  const { store, billing } = deps;

  async function requireUser(userId: string) {
    const u = await store.getUserById(userId);
    if (!u) throw unauthorized();
    return u;
  }

  async function checkout(userId: string, plan: Plan) {
    const user = await requireUser(userId);
    if (!["creator", "pro"].includes(plan)) throw badRequest("Pick Creator or Pro to upgrade.");
    const url = await billing.checkout({ id: user.id, email: user.email }, plan);
    return { url, plan };
  }

  /** Dev/test path used by MockBilling to apply a plan directly. */
  async function completeMock(userId: string, plan: Plan) {
    const user = await requireUser(userId);
    const updated = await store.updateUser(user.id, { plan, planStatus: "active" });
    return { plan, user: toAuthUser(updated!, limitsFor(updated!.plan).aiActionsPerMonth) };
  }

  async function portal(userId: string) {
    const user = await requireUser(userId);
    return { url: await billing.portal({ stripeCustomerId: user.stripeCustomerId }) };
  }

  async function cancel(userId: string) {
    const user = await requireUser(userId);
    await billing.cancel({ stripeSubscriptionId: user.stripeSubscriptionId });
    return { status: "scheduled_cancel" };
  }

  /**
   * Stripe webhook handler. Matches on `client_reference_id` (= our user id)
   * for `checkout.session.completed`, else by `stripe_customer_id`.
   */
  async function handleWebhook(body: string, signature: string) {
    const evt = await billing.parseWebhook(body, signature);

    if (evt.userId) {
      const user = await store.getUserById(evt.userId);
      if (!user) return { applied: false, reason: "user_not_found" };
      if (!evt.customerId) return { applied: false, reason: "no_customer" };
      await store.updateUser(user.id, {
        stripeCustomerId: evt.customerId,
        stripeSubscriptionId: evt.subscriptionId,
        plan: evt.plan ?? "creator",
        planStatus: "active",
      });
      return { applied: true, plan: evt.plan ?? "creator" };
    }

    if (!evt.customerId) return { applied: false, reason: "no_customer" };
    const user = await store.getUserByStripeCustomer(evt.customerId);
    if (!user) return { applied: false, reason: "user_not_matched" };

    if (evt.status === "canceled" || evt.status === "unpaid" || !evt.plan) {
      await store.updateUser(user.id, { plan: "free", planStatus: "canceled" });
    } else {
      await store.updateUser(user.id, {
        plan: evt.plan,
        planStatus: evt.status === "past_due" ? "past_due" : "active",
        stripeSubscriptionId: evt.subscriptionId,
      });
    }
    return { applied: true, plan: evt.plan ?? "free" };
  }

  return { checkout, completeMock, portal, cancel, handleWebhook };
}

export type BillingService = ReturnType<typeof billingService>;