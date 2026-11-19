/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backend security primitives, atomic JSON disk IO, password hashing,
 * persisted session store, Google Bearer token verification cache,
 * rate limiting, origin validation, and input sanitization.
 */

import type express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import type {
  AuthUser,
  CachedGoogleTokenVerification,
  PersistedSessionRecord,
  RateLimitBucket,
  StoredTeacherAccount,
} from "./types";

// Primary owner accounts that use the root data/*.json files for backward compatibility
export const PRIMARY_OWNER_IDENTIFIERS = new Set([
  "jorge.cano@fds-esc.edu.ar",
  "canomorenojj@gmail.com",
  "global_shared_workspace_v1",
]);

// Active user sessions isolated by email so multiple teachers do not share or leak sessions
export const activeUsersByEmail = new Map<string, AuthUser>();
export const savedOAuthTokensByEmail = new Map<string, string>();
export const teacherAccountsByEmail = new Map<string, StoredTeacherAccount>();
export const persistedSessionsByEmail = new Map<string, PersistedSessionRecord>();

const TEACHER_ACCOUNTS_FILE = path.join(process.cwd(), "data", "users", "teacher-accounts.json");
const ACTIVE_SESSIONS_FILE = path.join(process.cwd(), "data", "users", "active-sessions.json");
const SESSION_SECRET_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const googleTokenVerificationCache = new Map<string, CachedGoogleTokenVerification>();
const GOOGLE_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const apiRateLimitBuckets = new Map<string, RateLimitBucket>();
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const RATE_LIMIT_MAX_GENERAL = 300; // 300 req/min per IP for normal classroom operations
export const RATE_LIMIT_MAX_HEAVY = 25; // 25 req/min for heavy file/reset operations
export const RATE_LIMIT_MAX_LOGIN_IP = 15; // 15 login attempts/min per IP
export const RATE_LIMIT_MAX_LOGIN_EMAIL = 10; // 10 login attempts/min per target email
export const RATE_LIMIT_MAX_SESSION = 30; // 30 session syncs/min per IP
export const RATE_LIMIT_MAX_PROXY = 20; // 20 remote document fetches/min per IP

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of apiRateLimitBuckets.entries()) {
    if (now >= bucket.resetAt) {
      apiRateLimitBuckets.delete(key);
    }
  }
  for (const [tokenKey, cached] of googleTokenVerificationCache.entries()) {
    if (now >= cached.expiresAt) {
      googleTokenVerificationCache.delete(tokenKey);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

export function writeJsonFileAtomic(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

export function hashSessionSecret(secret: string): string {
  return crypto.createHash("sha256").update(`docencia_sess_v1:${secret}`).digest("hex");
}

export function loadActiveSessionsFromDisk(): void {
  try {
    if (!fs.existsSync(ACTIVE_SESSIONS_FILE)) return;
    const raw = fs.readFileSync(ACTIVE_SESSIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const sessionsObj = parsed?.sessions || parsed;
    const now = Date.now();
    if (sessionsObj && typeof sessionsObj === "object") {
      for (const [emailKey, rec] of Object.entries(sessionsObj)) {
        const record = rec as Partial<PersistedSessionRecord> | null;
        if (
          record &&
          typeof record.hash === "string" &&
          typeof record.expiresAt === "number" &&
          record.expiresAt > now
        ) {
          persistedSessionsByEmail.set(emailKey.trim().toLowerCase(), {
            hash: record.hash,
            expiresAt: record.expiresAt,
          });
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load active sessions from disk:", e);
  }
}

export function saveActiveSessionsToDisk(): void {
  try {
    const now = Date.now();
    const sessionsObj: Record<string, PersistedSessionRecord> = {};
    for (const [k, v] of persistedSessionsByEmail.entries()) {
      if (v.expiresAt > now) {
        sessionsObj[k] = v;
      } else {
        persistedSessionsByEmail.delete(k);
      }
    }
    writeJsonFileAtomic(ACTIVE_SESSIONS_FILE, { sessions: sessionsObj });
  } catch (e) {
    console.warn("Failed to save active sessions to disk:", e);
  }
}

export function persistSessionSecret(email: string, secret: string): void {
  const cleanEmail = email.trim().toLowerCase();
  const cleanSecret = secret.trim();
  if (!cleanEmail || !cleanSecret) return;
  persistedSessionsByEmail.set(cleanEmail, {
    hash: hashSessionSecret(cleanSecret),
    expiresAt: Date.now() + SESSION_SECRET_TTL_MS,
  });
  saveActiveSessionsToDisk();
}

export function revokePersistedSessionSecret(email: string): void {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return;
  if (persistedSessionsByEmail.delete(cleanEmail)) {
    saveActiveSessionsToDisk();
  }
}

export async function verifyGoogleBearerToken(rawToken: string): Promise<string | null> {
  const candidateToken = String(rawToken || "").trim();
  if (candidateToken.length <= 20 || candidateToken.startsWith("token_")) {
    return null;
  }
  const cacheKey = crypto.createHash("sha256").update(candidateToken).digest("hex");
  const now = Date.now();
  const cached = googleTokenVerificationCache.get(cacheKey);
  if (cached) {
    if (now < cached.expiresAt) {
      return cached.email;
    }
    googleTokenVerificationCache.delete(cacheKey);
  }

  try {
    const googleVerifyRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${candidateToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!googleVerifyRes.ok) {
      return null;
    }
    const info: any = await googleVerifyRes.json().catch(() => ({}));
    const verifiedEmail = String(info?.email || "").trim().toLowerCase();
    if (!verifiedEmail || !verifiedEmail.includes("@")) {
      return null;
    }
    googleTokenVerificationCache.set(cacheKey, {
      email: verifiedEmail,
      expiresAt: now + GOOGLE_TOKEN_CACHE_TTL_MS,
    });
    return verifiedEmail;
  } catch {
    return null;
  }
}

function hashTeacherPasswordLegacySha256(password: string, email: string): string {
  const cleanEmail = email.trim().toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`docencia_v1:${cleanEmail}:${password}`)
    .digest("hex");
}

export function hashTeacherPassword(password: string, _email: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt1:${salt}:${derived}`;
}

export function verifyTeacherPassword(
  password: string,
  email: string,
  storedHash: string
): { valid: boolean; needsUpgrade: boolean } {
  if (!storedHash || !password) return { valid: false, needsUpgrade: false };
  if (storedHash.startsWith("scrypt1:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return { valid: false, needsUpgrade: false };
    const [, salt, expectedHex] = parts;
    try {
      const derived = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(expectedHex, "hex");
      if (derived.length !== expected.length) return { valid: false, needsUpgrade: false };
      return { valid: crypto.timingSafeEqual(derived, expected), needsUpgrade: false };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }
  const legacyHash = hashTeacherPasswordLegacySha256(password, email);
  try {
    const a = Buffer.from(legacyHash, "utf8");
    const b = Buffer.from(storedHash, "utf8");
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid: match, needsUpgrade: match };
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}

export function loadTeacherAccountsFromDisk(): void {
  try {
    if (fs.existsSync(TEACHER_ACCOUNTS_FILE)) {
      const raw = fs.readFileSync(TEACHER_ACCOUNTS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [emailKey, acc] of Object.entries(parsed.accounts || parsed)) {
          if (acc && typeof acc === "object" && (acc as any).passwordHash) {
            teacherAccountsByEmail.set(emailKey.trim().toLowerCase(), acc as StoredTeacherAccount);
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load teacher accounts from disk:", e);
  }
}

export function saveTeacherAccountsToDisk(): void {
  try {
    const accountsObj: Record<string, StoredTeacherAccount> = {};
    for (const [k, v] of teacherAccountsByEmail.entries()) {
      accountsObj[k] = v;
    }
    writeJsonFileAtomic(TEACHER_ACCOUNTS_FILE, { accounts: accountsObj });
  } catch (e) {
    console.warn("Failed to save teacher accounts to disk:", e);
  }
}

export function hasValidSessionSecret(email: string, providedSecret: string): boolean {
  const cleanEmail = email.trim().toLowerCase();
  const secret = providedSecret.trim();
  if (!cleanEmail || !secret) return false;
  const active = activeUsersByEmail.get(cleanEmail);
  if (active?.sessionSecret) {
    try {
      const a = Buffer.from(active.sessionSecret, "utf8");
      const b = Buffer.from(secret, "utf8");
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true;
      }
    } catch {
      // fall through to persisted session check
    }
  }
  const persisted = persistedSessionsByEmail.get(cleanEmail);
  if (persisted && persisted.expiresAt > Date.now()) {
    try {
      const providedHash = hashSessionSecret(secret);
      const a = Buffer.from(persisted.hash, "utf8");
      const b = Buffer.from(providedHash, "utf8");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  return false;
}

export function requireAuthenticatedSession(req: express.Request, res: express.Response): boolean {
  if (typeof res.locals?.authenticatedEmail === "string" && res.locals.authenticatedEmail) {
    return true;
  }
  const reqEmail = String(req.headers["x-user-email"] || req.body?.email || "").trim().toLowerCase();
  const providedSecret = String(req.headers["x-session-secret"] || req.body?.sessionSecret || "").trim();
  if (!hasValidSessionSecret(reqEmail, providedSecret)) {
    res.status(401).json({
      success: false,
      error: "Sesión no verificada. Iniciá sesión nuevamente para realizar esta acción.",
    });
    return false;
  }
  res.locals.authenticatedEmail = reqEmail;
  return true;
}

export function consumeRateLimitBucket(
  bucketKey: string,
  maxAllowed: number,
  res: express.Response
): boolean {
  const now = Date.now();
  let bucket = apiRateLimitBuckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    apiRateLimitBuckets.set(bucketKey, bucket);
    return true;
  }
  bucket.count += 1;
  if (bucket.count > maxAllowed) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      success: false,
      error: "Demasiadas solicitudes en poco tiempo. Por favor, aguarde unos segundos e intente nuevamente.",
    });
    return false;
  }
  return true;
}

const AUTHORIZED_SERVER_ORIGINS = new Set([
  "https://ais-dev-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app",
  "https://ais-pre-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function configureAuthorizedOriginsFromEnv(): void {
  const envAllowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  for (const orig of envAllowedOrigins) {
    AUTHORIZED_SERVER_ORIGINS.add(orig);
  }
}

export function isAuthorizedOriginUrl(rawOrigin: string, currentHost?: string): boolean {
  if (AUTHORIZED_SERVER_ORIGINS.has(rawOrigin)) return true;
  try {
    const parsed = new URL(rawOrigin);
    if (currentHost && parsed.host === currentHost) return true;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

const PROTO_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function stripPrototypePollutionKeys(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      stripPrototypePollutionKeys(item, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PROTO_POLLUTION_KEYS.has(key)) {
      delete record[key];
    } else {
      stripPrototypePollutionKeys(record[key], depth + 1);
    }
  }
}

// Input Sanitization Helper for Backend Data Routes (ISO/IEC 27001 A.8.28)
export function sanitizeServerInputText(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, "")
    .trim()
    .slice(0, maxLength);
}
