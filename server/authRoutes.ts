/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication & teacher session HTTP routes (`/api/auth/*`).
 */

import type express from "express";
import crypto from "crypto";
import type { AuthUser } from "./types";
import {
  activeUsersByEmail,
  hasValidSessionSecret,
  hashTeacherPassword,
  persistSessionSecret,
  persistedSessionsByEmail,
  revokePersistedSessionSecret,
  saveTeacherAccountsToDisk,
  savedOAuthTokensByEmail,
  teacherAccountsByEmail,
  verifyGoogleBearerToken,
  verifyTeacherPassword,
} from "./security";

const DEFAULT_TEACHER_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.announcements",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const DEFAULT_TEACHER_PERMISSIONS = [
  "tasks.create",
  "tasks.assign",
  "tasks.grade",
  "tasks.delete",
  "drive.read",
  "drive.attach",
  "classroom.sync",
  "students.view",
  "grades.manage",
];

function deriveDefaultSchoolName(cleanEmail: string): string {
  if (cleanEmail.includes("fds-esc.edu.ar")) {
    return "FDS - Educación Secundaria";
  }
  if (cleanEmail.includes("@")) {
    return `Institución ${cleanEmail.split("@")[1].split(".")[0].toUpperCase()}`;
  }
  return "Institución Educativa";
}

export function registerAuthRoutes(app: express.Express): void {
  // Authentication & Session endpoints (strictly isolated per teacher email & sessionSecret)
  app.get("/api/auth/user", (req, res) => {
    const requestedEmail = String(req.query.email || req.headers["x-user-email"] || "")
      .trim()
      .toLowerCase();
    const providedSecret = String(req.headers["x-session-secret"] || "").trim();

    if (!requestedEmail) {
      return res.json({
        authenticated: false,
        user: null,
        token: null,
      });
    }

    const matchedUser = activeUsersByEmail.get(requestedEmail) || null;
    if (!matchedUser || !hasValidSessionSecret(requestedEmail, providedSecret)) {
      return res.json({
        authenticated: false,
        user: null,
        token: null,
      });
    }

    const { sessionSecret: _hiddenSecret, ...safeUser } = matchedUser;
    res.json({
      authenticated: true,
      user: safeUser,
      token: matchedUser.token || savedOAuthTokensByEmail.get(requestedEmail) || null,
    });
  });

  app.post("/api/auth/login-email", async (req, res) => {
    try {
      const { email, password, name, token } = req.body || {};
      const cleanEmail = String(email || "").trim().toLowerCase();
      const rawPassword = String(password || "").trim();

      if (!cleanEmail || !cleanEmail.includes("@")) {
        return res.status(400).json({
          success: false,
          error: "Por favor ingresá un correo electrónico docente válido.",
        });
      }

      // Verify any supplied Google OAuth token cryptographically before trusting it
      let verifiedIncomingToken: string | undefined;
      if (typeof token === "string" && token.trim().length > 20 && !token.trim().startsWith("token_")) {
        const candidateToken = token.trim();
        const verifiedEmail = await verifyGoogleBearerToken(candidateToken);
        if (verifiedEmail && verifiedEmail === cleanEmail) {
          verifiedIncomingToken = candidateToken;
        }
      }

      const existingAccount = teacherAccountsByEmail.get(cleanEmail);

      if (existingAccount && existingAccount.passwordHash) {
        if (!rawPassword) {
          return res.status(401).json({
            success: false,
            error: "Esta cuenta tiene clave registrada. Por favor ingresá tu contraseña para continuar.",
          });
        }
        const verification = verifyTeacherPassword(rawPassword, cleanEmail, existingAccount.passwordHash);
        if (!verification.valid) {
          return res.status(401).json({
            success: false,
            error: "Contraseña incorrecta para esta cuenta docente. Verificá tu clave.",
          });
        }
        if (verification.needsUpgrade) {
          existingAccount.passwordHash = hashTeacherPassword(rawPassword, cleanEmail);
          existingAccount.updatedAt = new Date().toISOString();
          saveTeacherAccountsToDisk();
        }
      } else if (rawPassword) {
        // First-time password registration for this email
        const incomingHash = hashTeacherPassword(rawPassword, cleanEmail);
        const cleanNameForAccount =
          name ||
          (cleanEmail
            ? cleanEmail
                .split("@")[0]
                .replace(/[._-]/g, " ")
            : "Docente Titular");
        const displayNameForAccount = cleanNameForAccount.startsWith("Prof.")
          ? cleanNameForAccount
          : `Prof. ${cleanNameForAccount}`;

        teacherAccountsByEmail.set(cleanEmail, {
          email: cleanEmail,
          passwordHash: incomingHash,
          name: displayNameForAccount,
          school: deriveDefaultSchoolName(cleanEmail),
          updatedAt: new Date().toISOString(),
        });
        saveTeacherAccountsToDisk();
      } else if (!verifiedIncomingToken) {
        return res.status(401).json({
          success: false,
          error: "Por favor ingresá una contraseña o iniciá sesión con Google para continuar.",
        });
      }

      const existingUser = activeUsersByEmail.get(cleanEmail);
      const storedAccount = teacherAccountsByEmail.get(cleanEmail);
      const cleanName =
        name ||
        existingUser?.name ||
        storedAccount?.name ||
        (cleanEmail ? cleanEmail.split("@")[0].replace(/[._-]/g, " ") : "Docente Titular");
      const displayName = cleanName.startsWith("Prof.") ? cleanName : `Prof. ${cleanName}`;
      const validToken =
        verifiedIncomingToken || existingUser?.token || savedOAuthTokensByEmail.get(cleanEmail);

      if (verifiedIncomingToken) {
        savedOAuthTokensByEmail.set(cleanEmail, verifiedIncomingToken);
      }

      const sessionSecret = crypto.randomBytes(24).toString("hex");
      const sessionUser: AuthUser = {
        id: existingUser?.id || `teacher_${cleanEmail.replace(/[^a-zA-Z0-9]/g, "_")}`,
        email: cleanEmail,
        name: displayName,
        avatar:
          existingUser?.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1d4ed8&color=ffffff&bold=true&size=150`,
        role: "Docente Titular",
        school:
          existingUser?.school ||
          storedAccount?.school ||
          deriveDefaultSchoolName(cleanEmail),
        scopes: existingUser?.scopes || [...DEFAULT_TEACHER_SCOPES],
        permissions: [...DEFAULT_TEACHER_PERMISSIONS],
        lastLogin: new Date().toISOString(),
        sessionSecret,
        ...(validToken ? { token: validToken } : {}),
      };

      activeUsersByEmail.set(cleanEmail, sessionUser);
      persistSessionSecret(cleanEmail, sessionSecret);
      const { sessionSecret: _hidden, ...safeUser } = sessionUser;

      return res.json({
        success: true,
        user: safeUser,
        sessionSecret,
        token: sessionUser.token || null,
      });
    } catch (err: any) {
      console.error("Error in /api/auth/login-email:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Error al iniciar sesión con correo y contraseña",
      });
    }
  });

  app.post("/api/auth/session", async (req, res) => {
    try {
      const { uid, email, name, avatar, scopes, school, token } = req.body || {};
      const cleanEmail = (email || "").trim().toLowerCase();
      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: "Email requerido para sincronizar sesión" });
      }
      const existingUser = activeUsersByEmail.get(cleanEmail);
      const providedSecret = String(req.headers["x-session-secret"] || req.body?.sessionSecret || "").trim();
      const callerHasValidSecret = hasValidSessionSecret(cleanEmail, providedSecret);

      // Verify Google OAuth access token directly with Google userinfo (cached 5 min) before trusting it or issuing a privileged sessionSecret
      let verifiedIncomingToken: string | undefined;
      if (typeof token === "string" && token.trim().length > 20 && !token.trim().startsWith("token_")) {
        const candidateToken = token.trim();
        const verifiedEmail = await verifyGoogleBearerToken(candidateToken);
        if (verifiedEmail && verifiedEmail === cleanEmail) {
          verifiedIncomingToken = candidateToken;
        }
      }

      const isVerifiedCaller = callerHasValidSecret || Boolean(verifiedIncomingToken);

      const cleanName = name || existingUser?.name || (cleanEmail ? cleanEmail.split("@")[0].replace(/[._-]/g, " ") : "Docente Titular");
      const displayName = cleanName.startsWith("Prof.") ? cleanName : `Prof. ${cleanName}`;
      const validToken = isVerifiedCaller
        ? verifiedIncomingToken || existingUser?.token || savedOAuthTokensByEmail.get(cleanEmail)
        : undefined;

      if (verifiedIncomingToken) {
        savedOAuthTokensByEmail.set(cleanEmail, verifiedIncomingToken);
      }

      // Only issue or retain a sessionSecret when the caller proved ownership via Google token or existing valid secret
      const sessionSecret = isVerifiedCaller
        ? (callerHasValidSecret ? (existingUser?.sessionSecret || providedSecret) : crypto.randomBytes(24).toString("hex"))
        : undefined;

      const sessionUser: AuthUser = {
        id: uid || existingUser?.id || `user-${Date.now()}`,
        email: cleanEmail,
        name: displayName,
        avatar: (avatar && !avatar.includes("photo-1534528741775"))
          ? avatar
          : existingUser?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1d4ed8&color=ffffff&bold=true&size=150`,
        role: "Docente Titular",
        school: school || existingUser?.school || deriveDefaultSchoolName(cleanEmail),
        scopes: Array.isArray(scopes) ? scopes : [...DEFAULT_TEACHER_SCOPES],
        permissions: [...DEFAULT_TEACHER_PERMISSIONS],
        lastLogin: new Date().toISOString(),
        ...(sessionSecret ? { sessionSecret } : existingUser?.sessionSecret ? { sessionSecret: existingUser.sessionSecret } : {}),
        ...(validToken ? { token: validToken } : existingUser?.token ? { token: existingUser.token } : {}),
      };

      if (isVerifiedCaller) {
        activeUsersByEmail.set(cleanEmail, sessionUser);
        if (sessionSecret) {
          persistSessionSecret(cleanEmail, sessionSecret);
        }
      }
      const { sessionSecret: _hidden, token: _hiddenToken, ...safeUser } = sessionUser;

      res.json({
        success: true,
        user: safeUser,
        ...(sessionSecret ? { sessionSecret } : {}),
        token: validToken || null,
      });
    } catch (err: any) {
      console.error("Error in /api/auth/session:", err);
      res.status(500).json({ success: false, error: err.message || "Error al sincronizar sesión" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const cleanEmail = String(req.body?.email || req.headers["x-user-email"] || "")
      .trim()
      .toLowerCase();
    const providedSecret = String(req.headers["x-session-secret"] || req.body?.sessionSecret || "").trim();
    const hasPersisted = persistedSessionsByEmail.has(cleanEmail);
    const hasMemorySecret = Boolean(activeUsersByEmail.get(cleanEmail)?.sessionSecret);
    if (cleanEmail && ((!hasMemorySecret && !hasPersisted) || hasValidSessionSecret(cleanEmail, providedSecret))) {
      const existing = activeUsersByEmail.get(cleanEmail);
      savedOAuthTokensByEmail.delete(cleanEmail);
      revokePersistedSessionSecret(cleanEmail);
      if (existing) {
        // Invalidate active sessionSecret and cached OAuth token on explicit logout
        activeUsersByEmail.set(cleanEmail, {
          ...existing,
          token: undefined,
          sessionSecret: undefined,
        });
      }
    }
    res.json({ success: true, message: "Sesión cerrada correctamente" });
  });

  app.get("/api/auth/permissions", (req, res) => {
    const requestedEmail = String(req.headers["x-user-email"] || req.query.email || "")
      .trim()
      .toLowerCase();
    const providedSecret = String(req.headers["x-session-secret"] || "").trim();
    const isVerified =
      Boolean(requestedEmail) &&
      Boolean(providedSecret) &&
      hasValidSessionSecret(requestedEmail, providedSecret);
    const matchedUser = isVerified ? activeUsersByEmail.get(requestedEmail) : undefined;
    res.json({
      role: matchedUser?.role || "Docente Titular",
      permissions: matchedUser?.permissions || [...DEFAULT_TEACHER_PERMISSIONS],
      scopes: matchedUser?.scopes || [],
    });
  });
}
