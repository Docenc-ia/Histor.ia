import { Course, Student, LessonPlan, GradeEntry, DriveResource, ClassroomTask, TeacherTask, StudentSubmission, TeacherProfile, CustomGem } from '../types';

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
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error('Error al cargar cursos');
    const data = await res.json();
    return data.courses;
  },

  async createCourse(courseData: Partial<Course>): Promise<Course> {
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(courseData),
    });
    if (!res.ok) throw new Error('Error al crear curso');
    const data = await res.json();
    return data.course;
  },

async bulkImportCourses(coursesList: Partial<Course>[]): Promise<{ success: boolean; message: string; courses: Course[] }> {
    // 1. Diagnóstico: Verificamos qué datos exactos estamos intentando enviar
    console.log("Datos que se están enviando al servidor:", coursesList);

    const res = await fetch('/api/courses/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses: coursesList }),
    });

    if (!res.ok) {
      // 2. Diagnóstico: Capturamos el error crudo del servidor para ver qué falló realmente
      const errorText = await res.text();
      console.error("El servidor rechazó la petición. Código:", res.status, "Detalle:", errorText);

      let err: any = {};
      try { 
        err = JSON.parse(errorText); 
      } catch (e) {
        // Si no es un JSON, mantenemos el texto crudo para investigar
      }
      
      throw new Error(err.error || `Error del servidor: ${res.status}. Revisa la consola para más detalles.`);
    }
    
    return res.json();
  },

  async syncCourseStudents(updates: Array<{ id: string; studentsCount: number }>): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/courses/sync-students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al sincronizar alumnos de materias');
    }
    return res.json();
  },

  async updateCourse(id: string, patch: Partial<Course>): Promise<{ success: boolean; course: Course }> {
    const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar materia');
    }
    return res.json();
  },

  async deleteCourse(id: string): Promise<{ success: boolean; message: string; courseId: string }> {
    const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar materia');
    }
    return res.json();
  },

  async clearAllCourses(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/courses/clear', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al limpiar materias de prueba');
    }
    return res.json();
  },

  async restoreDemoCourses(): Promise<{ success: boolean; message: string; courses: Course[] }> {
    const res = await fetch('/api/courses/restore-demo', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al restaurar materias de prueba');
    }
    return res.json();
  },

  // Students
  async getStudents(courseId?: string): Promise<Student[]> {
    const url = courseId ? `/api/students?courseId=${encodeURIComponent(courseId)}` : '/api/students';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar alumnos');
    const data = await res.json();
    return data.students;
  },

  async createStudent(studentData: { courseId: string; firstName: string; lastName: string; email?: string }): Promise<Student> {
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(studentData),
    });
    if (!res.ok) throw new Error('Error al registrar estudiante');
    const data = await res.json();
    return data.student;
  },

  async syncCourseStudentsRoster(courseId: string, students: Partial<Student>[]): Promise<{ success: boolean; count: number; students: Student[] }> {
    const res = await fetch('/api/students/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, students }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al sincronizar nómina de alumnos');
    }
    return res.json();
  },

  async cleanMockStudents(): Promise<{ success: boolean; remaining: number }> {
    const res = await fetch('/api/students/clear-mock', { method: 'POST' });
    if (!res.ok) return { success: false, remaining: 0 };
    return res.json();
  },

  // Attendance
  async saveAttendance(courseId: string, date: string, records: { studentId: string; status: string }[]): Promise<{ message: string }> {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, date, records }),
    });
    if (!res.ok) throw new Error('Error al guardar asistencia');
    return res.json();
  },

  // Student Disposition & Absences System (Google Sheets script integration)
  async getDisposition(courseId?: string, studentId?: string): Promise<{
    disposition: Record<string, { totalAbsences: number; totalDisposition: number }>;
    history: any[];
  }> {
    const params = new URLSearchParams();
    if (courseId) params.append('courseId', courseId);
    if (studentId) params.append('studentId', studentId);
    const res = await fetch(`/api/disposition?${params.toString()}`);
    if (!res.ok) throw new Error('Error al cargar disposición');
    return res.json();
  },

  async recordDisposition(data: {
    id?: string;
    studentId: string;
    studentName: string;
    courseId: string;
    action: string;
    category: 'Ausencia' | 'Disposición' | 'Llegada tarde';
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
    const res = await fetch('/api/disposition/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al registrar acción');
    return res.json();
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

