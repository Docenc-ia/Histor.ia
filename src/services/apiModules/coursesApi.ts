/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Courses CRUD & Classroom synchronization API client module.
 */

import { Course } from '../../types';
import { firestoreSync, getActiveUserId } from '../firestoreSync';
import {
  areCoursesSame,
  deduplicateCourses,
  getLocalCourses,
  saveLocalCourses,
} from '../storageHelpers';
import { canUseExpressBackend, fetchExpressJson } from './expressTransport';

export const coursesApi = {
  async getCourses(): Promise<Course[]> {
    const userId = getActiveUserId();

    // 1. Immediately get deduplicated local courses
    const local = deduplicateCourses(getLocalCourses());

    // 2. Fetch server courses (only for primary owner when Express backend is active) and cloud Firestore courses in parallel
    const serverPromise = canUseExpressBackend()
      ? fetchExpressJson<{ courses: Course[] }>('/api/courses').then((data) =>
          data && Array.isArray(data.courses) ? data.courses : []
        )
      : Promise.resolve([] as Course[]);

    const cloudPromise = userId
      ? firestoreSync.loadCourses(userId).catch((err) => {
          console.warn('Firestore loadCourses failed:', err);
          return [] as Course[];
        })
      : Promise.resolve([] as Course[]);

    const [serverCourses, cloudCourses] = await Promise.all([serverPromise, cloudPromise]);

    // Merge server, local, and cloud (Firestore) courses so fresh cloud syncs across devices update stale local entries
    const mergedList = deduplicateCourses([...serverCourses, ...local, ...cloudCourses]);

    if (mergedList.length > 0) {
      saveLocalCourses(mergedList);
      return mergedList;
    }

    return [];
  },

  async createCourse(courseData: Partial<Course>): Promise<Course> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ course: Course }>('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(courseData),
      });
      if (data?.course) {
        const list = deduplicateCourses([...getLocalCourses(), data.course]);
        saveLocalCourses(list);
        const userId = getActiveUserId();
        if (userId) await firestoreSync.saveCourses(userId, list).catch(() => {});
        return data.course;
      }
    }

    const newCourse: Course = {
      id:
        courseData.classroomCourseId ||
        courseData.id ||
        `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`,
      name: courseData.name || 'Nueva Materia',
      subject: courseData.subject || courseData.name || 'Materia',
      grade: courseData.grade || 'Secundaria',
      room: courseData.room || 'Aula Principal',
      schedule: courseData.schedule || 'A coordinar',
      color: courseData.color || '#1a73e8',
      studentsCount: Number(courseData.studentsCount) || 25,
      classroomSynced: !!courseData.classroomSynced,
      classroomCourseId: courseData.classroomCourseId,
      code: courseData.code || Math.random().toString(36).substring(2, 8),
      section: courseData.section || '1',
      orientation: courseData.orientation,
      division: courseData.division,
      schoolYear: courseData.schoolYear || String(new Date().getFullYear()),
    };
    const list = deduplicateCourses([...getLocalCourses(), newCourse]);
    saveLocalCourses(list);
    const userId = getActiveUserId();
    if (userId) {
      await firestoreSync.saveCourses(userId, list).catch(() => {});
    }
    return newCourse;
  },

  async bulkImportCourses(
    coursesList: Partial<Course>[]
  ): Promise<{ success: boolean; message: string; courses: Course[] }> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ success: boolean; message: string; courses: Course[] }>(
        '/api/courses/bulk',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courses: coursesList }),
        }
      );
      if (data) {
        const incoming = Array.isArray(data.courses) ? data.courses : [];
        const local = getLocalCourses();
        const fullList = deduplicateCourses([...local, ...incoming]);
        if (fullList.length > 0) {
          saveLocalCourses(fullList);
          const uId = getActiveUserId();
          if (uId) firestoreSync.saveCourses(uId, fullList).catch(() => {});
        }
        return { ...data, courses: fullList };
      }
    }

    // Client-side / isolated multi-teacher storage:
    const existing = getLocalCourses();
    const processed: Course[] = [...existing];
    let addedCount = 0;

    for (const item of coursesList) {
      const incomingClassroomId = item.classroomCourseId ? String(item.classroomCourseId).trim() : null;
      const incomingId = item.id ? String(item.id).trim() : null;
      const courseName = (item.name || '').trim();
      const courseSubject = (item.subject || courseName).trim();
      const studentsNum = typeof item.studentsCount === 'number' ? item.studentsCount : 0;

      const existingIndex = processed.findIndex((c) => areCoursesSame(c, item));

      if (existingIndex >= 0) {
        processed[existingIndex] = {
          ...processed[existingIndex],
          name: courseName || processed[existingIndex].name,
          subject: courseSubject || processed[existingIndex].subject,
          studentsCount: Math.max(processed[existingIndex].studentsCount || 0, studentsNum),
          classroomSynced: true,
          classroomCourseId: incomingClassroomId || processed[existingIndex].classroomCourseId,
        };
      } else {
        const courseId =
          incomingClassroomId ||
          incomingId ||
          `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`;
        const newCourse: Course = {
          id: courseId,
          name: courseName,
          subject: courseSubject,
          grade: item.grade || 'Secundaria',
          room: item.room || 'Aula Asignada',
          schedule: item.schedule || 'Horario a coordinar',
          color: item.color || '#137333',
          studentsCount: studentsNum,
          classroomSynced: true,
          classroomCourseId: incomingClassroomId || undefined,
          code: item.code || Math.random().toString(36).substring(2, 8),
          section: item.section || '1',
          schoolYear: item.schoolYear || String(new Date().getFullYear()),
          driveFolderId: item.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
        };
        processed.push(newCourse);
        addedCount++;
      }
    }

    const cleanFull = deduplicateCourses(processed);
    saveLocalCourses(cleanFull);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveCourses(userId, cleanFull)
        .catch((err) => console.warn('Firestore bulk import sync warning:', err));
    }

    return {
      success: true,
      message:
        addedCount > 0
          ? `Se agregaron ${addedCount} materias nuevas.`
          : `Las materias ya estaban cargadas previamente.`,
      courses: cleanFull,
    };
  },

  async syncCourseStudents(
    updates: Array<{ id: string; studentsCount: number }>
  ): Promise<{ success: boolean; message: string }> {
    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{ success: boolean; message: string }>(
        '/api/courses/sync-students',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        }
      );
      if (serverData) return serverData;
    }

    const courses = getLocalCourses();
    updates.forEach((u) => {
      const found = courses.find((c) => c.id === u.id);
      if (found) found.studentsCount = u.studentsCount;
    });
    saveLocalCourses(courses);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveCourses(userId, courses).catch(() => {});
    }
    return { success: true, message: 'Alumnos sincronizados correctamente' };
  },

  async updateCourse(id: string, patch: Partial<Course>): Promise<{ success: boolean; course: Course }> {
    const currentLocal = getLocalCourses();
    const list = currentLocal.map((c) =>
      c.id === id || (c.classroomCourseId && c.classroomCourseId === id) ? { ...c, ...patch } : c
    );
    saveLocalCourses(list);
    const updated =
      list.find((c) => c.id === id || (c.classroomCourseId && c.classroomCourseId === id)) ||
      ({ id, ...patch } as Course);

    const userId = getActiveUserId();
    const cloudSavePromise = userId ? firestoreSync.saveCourses(userId, list).catch(() => {}) : Promise.resolve();

    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ course?: Course }>(`/api/courses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (data?.course) {
        const syncedList = getLocalCourses().map((c) =>
          c.id === id || (c.classroomCourseId && c.classroomCourseId === id)
            ? { ...c, ...data.course, ...patch }
            : c
        );
        saveLocalCourses(syncedList);
        await cloudSavePromise;
        if (userId) await firestoreSync.saveCourses(userId, syncedList).catch(() => {});
        return { success: true, course: { ...data.course, ...patch } };
      }
    }

    await cloudSavePromise;
    return { success: true, course: updated };
  },

  async deleteCourse(id: string): Promise<{ success: boolean; message: string; courseId: string }> {
    const localCourses = getLocalCourses();
    const target = localCourses.find((c) => c.id === id || c.classroomCourseId === id || c.code === id);
    const idsToDelete = new Set<string>([id]);
    if (target?.id) idsToDelete.add(target.id);
    if (target?.classroomCourseId) idsToDelete.add(target.classroomCourseId);

    const list = localCourses.filter(
      (c) => !idsToDelete.has(c.id) && (!c.classroomCourseId || !idsToDelete.has(c.classroomCourseId))
    );
    saveLocalCourses(list, list.length === 0);

    const userId = getActiveUserId();
    if (userId) {
      idsToDelete.forEach((cid) => {
        firestoreSync.deleteCourse(userId, cid).catch(() => {});
      });
      firestoreSync.saveCourses(userId, list).catch(() => {});
    }

    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{ success: boolean; message: string; courseId: string }>(
        `/api/courses/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (serverData) return serverData;
    }

    return { success: true, message: 'Materia eliminada correctamente', courseId: id };
  },

  async clearAllCourses(): Promise<{ success: boolean; message: string }> {
    saveLocalCourses([], true);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.clearAllCourses(userId).catch(() => {});
      firestoreSync.saveCourses(userId, []).catch(() => {});
    }
    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{ success: boolean; message: string }>('/api/courses/clear', {
        method: 'POST',
      });
      if (serverData) return serverData;
    }

    return { success: true, message: 'Materias eliminadas correctamente' };
  },

  async restoreDemoCourses(): Promise<{ success: boolean; message: string; courses: Course[] }> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ success: boolean; message: string; courses: Course[] }>(
        '/api/courses/restore-demo',
        { method: 'POST' }
      );
      if (data) {
        if (Array.isArray(data.courses)) {
          saveLocalCourses(data.courses);
        }
        return data;
      }
    }

    saveLocalCourses([]);
    return { success: true, message: 'Materias restauradas correctamente', courses: [] };
  },
};
