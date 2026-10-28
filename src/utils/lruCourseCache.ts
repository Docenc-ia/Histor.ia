/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Course } from '../types';
import { findCourseMatch } from './courseFormatting';
import { safeSetLocalStorageItem, reclaimTransientStorageSpace } from './storageGuard';
import { getActiveUserId } from '../services/firestoreSync';

/**
 * Maximum number of full Course metadata snapshots kept in the Navigation LRU cache.
 */
export const MAX_COURSE_SNAPSHOTS_LRU = 8;

/**
 * Maximum number of courses whose heavy data snapshots (grades, libro de temas,
 * disposition maps, import history) are simultaneously retained in localStorage.
 * Least-recently-used courses beyond this limit have their heavy snapshot caches
 * evicted from localStorage (they remain safely stored in Firestore / Google Sheets).
 */
export const MAX_DATA_HOOKS_COURSES_LRU = 10;

/**
 * Maximum number of grade import history entries retained per course in localStorage.
 */
export const MAX_GRADE_HISTORY_ENTRIES_PER_COURSE = 50;

export const COURSE_SNAPSHOTS_LRU_STORAGE_KEY = 'docencia_course_snapshots_lru_v1';
export const COURSE_DATA_LRU_INDEX_STORAGE_KEY = 'docencia_course_data_lru_index_v1';
export const LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY = 'docencia_last_active_course_snapshot';

export interface CourseSnapshotLruEntry {
  courseId: string;
  classroomCourseId?: string;
  snapshot: Course;
  lastAccessedAt: number;
}

export interface CourseDataLruIndexEntry {
  courseId: string;
  lastAccessedAt: number;
  keys: string[];
}

// In-memory mirrors for O(1) synchronous reads without repeated JSON.parse overhead
let memorySnapshotLruCache: CourseSnapshotLruEntry[] | null = null;
let memorySnapshotLruUserScope: string | null = null;

let memoryDataLruIndex: CourseDataLruIndexEntry[] | null = null;
let memoryDataLruUserScope: string | null = null;

function getScopedStorageKey(baseKey: string): string {
  try {
    const uid = getActiveUserId();
    return uid ? `${baseKey}_${uid}` : baseKey;
  } catch (_) {
    return baseKey;
  }
}

/**
 * Sanitizes a Course object before storing it in the snapshot LRU cache so that
 * accidental transient fields or oversized strings cannot bloat localStorage.
 */
export function sanitizeCourseSnapshot(course: Course): Course {
  return {
    id: String(course.id || '').trim(),
    name: String(course.name || '').trim(),
    subject: course.subject ? String(course.subject).trim() : undefined,
    section: course.section ? String(course.section).trim() : undefined,
    grade: String(course.grade || '').trim(),
    orientation: course.orientation,
    division: course.division ? String(course.division).trim() : undefined,
    schedule: String(course.schedule || '').trim(),
    preferredCalendarId: course.preferredCalendarId,
    room: String(course.room || '').trim(),
    studentsCount: Number(course.studentsCount ?? course.studentCount ?? 0) || 0,
    studentCount: Number(course.studentCount ?? course.studentsCount ?? 0) || 0,
    color: String(course.color || '#1a73e8').trim(),
    schoolYear: course.schoolYear ? String(course.schoolYear).trim() : undefined,
    classroomSynced: Boolean(course.classroomSynced),
    classroomCourseId: course.classroomCourseId ? String(course.classroomCourseId).trim() : undefined,
    classroomLink: course.classroomLink,
    driveFolderId: course.driveFolderId,
    driveFolderUrl: course.driveFolderUrl,
    attendanceFolderId: course.attendanceFolderId,
    attendanceFolderUrl: course.attendanceFolderUrl,
    gradesFolderId: course.gradesFolderId,
    gradesFolderUrl: course.gradesFolderUrl,
    dispositionSheetId: course.dispositionSheetId,
    dispositionSheetUrl: course.dispositionSheetUrl,
  };
}

function loadSnapshotLruFromStorage(): CourseSnapshotLruEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const currentScope = getScopedStorageKey(COURSE_SNAPSHOTS_LRU_STORAGE_KEY);
  if (memorySnapshotLruCache && memorySnapshotLruUserScope === currentScope) {
    return memorySnapshotLruCache;
  }

  const entries: CourseSnapshotLruEntry[] = [];
  try {
    const raw =
      window.localStorage.getItem(currentScope) ||
      window.localStorage.getItem(COURSE_SNAPSHOTS_LRU_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            item.snapshot &&
            typeof item.snapshot.id === 'string' &&
            item.snapshot.id.trim()
          ) {
            entries.push({
              courseId: item.snapshot.id.trim(),
              classroomCourseId: item.snapshot.classroomCourseId
                ? String(item.snapshot.classroomCourseId).trim()
                : undefined,
              snapshot: sanitizeCourseSnapshot(item.snapshot),
              lastAccessedAt: Number(item.lastAccessedAt) || Date.now(),
            });
          }
        }
      }
    }

    // Migrate or include legacy single snapshot if not yet in LRU list
    const legacyRaw =
      window.localStorage.getItem(getScopedStorageKey(LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY)) ||
      window.localStorage.getItem(LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY);
    if (legacyRaw) {
      try {
        const legacyCourse = JSON.parse(legacyRaw) as Course;
        if (legacyCourse && typeof legacyCourse === 'object' && legacyCourse.id) {
          const cleanId = String(legacyCourse.id).trim();
          if (cleanId && !entries.some((e) => e.courseId === cleanId)) {
            entries.unshift({
              courseId: cleanId,
              classroomCourseId: legacyCourse.classroomCourseId
                ? String(legacyCourse.classroomCourseId).trim()
                : undefined,
              snapshot: sanitizeCourseSnapshot(legacyCourse),
              lastAccessedAt: Date.now(),
            });
          }
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Sort most recently accessed first and enforce max capacity
  entries.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  const bounded = entries.slice(0, MAX_COURSE_SNAPSHOTS_LRU);
  memorySnapshotLruCache = bounded;
  memorySnapshotLruUserScope = currentScope;
  return bounded;
}

function persistSnapshotLruToStorage(entries: CourseSnapshotLruEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const bounded = entries.slice(0, MAX_COURSE_SNAPSHOTS_LRU);
  const currentScope = getScopedStorageKey(COURSE_SNAPSHOTS_LRU_STORAGE_KEY);
  memorySnapshotLruCache = bounded;
  memorySnapshotLruUserScope = currentScope;

  try {
    const serialized = JSON.stringify(bounded);
    safeSetLocalStorageItem(currentScope, serialized);
    if (currentScope !== COURSE_SNAPSHOTS_LRU_STORAGE_KEY) {
      safeSetLocalStorageItem(COURSE_SNAPSHOTS_LRU_STORAGE_KEY, serialized);
    }

    // Keep legacy single-key synced with the MRU (most recently used) course for backward compatibility
    const mruSnapshot = bounded[0]?.snapshot;
    const legacyScopedKey = getScopedStorageKey(LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY);
    if (mruSnapshot) {
      const mruSerialized = JSON.stringify(mruSnapshot);
      safeSetLocalStorageItem(legacyScopedKey, mruSerialized);
      safeSetLocalStorageItem(LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY, mruSerialized);
    } else {
      window.localStorage.removeItem(legacyScopedKey);
      window.localStorage.removeItem(LEGACY_LAST_ACTIVE_COURSE_SNAPSHOT_KEY);
    }
  } catch (_) {}
}

/**
 * Retrieves a course snapshot from the LRU cache.
 * - If `targetCourseId` is omitted, returns the Most Recently Used (MRU) course snapshot.
 * - If `targetCourseId` is provided, finds the matching snapshot in the LRU cache,
 *   promotes it to the MRU position, and returns it.
 */
export function getCourseSnapshotFromLru(
  targetCourseId?: string,
  touchOnHit = false
): Course | null {
  const entries = loadSnapshotLruFromStorage();
  if (entries.length === 0) return null;

  if (!targetCourseId || !targetCourseId.trim()) {
    return entries[0]?.snapshot || null;
  }

  const cleanTarget = targetCourseId.trim();
  let matchedIndex = entries.findIndex(
    (e) => e.courseId === cleanTarget || (e.classroomCourseId && e.classroomCourseId === cleanTarget)
  );

  if (matchedIndex === -1) {
    const candidateCourse = findCourseMatch(
      cleanTarget,
      entries.map((e) => e.snapshot)
    );
    if (candidateCourse) {
      matchedIndex = entries.findIndex((e) => e.courseId === candidateCourse.id);
    }
  }

  if (matchedIndex === -1) return null;

  const matchedEntry = entries[matchedIndex];
  if (touchOnHit && matchedIndex > 0) {
    const updatedEntry: CourseSnapshotLruEntry = {
      ...matchedEntry,
      lastAccessedAt: Date.now(),
    };
    const nextEntries = [
      updatedEntry,
      ...entries.slice(0, matchedIndex),
      ...entries.slice(matchedIndex + 1),
    ].slice(0, MAX_COURSE_SNAPSHOTS_LRU);
    persistSnapshotLruToStorage(nextEntries);
  }

  return matchedEntry.snapshot;
}

/**
 * Inserts or updates a Course snapshot at the Most Recently Used (MRU) position
 * and evicts the Least Recently Used (LRU) snapshots if capacity exceeds `MAX_COURSE_SNAPSHOTS_LRU`.
 */
export function putCourseSnapshotInLru(course: Course | null | undefined): void {
  if (!course || typeof course !== 'object' || !course.id) return;
  const cleanId = String(course.id).trim();
  if (!cleanId || !course.name || course.name === 'Cargando materia...') return;

  const sanitized = sanitizeCourseSnapshot(course);
  const currentEntries = loadSnapshotLruFromStorage();

  const filtered = currentEntries.filter((entry) => {
    if (entry.courseId === cleanId) return false;
    if (
      sanitized.classroomCourseId &&
      entry.classroomCourseId === sanitized.classroomCourseId &&
      entry.snapshot.name === sanitized.name
    ) {
      return false;
    }
    return true;
  });

  const nextEntries: CourseSnapshotLruEntry[] = [
    {
      courseId: cleanId,
      classroomCourseId: sanitized.classroomCourseId,
      snapshot: sanitized,
      lastAccessedAt: Date.now(),
    },
    ...filtered,
  ].slice(0, MAX_COURSE_SNAPSHOTS_LRU);

  persistSnapshotLruToStorage(nextEntries);
}

/**
 * Updates existing cached snapshots in the LRU cache when a fresh list of courses arrives from Firestore,
 * without polluting the cache with all courses beyond `MAX_COURSE_SNAPSHOTS_LRU`.
 */
export function refreshCachedSnapshotsFromPool(coursesPool: Course[]): void {
  if (!Array.isArray(coursesPool) || coursesPool.length === 0) return;
  const currentEntries = loadSnapshotLruFromStorage();
  if (currentEntries.length === 0) return;

  let changed = false;
  const updatedEntries = currentEntries.map((entry) => {
    const fresh = findCourseMatch(entry.courseId, coursesPool);
    if (fresh && fresh.id === entry.courseId) {
      const sanitizedFresh = sanitizeCourseSnapshot(fresh);
      if (JSON.stringify(sanitizedFresh) !== JSON.stringify(entry.snapshot)) {
        changed = true;
        return {
          ...entry,
          classroomCourseId: sanitizedFresh.classroomCourseId,
          snapshot: sanitizedFresh,
        };
      }
    }
    return entry;
  });

  if (changed) {
    persistSnapshotLruToStorage(updatedEntries);
  }
}

/**
 * Removes a specific course snapshot (or all snapshots if `courseId` is omitted) from the LRU cache.
 */
export function removeCourseSnapshotFromLru(courseId?: string): void {
  if (!courseId) {
    persistSnapshotLruToStorage([]);
    return;
  }
  const cleanId = courseId.trim();
  if (!cleanId) return;

  const currentEntries = loadSnapshotLruFromStorage();
  const nextEntries = currentEntries.filter(
    (entry) => entry.courseId !== cleanId && entry.classroomCourseId !== cleanId
  );
  if (nextEntries.length !== currentEntries.length) {
    persistSnapshotLruToStorage(nextEntries);
  }
}

/**
 * Returns all currently cached course snapshots in MRU -> LRU order.
 */
export function getAllCachedCourseSnapshots(): Course[] {
  return loadSnapshotLruFromStorage().map((e) => e.snapshot);
}

// ============================================================================
// PER-COURSE DATA HOOKS LRU CACHE (Grades, Libro de Temas, Attendance/Disposition)
// ============================================================================

const EVICTABLE_COURSE_KEY_PATTERNS = [
  'fds_grade_history_',
  'fds_grades_data_',
  'fds_grades_categories_',
  'fds_grades_final_calc_',
  'fds_preliminary_valuation_',
  'fds_grades_annual_override_',
  'fds_grades_updated_at_',
  'fds_libro_temas_',
  'fds_disposition_data_',
];

function isEvictableCourseSnapshotKey(key: string): boolean {
  return EVICTABLE_COURSE_KEY_PATTERNS.some((prefix) => key.includes(prefix));
}

function loadDataLruIndex(): CourseDataLruIndexEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const currentScope = getScopedStorageKey(COURSE_DATA_LRU_INDEX_STORAGE_KEY);
  if (memoryDataLruIndex && memoryDataLruUserScope === currentScope) {
    return memoryDataLruIndex;
  }

  const entries: CourseDataLruIndexEntry[] = [];
  try {
    const raw =
      window.localStorage.getItem(currentScope) ||
      window.localStorage.getItem(COURSE_DATA_LRU_INDEX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.courseId === 'string' && item.courseId.trim()) {
            entries.push({
              courseId: item.courseId.trim(),
              lastAccessedAt: Number(item.lastAccessedAt) || Date.now(),
              keys: Array.isArray(item.keys)
                ? Array.from(new Set(item.keys.filter((k: unknown) => typeof k === 'string')))
                : [],
            });
          }
        }
      }
    }
  } catch (_) {}

  entries.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  memoryDataLruIndex = entries;
  memoryDataLruUserScope = currentScope;
  return entries;
}

function saveDataLruIndex(entries: CourseDataLruIndexEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const currentScope = getScopedStorageKey(COURSE_DATA_LRU_INDEX_STORAGE_KEY);
  memoryDataLruIndex = entries;
  memoryDataLruUserScope = currentScope;

  try {
    const serialized = JSON.stringify(entries);
    safeSetLocalStorageItem(currentScope, serialized);
  } catch (_) {}
}

/**
 * Collects all localStorage keys belonging to a specific `courseId` that are part of
 * the reconstructible per-course snapshot cache.
 */
function findCourseSnapshotKeysInStorage(courseId: string, trackedKeys: string[] = []): string[] {
  if (typeof window === 'undefined' || !window.localStorage || !courseId) return [];
  const keySet = new Set<string>(trackedKeys);
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.includes(courseId) && isEvictableCourseSnapshotKey(k)) {
        keySet.add(k);
      }
    }
  } catch (_) {}
  return Array.from(keySet);
}

/**
 * Evicts the localStorage snapshot keys of the Least Recently Used courses when the number of
 * cached courses exceeds `maxCourses` or when forced by a `QuotaExceededError`.
 * Never evicts `protectedCourseId` (the currently active course).
 */
export function enforceCourseDataLruLimit(
  protectedCourseId?: string,
  maxCourses: number = MAX_DATA_HOOKS_COURSES_LRU
): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  const index = loadDataLruIndex();
  if (index.length <= maxCourses) return 0;

  // Sort from MRU (newest) to LRU (oldest)
  index.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

  const kept: CourseDataLruIndexEntry[] = [];
  const toEvict: CourseDataLruIndexEntry[] = [];

  for (const entry of index) {
    if (
      (protectedCourseId && entry.courseId === protectedCourseId) ||
      kept.length < maxCourses
    ) {
      kept.push(entry);
    } else {
      toEvict.push(entry);
    }
  }

  let evictedKeysCount = 0;
  for (const victim of toEvict) {
    const keysToRemove = findCourseSnapshotKeysInStorage(victim.courseId, victim.keys);
    for (const k of keysToRemove) {
      try {
        window.localStorage.removeItem(k);
        evictedKeysCount++;
      } catch (_) {}
    }
  }

  saveDataLruIndex(kept);
  return evictedKeysCount;
}

/**
 * Marks a `courseId` (and optionally a specific `storageKey`) as Most Recently Used in the
 * data hooks LRU tracker, and automatically evicts any courses exceeding `MAX_DATA_HOOKS_COURSES_LRU`.
 */
export function touchCourseDataLru(courseId: string, storageKey?: string): void {
  if (!courseId || typeof window === 'undefined') return;
  const cleanId = courseId.trim();
  if (!cleanId) return;

  const index = loadDataLruIndex();
  const existingIdx = index.findIndex((e) => e.courseId === cleanId);
  const now = Date.now();

  let updatedEntry: CourseDataLruIndexEntry;
  if (existingIdx >= 0) {
    const prev = index[existingIdx];
    const nextKeys =
      storageKey && !prev.keys.includes(storageKey) ? [...prev.keys, storageKey] : prev.keys;
    updatedEntry = {
      courseId: cleanId,
      lastAccessedAt: now,
      keys: nextKeys,
    };
    index.splice(existingIdx, 1);
  } else {
    updatedEntry = {
      courseId: cleanId,
      lastAccessedAt: now,
      keys: storageKey ? [storageKey] : [],
    };
  }

  index.unshift(updatedEntry);

  if (index.length > MAX_DATA_HOOKS_COURSES_LRU) {
    saveDataLruIndex(index);
    enforceCourseDataLruLimit(cleanId, MAX_DATA_HOOKS_COURSES_LRU);
  } else {
    saveDataLruIndex(index);
  }
}

/**
 * Reads a course-scoped snapshot item from `localStorage` and promotes `courseId`
 * to the Most Recently Used position in the LRU cache.
 */
export function getCourseCachedItem(courseId: string, storageKey: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage || !storageKey) return null;
  try {
    const val = window.localStorage.getItem(storageKey);
    if (val !== null && courseId) {
      touchCourseDataLru(courseId, storageKey);
    }
    return val;
  } catch (_) {
    return null;
  }
}

/**
 * Writes a course-scoped snapshot item to `localStorage` with LRU tracking and
 * automatic LRU course eviction fallback if the browser's storage quota is reached.
 */
export function setCourseCachedItem(
  courseId: string,
  storageKey: string,
  rawValue: string
): boolean {
  if (typeof window === 'undefined' || !window.localStorage || !storageKey) return false;

  if (courseId) {
    touchCourseDataLru(courseId, storageKey);
  }

  // First attempt via safeSetLocalStorageItem (which also compacts pretty-printed JSON)
  if (safeSetLocalStorageItem(storageKey, rawValue)) {
    return true;
  }

  // If still failing due to QuotaExceededError, progressively evict Least Recently Used courses
  reclaimTransientStorageSpace();
  const index = loadDataLruIndex();
  for (let targetMax = Math.max(1, index.length - 1); targetMax >= 1; targetMax--) {
    enforceCourseDataLruLimit(courseId, targetMax);
    try {
      window.localStorage.setItem(storageKey, rawValue);
      return true;
    } catch (_) {
      // Continue evicting next oldest course snapshot
    }
  }

  return false;
}

/**
 * Evicts all cached data keys and snapshot entries for a specific course (e.g., when a course is deleted).
 */
export function evictCourseFromAllLruCaches(courseId: string): void {
  if (!courseId || typeof window === 'undefined') return;
  const cleanId = courseId.trim();
  if (!cleanId) return;

  removeCourseSnapshotFromLru(cleanId);

  const index = loadDataLruIndex();
  const victim = index.find((e) => e.courseId === cleanId);
  const keysToRemove = findCourseSnapshotKeysInStorage(cleanId, victim?.keys || []);
  for (const k of keysToRemove) {
    try {
      window.localStorage.removeItem(k);
    } catch (_) {}
  }

  const nextIndex = index.filter((e) => e.courseId !== cleanId);
  if (nextIndex.length !== index.length) {
    saveDataLruIndex(nextIndex);
  }
}

/**
 * Bounds an array of history entries (such as grade import history) to `maxEntries`
 * most recent items so per-course history snapshots cannot grow without bound.
 */
export function capCourseHistoryEntries<T>(
  entries: T[],
  maxEntries: number = MAX_GRADE_HISTORY_ENTRIES_PER_COURSE
): T[] {
  if (!Array.isArray(entries)) return [];
  if (entries.length <= maxEntries) return entries;
  return entries.slice(0, maxEntries);
}
