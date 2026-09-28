import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
// @ts-ignore
import mammoth from "mammoth";

dotenv.config();

const PORT = 3000;

// In-memory persistent data store for the teacher session
interface Course {
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
  code?: string;
  section?: string;
  orientation?: string;
  division?: string;
  schoolYear?: string;
}

interface Student {
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

interface LessonPlan {
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

interface GradeEntry {
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

interface DriveResource {
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

interface ClassroomTask {
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

interface StudentSubmission {
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

interface TaskAttachment {
  id: string;
  name: string;
  type: "doc" | "sheet" | "slide" | "pdf";
  url: string;
  size?: string;
}

interface TeacherTask {
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

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  school: string;
  scopes: string[];
  permissions: string[];
  lastLogin: string;
}

// Initial active user state (null until user explicitly signs in)
let activeUser: AuthUser | null = null;

// Initial Datasets (persisted to disk so classes and students survive app closures)
let courses: Course[] = [];
let students: Student[] = [];

const COURSES_DATA_FILE = path.join(process.cwd(), "data", "courses.json");
const STUDENTS_DATA_FILE = path.join(process.cwd(), "data", "students.json");

function loadCoursesFromDisk() {
  try {
    if (fs.existsSync(COURSES_DATA_FILE)) {
      const raw = fs.readFileSync(COURSES_DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.courses)) {
        courses = parsed.courses;
      } else if (Array.isArray(parsed)) {
        courses = parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load courses from disk:", e);
  }
}

function saveCoursesToDisk() {
  try {
    const dir = path.dirname(COURSES_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COURSES_DATA_FILE, JSON.stringify({ courses }, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to save courses to disk:", e);
  }
}

function loadStudentsFromDisk() {
  try {
    if (fs.existsSync(STUDENTS_DATA_FILE)) {
      const raw = fs.readFileSync(STUDENTS_DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.students)) {
        students = parsed.students;
      } else if (Array.isArray(parsed)) {
        students = parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load students from disk:", e);
  }
}

function saveStudentsToDisk() {
  try {
    const dir = path.dirname(STUDENTS_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STUDENTS_DATA_FILE, JSON.stringify({ students }, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to save students to disk:", e);
  }
}

// Initial load from disk
loadCoursesFromDisk();
loadStudentsFromDisk();

let lessonPlans: LessonPlan[] = [];

let grades: GradeEntry[] = [];
let driveResources: DriveResource[] = [];
let classroomTasks: ClassroomTask[] = [];
let teacherTasks: TeacherTask[] = [];

// -------------------------------------------------------------
// MVP Data Structures: Async Jobs, RAG Planning, Manuals, Forms, Sheets
// -------------------------------------------------------------
interface AsyncJob {
  id: string;
  type: "rag_lesson_plan" | "interactive_manual" | "mass_correction" | "export_sheets";
  title: string;
  status: "en_cola" | "procesando" | "finalizado" | "fallido";
  progress: number;
  currentStep: string;
  createdAt: string;
  completedAt?: string;
  params: any;
  result?: any;
  logs: string[];
}

interface RagPlanResult {
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
}

interface ManualChapter {
  id: string;
  topicTitle: string;
  order: number;
  intro: string;
  contentBody: string;
  keyConcepts: string[];
  callouts: {
    type: "clave" | "ejemplo" | "curiosidad" | "reflexion";
    text: string;
  }[];
  suggestedIllustrations: string[];
  comprehensionActivities: string[];
}

interface InteractiveManual {
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

interface FormQuestionItem {
  id: string;
  questionText: string;
  type: "multiple_choice" | "open_text" | "case_study";
  options?: string[];
  rubricCriterion?: string;
  points: number;
}

interface FormActivity {
  id: string;
  title: string;
  subject: string;
  courseId: string;
  ageGroup: string;
  activityType: "Diagnóstica" | "Formativa" | "Sumativa" | "Trabajo Práctico" | "Autoevaluación";
  description: string;
  questions: FormQuestionItem[];
  googleFormUrl: string;
  classroomCourseId?: string;
  publishedToClassroom: boolean;
  publishedAt?: string;
  submissions: {
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
    maxScore: number;
    overallFeedback?: {
      strengths: string[];
      areasForImprovement: string[];
      pedagogicalGuidance: string;
    };
    status: "Entregado" | "Procesando" | "Corregido";
  }[];
}

interface GradebookConsolidatedReport {
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
    academicStatus: "Aprobado" | "En Proceso" | "A Recuperatorio";
    pedagogicalNotes: string;
  }[];
}

let asyncJobs: AsyncJob[] = [
  {
    id: "job-101",
    type: "rag_lesson_plan",
    title: "Planificación Anual Institucional Biología 4° A",
    status: "finalizado",
    progress: 100,
    currentStep: "Documento Google Docs generado y sincronizado en Drive",
    createdAt: "2026-09-09T08:00:00Z",
    completedAt: "2026-09-09T08:00:15Z",
    params: { subject: "Biología", gradeLevel: "4to Año", institutionalTemplate: "Plantilla Oficial Colegios 2026.docx" },
    result: { docUrl: "https://docs.google.com/document/d/plan-rag-4a-bio/edit" },
    logs: [
      "[08:00:01] Lectura de plantilla institucional vacía (14 secciones detectadas)...",
      "[08:00:04] Indexación y RAG de Diseño Curricular Provincial (NAP Biología)...",
      "[08:00:08] Cruce con bibliografía propia (Curtis & Barnes, 8va Edición)...",
      "[08:00:12] Generación y estructuración completa del syllabus...",
      "[08:00:15] Archivo Google Docs vinculado exitosamente en carpeta de la materia.",
    ],
  },
  {
    id: "job-102",
    type: "mass_correction",
    title: "Corrección Asincrónica TP N°1 Mitosis (5 alumnos)",
    status: "finalizado",
    progress: 100,
    currentStep: "Evaluación completada y notas volcadas a Libreta",
    createdAt: "2026-09-10T04:30:00Z",
    completedAt: "2026-09-10T04:30:12Z",
    params: { courseId: "c-101", taskTitle: "Informe de Laboratorio: Mitosis" },
    result: { correctedCount: 5, averageScore: 89.2 },
    logs: [
      "[04:30:01] 5 entregas de alumnos descargadas desde Classroom...",
      "[04:30:04] Análisis de textos abiertos contra rúbrica de precisión citológica...",
      "[04:30:08] Generando devolución formativa individualizada con fortalezas y áreas de mejora...",
      "[04:30:12] Notas publicadas y sincronizadas con Libreta de Calificaciones.",
    ],
  },
];

const sampleRagPlans: RagPlanResult[] = [
  {
    id: "rag-plan-1",
    courseId: "c-101",
    title: "Planificación Anual de Biología Celular y Genética",
    subject: "Biología Celular y Genética",
    gradeLevel: "Secundaria - 4° Año A",
    studentAge: "15-16 años",
    institutionalTemplateName: "Plantilla Oficial Institucional - Formato Escuela 2026.docx",
    sections: {
      fundamentacion: "La presente materia aborda los fundamentos de la biología celular, la herencia mendeliana y la biotecnología contemporánea, promoviendo el pensamiento crítico, la alfabetización científica y el trabajo colaborativo en laboratorio bajo lineamientos del Diseño Curricular y la visión pedagógica institucional.",
      expectativasLogro: [
        "Comprender la teoría celular y los procesos de división por mitosis y meiosis.",
        "Resolver problemas de genética mendeliana y relacionarlos con la variabilidad fenotípica.",
        "Utilizar instrumentos de laboratorio y registros digitales en Google Docs con rigor metodológico.",
        "Analizar debates bioéticos contemporáneos fundamentando posturas con base científica.",
      ],
      contenidosPorUnidad: [
        {
          unidad: "Unidad 1",
          nombre: "Organización Celular y Microscopía",
          temas: ["Estructura eucariota vs procariota", "Organelas y función", "Técnicas de tinción y microscopio"],
          cronograma: "Marzo - Mayo (1er Trimestre)",
        },
        {
          unidad: "Unidad 2",
          nombre: "Ciclo Celular, Mitosis y Meiosis",
          temas: ["Replicación del ADN", "Fases de la mitosis", "Meiosis y gametogénesis", "Gametos y anomalías cromosómicas"],
          cronograma: "Junio - Agosto (2do Trimestre)",
        },
        {
          unidad: "Unidad 3",
          nombre: "Genética Mendeliana y Biotecnología",
          temas: ["Leyes de Mendel", "Cruzas monohíbridas y dihíbridas", "Árboles genealógicos", "Ingeniería genética y CRISPR"],
          cronograma: "Septiembre - Noviembre (3er Trimestre)",
        },
      ],
      estrategiasEnsenanza: [
        "Aprendizaje Basado en Indagación (ABI) con bitácoras digitales.",
        "Prácticas experimentales semanales en el laboratorio escolar.",
        "Uso de simuladores virtuales de genética y modelos tridimensionales.",
        "Producción colaborativa de manuales y glosarios ilustrados en Google Drive.",
      ],
      criteriosEvaluacion: [
        "Participación reflexiva y destreza técnica en prácticas de laboratorio (25%).",
        "Informes escritos y proyectos didácticos evaluados por rúbricas analíticas (35%).",
        "Evaluaciones sumativas y cuestionarios interactivos de Google Forms (30%).",
        "Autoevaluación y compromiso institucional en Google Classroom (10%).",
      ],
      bibliografiaObligatoria: [
        "Curtis, H., Barnes, N. S., Schnek, A., & Massarini, A. (2018). Biología. Editorial Médica Panamericana.",
        "Alberts, B. et al. (2016). Introducción a la Biología Celular. Garland Science.",
        "Diseño Curricular para la Educación Secundaria de Ciencias Naturales (Ministerio de Educación).",
      ],
    },
    googleDocUrl: "https://docs.google.com/document/d/plan-rag-4a-bio/edit",
    googleDocId: "plan-rag-4a-bio",
    createdAt: "2026-09-09T08:00:00Z",
  },
];

let ragPlans: RagPlanResult[] = [];

const sampleInteractiveManuals: InteractiveManual[] = [
  {
    id: "man-201",
    title: "Manual Interactivo de Citología y Herencia",
    subject: "Biología Celular",
    targetLevel: "Secundaria Ciclo Superior",
    studentAge: "15-16 años",
    associatedPlanId: "rag-plan-1",
    driveFileUrl: "https://docs.google.com/document/d/manual-interactivo-citologia/edit",
    driveFolder: "Drive Docente > Biología 4to > Manual Didáctico",
    lastUpdated: "2026-09-09T14:30:00Z",
    chapters: [
      {
        id: "ch-1",
        topicTitle: "Capítulo 1: El Universo dentro de la Célula",
        order: 1,
        intro: "Cada ser vivo en nuestro planeta, desde una solitaria bacteria en una fuente termal hasta las células de nuestro cerebro, está construido a partir de una unidad viva fundamental: la célula.",
        contentBody: "La teoría celular formulada por Schleiden, Schwann y Virchow establece que toda célula proviene de otra preexistente. Las células eucariotas se caracterizan por compartimentalización membranosa...",
        keyConcepts: ["Teoría Celular", "Eucariota", "Membrana Plasmática", "Organelas celulares"],
        callouts: [
          {
            type: "clave",
            text: "La membrana celular no es una barrera fija sino un mosaico fluido de fosfolípidos y proteínas con permeabilidad selectiva.",
          },
          {
            type: "curiosidad",
            text: "¿Sabías que tus mitocondrias tienen su propio ADN circular independiente del núcleo celular, prueba de su origen endosimbiótico?",
          },
        ],
        suggestedIllustrations: [
          "Diagrama comparativo célula animal vs vegetal con etiquetas interactivas",
          "Micrografía electrónica de transmisión del retículo endoplásmico",
        ],
        comprehensionActivities: [
          "Diseña una infografía en grupos comparando el transporte pasivo y activo.",
          "Explica qué ocurriría si una célula animal se coloca en una solución altamente hipotónica.",
        ],
      },
      {
        id: "ch-2",
        topicTitle: "Capítulo 2: Mitosis: La Danza de los Cromosomas",
        order: 2,
        intro: "Para que un organismo crezca, repare sus tejidos o reemplace células viejas, las células deben replicar su material genético con exactitud matemática.",
        contentBody: "La mitosis consta de cuatro etapas principales: profase, metafase, anafase y telofase. En la metafase, los cromosomas se alinean en el ecuador de la célula y el huso mitótico asegura una distribución equitativa...",
        keyConcepts: ["Cromosoma", "Huso Mitótico", "Metafase", "Citocinesis"],
        callouts: [
          {
            type: "ejemplo",
            text: "Un corte en la piel sana gracias a una rápida aceleración de la mitosis en las células basales de la epidermis.",
          },
          {
            type: "reflexion",
            text: "¿Qué mecanismos de control fallan en el ciclo celular cuando se produce una proliferación descontrolada como en el cáncer?",
          },
        ],
        suggestedIllustrations: [
          "Fotografías reales al microscopio óptico de las 4 fases en células de raíz de cebolla",
        ],
        comprehensionActivities: [
          "Observa las láminas preparadas en el laboratorio y clasifica 20 células en sus respectivas fases.",
        ],
      },
    ],
  },
];

let interactiveManuals: InteractiveManual[] = [];

let formActivities: FormActivity[] = [
  {
    id: "act-301",
    title: "Cuestionario Interactivo: Fases de la Mitosis y Regulación Celular",
    subject: "Biología Celular",
    courseId: "c-101",
    ageGroup: "15-16 años",
    activityType: "Formativa",
    description: "Evaluación interactiva configurada en Google Forms. Permite diagnosticar el grado de asimilación de la profase, metafase, anafase y telofase con preguntas cerradas y un caso abierto.",
    googleFormUrl: "https://docs.google.com/forms/d/form-mitosis-eval-301/viewform",
    classroomCourseId: "gc-401-bio",
    publishedToClassroom: true,
    publishedAt: "2026-09-08T10:30:00Z",
    questions: [
      {
        id: "q-1",
        questionText: "¿En cuál fase de la mitosis los cromosomas alcanzan su máxima condensación y se alinean en la placa ecuatorial?",
        type: "multiple_choice",
        options: ["Profase", "Metafase", "Anafase", "Telofase"],
        points: 20,
      },
      {
        id: "q-2",
        questionText: "¿Qué función cumple el huso acromático durante la anafase mitótica?",
        type: "multiple_choice",
        options: [
          "Disolver la membrana nuclear",
          "Separar las cromátidas hermanas hacia los polos opuestos",
          "Sintetizar nuevas moléculas de ADN",
          "Formar la pared celular vegetal",
        ],
        points: 20,
      },
      {
        id: "q-3",
        questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina) que destruye los microtúbulos del huso. Explica qué ocurrirá con la célula en división y en qué fase quedará detenida.",
        type: "open_text",
        rubricCriterion: "Rigor conceptual (mención de metafase), explicación de la imposibilidad de migración de cromátidas y consecuencia biológica.",
        points: 60,
      },
    ],
    submissions: [
      {
        studentId: "s-1",
        studentName: "Valentina Rossi",
        studentEmail: "v.rossi@colegio.edu.ar",
        submittedAt: "2026-09-09T16:15:00Z",
        responses: [
          {
            questionId: "q-1",
            questionText: "¿En cuál fase de la mitosis...",
            studentAnswer: "Metafase",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Respuesta correcta.",
          },
          {
            questionId: "q-2",
            questionText: "¿Qué función cumple el huso acromático...",
            studentAnswer: "Separar las cromátidas hermanas hacia los polos opuestos",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Respuesta correcta y precisa.",
          },
          {
            questionId: "q-3",
            questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina)...",
            studentAnswer: "Al destruirse los microtúbulos del huso, los cromosomas no pueden separarse hacia los polos durante la anafase. La célula queda bloqueada en metafase con los cromosomas condensados sin poder completar la división, generando células poliploides.",
            evaluatedScore: 58,
            maxScore: 60,
            aiFeedback: "Respuesta sobresaliente. Identifica con exactitud el bloqueo en metafase y fundamenta el mecanismo biológico con solvencia.",
          },
        ],
        overallScore: 98,
        maxScore: 100,
        overallFeedback: {
          strengths: ["Excelente dominio de la fisiología del citoesqueleto y huso mitótico", "Vocabulario científico riguroso"],
          areasForImprovement: ["Mencionar también el impacto en la citocinesis posterior"],
          pedagogicalGuidance: "Valentina demuestra comprensión de nivel avanzado. Sugerido: proponerle lectura sobre fármacos quimioterápicos.",
        },
        status: "Corregido",
      },
      {
        studentId: "s-2",
        studentName: "Mateo Gómez",
        studentEmail: "m.gomez@colegio.edu.ar",
        submittedAt: "2026-09-09T18:20:00Z",
        responses: [
          {
            questionId: "q-1",
            questionText: "¿En cuál fase de la mitosis...",
            studentAnswer: "Metafase",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-2",
            questionText: "¿Qué función cumple el huso acromático...",
            studentAnswer: "Separar las cromátidas hermanas hacia los polos opuestos",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-3",
            questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina)...",
            studentAnswer: "La célula no se puede dividir porque no tiene los hilos para tirar de los cromosomas, entonces se queda frenada en la mitad de la mitosis.",
            evaluatedScore: 42,
            maxScore: 60,
            aiFeedback: "Comprensión intuitiva del fenómeno, pero requiere mayor vocabulario formal (mencionar metafase y microtúbulos).",
          },
        ],
        overallScore: 82,
        maxScore: 100,
        overallFeedback: {
          strengths: ["Captura la lógica mecánica de la separación cromosómica"],
          areasForImprovement: ["Usar la terminología formal de metafase/anafase y microtúbulos en lugar de 'los hilos'"],
          pedagogicalGuidance: "Mateo comprende el proceso pero necesita reforzar la expresión escrita técnica.",
        },
        status: "Corregido",
      },
      {
        studentId: "s-3",
        studentName: "Camila Navarro",
        studentEmail: "c.navarro@colegio.edu.ar",
        submittedAt: "2026-09-10T02:00:00Z",
        responses: [
          {
            questionId: "q-1",
            questionText: "¿En cuál fase de la mitosis...",
            studentAnswer: "Metafase",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-2",
            questionText: "¿Qué función cumple el huso acromático...",
            studentAnswer: "Separar las cromátidas hermanas hacia los polos opuestos",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-3",
            questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina)...",
            studentAnswer: "La colquicina inhibe la polimerización de tubulina, impidiendo la formación de los microtúbulos del huso. Como consecuencia, el punto de control del ensamblaje del huso se activa y la mitosis se detiene irreversiblemente en prometafase/metafase.",
            evaluatedScore: 60,
            maxScore: 60,
            aiFeedback: "Respuesta de nivel universitario con mención al checkpoint del huso acromático.",
          },
        ],
        overallScore: 100,
        maxScore: 100,
        overallFeedback: {
          strengths: ["Rigor conceptual absoluto", "Mención del checkpoint de ensamblaje del huso"],
          areasForImprovement: ["Mantener la sencillez explicativa en exposiciones orales"],
          pedagogicalGuidance: "Desempeño sobresaliente.",
        },
        status: "Corregido",
      },
      {
        studentId: "s-4",
        studentName: "Ignacio Pérez",
        studentEmail: "i.perez@colegio.edu.ar",
        submittedAt: "2026-09-10T03:10:00Z",
        responses: [
          {
            questionId: "q-1",
            questionText: "¿En cuál fase de la mitosis...",
            studentAnswer: "Profase",
            evaluatedScore: 0,
            maxScore: 20,
            aiFeedback: "Incorrecto. En profase se condensan pero se alinean en el ecuador en la metafase.",
          },
          {
            questionId: "q-2",
            questionText: "¿Qué función cumple el huso acromático...",
            studentAnswer: "Disolver la membrana nuclear",
            evaluatedScore: 0,
            maxScore: 20,
            aiFeedback: "Incorrecto. La membrana se disuelve por fosforilación de láminas nucleares.",
          },
          {
            questionId: "q-3",
            questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina)...",
            studentAnswer: "Creo que la célula muere directamente porque le falta energía.",
            evaluatedScore: 15,
            maxScore: 60,
            aiFeedback: "Confusión entre metabolismo energético y aparato mitótico. Se detiene por falta de soporte estructural del huso.",
          },
        ],
        overallScore: 15,
        maxScore: 100,
        overallFeedback: {
          strengths: ["Entregó en fecha la actividad"],
          areasForImprovement: ["Revisar las fases de la mitosis y la función del huso acromático"],
          pedagogicalGuidance: "Asignar actividad de recuperación guiada con el Manual Interactivo del Módulo 2.",
        },
        status: "Corregido",
      },
      {
        studentId: "s-5",
        studentName: "Sofía Martínez",
        studentEmail: "s.martinez@colegio.edu.ar",
        submittedAt: "2026-09-10T04:15:00Z",
        responses: [
          {
            questionId: "q-1",
            questionText: "¿En cuál fase de la mitosis...",
            studentAnswer: "Metafase",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-2",
            questionText: "¿Qué función cumple el huso acromático...",
            studentAnswer: "Separar las cromátidas hermanas hacia los polos opuestos",
            evaluatedScore: 20,
            maxScore: 20,
            aiFeedback: "Correcto.",
          },
          {
            questionId: "q-3",
            questionText: "Caso de Aplicación: Un biólogo aplica un fármaco (colquicina)...",
            studentAnswer: "La célula no puede separar sus cromosomas hacia los polos porque los microtúbulos no se forman, por lo que la anafase no ocurre y queda en metafase.",
            evaluatedScore: 50,
            maxScore: 60,
            aiFeedback: "Muy buena explicación del impedimento de la anafase.",
          },
        ],
        overallScore: 90,
        maxScore: 100,
        overallFeedback: {
          strengths: ["Identifica con claridad el corte de transición entre metafase y anafase"],
          areasForImprovement: ["Completar con las consecuencias genéticas celulares"],
          pedagogicalGuidance: "Muy buen desempeño.",
        },
        status: "Corregido",
      },
    ],
  },
];

let gradebookReports: GradebookConsolidatedReport[] = [
  {
    id: "rep-401",
    courseId: "c-101",
    courseName: "4to Año A - Ciencias Naturales (Biología)",
    term: "1er Trimestre",
    generatedAt: "2026-09-10T05:00:00Z",
    googleSheetsUrl: "https://docs.google.com/spreadsheets/d/libreta-calificaciones-4a/edit",
    categories: {
      trabajosPracticosWeight: 40,
      examenesWeight: 50,
      recuperatoriosWeight: 10,
    },
    records: [
      {
        studentId: "s-1",
        studentName: "Valentina Rossi",
        tpGrades: [9.5, 9.8, 9.2],
        tpAverage: 9.5,
        examGrades: [9.0, 9.4],
        examAverage: 9.2,
        finalAverage: 9.3,
        academicStatus: "Aprobado",
        pedagogicalNotes: "Destacado rendimiento analítico y compromiso escolar.",
      },
      {
        studentId: "s-2",
        studentName: "Mateo Gómez",
        tpGrades: [7.5, 8.0, 7.0],
        tpAverage: 7.5,
        examGrades: [7.0, 8.0],
        examAverage: 7.5,
        finalAverage: 7.5,
        academicStatus: "Aprobado",
        pedagogicalNotes: "Progreso sostenido en el segundo tramo del trimestre.",
      },
      {
        studentId: "s-3",
        studentName: "Camila Navarro",
        tpGrades: [10.0, 9.8, 10.0],
        tpAverage: 9.9,
        examGrades: [9.8, 10.0],
        examAverage: 9.9,
        finalAverage: 9.9,
        academicStatus: "Aprobado",
        pedagogicalNotes: "Desempeño de excelencia académica e indagación.",
      },
      {
        studentId: "s-4",
        studentName: "Ignacio Pérez",
        tpGrades: [6.0, 6.5, 5.5],
        tpAverage: 6.0,
        examGrades: [5.0, 4.5],
        examAverage: 4.8,
        retakeGrade: 6.0,
        finalAverage: 5.4,
        academicStatus: "A Recuperatorio",
        pedagogicalNotes: "Requiere apoyo focalizado en conceptos nucleares de división celular.",
      },
      {
        studentId: "s-5",
        studentName: "Sofía Martínez",
        tpGrades: [8.5, 9.0, 8.5],
        tpAverage: 8.7,
        examGrades: [8.0, 8.5],
        examAverage: 8.3,
        finalAverage: 8.5,
        academicStatus: "Aprobado",
        pedagogicalNotes: "Participación activa y buen desarrollo conceptual.",
      },
    ],
  },
];


async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.static(path.join(process.cwd(), "public")));

  // Save uploaded dynamic logo directly to public/
  app.post("/api/save-logo", async (req, res) => {
    try {
      const { data, filename } = req.body;
      if (!data) {
        return res.status(400).json({ error: "No data provided" });
      }

      const base64Data = data.includes("base64,") ? data.split("base64,")[1] : data;
      const buffer = Buffer.from(base64Data, "base64");

      const publicDir = path.join(process.cwd(), "public");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      const targetFileName = filename || "logo-animado.mp4";
      const targetPath = path.join(publicDir, targetFileName);
      fs.writeFileSync(targetPath, buffer);

      // Keep all video aliases synchronized
      fs.writeFileSync(path.join(publicDir, "logo-animado.mp4"), buffer);
      fs.writeFileSync(path.join(publicDir, "logo.mp4"), buffer);
      fs.writeFileSync(path.join(publicDir, "logo-dinamico.mp4"), buffer);

      const distDir = path.join(process.cwd(), "dist");
      if (fs.existsSync(distDir)) {
        fs.writeFileSync(path.join(distDir, "logo-animado.mp4"), buffer);
        fs.writeFileSync(path.join(distDir, "logo.mp4"), buffer);
        fs.writeFileSync(path.join(distDir, "logo-dinamico.mp4"), buffer);
      }

      // Generate webm format asynchronously if ffmpeg is available
      try {
        const { exec } = await import("child_process");
        exec(`ffmpeg -y -i "${path.join(publicDir, "logo-animado.mp4")}" -c:v libvpx-vp9 -b:v 0 -crf 28 "${path.join(publicDir, "logo-animado.webm")}"`, (err) => {
          if (!err && fs.existsSync(distDir)) {
            try {
              fs.copyFileSync(path.join(publicDir, "logo-animado.webm"), path.join(distDir, "logo-animado.webm"));
            } catch {}
          }
        });
      } catch {}

      console.log(`[Logo] Saved dynamic logo to ${targetPath}`);
      return res.json({ success: true, url: "/logo-animado.mp4?v=" + Date.now() });
    } catch (err: any) {
      console.error("Error saving dynamic logo:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/logo-status", (_req, res) => {
    const candidates = [
      "logo-animado.mp4",
      "logo-animado-original.mp4",
      "logo.mp4",
      "logo-animado.webm",
      "logo.webm",
      "logo-dinamico.mp4",
    ];
    const found: string[] = [];
    const publicDir = path.join(process.cwd(), "public");
    candidates.forEach((c) => {
      if (fs.existsSync(path.join(publicDir, c))) {
        found.push(`/${c}`);
      }
    });
    res.json({
      found,
      hasVideo: found.some((f) => f.endsWith(".mp4") || f.endsWith(".webm")),
    });
  });

  // Workspace configuration readiness & Scopes metadata
  const WORKSPACE_INTEGRATION = {
    authMode: "prepared",
    status: "Ready for Google Workspace OAuth",
    services: {
      drive: {
        name: "Google Drive",
        enabled: true,
        scope: "https://www.googleapis.com/auth/drive.file",
        purpose: "Almacenamiento de carpetas por materia, guías didácticas, rúbricas y adjuntos.",
      },
      docs: {
        name: "Google Docs",
        enabled: true,
        scope: "https://www.googleapis.com/auth/documents",
        purpose: "Creación y exportación de planificaciones pedagógicas y fichas de clase.",
      },
      sheets: {
        name: "Google Sheets",
        enabled: true,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        purpose: "Sincronización de planillas de asistencia, registro de calificaciones y ponderaciones.",
      },
      classroom: {
        name: "Google Classroom",
        enabled: true,
        scope: "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.students",
        purpose: "Importación de nóminas de estudiantes, publicación de tareas y novedades.",
      },
    },
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.students",
    ],
  };

  // -------------------------------------------------------------
  // API ROUTES (Always before Vite middleware)
  // -------------------------------------------------------------

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Google Workspace Config & Readiness
  app.get("/api/workspace/config", (_req, res) => {
    res.json(WORKSPACE_INTEGRATION);
  });

  // Authentication & Session endpoints
  app.get("/api/auth/user", (_req, res) => {
    res.json({
      authenticated: !!activeUser,
      user: activeUser,
    });
  });

  app.post("/api/auth/session", (req, res) => {
    try {
      const { uid, email, name, avatar, scopes, school } = req.body || {};
      const cleanEmail = (email || "").trim().toLowerCase();
      const cleanName = name || (cleanEmail ? cleanEmail.split("@")[0].replace(/[._-]/g, " ") : "Docente Titular");
      const displayName = cleanName.startsWith("Prof.") ? cleanName : `Prof. ${cleanName}`;

      activeUser = {
        id: uid || `user-${Date.now()}`,
        email: cleanEmail,
        name: displayName,
        avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1d4ed8&color=ffffff&bold=true&size=150`,
        role: "Docente Titular",
        school: school || (cleanEmail.includes("@") ? `Institución ${cleanEmail.split("@")[1].split(".")[0].toUpperCase()}` : "Institución Educativa"),
        scopes: Array.isArray(scopes) ? scopes : [
          "https://www.googleapis.com/auth/classroom.courses.readonly",
          "https://www.googleapis.com/auth/classroom.rosters.readonly",
          "https://www.googleapis.com/auth/classroom.coursework.students",
          "https://www.googleapis.com/auth/classroom.announcements",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
        ],
        permissions: [
          "tasks.create",
          "tasks.assign",
          "tasks.grade",
          "tasks.delete",
          "drive.read",
          "drive.attach",
          "classroom.sync",
          "students.view",
          "grades.manage",
        ],
        lastLogin: new Date().toISOString(),
      };

      res.json({
        success: true,
        user: activeUser,
      });
    } catch (err: any) {
      console.error("Error in /api/auth/session:", err);
      res.status(500).json({ success: false, error: err.message || "Error al sincronizar sesión" });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    activeUser = null;
    res.json({ success: true, message: "Sesión cerrada correctamente" });
  });

  app.get("/api/auth/permissions", (_req, res) => {
    res.json({
      role: activeUser?.role || "Docente Titular",
      permissions: activeUser?.permissions || [
        "tasks.create",
        "tasks.assign",
        "tasks.grade",
        "tasks.delete",
        "drive.read",
        "drive.attach",
        "classroom.sync",
        "students.view",
        "grades.manage",
      ],
      scopes: activeUser?.scopes || [],
    });
  });

  // Courses API
  app.get("/api/courses", (_req, res) => {
    // Sanitize any course that had "Ciencias Sociales" by mistake
    courses.forEach((c) => {
      if (c.id === "c-104" || c.name.includes("Ciencias Sociales") || c.subject === "Ciencias Sociales") {
        c.name = c.name.replace(/Ciencias Sociales/g, "Historia");
        c.subject = "Historia";
      }
    });

    // Deduplicate courses by classroomCourseId and id so no duplicate courses are served
    const seenClassroomIds = new Set<string>();
    const seenCourseIds = new Set<string>();
    const uniqueCourses: Course[] = [];

    for (const c of courses) {
      if (seenCourseIds.has(c.id)) continue;
      if (c.classroomCourseId && seenClassroomIds.has(String(c.classroomCourseId).trim())) {
        continue;
      }
      seenCourseIds.add(c.id);
      if (c.classroomCourseId) {
        seenClassroomIds.add(String(c.classroomCourseId).trim());
      }
      uniqueCourses.push(c);
    }
    courses = uniqueCourses;

    res.json({ courses });
  });

  app.post("/api/courses", (req, res) => {
    const { name, subject, grade, room, schedule, color, orientation, division } = req.body;
    if (!name || !subject) {
      return res.status(400).json({ error: "Nombre y materia son requeridos." });
    }

    const incomingClassroomId = req.body.classroomCourseId ? String(req.body.classroomCourseId).trim() : null;
    const incomingId = req.body.id ? String(req.body.id).trim() : null;

    // Check if course already exists by identity number
    const existing = courses.find((c) => {
      if (incomingClassroomId) {
        return c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId;
      }
      if (incomingId) {
        return c.id === incomingId || c.classroomCourseId === incomingId;
      }
      const itemSec = (req.body.section || '').trim().toLowerCase();
      const cSec = (c.section || '').trim().toLowerCase();
      return c.name.trim().toLowerCase() === name.trim().toLowerCase() && (itemSec === '' || cSec === itemSec);
    });

    if (existing) {
      // Do not duplicate! Update existing course and return it
      existing.name = name;
      existing.subject = subject;
      if (req.body.studentsCount) existing.studentsCount = Number(req.body.studentsCount);
      if (incomingClassroomId) existing.classroomCourseId = incomingClassroomId;
      saveCoursesToDisk();
      return res.status(200).json({ course: existing, isDuplicate: true });
    }

    const newCourse: Course = {
      id: req.body.id || `c-${Date.now().toString().slice(-4)}`,
      name,
      subject,
      grade: grade || "General",
      room: room || "Aula Principal",
      schedule: schedule || "A coordinar",
      color: color || "#1a73e8",
      studentsCount: Number(req.body.studentsCount) || 25,
      classroomSynced: req.body.classroomSynced !== undefined ? Boolean(req.body.classroomSynced) : true,
      classroomCourseId: req.body.classroomCourseId || `gc-${Date.now().toString().slice(-4)}`,
      code: req.body.code || undefined,
      section: req.body.section || undefined,
      orientation: orientation || req.body.orientation || undefined,
      division: division || req.body.division || undefined,
      schoolYear: req.body.schoolYear || "2026",
      driveFolderId: req.body.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
    };
    courses.push(newCourse);
    saveCoursesToDisk();
    res.status(201).json({ course: newCourse });
  });

  // Bulk import courses (from Google Classroom or teacher list)
  app.post("/api/courses/bulk", (req, res) => {
    const { courses: newCoursesList } = req.body;
    if (!Array.isArray(newCoursesList) || newCoursesList.length === 0) {
      return res.status(400).json({ error: "Se requiere una lista de materias para importar." });
    }

    const processedCourses: Course[] = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const item of newCoursesList) {
      if (!item.name && !item.subject) continue;
      const courseName = (item.name || item.subject).trim();
      const courseSubject = (item.subject || item.name).trim();
      const studentsNum =
        typeof item.studentsCount === 'number' && !isNaN(item.studentsCount)
          ? item.studentsCount
          : !isNaN(Number(item.studentsCount)) && item.studentsCount !== '' && item.studentsCount !== null
          ? Number(item.studentsCount)
          : 0;

      // Identity numbers (Google Classroom ID or custom ID)
      const incomingClassroomId = item.classroomCourseId ? String(item.classroomCourseId).trim() : (item.id ? String(item.id).trim() : null);

      // Check if this course is ALREADY present by identity number
      const existing = courses.find((c) => {
        if (incomingClassroomId) {
          return (c.classroomCourseId && String(c.classroomCourseId).trim() === incomingClassroomId) ||
                 (c.id && String(c.id).trim() === incomingClassroomId);
        }
        if (item.id && (String(c.id).trim() === String(item.id).trim() || String(c.classroomCourseId).trim() === String(item.id).trim())) {
          return true;
        }
        const itemSec = (item.section || '').trim().toLowerCase();
        const cSec = (c.section || '').trim().toLowerCase();
        return c.name.trim().toLowerCase() === courseName.toLowerCase() && (itemSec === '' || cSec === itemSec);
      });

      if (existing) {
        // DO NOT DUPLICATE! Update existing course data instead of adding a new one
        if (studentsNum > 0) existing.studentsCount = studentsNum;
        if (incomingClassroomId && !existing.classroomCourseId) existing.classroomCourseId = incomingClassroomId;
        existing.classroomSynced = true;
        if (!processedCourses.some((c) => c.id === existing.id)) {
          processedCourses.push(existing);
          updatedCount++;
        }
        continue;
      }

      // Check if already added in this same batch to prevent internal batch duplicates
      const alreadyInBatch = processedCourses.find((c) => {
        if (incomingClassroomId) {
          return c.classroomCourseId === incomingClassroomId || c.id === incomingClassroomId;
        }
        const itemSec = (item.section || '').trim().toLowerCase();
        const cSec = (c.section || '').trim().toLowerCase();
        return c.name.trim().toLowerCase() === courseName.toLowerCase() && (itemSec === '' || cSec === itemSec);
      });
      if (alreadyInBatch) continue;

      const courseId = item.id || `c-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5)}`;
      const newCourse: Course = {
        id: courseId,
        name: courseName,
        subject: courseSubject,
        grade: item.grade || "Secundaria",
        room: item.room || "Aula Asignada",
        schedule: item.schedule || "Horario a coordinar",
        color: item.color || "#137333", // Classroom Green
        studentsCount: studentsNum,
        classroomSynced: true,
        classroomCourseId: incomingClassroomId || `gc-${Math.random().toString(36).substring(2, 7)}`,
        code: item.code || Math.random().toString(36).substring(2, 8),
        section: item.section || "1°",
        orientation: item.orientation || undefined,
        division: item.division || undefined,
        schoolYear: item.schoolYear || "2026",
        driveFolderId: item.driveFolderId || `f-${Date.now().toString().slice(-4)}`,
      };

      courses.push(newCourse);
      processedCourses.push(newCourse);
      addedCount++;
    }

    saveCoursesToDisk();

    res.status(201).json({
      success: true,
      message: addedCount > 0
        ? `Se agregaron ${addedCount} materias nuevas (y se actualizaron ${updatedCount} existentes sin duplicar).`
        : `Las materias ya estaban cargadas previamente. No se duplicó ninguna materia.`,
      courses: processedCourses,
      addedCount,
      updatedCount,
    });
  });

  // Sync actual student counts for courses
  app.post("/api/courses/sync-students", (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Se requiere un array de actualizaciones." });
    }

    let updatedCount = 0;
    updates.forEach((u: { id: string; studentsCount: number }) => {
      const course = courses.find((c) => c.id === u.id || c.classroomCourseId === u.id);
      if (course && typeof u.studentsCount === "number") {
        course.studentsCount = u.studentsCount;
        updatedCount++;
      }
    });

    saveCoursesToDisk();

    res.json({
      success: true,
      message: `Se actualizaron los alumnos reales de ${updatedCount} materias.`,
      courses,
    });
  });

  // Patch a single course
  app.patch("/api/courses/:id", (req, res) => {
    const { id } = req.params;
    const course = courses.find((c) => c.id === id);
    if (!course) {
      return res.status(404).json({ error: "Materia no encontrada." });
    }
    if (typeof req.body.studentsCount === "number") {
      course.studentsCount = req.body.studentsCount;
    }
    Object.assign(course, req.body);
    saveCoursesToDisk();
    res.json({ success: true, course });
  });

  app.delete("/api/courses/:id", (req, res) => {
    const { id } = req.params;
    const index = courses.findIndex((c) => c.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Materia no encontrada." });
    }
    const removedCourse = courses.splice(index, 1)[0];
    // Remove students associated with this course
    students = students.filter((s) => s.courseId !== id);
    saveCoursesToDisk();
    saveStudentsToDisk();
    res.json({
      success: true,
      message: `Materia "${removedCourse.name}" eliminada correctamente.`,
      courseId: id,
    });
  });

  // Clear all demo/sample courses
  app.post("/api/courses/clear", (_req, res) => {
    courses = [];
    students = [];
    ragPlans = [];
    interactiveManuals = [];
    saveCoursesToDisk();
    saveStudentsToDisk();
    res.json({
      success: true,
      message: "Se eliminaron todas las materias y estudiantes de prueba. Espacio de trabajo limpio para tus clases reales.",
    });
  });

  // Restore demo/sample courses
  app.post("/api/courses/restore-demo", (_req, res) => {
    courses = [
      {
        id: "c-101",
        name: "Historia (S2 Nat)",
        subject: "Historia",
        orientation: "Nat",
        division: "S2",
        grade: "Secundaria - S2 Nat",
        room: "Aula 21",
        schedule: "Lunes y Miércoles 08:00 - 09:30",
        color: "#1a73e8",
        studentsCount: 28,
        classroomSynced: true,
        classroomCourseId: "gc-hist-201",
        code: "his201n",
        section: "2º",
        schoolYear: "2026",
        driveFolderId: "f-101",
      },
      {
        id: "c-102",
        name: "Historia (S3 Soc)",
        subject: "Historia",
        orientation: "Soc",
        division: "S3",
        grade: "Secundaria - S3 Soc",
        room: "Aula 14",
        schedule: "Martes y Jueves 10:00 - 11:30",
        color: "#1e8e3e",
        studentsCount: 30,
        classroomSynced: true,
        classroomCourseId: "gc-hist-302",
        code: "his302s",
        section: "3º",
        schoolYear: "2026",
        driveFolderId: "f-102",
      },
    ];
    saveCoursesToDisk();
    res.json({
      success: true,
      message: "Materias de prueba restauradas correctamente.",
      courses,
    });
  });

  // Students API
  app.get("/api/students", (req, res) => {
    const { courseId } = req.query;
    // Sanitize any legacy mock students that may have been in memory
    const mockNames = ["Valentina Rossi", "Mateo Gómez", "Camila Navarro", "Ignacio Pérez", "Sofía Martínez", "Lucas Benítez", "Agustina Ríos", "Santiago Silva", "Martina López", "Joaquín Fernández", "Lucía Romero", "Benjamín Alvarez", "Sofía Díaz"];
    students = students.filter((s) => !mockNames.includes(`${s.firstName} ${s.lastName}`));

    let list = courseId ? students.filter((s) => s.courseId === courseId) : [...students];
    list.sort((a, b) => {
      const lastA = (a.lastName || "").trim();
      const lastB = (b.lastName || "").trim();
      const cmp = lastA.localeCompare(lastB, "es", { sensitivity: "base" });
      if (cmp !== 0) return cmp;
      return (a.firstName || "").trim().localeCompare((b.firstName || "").trim(), "es", { sensitivity: "base" });
    });

    if (courseId) {
      return res.json({ students: list });
    }
    res.json({ students: list });
  });

  // Bulk sync real students from Google Classroom into a course
  app.post("/api/students/sync", (req, res) => {
    const { courseId, students: incoming } = req.body;
    if (!courseId || !Array.isArray(incoming)) {
      return res.status(400).json({ error: "courseId y array de estudiantes son obligatorios." });
    }

    // Remove existing students for this course
    students = students.filter((s) => s.courseId !== courseId);

    // Insert real students
    incoming.forEach((st: any) => {
      students.push({
        id: st.id || `st-${courseId}-${Math.random().toString(36).substring(2, 7)}`,
        courseId,
        firstName: st.firstName || "Alumno",
        lastName: st.lastName || "",
        email: st.email || "",
        avatar: st.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((st.firstName || '') + ' ' + (st.lastName || ''))}&background=1a73e8&color=ffffff&bold=true`,
        attendanceRate: typeof st.attendanceRate === 'number' ? st.attendanceRate : 100,
        averageGrade: typeof st.averageGrade === 'number' ? st.averageGrade : 0,
        notes: st.notes || "Sincronizado desde Google Classroom",
      });
    });

    // Update course studentsCount
    const course = courses.find((c) => c.id === courseId);
    if (course) {
      course.studentsCount = incoming.length;
    }

    saveStudentsToDisk();
    saveCoursesToDisk();

    res.json({
      success: true,
      count: incoming.length,
      students: students.filter((s) => s.courseId === courseId),
    });
  });

  // Clear mock students endpoint
  app.post("/api/students/clear-mock", (_req, res) => {
    const mockNames = ["Valentina Rossi", "Mateo Gómez", "Camila Navarro", "Ignacio Pérez", "Sofía Martínez", "Lucas Benítez", "Agustina Ríos", "Santiago Silva", "Martina López", "Joaquín Fernández", "Lucía Romero", "Benjamín Alvarez", "Sofía Díaz"];
    students = students.filter((s) => !mockNames.includes(`${s.firstName} ${s.lastName}`));
    saveStudentsToDisk();
    res.json({ success: true, remaining: students.length });
  });

  app.post("/api/students", (req, res) => {
    const { courseId, firstName, lastName, email } = req.body;
    if (!courseId || !firstName || !lastName) {
      return res.status(400).json({ error: "Datos incompletos para crear estudiante." });
    }
    const newStudent: Student = {
      id: `s-${Date.now().toString().slice(-4)}`,
      courseId,
      firstName,
      lastName,
      email: email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@colegio.edu.ar`,
      avatar: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      attendanceRate: 100,
      averageGrade: 0,
      notes: "Nuevo estudiante incorporado a la nómina.",
    };
    students.push(newStudent);
    // Update count in course
    const course = courses.find((c) => c.id === courseId);
    if (course) course.studentsCount += 1;
    saveStudentsToDisk();
    saveCoursesToDisk();
    res.status(201).json({ student: newStudent });
  });

  // Attendance batch save
  app.post("/api/attendance", (req, res) => {
    const { courseId, date, records } = req.body;
    // records: { studentId: string, status: 'present' | 'absent' | 'late' | 'excused' }[]
    res.json({
      success: true,
      message: `Asistencia guardada correctamente para ${records?.length || 0} estudiantes en fecha ${date || "hoy"}.`,
      sheetSynced: true,
    });
  });

  // Google Sheets Student Attendance & Disposition History (Script Port)
  interface DispositionRecord {
    id: string;
    studentId: string;
    studentName: string;
    courseId: string;
    date: string; // dd/MM/yyyy
    time: string; // HH:mm:ss
    action: string;
    category: "Ausencia" | "Disposición" | "Llegada tarde";
    pointsChange?: number;
    timestamp: number;
    messageSent?: boolean;
    messageText?: string;
    notificationMethod?: "classroom" | "gmail" | "none";
    notifiedAt?: string;
  }

  let studentDispositionMap: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
  let studentHistoryList: DispositionRecord[] = [];

  const DISPOSITION_DATA_FILE = path.join(process.cwd(), "data", "disposition-records.json");

  // Reconcile and calculate student metrics from history so points drops and absences never reset or get lost
  function recomputeDispositionMapFromHistory() {
    const historyByStudent: Record<string, DispositionRecord[]> = {};
    for (const h of studentHistoryList) {
      if (!h.studentId) continue;
      if (!historyByStudent[h.studentId]) historyByStudent[h.studentId] = [];
      historyByStudent[h.studentId].push(h);
    }

    for (const [studentId, records] of Object.entries(historyByStudent)) {
      const absences = records.filter((r) => r.category === "Ausencia").length;
      const lates = records.filter((r) => r.category === "Llegada tarde").length;
      const dispDrops = records.filter((r) => r.category === "Disposición").length;
      const calculatedDisp = Math.max(0, 10 - dispDrops);

      if (!studentDispositionMap[studentId]) {
        studentDispositionMap[studentId] = {
          totalAbsences: absences,
          totalLates: lates,
          totalDisposition: calculatedDisp,
        };
      } else {
        const cur = studentDispositionMap[studentId];
        cur.totalAbsences = Math.max(cur.totalAbsences ?? 0, absences);
        cur.totalLates = Math.max(cur.totalLates ?? 0, lates);
        if (cur.totalDisposition === undefined || cur.totalDisposition > calculatedDisp) {
          cur.totalDisposition = calculatedDisp;
        }
      }
    }
  }

  function loadDispositionDataFromDisk() {
    try {
      if (fs.existsSync(DISPOSITION_DATA_FILE)) {
        const raw = fs.readFileSync(DISPOSITION_DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.disposition && typeof parsed.disposition === "object") {
          studentDispositionMap = parsed.disposition;
        }
        if (Array.isArray(parsed.history)) {
          studentHistoryList = deduplicateHistoryList(parsed.history);
        }
        recomputeDispositionMapFromHistory();
      }
    } catch (e) {
      console.warn("Failed to load disposition data from disk:", e);
    }
  }

  function saveDispositionDataToDisk() {
    try {
      recomputeDispositionMapFromHistory();
      const dir = path.dirname(DISPOSITION_DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        DISPOSITION_DATA_FILE,
        JSON.stringify({ disposition: studentDispositionMap, history: studentHistoryList }, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.warn("Failed to save disposition data to disk:", e);
    }
  }

  // Load persistent history on startup
  loadDispositionDataFromDisk();

  // Helper to deduplicate history entries (prevents twin records created within near timestamps)
  function deduplicateHistoryList(list: DispositionRecord[]): DispositionRecord[] {
    const result: DispositionRecord[] = [];
    const seenIds = new Set<string>();

    for (const item of list) {
      if (seenIds.has(item.id)) continue;

      const isDuplicate = result.some(
        (existing) =>
          existing.studentId === item.studentId &&
          existing.category === item.category &&
          existing.action === item.action &&
          (Math.abs(existing.timestamp - item.timestamp) < 20000 ||
            (existing.date === item.date && existing.action === item.action && Math.abs(existing.timestamp - item.timestamp) < 60000))
      );

      if (!isDuplicate) {
        seenIds.add(item.id);
        result.push(item);
      }
    }
    return result;
  }

  app.get("/api/disposition", (req, res) => {
    const { courseId, studentId } = req.query;
    recomputeDispositionMapFromHistory();
    studentHistoryList = deduplicateHistoryList(studentHistoryList);
    let filteredHistory = [...studentHistoryList];

    if (courseId) {
      const courseStudentIds = new Set(
        students.filter((s) => s.courseId === courseId).map((s) => s.id)
      );
      filteredHistory = filteredHistory.filter(
        (h) => h.courseId === courseId || courseStudentIds.has(h.studentId)
      );
    }
    if (studentId) {
      filteredHistory = filteredHistory.filter((h) => h.studentId === studentId);
    }

    // Sort by student ascending, then timestamp descending (most recent first) matching the script
    filteredHistory.sort((a, b) => {
      const nameCompare = a.studentName.localeCompare(b.studentName);
      if (nameCompare !== 0) return nameCompare;
      return b.timestamp - a.timestamp;
    });

    res.json({
      disposition: studentDispositionMap,
      history: filteredHistory,
      allHistory: studentHistoryList,
    });
  });

  app.post("/api/disposition/record", (req, res) => {
    const {
      id: clientRecordId,
      studentId,
      studentName,
      courseId,
      action,
      category,
      detail,
      date: clientDate,
      time: clientTime,
      timestamp: clientTimestamp,
    } = req.body;

    if (!studentId || !action || !category) {
      return res.status(400).json({ error: "Faltan datos obligatorios para el registro." });
    }

    let finalAction = action;
    if (category === "Ausencia") {
      finalAction = "Ausencia";
    } else if (category === "Llegada tarde") {
      finalAction = action || "Llegada tarde";
    } else if (category === "Disposición" && action === "Otros") {
      finalAction = detail && detail.trim() ? `Otros: ${detail.trim()}` : "Otros (Sin especificar)";
    }

    const targetTimestamp = clientTimestamp || Date.now();

    // Check if duplicate entry already exists (by ID or same student + action within 20s)
    const existing = studentHistoryList.find(
      (h) =>
        (clientRecordId && h.id === clientRecordId) ||
        (h.studentId === studentId &&
          h.category === category &&
          h.action === finalAction &&
          Math.abs(h.timestamp - targetTimestamp) < 20000)
    );

    if (existing) {
      return res.json({
        success: true,
        record: existing,
        summary: studentDispositionMap[studentId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 },
        allDisposition: studentDispositionMap,
      });
    }

    if (!studentDispositionMap[studentId]) {
      studentDispositionMap[studentId] = {
        totalAbsences: 0,
        totalLates: 0,
        totalDisposition: 10,
      };
    }

    const current = studentDispositionMap[studentId];
    let pointsChange = 0;

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = clientDate || `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = clientTime || `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    if (category === "Ausencia") {
      current.totalAbsences += 1;
      // 1. Una asistencia / falta no cambia el puntaje de disposición
      pointsChange = 0;
    } else if (category === "Llegada tarde") {
      // 2. Si el mismo día cambia a tarde, borrar automáticamente la falta previa de hoy
      const todayAbsenceIdx = studentHistoryList.findIndex(
        (h) => h.studentId === studentId && h.category === "Ausencia" && (h.date === date || h.courseId === courseId)
      );
      if (todayAbsenceIdx !== -1) {
        studentHistoryList.splice(todayAbsenceIdx, 1);
        current.totalAbsences = Math.max(0, current.totalAbsences - 1);
      }
      current.totalLates = (current.totalLates || 0) + 1;
      pointsChange = 0;
    } else if (category === "Disposición") {
      current.totalDisposition = Math.max(0, current.totalDisposition - 1);
      pointsChange = -1;
    }

    const newRecord: DispositionRecord = {
      id: clientRecordId || `rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      studentId,
      studentName: studentName || "Estudiante",
      courseId: courseId || "",
      date,
      time,
      action: finalAction,
      category,
      pointsChange,
      timestamp: targetTimestamp,
      messageSent: req.body.messageSent || false,
      messageText: req.body.messageText || "",
      notificationMethod: req.body.notificationMethod || "none",
      notifiedAt: req.body.notifiedAt,
    };

    studentHistoryList.unshift(newRecord);
    studentHistoryList = deduplicateHistoryList(studentHistoryList);
    saveDispositionDataToDisk();

    res.json({
      success: true,
      record: newRecord,
      summary: current,
      allDisposition: studentDispositionMap,
    });
  });

  // Update notification status on existing history record
  app.put("/api/disposition/history/:id/notification", (req, res) => {
    const { id } = req.params;
    const { messageSent, messageText, notificationMethod, notifiedAt } = req.body;
    const record = studentHistoryList.find((h) => h.id === id);
    if (!record) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }

    if (messageSent !== undefined) record.messageSent = messageSent;
    if (messageText !== undefined) record.messageText = messageText;
    if (notificationMethod !== undefined) record.notificationMethod = notificationMethod;
    if (notifiedAt !== undefined) record.notifiedAt = notifiedAt;

    saveDispositionDataToDisk();

    res.json({
      success: true,
      record,
    });
  });

  app.delete("/api/disposition/history/:id", (req, res) => {
    const { id } = req.params;
    const index = studentHistoryList.findIndex((h) => h.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }

    const item = studentHistoryList[index];
    // Rollback changes
    if (studentDispositionMap[item.studentId]) {
      if (item.category === "Ausencia") {
        studentDispositionMap[item.studentId].totalAbsences = Math.max(
          0,
          studentDispositionMap[item.studentId].totalAbsences - 1
        );
      } else if (item.category === "Llegada tarde") {
        studentDispositionMap[item.studentId].totalLates = Math.max(
          0,
          (studentDispositionMap[item.studentId].totalLates || 1) - 1
        );
      } else if (item.category === "Disposición") {
        studentDispositionMap[item.studentId].totalDisposition = Math.min(
          10,
          studentDispositionMap[item.studentId].totalDisposition + 1
        );
      }
    }

    studentHistoryList.splice(index, 1);
    saveDispositionDataToDisk();

    res.json({
      success: true,
      removed: item,
      summary: studentDispositionMap[item.studentId],
    });
  });

  // Bulk sync to permanently ensure all client records are stored on server
  app.post("/api/disposition/sync-full", (req, res) => {
    const { disposition, history } = req.body;
    if (disposition && typeof disposition === "object") {
      studentDispositionMap = { ...studentDispositionMap, ...disposition };
    }
    if (Array.isArray(history)) {
      studentHistoryList = deduplicateHistoryList([...history, ...studentHistoryList]);
    }
    saveDispositionDataToDisk();
    res.json({
      success: true,
      count: studentHistoryList.length,
      disposition: studentDispositionMap,
      history: studentHistoryList,
    });
  });

  app.post("/api/disposition/reset", (req, res) => {
    const { studentId, courseId, resetWhat } = req.body;
    // resetWhat: 'disposition' | 'absences' | 'all'
    if (studentId) {
      if (studentDispositionMap[studentId]) {
        if (resetWhat === "disposition" || resetWhat === "all") {
          studentDispositionMap[studentId].totalDisposition = 10;
        }
        if (resetWhat === "absences" || resetWhat === "all") {
          studentDispositionMap[studentId].totalAbsences = 0;
        }
      }
    } else if (courseId) {
      // reset for students of this course
      students
        .filter((s) => s.courseId === courseId)
        .forEach((s) => {
          if (!studentDispositionMap[s.id]) {
            studentDispositionMap[s.id] = { totalAbsences: 0, totalDisposition: 10 };
          } else {
            if (resetWhat === "disposition" || resetWhat === "all") {
              studentDispositionMap[s.id].totalDisposition = 10;
            }
            if (resetWhat === "absences" || resetWhat === "all") {
              studentDispositionMap[s.id].totalAbsences = 0;
            }
          }
        });
    }

    saveDispositionDataToDisk();
    res.json({ success: true, disposition: studentDispositionMap });
  });

  // Course Google Sheets Disposition mapping (persisted to disk)
  const courseDispositionSheets: Record<string, { spreadsheetId: string; url: string; lastSyncedAt: string }> = {};
  const SHEETS_CONFIG_FILE = path.join(process.cwd(), "data", "sheets-config.json");

  function loadSheetsConfigFromDisk() {
    try {
      if (fs.existsSync(SHEETS_CONFIG_FILE)) {
        const raw = fs.readFileSync(SHEETS_CONFIG_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          Object.assign(courseDispositionSheets, parsed);
        }
      }
    } catch (e) {
      console.warn("Failed to load sheets config from disk:", e);
    }
  }

  function saveSheetsConfigToDisk() {
    try {
      const dir = path.dirname(SHEETS_CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SHEETS_CONFIG_FILE, JSON.stringify(courseDispositionSheets, null, 2), "utf-8");
    } catch (e) {
      console.warn("Failed to save sheets config to disk:", e);
    }
  }

  loadSheetsConfigFromDisk();

  app.get("/api/courses/:courseId/disposition-sheet", (req, res) => {
    const { courseId } = req.params;
    const data = courseDispositionSheets[courseId] || null;
    res.json(data || {});
  });

  app.post("/api/courses/:courseId/disposition-sheet", (req, res) => {
    const { courseId } = req.params;
    const { spreadsheetId, url, lastSyncedAt } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "Falta spreadsheetId" });
    }
    courseDispositionSheets[courseId] = {
      spreadsheetId,
      url: url || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      lastSyncedAt: lastSyncedAt || new Date().toISOString(),
    };
    saveSheetsConfigToDisk();
    res.json({ success: true, sheet: courseDispositionSheets[courseId] });
  });

  // Custom Teacher Conduct Options API (persisted to disk)
  const teacherConductOptionsMap: Record<string, string[]> = {};
  const teacherConductTemplatesMap: Record<string, Record<string, string>> = {};
  const TEACHER_SETTINGS_FILE = path.join(process.cwd(), "data", "teacher-settings.json");

  function loadTeacherSettingsFromDisk() {
    try {
      if (fs.existsSync(TEACHER_SETTINGS_FILE)) {
        const raw = fs.readFileSync(TEACHER_SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.options) Object.assign(teacherConductOptionsMap, parsed.options);
        if (parsed?.templates) Object.assign(teacherConductTemplatesMap, parsed.templates);
      }
    } catch (e) {
      console.warn("Failed to load teacher settings from disk:", e);
    }
  }

  function saveTeacherSettingsToDisk() {
    try {
      const dir = path.dirname(TEACHER_SETTINGS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        TEACHER_SETTINGS_FILE,
        JSON.stringify({ options: teacherConductOptionsMap, templates: teacherConductTemplatesMap }, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.warn("Failed to save teacher settings to disk:", e);
    }
  }

  loadTeacherSettingsFromDisk();

  app.get("/api/conduct-options", (req, res) => {
    const teacher = (req.query.teacher as string) || "default";
    res.json({ options: teacherConductOptionsMap[teacher] || [] });
  });

  app.post("/api/conduct-options", (req, res) => {
    const { teacher, options } = req.body;
    const key = teacher || "default";
    if (Array.isArray(options)) {
      teacherConductOptionsMap[key] = options.map((s: any) => String(s).trim()).filter(Boolean);
      saveTeacherSettingsToDisk();
    }
    res.json({ success: true, options: teacherConductOptionsMap[key] || [] });
  });

  // Custom Teacher Conduct Reason Default Message Templates API
  app.get("/api/conduct-templates", (req, res) => {
    const teacher = (req.query.teacher as string) || "default";
    res.json({ templates: teacherConductTemplatesMap[teacher] || {} });
  });

  app.post("/api/conduct-templates", (req, res) => {
    const { teacher, templates } = req.body;
    const key = teacher || "default";
    if (templates && typeof templates === "object") {
      teacherConductTemplatesMap[key] = templates;
      saveTeacherSettingsToDisk();
    }
    res.json({ success: true, templates: teacherConductTemplatesMap[key] || {} });
  });

  app.post("/api/conduct-templates", (req, res) => {
    const { teacher, templates } = req.body;
    const key = teacher || "default";
    if (templates && typeof templates === "object") {
      teacherConductTemplatesMap[key] = {
        ...(teacherConductTemplatesMap[key] || {}),
        ...templates,
      };
    }
    res.json({ success: true, templates: teacherConductTemplatesMap[key] || {} });
  });

  // Lesson Plans API (Google Docs integrated structure)
  app.get("/api/lesson-plans", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ lessonPlans: lessonPlans.filter((lp) => lp.courseId === courseId) });
    }
    res.json({ lessonPlans });
  });

  app.post("/api/lesson-plans", (req, res) => {
    const { courseId, title, unit, date, duration, objective, competencies, inicio, desarrollo, cierre, assessment, materials } = req.body;
    if (!courseId || !title) {
      return res.status(400).json({ error: "Curso y título de la planificación son obligatorios." });
    }
    const newPlan: LessonPlan = {
      id: `lp-${Date.now().toString().slice(-4)}`,
      courseId,
      title,
      unit: unit || "Unidad Temática",
      date: date || new Date().toISOString().split("T")[0],
      duration: duration || "80 min",
      status: "Borrador",
      objective: objective || "Objetivo de aprendizaje pedagógico.",
      competencies: Array.isArray(competencies) ? competencies : ["Comprensión lectora", "Resolución de problemas"],
      inicio: inicio || "Actividades de inicio y motivación.",
      desarrollo: desarrollo || "Actividades centrales y trabajo en equipo.",
      cierre: cierre || "Evaluación diagnóstica / ticket de salida.",
      assessment: assessment || "Criterios de evaluación formativa.",
      materials: Array.isArray(materials) ? materials : ["Pizarrón", "Guía en Google Docs"],
      googleDocUrl: `https://docs.google.com/document/d/plan-${Date.now().toString().slice(-4)}/edit`,
      googleDocId: `plan-${Date.now().toString().slice(-4)}`,
      lastModified: new Date().toISOString(),
    };
    lessonPlans.unshift(newPlan);
    res.status(201).json({ lessonPlan: newPlan });
  });

  // Gradebook API (Google Sheets integrated structure)
  app.get("/api/gradebook", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ grades: grades.filter((g) => g.courseId === courseId) });
    }
    res.json({ grades });
  });

  app.post("/api/gradebook/update", (req, res) => {
    const { studentId, courseId, evaluationTitle, evaluationType, term, score, maxScore, feedback } = req.body;
    const existing = grades.find(
      (g) => g.studentId === studentId && g.courseId === courseId && g.evaluationTitle === evaluationTitle
    );
    if (existing) {
      existing.score = Number(score);
      existing.feedback = feedback || existing.feedback;
      return res.json({ grade: existing, updated: true });
    }
    const newGrade: GradeEntry = {
      id: `g-${Date.now().toString().slice(-4)}`,
      courseId,
      studentId,
      evaluationTitle,
      evaluationType: evaluationType || "Examen",
      term: term || "1er Trimestre",
      score: Number(score),
      maxScore: maxScore ? Number(maxScore) : 10,
      feedback: feedback || "Calificación registrada",
      date: new Date().toISOString().split("T")[0],
    };
    grades.push(newGrade);
    res.status(201).json({ grade: newGrade, created: true });
  });

  // Drive Resources API (Google Drive structure)
  app.get("/api/drive/files", (req, res) => {
    const { courseId, folder } = req.query;
    let filtered = [...driveResources];
    if (courseId) {
      filtered = filtered.filter((r) => !r.courseId || r.courseId === courseId);
    }
    if (folder) {
      filtered = filtered.filter((r) => r.folder === folder);
    }
    res.json({ files: filtered });
  });

  app.post("/api/drive/upload", (req, res) => {
    const { name, type, folder, courseId } = req.body;
    const newFile: DriveResource = {
      id: `res-${Date.now().toString().slice(-4)}`,
      courseId: courseId || "c-101",
      name: name || "Nuevo Documento.docx",
      mimeType: type === "sheet" ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document",
      type: type || "doc",
      size: "850 KB",
      folder: folder || "Recursos Generales",
      modifiedTime: new Date().toISOString(),
      googleDriveUrl: `https://drive.google.com/open?id=mock-res-${Date.now().toString().slice(-4)}`,
      sharedWithClassroom: false,
    };
    driveResources.unshift(newFile);
    res.status(201).json({ file: newFile });
  });

  // Classroom API
  app.get("/api/classroom/tasks", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: classroomTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: classroomTasks });
  });

  app.post("/api/classroom/publish-task", (req, res) => {
    const { courseId, title, description, dueDate, maxPoints, driveAttachmentName } = req.body;
    const newTask: ClassroomTask = {
      id: `task-${Date.now().toString().slice(-4)}`,
      courseId: courseId || "c-101",
      title: title || "Nueva Tarea de Classroom",
      description: description || "Consignas detalladas en el archivo adjunto.",
      dueDate: dueDate || new Date(Date.now() + 7 * 86400000).toISOString(),
      maxPoints: maxPoints ? Number(maxPoints) : 100,
      status: "Publicada",
      submittedCount: 0,
      assignedCount: courses.find((c) => c.id === courseId)?.studentsCount || 25,
      driveAttachmentName: driveAttachmentName || "Material_Didáctico.gdoc",
      classroomUrl: `https://classroom.google.com/c/mock-${courseId}/a/new-task`,
    };
    classroomTasks.unshift(newTask);
    res.status(201).json({ task: newTask });
  });

  // -------------------------------------------------------------
  // AUTH & USER PERMISSIONS API (Google OAuth 2.0 Integration)
  // -------------------------------------------------------------
  app.get("/api/auth/user", (_req, res) => {
    res.json({
      authenticated: Boolean(activeUser),
      user: activeUser,
    });
  });

  app.post("/api/auth/session", (req, res) => {
    const { uid, email, name, avatar, scopes, school } = req.body;
    activeUser = {
      id: uid || (activeUser ? activeUser.id : `user-${Date.now()}`),
      email: email || (activeUser ? activeUser.email : ""),
      name: name || (activeUser ? activeUser.name : "Docente"),
      avatar: (avatar && !avatar.includes("photo-1534528741775"))
        ? avatar
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(name || email || "Docente")}&background=1d4ed8&color=ffffff&bold=true&size=150`,
      role: "Docente Titular",
      school: school || (activeUser?.school ? activeUser.school : "Institución Educativa"),
      scopes: scopes || (activeUser ? activeUser.scopes : []),
      permissions: [
        "tasks.create",
        "tasks.assign",
        "tasks.grade",
        "tasks.delete",
        "drive.read",
        "drive.attach",
        "classroom.sync",
        "students.view",
        "grades.manage",
      ],
      lastLogin: new Date().toISOString(),
    };
    res.json({ success: true, user: activeUser });
  });

  app.post("/api/auth/logout", (_req, res) => {
    activeUser = null;
    res.json({ success: true, message: "Sesión de docente finalizada correctamente." });
  });

  app.get("/api/auth/permissions", (_req, res) => {
    res.json({
      role: activeUser?.role || "Docente Titular",
      permissions: activeUser?.permissions || [],
      scopes: activeUser?.scopes || [],
    });
  });

  // -------------------------------------------------------------
  // TEACHER TASK & ASSIGNMENT MANAGEMENT API (Module 1)
  // -------------------------------------------------------------
  app.get("/api/tasks", (req, res) => {
    const { courseId } = req.query;
    if (courseId) {
      return res.json({ tasks: teacherTasks.filter((t) => t.courseId === courseId) });
    }
    res.json({ tasks: teacherTasks });
  });

  app.get("/api/tasks/:id", (req, res) => {
    const task = teacherTasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    res.json({ task });
  });

  app.post("/api/tasks", (req, res) => {
    const { courseId, title, description, category, dueDate, maxPoints, driveAttachments } = req.body;
    if (!courseId || !title) {
      return res.status(400).json({ error: "Curso y título de la tarea son obligatorios." });
    }

    const course = courses.find((c) => c.id === courseId);
    const courseStudents = students.filter((s) => s.courseId === courseId);

    // Build initial student submissions array
    const submissions: StudentSubmission[] = courseStudents.map((student) => ({
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      studentEmail: student.email,
      studentAvatar: student.avatar,
      status: "Pendiente",
      maxPoints: maxPoints ? Number(maxPoints) : 100,
    }));

    const newTask: TeacherTask = {
      id: `tt-${Date.now().toString().slice(-4)}`,
      courseId,
      courseName: course?.name || "Curso",
      title,
      description: description || "Consignas y material de apoyo adjunto.",
      category: category || "Tarea",
      dueDate: dueDate || new Date(Date.now() + 5 * 86400000).toISOString(),
      maxPoints: maxPoints ? Number(maxPoints) : 100,
      status: "Publicada",
      driveAttachments: Array.isArray(driveAttachments) ? driveAttachments : [],
      assignedCount: submissions.length,
      submittedCount: 0,
      gradedCount: 0,
      submissions,
      createdAt: new Date().toISOString(),
    };

    teacherTasks.unshift(newTask);

    // Keep classroomTasks in sync for compatibility
    classroomTasks.unshift({
      id: newTask.id,
      courseId: newTask.courseId,
      title: newTask.title,
      description: newTask.description,
      dueDate: newTask.dueDate,
      maxPoints: newTask.maxPoints,
      status: "Publicada",
      submittedCount: 0,
      assignedCount: newTask.assignedCount,
      driveAttachmentName: newTask.driveAttachments[0]?.name || "Recurso_Drive.gdoc",
      classroomUrl: `https://classroom.google.com/c/${courseId}/a/${newTask.id}`,
    });

    res.status(201).json({ task: newTask });
  });

  app.post("/api/tasks/:taskId/grade", (req, res) => {
    const { taskId } = req.params;
    const { studentId, grade, feedback } = req.body;

    const task = teacherTasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    const sub = task.submissions.find((s) => s.studentId === studentId);
    if (!sub) {
      return res.status(404).json({ error: "Entrega del estudiante no encontrada en esta tarea." });
    }

    sub.status = "Calificado";
    sub.grade = Number(grade);
    if (feedback !== undefined) sub.feedback = feedback;

    // Recalculate stats
    task.gradedCount = task.submissions.filter((s) => s.status === "Calificado").length;
    task.submittedCount = task.submissions.filter((s) => s.status === "Entregado" || s.status === "Calificado" || s.status === "Entrega Tardía").length;

    // Automatically record in course Gradebook for sheets sync!
    const existingGrade = grades.find(
      (g) => g.studentId === studentId && g.courseId === task.courseId && g.evaluationTitle === task.title
    );
    if (existingGrade) {
      existingGrade.score = Number(grade);
      if (feedback) existingGrade.feedback = feedback;
    } else {
      grades.push({
        id: `g-${Date.now().toString().slice(-4)}`,
        courseId: task.courseId,
        studentId,
        evaluationTitle: task.title,
        evaluationType: task.category === "Proyecto" ? "Proyecto" : "Trabajo Práctico",
        term: "1er Trimestre",
        score: Number(grade),
        maxScore: task.maxPoints,
        feedback: feedback || "Calificado desde el Módulo de Tareas",
        date: new Date().toISOString().split("T")[0],
      });
    }

    res.json({ success: true, submission: sub, task });
  });

  app.post("/api/tasks/:taskId/status", (req, res) => {
    const { taskId } = req.params;
    const { status } = req.body;
    const task = teacherTasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    task.status = status;
    res.json({ success: true, task });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    teacherTasks = teacherTasks.filter((t) => t.id !== req.params.id);
    res.json({ success: true, message: "Tarea eliminada correctamente." });
  });

  // Teacher AI Assistant Endpoint (using Gemini via @google/genai with robust pedagogy fallback)
  app.post("/api/ai/assistant", async (req, res) => {
    const { prompt, type, subject, grade, topic } = req.body;

    // Check if Gemini key is available
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const systemPrompt = `Eres un asesor pedagógico de excelencia para docentes de nivel secundario y universitario.
Tu objetivo es asistir al docente creando contenidos didácticos de alta calidad, estructurados en formato profesional.
El usuario te solicitará:
- "lesson_plan": Una planificación pedagógica completa con Objetivos, Competencias, Inicio (15%), Desarrollo (60%), Cierre (25%), Rúbrica de evaluación y Recursos recomendados.
- "rubric": Una matriz de evaluación analítica con niveles (Sobresaliente, Notable, Aprobado, En Proceso) y descriptores claros.
- "feedback": Devolución formativa y constructiva para un alumno o curso.
- "questions": Un banco de preguntas de evaluación diversificadas (opción múltiple, desarrollo, estudio de caso).

Responde siempre en español, con redacción pedagógica clara, moderna y aplicable directamente en el aula o en Google Docs / Google Classroom.`;

        const userContent = `Tipo de solicitud: ${type || "general"}
Materia: ${subject || "General"}
Curso/Nivel: ${grade || "Secundaria"}
Tema: ${topic || "Tema general"}
Instrucción o requerimiento del docente:
${prompt}`;

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userContent}` }] },
          ],
        });

        const text = response.text || "No se obtuvo respuesta.";
        return res.json({ result: text, source: "gemini-3.8-flash" });
      } catch (err: any) {
        console.warn("Gemini API call failed, falling back to pedagogical engine:", err?.message);
      }
    }

    // Pedagogical Fallback Engine when Gemini Key is pending
    let fallbackText = "";
    if (type === "lesson_plan") {
      fallbackText = `### Planificación Didáctica: ${topic || "Tema Seleccionado"}
**Materia:** ${subject || "Ciencias Integradas"} | **Curso:** ${grade || "4to Año"} | **Duración Estimada:** 80 minutos

#### 1. Objetivos de Aprendizaje
- Comprender los principios fundamentales de ${topic || "este contenido"} y su relación con problemas del contexto real.
- Desarrollar habilidades de indagación crítica, trabajo colaborativo y argumentación basada en evidencias.

#### 2. Competencias a Desarrollar
- Pensamiento analítico y resolución de problemas.
- Alfabetización digital y uso de herramientas colaborativas (Google Docs y Sheets).
- Comunicación oral y escrita precisa.

#### 3. Secuencia Didáctica
- **Momento de Inicio (15 min):** Pregunta detonante / disparador visual proyectado en pantalla. Lluvia de ideas guiada para relevar concepciones previas.
- **Momento de Desarrollo (50 min):** Trabajo en grupos reducidos (3-4 estudiantes). Análisis de caso práctico utilizando la guía didáctica de Google Drive y registro de conclusiones intermedias.
- **Momento de Cierre (15 min):** Puesta en común de hallazgos. Ticket de salida de evaluación diagnóstica en Google Classroom para verificar asimilación.

#### 4. Estrategia de Evaluación Formativa
- Observación directa mediante lista de cotejo grupal.
- Evaluación entre pares de la entrega digital en Google Classroom.`;
    } else if (type === "rubric") {
      fallbackText = `### Rúbrica Analítica de Evaluación: ${topic || "Proyecto Didáctico"}
| Criterio | Sobresaliente (10-9) | Notable (8-7) | Aprobado (6) | En Proceso (<6) |
|---|---|---|---|---|
| **Comprensión Conceptual** | Domina con profundidad todos los conceptos clave de ${topic || "la unidad"} y los vincula a nuevos contextos. | Identifica los conceptos centrales y los aplica con mínimos errores. | Conoce los conceptos básicos pero muestra dudas en aplicaciones complejas. | Presenta confusiones significativas en las nociones nucleares. |
| **Rigor y Metodología** | Sigue una estructura metodológica impecable, citando fuentes fiables y justificando cada paso. | Cumple con la estructura requerida con claridad y fundamentación sólida. | Cumple parcialmente con la metodología; justificación elemental. | Desarrollo desorganizado o sin sustento argumentativo. |
| **Colaboración y Comunicación** | Comunica ideas con precisión técnica, escucha activamente y aporta soluciones al equipo. | Expresa con claridad sus conclusiones y colabora constructivamente. | Participación pasiva; comunicación aceptable pero básica. | Dificultades para trabajar en equipo o comunicar hallazgos. |`;
    } else {
      fallbackText = `### Sugerencias Pedagógicas para el Docente
Para abordar el tema **"${topic || "propuesto"}"** en ${subject || "tu asignatura"}:
1. **Conexión con Google Workspace:** Te recomendamos crear una plantilla en Google Docs con preguntas guía y compartirla como copia individual en Google Classroom.
2. **Monitoreo Continuo:** Utiliza una planilla en Google Sheets para registrar la autoevaluación de cada estudiante y detectar alertas tempranas de rendimiento.
3. **Recursos de Drive:** Agrupa el material de lectura y vídeos de soporte en una carpeta compartida de Google Drive para facilitar el acceso sin distracciones.`;
    }

    return res.json({ result: fallbackText, source: "pedagogical-template" });
  });

  // -------------------------------------------------------------
  // ASYNC JOBS API (Task Queue & Status Monitoring)
  // -------------------------------------------------------------
  app.get("/api/async-jobs", (_req, res) => {
    res.json(asyncJobs);
  });

  app.get("/api/async-jobs/:id", (req, res) => {
    const job = asyncJobs.find((j) => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job no encontrado" });
    }
    res.json(job);
  });

  // Aliases for /api/jobs
  app.get("/api/jobs", (_req, res) => {
    res.json(asyncJobs);
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = asyncJobs.find((j) => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job no encontrado" });
    }
    res.json(job);
  });

  // Helper endpoint to extract YouTube transcription
  app.post("/api/youtube/extract", (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Se requiere URL de YouTube" });
    }

    // Extract video ID or handle educational mock transcription
    const isMitosis = url.toLowerCase().includes("mitosis") || url.toLowerCase().includes("celular");
    const isMath = url.toLowerCase().includes("math") || url.toLowerCase().includes("matematica");

    let videoTitle = "Video Didáctico de Referencia";
    let transcriptText = "";

    if (isMitosis) {
      videoTitle = "Mitosis y el Ciclo Celular Explicado en 10 Minutos";
      transcriptText = `[00:00] Bienvenidos. Hoy exploramos cómo una sola célula se multiplica manteniendo intacto el genoma.\n[02:15] La profase inicia con la condensación de la cromatina y la disolución de la envoltura nuclear.\n[04:40] En la metafase, los cromosomas se alinean con máxima tensión en la placa metafásica.\n[07:10] Anafase: los cinetocoros traccionan hacia los polos opuestos dividiendo las cromátidas.\n[09:20] Telofase y citocinesis: se forman los nuevos núcleos y la membrana se estrangula en dos células hijas diploides.`;
    } else if (isMath) {
      videoTitle = "Funciones Polinómicas y sus Raíces Reales";
      transcriptText = `[00:00] Introducción a los polinomios de grado superior a dos y su comportamiento gráfico.\n[03:10] Regla de los signos de Descartes y teorema de Gauss para raíces racionales.\n[06:30] Factorización por regla de Ruffini y análisis del discriminante.\n[08:50] Puntos de inflexión y aplicaciones al modelado físico y económico.`;
    } else {
      videoTitle = "Explicación Conceptual y Fundamentos Teóricos";
      transcriptText = `[00:00] Presentación del tema central y relevancia en el mundo contemporáneo.\n[02:30] Desarrollo de los conceptos clave y evidencia experimental documentada.\n[05:45] Estudio de caso práctico con resolución guiada paso a paso.\n[08:15] Síntesis final, preguntas detonantes y actividades de autoevaluación sugeridas.`;
    }

    res.json({
      success: true,
      url,
      videoTitle,
      transcriptText,
      duration: "10:15 min",
      extractedAt: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------
  // DOCUMENT PARSER & SOURCE EXTRACTOR (DOCS / PDF / TXT / LINKS)
  // -------------------------------------------------------------
  app.post("/api/documents/parse", async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, linkUrl, docType } = req.body;

      // 1. If a link (Google Docs / Drive / Web) is submitted
      if (linkUrl && typeof linkUrl === "string") {
        const cleanUrl = linkUrl.trim();
        const docMatch = cleanUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        const driveMatch = cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        const docId = docMatch ? docMatch[1] : (driveMatch ? driveMatch[1] : null);

        let extractedText = "";
        let docTitle = "";

        if (docMatch) {
          docTitle = "Documento Google Docs Institucional";
          extractedText = `[Enlace Google Docs: ${cleanUrl}]\n• Document ID: ${docId}\n• Fuente vinculada para sincronización de estructura curricular y plantilla institucional.`;
        } else if (driveMatch) {
          docTitle = "Archivo en Google Drive";
          extractedText = `[Enlace Google Drive: ${cleanUrl}]\n• Recurso de referencia vinculado en la nube para planificación docente.`;
        } else {
          docTitle = "Enlace Web de Referencia";
          extractedText = `[Recurso Externo: ${cleanUrl}]\n• Enlace de normativa o contenido de cátedra incorporado como fuente de consulta.`;
        }

        return res.json({
          success: true,
          type: "link",
          fileName: docTitle,
          url: cleanUrl,
          docId: docId || undefined,
          text: extractedText,
          message: "Enlace vinculado correctamente como fuente de planificación.",
        });
      }

      // 2. If uploaded file
      if (!base64Data) {
        return res.status(400).json({ error: "No se recibió archivo ni enlace válido para procesar." });
      }

      const cleanBase64 = base64Data.includes(";base64,")
        ? base64Data.split(";base64,")[1]
        : base64Data;
      const buffer = Buffer.from(cleanBase64, "base64");
      const lowerName = (fileName || "").toLowerCase();
      const fileSize = `${(buffer.length / 1024).toFixed(0)} KB`;

      let extractedText = "";
      let docKind: "docx" | "pdf" | "text" = "text";

      // A. Word Documents (.docx)
      if (lowerName.endsWith(".docx")) {
        docKind = "docx";
        try {
          const mammothRes = await mammoth.extractRawText({ buffer });
          extractedText = mammothRes.value ? mammothRes.value.trim() : "";
        } catch (mErr: any) {
          console.warn("Mammoth extraction warning:", mErr?.message);
        }
      }

      // B. PDF Documents (.pdf)
      if (lowerName.endsWith(".pdf") || mimeType === "application/pdf") {
        docKind = "pdf";
        if (process.env.GEMINI_API_KEY) {
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const prompt =
              docType === "bibliography"
                ? "Extrae minuciosamente de este documento PDF la bibliografía, referencias bibliográficas, libros recomendados, autores, capítulos, lecturas sugeridas y conceptos clave de la cátedra. Devuelve el texto ordenado, claro y completo para que sirva de insumo de planificación docente."
                : docType === "normative"
                ? "Extrae con máxima fidelidad del siguiente documento PDF los contenidos mínimos obligatorios, núcleos de aprendizaje prioritarios (NAP), competencias, ejes temáticos y criterios oficiales del diseño curricular. Devuelve el contenido estructurado."
                : "Extrae con máxima fidelidad de esta plantilla institucional todas las secciones requeridas, estructura de planificación, fundamentación, objetivos, unidades y criterios de evaluación solicitados por el colegio.";

            const aiRes = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: {
                        mimeType: "application/pdf",
                        data: cleanBase64,
                      },
                    },
                    { text: prompt },
                  ],
                },
              ],
            });

            extractedText = aiRes.text ? aiRes.text.trim() : "";
          } catch (pdfErr: any) {
            console.warn("Gemini PDF extraction warning:", pdfErr?.message);
          }
        }

        // Fallback if Gemini unavailable or returned empty
        if (!extractedText) {
          const rawString = buffer.toString("binary");
          const textMatches = rawString.match(/\(([^()]{3,})\)/g);
          if (textMatches && textMatches.length > 5) {
            extractedText = textMatches
              .map((m) => m.slice(1, -1))
              .filter((t) => t.length > 2 && !/^[0-9\s]+$/.test(t))
              .join(" ")
              .slice(0, 3000);
          }
        }
      }

      // C. Plain Text / Markdown / CSV / RTF
      if (
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".csv") ||
        lowerName.endsWith(".rtf")
      ) {
        docKind = "text";
        extractedText = buffer.toString("utf-8");
      }

      // Final fallback if text could not be parsed
      if (!extractedText || !extractedText.trim()) {
        extractedText = `[Archivo: ${fileName} (${fileSize})]\nContenido registrado y procesado para la planificación de la asignatura.`;
      }

      return res.json({
        success: true,
        fileName,
        fileSize,
        type: docKind,
        text: extractedText,
        message: `Se cargó y extrajo el documento "${fileName}" con éxito.`,
      });
    } catch (error: any) {
      console.error("Error al procesar documento:", error);
      return res.status(500).json({ error: error.message || "Error al procesar el archivo subido" });
    }
  });

  // -------------------------------------------------------------
  // NOTEBOOKLM INTEGRATION & MULTIMODAL TOOLBOX
  // -------------------------------------------------------------
  app.post("/api/notebooklm/optimize-tokens", (req, res) => {
    const { text, targetRatio = 0.35 } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Se requiere texto para optimizar tokens" });
    }

    // Heuristic: ~4 chars per token in Spanish/English
    const rawTokens = Math.max(1, Math.round(text.length / 4));

    // Extract key sentences and structured bullets
    const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);
    const keyPoints: string[] = [];

    paragraphs.forEach((p) => {
      const clean = p.replace(/^[-*#\d.]+\s*/, "").trim();
      if (clean.length > 20 && keyPoints.length < 8) {
        keyPoints.push(clean);
      }
    });

    if (keyPoints.length === 0) {
      keyPoints.push(text.slice(0, 200) + "...");
    }

    const compressedContent = `### Síntesis Contextual Indexada (Optimizada para IA)\n` +
      keyPoints.map((pt, idx) => `• [Punto Clave ${idx + 1}]: ${pt}`).join("\n");

    const optimizedTokens = Math.max(20, Math.round(compressedContent.length / 4));
    const savedTokens = Math.max(0, rawTokens - optimizedTokens);
    const percentageSaved = Math.min(88, Math.max(15, Math.round((savedTokens / rawTokens) * 100)));

    res.json({
      success: true,
      originalTokens: rawTokens,
      optimizedTokens,
      savedTokens,
      percentageSaved,
      compressedContent,
      keyPoints,
    });
  });

  app.post("/api/notebooklm/audio-overview", (req, res) => {
    const { title, content, courseName, subject } = req.body;
    const topic = title || subject || "Contenido Pedagógico";

    const script = [
      {
        speaker: "Profa. Sofía",
        role: "Docente Titular",
        avatar: "🦉",
        text: `¡Hola colegas! Bienvenidos a este breve resumen pedagógico sobre "${topic}". Hoy vamos a sintetizar las ideas centrales para que puedan aplicarlas directamente en clase o compartirlas con sus estudiantes.`,
      },
      {
        speaker: "Prof. Martín",
        role: "Coordinador Pedagógico",
        avatar: "👨‍🏫",
        text: `Excelente Sofía. Lo más potente de este material es cómo conecta los conceptos teóricos con situaciones prácticas. Al revisar el documento, queda claro que el objetivo principal es asegurar una asimilación activa sin sobrecargar de lectura innecesaria.`,
      },
      {
        speaker: "Profa. Sofía",
        role: "Docente Titular",
        avatar: "🦉",
        text: `Exacto. Para el trabajo en el aula, sugerimos iniciar con la pregunta disparadora del material, luego pasar al análisis guiado en grupos, y cerrar con un ticket de salida en Google Classroom para verificar que todos captaron el núcleo del tema.`,
      },
      {
        speaker: "Prof. Martín",
        role: "Coordinador Pedagógico",
        avatar: "👨‍🏫",
        text: `Un gran recordatorio. Recuerden que este documento ya está formateado para que puedan llevarlo a NotebookLM o exportarlo a Google Docs con un solo clic. ¡A seguir innovando en el aula!`,
      },
    ];

    const fullSummary = script.map((s) => `${s.speaker}: ${s.text}`).join("\n\n");

    res.json({
      success: true,
      title: `Podcast Pedagógico: ${topic}`,
      duration: "2:30 min",
      speakers: ["Profa. Sofía", "Prof. Martín"],
      script,
      summaryText: fullSummary,
    });
  });

  app.post("/api/notebooklm/video-to-pedagogical", (req, res) => {
    const { videoUrl, transcript, moduleType } = req.body;
    const sourceText = transcript || `Video de referencia analizado en Docenc.IA: ${videoUrl || "Recurso educativo"}`;

    const pedagogicalOutput = {
      summary: "El video desarrolla conceptos nucleares con apoyatura visual, facilitando la comprensión secuencial de los fenómenos estudiados.",
      keyConcepts: [
        "Identificación de premisas y marco conceptual inicial.",
        "Mecanismos de acción y relación causa-efecto demostrada en pantalla.",
        "Errores conceptuales frecuentes en los alumnos y cómo desarticularlos.",
        "Conclusiones transferibles a la resolución de problemas en el aula.",
      ],
      suggestedQuestions: [
        "¿Cuál es el factor determinante explicado en la primera mitad del video?",
        "¿Cómo justificarías con tus palabras el resultado final presentado en el experimento?",
        "¿Qué similitudes encuentras entre lo expuesto en el video y el caso de estudio de la guía?",
      ],
      suggestedClassActivity: "Proyectar los primeros 4 minutos como disparador; luego pausar para que los alumnos predigan el desenlace en Google Forms antes de ver el final.",
    };

    res.json({
      success: true,
      videoUrl,
      moduleType,
      pedagogicalOutput,
    });
  });

  // -------------------------------------------------------------
  // MÓDULO 1: RAG PLANIFICACIÓN INSTITUCIONAL -> GOOGLE DOCS
  // -------------------------------------------------------------
  app.get("/api/rag/plans", (req, res) => {
    const courseId = req.query.courseId as string | undefined;
    if (courseId) {
      const filtered = ragPlans.filter((p) => p.courseId === courseId);
      return res.json(filtered);
    }
    res.json(ragPlans);
  });

  app.get("/api/rag/plans/:id", (req, res) => {
    const plan = ragPlans.find((p) => p.id === req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    res.json(plan);
  });

  app.delete("/api/rag/plans/:id", (req, res) => {
    const { id } = req.params;
    const initialLen = ragPlans.length;
    ragPlans = ragPlans.filter((p) => p.id !== id);
    if (ragPlans.length === initialLen) {
      return res.status(404).json({ error: "Planificación no encontrada." });
    }
    res.json({
      success: true,
      message: "Planificación eliminada exitosamente.",
      id,
    });
  });

  app.post("/api/rag/plans/clear", (req, res) => {
    const { courseId } = req.body || {};
    if (courseId) {
      ragPlans = ragPlans.filter((p) => p.courseId !== courseId);
    } else {
      ragPlans = [];
    }
    res.json({
      success: true,
      message: "Se han eliminado las planificaciones. Espacio de trabajo limpio.",
    });
  });

  app.post("/api/rag/lesson-plan", async (req, res) => {
    const {
      courseId,
      subject,
      gradeLevel,
      studentAge,
      institutionalTemplateText,
      curriculumNormsText,
      bibliographyText,
    } = req.body;

    const course = courses.find((c) => c.id === courseId) || courses[0];
    const jobId = `job-rag-${Date.now()}`;
    const newJob: AsyncJob = {
      id: jobId,
      type: "rag_lesson_plan",
      title: `Planificación RAG: ${subject || course.subject} (${gradeLevel || course.grade})`,
      status: "procesando",
      progress: 25,
      currentStep: "Indexando plantilla institucional y diseño curricular...",
      createdAt: new Date().toISOString(),
      params: { courseId, subject, gradeLevel, studentAge },
      logs: [
        `[${new Date().toLocaleTimeString()}] Iniciando pipeline RAG con ${studentAge || "15-16 años"}...`,
        `[${new Date().toLocaleTimeString()}] Analizando campos obligatorios de la plantilla institucional...`,
      ],
    };
    asyncJobs.unshift(newJob);

    // Simulate async pipeline transition
    setTimeout(async () => {
      try {
        newJob.progress = 60;
        newJob.currentStep = "Cruzando normativas curriculares oficiales con bibliografía docente...";
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Vectorizando fragmentos curriculares y contenidos prioritarios...`);

        let generatedFundamentacion = "";
        let generatedExpectativas: string[] = [];
        let generatedUnits: any[] = [];
        let generatedEstrategias: string[] = [];
        let generatedEvaluacion: string[] = [];
        let generatedBiblio: string[] = [];

        // Check if Gemini API can be queried
        if (process.env.GEMINI_API_KEY) {
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const prompt = `Actúa como asesor pedagógico y especialista en diseño curricular.
Debes generar una Planificación Anual completa que respete estrictamente los requerimientos de la plantilla institucional del docente, integrando el diseño curricular oficial y la bibliografía de referencia.
Materia: ${subject || course.subject}
Nivel/Curso: ${gradeLevel || course.grade}
Edad promedio estudiantes: ${studentAge || "15-16 años"}
Requerimientos de la Plantilla Institucional:
${institutionalTemplateText || "Fundamentación, Expectativas de logro, 3 Unidades bimestrales, Estrategias de enseñanza, Criterios de evaluación y Bibliografía."}

Normativas Oficiales / Diseño Curricular:
${curriculumNormsText || "Núcleos de aprendizaje prioritarios, indagación científica, alfabetización digital y pensamiento crítico."}

Bibliografía del Docente:
${bibliographyText || "Textos canónicos de la disciplina y recursos abiertos de divulgación."}

Responde en formato JSON válido con las siguientes claves:
{
  "fundamentacion": "texto amplio",
  "expectativasLogro": ["expectativa 1", "expectativa 2", "expectativa 3", "expectativa 4"],
  "contenidosPorUnidad": [
    {"unidad": "Unidad 1", "nombre": "Título", "temas": ["tema 1", "tema 2"], "cronograma": "1er Trimestre"},
    {"unidad": "Unidad 2", "nombre": "Título", "temas": ["tema 1", "tema 2"], "cronograma": "2do Trimestre"},
    {"unidad": "Unidad 3", "nombre": "Título", "temas": ["tema 1", "tema 2"], "cronograma": "3er Trimestre"}
  ],
  "estrategiasEnsenanza": ["estrategia 1", "estrategia 2", "estrategia 3"],
  "criteriosEvaluacion": ["criterio 1", "criterio 2", "criterio 3"],
  "bibliografiaObligatoria": ["fuente 1", "fuente 2"]
}`;

            const geminiRes = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: [{ role: "user", parts: [{ text: prompt }] }],
            });

            const rawText = geminiRes.text || "";
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              generatedFundamentacion = parsed.fundamentacion || "";
              generatedExpectativas = parsed.expectativasLogro || [];
              generatedUnits = parsed.contenidosPorUnidad || [];
              generatedEstrategias = parsed.estrategiasEnsenanza || [];
              generatedEvaluacion = parsed.criteriosEvaluacion || [];
              generatedBiblio = parsed.bibliografiaObligatoria || [];
            }
          } catch (e: any) {
            console.warn("Gemini RAG call fallback:", e?.message);
          }
        }

        // Default fallbacks if Gemini not present or parsed empty
        if (!generatedFundamentacion) {
          generatedFundamentacion = `La asignatura ${subject || course.subject} se fundamenta en los lineamientos curriculares vigentes y la normativa institucional, promoviendo el aprendizaje significativo, la resolución de problemas auténticos y el desarrollo de competencias cognitivas y digitales acordes a la franja de ${studentAge || "15-16 años"}.`;
          generatedExpectativas = [
            `Dominar los conceptos nucleares de ${subject || course.subject} vinculándolos al entorno real.`,
            "Desarrollar autonomía en la investigación, el trabajo colaborativo y la comunicación fundamentada.",
            "Utilizar herramientas digitales (Google Workspace) para el registro, modelado y comunicación de proyectos.",
            "Evidenciar actitud reflexiva y compromiso con las pautas éticas e institucionales.",
          ];
          generatedUnits = [
            {
              unidad: "Unidad 1",
              nombre: `Introducción a los Modelos de ${subject || "la Disciplina"}`,
              temas: ["Fundamentos teóricos y antecedentes", "Metodología de indagación y registro", "Práctica diagnóstica inicial"],
              cronograma: "Marzo - Mayo (1er Trimestre)",
            },
            {
              unidad: "Unidad 2",
              nombre: "Desarrollo y Profundización Conceptual",
              temas: ["Leyes y principios fundamentales", "Resolución de casos y experimentación", "Integración digital"],
              cronograma: "Junio - Agosto (2do Trimestre)",
            },
            {
              unidad: "Unidad 3",
              nombre: "Aplicaciones Contemporáneas y Proyecto Integrador",
              temas: ["Debates actuales y tecnología", "Proyecto final colaborativo", "Síntesis y muestra escolar"],
              cronograma: "Septiembre - Noviembre (3er Trimestre)",
            },
          ];
          generatedEstrategias = [
            "Aprendizaje Basado en Proyectos y resolución de problemas auténticos.",
            "Uso continuo de carpetas y documentos compartidos en Google Drive.",
            "Secuencias didácticas diversificadas con rúbricas de retroalimentación formativa.",
          ];
          generatedEvaluacion = [
            "Evaluación de proceso: seguimiento continuo en Google Classroom (30%).",
            "Trabajos prácticos grupales y portfolios digitales en Google Docs (40%).",
            "Instancias sumativas y cuestionarios interactivos de Google Forms (30%).",
          ];
          generatedBiblio = [
            "Bibliografía obligatoria seleccionada por la cátedra docente.",
            "Diseño Curricular Jurisdiccional y Cuadernos Pedagógicos Oficiales.",
          ];
        }

        const planId = `rag-plan-${Date.now()}`;
        const newPlan: RagPlanResult = {
          id: planId,
          courseId: course.id,
          title: `Planificación Oficial: ${subject || course.subject}`,
          subject: subject || course.subject,
          gradeLevel: gradeLevel || course.grade,
          studentAge: studentAge || "15-16 años",
          institutionalTemplateName: "Plantilla Oficial Docente 2026",
          sections: {
            fundamentacion: generatedFundamentacion,
            expectativasLogro: generatedExpectativas,
            contenidosPorUnidad: generatedUnits,
            estrategiasEnsenanza: generatedEstrategias,
            criteriosEvaluacion: generatedEvaluacion,
            bibliografiaObligatoria: generatedBiblio,
          },
          googleDocUrl: `https://docs.google.com/document/d/${planId}/edit`,
          googleDocId: planId,
          createdAt: new Date().toISOString(),
        };
        ragPlans.unshift(newPlan);

        // Add to teacher drive files
        driveResources.unshift({
          id: `doc-${planId}`,
          courseId: course.id,
          name: `Planificación Oficial - ${newPlan.title}.docx`,
          mimeType: "application/vnd.google-apps.document",
          type: "doc",
          size: "420 KB",
          folder: "Planificaciones Oficiales",
          modifiedTime: new Date().toISOString(),
          googleDriveUrl: newPlan.googleDocUrl,
          sharedWithClassroom: true,
        });

        newJob.progress = 100;
        newJob.status = "finalizado";
        newJob.completedAt = new Date().toISOString();
        newJob.currentStep = "Documento Google Docs generado y guardado en Drive";
        newJob.result = { planId, docUrl: newPlan.googleDocUrl };
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Planificación completada y exportada como Google Doc editable.`);
      } catch (err: any) {
        newJob.status = "fallido";
        newJob.currentStep = "Error en el pipeline RAG";
        newJob.logs.push(`Error: ${err.message}`);
      }
    }, 1500);

    res.json({
      success: true,
      message: "Procesamiento RAG iniciado en segundo plano",
      jobId,
    });
  });

  // -------------------------------------------------------------
  // MÓDULO 2: GENERADOR DE MATERIAL DIDÁCTICO (MANUAL EN DRIVE)
  // -------------------------------------------------------------
  app.get("/api/manuals", (_req, res) => {
    res.json(interactiveManuals);
  });

  app.get("/api/manuals/:id", (req, res) => {
    const manual = interactiveManuals.find((m) => m.id === req.params.id);
    if (!manual) return res.status(404).json({ error: "Manual no encontrado" });
    res.json(manual);
  });

  app.delete("/api/manuals/:id", (req, res) => {
    const { id } = req.params;
    interactiveManuals = interactiveManuals.filter((m) => m.id !== id);
    res.json({ success: true, message: "Manual didáctico eliminado.", id });
  });

  app.post("/api/manuals/clear", (_req, res) => {
    interactiveManuals = [];
    res.json({ success: true, message: "Manuales didácticos eliminados." });
  });

  app.post("/api/manuals/import-notebooklm", (req, res) => {
    const {
      manualId,
      title,
      subject,
      targetLevel,
      studentAge,
      orientation,
      chapter,
    } = req.body;

    const chapterTopic = chapter?.topicTitle || "Capítulo de NotebookLM";
    let targetManual = interactiveManuals.find((m) => m.id === manualId);

    const newChapter: ManualChapter = {
      id: `ch-nlm-${Date.now()}`,
      topicTitle: chapterTopic,
      order: targetManual ? targetManual.chapters.length + 1 : 1,
      intro: chapter?.intro || `Material didáctico sobre ${chapterTopic} generado con NotebookLM.`,
      contentBody: chapter?.contentBody || "",
      keyConcepts: chapter?.keyConcepts || [chapterTopic, orientation || "Orientación General", targetLevel || "Secundario"],
      callouts: chapter?.callouts || [
        {
          type: "clave",
          text: `Concepto Clave: Analizar los aspectos centrales de ${chapterTopic} con enfoque en ${orientation || "la disciplina"}.`,
        },
      ],
      suggestedIllustrations: chapter?.suggestedIllustrations || [`Infografía didáctica de ${chapterTopic}`],
      comprehensionActivities: chapter?.comprehensionActivities || [
        `Explica con tus palabras el concepto principal de ${chapterTopic}.`,
      ],
    };

    if (targetManual) {
      targetManual.chapters.push(newChapter);
      targetManual.lastUpdated = new Date().toISOString();
    } else {
      const manualTitle = title || `Material Didáctico: ${chapterTopic}`;
      targetManual = {
        id: `man-nlm-${Date.now()}`,
        title: manualTitle,
        subject: subject || orientation || "Material Didáctico",
        targetLevel: targetLevel || "Secundario",
        studentAge: studentAge || "Secundario",
        associatedPlanId: "notebooklm-import",
        chapters: [newChapter],
        driveFileUrl: `https://docs.google.com/document/d/notebooklm-${Date.now()}/edit`,
        driveFolder: `Drive Docente > ${orientation || "Material Didáctico"} > NotebookLM`,
        lastUpdated: new Date().toISOString(),
      };
      interactiveManuals.unshift(targetManual);

      driveResources.unshift({
        id: `doc-${targetManual.id}`,
        name: `${manualTitle}.docx`,
        mimeType: "application/vnd.google-apps.document",
        type: "doc",
        size: "1.4 MB",
        folder: "Materiales NotebookLM",
        modifiedTime: new Date().toISOString(),
        googleDriveUrl: targetManual.driveFileUrl,
        sharedWithClassroom: true,
      });
    }

    res.json({ success: true, manual: targetManual });
  });

  interface CustomGem {
    id: string;
    name: string;
    description: string;
    directives: string;
    createdAt: string;
  }

  const customGems: CustomGem[] = [
    {
      id: "gem-socratico",
      name: "Gem Diálogo Socrático",
      description: "Preguntas disparadoras, pensamiento crítico y debate guiado.",
      directives: "Fomentar el método socrático con preguntas abiertas que desafíen a los estudiantes a formular y justificar sus hipótesis antes de dar respuestas cerradas.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "gem-tecnico",
      name: "Gem Aplicación Práctica & Taller",
      description: "Casos reales, resolución de problemas y aplicaciones cotidianas.",
      directives: "Explicar los conceptos con ejemplos prácticos y aplicaciones directas en la vida real, tecnología y situaciones problemáticas concretas de la vida cotidiana.",
      createdAt: new Date().toISOString(),
    },
  ];

  app.get("/api/custom-gems", (_req, res) => {
    res.json({ success: true, gems: customGems });
  });

  app.post("/api/custom-gems", (req, res) => {
    const { name, description, directives } = req.body || {};
    if (!name || !directives) {
      return res.status(400).json({ error: "Nombre y directivas son obligatorios." });
    }
    const newGem: CustomGem = {
      id: `gem-${Date.now()}`,
      name: name.trim(),
      description: (description || "").trim() || "Gem personalizado del docente",
      directives: directives.trim(),
      createdAt: new Date().toISOString(),
    };
    customGems.unshift(newGem);
    res.json({ success: true, gem: newGem });
  });

  app.delete("/api/custom-gems/:id", (req, res) => {
    const { id } = req.params;
    const index = customGems.findIndex((g) => g.id === id);
    if (index >= 0) {
      customGems.splice(index, 1);
    }
    res.json({ success: true, message: "Gem eliminado" });
  });

  app.post("/api/custom-gems/generate-directives", async (req, res) => {
    try {
      const { idea, subject, orientation, studentAge } = req.body || {};
      if (!idea) {
        return res.status(400).json({ error: "Debe ingresar una idea o descripción básica." });
      }
      let generatedDirectives = `Actúa como un Gem docente experto. Foco: ${idea}. Adapta el vocabulario a estudiantes de ${studentAge || "secundaria"} y vincula los contenidos con ${orientation || "la orientación escolar"}. Utiliza ejemplos prácticos, preguntas disparadoras y estimula el pensamiento crítico.`;

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const prompt = `Eres un diseñador de perfiles de IA educativa (Gems de Google).
Un docente de educación secundaria quiere crear un Gem con la siguiente idea o descripción:
"${idea}"

Contexto escolar:
- Orientación: ${orientation || "Ciencias Sociales / Ciencias Naturales"}
- Nivel de los alumnos: ${studentAge || "Secundario (13 a 18 años)"}
- Asignatura: ${subject || orientation || "Material didáctico"}

Escribe las directivas completas de comportamiento (System Prompt) para este Gem docente.
Las instrucciones deben ser claras, directas, profesionales y enfocadas en educación secundaria:
- Define el rol docente y el tono pedagógico.
- Indica cómo debe explicar los conceptos y realizar la transposición didáctica.
- Especifica el estilo de los cuadros de llamada (ejemplos, curiosidades, preguntas de reflexión).
- Indica cómo debe plantear las actividades de comprensión para motivar a los estudiantes.

Devuelve ÚNICAMENTE las directivas de texto plano listas para usar, sin títulos introductorios ni comillas decorativas.`;

          const aiRes = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          });
          if (aiRes.text) {
            generatedDirectives = aiRes.text.trim();
          }
        } catch (e: any) {
          console.warn("Error calling Gemini for gem directives:", e?.message);
        }
      }

      res.json({ success: true, directives: generatedDirectives });
    } catch (err: any) {
      console.error("Error in generate-directives:", err);
      res.status(500).json({ error: err.message || "Error al generar directivas con IA" });
    }
  });

  app.post("/api/manuals", async (req, res) => {
    try {
      const {
        manualId,
        title,
        subject,
        targetLevel,
        studentAge,
        orientation,
        aiEngine = "notebooklm-rag",
        customDirectives,
        generalSourceInstructions,
        incrementalTopic,
        sources, // array of { type, title, urlOrContent, instructions, timeRange, pageRange }
        priorPlanId,
      } = req.body || {};

      let engineLabel = "Motor NotebookLM (RAG Multimodal)";
      let specificEngineInstruction = "";

      const selectedCustomGem = customGems.find((g) => g.id === aiEngine);
      if (selectedCustomGem) {
        engineLabel = `Gem Personalizado: ${selectedCustomGem.name}`;
        specificEngineInstruction = `- Si el motor es "${engineLabel}": Aplica estrictamente las directivas personalizadas del Gem: "${selectedCustomGem.directives}".`;
      } else if (
        aiEngine === "gem-docente" ||
        aiEngine === "gem-pedagogico" ||
        aiEngine === "gem-disciplinar"
      ) {
        engineLabel = `Gem Docente Integral (Pedagógico + ${orientation || "Disciplinar"})`;
        specificEngineInstruction = `- Si el motor es "Gem Docente Integral": Combina de forma equilibrada la transposición didáctica (adaptando el lenguaje, motivación y analogías para estudiantes de ${studentAge || "Secundario"}) con un riguroso marco conceptual, metodológico y epistemológico propio de ${orientation || "la orientación escolar"}.`;
      } else {
        engineLabel = "Motor NotebookLM (RAG Multimodal)";
        specificEngineInstruction = `- Si el motor es "Motor NotebookLM (RAG Multimodal)": Ancla la explicación de forma estricta y transparente en las fuentes provistas (documentos de Drive, PDFs, transcripciones de YouTube). Cita ideas centrales derivadas de las fuentes.`;
      }

      const jobId = `job-man-${Date.now()}`;
      const newJob: AsyncJob = {
        id: jobId,
        type: "interactive_manual",
        title: `Material Didáctico: ${title || subject || incrementalTopic || "Nuevo Tema"}`,
        status: "procesando",
        progress: 20,
        currentStep: `[${engineLabel}] Indexando fuentes y ejecutando grounding multimodal...`,
        createdAt: new Date().toISOString(),
        params: { manualId, title, incrementalTopic, aiEngine },
        logs: [
          `[${new Date().toLocaleTimeString()}] Iniciando ${engineLabel}...`,
          `[${new Date().toLocaleTimeString()}] Procesando ${sources?.length || 0} fuente(s) didáctica(s) (Drive, PDF, YouTube)...`,
          `[${new Date().toLocaleTimeString()}] Calibrando nivel para ${studentAge || "Secundario"} (${targetLevel || "Middle"}) - Orientación: ${orientation || "Ciencias"}...`,
        ],
      };
      asyncJobs.unshift(newJob);

      setTimeout(async () => {
      try {
        newJob.progress = 65;
        newJob.currentStep = `[${engineLabel}] Sintetizando conceptos, cuadros didácticos y actividades...`;
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Estructurando conceptos clave, ejemplos y actividades de comprensión...`);

        let chapterTitle = incrementalTopic || "Nuevo Capítulo Didáctico";
        let intro = `En este capítulo profundizamos sobre ${chapterTitle}, integrando las fuentes seleccionadas por el docente y estableciendo vínculos con la orientación en ${orientation || "la disciplina"}.`;
        let contentBody = `El análisis sistemático de las fuentes revela que ${chapterTitle} constituye un hito fundamental para la comprensión de ${subject || orientation || "la disciplina"}. A partir de los documentos y registros analizados, los modelos conceptuales se articulan para brindar herramientas sólidas a los estudiantes...`;
        let keyConcepts = [chapterTitle, orientation || "Orientación General", targetLevel || "Secundario", "Pensamiento Crítico"];
        let callouts = [
          {
            type: "clave" as const,
            text: `Concepto Clave: Identificar siempre la relación de causa y efecto en los fenómenos descritos en ${chapterTitle}.`,
          },
          {
            type: "curiosidad" as const,
            text: `Para Recordar: Los debates conceptuales contemporáneos siguen dialogando con estos fundamentos.`,
          },
        ];
        let suggestedIllustrations = [
          `Diagrama esquemático en alta resolución de ${chapterTitle}`,
          "Gráfico comparativo de variables con notas al pie",
        ];
        let comprehensionActivities = [
          `Redacta con tus palabras un resumen de 3 párrafos sobre ${chapterTitle}.`,
          "Resuelve la situación problemática planteada en la guía de trabajo colaborativo.",
        ];

        // If Gemini is available, customize content using specialized engine instructions
        if (process.env.GEMINI_API_KEY) {
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const formattedSources = (sources || []).map((s: any, idx: number) => {
              let details = `[Fuente ${idx + 1}] Tipo: ${s.type.toUpperCase()} | Título: "${s.title}"`;
              if (s.timeRange?.trim()) {
                details += `\n   ⏱️ RECORTE DE MINUTOS / TIEMPO: "${s.timeRange.trim()}" (IMPORTANTE: Considerar exclusivamente los conceptos explicados en este fragmento temporal del video)`;
              }
              if (s.pageRange?.trim()) {
                details += `\n   📄 RECORTE DE PÁGINAS: "${s.pageRange.trim()}" (IMPORTANTE: Considerar exclusivamente los contenidos de estas páginas del documento)`;
              }
              if (s.instructions?.trim()) {
                details += `\n   📌 INDICACIÓN ESPECÍFICA DEL DOCENTE: "${s.instructions.trim()}"`;
              }
              details += `\n   Contenido / Referencia: ${typeof s.urlOrContent === 'string' ? s.urlOrContent.slice(0, 3000) : JSON.stringify(s.urlOrContent)}`;
              return details;
            }).join('\n\n');

            const prompt = `Actúa como el motor de IA "${engineLabel}".
Tu misión es generar un capítulo completo de material didáctico interactivo para educación secundaria.

PARÁMETROS CURRICULARES:
- Año Escolar: ${studentAge || "Secundario"}
- Ciclo/Nivel: ${targetLevel || "Secundario"} (Middle si 1º a 3º, Senior si 4º a 6º)
- Orientación: ${orientation || "Ciencias Sociales / Ciencias Naturales"}
- Asignatura: ${subject || orientation || "Material Didáctico"}
- Tema a Desarrollar: "${incrementalTopic || "Tema Principal"}"

FUENTES PROPORCIONADAS POR EL DOCENTE (GROUNDING TIPO NOTEBOOKLM):
${formattedSources || "No se aportaron fuentes externas específicas. Utiliza el conocimiento curricular de la disciplina."}
${generalSourceInstructions?.trim() ? `\nINDICACIONES GENERALES DEL DOCENTE PARA LAS FUENTES:\n${generalSourceInstructions.trim()}\n` : ''}

REGLAS OBLIGATORIAS DE RECORTE Y ENFOQUE PEDAGÓGICO:
1. Si una fuente tiene recorte de tiempo/minutos (ej: "del minuto 02:00 al 05:30"), extrae y fundamenta únicamente los conceptos abordados en ese intervalo.
2. Si una fuente tiene recorte de páginas (ej: "páginas 15 a 22"), prioriza exclusivamente lo desarrollado en esas páginas.
3. Sigue al pie de la letra cualquier indicación específica que el docente haya dejado para cada fuente individual.

DIRECTIVAS ESPECÍFICAS SEGÚN MOTOR:
${specificEngineInstruction}
${customDirectives?.trim() ? `\nINSTRUCCIONES / DIRECTIVAS PERSONALIZADAS ADICIONALES DEL DOCENTE:\n${customDirectives.trim()}` : ''}

Responde ÚNICAMENTE en formato JSON válido con la siguiente estructura:
{
  "intro": "Párrafo introductorio de 2 o 3 oraciones que contextualice el tema en la orientación ${orientation} y despierte curiosidad.",
  "contentBody": "Desarrollo conceptual claro y riguroso de 2 o 3 párrafos, conectando la teoría con ejemplos concretos y las fuentes aportadas.",
  "keyConcepts": ["Concepto 1", "Concepto 2", "Concepto 3", "Concepto 4"],
  "callouts": [
    {"type": "clave", "text": "Concepto Clave indispensable para recordar."},
    {"type": "curiosidad", "text": "Dato curioso, anécdota histórica o hecho experimental."},
    {"type": "ejemplo", "text": "Ejemplo práctico o caso aplicado a la realidad cotidiana."},
    {"type": "reflexion", "text": "Pregunta reflexiva o dilema para debatir en clase."}
  ],
  "suggestedIllustrations": ["Descripción de infografía o diagrama conceptual 1", "Descripción de esquema gráfico 2"],
  "comprehensionActivities": [
    "Actividad de comprensión y análisis basada en el texto",
    "Pregunta de aplicación o resolución de caso colaborativo"
  ]
}`;

            const geminiRes = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: [{ role: "user", parts: [{ text: prompt }] }],
            });

            const match = (geminiRes.text || "").match(/\{[\s\S]*\}/);
            if (match) {
              const p = JSON.parse(match[0]);
              intro = p.intro || intro;
              contentBody = p.contentBody || contentBody;
              keyConcepts = p.keyConcepts || keyConcepts;
              callouts = p.callouts || callouts;
              suggestedIllustrations = p.suggestedIllustrations || suggestedIllustrations;
              comprehensionActivities = p.comprehensionActivities || comprehensionActivities;
            }
          } catch (e: any) {
            console.warn("Gemini Manual generation fallback:", e?.message);
          }
        }

        let targetManual = interactiveManuals.find((m) => m.id === manualId);
        const newChapter: ManualChapter = {
          id: `ch-${Date.now()}`,
          topicTitle: chapterTitle,
          order: targetManual ? targetManual.chapters.length + 1 : 1,
          intro,
          contentBody,
          keyConcepts,
          callouts,
          suggestedIllustrations,
          comprehensionActivities,
        };

        if (targetManual) {
          targetManual.chapters.push(newChapter);
          targetManual.lastUpdated = new Date().toISOString();
        } else {
          targetManual = {
            id: `man-${Date.now()}`,
            title: title || `Manual Interactivo de ${subject || "Estudio"}`,
            subject: subject || "Materia General",
            targetLevel: targetLevel || "Secundaria",
            studentAge: studentAge || "15-16 años",
            associatedPlanId: priorPlanId || "rag-plan-1",
            chapters: [newChapter],
            driveFileUrl: `https://docs.google.com/document/d/manual-${Date.now()}/edit`,
            driveFolder: `Drive Docente > ${subject || "Material Didáctico"} > Manuales`,
            lastUpdated: new Date().toISOString(),
          };
          interactiveManuals.unshift(targetManual);

          // Add to Drive resources
          driveResources.unshift({
            id: `doc-${targetManual.id}`,
            name: `${targetManual.title}.docx`,
            mimeType: "application/vnd.google-apps.document",
            type: "doc",
            size: "1.8 MB",
            folder: "Manuales Didácticos Interactivos",
            modifiedTime: new Date().toISOString(),
            googleDriveUrl: targetManual.driveFileUrl,
            sharedWithClassroom: true,
          });
        }

        newJob.progress = 100;
        newJob.status = "finalizado";
        newJob.completedAt = new Date().toISOString();
        newJob.currentStep = "Manual interactivo sincronizado en Google Drive";
        newJob.result = { manualId: targetManual.id, driveUrl: targetManual.driveFileUrl };
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Capítulo agregado y guardado en Google Drive.`);
      } catch (err: any) {
        newJob.status = "fallido";
        newJob.currentStep = "Error al generar manual";
        newJob.logs.push(`Error: ${err.message}`);
      }
    }, 1500);

    res.json({
      success: true,
      message: "Generación de manual en proceso",
      jobId,
    });
  } catch (err: any) {
    console.error("[POST /api/manuals error]:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Error al iniciar la generación de manual",
    });
  }
});

  // -------------------------------------------------------------
  // MÓDULO 3 Y 4: ACTIVIDADES, EVALUACIONES, FEEDBACK Y LIBRETA
  // -------------------------------------------------------------
  app.get("/api/activities", (_req, res) => {
    res.json(formActivities);
  });

  app.post("/api/activities/generate", async (req, res) => {
    const { topic, ageGroup, activityType, courseId, questionCount } = req.body;
    const course = courses.find((c) => c.id === courseId) || courses[0];

    const actId = `act-${Date.now()}`;
    const count = Number(questionCount) || 3;

    const generatedQuestions: FormQuestionItem[] = [
      {
        id: `q-${Date.now()}-1`,
        questionText: `Pregunta diagnóstica: Identifica el concepto nuclear de ${topic || "este tema"}.`,
        type: "multiple_choice",
        options: ["Opción A: Definición formal y precisa", "Opción B: Noción intuitiva con límites", "Opción C: Caso contrario"],
        points: 20,
      },
      {
        id: `q-${Date.now()}-2`,
        questionText: `¿Cuál es la función o consecuencia principal de los mecanismos analizados en ${topic || "la clase"}?`,
        type: "multiple_choice",
        options: ["Regulación y estabilidad", "Aceleración descontrolada", "Degradación pasiva", "Inhibición total"],
        points: 20,
      },
      {
        id: `q-${Date.now()}-3`,
        questionText: `Desarrollo Abierto: Analiza un caso del mundo real donde se manifieste ${topic || "el contenido"} y justifica tu respuesta con terminología científica.`,
        type: "open_text",
        rubricCriterion: "Precisión conceptual, argumentación basada en evidencias y vocabulario técnico adecuado.",
        points: 60,
      },
    ];

    const newActivity: FormActivity = {
      id: actId,
      title: `Formulario Interactivo: ${topic || "Actividad Didáctica"}`,
      subject: course.subject,
      courseId: course.id,
      ageGroup: ageGroup || "15-16 años",
      activityType: activityType || "Formativa",
      description: `Cuestionario interactivo generado en Google Forms adaptado a ${ageGroup || "estudiantes"}. Listo para desplegar en Google Classroom.`,
      googleFormUrl: `https://docs.google.com/forms/d/form-${actId}/viewform`,
      classroomCourseId: course.classroomCourseId,
      publishedToClassroom: false,
      questions: generatedQuestions,
      submissions: [
        {
          studentId: "s-1",
          studentName: "Valentina Rossi",
          studentEmail: "v.rossi@colegio.edu.ar",
          submittedAt: new Date().toISOString(),
          responses: [
            {
              questionId: generatedQuestions[0].id,
              questionText: generatedQuestions[0].questionText,
              studentAnswer: "Opción A: Definición formal y precisa",
              evaluatedScore: 20,
              maxScore: 20,
            },
            {
              questionId: generatedQuestions[1].id,
              questionText: generatedQuestions[1].questionText,
              studentAnswer: "Regulación y estabilidad",
              evaluatedScore: 20,
              maxScore: 20,
            },
            {
              questionId: generatedQuestions[2].id,
              questionText: generatedQuestions[2].questionText,
              studentAnswer: `El fenómeno de ${topic || "la unidad"} permite que el sistema mantenga la homeostasis ante variaciones del entorno, tal como se observó en el experimento de laboratorio.`,
              maxScore: 60,
            },
          ],
          maxScore: 100,
          status: "Entregado",
        },
        {
          studentId: "s-2",
          studentName: "Mateo Gómez",
          studentEmail: "m.gomez@colegio.edu.ar",
          submittedAt: new Date().toISOString(),
          responses: [
            {
              questionId: generatedQuestions[0].id,
              questionText: generatedQuestions[0].questionText,
              studentAnswer: "Opción A: Definición formal y precisa",
              evaluatedScore: 20,
              maxScore: 20,
            },
            {
              questionId: generatedQuestions[1].id,
              questionText: generatedQuestions[1].questionText,
              studentAnswer: "Regulación y estabilidad",
              evaluatedScore: 20,
              maxScore: 20,
            },
            {
              questionId: generatedQuestions[2].id,
              questionText: generatedQuestions[2].questionText,
              studentAnswer: "Funciona porque las partes trabajan juntas y no se separan cuando hay cambios.",
              maxScore: 60,
            },
          ],
          maxScore: 100,
          status: "Entregado",
        },
      ],
    };

    formActivities.unshift(newActivity);

    res.json({
      success: true,
      activity: newActivity,
      message: "Cuestionario de Google Forms generado con éxito.",
    });
  });

  app.post("/api/activities/:id/publish-classroom", (req, res) => {
    const act = formActivities.find((a) => a.id === req.params.id);
    if (!act) return res.status(404).json({ error: "Actividad no encontrada" });

    act.publishedToClassroom = true;
    act.publishedAt = new Date().toISOString();

    // Also add to teacherTasks to unify Classroom coursework view
    teacherTasks.unshift({
      id: `tt-${act.id}`,
      courseId: act.courseId,
      courseName: courses.find((c) => c.id === act.courseId)?.name || "Clase Activa",
      title: act.title,
      description: act.description,
      category: act.activityType === "Trabajo Práctico" ? "Trabajo Práctico" : "Evaluación",
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      maxPoints: 100,
      status: "Publicada",
      driveAttachments: [
        {
          id: `form-att-${act.id}`,
          name: `${act.title} (Google Forms)`,
          type: "sheet",
          url: act.googleFormUrl,
        },
      ],
      assignedCount: 5,
      submittedCount: 2,
      gradedCount: 0,
      submissions: [],
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `Actividad publicada con 1 clic en Google Classroom (${act.classroomCourseId || "Clase activa"}).`,
      activity: act,
    });
  });

  // FEEDBACK INTELIGENTE ASINCRÓNICO PARA EVALUACIONES MASIVAS
  app.post("/api/evaluations/auto-feedback", async (req, res) => {
    const { activityId } = req.body;
    const act = formActivities.find((a) => a.id === activityId) || formActivities[0];

    const jobId = `job-eval-${Date.now()}`;
    const newJob: AsyncJob = {
      id: jobId,
      type: "mass_correction",
      title: `Corrección Asincrónica con IA: ${act.title}`,
      status: "procesando",
      progress: 20,
      currentStep: "Descargando respuestas abiertas de los alumnos...",
      createdAt: new Date().toISOString(),
      params: { activityId: act.id, submissionsCount: act.submissions.length },
      logs: [
        `[${new Date().toLocaleTimeString()}] Iniciando corrección masiva de ${act.submissions.length} entregas...`,
        `[${new Date().toLocaleTimeString()}] Aplicando rúbrica analítica para respuestas de desarrollo libre...`,
      ],
    };
    asyncJobs.unshift(newJob);

    setTimeout(async () => {
      try {
        newJob.progress = 60;
        newJob.currentStep = "Analizando textos abiertos y generando devoluciones pedagógicas...";

        // Grade each submission in the activity
        for (const sub of act.submissions) {
          newJob.logs.push(`[${new Date().toLocaleTimeString()}] Evaluando alumno: ${sub.studentName}...`);
          let totalScore = 0;
          for (const resp of sub.responses) {
            if (resp.evaluatedScore === undefined) {
              // Open text evaluation
              const isDetailed = resp.studentAnswer.length > 50;
              const awarded = isDetailed ? Math.round(resp.maxScore * 0.9) : Math.round(resp.maxScore * 0.65);
              resp.evaluatedScore = awarded;
              resp.aiFeedback = isDetailed
                ? "Respuesta fundamentada y con vocabulario disciplinar preciso."
                : "Respuesta admisible; se recomienda profundizar la justificación técnica.";
            }
            totalScore += resp.evaluatedScore || 0;
          }

          sub.overallScore = Math.min(100, totalScore);
          sub.status = "Corregido";
          sub.overallFeedback = {
            strengths: ["Compromiso en la entrega en término", "Buena resolución en preguntas de opción múltiple"],
            areasForImprovement: ["Ampliar la redacción técnica en las preguntas de desarrollo"],
            pedagogicalGuidance: `Devolución enviada a ${sub.studentName}. Nota sugerida: ${sub.overallScore}/100.`,
          };
        }

        newJob.progress = 100;
        newJob.status = "finalizado";
        newJob.completedAt = new Date().toISOString();
        newJob.currentStep = "Corrección masiva finalizada y sincronizada con Libreta";
        newJob.result = {
          activityId: act.id,
          evaluatedSubmissions: act.submissions.length,
          averageScore: Math.round(act.submissions.reduce((acc, s) => acc + (s.overallScore || 0), 0) / act.submissions.length),
        };
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Devoluciones individuales y calificaciones volcadas con éxito.`);
      } catch (err: any) {
        newJob.status = "fallido";
        newJob.currentStep = "Error en la corrección asincrónica";
        newJob.logs.push(`Error: ${err.message}`);
      }
    }, 1500);

    res.json({
      success: true,
      message: "Corrección asincrónica con IA iniciada",
      jobId,
    });
  });

  // LIBRETA DE CALIFICACIONES -> EXPORTACIÓN CONSOLIDADA A GOOGLE SHEETS
  app.get("/api/gradebook/consolidated", (_req, res) => {
    res.json(gradebookReports);
  });

  app.post("/api/gradebook/consolidate-sheets", async (req, res) => {
    const { courseId, term, weights } = req.body;
    const course = courses.find((c) => c.id === courseId) || courses[0];

    const jobId = `job-sheets-${Date.now()}`;
    const newJob: AsyncJob = {
      id: jobId,
      type: "export_sheets",
      title: `Consolidación de Notas en Sheets: ${course.name}`,
      status: "procesando",
      progress: 30,
      currentStep: "Agrupando notas por categoría (TPs, Exámenes, Recuperatorios)...",
      createdAt: new Date().toISOString(),
      params: { courseId: course.id, term: term || "1er Trimestre" },
      logs: [
        `[${new Date().toLocaleTimeString()}] Ponderaciones: TPs (${weights?.tp || 40}%), Exámenes (${weights?.exam || 50}%), Recuperatorios (${weights?.rec || 10}%)...`,
        `[${new Date().toLocaleTimeString()}] Calculando promedios ponderados y condición pedagógica final...`,
      ],
    };
    asyncJobs.unshift(newJob);

    setTimeout(() => {
      try {
        const reportId = `rep-${Date.now()}`;
        const newReport: GradebookConsolidatedReport = {
          id: reportId,
          courseId: course.id,
          courseName: course.name,
          term: term || "1er Trimestre",
          generatedAt: new Date().toISOString(),
          googleSheetsUrl: `https://docs.google.com/spreadsheets/d/libreta-${course.id}-${Date.now()}/edit`,
          categories: {
            trabajosPracticosWeight: weights?.tp || 40,
            examenesWeight: weights?.exam || 50,
            recuperatoriosWeight: weights?.rec || 10,
          },
          records: [
            {
              studentId: "s-1",
              studentName: "Valentina Rossi",
              tpGrades: [9.5, 9.8, 9.2],
              tpAverage: 9.5,
              examGrades: [9.0, 9.4],
              examAverage: 9.2,
              finalAverage: 9.3,
              academicStatus: "Aprobado",
              pedagogicalNotes: "Sobresaliente nivel de indagación y consistencia.",
            },
            {
              studentId: "s-2",
              studentName: "Mateo Gómez",
              tpGrades: [7.5, 8.0, 7.0],
              tpAverage: 7.5,
              examGrades: [7.0, 8.0],
              examAverage: 7.5,
              finalAverage: 7.5,
              academicStatus: "Aprobado",
              pedagogicalNotes: "Buen progreso en el trabajo autónomo.",
            },
            {
              studentId: "s-3",
              studentName: "Camila Navarro",
              tpGrades: [10.0, 9.8, 10.0],
              tpAverage: 9.9,
              examGrades: [9.8, 10.0],
              examAverage: 9.9,
              finalAverage: 9.9,
              academicStatus: "Aprobado",
              pedagogicalNotes: "Desempeño de honor en todas las áreas.",
            },
            {
              studentId: "s-4",
              studentName: "Ignacio Pérez",
              tpGrades: [6.0, 6.5, 5.5],
              tpAverage: 6.0,
              examGrades: [5.0, 4.5],
              examAverage: 4.8,
              retakeGrade: 6.0,
              finalAverage: 5.4,
              academicStatus: "A Recuperatorio",
              pedagogicalNotes: "Requiere afianzar conceptos clave en instancia recuperatoria.",
            },
            {
              studentId: "s-5",
              studentName: "Sofía Martínez",
              tpGrades: [8.5, 9.0, 8.5],
              tpAverage: 8.7,
              examGrades: [8.0, 8.5],
              examAverage: 8.3,
              finalAverage: 8.5,
              academicStatus: "Aprobado",
              pedagogicalNotes: "Participación muy activa y colaborativa.",
            },
          ],
        };
        gradebookReports.unshift(newReport);

        // Add to Drive resources
        driveResources.unshift({
          id: `sheet-${reportId}`,
          courseId: course.id,
          name: `Libreta Consolidada - ${course.name} (${newReport.term}).xlsx`,
          mimeType: "application/vnd.google-apps.spreadsheet",
          type: "sheet",
          size: "680 KB",
          folder: "Libretas y Calificaciones",
          modifiedTime: new Date().toISOString(),
          googleDriveUrl: newReport.googleSheetsUrl,
          sharedWithClassroom: false,
        });

        newJob.progress = 100;
        newJob.status = "finalizado";
        newJob.completedAt = new Date().toISOString();
        newJob.currentStep = "Planilla Google Sheets exportada y vinculada en Drive";
        newJob.result = { reportId, sheetsUrl: newReport.googleSheetsUrl };
        newJob.logs.push(`[${new Date().toLocaleTimeString()}] Informe final consolidado generado exitosamente.`);
      } catch (err: any) {
        newJob.status = "fallido";
        newJob.currentStep = "Error al consolidar informe";
        newJob.logs.push(`Error: ${err.message}`);
      }
    }, 1200);

    res.json({
      success: true,
      message: "Consolidación de notas iniciada",
      jobId,
    });
  });

  // -------------------------------------------------------------
  // Google Calendar & Horarios Escolares API Endpoints
  // -------------------------------------------------------------
  interface CalendarEventItemServer {
    id: string;
    calendarId?: string;
    title: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    isAllDay?: boolean;
    category: 'materia' | 'colegio' | 'examen' | 'reunion' | 'feriado';
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

  // Preloaded school calendar and course schedule events
  let calendarEvents: CalendarEventItemServer[] = [
    {
      id: "cal-ev-1",
      title: "Jornada Institucional y Docente",
      description: "Reunión general de claustro docente, evaluación de trayectoria pedagógica y acuerdos curriculares.",
      location: "SUM / Sala de Profesores",
      start: new Date(new Date().setDate(new Date().getDate() + 2)).toISOString().split('T')[0] + "T08:00:00",
      end: new Date(new Date().setDate(new Date().getDate() + 2)).toISOString().split('T')[0] + "T12:30:00",
      isAllDay: false,
      category: "colegio",
      color: "#0284c7",
      recurrence: "Única vez",
      syncedToGoogle: false,
    },
    {
      id: "cal-ev-2",
      title: "Cierre de Calificaciones y Libretas - 2do Trimestre",
      description: "Fecha límite para subir promedios trimestrales y notas de TPs al sistema institucional.",
      location: "Secretaría Académica",
      start: new Date(new Date().setDate(new Date().getDate() + 8)).toISOString().split('T')[0] + "T07:30:00",
      end: new Date(new Date().setDate(new Date().getDate() + 8)).toISOString().split('T')[0] + "T18:00:00",
      isAllDay: true,
      category: "colegio",
      color: "#d97706",
      recurrence: "Única vez",
      syncedToGoogle: false,
    },
    {
      id: "cal-ev-3",
      title: "Reunión de Departamento de Ciencias",
      description: "Coordinación de criterios de evaluación de laboratorios y proyectos integradores.",
      location: "Laboratorio de Ciencias",
      start: new Date(new Date().setDate(new Date().getDate() + 4)).toISOString().split('T')[0] + "T14:00:00",
      end: new Date(new Date().setDate(new Date().getDate() + 4)).toISOString().split('T')[0] + "T15:30:00",
      isAllDay: false,
      category: "reunion",
      color: "#7c3aed",
      recurrence: "Quincenal",
      syncedToGoogle: false,
    },
    {
      id: "cal-ev-4",
      title: "Mesa de Exámenes Previos y Libres",
      description: "Constitución de tribunales evaluadores para alumnos con materias pendientes.",
      location: "Aulas 101 a 104",
      start: new Date(new Date().setDate(new Date().getDate() + 15)).toISOString().split('T')[0] + "T08:00:00",
      end: new Date(new Date().setDate(new Date().getDate() + 15)).toISOString().split('T')[0] + "T13:00:00",
      isAllDay: false,
      category: "examen",
      color: "#dc2626",
      recurrence: "Período institucional",
      syncedToGoogle: false,
    },
    {
      id: "cal-ev-5",
      title: "Feriado Nacional y Día Escolar",
      description: "Sin actividad académica institucional en concordancia con el calendario oficial.",
      location: "Todo el establecimiento",
      start: new Date(new Date().setDate(new Date().getDate() + 12)).toISOString().split('T')[0] + "T00:00:00",
      end: new Date(new Date().setDate(new Date().getDate() + 12)).toISOString().split('T')[0] + "T23:59:59",
      isAllDay: true,
      category: "feriado",
      color: "#16a34a",
      recurrence: "Feriado",
      syncedToGoogle: false,
    },
  ];

  // GET /api/calendar/events
  app.get("/api/calendar/events", (req, res) => {
    const { courseId, category } = req.query;
    let filtered = [...calendarEvents];
    if (courseId && typeof courseId === "string") {
      filtered = filtered.filter((e) => !e.courseId || e.courseId === courseId);
    }
    if (category && typeof category === "string") {
      filtered = filtered.filter((e) => e.category === category);
    }
    res.json({ success: true, events: filtered });
  });

  // POST /api/calendar/events
  app.post("/api/calendar/events", (req, res) => {
    const data = req.body;
    if (!data.title || !data.start) {
      return res.status(400).json({ error: "Título y fecha de inicio son requeridos" });
    }

    // Check if an equivalent event already exists to prevent infinite duplication
    const cleanTitle = data.title.toLowerCase().trim();
    const existingIndex = calendarEvents.findIndex((e) => {
      // 1. Same exact ID
      if (data.id && e.id === data.id) return true;

      // 2. Class schedule event (same course/title, same dayOfWeek, same start time)
      if (
        (data.category === "materia" || e.category === "materia") &&
        data.dayOfWeek &&
        e.dayOfWeek === data.dayOfWeek &&
        data.startTime &&
        e.startTime === data.startTime &&
        ((data.courseId && e.courseId === data.courseId) ||
          cleanTitle.includes(e.title.toLowerCase().trim()) ||
          e.title.toLowerCase().trim().includes(cleanTitle))
      ) {
        return true;
      }

      // 3. Dated event (same day and same title)
      if (
        e.title.toLowerCase().trim() === cleanTitle &&
        e.start.slice(0, 10) === data.start.slice(0, 10) &&
        (e.startTime || "") === (data.startTime || "")
      ) {
        return true;
      }

      return false;
    });

    const newEvent: CalendarEventItemServer = {
      id: data.id || `cal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: data.title,
      description: data.description || "",
      location: data.location || "",
      start: data.start,
      end: data.end || data.start,
      isAllDay: !!data.isAllDay,
      category: data.category || "colegio",
      courseId: data.courseId,
      courseName: data.courseName,
      color: data.color || "#2563eb",
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      recurrence: data.recurrence || "Única vez",
      htmlLink: data.htmlLink,
      syncedToGoogle: !!data.syncedToGoogle,
    };

    if (existingIndex >= 0) {
      calendarEvents[existingIndex] = { ...calendarEvents[existingIndex], ...newEvent };
      return res.status(200).json({ success: true, event: calendarEvents[existingIndex], updated: true });
    }

    calendarEvents.unshift(newEvent);
    res.status(201).json({ success: true, event: newEvent });
  });

  // POST /api/calendar/deduplicate
  // Removes duplicate and redundant calendar items
  app.post("/api/calendar/deduplicate", (_req, res) => {
    const initialCount = calendarEvents.length;
    const seenKeys = new Set<string>();
    const uniqueEvents: CalendarEventItemServer[] = [];

    for (const ev of calendarEvents) {
      const cleanTitle = (ev.title || "").toLowerCase().trim();
      let dedupeKey = "";

      if (ev.category === "materia" || (ev.dayOfWeek && ev.startTime)) {
        // Deduplicate weekly classes by course + weekday + hour
        const courseKey = ev.courseId || cleanTitle;
        dedupeKey = `class_${courseKey}_d${ev.dayOfWeek}_${ev.startTime || ""}_${ev.endTime || ""}`;
      } else {
        // Deduplicate dated events by title + date
        const dateKey = (ev.start || "").slice(0, 10);
        dedupeKey = `event_${cleanTitle}_${dateKey}_${ev.startTime || ""}`;
      }

      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        uniqueEvents.push(ev);
      }
    }

    calendarEvents = uniqueEvents;
    const removedCount = initialCount - calendarEvents.length;

    res.json({
      success: true,
      removedCount,
      remainingCount: calendarEvents.length,
      message: `Se eliminaron ${removedCount} eventos repetidos. Quedaron ${calendarEvents.length} eventos únicos y organizados.`,
    });
  });

  // POST /api/calendar/clear-classes
  // Clears all repetitive class schedule blocks to allow a clean re-sync
  app.post("/api/calendar/clear-classes", (_req, res) => {
    const initialCount = calendarEvents.length;
    calendarEvents = calendarEvents.filter((e) => e.category !== "materia");
    const clearedCount = initialCount - calendarEvents.length;

    res.json({
      success: true,
      clearedCount,
      remainingCount: calendarEvents.length,
      message: `Se restablecieron los horarios de materias (se limpiaron ${clearedCount} bloques repetidos). Los eventos escolares institucionales se preservaron.`,
    });
  });

  // PUT /api/calendar/events/:id
  app.put("/api/calendar/events/:id", (req, res) => {
    const { id } = req.params;
    const index = calendarEvents.findIndex((e) => e.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }
    calendarEvents[index] = { ...calendarEvents[index], ...req.body };
    res.json({ success: true, event: calendarEvents[index] });
  });

  // DELETE /api/calendar/events/:id
  app.delete("/api/calendar/events/:id", (req, res) => {
    const { id } = req.params;
    calendarEvents = calendarEvents.filter((e) => e.id !== id);
    res.json({ success: true, message: "Evento eliminado del calendario" });
  });

  // POST /api/calendar/sync-course-schedules
  // Generates weekly timetable class events from active courses
  app.post("/api/calendar/sync-course-schedules", (req, res) => {
    const { targetCourseId } = req.body || {};
    const relevantCourses = targetCourseId 
      ? courses.filter(c => c.id === targetCourseId)
      : courses;

    if (relevantCourses.length === 0) {
      return res.json({ success: true, syncedCount: 0, message: "No hay materias para sincronizar horarios." });
    }

    // Days mapping in Spanish
    const dayMap: { [key: string]: number } = {
      lunes: 1,
      martes: 2,
      miercoles: 3,
      miércoles: 3,
      jueves: 4,
      viernes: 5,
    };

    let createdEvents: CalendarEventItemServer[] = [];

    for (const course of relevantCourses) {
      if (!course.schedule) continue;

      // Format example: "Lunes 07:45 - 09:15, Jueves 09:30 - 11:00"
      const parts = course.schedule.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        const match = trimmed.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes)\s*([0-9]{1,2}:[0-9]{2})\s*[-aà]\s*([0-9]{1,2}:[0-9]{2})/i);
        if (match) {
          const dayName = match[1].toLowerCase();
          const dayNum = dayMap[dayName] || 1;
          const sTime = match[2];
          const eTime = match[3];

          // Calculate next occurrence date of that weekday
          const today = new Date();
          const currentDay = today.getDay(); // 0 is Sunday
          let diff = dayNum - currentDay;
          if (diff < 0) diff += 7;
          const classDate = new Date(today);
          classDate.setDate(today.getDate() + diff);
          const dateStr = classDate.toISOString().split("T")[0];

          const eventId = `sched-${course.id}-${dayNum}-${sTime.replace(":", "")}`;
          // Avoid duplicate
          const existingIdx = calendarEvents.findIndex(e => e.id === eventId);
          const newEvent: CalendarEventItemServer = {
            id: eventId,
            title: `Clase: ${course.name}`,
            description: `Materia: ${course.name} | División: ${course.division || course.section || 'General'} | Aula: ${course.room || 'Aula asignada'}`,
            location: course.room ? `Aula ${course.room}` : 'Colegio',
            start: `${dateStr}T${sTime}:00`,
            end: `${dateStr}T${eTime}:00`,
            isAllDay: false,
            category: "materia",
            courseId: course.id,
            courseName: course.name,
            color: course.color || "#1d4ed8",
            dayOfWeek: dayNum,
            startTime: sTime,
            endTime: eTime,
            recurrence: `Semanal los ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`,
            syncedToGoogle: false,
          };

          if (existingIdx >= 0) {
            calendarEvents[existingIdx] = newEvent;
          } else {
            calendarEvents.push(newEvent);
          }
          createdEvents.push(newEvent);
        }
      }
    }

    res.json({
      success: true,
      syncedCount: createdEvents.length,
      events: createdEvents,
      message: `Se sincronizaron ${createdEvents.length} bloques de horarios de clases en el calendario.`,
    });
  });

  // -------------------------------------------------------------
  // API Fallback & Error Handling (Prevents API routes from returning HTML)
  // -------------------------------------------------------------
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      success: false,
      error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api") || req.originalUrl?.startsWith("/api")) {
      console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || "Error interno del servidor",
      });
    }
    next(err);
  });

  // -------------------------------------------------------------
  // Vite Middleware / Production Static Handling
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Portal Docente Workspace] Servidor full-stack ejecutándose en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
