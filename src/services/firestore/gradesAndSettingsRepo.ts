/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { CustomGem } from '../../types';
import {
  ALL_DBS,
  FIRESTORE_TIMEOUT_MS,
  READ_CACHE_TTL_MS,
  OperationType,
  isFirestoreAvailable,
  executeWithTimeout,
  handleFirestoreError,
  getCandidateUserIds,
  getTargetWriteUserIds,
  isPrimaryOwnerAccount,
  sanitizeForFirestore,
  computePayloadFingerprint,
  isPayloadDirty,
  markPayloadSynced,
  removeFingerprintPrefix,
  notifyDebouncedSyncPending,
  registerCloudFlushHandler,
} from './firestoreClient';

let snapshotsByUserCache: {
  userId: string;
  timestamp: number;
  byCourse: Record<string, Record<string, any>>;
} | null = null;
const settingsReadCache = new Map<string, { timestamp: number; value: any }>();
const gemsReadCache = new Map<string, { timestamp: number; data: CustomGem[] }>();

const pendingSnapshotWrites = new Map<
  string,
  { timer: any; userId: string; courseId: string; term: string; snapshotData: any }
>();
const pendingSettingWrites = new Map<
  string,
  { timer: any; userId: string; settingKey: string; payload: any }
>();

export function invalidateGradesAndSettingsCaches(): void {
  snapshotsByUserCache = null;
  settingsReadCache.clear();
  gemsReadCache.clear();
}

async function flushSingleSnapshotWrite(entry: {
  userId: string;
  courseId: string;
  term: string;
  snapshotData: any;
}): Promise<void> {
  const { userId, courseId, term, snapshotData } = entry;
  if (!userId || !courseId || !term || !isFirestoreAvailable()) return;
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
  if (!userId || !settingKey || !isFirestoreAvailable()) return;
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

registerCloudFlushHandler('snapshots_and_settings_flush', () => {
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

export const gradesAndSettingsRepo = {
  /**
   * Save a cuatrimestre gradebook or libro de temas snapshot globally across linked accounts
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

    if (!isFirestoreAvailable()) return;

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
   */
  async loadTermSnapshots(
    userId: string,
    courseId: string
  ): Promise<Record<string, any>> {
    if (!courseId || !isFirestoreAvailable()) return {};
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
   * Save user settings (conduct options, templates, observations, etc.) under /users/{uid}/settings/{settingKey}
   */
  async saveUserSetting(userId: string, settingKey: string, payload: any): Promise<void> {
    if (!userId || !settingKey) return;
    const cacheKey = `${userId}:${settingKey}`;
    settingsReadCache.set(cacheKey, { timestamp: Date.now(), value: payload });

    if (!isFirestoreAvailable()) return;
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
   * Load user setting across candidate accounts using direct document lookup
   */
  async loadUserSetting<T = any>(userId: string, settingKey: string): Promise<T | null> {
    if (!settingKey || !isFirestoreAvailable()) return null;
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
    if (!userId || !gem?.id || !isFirestoreAvailable()) return;
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
   * Load Custom Gems from Firestore across candidate accounts
   */
  async loadCustomGems(userId: string): Promise<CustomGem[]> {
    if (!isFirestoreAvailable()) return [];
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
    if (!gemId || !isFirestoreAvailable()) return;
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
};
