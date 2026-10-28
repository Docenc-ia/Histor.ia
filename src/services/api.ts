import {
  Course,
  Student,
  TeacherProfile,
} from '../types';
import { firestoreSync, getActiveUserId, isPrimaryOwnerAccount } from './firestoreSync';
import { isSameCalendarDay } from '../utils/dateUtils';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';
import { computeQuickStudentAttendanceRate } from '../utils/attendanceCalculations';
import { apiSecondaryEndpoints } from './apiSecondaryEndpoints';
import {
  STORAGE_KEYS,
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  normalizeCourseCanonicalKey,
  areCoursesSame,
  deduplicateCourses,
  deduplicateStudents,
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  PRIMARY_DISPOSITION_KEY,
  PRIMARY_HISTORY_KEY,
  DELETED_HISTORY_IDS_KEY,
  getDeletedHistoryIds,
  markHistoryIdDeleted,
  deduplicateHistoryItems,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getLocalDisposition2c,
  saveLocalDisposition2c,
  getRemovedStudentsIndex,
  getRemovedStudentIds,
  getRemovedStudentsList,
  markStudentRemoved,
  unmarkStudentRemoved,
  syncAllRemovedStudentsIndexFromCloud,
  syncRemovedStudentsFromCloud,
  getCourseDivisionGroupKey,
  getDivisionCandidateStudentsForCourse,
  healSiblingCourseRosters,
} from './storageHelpers';

export {
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  normalizeCourseCanonicalKey,
  areCoursesSame,
  deduplicateCourses,
  deduplicateStudents,
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  PRIMARY_DISPOSITION_KEY,
  PRIMARY_HISTORY_KEY,
  DELETED_HISTORY_IDS_KEY,
  getDeletedHistoryIds,
  markHistoryIdDeleted,
  deduplicateHistoryItems,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getLocalDisposition2c,
  saveLocalDisposition2c,
  getRemovedStudentsIndex,
  getRemovedStudentIds,
  getRemovedStudentsList,
  markStudentRemoved,
  unmarkStudentRemoved,
  syncAllRemovedStudentsIndexFromCloud,
  syncRemovedStudentsFromCloud,
  getCourseDivisionGroupKey,
  getDivisionCandidateStudentsForCourse,
  healSiblingCourseRosters,
};

// Detect if we are running on a static/serverless host (e.g. Vercel) where local Express disk persistence is unavailable
let expressBackendAvailable: boolean =
  typeof window !== 'undefined' ? !window.location.hostname.endsWith('.vercel.app') : true;

function canUseExpressBackend(requireOwner = true): boolean {
  if (!expressBackendAvailable) return false;
  return requireOwner ? isPrimaryOwnerAccount() : true;
}

async function fetchExpressJson<T = any>(url: string, init?: RequestInit): Promise<T | null> {
  if (!expressBackendAvailable) return null;
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || !contentType.includes('application/json')) {
      expressBackendAvailable = false;
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    expressBackendAvailable = false;
    return null;
  }
}

export const api = {
  // Auth API
  async getAuthUser(email?: string): Promise<{ authenticated: boolean; user: TeacherProfile }> {
    const targetEmail = (email || '').trim().toLowerCase();
    if (!targetEmail || !canUseExpressBackend(false)) {
      return { authenticated: false, user: null as any };
    }
    const data = await fetchExpressJson<{ authenticated: boolean; user: TeacherProfile }>(
      `/api/auth/user?email=${encodeURIComponent(targetEmail)}`
    );
    return data || { authenticated: false, user: null as any };
  },

  async syncAuthSession(userData: {
    uid: string;
    email: string;
    name: string;
    avatar: string;
    token?: string;
    scopes?: string[];
    school?: string;
  }): Promise<{ success: boolean; user: TeacherProfile }> {
    // Persist teacher profile in Firestore globally across accounts
    firestoreSync
      .saveTeacherProfile({
        id: userData.uid,
        email: userData.email,
        name: userData.name,
        avatar: userData.avatar,
        school: userData.school,
      })
      .catch(() => {});

    if (canUseExpressBackend(false)) {
      const serverData = await fetchExpressJson<{ success: boolean; user: TeacherProfile }>('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData),
      });
      if (serverData?.user) return serverData;
    }

    // Graceful fallback profile to ensure user is never blocked
    const fallbackProfile: TeacherProfile = {
      id: userData.uid,
      email: userData.email,
      name: userData.name || 'Docente Titular',
      avatar: userData.avatar,
      role: 'Docente Titular',
      school: userData.school || 'Institución Educativa',
      scopes: userData.scopes || [],
      permissions: [
        'tasks.create',
        'tasks.assign',
        'tasks.grade',
        'tasks.delete',
        'drive.read',
        'drive.attach',
        'classroom.sync',
        'students.view',
        'grades.manage',
      ],
    };
    return { success: true, user: fallbackProfile };
  },

  async logoutAuth(email?: string): Promise<void> {
    firestoreSync.clearMemoryCaches();
    if (canUseExpressBackend(false)) {
      await fetchExpressJson('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    }
  },

  async logoutAuthSession(email?: string): Promise<void> {
    return this.logoutAuth(email);
  },

  async getPermissions(): Promise<{ role: string; permissions: string[]; scopes: string[] }> {
    const res = await fetch('/api/auth/permissions');
    if (!res.ok) throw new Error('Error al consultar permisos');
    return res.json();
  },

  ...apiSecondaryEndpoints,
  getUserScopedItem,
  setUserScopedItem,

  // Courses
  async getCourses(): Promise<Course[]> {
    const userId = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();

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

    // Merge server, cloud (Firestore), and local courses so local edits always take precedence
    const mergedList = deduplicateCourses([...serverCourses, ...cloudCourses, ...local]);

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
      id: courseData.classroomCourseId || courseData.id || `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`,
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

  async bulkImportCourses(coursesList: Partial<Course>[]): Promise<{ success: boolean; message: string; courses: Course[] }> {
    if (canUseExpressBackend()) {
      const data = await fetchExpressJson<{ success: boolean; message: string; courses: Course[] }>('/api/courses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses: coursesList }),
      });
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
    let updatedCount = 0;

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
        updatedCount++;
      } else {
        const courseId = incomingClassroomId || incomingId || `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`;
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
      firestoreSync.saveCourses(userId, cleanFull).catch((err) => console.warn('Firestore bulk import sync warning:', err));
    }

    return {
      success: true,
      message: addedCount > 0
        ? `Se agregaron ${addedCount} materias nuevas.`
        : `Las materias ya estaban cargadas previamente.`,
      courses: cleanFull,
    };
  },

  async syncCourseStudents(updates: Array<{ id: string; studentsCount: number }>): Promise<{ success: boolean; message: string }> {
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/courses/sync-students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        });
        if (res.ok) return res.json();
      } catch (_) {}
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
      c.id === id || (c.classroomCourseId && c.classroomCourseId === id)
        ? { ...c, ...patch }
        : c
    );
    saveLocalCourses(list);
    const updated =
      list.find((c) => c.id === id || (c.classroomCourseId && c.classroomCourseId === id)) ||
      ({ id, ...patch } as Course);

    const userId = getActiveUserId();
    const cloudSavePromise = userId
      ? firestoreSync.saveCourses(userId, list).catch(() => {})
      : Promise.resolve();

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.course) {
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
      } catch (_) {}
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

    const list = localCourses.filter((c) => !idsToDelete.has(c.id) && (!c.classroomCourseId || !idsToDelete.has(c.classroomCourseId)));
    saveLocalCourses(list, list.length === 0);

    const userId = getActiveUserId();
    if (userId) {
      idsToDelete.forEach((cid) => {
        firestoreSync.deleteCourse(userId, cid).catch(() => {});
      });
      firestoreSync.saveCourses(userId, list).catch(() => {});
    }

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          return res.json();
        }
      } catch (_) {}
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
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/courses/clear', {
          method: 'POST',
        });
        if (res.ok) {
          return res.json();
        }
      } catch (_) {}
    }

    return { success: true, message: 'Materias eliminadas correctamente' };
  },

  async restoreDemoCourses(): Promise<{ success: boolean; message: string; courses: Course[] }> {
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/courses/restore-demo', {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.courses)) {
            saveLocalCourses(data.courses);
          }
          return data;
        }
      } catch (_) {}
    }

    saveLocalCourses([]);
    return { success: true, message: 'Materias restauradas correctamente', courses: [] };
  },

  // Students
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

    const rawCombined = deduplicateStudents([...allLocal, ...cloudStudents, ...filteredServerStudents]);
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

  async createStudent(studentData: Partial<Student> & { courseId: string; firstName: string; lastName: string; email?: string }): Promise<Student> {
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentData),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.student) {
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
      } catch (_) {}
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
        `https://ui-avatars.com/api/?name=${encodeURIComponent((studentData.firstName || '') + ' ' + (studentData.lastName || ''))}&background=1a73e8&color=ffffff&bold=true`,
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
      if (isPrimaryOwnerAccount() && canUseExpressBackend()) {
        fetch(`/api/students/${encodeURIComponent(courseId)}/${encodeURIComponent(studentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).catch(() => {});
      }
      return updatedStudent;
    }
    return null;
  },

  async syncCourseStudentsRoster(courseId: string, students: Partial<Student>[]): Promise<{ success: boolean; count: number; students: Student[] }> {
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
        avatar: st.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1a73e8&color=ffffff&bold=true`,
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
      firestoreSync.saveStudents(userId, courseId, activeFormatted).catch((e) => console.warn('Firestore sync students warning:', e));
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/students/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, students: activeFormatted }),
        });
        if (res.ok) {
          const data = await res.json();
          return data;
        }
      } catch (_) {}
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
      finalCourseRoster = deduplicateStudents(
        formattedSelected.map((s) => ({ ...s, courseId }))
      );
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

    if (isPrimaryOwnerAccount() && canUseExpressBackend()) {
      fetch('/api/students/sync', {
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

  async removeStudentFromCourse(studentOrId: Student | string, courseId: string): Promise<{ success: boolean; message: string }> {
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

    if (isPrimaryOwnerAccount() && canUseExpressBackend()) {
      fetch(`/api/students/${encodeURIComponent(courseId)}/${encodeURIComponent(studentId)}`, {
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

    if (isPrimaryOwnerAccount() && canUseExpressBackend()) {
      fetch('/api/students', {
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
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/students/clear-mock', { method: 'POST' });
        if (res.ok) return res.json();
      } catch (_) {}
    }
    return { success: false, remaining: 0 };
  },

  // Attendance
  async saveAttendance(courseId: string, date: string, records: { studentId: string; status: string }[]): Promise<{ message: string }> {
    if (typeof window !== 'undefined') {
      try {
        const key = getUserStorageKey(STORAGE_KEYS.ATTENDANCE);
        const raw = localStorage.getItem(key) || (isPrimaryOwnerAccount() && key !== STORAGE_KEYS.ATTENDANCE ? localStorage.getItem(STORAGE_KEYS.ATTENDANCE) : null) || '{}';
        const parsed = JSON.parse(raw);
        if (!parsed[courseId]) parsed[courseId] = {};
        parsed[courseId][date] = records;
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch (_) {}
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveAttendance(userId, courseId, date, records).catch((e) => console.warn('Firestore saveAttendance warning:', e));
    }

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, date, records }),
        });
        if (res.ok) return res.json();
      } catch (e) {
        console.warn('Backend /api/attendance unavailable:', e);
      }
    }

    return { message: 'Asistencia registrada con éxito' };
  },

  // Student Disposition & Absences System (Compact v2 Cloud Engine + Google Sheets integration)
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
        const hasUnsyncedLocalItems = local.history.some((lh: any) => lh?.id && !deleted.has(lh.id) && !cloudIds.has(lh.id));

        if (
          cleanCloudHistory.length > 0 ||
          Object.keys(cloud.disposition || {}).length > 0 ||
          Object.keys(cloud.disposition2c || {}).length > 0
        ) {
          const mergedHistory = deduplicateHistoryItems([...cleanCloudHistory, ...local.history]).filter(
            (h) => !deleted.has(h.id)
          );
          mergedHistory.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
          const mergedDisp = { ...local.disposition, ...(cloud.disposition || {}) };
          const mergedDisp2c = { ...local2c, ...(cloud.disposition2c || {}) };

          saveAllDispositionStorage(mergedDisp, mergedHistory, { silent: true });
          if (Object.keys(mergedDisp2c).length > 0) {
            saveLocalDisposition2c(mergedDisp2c);
          }

          if (hasUnsyncedLocalItems) {
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
        const mergedHistory = deduplicateHistoryItems([...local.history, ...cleanServerHistory]).filter(
          (h) => !deleted.has(h.id)
        );
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
    const current = (currentMap[data.studentId] as any) || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    if (current.totalDisposition === undefined) current.totalDisposition = 10;
    if (current.totalLates === undefined) current.totalLates = 0;
    if (current.totalAbsences === undefined) current.totalAbsences = 0;
    if (data.courseId) current.courseId = data.courseId;

    const userId = getActiveUserId();
    const recordId = data.id || `disp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
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
    };

    if (existingIndex === -1) {
      history.unshift(newRecord);
    } else {
      history[existingIndex] = { ...history[existingIndex], ...newRecord };
    }

    // Persist immediately across storage
    if (is2c) {
      saveAllDispositionStorage(allDisposition1c, history, { silent: true, courseId: data.courseId });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('docencia_disposition_storage_change', {
            detail: { term: '2c', courseId: data.courseId, disposition: allDisposition2c, history },
          })
        );
      }
    } else {
      saveAllDispositionStorage(allDisposition1c, history, { courseId: data.courseId });
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
        saveLocalStudents(studentCourseId, allLocalStudents.filter((s) => s.courseId === studentCourseId));
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
      firestoreSync.saveDisposition(userId, newRecord).catch((e) => console.warn('Firestore saveDisposition warning:', e));
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
      notificationMethod: 'classroom' | 'gmail' | 'none';
      notifiedAt?: string;
    }
  ): Promise<{ success: boolean; record: any }> {
    const local = getAllDispositionStorage();
    const updatedHistory = local.history.map((item: any) => {
      if (item.id === id) {
        return {
          ...item,
          ...notificationData,
        };
      }
      return item;
    });

    saveAllDispositionStorage(local.disposition, updatedHistory);

    const userId = getActiveUserId();
    const targetItem = updatedHistory.find((h: any) => h.id === id);
    if (userId && targetItem) {
      firestoreSync.saveDisposition(userId, targetItem).catch(() => {});
    }

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/disposition/history/${encodeURIComponent(id)}/notification`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notificationData),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          return await res.json();
        }
      } catch (_) {}
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
          setUserScopedItem(
            `fds_disposition_data_${targetCourseId}_${targetTerm}`,
            JSON.stringify(perCourseMap)
          );
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
          saveLocalStudents(studentCourseId, allLocalStudents.filter((s) => s.courseId === studentCourseId));
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
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/disposition/history/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extra || {}),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const serverData = await res.json();
          return serverData;
        }
      } catch (_) {}
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
      setUserScopedItem(
        `fds_disposition_data_${data.courseId}_${targetTerm}`,
        JSON.stringify(courseMap)
      );
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

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/disposition/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          return await res.json();
        }
      } catch (_) {}
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

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch('/api/disposition/sync-full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          return await res.json();
        }
      } catch (_) {}
    }

    return {
      success: true,
      count: cleanHistory.length,
      disposition: data.disposition,
      history: cleanHistory,
    };
  },

  async getCourseDispositionSheet(courseId: string): Promise<{
    spreadsheetId?: string;
    url?: string;
    lastSyncedAt?: string;
    isLiveGoogle?: boolean;
  }> {
    const userId = getActiveUserId();
    const localKey = `fds_course_disposition_sheet_${courseId}`;

    let cached: any = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = getUserScopedItem(localKey);
        if (raw) {
          cached = JSON.parse(raw);
        }
      } catch (_) {}
    }

    // 1. Check course object in local store / Firestore for dispositionSheetId
    try {
      const localCourses = this.getLocalCourses();
      const matched =
        localCourses.find((c) => c.id === courseId) ||
        (localCourses.filter((c) => c.classroomCourseId === courseId).length === 1
          ? localCourses.find((c) => c.classroomCourseId === courseId)
          : undefined);
      if (matched?.dispositionSheetId && isRealGoogleSpreadsheetId(matched.dispositionSheetId)) {
        const sheetInfo = {
          spreadsheetId: matched.dispositionSheetId,
          url: matched.dispositionSheetUrl || `https://docs.google.com/spreadsheets/d/${matched.dispositionSheetId}/edit`,
          isLiveGoogle: true,
          lastSyncedAt: cached?.lastSyncedAt || new Date().toISOString(),
        };
        setUserScopedItem(localKey, JSON.stringify(sheetInfo));
        return sheetInfo;
      }
    } catch (_) {}

    // 2. Check localStorage cache for this course
    if (cached?.spreadsheetId && isRealGoogleSpreadsheetId(cached.spreadsheetId)) {
      return {
        ...cached,
        isLiveGoogle: true,
        url: cached.url || `https://docs.google.com/spreadsheets/d/${cached.spreadsheetId}/edit`,
      };
    }

    // 3. Fallback to server config for primary owner
    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (data?.spreadsheetId && isRealGoogleSpreadsheetId(data.spreadsheetId)) {
            const sanitized = {
              ...data,
              isLiveGoogle: true,
              url: data.url || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
            };
            setUserScopedItem(localKey, JSON.stringify(sanitized));
            return sanitized;
          }
        }
      } catch (_) {}
    }

    if (userId) {
      try {
        const cloudSheet = await firestoreSync.loadUserSetting<{ spreadsheetId?: string; url?: string; lastSyncedAt?: string }>(
          userId,
          `sheet_${courseId}`
        );
        if (cloudSheet?.spreadsheetId && isRealGoogleSpreadsheetId(cloudSheet.spreadsheetId)) {
          const sanitized = {
            ...cloudSheet,
            isLiveGoogle: true,
            url: cloudSheet.url || `https://docs.google.com/spreadsheets/d/${cloudSheet.spreadsheetId}/edit`,
          };
          setUserScopedItem(localKey, JSON.stringify(sanitized));
          return sanitized;
        }
      } catch (_) {}
    }

    return {};
  },

  async unlinkCourseDispositionSheet(courseId: string): Promise<{ success: boolean }> {
    const localKey = `fds_course_disposition_sheet_${courseId}`;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(getUserStorageKey(localKey));
        if (isPrimaryOwnerAccount()) {
          localStorage.removeItem(localKey);
        }
      } catch (_) {}
    }

    // Clear dispositionSheetId on the course in localStorage and Firestore
    try {
      const courses = getLocalCourses();
      const hasExactIdMatch = courses.some((c) => c.id === courseId);
      let changed = false;
      const updated = courses.map((c) => {
        if (c.id === courseId || (!hasExactIdMatch && c.classroomCourseId === courseId)) {
          changed = true;
          const next = { ...c };
          delete next.dispositionSheetId;
          delete next.dispositionSheetUrl;
          return next;
        }
        return c;
      });
      if (changed) {
        saveLocalCourses(updated);
        const userId = getActiveUserId();
        if (userId) {
          firestoreSync.saveCourses(userId, updated).catch(() => {});
          firestoreSync.saveUserSetting(userId, `sheet_${courseId}`, {}).catch(() => {});
        }
      }
    } catch (_) {}

    if (isPrimaryOwnerAccount()) {
      try {
        await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`, {
          method: 'DELETE',
        });
      } catch (_) {}
    }
    return { success: true };
  },

  async saveCourseDispositionSheet(
    courseId: string,
    data: { spreadsheetId: string; url?: string; lastSyncedAt?: string }
  ): Promise<{ success: boolean }> {
    const localKey = `fds_course_disposition_sheet_${courseId}`;
    const isReal = isRealGoogleSpreadsheetId(data.spreadsheetId);
    const sanitizedData = {
      ...data,
      url: isReal ? (data.url || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`) : '',
    };
    setUserScopedItem(localKey, JSON.stringify(sanitizedData));

    // Persist dispositionSheetId directly on the Course object in localStorage and Firestore
    try {
      const userId = getActiveUserId();
      if (userId) {
        firestoreSync.saveUserSetting(userId, `sheet_${courseId}`, sanitizedData).catch(() => {});
      }
      const courses = getLocalCourses();
      const hasExactIdMatch = courses.some((c) => c.id === courseId);
      let changed = false;
      const updated = courses.map((c) => {
        if (c.id === courseId || (!hasExactIdMatch && c.classroomCourseId === courseId)) {
          changed = true;
          return {
            ...c,
            dispositionSheetId: data.spreadsheetId,
            dispositionSheetUrl: sanitizedData.url,
          };
        }
        return c;
      });
      if (changed) {
        saveLocalCourses(updated);
        if (userId) {
          firestoreSync.saveCourses(userId, updated).catch(() => {});
        }
      }
    } catch (_) {}

    if (isPrimaryOwnerAccount()) {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sanitizedData),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          return await res.json();
        }
        return { success: true };
      } catch {
        return { success: true };
      }
    }
    return { success: true };
  },

  // Storage & deduplication helpers for instant local cache access
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  deduplicateCourses,
  deduplicateStudents,
  getAllDispositionStorage,
  saveAllDispositionStorage,
};

