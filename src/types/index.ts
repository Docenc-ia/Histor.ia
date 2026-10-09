export interface Course {
  id: string;
  name: string;
  subject?: string;
  grade?: string;
  orientation?: string; // e.g. "Nat", "Soc", "Soc1", "Eco"
  division?: string;    // e.g. "S2", "S1", "S3", "S4"
  room?: string;
  schedule?: string;
  color?: string;
  studentsCount?: number;
  classroomCourseId?: string;
  classroomSynced?: boolean;
  driveFolderId?: string;
  driveFolderUrl?: string;
  attendanceFolderId?: string;
  attendanceFolderUrl?: string;
  gradesFolderId?: string;
  gradesFolderUrl?: string;
  dispositionSheetId?: string;
  dispositionSheetUrl?: string;
  gradesSheetId?: string;
  gradesSheetUrl?: string;
  code?: string;
  gradeLevel?: string;
  studentCount?: number;
  description?: string;
  section?: string;
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

export interface StudentObservation {
  id: string;
  studentId: string;
  courseId: string;
  text: string;
  reportUrl?: string; // Enlace a informe psicopedagógico o documento de Drive
  date: string;
  timestamp: number;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface StudentHistoryItem {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  date: string; // dd/MM/yyyy
  time: string; // HH:mm:ss
  action: string; // e.g. "Ausencia", "Llegada tarde", "Uso indebido de celular", "Otros: ..."
  category: 'Ausencia' | 'Disposición' | 'Llegada tarde' | 'Asistencia' | 'Calificación' | 'Sistema';
  term?: '1c' | '2c';
  pointsChange?: number;
  resultingDisposition?: number;
  previousDisposition?: number;
  timestamp: number;
  messageSent?: boolean;
  messageText?: string;
  notificationMethod?: 'classroom' | 'gmail' | 'whatsapp' | 'none';
  notifiedAt?: string;
}

export interface AbsencePresetTemplate {
  id: string;
  name: string;
  channel: 'classroom' | 'gmail' | 'any';
  text: string;
  category?: 'all' | 'Ausencia' | 'Disposición';
  associatedReason?: string;
  isDefault?: boolean;
  createdAt?: number;
}

export interface AbsenceNotificationSettings {
  autoNotify: boolean; // Si true, envía o abre confirmación automática al pulsar +1 Falta o bajar disposición
  channel: 'classroom' | 'gmail'; // classroom anuncio individual vs correo gmail
  templateClassroom: string;
  templateGmail: string;
  templateConductClassroom?: string;
  templateConductGmail?: string;
  dontShowPopupOnAbsence?: boolean; // Si true, registra ausencias sin ventana emergente para enviar avisos masivos al final
  dontShowPopupOnDisposition?: boolean; // Si true, registra conducta sin ventana emergente para enviar avisos al final
}

export interface StudentDispositionData {
  totalAbsences: number;
  totalLates?: number;
  totalDisposition: number; // starts at 10
}

export interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  notes?: string;
}

export interface LessonPlan {
  id: string;
  courseId: string;
  title: string;
  unit: string;
  date: string;
  duration: string;
  status: 'Borrador' | 'Aprobada' | 'Completada';
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
  evaluationType: 'Examen' | 'Trabajo Práctico' | 'Participación' | 'Proyecto';
  term: '1er Trimestre' | '2do Trimestre' | '3er Trimestre';
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
  type: 'doc' | 'sheet' | 'slide' | 'pdf' | 'folder';
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
  status: 'Publicada' | 'Borrador' | 'Calificada';
  submittedCount: number;
  assignedCount: number;
  driveAttachmentName?: string;
  classroomUrl?: string;
}

export interface WorkspaceServiceStatus {
  name: string;
  enabled: boolean;
  scope: string;
  purpose: string;
  connected: boolean;
  icon: string;
}

export interface TeacherProfile {
  id?: string;
  name: string;
  email: string;
  school: string;
  role: string;
  avatar: string;
  permissions?: string[];
  scopes?: string[];
}

export interface StudentSubmission {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentAvatar: string;
  status: 'Entregado' | 'Calificado' | 'Pendiente' | 'Entrega Tardía';
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
  type: 'doc' | 'sheet' | 'slide' | 'pdf';
  url: string;
  size?: string;
}

export interface TeacherTask {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  description: string;
  category: 'Tarea' | 'Trabajo Práctico' | 'Proyecto' | 'Evaluación';
  dueDate: string;
  maxPoints: number;
  status: 'Publicada' | 'Borrador' | 'Cerrada';
  driveAttachments: TaskAttachment[];
  assignedCount: number;
  submittedCount: number;
  gradedCount: number;
  submissions: StudentSubmission[];
  createdAt: string;
}

export interface AsyncJob {
  id: string;
  type: 'rag_lesson_plan' | 'interactive_manual' | 'mass_correction' | 'export_sheets';
  title: string;
  status: 'en_cola' | 'procesando' | 'finalizado' | 'fallido';
  progress: number; // 0 - 100
  currentStep: string;
  createdAt: string;
  completedAt?: string;
  params: any;
  result?: any;
  logs: string[];
}

export interface RagDocumentSource {
  id: string;
  category: 'plantilla_institucional' | 'normativa_oficial' | 'bibliografia_propia';
  name: string;
  size?: string;
  snippet?: string;
  uploadedAt: string;
}

export interface RagPlanResult {
  id: string;
  courseId: string;
  title: string;
  subject: string;
  gradeLevel: string;
  studentAge: string;
  institutionalTemplateName: string;
  sections: {
    fundamentacion: string;
    expectativasLogro: string[];
    contenidosPorUnidad: {
      unidad: string;
      nombre: string;
      temas: string[];
      cronograma: string;
    }[];
    estrategiasEnsenanza: string[];
    criteriosEvaluacion: string[];
    bibliografiaObligatoria: string[];
  };
  googleDocUrl: string;
  googleDocId: string;
  createdAt: string;
  generatedDocContent?: string;
}

export interface ManualSourceInput {
  id: string;
  type: 'pdf' | 'youtube' | 'web' | 'notes' | 'plan';
  title: string;
  urlOrContent: string;
  processedSummary?: string;
  instructions?: string;
  timeRange?: string;
  pageRange?: string;
}

export interface ManualChapter {
  id: string;
  topicTitle: string;
  order: number;
  intro: string;
  contentBody: string;
  keyConcepts: string[];
  callouts: {
    type: 'clave' | 'ejemplo' | 'curiosidad' | 'reflexion';
    text: string;
  }[];
  suggestedIllustrations: string[];
  comprehensionActivities: string[];
}

export interface InteractiveManual {
  id: string;
  title: string;
  subject: string;
  targetLevel: string;
  studentAge: string;
  associatedPlanId?: string;
  chapters: ManualChapter[];
  driveFileUrl: string;
  driveFolder: string;
  lastUpdated: string;
}

export interface CustomGem {
  id: string;
  name: string;
  description: string;
  directives: string;
  createdAt: string;
}

export interface FormQuestionItem {
  id: string;
  questionText: string;
  type: 'multiple_choice' | 'open_text' | 'case_study' | 'open';
  options?: string[];
  rubricCriterion?: string;
  points: number;
  prompt?: string;
  correctAnswer?: string;
  expectedCriteria?: string;
}

export interface FormActivity {
  id: string;
  title: string;
  subject: string;
  courseId: string;
  ageGroup: string;
  activityType: 'Diagnóstica' | 'Formativa' | 'Sumativa' | 'Trabajo Práctico' | 'Autoevaluación';
  description: string;
  questions: FormQuestionItem[];
  googleFormUrl: string;
  googleFormsUrl?: string;
  submissionsCount?: number;
  classroomCourseId?: string;
  publishedToClassroom: boolean;
  publishedAt?: string;
  submissions: StudentEvaluationSubmission[];
  rubricCriteria?: string[] | string;
}

export interface StudentEvaluationSubmission {
  id?: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  submittedAt: string;
  responses: {
    questionId: string;
    questionText: string;
    studentAnswer: string;
    evaluatedScore?: number;
    maxScore: number;
    aiFeedback?: string;
  }[];
  overallScore?: number;
  score?: number;
  grade?: number;
  maxScore: number;
  aiFeedback?: string;
  answers?: any;
  overallFeedback?: {
    strengths: string[];
    areasForImprovement: string[];
    pedagogicalGuidance: string;
  };
  status: 'Entregado' | 'Procesando' | 'Corregido';
}

export interface GradebookConsolidatedReport {
  id: string;
  courseId: string;
  courseName: string;
  term: string;
  generatedAt: string;
  googleSheetsUrl: string;
  categories: {
    trabajosPracticosWeight: number;
    examenesWeight: number;
    recuperatoriosWeight: number;
  };
  records: {
    studentId: string;
    studentName: string;
    tpGrades: number[];
    tpAverage: number;
    examGrades: number[];
    examAverage: number;
    retakeGrade?: number;
    finalAverage: number;
    academicStatus: 'Aprobado' | 'En Proceso' | 'A Recuperatorio';
    pedagogicalNotes: string;
  }[];
  students?: any[];
}

export type CalendarEventCategory = 'materia' | 'colegio' | 'examen' | 'reunion' | 'feriado';

export interface CalendarEventItem {
  id: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string; // ISO string e.g. "2026-09-18T08:00:00" or date "2026-09-18"
  end: string;   // ISO string e.g. "2026-09-18T09:30:00" or date "2026-09-18"
  isAllDay?: boolean;
  category: CalendarEventCategory;
  courseId?: string;
  courseName?: string;
  color?: string;
  dayOfWeek?: number; // 1 = Monday, ..., 5 = Friday (for recurring weekly timetable)
  startTime?: string; // e.g. "08:00"
  endTime?: string;   // e.g. "09:30"
  recurrence?: string; // e.g. "Semanal", "Única vez"
  htmlLink?: string;
  syncedToGoogle?: boolean;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
}

