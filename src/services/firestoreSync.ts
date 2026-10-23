/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OperationType,
  FirestoreErrorInfo,
  CloudSyncState,
  CloudSyncStatusInfo,
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
  clearFingerprints,
  resetCachedStoredProfile,
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

export function clearFirestoreMemoryCaches(): void {
  try {
    flushAllPendingCloudSaves();
  } catch (_) {}
  invalidateCoursesAndStudentsCaches();
  invalidateDispositionCaches();
  invalidateGradesAndSettingsCaches();
  clearFingerprints();
  resetCachedStoredProfile();
}

export const firestoreSync = {
  clearMemoryCaches: clearFirestoreMemoryCaches,
  clearCaches: clearFirestoreMemoryCaches,
  ...coursesAndStudentsRepo,
  ...attendanceAndHistoryRepo,
  ...gradesAndSettingsRepo,
};
