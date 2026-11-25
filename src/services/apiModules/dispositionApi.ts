/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Student Disposition, Absences & Notification History API client module.
 */

import { firestoreSync, getActiveUserId } from '../firestoreSync';
import { isSameCalendarDay } from '../../utils/dateUtils';
import { computeQuickStudentAttendanceRate } from '../../utils/attendanceCalculations';
import { hasHistoryNotificationDrift, mergeHistoryLists } from '../../utils/historyMerge';
import {
  getAllDispositionStorage,
  getDeletedHistoryIds,
  getLocalCourses,
  getLocalDisposition2c,
  getLocalStudents,
  getUserScopedItem,
  markHistoryIdDeleted,
  saveAllDispositionStorage,
  saveLocalDisposition2c,
  saveLocalStudents,
  setUserScopedItem,
} from '../storageHelpers';
import { canUseExpressBackend, fetchExpressJson } from './expressTransport';

export const dispositionApi = {
  async getDisposition(courseId?: string, studentId?: string): Promise<{
    disposition: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
    disposition2c?: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
    history: any[];
  }> {
    const local = getAllDispositionStorage();
    const local2c = getLocalDisposition2c();
    const userId = getActiveUserId();
    const deleted = getDeletedHistoryIds();

    if (userId) {
      try {
        const cloud = await firestoreSync.loadDisposition(userId);
        const cleanCloudHistory = (cloud.history || []).filter((h: any) => h?.id && !deleted.has(h.id));
        const cloudIds = new Set(cleanCloudHistory.map((h: any) => h.id));
        const hasUnsyncedLocalItems = local.history.some(
          (lh: any) => lh?.id && !deleted.has(lh.id) && !cloudIds.has(lh.id)
        );

        if (
          cleanCloudHistory.length > 0 ||
          Object.keys(cloud.disposition || {}).length > 0 ||
          Object.keys(cloud.disposition2c || {}).length > 0
        ) {
          const mergedHistory = mergeHistoryLists(cleanCloudHistory, local.history, deleted);
          const mergedDisp = { ...local.disposition, ...(cloud.disposition || {}) };
          const mergedDisp2c = { ...local2c, ...(cloud.disposition2c || {}) };

          saveAllDispositionStorage(mergedDisp, mergedHistory, { silent: true });
          if (Object.keys(mergedDisp2c).length > 0) {
            saveLocalDisposition2c(mergedDisp2c);
          }

          if (hasUnsyncedLocalItems || hasHistoryNotificationDrift(cleanCloudHistory, mergedHistory)) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }

          return { disposition: mergedDisp, disposition2c: mergedDisp2c, history: mergedHistory };
        } else if (hasUnsyncedLocalItems || Object.keys(local.disposition).length > 0) {
          firestoreSync.syncCompactDispositionNow(userId, false);
        }
      } catch (err) {
        console.warn('Firestore loadDisposition warning:', err);
      }
    }

    if (canUseExpressBackend()) {
      const params = new URLSearchParams();
      if (courseId) params.append('courseId', courseId);
      if (studentId) params.append('studentId', studentId);
      const serverData = await fetchExpressJson<{ history?: any[]; disposition?: Record<string, any> }>(
        `/api/disposition?${params.toString()}`
      );
      if (serverData?.history || serverData?.disposition) {
        const cleanServerHistory = (serverData.history || []).filter((h: any) => h?.id && !deleted.has(h.id));
        const mergedHistory = mergeHistoryLists(local.history, cleanServerHistory, deleted);
        const mergedDisp = { ...(serverData.disposition || {}), ...local.disposition };
        saveAllDispositionStorage(mergedDisp, mergedHistory, { silent: true });
        return { disposition: mergedDisp, disposition2c: local2c, history: mergedHistory };
      }
    }

    return { disposition: local.disposition, disposition2c: local2c, history: local.history } as any;
  },

  async recordDisposition(data: {
    id?: string;
    studentId: string;
    studentName: string;
    courseId: string;
    action: string;
    category: 'Ausencia' | 'Disposición' | 'Llegada tarde' | 'Asistencia' | 'Calificación' | 'Sistema';
    term?: '1c' | '2c';
    detail?: string;
    date?: string;
    time?: string;
    timestamp?: number;
    messageSent?: boolean;
    messageText?: string;
    notificationMethod?: 'classroom' | 'gmail' | 'whatsapp' | 'none' | 'omitted';
    omitNotification?: boolean;
    notifiedAt?: string;
    updatedAt?: string;
    pointsChange?: number;
    expectedSummary?: { totalAbsences: number; totalLates?: number; totalDisposition: number };
  }): Promise<{
    success: boolean;
    record: any;
    summary: { totalAbsences: number; totalDisposition: number };
    allDisposition: Record<string, { totalAbsences: number; totalDisposition: number }>;
  }> {
    const is2c = data.term === '2c';
    const local = getAllDispositionStorage();
    let history: any[] = [...local.history];

    let allDisposition1c: Record<string, any> = {};
    let allDisposition2c: Record<string, any> = {};

    if (typeof window !== 'undefined') {
      try {
        const raw1c = data.courseId ? getUserScopedItem(`fds_disposition_data_${data.courseId}_1c`) : null;
        if (raw1c) {
          allDisposition1c = JSON.parse(raw1c);
        } else if (data.courseId) {
          Object.entries(local.disposition || {}).forEach(([k, val]: [string, any]) => {
            if (!val || typeof val !== 'object') return;
            if (k.startsWith(`${data.courseId}::`)) {
              const cleanStudentId = k.slice(`${data.courseId}::`.length);
              allDisposition1c[cleanStudentId] = { ...val, courseId: data.courseId };
            } else if (!k.includes('::') && val.courseId === data.courseId) {
              allDisposition1c[k] = { ...val };
            }
          });
        } else {
          allDisposition1c = { ...local.disposition };
        }
        const raw2c = data.courseId
          ? getUserScopedItem(`fds_disposition_data_${data.courseId}_2c`)
          : getUserScopedItem('fds_disposition_data_2c');
        if (raw2c) {
          allDisposition2c = JSON.parse(raw2c);
        } else if (data.courseId) {
          const global2cRaw = getUserScopedItem('fds_disposition_data_2c');
          if (global2cRaw) {
            const parsedGlobal2c = JSON.parse(global2cRaw);
            Object.entries(parsedGlobal2c || {}).forEach(([k, val]: [string, any]) => {
              if (!val || typeof val !== 'object') return;
              if (k.startsWith(`${data.courseId}::`)) {
                const cleanStudentId = k.slice(`${data.courseId}::`.length);
                allDisposition2c[cleanStudentId] = { ...val, courseId: data.courseId };
              } else if (!k.includes('::') && val.courseId === data.courseId) {
                allDisposition2c[k] = { ...val };
              }
            });
          }
        }
      } catch (_) {}
    }

    const currentMap = is2c ? allDisposition2c : allDisposition1c;
    const current = (currentMap[data.studentId] as any) || {
      totalAbsences: 0,
      totalLates: 0,
      totalDisposition: 10,
    };
    if (current.totalDisposition === undefined) current.totalDisposition = 10;
    if (current.totalLates === undefined) current.totalLates = 0;
    if (current.totalAbsences === undefined) current.totalAbsences = 0;
    if (data.courseId) current.courseId = data.courseId;

    const userId = getActiveUserId();
    const recordId = data.id || `disp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const existingIndex = history.findIndex((h) => h.id === recordId);

    if (data.expectedSummary) {
      current.totalAbsences = data.expectedSummary.totalAbsences;
      if (data.expectedSummary.totalLates !== undefined) current.totalLates = data.expectedSummary.totalLates;
      current.totalDisposition = data.expectedSummary.totalDisposition;
    } else if (existingIndex === -1) {
      // Only apply delta if not already pre-applied
      if (data.category === 'Ausencia') {
        current.totalAbsences += 1;
      } else if (data.category === 'Llegada tarde') {
        current.totalLates = (current.totalLates || 0) + 1;

        // Si el mismo día tenía una falta previa registrada, eliminarla automáticamente (el alumno llegó a clase)
        const now = new Date();
        const isTodayAbsence = (h: any) => {
          if (h.studentId !== data.studentId) return false;
          if (data.courseId && h.courseId !== data.courseId) return false;
          const isAbs =
            h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta');
          if (!isAbs) return false;
          return isSameCalendarDay(h.date, h.timestamp, now) || !h.date;
        };

        const todayAbsences = history.filter(isTodayAbsence);
        if (todayAbsences.length > 0) {
          todayAbsences.forEach((a) => markHistoryIdDeleted(a.id));
          history = history.filter((h) => !isTodayAbsence(h));
          current.totalAbsences = Math.max(0, (current.totalAbsences || 0) - todayAbsences.length);
          if (userId) {
            todayAbsences.forEach((a) => {
              firestoreSync.deleteDisposition(userId, a.id).catch(() => {});
            });
          }
        }
        if (userId) {
          firestoreSync.deleteTodayAbsencesForStudent(userId, data.studentId, now, data.courseId).catch(() => {});
        }
      } else if (data.category === 'Disposición') {
        const delta = typeof data.pointsChange === 'number' ? data.pointsChange : -1;
        current.totalDisposition = Math.max(0, Math.min(10, current.totalDisposition + delta));
      }
    }

    if (is2c) {
      allDisposition2c[data.studentId] = current;
      if (typeof window !== 'undefined') {
        if (data.courseId) {
          setUserScopedItem(`fds_disposition_data_${data.courseId}_2c`, JSON.stringify(allDisposition2c));
        } else {
          setUserScopedItem('fds_disposition_data_2c', JSON.stringify(allDisposition2c));
        }
      }
    } else {
      allDisposition1c[data.studentId] = current;
      if (typeof window !== 'undefined' && data.courseId) {
        setUserScopedItem(`fds_disposition_data_${data.courseId}_1c`, JSON.stringify(allDisposition1c));
      }
    }

    const allDisposition = is2c ? allDisposition2c : allDisposition1c;

    const isNotificationResolution = Boolean(
      data.omitNotification ||
        data.messageSent ||
        data.notificationMethod === 'omitted' ||
        data.notifiedAt === 'No enviar' ||
        data.notifiedAt === 'Omitido'
    );

    const newRecord = {
      id: recordId,
      ...data,
      pointsChange:
        typeof data.pointsChange === 'number'
          ? data.pointsChange
          : data.category === 'Ausencia' || data.category === 'Llegada tarde'
          ? 0
          : data.category === 'Disposición'
          ? -1
          : 0,
      date: data.date || new Date().toISOString().split('T')[0],
      timestamp: data.timestamp || Date.now(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    if (existingIndex === -1) {
      history.unshift(newRecord);
    } else {
      history[existingIndex] = { ...history[existingIndex], ...newRecord };
    }

    // Persist immediately across storage
    if (is2c) {
      saveAllDispositionStorage(allDisposition1c, history, {
        silent: true,
        courseId: data.courseId,
        flushNow: isNotificationResolution,
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('docencia_disposition_storage_change', {
            detail: { term: '2c', courseId: data.courseId, disposition: allDisposition2c, history },
          })
        );
      }
    } else {
      saveAllDispositionStorage(allDisposition1c, history, {
        courseId: data.courseId,
        flushNow: isNotificationResolution,
      });
    }

    // Cascaded update of local student record strictly for this course
    try {
      const allLocalStudents = getLocalStudents();
      const stIdx = allLocalStudents.findIndex(
        (s) => s.id === data.studentId && (!data.courseId || s.courseId === data.courseId)
      );
      if (stIdx !== -1) {
        const studentCourseId = allLocalStudents[stIdx].courseId;
        const newAbs = allDisposition[data.studentId]?.totalAbsences || 0;
        const newLates = allDisposition[data.studentId]?.totalLates || 0;
        const courseObj = getLocalCourses().find((c) => c.id === studentCourseId);
        const newRate = computeQuickStudentAttendanceRate(
          data.studentId,
          studentCourseId,
          newAbs,
          newLates,
          courseObj?.schedule
        );
        allLocalStudents[stIdx] = {
          ...allLocalStudents[stIdx],
          attendanceRate: newRate,
        };
        saveLocalStudents(
          studentCourseId,
          allLocalStudents.filter((s) => s.courseId === studentCourseId)
        );
      }
      window.dispatchEvent(
        new CustomEvent('docencia_student_status_updated', {
          detail: {
            studentId: data.studentId,
            courseId: data.courseId,
            summary: current,
            disposition: allDisposition,
          },
        })
      );
    } catch (_) {}

    if (userId) {
      const targetToSave = existingIndex !== -1 ? history[existingIndex] : newRecord;
      firestoreSync
        .saveDisposition(userId, targetToSave, isNotificationResolution)
        .catch((e) => console.warn('Firestore saveDisposition warning:', e));
    }

    if (canUseExpressBackend()) {
      const serverRes = await fetchExpressJson('/api/disposition/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (serverRes) return serverRes;
    }

    return {
      success: true,
      record: newRecord,
      summary: current,
      allDisposition,
    };
  },

  async updateDispositionHistoryNotification(
    id: string,
    notificationData: {
      messageSent: boolean;
      messageText: string;
      notificationMethod: 'classroom' | 'gmail' | 'whatsapp' | 'none' | 'omitted';
      omitNotification?: boolean;
      notifiedAt?: string;
      updatedAt?: string;
    }
  ): Promise<{ success: boolean; record: any }> {
    const nowIso = notificationData.updatedAt || new Date().toISOString();
    const local = getAllDispositionStorage();
    const updatedHistory = local.history.map((item: any) => {
      if (item.id === id) {
        return {
          ...item,
          ...notificationData,
          updatedAt: nowIso,
        };
      }
      return item;
    });

    saveAllDispositionStorage(local.disposition, updatedHistory, { flushNow: true });

    const userId = getActiveUserId();
    const targetItem = updatedHistory.find((h: any) => h.id === id);
    if (userId && targetItem) {
      firestoreSync.saveDisposition(userId, targetItem, true).catch(() => {});
    }

    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{ success: boolean; record: any }>(
        `/api/disposition/history/${encodeURIComponent(id)}/notification`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notificationData),
        }
      );
      if (serverData) return serverData;
    }

    return { success: true, record: targetItem };
  },

  async deleteDispositionHistory(
    id: string,
    extra?: {
      studentId?: string;
      courseId?: string;
      term?: '1c' | '2c';
      isAbsence?: boolean;
      isLate?: boolean;
      pointsToReturn?: number;
      newAbsences?: number;
      newLates?: number;
      newDisposition?: number;
    }
  ): Promise<{ success: boolean; summary?: any; disposition?: Record<string, any> }> {
    // 1. Mark permanently in tombstone so it can never reappear
    markHistoryIdDeleted(id);

    // 2. Load unified storage
    const local = getAllDispositionStorage();
    const allDisposition: Record<string, any> = { ...local.disposition };
    const history = local.history.filter((h: any) => h.id !== id);

    let studentIdToDelete: string | null = extra?.studentId || null;
    const targetItem = local.history.find((h: any) => h.id === id);
    if (targetItem && !studentIdToDelete) {
      studentIdToDelete = targetItem.studentId;
    }
    const targetCourseId = extra?.courseId || targetItem?.courseId;
    const targetTerm: '1c' | '2c' = extra?.term || (targetItem?.term === '2c' ? '2c' : '1c');

    let perCourseMap: Record<string, any> = {};
    if (typeof window !== 'undefined' && targetCourseId) {
      try {
        const rawCourse = getUserScopedItem(`fds_disposition_data_${targetCourseId}_${targetTerm}`);
        if (rawCourse) perCourseMap = JSON.parse(rawCourse);
      } catch (_) {}
    }

    let currentSummary: any = null;
    if (studentIdToDelete) {
      const compositeKey = targetCourseId ? `${targetCourseId}::${studentIdToDelete}` : studentIdToDelete;
      const baseExisting =
        perCourseMap[studentIdToDelete] ||
        allDisposition[compositeKey] ||
        (!targetCourseId || allDisposition[studentIdToDelete]?.courseId === targetCourseId
          ? allDisposition[studentIdToDelete]
          : null);
      const current = baseExisting
        ? { ...baseExisting }
        : {
            totalAbsences: 0,
            totalLates: 0,
            totalDisposition: 10,
          };
      if (targetCourseId) current.courseId = targetCourseId;

      if (extra?.newDisposition !== undefined) {
        current.totalDisposition = extra.newDisposition;
      } else if (extra?.pointsToReturn !== undefined && extra.pointsToReturn > 0) {
        current.totalDisposition = Math.min(10, (current.totalDisposition ?? 10) + extra.pointsToReturn);
      } else if (
        targetItem?.category === 'Disposición' ||
        (targetItem?.pointsChange && targetItem.pointsChange < 0)
      ) {
        const pts = targetItem?.pointsChange ? Math.abs(targetItem.pointsChange) : 1;
        current.totalDisposition = Math.min(10, (current.totalDisposition ?? 10) + pts);
      }

      if (extra?.newAbsences !== undefined) {
        current.totalAbsences = extra.newAbsences;
      } else if (
        targetItem?.category === 'Ausencia' ||
        targetItem?.action === 'Ausencia' ||
        targetItem?.action?.toLowerCase().includes('ausencia') ||
        targetItem?.action?.toLowerCase().includes('falta')
      ) {
        current.totalAbsences = Math.max(0, (current.totalAbsences || 0) - 1);
      }

      if (extra?.newLates !== undefined) {
        current.totalLates = extra.newLates;
      } else if (
        targetItem?.category === 'Llegada tarde' ||
        targetItem?.action?.toLowerCase().includes('tarde') ||
        targetItem?.action?.toLowerCase().includes('tardanza')
      ) {
        current.totalLates = Math.max(0, (current.totalLates || 0) - 1);
      }

      perCourseMap[studentIdToDelete] = current;
      if (targetCourseId) {
        allDisposition[compositeKey] = current;
        if (typeof window !== 'undefined') {
          setUserScopedItem(`fds_disposition_data_${targetCourseId}_${targetTerm}`, JSON.stringify(perCourseMap));
        }
      } else {
        allDisposition[studentIdToDelete] = current;
      }
      currentSummary = current;
    }

    // 3. Save across all client storage keys
    saveAllDispositionStorage(allDisposition, history, { courseId: targetCourseId });

    // Cascaded update of local student record strictly for targetCourseId
    if (studentIdToDelete) {
      try {
        const allLocalStudents = getLocalStudents();
        const stIdx = allLocalStudents.findIndex(
          (s) => s.id === studentIdToDelete && (!targetCourseId || s.courseId === targetCourseId)
        );
        if (stIdx !== -1) {
          const studentCourseId = allLocalStudents[stIdx].courseId;
          const newAbs = currentSummary?.totalAbsences || 0;
          const newLates = currentSummary?.totalLates || 0;
          const courseObj = getLocalCourses().find((c) => c.id === studentCourseId);
          const newRate = computeQuickStudentAttendanceRate(
            studentIdToDelete,
            studentCourseId,
            newAbs,
            newLates,
            courseObj?.schedule
          );
          allLocalStudents[stIdx] = {
            ...allLocalStudents[stIdx],
            attendanceRate: newRate,
          };
          saveLocalStudents(
            studentCourseId,
            allLocalStudents.filter((s) => s.courseId === studentCourseId)
          );
        }
        window.dispatchEvent(
          new CustomEvent('docencia_student_status_updated', {
            detail: {
              studentId: studentIdToDelete,
              courseId: targetCourseId,
              summary: currentSummary,
              disposition: targetCourseId ? perCourseMap : allDisposition,
            },
          })
        );
      } catch (_) {}
    }

    // 4. Delete from Firestore
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.deleteDisposition(userId, id).catch((e) => console.warn('Firestore deleteDisposition error:', e));
    }

    // 5. Delete on backend if primary owner
    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{
        success: boolean;
        summary?: any;
        disposition?: Record<string, any>;
      }>(`/api/disposition/history/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extra || {}),
      });
      if (serverData) return serverData;
    }

    return {
      success: true,
      summary: currentSummary,
      disposition: targetCourseId ? perCourseMap : allDisposition,
    };
  },

  async resetDisposition(data: {
    studentId?: string;
    courseId?: string;
    term?: '1c' | '2c';
    resetWhat: 'disposition' | 'absences' | 'all';
    clearHistory?: boolean;
  }): Promise<{ success: boolean; disposition: Record<string, any>; history?: any[] }> {
    const targetTerm: '1c' | '2c' = data.term === '2c' ? '2c' : '1c';
    const local = getAllDispositionStorage();
    const map = { ...local.disposition };
    let history = [...local.history];

    let courseMap: Record<string, any> = {};
    if (typeof window !== 'undefined' && data.courseId) {
      try {
        const raw = getUserScopedItem(`fds_disposition_data_${data.courseId}_${targetTerm}`);
        if (raw) courseMap = JSON.parse(raw);
      } catch (_) {}
    }

    const applyResetToEntry = (entry: any) => {
      const next = entry ? { ...entry } : { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      if (data.courseId) next.courseId = data.courseId;
      if (data.resetWhat === 'disposition' || data.resetWhat === 'all' || !data.resetWhat) {
        next.totalDisposition = 10;
      }
      if (data.resetWhat === 'absences' || data.resetWhat === 'all') {
        next.totalAbsences = 0;
      }
      if (data.resetWhat === 'all') {
        next.totalLates = 0;
      }
      return next;
    };

    if (data.studentId) {
      if (data.courseId) {
        courseMap[data.studentId] = applyResetToEntry(courseMap[data.studentId]);
        map[`${data.courseId}::${data.studentId}`] = courseMap[data.studentId];
      } else {
        map[data.studentId] = applyResetToEntry(map[data.studentId]);
      }
    } else if (data.courseId) {
      const courseStudents = getLocalStudents(data.courseId);
      const targetStudentIds = new Set<string>([
        ...courseStudents.map((s) => s.id),
        ...Object.keys(courseMap),
      ]);
      targetStudentIds.forEach((sId) => {
        courseMap[sId] = applyResetToEntry(courseMap[sId]);
        map[`${data.courseId}::${sId}`] = courseMap[sId];
      });
    }

    if (typeof window !== 'undefined' && data.courseId) {
      setUserScopedItem(`fds_disposition_data_${data.courseId}_${targetTerm}`, JSON.stringify(courseMap));
    }

    if (data.clearHistory) {
      const removedIds: string[] = [];
      history = history.filter((h: any) => {
        const matchesStudent = data.studentId ? h.studentId === data.studentId : true;
        const matchesCourse = data.courseId ? h.courseId === data.courseId : true;
        const matchesTerm = data.term ? (h.term || '1c') === data.term : true;
        if (matchesStudent && matchesCourse && matchesTerm) {
          const isDisp =
            h.category === 'Disposición' ||
            (!h.category && h.action !== 'Ausencia' && h.action !== 'Llegada tarde') ||
            (h.pointsChange !== undefined && h.pointsChange < 0);
          const isAbs = h.category === 'Ausencia' || h.action === 'Ausencia';
          if (data.resetWhat === 'absences' && isAbs) {
            removedIds.push(h.id);
            return false;
          }
          if ((data.resetWhat === 'disposition' || !data.resetWhat) && isDisp) {
            removedIds.push(h.id);
            return false;
          }
          if (data.resetWhat === 'all') {
            removedIds.push(h.id);
            return false;
          }
        }
        return true;
      });
      removedIds.forEach((id) => markHistoryIdDeleted(id));
    }

    saveAllDispositionStorage(map, history, { courseId: data.courseId });

    const userId = getActiveUserId();
    if (userId) {
      if (data.studentId && !data.courseId) {
        firestoreSync.deleteStudentDispositionDocs(userId, data.studentId, data.clearHistory).catch(() => {});
      } else if (data.courseId && !data.studentId) {
        firestoreSync.deleteCourseDispositionDocs(userId, data.courseId, data.clearHistory).catch(() => {});
      } else {
        firestoreSync.syncCompactDispositionNow(userId, false);
      }
    }

    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{
        success: boolean;
        disposition: Record<string, any>;
        history?: any[];
      }>('/api/disposition/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (serverData) return serverData;
    }

    return {
      success: true,
      disposition: data.courseId ? courseMap : map,
      history,
    };
  },

  async syncFullDisposition(data: {
    disposition: Record<string, any>;
    history: any[];
    replaceHistory?: boolean;
  }): Promise<{ success: boolean; count: number; disposition?: Record<string, any>; history?: any[] }> {
    const deleted = getDeletedHistoryIds();
    const cleanHistory = (data?.history || []).filter((h) => h?.id && !deleted.has(h.id));
    if (data?.disposition || data?.history) {
      saveAllDispositionStorage(data.disposition || {}, cleanHistory);
    }

    const userId = getActiveUserId();
    if (userId && cleanHistory.length > 0) {
      firestoreSync.saveDispositionBatch(userId, cleanHistory).catch(() => {});
    }

    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{
        success: boolean;
        count: number;
        disposition?: Record<string, any>;
        history?: any[];
      }>('/api/disposition/sync-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (serverData) return serverData;
    }

    return {
      success: true,
      count: cleanHistory.length,
      disposition: data.disposition,
      history: cleanHistory,
    };
  },
};
