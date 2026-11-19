/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Student Attendance & Disposition History API routes isolated per teacher workspace.
 */

import type express from "express";
import type { DispositionRecord } from "./types";
import { sanitizeServerInputText } from "./security";
import { deduplicateHistoryList, type WorkspaceStore } from "./workspaceStore";

export function registerDispositionRoutes(app: express.Express, store: WorkspaceStore): void {
  app.get("/api/disposition", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, studentId } = req.query;
    store.recomputeDispositionMapFromHistory(ws);
    ws.studentHistoryList = deduplicateHistoryList(ws.studentHistoryList);
    let filteredHistory = [...ws.studentHistoryList];

    if (courseId) {
      const courseStudentIds = new Set(ws.students.filter((s) => s.courseId === courseId).map((s) => s.id));
      filteredHistory = filteredHistory.filter((h) => h.courseId === courseId || courseStudentIds.has(h.studentId));
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
      disposition: ws.studentDispositionMap,
      history: filteredHistory,
      allHistory: ws.studentHistoryList,
    });
  });

  app.post("/api/disposition/record", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const {
      id: clientRecordId,
      studentId,
      courseId,
      date: clientDate,
      time: clientTime,
      timestamp: clientTimestamp,
    } = req.body || {};
    const studentName = sanitizeServerInputText(req.body?.studentName, 160);
    const action = sanitizeServerInputText(req.body?.action, 300);
    const category = sanitizeServerInputText(req.body?.category, 80);
    const detail = sanitizeServerInputText(req.body?.detail, 400);

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
    const existing = ws.studentHistoryList.find(
      (h) =>
        (clientRecordId && h.id === clientRecordId) ||
        (h.studentId === studentId &&
          h.category === category &&
          h.action === finalAction &&
          Math.abs(h.timestamp - targetTimestamp) < 1000)
    );

    if (existing) {
      let updatedExisting = false;
      if (req.body?.messageSent !== undefined) {
        existing.messageSent = Boolean(req.body.messageSent);
        updatedExisting = true;
      }
      if (req.body?.messageText !== undefined) {
        existing.messageText = req.body.messageText;
        updatedExisting = true;
      }
      if (req.body?.notificationMethod !== undefined) {
        existing.notificationMethod = req.body.notificationMethod;
        updatedExisting = true;
      }
      if (req.body?.omitNotification !== undefined) {
        (existing as any).omitNotification = Boolean(req.body.omitNotification);
        updatedExisting = true;
      }
      if (req.body?.notifiedAt !== undefined) {
        existing.notifiedAt = req.body.notifiedAt;
        updatedExisting = true;
      }
      if (updatedExisting) {
        store.saveDisposition(ws);
      }
      return res.json({
        success: true,
        record: existing,
        summary: ws.studentDispositionMap[studentId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 },
        allDisposition: ws.studentDispositionMap,
      });
    }

    if (!ws.studentDispositionMap[studentId]) {
      ws.studentDispositionMap[studentId] = {
        totalAbsences: 0,
        totalLates: 0,
        totalDisposition: 10,
      };
    }

    const current = ws.studentDispositionMap[studentId];
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
      ws.studentHistoryList.forEach((h, idx) => {
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
          ws.studentHistoryList.splice(toRemove[i], 1);
        }
        current.totalAbsences = Math.max(0, current.totalAbsences - toRemove.length);
      }
      current.totalLates = (current.totalLates || 0) + 1;
      pointsChange = 0;
    } else if (category === "Disposición") {
      current.totalDisposition = Math.max(0, current.totalDisposition - 1);
      pointsChange = -1;
    }

    const newRecord: DispositionRecord & { omitNotification?: boolean } = {
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
      omitNotification: Boolean(req.body.omitNotification),
      notifiedAt: req.body.notifiedAt,
    };

    ws.studentHistoryList.unshift(newRecord);
    ws.studentHistoryList = deduplicateHistoryList(ws.studentHistoryList);
    store.saveDisposition(ws);

    // Cascaded update of corresponding student status on backend
    const targetStudent = ws.students.find((s) => s.id === studentId);
    if (targetStudent) {
      targetStudent.attendanceRate = Math.max(0, Math.round(100 - current.totalAbsences * 5));
      store.saveStudents(ws);
    }

    res.json({
      success: true,
      record: newRecord,
      summary: current,
      allDisposition: ws.studentDispositionMap,
      student: targetStudent,
      students: ws.students,
    });
  });

  // Update notification status on existing history record
  app.put("/api/disposition/history/:id/notification", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    const { messageSent, messageText, notificationMethod, omitNotification, notifiedAt } = req.body;
    const record = ws.studentHistoryList.find((h) => h.id === id);
    if (!record) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }

    if (messageSent !== undefined) record.messageSent = messageSent;
    if (messageText !== undefined) record.messageText = messageText;
    if (notificationMethod !== undefined) record.notificationMethod = notificationMethod;
    if (omitNotification !== undefined) (record as any).omitNotification = Boolean(omitNotification);
    if (notifiedAt !== undefined) record.notifiedAt = notifiedAt;

    store.saveDisposition(ws);

    res.json({
      success: true,
      record,
    });
  });

  app.delete("/api/disposition/history/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    const {
      pointsToReturn,
      isAbsence: clientIsAbsence,
      isLate: clientIsLate,
      newAbsences,
      newLates,
      newDisposition,
    } = req.body || {};
    const index = ws.studentHistoryList.findIndex((h) => h.id === id);
    const item = index !== -1 ? ws.studentHistoryList[index] : null;

    if (index !== -1) {
      ws.studentHistoryList.splice(index, 1);
    }

    const studentId = item?.studentId || req.body?.studentId || (req.query?.studentId as string);
    let updatedStudent: any = null;

    if (studentId) {
      if (!ws.studentDispositionMap[studentId]) {
        ws.studentDispositionMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      }
      const current = ws.studentDispositionMap[studentId];

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
      const targetStudent = ws.students.find((s) => s.id === studentId);
      if (targetStudent) {
        targetStudent.attendanceRate = Math.max(0, Math.round(100 - current.totalAbsences * 5));
        updatedStudent = targetStudent;
        store.saveStudents(ws);
      }
    }

    store.saveDisposition(ws);

    res.json({
      success: true,
      removed: item,
      summary: studentId ? ws.studentDispositionMap[studentId] : undefined,
      disposition: ws.studentDispositionMap,
      student: updatedStudent,
      students: ws.students,
    });
  });

  // Bulk sync to permanently ensure all client records are stored on server
  app.post("/api/disposition/sync-full", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { disposition, history, replaceHistory } = req.body;
    if (disposition && typeof disposition === "object") {
      ws.studentDispositionMap = { ...ws.studentDispositionMap, ...disposition };
    }
    if (Array.isArray(history)) {
      if (replaceHistory) {
        ws.studentHistoryList = deduplicateHistoryList(history);
      } else {
        ws.studentHistoryList = deduplicateHistoryList([...history, ...ws.studentHistoryList]);
      }
    }
    store.saveDisposition(ws);
    res.json({
      success: true,
      count: ws.studentHistoryList.length,
      disposition: ws.studentDispositionMap,
      history: ws.studentHistoryList,
    });
  });

  app.post("/api/disposition/reset", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { studentId, courseId, resetWhat, clearHistory } = req.body;
    // resetWhat: 'disposition' | 'absences' | 'all'
    if (studentId) {
      if (!ws.studentDispositionMap[studentId]) {
        ws.studentDispositionMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      }
      const current = ws.studentDispositionMap[studentId];
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
        const shouldClearCategory = (category: string): boolean => {
          if (resetWhat === "all") {
            return category === "Ausencia" || category === "Llegada tarde" || category === "Disposición";
          }
          if (resetWhat === "absences") return category === "Ausencia";
          if (resetWhat === "lates") return category === "Llegada tarde";
          return category === "Disposición";
        };
        ws.studentHistoryList = ws.studentHistoryList.filter(
          (h) => !(h.studentId === studentId && shouldClearCategory(h.category))
        );
      }
    } else if (courseId) {
      // reset for students of this course
      ws.students
        .filter((s) => s.courseId === courseId)
        .forEach((s) => {
          if (!ws.studentDispositionMap[s.id]) {
            ws.studentDispositionMap[s.id] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
          } else {
            const current = ws.studentDispositionMap[s.id];
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
        const shouldClearCategory = (category: string): boolean => {
          if (resetWhat === "all") {
            return category === "Ausencia" || category === "Llegada tarde" || category === "Disposición";
          }
          if (resetWhat === "absences") return category === "Ausencia";
          if (resetWhat === "lates") return category === "Llegada tarde";
          return category === "Disposición";
        };
        ws.studentHistoryList = ws.studentHistoryList.filter(
          (h) => !(h.courseId === courseId && shouldClearCategory(h.category))
        );
      }
    }

    store.saveDisposition(ws);
    res.json({ success: true, disposition: ws.studentDispositionMap, history: ws.studentHistoryList });
  });
}
