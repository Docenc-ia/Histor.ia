/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified Synchronization Coordinator (`syncCoordinator`).
 * Orchestrates Firebase Firestore debounced writes, the Offline Sync Queue,
 * and the Google Sheets Sync Queue from a single architectural boundary.
 */

import { Course, Student } from '../types';
import {
  firestoreSync,
  getActiveUserId,
  flushAllPendingCloudSaves,
  subscribeToCloudSyncStatus,
  getCloudSyncStatus,
  CloudSyncStatusInfo,
} from './firestoreSync';
import { flushOfflineSyncQueue, getOfflineSyncQueue } from './offlineSyncQueue';
import { sheetsSyncQueue } from './workspace/sheetsSyncQueue';
import { api } from './api';
import { storageGateway } from './storageGateway';
import { emitAppEvent } from '../utils/appEventBus';

class UnifiedSyncCoordinator {
  private isResyncing = false;

  /**
   * Immediately flushes all pending debounced writes across Firestore and Google Sheets,
   * and triggers the offline sync queue processor if online.
   */
  public flushAll(): void {
    try {
      flushAllPendingCloudSaves();
    } catch (_) {}

    try {
      sheetsSyncQueue.flushAllPending();
    } catch (_) {}

    try {
      emitAppEvent('docencia_trigger_queue_flush', undefined, 0);
    } catch (_) {}
  }

  /**
   * Performs a full manual resynchronization of courses, students, observations,
   * and pending offline queue items to Firebase Firestore.
   */
  public async resyncAllToCloud(options?: {
    courses?: Course[];
    students?: Student[];
    onRefreshData?: () => Promise<void>;
  }): Promise<void> {
    if (this.isResyncing) return;
    this.isResyncing = true;

    try {
      this.flushAll();

      const uid = getActiveUserId();
      const localCourses =
        options?.courses && options.courses.length > 0
          ? options.courses
          : api.getLocalCourses();
      const localStudents =
        options?.students && options.students.length > 0
          ? options.students
          : api.getLocalStudents();

      if (uid && localCourses.length > 0) {
        await firestoreSync.saveCourses(uid, localCourses);
      }

      if (uid && localStudents.length > 0) {
        const byCourse = new Map<string, Student[]>();
        localStudents.forEach((s) => {
          if (!s.courseId) return;
          const list = byCourse.get(s.courseId) || [];
          list.push(s);
          byCourse.set(s.courseId, list);
        });
        for (const [cid, list] of byCourse.entries()) {
          await firestoreSync.saveStudents(uid, cid, list);
        }
      }

      if (uid) {
        try {
          const obsMap = storageGateway.getStudentObservationsMap();
          if (obsMap && typeof obsMap === 'object' && Object.keys(obsMap).length > 0) {
            await firestoreSync.saveStudentObservationsMap(uid, obsMap);
          }
        } catch (_) {}
      }

      // Process any remaining items in the offline queue
      if (getOfflineSyncQueue().length > 0) {
        await flushOfflineSyncQueue(async (action) => {
          if (!uid) return false;
          if (action.type === 'generic_setting' && action.payload?.key) {
            await firestoreSync.saveUserSetting(uid, action.payload.key, action.payload.value);
            return true;
          }
          return true;
        });
      }

      if (options?.onRefreshData) {
        await options.onRefreshData();
      } else {
        await Promise.all([api.getCourses(), api.getStudents()]);
      }

      emitAppEvent('docencia_student_status_updated');
    } finally {
      this.isResyncing = false;
    }
  }

  public subscribeStatus(listener: (status: CloudSyncStatusInfo) => void): () => void {
    return subscribeToCloudSyncStatus(listener);
  }

  public getStatus(): CloudSyncStatusInfo {
    return getCloudSyncStatus();
  }
}

export const syncCoordinator = new UnifiedSyncCoordinator();
