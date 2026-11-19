/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Calendar & School Schedule API routes isolated per teacher workspace.
 */

import type express from "express";
import type { CalendarEventItemServer } from "./types";
import { sanitizeServerInputText } from "./security";
import type { WorkspaceStore } from "./workspaceStore";

export function registerCalendarRoutes(app: express.Express, store: WorkspaceStore): void {
  // GET /api/calendar/events
  app.get("/api/calendar/events", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { courseId, category } = req.query;
    let filtered = [...ws.calendarEvents];
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
    const ws = store.getSliceForResponse(res);
    const data = req.body;
    if (!data.title || !data.start) {
      return res.status(400).json({ error: "Título y fecha de inicio son requeridos" });
    }

    // Check if an equivalent event already exists to prevent infinite duplication
    const cleanTitle = data.title.toLowerCase().trim();
    const existingIndex = ws.calendarEvents.findIndex((e) => {
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
      ws.calendarEvents[existingIndex] = { ...ws.calendarEvents[existingIndex], ...newEvent };
      return res.status(200).json({ success: true, event: ws.calendarEvents[existingIndex], updated: true });
    }

    ws.calendarEvents.unshift(newEvent);
    res.status(201).json({ success: true, event: newEvent });
  });

  // POST /api/calendar/deduplicate
  // Removes duplicate and redundant calendar items
  app.post("/api/calendar/deduplicate", (_req, res) => {
    const ws = store.getSliceForResponse(res);
    const initialCount = ws.calendarEvents.length;
    const seenKeys = new Set<string>();
    const uniqueEvents: CalendarEventItemServer[] = [];

    for (const ev of ws.calendarEvents) {
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

    ws.calendarEvents = uniqueEvents;
    const removedCount = initialCount - ws.calendarEvents.length;

    res.json({
      success: true,
      removedCount,
      remainingCount: ws.calendarEvents.length,
      message: `Se eliminaron ${removedCount} eventos repetidos. Quedaron ${ws.calendarEvents.length} eventos únicos y organizados.`,
    });
  });

  // POST /api/calendar/clear-classes
  // Clears all repetitive class schedule blocks to allow a clean re-sync
  app.post("/api/calendar/clear-classes", (_req, res) => {
    const ws = store.getSliceForResponse(res);
    const initialCount = ws.calendarEvents.length;
    ws.calendarEvents = ws.calendarEvents.filter((e) => e.category !== "materia");
    const clearedCount = initialCount - ws.calendarEvents.length;

    res.json({
      success: true,
      clearedCount,
      remainingCount: ws.calendarEvents.length,
      message: `Se restablecieron los horarios de materias (se limpiaron ${clearedCount} bloques repetidos). Los eventos escolares institucionales se preservaron.`,
    });
  });

  // PUT /api/calendar/events/:id
  app.put("/api/calendar/events/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    const index = ws.calendarEvents.findIndex((e) => e.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const existing = ws.calendarEvents[index];
    const allowedUpdate: Partial<CalendarEventItemServer> = {};
    if (body.title !== undefined) allowedUpdate.title = sanitizeServerInputText(body.title, 200);
    if (body.description !== undefined) allowedUpdate.description = sanitizeServerInputText(body.description, 1500);
    if (body.location !== undefined) allowedUpdate.location = sanitizeServerInputText(body.location, 200);
    if (body.start !== undefined) allowedUpdate.start = sanitizeServerInputText(body.start, 64);
    if (body.end !== undefined) allowedUpdate.end = sanitizeServerInputText(body.end, 64);
    if (body.isAllDay !== undefined) allowedUpdate.isAllDay = Boolean(body.isAllDay);
    if (body.category !== undefined) allowedUpdate.category = sanitizeServerInputText(body.category, 40) as any;
    if (body.courseId !== undefined) allowedUpdate.courseId = sanitizeServerInputText(body.courseId, 120);
    if (body.courseName !== undefined) allowedUpdate.courseName = sanitizeServerInputText(body.courseName, 200);
    if (body.color !== undefined) allowedUpdate.color = sanitizeServerInputText(body.color, 32);
    if (body.dayOfWeek !== undefined) allowedUpdate.dayOfWeek = Number(body.dayOfWeek);
    if (body.startTime !== undefined) allowedUpdate.startTime = sanitizeServerInputText(body.startTime, 16);
    if (body.endTime !== undefined) allowedUpdate.endTime = sanitizeServerInputText(body.endTime, 16);
    if (body.recurrence !== undefined) allowedUpdate.recurrence = sanitizeServerInputText(body.recurrence, 120);
    if (body.calendarId !== undefined) allowedUpdate.calendarId = sanitizeServerInputText(body.calendarId, 200);
    if (body.htmlLink !== undefined) allowedUpdate.htmlLink = sanitizeServerInputText(body.htmlLink, 500);
    if (body.syncedToGoogle !== undefined) allowedUpdate.syncedToGoogle = Boolean(body.syncedToGoogle);

    ws.calendarEvents[index] = { ...existing, ...allowedUpdate, id: existing.id };
    res.json({ success: true, event: ws.calendarEvents[index] });
  });

  // DELETE /api/calendar/events/:id
  app.delete("/api/calendar/events/:id", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { id } = req.params;
    ws.calendarEvents = ws.calendarEvents.filter((e) => e.id !== id);
    res.json({ success: true, message: "Evento eliminado del calendario" });
  });

  // POST /api/calendar/sync-course-schedules
  // Generates weekly timetable class events from active courses
  app.post("/api/calendar/sync-course-schedules", (req, res) => {
    const ws = store.getSliceForResponse(res);
    const { targetCourseId } = req.body || {};
    const relevantCourses = targetCourseId ? ws.courses.filter((c) => c.id === targetCourseId) : ws.courses;

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

    const createdEvents: CalendarEventItemServer[] = [];

    for (const course of relevantCourses) {
      if (!course.schedule) continue;

      // Format example: "Lunes 07:45 - 09:15, Jueves 09:30 - 11:00"
      const parts = course.schedule.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        const match = trimmed.match(
          /(lunes|martes|mi[eé]rcoles|jueves|viernes)\s*([0-9]{1,2}:[0-9]{2})\s*[-aà]\s*([0-9]{1,2}:[0-9]{2})/i
        );
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
          const existingIdx = ws.calendarEvents.findIndex((e) => e.id === eventId);
          const newEvent: CalendarEventItemServer = {
            id: eventId,
            title: `Clase: ${course.name}`,
            description: `Materia: ${course.name} | División: ${course.division || course.section || "General"} | Aula: ${
              course.room || "Aula asignada"
            }`,
            location: course.room ? `Aula ${course.room}` : "Colegio",
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
            ws.calendarEvents[existingIdx] = newEvent;
          } else {
            ws.calendarEvents.push(newEvent);
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
}
