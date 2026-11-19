/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Academic Workspace API routes (conduct options/templates, lesson plans,
 * gradebook, Drive resources, Classroom tasks, and Teacher tasks),
 * isolated per teacher workspace via WorkspaceStore.
 */

import type express from "express";
import type {
  ClassroomTask,
  DriveResource,
  GradeEntry,
  LessonPlan,
  StudentSubmission,
  TeacherTask,
} from "./types";
import type { WorkspaceStore } from "./workspaceStore";

export function registerAcademicRoutes(app: express.Express, store: WorkspaceStore): void {
  // Custom Teacher Conduct Options API (persisted to disk)
  app.get("/api/conduct-options", (req, res) => {
    const wsKey = store.resolveWorkspaceKeyFromResponse(res);
    const options = store.getConductOptions(wsKey, req.query.teacher as string | undefined);
    res.json({ options });
  });

  app.post("/api/conduct-options", (req, res) => {
    const wsKey = store.resolveWorkspaceKeyFromResponse(res);
    const { teacher, options } = req.body;
    const updated = store.setConductOptions(wsKey, teacher, options);
    res.json({ success: true, options: updated });
  });

  // Custom Teacher Conduct Reason Default Message Templates API
  app.get("/api/conduct-templates", (req, res) => {
    const wsKey = store.resolveWorkspaceKeyFromResponse(res);
    const templates = store.getConductTemplates(wsKey, req.query.teacher as string | undefined);
    res.json({ templates });
  });

  app.post("/api/conduct-templates", (req, res) => {
    const wsKey = store.resolveWorkspaceKeyFromResponse(res);
    const { teacher, templates } = req.body;
    const updated = store.mergeConductTemplates(wsKey, teacher, templates);
    res.json({ success: true, templates: updated });
  });

  // Lesson Plans API (Google Docs integrated structure)
  app.get("/api/lesson-plans", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ lessonPlans: ws.lessonPlans.filter((lp) => lp.courseId === courseId) });
    }
    res.json({ lessonPlans: ws.lessonPlans });
  });

  app.post("/api/lesson-plans", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const {
      courseId,
      title,
      unit,
      date,
      duration,
      objective,
      competencies,
      inicio,
      desarrollo,
      cierre,
      assessment,
      materials,
    } = req.body;
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
    ws.lessonPlans.unshift(newPlan);
    res.status(201).json({ lessonPlan: newPlan });
  });

  // Gradebook API (Google Sheets integrated structure)
  app.get("/api/gradebook", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ grades: ws.grades.filter((g) => g.courseId === courseId) });
    }
    res.json({ grades: ws.grades });
  });

  app.post("/api/gradebook/update", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { studentId, courseId, evaluationTitle, evaluationType, term, score, maxScore, feedback } = req.body;
    const existing = ws.grades.find(
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
    ws.grades.push(newGrade);
    res.status(201).json({ grade: newGrade, created: true });
  });

  // Drive Resources API (Google Drive structure)
  app.get("/api/drive/files", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, folder } = req.query;
    let filtered = [...ws.driveResources];
    if (courseId) {
      filtered = filtered.filter((r) => !r.courseId || r.courseId === courseId);
    }
    if (folder) {
      filtered = filtered.filter((r) => r.folder === folder);
    }
    res.json({ files: filtered });
  });

  app.post("/api/drive/upload", (req, res) => {
    const ws = store.getSliceForResponse(res);
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
    ws.driveResources.unshift(newFile);
    res.status(201).json({ file: newFile });
  });

  // Classroom API
  app.get("/api/classroom/tasks", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: ws.classroomTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: ws.classroomTasks });
  });

  app.post("/api/classroom/publish-task", (req, res) => {
    const ws = store.getSliceForResponse(res);
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
      assignedCount: ws.courses.find((c) => c.id === courseId)?.studentsCount || 25,
      driveAttachmentName: driveAttachmentName || "Material_Didáctico.gdoc",
      classroomUrl: `https://classroom.google.com/c/mock-${courseId}/a/new-task`,
    };
    ws.classroomTasks.unshift(newTask);
    res.status(201).json({ task: newTask });
  });

  // -------------------------------------------------------------
  // TEACHER TASK & ASSIGNMENT MANAGEMENT API (Module 1)
  // -------------------------------------------------------------
  app.get("/api/tasks", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: ws.teacherTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: ws.teacherTasks });
  });

  app.get("/api/tasks/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const task = ws.teacherTasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    res.json({ task });
  });

  app.post("/api/tasks", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, title, description, category, dueDate, maxPoints, driveAttachments } = req.body;
    if (!courseId || !title) {
      return res.status(400).json({ error: "Curso y título de la tarea son obligatorios." });
    }

    const course = ws.courses.find((c) => c.id === courseId);
    const courseStudents = ws.students.filter((s) => s.courseId === courseId);

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

    ws.teacherTasks.unshift(newTask);

    // Keep classroomTasks in sync for compatibility
    ws.classroomTasks.unshift({
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
    const ws = store.getSliceForResponse(res);
    const { taskId } = req.params;
    const { studentId, grade, feedback } = req.body;

    const task = ws.teacherTasks.find((t) => t.id === taskId);
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
    task.submittedCount = task.submissions.filter(
      (s) => s.status === "Entregado" || s.status === "Calificado" || s.status === "Entrega Tardía"
    ).length;

    // Automatically record in course Gradebook for sheets sync
    const existingGrade = ws.grades.find(
      (g) => g.studentId === studentId && g.courseId === task.courseId && g.evaluationTitle === task.title
    );
    if (existingGrade) {
      existingGrade.score = Number(grade);
      if (feedback) existingGrade.feedback = feedback;
    } else {
      ws.grades.push({
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
    const ws = store.getSliceForResponse(res);
    const { taskId } = req.params;
    const { status } = req.body;
    const task = ws.teacherTasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    task.status = status;
    res.json({ success: true, task });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    ws.teacherTasks = ws.teacherTasks.filter((t) => t.id !== req.params.id);
    res.json({ success: true, message: "Tarea eliminada correctamente." });
  });
}
