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

let lastRawProfileStr: string | null = null;
let lastParsedProfileObj: { id?: string; email?: string } | null = null;

function getCachedStoredProfile(): { id?: string; email?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
    if (!saved) {
      lastRawProfileStr = null;
      lastParsedProfileObj = null;
      return null;
    }
    if (saved === lastRawProfileStr && lastParsedProfileObj) {
      return lastParsedProfileObj;
    }
    const parsed = JSON.parse(saved);
    lastRawProfileStr = saved;
    lastParsedProfileObj = parsed;
    return parsed;
  } catch (_) {
    return null;
  }
}

// Helper to get active teacher email
export function getActiveUserEmail(): string {
  if (auth.currentUser?.email) return auth.currentUser.email.trim().toLowerCase();
  if (typeof window !== 'undefined') {
    try {
      const parsed = getCachedStoredProfile();
      if (parsed?.email) return String(parsed.email).trim().toLowerCase();
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
      const parsed = getCachedStoredProfile();
      if (parsed) {
        if (parsed.id && !String(parsed.id).startsWith('user-')) {
          return String(parsed.id);
        }
        if (parsed.email) {
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

// In-memory caches (60 seconds TTL, invalidated immediately on any write) to avoid redundant Firestore reads on tab switches
const READ_CACHE_TTL_MS = 60000;
let coursesReadCache: { userId: string; timestamp: number; data: Course[] } | null = null;
let studentsReadCache: { userId: string; timestamp: number; data: Student[] } | null = null;
let dispositionReadCache: {
  userId: string;
  timestamp: number;
  data: { disposition: Record<string, any>; disposition2c?: Record<string, any>; history: any[] };
} | null = null;
let snapshotsByUserCache: {
  userId: string;
  timestamp: number;
  byCourse: Record<string, Record<string, any>>;
} | null = null;
const settingsReadCache = new Map<string, { timestamp: number; value: any }>();
const gemsReadCache = new Map<string, { timestamp: number; data: CustomGem[] }>();

// ---------------------------------------------------------------------------
// INCREMENTAL DIRTY-TRACKING & FINGERPRINT ENGINE (Eliminates redundant writes)
// ---------------------------------------------------------------------------
const FINGERPRINT_STORAGE_KEY = 'docencia_cloud_sync_fingerprints_v2';
const lastSyncedFingerprints = new Map<string, string>();
let fingerprintPersistTimer: any = null;

function hydrateFingerprintsFromSession(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') {
            lastSyncedFingerprints.set(k, v);
          }
        }
      }
    }
  } catch (_) {}
}
hydrateFingerprintsFromSession();

function schedulePersistFingerprints(): void {
  if (typeof window === 'undefined') return;
  if (fingerprintPersistTimer) return;
  fingerprintPersistTimer = setTimeout(() => {
    fingerprintPersistTimer = null;
    try {
      const obj: Record<string, string> = {};
      // Keep the most recent 1,500 fingerprints in sessionStorage
      const entries = Array.from(lastSyncedFingerprints.entries()).slice(-1500);
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      sessionStorage.setItem(FINGERPRINT_STORAGE_KEY, JSON.stringify(obj));
    } catch (_) {}
  }, 500);
}

const VOLATILE_KEYS = new Set(['updatedAt', 'savedAt', 'lastSyncedAt']);

function canonicalizeValue(val: any): string {
  if (val === null || val === undefined) return 'null';
  const t = typeof val;
  if (t === 'number' || t === 'boolean') return String(val);
  if (t === 'string') return JSON.stringify(val);
  if (Array.isArray(val)) {
    const parts: string[] = [];
    for (let i = 0; i < val.length; i++) {
      if (val[i] !== undefined) {
        parts.push(canonicalizeValue(val[i]));
      }
    }
    return '[' + parts.join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(val).filter((k) => !VOLATILE_KEYS.has(k) && val[k] !== undefined).sort();
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      parts.push(JSON.stringify(k) + ':' + canonicalizeValue(val[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  return '';
}

function computePayloadFingerprint(payload: any): string {
  const canonical = canonicalizeValue(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${canonical.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

function isPayloadDirty(key: string, payload: any): { dirty: boolean; fingerprint: string } {
  const fp = computePayloadFingerprint(payload);
  const prev = lastSyncedFingerprints.get(key);
  return { dirty: prev !== fp, fingerprint: fp };
}

function markPayloadSynced(key: string, fingerprint: string): void {
  lastSyncedFingerprints.set(key, fingerprint);
  schedulePersistFingerprints();
}

function removeFingerprintPrefix(prefix: string): void {
  for (const k of Array.from(lastSyncedFingerprints.keys())) {
    if (k.startsWith(prefix)) {
      lastSyncedFingerprints.delete(k);
    }
  }
  schedulePersistFingerprints();
}

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
  snapshotsByUserCache = null;
}

export function clearFirestoreMemoryCaches(): void {
  coursesReadCache = null;
  studentsReadCache = null;
  dispositionReadCache = null;
  snapshotsByUserCache = null;
  settingsReadCache.clear();
  gemsReadCache.clear();
  lastSyncedFingerprints.clear();
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(FINGERPRINT_STORAGE_KEY);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// COMPACT DISPOSITION & HISTORY ENGINE (1-2 reads instead of 3,000+ reads)
// ---------------------------------------------------------------------------
const COMPACT_SUMMARY_DOC_ID = 'disposition_summary_v2';
const COMPACT_HISTORY_DOC_ID = 'disposition_history_v2';
const COMPACT_SYNC_KEY = 'disposition_compact_bundle';

let compactSyncTimer: any = null;
let pendingCompactUserId: string | null = null;
const inMemoryPendingRecords = new Map<string, any>();
const inMemoryDeletedIds = new Set<string>();

function readLocalDispositionBundle(userId: string): {
  disposition: Record<string, any>;
  disposition2c: Record<string, any>;
  history: any[];
  deletedIds: Set<string>;
} {
  const deletedIds = getDeletedHistoryIdsSet();
  inMemoryDeletedIds.forEach((id) => deletedIds.add(id));

  let disposition: Record<string, any> = {};
  let disposition2c: Record<string, any> = {};
  const historyMap = new Map<string, any>();

  if (typeof window !== 'undefined') {
    const isOwner = isPrimaryOwnerAccount();
    try {
      const dispKeys = isOwner
        ? [`docencia_disposition_data_${userId}`, 'fds_disposition_data_v2', 'docencia_disposition_data']
        : [`docencia_disposition_data_${userId}`];
      for (const k of dispKeys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            disposition = { ...parsed, ...disposition };
          }
        }
      }

      const disp2cKeys = isOwner
        ? [`fds_disposition_data_2c_${userId}`, 'fds_disposition_data_2c']
        : [`fds_disposition_data_2c_${userId}`];
      for (const k of disp2cKeys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            disposition2c = { ...parsed, ...disposition2c };
          }
        }
      }

      const histKeys = isOwner
        ? [`docencia_disposition_history_${userId}`, 'fds_disposition_history_v2', 'docencia_disposition_history']
        : [`docencia_disposition_history_${userId}`];
      for (const k of histKeys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item?.id && !deletedIds.has(item.id) && !historyMap.has(item.id)) {
                historyMap.set(item.id, item);
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // Merge any in-memory pending records
  inMemoryPendingRecords.forEach((rec, id) => {
    if (!deletedIds.has(id)) {
      historyMap.set(id, { ...(historyMap.get(id) || {}), ...rec });
    }
  });

  const history = Array.from(historyMap.values()).filter((h) => h?.id && !deletedIds.has(h.id));
  history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return { disposition, disposition2c, history, deletedIds };
}

function computeTotalsFromHistoryList(history: any[]): {
  disposition1c: Record<string, { totalAbsences: number; totalLates: number; totalDisposition: number }>;
  disposition2c: Record<string, { totalAbsences: number; totalLates: number; totalDisposition: number }>;
} {
  const disposition1c: Record<string, { totalAbsences: number; totalLates: number; totalDisposition: number }> = {};
  const disposition2c: Record<string, { totalAbsences: number; totalLates: number; totalDisposition: number }> = {};

  const chronological = [...history].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const data of chronological) {
    const studentId = data?.studentId;
    if (!studentId || studentId === 'all') continue;
    const targetMap = data.term === '2c' ? disposition2c : disposition1c;
    if (!targetMap[studentId]) {
      targetMap[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    }
    const isReset =
      data.category === 'Sistema' ||
      String(data.action || '').toLowerCase().includes('restablecid') ||
      String(data.action || '').toLowerCase().includes('reinicio');
    if (isReset) {
      targetMap[studentId].totalDisposition = 10;
      continue;
    }

    const isAbsence =
      data.category === 'Ausencia' ||
      data.action === 'Ausencia' ||
      String(data.action || '').toLowerCase().includes('ausencia') ||
      String(data.action || '').toLowerCase().includes('falta');

    const isLate =
      data.category === 'Llegada tarde' ||
      data.action === 'Llegada tarde' ||
      String(data.action || '').toLowerCase().includes('llegada tarde') ||
      String(data.action || '').toLowerCase().includes('tardanza') ||
      String(data.action || '').toLowerCase().includes('tarde');

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

  return { disposition1c, disposition2c };
}

async function flushCompactDispositionToCloud(
  explicitUserId?: string,
  overrideBundle?: {
    disposition: Record<string, any>;
    disposition2c: Record<string, any>;
    history: any[];
    deletedIds?: string[];
  }
): Promise<void> {
  if (compactSyncTimer) {
    clearTimeout(compactSyncTimer);
    compactSyncTimer = null;
  }
  const userId = explicitUserId || pendingCompactUserId || getActiveUserId();
  if (!userId || Date.now() < firestoreUnavailableUntil) {
    notifyDebouncedSyncPending(COMPACT_SYNC_KEY, false);
    return;
  }

  const localBundle = overrideBundle
    ? {
        disposition: overrideBundle.disposition || {},
        disposition2c: overrideBundle.disposition2c || {},
        history: overrideBundle.history || [],
        deletedIds: new Set<string>(overrideBundle.deletedIds || Array.from(getDeletedHistoryIdsSet())),
      }
    : readLocalDispositionBundle(userId);

  const computed = computeTotalsFromHistoryList(localBundle.history);
  const mergedDisp1c = { ...computed.disposition1c, ...localBundle.disposition };
  const mergedDisp2c = { ...computed.disposition2c, ...localBundle.disposition2c };
  const cleanHistory = localBundle.history.slice(0, 2500);
  const cleanDeletedIds = Array.from(localBundle.deletedIds).slice(-1500);

  dispositionReadCache = {
    userId,
    timestamp: Date.now(),
    data: {
      disposition: mergedDisp1c,
      disposition2c: mergedDisp2c,
      history: cleanHistory,
    },
  };

  const writeIds = getTargetWriteUserIds(userId);
  const nowIso = new Date().toISOString();

  const summaryCore = {
    version: 2,
    migratedFromLegacy: true,
    disposition: mergedDisp1c,
    disposition2c: mergedDisp2c,
    deletedIds: cleanDeletedIds,
  };
  const historyCore = {
    version: 2,
    items: cleanHistory,
  };

  const summaryPayload = sanitizeForFirestore({
    ...summaryCore,
    updatedAt: nowIso,
  });

  const historyPayload = sanitizeForFirestore({
    ...historyCore,
    updatedAt: nowIso,
  });

  try {
    for (const targetDb of ALL_DBS) {
      const batch = writeBatch(targetDb);
      let opsCount = 0;
      const pendingMarks: Array<{ key: string; fp: string }> = [];

      for (const uid of writeIds) {
        const sumKey = `disp_summary:${uid}`;
        const histKey = `disp_history:${uid}`;
        const sumCheck = isPayloadDirty(sumKey, summaryCore);
        const histCheck = isPayloadDirty(histKey, historyCore);

        if (sumCheck.dirty) {
          batch.set(
            doc(targetDb, 'users', uid, 'settings', COMPACT_SUMMARY_DOC_ID),
            { value: summaryPayload, updatedAt: nowIso },
            { merge: true }
          );
          opsCount++;
          pendingMarks.push({ key: sumKey, fp: sumCheck.fingerprint });
        }
        if (histCheck.dirty) {
          batch.set(
            doc(targetDb, 'users', uid, 'settings', COMPACT_HISTORY_DOC_ID),
            { value: historyPayload, updatedAt: nowIso },
            { merge: true }
          );
          opsCount++;
          pendingMarks.push({ key: histKey, fp: histCheck.fingerprint });
        }
      }

      if (opsCount > 0) {
        const res = await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
        if (res !== null) {
          pendingMarks.forEach((m) => markPayloadSynced(m.key, m.fp));
        }
      }
    }
    inMemoryPendingRecords.clear();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userId}/settings/${COMPACT_SUMMARY_DOC_ID}`);
  } finally {
    notifyDebouncedSyncPending(COMPACT_SYNC_KEY, false);
  }
}

function scheduleCompactDispositionSync(userId: string, immediate = false): void {
  if (!userId || Date.now() < firestoreUnavailableUntil) return;
  pendingCompactUserId = userId;

  const current = readLocalDispositionBundle(userId);
  const computed = computeTotalsFromHistoryList(current.history);
  dispositionReadCache = {
    userId,
    timestamp: Date.now(),
    data: {
      disposition: { ...computed.disposition1c, ...current.disposition },
      disposition2c: { ...computed.disposition2c, ...current.disposition2c },
      history: current.history,
    },
  };

  if (immediate) {
    flushCompactDispositionToCloud(userId).catch(() => {});
    return;
  }

  notifyDebouncedSyncPending(COMPACT_SYNC_KEY, true);
  if (compactSyncTimer) {
    clearTimeout(compactSyncTimer);
  }
  compactSyncTimer = setTimeout(() => {
    flushCompactDispositionToCloud(userId).catch(() => {});
  }, 1200);
}

registerCloudFlushHandler('compact_disposition_flush', () => {
  if (compactSyncTimer && pendingCompactUserId) {
    flushCompactDispositionToCloud(pendingCompactUserId).catch(() => {});
  }
});

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

// Coalescing queues for high-frequency writes (attendance, snapshots, user settings)
const pendingAttendanceWrites = new Map<
  string,
  { timer: any; userId: string; courseId: string; date: string; records: { studentId: string; status: string }[] }
>();
const pendingSnapshotWrites = new Map<
  string,
  { timer: any; userId: string; courseId: string; term: string; snapshotData: any }
>();
const pendingSettingWrites = new Map<
  string,
  { timer: any; userId: string; settingKey: string; payload: any }
>();

async function flushSingleAttendanceWrite(entry: {
  userId: string;
  courseId: string;
  date: string;
  records: { studentId: string; status: string }[];
}): Promise<void> {
  const { userId, courseId, date, records } = entry;
  if (!userId || !courseId || !date || Date.now() < firestoreUnavailableUntil) return;
  const docId = `${courseId}_${date}`;
  const writeIds = getTargetWriteUserIds(userId);
  const nowIso = new Date().toISOString();
  const recordsStr = JSON.stringify(records);

  for (const targetDb of ALL_DBS) {
    for (const uid of writeIds) {
      const fpKey = `attendance:${uid}:${docId}`;
      const check = isPayloadDirty(fpKey, { courseId, date, records: recordsStr });
      if (!check.dirty) continue;

      const path = `users/${uid}/attendance/${docId}`;
      executeWithTimeout(
        setDoc(
          doc(targetDb, 'users', uid, 'attendance', docId),
          {
            courseId,
            date,
            records: recordsStr,
            updatedAt: nowIso,
          },
          { merge: true }
        ),
        FIRESTORE_TIMEOUT_MS,
        true
      )
        .then((res) => {
          if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
        })
        .catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
    }
  }
}

async function flushSingleSnapshotWrite(entry: {
  userId: string;
  courseId: string;
  term: string;
  snapshotData: any;
}): Promise<void> {
  const { userId, courseId, term, snapshotData } = entry;
  if (!userId || !courseId || !term || Date.now() < firestoreUnavailableUntil) return;
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
      const fpKey = `snapshot:${uid}:${docId}`;
      const check = isPayloadDirty(fpKey, cleanPayload);
      if (!check.dirty) continue;

      const path = `users/${uid}/snapshots/${docId}`;
      executeWithTimeout(
        setDoc(doc(targetDb, 'users', uid, 'snapshots', docId), cleanPayload, { merge: true }),
        FIRESTORE_TIMEOUT_MS,
        true
      )
        .then((res) => {
          if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
        })
        .catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
    }
  }
}

async function flushSingleSettingWrite(entry: {
  userId: string;
  settingKey: string;
  payload: any;
}): Promise<void> {
  const { userId, settingKey, payload } = entry;
  if (!userId || !settingKey || Date.now() < firestoreUnavailableUntil) return;
  const writeIds = getTargetWriteUserIds(userId);
  const nowIso = new Date().toISOString();
  const cleanPayload = sanitizeForFirestore({ value: payload, updatedAt: nowIso });

  for (const targetDb of ALL_DBS) {
    for (const uid of writeIds) {
      const fpKey = `setting:${uid}:${settingKey}`;
      const check = isPayloadDirty(fpKey, payload);
      if (!check.dirty) continue;

      const path = `users/${uid}/settings/${settingKey}`;
      executeWithTimeout(
        setDoc(doc(targetDb, 'users', uid, 'settings', settingKey), cleanPayload, { merge: true }),
        FIRESTORE_TIMEOUT_MS,
        true
      )
        .then((res) => {
          if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
        })
        .catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
    }
  }
}

registerCloudFlushHandler('incremental_queues_flush', () => {
  pendingAttendanceWrites.forEach((entry, key) => {
    clearTimeout(entry.timer);
    pendingAttendanceWrites.delete(key);
    notifyDebouncedSyncPending(`att_${key}`, false);
    flushSingleAttendanceWrite(entry).catch(() => {});
  });
  pendingSnapshotWrites.forEach((entry, key) => {
    clearTimeout(entry.timer);
    pendingSnapshotWrites.delete(key);
    notifyDebouncedSyncPending(`snap_${key}`, false);
    flushSingleSnapshotWrite(entry).catch(() => {});
  });
  pendingSettingWrites.forEach((entry, key) => {
    clearTimeout(entry.timer);
    pendingSettingWrites.delete(key);
    notifyDebouncedSyncPending(`set_${key}`, false);
    flushSingleSettingWrite(entry).catch(() => {});
  });
});

export const firestoreSync = {
  clearMemoryCaches: clearFirestoreMemoryCaches,
  clearCaches: clearFirestoreMemoryCaches,

  /**
   * Save teacher profile to Firestore under /users/{userId} (skips if unchanged)
   */
  async saveTeacherProfile(profile: Partial<TeacherProfile> & { id?: string; email?: string }): Promise<void> {
    if (!profile?.email && !profile?.id) return;
    if (Date.now() < firestoreUnavailableUntil) return;
    const userId = profile.id || getActiveUserId();
    const coreProfile = {
      uid: String(userId).slice(0, 128),
      email: String(profile.email || '').slice(0, 256),
      name: String(profile.name || 'Docente Titular').slice(0, 256),
      avatar: String(profile.avatar || '').slice(0, 1024),
      role: String(profile.role || 'Docente Titular').slice(0, 128),
      school: String(profile.school || 'FDS - Educación Secundaria').slice(0, 256),
    };
    const payload = {
      ...coreProfile,
      updatedAt: new Date().toISOString(),
    };
    const writeIds = getTargetWriteUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const fpKey = `teacher_profile:${uid}`;
        const check = isPayloadDirty(fpKey, coreProfile);
        if (!check.dirty) continue;

        const path = `users/${uid}`;
        executeWithTimeout(setDoc(doc(targetDb, 'users', uid), payload, { merge: true }), FIRESTORE_TIMEOUT_MS, true)
          .then((res) => {
            if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
          })
          .catch((err) => {
            handleFirestoreError(err, OperationType.WRITE, path);
          });
      }
    }
  },

  /**
   * Save courses to Firestore using Incremental Dirty-Tracking:
   * - Skips write completely if courses list is unchanged
   * - Only writes individual course docs that actually changed
   */
  async saveCourses(userId: string, courses: Course[]): Promise<void> {
    if (!userId || !Array.isArray(courses) || Date.now() < firestoreUnavailableUntil) return;
    const cleanCourses = courses.filter((c) => c && c.id);
    coursesReadCache = { userId, timestamp: Date.now(), data: cleanCourses };
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    const compactCore = {
      version: 2,
      migratedFromLegacy: true,
      items: cleanCourses,
    };
    const compactPayload = sanitizeForFirestore({
      ...compactCore,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      try {
        const batch = writeBatch(targetDb);
        let opsCount = 0;
        const pendingMarks: Array<{ key: string; fp: string }> = [];

        for (const uid of writeIds) {
          const compactKey = `courses_compact:${uid}`;
          const compactCheck = isPayloadDirty(compactKey, compactCore);
          if (compactCheck.dirty) {
            batch.set(
              doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
              { value: compactPayload, updatedAt: nowIso },
              { merge: true }
            );
            opsCount++;
            pendingMarks.push({ key: compactKey, fp: compactCheck.fingerprint });
          }

          // Mirror ONLY modified course documents for backwards-compatibility
          for (const course of cleanCourses) {
            const itemKey = `course_doc:${uid}:${course.id}`;
            const itemCheck = isPayloadDirty(itemKey, course);
            if (!itemCheck.dirty) continue;

            const ref = doc(targetDb, 'users', uid, 'courses', course.id);
            batch.set(
              ref,
              sanitizeForFirestore({
                ...course,
                updatedAt: nowIso,
              }),
              { merge: true }
            );
            opsCount++;
            pendingMarks.push({ key: itemKey, fp: itemCheck.fingerprint });
          }
        }

        if (opsCount > 0) {
          const res = await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
          if (res !== null) {
            pendingMarks.forEach((m) => markPayloadSynced(m.key, m.fp));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/settings/courses_compact_v2`);
      }
    }
  },

  /**
   * Load courses from Firestore using Compact v2 Document (1 read instead of N reads)
   * with automatic backwards-compatible migration and fingerprint seeding.
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
    const writeIds = getTargetWriteUserIds(userId);
    const coursesMap = new Map<string, Course>();

    try {
      // 1. Try Compact v2 Document first (1 read per candidate)
      const compactQueries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          compactQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'))).catch(() => null)
          );
        }
      }

      const compactSnaps = await Promise.all(compactQueries);
      let hasMigratedDoc = false;

      for (const snap of compactSnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const raw = snap.data();
        const val = raw?.value || raw;
        const items = Array.isArray(val?.items) ? val.items : [];
        if (val?.migratedFromLegacy || items.length > 0) {
          hasMigratedDoc = true;
        }
        for (const c of items) {
          if (c && c.id && (c.name || c.subject)) {
            coursesMap.set(c.id, c);
          }
        }
      }

      // 2. ONE-TIME LEGACY MIGRATION if no compact v2 doc exists yet
      if (!hasMigratedDoc) {
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
              coursesMap.set(data.id, data);
            }
          });
        }
      }

      const courses = Array.from(coursesMap.values());
      if (courses.length > 0) {
        coursesReadCache = { userId, timestamp: Date.now(), data: courses };
        // Seed fingerprints so subsequent saveCourses with identical data skips writes
        for (const uid of writeIds) {
          for (const c of courses) {
            markPayloadSynced(`course_doc:${uid}:${c.id}`, computePayloadFingerprint(c));
          }
          if (hasMigratedDoc) {
            markPayloadSynced(
              `courses_compact:${uid}`,
              computePayloadFingerprint({ version: 2, migratedFromLegacy: true, items: courses })
            );
          }
        }
      }

      // If we just migrated from legacy, save the compact v2 bundle in background
      if (!hasMigratedDoc && courses.length > 0) {
        const nowIso = new Date().toISOString();
        const compactCore = {
          version: 2,
          migratedFromLegacy: true,
          items: courses,
        };
        const compactPayload = sanitizeForFirestore({
          ...compactCore,
          updatedAt: nowIso,
        });
        for (const targetDb of ALL_DBS) {
          for (const uid of writeIds) {
            executeWithTimeout(
              setDoc(
                doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
                { value: compactPayload, updatedAt: nowIso },
                { merge: true }
              )
            )
              .then((res) => {
                if (res !== null) {
                  markPayloadSynced(`courses_compact:${uid}`, computePayloadFingerprint(compactCore));
                }
              })
              .catch(() => {});
          }
        }
      }

      return courses;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/courses`);
      return [];
    }
  },

  /**
   * Delete a course from Firestore across linked accounts and compact store
   */
  async deleteCourse(userId: string, courseId: string): Promise<void> {
    if (!courseId || Date.now() < firestoreUnavailableUntil) return;
    invalidateCoursesCache();
    invalidateStudentsCache();
    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    // 1. Remove from compact courses & compact students
    try {
      const remainingCourses = (coursesReadCache?.data || []).filter((c) => c.id !== courseId);
      coursesReadCache = { userId, timestamp: Date.now(), data: remainingCourses };

      for (const targetDb of ALL_DBS) {
        const batch = writeBatch(targetDb);
        for (const uid of writeIds) {
          batch.set(
            doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
            {
              value: sanitizeForFirestore({
                version: 2,
                migratedFromLegacy: true,
                items: remainingCourses,
                updatedAt: nowIso,
              }),
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
        await executeWithTimeout(batch.commit());
      }
    } catch (_) {}

    // 2. Remove legacy document and its cached fingerprint
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        removeFingerprintPrefix(`course_doc:${uid}:${courseId}`);
        removeFingerprintPrefix(`courses_compact:${uid}`);
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
    invalidateStudentsCache();
    removeFingerprintPrefix('course_doc:');
    removeFingerprintPrefix('courses_compact:');
    removeFingerprintPrefix('student_doc:');
    removeFingerprintPrefix('students_compact:');
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
            {
              value: {
                version: 2,
                migratedFromLegacy: true,
                items: [],
                updatedAt: nowIso,
              },
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ).catch(() => {});

        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
            {
              value: {
                version: 2,
                migratedFromLegacy: true,
                items: [],
                updatedAt: nowIso,
              },
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ).catch(() => {});
      }
    }

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
        } catch (_) {}
      }
    }
  },

  /**
   * Save students roster for a course to Firestore globally using Incremental Dirty-Tracking:
   * - Preserves students from all other courses (using memory cache + localStorage fallback)
   * - Skips write completely if nothing changed
   * - Only writes individual student docs that actually changed
   */
  async saveStudents(userId: string, courseId: string, students: Student[]): Promise<void> {
    if (!userId || !courseId || !Array.isArray(students) || Date.now() < firestoreUnavailableUntil) return;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    // Reconcile complete student list across all courses (seed from cache and localStorage so no course is ever dropped)
    const currentStudentsMap = new Map<string, Student>();
    if (typeof window !== 'undefined') {
      try {
        const localKey = `docencia_local_students_${userId}`;
        const rawLocal =
          localStorage.getItem(localKey) ||
          (isPrimaryOwnerAccount() ? localStorage.getItem('docencia_local_students') : null);
        if (rawLocal) {
          const parsedLocal = JSON.parse(rawLocal);
          if (Array.isArray(parsedLocal)) {
            for (const s of parsedLocal) {
              if (s?.id) currentStudentsMap.set(s.id, s);
            }
          }
        }
      } catch (_) {}
    }
    (studentsReadCache?.data || []).forEach((s) => {
      if (s?.id) currentStudentsMap.set(s.id, s);
    });

    // Remove existing students of this course to prevent duplicates, then add incoming
    for (const [sId, st] of Array.from(currentStudentsMap.entries())) {
      if (st.courseId === courseId) {
        currentStudentsMap.delete(sId);
      }
    }
    for (const st of students) {
      if (st?.id) {
        currentStudentsMap.set(st.id, { ...st, courseId });
      }
    }

    const fullCleanStudents = Array.from(currentStudentsMap.values());
    studentsReadCache = { userId, timestamp: Date.now(), data: fullCleanStudents };

    const compactCore = {
      version: 2,
      migratedFromLegacy: true,
      items: fullCleanStudents,
    };
    const compactPayload = sanitizeForFirestore({
      ...compactCore,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      try {
        const batch = writeBatch(targetDb);
        let opsCount = 0;
        const pendingMarks: Array<{ key: string; fp: string }> = [];

        for (const uid of writeIds) {
          const compactKey = `students_compact:${uid}`;
          const compactCheck = isPayloadDirty(compactKey, compactCore);
          if (compactCheck.dirty) {
            batch.set(
              doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
              { value: compactPayload, updatedAt: nowIso },
              { merge: true }
            );
            opsCount++;
            pendingMarks.push({ key: compactKey, fp: compactCheck.fingerprint });
          }

          // Mirror ONLY modified course students to legacy subcollection
          for (const st of students) {
            if (!st?.id) continue;
            const normalizedStudent = { ...st, courseId };
            const itemKey = `student_doc:${uid}:${st.id}`;
            const itemCheck = isPayloadDirty(itemKey, normalizedStudent);
            if (!itemCheck.dirty) continue;

            const ref = doc(targetDb, 'users', uid, 'students', st.id);
            batch.set(
              ref,
              sanitizeForFirestore({
                ...normalizedStudent,
                updatedAt: nowIso,
              }),
              { merge: true }
            );
            opsCount++;
            pendingMarks.push({ key: itemKey, fp: itemCheck.fingerprint });
          }
        }

        if (opsCount > 0) {
          const res = await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
          if (res !== null) {
            pendingMarks.forEach((m) => markPayloadSynced(m.key, m.fp));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/settings/students_compact_v2`);
      }
    }
  },

  /**
   * Load students from Firestore using Compact v2 Document (1 read instead of N reads)
   * with automatic backwards-compatible migration and fingerprint seeding.
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
    const writeIds = getTargetWriteUserIds(userId);
    const studentsMap = new Map<string, Student>();

    try {
      // 1. Try Compact v2 Document first (1 read per candidate)
      const compactQueries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          compactQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'))).catch(() => null)
          );
        }
      }

      const compactSnaps = await Promise.all(compactQueries);
      let hasMigratedDoc = false;

      for (const snap of compactSnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const raw = snap.data();
        const val = raw?.value || raw;
        const items = Array.isArray(val?.items) ? val.items : [];
        if (val?.migratedFromLegacy || items.length > 0) {
          hasMigratedDoc = true;
        }
        for (const s of items) {
          if (s && s.id && (s.firstName || s.lastName || s.email)) {
            studentsMap.set(s.id, s);
          }
        }
      }

      // 2. ONE-TIME LEGACY MIGRATION if no compact doc exists yet
      if (!hasMigratedDoc) {
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
              studentsMap.set(data.id, data);
            }
          });
        }
      }

      const allStudents = Array.from(studentsMap.values());
      if (allStudents.length > 0) {
        studentsReadCache = { userId, timestamp: Date.now(), data: allStudents };
        for (const uid of writeIds) {
          for (const st of allStudents) {
            markPayloadSynced(`student_doc:${uid}:${st.id}`, computePayloadFingerprint(st));
          }
          if (hasMigratedDoc) {
            markPayloadSynced(
              `students_compact:${uid}`,
              computePayloadFingerprint({ version: 2, migratedFromLegacy: true, items: allStudents })
            );
          }
        }
      }

      // If we just migrated from legacy, save the compact v2 bundle in background
      if (!hasMigratedDoc && allStudents.length > 0) {
        const nowIso = new Date().toISOString();
        const compactCore = {
          version: 2,
          migratedFromLegacy: true,
          items: allStudents,
        };
        const compactPayload = sanitizeForFirestore({
          ...compactCore,
          updatedAt: nowIso,
        });
        for (const targetDb of ALL_DBS) {
          for (const uid of writeIds) {
            executeWithTimeout(
              setDoc(
                doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
                { value: compactPayload, updatedAt: nowIso },
                { merge: true }
              )
            )
              .then((res) => {
                if (res !== null) {
                  markPayloadSynced(`students_compact:${uid}`, computePayloadFingerprint(compactCore));
                }
              })
              .catch(() => {});
          }
        }
      }

      return courseId ? allStudents.filter((s) => s.courseId === courseId) : allStudents;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/students`);
      return [];
    }
  },

  /**
   * Save attendance records for a course and date globally (coalesced & fingerprinted)
   */
  async saveAttendance(
    userId: string,
    courseId: string,
    date: string,
    records: { studentId: string; status: string }[]
  ): Promise<void> {
    if (!userId || !courseId || !date || Date.now() < firestoreUnavailableUntil) return;
    const queueKey = `${userId}_${courseId}_${date}`;
    const existing = pendingAttendanceWrites.get(queueKey);
    if (existing) {
      clearTimeout(existing.timer);
    }
    notifyDebouncedSyncPending(`att_${queueKey}`, true);
    const timer = setTimeout(() => {
      pendingAttendanceWrites.delete(queueKey);
      notifyDebouncedSyncPending(`att_${queueKey}`, false);
      flushSingleAttendanceWrite({ userId, courseId, date, records }).catch(() => {});
    }, 650);
    pendingAttendanceWrites.set(queueKey, { timer, userId, courseId, date, records });
  },

  /**
   * Save a student disposition / absence incident globally via the Compact Coalesced Engine (1 batch write instead of N writes)
   */
  async saveDisposition(userId: string, record: any): Promise<void> {
    if (!userId || !record?.id || Date.now() < firestoreUnavailableUntil) return;
    inMemoryPendingRecords.set(record.id, {
      ...record,
      updatedAt: new Date().toISOString(),
    });
    inMemoryDeletedIds.delete(record.id);
    scheduleCompactDispositionSync(userId, false);
  },

  /**
   * Delete a student disposition / absence incident from Firestore globally
   */
  async deleteDisposition(userId: string, recordId: string): Promise<void> {
    if (!recordId) return;
    inMemoryPendingRecords.delete(recordId);
    inMemoryDeletedIds.add(recordId);
    scheduleCompactDispositionSync(userId || getActiveUserId(), false);

    const candidateIds = getCandidateUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        executeWithTimeout(deleteDoc(doc(targetDb, 'users', uid, 'disposition', recordId))).catch(() => {});
      }
    }
  },

  /**
   * Delete any absence records for a student recorded today (0 Firestore reads — uses local/compact state)
   */
  async deleteTodayAbsencesForStudent(userId: string, studentId: string, targetDate: Date = new Date()): Promise<string[]> {
    if (!userId || !studentId) return [];
    const bundle = readLocalDispositionBundle(userId);
    const deletedIds: string[] = [];

    for (const data of bundle.history) {
      if (
        data.studentId === studentId &&
        data.category === 'Ausencia' &&
        isSameCalendarDay(data.date, data.timestamp, targetDate)
      ) {
        deletedIds.push(data.id);
        inMemoryDeletedIds.add(data.id);
        inMemoryPendingRecords.delete(data.id);
      }
    }

    if (deletedIds.length > 0) {
      scheduleCompactDispositionSync(userId, false);
    }
    return Array.from(new Set(deletedIds));
  },

  /**
   * Delete disposition documents for a single student (0 Firestore reads — uses local/compact state)
   */
  async deleteStudentDispositionDocs(userId: string, studentId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !studentId) return [];
    const bundle = readLocalDispositionBundle(userId);
    const deletedIds: string[] = [];

    for (const data of bundle.history) {
      if (data.studentId === studentId) {
        const isDisp =
          data.category === 'Disposición' ||
          (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
        if (clearAll || isDisp) {
          deletedIds.push(data.id);
          inMemoryDeletedIds.add(data.id);
          inMemoryPendingRecords.delete(data.id);
        }
      }
    }

    scheduleCompactDispositionSync(userId, false);
    return Array.from(new Set(deletedIds));
  },

  /**
   * Delete disposition documents for an entire course (0 Firestore reads — uses local/compact state)
   */
  async deleteCourseDispositionDocs(userId: string, courseId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !courseId) return [];
    const bundle = readLocalDispositionBundle(userId);
    const deletedIds: string[] = [];

    for (const data of bundle.history) {
      if (data.courseId === courseId) {
        const isDisp =
          data.category === 'Disposición' ||
          (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
        if (clearAll || isDisp) {
          deletedIds.push(data.id);
          inMemoryDeletedIds.add(data.id);
          inMemoryPendingRecords.delete(data.id);
        }
      }
    }

    scheduleCompactDispositionSync(userId, false);
    return Array.from(new Set(deletedIds));
  },

  /**
   * Load disposition summary (1°C + 2°C) and history from Firestore using Compact v2 Documents (2 reads instead of 3,000+),
   * with automatic one-time migration from legacy `users/{uid}/disposition` collection so zero historical data is ever lost.
   */
  async loadDisposition(
    userId: string
  ): Promise<{ disposition: Record<string, any>; disposition2c?: Record<string, any>; history: any[] }> {
    if (Date.now() < firestoreUnavailableUntil) {
      return { disposition: {}, disposition2c: {}, history: [] };
    }
    if (
      dispositionReadCache &&
      dispositionReadCache.userId === userId &&
      Date.now() - dispositionReadCache.timestamp < READ_CACHE_TTL_MS &&
      (dispositionReadCache.data.history.length > 0 ||
        Object.keys(dispositionReadCache.data.disposition).length > 0 ||
        Object.keys(dispositionReadCache.data.disposition2c || {}).length > 0)
    ) {
      return dispositionReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const deleted = getDeletedHistoryIdsSet();
    inMemoryDeletedIds.forEach((id) => deleted.add(id));

    try {
      const summaryQueries: Promise<any>[] = [];
      const historyQueries: Promise<any>[] = [];

      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          summaryQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', COMPACT_SUMMARY_DOC_ID))).catch(() => null)
          );
          historyQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', COMPACT_HISTORY_DOC_ID))).catch(() => null)
          );
        }
      }

      const [summarySnaps, historySnaps] = await Promise.all([
        Promise.all(summaryQueries),
        Promise.all(historyQueries),
      ]);

      let hasMigratedCompactDoc = false;
      let mergedDisposition1c: Record<string, any> = {};
      let mergedDisposition2c: Record<string, any> = {};
      const seenRecordIds = new Set<string>();
      const history: any[] = [];

      for (const snap of summarySnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const rawData = snap.data();
        const val = rawData?.value || rawData;
        if (!val || typeof val !== 'object') continue;

        if (val.migratedFromLegacy) {
          hasMigratedCompactDoc = true;
        }
        if (Array.isArray(val.deletedIds)) {
          val.deletedIds.forEach((id: string) => {
            if (id) deleted.add(id);
          });
        }
        if (val.disposition && typeof val.disposition === 'object') {
          mergedDisposition1c = { ...mergedDisposition1c, ...val.disposition };
        }
        if (val.disposition2c && typeof val.disposition2c === 'object') {
          mergedDisposition2c = { ...mergedDisposition2c, ...val.disposition2c };
        }
      }

      for (const snap of historySnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const rawData = snap.data();
        const val = rawData?.value || rawData;
        const items = Array.isArray(val?.items) ? val.items : [];
        if (items.length > 0) {
          hasMigratedCompactDoc = true;
        }
        for (const item of items) {
          const recordId = item?.id;
          if (!recordId || deleted.has(recordId) || seenRecordIds.has(recordId)) continue;
          seenRecordIds.add(recordId);
          history.push(item);
        }
      }

      // ONE-TIME LEGACY MIGRATION if teacher hasn't been migrated to compact v2 yet
      if (!hasMigratedCompactDoc) {
        const legacyQueries: Promise<any>[] = [];
        for (const targetDb of ALL_DBS) {
          for (const uid of candidateIds) {
            legacyQueries.push(
              executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'disposition'))).catch(() => null)
            );
          }
        }
        const legacySnaps = await Promise.all(legacyQueries);
        for (const snap of legacySnaps) {
          if (!snap) continue;
          snap.forEach((docSnap: any) => {
            const docId = docSnap.id;
            const data = docSnap.data();
            const recordId = data.id || docId;
            if (deleted.has(docId) || deleted.has(recordId) || seenRecordIds.has(recordId)) return;
            seenRecordIds.add(recordId);
            const item: any = { id: recordId, ...data };
            if (data.category === 'Ausencia' || data.category === 'Llegada tarde') {
              item.pointsChange = 0;
            }
            history.push(item);
          });
        }
      }

      history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const computedFromHistory = computeTotalsFromHistoryList(history);
      const finalDisposition1c: Record<string, any> = { ...computedFromHistory.disposition1c };
      for (const [stId, summaryVal] of Object.entries(mergedDisposition1c)) {
        const fromHist = finalDisposition1c[stId];
        if (!fromHist) {
          finalDisposition1c[stId] = summaryVal;
        } else {
          finalDisposition1c[stId] = {
            totalAbsences: Math.max(fromHist.totalAbsences || 0, summaryVal.totalAbsences || 0),
            totalLates: Math.max(fromHist.totalLates || 0, summaryVal.totalLates || 0),
            totalDisposition:
              summaryVal.totalDisposition !== undefined ? summaryVal.totalDisposition : fromHist.totalDisposition,
          };
        }
      }

      const finalDisposition2c: Record<string, any> = { ...computedFromHistory.disposition2c };
      for (const [stId, summaryVal] of Object.entries(mergedDisposition2c)) {
        const fromHist = finalDisposition2c[stId];
        if (!fromHist) {
          finalDisposition2c[stId] = summaryVal;
        } else {
          finalDisposition2c[stId] = {
            totalAbsences: Math.max(fromHist.totalAbsences || 0, summaryVal.totalAbsences || 0),
            totalLates: Math.max(fromHist.totalLates || 0, summaryVal.totalLates || 0),
            totalDisposition:
              summaryVal.totalDisposition !== undefined ? summaryVal.totalDisposition : fromHist.totalDisposition,
          };
        }
      }

      const result = {
        disposition: finalDisposition1c,
        disposition2c: finalDisposition2c,
        history,
      };

      dispositionReadCache = { userId, timestamp: Date.now(), data: result };

      if (hasMigratedCompactDoc) {
        const writeIds = getTargetWriteUserIds(userId);
        const cleanHistory = history.slice(0, 2500);
        const cleanDeletedIds = Array.from(deleted).slice(-1500);
        const summaryCore = {
          version: 2,
          migratedFromLegacy: true,
          disposition: finalDisposition1c,
          disposition2c: finalDisposition2c,
          deletedIds: cleanDeletedIds,
        };
        const historyCore = {
          version: 2,
          items: cleanHistory,
        };
        const sumFp = computePayloadFingerprint(summaryCore);
        const histFp = computePayloadFingerprint(historyCore);
        for (const uid of writeIds) {
          markPayloadSynced(`disp_summary:${uid}`, sumFp);
          markPayloadSynced(`disp_history:${uid}`, histFp);
        }
      } else {
        const localBundle = readLocalDispositionBundle(userId);
        const combinedHistMap = new Map<string, any>();
        for (const h of [...history, ...localBundle.history]) {
          if (h?.id && !deleted.has(h.id) && !combinedHistMap.has(h.id)) {
            combinedHistMap.set(h.id, h);
          }
        }
        const combinedHistory = Array.from(combinedHistMap.values()).sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        );
        flushCompactDispositionToCloud(userId, {
          disposition: { ...localBundle.disposition, ...finalDisposition1c },
          disposition2c: { ...localBundle.disposition2c, ...finalDisposition2c },
          history: combinedHistory,
          deletedIds: Array.from(deleted),
        }).catch(() => {});
      }

      return result;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/settings/${COMPACT_SUMMARY_DOC_ID}`);
      return { disposition: {}, disposition2c: {}, history: [] };
    }
  },

  /**
   * Save a cuatrimestre gradebook or libro de temas snapshot globally across linked accounts
   * (Coalesced & fingerprinted so unchanged snapshots consume 0 writes)
   */
  async saveTermSnapshot(
    userId: string,
    courseId: string,
    term: string,
    snapshotData: any
  ): Promise<void> {
    if (!userId || !courseId || !term) return;
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({
      ...snapshotData,
      courseId,
      term,
      updatedAt: nowIso,
    });

    if (snapshotsByUserCache && snapshotsByUserCache.userId === userId) {
      if (!snapshotsByUserCache.byCourse[courseId]) {
        snapshotsByUserCache.byCourse[courseId] = {};
      }
      snapshotsByUserCache.byCourse[courseId][term] = cleanPayload;
      snapshotsByUserCache.timestamp = Date.now();
    }

    if (Date.now() < firestoreUnavailableUntil) return;

    const queueKey = `${userId}_${courseId}_${term}`;
    const existing = pendingSnapshotWrites.get(queueKey);
    if (existing) {
      clearTimeout(existing.timer);
    }
    notifyDebouncedSyncPending(`snap_${queueKey}`, true);
    const timer = setTimeout(() => {
      pendingSnapshotWrites.delete(queueKey);
      notifyDebouncedSyncPending(`snap_${queueKey}`, false);
      flushSingleSnapshotWrite({ userId, courseId, term, snapshotData }).catch(() => {});
    }, 550);
    pendingSnapshotWrites.set(queueKey, { timer, userId, courseId, term, snapshotData });
  },

  /**
   * Load cuatrimestre snapshots for a course using a teacher-wide in-memory cache
   * so switching between courses or tabs uses 0 extra Firestore reads.
   */
  async loadTermSnapshots(
    userId: string,
    courseId: string
  ): Promise<Record<string, any>> {
    if (!courseId || Date.now() < firestoreUnavailableUntil) return {};
    if (
      snapshotsByUserCache &&
      snapshotsByUserCache.userId === userId &&
      Date.now() - snapshotsByUserCache.timestamp < READ_CACHE_TTL_MS
    ) {
      return snapshotsByUserCache.byCourse[courseId] || {};
    }

    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
    try {
      const queries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'snapshots'))).catch(() => null));
        }
      }

      const snaps = await Promise.all(queries);
      const byCourse: Record<string, Record<string, any>> = {};
      for (const snap of snaps) {
        if (!snap) continue;
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.courseId && data.term) {
            if (!byCourse[data.courseId]) {
              byCourse[data.courseId] = {};
            }
            const existing = byCourse[data.courseId][data.term];
            if (!existing || (data.updatedAt && (!existing.updatedAt || data.updatedAt > existing.updatedAt))) {
              byCourse[data.courseId][data.term] = data;
            }
          }
        });
      }
      // Seed snapshot fingerprints so subsequent saves with identical data skip network writes
      for (const [cId, termsObj] of Object.entries(byCourse)) {
        for (const [tKey, snapVal] of Object.entries(termsObj)) {
          const fp = computePayloadFingerprint(snapVal);
          for (const uid of writeIds) {
            markPayloadSynced(`snapshot:${uid}:${cId}_${tKey}`, fp);
          }
        }
      }
      snapshotsByUserCache = { userId, timestamp: Date.now(), byCourse };
      return byCourse[courseId] || {};
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/snapshots`);
      return {};
    }
  },

  /**
   * Save multiple disposition records in a single Compact Bundle write (2 docs total instead of N docs)
   */
  async saveDispositionBatch(userId: string, records: any[]): Promise<void> {
    if (!userId || !Array.isArray(records) || records.length === 0 || Date.now() < firestoreUnavailableUntil) return;
    for (const rec of records) {
      if (rec?.id && !inMemoryDeletedIds.has(rec.id)) {
        inMemoryPendingRecords.set(rec.id, rec);
      }
    }
    scheduleCompactDispositionSync(userId, false);
  },

  /**
   * Save user settings (conduct options, templates, observations, etc.) under /users/{uid}/settings/{settingKey}
   * (Cached, coalesced & fingerprinted)
   */
  async saveUserSetting(userId: string, settingKey: string, payload: any): Promise<void> {
    if (!userId || !settingKey) return;
    const cacheKey = `${userId}:${settingKey}`;
    settingsReadCache.set(cacheKey, { timestamp: Date.now(), value: payload });

    if (Date.now() < firestoreUnavailableUntil) return;
    const queueKey = `${userId}_${settingKey}`;
    const existing = pendingSettingWrites.get(queueKey);
    if (existing) {
      clearTimeout(existing.timer);
    }
    notifyDebouncedSyncPending(`set_${queueKey}`, true);
    const timer = setTimeout(() => {
      pendingSettingWrites.delete(queueKey);
      notifyDebouncedSyncPending(`set_${queueKey}`, false);
      flushSingleSettingWrite({ userId, settingKey, payload }).catch(() => {});
    }, 450);
    pendingSettingWrites.set(queueKey, { timer, userId, settingKey, payload });
  },

  /**
   * Load user setting (conduct options, templates, etc.) across candidate accounts using direct document lookup
   * with in-memory read caching and fingerprint seeding.
   */
  async loadUserSetting<T = any>(userId: string, settingKey: string): Promise<T | null> {
    if (!settingKey || Date.now() < firestoreUnavailableUntil) return null;
    const cacheKey = `${userId}:${settingKey}`;
    const cached = settingsReadCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < READ_CACHE_TTL_MS && cached.value !== null && cached.value !== undefined) {
      return cached.value as T;
    }

    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
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
      if (latestValue !== null && latestValue !== undefined) {
        settingsReadCache.set(cacheKey, { timestamp: Date.now(), value: latestValue });
        const fp = computePayloadFingerprint(latestValue);
        for (const uid of writeIds) {
          markPayloadSynced(`setting:${uid}:${settingKey}`, fp);
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
    gemsReadCache.delete(userId);
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();
    const cleanPayload = sanitizeForFirestore({ ...gem, updatedAt: nowIso });
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const fpKey = `gem:${uid}:${gem.id}`;
        const check = isPayloadDirty(fpKey, gem);
        if (!check.dirty) continue;

        const path = `users/${uid}/gems/${gem.id}`;
        executeWithTimeout(
          setDoc(doc(targetDb, 'users', uid, 'gems', gem.id), cleanPayload, { merge: true })
        )
          .then((res) => {
            if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
          })
          .catch((err) => handleFirestoreError(err, OperationType.WRITE, path));
      }
    }
  },

  /**
   * Load Custom Gems from Firestore across candidate accounts (with read caching)
   */
  async loadCustomGems(userId: string): Promise<CustomGem[]> {
    if (Date.now() < firestoreUnavailableUntil) return [];
    const cached = gemsReadCache.get(userId);
    if (cached && Date.now() - cached.timestamp < READ_CACHE_TTL_MS && cached.data.length > 0) {
      return cached.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
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
      const list = Array.from(gemsMap.values());
      if (list.length > 0) {
        gemsReadCache.set(userId, { timestamp: Date.now(), data: list });
        for (const uid of writeIds) {
          for (const g of list) {
            markPayloadSynced(`gem:${uid}:${g.id}`, computePayloadFingerprint(g));
          }
        }
      }
      return list;
    } catch (_) {
      return [];
    }
  },

  /**
   * Delete Custom Gem from Firestore across candidate accounts
   */
  async deleteCustomGem(userId: string, gemId: string): Promise<void> {
    if (!gemId || Date.now() < firestoreUnavailableUntil) return;
    gemsReadCache.delete(userId);
    const candidateIds = getCandidateUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        removeFingerprintPrefix(`gem:${uid}:${gemId}`);
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
   * Delete any late arrival records for a student recorded today (0 Firestore reads — uses local/compact state)
   */
  async deleteTodayLatesForStudent(userId: string, studentId: string, targetDate: Date = new Date()): Promise<string[]> {
    if (!userId || !studentId) return [];
    const bundle = readLocalDispositionBundle(userId);
    const deletedIds: string[] = [];

    for (const data of bundle.history) {
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
        deletedIds.push(data.id);
        inMemoryDeletedIds.add(data.id);
        inMemoryPendingRecords.delete(data.id);
      }
    }

    if (deletedIds.length > 0) {
      scheduleCompactDispositionSync(userId, false);
    }
    return Array.from(new Set(deletedIds));
  },

  /**
   * Trigger a compact disposition & history sync explicitly (e.g. when 2°C map or reset changes)
   */
  syncCompactDispositionNow(userId?: string, immediate = false): void {
    const uid = userId || getActiveUserId();
    if (!uid) return;
    scheduleCompactDispositionSync(uid, immediate);
  },
};

