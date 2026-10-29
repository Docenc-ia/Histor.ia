/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * School-Year Backup & Restore Service (`backupService`).
 * Extracts JSON/Excel serialization and cloud restoration logic out of Header.tsx.
 * Dynamically imports Excel export utilities only when requested by the teacher.
 */

import { Course, Student, TeacherProfile } from '../types';
import {
  api,
  saveLocalCourses,
  saveLocalStudents,
  saveAllDispositionStorage,
} from './api';
import {
  firestoreSync,
  getActiveUserId,
  isPrimaryOwnerAccount,
} from './firestoreSync';
import { storageGateway } from './storageGateway';
import { syncCoordinator } from './syncCoordinator';
import { safeSetLocalStorageItem } from '../utils/storageGuard';
import { emitAppEvent } from '../utils/appEventBus';

export interface FullBackupTeacherContext {
  user: TeacherProfile | null;
  courses?: Course[];
  students?: Student[];
}

export const backupService = {
  /**
   * Generates and triggers a browser download of the complete school-year JSON backup.
   */
  downloadFullBackupJson(ctx: FullBackupTeacherContext): void {
    syncCoordinator.flushAll();
    const uid = getActiveUserId();
    const courses =
      ctx.courses && ctx.courses.length > 0 ? ctx.courses : api.getLocalCourses();
    const students =
      ctx.students && ctx.students.length > 0 ? ctx.students : api.getLocalStudents();
    const dispStorage = api.getAllDispositionStorage();
    const disposition2c = storageGateway.getDisposition2cMap();
    const settingsAndGradesSnapshot = storageGateway.collectTeacherScopedSnapshot();

    const payload = {
      app: 'Docenc.ia - Respaldo Integral del Ciclo Lectivo',
      version: '3.2',
      exportedAt: new Date().toISOString(),
      formattedDate: new Date().toLocaleString('es-AR'),
      teacher: {
        uid: uid || '',
        name: ctx.user?.name || 'Docente',
        email: ctx.user?.email || '',
        school: ctx.user?.school || '',
      },
      courses,
      students,
      disposition: dispStorage.disposition,
      disposition2c,
      history: dispStorage.history,
      settingsAndGradesSnapshot,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `Respaldo_Completo_DocencIA_${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Dynamically loads the Excel exporter and downloads a unified school-year summary (.xlsx).
   */
  async downloadFullExcelSummary(ctx: FullBackupTeacherContext): Promise<void> {
    const courses =
      ctx.courses && ctx.courses.length > 0 ? ctx.courses : api.getLocalCourses();
    const students =
      ctx.students && ctx.students.length > 0 ? ctx.students : api.getLocalStudents();

    if (courses.length === 0) {
      throw new Error('No hay materias cargadas para exportar a Excel.');
    }

    const dispStorage = api.getAllDispositionStorage();
    const disp2c = storageGateway.getDisposition2cMap();

    const { exportCourseDispositionToExcel } = await import('../utils/excelExport');
    exportCourseDispositionToExcel(
      `Todas_Las_Materias_Ciclo_${new Date().getFullYear()}`,
      students,
      dispStorage.disposition || {},
      disp2c
    );
  },

  /**
   * Restores a complete JSON backup file into localStorage and syncs it to Firebase Firestore.
   */
  async restoreFullBackupFromJsonString(content: string): Promise<void> {
    const data = JSON.parse(content);
    if (
      !data ||
      typeof data !== 'object' ||
      (!data.courses && !data.settingsAndGradesSnapshot)
    ) {
      throw new Error('El archivo seleccionado no es un respaldo válido de Docenc.ia.');
    }

    const uid = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const oldUid = data?.teacher?.uid ? String(data.teacher.uid) : '';

    if (data.settingsAndGradesSnapshot && typeof data.settingsAndGradesSnapshot === 'object') {
      for (const [k, v] of Object.entries(data.settingsAndGradesSnapshot)) {
        if (k.startsWith('fds_') || k.startsWith('docencia_')) {
          let targetKey = k;
          if (uid) {
            if (oldUid && k.endsWith(`_${oldUid}`)) {
              targetKey = `${k.slice(0, -`_${oldUid}`.length)}_${uid}`;
            } else if (!k.endsWith(`_${uid}`)) {
              targetKey = `${k}_${uid}`;
            }
          }
          const serialized = typeof v === 'string' ? v : JSON.stringify(v);
          safeSetLocalStorageItem(targetKey, serialized);
          if (isOwner) {
            safeSetLocalStorageItem(k, serialized);
          }
          if (
            uid &&
            targetKey.startsWith('fds_libro_temas_2026_') &&
            v &&
            typeof v === 'object'
          ) {
            const basePart = targetKey
              .replace(`_${uid}`, '')
              .replace('fds_libro_temas_2026_', '');
            if (basePart) {
              firestoreSync
                .saveUserSetting(uid, `libro_temas_${basePart}`, v)
                .catch(() => {});
            }
          }
        }
      }
    }

    if (Array.isArray(data.courses) && data.courses.length > 0) {
      saveLocalCourses(data.courses);
      if (uid) await firestoreSync.saveCourses(uid, data.courses);
    }

    if (Array.isArray(data.students) && data.students.length > 0) {
      saveLocalStudents(data.students);
      if (uid) {
        const byCourse = new Map<string, Student[]>();
        data.students.forEach((st: Student) => {
          if (!st.courseId) return;
          const arr = byCourse.get(st.courseId) || [];
          arr.push(st);
          byCourse.set(st.courseId, arr);
        });
        for (const [cid, list] of byCourse.entries()) {
          await firestoreSync.saveStudents(uid, cid, list);
        }
      }
    }

    if (data.disposition2c && typeof data.disposition2c === 'object') {
      storageGateway.setScopedJson('fds_disposition_data_2c', data.disposition2c);
      if (uid) {
        await firestoreSync.saveUserSetting(uid, 'disposition_map_2c', data.disposition2c);
      }
    }

    if (data.disposition || data.history) {
      saveAllDispositionStorage(data.disposition || {}, data.history || []);
      if (uid && Array.isArray(data.history) && data.history.length > 0) {
        await firestoreSync.saveDispositionBatch(uid, data.history);
      }
    }

    emitAppEvent('docencia_student_status_updated');
    emitAppEvent('docencia_disposition_storage_change');
  },
};
