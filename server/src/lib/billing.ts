import Stripe from "stripe";
import { config } from "../config.js";
import type { Plan } from "./types.js";
import { badRequest } from "./errors.js";

/** Normalized representation of a Stripe billing event. */
export interface BillingEvent {
  /** Our user id, when known (checkout client_reference_id). */
  userId: string | null;
  /** Stripe customer id (null if the event isn't about a customer). */
  customerId: string | null;
  subscriptionId: string | null;
  /** Resolved plan for the subscription, or null when downgrading/canceled. */
  plan: Plan | null;
  status: string | null;
}

/**
 * Billing abstraction. Two implementations:
 *   - StripeBilling: real Stripe subscriptions (Checkout + webhooks).
 *   - MockBilling: local dev / test implementation with no network dependency.
 * Both expose the same surface so routes and tests are identical.
 */
export interface Billing {
  isLive(): boolean;
  /** The plan's Stripe price id (or readable code in mock mode). */
  priceFor(plan: Plan): string;
  /** Start Checkout for the given plan. Returns a redirect URL. */
  checkout(user: { id: string; email: string }, plan: Plan): Promise<string>;
  /** Create a billing portal session. */
  portal(user: { stripeCustomerId: string | null }): Promise<string>;
  /** Pause a subscription at period end. */
  cancel(user: { stripeSubscriptionId: string | null }): Promise<void>;
  /** Parse a webhook payload into a normalized BillingEvent. */
  parseWebhook(body: string, signature: string): Promise<BillingEvent>;
}

const planToPrice: Record<Plan, string> = {
  free: config.stripe.prices.free,
  creator: config.stripe.prices.creator,
  pro: config.stripe.prices.pro,
};

export class StripeBilling implements Billing {
  private stripe: Stripe;
  constructor() {
    if (!config.stripe.secretKey) throw new Error("STRIPE_SECRET_KEY required when STRIPE_ENABLED=true");
    this.stripe = new Stripe(config.stripe.secretKey);
  }
  isLive(): boolean { return true; }
  priceFor(plan: Plan): string { return planToPrice[plan]; }

  async checkout(user: { id: string; email: string }, plan: Plan): Promise<string> {
    if (plan === "free") throw badRequest("The free plan doesn't need checkout.");
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [{ price: planToPrice[plan], quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: { plan },
    });
    return session.url!;
  }
  async portal(user: { stripeCustomerId: string | null }): Promise<string> {
    if (!user.stripeCustomerId) throw badRequest("No Stripe customer on this account yet.");
    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: config.stripe.successUrl,
    });
    return session.url!;
  }
  async cancel(user: { stripeSubscriptionId: string | null }): Promise<void> {
    if (!user.stripeSubscriptionId) throw badRequest("No active subscription.");
    await this.stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
  }
  async parseWebhook(body: string, signature: string): Promise<BillingEvent> {
    const event = this.stripe.webhooks.constructEvent(body, signature, config.stripe.webhookSecret!);
    return normalizeStripeEvent(event);
  }
}

export class MockBilling implements Billing {
  isLive(): boolean { return false; }
  priceFor(plan: Plan): string { return planToPrice[plan]; }
  async checkout(user: { id: string; email: string }, plan: Plan): Promise<string> {
    // Local: the frontend "completes" checkout via /api/billing/mock/complete.
    return `${config.publicOrigin}/api/billing/mock/complete?plan=${plan}&userId=${user.id}`;
  }
  async portal(): Promise<string> { return `${config.publicOrigin}/app/billing`; }
  async cancel(): Promise<void> { /* mock */ }
  async parseWebhook(): Promise<BillingEvent> {
    throw badRequest("Mock billing has no webhook; use /api/billing/mock/complete instead.");
  }
}

function normalizeStripeEvent(event: Stripe.Event): BillingEvent {
  const base: BillingEvent = { userId: null, customerId: null, subscriptionId: null, plan: null, status: null };
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      return { ...base, userId: (s.client_reference_id as string) ?? null, customerId: (s.customer as string) ?? null, subscriptionId: (s.subscription as string) ?? null, plan: (s.metadata?.plan as Plan) ?? null, status: "active" };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id;
      return { ...base, customerId: (sub.customer as string) ?? null, subscriptionId: sub.id, plan: planFromPrice(priceId), status: sub.status };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return { ...base, customerId: (sub.customer as string) ?? null, subscriptionId: sub.id, plan: null, status: "canceled" };
    }
    default:
      return base;
  }
}

function planFromPrice(priceId: string | undefined): Plan | null {
  const inv: Record<string, Plan> = {
    [planToPrice.free]: "free",
    [planToPrice.creator]: "creator",
    [planToPrice.pro]: "pro",
  };
  return priceId ? inv[priceId] ?? null : null;
}

export function makeBilling(): Billing {
  return config.stripe.enabled ? new StripeBilling() : new MockBilling();
}