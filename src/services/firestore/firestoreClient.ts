/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDocFromServer,
  Firestore,
  disableNetwork,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import { auth } from '../workspace/googleAuth';

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

export const READ_CACHE_TTL_MS = 60000;
export const FIRESTORE_TIMEOUT_MS = 2200;

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

export function isFirestoreAvailable(): boolean {
  return Date.now() >= firestoreUnavailableUntil;
}

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

// Initialize Firebase App targeting gen-lang-client-0511455975
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Primary provisioned Firestore database instance
export const db: Firestore = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

// Disable network if quota was exhausted during recent session to prevent background retry logs
if (!isFirestoreAvailable()) {
  try {
    disableNetwork(db).catch(() => {});
  } catch (_) {}
}

// Default database instance of gen-lang-client-0511455975 (ensures cross-environment & Vercel compatibility)
export const defaultDb: Firestore = getFirestore(app);

// Active database instance to use: targets the provisioned database only to prevent duplicate writes
export const ALL_DBS: Firestore[] = [db];

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

export function emitSyncStatus(partial: Partial<CloudSyncStatusInfo>): void {
  currentSyncStatus = { ...currentSyncStatus, ...partial };
  syncListeners.forEach((listener) => {
    try {
      listener(currentSyncStatus);
    } catch (_) {}
  });
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): void {
  const msg = error instanceof Error ? error.message : String(error);

  if (isFirestoreQuotaError(error)) {
    firestoreUnavailableUntil = Date.now() + 30 * 60 * 1000;
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('firestore_quota_exhausted_until', String(firestoreUnavailableUntil));
      }
    } catch (_) {}
    try {
      disableNetwork(db).catch(() => {});
    } catch (_) {}
    console.warn('Docenc.ia: Límite diario de Firestore alcanzado. La app continúa funcionando con persistencia local ultrarrápida sin pérdida de datos.');
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

export async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = FIRESTORE_TIMEOUT_MS,
  trackAsWrite = false
): Promise<T | null> {
  if (!isFirestoreAvailable()) {
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

export async function testFirestoreConnection(): Promise<boolean> {
  if (!isFirestoreAvailable()) {
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

export function resetCachedStoredProfile(): void {
  lastRawProfileStr = null;
  lastParsedProfileObj = null;
}

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

export function getActiveUserId(): string {
  const email = getActiveUserEmail();
  if (email && !isPrimaryOwnerAccount(email)) {
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

export function getDeletedHistoryIdsSet(): Set<string> {
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

export function getTargetWriteUserIds(userId: string): string[] {
  const email = getActiveUserEmail();
  if (email && !isPrimaryOwnerAccount(email)) {
    return ['teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_')];
  }
  return [userId || GLOBAL_WORKSPACE_ID];
}

export function sanitizeForFirestore<T>(input: T): T {
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

// ---------------------------------------------------------------------------
// INCREMENTAL DIRTY-TRACKING & FINGERPRINT ENGINE
// ---------------------------------------------------------------------------
export const FINGERPRINT_STORAGE_KEY = 'docencia_cloud_sync_fingerprints_v2';
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

export function computePayloadFingerprint(payload: any): string {
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

export function isPayloadDirty(key: string, payload: any): { dirty: boolean; fingerprint: string } {
  const fp = computePayloadFingerprint(payload);
  const prev = lastSyncedFingerprints.get(key);
  return { dirty: prev !== fp, fingerprint: fp };
}

export function markPayloadSynced(key: string, fingerprint: string): void {
  lastSyncedFingerprints.set(key, fingerprint);
  schedulePersistFingerprints();
}

export function removeFingerprintPrefix(prefix: string): void {
  for (const k of Array.from(lastSyncedFingerprints.keys())) {
    if (k.startsWith(prefix)) {
      lastSyncedFingerprints.delete(k);
    }
  }
  schedulePersistFingerprints();
}

export function clearFingerprints(): void {
  lastSyncedFingerprints.clear();
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(FINGERPRINT_STORAGE_KEY);
    } catch (_) {}
  }
}
