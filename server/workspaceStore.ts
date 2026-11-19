/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Concurrency-safe per-teacher workspace store (ISO/IEC 27001 A.5.15 & A.8.3).
 * Replaces shared module-level mutable globals with isolated TeacherWorkspaceSlice
 * instances resolved per request from the cryptographically verified session identity.
 */

import type express from "express";
import fs from "fs";
import path from "path";
import type { Course, DispositionRecord, TeacherWorkspaceSlice } from "./types";
import { PRIMARY_OWNER_IDENTIFIERS, writeJsonFileAtomic } from "./security";

export function normalizeCourseKey(c: Partial<Course>): string {
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

export function deduplicateCoursesList(list: Course[]): Course[] {
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
        existing.classroomCourseId && existing.id === existing.classroomCourseId
          ? existing.id
          : c.classroomCourseId && c.id === c.classroomCourseId
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

export function deduplicateHistoryList(list: DispositionRecord[]): DispositionRecord[] {
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
          (existing.date === item.date &&
            existing.action === item.action &&
            Math.abs(existing.timestamp - item.timestamp) < 60000))
    );

    if (!isDuplicate) {
      seenIds.add(item.id);
      result.push(item);
    }
  }
  return result;
}

export class WorkspaceStore {
  private readonly slices = new Map<string, TeacherWorkspaceSlice>();
  private readonly teacherConductOptionsMap: Record<string, string[]> = {};
  private readonly teacherConductTemplatesMap: Record<string, Record<string, string>> = {};
  private readonly teacherSettingsFile = path.join(process.cwd(), "data", "teacher-settings.json");

  constructor() {
    this.loadTeacherSettingsFromDisk();
    // Preload primary owner workspace at startup to preserve existing startup behavior
    this.getSlice("owner");
  }

  public resolveWorkspaceKeyFromResponse(res: express.Response): string {
    const verifiedEmail = String(res.locals?.authenticatedEmail || "")
      .trim()
      .toLowerCase();

    if (!verifiedEmail) return "anonymous";
    if (PRIMARY_OWNER_IDENTIFIERS.has(verifiedEmail)) return "owner";

    const safeKey = verifiedEmail.replace(/[^a-z0-9._-]/g, "_").slice(0, 64);
    return safeKey ? `user_${safeKey}` : "anonymous";
  }

  private getWorkspaceDataFiles(workspaceKey: string) {
    if (workspaceKey === "owner") {
      return {
        coursesFile: path.join(process.cwd(), "data", "courses.json"),
        studentsFile: path.join(process.cwd(), "data", "students.json"),
        dispositionFile: path.join(process.cwd(), "data", "disposition-records.json"),
      };
    }
    const userDir = path.join(process.cwd(), "data", "users", workspaceKey);
    return {
      coursesFile: path.join(userDir, "courses.json"),
      studentsFile: path.join(userDir, "students.json"),
      dispositionFile: path.join(userDir, "disposition-records.json"),
    };
  }

  public getSlice(workspaceKey: string): TeacherWorkspaceSlice {
    const existing = this.slices.get(workspaceKey);
    if (existing && existing.initialized) {
      return existing;
    }

    const files = this.getWorkspaceDataFiles(workspaceKey);
    const slice: TeacherWorkspaceSlice = {
      workspaceKey,
      coursesFile: files.coursesFile,
      studentsFile: files.studentsFile,
      dispositionFile: files.dispositionFile,
      courses: [],
      students: [],
      coursesLoadedFromDisk: false,
      studentsLoadedFromDisk: false,
      studentDispositionMap: {},
      studentHistoryList: [],
      lessonPlans: [],
      grades: [],
      driveResources: [],
      classroomTasks: [],
      teacherTasks: [],
      calendarEvents: [],
      initialized: true,
    };

    this.loadCourses(slice);
    this.loadStudents(slice);
    this.loadDisposition(slice);

    this.slices.set(workspaceKey, slice);
    return slice;
  }

  public getSliceForResponse(res: express.Response): TeacherWorkspaceSlice {
    const wsKey = this.resolveWorkspaceKeyFromResponse(res);
    res.locals.workspaceKey = wsKey;
    return this.getSlice(wsKey);
  }

  public loadCourses(ws: TeacherWorkspaceSlice): void {
    try {
      if (fs.existsSync(ws.coursesFile)) {
        const raw = fs.readFileSync(ws.coursesFile, "utf-8");
        const parsed = JSON.parse(raw);
        let list: Course[] = [];
        if (Array.isArray(parsed.courses)) {
          list = parsed.courses;
        } else if (Array.isArray(parsed)) {
          list = parsed;
        }
        ws.courses = deduplicateCoursesList(list);
      } else {
        ws.courses = [];
      }
      ws.coursesLoadedFromDisk = true;
    } catch (e) {
      console.warn("Failed to load courses from disk:", e);
      ws.coursesLoadedFromDisk = true;
    }
  }

  public saveCourses(ws: TeacherWorkspaceSlice): void {
    try {
      ws.courses = deduplicateCoursesList(ws.courses);
      writeJsonFileAtomic(ws.coursesFile, { courses: ws.courses });
    } catch (e) {
      console.warn("Failed to save courses to disk:", e);
    }
  }

  public loadStudents(ws: TeacherWorkspaceSlice): void {
    try {
      if (fs.existsSync(ws.studentsFile)) {
        const raw = fs.readFileSync(ws.studentsFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.students)) {
          ws.students = parsed.students;
        } else if (Array.isArray(parsed)) {
          ws.students = parsed;
        }
      }
      ws.studentsLoadedFromDisk = true;
    } catch (e) {
      console.warn("Failed to load students from disk:", e);
      ws.studentsLoadedFromDisk = true;
    }
  }

  public saveStudents(ws: TeacherWorkspaceSlice): void {
    try {
      writeJsonFileAtomic(ws.studentsFile, { students: ws.students });
    } catch (e) {
      console.warn("Failed to save students to disk:", e);
    }
  }

  public recomputeDispositionMapFromHistory(ws: TeacherWorkspaceSlice): void {
    const historyByStudent: Record<string, DispositionRecord[]> = {};
    for (const h of ws.studentHistoryList) {
      if (!h.studentId) continue;
      if (!historyByStudent[h.studentId]) historyByStudent[h.studentId] = [];
      historyByStudent[h.studentId].push(h);
    }

    for (const [studentId, records] of Object.entries(historyByStudent)) {
      const absences = records.filter((r) => r.category === "Ausencia").length;
      const lates = records.filter((r) => r.category === "Llegada tarde").length;
      const dispDrops = records.filter((r) => r.category === "Disposición").length;
      const calculatedDisp = Math.max(0, 10 - dispDrops);

      if (!ws.studentDispositionMap[studentId]) {
        ws.studentDispositionMap[studentId] = {
          totalAbsences: absences,
          totalLates: lates,
          totalDisposition: calculatedDisp,
        };
      } else {
        const cur = ws.studentDispositionMap[studentId];
        cur.totalAbsences = Math.max(cur.totalAbsences ?? 0, absences);
        cur.totalLates = Math.max(cur.totalLates ?? 0, lates);
        if (cur.totalDisposition === undefined || cur.totalDisposition > calculatedDisp) {
          cur.totalDisposition = calculatedDisp;
        }
      }
    }
  }

  public loadDisposition(ws: TeacherWorkspaceSlice): void {
    try {
      if (fs.existsSync(ws.dispositionFile)) {
        const raw = fs.readFileSync(ws.dispositionFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.disposition && typeof parsed.disposition === "object") {
          ws.studentDispositionMap = parsed.disposition;
        }
        if (Array.isArray(parsed.history)) {
          ws.studentHistoryList = deduplicateHistoryList(parsed.history);
        }
        this.recomputeDispositionMapFromHistory(ws);
      }
    } catch (e) {
      console.warn("Failed to load disposition data from disk:", e);
    }
  }

  public saveDisposition(ws: TeacherWorkspaceSlice): void {
    try {
      this.recomputeDispositionMapFromHistory(ws);
      writeJsonFileAtomic(ws.dispositionFile, {
        disposition: ws.studentDispositionMap,
        history: ws.studentHistoryList,
      });
    } catch (e) {
      console.warn("Failed to save disposition data to disk:", e);
    }
  }

  // Teacher conduct options & message templates (persisted to data/teacher-settings.json)
  private loadTeacherSettingsFromDisk(): void {
    try {
      if (fs.existsSync(this.teacherSettingsFile)) {
        const raw = fs.readFileSync(this.teacherSettingsFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.options) Object.assign(this.teacherConductOptionsMap, parsed.options);
        if (parsed?.templates) Object.assign(this.teacherConductTemplatesMap, parsed.templates);
      }
    } catch (e) {
      console.warn("Failed to load teacher settings from disk:", e);
    }
  }

  private saveTeacherSettingsToDisk(): void {
    try {
      writeJsonFileAtomic(this.teacherSettingsFile, {
        options: this.teacherConductOptionsMap,
        templates: this.teacherConductTemplatesMap,
      });
    } catch (e) {
      console.warn("Failed to save teacher settings to disk:", e);
    }
  }

  private resolveScopedTeacherSettingKey(workspaceKey: string, requestedTeacher?: string): string {
    const baseKey = String(requestedTeacher || "default").trim() || "default";
    // Preserve legacy unscoped key for primary owner so existing saved options/templates are 100% preserved
    if (workspaceKey === "owner") return baseKey;
    return `${workspaceKey}::${baseKey}`;
  }

  public getConductOptions(workspaceKey: string, requestedTeacher?: string): string[] {
    const key = this.resolveScopedTeacherSettingKey(workspaceKey, requestedTeacher);
    return this.teacherConductOptionsMap[key] || [];
  }

  public setConductOptions(workspaceKey: string, requestedTeacher: string | undefined, options: unknown): string[] {
    const key = this.resolveScopedTeacherSettingKey(workspaceKey, requestedTeacher);
    if (Array.isArray(options)) {
      this.teacherConductOptionsMap[key] = options.map((s) => String(s).trim()).filter(Boolean);
      this.saveTeacherSettingsToDisk();
    }
    return this.teacherConductOptionsMap[key] || [];
  }

  public getConductTemplates(workspaceKey: string, requestedTeacher?: string): Record<string, string> {
    const key = this.resolveScopedTeacherSettingKey(workspaceKey, requestedTeacher);
    return this.teacherConductTemplatesMap[key] || {};
  }

  public mergeConductTemplates(
    workspaceKey: string,
    requestedTeacher: string | undefined,
    templates: unknown
  ): Record<string, string> {
    const key = this.resolveScopedTeacherSettingKey(workspaceKey, requestedTeacher);
    if (templates && typeof templates === "object") {
      this.teacherConductTemplatesMap[key] = {
        ...(this.teacherConductTemplatesMap[key] || {}),
        ...(templates as Record<string, string>),
      };
      this.saveTeacherSettingsToDisk();
    }
    return this.teacherConductTemplatesMap[key] || {};
  }
}

export const workspaceStore = new WorkspaceStore();
