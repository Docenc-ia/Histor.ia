/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Course, Student } from '../types';
import { firestoreSync, getActiveUserId, isPrimaryOwnerAccount } from './firestoreSync';
export { isPrimaryOwnerAccount };
import { safeSetLocalStorageItem, runStorageMaintenanceOnce } from '../utils/storageGuard';
import { emitAppEvent } from '../utils/appEventBus';
import {
  isValidCourseSchedule,
  getEffectiveScheduleStringForCourse,
  formatCourseSidebarLabel,
} from '../utils/courseFormatting';

// Run non-destructive storage compaction once on startup
runStorageMaintenanceOnce();

// LocalStorage keys for client-side persistence (Vercel & static deployment support)
export const STORAGE_KEYS = {
  COURSES: 'docencia_courses_data',
  STUDENTS: 'docencia_students_data',
  TASKS: 'docencia_tasks_data',
  ATTENDANCE: 'docencia_attendance_data',
  DISPOSITION: 'docencia_disposition_data',
  DISPOSITION_HISTORY: 'docencia_disposition_history',
};

export function getUserStorageKey(baseKey: string): string {
  const userId = getActiveUserId();
  return userId ? `${baseKey}_${userId}` : baseKey;
}

export function normalizeCourseCanonicalKey(c: Partial<Course>): string {
  if (!c) return '';
  if (
    c.classroomCourseId &&
    !c.classroomCourseId.startsWith('gc-') &&
    !isNaN(Number(c.classroomCourseId))
  ) {
    return `classroom:${String(c.classroomCourseId).trim()}`;
  }

  const label = formatCourseSidebarLabel(c as Course)
    .trim()
    .toLowerCase();
  const name = (c.name || '').trim().toLowerCase();
  const sub = (c.subject || '').trim().toLowerCase();
  const div = (c.division || '').trim().toLowerCase();
  const grade = (c.grade || '').trim().toLowerCase();
  const sec = (c.section || '').trim().toLowerCase();
  const meaningfulSec = sec && sec !== '1' && sec !== 'a' ? sec : '';

  const paren = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (paren) {
    return `name:${paren[1].trim()}:${paren[2].trim()}`;
  }
  if (label && label.includes('(')) {
    return `label:${label}`;
  }
  const groupKey = div || meaningfulSec || grade || sec || 'main';
  return `name:${name || sub}:${sub || name}:${groupKey}`;
}

export function areCoursesSame(c1: Partial<Course>, c2: Partial<Course>): boolean {
  if (!c1 || !c2) return false;
  if (c1 === c2) return true;
  if (c1.id && c2.id && String(c1.id).trim() === String(c2.id).trim()) return true;

  const id1 = c1.classroomCourseId ? String(c1.classroomCourseId).trim() : null;
  const id2 = c2.classroomCourseId ? String(c2.classroomCourseId).trim() : null;

  if (id1 && id2 && id1 === id2) return true;
  if (id1 && (c2.id === id1 || c2.classroomCourseId === id1)) return true;
  if (id2 && (c1.id === id2 || c1.classroomCourseId === id2)) return true;

  // If both are manual courses with distinct IDs and neither is a Classroom ID, check full identity
  if (
    c1.id &&
    c2.id &&
    c1.id !== c2.id &&
    !id1 &&
    !id2 &&
    ((c1.name || '').trim().toLowerCase() !== (c2.name || '').trim().toLowerCase() ||
      (c1.division || '').trim().toLowerCase() !== (c2.division || '').trim().toLowerCase())
  ) {
    return false;
  }

  const k1 = normalizeCourseCanonicalKey(c1);
  const k2 = normalizeCourseCanonicalKey(c2);
  if (k1 && k2 && k1 === k2) return true;

  return false;
}

function isValidRoom(r?: string | null): boolean {
  if (!r || typeof r !== 'string') return false;
  const clean = r.trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();
  return lower !== 'aula asignada' && lower !== 'aula principal' && lower !== 'sin aula';
}

function pickBestSchedule(newerSched?: string | null, olderSched?: string | null, fallbackCourse?: Partial<Course>): string {
  const nValid = isValidCourseSchedule(newerSched);
  const oValid = isValidCourseSchedule(olderSched);
  const nHasTime = nValid && /\d{1,2}:\d{2}/.test(newerSched!);
  const oHasTime = oValid && /\d{1,2}:\d{2}/.test(olderSched!);

  // If newer has explicit time, or both/neither have explicit time and newer is valid, prefer newer
  if (nHasTime) return newerSched!.trim();
  if (oHasTime && !nValid) return olderSched!.trim();
  if (nValid) return newerSched!.trim();
  if (oValid) return olderSched!.trim();

  if (fallbackCourse) {
    const eff = getEffectiveScheduleStringForCourse(fallbackCourse);
    if (eff) return eff;
  }
  return (newerSched || olderSched || '').trim();
}

export function deduplicateCourses(coursesList: Course[]): Course[] {
  if (!Array.isArray(coursesList) || coursesList.length === 0) return [];
  const result: Course[] = [];
  const indexById = new Map<string, number>();
  const indexByClassroomId = new Map<string, number>();
  const indexByCanonical = new Map<string, number>();

  for (const c of coursesList) {
    if (!c || (!c.name && !c.subject)) continue;

    const cId = c.id ? String(c.id).trim() : '';
    const cClassroomId = c.classroomCourseId ? String(c.classroomCourseId).trim() : '';
    const cCanonical = normalizeCourseCanonicalKey(c);

    let existingIdx = -1;
    if (cId && indexById.has(cId)) existingIdx = indexById.get(cId)!;
    else if (cId && indexByClassroomId.has(cId)) existingIdx = indexByClassroomId.get(cId)!;
    else if (cClassroomId && indexByClassroomId.has(cClassroomId)) existingIdx = indexByClassroomId.get(cClassroomId)!;
    else if (cClassroomId && indexById.has(cClassroomId)) existingIdx = indexById.get(cClassroomId)!;
    else if (cCanonical && indexByCanonical.has(cCanonical)) {
      const candidateIdx = indexByCanonical.get(cCanonical)!;
      const candidate = result[candidateIdx];
      if (areCoursesSame(candidate, c)) {
        existingIdx = candidateIdx;
      }
    }

    if (existingIdx >= 0) {
      const existing = result[existingIdx];
      const preferredId =
        existing.classroomCourseId && existing.id === existing.classroomCourseId
          ? existing.id
          : c.classroomCourseId && c.id === c.classroomCourseId
          ? c.id
          : existing.id || c.id;

      const resolvedSchedule = pickBestSchedule(c.schedule, existing.schedule, {
        ...existing,
        ...c,
        id: preferredId,
      });

      const resolvedRoom = isValidRoom(c.room)
        ? c.room!.trim()
        : isValidRoom(existing.room)
        ? existing.room!.trim()
        : c.room || existing.room || '';

      const merged: Course = {
        ...existing,
        ...c,
        id: preferredId,
        classroomSynced: Boolean(existing.classroomSynced || c.classroomSynced),
        studentsCount: Math.max(Number(existing.studentsCount) || 0, Number(c.studentsCount) || 0),
        name: c.name || existing.name,
        subject: c.subject || existing.subject,
        grade: c.grade || existing.grade,
        section: c.section || existing.section,
        division: c.division || existing.division,
        orientation:
          c.orientation && c.orientation !== 'Secundaria'
            ? c.orientation
            : existing.orientation && existing.orientation !== 'Secundaria'
            ? existing.orientation
            : c.orientation || existing.orientation,
        room: resolvedRoom,
        schedule: resolvedSchedule,
        preferredCalendarId:
          (c.preferredCalendarId && c.preferredCalendarId !== 'primary'
            ? c.preferredCalendarId
            : existing.preferredCalendarId) ||
          c.preferredCalendarId ||
          existing.preferredCalendarId,
        schoolYear: c.schoolYear || existing.schoolYear || '2026',
      };
      const classroomId = existing.classroomCourseId || c.classroomCourseId;
      if (classroomId) merged.classroomCourseId = classroomId;
      else delete merged.classroomCourseId;

      const sheetId = c.dispositionSheetId || existing.dispositionSheetId;
      if (sheetId) merged.dispositionSheetId = sheetId;
      else delete merged.dispositionSheetId;

      const sheetUrl = c.dispositionSheetUrl || existing.dispositionSheetUrl;
      if (sheetUrl) merged.dispositionSheetUrl = sheetUrl;
      else delete merged.dispositionSheetUrl;

      const driveFolderId = c.driveFolderId || existing.driveFolderId;
      if (driveFolderId) merged.driveFolderId = driveFolderId;
      else delete merged.driveFolderId;

      const driveFolderUrl = c.driveFolderUrl || existing.driveFolderUrl;
      if (driveFolderUrl) merged.driveFolderUrl = driveFolderUrl;
      else delete merged.driveFolderUrl;

      result[existingIdx] = merged;
      if (merged.id) indexById.set(String(merged.id).trim(), existingIdx);
      if (merged.classroomCourseId) indexByClassroomId.set(String(merged.classroomCourseId).trim(), existingIdx);
    } else {
      const hydratedCourse = isValidCourseSchedule(c.schedule)
        ? c
        : (() => {
            const recovered = getEffectiveScheduleStringForCourse(c);
            return recovered ? { ...c, schedule: recovered } : c;
          })();
      const newIdx = result.length;
      result.push(hydratedCourse);
      if (cId) indexById.set(cId, newIdx);
      if (cClassroomId) indexByClassroomId.set(cClassroomId, newIdx);
      if (cCanonical) indexByCanonical.set(cCanonical, newIdx);
    }
  }

  return result;
}

export function deduplicateStudents(studentsList: Student[]): Student[] {
  if (!Array.isArray(studentsList) || studentsList.length === 0) return [];
  const result: Student[] = [];
  const indexByCourseAndId = new Map<string, number>();
  const indexByUnscopedId = new Map<string, number>();
  const indexByCourseAndEmail = new Map<string, number>();
  const indexByCourseAndName = new Map<string, number>();

  for (const st of studentsList) {
    if (!st || (!st.firstName && !st.lastName)) continue;
    const stId = st.id ? String(st.id).trim() : '';
    const cleanEmail = (st.email || '').trim().toLowerCase();
    const cleanName = `${(st.firstName || '').trim()} ${(st.lastName || '').trim()}`.trim().toLowerCase();
    const cId = st.courseId ? String(st.courseId).trim() : '';

    let existingIdx = -1;
    if (stId && cId && indexByCourseAndId.has(`${cId}::${stId}`)) {
      existingIdx = indexByCourseAndId.get(`${cId}::${stId}`)!;
    } else if (stId && (!cId || indexByUnscopedId.has(stId))) {
      const candidateIdx = indexByUnscopedId.get(stId);
      if (candidateIdx !== undefined) {
        const ex = result[candidateIdx];
        if (!cId || !ex.courseId || ex.courseId === cId) {
          existingIdx = candidateIdx;
        }
      }
    } else if (cId && cleanEmail && indexByCourseAndEmail.has(`${cId}::${cleanEmail}`)) {
      existingIdx = indexByCourseAndEmail.get(`${cId}::${cleanEmail}`)!;
    } else if (cId && cleanName && indexByCourseAndName.has(`${cId}::${cleanName}`)) {
      existingIdx = indexByCourseAndName.get(`${cId}::${cleanName}`)!;
    }

    if (existingIdx >= 0) {
      const merged: Student = {
        ...result[existingIdx],
        ...st,
        id: result[existingIdx].id || st.id,
      };
      result[existingIdx] = merged;
      const mCourse = merged.courseId ? String(merged.courseId).trim() : '';
      if (merged.id) {
        if (mCourse) indexByCourseAndId.set(`${mCourse}::${merged.id}`, existingIdx);
        indexByUnscopedId.set(String(merged.id).trim(), existingIdx);
      }
      if (mCourse && cleanEmail) indexByCourseAndEmail.set(`${mCourse}::${cleanEmail}`, existingIdx);
      if (mCourse && cleanName) indexByCourseAndName.set(`${mCourse}::${cleanName}`, existingIdx);
    } else {
      const newIdx = result.length;
      result.push(st);
      if (stId) {
        if (cId) indexByCourseAndId.set(`${cId}::${stId}`, newIdx);
        indexByUnscopedId.set(stId, newIdx);
      }
      if (cId && cleanEmail) indexByCourseAndEmail.set(`${cId}::${cleanEmail}`, newIdx);
      if (cId && cleanName) indexByCourseAndName.set(`${cId}::${cleanName}`, newIdx);
    }
  }

  return result;
}

// In-memory read caches + Write-Behind queue for 0ms reads and non-blocking writes
let cachedCourses: { userId: string; list: Course[] } | null = null;
let cachedStudents: { userId: string; list: Student[] } | null = null;
let cachedDisposition: {
  userId: string;
  data: { disposition: Record<string, any>; history: any[] };
} | null = null;
let cachedDisposition2c: { userId: string; data: Record<string, any> } | null = null;
let cachedDeletedHistoryIds: { userId: string; set: Set<string> } | null = null;
let cachedRemovedIndex: { userId: string; data: Record<string, string[]> } | null = null;
const cachedRemovedCourseIds = new Map<string, Set<string>>();
const cachedRemovedCourseLists = new Map<string, Student[]>();

// Write-Behind queue: batches expensive JSON.stringify + localStorage writes off the hot UI path
const pendingWriteBehindTasks = new Map<string, () => void>();
let writeBehindTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_BEHIND_DELAY_MS = 120;

export function flushStorageWriteBehind(): void {
  if (writeBehindTimer !== null) {
    clearTimeout(writeBehindTimer);
    writeBehindTimer = null;
  }
  if (pendingWriteBehindTasks.size === 0) return;
  const tasks = Array.from(pendingWriteBehindTasks.values());
  pendingWriteBehindTasks.clear();
  for (const task of tasks) {
    try {
      task();
    } catch (err) {
      console.warn('Error flushing write-behind storage task:', err);
    }
  }
}

function scheduleWriteBehind(taskKey: string, taskFn: () => void): void {
  pendingWriteBehindTasks.set(taskKey, taskFn);
  if (writeBehindTimer === null) {
    writeBehindTimer = setTimeout(() => {
      flushStorageWriteBehind();
    }, WRITE_BEHIND_DELAY_MS);
  }
}

export function invalidateStorageMemoryCache(): void {
  flushStorageWriteBehind();
  cachedCourses = null;
  cachedStudents = null;
  cachedDisposition = null;
  cachedDisposition2c = null;
  cachedDeletedHistoryIds = null;
  cachedRemovedIndex = null;
  cachedRemovedCourseIds.clear();
  cachedRemovedCourseLists.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => {
    cachedCourses = null;
    cachedStudents = null;
    cachedDisposition = null;
    cachedDisposition2c = null;
    cachedDeletedHistoryIds = null;
    cachedRemovedIndex = null;
    cachedRemovedCourseIds.clear();
    cachedRemovedCourseLists.clear();
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushStorageWriteBehind();
    }
  });

  window.addEventListener('pagehide', () => {
    flushStorageWriteBehind();
  });

  window.addEventListener('beforeunload', () => {
    flushStorageWriteBehind();
  });
}

export function getLocalCourses(): Course[] {
  if (typeof window === 'undefined') return [];
  try {
    const userId = getActiveUserId();
    if (cachedCourses && cachedCourses.userId === userId) {
      return cachedCourses.list;
    }
    const isOwner = isPrimaryOwnerAccount();
    const explicitlyCleared = localStorage.getItem('docencia_courses_explicitly_cleared') === 'true';
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    const primaryRaw = localStorage.getItem(key);
    const candidateKeys = isOwner ? [key, STORAGE_KEYS.COURSES, 'docencia_persisted_courses'] : [key];

    for (const k of candidateKeys) {
      const raw = k === key ? primaryRaw : localStorage.getItem(k);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const deduped = deduplicateCourses(parsed);
            cachedCourses = { userId, list: deduped };
            return deduped;
          }
        } catch (_) {}
      }
    }

    if (isOwner && !explicitlyCleared) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('docencia_courses') || k.includes('courses'))) {
          try {
            const item = localStorage.getItem(k);
            if (item) {
              const p = JSON.parse(item);
              if (Array.isArray(p) && p.length > 0 && p[0]?.id && (p[0]?.name || p[0]?.subject)) {
                const deduped = deduplicateCourses(p);
                cachedCourses = { userId, list: deduped };
                return deduped;
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return [];
}

export function saveLocalCourses(coursesList: Course[], forceClear = false): void {
  if (typeof window === 'undefined') return;
  try {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const cleanList = deduplicateCourses(coursesList);
    if (cleanList.length === 0 && !forceClear) {
      return;
    }
    cachedCourses = { userId, list: cleanList };
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    emitAppEvent('docencia_courses_updated');

    scheduleWriteBehind(`courses_${userId}`, () => {
      const dataStr = JSON.stringify(cleanList);
      safeSetLocalStorageItem(key, dataStr);
      if (isOwner) {
        safeSetLocalStorageItem(STORAGE_KEYS.COURSES, dataStr);
        safeSetLocalStorageItem('docencia_persisted_courses', dataStr);
      }
      if (cleanList.length > 0) {
        localStorage.removeItem('docencia_courses_explicitly_cleared');
      } else if (forceClear) {
        if (isOwner) {
          safeSetLocalStorageItem('docencia_courses_explicitly_cleared', 'true');
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('docencia_courses') || k === 'docencia_persisted_courses')) {
              safeSetLocalStorageItem(k, '[]');
            }
          }
        } else {
          safeSetLocalStorageItem(key, '[]');
        }
      }
    });
  } catch (_) {}
}

function filterOutRemovedStudents(students: Student[]): Student[] {
  if (!Array.isArray(students) || students.length === 0) return [];
  const removedCache = new Map<string, Set<string>>();
  return students.filter((s) => {
    if (!s?.courseId) return true;
    let set = removedCache.get(s.courseId);
    if (!set) {
      set = getRemovedStudentIds(s.courseId);
      removedCache.set(s.courseId, set);
    }
    return !set.has(s.id);
  });
}

export function getLocalStudents(courseId?: string): Student[] {
  if (typeof window === 'undefined') return [];
  try {
    const userId = getActiveUserId();
    if (cachedStudents && cachedStudents.userId === userId) {
      const visible = filterOutRemovedStudents(cachedStudents.list);
      return courseId ? visible.filter((s) => s.courseId === courseId) : visible;
    }
    const isOwner = isPrimaryOwnerAccount();
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    let raw = localStorage.getItem(key);
    if (isOwner && !raw && key !== STORAGE_KEYS.STUDENTS) {
      raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    }
    if (isOwner && !raw) {
      raw = localStorage.getItem('docencia_persisted_students');
    }
    if (raw) {
      const parsed: Student[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const deduped = deduplicateStudents(parsed);
        cachedStudents = { userId, list: deduped };
        const clean = filterOutRemovedStudents(deduped);
        return courseId ? clean.filter((s) => s.courseId === courseId) : clean;
      }
    }
    if (isOwner) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('docencia_students') || k.includes('students'))) {
          try {
            const item = localStorage.getItem(k);
            if (item) {
              const p = JSON.parse(item);
              if (Array.isArray(p) && p.length > 0 && p[0]?.id && p[0]?.firstName) {
                const deduped = deduplicateStudents(p);
                cachedStudents = { userId, list: deduped };
                const clean = filterOutRemovedStudents(deduped);
                return courseId ? clean.filter((s: Student) => s.courseId === courseId) : clean;
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return [];
}

export function saveLocalStudents(courseIdOrList: string | Student[], studentsList?: Student[]): void {
  if (typeof window === 'undefined') return;
  try {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    let updated: Student[];
    if (Array.isArray(courseIdOrList)) {
      updated = deduplicateStudents(courseIdOrList);
    } else {
      const courseId = courseIdOrList;
      const all = getLocalStudents();
      const rest = all.filter((s) => s.courseId !== courseId);
      updated = deduplicateStudents([...rest, ...(studentsList || [])]);
    }
    cachedStudents = { userId, list: updated };

    scheduleWriteBehind(`students_${userId}`, () => {
      const dataStr = JSON.stringify(updated);
      safeSetLocalStorageItem(key, dataStr);
      if (isOwner) {
        safeSetLocalStorageItem(STORAGE_KEYS.STUDENTS, dataStr);
        safeSetLocalStorageItem('docencia_persisted_students', dataStr);
      }
    });
  } catch (_) {}
}

export const PRIMARY_DISPOSITION_KEY = 'fds_disposition_data_v2';
export const PRIMARY_HISTORY_KEY = 'fds_disposition_history_v2';
export const DELETED_HISTORY_IDS_KEY = 'docencia_deleted_history_ids';

/**
 * Reads a user-scoped key from localStorage, falling back to the legacy un-scoped key
 * ONLY for the primary owner account so existing data is never lost while isolating other teachers.
 */
export function getUserScopedItem(baseKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const scopedKey = getUserStorageKey(baseKey);
    const val = localStorage.getItem(scopedKey);
    if (val !== null) return val;
    if (isPrimaryOwnerAccount()) {
      return localStorage.getItem(baseKey);
    }
  } catch (_) {}
  return null;
}

/**
 * Writes a user-scoped key to localStorage, and also mirrors to the legacy un-scoped key
 * if the active account is the primary owner.
 */
export function setUserScopedItem(baseKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const scopedKey = getUserStorageKey(baseKey);
    safeSetLocalStorageItem(scopedKey, value);
    if (isPrimaryOwnerAccount() && scopedKey !== baseKey) {
      safeSetLocalStorageItem(baseKey, value);
    }
  } catch (_) {}
}

export const getStorageItemForUser = getUserScopedItem;
export const setStorageItemForUser = setUserScopedItem;

export function getDeletedHistoryIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const userId = getActiveUserId();
    if (cachedDeletedHistoryIds && cachedDeletedHistoryIds.userId === userId) {
      return new Set(cachedDeletedHistoryIds.set);
    }
    const raw = getUserScopedItem(DELETED_HISTORY_IDS_KEY);
    const parsedSet = raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    cachedDeletedHistoryIds = { userId, set: parsedSet };
    return new Set(parsedSet);
  } catch (_) {}
  return new Set();
}

export function markHistoryIdDeleted(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const userId = getActiveUserId();
    const set = getDeletedHistoryIds();
    set.add(id);
    cachedDeletedHistoryIds = { userId, set };
    if (cachedDisposition && cachedDisposition.userId === userId) {
      cachedDisposition = {
        userId,
        data: {
          disposition: cachedDisposition.data.disposition,
          history: cachedDisposition.data.history.filter((h) => h?.id !== id),
        },
      };
    }
    scheduleWriteBehind(`deleted_history_${userId}`, () => {
      setUserScopedItem(DELETED_HISTORY_IDS_KEY, JSON.stringify(Array.from(set)));
    });
  } catch (_) {}
}

export function deduplicateHistoryItems(list: any[]): any[] {
  const result: any[] = [];
  const seenIds = new Set<string>();
  const deleted = getDeletedHistoryIds();
  for (const item of list) {
    if (!item?.id || seenIds.has(item.id) || deleted.has(item.id)) continue;
    seenIds.add(item.id);
    result.push(item);
  }
  return result;
}

export function saveAllDispositionStorage(
  disposition: Record<string, any>,
  history: any[],
  options?: { silent?: boolean }
): void {
  if (typeof window === 'undefined') return;
  try {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const deleted = getDeletedHistoryIds();
    const cleanHistory = (history || []).filter((h) => h?.id && !deleted.has(h.id));
    const safeDisposition = disposition || {};

    // 1. Update in-memory cache immediately (0ms synchronous memory update)
    cachedDisposition = {
      userId,
      data: { disposition: safeDisposition, history: cleanHistory },
    };

    // 2. Schedule JSON serialization & localStorage persistence via write-behind
    scheduleWriteBehind(`disposition_${userId}`, () => {
      const dispJson = JSON.stringify(safeDisposition);
      const histJson = JSON.stringify(cleanHistory);

      const keysDisp: string[] = isOwner
        ? [PRIMARY_DISPOSITION_KEY, 'docencia_disposition_data', STORAGE_KEYS.DISPOSITION]
        : [];
      const keysHist: string[] = isOwner
        ? [PRIMARY_HISTORY_KEY, 'docencia_disposition_history', STORAGE_KEYS.DISPOSITION_HISTORY]
        : [];
      if (userId) {
        keysDisp.push(`docencia_disposition_data_${userId}`);
        keysHist.push(`docencia_disposition_history_${userId}`);
      }

      const uniqueDispKeys = Array.from(new Set(keysDisp));
      const uniqueHistKeys = Array.from(new Set(keysHist));

      for (const k of uniqueDispKeys) {
        safeSetLocalStorageItem(k, dispJson);
      }
      for (const k of uniqueHistKeys) {
        safeSetLocalStorageItem(k, histJson);
      }
    });

    if (!options?.silent) {
      emitAppEvent('docencia_disposition_storage_change', {
        disposition: safeDisposition,
        history: cleanHistory,
      });
    }
  } catch (err) {
    console.warn('Error saving disposition to storage:', err);
  }
}

export function getAllDispositionStorage(): { disposition: Record<string, any>; history: any[] } {
  if (typeof window === 'undefined') return { disposition: {}, history: [] };
  const userId = getActiveUserId();
  if (cachedDisposition && cachedDisposition.userId === userId) {
    return cachedDisposition.data;
  }

  const isOwner = isPrimaryOwnerAccount();
  const deleted = getDeletedHistoryIds();
  let disposition: Record<string, any> = {};
  let history: any[] = [];
  const keysDisp = new Set<string>(
    isOwner
      ? [
          PRIMARY_DISPOSITION_KEY,
          ...(userId ? [`docencia_disposition_data_${userId}`] : []),
          'docencia_disposition_data',
          STORAGE_KEYS.DISPOSITION,
        ]
      : userId
      ? [`docencia_disposition_data_${userId}`]
      : []
  );

  const keysHist = new Set<string>(
    isOwner
      ? [
          PRIMARY_HISTORY_KEY,
          ...(userId ? [`docencia_disposition_history_${userId}`] : []),
          'docencia_disposition_history',
          STORAGE_KEYS.DISPOSITION_HISTORY,
        ]
      : userId
      ? [`docencia_disposition_history_${userId}`]
      : []
  );

  if (isOwner) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          (k.startsWith('docencia_disposition_data_') || k === 'fds_disposition_data' || k.startsWith('fds_disposition_data__')) &&
          !k.endsWith('_1c') &&
          !k.endsWith('_2c') &&
          !k.includes('_data_2c')
        ) {
          keysDisp.add(k);
        } else if (k.startsWith('docencia_disposition_history_') || k.startsWith('fds_disposition_history')) {
          keysHist.add(k);
        }
      }
    } catch (_) {}
  }

  for (const k of Array.from(keysDisp)) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          disposition = { ...parsed, ...disposition };
        }
      }
    } catch (_) {}
  }

  const mergedHistory: any[] = [];
  for (const k of Array.from(keysHist)) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const clean = list.filter((item: any) => item?.id && !deleted.has(item.id));
          mergedHistory.push(...clean);
        }
      }
    } catch (_) {}
  }
  history = deduplicateHistoryItems(mergedHistory);

  const result = { disposition, history };
  cachedDisposition = {
    userId,
    data: result,
  };
  return result;
}

export function getLocalDisposition2c(): Record<string, any> {
  if (typeof window === 'undefined') return {};
  try {
    const userId = getActiveUserId();
    if (cachedDisposition2c && cachedDisposition2c.userId === userId) {
      return cachedDisposition2c.data;
    }
    const raw = getUserScopedItem('fds_disposition_data_2c');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cachedDisposition2c = { userId, data: parsed };
        return parsed;
      }
    }
    cachedDisposition2c = { userId, data: {} };
  } catch (_) {}
  return {};
}

export function saveLocalDisposition2c(disposition2c: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  try {
    const userId = getActiveUserId();
    const safeDisp2c = disposition2c || {};
    cachedDisposition2c = { userId, data: safeDisp2c };
    scheduleWriteBehind(`disposition2c_${userId}`, () => {
      setUserScopedItem('fds_disposition_data_2c', JSON.stringify(safeDisp2c));
    });
  } catch (_) {}
}

export function getRemovedStudentsIndex(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const userId = getActiveUserId();
    if (cachedRemovedIndex && cachedRemovedIndex.userId === userId) {
      return cachedRemovedIndex.data;
    }
    const raw = getUserScopedItem('fds_removed_students_index');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cachedRemovedIndex = { userId, data: parsed };
        return parsed;
      }
    }
    cachedRemovedIndex = { userId, data: {} };
  } catch (_) {}
  return {};
}

export function saveRemovedStudentsIndex(
  index: Record<string, string[]>,
  syncToCloud = true
): void {
  if (typeof window === 'undefined') return;
  try {
    const userId = getActiveUserId();
    const safeIndex = index || {};
    cachedRemovedIndex = { userId, data: safeIndex };
    scheduleWriteBehind(`removed_index_${userId}`, () => {
      setUserScopedItem('fds_removed_students_index', JSON.stringify(safeIndex));
    });
    if (syncToCloud && userId) {
      firestoreSync
        .saveUserSetting(userId, 'removed_students_index', {
          courses: safeIndex,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  } catch (_) {}
}

export function getRemovedStudentIds(courseId: string): Set<string> {
  if (typeof window === 'undefined' || !courseId) return new Set();
  try {
    const userId = getActiveUserId();
    const cacheKey = `${userId}::${courseId}`;
    const cached = cachedRemovedCourseIds.get(cacheKey);
    if (cached) return new Set(cached);

    const raw = getUserScopedItem(`fds_removed_students_${courseId}`);
    if (raw) {
      const set = new Set<string>(JSON.parse(raw));
      cachedRemovedCourseIds.set(cacheKey, set);
      return new Set(set);
    }
    const idx = getRemovedStudentsIndex();
    if (Array.isArray(idx[courseId])) {
      const set = new Set<string>(idx[courseId]);
      cachedRemovedCourseIds.set(cacheKey, set);
      return new Set(set);
    }
    cachedRemovedCourseIds.set(cacheKey, new Set());
  } catch (_) {}
  return new Set();
}

export function getRemovedStudentsList(courseId: string): Student[] {
  if (typeof window === 'undefined' || !courseId) return [];
  try {
    const userId = getActiveUserId();
    const cacheKey = `${userId}::${courseId}`;
    const cached = cachedRemovedCourseLists.get(cacheKey);
    if (cached) return [...cached];

    const raw = getUserScopedItem(`fds_removed_students_objs_${courseId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cachedRemovedCourseLists.set(cacheKey, parsed);
        return [...parsed];
      }
    }
    cachedRemovedCourseLists.set(cacheKey, []);
  } catch (_) {}
  return [];
}

export function markStudentRemoved(courseId: string, studentOrId: Student | string): void {
  if (typeof window === 'undefined' || !courseId || !studentOrId) return;
  try {
    const userId = getActiveUserId();
    const cacheKey = `${userId}::${courseId}`;
    const studentId = typeof studentOrId === 'string' ? studentOrId : studentOrId.id;
    const set = getRemovedStudentIds(courseId);
    set.add(studentId);
    const idsArray = Array.from(set);
    cachedRemovedCourseIds.set(cacheKey, set);
    cachedStudents = null;

    let list = getRemovedStudentsList(courseId);
    if (typeof studentOrId === 'object' && studentOrId.id) {
      list = list.filter((s) => s.id !== studentOrId.id);
      list.push({ ...studentOrId, courseId });
      cachedRemovedCourseLists.set(cacheKey, list);
    }

    scheduleWriteBehind(`removed_course_${cacheKey}`, () => {
      setUserScopedItem(`fds_removed_students_${courseId}`, JSON.stringify(idsArray));
      setUserScopedItem(`fds_removed_students_objs_${courseId}`, JSON.stringify(list));
    });

    const index = { ...getRemovedStudentsIndex(), [courseId]: idsArray };
    saveRemovedStudentsIndex(index, true);

    if (userId) {
      firestoreSync
        .saveUserSetting(userId, `removed_students_${courseId}`, {
          ids: idsArray,
          students: list,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  } catch (_) {}
}

export function unmarkStudentRemoved(courseId: string, studentId: string): void {
  if (typeof window === 'undefined' || !courseId || !studentId) return;
  try {
    const userId = getActiveUserId();
    const cacheKey = `${userId}::${courseId}`;
    const set = getRemovedStudentIds(courseId);
    set.delete(studentId);
    const idsArray = Array.from(set);
    cachedRemovedCourseIds.set(cacheKey, set);
    cachedStudents = null;

    const list = getRemovedStudentsList(courseId).filter((s) => s.id !== studentId);
    cachedRemovedCourseLists.set(cacheKey, list);

    scheduleWriteBehind(`removed_course_${cacheKey}`, () => {
      setUserScopedItem(`fds_removed_students_${courseId}`, JSON.stringify(idsArray));
      setUserScopedItem(`fds_removed_students_objs_${courseId}`, JSON.stringify(list));
    });

    const index = { ...getRemovedStudentsIndex(), [courseId]: idsArray };
    saveRemovedStudentsIndex(index, true);

    if (userId) {
      firestoreSync
        .saveUserSetting(userId, `removed_students_${courseId}`, {
          ids: idsArray,
          students: list,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  } catch (_) {}
}

export async function syncAllRemovedStudentsIndexFromCloud(): Promise<Record<string, string[]>> {
  if (typeof window === 'undefined') return {};
  const localIndex = getRemovedStudentsIndex();
  const userId = getActiveUserId();
  if (!userId) return localIndex;

  try {
    const cloudDoc = await firestoreSync.loadUserSetting<{
      courses?: Record<string, string[]>;
      updatedAt?: string;
    }>(userId, 'removed_students_index');

    if (cloudDoc && cloudDoc.courses && typeof cloudDoc.courses === 'object') {
      const mergedIndex: Record<string, string[]> = { ...localIndex, ...cloudDoc.courses };
      let changed = false;
      for (const [cid, ids] of Object.entries(mergedIndex)) {
        if (!Array.isArray(ids)) continue;
        const prevSet = getRemovedStudentIds(cid);
        const prevStr = JSON.stringify(Array.from(prevSet).sort());
        const nextStr = JSON.stringify([...ids].sort());
        if (prevStr !== nextStr) {
          cachedRemovedCourseIds.set(`${userId}::${cid}`, new Set(ids));
          setUserScopedItem(`fds_removed_students_${cid}`, JSON.stringify(ids));
          changed = true;
        }
      }
      saveRemovedStudentsIndex(mergedIndex, false);
      if (changed) {
        cachedStudents = null;
        window.dispatchEvent(new Event('docencia_student_status_updated'));
      }
      return mergedIndex;
    } else {
      const courses = getLocalCourses();
      let hasAnyLocal = false;
      const seededIndex: Record<string, string[]> = { ...localIndex };
      for (const c of courses) {
        if (!c?.id) continue;
        const ids = Array.from(getRemovedStudentIds(c.id));
        if (ids.length > 0) {
          seededIndex[c.id] = ids;
          hasAnyLocal = true;
        }
      }
      if (hasAnyLocal) {
        saveRemovedStudentsIndex(seededIndex, true);
      }
      return seededIndex;
    }
  } catch (_) {}
  return localIndex;
}

export async function syncRemovedStudentsFromCloud(
  courseId: string
): Promise<{ ids: Set<string>; list: Student[] }> {
  if (typeof window === 'undefined' || !courseId) {
    return { ids: new Set(), list: [] };
  }
  const localIds = getRemovedStudentIds(courseId);
  const localList = getRemovedStudentsList(courseId);
  const userId = getActiveUserId();
  if (!userId) {
    return { ids: localIds, list: localList };
  }

  try {
    const cloudData = await firestoreSync.loadUserSetting<{
      ids?: string[];
      students?: Student[];
      updatedAt?: string;
    }>(userId, `removed_students_${courseId}`);

    if (cloudData && (Array.isArray(cloudData.ids) || Array.isArray(cloudData.students))) {
      const cloudIds = Array.isArray(cloudData.ids) ? cloudData.ids : [];
      const cloudStudents = Array.isArray(cloudData.students) ? cloudData.students : [];

      const nextIds = new Set<string>(cloudIds);
      const nextList: Student[] = cloudStudents.map((s) => ({ ...s, courseId }));

      const prevIdsStr = JSON.stringify(Array.from(localIds).sort());
      const nextIdsStr = JSON.stringify(Array.from(nextIds).sort());

      const cacheKey = `${userId}::${courseId}`;
      cachedRemovedCourseIds.set(cacheKey, nextIds);
      cachedRemovedCourseLists.set(cacheKey, nextList);

      scheduleWriteBehind(`removed_course_${cacheKey}`, () => {
        setUserScopedItem(`fds_removed_students_${courseId}`, JSON.stringify(Array.from(nextIds)));
        setUserScopedItem(`fds_removed_students_objs_${courseId}`, JSON.stringify(nextList));
      });

      const index = { ...getRemovedStudentsIndex() };
      if (JSON.stringify(index[courseId] || []) !== JSON.stringify(cloudIds)) {
        index[courseId] = cloudIds;
        saveRemovedStudentsIndex(index, true);
      }

      if (prevIdsStr !== nextIdsStr || localList.length !== nextList.length) {
        cachedStudents = null;
        window.dispatchEvent(new Event('docencia_student_status_updated'));
      }
      return { ids: nextIds, list: nextList };
    } else if (localIds.size > 0 || localList.length > 0) {
      const idsArr = Array.from(localIds);
      const index = { ...getRemovedStudentsIndex(), [courseId]: idsArr };
      saveRemovedStudentsIndex(index, true);

      firestoreSync
        .saveUserSetting(userId, `removed_students_${courseId}`, {
          ids: idsArr,
          students: localList,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  } catch (_) {}

  return { ids: localIds, list: localList };
}





