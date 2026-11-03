/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { collection, onSnapshot, Unsubscribe } from 'firebase/firestore';
import {
  OperationType,
  FirestoreErrorInfo,
  CloudSyncState,
  CloudSyncStatusInfo,
  db,
  defaultDb,
  GLOBAL_WORKSPACE_ID,
  isFirestoreAvailable,
  isFirestoreQuotaError,
  handleFirestoreError,
  registerCloudFlushHandler,
  notifyDebouncedSyncPending,
  flushAllPendingCloudSaves,
  subscribeToCloudSyncStatus,
  getCloudSyncStatus,
  testFirestoreConnection,
  getActiveUserEmail,
  isPrimaryOwnerAccount,
  getActiveUserId,
  getCandidateUserIds,
  clearFingerprints,
  resetCachedStoredProfile,
  emitSyncStatus,
} from './firestore/firestoreClient';
import {
  coursesAndStudentsRepo,
  invalidateCoursesAndStudentsCaches,
} from './firestore/coursesAndStudentsRepo';
import {
  attendanceAndHistoryRepo,
  invalidateDispositionCaches,
} from './firestore/attendanceAndHistoryRepo';
import {
  gradesAndSettingsRepo,
  invalidateGradesAndSettingsCaches,
} from './firestore/gradesAndSettingsRepo';
import { emitAppEvent } from '../utils/appEventBus';

export {
  OperationType,
  db,
  defaultDb,
  GLOBAL_WORKSPACE_ID,
  isFirestoreQuotaError,
  handleFirestoreError,
  registerCloudFlushHandler,
  notifyDebouncedSyncPending,
  flushAllPendingCloudSaves,
  subscribeToCloudSyncStatus,
  getCloudSyncStatus,
  testFirestoreConnection,
  getActiveUserEmail,
  isPrimaryOwnerAccount,
  getActiveUserId,
  getCandidateUserIds,
};

export type { FirestoreErrorInfo, CloudSyncState, CloudSyncStatusInfo };

export function invalidateReadCachesForCrossDeviceSync(): void {
  invalidateCoursesAndStudentsCaches();
  invalidateDispositionCaches();
  invalidateGradesAndSettingsCaches();
}

export function clearFirestoreMemoryCaches(): void {
  try {
    flushAllPendingCloudSaves();
  } catch (_) {}
  invalidateReadCachesForCrossDeviceSync();
  clearFingerprints();
  resetCachedStoredProfile();
}

/**
 * Starts real-time cross-device synchronization (PC <-> Mobile) using Firestore onSnapshot
 * on the active workspace's settings and snapshots collections while the tab is visible,
 * plus automatic re-hydration on window focus / visibility restore.
 */
export function startLiveCloudWorkspaceSync(
  onRemoteUpdate?: (info: { scope: 'settings' | 'snapshots' | 'focus'; changedDocIds: string[] }) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  let unsubSettings: Unsubscribe | null = null;
  let unsubSnapshots: Unsubscribe | null = null;
  let lastFocusSyncAt = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const detachListeners = () => {
    if (unsubSettings) {
      try {
        unsubSettings();
      } catch (_) {}
      unsubSettings = null;
    }
    if (unsubSnapshots) {
      try {
        unsubSnapshots();
      } catch (_) {}
      unsubSnapshots = null;
    }
  };

  const triggerRemoteSync = (scope: 'settings' | 'snapshots' | 'focus', changedDocIds: string[]) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      invalidateReadCachesForCrossDeviceSync();
      emitSyncStatus({
        state: 'synced',
        lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      emitAppEvent('docencia_cloud_live_sync', { scope, changedDocIds });
      if (onRemoteUpdate) {
        onRemoteUpdate({ scope, changedDocIds });
      }
    }, 250);
  };

  const attachListeners = () => {
    detachListeners();
    if (!isFirestoreAvailable()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    const uid = getActiveUserId();
    if (!uid) return;

    let initialSettingsSkipped = false;
    let initialSnapshotsSkipped = false;

    const settingsPath = `users/${uid}/settings`;
    try {
      unsubSettings = onSnapshot(
        collection(db, 'users', uid, 'settings'),
        (snap) => {
          if (!initialSettingsSkipped) {
            initialSettingsSkipped = true;
            return;
          }
          if (snap.metadata.hasPendingWrites) return;
          const changedIds = snap
            .docChanges()
            .filter((ch) => !ch.doc.metadata.hasPendingWrites)
            .map((ch) => ch.doc.id);
          if (changedIds.length > 0) {
            triggerRemoteSync('settings', changedIds);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, settingsPath);
        }
      );
    } catch (_) {}

    const snapshotsPath = `users/${uid}/snapshots`;
    try {
      unsubSnapshots = onSnapshot(
        collection(db, 'users', uid, 'snapshots'),
        (snap) => {
          if (!initialSnapshotsSkipped) {
            initialSnapshotsSkipped = true;
            return;
          }
          if (snap.metadata.hasPendingWrites) return;
          const changedIds = snap
            .docChanges()
            .filter((ch) => !ch.doc.metadata.hasPendingWrites)
            .map((ch) => ch.doc.id);
          if (changedIds.length > 0) {
            triggerRemoteSync('snapshots', changedIds);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, snapshotsPath);
        }
      );
    } catch (_) {}
  };

  const handleVisibilityOrFocus = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      detachListeners();
      return;
    }
    if (!unsubSettings && !unsubSnapshots) {
      attachListeners();
    }
    const now = Date.now();
    if (now - lastFocusSyncAt > 4000) {
      lastFocusSyncAt = now;
      triggerRemoteSync('focus', []);
    }
  };

  attachListeners();
  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    detachListeners();
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
  };
}

export const firestoreSync = {
  clearMemoryCaches: clearFirestoreMemoryCaches,
  clearCaches: clearFirestoreMemoryCaches,
  invalidateReadCaches: invalidateReadCachesForCrossDeviceSync,
  startLiveCloudWorkspaceSync,
  ...coursesAndStudentsRepo,
  ...attendanceAndHistoryRepo,
  ...gradesAndSettingsRepo,
};

