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
  writeBatch,
} from 'firebase/firestore';
import { isSameCalendarDay } from '../../utils/dateUtils';
import {
  ALL_DBS,
  FIRESTORE_TIMEOUT_MS,
  READ_CACHE_TTL_MS,
  OperationType,
  isFirestoreAvailable,
  executeWithTimeout,
  handleFirestoreError,
  getActiveUserId,
  getCandidateUserIds,
  getTargetWriteUserIds,
  getDeletedHistoryIdsSet,
  isPrimaryOwnerAccount,
  sanitizeForFirestore,
  computePayloadFingerprint,
  isPayloadDirty,
  markPayloadSynced,
  notifyDebouncedSyncPending,
  registerCloudFlushHandler,
} from './firestoreClient';

const COMPACT_SUMMARY_DOC_ID = 'disposition_summary_v2';
const COMPACT_HISTORY_DOC_ID = 'disposition_history_v2';
const COMPACT_SYNC_KEY = 'disposition_compact_bundle';

let dispositionReadCache: {
  userId: string;
  timestamp: number;
  data: { disposition: Record<string, any>; disposition2c?: Record<string, any>; history: any[] };
} | null = null;

let compactSyncTimer: any = null;
let pendingCompactUserId: string | null = null;
const inMemoryPendingRecords = new Map<string, any>();
const inMemoryDeletedIds = new Set<string>();

const pendingAttendanceWrites = new Map<
  string,
  { timer: any; userId: string; courseId: string; date: string; records: { studentId: string; status: string }[] }
>();

export function invalidateDispositionCaches(): void {
  dispositionReadCache = null;
  inMemoryPendingRecords.clear();
  inMemoryDeletedIds.clear();
  pendingCompactUserId = null;
}

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
  if (!userId || !isFirestoreAvailable()) {
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
  if (!userId || !isFirestoreAvailable()) return;
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

async function flushSingleAttendanceWrite(entry: {
  userId: string;
  courseId: string;
  date: string;
  records: { studentId: string; status: string }[];
}): Promise<void> {
  const { userId, courseId, date, records } = entry;
  if (!userId || !courseId || !date || !isFirestoreAvailable()) return;
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

registerCloudFlushHandler('attendance_and_disposition_flush', () => {
  if (compactSyncTimer && pendingCompactUserId) {
    flushCompactDispositionToCloud(pendingCompactUserId).catch(() => {});
  }
  pendingAttendanceWrites.forEach((entry, key) => {
    clearTimeout(entry.timer);
    pendingAttendanceWrites.delete(key);
    notifyDebouncedSyncPending(`att_${key}`, false);
    flushSingleAttendanceWrite(entry).catch(() => {});
  });
});

export const attendanceAndHistoryRepo = {
  /**
   * Save attendance records for a course and date globally (coalesced & fingerprinted)
   */
  async saveAttendance(
    userId: string,
    courseId: string,
    date: string,
    records: { studentId: string; status: string }[]
  ): Promise<void> {
    if (!userId || !courseId || !date || !isFirestoreAvailable()) return;
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
   * Save a student disposition / absence incident globally via the Compact Coalesced Engine
   */
  async saveDisposition(userId: string, record: any): Promise<void> {
    if (!userId || !record?.id || !isFirestoreAvailable()) return;
    inMemoryPendingRecords.set(record.id, {
      ...record,
      updatedAt: new Date().toISOString(),
    });
    inMemoryDeletedIds.delete(record.id);
    scheduleCompactDispositionSync(userId, false);
  },

  /**
   * Save multiple disposition records in a single Compact Bundle write
   */
  async saveDispositionBatch(userId: string, records: any[]): Promise<void> {
    if (!userId || !Array.isArray(records) || records.length === 0 || !isFirestoreAvailable()) return;
    for (const rec of records) {
      if (rec?.id && !inMemoryDeletedIds.has(rec.id)) {
        inMemoryPendingRecords.set(rec.id, rec);
      }
    }
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
   * Delete any absence records for a student recorded today
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
   * Delete any late arrival records for a student recorded today
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
   * Delete disposition documents for a single student
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
   * Delete disposition documents for an entire course
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
   * Load disposition summary (1°C + 2°C) and history from Firestore using Compact v2 Documents
   */
  async loadDisposition(
    userId: string
  ): Promise<{ disposition: Record<string, any>; disposition2c?: Record<string, any>; history: any[] }> {
    if (!isFirestoreAvailable()) {
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
   * Trigger a compact disposition & history sync explicitly
   */
  syncCompactDispositionNow(userId?: string, immediate = false): void {
    const uid = userId || getActiveUserId();
    if (!uid) return;
    scheduleCompactDispositionSync(uid, immediate);
  },
};
