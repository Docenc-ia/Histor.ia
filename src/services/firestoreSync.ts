/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  getDocFromServer,
  writeBatch,
  Firestore,
  disableNetwork,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Course, Student, TeacherProfile, CustomGem } from '../types';
import { auth } from './workspace/googleAuth';
import { isSameCalendarDay } from '../utils/dateUtils';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: boolean | string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Circuit breaker state to prevent hanging the UI or flooding backend when quota is exhausted
let firestoreUnavailableUntil = (() => {
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('firestore_quota_exhausted_until');
      if (stored) {
        const val = parseInt(stored, 10);
        if (val > Date.now()) return val;
      }
    } catch (_) {}
  }
  return 0;
})();

// Helper to check if error is due to Firestore quota exhaustion
export function isFirestoreQuotaError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code;
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('quota metric') ||
    msg.includes('Free daily write units per project')
  );
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): void {
  const msg = error instanceof Error ? error.message : String(error);

  if (isFirestoreQuotaError(error)) {
    // Quota reached on Firestore free tier: trip circuit breaker for 30 minutes
    firestoreUnavailableUntil = Date.now() + 30 * 60 * 1000;
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('firestore_quota_exhausted_until', String(firestoreUnavailableUntil));
      }
    } catch (_) {}
    try {
      disableNetwork(db).catch(() => {});
    } catch (_) {}
    console.warn('Docenc.IA: Límite diario de Firestore alcanzado. La app continúa funcionando con persistencia local ultrarrápida sin pérdida de datos.');
    emitSyncStatus({
      state: 'synced',
      pendingCount: 0,
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: msg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (msg.toLowerCase().includes('missing or insufficient permissions')) {
    throw new Error(JSON.stringify(errInfo));
  }
}

// Initialize Firebase App targeting gen-lang-client-0511455975
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Primary provisioned Firestore database instance
export const db: Firestore = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

// Disable network if quota was exhausted during recent session to prevent background retry logs
if (firestoreUnavailableUntil > Date.now()) {
  try {
    disableNetwork(db).catch(() => {});
  } catch (_) {}
}

// Default database instance of gen-lang-client-0511455975 (ensures cross-environment & Vercel compatibility)
export const defaultDb: Firestore = getFirestore(app);

// Active database instance to use: targets the provisioned database only to prevent duplicate writes
const ALL_DBS: Firestore[] = [db];

// Shared global workspace ID so changes sync globally across linked user accounts in gen-lang-client-0511455975
export const GLOBAL_WORKSPACE_ID = 'global_shared_workspace';

// Cloud Sync Status emitter for UI indicator ("Guardado en la nube" / "Sincronizando...")
export type CloudSyncState = 'synced' | 'syncing' | 'error' | 'offline';

export interface CloudSyncStatusInfo {
  state: CloudSyncState;
  lastSyncedAt: string | null;
  pendingCount: number;
}

let currentSyncStatus: CloudSyncStatusInfo = {
  state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'synced',
  lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  pendingCount: 0,
};

const syncListeners = new Set<(status: CloudSyncStatusInfo) => void>();
const flushHandlers = new Map<string, () => void>();
const pendingDebouncedKeys = new Set<string>();

function emitSyncStatus(partial: Partial<CloudSyncStatusInfo>) {
  currentSyncStatus = { ...currentSyncStatus, ...partial };
  syncListeners.forEach((listener) => {
    try {
      listener(currentSyncStatus);
    } catch (_) {}
  });
}

export function registerCloudFlushHandler(id: string, flushFn: () => void): () => void {
  flushHandlers.set(id, flushFn);
  return () => {
    flushHandlers.delete(id);
    pendingDebouncedKeys.delete(id);
  };
}

export function notifyDebouncedSyncPending(id: string, isPending: boolean): void {
  if (isPending) {
    pendingDebouncedKeys.add(id);
    emitSyncStatus({
      state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'syncing',
    });
  } else {
    pendingDebouncedKeys.delete(id);
    if (currentSyncStatus.pendingCount === 0 && pendingDebouncedKeys.size === 0) {
      emitSyncStatus({
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'synced',
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
  }
}

export function flushAllPendingCloudSaves(): boolean {
  let flushedAny = false;
  flushHandlers.forEach((fn) => {
    try {
      fn();
      flushedAny = true;
    } catch (_) {}
  });
  return flushedAny;
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAllPendingCloudSaves();
    }
  });

  window.addEventListener('pagehide', () => {
    flushAllPendingCloudSaves();
  });

  window.addEventListener('beforeunload', (e) => {
    const hadPendingDebounce = pendingDebouncedKeys.size > 0;
    if (hadPendingDebounce) {
      flushAllPendingCloudSaves();
    }
    if (currentSyncStatus.pendingCount > 0 || hadPendingDebounce) {
      e.preventDefault();
      e.returnValue = 'Hay cambios guardándose en la nube. ¿Deseas salir de todos modos?';
      return e.returnValue;
    }
  });

  window.addEventListener('offline', () => {
    emitSyncStatus({ state: 'offline' });
  });

  window.addEventListener('online', () => {
    flushAllPendingCloudSaves();
    emitSyncStatus({
      state: currentSyncStatus.pendingCount > 0 ? 'syncing' : 'synced',
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    window.dispatchEvent(new Event('docencia_network_restored'));
  });
}

export function subscribeToCloudSyncStatus(listener: (status: CloudSyncStatusInfo) => void): () => void {
  syncListeners.add(listener);
  listener(currentSyncStatus);
  return () => {
    syncListeners.delete(listener);
  };
}

export function getCloudSyncStatus(): CloudSyncStatusInfo {
  return currentSyncStatus;
}

const FIRESTORE_TIMEOUT_MS = 2200;

async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = FIRESTORE_TIMEOUT_MS,
  trackAsWrite = false
): Promise<T | null> {
  if (Date.now() < firestoreUnavailableUntil) {
    return null;
  }
  if (trackAsWrite) {
    emitSyncStatus({
      state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'syncing',
      pendingCount: currentSyncStatus.pendingCount + 1,
    });
  }
  let timer: any;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    if (trackAsWrite) {
      const nextPending = Math.max(0, currentSyncStatus.pendingCount - 1);
      const hasMore = nextPending > 0 || pendingDebouncedKeys.size > 0;
      emitSyncStatus({
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : hasMore ? 'syncing' : 'synced',
        pendingCount: nextPending,
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } else if (!currentSyncStatus.lastSyncedAt) {
      emitSyncStatus({
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
    return res;
  } catch (err: any) {
    clearTimeout(timer);
    if (isFirestoreQuotaError(err)) {
      firestoreUnavailableUntil = Date.now() + 30 * 60 * 1000;
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('firestore_quota_exhausted_until', String(firestoreUnavailableUntil));
        }
      } catch (_) {}
    }
    if (trackAsWrite) {
      const nextPending = Math.max(0, currentSyncStatus.pendingCount - 1);
      emitSyncStatus({
        state: isFirestoreQuotaError(err) ? 'synced' : 'error',
        pendingCount: nextPending,
      });
    }
    return null;
  }
}

// Test connection on boot as required by Firebase guidelines
export async function testFirestoreConnection(): Promise<boolean> {
  if (Date.now() < firestoreUnavailableUntil) {
    emitSyncStatus({
      state: 'synced',
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    return true;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    emitSyncStatus({
      state: 'synced',
      lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    return true;
  } catch (error: any) {
    if (isFirestoreQuotaError(error)) {
      firestoreUnavailableUntil = Date.now() + 30 * 60 * 1000;
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('firestore_quota_exhausted_until', String(firestoreUnavailableUntil));
        }
      } catch (_) {}
      emitSyncStatus({
        state: 'synced',
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return true;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}
testFirestoreConnection().catch(() => {});

// Helper to get active teacher email
export function getActiveUserEmail(): string {
  if (auth.currentUser?.email) return auth.currentUser.email.trim().toLowerCase();
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.email) return String(parsed.email).trim().toLowerCase();
      }
      const email = sessionStorage.getItem('docencia_teacher_email') || localStorage.getItem('docencia_teacher_email');
      if (email) return email.trim().toLowerCase();
    } catch (_) {}
  }
  return '';
}

// Checks if the active session belongs to the primary developer/teacher (Jorge Cano across his two accounts)
export function isPrimaryOwnerAccount(email?: string): boolean {
  const e = (email ?? getActiveUserEmail()).trim().toLowerCase();
  if (!e) return true;
  return (
    e === 'jorge.cano@fds-esc.edu.ar' ||
    e === 'canomorenojj@gmail.com' ||
    e.startsWith('jorge.cano@') ||
    e.startsWith('canomorenojj@')
  );
}

// Helper to get active user ID (deterministic and consistent across sessions)
export function getActiveUserId(): string {
  const email = getActiveUserEmail();
  if (email && !isPrimaryOwnerAccount(email)) {
    // Any other teacher gets their own isolated deterministic workspace ID automatically
    return 'teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_');
  }
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id && !String(parsed.id).startsWith('user-')) {
          return parsed.id;
        }
        if (parsed?.email) {
          return 'teacher_' + String(parsed.email).trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
        }
      }
      if (email) return 'teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    } catch (_) {}
  }
  return GLOBAL_WORKSPACE_ID;
}

// Helper to get deleted history IDs from user-scoped localStorage tombstones
function getDeletedHistoryIdsSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const uid = getActiveUserId();
    const scopedKey = uid ? `docencia_deleted_history_ids_${uid}` : 'docencia_deleted_history_ids';
    const raw =
      localStorage.getItem(scopedKey) ||
      (isPrimaryOwnerAccount() ? localStorage.getItem('docencia_deleted_history_ids') : null);
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
}

// Helper to gather all candidate user IDs for the current logged-in teacher
// - For Jorge Cano (canomorenojj@gmail.com / jorge.cano@fds-esc.edu.ar): links both of his accounts together
// - For any other teacher (colleagues): strictly isolates to their own Google UID and email ID
export function getCandidateUserIds(primaryId?: string): string[] {
  const email = getActiveUserEmail();
  const isOwner = isPrimaryOwnerAccount(email);

  if (!isOwner && email) {
    const colleagueIds = new Set<string>([
      'teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_'),
    ]);
    if (primaryId) colleagueIds.add(primaryId);
    if (auth.currentUser?.uid) colleagueIds.add(auth.currentUser.uid);
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.id) colleagueIds.add(String(parsed.id));
        }
      } catch (_) {}
    }
    return Array.from(colleagueIds).filter(Boolean);
  }

  const ids = new Set<string>([
    GLOBAL_WORKSPACE_ID,
    'teacher_jorge_cano_fds_esc_edu_ar',
    'teacher_canomorenojj_gmail_com',
  ]);
  if (primaryId) ids.add(primaryId);
  if (auth.currentUser?.uid) ids.add(auth.currentUser.uid);

  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) ids.add(String(parsed.id));
        if (parsed?.email) {
          const cleanEmail = String(parsed.email).trim().toLowerCase();
          ids.add('teacher_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_'));
        }
      }
      if (email) {
        ids.add('teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_'));
      }
    } catch (_) {}
  }

  return Array.from(ids).filter(Boolean);
}

// Short-lived in-memory caches (4 seconds TTL) to avoid redundant parallel Firestore reads on rapid tab switches
const READ_CACHE_TTL_MS = 4000;
let coursesReadCache: { userId: string; timestamp: number; data: Course[] } | null = null;
let studentsReadCache: { userId: string; timestamp: number; data: Student[] } | null = null;
let dispositionReadCache: { userId: string; timestamp: number; data: { disposition: Record<string, any>; history: any[] } } | null = null;
let snapshotsReadCache: { key: string; timestamp: number; data: Record<string, any> } | null = null;

function invalidateCoursesCache() {
  coursesReadCache = null;
}

function invalidateStudentsCache() {
  studentsReadCache = null;
}

function invalidateDispositionCache() {
  dispositionReadCache = null;
}

function invalidateSnapshotsCache() {
  snapshotsReadCache = null;
}

export function clearFirestoreMemoryCaches(): void {
  coursesReadCache = null;
  studentsReadCache = null;
  dispositionReadCache = null;
  snapshotsReadCache = null;
}

// Target user bucket to write to: single canonical target to avoid burning Firestore write quota
function getTargetWriteUserIds(userId: string): string[] {
  const email = getActiveUserEmail();
  if (email && !isPrimaryOwnerAccount(email)) {
    return ['teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_')];
  }
  return [userId || GLOBAL_WORKSPACE_ID];
}

// Recursively strips `undefined` values from objects/arrays before writing to Firestore
function sanitizeForFirestore<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof input === 'object' && !(input instanceof Date)) {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(input as Record<string, any>)) {
      if (val !== undefined) {
        clean[key] = sanitizeForFirestore(val);
      }
    }
    return clean as T;
  }
  return input;
}

export const firestoreSync = {
  clearMemoryCaches: clearFirestoreMemoryCaches,

  /**
   * Save teacher profile to Firestore under /users/{userId}
   */
  async saveTeacherProfile(profile: Partial<TeacherProfile> & { id?: string; email?: string }): Promise<void> {
    if (!profile?.email && !profile?.id) return;
    if (Date.now() < firestoreUnavailableUntil) return;
    const userId = profile.id || getActiveUserId();
    const payload = {
      uid: String(userId).slice(0, 128),
      email: String(profile.email || '').slice(0, 256),
      name: String(profile.name || 'Docente Titular').slice(0, 256),
      avatar: String(profile.avatar || '').slice(0, 1024),
      role: String(profile.role || 'Docente Titular').slice(0, 128),
      school: String(profile.school || 'FDS - Educación Secundaria').slice(0, 256),
      updatedAt: new Date().toISOString(),
    };
    const writeIds = getTargetWriteUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}`;
        executeWithTimeout(setDoc(doc(targetDb, 'users', uid), payload, { merge: true }), FIRESTORE_TIMEOUT_MS, true).catch((err) => {
          handleFirestoreError(err, OperationType.WRITE, path);
        });
      }
    }
  },

  /**
   * Save all courses to Firestore under /users/{userId}/courses/{courseId}
   */
  async saveCourses(userId: string, courses: Course[]): Promise<void> {
    if (!userId || !Array.isArray(courses) || Date.now() < firestoreUnavailableUntil) return;
    invalidateCoursesCache();
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    for (const targetDb of ALL_DBS) {
      try {
        const batch = writeBatch(targetDb);
        for (const uid of writeIds) {
          for (const course of courses) {
            if (!course?.id) continue;
            const ref = doc(targetDb, 'users', uid, 'courses', course.id);
            batch.set(
              ref,
              sanitizeForFirestore({
                ...course,
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }
        }
        await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/courses`);
      }
    }
  },

  /**
   * Load courses from Firestore for the current teacher
   */
  async loadCourses(userId: string): Promise<Course[]> {
    if (Date.now() < firestoreUnavailableUntil) return [];
    if (
      coursesReadCache &&
      coursesReadCache.userId === userId &&
      Date.now() - coursesReadCache.timestamp < READ_CACHE_TTL_MS &&
      coursesReadCache.data.length > 0
    ) {
      return coursesReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const courses: Course[] = [];

    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'courses'))).catch(() => null));
        }
      }

      const snaps = await Promise.all(queries);
      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const data = docSnap.data() as Course;
          if (data && data.id && (data.name || data.subject)) {
            courses.push(data);
          }
        });
      }
      if (courses.length > 0) {
        coursesReadCache = { userId, timestamp: Date.now(), data: courses };
      }
      return courses;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/courses`);
      return [];
    }
  },

  /**
   * Delete a course from Firestore across linked accounts
   */
  async deleteCourse(userId: string, courseId: string): Promise<void> {
    if (!courseId || Date.now() < firestoreUnavailableUntil) return;
    invalidateCoursesCache();
    const candidateIds = getCandidateUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        executeWithTimeout(deleteDoc(doc(targetDb, 'users', uid, 'courses', courseId))).catch(() => {});
      }
    }
  },

  /**
   * Clear all courses for a user from Firestore
   */
  async clearAllCourses(userId: string): Promise<void> {
    if (!userId || Date.now() < firestoreUnavailableUntil) return;
    invalidateCoursesCache();
    const writeIds = getTargetWriteUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        try {
          const snap = await executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'courses')));
          if (!snap || snap.empty) continue;
          const batch = writeBatch(targetDb);
          snap.forEach((docSnap: any) => {
            batch.delete(docSnap.ref);
          });
          await executeWithTimeout(batch.commit());
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `users/${uid}/courses`);
        }
      }
    }
  },

  /**
   * Save students roster for a course to Firestore globally
   */
  async saveStudents(userId: string, courseId: string, students: Student[]): Promise<void> {
    if (!userId || !courseId || !Array.isArray(students) || Date.now() < firestoreUnavailableUntil) return;
    invalidateStudentsCache();
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    for (const targetDb of ALL_DBS) {
      try {
        const batch = writeBatch(targetDb);
        for (const uid of writeIds) {
          for (const st of students) {
            if (!st?.id) continue;
            const ref = doc(targetDb, 'users', uid, 'students', st.id);
            batch.set(
              ref,
              sanitizeForFirestore({
                ...st,
                courseId,
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }
        }
        await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/students`);
      }
    }
  },

  /**
   * Load students from Firestore for the current teacher's candidate accounts
   */
  async loadStudents(userId: string, courseId?: string): Promise<Student[]> {
    if (Date.now() < firestoreUnavailableUntil) return [];
    if (
      studentsReadCache &&
      studentsReadCache.userId === userId &&
      Date.now() - studentsReadCache.timestamp < READ_CACHE_TTL_MS &&
      studentsReadCache.data.length > 0
    ) {
      return courseId
        ? studentsReadCache.data.filter((s) => s.courseId === courseId)
        : studentsReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const students: Student[] = [];

    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'students'))).catch(() => null));
        }
      }

      const snaps = await Promise.all(queries);
      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const data = docSnap.data() as Student;
          if (data && data.id) {
            students.push(data);
          }
        });
      }
      if (students.length > 0) {
        studentsReadCache = { userId, timestamp: Date.now(), data: students };
      }
      return courseId ? students.filter((s) => s.courseId === courseId) : students;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/students`);
      return [];
    }
  },

  /**
   * Save attendance records for a course and date globally
   */
  async saveAttendance(
    userId: string,
    courseId: string,
    date: string,
    records: { studentId: string; status: string }[]
  ): Promise<void> {
    if (!userId || !courseId || !date || Date.now() < firestoreUnavailableUntil) return;
    const docId = `${courseId}_${date}`;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}/attendance/${docId}`;
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'attendance', docId),
            {
              courseId,
              date,
              records: JSON.stringify(records),
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Save a student disposition / absence incident globally
   */
  async saveDisposition(userId: string, record: any): Promise<void> {
    if (!userId || !record?.id || Date.now() < firestoreUnavailableUntil) return;
    invalidateDispositionCache();
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({
      ...record,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}/disposition/${record.id}`;
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'disposition', record.id),
            cleanPayload,
            { merge: true }
          )
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Delete a student disposition / absence incident from Firestore globally
   */
  async deleteDisposition(userId: string, recordId: string): Promise<void> {
    if (!recordId) return;
    invalidateDispositionCache();
    const candidateIds = getCandidateUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        executeWithTimeout(deleteDoc(doc(targetDb, 'users', uid, 'disposition', recordId))).catch(() => {});
      }
    }
  },

  /**
   * Delete any absence records for a student recorded today in Firestore
   */
  async deleteTodayAbsencesForStudent(userId: string, studentId: string, targetDate: Date = new Date()): Promise<string[]> {
    if (!userId || !studentId) return [];
    invalidateDispositionCache();
    const candidateIds = getCandidateUserIds(userId);
    const deletedIds: string[] = [];

    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        try {
          const col = collection(targetDb, 'users', uid, 'disposition');
          const snap = await executeWithTimeout(getDocs(col));
          if (!snap) continue;
          const deletePromises: Promise<void>[] = [];

          snap.forEach((docSnap: any) => {
            const data = docSnap.data();
            if (
              data.studentId === studentId &&
              data.category === 'Ausencia' &&
              isSameCalendarDay(data.date, data.timestamp, targetDate)
            ) {
              deletedIds.push(docSnap.id);
              deletePromises.push(deleteDoc(docSnap.ref));
            }
          });

          if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
          }
        } catch (_) {}
      }
    }
    return Array.from(new Set(deletedIds));
  },

  /**
   * Delete disposition documents for a single student from Firestore (when resetting / clearing disposition)
   */
  async deleteStudentDispositionDocs(userId: string, studentId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !studentId) return [];
    invalidateDispositionCache();
    const candidateIds = getCandidateUserIds(userId);
    const deletedIds: string[] = [];

    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        try {
          const col = collection(targetDb, 'users', uid, 'disposition');
          const snap = await executeWithTimeout(getDocs(col));
          if (!snap) continue;
          const deletePromises: Promise<void>[] = [];

          snap.forEach((docSnap: any) => {
            const data = docSnap.data();
            if (data.studentId === studentId) {
              const isDisp = data.category === 'Disposición' || (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
              if (clearAll || isDisp) {
                deletedIds.push(docSnap.id);
                deletePromises.push(deleteDoc(docSnap.ref));
              }
            }
          });

          if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
          }
        } catch (_) {}
      }
    }
    return Array.from(new Set(deletedIds));
  },

  /**
   * Delete disposition documents for an entire course from Firestore
   */
  async deleteCourseDispositionDocs(userId: string, courseId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !courseId) return [];
    invalidateDispositionCache();
    const candidateIds = getCandidateUserIds(userId);
    const deletedIds: string[] = [];

    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        try {
          const col = collection(targetDb, 'users', uid, 'disposition');
          const snap = await executeWithTimeout(getDocs(col));
          if (!snap) continue;
          const deletePromises: Promise<void>[] = [];

          snap.forEach((docSnap: any) => {
            const data = docSnap.data();
            if (data.courseId === courseId) {
              const isDisp = data.category === 'Disposición' || (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
              if (clearAll || isDisp) {
                deletedIds.push(docSnap.id);
                deletePromises.push(deleteDoc(docSnap.ref));
              }
            }
          });

          if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
          }
        } catch (_) {}
      }
    }
    return Array.from(new Set(deletedIds));
  },

  /**
   * Load disposition history from Firestore for the current teacher's candidate accounts
   */
  async loadDisposition(userId: string): Promise<{ disposition: Record<string, any>; history: any[] }> {
    if (Date.now() < firestoreUnavailableUntil) {
      return { disposition: {}, history: [] };
    }
    if (
      dispositionReadCache &&
      dispositionReadCache.userId === userId &&
      Date.now() - dispositionReadCache.timestamp < READ_CACHE_TTL_MS &&
      (dispositionReadCache.data.history.length > 0 || Object.keys(dispositionReadCache.data.disposition).length > 0)
    ) {
      return dispositionReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'disposition'))).catch(() => null));
        }
      }

      const snaps = await Promise.all(queries);
      const history: any[] = [];
      const seenRecordIds = new Set<string>();
      const disposition: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
      const disposition2c: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
      const deleted = getDeletedHistoryIdsSet();

      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const docId = docSnap.id;
          const data = docSnap.data();
          const recordId = data.id || docId;

          if (deleted.has(docId) || deleted.has(recordId)) {
            deleteDoc(docSnap.ref).catch(() => {});
            return;
          }

          if (seenRecordIds.has(recordId)) return;
          seenRecordIds.add(recordId);

          const item: any = { id: recordId, ...data };
          if (data.category === 'Ausencia' || data.category === 'Llegada tarde') {
            item.pointsChange = 0;
          }
          history.push(item);

          const studentId = data.studentId;
          if (studentId && studentId !== 'all') {
            const targetMap = data.term === '2c' ? disposition2c : disposition;
            if (!targetMap[studentId]) {
              targetMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
            }
            const isAbsence =
              data.category === 'Ausencia' ||
              data.action === 'Ausencia' ||
              data.action?.toLowerCase().includes('ausencia') ||
              data.action?.toLowerCase().includes('falta');

            const isLate =
              data.category === 'Llegada tarde' ||
              data.action === 'Llegada tarde' ||
              data.action?.toLowerCase().includes('llegada tarde') ||
              data.action?.toLowerCase().includes('tardanza') ||
              data.action?.toLowerCase().includes('tarde');

            if (isAbsence) {
              targetMap[studentId].totalAbsences += 1;
            } else if (isLate) {
              targetMap[studentId].totalLates = (targetMap[studentId].totalLates || 0) + 1;
            } else if (
              data.category === 'Disposición' ||
              (!isAbsence && !isLate && data.category !== 'Sistema' && data.category !== 'Calificación')
            ) {
              const delta = typeof data.pointsChange === 'number' ? data.pointsChange : -1;
              targetMap[studentId].totalDisposition = Math.min(
                10,
                Math.max(0, targetMap[studentId].totalDisposition + delta)
              );
            }
          }
        });
      }

      history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const result = { disposition, disposition2c, history };
      if (history.length > 0 || Object.keys(disposition).length > 0 || Object.keys(disposition2c).length > 0) {
        dispositionReadCache = { userId, timestamp: Date.now(), data: result };
      }
      return result;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/disposition`);
      return { disposition: {}, history: [] };
    }
  },

  /**
   * Save a cuatrimestre gradebook snapshot globally across linked accounts and database instances
   */
  async saveTermSnapshot(
    userId: string,
    courseId: string,
    term: string,
    snapshotData: any
  ): Promise<void> {
    if (!userId || !courseId || !term) return;
    invalidateSnapshotsCache();
    const docId = `${courseId}_${term}`;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({
      ...snapshotData,
      courseId,
      term,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}/snapshots/${docId}`;
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'snapshots', docId),
            cleanPayload,
            { merge: true }
          )
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Load cuatrimestre closure snapshots for a course for the current teacher's candidate accounts
   */
  async loadTermSnapshots(
    userId: string,
    courseId: string
  ): Promise<Record<string, any>> {
    if (!courseId || Date.now() < firestoreUnavailableUntil) return {};
    const cacheKey = `${userId}_${courseId}`;
    if (
      snapshotsReadCache &&
      snapshotsReadCache.key === cacheKey &&
      Date.now() - snapshotsReadCache.timestamp < READ_CACHE_TTL_MS &&
      Object.keys(snapshotsReadCache.data).length > 0
    ) {
      return snapshotsReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'snapshots'))).catch(() => null));
        }
      }

      const snaps = await Promise.all(queries);
      const snapshots: Record<string, any> = {};
      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.courseId === courseId && data.term) {
            const existing = snapshots[data.term];
            if (!existing || (data.updatedAt && (!existing.updatedAt || data.updatedAt > existing.updatedAt))) {
              snapshots[data.term] = data;
            }
          }
        });
      }
      if (Object.keys(snapshots).length > 0) {
        snapshotsReadCache = { key: cacheKey, timestamp: Date.now(), data: snapshots };
      }
      return snapshots;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/snapshots`);
      return {};
    }
  },

  /**
   * Batch save multiple disposition records in a single Firestore batch operation
   */
  async saveDispositionBatch(userId: string, records: any[]): Promise<void> {
    if (!userId || !Array.isArray(records) || records.length === 0 || Date.now() < firestoreUnavailableUntil) return;
    invalidateDispositionCache();
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const validRecords = records.filter((r) => r && r.id);
    if (validRecords.length === 0) return;

    // Chunk into groups of 80 records so batch size * writeIds stays well below Firestore's 500 operation limit
    const CHUNK_SIZE = 80;
    for (const targetDb of ALL_DBS) {
      for (let i = 0; i < validRecords.length; i += CHUNK_SIZE) {
        const chunk = validRecords.slice(i, i + CHUNK_SIZE);
        try {
          const batch = writeBatch(targetDb);
          for (const uid of writeIds) {
            for (const rec of chunk) {
              const ref = doc(targetDb, 'users', uid, 'disposition', rec.id);
              batch.set(ref, sanitizeForFirestore({ ...rec, updatedAt: nowIso }), { merge: true });
            }
          }
          await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${userId}/disposition`);
        }
      }
    }
  },

  /**
   * Save user settings (conduct options, templates, etc.) under /users/{uid}/settings/{settingKey}
   */
  async saveUserSetting(userId: string, settingKey: string, payload: any): Promise<void> {
    if (!userId || !settingKey || Date.now() < firestoreUnavailableUntil) return;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({ value: payload, updatedAt: nowIso });
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}/settings/${settingKey}`;
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'settings', settingKey),
            cleanPayload,
            { merge: true }
          ),
          FIRESTORE_TIMEOUT_MS,
          true
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Load user setting (conduct options, templates, etc.) across candidate accounts using direct document lookup
   */
  async loadUserSetting<T = any>(userId: string, settingKey: string): Promise<T | null> {
    if (!settingKey || Date.now() < firestoreUnavailableUntil) return null;
    const candidateIds = getCandidateUserIds(userId);
    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', settingKey))).catch(() => null)
          );
        }
      }
      const snaps = await Promise.all(queries);
      let latestUpdatedAt = '';
      let latestValue: T | null = null;
      for (const docSnap of snaps) {
        if (!docSnap || typeof docSnap.exists !== 'function' || !docSnap.exists()) continue;
        const data = docSnap.data();
        if (data && data.value !== undefined) {
          if (!latestUpdatedAt || (data.updatedAt && data.updatedAt >= latestUpdatedAt)) {
            latestUpdatedAt = data.updatedAt || '';
            latestValue = data.value as T;
          }
        }
      }
      return latestValue;
    } catch (_) {
      return null;
    }
  },

  /**
   * Save Custom Gem to Firestore under /users/{uid}/gems/{gemId}
   */
  async saveCustomGem(userId: string, gem: CustomGem): Promise<void> {
    if (!userId || !gem?.id || Date.now() < firestoreUnavailableUntil) return;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({ ...gem, updatedAt: nowIso });
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const path = `users/${uid}/gems/${gem.id}`;
        executeWithTimeout(
          setDoc(doc(targetDb, 'users', uid, 'gems', gem.id), cleanPayload, { merge: true })
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Load Custom Gems from Firestore across candidate accounts
   */
  async loadCustomGems(userId: string): Promise<CustomGem[]> {
    if (Date.now() < firestoreUnavailableUntil) return [];
    const candidateIds = getCandidateUserIds(userId);
    const gemsMap = new Map<string, CustomGem>();
    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'gems'))).catch(() => null));
        }
      }
      const snaps = await Promise.all(queries);
      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const data = docSnap.data() as CustomGem;
          if (data && data.id && data.name) {
            gemsMap.set(data.id, data);
          }
        });
      }
      return Array.from(gemsMap.values());
    } catch (_) {
      return [];
    }
  },

  /**
   * Delete Custom Gem from Firestore across candidate accounts
   */
  async deleteCustomGem(userId: string, gemId: string): Promise<void> {
    if (!gemId || Date.now() < firestoreUnavailableUntil) return;
    const candidateIds = getCandidateUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        executeWithTimeout(deleteDoc(doc(targetDb, 'users', uid, 'gems', gemId))).catch(() => {});
      }
    }
  },

  /**
   * Save a single student observation or full observations map to the user's cloud settings
   */
  async saveStudentObservation(
    userId: string,
    obs: any,
    fullMap?: Record<string, any[]>
  ): Promise<void> {
    if (!userId) return;
    try {
      let mapToSave = fullMap;
      if (!mapToSave && typeof window !== 'undefined') {
        const scopedKey = `fds_student_observations_${userId}`;
        const stored =
          localStorage.getItem(scopedKey) ||
          (isPrimaryOwnerAccount() ? localStorage.getItem('fds_student_observations') : null);
        if (stored) {
          mapToSave = JSON.parse(stored);
        }
      }
      if (!mapToSave && obs?.studentId) {
        mapToSave = { [obs.studentId]: [obs] };
      }
      if (mapToSave) {
        await this.saveUserSetting(userId, 'student_observations', mapToSave);
      }
    } catch (_) {}
  },

  /**
   * Save full student observations map to Firestore
   */
  async saveStudentObservationsMap(
    userId: string,
    observationsMap: Record<string, any[]>
  ): Promise<void> {
    if (!userId) return;
    await this.saveUserSetting(userId, 'student_observations', observationsMap);
  },

  /**
   * Load student observations map from Firestore across candidate accounts
   */
  async loadStudentObservationsMap(userId: string): Promise<Record<string, any[]> | null> {
    if (!userId) return null;
    const res = await this.loadUserSetting(userId, 'student_observations');
    return (res as Record<string, any[]>) || null;
  },

  /**
   * Delete any late arrival records for a student recorded today in Firestore
   */
  async deleteTodayLatesForStudent(userId: string, studentId: string, targetDate: Date = new Date()): Promise<string[]> {
    if (!userId || !studentId) return [];
    invalidateDispositionCache();
    const candidateIds = getCandidateUserIds(userId);
    const deletedIds: string[] = [];

    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        try {
          const col = collection(targetDb, 'users', uid, 'disposition');
          const snap = await executeWithTimeout(getDocs(col));
          if (!snap) continue;
          const deletePromises: Promise<void>[] = [];

          snap.forEach((docSnap: any) => {
            const data = docSnap.data();
            const isLate =
              data.category === 'Llegada tarde' ||
              data.action === 'Llegada tarde' ||
              String(data.action || '').toLowerCase().includes('llegada tarde') ||
              String(data.action || '').toLowerCase().includes('tarde');
            if (
              data.studentId === studentId &&
              isLate &&
              isSameCalendarDay(data.date, data.timestamp, targetDate)
            ) {
              deletedIds.push(docSnap.id);
              deletePromises.push(deleteDoc(docSnap.ref));
            }
          });

          if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
          }
        } catch (_) {}
      }
    }
    return Array.from(new Set(deletedIds));
  },
};

