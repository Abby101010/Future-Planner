/* Starward server — auth middleware
 *
 * Validates Supabase JWTs on every request and resolves a userId from the
 * token's `sub` claim. Falls back to DEV_USER_ID for local development.
 *
 * THE ONLY PLACE THE USER ID IS DECIDED. If you find yourself hardcoding
 * a userId anywhere else, stop and put it here instead.
 */

import type { Request, Response, NextFunction } from "express";
import { createPublicKey } from "crypto";
import jwt from "jsonwebtoken";
import { runWithUserId } from "./requestContext";
import { query } from "../db/pool";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Extract a bearer token from a raw Authorization header value.
 * Returns null when the header is missing or not a Bearer scheme.
 * Shared between the Express middleware and the WS upgrade handler
 * so there is exactly one place that knows the token format.
 */
export function extractBearerToken(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  if (!headerValue.toLowerCase().startsWith("bearer ")) return null;
  const token = headerValue.slice(7).trim();
  return token.length > 0 ? token : null;
}

// ── ES256 JWKS public key cache ─────────────────────────

let cachedEs256Pem: string | null = null;

/**
 * Fetch the ES256 public key from Supabase's JWKS endpoint and cache it
 * as a PEM string. Called lazily on the first ES256 token we see.
 */
async function getEs256PublicKey(): Promise<string | null> {
  if (cachedEs256Pem) return cachedEs256Pem;

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[auth] SUPABASE_URL not set — cannot fetch JWKS for ES256 verification");
    return null;
  }

  try {
    const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch returned ${res.status}`);

    const { keys } = (await res.json()) as { keys: Array<Record<string, unknown>> };
    const es256Key = keys.find((k) => k.alg === "ES256");
    if (!es256Key) throw new Error("No ES256 key found in JWKS");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const publicKey = createPublicKey({ key: es256Key as any, format: "jwk" });
    cachedEs256Pem = publicKey.export({ type: "spki", format: "pem" }) as string;
    return cachedEs256Pem;
  } catch (err) {
    console.error("[auth] Failed to fetch JWKS:", (err as Error).message);
    return null;
  }
}

/**
 * Validate a bearer token and resolve a userId.
 *
 * - If DEV_USER_ID is set (local dev), bypasses JWT verification and
 *   returns that userId directly.
 * - Otherwise, reads the JWT header to determine the signing algorithm:
 *   - HS256 → verifies with SUPABASE_JWT_SECRET (anon / service-role keys)
 *   - ES256 → verifies with Supabase JWKS public key (user access tokens)
 * - Extracts `sub` as the userId and requires `role === 'authenticated'`.
 *
 * Returns `null` when the token is missing/invalid — callers should
 * translate that to a 401 response.
 */
export async function validateBearerToken(
  token: string | null | undefined,
): Promise<{ userId: string } | null> {
  if (!token) return null;

  // Dev bypass: when DEV_USER_ID is set, any token is accepted.
  const devUserId = process.env.DEV_USER_ID;
  if (devUserId) {
    return { userId: devUserId };
  }

  // Decode the JWT header to determine the signing algorithm.
  let alg: string;
  try {
    const headerJson = Buffer.from(token.split(".")[0], "base64url").toString();
    alg = (JSON.parse(headerJson) as { alg?: string }).alg ?? "HS256";
  } catch {
    console.error("[auth] Failed to decode JWT header");
    return null;
  }

  let decoded: { sub?: string; exp?: number; role?: string };

  try {
    if (alg === "ES256") {
      const pem = await getEs256PublicKey();
      if (!pem) {
        console.error("[auth] No ES256 public key available — cannot verify token");
        return null;
      }
      decoded = jwt.verify(token, pem, { algorithms: ["ES256"] }) as typeof decoded;
    } else {
      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (!jwtSecret) {
        console.error("[auth] SUPABASE_JWT_SECRET not set — cannot verify HS256 token");
        return null;
      }
      decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] }) as typeof decoded;
    }
  } catch (err) {
    console.error("[auth] JWT verify failed:", (err as Error).message);
    return null;
  }

  if (!decoded.sub) {
    console.error("[auth] JWT missing sub claim");
    return null;
  }
  if (decoded.role !== "authenticated") {
    console.error("[auth] JWT role is", decoded.role, "expected authenticated");
    return null;
  }

  return { userId: decoded.sub };
}

// ── User auto-creation ──────────────────────────────────

/** Set of userIds we've already ensured exist this process lifetime. */
const knownUsers = new Set<string>();

/**
 * Ensure a row exists in the `users` table for this userId.
 * Uses ON CONFLICT DO NOTHING so it's safe to call on every request.
 * Cached in a Set to avoid hitting the DB after the first request.
 */
async function ensureUserExists(userId: string): Promise<void> {
  if (knownUsers.has(userId)) return;

  await query(
    `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  knownUsers.add(userId);
}

// ── Express middleware ───────────────────────────────────

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization") || req.header("Authorization");
  const token = extractBearerToken(header);
  if (!token) {
    res.status(401).json({ ok: false, error: "missing Authorization header" });
    return;
  }

  const auth = await validateBearerToken(token);
  if (!auth) {
    res.status(401).json({ ok: false, error: "invalid or expired token" });
    return;
  }

  req.userId = auth.userId;

  // Ensure the user has a row in the users table (first sign-up creates it).
  try {
    await ensureUserExists(auth.userId);
  } catch (err) {
    console.error("[auth] ensureUserExists failed:", err);
    // Non-fatal: the user row may already exist or will be created by onboarding.
  }

  // Run the rest of the request inside an AsyncLocalStorage context so
  // deeply-nested code (repositories, AI handlers) can read userId
  // without it being threaded through every function signature.
  runWithUserId(auth.userId, () => next());
}
