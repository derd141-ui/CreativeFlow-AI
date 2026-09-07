import type { Store } from "../store/store.js";
import { hashPassword, verifyPassword, normalizeEmail, isValidEmail } from "../lib/password.js";
import { hashToken, generateSessionToken } from "../lib/tokens.js";
import { limitsFor } from "../lib/limits.js";
import { toAuthUser } from "../lib/types.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { config } from "../config.js";
import type { Deps } from "./context.js";
import type { AuthUser } from "../lib/types.js";

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export function authService({ store, clock }: Deps) {
  async function createSession(userId: string, meta?: { userAgent?: string; ip?: string }): Promise<string> {
    const token = generateSessionToken();
    const ttl = config.sessionTtlDays * 86400 * 1000;
    const expires = new Date((clock?.() ?? new Date()).getTime() + ttl);
    await store.createSession({ userId, tokenHash: hashToken(token), userAgent: meta?.userAgent, ip: meta?.ip, expiresAt: expires });
    return token;
  }

  async function register(email: string, password: string, name: string, meta?: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(email)) throw badRequest("A valid email is required.");
    if (password.length < 8) throw badRequest("Password must be at least 8 characters.");
    const existing = await store.getUserByEmailNormalized(normalized);
    if (existing) throw conflict("An account with that email already exists.", "EMAIL_TAKEN");
    const passwordHash = await hashPassword(password);
    const user = await store.createUser({ email: email.trim(), emailNormalized: normalized, passwordHash, name: name?.trim() || "" });
    const token = await createSession(user.id, meta);
    return { user: toAuthUser(user, limitsFor(user.plan).aiActionsPerMonth), token };
  }

  async function login(email: string, password: string, meta?: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const user = await store.getUserByEmailNormalized(normalizeEmail(email));
    if (!user) throw unauthorized("Incorrect email or password.");
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw unauthorized("Incorrect email or password.");
    const token = await createSession(user.id, meta);
    return { user: toAuthUser(user, limitsFor(user.plan).aiActionsPerMonth), token };
  }

  async function logout(token: string): Promise<void> {
    const session = await store.getSessionByTokenHash(hashToken(token));
    if (session) await store.deleteSession(session.id);
  }

  async function me(userId: string): Promise<AuthUser> {
    const user = await store.getUserById(userId);
    if (!user) throw unauthorized();
    return toAuthUser(user, limitsFor(user.plan).aiActionsPerMonth);
  }

  /** Parse the bearer token into a user id (null if invalid/expired). */
  async function resolveUserFromToken(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const session = await store.getSessionByTokenHash(hashToken(token));
    if (!session) return null;
    if (session.expiresAt < (clock?.() ?? new Date())) return null;
    return session.userId;
  }

  return { register, login, logout, me, resolveUserFromToken, createSession };
}

export type AuthService = ReturnType<typeof authService>;