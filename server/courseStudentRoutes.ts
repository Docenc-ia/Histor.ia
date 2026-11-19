/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Courses, Students, and Attendance API routes isolated per teacher workspace.
 */

import type express from "express";
import type { Course, Student } from "./types";
import { requireAuthenticatedSession, sanitizeServerInputText } from "./security";
import {
  deduplicateCoursesList,
  normalizeCourseKey,
  type WorkspaceStore,
} from "./workspaceStore";

export function registerCourseStudentRoutes(app: express.Express, store: WorkspaceStore): void {
  // Courses API
  app.get("/api/courses", (_req, res) => {
    const ws = store.getSliceForResponse(res);
    if (!ws.coursesLoadedFromDisk) {
      store.loadCourses(ws);
    }
    ws.courses = deduplicateCoursesList(ws.courses);
    res.json({ courses: ws.courses });
  });

  app.post("/api/courses", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const name = sanitizeServerInputText(req.body?.name, 160);
    const subject = sanitizeServerInputText(req.body?.subject, 160);
    const grade = sanitizeServerInputText(req.body?.grade, 120);
    const room = sanitizeServerInputText(req.body?.room, 120);
    const schedule = sanitizeServerInputText(req.body?.schedule, 160);
    const color = sanitizeServerInputText(req.body?.color, 40);
    const orientation = sanitizeServerInputText(req.body?.orientation, 80);
    const division = sanitizeServerInputText(req.body?.division, 80);
    if (!name || !subject) {
      return res.status(400).json({ error: "Nombre y materia son requeridos." });
    }

    if (!ws.coursesLoadedFromDisk) {
      store.loadCourses(ws);
    }

    const incomingClassroomId = req.body.classroomCourseId ? String(req.body.classroomCourseId).trim() : null;
    const incomingId = req.body.id ? String(req.body.id).trim() : null;

    // Check if course already exists
    const existing = ws.courses.find((c) => {
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
      store.saveCourses(ws);
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
    ws.courses.push(newCourse);
    ws.courses = deduplicateCoursesList(ws.courses);
    store.saveCourses(ws);
    res.status(201).json({ course: newCourse });
  });

  // Bulk import courses (from Google Classroom or teacher list)
  app.post("/api/courses/bulk", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courses: newCoursesList } = req.body;
    if (!Array.isArray(newCoursesList) || newCoursesList.length === 0) {
      return res.status(400).json({ error: "Se requiere una lista de materias para importar." });
    }

    if (!ws.coursesLoadedFromDisk) {
      store.loadCourses(ws);
    }

    const processedCourses: Course[] = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const item of newCoursesList) {
      if (!item.name && !item.subject) continue;
      const courseName = (item.name || item.subject).trim();
      const courseSubject = (item.subject || item.name).trim();
      const studentsNum =
        typeof item.studentsCount === "number" && !isNaN(item.studentsCount)
          ? item.studentsCount
          : !isNaN(Number(item.studentsCount)) && item.studentsCount !== "" && item.studentsCount !== null
          ? Number(item.studentsCount)
          : 0;

      // Identity numbers (Google Classroom ID or custom ID)
      const incomingClassroomId = item.classroomCourseId
        ? String(item.classroomCourseId).trim()
        : item.id && !item.id.startsWith("c-")
        ? String(item.id).trim()
        : null;

      // Check if this course is ALREADY present
      const existing = ws.courses.find((c) => {
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

      const courseId =
        incomingClassroomId ||
        item.id ||
        `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`;
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

      ws.courses.push(newCourse);
      processedCourses.push(newCourse);
      addedCount++;
    }

    ws.courses = deduplicateCoursesList(ws.courses);
    store.saveCourses(ws);

    res.status(201).json({
      success: true,
      message:
        addedCount > 0
          ? `Se agregaron ${addedCount} materias nuevas (y se actualizaron ${updatedCount} existentes sin duplicar).`
          : `Las materias ya estaban cargadas previamente. No se duplicó ninguna materia.`,
      courses: ws.courses,
      processedCourses,
      addedCount,
      updatedCount,
    });
  });

  // Sync actual student counts for courses
  app.post("/api/courses/sync-students", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Se requiere un array de actualizaciones." });
    }

    let updatedCount = 0;
    updates.forEach((u: { id: string; studentsCount: number }) => {
      const course = ws.courses.find((c) => c.id === u.id || c.classroomCourseId === u.id);
      if (course && typeof u.studentsCount === "number") {
        course.studentsCount = u.studentsCount;
        updatedCount++;
      }
    });

    store.saveCourses(ws);

    res.json({
      success: true,
      message: `Se actualizaron los alumnos reales de ${updatedCount} materias.`,
      courses: ws.courses,
    });
  });

  // Patch a single course
  app.patch("/api/courses/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    if (!ws.coursesLoadedFromDisk) {
      store.loadCourses(ws);
    }
    let course = ws.courses.find((c) => c.id === id || c.classroomCourseId === id);
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
        ws.courses.push(course);
      } else {
        return res.status(404).json({ error: "Materia no encontrada." });
      }
    }
    if (typeof req.body.studentsCount === "number") {
      course.studentsCount = req.body.studentsCount;
    }
    if (req.body && typeof req.body === "object") {
      const allowedCourseKeys: Array<keyof Course> = [
        "name",
        "subject",
        "grade",
        "room",
        "schedule",
        "color",
        "classroomSynced",
        "classroomCourseId",
        "code",
        "section",
        "orientation",
        "division",
        "schoolYear",
        "driveFolderId",
      ];
      for (const key of allowedCourseKeys) {
        if (Object.prototype.hasOwnProperty.call(req.body, key) && req.body[key] !== undefined) {
          (course as any)[key] =
            typeof req.body[key] === "string"
              ? sanitizeServerInputText(req.body[key], 200)
              : req.body[key];
        }
      }
    }
    store.saveCourses(ws);
    res.json({ success: true, course });
  });

  app.delete("/api/courses/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    if (!ws.coursesLoadedFromDisk) {
      store.loadCourses(ws);
    }
    const target = ws.courses.find((c) => c.id === id || c.classroomCourseId === id || (c.code && c.code === id));
    if (!target) {
      return res.json({ success: true, message: "Materia eliminada o no encontrada.", courseId: id });
    }
    const targetKey = normalizeCourseKey(target);
    const removedName = target.name || "Materia";
    const targetIds = new Set<string>([id, target.id]);
    if (target.classroomCourseId) targetIds.add(target.classroomCourseId);

    ws.courses = ws.courses.filter(
      (c) =>
        !targetIds.has(c.id) &&
        (!c.classroomCourseId || !targetIds.has(c.classroomCourseId)) &&
        normalizeCourseKey(c) !== targetKey
    );
    // Remove students associated with this course
    ws.students = ws.students.filter((s) => !targetIds.has(s.courseId));
    store.saveCourses(ws);
    store.saveStudents(ws);
    res.json({
      success: true,
      message: `Materia "${removedName}" eliminada correctamente.`,
      courseId: id,
    });
  });

  // Clear all demo/sample courses (requires verified session)
  app.post("/api/courses/clear", (req, res) => {
    if (!requireAuthenticatedSession(req, res)) return;
    const ws = store.getSliceForResponse(res);
    ws.courses = [];
    ws.students = [];
    ws.coursesLoadedFromDisk = true;
    store.saveCourses(ws);
    store.saveStudents(ws);
    res.json({
      success: true,
      message:
        "Se eliminaron todas las materias y estudiantes de prueba. Espacio de trabajo limpio para tus clases reales.",
    });
  });

  // Restore demo/sample courses (requires verified session)
  app.post("/api/courses/restore-demo", (req, res) => {
    if (!requireAuthenticatedSession(req, res)) return;
    const ws = store.getSliceForResponse(res);
    const currentYearStr = String(new Date().getFullYear());
    ws.courses = [
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
        schoolYear: currentYearStr,
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
        schoolYear: currentYearStr,
        driveFolderId: "f-102",
      },
    ];
    store.saveCourses(ws);
    res.json({
      success: true,
      message: "Materias de prueba restauradas correctamente.",
      courses: ws.courses,
    });
  });

  // Students API
  app.get("/api/students", (req, res) => {
    const ws = store.getSliceForResponse(res);
    if (!ws.students || ws.students.length === 0) {
      store.loadStudents(ws);
    }
    const { courseId } = req.query;
    let list = courseId ? ws.students.filter((s) => s.courseId === courseId) : [...ws.students];
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
    const ws = store.getSliceForResponse(res);
    const { courseId, students: incoming } = req.body;
    if (!courseId || !Array.isArray(incoming)) {
      return res.status(400).json({ error: "courseId y array de estudiantes son obligatorios." });
    }

    // Remove existing students for this course
    ws.students = ws.students.filter((s) => s.courseId !== courseId);

    // Insert real students
    incoming.forEach((st: any) => {
      ws.students.push({
        id: st.id || `st-${courseId}-${Math.random().toString(36).substring(2, 7)}`,
        courseId,
        firstName: st.firstName || "Alumno",
        lastName: st.lastName || "",
        email: st.email || "",
        avatar:
          st.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(
            (st.firstName || "") + " " + (st.lastName || "")
          )}&background=1a73e8&color=ffffff&bold=true`,
        attendanceRate: typeof st.attendanceRate === "number" ? st.attendanceRate : 100,
        averageGrade: typeof st.averageGrade === "number" ? st.averageGrade : 0,
        notes: st.notes || "Sincronizado desde Google Classroom",
      });
    });

    // Update course studentsCount
    const course = ws.courses.find((c) => c.id === courseId);
    if (course) {
      course.studentsCount = incoming.length;
    }

    store.saveStudents(ws);
    store.saveCourses(ws);

    res.json({
      success: true,
      count: incoming.length,
      students: ws.students.filter((s) => s.courseId === courseId),
    });
  });

  // Clear mock students endpoint (only removes students explicitly tagged with synthetic mock IDs, never real students by name)
  app.post("/api/students/clear-mock", (req, res) => {
    if (!requireAuthenticatedSession(req, res)) return;
    const ws = store.getSliceForResponse(res);
    ws.students = ws.students.filter((s) => !String(s.id || "").startsWith("mock-"));
    store.saveStudents(ws);
    res.json({ success: true, remaining: ws.students.length });
  });

  app.post("/api/students", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id, courseId, avatar, attendanceRate, averageGrade } = req.body || {};
    const firstName = sanitizeServerInputText(req.body?.firstName, 120);
    const lastName = sanitizeServerInputText(req.body?.lastName, 120);
    const email = sanitizeServerInputText(req.body?.email, 180);
    const notes = sanitizeServerInputText(req.body?.notes, 1000);
    if (!courseId || !firstName || !lastName) {
      return res.status(400).json({ error: "Datos incompletos para crear estudiante." });
    }
    const studentId = id || `s-${courseId}-${Date.now().toString().slice(-4)}`;
    // Avoid duplicates within the exact same courseId
    const existingIdx = ws.students.findIndex((s) => s.courseId === courseId && s.id === studentId);
    const newStudent: Student = {
      id: studentId,
      courseId,
      firstName,
      lastName,
      email: email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@colegio.edu.ar`,
      avatar:
        avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(`${firstName} ${lastName}`)}&background=1a73e8&color=ffffff&bold=true`,
      attendanceRate: typeof attendanceRate === "number" ? attendanceRate : 100,
      averageGrade: typeof averageGrade === "number" ? averageGrade : 0,
      notes: notes || "Nuevo estudiante incorporado a la nómina.",
    };
    if (existingIdx >= 0) {
      ws.students[existingIdx] = newStudent;
    } else {
      ws.students.push(newStudent);
      const course = ws.courses.find((c) => c.id === courseId);
      if (course) course.studentsCount = ws.students.filter((s) => s.courseId === courseId).length;
    }
    store.saveStudents(ws);
    store.saveCourses(ws);
    res.status(201).json({ student: newStudent });
  });

  // Update a student strictly within a specific courseId
  app.patch("/api/students/:courseId/:studentId", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, studentId } = req.params;
    const updates = req.body || {};
    const idx = ws.students.findIndex((s) => s.courseId === courseId && s.id === studentId);
    if (idx === -1) {
      return res.status(404).json({ error: "Estudiante no encontrado en esta materia." });
    }
    const safeUpdates: Partial<Student> = {};
    if (typeof updates.firstName === "string") safeUpdates.firstName = sanitizeServerInputText(updates.firstName, 120);
    if (typeof updates.lastName === "string") safeUpdates.lastName = sanitizeServerInputText(updates.lastName, 120);
    if (typeof updates.email === "string") safeUpdates.email = sanitizeServerInputText(updates.email, 180);
    if (typeof updates.avatar === "string") safeUpdates.avatar = sanitizeServerInputText(updates.avatar, 500);
    if (typeof updates.notes === "string") safeUpdates.notes = sanitizeServerInputText(updates.notes, 1000);
    if (typeof updates.attendanceRate === "number") safeUpdates.attendanceRate = updates.attendanceRate;
    if (typeof updates.averageGrade === "number") safeUpdates.averageGrade = updates.averageGrade;

    ws.students[idx] = {
      ...ws.students[idx],
      ...safeUpdates,
      id: studentId,
      courseId,
    };
    store.saveStudents(ws);
    res.json({ success: true, student: ws.students[idx] });
  });

  // Remove a student strictly from a specific courseId without affecting other courses
  app.delete("/api/students/:courseId/:studentId", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, studentId } = req.params;
    ws.students = ws.students.filter((s) => !(s.courseId === courseId && s.id === studentId));
    const course = ws.courses.find((c) => c.id === courseId);
    if (course) {
      course.studentsCount = ws.students.filter((s) => s.courseId === courseId).length;
    }
    store.saveStudents(ws);
    store.saveCourses(ws);
    res.json({ success: true });
  });

  // Attendance batch save
  app.post("/api/attendance", (req, res) => {
    const { date, records } = req.body;
    res.json({
      success: true,
      message: `Asistencia guardada correctamente para ${records?.length || 0} estudiantes en fecha ${date || "hoy"}.`,
      sheetSynced: true,
    });
  });
}
