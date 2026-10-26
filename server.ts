import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

// Port 3000 is required by the AI Studio environment
const PORT = 3000;

// In-memory persistent data store for the teacher session
interface Course {
  id: string;
  name: string;
  subject: string;
  grade: string;
  room: string;
  schedule: string;
  color: string;
  studentsCount: number;
  classroomCourseId?: string;
  classroomSynced: boolean;
  driveFolderId?: string;
  driveFolderUrl?: string;
  attendanceFolderId?: string;
  attendanceFolderUrl?: string;
  gradesFolderId?: string;
  gradesFolderUrl?: string;
  dispositionSheetId?: string;
  dispositionSheetUrl?: string;
  gradesSheetId?: string;
  gradesSheetUrl?: string;
  code?: string;
  section?: string;
  orientation?: string;
  division?: string;
  schoolYear?: string;
}

interface Student {
  id: string;
  courseId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string;
  attendanceRate: number;
  averageGrade: number;
  notes: string;
}

interface LessonPlan {
  id: string;
  courseId: string;
  title: string;
  unit: string;
  date: string;
  duration: string;
  status: "Borrador" | "Aprobada" | "Completada";
  objective: string;
  competencies: string[];
  inicio: string;
  desarrollo: string;
  cierre: string;
  assessment: string;
  materials: string[];
  googleDocUrl?: string;
  googleDocId?: string;
  lastModified: string;
}

interface GradeEntry {
  id: string;
  courseId: string;
  studentId: string;
  evaluationTitle: string;
  evaluationType: "Examen" | "Trabajo Práctico" | "Participación" | "Proyecto";
  term: "1er Trimestre" | "2do Trimestre" | "3er Trimestre";
  score: number;
  maxScore: number;
  feedback?: string;
  date: string;
}

interface DriveResource {
  id: string;
  courseId?: string;
  name: string;
  mimeType: string;
  type: "doc" | "sheet" | "slide" | "pdf" | "folder";
  size: string;
  folder: string;
  modifiedTime: string;
  googleDriveUrl: string;
  sharedWithClassroom: boolean;
}

interface ClassroomTask {
  id: string;
  courseId: string;
  title: string;
  description: string;
  dueDate: string;
  maxPoints: number;
  status: "Publicada" | "Borrador" | "Calificada";
  submittedCount: number;
  assignedCount: number;
  driveAttachmentName?: string;
  classroomUrl?: string;
}

interface StudentSubmission {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentAvatar: string;
  status: "Entregado" | "Calificado" | "Pendiente" | "Entrega Tardía";
  submittedAt?: string;
  submittedFileUrl?: string;
  submittedFileName?: string;
  grade?: number;
  maxPoints: number;
  feedback?: string;
}

interface TaskAttachment {
  id: string;
  name: string;
  type: "doc" | "sheet" | "slide" | "pdf";
  url: string;
  size?: string;
}

interface TeacherTask {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  description: string;
  category: "Tarea" | "Trabajo Práctico" | "Proyecto" | "Evaluación";
  dueDate: string;
  maxPoints: number;
  status: "Publicada" | "Borrador" | "Cerrada";
  driveAttachments: TaskAttachment[];
  assignedCount: number;
  submittedCount: number;
  gradedCount: number;
  submissions: StudentSubmission[];
  createdAt: string;
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  school: string;
  scopes: string[];
  permissions: string[];
  lastLogin: string;
}

// Active user sessions isolated by email so multiple teachers do not share or leak sessions
const activeUsersByEmail = new Map<string, AuthUser>();

// Initial Datasets (persisted to disk so classes and students survive app closures)
let courses: Course[] = [];
let students: Student[] = [];

const COURSES_DATA_FILE = path.join(process.cwd(), "data", "courses.json");
const STUDENTS_DATA_FILE = path.join(process.cwd(), "data", "students.json");

function normalizeCourseKey(c: Partial<Course>): string {
  if (!c) return "";
  if (c.classroomCourseId && !c.classroomCourseId.startsWith("gc-") && !isNaN(Number(c.classroomCourseId))) {
    return `classroom:${String(c.classroomCourseId).trim()}`;
  }
  const name = (c.name || "").trim().toLowerCase();
  const sub = (c.subject || "").trim().toLowerCase();
  const sec = (c.section || c.grade || c.division || "").trim().toLowerCase();
  const paren = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (paren) {
    return `name:${paren[1].trim()}:${paren[2].trim()}`;
  }
  return `name:${sub || name}:${sec || "main"}`;
}

function deduplicateCoursesList(list: Course[]): Course[] {
  if (!Array.isArray(list)) return [];
  const result: Course[] = [];
  for (const c of list) {
    if (!c || (!c.name && !c.subject)) continue;
    const key = normalizeCourseKey(c);
    const existingIdx = result.findIndex((existing) => {
      if (existing.id && c.id && existing.id === c.id) return true;
      const exCId = existing.classroomCourseId ? String(existing.classroomCourseId).trim() : null;
      const cCId = c.classroomCourseId ? String(c.classroomCourseId).trim() : null;
      if (exCId && cCId && exCId === cCId) return true;
      if (exCId && (c.id === exCId || cCId === exCId)) return true;
      if (cCId && (existing.id === cCId || exCId === cCId)) return true;
      if (key && normalizeCourseKey(existing) === key) return true;
      return false;
    });

    if (existingIdx >= 0) {
      const existing = result[existingIdx];
      const preferredId =
        (existing.classroomCourseId && existing.id === existing.classroomCourseId)
          ? existing.id
          : (c.classroomCourseId && c.id === c.classroomCourseId)
          ? c.id
          : existing.id || c.id;

      result[existingIdx] = {
        ...existing,
        ...c,
        id: preferredId,
        classroomCourseId: existing.classroomCourseId || c.classroomCourseId,
        classroomSynced: existing.classroomSynced || c.classroomSynced,
        studentsCount: Math.max(Number(existing.studentsCount) || 0, Number(c.studentsCount) || 0),
        name: existing.name || c.name,
        subject: existing.subject || c.subject,
        grade: existing.grade || c.grade,
        section: existing.section || c.section,
        schoolYear: existing.schoolYear || c.schoolYear || String(new Date().getFullYear()),
      };
    } else {
      result.push(c);
    }
  }
  return result;
}

let coursesLoadedFromDisk = false;

function loadCoursesFromDisk() {
  try {
    if (fs.existsSync(COURSES_DATA_FILE)) {
      const raw = fs.readFileSync(COURSES_DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      let list: Course[] = [];
      if (Array.isArray(parsed.courses)) {
        list = parsed.courses;
      } else if (Array.isArray(parsed)) {
        list = parsed;
      }
      courses = deduplicateCoursesList(list);
    } else {
      courses = [];
    }
    coursesLoadedFromDisk = true;
  } catch (e) {
    console.warn("Failed to load courses from disk:", e);
    coursesLoadedFromDisk = true;
  }
}

function saveCoursesToDisk(force = true) {
  try {
    courses = deduplicateCoursesList(courses);
    const dir = path.dirname(COURSES_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COURSES_DATA_FILE, JSON.stringify({ courses }, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to save courses to disk:", e);
  }
}

function loadStudentsFromDisk() {
  try {
    if (fs.existsSync(STUDENTS_DATA_FILE)) {
      const raw = fs.readFileSync(STUDENTS_DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.students)) {
        students = parsed.students;
      } else if (Array.isArray(parsed)) {
        students = parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load students from disk:", e);
  }
}

function saveStudentsToDisk(_force = true) {
  try {
    const dir = path.dirname(STUDENTS_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STUDENTS_DATA_FILE, JSON.stringify({ students }, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to save students to disk:", e);
  }
}

// Initial load from disk
loadCoursesFromDisk();
loadStudentsFromDisk();

let lessonPlans: LessonPlan[] = [];

let grades: GradeEntry[] = [];
let driveResources: DriveResource[] = [];
let classroomTasks: ClassroomTask[] = [];
let teacherTasks: TeacherTask[] = [];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(path.join(process.cwd(), "public")));

  // Same-origin / anti-CSRF verification for state-mutating /api/* requests
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return res.status(403).json({ error: "Solicitud bloqueada por política de seguridad de origen." });
        }
      } catch {
        return res.status(403).json({ error: "Origen inválido." });
      }
    }
    return next();
  });

  // Save uploaded dynamic logo directly to public/ (hardened against path traversal & arbitrary file writes)
  app.post("/api/save-logo", async (req, res) => {
    try {
      const { data, filename } = req.body;
      if (!data || typeof data !== "string") {
        return res.status(400).json({ error: "No data provided" });
      }

      const safeName = path.basename(String(filename || "logo-animado.mp4"));
      if (!/\.(mp4|webm)$/i.test(safeName)) {
        return res.status(400).json({ error: "Formato inválido. Solo se permiten archivos .mp4 o .webm" });
      }

      const base64Data = data.includes("base64,") ? data.split("base64,")[1] : data;
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 12 * 1024 * 1024) {
        return res.status(413).json({ error: "El archivo excede el tamaño máximo permitido (12 MB)." });
      }

      const publicDir = path.join(process.cwd(), "public");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      const targetPath = path.join(publicDir, safeName);
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

  // Authentication & Session endpoints (isolated per teacher email)
  app.get("/api/auth/user", (req, res) => {
    const requestedEmail = String(req.query.email || "").trim().toLowerCase();
    const matchedUser = requestedEmail ? (activeUsersByEmail.get(requestedEmail) || null) : null;
    res.json({
      authenticated: !!matchedUser,
      user: matchedUser,
    });
  });

  app.post("/api/auth/session", (req, res) => {
    try {
      const { uid, email, name, avatar, scopes, school } = req.body || {};
      const cleanEmail = (email || "").trim().toLowerCase();
      const cleanName = name || (cleanEmail ? cleanEmail.split("@")[0].replace(/[._-]/g, " ") : "Docente Titular");
      const displayName = cleanName.startsWith("Prof.") ? cleanName : `Prof. ${cleanName}`;

      const sessionUser: AuthUser = {
        id: uid || `user-${Date.now()}`,
        email: cleanEmail,
        name: displayName,
        avatar: (avatar && !avatar.includes("photo-1534528741775"))
          ? avatar
          : `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1d4ed8&color=ffffff&bold=true&size=150`,
        role: "Docente Titular",
        school: school || (cleanEmail.includes("@") ? `Institución ${cleanEmail.split("@")[1].split(".")[0].toUpperCase()}` : "Institución Educativa"),
        scopes: Array.isArray(scopes) ? scopes : [
          "https://www.googleapis.com/auth/classroom.courses.readonly",
          "https://www.googleapis.com/auth/classroom.rosters.readonly",
          "https://www.googleapis.com/auth/classroom.coursework.students",
          "https://www.googleapis.com/auth/classroom.announcements",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
        ],
        permissions: [
          "tasks.create",
          "tasks.assign",
          "tasks.grade",
          "tasks.delete",
          "drive.read",
          "drive.attach",
          "classroom.sync",
          "students.view",
          "grades.manage",
        ],
        lastLogin: new Date().toISOString(),
      };

      if (cleanEmail) {
        activeUsersByEmail.set(cleanEmail, sessionUser);
      }

      res.json({
        success: true,
        user: sessionUser,
      });
    } catch (err: any) {
      console.error("Error in /api/auth/session:", err);
      res.status(500).json({ success: false, error: err.message || "Error al sincronizar sesión" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const cleanEmail = String(req.body?.email || req.query?.email || "").trim().toLowerCase();
    if (cleanEmail) {
      activeUsersByEmail.delete(cleanEmail);
    }
    res.json({ success: true, message: "Sesión cerrada correctamente" });
  });

  app.get("/api/auth/permissions", (req, res) => {
    const requestedEmail = String(req.query.email || "").trim().toLowerCase();
    const matchedUser = requestedEmail ? activeUsersByEmail.get(requestedEmail) : undefined;
    res.json({
      role: matchedUser?.role || "Docente Titular",
      permissions: matchedUser?.permissions || [
        "tasks.create",
        "tasks.assign",
        "tasks.grade",
        "tasks.delete",
        "drive.read",
        "drive.attach",
        "classroom.sync",
        "students.view",
        "grades.manage",
      ],
      scopes: matchedUser?.scopes || [],
    });
  });

  // Courses API
  app.get("/api/courses", (_req, res) => {
    if (!coursesLoadedFromDisk) {
      loadCoursesFromDisk();
    }
    courses = deduplicateCoursesList(courses);
    res.json({ courses });
  });

  app.post("/api/courses", (req, res) => {
    const { name, subject, grade, room, schedule, color, orientation, division } = req.body;
    if (!name || !subject) {
      return res.status(400).json({ error: "Nombre y materia son requeridos." });
    }

    if (!coursesLoadedFromDisk) {
      loadCoursesFromDisk();
    }

    const incomingClassroomId = req.body.classroomCourseId ? String(req.body.classroomCourseId).trim() : null;
    const incomingId = req.body.id ? String(req.body.id).trim() : null;

    // Check if course already exists
    const existing = courses.find((c) => {
      if (incomingClassroomId && (c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId)) {
        return true;
      }
      if (incomingId && (c.id === incomingId || c.classroomCourseId === incomingId)) {
        return true;
      }
      return normalizeCourseKey(c) === normalizeCourseKey(req.body);
    });

    if (existing) {
      existing.name = name;
      existing.subject = subject;
      if (req.body.studentsCount) existing.studentsCount = Number(req.body.studentsCount);
      if (incomingClassroomId) existing.classroomCourseId = incomingClassroomId;
      saveCoursesToDisk();
      return res.status(200).json({ course: existing, isDuplicate: true });
    }

    const courseId = incomingClassroomId || req.body.id || `c-${Date.now().toString().slice(-4)}`;
    const newCourse: Course = {
      id: courseId,
      name,
      subject,
      grade: grade || "General",
      room: room || "Aula Principal",
      schedule: schedule || "A coordinar",
      color: color || "#1a73e8",
      studentsCount: Number(req.body.studentsCount) || 25,
      classroomSynced: req.body.classroomSynced !== undefined ? Boolean(req.body.classroomSynced) : true,
      classroomCourseId: incomingClassroomId || req.body.classroomCourseId || undefined,
      code: req.body.code || undefined,
      section: req.body.section || undefined,
      orientation: orientation || req.body.orientation || undefined,
      division: division || req.body.division || undefined,
      schoolYear: req.body.schoolYear || String(new Date().getFullYear()),
      driveFolderId: req.body.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
    };
    courses.push(newCourse);
    courses = deduplicateCoursesList(courses);
    saveCoursesToDisk();
    res.status(201).json({ course: newCourse });
  });

  // Bulk import courses (from Google Classroom or teacher list)
  app.post("/api/courses/bulk", (req, res) => {
    const { courses: newCoursesList } = req.body;
    if (!Array.isArray(newCoursesList) || newCoursesList.length === 0) {
      return res.status(400).json({ error: "Se requiere una lista de materias para importar." });
    }

    if (!coursesLoadedFromDisk) {
      loadCoursesFromDisk();
    }

    const processedCourses: Course[] = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const item of newCoursesList) {
      if (!item.name && !item.subject) continue;
      const courseName = (item.name || item.subject).trim();
      const courseSubject = (item.subject || item.name).trim();
      const studentsNum =
        typeof item.studentsCount === 'number' && !isNaN(item.studentsCount)
          ? item.studentsCount
          : !isNaN(Number(item.studentsCount)) && item.studentsCount !== '' && item.studentsCount !== null
          ? Number(item.studentsCount)
          : 0;

      // Identity numbers (Google Classroom ID or custom ID)
      const incomingClassroomId = item.classroomCourseId
        ? String(item.classroomCourseId).trim()
        : (item.id && !item.id.startsWith('c-') ? String(item.id).trim() : null);

      // Check if this course is ALREADY present
      const existing = courses.find((c) => {
        if (incomingClassroomId && (c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId)) {
          return true;
        }
        if (item.id && (c.id === item.id || c.classroomCourseId === item.id)) {
          return true;
        }
        return normalizeCourseKey(c) === normalizeCourseKey(item);
      });

      if (existing) {
        if (studentsNum > 0) existing.studentsCount = Math.max(existing.studentsCount, studentsNum);
        if (incomingClassroomId && !existing.classroomCourseId) existing.classroomCourseId = incomingClassroomId;
        existing.classroomSynced = true;
        if (!processedCourses.some((c) => c.id === existing.id)) {
          processedCourses.push(existing);
          updatedCount++;
        }
        continue;
      }

      // Check if already added in this same batch to prevent internal batch duplicates
      const alreadyInBatch = processedCourses.find((c) => {
        if (incomingClassroomId && (c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId)) {
          return true;
        }
        return normalizeCourseKey(c) === normalizeCourseKey(item);
      });
      if (alreadyInBatch) continue;

      const courseId = incomingClassroomId || item.id || `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`;
      const newCourse: Course = {
        id: courseId,
        name: courseName,
        subject: courseSubject,
        grade: item.grade || "Secundaria",
        room: item.room || "Aula Asignada",
        schedule: item.schedule || "Horario a coordinar",
        color: item.color || "#137333", // Classroom Green
        studentsCount: studentsNum,
        classroomSynced: true,
        classroomCourseId: incomingClassroomId || undefined,
        code: item.code || Math.random().toString(36).substring(2, 8),
        section: item.section || "1",
        orientation: item.orientation || undefined,
        division: item.division || undefined,
        schoolYear: item.schoolYear || String(new Date().getFullYear()),
        driveFolderId: item.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
      };

      courses.push(newCourse);
      processedCourses.push(newCourse);
      addedCount++;
    }

    courses = deduplicateCoursesList(courses);
    saveCoursesToDisk();

    res.status(201).json({
      success: true,
      message: addedCount > 0
        ? `Se agregaron ${addedCount} materias nuevas (y se actualizaron ${updatedCount} existentes sin duplicar).`
        : `Las materias ya estaban cargadas previamente. No se duplicó ninguna materia.`,
      courses: courses,
      processedCourses: processedCourses,
      addedCount,
      updatedCount,
    });
  });

  // Sync actual student counts for courses
  app.post("/api/courses/sync-students", (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Se requiere un array de actualizaciones." });
    }

    let updatedCount = 0;
    updates.forEach((u: { id: string; studentsCount: number }) => {
      const course = courses.find((c) => c.id === u.id || c.classroomCourseId === u.id);
      if (course && typeof u.studentsCount === "number") {
        course.studentsCount = u.studentsCount;
        updatedCount++;
      }
    });

    saveCoursesToDisk();

    res.json({
      success: true,
      message: `Se actualizaron los alumnos reales de ${updatedCount} materias.`,
      courses,
    });
  });

  // Patch a single course
  app.patch("/api/courses/:id", (req, res) => {
    const { id } = req.params;
    if (!coursesLoadedFromDisk) {
      loadCoursesFromDisk();
    }
    let course = courses.find((c) => c.id === id || c.classroomCourseId === id);
    if (!course) {
      if (req.body && (req.body.name || req.body.subject)) {
        course = {
          id,
          name: req.body.name || req.body.subject || "Materia",
          subject: req.body.subject || req.body.name || "Materia",
          grade: req.body.grade || "Secundaria",
          room: req.body.room || "Aula Principal",
          schedule: req.body.schedule || "A coordinar",
          color: req.body.color || "#1a73e8",
          studentsCount: typeof req.body.studentsCount === "number" ? req.body.studentsCount : 25,
          classroomSynced: Boolean(req.body.classroomSynced),
          classroomCourseId: req.body.classroomCourseId,
          code: req.body.code || Math.random().toString(36).substring(2, 8),
          section: req.body.section || "1",
          orientation: req.body.orientation,
          division: req.body.division,
          schoolYear: req.body.schoolYear || String(new Date().getFullYear()),
        };
        courses.push(course);
      } else {
        return res.status(404).json({ error: "Materia no encontrada." });
      }
    }
    if (typeof req.body.studentsCount === "number") {
      course.studentsCount = req.body.studentsCount;
    }
    Object.assign(course, req.body);
    saveCoursesToDisk();
    res.json({ success: true, course });
  });

  app.delete("/api/courses/:id", (req, res) => {
    const { id } = req.params;
    if (!coursesLoadedFromDisk) {
      loadCoursesFromDisk();
    }
    const target = courses.find((c) => c.id === id || c.classroomCourseId === id || (c.code && c.code === id));
    if (!target) {
      return res.json({ success: true, message: "Materia eliminada o no encontrada.", courseId: id });
    }
    const targetKey = normalizeCourseKey(target);
    const removedName = target.name || "Materia";
    const targetIds = new Set<string>([id, target.id]);
    if (target.classroomCourseId) targetIds.add(target.classroomCourseId);

    courses = courses.filter((c) => !targetIds.has(c.id) && (!c.classroomCourseId || !targetIds.has(c.classroomCourseId)) && normalizeCourseKey(c) !== targetKey);
    // Remove students associated with this course
    students = students.filter((s) => !targetIds.has(s.courseId));
    // Remove sheet configuration for deleted course
    targetIds.forEach((tId) => {
      delete courseDispositionSheets[tId];
    });
    saveSheetsConfigToDisk();
    saveCoursesToDisk(true);
    saveStudentsToDisk(true);
    res.json({
      success: true,
      message: `Materia "${removedName}" eliminada correctamente.`,
      courseId: id,
    });
  });

  // Clear all demo/sample courses
  app.post("/api/courses/clear", (_req, res) => {
    courses = [];
    students = [];
    Object.keys(courseDispositionSheets).forEach((k) => delete courseDispositionSheets[k]);
    saveSheetsConfigToDisk();
    coursesLoadedFromDisk = true;
    saveCoursesToDisk(true);
    saveStudentsToDisk(true);
    res.json({
      success: true,
      message: "Se eliminaron todas las materias y estudiantes de prueba. Espacio de trabajo limpio para tus clases reales.",
    });
  });

  // Restore demo/sample courses
  app.post("/api/courses/restore-demo", (_req, res) => {
    courses = [
      {
        id: "c-101",
        name: "Historia (S2 Nat)",
        subject: "Historia",
        orientation: "Nat",
        division: "S2",
        grade: "Secundaria - S2 Nat",
        room: "Aula 21",
        schedule: "Lunes y Miércoles 08:00 - 09:30",
        color: "#1a73e8",
        studentsCount: 28,
        classroomSynced: true,
        classroomCourseId: "gc-hist-201",
        code: "his201n",
        section: "2º",
        schoolYear: "2026",
        driveFolderId: "f-101",
      },
      {
        id: "c-102",
        name: "Historia (S3 Soc)",
        subject: "Historia",
        orientation: "Soc",
        division: "S3",
        grade: "Secundaria - S3 Soc",
        room: "Aula 14",
        schedule: "Martes y Jueves 10:00 - 11:30",
        color: "#1e8e3e",
        studentsCount: 30,
        classroomSynced: true,
        classroomCourseId: "gc-hist-302",
        code: "his302s",
        section: "3º",
        schoolYear: "2026",
        driveFolderId: "f-102",
      },
    ];
    saveCoursesToDisk();
    res.json({
      success: true,
      message: "Materias de prueba restauradas correctamente.",
      courses,
    });
  });

  // Students API
  app.get("/api/students", (req, res) => {
    if (!students || students.length === 0) {
      loadStudentsFromDisk();
    }
    const { courseId } = req.query;
    // Sanitize any legacy mock students that may have been in memory
    const mockNames = ["Valentina Rossi", "Mateo Gómez", "Camila Navarro", "Ignacio Pérez", "Sofía Martínez", "Lucas Benítez", "Agustina Ríos", "Santiago Silva", "Martina López", "Joaquín Fernández", "Lucía Romero", "Benjamín Alvarez", "Sofía Díaz"];
    students = students.filter((s) => !mockNames.includes(`${s.firstName} ${s.lastName}`));

    let list = courseId ? students.filter((s) => s.courseId === courseId) : [...students];
    list.sort((a, b) => {
      const lastA = (a.lastName || "").trim();
      const lastB = (b.lastName || "").trim();
      const cmp = lastA.localeCompare(lastB, "es", { sensitivity: "base" });
      if (cmp !== 0) return cmp;
      return (a.firstName || "").trim().localeCompare((b.firstName || "").trim(), "es", { sensitivity: "base" });
    });

    if (courseId) {
      return res.json({ students: list });
    }
    res.json({ students: list });
  });

  // Bulk sync real students from Google Classroom into a course
  app.post("/api/students/sync", (req, res) => {
    const { courseId, students: incoming } = req.body;
    if (!courseId || !Array.isArray(incoming)) {
      return res.status(400).json({ error: "courseId y array de estudiantes son obligatorios." });
    }

    // Remove existing students for this course
    students = students.filter((s) => s.courseId !== courseId);

    // Insert real students
    incoming.forEach((st: any) => {
      students.push({
        id: st.id || `st-${courseId}-${Math.random().toString(36).substring(2, 7)}`,
        courseId,
        firstName: st.firstName || "Alumno",
        lastName: st.lastName || "",
        email: st.email || "",
        avatar: st.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((st.firstName || '') + ' ' + (st.lastName || ''))}&background=1a73e8&color=ffffff&bold=true`,
        attendanceRate: typeof st.attendanceRate === 'number' ? st.attendanceRate : 100,
        averageGrade: typeof st.averageGrade === 'number' ? st.averageGrade : 0,
        notes: st.notes || "Sincronizado desde Google Classroom",
      });
    });

    // Update course studentsCount
    const course = courses.find((c) => c.id === courseId);
    if (course) {
      course.studentsCount = incoming.length;
    }

    saveStudentsToDisk();
    saveCoursesToDisk();

    res.json({
      success: true,
      count: incoming.length,
      students: students.filter((s) => s.courseId === courseId),
    });
  });

  // Clear mock students endpoint
  app.post("/api/students/clear-mock", (_req, res) => {
    const mockNames = ["Valentina Rossi", "Mateo Gómez", "Camila Navarro", "Ignacio Pérez", "Sofía Martínez", "Lucas Benítez", "Agustina Ríos", "Santiago Silva", "Martina López", "Joaquín Fernández", "Lucía Romero", "Benjamín Alvarez", "Sofía Díaz"];
    students = students.filter((s) => !mockNames.includes(`${s.firstName} ${s.lastName}`));
    saveStudentsToDisk();
    res.json({ success: true, remaining: students.length });
  });

  app.post("/api/students", (req, res) => {
    const { courseId, firstName, lastName, email } = req.body;
    if (!courseId || !firstName || !lastName) {
      return res.status(400).json({ error: "Datos incompletos para crear estudiante." });
    }
    const newStudent: Student = {
      id: `s-${Date.now().toString().slice(-4)}`,
      courseId,
      firstName,
      lastName,
      email: email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@colegio.edu.ar`,
      avatar: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      attendanceRate: 100,
      averageGrade: 0,
      notes: "Nuevo estudiante incorporado a la nómina.",
    };
    students.push(newStudent);
    // Update count in course
    const course = courses.find((c) => c.id === courseId);
    if (course) course.studentsCount += 1;
    saveStudentsToDisk();
    saveCoursesToDisk();
    res.status(201).json({ student: newStudent });
  });

  // Attendance batch save
  app.post("/api/attendance", (req, res) => {
    const { courseId, date, records } = req.body;
    // records: { studentId: string, status: 'present' | 'absent' | 'late' | 'excused' }[]
    res.json({
      success: true,
      message: `Asistencia guardada correctamente para ${records?.length || 0} estudiantes en fecha ${date || "hoy"}.`,
      sheetSynced: true,
    });
  });

  // Google Sheets Student Attendance & Disposition History (Script Port)
  interface DispositionRecord {
    id: string;
    studentId: string;
    studentName: string;
    courseId: string;
    date: string; // dd/MM/yyyy
    time: string; // HH:mm:ss
    action: string;
    category: "Ausencia" | "Disposición" | "Llegada tarde" | "Sistema" | "Calificación" | string;
    pointsChange?: number;
    previousDisposition?: number;
    resultingDisposition?: number;
    timestamp: number;
    messageSent?: boolean;
    messageText?: string;
    notificationMethod?: "classroom" | "gmail" | "none";
    notifiedAt?: string;
  }

  let studentDispositionMap: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
  let studentHistoryList: DispositionRecord[] = [];

  const DISPOSITION_DATA_FILE = path.join(process.cwd(), "data", "disposition-records.json");

  // Reconcile and calculate student metrics from history so points drops and absences never reset or get lost
  function recomputeDispositionMapFromHistory() {
    const historyByStudent: Record<string, DispositionRecord[]> = {};
    for (const h of studentHistoryList) {
      if (!h.studentId) continue;
      if (!historyByStudent[h.studentId]) historyByStudent[h.studentId] = [];
      historyByStudent[h.studentId].push(h);
    }

    for (const [studentId, records] of Object.entries(historyByStudent)) {
      const absences = records.filter((r) => r.category === "Ausencia").length;
      const lates = records.filter((r) => r.category === "Llegada tarde").length;
      const dispDrops = records.filter((r) => r.category === "Disposición").length;
      const calculatedDisp = Math.max(0, 10 - dispDrops);

      if (!studentDispositionMap[studentId]) {
        studentDispositionMap[studentId] = {
          totalAbsences: absences,
          totalLates: lates,
          totalDisposition: calculatedDisp,
        };
      } else {
        const cur = studentDispositionMap[studentId];
        cur.totalAbsences = Math.max(cur.totalAbsences ?? 0, absences);
        cur.totalLates = Math.max(cur.totalLates ?? 0, lates);
        if (cur.totalDisposition === undefined || cur.totalDisposition > calculatedDisp) {
          cur.totalDisposition = calculatedDisp;
        }
      }
    }
  }

  function loadDispositionDataFromDisk() {
    try {
      if (fs.existsSync(DISPOSITION_DATA_FILE)) {
        const raw = fs.readFileSync(DISPOSITION_DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.disposition && typeof parsed.disposition === "object") {
          studentDispositionMap = parsed.disposition;
        }
        if (Array.isArray(parsed.history)) {
          studentHistoryList = deduplicateHistoryList(parsed.history);
        }
        recomputeDispositionMapFromHistory();
      }
    } catch (e) {
      console.warn("Failed to load disposition data from disk:", e);
    }
  }

  function saveDispositionDataToDisk() {
    try {
      recomputeDispositionMapFromHistory();
      const dir = path.dirname(DISPOSITION_DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        DISPOSITION_DATA_FILE,
        JSON.stringify({ disposition: studentDispositionMap, history: studentHistoryList }, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.warn("Failed to save disposition data to disk:", e);
    }
  }

  // Load persistent history on startup
  loadDispositionDataFromDisk();

  // Helper to deduplicate history entries (prevents twin records created within near timestamps)
  function deduplicateHistoryList(list: DispositionRecord[]): DispositionRecord[] {
    const result: DispositionRecord[] = [];
    const seenIds = new Set<string>();

    for (const item of list) {
      if (seenIds.has(item.id)) continue;

      const isDuplicate = result.some(
        (existing) =>
          existing.studentId === item.studentId &&
          existing.category === item.category &&
          existing.action === item.action &&
          (Math.abs(existing.timestamp - item.timestamp) < 20000 ||
            (existing.date === item.date && existing.action === item.action && Math.abs(existing.timestamp - item.timestamp) < 60000))
      );

      if (!isDuplicate) {
        seenIds.add(item.id);
        result.push(item);
      }
    }
    return result;
  }

  app.get("/api/disposition", (req, res) => {
    const { courseId, studentId } = req.query;
    recomputeDispositionMapFromHistory();
    studentHistoryList = deduplicateHistoryList(studentHistoryList);
    let filteredHistory = [...studentHistoryList];

    if (courseId) {
      const courseStudentIds = new Set(
        students.filter((s) => s.courseId === courseId).map((s) => s.id)
      );
      filteredHistory = filteredHistory.filter(
        (h) => h.courseId === courseId || courseStudentIds.has(h.studentId)
      );
    }
    if (studentId) {
      filteredHistory = filteredHistory.filter((h) => h.studentId === studentId);
    }

    // Sort by student ascending, then timestamp descending (most recent first) matching the script
    filteredHistory.sort((a, b) => {
      const nameCompare = a.studentName.localeCompare(b.studentName);
      if (nameCompare !== 0) return nameCompare;
      return b.timestamp - a.timestamp;
    });

    res.json({
      disposition: studentDispositionMap,
      history: filteredHistory,
      allHistory: studentHistoryList,
    });
  });

  app.post("/api/disposition/record", (req, res) => {
    const {
      id: clientRecordId,
      studentId,
      studentName,
      courseId,
      action,
      category,
      detail,
      date: clientDate,
      time: clientTime,
      timestamp: clientTimestamp,
    } = req.body;

    if (!studentId || !action || !category) {
      return res.status(400).json({ error: "Faltan datos obligatorios para el registro." });
    }

    let finalAction = action;
    if (category === "Ausencia") {
      finalAction = "Ausencia";
    } else if (category === "Llegada tarde") {
      finalAction = action || "Llegada tarde";
    } else if (category === "Disposición" && action === "Otros") {
      finalAction = detail && detail.trim() ? `Otros: ${detail.trim()}` : "Otros (Sin especificar)";
    }

    const targetTimestamp = clientTimestamp || Date.now();

    // Check if duplicate entry already exists (strictly by same ID or accidental double click < 1s)
    const existing = studentHistoryList.find(
      (h) =>
        (clientRecordId && h.id === clientRecordId) ||
        (h.studentId === studentId &&
          h.category === category &&
          h.action === finalAction &&
          Math.abs(h.timestamp - targetTimestamp) < 1000)
    );

    if (existing) {
      return res.json({
        success: true,
        record: existing,
        summary: studentDispositionMap[studentId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 },
        allDisposition: studentDispositionMap,
      });
    }

    if (!studentDispositionMap[studentId]) {
      studentDispositionMap[studentId] = {
        totalAbsences: 0,
        totalLates: 0,
        totalDisposition: 10,
      };
    }

    const current = studentDispositionMap[studentId];
    let pointsChange = 0;

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = clientDate || `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = clientTime || `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    if (category === "Ausencia") {
      current.totalAbsences += 1;
      // 1. Una asistencia / falta no cambia el puntaje de disposición
      pointsChange = 0;
    } else if (category === "Llegada tarde") {
      // 2. Si el mismo día cambia a tarde, borrar automáticamente las faltas previas de hoy
      const toRemove: number[] = [];
      studentHistoryList.forEach((h, idx) => {
        if (
          h.studentId === studentId &&
          h.category === "Ausencia" &&
          (h.date === date || (h.timestamp && new Date(h.timestamp).toDateString() === now.toDateString()))
        ) {
          toRemove.push(idx);
        }
      });
      if (toRemove.length > 0) {
        for (let i = toRemove.length - 1; i >= 0; i--) {
          studentHistoryList.splice(toRemove[i], 1);
        }
        current.totalAbsences = Math.max(0, current.totalAbsences - toRemove.length);
      }
      current.totalLates = (current.totalLates || 0) + 1;
      pointsChange = 0;
    } else if (category === "Disposición") {
      current.totalDisposition = Math.max(0, current.totalDisposition - 1);
      pointsChange = -1;
    }

    const newRecord: DispositionRecord = {
      id: clientRecordId || `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      studentId,
      studentName: studentName || "Estudiante",
      courseId: courseId || "",
      date,
      time,
      action: finalAction,
      category,
      pointsChange,
      timestamp: targetTimestamp,
      messageSent: req.body.messageSent || false,
      messageText: req.body.messageText || "",
      notificationMethod: req.body.notificationMethod || "none",
      notifiedAt: req.body.notifiedAt,
    };

    studentHistoryList.unshift(newRecord);
    studentHistoryList = deduplicateHistoryList(studentHistoryList);
    saveDispositionDataToDisk();

    // Cascaded update of corresponding student status on backend
    const targetStudent = students.find((s) => s.id === studentId);
    if (targetStudent) {
      targetStudent.attendanceRate = Math.max(0, Math.round(100 - (current.totalAbsences * 5)));
      saveStudentsToDisk();
    }

    res.json({
      success: true,
      record: newRecord,
      summary: current,
      allDisposition: studentDispositionMap,
      student: targetStudent,
      students,
    });
  });

  // Update notification status on existing history record
  app.put("/api/disposition/history/:id/notification", (req, res) => {
    const { id } = req.params;
    const { messageSent, messageText, notificationMethod, notifiedAt } = req.body;
    const record = studentHistoryList.find((h) => h.id === id);
    if (!record) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }

    if (messageSent !== undefined) record.messageSent = messageSent;
    if (messageText !== undefined) record.messageText = messageText;
    if (notificationMethod !== undefined) record.notificationMethod = notificationMethod;
    if (notifiedAt !== undefined) record.notifiedAt = notifiedAt;

    saveDispositionDataToDisk();

    res.json({
      success: true,
      record,
    });
  });

  app.delete("/api/disposition/history/:id", (req, res) => {
    const { id } = req.params;
    const {
      pointsToReturn,
      isAbsence: clientIsAbsence,
      isLate: clientIsLate,
      newAbsences,
      newLates,
      newDisposition,
    } = req.body || {};
    const index = studentHistoryList.findIndex((h) => h.id === id);
    const item = index !== -1 ? studentHistoryList[index] : null;

    if (index !== -1) {
      studentHistoryList.splice(index, 1);
    }

    const studentId = item?.studentId || req.body?.studentId || (req.query?.studentId as string);
    let updatedStudent: any = null;

    if (studentId) {
      if (!studentDispositionMap[studentId]) {
        studentDispositionMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      }
      const current = studentDispositionMap[studentId];

      const isAbsence =
        clientIsAbsence ??
        (item?.category === "Ausencia" ||
          item?.action === "Ausencia" ||
          item?.action?.toLowerCase().includes("ausencia") ||
          item?.action?.toLowerCase().includes("falta"));

      const isLate =
        clientIsLate ??
        (item?.category === "Llegada tarde" ||
          item?.action === "Llegada tarde" ||
          item?.action?.toLowerCase().includes("llegada tarde") ||
          item?.action?.toLowerCase().includes("tardanza") ||
          item?.action?.toLowerCase().includes("tarde"));

      let pts = pointsToReturn;
      if (pts === undefined && item) {
        if (item.pointsChange && item.pointsChange < 0) {
          pts = Math.abs(item.pointsChange);
        } else if (
          item.previousDisposition !== undefined &&
          item.resultingDisposition !== undefined &&
          item.previousDisposition > item.resultingDisposition
        ) {
          pts = item.previousDisposition - item.resultingDisposition;
        } else if (
          item.category === "Disposición" ||
          (!isAbsence && !isLate && item.category !== "Sistema" && item.category !== "Calificación")
        ) {
          pts = 1;
        }
      }

      if (newAbsences !== undefined) {
        current.totalAbsences = Math.max(0, newAbsences);
      } else if (isAbsence) {
        current.totalAbsences = Math.max(0, (current.totalAbsences || 0) - 1);
      }

      if (newLates !== undefined) {
        current.totalLates = Math.max(0, newLates);
      } else if (isLate) {
        current.totalLates = Math.max(0, (current.totalLates || 0) - 1);
      }

      if (newDisposition !== undefined) {
        current.totalDisposition = Math.max(0, Math.min(10, newDisposition));
      } else if (pts && pts > 0) {
        current.totalDisposition = Math.min(10, (current.totalDisposition ?? 10) + pts);
      }

      // Cascaded update of corresponding student status on backend
      const targetStudent = students.find((s) => s.id === studentId);
      if (targetStudent) {
        targetStudent.attendanceRate = Math.max(0, Math.round(100 - (current.totalAbsences * 5)));
        updatedStudent = targetStudent;
        saveStudentsToDisk();
      }
    }

    saveDispositionDataToDisk();

    res.json({
      success: true,
      removed: item,
      summary: studentId ? studentDispositionMap[studentId] : undefined,
      disposition: studentDispositionMap,
      student: updatedStudent,
      students,
    });
  });

  // Bulk sync to permanently ensure all client records are stored on server
  app.post("/api/disposition/sync-full", (req, res) => {
    const { disposition, history, replaceHistory } = req.body;
    if (disposition && typeof disposition === "object") {
      studentDispositionMap = { ...studentDispositionMap, ...disposition };
    }
    if (Array.isArray(history)) {
      if (replaceHistory) {
        studentHistoryList = deduplicateHistoryList(history);
      } else {
        studentHistoryList = deduplicateHistoryList([...history, ...studentHistoryList]);
      }
    }
    saveDispositionDataToDisk();
    res.json({
      success: true,
      count: studentHistoryList.length,
      disposition: studentDispositionMap,
      history: studentHistoryList,
    });
  });

  app.post("/api/disposition/reset", (req, res) => {
    const { studentId, courseId, resetWhat, clearHistory } = req.body;
    // resetWhat: 'disposition' | 'absences' | 'all'
    if (studentId) {
      if (!studentDispositionMap[studentId]) {
        studentDispositionMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      }
      const current = studentDispositionMap[studentId];
      if (resetWhat === "disposition" || resetWhat === "all" || !resetWhat) {
        current.totalDisposition = 10;
      }
      if (resetWhat === "absences" || resetWhat === "all") {
        current.totalAbsences = 0;
      }
      if (resetWhat === "lates" || resetWhat === "all") {
        current.totalLates = 0;
      }
      if (clearHistory) {
        studentHistoryList = studentHistoryList.filter(
          (h) => !(h.studentId === studentId && (resetWhat === "absences" ? h.category === "Ausencia" : h.category === "Disposición"))
        );
      }
    } else if (courseId) {
      // reset for students of this course
      students
        .filter((s) => s.courseId === courseId)
        .forEach((s) => {
          if (!studentDispositionMap[s.id]) {
            studentDispositionMap[s.id] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
          } else {
            const current = studentDispositionMap[s.id];
            if (resetWhat === "disposition" || resetWhat === "all" || !resetWhat) {
              current.totalDisposition = 10;
            }
            if (resetWhat === "absences" || resetWhat === "all") {
              current.totalAbsences = 0;
            }
            if (resetWhat === "lates" || resetWhat === "all") {
              current.totalLates = 0;
            }
          }
        });
      if (clearHistory) {
        studentHistoryList = studentHistoryList.filter(
          (h) => !(h.courseId === courseId && (resetWhat === "absences" ? h.category === "Ausencia" : h.category === "Disposición"))
        );
      }
    }

    saveDispositionDataToDisk();
    res.json({ success: true, disposition: studentDispositionMap, history: studentHistoryList });
  });

  // Course Google Sheets Disposition mapping (persisted to disk)
  function isRealSpreadsheetId(id?: string): boolean {
    return Boolean(
      id &&
      typeof id === 'string' &&
      !id.startsWith('sheet-') &&
      !id.startsWith('libreta-') &&
      !id.startsWith('mock-') &&
      id.length >= 25
    );
  }

  const courseDispositionSheets: Record<string, { spreadsheetId: string; url: string; lastSyncedAt: string }> = {};
  const SHEETS_CONFIG_FILE = path.join(process.cwd(), "data", "sheets-config.json");

  function loadSheetsConfigFromDisk() {
    try {
      if (fs.existsSync(SHEETS_CONFIG_FILE)) {
        const raw = fs.readFileSync(SHEETS_CONFIG_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [cId, item] of Object.entries(parsed as any)) {
            const spId = (item as any)?.spreadsheetId || "";
            const isReal = spId && !spId.startsWith("sheet-") && !spId.startsWith("libreta-") && !spId.startsWith("mock-") && spId.length >= 25;
            courseDispositionSheets[cId] = {
              spreadsheetId: spId,
              url: isReal ? ((item as any)?.url || `https://docs.google.com/spreadsheets/d/${spId}/edit`) : "",
              lastSyncedAt: (item as any)?.lastSyncedAt || "",
            };
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load sheets config from disk:", e);
    }
  }

  function saveSheetsConfigToDisk() {
    try {
      const dir = path.dirname(SHEETS_CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SHEETS_CONFIG_FILE, JSON.stringify(courseDispositionSheets, null, 2), "utf-8");
    } catch (e) {
      console.warn("Failed to save sheets config to disk:", e);
    }
  }

  loadSheetsConfigFromDisk();

  app.get("/api/courses/:courseId/disposition-sheet", (req, res) => {
    const { courseId } = req.params;
    loadSheetsConfigFromDisk();
    let data = courseDispositionSheets[courseId] || null;

    // Check if course has a dedicated sheet saved in courses data
    if ((!data || !data.spreadsheetId) && coursesLoadedFromDisk) {
      const course = courses.find((c) => c.id === courseId || c.classroomCourseId === courseId);
      if (course?.dispositionSheetId && isRealSpreadsheetId(course.dispositionSheetId)) {
        data = {
          spreadsheetId: course.dispositionSheetId,
          url: course.dispositionSheetUrl || `https://docs.google.com/spreadsheets/d/${course.dispositionSheetId}/edit`,
          lastSyncedAt: new Date().toISOString(),
        };
        courseDispositionSheets[courseId] = data;
        saveSheetsConfigToDisk();
      }
    }

    res.json(data || {});
  });

  app.post("/api/courses/:courseId/disposition-sheet", (req, res) => {
    const { courseId } = req.params;
    const { spreadsheetId, url, lastSyncedAt } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "Falta spreadsheetId" });
    }
    const isReal = isRealSpreadsheetId(spreadsheetId);
    const sheetData = {
      spreadsheetId,
      url: isReal ? (url || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`) : "",
      lastSyncedAt: lastSyncedAt || new Date().toISOString(),
    };
    courseDispositionSheets[courseId] = sheetData;
    saveSheetsConfigToDisk();

    // Also update course object if loaded
    const courseIndex = courses.findIndex((c) => c.id === courseId || c.classroomCourseId === courseId);
    if (courseIndex !== -1) {
      courses[courseIndex].dispositionSheetId = spreadsheetId;
      courses[courseIndex].dispositionSheetUrl = sheetData.url;
      saveCoursesToDisk();
    }

    res.json({ success: true, sheet: sheetData });
  });

  app.delete("/api/courses/:courseId/disposition-sheet", (req, res) => {
    const { courseId } = req.params;
    delete courseDispositionSheets[courseId];
    saveSheetsConfigToDisk();

    const courseIndex = courses.findIndex((c) => c.id === courseId || c.classroomCourseId === courseId);
    if (courseIndex !== -1) {
      courses[courseIndex].dispositionSheetId = undefined;
      courses[courseIndex].dispositionSheetUrl = undefined;
      saveCoursesToDisk();
    }

    res.json({ success: true, message: "Hoja de cálculo desvinculada del curso." });
  });

  // Custom Teacher Conduct Options API (persisted to disk)
  const teacherConductOptionsMap: Record<string, string[]> = {};
  const teacherConductTemplatesMap: Record<string, Record<string, string>> = {};
  const TEACHER_SETTINGS_FILE = path.join(process.cwd(), "data", "teacher-settings.json");

  function loadTeacherSettingsFromDisk() {
    try {
      if (fs.existsSync(TEACHER_SETTINGS_FILE)) {
        const raw = fs.readFileSync(TEACHER_SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.options) Object.assign(teacherConductOptionsMap, parsed.options);
        if (parsed?.templates) Object.assign(teacherConductTemplatesMap, parsed.templates);
      }
    } catch (e) {
      console.warn("Failed to load teacher settings from disk:", e);
    }
  }

  function saveTeacherSettingsToDisk() {
    try {
      const dir = path.dirname(TEACHER_SETTINGS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        TEACHER_SETTINGS_FILE,
        JSON.stringify({ options: teacherConductOptionsMap, templates: teacherConductTemplatesMap }, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.warn("Failed to save teacher settings to disk:", e);
    }
  }

  loadTeacherSettingsFromDisk();

  app.get("/api/conduct-options", (req, res) => {
    const teacher = (req.query.teacher as string) || "default";
    res.json({ options: teacherConductOptionsMap[teacher] || [] });
  });

  app.post("/api/conduct-options", (req, res) => {
    const { teacher, options } = req.body;
    const key = teacher || "default";
    if (Array.isArray(options)) {
      teacherConductOptionsMap[key] = options.map((s: any) => String(s).trim()).filter(Boolean);
      saveTeacherSettingsToDisk();
    }
    res.json({ success: true, options: teacherConductOptionsMap[key] || [] });
  });

  // Custom Teacher Conduct Reason Default Message Templates API
  app.get("/api/conduct-templates", (req, res) => {
    const teacher = (req.query.teacher as string) || "default";
    res.json({ templates: teacherConductTemplatesMap[teacher] || {} });
  });

  app.post("/api/conduct-templates", (req, res) => {
    const { teacher, templates } = req.body;
    const key = teacher || "default";
    if (templates && typeof templates === "object") {
      teacherConductTemplatesMap[key] = {
        ...(teacherConductTemplatesMap[key] || {}),
        ...templates,
      };
      saveTeacherSettingsToDisk();
    }
    res.json({ success: true, templates: teacherConductTemplatesMap[key] || {} });
  });

  // Lesson Plans API (Google Docs integrated structure)
  app.get("/api/lesson-plans", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ lessonPlans: lessonPlans.filter((lp) => lp.courseId === courseId) });
    }
    res.json({ lessonPlans });
  });

  app.post("/api/lesson-plans", (req, res) => {
    const { courseId, title, unit, date, duration, objective, competencies, inicio, desarrollo, cierre, assessment, materials } = req.body;
    if (!courseId || !title) {
      return res.status(400).json({ error: "Curso y título de la planificación son obligatorios." });
    }
    const newPlan: LessonPlan = {
      id: `lp-${Date.now().toString().slice(-4)}`,
      courseId,
      title,
      unit: unit || "Unidad Temática",
      date: date || new Date().toISOString().split("T")[0],
      duration: duration || "80 min",
      status: "Borrador",
      objective: objective || "Objetivo de aprendizaje pedagógico.",
      competencies: Array.isArray(competencies) ? competencies : ["Comprensión lectora", "Resolución de problemas"],
      inicio: inicio || "Actividades de inicio y motivación.",
      desarrollo: desarrollo || "Actividades centrales y trabajo en equipo.",
      cierre: cierre || "Evaluación diagnóstica / ticket de salida.",
      assessment: assessment || "Criterios de evaluación formativa.",
      materials: Array.isArray(materials) ? materials : ["Pizarrón", "Guía en Google Docs"],
      googleDocUrl: `https://docs.google.com/document/d/plan-${Date.now().toString().slice(-4)}/edit`,
      googleDocId: `plan-${Date.now().toString().slice(-4)}`,
      lastModified: new Date().toISOString(),
    };
    lessonPlans.unshift(newPlan);
    res.status(201).json({ lessonPlan: newPlan });
  });

  // Gradebook API (Google Sheets integrated structure)
  app.get("/api/gradebook", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ grades: grades.filter((g) => g.courseId === courseId) });
    }
    res.json({ grades });
  });

  app.post("/api/gradebook/update", (req, res) => {
    const { studentId, courseId, evaluationTitle, evaluationType, term, score, maxScore, feedback } = req.body;
    const existing = grades.find(
      (g) => g.studentId === studentId && g.courseId === courseId && g.evaluationTitle === evaluationTitle
    );
    if (existing) {
      existing.score = Number(score);
      existing.feedback = feedback || existing.feedback;
      return res.json({ grade: existing, updated: true });
    }
    const newGrade: GradeEntry = {
      id: `g-${Date.now().toString().slice(-4)}`,
      courseId,
      studentId,
      evaluationTitle,
      evaluationType: evaluationType || "Examen",
      term: term || "1er Trimestre",
      score: Number(score),
      maxScore: maxScore ? Number(maxScore) : 10,
      feedback: feedback || "Calificación registrada",
      date: new Date().toISOString().split("T")[0],
    };
    grades.push(newGrade);
    res.status(201).json({ grade: newGrade, created: true });
  });

  // Drive Resources API (Google Drive structure)
  app.get("/api/drive/files", (req, res) => {
    const { courseId, folder } = req.query;
    let filtered = [...driveResources];
    if (courseId) {
      filtered = filtered.filter((r) => !r.courseId || r.courseId === courseId);
    }
    if (folder) {
      filtered = filtered.filter((r) => r.folder === folder);
    }
    res.json({ files: filtered });
  });

  app.post("/api/drive/upload", (req, res) => {
    const { name, type, folder, courseId } = req.body;
    const newFile: DriveResource = {
      id: `res-${Date.now().toString().slice(-4)}`,
      courseId: courseId || "c-101",
      name: name || "Nuevo Documento.docx",
      mimeType: type === "sheet" ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document",
      type: type || "doc",
      size: "850 KB",
      folder: folder || "Recursos Generales",
      modifiedTime: new Date().toISOString(),
      googleDriveUrl: `https://drive.google.com/open?id=mock-res-${Date.now().toString().slice(-4)}`,
      sharedWithClassroom: false,
    };
    driveResources.unshift(newFile);
    res.status(201).json({ file: newFile });
  });

  // Classroom API
  app.get("/api/classroom/tasks", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: classroomTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: classroomTasks });
  });

  app.post("/api/classroom/publish-task", (req, res) => {
    const { courseId, title, description, dueDate, maxPoints, driveAttachmentName } = req.body;
    const newTask: ClassroomTask = {
      id: `task-${Date.now().toString().slice(-4)}`,
      courseId: courseId || "c-101",
      title: title || "Nueva Tarea de Classroom",
      description: description || "Consignas detalladas en el archivo adjunto.",
      dueDate: dueDate || new Date(Date.now() + 7 * 86400000).toISOString(),
      maxPoints: maxPoints ? Number(maxPoints) : 100,
      status: "Publicada",
      submittedCount: 0,
      assignedCount: courses.find((c) => c.id === courseId)?.studentsCount || 25,
      driveAttachmentName: driveAttachmentName || "Material_Didáctico.gdoc",
      classroomUrl: `https://classroom.google.com/c/mock-${courseId}/a/new-task`,
    };
    classroomTasks.unshift(newTask);
    res.status(201).json({ task: newTask });
  });


  // -------------------------------------------------------------
  // TEACHER TASK & ASSIGNMENT MANAGEMENT API (Module 1)
  // -------------------------------------------------------------
  app.get("/api/tasks", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: teacherTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: teacherTasks });
  });

  app.get("/api/tasks/:id", (req, res) => {
    const task = teacherTasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    res.json({ task });
  });

  app.post("/api/tasks", (req, res) => {
    const { courseId, title, description, category, dueDate, maxPoints, driveAttachments } = req.body;
    if (!courseId || !title) {
      return res.status(400).json({ error: "Curso y título de la tarea son obligatorios." });
    }

    const course = courses.find((c) => c.id === courseId);
    const courseStudents = students.filter((s) => s.courseId === courseId);

    // Build initial student submissions array
    const submissions: StudentSubmission[] = courseStudents.map((student) => ({
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      studentEmail: student.email,
      studentAvatar: student.avatar,
      status: "Pendiente",
      maxPoints: maxPoints ? Number(maxPoints) : 100,
    }));

    const newTask: TeacherTask = {
      id: `tt-${Date.now().toString().slice(-4)}`,
      courseId,
      courseName: course?.name || "Curso",
      title,
      description: description || "Consignas y material de apoyo adjunto.",
      category: category || "Tarea",
      dueDate: dueDate || new Date(Date.now() + 5 * 86400000).toISOString(),
      maxPoints: maxPoints ? Number(maxPoints) : 100,
      status: "Publicada",
      driveAttachments: Array.isArray(driveAttachments) ? driveAttachments : [],
      assignedCount: submissions.length,
      submittedCount: 0,
      gradedCount: 0,
      submissions,
      createdAt: new Date().toISOString(),
    };

    teacherTasks.unshift(newTask);

    // Keep classroomTasks in sync for compatibility
    classroomTasks.unshift({
      id: newTask.id,
      courseId: newTask.courseId,
      title: newTask.title,
      description: newTask.description,
      dueDate: newTask.dueDate,
      maxPoints: newTask.maxPoints,
      status: "Publicada",
      submittedCount: 0,
      assignedCount: newTask.assignedCount,
      driveAttachmentName: newTask.driveAttachments[0]?.name || "Recurso_Drive.gdoc",
      classroomUrl: `https://classroom.google.com/c/${courseId}/a/${newTask.id}`,
    });

    res.status(201).json({ task: newTask });
  });

  app.post("/api/tasks/:taskId/grade", (req, res) => {
    const { taskId } = req.params;
    const { studentId, grade, feedback } = req.body;

    const task = teacherTasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    const sub = task.submissions.find((s) => s.studentId === studentId);
    if (!sub) {
      return res.status(404).json({ error: "Entrega del estudiante no encontrada en esta tarea." });
    }

    sub.status = "Calificado";
    sub.grade = Number(grade);
    if (feedback !== undefined) sub.feedback = feedback;

    // Recalculate stats
    task.gradedCount = task.submissions.filter((s) => s.status === "Calificado").length;
    task.submittedCount = task.submissions.filter((s) => s.status === "Entregado" || s.status === "Calificado" || s.status === "Entrega Tardía").length;

    // Automatically record in course Gradebook for sheets sync!
    const existingGrade = grades.find(
      (g) => g.studentId === studentId && g.courseId === task.courseId && g.evaluationTitle === task.title
    );
    if (existingGrade) {
      existingGrade.score = Number(grade);
      if (feedback) existingGrade.feedback = feedback;
    } else {
      grades.push({
        id: `g-${Date.now().toString().slice(-4)}`,
        courseId: task.courseId,
        studentId,
        evaluationTitle: task.title,
        evaluationType: task.category === "Proyecto" ? "Proyecto" : "Trabajo Práctico",
        term: "1er Trimestre",
        score: Number(grade),
        maxScore: task.maxPoints,
        feedback: feedback || "Calificado desde el Módulo de Tareas",
        date: new Date().toISOString().split("T")[0],
      });
    }

    res.json({ success: true, submission: sub, task });
  });

  app.post("/api/tasks/:taskId/status", (req, res) => {
    const { taskId } = req.params;
    const { status } = req.body;
    const task = teacherTasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    task.status = status;
    res.json({ success: true, task });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    teacherTasks = teacherTasks.filter((t) => t.id !== req.params.id);
    res.json({ success: true, message: "Tarea eliminada correctamente." });
  });

  // -------------------------------------------------------------
  // Google Calendar & Horarios Escolares API Endpoints
  // -------------------------------------------------------------
  interface CalendarEventItemServer {
    id: string;
    calendarId?: string;
    title: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    isAllDay?: boolean;
    category: 'materia' | 'colegio' | 'examen' | 'reunion' | 'feriado';
    courseId?: string;
    courseName?: string;
    color?: string;
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    recurrence?: string;
    htmlLink?: string;
    syncedToGoogle?: boolean;
  }

  // School calendar and course schedule events
  let calendarEvents: CalendarEventItemServer[] = [];

  // GET /api/calendar/events
  app.get("/api/calendar/events", (req, res) => {
    const { courseId, category } = req.query;
    let filtered = [...calendarEvents];
    if (courseId && typeof courseId === "string") {
      filtered = filtered.filter((e) => !e.courseId || e.courseId === courseId);
    }
    if (category && typeof category === "string") {
      filtered = filtered.filter((e) => e.category === category);
    }
    res.json({ success: true, events: filtered });
  });

  // POST /api/calendar/events
  app.post("/api/calendar/events", (req, res) => {
    const data = req.body;
    if (!data.title || !data.start) {
      return res.status(400).json({ error: "Título y fecha de inicio son requeridos" });
    }

    // Check if an equivalent event already exists to prevent infinite duplication
    const cleanTitle = data.title.toLowerCase().trim();
    const existingIndex = calendarEvents.findIndex((e) => {
      // 1. Same exact ID
      if (data.id && e.id === data.id) return true;

      // 2. Class schedule event (same course/title, same dayOfWeek, same start time)
      if (
        (data.category === "materia" || e.category === "materia") &&
        data.dayOfWeek &&
        e.dayOfWeek === data.dayOfWeek &&
        data.startTime &&
        e.startTime === data.startTime &&
        ((data.courseId && e.courseId === data.courseId) ||
          cleanTitle.includes(e.title.toLowerCase().trim()) ||
          e.title.toLowerCase().trim().includes(cleanTitle))
      ) {
        return true;
      }

      // 3. Dated event (same day and same title)
      if (
        e.title.toLowerCase().trim() === cleanTitle &&
        e.start.slice(0, 10) === data.start.slice(0, 10) &&
        (e.startTime || "") === (data.startTime || "")
      ) {
        return true;
      }

      return false;
    });

    const newEvent: CalendarEventItemServer = {
      id: data.id || `cal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: data.title,
      description: data.description || "",
      location: data.location || "",
      start: data.start,
      end: data.end || data.start,
      isAllDay: !!data.isAllDay,
      category: data.category || "colegio",
      courseId: data.courseId,
      courseName: data.courseName,
      color: data.color || "#2563eb",
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      recurrence: data.recurrence || "Única vez",
      htmlLink: data.htmlLink,
      syncedToGoogle: !!data.syncedToGoogle,
    };

    if (existingIndex >= 0) {
      calendarEvents[existingIndex] = { ...calendarEvents[existingIndex], ...newEvent };
      return res.status(200).json({ success: true, event: calendarEvents[existingIndex], updated: true });
    }

    calendarEvents.unshift(newEvent);
    res.status(201).json({ success: true, event: newEvent });
  });

  // POST /api/calendar/deduplicate
  // Removes duplicate and redundant calendar items
  app.post("/api/calendar/deduplicate", (_req, res) => {
    const initialCount = calendarEvents.length;
    const seenKeys = new Set<string>();
    const uniqueEvents: CalendarEventItemServer[] = [];

    for (const ev of calendarEvents) {
      const cleanTitle = (ev.title || "").toLowerCase().trim();
      let dedupeKey = "";

      if (ev.category === "materia" || (ev.dayOfWeek && ev.startTime)) {
        // Deduplicate weekly classes by course + weekday + hour
        const courseKey = ev.courseId || cleanTitle;
        dedupeKey = `class_${courseKey}_d${ev.dayOfWeek}_${ev.startTime || ""}_${ev.endTime || ""}`;
      } else {
        // Deduplicate dated events by title + date
        const dateKey = (ev.start || "").slice(0, 10);
        dedupeKey = `event_${cleanTitle}_${dateKey}_${ev.startTime || ""}`;
      }

      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        uniqueEvents.push(ev);
      }
    }

    calendarEvents = uniqueEvents;
    const removedCount = initialCount - calendarEvents.length;

    res.json({
      success: true,
      removedCount,
      remainingCount: calendarEvents.length,
      message: `Se eliminaron ${removedCount} eventos repetidos. Quedaron ${calendarEvents.length} eventos únicos y organizados.`,
    });
  });

  // POST /api/calendar/clear-classes
  // Clears all repetitive class schedule blocks to allow a clean re-sync
  app.post("/api/calendar/clear-classes", (_req, res) => {
    const initialCount = calendarEvents.length;
    calendarEvents = calendarEvents.filter((e) => e.category !== "materia");
    const clearedCount = initialCount - calendarEvents.length;

    res.json({
      success: true,
      clearedCount,
      remainingCount: calendarEvents.length,
      message: `Se restablecieron los horarios de materias (se limpiaron ${clearedCount} bloques repetidos). Los eventos escolares institucionales se preservaron.`,
    });
  });

  // PUT /api/calendar/events/:id
  app.put("/api/calendar/events/:id", (req, res) => {
    const { id } = req.params;
    const index = calendarEvents.findIndex((e) => e.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }
    calendarEvents[index] = { ...calendarEvents[index], ...req.body };
    res.json({ success: true, event: calendarEvents[index] });
  });

  // DELETE /api/calendar/events/:id
  app.delete("/api/calendar/events/:id", (req, res) => {
    const { id } = req.params;
    calendarEvents = calendarEvents.filter((e) => e.id !== id);
    res.json({ success: true, message: "Evento eliminado del calendario" });
  });

  // POST /api/calendar/sync-course-schedules
  // Generates weekly timetable class events from active courses
  app.post("/api/calendar/sync-course-schedules", (req, res) => {
    const { targetCourseId } = req.body || {};
    const relevantCourses = targetCourseId 
      ? courses.filter(c => c.id === targetCourseId)
      : courses;

    if (relevantCourses.length === 0) {
      return res.json({ success: true, syncedCount: 0, message: "No hay materias para sincronizar horarios." });
    }

    // Days mapping in Spanish
    const dayMap: { [key: string]: number } = {
      lunes: 1,
      martes: 2,
      miercoles: 3,
      miércoles: 3,
      jueves: 4,
      viernes: 5,
    };

    let createdEvents: CalendarEventItemServer[] = [];

    for (const course of relevantCourses) {
      if (!course.schedule) continue;

      // Format example: "Lunes 07:45 - 09:15, Jueves 09:30 - 11:00"
      const parts = course.schedule.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        const match = trimmed.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes)\s*([0-9]{1,2}:[0-9]{2})\s*[-aà]\s*([0-9]{1,2}:[0-9]{2})/i);
        if (match) {
          const dayName = match[1].toLowerCase();
          const dayNum = dayMap[dayName] || 1;
          const sTime = match[2];
          const eTime = match[3];

          // Calculate next occurrence date of that weekday
          const today = new Date();
          const currentDay = today.getDay(); // 0 is Sunday
          let diff = dayNum - currentDay;
          if (diff < 0) diff += 7;
          const classDate = new Date(today);
          classDate.setDate(today.getDate() + diff);
          const dateStr = classDate.toISOString().split("T")[0];

          const eventId = `sched-${course.id}-${dayNum}-${sTime.replace(":", "")}`;
          // Avoid duplicate
          const existingIdx = calendarEvents.findIndex(e => e.id === eventId);
          const newEvent: CalendarEventItemServer = {
            id: eventId,
            title: `Clase: ${course.name}`,
            description: `Materia: ${course.name} | División: ${course.division || course.section || 'General'} | Aula: ${course.room || 'Aula asignada'}`,
            location: course.room ? `Aula ${course.room}` : 'Colegio',
            start: `${dateStr}T${sTime}:00`,
            end: `${dateStr}T${eTime}:00`,
            isAllDay: false,
            category: "materia",
            courseId: course.id,
            courseName: course.name,
            color: course.color || "#1d4ed8",
            dayOfWeek: dayNum,
            startTime: sTime,
            endTime: eTime,
            recurrence: `Semanal los ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`,
            syncedToGoogle: false,
          };

          if (existingIdx >= 0) {
            calendarEvents[existingIdx] = newEvent;
          } else {
            calendarEvents.push(newEvent);
          }
          createdEvents.push(newEvent);
        }
      }
    }

    res.json({
      success: true,
      syncedCount: createdEvents.length,
      events: createdEvents,
      message: `Se sincronizaron ${createdEvents.length} bloques de horarios de clases en el calendario.`,
    });
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Portal Docente Workspace] Servidor full-stack ejecutándose en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
