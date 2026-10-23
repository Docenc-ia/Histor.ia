import {
  LessonPlan,
  GradeEntry,
  DriveResource,
  ClassroomTask,
  TeacherTask,
  StudentSubmission,
} from '../types';
import { firestoreSync, getActiveUserId } from './firestoreSync';
import { getUserStorageKey } from './storageHelpers';
import { safeSetLocalStorageItem } from '../utils/storageGuard';

/**
 * Secondary API endpoints for Tasks, Conduct Options/Templates, Lesson Plans,
 * Gradebook, Drive Resources, Classroom Tasks, Workspace Config, and Calendar.
 * Extracted from api.ts to keep core course/student/attendance synchronization modular.
 */
export const apiSecondaryEndpoints = {
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

  // Custom Conduct Options
  async getConductOptions(teacher?: string): Promise<string[]> {
    const userId = getActiveUserId();
    const localKey = getUserStorageKey('docencia_conduct_options');
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (_) {}
    }

    if (userId) {
      const cloud = await firestoreSync.loadUserSetting<string[]>(userId, 'conduct_options');
      if (Array.isArray(cloud) && cloud.length > 0) {
        safeSetLocalStorageItem(localKey, JSON.stringify(cloud));
        return cloud;
      }
    }

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
    const userId = getActiveUserId();
    const localKey = getUserStorageKey('docencia_conduct_options');
    safeSetLocalStorageItem(localKey, JSON.stringify(options));
    if (userId) {
      firestoreSync.saveUserSetting(userId, 'conduct_options', options).catch(() => {});
    }
    try {
      const res = await fetch('/api/conduct-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher, options }),
      });
      return res.ok;
    } catch {
      return true;
    }
  },

  async getConductTemplates(teacher?: string): Promise<Record<string, string>> {
    const userId = getActiveUserId();
    const localKey = getUserStorageKey('docencia_conduct_templates');
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
        }
      } catch (_) {}
    }

    if (userId) {
      const cloud = await firestoreSync.loadUserSetting<Record<string, string>>(userId, 'conduct_templates');
      if (cloud && typeof cloud === 'object' && Object.keys(cloud).length > 0) {
        safeSetLocalStorageItem(localKey, JSON.stringify(cloud));
        return cloud;
      }
    }

    try {
      const url = teacher ? `/api/conduct-templates?teacher=${encodeURIComponent(teacher)}` : '/api/conduct-templates';
      const res = await fetch(url);
      if (!res.ok) return {};
      const data = await res.json();
      return data.templates && typeof data.templates === 'object' ? data.templates : {};
    } catch {
      return {};
    }
  },

  async saveConductTemplates(teacher: string, templates: Record<string, string>): Promise<boolean> {
    const userId = getActiveUserId();
    const localKey = getUserStorageKey('docencia_conduct_templates');
    safeSetLocalStorageItem(localKey, JSON.stringify(templates));
    if (userId) {
      firestoreSync.saveUserSetting(userId, 'conduct_templates', templates).catch(() => {});
    }
    try {
      const res = await fetch('/api/conduct-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher, templates }),
      });
      return res.ok;
    } catch {
      return true;
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

  // Workspace Config
  async getWorkspaceConfig() {
    const res = await fetch('/api/workspace/config');
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
