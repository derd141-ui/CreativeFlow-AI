import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, code = "BAD_REQUEST") => new HttpError(400, code, msg);
export const unauthorized = (msg = "Authentication required") => new HttpError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You don't have access to this resource") =>
  new HttpError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new HttpError(404, "NOT_FOUND", msg);
export const conflict = (msg: string, code = "CONFLICT") => new HttpError(409, code, msg);
export const tooMany = (msg: string, code = "RATE_LIMITED") => new HttpError(429, code, msg);
export const planRequired = (msg: string, required: string) =>
  new HttpError(402, "PLAN_REQUIRED", msg, { plan: required });
export const aiExhausted = (msg = "Your monthly AI actions are exhausted") =>
  new HttpError(402, "AI_EXHAUSTED", msg);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return res.status(400).json({ error: { code: "VALIDATION", message } });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error("Unhandled error:", err);
  return res.status(500).json({ error: { code: "INTERNAL", message } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}