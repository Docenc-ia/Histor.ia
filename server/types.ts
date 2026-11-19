/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared TypeScript domain interfaces for the Docenc.IA Express backend.
 */

export interface Course {
  id: string;
  name: string;
  subject: string;
  grade: string;
  room: string;
  schedule: string;
  color: string;
  studentsCount: number;
  classroomCourseId?: string;
  classroomSynced: boolean;
  driveFolderId?: string;
  driveFolderUrl?: string;
  attendanceFolderId?: string;
  attendanceFolderUrl?: string;
  gradesFolderId?: string;
  gradesFolderUrl?: string;
  gradesSheetId?: string;
  gradesSheetUrl?: string;
  code?: string;
  section?: string;
  orientation?: string;
  division?: string;
  schoolYear?: string;
}

export interface Student {
  id: string;
  courseId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string;
  attendanceRate: number;
  averageGrade: number;
  notes: string;
}

export interface LessonPlan {
  id: string;
  courseId: string;
  title: string;
  unit: string;
  date: string;
  duration: string;
  status: "Borrador" | "Aprobada" | "Completada";
  objective: string;
  competencies: string[];
  inicio: string;
  desarrollo: string;
  cierre: string;
  assessment: string;
  materials: string[];
  googleDocUrl?: string;
  googleDocId?: string;
  lastModified: string;
}

export interface GradeEntry {
  id: string;
  courseId: string;
  studentId: string;
  evaluationTitle: string;
  evaluationType: "Examen" | "Trabajo Práctico" | "Participación" | "Proyecto";
  term: "1er Trimestre" | "2do Trimestre" | "3er Trimestre";
  score: number;
  maxScore: number;
  feedback?: string;
  date: string;
}

export interface DriveResource {
  id: string;
  courseId?: string;
  name: string;
  mimeType: string;
  type: "doc" | "sheet" | "slide" | "pdf" | "folder";
  size: string;
  folder: string;
  modifiedTime: string;
  googleDriveUrl: string;
  sharedWithClassroom: boolean;
}

export interface ClassroomTask {
  id: string;
  courseId: string;
  title: string;
  description: string;
  dueDate: string;
  maxPoints: number;
  status: "Publicada" | "Borrador" | "Calificada";
  submittedCount: number;
  assignedCount: number;
  driveAttachmentName?: string;
  classroomUrl?: string;
}

export interface StudentSubmission {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentAvatar: string;
  status: "Entregado" | "Calificado" | "Pendiente" | "Entrega Tardía";
  submittedAt?: string;
  submittedFileUrl?: string;
  submittedFileName?: string;
  grade?: number;
  maxPoints: number;
  feedback?: string;
}

export interface TaskAttachment {
  id: string;
  name: string;
  type: "doc" | "sheet" | "slide" | "pdf";
  url: string;
  size?: string;
}

export interface TeacherTask {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  description: string;
  category: "Tarea" | "Trabajo Práctico" | "Proyecto" | "Evaluación";
  dueDate: string;
  maxPoints: number;
  status: "Publicada" | "Borrador" | "Cerrada";
  driveAttachments: TaskAttachment[];
  assignedCount: number;
  submittedCount: number;
  gradedCount: number;
  submissions: StudentSubmission[];
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  school: string;
  scopes: string[];
  permissions: string[];
  lastLogin: string;
  token?: string;
  sessionSecret?: string;
}

export interface StoredTeacherAccount {
  email: string;
  passwordHash: string;
  name: string;
  school: string;
  updatedAt: string;
}

export interface PersistedSessionRecord {
  hash: string;
  expiresAt: number;
}

export interface CachedGoogleTokenVerification {
  email: string;
  expiresAt: number;
}

export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface DispositionRecord {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  date: string; // dd/MM/yyyy
  time: string; // HH:mm:ss
  action: string;
  category: "Ausencia" | "Disposición" | "Llegada tarde" | "Sistema" | "Calificación" | string;
  pointsChange?: number;
  previousDisposition?: number;
  resultingDisposition?: number;
  timestamp: number;
  messageSent?: boolean;
  messageText?: string;
  notificationMethod?: "classroom" | "gmail" | "none";
  notifiedAt?: string;
}

export interface CalendarEventItemServer {
  id: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  category: "materia" | "colegio" | "examen" | "reunion" | "feriado";
  courseId?: string;
  courseName?: string;
  color?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  recurrence?: string;
  htmlLink?: string;
  syncedToGoogle?: boolean;
}

export interface TeacherWorkspaceSlice {
  workspaceKey: string;
  coursesFile: string;
  studentsFile: string;
  dispositionFile: string;
  courses: Course[];
  students: Student[];
  coursesLoadedFromDisk: boolean;
  studentsLoadedFromDisk: boolean;
  studentDispositionMap: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
  studentHistoryList: DispositionRecord[];
  lessonPlans: LessonPlan[];
  grades: GradeEntry[];
  driveResources: DriveResource[];
  classroomTasks: ClassroomTask[];
  teacherTasks: TeacherTask[];
  calendarEvents: CalendarEventItemServer[];
  initialized: boolean;
}
