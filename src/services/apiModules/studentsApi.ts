/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Students roster, selective synchronization, and attendance batch API client module.
 */

import { Student } from '../../types';
import { firestoreSync, getActiveUserId, isPrimaryOwnerAccount } from '../firestoreSync';
import { computeQuickStudentAttendanceRate } from '../../utils/attendanceCalculations';
import { safeSetLocalStorageItem } from '../../utils/storageGuard';
import {
  STORAGE_KEYS,
  deduplicateStudents,
  getAllDispositionStorage,
  getDivisionCandidateStudentsForCourse,
  getLocalCourses,
  getLocalStudents,
  getRemovedStudentIds,
  getUserScopedItem,
  getUserStorageKey,
  healSiblingCourseRosters,
  markStudentRemoved,
  saveLocalCourses,
  saveLocalStudents,
  syncAllRemovedStudentsIndexFromCloud,
  syncRemovedStudentsFromCloud,
  unmarkStudentRemoved,
} from '../storageHelpers';
import { canUseExpressBackend, fetchExpressJson } from './expressTransport';

export const studentsApi = {
  async getStudents(courseId?: string): Promise<Student[]> {
    const localDisp = getAllDispositionStorage().disposition || {};
    const localCourses = getLocalCourses();
    const scheduleByCourseId = new Map<string, string>();
    const perCourseDispMap = new Map<string, Record<string, any>>();
    localCourses.forEach((c) => {
      if (c.id && c.schedule) scheduleByCourseId.set(c.id, c.schedule);
      if (c.id) {
        try {
          const rawCourseDisp = getUserScopedItem(`fds_disposition_data_${c.id}_1c`);
          if (rawCourseDisp) {
            const parsed = JSON.parse(rawCourseDisp);
            if (parsed && typeof parsed === 'object') {
              perCourseDispMap.set(c.id, parsed);
            }
          }
        } catch (_) {}
      }
    });

    const enrichStudents = (list: Student[]) => {
      return list.map((st) => {
        const courseDisp = st.courseId ? perCourseDispMap.get(st.courseId) : undefined;
        const candidateGlobal = localDisp[`${st.courseId}::${st.id}`] || localDisp[st.id];
        const d =
          courseDisp?.[st.id] ||
          (candidateGlobal && (!candidateGlobal.courseId || candidateGlobal.courseId === st.courseId)
            ? candidateGlobal
            : undefined);
        if (d && typeof d.totalAbsences === 'number') {
          const rate = computeQuickStudentAttendanceRate(
            st.id,
            st.courseId,
            d.totalAbsences,
            d.totalLates || 0,
            st.courseId ? scheduleByCourseId.get(st.courseId) : undefined
          );
          return { ...st, attendanceRate: rate };
        }
        return st;
      });
    };

    // 1. Immediately get deduplicated local students (full list so division sibling healing can cross-reference)
    const allLocal = deduplicateStudents(getLocalStudents());
    // 2. Fetch server students (only for primary owner when Express backend is active) & cloud students in parallel
    const url = courseId ? `/api/students?courseId=${encodeURIComponent(courseId)}` : '/api/students';
    const serverPromise = canUseExpressBackend()
      ? fetchExpressJson<{ students: Student[] }>(url).then((data) =>
          data && Array.isArray(data.students) ? data.students : []
        )
      : Promise.resolve([] as Student[]);

    const userId = getActiveUserId();
    const cloudPromise = userId
      ? firestoreSync.loadStudents(userId).catch((err) => {
          console.warn('Firestore loadStudents error:', err);
          return [] as Student[];
        })
      : Promise.resolve([] as Student[]);

    const removedSyncPromise = userId
      ? Promise.all([
          syncAllRemovedStudentsIndexFromCloud().catch(() => null),
          courseId ? syncRemovedStudentsFromCloud(courseId).catch(() => null) : Promise.resolve(null),
        ])
      : Promise.resolve(null);

    const [serverStudents, cloudStudents] = await Promise.all([
      serverPromise,
      cloudPromise,
      removedSyncPromise,
    ]);

    // Courses that already have an explicit per-course local roster should not have removed/unselected
    // students resurrected by stale Express server seed data.
    const coursesWithExplicitLocalBucket = new Set<string>();
    if (typeof window !== 'undefined') {
      for (const c of localCourses) {
        if (c?.id && getUserScopedItem(`docencia_course_students_${c.id}`) !== null) {
          coursesWithExplicitLocalBucket.add(c.id);
        }
      }
    }

    const filteredServerStudents = serverStudents.filter(
      (st) => !st?.courseId || !coursesWithExplicitLocalBucket.has(st.courseId)
    );

    const rawCombined = deduplicateStudents([...filteredServerStudents, ...allLocal, ...cloudStudents]);
    const { students: healedCombined, healedCourseIds } = healSiblingCourseRosters(rawCombined);
    const mergedStudents = enrichStudents(healedCombined);

    const allFilteredStudents = mergedStudents.filter((st) => {
      if (st.courseId && getRemovedStudentIds(st.courseId).has(st.id)) return false;
      return true;
    });

    if (allFilteredStudents.length > 0) {
      const byCourse = new Map<string, Student[]>();
      for (const st of allFilteredStudents) {
        if (!st.courseId) continue;
        const arr = byCourse.get(st.courseId) || [];
        arr.push(st);
        byCourse.set(st.courseId, arr);
      }
      byCourse.forEach((courseList, cid) => {
        saveLocalStudents(cid, courseList);
      });

      if (healedCourseIds.length > 0) {
        const courses = getLocalCourses();
        let coursesChanged = false;
        for (const hCid of healedCourseIds) {
          const healedList = byCourse.get(hCid) || [];
          const cIdx = courses.findIndex((c) => c.id === hCid);
          if (cIdx >= 0 && courses[cIdx].studentsCount !== healedList.length) {
            courses[cIdx].studentsCount = healedList.length;
            coursesChanged = true;
          }
          if (userId && healedList.length > 0) {
            firestoreSync.saveStudents(userId, hCid, healedList).catch(() => {});
          }
        }
        if (coursesChanged) {
          saveLocalCourses(courses);
          if (userId) {
            firestoreSync.saveCourses(userId, courses).catch(() => {});
          }
        }
      }
    }

    return courseId
      ? allFilteredStudents.filter((st) => st.courseId === courseId)
      : allFilteredStudents;
  },

  async createStudent(
    studentData: Partial<Student> & { courseId: string; firstName: string; lastName: string; email?: string }
  ): Promise<Student> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ student?: Student }>('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studentData),
      });
      if (data?.student) {
        const scopedStudent: Student = { ...data.student, courseId: studentData.courseId };
        const current = getLocalStudents(studentData.courseId);
        saveLocalStudents(studentData.courseId, [...current, scopedStudent]);
        const userId = getActiveUserId();
        if (userId) {
          firestoreSync.saveStudents(userId, studentData.courseId, [...current, scopedStudent]).catch(() => {});
        }
        return scopedStudent;
      }
    }

    const newStudent: Student = {
      ...studentData,
      id: studentData.id || `st-${studentData.courseId}-${Date.now().toString().slice(-4)}`,
      courseId: studentData.courseId,
      firstName: studentData.firstName || '',
      lastName: studentData.lastName || '',
      email: studentData.email || '',
      attendanceRate: typeof studentData.attendanceRate === 'number' ? studentData.attendanceRate : 100,
      averageGrade: typeof studentData.averageGrade === 'number' ? studentData.averageGrade : 0,
      notes: studentData.notes || 'Registrado manualmente',
      avatar:
        studentData.avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          (studentData.firstName || '') + ' ' + (studentData.lastName || '')
        )}&background=1a73e8&color=ffffff&bold=true`,
    };
    const current = getLocalStudents(studentData.courseId);
    saveLocalStudents(studentData.courseId, [...current, newStudent]);
    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === studentData.courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = (courses[courseIndex].studentsCount || 0) + 1;
      saveLocalCourses(courses);
    }
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, studentData.courseId, [...current, newStudent]).catch(() => {});
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }
    return newStudent;
  },

  async updateStudent(studentId: string, courseId: string, updates: Partial<Student>): Promise<Student | null> {
    if (!courseId || !studentId) return null;
    const current = getLocalStudents(courseId);
    const idx = current.findIndex((s) => s.id === studentId && s.courseId === courseId);
    if (idx !== -1) {
      // Strictly preserve id and courseId so editing in one course never alters another course
      const updatedStudent: Student = {
        ...current[idx],
        ...updates,
        id: studentId,
        courseId,
      };
      current[idx] = updatedStudent;
      saveLocalStudents(courseId, current);
      const userId = getActiveUserId();
      if (userId) {
        firestoreSync.saveStudents(userId, courseId, current).catch(() => {});
      }
      if (canUseExpressBackend()) {
        fetchExpressJson(`/api/students/${encodeURIComponent(courseId)}/${encodeURIComponent(studentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).catch(() => {});
      }
      return updatedStudent;
    }
    return null;
  },

  async syncCourseStudentsRoster(
    courseId: string,
    students: Partial<Student>[]
  ): Promise<{ success: boolean; count: number; students: Student[] }> {
    const formattedStudents: Student[] = students.map((st, i) => {
      const firstName = st.firstName || 'Estudiante';
      const lastName = st.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      const rawUserId = st.id || (st as any).userId || `st-${courseId}-${i + 1}`;
      return {
        ...st,
        id: rawUserId,
        classroomUserId: String(rawUserId),
        courseId,
        firstName,
        lastName,
        email: st.email || '',
        attendanceRate: typeof st.attendanceRate === 'number' ? st.attendanceRate : 100,
        averageGrade: typeof st.averageGrade === 'number' ? st.averageGrade : 0,
        notes: st.notes || 'Sincronizado desde Google Classroom',
        avatar:
          st.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1a73e8&color=ffffff&bold=true`,
      };
    });

    await syncRemovedStudentsFromCloud(courseId).catch(() => {});
    const removedSet = getRemovedStudentIds(courseId);
    const activeFormatted = formattedStudents.filter((st) => !removedSet.has(st.id));

    saveLocalStudents(courseId, activeFormatted);

    // Also update course studentsCount
    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = activeFormatted.length;
      courses[courseIndex].classroomSynced = true;
      saveLocalCourses(courses);
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveStudents(userId, courseId, activeFormatted)
        .catch((e) => console.warn('Firestore sync students warning:', e));
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ success: boolean; count: number; students: Student[] }>(
        '/api/students/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, students: activeFormatted }),
        }
      );
      if (data) return data;
    }

    return {
      success: true,
      count: activeFormatted.length,
      students: activeFormatted,
    };
  },

  getDivisionCandidateStudentsForCourse(courseId: string): Student[] {
    return getDivisionCandidateStudentsForCourse(courseId);
  },

  /**
   * Selective Student Synchronization: imports ONLY the explicitly selected students
   * into a single specific `courseId`, preventing duplicates within that course and
   * never inserting or modifying students in any other course.
   */
  async syncSelectedCourseStudents(
    courseId: string,
    selectedStudents: Partial<Student>[],
    options?: {
      mode?: 'merge' | 'replace';
      allCandidates?: Partial<Student>[];
      realClassroomId?: string;
    }
  ): Promise<{
    success: boolean;
    count: number;
    addedCount: number;
    students: Student[];
  }> {
    const mode = options?.mode || 'merge';
    const currentInCourse = getLocalStudents(courseId);
    const existingById = new Map<string, Student>();
    const existingByEmail = new Map<string, Student>();
    const existingByName = new Map<string, Student>();

    for (const ex of currentInCourse) {
      if (ex.id) existingById.set(String(ex.id).trim(), ex);
      if (ex.email) existingByEmail.set(ex.email.trim().toLowerCase(), ex);
      const full = `${(ex.firstName || '').trim()} ${(ex.lastName || '').trim()}`.trim().toLowerCase();
      if (full) existingByName.set(full, ex);
    }

    const formattedSelected: Student[] = selectedStudents.map((st, i) => {
      const firstName = (st.firstName || 'Estudiante').trim();
      const lastName = (st.lastName || '').trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const cleanEmail = (st.email || '').trim().toLowerCase();
      const rawId = String(st.id || (st as any).userId || `st-${courseId}-${i + 1}`).trim();

      // Match existing record in THIS courseId if already enrolled so we preserve their ID, attendanceRate, notes, etc.
      const matchedExisting =
        existingById.get(rawId) ||
        (cleanEmail ? existingByEmail.get(cleanEmail) : undefined) ||
        (fullName ? existingByName.get(fullName.toLowerCase()) : undefined);

      const finalId = matchedExisting?.id || rawId;
      // Ensure selected student is unmarked from the removed list of THIS courseId
      unmarkStudentRemoved(courseId, finalId);
      if (rawId !== finalId) {
        unmarkStudentRemoved(courseId, rawId);
      }

      return {
        ...matchedExisting,
        ...st,
        id: finalId,
        classroomUserId: String(st.classroomUserId || rawId),
        courseId,
        firstName,
        lastName,
        email: st.email || matchedExisting?.email || '',
        attendanceRate:
          typeof matchedExisting?.attendanceRate === 'number'
            ? matchedExisting.attendanceRate
            : typeof st.attendanceRate === 'number'
            ? st.attendanceRate
            : 100,
        averageGrade:
          typeof matchedExisting?.averageGrade === 'number'
            ? matchedExisting.averageGrade
            : typeof st.averageGrade === 'number'
            ? st.averageGrade
            : 0,
        notes: matchedExisting?.notes || st.notes || 'Importado selectivamente desde Google Classroom',
        avatar:
          st.avatar ||
          matchedExisting?.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1a73e8&color=ffffff&bold=true`,
      };
    });

    const selectedKeys = new Set<string>();
    for (const s of formattedSelected) {
      selectedKeys.add(s.id);
      if (s.classroomUserId) selectedKeys.add(s.classroomUserId);
      if (s.email) selectedKeys.add(s.email.trim().toLowerCase());
      const full = `${s.firstName} ${s.lastName}`.trim().toLowerCase();
      if (full) selectedKeys.add(full);
    }

    let finalCourseRoster: Student[];
    if (mode === 'replace') {
      // Mark any unchecked candidate as excluded in THIS courseId so it stays hidden here without affecting other courses
      const candidates = options?.allCandidates || [];
      for (const cand of candidates) {
        const cId = String(cand.id || (cand as any).userId || '').trim();
        const cEmail = (cand.email || '').trim().toLowerCase();
        const cFull = `${(cand.firstName || '').trim()} ${(cand.lastName || '').trim()}`.trim().toLowerCase();
        const isSelected =
          (cId && selectedKeys.has(cId)) ||
          (cEmail && selectedKeys.has(cEmail)) ||
          (cFull && selectedKeys.has(cFull));
        if (!isSelected && cId) {
          markStudentRemoved(courseId, {
            ...(cand as Student),
            id: cId,
            courseId,
            firstName: cand.firstName || 'Estudiante',
            lastName: cand.lastName || '',
            email: cand.email || '',
            avatar: cand.avatar || '',
            attendanceRate: 100,
            averageGrade: 0,
            notes: '',
          });
        }
      }
      finalCourseRoster = deduplicateStudents(formattedSelected.map((s) => ({ ...s, courseId })));
    } else {
      // 'merge' mode: add selected students to current course roster without duplicating
      finalCourseRoster = deduplicateStudents(
        [...currentInCourse, ...formattedSelected].map((s) => ({ ...s, courseId }))
      );
    }

    const addedCount = Math.max(0, finalCourseRoster.length - currentInCourse.length);

    // Persist strictly for this courseId only
    saveLocalStudents(courseId, finalCourseRoster);

    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = finalCourseRoster.length;
      courses[courseIndex].classroomSynced = true;
      if (options?.realClassroomId) {
        courses[courseIndex].classroomCourseId = options.realClassroomId;
      }
      saveLocalCourses(courses);
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, courseId, finalCourseRoster).catch(() => {});
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    if (canUseExpressBackend()) {
      fetchExpressJson('/api/students/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, students: finalCourseRoster }),
      }).catch(() => {});
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('docencia_student_status_updated'));
    }

    return {
      success: true,
      count: finalCourseRoster.length,
      addedCount,
      students: finalCourseRoster,
    };
  },

  async removeStudentFromCourse(
    studentOrId: Student | string,
    courseId: string
  ): Promise<{ success: boolean; message: string }> {
    const studentId = typeof studentOrId === 'string' ? studentOrId : studentOrId.id;
    const current = getLocalStudents(courseId);
    const existingObj =
      typeof studentOrId === 'object'
        ? { ...studentOrId, courseId }
        : current.find((s) => s.id === studentId && s.courseId === courseId);
    markStudentRemoved(courseId, existingObj || studentId);

    // Strictly remove ONLY the student relation for this specific courseId
    const updated = current.filter((s) => !(s.id === studentId && s.courseId === courseId));
    saveLocalStudents(courseId, updated);

    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = Math.max(0, updated.length);
      saveLocalCourses(courses);
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, courseId, updated).catch(() => {});
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    if (canUseExpressBackend()) {
      fetchExpressJson(`/api/students/${encodeURIComponent(courseId)}/${encodeURIComponent(studentId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('docencia_student_status_updated'));
    }

    return { success: true, message: 'Estudiante quitado de la lista en esta materia' };
  },

  async restoreStudentInCourse(student: Student, courseId: string): Promise<{ success: boolean; message: string }> {
    unmarkStudentRemoved(courseId, student.id);
    const current = getLocalStudents(courseId);
    const restoredStudent: Student = { ...student, courseId };
    const updated = deduplicateStudents([...current, restoredStudent]);
    saveLocalStudents(courseId, updated);

    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = updated.length;
      saveLocalCourses(courses);
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, courseId, updated).catch(() => {});
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    if (canUseExpressBackend()) {
      fetchExpressJson('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoredStudent),
      }).catch(() => {});
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('docencia_student_status_updated'));
    }

    return { success: true, message: 'Estudiante reincorporado a la lista de esta materia' };
  },

  async cleanMockStudents(): Promise<{ success: boolean; remaining: number }> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ success: boolean; remaining: number }>('/api/students/clear-mock', {
        method: 'POST',
      });
      if (data) return data;
    }
    return { success: false, remaining: 0 };
  },

  async saveAttendance(
    courseId: string,
    date: string,
    records: { studentId: string; status: string }[]
  ): Promise<{ message: string }> {
    if (typeof window !== 'undefined') {
      try {
        const key = getUserStorageKey(STORAGE_KEYS.ATTENDANCE);
        const raw =
          localStorage.getItem(key) ||
          (isPrimaryOwnerAccount() && key !== STORAGE_KEYS.ATTENDANCE
            ? localStorage.getItem(STORAGE_KEYS.ATTENDANCE)
            : null) ||
          '{}';
        const parsed = JSON.parse(raw);
        if (!parsed[courseId]) parsed[courseId] = {};
        parsed[courseId][date] = records;
        safeSetLocalStorageItem(key, JSON.stringify(parsed));
      } catch (_) {}
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveAttendance(userId, courseId, date, records)
        .catch((e) => console.warn('Firestore saveAttendance warning:', e));
    }

    if (canUseExpressBackend()) {
      const serverData = await fetchExpressJson<{ message: string }>('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, date, records }),
      });
      if (serverData) return serverData;
    }

    return { message: 'Asistencia registrada con éxito' };
  },
};
