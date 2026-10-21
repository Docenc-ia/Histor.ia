/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Course, Student } from '../types';
import { getActiveUserId, isPrimaryOwnerAccount } from './firestoreSync';
export { isPrimaryOwnerAccount };
import { safeSetLocalStorageItem, runStorageMaintenanceOnce } from '../utils/storageGuard';
import { emitAppEvent } from '../utils/appEventBus';

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
  if (c.classroomCourseId && !c.classroomCourseId.startsWith('gc-') && !isNaN(Number(c.classroomCourseId))) {
    return `classroom:${String(c.classroomCourseId).trim()}`;
  }
  const name = (c.name || '').trim().toLowerCase();
  const sub = (c.subject || '').trim().toLowerCase();
  const sec = (c.section || c.grade || c.division || '').trim().toLowerCase();
  const paren = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (paren) {
    return `name:${paren[1].trim()}:${paren[2].trim()}`;
  }
  return `name:${sub || name}:${sec || 'main'}`;
}

export function areCoursesSame(c1: Partial<Course>, c2: Partial<Course>): boolean {
  if (!c1 || !c2) return false;
  if (c1.id && c2.id && String(c1.id).trim() === String(c2.id).trim()) return true;

  const id1 = c1.classroomCourseId ? String(c1.classroomCourseId).trim() : null;
  const id2 = c2.classroomCourseId ? String(c2.classroomCourseId).trim() : null;

  if (id1 && id2 && id1 === id2) return true;
  if (id1 && (c2.id === id1 || c2.classroomCourseId === id1)) return true;
  if (id2 && (c1.id === id2 || c1.classroomCourseId === id2)) return true;

  const k1 = normalizeCourseCanonicalKey(c1);
  const k2 = normalizeCourseCanonicalKey(c2);
  if (k1 && k2 && k1 === k2) return true;

  return false;
}

export function deduplicateCourses(coursesList: Course[]): Course[] {
  if (!Array.isArray(coursesList)) return [];
  const result: Course[] = [];

  for (const c of coursesList) {
    if (!c || (!c.name && !c.subject)) continue;

    const existingIdx = result.findIndex((existing) => areCoursesSame(existing, c));
    if (existingIdx >= 0) {
      const existing = result[existingIdx];
      const preferredId =
        existing.classroomCourseId && existing.id === existing.classroomCourseId
          ? existing.id
          : c.classroomCourseId && c.id === c.classroomCourseId
          ? c.id
          : existing.id || c.id;

      const merged: Course = {
        ...existing,
        ...c,
        id: preferredId,
        classroomSynced: Boolean(existing.classroomSynced || c.classroomSynced),
        studentsCount: Math.max(Number(existing.studentsCount) || 0, Number(c.studentsCount) || 0),
        name: existing.name || c.name,
        subject: existing.subject || c.subject,
        grade: existing.grade || c.grade,
        section: existing.section || c.section,
        schoolYear: existing.schoolYear || c.schoolYear || '2026',
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

      result[existingIdx] = merged;
    } else {
      result.push(c);
    }
  }

  return result;
}

export function deduplicateStudents(studentsList: Student[]): Student[] {
  if (!Array.isArray(studentsList)) return [];
  const result: Student[] = [];

  for (const st of studentsList) {
    if (!st || (!st.firstName && !st.lastName)) continue;
    const cleanEmail = (st.email || '').trim().toLowerCase();
    const cleanName = `${(st.firstName || '').trim()} ${(st.lastName || '').trim()}`.toLowerCase();
    const cId = st.courseId || '';

    const existingIdx = result.findIndex((existing) => {
      if (existing.id && st.id && existing.id === st.id) return true;
      if (cId && existing.courseId && cId === existing.courseId) {
        if (cleanEmail && existing.email && existing.email.trim().toLowerCase() === cleanEmail) return true;
        const exName = `${(existing.firstName || '').trim()} ${(existing.lastName || '').trim()}`.toLowerCase();
        if (exName && cleanName && exName === cleanName) return true;
      }
      return false;
    });

    if (existingIdx >= 0) {
      result[existingIdx] = {
        ...result[existingIdx],
        ...st,
        id: result[existingIdx].id || st.id,
      };
    } else {
      result.push(st);
    }
  }

  return result;
}

// In-memory read caches invalidated immediately on writes or cross-tab storage changes
let cachedCourses: { userId: string; rawRef: string | null; list: Course[] } | null = null;
let cachedStudents: { userId: string; rawRef: string | null; list: Student[] } | null = null;
let cachedDisposition: {
  userId: string;
  rawDispRef: string | null;
  rawHistRef: string | null;
  data: { disposition: Record<string, any>; history: any[] };
} | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => {
    cachedCourses = null;
    cachedStudents = null;
    cachedDisposition = null;
  });
}

export function getLocalCourses(): Course[] {
  if (typeof window === 'undefined') return [];
  try {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const explicitlyCleared = localStorage.getItem('docencia_courses_explicitly_cleared') === 'true';
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    const primaryRaw = localStorage.getItem(key);
    if (cachedCourses && cachedCourses.userId === userId && cachedCourses.rawRef === primaryRaw && primaryRaw) {
      return cachedCourses.list;
    }
    const candidateKeys = isOwner ? [key, STORAGE_KEYS.COURSES, 'docencia_persisted_courses'] : [key];

    for (const k of candidateKeys) {
      const raw = k === key ? primaryRaw : localStorage.getItem(k);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const deduped = deduplicateCourses(parsed);
            cachedCourses = { userId, rawRef: primaryRaw, list: deduped };
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
                return deduplicateCourses(p);
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
    const isOwner = isPrimaryOwnerAccount();
    const cleanList = deduplicateCourses(coursesList);
    if (cleanList.length === 0 && !forceClear) {
      return;
    }
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    const dataStr = JSON.stringify(cleanList);
    safeSetLocalStorageItem(key, dataStr);
    if (isOwner) {
      safeSetLocalStorageItem(STORAGE_KEYS.COURSES, dataStr);
      safeSetLocalStorageItem('docencia_persisted_courses', dataStr);
    }
    cachedCourses = { userId: getActiveUserId(), rawRef: dataStr, list: cleanList };
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
  } catch (_) {}
}

export function getLocalStudents(courseId?: string): Student[] {
  if (typeof window === 'undefined') return [];
  try {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    let raw = localStorage.getItem(key);
    if (cachedStudents && cachedStudents.userId === userId && cachedStudents.rawRef === raw && raw) {
      return courseId ? cachedStudents.list.filter((s) => s.courseId === courseId) : cachedStudents.list;
    }
    if (isOwner && !raw && key !== STORAGE_KEYS.STUDENTS) {
      raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    }
    if (isOwner && !raw) {
      raw = localStorage.getItem('docencia_persisted_students');
    }
    if (raw) {
      const parsed: Student[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = deduplicateStudents(parsed);
        cachedStudents = { userId, rawRef: localStorage.getItem(key), list: clean };
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
                const clean = deduplicateStudents(p);
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
    const dataStr = JSON.stringify(updated);
    safeSetLocalStorageItem(key, dataStr);
    if (isOwner) {
      safeSetLocalStorageItem(STORAGE_KEYS.STUDENTS, dataStr);
      safeSetLocalStorageItem('docencia_persisted_students', dataStr);
    }
    cachedStudents = { userId: getActiveUserId(), rawRef: dataStr, list: updated };
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
    const raw = getUserScopedItem(DELETED_HISTORY_IDS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
}

export function markHistoryIdDeleted(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const set = getDeletedHistoryIds();
    set.add(id);
    setUserScopedItem(DELETED_HISTORY_IDS_KEY, JSON.stringify(Array.from(set)));
    cachedDisposition = null;
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
    const isOwner = isPrimaryOwnerAccount();
    const deleted = getDeletedHistoryIds();
    const cleanHistory = (history || []).filter((h) => h?.id && !deleted.has(h.id));
    const dispJson = JSON.stringify(disposition || {});
    const histJson = JSON.stringify(cleanHistory);

    const userId = getActiveUserId();
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

    cachedDisposition = {
      userId,
      rawDispRef: dispJson,
      rawHistRef: histJson,
      data: { disposition: disposition || {}, history: cleanHistory },
    };

    if (!options?.silent) {
      emitAppEvent('docencia_disposition_storage_change', {
        disposition,
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
  const isOwner = isPrimaryOwnerAccount();
  const primaryDispRaw = localStorage.getItem(
    isOwner ? PRIMARY_DISPOSITION_KEY : `docencia_disposition_data_${userId}`
  );
  const primaryHistRaw = localStorage.getItem(
    isOwner ? PRIMARY_HISTORY_KEY : `docencia_disposition_history_${userId}`
  );
  if (
    cachedDisposition &&
    cachedDisposition.userId === userId &&
    cachedDisposition.rawDispRef === primaryDispRaw &&
    cachedDisposition.rawHistRef === primaryHistRaw &&
    primaryDispRaw !== null
  ) {
    return cachedDisposition.data;
  }

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
          (k.startsWith('docencia_disposition_data_') || k.startsWith('fds_disposition_data')) &&
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
    rawDispRef: primaryDispRaw,
    rawHistRef: primaryHistRaw,
    data: result,
  };
  return result;
}

export function getLocalDisposition2c(): Record<string, any> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = getUserScopedItem('fds_disposition_data_2c');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {};
}

export function saveLocalDisposition2c(disposition2c: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  try {
    setUserScopedItem('fds_disposition_data_2c', JSON.stringify(disposition2c || {}));
  } catch (_) {}
}

