import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import {
  PRIMARY_OWNER_IDENTIFIERS,
  RATE_LIMIT_MAX_GENERAL,
  RATE_LIMIT_MAX_HEAVY,
  RATE_LIMIT_MAX_LOGIN_EMAIL,
  RATE_LIMIT_MAX_LOGIN_IP,
  RATE_LIMIT_MAX_PROXY,
  RATE_LIMIT_MAX_SESSION,
  configureAuthorizedOriginsFromEnv,
  consumeRateLimitBucket,
  hasValidSessionSecret,
  isAuthorizedOriginUrl,
  loadActiveSessionsFromDisk,
  loadTeacherAccountsFromDisk,
  stripPrototypePollutionKeys,
  verifyGoogleBearerToken,
} from "./server/security";
import { handleFetchRemoteDocument } from "./server/remoteDocumentProxy";
import { registerAuthRoutes } from "./server/authRoutes";
import { workspaceStore } from "./server/workspaceStore";
import { registerCourseStudentRoutes } from "./server/courseStudentRoutes";
import { registerDispositionRoutes } from "./server/dispositionRoutes";
import { registerAcademicRoutes } from "./server/academicRoutes";
import { registerCalendarRoutes } from "./server/calendarRoutes";

dotenv.config();
configureAuthorizedOriginsFromEnv();

// Port 3000 is required by the AI Studio environment
const PORT = 3000;

loadTeacherAccountsFromDisk();
loadActiveSessionsFromDisk();

async function startServer() {
  const app = express();

  // ISO/IEC 27001 A.8.9 & A.8.26: Remove server fingerprinting & apply safe HTTP security headers
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    // Preserves Google OAuth popup communication while isolating cross-origin openers
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    const isHttps =
      req.secure ||
      String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
    if (isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // Per-route JSON body size limits: 15mb only for routes that legitimately carry large payloads, 2mb everywhere else
  const LARGE_JSON_BODY_ROUTES = new Set([
    "/api/save-logo",
    "/api/disposition/sync-full",
    "/api/courses/bulk",
    "/api/students/sync",
    "/api/drive/upload",
  ]);
  const jsonParserLarge = express.json({ limit: "15mb" });
  const jsonParserStandard = express.json({ limit: "2mb" });
  app.use((req, res, next) => {
    if (LARGE_JSON_BODY_ROUTES.has(req.path)) {
      return jsonParserLarge(req, res, next);
    }
    return jsonParserStandard(req, res, next);
  });
  app.use(express.static(path.join(process.cwd(), "public")));

  // Prevent browser/proxy caching of private teacher & student API responses and strip prototype pollution keys
  app.use("/api", (req, res, next) => {
    if (req.path !== "/logo-status") {
      res.setHeader("Cache-Control", "no-store, private");
    }
    if (req.body && typeof req.body === "object") {
      stripPrototypePollutionKeys(req.body);
    }
    if (req.query && typeof req.query === "object") {
      stripPrototypePollutionKeys(req.query);
    }
    next();
  });

  // ISO/IEC 27001 A.8.6 / A.8.20: Tighter per-route & anti-bruteforce rate limiting on /api/*
  app.use("/api", (req, res, next) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp =
      (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
      req.socket.remoteAddress ||
      "unknown";

    if (req.path === "/auth/login-email" && req.method === "POST") {
      if (!consumeRateLimitBucket(`${clientIp}:login-ip`, RATE_LIMIT_MAX_LOGIN_IP, res)) {
        return;
      }
      const targetEmail = String(req.body?.email || "").trim().toLowerCase();
      if (targetEmail && !consumeRateLimitBucket(`login-email:${targetEmail}`, RATE_LIMIT_MAX_LOGIN_EMAIL, res)) {
        return;
      }
      return next();
    }

    if (req.path === "/auth/session" && req.method === "POST") {
      if (!consumeRateLimitBucket(`${clientIp}:auth-session`, RATE_LIMIT_MAX_SESSION, res)) {
        return;
      }
      return next();
    }

    if (req.path === "/workspace/fetch-remote-document") {
      if (!consumeRateLimitBucket(`${clientIp}:remote-proxy`, RATE_LIMIT_MAX_PROXY, res)) {
        return;
      }
      return next();
    }

    const isHeavyEndpoint =
      req.path === "/save-logo" ||
      req.path === "/courses/clear" ||
      req.path === "/courses/restore-demo";
    const bucketKey = `${clientIp}:${isHeavyEndpoint ? "heavy" : "general"}`;
    const maxAllowed = isHeavyEndpoint ? RATE_LIMIT_MAX_HEAVY : RATE_LIMIT_MAX_GENERAL;
    if (!consumeRateLimitBucket(bucketKey, maxAllowed, res)) {
      return;
    }
    return next();
  });

  // ISO/IEC 27001 A.8.20 & A.8.26: Authorized Origins & anti-CSRF verification for /api/* requests

  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin) {
      if (!isAuthorizedOriginUrl(origin, host)) {
        return res.status(403).json({
          error: "Solicitud bloqueada por política de seguridad de origen (ISO/IEC 27001 Authorized Origins).",
        });
      }
    }
    return next();
  });

  // Centralized authentication middleware for all non-public /api/* routes (ISO/IEC 27001 A.5.15 & A.8.5)
  const PUBLIC_API_GET_PATHS = new Set([
    "/health",
    "/logo-status",
    "/workspace/config",
    "/auth/user",
    "/auth/permissions",
  ]);
  const PUBLIC_API_POST_PATHS = new Set([
    "/auth/login-email",
    "/auth/session",
    "/auth/logout",
  ]);

  app.use("/api", async (req, res, next) => {
    try {
      if (req.method === "OPTIONS") {
        return next();
      }
      if (req.method === "GET" && PUBLIC_API_GET_PATHS.has(req.path)) {
        return next();
      }
      if (req.method === "POST" && PUBLIC_API_POST_PATHS.has(req.path)) {
        return next();
      }

      const claimedEmail = String(req.headers["x-user-email"] || "").trim().toLowerCase();
      const providedSecret = String(req.headers["x-session-secret"] || "").trim();

      // 1. Fast synchronous verification via persisted/in-memory sessionSecret
      if (claimedEmail && providedSecret && hasValidSessionSecret(claimedEmail, providedSecret)) {
        res.locals.authenticatedEmail = claimedEmail;
        return next();
      }

      // 2. Cryptographic fallback via verified Google OAuth Bearer access token (5-min cache)
      const authHeader = String(req.headers.authorization || "").trim();
      if (/^bearer\s+/i.test(authHeader)) {
        const bearerToken = authHeader.replace(/^bearer\s+/i, "").trim();
        const verifiedEmail = await verifyGoogleBearerToken(bearerToken);
        if (verifiedEmail) {
          if (claimedEmail && claimedEmail !== verifiedEmail) {
            return res.status(403).json({
              success: false,
              error: "La identidad del encabezado no coincide con la sesión autenticada.",
            });
          }
          res.locals.authenticatedEmail = verifiedEmail;
          return next();
        }
      }

      return res.status(401).json({
        success: false,
        error: "Sesión no verificada. Iniciá sesión nuevamente para continuar.",
      });
    } catch (err) {
      return next(err);
    }
  });

  // Workspace isolation is now resolved directly per request via workspaceStore.getSliceForResponse(res),
  // eliminating shared mutable globals and any risk of cross-teacher interleaving.

  // Save uploaded dynamic logo directly to public/ (hardened against path traversal, arbitrary file writes & unauthorized users)
  app.post("/api/save-logo", async (req, res) => {
    try {
      const authenticatedEmail = String(res.locals?.authenticatedEmail || "").trim().toLowerCase();
      if (!authenticatedEmail || !PRIMARY_OWNER_IDENTIFIERS.has(authenticatedEmail)) {
        return res.status(403).json({
          error: "Solo la cuenta administradora titular autenticada tiene permiso para modificar el logo institucional global.",
        });
      }

      const { data, filename } = req.body;
      if (!data || typeof data !== "string") {
        return res.status(400).json({ error: "No data provided" });
      }

      const safeName = path.basename(String(filename || "logo-animado.mp4")).replace(/[^a-zA-Z0-9._-]/g, "");
      if (!safeName || !/^[a-zA-Z0-9._-]+\.(mp4|webm)$/i.test(safeName)) {
        return res.status(400).json({ error: "Formato inválido. Solo se permiten archivos .mp4 o .webm" });
      }

      const base64Data = data.includes("base64,") ? data.split("base64,")[1] : data;
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 12 * 1024 * 1024) {
        return res.status(413).json({ error: "El archivo excede el tamaño máximo permitido (12 MB)." });
      }

      const publicDir = path.resolve(process.cwd(), "public");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      const targetPath = path.resolve(publicDir, safeName);
      if (!targetPath.startsWith(publicDir + path.sep)) {
        return res.status(400).json({ error: "Nombre de archivo no permitido." });
      }
      fs.writeFileSync(targetPath, buffer);

      // Keep all video aliases synchronized
      fs.writeFileSync(path.join(publicDir, "logo-animado.mp4"), buffer);
      fs.writeFileSync(path.join(publicDir, "logo.mp4"), buffer);
      fs.writeFileSync(path.join(publicDir, "logo-dinamico.mp4"), buffer);

      const distDir = path.join(process.cwd(), "dist");
      if (fs.existsSync(distDir)) {
        fs.writeFileSync(path.join(distDir, "logo-animado.mp4"), buffer);
        fs.writeFileSync(path.join(distDir, "logo.mp4"), buffer);
        fs.writeFileSync(path.join(distDir, "logo-dinamico.mp4"), buffer);
      }

      console.log(`[Logo] Saved dynamic logo to ${targetPath}`);
      return res.json({ success: true, url: "/logo-animado.mp4?v=" + Date.now() });
    } catch (err: any) {
      console.error("Error saving dynamic logo:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/logo-status", (_req, res) => {
    const candidates = [
      "logo-animado.mp4",
      "logo-animado-original.mp4",
      "logo.mp4",
      "logo-animado.webm",
      "logo.webm",
      "logo-dinamico.mp4",
    ];
    const found: string[] = [];
    const publicDir = path.join(process.cwd(), "public");
    candidates.forEach((c) => {
      if (fs.existsSync(path.join(publicDir, c))) {
        found.push(`/${c}`);
      }
    });
    res.json({
      found,
      hasVideo: found.some((f) => f.endsWith(".mp4") || f.endsWith(".webm")),
    });
  });

  // Workspace configuration readiness & Scopes metadata
  const WORKSPACE_INTEGRATION = {
    authMode: "prepared",
    status: "Ready for Google Workspace OAuth",
    services: {
      drive: {
        name: "Google Drive",
        enabled: true,
        scope: "https://www.googleapis.com/auth/drive.file",
        purpose: "Almacenamiento de carpetas por materia, guías didácticas, rúbricas y adjuntos.",
      },
      docs: {
        name: "Google Docs",
        enabled: true,
        scope: "https://www.googleapis.com/auth/documents",
        purpose: "Creación y exportación de planificaciones pedagógicas y fichas de clase.",
      },
      sheets: {
        name: "Google Sheets",
        enabled: true,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        purpose: "Sincronización de planillas de asistencia, registro de calificaciones y ponderaciones.",
      },
      classroom: {
        name: "Google Classroom",
        enabled: true,
        scope: "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.students",
        purpose: "Importación de nóminas de estudiantes, publicación de tareas y novedades.",
      },
    },
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.students",
    ],
  };

  // -------------------------------------------------------------
  // API ROUTES (Always before Vite middleware)
  // -------------------------------------------------------------

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Google Workspace Config & Readiness
  app.get("/api/workspace/config", (_req, res) => {
    res.json(WORKSPACE_INTEGRATION);
  });

  // Server-side proxy for fetching Google Sheets CSV/HTML, Google Docs HTML/TXT, and Google Forms metadata without browser CORS restrictions
  app.post("/api/workspace/fetch-remote-document", handleFetchRemoteDocument);

  // Authentication & Session endpoints (isolated in server/authRoutes.ts)
  registerAuthRoutes(app);

  // Domain API routes isolated per teacher workspace via WorkspaceStore
  registerCourseStudentRoutes(app, workspaceStore);
  registerDispositionRoutes(app, workspaceStore);
  registerAcademicRoutes(app, workspaceStore);
  registerCalendarRoutes(app, workspaceStore);

  // -------------------------------------------------------------
  // API Fallback & Error Handling (Prevents API routes from returning HTML)
  // -------------------------------------------------------------
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      success: false,
      error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api") || req.originalUrl?.startsWith("/api")) {
      console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || "Error interno del servidor",
      });
    }
    next(err);
  });

  // -------------------------------------------------------------
  // Vite Middleware / Production Static Handling
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Portal Docente Workspace] Servidor full-stack ejecutándose en http://0.0.0.0:${PORT}`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[Portal Docente Workspace] Error en el servidor HTTP (puerto ${PORT}):`, err.message);
  });
}

startServer().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
