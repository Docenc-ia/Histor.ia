import { Course, Student, LessonPlan, GradeEntry, DriveResource, ClassroomTask, TeacherTask, StudentSubmission, TeacherProfile, CustomGem } from '../types';
import { firestoreSync, getActiveUserId } from './firestoreSync';

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

function getLocalCourses(): Course[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    let raw = localStorage.getItem(key);
    if (!raw && key !== STORAGE_KEYS.COURSES) {
      raw = localStorage.getItem(STORAGE_KEYS.COURSES);
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

function saveLocalCourses(coursesList: Course[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getUserStorageKey(STORAGE_KEYS.COURSES);
    localStorage.setItem(key, JSON.stringify(coursesList));
  } catch (_) {}
}

function getLocalStudents(courseId?: string): Student[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    let raw = localStorage.getItem(key);
    if (!raw && key !== STORAGE_KEYS.STUDENTS) {
      raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    }
    if (raw) {
      const parsed: Student[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return courseId ? parsed.filter((s) => s.courseId === courseId) : parsed;
      }
    }
  } catch (_) {}
  return [];
}

function saveLocalStudents(courseId: string, studentsList: Student[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getUserStorageKey(STORAGE_KEYS.STUDENTS);
    const all = getLocalStudents();
    const rest = all.filter((s) => s.courseId !== courseId);
    const updated = [...rest, ...studentsList];
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (_) {}
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
    if (userId) {
      try {
        const cloudCourses = await firestoreSync.loadCourses(userId);
        if (cloudCourses && cloudCourses.length > 0) {
          saveLocalCourses(cloudCourses);
          return cloudCourses;
        }
      } catch (err) {
        console.warn('Firestore loadCourses failed, trying other sources:', err);
      }
    }

    try {
      const res = await fetch('/api/courses');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.courses)) {
          if (data.courses.length > 0) {
            saveLocalCourses(data.courses);
            if (userId) {
              firestoreSync.saveCourses(userId, data.courses).catch(() => {});
            }
            return data.courses;
          }
          const local = getLocalCourses();
          if (local.length > 0) return local;
          return data.courses;
        }
      }
    } catch (e) {
      console.warn('Backend /api/courses unavailable, using local storage:', e);
    }
    return getLocalCourses();
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
          const list = getLocalCourses().filter((c) => c.id !== data.course.id);
          list.push(data.course);
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
      id: courseData.id || `c-${Date.now().toString().slice(-4)}`,
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
    const list = getLocalCourses();
    list.push(newCourse);
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
        if (data && Array.isArray(data.courses)) {
          saveLocalCourses(data.courses);
          const uId = getActiveUserId();
          if (uId) firestoreSync.saveCourses(uId, data.courses).catch(() => {});
        }
        return data;
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

      const existingIndex = processed.findIndex((c) => {
        if (incomingClassroomId && (c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId)) return true;
        if (incomingId && (c.id === incomingId || c.classroomCourseId === incomingId)) return true;
        const itemSec = (item.section || '').trim().toLowerCase();
        const cSec = (c.section || '').trim().toLowerCase();
        return c.name.trim().toLowerCase() === courseName.toLowerCase() && (itemSec === '' || cSec === itemSec);
      });

      if (existingIndex >= 0) {
        processed[existingIndex] = {
          ...processed[existingIndex],
          name: courseName || processed[existingIndex].name,
          subject: courseSubject || processed[existingIndex].subject,
          studentsCount: studentsNum || processed[existingIndex].studentsCount,
          classroomSynced: true,
          classroomCourseId: incomingClassroomId || processed[existingIndex].classroomCourseId,
        };
        updatedCount++;
      } else {
        const newCourse: Course = {
          id: item.id || `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`,
          name: courseName,
          subject: courseSubject,
          grade: item.grade || 'Secundaria',
          room: item.room || 'Aula Asignada',
          schedule: item.schedule || 'Horario a coordinar',
          color: item.color || '#137333',
          studentsCount: studentsNum,
          classroomSynced: true,
          classroomCourseId: incomingClassroomId || `gc-${Math.random().toString(36).substring(2, 7)}`,
          code: item.code || Math.random().toString(36).substring(2, 8),
          section: item.section || '1',
          schoolYear: item.schoolYear || '2026',
          driveFolderId: item.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
        };
        processed.push(newCourse);
        addedCount++;
      }
    }

    saveLocalCourses(processed);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveCourses(userId, processed).catch((err) => console.warn('Firestore bulk import sync warning:', err));
    }

    return {
      success: true,
      message: addedCount > 0
        ? `Se agregaron ${addedCount} materias nuevas.`
        : `Las materias ya estaban cargadas previamente.`,
      courses: processed,
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
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const list = getLocalCourses().filter((c) => c.id !== id);
        saveLocalCourses(list);
        const userId = getActiveUserId();
        if (userId) firestoreSync.deleteCourse(userId, id).catch(() => {});
        return res.json();
      }
    } catch (_) {}

    const list = getLocalCourses().filter((c) => c.id !== id);
    saveLocalCourses(list);
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.deleteCourse(userId, id).catch(() => {});
    }
    return { success: true, message: 'Materia eliminada correctamente', courseId: id };
  },

  async clearAllCourses(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/courses/clear', {
        method: 'POST',
      });
      if (res.ok) {
        saveLocalCourses([]);
        return res.json();
      }
    } catch (_) {}

    saveLocalCourses([]);
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
    const userId = getActiveUserId();
    if (userId) {
      try {
        const cloudStudents = await firestoreSync.loadStudents(userId, courseId);
        if (cloudStudents && cloudStudents.length > 0) {
          if (courseId) {
            saveLocalStudents(courseId, cloudStudents);
          }
          return cloudStudents;
        }
      } catch (err) {
        console.warn('Firestore loadStudents error:', err);
      }
    }

    try {
      const url = courseId ? `/api/students?courseId=${encodeURIComponent(courseId)}` : '/api/students';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.students)) {
          if (data.students.length > 0) {
            if (courseId) {
              saveLocalStudents(courseId, data.students);
            }
            if (userId && courseId) {
              firestoreSync.saveStudents(userId, courseId, data.students).catch(() => {});
            }
            return data.students;
          }
          const local = getLocalStudents(courseId);
          if (local.length > 0) return local;
          return data.students;
        }
      }
    } catch (e) {
      console.warn('Backend /api/students unavailable, reading from local storage:', e);
    }
    return getLocalStudents(courseId);
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
    disposition: Record<string, { totalAbsences: number; totalDisposition: number }>;
    history: any[];
  }> {
    const userId = getActiveUserId();
    if (userId) {
      try {
        const cloud = await firestoreSync.loadDisposition(userId);
        if (cloud.history.length > 0 || Object.keys(cloud.disposition).length > 0) {
          return cloud;
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
      if (res.ok) return res.json();
    } catch (_) {}

    let disposition: Record<string, { totalAbsences: number; totalDisposition: number }> = {};
    let history: any[] = [];
    if (typeof window !== 'undefined') {
      try {
        const dKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION);
        const hKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION_HISTORY);
        const rawDisp = localStorage.getItem(dKey) || (dKey !== STORAGE_KEYS.DISPOSITION ? localStorage.getItem(STORAGE_KEYS.DISPOSITION) : null);
        if (rawDisp) disposition = JSON.parse(rawDisp);
        const rawHist = localStorage.getItem(hKey) || (hKey !== STORAGE_KEYS.DISPOSITION_HISTORY ? localStorage.getItem(STORAGE_KEYS.DISPOSITION_HISTORY) : null);
        if (rawHist) history = JSON.parse(rawHist);
      } catch (_) {}
    }
    return { disposition, history };
  },

  async recordDisposition(data: {
    id?: string;
    studentId: string;
    studentName: string;
    courseId: string;
    action: string;
    category: 'Ausencia' | 'Disposición' | 'Llegada tarde' | 'Asistencia' | 'Calificación' | 'Sistema';
    detail?: string;
    date?: string;
    time?: string;
    timestamp?: number;
    messageSent?: boolean;
    messageText?: string;
    notificationMethod?: 'classroom' | 'gmail' | 'none';
    notifiedAt?: string;
  }): Promise<{
    success: boolean;
    record: any;
    summary: { totalAbsences: number; totalDisposition: number };
    allDisposition: Record<string, { totalAbsences: number; totalDisposition: number }>;
  }> {
    let allDisposition: Record<string, { totalAbsences: number; totalDisposition: number }> = {};
    let history: any[] = [];
    if (typeof window !== 'undefined') {
      try {
        const dKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION);
        const hKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION_HISTORY);
        const rawDisp = localStorage.getItem(dKey) || (dKey !== STORAGE_KEYS.DISPOSITION ? localStorage.getItem(STORAGE_KEYS.DISPOSITION) : null);
        if (rawDisp) allDisposition = JSON.parse(rawDisp);
        const rawHist = localStorage.getItem(hKey) || (hKey !== STORAGE_KEYS.DISPOSITION_HISTORY ? localStorage.getItem(STORAGE_KEYS.DISPOSITION_HISTORY) : null);
        if (rawHist) history = JSON.parse(rawHist);
      } catch (_) {}
    }

    const current = (allDisposition[data.studentId] as any) || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    if (current.totalDisposition === undefined) current.totalDisposition = 10;
    if (current.totalLates === undefined) current.totalLates = 0;
    if (current.totalAbsences === undefined) current.totalAbsences = 0;

    if (data.category === 'Ausencia') {
      current.totalAbsences += 1;
    } else if (data.category === 'Llegada tarde') {
      current.totalLates = (current.totalLates || 0) + 1;
    } else if (data.category === 'Disposición') {
      current.totalDisposition = Math.max(0, current.totalDisposition - 1);
    }
    allDisposition[data.studentId] = current;

    const newRecord = {
      id: data.id || `disp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      ...data,
      date: data.date || new Date().toISOString().split('T')[0],
      timestamp: data.timestamp || Date.now(),
    };
    // Ensure repeated actions are preserved, only skip if identical ID already exists
    const existingIndex = history.findIndex((h) => h.id === newRecord.id);
    if (existingIndex === -1) {
      history.unshift(newRecord);
    } else {
      history[existingIndex] = newRecord;
    }

    if (typeof window !== 'undefined') {
      try {
        const dKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION);
        const hKey = getUserStorageKey(STORAGE_KEYS.DISPOSITION_HISTORY);
        localStorage.setItem(dKey, JSON.stringify(allDisposition));
        localStorage.setItem(hKey, JSON.stringify(history));
      } catch (_) {}
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.saveDisposition(userId, newRecord).catch((e) => console.warn('Firestore saveDisposition warning:', e));
    }

    try {
      const res = await fetch('/api/disposition/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) return res.json();
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
    const res = await fetch(`/api/disposition/history/${encodeURIComponent(id)}/notification`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notificationData),
    });
    if (!res.ok) throw new Error('Error al actualizar notificación del historial');
    return res.json();
  },

  async deleteDispositionHistory(id: string): Promise<{ success: boolean; summary: any }> {
    const res = await fetch(`/api/disposition/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Error al revertir registro de historial');
    return res.json();
  },

  async resetDisposition(data: {
    studentId?: string;
    courseId?: string;
    resetWhat: 'disposition' | 'absences' | 'all';
  }): Promise<{ success: boolean; disposition: Record<string, any> }> {
    const res = await fetch('/api/disposition/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al reiniciar valores');
    return res.json();
  },

  async syncFullDisposition(data: {
    disposition: Record<string, any>;
    history: any[];
  }): Promise<{ success: boolean; count: number; disposition?: Record<string, any>; history?: any[] }> {
    try {
      const res = await fetch('/api/disposition/sync-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch {
      return { success: false, count: 0 };
    }
  },

  async getCourseDispositionSheet(courseId: string): Promise<{
    spreadsheetId?: string;
    url?: string;
    lastSyncedAt?: string;
  }> {
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`);
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  },

  async saveCourseDispositionSheet(
    courseId: string,
    data: { spreadsheetId: string; url: string; lastSyncedAt?: string }
  ): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/disposition-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch {
      return { success: false };
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
};

