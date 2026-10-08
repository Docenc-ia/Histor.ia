import { Course, Student, LessonPlan, GradeEntry, DriveResource, ClassroomTask, TeacherTask, StudentSubmission, TeacherProfile, CustomGem } from '../types';
import { firestoreSync, getActiveUserId } from './firestoreSync';
import { isSameCalendarDay } from '../utils/dateUtils';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';

// LocalStorage keys for client-side persistence (Vercel & static deployment support)
const STORAGE_KEYS = {
  COURSES: 'docencia_courses_data',
  STUDENTS: 'docencia_students_data',
  TASKS: 'docencia_tasks_data',
  ATTENDANCE: 'docencia_attendance_data',
  DISPOSITION: 'docencia_disposition_data',
  DISPOSITION_HISTORY: 'docencia_disposition_history',
};

function getUserStorageKey(baseKey: string): string {
  const userId = getActiveUserId();
  return userId ? `${baseKey}_${userId}` : baseKey;
}

export function normalizeCourseCanonicalKey(c: Partial<Course>): string {
  if (!c) return '';
  if (c.classroomCourseId && !c.classroomCourseId.startsWith('gc-') && !isNaN(Number(c.classroomCourseId))) {
    return `classroom:${String(c.classroomCourseId).trim()}`;
  }
  const name = (c.name || '').trim().toLowerCase();
  const sub = (c.subject || '').trim().toLowerCase();
  const sec = (c.section || c.grade || c.division || '').trim().toLowerCase();
  const paren = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (paren) {
    return `name:${paren[1].trim()}:${paren[2].trim()}`;
  }
  return `name:${sub || name}:${sec || 'main'}`;
}

export function areCoursesSame(c1: Partial<Course>, c2: Partial<Course>): boolean {
  if (!c1 || !c2) return false;
  if (c1.id && c2.id && String(c1.id).trim() === String(c2.id).trim()) return true;

  const id1 = c1.classroomCourseId ? String(c1.classroomCourseId).trim() : null;
  const id2 = c2.classroomCourseId ? String(c2.classroomCourseId).trim() : null;

  if (id1 && id2 && id1 === id2) return true;
  if (id1 && (c2.id === id1 || c2.classroomCourseId === id1)) return true;
  if (id2 && (c1.id === id2 || c1.classroomCourseId === id2)) return true;

  const k1 = normalizeCourseCanonicalKey(c1);
  const k2 = normalizeCourseCanonicalKey(c2);
  if (k1 && k2 && k1 === k2) return true;

  return false;
}

export function deduplicateCourses(coursesList: Course[]): Course[] {
  if (!Array.isArray(coursesList)) return [];
  const result: Course[] = [];

  for (const c of coursesList) {
    if (!c || (!c.name && !c.subject)) continue;

    const existingIdx = result.findIndex((existing) => areCoursesSame(existing, c));
    if (existingIdx >= 0) {
      const existing = result[existingIdx];
      const preferredId =
        (existing.classroomCourseId && existing.id === existing.classroomCourseId)
          ? existing.id
          : (c.classroomCourseId && c.id === c.classroomCourseId)
          ? c.id
          : existing.id || c.id;

      result[existingIdx] = {
        ...existing,
        ...c,
        id: preferredId,
        classroomCourseId: existing.classroomCourseId || c.classroomCourseId,
        classroomSynced: existing.classroomSynced || c.classroomSynced,
        studentsCount: Math.max(Number(existing.studentsCount) || 0, Number(c.studentsCount) || 0),
        name: existing.name || c.name,
        subject: existing.subject || c.subject,
        grade: existing.grade || c.grade,
        section: existing.section || c.section,
        schoolYear: existing.schoolYear || c.schoolYear || '2026',
      };
    } else {
      result.push(c);
    }
  }

  return result;
}

export function deduplicateStudents(studentsList: Student[]): Student[] {
  if (!Array.isArray(studentsList)) return [];
  const result: Student[] = [];

  for (const st of studentsList) {
    if (!st || (!st.firstName && !st.lastName)) continue;
    const cleanEmail = (st.email || '').trim().toLowerCase();
    const cleanName = `${(st.firstName || '').trim()} ${(st.lastName || '').trim()}`.toLowerCase();
    const cId = st.courseId || '';

    const existingIdx = result.findIndex((existing) => {
      if (existing.id && st.id && existing.id === st.id) return true;
      if (cId && existing.courseId && cId === existing.courseId) {
        if (cleanEmail && existing.email && existing.email.trim().toLowerCase() === cleanEmail) return true;
        const exName = `${(existing.firstName || '').trim()} ${(existing.lastName || '').trim()}`.toLowerCase();
        if (exName && cleanName && exName === cleanName) return true;
      }
      return false;
    });

    if (existingIdx >= 0) {
      result[existingIdx] = {
        ...result[existingIdx],
        ...st,
        id: result[existingIdx].id || st.id,
      };
    } else {
      result.push(st);
    }
  }

  return result;
}

export function getLocalCourses(): Course[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    let raw = localStorage.getItem(key);
    if (!raw && key !== STORAGE_KEYS.COURSES) {
      raw = localStorage.getItem(STORAGE_KEYS.COURSES);
    }
    if (!raw) {
      raw = localStorage.getItem('docencia_persisted_courses');
    }
    if (raw !== null && raw !== undefined) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return deduplicateCourses(parsed);
      } catch (_) {}
    }
    // Deep fallback only if raw was never saved before (null)
    if (raw === null || raw === undefined) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('docencia_courses') || k.includes('courses'))) {
          try {
            const item = localStorage.getItem(k);
            if (item) {
              const p = JSON.parse(item);
              if (Array.isArray(p) && p.length > 0 && p[0]?.id && (p[0]?.name || p[0]?.subject)) {
                return deduplicateCourses(p);
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return [];
}

export function saveLocalCourses(coursesList: Course[]): void {
  if (typeof window === 'undefined') return;
  try {
    const cleanList = deduplicateCourses(coursesList);
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    const dataStr = JSON.stringify(cleanList);
    localStorage.setItem(key, dataStr);
    localStorage.setItem(STORAGE_KEYS.COURSES, dataStr);
    localStorage.setItem('docencia_persisted_courses', dataStr);
    if (cleanList.length === 0) {
      // Invalidate legacy or alternate keys so deleted courses never resurrect
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('docencia_courses') || k === 'docencia_persisted_courses')) {
          localStorage.setItem(k, '[]');
        }
      }
    }
  } catch (_) {}
}

export function getLocalStudents(courseId?: string): Student[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    let raw = localStorage.getItem(key);
    if (!raw && key !== STORAGE_KEYS.STUDENTS) {
      raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    }
    if (!raw) {
      raw = localStorage.getItem('docencia_persisted_students');
    }
    if (raw) {
      const parsed: Student[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = deduplicateStudents(parsed);
        return courseId ? clean.filter((s) => s.courseId === courseId) : clean;
      }
    }
    // Deep fallback: scan localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('docencia_students') || k.includes('students'))) {
        try {
          const item = localStorage.getItem(k);
          if (item) {
            const p = JSON.parse(item);
            if (Array.isArray(p) && p.length > 0 && p[0]?.id && p[0]?.firstName) {
              const clean = deduplicateStudents(p);
              return courseId ? clean.filter((s: Student) => s.courseId === courseId) : clean;
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return [];
}

export function saveLocalStudents(courseId: string, studentsList: Student[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    const all = getLocalStudents();
    const rest = all.filter((s) => s.courseId !== courseId);
    const updated = deduplicateStudents([...rest, ...studentsList]);
    const dataStr = JSON.stringify(updated);
    localStorage.setItem(key, dataStr);
    localStorage.setItem(STORAGE_KEYS.STUDENTS, dataStr);
    localStorage.setItem('docencia_persisted_students', dataStr);
  } catch (_) {}
}

export const PRIMARY_DISPOSITION_KEY = 'fds_disposition_data_v2';
export const PRIMARY_HISTORY_KEY = 'fds_disposition_history_v2';
export const DELETED_HISTORY_IDS_KEY = 'docencia_deleted_history_ids';

export function getDeletedHistoryIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_HISTORY_IDS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
}

export function markHistoryIdDeleted(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const set = getDeletedHistoryIds();
    set.add(id);
    localStorage.setItem(DELETED_HISTORY_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch (_) {}
}

export function deduplicateHistoryItems(list: any[]): any[] {
  const result: any[] = [];
  const seenIds = new Set<string>();
  const deleted = getDeletedHistoryIds();
  for (const item of list) {
    if (!item?.id || seenIds.has(item.id) || deleted.has(item.id)) continue;
    seenIds.add(item.id);
    result.push(item);
  }
  return result;
}

export function saveAllDispositionStorage(disposition: Record<string, any>, history: any[], options?: { silent?: boolean }): void {
  if (typeof window === 'undefined') return;
  try {
    const deleted = getDeletedHistoryIds();
    const cleanHistory = (history || []).filter((h) => h?.id && !deleted.has(h.id));
    const dispJson = JSON.stringify(disposition || {});
    const histJson = JSON.stringify(cleanHistory);

    const userId = getActiveUserId();
    const keysDisp = [
      PRIMARY_DISPOSITION_KEY,
      'docencia_disposition_data',
      STORAGE_KEYS.DISPOSITION,
    ];
    const keysHist = [
      PRIMARY_HISTORY_KEY,
      'docencia_disposition_history',
      STORAGE_KEYS.DISPOSITION_HISTORY,
    ];
    if (userId) {
      keysDisp.push(`docencia_disposition_data_${userId}`);
      keysHist.push(`docencia_disposition_history_${userId}`);
    }

    const uniqueDispKeys = Array.from(new Set(keysDisp));
    const uniqueHistKeys = Array.from(new Set(keysHist));

    for (const k of uniqueDispKeys) {
      localStorage.setItem(k, dispJson);
    }
    for (const k of uniqueHistKeys) {
      localStorage.setItem(k, histJson);
    }

    // Only dispatch when not silenced (e.g. during mutations, not during read/fetch)
    if (!options?.silent) {
      window.dispatchEvent(
        new CustomEvent('docencia_disposition_storage_change', {
          detail: { disposition, history: cleanHistory },
        })
      );
    }
  } catch (err) {
    console.warn('Error saving disposition to storage:', err);
  }
}

export function getAllDispositionStorage(): { disposition: Record<string, any>; history: any[] } {
  if (typeof window === 'undefined') return { disposition: {}, history: [] };
  const deleted = getDeletedHistoryIds();
  let disposition: Record<string, any> = {};
  let history: any[] = [];

  const userId = getActiveUserId();
  const keysDisp = [
    PRIMARY_DISPOSITION_KEY,
    userId ? `docencia_disposition_data_${userId}` : null,
    'docencia_disposition_data',
    STORAGE_KEYS.DISPOSITION,
  ].filter(Boolean) as string[];

  const keysHist = [
    PRIMARY_HISTORY_KEY,
    userId ? `docencia_disposition_history_${userId}` : null,
    'docencia_disposition_history',
    STORAGE_KEYS.DISPOSITION_HISTORY,
  ].filter(Boolean) as string[];

  // 1. Load disposition map - PRIMARY has priority, fallback to user/legacy
  for (const k of keysDisp) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          disposition = { ...disposition, ...parsed };
          if (k === PRIMARY_DISPOSITION_KEY) break;
        }
      }
    } catch (_) {}
  }

  // 2. Load history list - PRIMARY has priority so deletions are immediately respected
  for (const k of keysHist) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const clean = list.filter((item: any) => item?.id && !deleted.has(item.id));
          if (k === PRIMARY_HISTORY_KEY) {
            history = clean;
            break;
          } else if (history.length === 0 && clean.length > 0) {
            history = clean;
          }
        }
      }
    } catch (_) {}
  }

  return { disposition, history };
}

export const api = {
  // Auth API
  async getAuthUser(): Promise<{ authenticated: boolean; user: TeacherProfile }> {
    try {
      const res = await fetch('/api/auth/user');
      if (!res.ok) return { authenticated: false, user: null as any };
      return res.json();
    } catch {
      return { authenticated: false, user: null as any };
    }
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
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData),
      });
      if (res.ok) {
        return res.json();
      }
    } catch (e) {
      console.warn('Sync auth session warning:', e);
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

  async logoutAuth(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
  },

  async getPermissions(): Promise<{ role: string; permissions: string[]; scopes: string[] }> {
    const res = await fetch('/api/auth/permissions');
    if (!res.ok) throw new Error('Error al consultar permisos');
    return res.json();
  },

  // Teacher Tasks & Assignment Management (Module 1)
  async getTasks(courseId?: string): Promise<TeacherTask[]> {
    const url = courseId ? `/api/tasks?courseId=${encodeURIComponent(courseId)}` : '/api/tasks';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar tareas');
    const data = await res.json();
    return data.tasks;
  },

  async getTask(id: string): Promise<TeacherTask> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Error al cargar detalle de tarea');
    const data = await res.json();
    return data.task;
  },

  async createTask(taskData: {
    courseId: string;
    title: string;
    description: string;
    category: 'Tarea' | 'Trabajo Práctico' | 'Proyecto' | 'Evaluación';
    dueDate: string;
    maxPoints: number;
    driveAttachments?: Array<{ id: string; name: string; type: 'doc' | 'sheet' | 'slide' | 'pdf'; url: string; size?: string }>;
  }): Promise<TeacherTask> {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData),
    });
    if (!res.ok) throw new Error('Error al crear tarea');
    const data = await res.json();
    return data.task;
  },

  async gradeSubmission(
    taskId: string,
    studentId: string,
    grade: number,
    feedback?: string
  ): Promise<{ submission: StudentSubmission; task: TeacherTask }> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, grade, feedback }),
    });
    if (!res.ok) throw new Error('Error al calificar entrega');
    return res.json();
  },

  async updateTaskStatus(taskId: string, status: 'Publicada' | 'Borrador' | 'Cerrada'): Promise<TeacherTask> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Error al actualizar estado de la tarea');
    const data = await res.json();
    return data.task;
  },

  async deleteTask(taskId: string): Promise<void> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Error al eliminar tarea');
  },

  // Courses
  async getCourses(): Promise<Course[]> {
    const userId = getActiveUserId();

    // 1. Immediately get deduplicated local courses
    const local = deduplicateCourses(getLocalCourses());

    // 2. Fetch server courses and cloud Firestore courses in parallel
    const serverPromise = fetch('/api/courses')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && Array.isArray(data.courses) ? (data.courses as Course[]) : []))
      .catch((e) => {
        console.warn('Backend /api/courses unavailable:', e);
        return [] as Course[];
      });

    const cloudPromise = userId
      ? firestoreSync.loadCourses(userId).catch((err) => {
          console.warn('Firestore loadCourses failed:', err);
          return [] as Course[];
        })
      : Promise.resolve([] as Course[]);

    const [serverCourses, cloudCourses] = await Promise.all([serverPromise, cloudPromise]);

    // If both server and local are empty, respect the zero-courses state
    if (serverCourses.length === 0 && local.length === 0) {
      saveLocalCourses([]);
      return [];
    }

    const mergedList = deduplicateCourses([...local, ...serverCourses, ...cloudCourses]);

    if (mergedList.length > 0) {
      saveLocalCourses(mergedList);
      if (userId) {
        firestoreSync.saveCourses(userId, mergedList).catch(() => {});
      }
      return mergedList;
    }

    saveLocalCourses([]);
    return [];
  },

  async createCourse(courseData: Partial<Course>): Promise<Course> {
    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(courseData),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.course) {
          const list = deduplicateCourses([...getLocalCourses(), data.course]);
          saveLocalCourses(list);
          const userId = getActiveUserId();
          if (userId) firestoreSync.saveCourses(userId, list).catch(() => {});
          return data.course;
        }
      }
    } catch (e) {
      console.warn('Backend /api/courses POST unavailable, saving locally:', e);
    }

    const newCourse: Course = {
      id: courseData.classroomCourseId || courseData.id || `c-${Date.now().toString().slice(-4)}`,
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
      schoolYear: courseData.schoolYear || '2026',
    };
    const list = deduplicateCourses([...getLocalCourses(), newCourse]);
    saveLocalCourses(list);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveCourses(userId, list).catch(() => {});
    }
    return newCourse;
  },

  async bulkImportCourses(coursesList: Partial<Course>[]): Promise<{ success: boolean; message: string; courses: Course[] }> {
    try {
      const res = await fetch('/api/courses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses: coursesList }),
      });
      if (res.ok) {
        const data = await res.json();
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
    } catch (e) {
      console.warn('Backend /api/courses/bulk unavailable, importing to local storage:', e);
    }

    // Client-side fallback for Vercel & static deployments:
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
          schoolYear: item.schoolYear || '2026',
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
    try {
      const res = await fetch('/api/courses/sync-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (res.ok) return res.json();
    } catch (_) {}

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
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.course) {
          const list = getLocalCourses().map((c) => (c.id === id ? data.course : c));
          saveLocalCourses(list);
          const userId = getActiveUserId();
          if (userId) firestoreSync.saveCourses(userId, list).catch(() => {});
          return data;
        }
      }
    } catch (_) {}

    const list = getLocalCourses().map((c) => (c.id === id ? { ...c, ...patch } : c));
    saveLocalCourses(list);
    const updated = list.find((c) => c.id === id) || (patch as Course);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveCourses(userId, list).catch(() => {});
    }
    return { success: true, course: updated };
  },

  async deleteCourse(id: string): Promise<{ success: boolean; message: string; courseId: string }> {
    const localCourses = getLocalCourses();
    const target = localCourses.find((c) => c.id === id || c.classroomCourseId === id || c.code === id);
    const idsToDelete = new Set<string>([id]);
    if (target?.id) idsToDelete.add(target.id);
    if (target?.classroomCourseId) idsToDelete.add(target.classroomCourseId);

    const list = localCourses.filter((c) => !idsToDelete.has(c.id) && (!c.classroomCourseId || !idsToDelete.has(c.classroomCourseId)));
    saveLocalCourses(list);

    const userId = getActiveUserId();
    if (userId) {
      idsToDelete.forEach((cid) => {
        firestoreSync.deleteCourse(userId, cid).catch(() => {});
      });
      firestoreSync.saveCourses(userId, list).catch(() => {});
    }

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        return res.json();
      }
    } catch (_) {}

    return { success: true, message: 'Materia eliminada correctamente', courseId: id };
  },

  async clearAllCourses(): Promise<{ success: boolean; message: string }> {
    saveLocalCourses([]);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.clearAllCourses(userId).catch(() => {});
      firestoreSync.saveCourses(userId, []).catch(() => {});
    }
    try {
      const res = await fetch('/api/courses/clear', {
        method: 'POST',
      });
      if (res.ok) {
        return res.json();
      }
    } catch (_) {}

    return { success: true, message: 'Materias de prueba eliminadas correctamente' };
  },

  async restoreDemoCourses(): Promise<{ success: boolean; message: string; courses: Course[] }> {
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

    saveLocalCourses([]);
    return { success: true, message: 'Materias restauradas correctamente', courses: [] };
  },

  // Students
  async getStudents(courseId?: string): Promise<Student[]> {
    const localDisp = getAllDispositionStorage().disposition || {};
    const enrichStudents = (list: Student[]) => {
      return list.map((st) => {
        const d = localDisp[st.id];
        if (d && typeof d.totalAbsences === 'number') {
          const rate = Math.max(0, Math.round(100 - (d.totalAbsences * 5)));
          return { ...st, attendanceRate: rate };
        }
        return st;
      });
    };

    // 1. Immediately get deduplicated local students
    const local = deduplicateStudents(getLocalStudents(courseId));

    // 2. Fetch server students & cloud students in parallel
    const url = courseId ? `/api/students?courseId=${encodeURIComponent(courseId)}` : '/api/students';
    const serverPromise = fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && Array.isArray(data.students) ? (data.students as Student[]) : []))
      .catch((e) => {
        console.warn('Backend /api/students unavailable:', e);
        return [] as Student[];
      });

    const userId = getActiveUserId();
    const cloudPromise = userId
      ? firestoreSync.loadStudents(userId, courseId).catch((err) => {
          console.warn('Firestore loadStudents error:', err);
          return [] as Student[];
        })
      : Promise.resolve([] as Student[]);

    const [serverStudents, cloudStudents] = await Promise.all([serverPromise, cloudPromise]);

    const mergedStudents = enrichStudents(deduplicateStudents([...local, ...serverStudents, ...cloudStudents]));

    if (courseId && mergedStudents.length > 0) {
      saveLocalStudents(courseId, mergedStudents);
      if (userId) {
        firestoreSync.saveStudents(userId, courseId, mergedStudents).catch(() => {});
      }
    }

    return mergedStudents;
  },

  async createStudent(studentData: { courseId: string; firstName: string; lastName: string; email?: string }): Promise<Student> {
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studentData),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.student) {
          const current = getLocalStudents(studentData.courseId);
          saveLocalStudents(studentData.courseId, [...current, data.student]);
          const userId = getActiveUserId();
          if (userId) {
            firestoreSync.saveStudents(userId, studentData.courseId, [...current, data.student]).catch(() => {});
          }
          return data.student;
        }
      }
    } catch (_) {}

    const newStudent: Student = {
      id: `st-${studentData.courseId}-${Date.now().toString().slice(-4)}`,
      courseId: studentData.courseId,
      firstName: studentData.firstName,
      lastName: studentData.lastName,
      email: studentData.email,
      attendanceRate: 100,
      averageGrade: 0,
      notes: 'Registrado manualmente',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(studentData.firstName + ' ' + studentData.lastName)}&background=1a73e8&color=ffffff&bold=true`,
    };
    const current = getLocalStudents(studentData.courseId);
    saveLocalStudents(studentData.courseId, [...current, newStudent]);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, studentData.courseId, [...current, newStudent]).catch(() => {});
    }
    return newStudent;
  },

  async syncCourseStudentsRoster(courseId: string, students: Partial<Student>[]): Promise<{ success: boolean; count: number; students: Student[] }> {
    const formattedStudents: Student[] = students.map((st, i) => {
      const firstName = st.firstName || 'Estudiante';
      const lastName = st.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      return {
        id: st.id || (st as any).userId || `st-${courseId}-${i + 1}`,
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

    saveLocalStudents(courseId, formattedStudents);

    // Also update course studentsCount
    const courses = getLocalCourses();
    const courseIndex = courses.findIndex((c) => c.id === courseId);
    if (courseIndex >= 0) {
      courses[courseIndex].studentsCount = formattedStudents.length;
      courses[courseIndex].classroomSynced = true;
      saveLocalCourses(courses);
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveStudents(userId, courseId, formattedStudents).catch((e) => console.warn('Firestore sync students warning:', e));
      if (courseIndex >= 0) {
        firestoreSync.saveCourses(userId, courses).catch(() => {});
      }
    }

    try {
      const res = await fetch('/api/students/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, students }),
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (_) {}

    return {
      success: true,
      count: formattedStudents.length,
      students: formattedStudents,
    };
  },

  async cleanMockStudents(): Promise<{ success: boolean; remaining: number }> {
    try {
      const res = await fetch('/api/students/clear-mock', { method: 'POST' });
      if (res.ok) return res.json();
    } catch (_) {}
    return { success: false, remaining: 0 };
  },

  // Attendance
  async saveAttendance(courseId: string, date: string, records: { studentId: string; status: string }[]): Promise<{ message: string }> {
    if (typeof window !== 'undefined') {
      try {
        const key = getUserStorageKey(STORAGE_KEYS.ATTENDANCE);
        const raw = localStorage.getItem(key) || (key !== STORAGE_KEYS.ATTENDANCE ? localStorage.getItem(STORAGE_KEYS.ATTENDANCE) : null) || '{}';
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

    return { message: 'Asistencia registrada con éxito' };
  },

  // Student Disposition & Absences System (Google Sheets script integration)
  async getDisposition(courseId?: string, studentId?: string): Promise<{
    disposition: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
    history: any[];
  }> {
    const local = getAllDispositionStorage();
    const userId = getActiveUserId();
    const deleted = getDeletedHistoryIds();

    if (userId) {
      try {
        const cloud = await firestoreSync.loadDisposition(userId);
        const cleanCloudHistory = (cloud.history || []).filter((h: any) => h?.id && !deleted.has(h.id));

        // Purge any resurrected tombstones from Firestore in background
        const resurrected = (cloud.history || []).filter((h: any) => h?.id && deleted.has(h.id));
        if (resurrected.length > 0) {
          resurrected.forEach((r: any) => {
            firestoreSync.deleteDisposition(userId, r.id).catch(() => {});
          });
        }

        if (cleanCloudHistory.length > 0 || Object.keys(cloud.disposition || {}).length > 0) {
          const mergedHistory = deduplicateHistoryItems([...local.history, ...cleanCloudHistory]).filter((h) => !deleted.has(h.id));
          const mergedDisp = { ...(cloud.disposition || {}), ...local.disposition };
          saveAllDispositionStorage(mergedDisp, mergedHistory, { silent: true });
          return { disposition: mergedDisp, history: mergedHistory };
        }
      } catch (err) {
        console.warn('Firestore loadDisposition warning:', err);
      }
    }

    try {
      const params = new URLSearchParams();
      if (courseId) params.append('courseId', courseId);
      if (studentId) params.append('studentId', studentId);
      const res = await fetch(`/api/disposition?${params.toString()}`);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const serverData = await res.json();
        if (serverData?.history || serverData?.disposition) {
          const cleanServerHistory = (serverData.history || []).filter((h: any) => h?.id && !deleted.has(h.id));
          const mergedHistory = deduplicateHistoryItems([...local.history, ...cleanServerHistory]).filter((h) => !deleted.has(h.id));
          const mergedDisp = { ...(serverData.disposition || {}), ...local.disposition };
          saveAllDispositionStorage(mergedDisp, mergedHistory, { silent: true });
          return { disposition: mergedDisp, history: mergedHistory };
        }
      }
    } catch (_) {}

    return local as any;
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
    notificationMethod?: 'classroom' | 'gmail' | 'none';
    notifiedAt?: string;
    expectedSummary?: { totalAbsences: number; totalLates?: number; totalDisposition: number };
  }): Promise<{
    success: boolean;
    record: any;
    summary: { totalAbsences: number; totalDisposition: number };
    allDisposition: Record<string, { totalAbsences: number; totalDisposition: number }>;
  }> {
    const local = getAllDispositionStorage();
    const allDisposition: Record<string, any> = { ...local.disposition };
    let history: any[] = [...local.history];

    const current = (allDisposition[data.studentId] as any) || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    if (current.totalDisposition === undefined) current.totalDisposition = 10;
    if (current.totalLates === undefined) current.totalLates = 0;
    if (current.totalAbsences === undefined) current.totalAbsences = 0;

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
          firestoreSync.deleteTodayAbsencesForStudent(userId, data.studentId, now).catch(() => {});
        }
      } else if (data.category === 'Disposición') {
        current.totalDisposition = Math.max(0, current.totalDisposition - 1);
      }
    }
    allDisposition[data.studentId] = current;

    const newRecord = {
      id: recordId,
      ...data,
      pointsChange:
        data.category === 'Ausencia' || data.category === 'Llegada tarde'
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

    // Persist immediately across all local storage keys
    saveAllDispositionStorage(allDisposition, history);

    // Cascaded update of local student record
    try {
      const allLocalStudents = getLocalStudents();
      const stIdx = allLocalStudents.findIndex((s) => s.id === data.studentId);
      if (stIdx !== -1) {
        const studentCourseId = allLocalStudents[stIdx].courseId;
        const newAbs = allDisposition[data.studentId]?.totalAbsences || 0;
        const newRate = Math.max(0, Math.round(100 - (newAbs * 5)));
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
            summary: current,
            disposition: allDisposition,
          },
        })
      );
    } catch (_) {}

    if (userId) {
      firestoreSync.saveDisposition(userId, newRecord).catch((e) => console.warn('Firestore saveDisposition warning:', e));
    }

    try {
      const res = await fetch('/api/disposition/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const serverRes = await res.json();
        return serverRes;
      }
    } catch (_) {}

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

    return { success: true, record: targetItem };
  },

  async deleteDispositionHistory(
    id: string,
    extra?: {
      studentId?: string;
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

    let currentSummary: any = null;
    if (studentIdToDelete) {
      const current = allDisposition[studentIdToDelete] || {
        totalAbsences: 0,
        totalLates: 0,
        totalDisposition: 10,
      };

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

      allDisposition[studentIdToDelete] = current;
      currentSummary = current;
    }

    // 3. Save across all client storage keys
    saveAllDispositionStorage(allDisposition, history);

    // Cascaded update of local student record
    if (studentIdToDelete) {
      try {
        const allLocalStudents = getLocalStudents();
        const stIdx = allLocalStudents.findIndex((s) => s.id === studentIdToDelete);
        if (stIdx !== -1) {
          const studentCourseId = allLocalStudents[stIdx].courseId;
          const newAbs = allDisposition[studentIdToDelete]?.totalAbsences || 0;
          const newRate = Math.max(0, Math.round(100 - (newAbs * 5)));
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
              summary: currentSummary,
              disposition: allDisposition,
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

    // 5. Delete on backend if available
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

    return { success: true, summary: currentSummary, disposition: allDisposition };
  },

  async resetDisposition(data: {
    studentId?: string;
    courseId?: string;
    resetWhat: 'disposition' | 'absences' | 'all';
    clearHistory?: boolean;
  }): Promise<{ success: boolean; disposition: Record<string, any>; history?: any[] }> {
    const local = getAllDispositionStorage();
    const map = { ...local.disposition };
    let history = [...local.history];

    if (data.studentId) {
      if (!map[data.studentId]) {
        map[data.studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      }
      if (data.resetWhat === 'disposition' || data.resetWhat === 'all' || !data.resetWhat) {
        map[data.studentId].totalDisposition = 10;
      }
      if (data.resetWhat === 'absences' || data.resetWhat === 'all') {
        map[data.studentId].totalAbsences = 0;
      }
      if (data.resetWhat === 'all') {
        map[data.studentId].totalLates = 0;
      }
    } else if (data.courseId) {
      Object.keys(map).forEach((sId) => {
        if (!map[sId]) map[sId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
        if (data.resetWhat === 'disposition' || data.resetWhat === 'all' || !data.resetWhat) {
          map[sId].totalDisposition = 10;
        }
        if (data.resetWhat === 'absences' || data.resetWhat === 'all') {
          map[sId].totalAbsences = 0;
        }
        if (data.resetWhat === 'all') {
          map[sId].totalLates = 0;
        }
      });
    }

    if (data.clearHistory) {
      const removedIds: string[] = [];
      history = history.filter((h: any) => {
        const matchesStudent = data.studentId ? h.studentId === data.studentId : true;
        const matchesCourse = data.courseId ? h.courseId === data.courseId : true;
        if (matchesStudent && matchesCourse) {
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

    saveAllDispositionStorage(map, history);

    const userId = getActiveUserId();
    if (userId) {
      if (data.studentId) {
        firestoreSync.deleteStudentDispositionDocs(userId, data.studentId, data.clearHistory).catch(() => {});
      } else if (data.courseId) {
        firestoreSync.deleteCourseDispositionDocs(userId, data.courseId, data.clearHistory).catch(() => {});
      }
    }

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

    return {
      success: true,
      disposition: map,
      history,
    };
  },

  async syncFullDisposition(data: {
    disposition: Record<string, any>;
    history: any[];
    replaceHistory?: boolean;
  }): Promise<{ success: boolean; count: number; disposition?: Record<string, any>; history?: any[] }> {
    if (data?.disposition || data?.history) {
      const deleted = getDeletedHistoryIds();
      const cleanHistory = (data.history || []).filter((h) => h?.id && !deleted.has(h.id));
      saveAllDispositionStorage(data.disposition || {}, cleanHistory);
    }

    const userId = getActiveUserId();
    if (userId && data.history && data.history.length > 0) {
      for (const item of data.history.slice(0, 15)) {
        firestoreSync.saveDisposition(userId, item).catch(() => {});
      }
    }

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

    return {
      success: true,
      count: data.history?.length || 0,
      disposition: data.disposition,
      history: data.history,
    };
  },

  async getCourseDispositionSheet(courseId: string): Promise<{
    spreadsheetId?: string;
    url?: string;
    lastSyncedAt?: string;
  }> {
    const localKey = `fds_course_disposition_sheet_${courseId}`;
    let cached: any = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(localKey);
        if (raw) cached = JSON.parse(raw);
      } catch (_) {}
    }
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data?.spreadsheetId) {
          const isReal = isRealGoogleSpreadsheetId(data.spreadsheetId);
          const sanitized = {
            ...data,
            isLiveGoogle: isReal,
            url: isReal ? (data.url || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`) : '',
          };
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem(localKey, JSON.stringify(sanitized));
            } catch (_) {}
          }
          return sanitized;
        }
      }
    } catch (_) {}
    if (cached?.spreadsheetId) {
      const isReal = isRealGoogleSpreadsheetId(cached.spreadsheetId);
      return {
        ...cached,
        isLiveGoogle: isReal,
        url: isReal ? cached.url : '',
      };
    }
    return {};
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
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(localKey, JSON.stringify(sanitizedData));
      } catch (_) {}
    }
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
  },

  // Custom Conduct Options
  async getConductOptions(teacher?: string): Promise<string[]> {
    try {
      const url = teacher ? `/api/conduct-options?teacher=${encodeURIComponent(teacher)}` : '/api/conduct-options';
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.options) ? data.options : [];
    } catch {
      return [];
    }
  },

  async saveConductOptions(teacher: string, options: string[]): Promise<boolean> {
    try {
      const res = await fetch('/api/conduct-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher, options }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getConductTemplates(teacher?: string): Promise<Record<string, string>> {
    try {
      const url = teacher ? `/api/conduct-templates?teacher=${encodeURIComponent(teacher)}` : '/api/conduct-templates';
      const res = await fetch(url);
      if (!res.ok) return {};
      const data = await res.json();
      return (data.templates && typeof data.templates === 'object') ? data.templates : {};
    } catch {
      return {};
    }
  },

  async saveConductTemplates(teacher: string, templates: Record<string, string>): Promise<boolean> {
    try {
      const res = await fetch('/api/conduct-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher, templates }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Lesson Plans (Google Docs ready)
  async getLessonPlans(courseId?: string): Promise<LessonPlan[]> {
    const url = courseId ? `/api/lesson-plans?courseId=${encodeURIComponent(courseId)}` : '/api/lesson-plans';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar planificaciones');
    const data = await res.json();
    return data.lessonPlans;
  },

  async createLessonPlan(planData: Partial<LessonPlan>): Promise<LessonPlan> {
    const res = await fetch('/api/lesson-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planData),
    });
    if (!res.ok) throw new Error('Error al guardar planificación');
    const data = await res.json();
    return data.lessonPlan;
  },

  // Gradebook (Google Sheets ready)
  async getGrades(courseId?: string): Promise<GradeEntry[]> {
    const url = courseId ? `/api/gradebook?courseId=${encodeURIComponent(courseId)}` : '/api/gradebook';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar calificaciones');
    const data = await res.json();
    return data.grades;
  },

  async updateGrade(gradeData: Partial<GradeEntry>): Promise<GradeEntry> {
    const res = await fetch('/api/gradebook/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gradeData),
    });
    if (!res.ok) throw new Error('Error al registrar nota');
    const data = await res.json();
    return data.grade;
  },

  // Drive Resources (Google Drive ready)
  async getDriveFiles(courseId?: string, folder?: string): Promise<DriveResource[]> {
    const params = new URLSearchParams();
    if (courseId) params.append('courseId', courseId);
    if (folder) params.append('folder', folder);
    const res = await fetch(`/api/drive/files?${params.toString()}`);
    if (!res.ok) throw new Error('Error al obtener archivos de Drive');
    const data = await res.json();
    return data.files;
  },

  async uploadDriveFile(fileData: { name: string; type: string; folder: string; courseId?: string }): Promise<DriveResource> {
    const res = await fetch('/api/drive/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fileData),
    });
    if (!res.ok) throw new Error('Error al subir a Drive');
    const data = await res.json();
    return data.file;
  },

  // Classroom Tasks
  async getClassroomTasks(courseId?: string): Promise<ClassroomTask[]> {
    const url = courseId ? `/api/classroom/tasks?courseId=${encodeURIComponent(courseId)}` : '/api/classroom/tasks';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar tareas de Classroom');
    const data = await res.json();
    return data.tasks;
  },

  async publishClassroomTask(taskData: Partial<ClassroomTask>): Promise<ClassroomTask> {
    const res = await fetch('/api/classroom/publish-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData),
    });
    if (!res.ok) throw new Error('Error al publicar tarea en Classroom');
    const data = await res.json();
    return data.task;
  },

  // AI Pedagogical Assistant
  async askAiAssistant(params: {
    prompt: string;
    type: 'lesson_plan' | 'rubric' | 'feedback' | 'questions';
    subject?: string;
    grade?: string;
    topic?: string;
  }): Promise<{ result: string; source: string }> {
    const res = await fetch('/api/ai/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error en el asistente pedagógico');
    return res.json();
  },

  // Workspace Config
  async getWorkspaceConfig() {
    const res = await fetch('/api/workspace/config');
    return res.json();
  },

  // MVP Module 1: RAG Lesson Planning -> Google Docs
  async getRagPlans(courseId?: string): Promise<any[]> {
    const url = courseId ? `/api/rag/plans?courseId=${encodeURIComponent(courseId)}` : '/api/rag/plans';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar planificaciones RAG');
    return res.json();
  },

  async deleteRagPlan(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`/api/rag/plans/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Error al eliminar planificación RAG');
    return res.json();
  },

  async clearRagPlans(courseId?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/rag/plans/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId }),
    });
    if (!res.ok) throw new Error('Error al limpiar planificaciones');
    return res.json();
  },

  async generateRagLessonPlan(params: {
    courseId?: string;
    subject: string;
    gradeLevel: string;
    studentAge: string;
    institutionalTemplateText?: string;
    curriculumNormsText?: string;
    bibliographyText?: string;
  }): Promise<{ success: boolean; jobId: string; message: string }> {
    const res = await fetch('/api/rag/lesson-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al iniciar pipeline RAG');
    return res.json();
  },

  // Document & Link Parser for RAG Sources (Word / PDF / Docs / Text)
  async parseDocument(params: {
    fileName?: string;
    mimeType?: string;
    base64Data?: string;
    linkUrl?: string;
    docType?: 'template' | 'normative' | 'bibliography';
  }): Promise<{
    success: boolean;
    fileName?: string;
    fileSize?: string;
    type: 'pdf' | 'docx' | 'text' | 'link';
    text: string;
    url?: string;
    docId?: string;
    message?: string;
  }> {
    const res = await fetch('/api/documents/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al procesar documento' }));
      throw new Error(err.error || 'Error al procesar documento');
    }
    return res.json();
  },

  // MVP Module 2: Interactive Manuals (Drive) & YouTube Transcription
  async getManuals(): Promise<any[]> {
    const res = await fetch('/api/manuals');
    if (!res.ok) throw new Error('Error al cargar manuales interactivos');
    return res.json();
  },

  async deleteManual(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`/api/manuals/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Error al eliminar manual interactivo');
    return res.json();
  },

  async clearManuals(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/manuals/clear', {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Error al limpiar manuales');
    return res.json();
  },

  async importNotebookLmManual(data: {
    manualId?: string;
    title?: string;
    subject?: string;
    targetLevel: string;
    studentAge: string;
    orientation?: string;
    chapter: any;
  }): Promise<{ success: boolean; manual: any }> {
    const res = await fetch('/api/manuals/import-notebooklm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al importar material didáctico desde NotebookLM');
    return res.json();
  },

  async generateManualChapter(params: {
    manualId?: string;
    title?: string;
    subject: string;
    targetLevel: string;
    studentAge: string;
    orientation?: string;
    aiEngine?: 'notebooklm-rag' | 'gem-docente' | 'gem-pedagogico' | 'gem-disciplinar' | string;
    customDirectives?: string;
    incrementalTopic: string;
    generalSourceInstructions?: string;
    sources: Array<{
      type: 'pdf' | 'youtube' | 'web' | 'plan' | 'notes';
      title: string;
      urlOrContent: string;
      instructions?: string;
      timeRange?: string;
      pageRange?: string;
    }>;
    priorPlanId?: string;
  }): Promise<{ success: boolean; jobId: string; message: string }> {
    const res = await fetch('/api/manuals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      console.error('[API Error /api/manuals]: Received non-JSON response:', text.slice(0, 300));
      throw new Error(`El servidor respondió con un formato inesperado (${res.status}). Por favor, intenta nuevamente.`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || 'Error al generar capítulo de manual');
    }
    return res.json();
  },

  // Custom Gems Management API
  async getCustomGems(): Promise<CustomGem[]> {
    const res = await fetch('/api/custom-gems');
    if (!res.ok) throw new Error('Error al obtener lista de Gems personalizados');
    const data = await res.json();
    return data.gems || [];
  },

  async saveCustomGem(params: { name: string; description?: string; directives: string }): Promise<CustomGem> {
    const res = await fetch('/api/custom-gems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al guardar Gem personalizado');
    }
    const data = await res.json();
    return data.gem;
  },

  async deleteCustomGem(id: string): Promise<boolean> {
    const res = await fetch(`/api/custom-gems/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar Gem');
    return true;
  },

  async generateGemDirectives(params: {
    idea: string;
    subject?: string;
    orientation?: string;
    studentAge?: string;
  }): Promise<string> {
    const res = await fetch('/api/custom-gems/generate-directives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al generar directivas con IA');
    }
    const data = await res.json();
    return data.directives;
  },

  async extractYoutubeTranscription(url: string): Promise<{
    success: boolean;
    url: string;
    videoTitle: string;
    transcriptText: string;
    duration: string;
  }> {
    const res = await fetch('/api/youtube/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error('Error al transcribir video de YouTube');
    return res.json();
  },

  // MVP Module 3: Activities & Google Forms -> Classroom
  async getActivities(): Promise<any[]> {
    const res = await fetch('/api/activities');
    if (!res.ok) throw new Error('Error al obtener actividades interactivas');
    return res.json();
  },

  async generateFormActivity(params: {
    topic: string;
    ageGroup: string;
    activityType: string;
    courseId: string;
    questionCount?: number;
  }): Promise<{ success: boolean; activity: any; message: string }> {
    const res = await fetch('/api/activities/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al generar formulario');
    return res.json();
  },

  async publishActivityToClassroom(activityId: string): Promise<{ success: boolean; message: string; activity: any }> {
    const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/publish-classroom`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Error al publicar en Classroom');
    return res.json();
  },

  // MVP Module 4: Intelligent Async Auto-Feedback & Sheets Gradebook
  async startAutoFeedback(activityId: string): Promise<{ success: boolean; jobId: string; message: string }> {
    const res = await fetch('/api/evaluations/auto-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityId }),
    });
    if (!res.ok) throw new Error('Error al iniciar corrección automática');
    return res.json();
  },

  async getGradebookConsolidated(): Promise<any[]> {
    const res = await fetch('/api/gradebook/consolidated');
    if (!res.ok) throw new Error('Error al obtener libretas consolidadas');
    return res.json();
  },

  async consolidateGradebookToSheets(params: {
    courseId: string;
    term: string;
    weights?: { tp: number; exam: number; rec: number };
  }): Promise<{ success: boolean; jobId: string; message: string }> {
    const res = await fetch('/api/gradebook/consolidate-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al consolidar en Google Sheets');
    return res.json();
  },

  // Async Jobs System
  async getAsyncJobs(): Promise<any[]> {
    const res = await fetch('/api/async-jobs');
    if (!res.ok) throw new Error('Error al consultar tareas en segundo plano');
    return res.json();
  },

  async getAsyncJob(id: string): Promise<any> {
    const res = await fetch(`/api/async-jobs/${encodeURIComponent(id)}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  },

  // NotebookLM & Multimodal Toolset (Across 4 Modules)
  async optimizeTokens(params: { text: string; targetRatio?: number }): Promise<{
    success: boolean;
    originalTokens: number;
    optimizedTokens: number;
    savedTokens: number;
    percentageSaved: number;
    compressedContent: string;
    keyPoints: string[];
  }> {
    const res = await fetch('/api/notebooklm/optimize-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al optimizar tokens');
    return res.json();
  },

  async generateAudioOverview(params: {
    title: string;
    content?: string;
    courseName?: string;
    subject?: string;
  }): Promise<{
    success: boolean;
    title: string;
    duration: string;
    speakers: string[];
    script: Array<{ speaker: string; role: string; avatar: string; text: string }>;
    summaryText: string;
  }> {
    const res = await fetch('/api/notebooklm/audio-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al generar resumen de audio');
    return res.json();
  },

  async analyzeVideoPedagogical(params: {
    videoUrl: string;
    transcript?: string;
    moduleType: string;
  }): Promise<{
    success: boolean;
    videoUrl: string;
    moduleType: string;
    pedagogicalOutput: {
      summary: string;
      keyConcepts: string[];
      suggestedQuestions: string[];
      suggestedClassActivity: string;
    };
  }> {
    const res = await fetch('/api/notebooklm/video-to-pedagogical', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al analizar video para docencia');
    return res.json();
  },

  // Calendar & Timetable API
  async getCalendarEvents(params?: { courseId?: string; category?: string }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.courseId) q.set('courseId', params.courseId);
    if (params?.category) q.set('category', params.category);
    const res = await fetch(`/api/calendar/events?${q.toString()}`);
    if (!res.ok) throw new Error('Error al obtener eventos del calendario');
    const data = await res.json();
    return data.events || [];
  },

  async createCalendarEvent(eventData: any): Promise<any> {
    const res = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    });
    if (!res.ok) throw new Error('Error al crear evento de calendario');
    const data = await res.json();
    return data.event;
  },

  async deleteCalendarEvent(id: string): Promise<void> {
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Error al eliminar evento');
  },

  async syncCourseSchedules(targetCourseId?: string): Promise<{ success: boolean; syncedCount: number; message: string }> {
    const res = await fetch('/api/calendar/sync-course-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCourseId }),
    });
    if (!res.ok) throw new Error('Error al sincronizar horarios de materias');
    return res.json();
  },

  // Storage & deduplication helpers for instant local cache access
  getLocalCourses,
  getLocalStudents,
  deduplicateCourses,
  deduplicateStudents,
};

