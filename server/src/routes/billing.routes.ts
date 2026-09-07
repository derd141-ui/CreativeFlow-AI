import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/index.js";
import { requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";

export function billingRoutes(svc: Services): Router {
  const r = Router();
  const uid = (res: any) => res.locals.userId;

  r.post("/checkout", requireAuth(svc.auth), async (req, res, next) => {
    try {
      const b = z.object({ plan: z.enum(["creator", "pro"]) }).parse(req.body);
      res.json(await svc.billing.checkout(uid(res), b.plan));
    } catch (e) { next(e); }
  });

  r.get("/portal", requireAuth(svc.auth), async (_req, res, next) => {
    try { res.json(await svc.billing.portal(uid(res))); } catch (e) { next(e); }
  });

  r.post("/cancel", requireAuth(svc.auth), async (_req, res, next) => {
    try { res.json(await svc.billing.cancel(uid(res))); } catch (e) { next(e); }
  });

  // Mock-billing completion path (dev/test only; disabled when live Stripe is on).
  r.post("/mock/complete", requireAuth(svc.auth), async (req, res, next) => {
    try {
      if (svc.billing.constructor.name === "StripeBilling") throw badRequest("Mock billing is disabled.");
      const b = z.object({ plan: z.enum(["creator", "pro"]) }).parse(req.body);
      res.json(await svc.billing.completeMock(uid(res), b.plan));
    } catch (e) { next(e); }
  });

  // Stripe webhook (no auth; verified by signature).
  r.post("/webhook", async (req, res, next) => {
    try {
      const signature = req.headers["stripe-signature"];
      if (!signature) throw badRequest("Missing Stripe signature.");
      const body = req.rawBody ?? JSON.stringify(req.body);
      const out = await svc.billing.handleWebhook(body as string, signature as string);
      res.json(out);
    } catch (e) { next(e); }
  });

  r.get("/config", (_req, res) => {
    res.json({ stripeEnabled: config.stripe.enabled, prices: config.stripe.prices });
  });

  return r;
}