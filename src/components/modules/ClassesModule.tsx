import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  FileSpreadsheet,
  GraduationCap,
  FolderClosed,
  Search,
  Plus,
  Minus,
  Check,
  X,
  Download,
  AlertCircle,
  RefreshCw,
  History,
  Smartphone,
  MessageSquare,
  BookOpen,
  HelpCircle,
  Trash2,
  RotateCcw,
  Copy,
  ChevronRight,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
  ExternalLink,
  Loader2,
  Settings,
  Pencil,
  Award,
  Bell,
  Mail,
  Send,
  CheckSquare,
  Square,
  CheckCheck,
  Bookmark,
  Save,
  MessageCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Filter,
  FileText,
  Link,
  Printer,
  ArrowLeftRight,
  Upload,
} from 'lucide-react';
import { GradebookMatrix, DEFAULT_CATEGORIES } from './GradebookMatrix';
import { ImportGradesModal } from './ImportGradesModal';
import { CourseReportModal } from './CourseReportModal';
import {
  exportCourseClassHistoryToExcel,
  exportCourseDispositionToExcel,
  exportGradebookMatrixToExcel,
  GradeHistoryEntry,
} from '../../utils/excelExport';
import { GradeCategory, GradeSubcategory, StudentGradesMap } from '../../types/grades';
import { Course, Student, AttendanceStatus, StudentHistoryItem, StudentDispositionData, AbsenceNotificationSettings, AbsencePresetTemplate, StudentObservation } from '../../types';
import {
  api,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getDeletedHistoryIds,
  markHistoryIdDeleted,
} from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { classroomService } from '../../services/workspace/classroomService';
import { gmailService } from '../../services/workspace/gmailService';
import { getCachedAccessToken, setCachedAccessToken, isValidGoogleAccessToken } from '../../services/workspace/googleAuth';
import { sheetsService } from '../../services/workspace/sheetsService';
import { calendarService } from '../../services/workspace/calendarService';
import { driveService, CourseFolderStructure } from '../../services/workspace/driveService';
import { isSameCalendarDay, formatLocalDateDMY, formatLocalTimeHMS } from '../../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../../services/firestoreSync';
import { isRealGoogleSpreadsheetId, copyTableToClipboard, extractSpreadsheetIdFromInput } from '../../utils/sheetsUtils';

interface ClassesModuleProps {
  courses: Course[];
  students: Student[];
  selectedCourseId?: string;
  onSelectCourse?: (id: string) => void;
  onRefreshData: () => void;
  onNavigate: (tab: string, filterCourseId?: string) => void;
  onOpenNewModal?: (type: 'course' | 'plan' | 'task' | 'file') => void;
}

const LOCAL_DISPOSITION_KEY = 'fds_disposition_data_v2';
const LOCAL_HISTORY_KEY = 'fds_disposition_history_v2';

// Helper function to deduplicate history entries (only filters identical IDs or deleted tombstones)
function deduplicateHistory(list: StudentHistoryItem[]): StudentHistoryItem[] {
  const result: StudentHistoryItem[] = [];
  const seenIds = new Set<string>();
  const deleted = getDeletedHistoryIds();

  for (const item of list) {
    if (!item?.id || seenIds.has(item.id) || deleted.has(item.id)) continue;
    seenIds.add(item.id);
    result.push(item);
  }
  return result;
}

export const ClassesModule: React.FC<ClassesModuleProps> = ({
  courses,
  students,
  selectedCourseId,
  onSelectCourse,
  onRefreshData,
  onNavigate,
  onOpenNewModal,
}) => {
  const { isDarkMode, token, user, loginWithGoogle, requestAccessToken } = useWorkspaceAuth();
  const activeCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];

  // Students sorted strictly alphabetically by last name (apellido), then first name
  const courseStudents = useMemo(() => {
    return students
      .filter((s) => s.courseId === activeCourse?.id)
      .sort((a, b) => {
        const lastA = (a.lastName || '').trim();
        const lastB = (b.lastName || '').trim();
        const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        const firstA = (a.firstName || '').trim();
        const firstB = (b.firstName || '').trim();
        return firstA.localeCompare(firstB, 'es', { sensitivity: 'base' });
      });
  }, [students, activeCourse?.id]);

  // Active view: 'roster' (Alumnos/as) vs 'grades' (Calificaciones) vs 'history' (Bitácora / Historial Google Sheets)
  const [activeTab, setActiveTab] = useState<'roster' | 'grades' | 'history'>('roster');

  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSyncingClassroomRoster, setIsSyncingClassroomRoster] = useState(false);
  const [needsRosterPermission, setNeedsRosterPermission] = useState(false);

  // Modal 1: Sincronizar / Seleccionar Horarios con Google Calendar (manual, sin auto-adivinar)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [calendarModalCourse, setCalendarModalCourse] = useState<Course | null>(null);
  const [calendarScheduleSelection, setCalendarScheduleSelection] = useState('');
  const [syncToGoogleFromModal, setSyncToGoogleFromModal] = useState(true);
  const [isSavingCalendarSelection, setIsSavingCalendarSelection] = useState(false);

  // Fast Slot Picker from Calendar
  const [calendarSlots, setCalendarSlots] = useState<{
    id: string;
    title: string;
    dayOfWeek: number;
    dayName: string;
    startTime: string;
    endTime: string;
    displayText: string;
  }[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Modal 2: Editar Detalles Específicos del Curso (Aula, división, observaciones, horario específico)
  const [isEditCourseModalOpen, setIsEditCourseModalOpen] = useState(false);
  const [editCourseData, setEditCourseData] = useState<{
    id: string;
    name: string;
    subject: string;
    grade: string;
    room: string;
    division: string;
    schedule: string;
  } | null>(null);
  const [isSavingCourseDetails, setIsSavingCourseDetails] = useState(false);

  // Disposition state map: studentId -> { totalAbsences: number, totalDisposition: number }
  const [dispositionMap, setDispositionMap] = useState<Record<string, StudentDispositionData>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = getAllDispositionStorage();
        if (stored.disposition && Object.keys(stored.disposition).length > 0) {
          return stored.disposition as Record<string, StudentDispositionData>;
        }
      } catch (_) {}
    }
    return {};
  });

  // 2° Cuatrimestre disposition state map
  const [dispositionMap2c, setDispositionMap2c] = useState<Record<string, StudentDispositionData>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('fds_disposition_data_2c');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return {};
  });

  // Academic term for Attendance & Disposition: '1c' | '2c' | 'annual'
  const [attendanceTerm, setAttendanceTerm] = useState<'1c' | '2c' | 'annual'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('fds_attendance_active_term');
        if (saved === '1c' || saved === '2c' || saved === 'annual') return saved;
      } catch (_) {}
    }
    return '1c';
  });

  const setAttendanceTermHandler = (term: '1c' | '2c' | 'annual') => {
    setAttendanceTerm(term);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fds_attendance_active_term', term);
      if (activeCourse?.id) {
        localStorage.setItem(`fds_attendance_active_term_${activeCourse.id}`, term);
      }
    }
  };

  // History entries list: array of StudentHistoryItem
  const [historyList, setHistoryList] = useState<StudentHistoryItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = getAllDispositionStorage();
        if (Array.isArray(stored.history) && stored.history.length > 0) {
          return deduplicateHistory(stored.history);
        }
      } catch (_) {}
    }
    return [];
  });

  // Teacher custom conduct options (No default options - each teacher adds their own)
  const teacherEmail = user?.email || 'profesor';
  const LOCAL_CONDUCT_OPTIONS_KEY = `fds_teacher_conduct_options_v2_${teacherEmail}`;
  const LOCAL_NOTIF_SETTINGS_KEY = `fds_absence_notif_settings_v1_${teacherEmail}`;
  const LOCAL_ABSENCE_PRESETS_KEY = `fds_absence_presets_v2_${teacherEmail}`;

  const DEFAULT_ABSENCE_PRESETS: AbsencePresetTemplate[] = [
    {
      id: 'preset-standard',
      name: 'Aviso estándar de inasistencia',
      channel: 'any',
      category: 'Ausencia',
      text: 'Estimado/a {ESTUDIANTE}, te notificamos que se ha registrado una inasistencia en la materia {MATERIA} el día {FECHA}. Recuerda revisar el material de la clase y ponerte al día con las actividades solicitadas.',
      isDefault: true,
    },
    {
      id: 'preset-short',
      name: 'Aviso breve para ponerse al día',
      channel: 'any',
      category: 'Ausencia',
      text: 'Hola {ESTUDIANTE}, hoy {FECHA} se registró tu inasistencia en la clase de {MATERIA}. Por favor consulta con tus compañeros y en el aula virtual las tareas vistas en clase para no atrasarte.',
    },
    {
      id: 'preset-formal',
      name: 'Aviso formal con justificativo',
      channel: 'gmail',
      category: 'Ausencia',
      text: 'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} se ha registrado una inasistencia en la asignatura {MATERIA}.\nTe recordamos presentar los justificativos correspondientes y consultar el material del aula virtual.\n\nSaludos cordiales,\nProfesor/a',
    },
    {
      id: 'preset-assignments',
      name: 'Aviso de tareas y trabajos prácticos',
      channel: 'classroom',
      category: 'Ausencia',
      text: 'Estimado/a {ESTUDIANTE}, registramos tu ausencia en la clase de {MATERIA} ({FECHA}). Es importante que revises el aula virtual para ponerte al día con las consignas y entregas programadas.',
    },
  ];

  const DEFAULT_CONDUCT_PRESETS: AbsencePresetTemplate[] = [
    {
      id: 'preset-conduct-standard',
      name: 'Aviso de llamado de atención / conducta',
      channel: 'any',
      category: 'Disposición',
      text: 'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "{MOTIVO}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.',
      isDefault: true,
    },
    {
      id: 'preset-conduct-material',
      name: 'Aviso de falta de material o compromiso',
      channel: 'any',
      category: 'Disposición',
      text: 'Hola {ESTUDIANTE}, en la clase de hoy ({FECHA}) en {MATERIA} registramos un llamado de atención por "{MOTIVO}" (-1 punto de disposición, nota actual: {DISPOSICION}/10). Recuerda traer los útiles necesarios y completar las actividades para la próxima clase.',
    },
    {
      id: 'preset-conduct-formal',
      name: 'Aviso formal a estudiante y familia (Gmail)',
      channel: 'gmail',
      category: 'Disposición',
      text: 'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} durante la clase de {MATERIA} se ha registrado un llamado de atención por el motivo: "{MOTIVO}".\nComo consecuencia, tu registro de disposición de la materia queda en {DISPOSICION}/10 puntos.\nTe pedimos reflexionar y mejorar en este aspecto para no comprometer tu evaluación de cursada.\n\nAtentamente,\nProfesor/a',
    },
  ];

  // Saved presets state (combining absence and disposition presets)
  const [savedPresets, setSavedPresets] = useState<AbsencePresetTemplate[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_ABSENCE_PRESETS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const hasConduct = parsed.some((p: any) => p.category === 'Disposición');
            if (!hasConduct) {
              return [...parsed, ...DEFAULT_CONDUCT_PRESETS];
            }
            return parsed;
          }
        }
      } catch (_) {}
    }
    return [...DEFAULT_ABSENCE_PRESETS, ...DEFAULT_CONDUCT_PRESETS];
  });

  const LOCAL_REASON_TEMPLATES_KEY = `fds_conduct_reason_templates_v2_${teacherEmail}`;

  const DEFAULT_REASON_TEMPLATES: Record<string, string> = {
    'Sin libro': 'Estimado/a {ESTUDIANTE}, hoy {FECHA} se registró un llamado de atención por no traer el libro a la clase de {MATERIA} (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Recuerda traer el libro y los materiales requeridos para la próxima clase.',
    'Falta de tarea': 'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención en {MATERIA} por no presentar la tarea asignada (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Es fundamental realizar las actividades para acompañar tu proceso de aprendizaje.',
    'Uso indebido de celular': 'Estimado/a {ESTUDIANTE}, en la clase de {MATERIA} de hoy {FECHA} se registró un llamado de atención por el uso de teléfono celular en el aula sin autorización (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Te solicitamos guardar los dispositivos durante la clase.',
    'Interrupción de clase': 'Estimado/a {ESTUDIANTE}, hoy {FECHA} en {MATERIA} se registró un llamado de atención por interrupciones reiteradas al desarrollo de la clase (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Te pedimos colaborar activamente con el orden y las consignas de convivencia.',
    'Falta de materiales': 'Hola {ESTUDIANTE}, hoy {FECHA} en {MATERIA} se registró un llamado de atención por no contar con los útiles y materiales indispensables de la clase (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Recuerda prepararlos con anticipación.',
    'Participación destacada': 'Estimado/a {ESTUDIANTE}, ¡felicitaciones! Hoy {FECHA} sumaste 1 punto en tu nota de disposición en {MATERIA} por tu activa y valiosa participación en clase (Puntaje actual: {DISPOSICION}/10). ¡Excelente aporte!',
    'Excelente trabajo en clase': 'Estimado/a {ESTUDIANTE}, te felicitamos por tu gran desempeño y compromiso durante la clase de {MATERIA} de hoy {FECHA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡A seguir así!',
    'Colaboración con compañeros': 'Hola {ESTUDIANTE}, destacamos y agradecemos tu valiosa colaboración y compañerismo en la clase de {MATERIA} de hoy {FECHA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡Muy buen trabajo!',
    'Tarea y materiales completos': 'Estimado/a {ESTUDIANTE}, felicitaciones por presentar tus actividades y materiales en forma completa e impecable hoy {FECHA} en {MATERIA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10).',
    'Compromiso y superación': 'Estimado/a {ESTUDIANTE}, hoy {FECHA} en {MATERIA} reconocemos tu esfuerzo constante y superación personal (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡Felicitaciones por este logro!',
  };

  // Plantillas específicas para cada motivo de conducta guardadas por el profesor
  const [conductReasonTemplates, setConductReasonTemplates] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_REASON_TEMPLATES_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            return { ...DEFAULT_REASON_TEMPLATES, ...parsed };
          }
        }
      } catch (_) {}
    }
    return DEFAULT_REASON_TEMPLATES;
  });

  // Carga inicial y sincronización con el backend para plantillas de conducta
  useEffect(() => {
    let isMounted = true;
    api
      .getConductTemplates(teacherEmail)
      .then((remoteTemplates) => {
        if (!isMounted) return;
        if (remoteTemplates && typeof remoteTemplates === 'object' && Object.keys(remoteTemplates).length > 0) {
          setConductReasonTemplates((prev) => {
            const merged = { ...prev, ...remoteTemplates };
            try {
              localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [teacherEmail]);

  const handleSavePreset = (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any' = 'any',
    category: 'all' | 'Ausencia' | 'Disposición' = 'all',
    associatedReason?: string
  ) => {
    const trimmed = name.trim() || `Plantilla personalizada ${savedPresets.length + 1}`;
    const newPreset: AbsencePresetTemplate = {
      id: `preset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      channel,
      category,
      associatedReason: associatedReason?.trim(),
      text,
      createdAt: Date.now(),
    };
    const updated = [...savedPresets, newPreset];
    setSavedPresets(updated);
    try {
      localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(updated));
    } catch (_) {}
    setToastMessage(`Mensaje preestablecido "${trimmed}" guardado correctamente.`);
    setTimeout(() => setToastMessage(null), 3500);
    return newPreset.id;
  };

  const handleDeletePreset = (presetId: string) => {
    if (savedPresets.length <= 1) {
      setToastMessage('Debe mantenerse al menos un mensaje preestablecido.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const updated = savedPresets.filter((p) => p.id !== presetId);
    setSavedPresets(updated);
    try {
      localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(updated));
    } catch (_) {}
    setToastMessage('Plantilla eliminada.');
    setTimeout(() => setToastMessage(null), 2500);
  };

  const formatTemplateForStudent = (
    template: string,
    student: Student | { firstName: string; lastName: string; id: string },
    courseName: string,
    disposition: number,
    date: string,
    motivo?: string,
    pointsChange?: number
  ) => {
    const studentName = student.firstName && student.lastName ? `${student.firstName} ${student.lastName}` : (student.firstName || student.lastName || 'Estudiante');
    const pts = pointsChange !== undefined ? (pointsChange > 0 ? `+${pointsChange}` : `${pointsChange}`) : '1';
    const cleanMotivo = motivo ? motivo.replace(/^(\+|\[\+\])\s*/, '') : 'Conducta';
    return template
      .replace(/{(?:ALUMNO|ESTUDIANTE)}/g, studentName)
      .replace(/{MATERIA}/g, courseName)
      .replace(/{DISPOSICION}/g, `${disposition}`)
      .replace(/{FECHA}/g, date)
      .replace(/{(?:PUNTOS|DELTA)}/g, pts)
      .replace(/{(?:MOTIVO|ACCION|CONDUCTA)}/g, cleanMotivo);
  };

  const extractGenericTemplate = (
    text: string,
    student?: Student | { firstName: string; lastName: string; id: string } | null,
    courseName?: string,
    date?: string,
    motivo?: string,
    disposition?: number
  ) => {
    let tpl = text;
    if (student) {
      const full1 = `${student.firstName} ${student.lastName}`.trim();
      const full2 = `${student.lastName}, ${student.firstName}`.trim();
      if (full1 && tpl.includes(full1)) tpl = tpl.split(full1).join('{ESTUDIANTE}');
      if (full2 && tpl.includes(full2)) tpl = tpl.split(full2).join('{ESTUDIANTE}');
      if (student.firstName && student.firstName.trim().length > 2 && tpl.includes(student.firstName)) {
        tpl = tpl.split(student.firstName).join('{ESTUDIANTE}');
      }
    }
    if (courseName && tpl.includes(courseName)) {
      tpl = tpl.split(courseName).join('{MATERIA}');
    }
    if (date && tpl.includes(date)) {
      tpl = tpl.split(date).join('{FECHA}');
    }
    if (disposition !== undefined) {
      if (tpl.includes(`${disposition}/10`)) {
        tpl = tpl.split(`${disposition}/10`).join('{DISPOSICION}/10');
      }
    }
    if (motivo && tpl.includes(motivo)) {
      tpl = tpl.split(motivo).join('{MOTIVO}');
    }
    return tpl;
  };

  // Obtener la plantilla asociada a un motivo de conducta específico
  const getTemplateForReason = (reasonName: string, type: 'positive' | 'negative' = 'negative'): string => {
    const trimmed = (reasonName || '').trim();
    if (!trimmed) {
      return type === 'positive'
        ? DEFAULT_REASON_TEMPLATES['Participación destacada']
        : notifSettings.templateConductClassroom || DEFAULT_CONDUCT_PRESETS[0].text;
    }
    // 1. Coincidencia directa en mapa de plantillas personalizadas
    if (conductReasonTemplates[trimmed]) {
      return conductReasonTemplates[trimmed];
    }
    // 2. Coincidencia insensible a mayúsculas/minúsculas
    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(conductReasonTemplates)) {
      if (k.toLowerCase() === lower) return v;
    }
    // 3. Coincidencia en las plantillas estándar por defecto
    for (const [k, v] of Object.entries(DEFAULT_REASON_TEMPLATES)) {
      if (k.toLowerCase() === lower || lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) {
        return v;
      }
    }
    // 4. Si el motivo en sí suena positivo o el tipo es positivo
    const isPositiveReason =
      type === 'positive' ||
      trimmed.startsWith('+') ||
      trimmed.startsWith('[+]') ||
      /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(trimmed);

    const cleanReason = trimmed.replace(/^(\+|\[\+\])\s*/, '');
    if (isPositiveReason) {
      return `Estimado/a {ESTUDIANTE}, ¡felicitaciones! Hoy {FECHA} sumaste puntos a tu nota de disposición por "${cleanReason}" en la materia {MATERIA} (Puntaje actual: {DISPOSICION}/10). ¡Excelente trabajo, seguí así!`;
    }

    // 5. Fallback dinámico con el motivo (negativo / llamado de atención)
    return `Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "${cleanReason}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.`;
  };

  // Guardar plantilla específica para una cuestión/motivo
  const handleSaveTemplateForReason = (
    reason: string,
    text: string,
    showToast = true,
    studentForContext?: Student | { firstName: string; lastName: string; id: string } | null
  ) => {
    const trimmed = (reason || '').trim();
    if (!trimmed || !text.trim()) return;

    const targetStudent = studentForContext || absenceNotifModal.student;
    const genericText = extractGenericTemplate(
      text,
      targetStudent,
      activeCourse?.name,
      absenceNotifModal.historyItem?.date,
      trimmed
    );

    const updated = {
      ...conductReasonTemplates,
      [trimmed]: genericText,
    };
    setConductReasonTemplates(updated);
    try {
      localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updated));
    } catch (_) {}
    api.saveConductTemplates(teacherEmail, updated).catch(() => {});

    // Asegurar que esta opción también figure en teacherConductOptions para usarla con un clic
    if (!teacherConductOptions.includes(trimmed)) {
      handleAddConductOption(trimmed);
    }

    if (showToast) {
      setToastMessage(`✓ Plantilla guardada para "${trimmed}". La próxima vez que un alumno no traiga o registre esto, aparecerá este mensaje por defecto.`);
      setTimeout(() => setToastMessage(null), 4500);
    }
  };

  // Restablecer plantilla de una cuestión a su valor estándar
  const handleResetTemplateForReason = (reason: string) => {
    const trimmed = (reason || '').trim();
    if (!trimmed) return;

    const updated = { ...conductReasonTemplates };
    delete updated[trimmed];
    setConductReasonTemplates(updated);
    try {
      localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updated));
    } catch (_) {}
    api.saveConductTemplates(teacherEmail, updated).catch(() => {});

    setToastMessage(`Mensaje de "${trimmed}" restablecido a la plantilla estándar.`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Determinar si una cuestión tiene plantilla personalizada por el usuario
  const isReasonCustomized = (reasonName: string): boolean => {
    const trimmed = (reasonName || '').trim();
    if (!trimmed) return false;
    if (conductReasonTemplates[trimmed]) return true;
    const lower = trimmed.toLowerCase();
    return Object.keys(conductReasonTemplates).some((k) => k.toLowerCase() === lower);
  };

  // Pre-configured notification messages settings
  const [notifSettings, setNotifSettings] = useState<AbsenceNotificationSettings>(() => {
    const defaultSettings: AbsenceNotificationSettings = {
      autoNotify: false,
      channel: 'classroom', // Default: Classroom announcement directed to the student
      templateClassroom: 'Estimado/a {ESTUDIANTE}, te notificamos que se ha registrado una inasistencia en la materia {MATERIA} el día {FECHA}. Recuerda revisar el material de la clase y ponerte al día con las actividades solicitadas.',
      templateGmail: 'Estimado/a {ESTUDIANTE},\n\nTe informamos que en la fecha {FECHA} se ha registrado una inasistencia en la clase de {MATERIA}.\n\nPor favor consulta con tus compañeros o en el aula virtual las tareas correspondientes para mantenerte al día.\n\nSaludos cordiales,\nProfesor/a',
      templateConductClassroom: 'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "{MOTIVO}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.',
      templateConductGmail: 'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} durante la clase de {MATERIA} se ha registrado un llamado de atención por el motivo: "{MOTIVO}".\nComo consecuencia, tu registro de disposición de la materia queda en {DISPOSICION}/10 puntos.\nTe pedimos reflexionar y mejorar en este aspecto para no comprometer tu evaluación de cursada.\n\nAtentamente,\nProfesor/a',
      dontShowPopupOnAbsence: false,
      dontShowPopupOnDisposition: false,
    };

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_NOTIF_SETTINGS_KEY);
        if (saved) return { ...defaultSettings, ...JSON.parse(saved) };
      } catch (_) {}
    }
    return defaultSettings;
  });

  const handleSaveNotifSettings = (newSettings: AbsenceNotificationSettings) => {
    setNotifSettings(newSettings);
    try {
      localStorage.setItem(LOCAL_NOTIF_SETTINGS_KEY, JSON.stringify(newSettings));
    } catch (_) {}
    setToastMessage('Configuración de avisos guardada correctamente.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Tab activa en el modal de configuración de avisos: 'reasons' (Mensajes por Cuestión) | 'presets' (Plantillas Generales) | 'settings' (Modo Rápido y Canales)
  const [notifConfigActiveTab, setNotifConfigActiveTab] = useState<'reasons' | 'presets' | 'settings'>('reasons');
  const [searchReasonQuery, setSearchReasonQuery] = useState('');
  const [isNewReasonFormOpen, setIsNewReasonFormOpen] = useState(false);
  const [newReasonName, setNewReasonName] = useState('');
  const [newReasonTemplateText, setNewReasonTemplateText] = useState('');
  const [reasonCardDrafts, setReasonCardDrafts] = useState<Record<string, string>>({});

  // Modal to edit notification templates & settings
  const [isNotifConfigModalOpen, setIsNotifConfigModalOpen] = useState(false);
  const [newConfigPreset, setNewConfigPreset] = useState<{
    name: string;
    text: string;
    channel: 'classroom' | 'gmail' | 'any';
    category: 'Ausencia' | 'Disposición';
    isOpen: boolean;
  }>({
    name: '',
    text: '',
    channel: 'classroom',
    category: 'Ausencia',
    isOpen: false,
  });

  // Modal to notify or edit message for a specific absence record
  const [absenceNotifModal, setAbsenceNotifModal] = useState<{
    isOpen: boolean;
    historyItem: StudentHistoryItem | null;
    student: Student | null;
    channel: 'classroom' | 'gmail';
    messageText: string;
    selectedPresetId?: string;
    showSavePresetInput?: boolean;
    newPresetName?: string;
    isSending: boolean;
  }>({
    isOpen: false,
    historyItem: null,
    student: null,
    channel: 'classroom',
    messageText: '',
    selectedPresetId: 'preset-standard',
    showSavePresetInput: false,
    newPresetName: '',
    isSending: false,
  });

  // Batch selection of students for notification at the end of class
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedPendingHistoryIds, setSelectedPendingHistoryIds] = useState<string[]>([]);

  // Pending absence items for current course (without sent notification)
  const pendingAbsenceItems = useMemo(() => {
    if (!activeCourse) return [];
    return historyList.filter(
      (h) => h.courseId === activeCourse.id && h.category === 'Ausencia' && !h.messageSent
    );
  }, [historyList, activeCourse?.id]);

  // Pending conduct items for current course (without sent notification)
  const pendingConductItems = useMemo(() => {
    if (!activeCourse) return [];
    return historyList.filter(
      (h) => h.courseId === activeCourse.id && h.category === 'Disposición' && !h.messageSent
    );
  }, [historyList, activeCourse?.id]);

  // All pending notification items for current course (both absences and conduct records)
  const pendingAllItems = useMemo(() => {
    return [...pendingAbsenceItems, ...pendingConductItems];
  }, [pendingAbsenceItems, pendingConductItems]);

  // Batch modal state
  const [batchAbsenceModal, setBatchAbsenceModal] = useState<{
    isOpen: boolean;
    selectedItems: {
      historyItem: StudentHistoryItem;
      student: Student;
    }[];
    channel: 'classroom' | 'gmail';
    selectedPresetId: string;
    rawTemplateText: string;
    previewStudentIndex: number;
    previewStudentId?: string;
    showSavePresetInput: boolean;
    newPresetName: string;
    isSending: boolean;
    currentSendingStudentName?: string;
    progress?: number;
    total?: number;
    sendProgress: { current: number; total: number; currentStudentName: string } | null;
    useSmartTemplates: boolean;
    customPerItemMessages?: Record<string, string>;
  }>({
    isOpen: false,
    selectedItems: [],
    channel: 'classroom',
    selectedPresetId: 'preset-standard',
    rawTemplateText: '',
    previewStudentIndex: 0,
    previewStudentId: '',
    showSavePresetInput: false,
    newPresetName: '',
    isSending: false,
    currentSendingStudentName: '',
    progress: 0,
    total: 0,
    sendProgress: null,
    useSmartTemplates: true,
    customPerItemMessages: {},
  });

  const [teacherConductOptions, setTeacherConductOptions] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_CONDUCT_OPTIONS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_) {}
    }
    return []; // Start empty: no default options!
  });

  // Sync teacher conduct options with backend
  useEffect(() => {
    let isMounted = true;
    api.getConductOptions(teacherEmail).then((opts) => {
      if (!isMounted) return;
      if (Array.isArray(opts) && opts.length > 0) {
        setTeacherConductOptions(opts);
        try {
          localStorage.setItem(LOCAL_CONDUCT_OPTIONS_KEY, JSON.stringify(opts));
        } catch (_) {}
      }
    });
    return () => {
      isMounted = false;
    };
  }, [teacherEmail]);

  const handleSaveConductOptions = (newOptions: string[]) => {
    const cleaned = Array.from(new Set(newOptions.map((s) => s.trim()))).filter(Boolean);
    setTeacherConductOptions(cleaned);
    try {
      localStorage.setItem(LOCAL_CONDUCT_OPTIONS_KEY, JSON.stringify(cleaned));
    } catch (_) {}
    api.saveConductOptions(teacherEmail, cleaned).catch(() => {});
  };

  const handleAddConductOption = (newOpt: string) => {
    const trimmed = newOpt.trim();
    if (!trimmed) return;
    if (teacherConductOptions.includes(trimmed)) return;
    const updated = [...teacherConductOptions, trimmed];
    handleSaveConductOptions(updated);
    setNewConductInput('');
  };

  const handleDeleteConductOption = (optToDelete: string) => {
    const updated = teacherConductOptions.filter((o) => o !== optToDelete);
    handleSaveConductOptions(updated);
  };

  const [editingConductOpt, setEditingConductOpt] = useState<string | null>(null);
  const [editConductInput, setEditConductInput] = useState('');

  const handleEditConductOption = (oldOpt: string, newOpt: string) => {
    const trimmed = newOpt.trim();
    if (!trimmed || trimmed === oldOpt) {
      setEditingConductOpt(null);
      return;
    }
    const updated = teacherConductOptions.map((o) => (o === oldOpt ? trimmed : o));
    handleSaveConductOptions(updated);

    if (conductReasonTemplates[oldOpt]) {
      const updatedTpls = { ...conductReasonTemplates };
      updatedTpls[trimmed] = updatedTpls[oldOpt];
      delete updatedTpls[oldOpt];
      setConductReasonTemplates(updatedTpls);
      try {
        localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updatedTpls));
      } catch (_) {}
      api.saveConductTemplates(teacherEmail, updatedTpls).catch(() => {});
    }

    setEditingConductOpt(null);
  };

  // Estado para editar plantilla de un motivo dentro del modal de gestión de conductas
  const [editingTemplateForReason, setEditingTemplateForReason] = useState<string | null>(null);
  const [reasonTemplateDraft, setReasonTemplateDraft] = useState<string>('');
  const [saveReasonAsDefaultOnSend, setSaveReasonAsDefaultOnSend] = useState(true);

  // Todas las cuestiones y motivos conocidos combinados
  const allKnownReasonKeys = useMemo(() => {
    const set = new Set<string>();
    Object.keys(DEFAULT_REASON_TEMPLATES).forEach((k) => set.add(k.trim()));
    teacherConductOptions.forEach((o) => set.add(o.trim()));
    Object.keys(conductReasonTemplates).forEach((k) => set.add(k.trim()));
    return Array.from(set).filter(Boolean);
  }, [teacherConductOptions, conductReasonTemplates]);

  // Modal to record conduct for a specific student (sumar o restar puntos)
  const [conductRecordModal, setConductRecordModal] = useState<{
    isOpen: boolean;
    student: Student | null;
    mode: 'subtract' | 'add';
    points: number;
    customReason: string;
    saveToOptions: boolean;
  }>({
    isOpen: false,
    student: null,
    mode: 'subtract',
    points: 1,
    customReason: '',
    saveToOptions: false,
  });

  // Modal to manage teacher's custom conduct options
  const [isManageConductModalOpen, setIsManageConductModalOpen] = useState(false);
  const [newConductInput, setNewConductInput] = useState('');
  const [newConductType, setNewConductType] = useState<'subtract' | 'add'>('subtract');

  // Modal para ver el historial individual de un alumno
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<Student | null>(null);

  // Modal para editar la nota de disposición de un estudiante (ingreso manual / notas en papel)
  const [editingDispositionStudent, setEditingDispositionStudent] = useState<Student | null>(null);
  const [editingDispositionScore, setEditingDispositionScore] = useState<string>('10');
  const [editingDispositionTerm, setEditingDispositionTerm] = useState<'1c' | '2c'>('1c');
  const [editingDispositionReason, setEditingDispositionReason] = useState<string>('');

  // Modal para editar cantidad de faltas (pasaje de papel, fecha retroactiva y aviso al alumno)
  const [editingAbsenceStudent, setEditingAbsenceStudent] = useState<Student | null>(null);
  const [editingAbsenceCount, setEditingAbsenceCount] = useState<string>('0');
  const [editingAbsenceTerm, setEditingAbsenceTerm] = useState<'1c' | '2c'>('1c');
  const [editingAbsenceDate, setEditingAbsenceDate] = useState<string>(() => {
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  });
  const [editingAbsenceReason, setEditingAbsenceReason] = useState<string>('Pasado de planilla en papel');
  const [editingAbsenceSendNotif, setEditingAbsenceSendNotif] = useState<boolean>(false);
  const [editingAbsenceChannel, setEditingAbsenceChannel] = useState<'classroom' | 'gmail'>('classroom');
  const [editingAbsenceMessageText, setEditingAbsenceMessageText] = useState<string>('');
  const [isSavingAbsenceEdit, setIsSavingAbsenceEdit] = useState<boolean>(false);

  // Modal para agregar alumno manualmente (con correo para avisos y mensajes)
  const [isAddStudentModalOpen, setIsAddStudentModalOpen] = useState(false);
  const [addStudentFirstName, setAddStudentFirstName] = useState('');
  const [addStudentLastName, setAddStudentLastName] = useState('');
  const [addStudentEmail, setAddStudentEmail] = useState('');
  const [addStudentPhone, setAddStudentPhone] = useState('');
  const [addStudentNotes, setAddStudentNotes] = useState('');
  const [isSavingManualStudent, setIsSavingManualStudent] = useState(false);
  const [addStudentTab, setAddStudentTab] = useState<'single' | 'batch'>('single');
  const [batchStudentsText, setBatchStudentsText] = useState('');

  // Modal para enviar mensaje directo a un estudiante (usando su correo o canales)
  const [directMessageModal, setDirectMessageModal] = useState<{
    isOpen: boolean;
    student: Student | null;
    subject: string;
    messageText: string;
    channel: 'gmail' | 'classroom' | 'whatsapp';
    isSending: boolean;
  }>({
    isOpen: false,
    student: null,
    subject: '',
    messageText: '',
    channel: 'gmail',
    isSending: false,
  });

  // State para edición de email en ficha del alumno
  const [isEditingStudentEmail, setIsEditingStudentEmail] = useState(false);
  const [editedStudentEmail, setEditedStudentEmail] = useState('');

  // Ficha y observaciones del estudiante (al hacer clic en su nombre)
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<Student | null>(null);
  const [newObservationText, setNewObservationText] = useState('');
  const [newObservationUrl, setNewObservationUrl] = useState('');
  const [studentObservations, setStudentObservations] = useState<Record<string, StudentObservation[]>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('fds_student_observations');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return {};
  });

  // Modal para mandar nota de disposición a Calificaciones
  const [isSendDispositionModalOpen, setIsSendDispositionModalOpen] = useState(false);

  // Animation tracking for instant button feedback (like unchecking in the script)
  const [pulsingStudentId, setPulsingStudentId] = useState<string | null>(null);

  // Real-time Google Sheet configuration & Sync status
  const [sheetConfig, setSheetConfig] = useState<{
    spreadsheetId: string;
    url: string;
    isLiveGoogle: boolean;
    lastSyncedAt?: string;
  } | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isOpeningSheet, setIsOpeningSheet] = useState(false);
  const [showSheetsConnectModal, setShowSheetsConnectModal] = useState(false);
  const [sheetsModalFeedback, setSheetsModalFeedback] = useState<string | null>(null);
  const [customSheetInput, setCustomSheetInput] = useState('');
  const [isLinkingCustomSheet, setIsLinkingCustomSheet] = useState(false);
  const [customFolderInput, setCustomFolderInput] = useState('');
  const [isLinkingCustomFolder, setIsLinkingCustomFolder] = useState(false);
  const [historySubTab, setHistorySubTab] = useState<'incidents' | 'summary'>('incidents');

  // Doble Entrada (Two-Way Sync): lectura de cambios desde Google Sheets a la App
  const [isPullingFromSheet, setIsPullingFromSheet] = useState(false);
  const [dobleEntradaDiffs, setDobleEntradaDiffs] = useState<any[] | null>(null);
  const [isDobleEntradaModalOpen, setIsDobleEntradaModalOpen] = useState(false);

  // Modal / Selector de Exportar Excel en la cabecera
  const [isHeaderExportExcelModalOpen, setIsHeaderExportExcelModalOpen] = useState(false);

  // Modal de Importar desde Excel / Sheets en la cabecera
  const [isHeaderImportModalOpen, setIsHeaderImportModalOpen] = useState(false);

  // Permanent history controls (always visible in roster tab & history tab)
  const [permHistorySearch, setPermHistorySearch] = useState('');
  const [permHistoryCategory, setPermHistoryCategory] = useState<'all' | 'Ausencia' | 'Llegada tarde' | 'Disposición' | 'Calificación' | 'Sistema'>('all');
  const [permHistoryDate, setPermHistoryDate] = useState<string>('all');
  const [isPermHistoryCollapsed, setIsPermHistoryCollapsed] = useState(false);

  // Google Drive course folder structure state
  const [isSettingUpDriveFolder, setIsSettingUpDriveFolder] = useState<boolean>(false);
  const [driveFolderModalOpen, setDriveFolderModalOpen] = useState<boolean>(false);
  const [courseDriveStructure, setCourseDriveStructure] = useState<{
    mainFolder: { id: string; name: string; url: string };
    attendanceFolder: { id: string; name: string; url: string };
    gradesFolder: { id: string; name: string; url: string };
    attendanceSheetUrl?: string;
    gradesSheetUrl?: string;
  } | null>(null);

  // Course and Student report modal state
  const [courseReportModalOpen, setCourseReportModalOpen] = useState<boolean>(false);
  const [courseReportModalTab, setCourseReportModalTab] = useState<'course' | 'individual'>('course');
  const [courseReportModalStudentId, setCourseReportModalStudentId] = useState<string>('all');

  // Guaranteed two-way synchronization on startup to ensure long-term durability across days & months
  useEffect(() => {
    try {
      const stored = getAllDispositionStorage();
      if (Array.isArray(stored.history) && (stored.history.length > 0 || Object.keys(stored.disposition).length > 0)) {
        api
          .syncFullDisposition({ disposition: stored.disposition, history: stored.history })
          .then((res) => {
            if (res.disposition && Object.keys(res.disposition).length > 0) {
              setDispositionMap((prev) => ({ ...prev, ...res.disposition }));
            }
          })
          .catch(() => {});
      }
    } catch (_) {}
  }, []);

  // Listen for storage changes across tabs / modules to update instantly
  useEffect(() => {
    const handleStorageChange = (e: any) => {
      if (e?.detail) {
        const { disposition, history } = e.detail;
        if (disposition && typeof disposition === 'object') {
          setDispositionMap((prev) => {
            const incomingKeys = Object.keys(disposition);
            const prevKeys = Object.keys(prev);
            let hasChanged = incomingKeys.length !== prevKeys.length;
            if (!hasChanged) {
              for (const k of incomingKeys) {
                if (
                  !prev[k] ||
                  prev[k].totalAbsences !== disposition[k].totalAbsences ||
                  prev[k].totalLates !== disposition[k].totalLates ||
                  prev[k].totalDisposition !== disposition[k].totalDisposition
                ) {
                  hasChanged = true;
                  break;
                }
              }
            }
            return hasChanged ? { ...prev, ...disposition } : prev;
          });
        }
        if (Array.isArray(history)) {
          setHistoryList((prev) => {
            const incomingDedup = deduplicateHistory(history);
            if (
              prev.length === incomingDedup.length &&
              prev.every((p, i) => p.id === incomingDedup[i]?.id)
            ) {
              return prev;
            }
            return incomingDedup;
          });
        }
      }
    };
    window.addEventListener('docencia_disposition_storage_change', handleStorageChange);
    return () => window.removeEventListener('docencia_disposition_storage_change', handleStorageChange);
  }, []);

  // Load from backend API / Firestore, keeping localStorage synced and deduplicated without resurrecting deleted items
  useEffect(() => {
    let isMounted = true;
    if (activeCourse?.id) {
      api
        .getDisposition(activeCourse.id)
        .then((res) => {
          if (!isMounted) return;
          if (res.disposition && Object.keys(res.disposition).length > 0) {
            setDispositionMap((prev) => {
              const incoming = res.disposition;
              const incomingKeys = Object.keys(incoming);
              let hasChanged = false;
              for (const k of incomingKeys) {
                if (
                  !prev[k] ||
                  prev[k].totalAbsences !== incoming[k]?.totalAbsences ||
                  prev[k].totalLates !== incoming[k]?.totalLates ||
                  prev[k].totalDisposition !== incoming[k]?.totalDisposition
                ) {
                  hasChanged = true;
                  break;
                }
              }
              return hasChanged ? { ...prev, ...incoming } : prev;
            });
          }
          if (Array.isArray(res.history)) {
            const deleted = getDeletedHistoryIds();
            const cleanIncoming = res.history.filter((h) => h?.id && !deleted.has(h.id));
            setHistoryList((prev) => {
              const cleanPrev = prev.filter((h) => h?.id && !deleted.has(h.id));
              const prevIds = new Set(cleanPrev.map((p) => p.id));
              const genuinelyNewFromCloud = cleanIncoming.filter((ci) => !prevIds.has(ci.id));
              if (genuinelyNewFromCloud.length > 0) {
                return deduplicateHistory([...cleanPrev, ...genuinelyNewFromCloud]);
              }
              if (cleanPrev.length === 0 && cleanIncoming.length > 0) {
                return deduplicateHistory(cleanIncoming);
              }
              return cleanPrev;
            });
          }
        })
        .catch(() => {});

      // Load saved Google Sheet configuration
      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      api
        .getCourseDispositionSheet(activeCourse.id)
        .then((data) => {
          if (!isMounted) return;
          if (
            data?.spreadsheetId &&
            isRealGoogleSpreadsheetId(data.spreadsheetId) &&
            (isS2NatCourse || data.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
          ) {
            setSheetConfig({
              spreadsheetId: data.spreadsheetId,
              url: data.url || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
              isLiveGoogle: true,
              lastSyncedAt: data.lastSyncedAt,
            });
          } else {
            if (data?.spreadsheetId === POISONED_S2_NAT_SHEET_ID && !isS2NatCourse) {
              api.unlinkCourseDispositionSheet(activeCourse.id).catch(() => {});
            }
            const fallbackId = `sheet-disp-${activeCourse.id}`;
            setSheetConfig({
              spreadsheetId: fallbackId,
              url: '',
              isLiveGoogle: false,
              lastSyncedAt: undefined,
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [activeCourse?.id]);

  // Real-time synchronization with Google Sheets (automatic background updates when marking)
  const triggerSheetsSync = async (
    customMap?: Record<string, StudentDispositionData>,
    customHistory?: StudentHistoryItem[],
    customMap2c?: Record<string, StudentDispositionData>
  ) => {
    if (!activeCourse) return;
    const activeToken = token || getCachedAccessToken();
    const isAuthenticToken = activeToken && isValidGoogleAccessToken(activeToken);

    if (!isAuthenticToken) {
      return;
    }

    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    setIsSyncingSheet(true);
    try {
      const map1cToUse = customMap || dispositionMap;
      const map2cToUse = customMap2c || dispositionMap2c;
      const historyToUse = customHistory
        ? customHistory.filter((h) => h.courseId === activeCourse.id)
        : historyList.filter((h) => h.courseId === activeCourse.id);
      const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
      const realExistingId =
        (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
        (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

      // Ensure course Drive folder exists
      let targetFolderId = activeCourse.attendanceFolderId || activeCourse.driveFolderId;
      if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            activeCourse.name,
            undefined,
            activeToken
          );
          targetFolderId = folderStruct.attendanceFolder.id || folderStruct.mainFolder.id;
          activeCourse.attendanceFolderId = folderStruct.attendanceFolder.id;
          activeCourse.attendanceFolderUrl = folderStruct.attendanceFolder.url;
          activeCourse.gradesFolderId = folderStruct.gradesFolder.id;
          activeCourse.gradesFolderUrl = folderStruct.gradesFolder.url;
          activeCourse.driveFolderId = folderStruct.mainFolder.id;
          activeCourse.driveFolderUrl = folderStruct.mainFolder.url;
          api.updateCourse(activeCourse.id, {
            attendanceFolderId: folderStruct.attendanceFolder.id,
            attendanceFolderUrl: folderStruct.attendanceFolder.url,
            gradesFolderId: folderStruct.gradesFolder.id,
            gradesFolderUrl: folderStruct.gradesFolder.url,
            driveFolderId: folderStruct.mainFolder.id,
            driveFolderUrl: folderStruct.mainFolder.url,
          }).catch(() => {});
        } catch (_) {}
      }

      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        map1cToUse,
        historyToUse,
        realExistingId,
        targetFolderId,
        activeToken,
        map2cToUse
      );

      const isLive = res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId);

      setSheetConfig({
        spreadsheetId: res.spreadsheetId,
        url: isLive ? res.url : (sheetConfig?.url || ''),
        isLiveGoogle: isLive,
        lastSyncedAt: res.updatedAt,
      });

      if (isLive) {
        activeCourse.dispositionSheetId = res.spreadsheetId;
        activeCourse.dispositionSheetUrl = res.url;
        api
          .saveCourseDispositionSheet(activeCourse.id, {
            spreadsheetId: res.spreadsheetId,
            url: res.url,
            lastSyncedAt: res.updatedAt,
          })
          .catch(() => {});
        api
          .updateCourse(activeCourse.id, {
            dispositionSheetId: res.spreadsheetId,
            dispositionSheetUrl: res.url,
          })
          .catch(() => {});
      } else if (res.errorCode === 'UNAUTHORIZED') {
        setCachedAccessToken(null);
      }
    } catch (err) {
      console.warn('Background sync to Google Sheets error:', err);
    } finally {
      setIsSyncingSheet(false);
    }
  };

  // Explicit manual sync triggered by clicking "Sincronizar Sheets" / "Sincronizar Ahora"
  const handleManualSheetsSync = async () => {
    if (!activeCourse) return;
    setIsSyncingSheet(true);
    setToastMessage('Verificando conexión con Google Sheets...');
    try {
      let activeToken = token || getCachedAccessToken();
      let isAuthentic = activeToken && isValidGoogleAccessToken(activeToken);

      if (!isAuthentic) {
        setToastMessage('Solicitando autorización de tu cuenta de Google...');
        try {
          const freshToken = await requestAccessToken();
          if (freshToken && isValidGoogleAccessToken(freshToken)) {
            activeToken = freshToken;
            isAuthentic = true;
          }
        } catch (authErr: any) {
          console.warn('Google Sheets OAuth authorization error:', authErr);
          setToastMessage('Se requiere autorización de Google para editar la planilla.');
          setShowSheetsConnectModal(true);
          return;
        }
      }

      if (!activeToken || !isAuthentic) {
        setToastMessage('Por favor autoriza la conexión con Google para sincronizar la hoja.');
        setShowSheetsConnectModal(true);
        return;
      }

      setToastMessage(`Sincronizando con Google Sheets para "${activeCourse.name}"...`);
      const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      const realExistingId =
        (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
        (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

      let map1cToSync = dispositionMap;
      let map2cToSync = dispositionMap2c;
      let pulledChangesCount = 0;

      // 1. Doble Entrada (Pull): Si ya existe hoja en Sheets, primero verificamos y traemos
      // cualquier cambio que el profesor haya hecho directamente en la hoja de cálculo.
      if (realExistingId) {
        try {
          const pullRes = await sheetsService.pullDispositionSheetFromGoogle(
            activeCourse,
            currentStudents,
            dispositionMap,
            dispositionMap2c,
            realExistingId,
            activeToken
          );
          if (pullRes.success && pullRes.changesCount > 0) {
            pulledChangesCount = pullRes.changesCount;
            map1cToSync = pullRes.updatedMap1c;
            map2cToSync = pullRes.updatedMap2c;
            setDispositionMap(pullRes.updatedMap1c);
            setDispositionMap2c(pullRes.updatedMap2c);

            if (typeof window !== 'undefined' && activeCourse?.id) {
              localStorage.setItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(pullRes.updatedMap1c));
              localStorage.setItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(pullRes.updatedMap2c));
            }

            const now = new Date();
            const dateStr = formatLocalDateDMY(now);
            const timeStr = formatLocalTimeHMS(now);
            const newHistoryItems: StudentHistoryItem[] = pullRes.changes.map((change, idx) => ({
              id: `sheet-pull-${Date.now()}-${idx}`,
              studentId: change.studentId,
              studentName: change.studentName,
              courseId: activeCourse.id,
              term: change.term,
              category: change.field === 'totalAbsences' ? 'Ausencia' : change.field === 'totalLates' ? 'Llegada tarde' : 'Disposición',
              action: `Sincronización Sheets (${change.termLabel}): ${change.fieldLabel} modificado en Google Sheet de ${change.oldValue} a ${change.newValue}`,
              date: dateStr,
              time: timeStr,
              timestamp: Date.now() + idx,
            }));

            const updatedHistory = deduplicateHistory([...newHistoryItems, ...historyList]);
            setHistoryList(updatedHistory);
            saveAllDispositionStorage(pullRes.updatedMap1c, updatedHistory);
            window.dispatchEvent(new Event('docencia_student_status_updated'));

            setDobleEntradaDiffs(pullRes.changes);
            setIsDobleEntradaModalOpen(true);
          }
        } catch (pullErr) {
          console.warn('Advertencia al leer modificaciones previas en Google Sheets:', pullErr);
        }
      }

      // Ensure course dedicated Drive folder exists
      let targetFolderId = activeCourse.attendanceFolderId || activeCourse.driveFolderId;
      if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            activeCourse.name,
            undefined,
            activeToken
          );
          targetFolderId = folderStruct.attendanceFolder.id || folderStruct.mainFolder.id;
          activeCourse.attendanceFolderId = folderStruct.attendanceFolder.id;
          activeCourse.attendanceFolderUrl = folderStruct.attendanceFolder.url;
          activeCourse.gradesFolderId = folderStruct.gradesFolder.id;
          activeCourse.gradesFolderUrl = folderStruct.gradesFolder.url;
          activeCourse.driveFolderId = folderStruct.mainFolder.id;
          activeCourse.driveFolderUrl = folderStruct.mainFolder.url;
          api.updateCourse(activeCourse.id, {
            attendanceFolderId: folderStruct.attendanceFolder.id,
            attendanceFolderUrl: folderStruct.attendanceFolder.url,
            gradesFolderId: folderStruct.gradesFolder.id,
            gradesFolderUrl: folderStruct.gradesFolder.url,
            driveFolderId: folderStruct.mainFolder.id,
            driveFolderUrl: folderStruct.mainFolder.url,
          }).catch(() => {});
        } catch (_) {}
      }

      // 2. Doble Entrada (Push): Subir y sincronizar la planilla completa hacia Google Sheets
      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        map1cToSync,
        historyList.filter((h) => h.courseId === activeCourse.id),
        realExistingId,
        targetFolderId,
        activeToken,
        map2cToSync
      );

      if (res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId)) {
        activeCourse.dispositionSheetId = res.spreadsheetId;
        activeCourse.dispositionSheetUrl = res.url;

        setSheetConfig({
          spreadsheetId: res.spreadsheetId,
          url: res.url,
          isLiveGoogle: true,
          lastSyncedAt: res.updatedAt,
        });

        await api.saveCourseDispositionSheet(activeCourse.id, {
          spreadsheetId: res.spreadsheetId,
          url: res.url,
          lastSyncedAt: res.updatedAt,
        });

        await api.updateCourse(activeCourse.id, {
          dispositionSheetId: res.spreadsheetId,
          dispositionSheetUrl: res.url,
        }).catch(() => {});

        if (pulledChangesCount > 0) {
          setToastMessage(`✓ ¡Sincronizado con Sheets! Se incorporaron ${pulledChangesCount} cambio(s) desde Google Sheets y se actualizó la planilla.`);
        } else {
          setToastMessage(`✓ ¡Sincronizado con Sheets! Planilla de "${activeCourse.name}" actualizada con éxito (${res.summaryRowsCount} alumnos).`);
        }
        setSheetsModalFeedback(null);
        setShowSheetsConnectModal(false);
      } else if (res.errorCode === 'UNAUTHORIZED') {
        setToastMessage('Tu sesión de Google expiró. Por favor vuelve a autorizar tu cuenta.');
        setCachedAccessToken(null);
        setShowSheetsConnectModal(true);
      } else if (res.error) {
        setToastMessage(`Error al sincronizar con Sheets: ${res.error}`);
      } else {
        setToastMessage('No se pudo verificar la actualización en Google Sheets.');
      }
    } catch (err: any) {
      console.warn('Manual Google Sheets sync error:', err);
      setToastMessage(`Error de sincronización: ${err?.message || 'Error de conexión'}`);
    } finally {
      setIsSyncingSheet(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  // Link an existing Google Sheet by URL or ID pasted by the teacher
  const handleLinkCustomSpreadsheet = async () => {
    if (!activeCourse || !customSheetInput.trim()) return;
    const extractedId = extractSpreadsheetIdFromInput(customSheetInput);
    if (!extractedId) {
      setSheetsModalFeedback('Por favor ingresa un link válido de Google Sheets (ej: https://docs.google.com/spreadsheets/d/...) o un ID válido.');
      return;
    }

    setIsLinkingCustomSheet(true);
    try {
      const url = `https://docs.google.com/spreadsheets/d/${extractedId}/edit`;
      const updatedAt = new Date().toLocaleTimeString();

      setSheetConfig({
        spreadsheetId: extractedId,
        url,
        isLiveGoogle: true,
        lastSyncedAt: updatedAt,
      });

      await api.saveCourseDispositionSheet(activeCourse.id, {
        spreadsheetId: extractedId,
        url,
        lastSyncedAt: updatedAt,
      });

      setToastMessage('✓ Hoja de Google Sheets vinculada correctamente al curso');
      setSheetsModalFeedback('✓ Hoja vinculada con éxito. Sincronizando datos...');

      let activeToken = token || getCachedAccessToken();
      const isAuthentic = activeToken && isValidGoogleAccessToken(activeToken);

      if (isAuthentic && activeToken) {
        const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
        const res = await sheetsService.syncDispositionSheet(
          activeCourse,
          currentStudents,
          dispositionMap,
          historyList.filter((h) => h.courseId === activeCourse.id),
          extractedId,
          activeCourse.attendanceFolderId,
          activeToken
        );
        if (res.isLiveGoogle) {
          setToastMessage(`✓ Planilla vinculada y sincronizada (${res.summaryRowsCount} alumnos)`);
        }
      }

      setCustomSheetInput('');
      setShowSheetsConnectModal(false);
    } catch (err: any) {
      setSheetsModalFeedback('Error al vincular la hoja: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsLinkingCustomSheet(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  // Handler to configure or change the Google Drive folder where spreadsheets are stored
  const handleSaveCustomDriveFolder = async () => {
    if (!activeCourse || !customFolderInput.trim()) return;
    setIsLinkingCustomFolder(true);
    setSheetsModalFeedback(null);
    try {
      const input = customFolderInput.trim();
      let targetFolderId = '';
      let targetFolderName = input;
      let targetFolderUrl = '';

      // Check if user pasted a Google Drive folder URL (e.g. https://drive.google.com/drive/folders/1aBc...)
      if (input.includes('/folders/')) {
        const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          targetFolderId = match[1];
        }
      } else if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) {
        targetFolderId = input;
      }

      const activeToken = token || getCachedAccessToken();

      if (targetFolderId) {
        if (activeToken) {
          try {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name,webViewLink,trashed`,
              {
                headers: { Authorization: `Bearer ${activeToken}` },
              }
            );
            if (res.ok) {
              const data = await res.json();
              targetFolderName = data.name || 'Carpeta Personalizada';
              targetFolderUrl = data.webViewLink || `https://drive.google.com/drive/folders/${targetFolderId}`;
            }
          } catch (_) {}
        }
        if (!targetFolderUrl) {
          targetFolderUrl = `https://drive.google.com/drive/folders/${targetFolderId}`;
        }
      } else {
        // Find or create folder with this name in Google Drive
        const created = await driveService.findOrCreateFolder(targetFolderName);
        targetFolderId = created.id;
        targetFolderUrl = created.url;
      }

      // If there is an existing spreadsheet, move it into this folder
      if (sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId)) {
        await driveService.moveFileToFolder(sheetConfig.spreadsheetId, targetFolderId);
      }

      // Update course metadata in database & local state
      const updatedData: Partial<Course> = {
        driveFolderId: targetFolderId,
        driveFolderUrl: targetFolderUrl,
        attendanceFolderId: targetFolderId,
        attendanceFolderUrl: targetFolderUrl,
      };

      await api.updateCourse(activeCourse.id, updatedData);
      Object.assign(activeCourse, updatedData);

      setSheetsModalFeedback(`✓ Carpeta de Drive configurada: "${targetFolderName}". Las planillas se guardarán en esta ubicación.`);
      setToastMessage(`✓ Carpeta de Drive actualizada: "${targetFolderName}"`);
      setCustomFolderInput('');
    } catch (err: any) {
      setSheetsModalFeedback('Error al configurar la carpeta de Drive: ' + (err?.message || 'Error'));
    } finally {
      setIsLinkingCustomFolder(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  // Safely open or initialize live Google Sheet without 404 dead links
  const handleOpenGoogleSheet = async () => {
    if (!activeCourse) return;

    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    // 1. If we already have a confirmed live Google Sheet URL or real ID that belongs to this course
    if (
      sheetConfig?.spreadsheetId &&
      isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) &&
      (isS2NatCourse || sheetConfig.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
    ) {
      const openUrl = sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`;
      window.open(openUrl, '_blank');
      return;
    }

    // 2. Otherwise trigger manual sync to create/link and open
    await handleManualSheetsSync();
  };

  const handleConnectGoogleForSheets = async () => {
    await handleManualSheetsSync();
    if (sheetConfig?.url) {
      window.open(sheetConfig.url, '_blank');
    }
  };

  // Doble Entrada (Two-Way Sync): Traer cambios realizados directamente en Google Sheets a la App
  const handlePullFromGoogleSheet = async (showFeedback = true) => {
    if (!activeCourse) return;
    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    const sheetId =
      (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
      (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

    if (!sheetId) {
      setToastMessage('Aviso: Primero vincula una hoja de Google Sheets a la materia para usar Doble Entrada.');
      setTimeout(() => setToastMessage(null), 4000);
      setShowSheetsConnectModal(true);
      return;
    }

    const activeToken = token || getCachedAccessToken();
    if (!activeToken || !isValidGoogleAccessToken(activeToken)) {
      setToastMessage('Para leer datos de Google Sheets en tiempo real, autoriza tu cuenta de Google.');
      setShowSheetsConnectModal(true);
      return;
    }

    setIsPullingFromSheet(true);
    try {
      const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
      const res = await sheetsService.pullDispositionSheetFromGoogle(
        activeCourse,
        currentStudents,
        dispositionMap,
        dispositionMap2c,
        sheetId,
        activeToken
      );

      if (!res.success) {
        setToastMessage(res.message);
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      if (res.changesCount > 0) {
        // Actualizar estados locales de 1c y 2c
        setDispositionMap(res.updatedMap1c);
        setDispositionMap2c(res.updatedMap2c);
        if (typeof window !== 'undefined' && activeCourse?.id) {
          localStorage.setItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(res.updatedMap1c));
          localStorage.setItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(res.updatedMap2c));
        }

        // Registrar los cambios en el historial para auditoría
        const now = new Date();
        const dateStr = formatLocalDateDMY(now);
        const timeStr = formatLocalTimeHMS(now);
        const newHistoryItems: StudentHistoryItem[] = res.changes.map((change, idx) => ({
          id: `sheet-pull-${Date.now()}-${idx}`,
          studentId: change.studentId,
          studentName: change.studentName,
          courseId: activeCourse.id,
          term: change.term,
          category: change.field === 'totalAbsences' ? 'Ausencia' : change.field === 'totalLates' ? 'Llegada tarde' : 'Disposición',
          action: `Doble Entrada Sheets (${change.termLabel}): ${change.fieldLabel} modificado en Google Sheet de ${change.oldValue} a ${change.newValue}`,
          date: dateStr,
          time: timeStr,
          timestamp: Date.now() + idx,
        }));

        const updatedHistory = deduplicateHistory([...newHistoryItems, ...historyList]);
        setHistoryList(updatedHistory);
        saveAllDispositionStorage(res.updatedMap1c, updatedHistory);

        // Notificar a toda la aplicación
        window.dispatchEvent(new Event('docencia_student_status_updated'));

        setDobleEntradaDiffs(res.changes);
        setIsDobleEntradaModalOpen(true);
        setToastMessage(`✓ ¡Doble Entrada! Se sincronizaron ${res.changesCount} cambio(s) desde Google Sheets.`);
        setTimeout(() => setToastMessage(null), 5000);
      } else {
        if (showFeedback) {
          setToastMessage('✓ Google Sheet y App sincronizados: No hay diferencias pendientes.');
          setTimeout(() => setToastMessage(null), 3500);
        }
      }
    } catch (err: any) {
      console.error('Error in handlePullFromGoogleSheet:', err);
      setToastMessage('No se pudo leer la hoja de cálculo. Verifica permisos o conexión.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsPullingFromSheet(false);
    }
  };

  // Exportar archivos Excel para la materia
  const handleExportAllCourseExcel = (type: 'all' | 'disposition' | 'grades' | 'history') => {
    if (!activeCourse) return;
    if (type === 'disposition') {
      exportCourseDispositionToExcel(activeCourse.name, courseStudents, dispositionMap, dispositionMap2c);
    } else if (type === 'history') {
      exportCourseClassHistoryToExcel(activeCourse.name, courseHistory);
    } else if (type === 'grades') {
      const cats1c = localStorage.getItem(`fds_grades_categories_${activeCourse.id}_1c`) || localStorage.getItem(`fds_grades_categories_${activeCourse.id}`);
      const parsedCats = cats1c ? JSON.parse(cats1c) : DEFAULT_CATEGORIES;
      const gradesData = localStorage.getItem(`fds_grades_data_${activeCourse.id}_1c`) || localStorage.getItem(`fds_grades_data_${activeCourse.id}`);
      const parsedGrades = gradesData ? JSON.parse(gradesData) : {};
      exportGradebookMatrixToExcel(activeCourse.name, '1° Cuatrimestre', courseStudents, parsedCats, parsedGrades);
    } else {
      // Export package: both disposition and history
      exportCourseDispositionToExcel(activeCourse.name, courseStudents, dispositionMap, dispositionMap2c);
      setTimeout(() => {
        exportCourseClassHistoryToExcel(activeCourse.name, courseHistory);
      }, 500);
    }
    setIsHeaderExportExcelModalOpen(false);
    setToastMessage(`✓ Archivo Excel descargado para "${activeCourse.name}"`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Helper para categorías de calificaciones del curso
  const getCategoriesForImport = (term: '1c' | '2c'): GradeCategory[] => {
    if (!activeCourse) return DEFAULT_CATEGORIES;
    try {
      const key = `fds_grades_categories_${activeCourse.id}_${term}`;
      const saved = localStorage.getItem(key) || (term === '1c' ? localStorage.getItem(`fds_grades_categories_${activeCourse.id}`) : null);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_CATEGORIES;
  };

  // Helper para mapa de notas del curso
  const getGradesMapForImport = (term: '1c' | '2c'): StudentGradesMap => {
    if (!activeCourse) return {};
    try {
      const key = `fds_grades_data_${activeCourse.id}_${term}`;
      const saved = localStorage.getItem(key) || (term === '1c' ? localStorage.getItem(`fds_grades_data_${activeCourse.id}`) : null);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {};
  };

  // Aplicar notas importadas desde el modal de la cabecera
  const handleApplyImportFromClassesModule = (data: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>;
    historyEntry: GradeHistoryEntry;
  }) => {
    if (!activeCourse) return;
    const isTarget2c = data.term === '2c';
    let targetCats = getCategoriesForImport(data.term);

    if (data.newSubcategoryName) {
      targetCats = targetCats.map((cat) => {
        if (cat.id === data.categoryId) {
          return {
            ...cat,
            subcategories: [
              ...cat.subcategories,
              {
                id: data.subcategoryId,
                name: data.newSubcategoryName!,
                maxScore: 10,
              },
            ],
          };
        }
        return cat;
      });
      localStorage.setItem(`fds_grades_categories_${activeCourse.id}_${data.term}`, JSON.stringify(targetCats));
      if (!isTarget2c) {
        localStorage.setItem(`fds_grades_categories_${activeCourse.id}`, JSON.stringify(targetCats));
      }
    }

    const currentTargetGrades = getGradesMapForImport(data.term);
    Object.entries(data.updates).forEach(([stId, score]) => {
      if (!currentTargetGrades[stId]) {
        currentTargetGrades[stId] = {};
      }
      currentTargetGrades[stId] = {
        ...currentTargetGrades[stId],
        [data.subcategoryId]: score,
      };
    });

    localStorage.setItem(`fds_grades_data_${activeCourse.id}_${data.term}`, JSON.stringify(currentTargetGrades));
    if (!isTarget2c) {
      localStorage.setItem(`fds_grades_data_${activeCourse.id}`, JSON.stringify(currentTargetGrades));
    }

    // Guardar en historial
    try {
      const hKey = `fds_grade_history_${activeCourse.id}`;
      const savedHist = localStorage.getItem(hKey);
      const parsedHist = savedHist ? JSON.parse(savedHist) : [];
      localStorage.setItem(hKey, JSON.stringify([data.historyEntry, ...parsedHist]));
    } catch (_) {}

    // Persistir en Firestore
    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveTermSnapshot(userId, activeCourse.id, data.term, {
          courseId: activeCourse.id,
          term: data.term,
          termLabel: data.term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
          categories: targetCats,
          gradesMap: currentTargetGrades,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }

    // Notificar al sistema
    window.dispatchEvent(
      new CustomEvent('fds-grades-updated', {
        detail: { term: data.term, courseId: activeCourse.id },
      })
    );

    setActiveTab('grades');
    setIsHeaderImportModalOpen(false);
    setToastMessage(`✓ ¡Se importaron y registraron ${Object.keys(data.updates).length} nota(s) con éxito!`);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const handleOpenInSheetsNew = async () => {
    if (!activeCourse) return;
    const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
    const headers = ['Estudiante', 'Email', 'Disposición', 'Faltas', 'Tardanzas', 'Estado'];
    const rows = currentStudents.map((st) => {
      const disp = dispositionMap[st.id];
      const fullName = `${st.lastName || ''} ${st.firstName || ''}`.trim() || st.email;
      const score = disp?.totalDisposition ?? 10;
      return [
        fullName,
        st.email,
        score,
        disp?.totalAbsences ?? 0,
        disp?.totalLates ?? 0,
        score >= 7 ? 'Regular' : 'En observación',
      ];
    });
    await copyTableToClipboard(headers, rows);
    window.open('https://sheets.new', '_blank');
    setSheetsModalFeedback('¡Datos copiados al portapapeles! Se abrió Google Sheets en una nueva pestaña. Presiona Ctrl+V para pegar.');
  };

  const handleDownloadCourseCsv = () => {
    if (!activeCourse) return;
    const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
    const currentHistory = historyList.filter((h) => h.courseId === activeCourse.id);
    sheetsService.exportDispositionCsv(activeCourse.name, currentStudents, dispositionMap, currentHistory);
    setSheetsModalFeedback('Archivo CSV descargado con éxito.');
  };

  // Clean any legacy mock students on startup
  useEffect(() => {
    api.cleanMockStudents().catch(() => {});
  }, []);

  const handleSyncRoster = async () => {
    if (!activeCourse) return;
    const activeToken = token || getCachedAccessToken();
    if (!activeToken) {
      setToastMessage('Por favor conectá tu cuenta de Google para sincronizar los estudiantes de Classroom.');
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    try {
      setIsSyncingClassroomRoster(true);
      const res = await classroomService.resolveAndFetchCourseStudents(activeCourse, activeToken);

      if (res.rosterPermissionRequired) {
        setNeedsRosterPermission(true);
        setToastMessage('Se requiere permiso para leer la nómina de estudiantes de Google Classroom.');
        setTimeout(() => setToastMessage(null), 5000);
        return;
      }

      if (res.success && Array.isArray(res.students)) {
        setNeedsRosterPermission(false);
        await api.syncCourseStudentsRoster(activeCourse.id, res.students);

        if (res.realClassroomId && res.realClassroomId !== activeCourse.classroomCourseId) {
          await api.updateCourse(activeCourse.id, {
            classroomCourseId: res.realClassroomId,
            classroomSynced: true,
            studentsCount: res.students.length,
          });
        }

        onRefreshData();
        setToastMessage(`¡Listo! Se sincronizaron ${res.students.length} estudiantes reales desde Google Classroom.`);
        setTimeout(() => setToastMessage(null), 4500);
      } else {
        setToastMessage(res.message || 'No se encontraron estudiantes inscriptos en este curso de Google Classroom.');
        setTimeout(() => setToastMessage(null), 4500);
      }
    } catch (err: any) {
      console.warn('Error al sincronizar alumnos:', err);
      setToastMessage(err?.message || 'Error al conectar con Google Classroom.');
      setTimeout(() => setToastMessage(null), 4500);
    } finally {
      setIsSyncingClassroomRoster(false);
    }
  };

  // Abre el modal de Sincronización con Calendar y carga los eventos inmediatamente
  const handleOpenCalendarSyncModal = async (course: Course) => {
    setCalendarModalCourse(course);
    setCalendarScheduleSelection(
      course.schedule &&
        course.schedule !== 'Lunes y Miércoles' &&
        !course.schedule.toLowerCase().includes('coordinar')
        ? course.schedule
        : ''
    );
    setIsCalendarModalOpen(true);

    // Cargar automáticamente y en ultra-rápido (< 500ms) los bloques de eventos de la semana
    const activeToken = token || getCachedAccessToken();
    if (activeToken) {
      try {
        setIsLoadingSlots(true);
        const res = await calendarService.getWeeklyCalendarSlots('primary');
        if (res.success) {
          setCalendarSlots(res.slots);
        }
      } catch (err) {
        console.warn('Error loading calendar slots:', err);
      } finally {
        setIsLoadingSlots(false);
      }
    }
  };

  // Guardar la selección elegida del Calendar para el curso
  const handleSaveCalendarSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarModalCourse) return;
    const cleanSchedule = calendarScheduleSelection.trim();
    if (!cleanSchedule) return;

    try {
      setIsSavingCalendarSelection(true);
      // 1. Guardar en la base de datos
      await api.updateCourse(calendarModalCourse.id, { schedule: cleanSchedule });

      // 2. Sincronizar bloques de cursada en el calendario interno de la app
      await fetch('/api/calendar/sync-course-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCourseId: calendarModalCourse.id }),
      }).catch((e) => console.warn('Sync internal schedule error:', e));

      // 3. Sincronización bidireccional a Google Calendar si está marcada la casilla
      let googleMsg = '';
      if (syncToGoogleFromModal) {
        const activeToken = token || getCachedAccessToken();
        if (activeToken) {
          try {
            const gRes = await calendarService.syncCourseScheduleToGoogle(
              calendarModalCourse,
              cleanSchedule,
              'primary'
            );
            if (gRes.success) {
              googleMsg = ' y actualizado en tu Google Calendar con repetición semanal';
            }
          } catch (gErr) {
            console.warn('Error syncing to Google Calendar:', gErr);
          }
        }
      }

      setToastMessage(`¡Horario confirmado para ${calendarModalCourse.name}${googleMsg}!`);
      setTimeout(() => setToastMessage(null), 5000);
      setIsCalendarModalOpen(false);
      setCalendarModalCourse(null);
      onRefreshData();
    } catch (err) {
      console.error('Error guardando horario:', err);
      setToastMessage('No se pudo guardar el horario seleccionado.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingCalendarSelection(false);
    }
  };

  // Abre el modal para editar datos específicos del curso (Aula, división, materia, etc.)
  const handleOpenEditCourseDetailsModal = (course: Course) => {
    setEditCourseData({
      id: course.id,
      name: course.name,
      subject: course.subject || '',
      grade: course.grade || '',
      room: course.room || '',
      division: course.division || '',
      schedule: course.schedule || '',
    });
    setIsEditCourseModalOpen(true);
  };

  // Guardar datos específicos del curso
  const handleSaveCourseDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCourseData) return;

    try {
      setIsSavingCourseDetails(true);
      await api.updateCourse(editCourseData.id, {
        name: editCourseData.name.trim(),
        subject: editCourseData.subject.trim(),
        grade: editCourseData.grade.trim(),
        room: editCourseData.room.trim(),
        division: editCourseData.division.trim(),
        schedule: editCourseData.schedule.trim(),
      });

      setToastMessage(`¡Información actualizada para ${editCourseData.name}!`);
      setTimeout(() => setToastMessage(null), 4500);
      setIsEditCourseModalOpen(false);
      setEditCourseData(null);
      onRefreshData();
    } catch (err) {
      console.error('Error guardando detalles del curso:', err);
      setToastMessage('Error al actualizar los datos del curso.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingCourseDetails(false);
    }
  };

  const filteredStudents = courseStudents.filter((s) =>
    `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper to get student disposition data (reconciled with historyList and dispositionMap per term)
  const getStudentMetrics = (
    studentId: string,
    targetTerm: '1c' | '2c' | 'annual' = attendanceTerm
  ): StudentDispositionData => {
    if (targetTerm === 'annual') {
      const m1 = getStudentMetrics(studentId, '1c');
      const m2 = getStudentMetrics(studentId, '2c');
      const totalAbsences = m1.totalAbsences + m2.totalAbsences;
      const totalLates = (m1.totalLates || 0) + (m2.totalLates || 0);
      const totalDisposition = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
      return {
        totalAbsences,
        totalLates,
        totalDisposition,
      };
    }

    const is2c = targetTerm === '2c';
    const fromMap = is2c ? dispositionMap2c[studentId] : dispositionMap[studentId];
    const studentHistory = historyList.filter(
      (h) => h.studentId === studentId && (is2c ? h.term === '2c' : (h.term === '1c' || !h.term))
    );

    const historyAbsences = studentHistory.filter(
      (h) =>
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta')
    ).length;

    const historyLates = studentHistory.filter(
      (h) =>
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza')
    ).length;

    let calculatedDisp = 10;
    const sortedStudentEvents = [...studentHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    for (const ev of sortedStudentEvents) {
      const isReset =
        ev.category === 'Sistema' ||
        ev.action?.toLowerCase().includes('restablecid') ||
        ev.action?.toLowerCase().includes('reinicio');
      if (isReset) {
        calculatedDisp = 10;
        continue;
      }
      if (ev.pointsChange !== undefined) {
        calculatedDisp = Math.min(10, Math.max(0, calculatedDisp + ev.pointsChange));
      } else if (ev.category === 'Disposición') {
        calculatedDisp = Math.max(0, calculatedDisp - 1);
      }
    }

    let totalAbsences = 0;
    if (fromMap?.totalAbsences !== undefined) {
      totalAbsences = fromMap.totalAbsences;
    } else {
      totalAbsences = historyAbsences;
    }
    if (historyAbsences > totalAbsences) {
      totalAbsences = historyAbsences;
    }
    if (historyAbsences === 0 && (!fromMap || fromMap.totalAbsences === undefined)) {
      totalAbsences = 0;
    }

    let totalLates = 0;
    if (fromMap?.totalLates !== undefined) {
      totalLates = fromMap.totalLates;
    } else {
      totalLates = historyLates;
    }
    if (historyLates > totalLates) {
      totalLates = historyLates;
    }
    if (historyLates === 0 && (!fromMap || fromMap.totalLates === undefined)) {
      totalLates = 0;
    }

    let totalDisposition = 10;
    if (fromMap?.totalDisposition !== undefined) {
      totalDisposition = fromMap.totalDisposition;
    } else {
      totalDisposition = calculatedDisp;
    }

    return {
      totalAbsences,
      totalLates,
      totalDisposition,
    };
  };

  const saveTermDisposition = (
    term: '1c' | '2c',
    updatedMap: Record<string, StudentDispositionData>,
    updatedHistory: StudentHistoryItem[]
  ) => {
    if (term === '2c') {
      setDispositionMap2c(updatedMap);
      if (typeof window !== 'undefined') {
        localStorage.setItem('fds_disposition_data_2c', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          localStorage.setItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(updatedMap));
        }
      }
      saveAllDispositionStorage(dispositionMap, updatedHistory);
    } else {
      setDispositionMap(updatedMap);
      if (typeof window !== 'undefined' && activeCourse?.id) {
        localStorage.setItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(updatedMap));
      }
      saveAllDispositionStorage(updatedMap, updatedHistory);
    }
  };

  // -------------------------------------------------------------
  // LÓGICA DE REGISTRO IDÉNTICA AL SCRIPT DE GOOGLE SHEETS
  // -------------------------------------------------------------

  // 1. LÓGICA PARA AUSENCIAS (Columna B / número 2 del script + Descuento de 1 pto de Disposición)
  const handleAddAbsence = async (student: Student) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const id = `rec-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';

    // Visual feedback
    setPulsingStudentId(`abs-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const current = getStudentMetrics(student.id, targetTerm);
    const newAbsences = current.totalAbsences + 1;
    const newDisposition = current.totalDisposition;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalAbsences: newAbsences,
        totalDisposition: newDisposition,
      },
    };

    // Initial history entry (message notification starts as pending)
    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: 'Ausencia',
      category: 'Ausencia',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...historyList]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    setToastMessage(`Ausencia registrada para ${student.firstName} ${student.lastName} (+1 Falta en ${targetTerm === '2c' ? '2°C' : '1°C'})`);
    setTimeout(() => setToastMessage(null), 3500);

    // Sync immediately in real time to Google Sheets
    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    // Persist to server with exact ID, date, time, timestamp and expected summary
    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: 'Ausencia',
        category: 'Ausencia',
        date,
        time,
        timestamp,
        messageSent: false,
        messageText: '',
        notificationMethod: 'none',
        expectedSummary: {
          totalAbsences: newAbsences,
          totalLates: current.totalLates || 0,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});

    // Check if teacher has selected a default preset or standard
    const activePreset = savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];
    const channelToUse = activePreset.channel !== 'any' ? activePreset.channel : notifSettings.channel;
    const personalizedMessage = formatTemplateForStudent(
      activePreset.text,
      student,
      activeCourse.name,
      newDisposition,
      date
    );

    if (notifSettings.autoNotify) {
      // Auto-send directly
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
    } else if (notifSettings.dontShowPopupOnAbsence) {
      // Fast roll-call mode: do not open modal per student, record absence as pending for batch send
      setToastMessage(`Ausencia registrada para ${student.firstName} ${student.lastName}. Aviso pendiente para enviar al final.`);
      setTimeout(() => setToastMessage(null), 3500);
    } else {
      // Open customizable notification modal for teacher confirmation/editing
      setAbsenceNotifModal({
        isOpen: true,
        historyItem: newHistoryEntry,
        student,
        channel: channelToUse,
        messageText: personalizedMessage,
        selectedPresetId: activePreset.id,
        showSavePresetInput: false,
        newPresetName: '',
        isSending: false,
      });
    }
  };

  // Helper to send notification (Classroom announcement or Gmail) and update sheet / history
  const sendNotificationForItem = async (
    historyItem: StudentHistoryItem,
    student: Student,
    channel: 'classroom' | 'gmail',
    messageText: string
  ) => {
    let success = false;
    let notifMessage = '';

    if (channel === 'classroom') {
      const classroomCourseId = activeCourse.classroomCourseId || activeCourse.id;
      // Google Classroom targeted announcement (assigneeMode: INDIVIDUAL_STUDENTS)
      const res = await classroomService.createIndividualAnnouncement(
        classroomCourseId,
        student.id,
        messageText
      );
      success = res.success;
      notifMessage = res.message || (res.success ? 'Aviso publicado en el tablón del estudiante' : 'Error en Classroom');
    } else {
      // Gmail message send
      const subject = historyItem.category === 'Disposición'
        ? `Aviso de Conducta / Disposición - ${activeCourse.name}`
        : `Notificación de Inasistencia - ${activeCourse.name}`;
      const res = await gmailService.sendEmail(
        student.email || '',
        subject,
        messageText
      );
      success = res.success;
      notifMessage = res.message || (res.success ? 'Correo enviado' : 'Error en Gmail');
    }

    const now = new Date();
    const notifiedAt = now.toLocaleTimeString();

    // Update in local history
    const updatedHistory = historyList.map((item) => {
      if (item.id === historyItem.id) {
        return {
          ...item,
          messageSent: true,
          messageText,
          notificationMethod: channel,
          notifiedAt,
        };
      }
      return item;
    });

    setHistoryList(updatedHistory);

    // Update in Google Sheets
    triggerSheetsSync(dispositionMap, updatedHistory);

    // Persist notification state to server
    api
      .updateDispositionHistoryNotification(historyItem.id, {
        messageSent: true,
        messageText,
        notificationMethod: channel,
        notifiedAt,
      })
      .catch(() => {});

    setToastMessage(
      success
        ? `Notificación enviada a ${student.firstName} (${channel === 'classroom' ? 'Tablón Classroom' : 'Correo Gmail'})`
        : `Aviso registrado en la planilla: ${notifMessage}`
    );
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Helper to obtain the personalized message for an item in batch mode
  const getBatchMessageForItem = (
    item: { historyItem: StudentHistoryItem; student: Student },
    modalState: typeof batchAbsenceModal
  ): string => {
    // 1. If teacher manually customized this specific item in preview
    if (modalState.customPerItemMessages && modalState.customPerItemMessages[item.historyItem.id]) {
      return modalState.customPerItemMessages[item.historyItem.id];
    }

    const curDisp = dispositionMap[item.student.id]?.totalDisposition ?? 10;
    const isConduct = item.historyItem.category === 'Disposición';

    // 2. If smart templates is enabled (default)
    if (modalState.useSmartTemplates) {
      if (isConduct) {
        const specificTpl = getTemplateForReason(item.historyItem.action);
        return formatTemplateForStudent(
          specificTpl,
          item.student,
          activeCourse?.name || '',
          curDisp,
          item.historyItem.date || '',
          item.historyItem.action
        );
      } else {
        const defaultAbsenceTpl =
          savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
          notifSettings.templateClassroom ||
          DEFAULT_ABSENCE_PRESETS[0].text;
        return formatTemplateForStudent(
          defaultAbsenceTpl,
          item.student,
          activeCourse?.name || '',
          curDisp,
          item.historyItem.date || ''
        );
      }
    }

    // 3. Unified template mode
    return formatTemplateForStudent(
      modalState.rawTemplateText,
      item.student,
      activeCourse?.name || '',
      curDisp,
      item.historyItem.date || '',
      item.historyItem.action
    );
  };

  // Batch actions for deferred notifications (Absences and Conduct)
  const handleOpenBatchFromPending = (filterType: 'all' | 'absences' | 'conduct' = 'all') => {
    if (!activeCourse) return;
    let targetItems: StudentHistoryItem[] = [];
    if (filterType === 'absences') {
      targetItems = pendingAbsenceItems;
    } else if (filterType === 'conduct') {
      targetItems = pendingConductItems;
    } else {
      targetItems = pendingAllItems;
    }

    const items = targetItems
      .map((h) => {
        const student =
          students.find((s) => s.id === h.studentId) ||
          courseStudents.find((s) => s.id === h.studentId) ||
          ({
            id: h.studentId,
            firstName: h.studentName?.split(' ')[0] || h.studentName,
            lastName: h.studentName?.split(' ').slice(1).join(' ') || '',
            email: '',
            courseId: activeCourse.id,
          } as Student);
        return { historyItem: h, student };
      })
      .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];

    if (items.length === 0) {
      setToastMessage('No hay avisos pendientes de notificación para este curso.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const defaultPreset = savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleOpenBatchFromSelectedStudents = () => {
    if (!activeCourse || selectedStudentIds.length === 0) return;

    const items: { historyItem: StudentHistoryItem; student: Student }[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let updatedMap = { ...dispositionMap };
    let newHistoryEntries: StudentHistoryItem[] = [];

    selectedStudentIds.forEach((studentId) => {
      const student = students.find((s) => s.id === studentId);
      if (!student) return;

      const existingPending = historyList.find(
        (h) => h.courseId === activeCourse.id && h.studentId === student.id && h.category === 'Ausencia' && !h.messageSent
      );

      if (existingPending) {
        items.push({ historyItem: existingPending, student });
      } else {
        const current = updatedMap[student.id] || { totalAbsences: 0, totalDisposition: 10 };
        const newDisposition = current.totalDisposition;
        updatedMap[student.id] = {
          ...current,
          totalAbsences: current.totalAbsences + 1,
          totalDisposition: newDisposition,
        };

        const id = `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const newHistory: StudentHistoryItem = {
          id,
          studentId: student.id,
          studentName: `${student.lastName}, ${student.firstName}`,
          courseId: activeCourse.id,
          date,
          time,
          action: 'Ausencia',
          category: 'Ausencia',
          pointsChange: 0,
          timestamp: Date.now(),
          messageSent: false,
          messageText: '',
          notificationMethod: 'none',
        };
        newHistoryEntries.push(newHistory);
        items.push({ historyItem: newHistory, student });

        api.recordDisposition(newHistory).catch(() => {});
      }
    });

    if (newHistoryEntries.length > 0) {
      const mergedHistory = deduplicateHistory([...newHistoryEntries, ...historyList]);
      setHistoryList(mergedHistory);
      setDispositionMap(updatedMap);
      triggerSheetsSync(updatedMap, mergedHistory);
    }

    const defaultPreset = savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleOpenBatchFromSelectedHistory = () => {
    if (!activeCourse || selectedPendingHistoryIds.length === 0) return;
    const items = selectedPendingHistoryIds
      .map((id) => {
        const h = historyList.find((item) => item.id === id);
        if (!h) return null;
        const student =
          students.find((s) => s.id === h.studentId) ||
          courseStudents.find((s) => s.id === h.studentId) ||
          ({
            id: h.studentId,
            firstName: h.studentName?.split(' ')[0] || h.studentName,
            lastName: h.studentName?.split(' ').slice(1).join(' ') || '',
            email: '',
            courseId: activeCourse.id,
          } as Student);
        return { historyItem: h, student };
      })
      .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];

    if (items.length === 0) return;

    const defaultPreset = savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleSendBatchNotifications = async () => {
    if (batchAbsenceModal.selectedItems.length === 0) return;
    setBatchAbsenceModal((prev) => ({ ...prev, isSending: true }));

    const channel = batchAbsenceModal.channel;
    const total = batchAbsenceModal.selectedItems.length;
    let sentCount = 0;

    let updatedHistoryItems: StudentHistoryItem[] = [...historyList];

    for (let i = 0; i < total; i++) {
      const item = batchAbsenceModal.selectedItems[i];
      const student = item.student;
      const historyItem = item.historyItem;

      setBatchAbsenceModal((prev) => ({
        ...prev,
        isSending: true,
        currentSendingStudentName: `${student.firstName} ${student.lastName}`,
        progress: i + 1,
        total,
        sendProgress: {
          current: i + 1,
          total,
          currentStudentName: `${student.firstName} ${student.lastName}`,
        },
      }));

      const personalizedMessage = getBatchMessageForItem(item, batchAbsenceModal);
      const isConduct = historyItem.category === 'Disposición';
      const emailSubject = isConduct
        ? `Notificación de Conducta / Disposición - ${activeCourse.name}`
        : `Notificación de Inasistencia - ${activeCourse.name}`;

      let success = false;
      let notifMessage = '';

      if (channel === 'classroom') {
        const classroomCourseId = activeCourse.classroomCourseId || activeCourse.id;
        const res = await classroomService.createIndividualAnnouncement(
          classroomCourseId,
          student.id,
          personalizedMessage
        );
        success = res.success;
        notifMessage = res.message || '';
      } else {
        const res = await gmailService.sendEmail(
          student.email || '',
          emailSubject,
          personalizedMessage
        );
        success = res.success;
        notifMessage = res.message || '';
      }

      const now = new Date();
      const notifiedAt = now.toLocaleTimeString();

      const idx = updatedHistoryItems.findIndex((h) => h.id === historyItem.id);
      if (idx !== -1) {
        updatedHistoryItems[idx] = {
          ...updatedHistoryItems[idx],
          messageSent: true,
          messageText: personalizedMessage,
          notificationMethod: channel,
          notifiedAt,
        };
      }

      api
        .updateDispositionHistoryNotification(historyItem.id, {
          messageSent: true,
          messageText: personalizedMessage,
          notificationMethod: channel,
          notifiedAt,
        })
        .catch(() => {});

      sentCount++;
    }

    setHistoryList(updatedHistoryItems);
    triggerSheetsSync(dispositionMap, updatedHistoryItems);

    setBatchAbsenceModal({
      isOpen: false,
      selectedItems: [],
      channel: 'classroom',
      selectedPresetId: 'preset-standard',
      rawTemplateText: '',
      previewStudentIndex: 0,
      previewStudentId: '',
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: 0,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });

    setSelectedStudentIds([]);
    setSelectedPendingHistoryIds([]);

    setToastMessage(`¡Listo! Se enviaron ${sentCount} avisos por ${channel === 'classroom' ? 'Classroom' : 'Gmail'} y se registraron en Google Sheets.`);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const toggleSelectStudent = (studentId: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleSelectAllStudents = () => {
    if (selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(filteredStudents.map((s) => s.id));
    }
  };

  const toggleSelectPendingHistory = (historyId: string) => {
    setSelectedPendingHistoryIds((prev) =>
      prev.includes(historyId) ? prev.filter((id) => id !== historyId) : [...prev, historyId]
    );
  };

  const toggleSelectAllPendingHistory = () => {
    const pendingIds = courseHistory
      .filter((item) => (item.category === 'Ausencia' || item.category === 'Disposición') && !item.messageSent)
      .map((item) => item.id);
    if (selectedPendingHistoryIds.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedPendingHistoryIds([]);
    } else {
      setSelectedPendingHistoryIds(pendingIds);
    }
  };

  // 2. LÓGICA PARA DISPOSICIÓN (Resta o suma puntos del total y registra en historial)
  const handleRecordDispositionAction = async (
    student: Student,
    actionName: string,
    detailText?: string,
    explicitPointsDelta?: number
  ) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const id = `rec-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;

    const isActionPositive =
      actionName.startsWith('+') ||
      actionName.startsWith('[+]') ||
      actionName.includes('(+') ||
      /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(actionName);

    const delta = explicitPointsDelta !== undefined
      ? explicitPointsDelta
      : (isActionPositive ? 1 : -1);

    const cleanAction = actionName.replace(/^(\+|\[\+\])\s*/, '');

    let finalAction = cleanAction;
    if (detailText && detailText.trim()) {
      finalAction = detailText.trim();
    } else if (actionName === 'Otros' && detailText) {
      finalAction = detailText.trim() || (delta > 0 ? 'Reconocimiento destacado' : 'Conducta no especificada');
    }

    // Visual feedback
    setPulsingStudentId(`disp-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
    const current = getStudentMetrics(student.id, targetTerm);
    const currentDisp = current.totalDisposition !== undefined ? current.totalDisposition : 10;
    const newDisposition = Math.min(10, Math.max(0, currentDisp + delta));
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: newDisposition,
      },
    };

    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: finalAction,
      category: 'Disposición',
      pointsChange: delta,
      previousDisposition: currentDisp,
      resultingDisposition: newDisposition,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...historyList]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const typeStr = delta > 0 ? 'Reconocimiento registrado' : 'Conducta registrada';
    setToastMessage(`${typeStr} para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}: ${finalAction} (${deltaStr} pto | ${currentDisp} → ${newDisposition} pts)`);
    setTimeout(() => setToastMessage(null), 3500);

    // Sync immediately in real time to Google Sheets
    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    // Persist to server with exact ID, date, time, timestamp and expectedSummary
    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: finalAction,
        category: 'Disposición',
        detail: detailText,
        date,
        time,
        timestamp,
        expectedSummary: {
          totalAbsences: current.totalAbsences,
          totalLates: current.totalLates || 0,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});

    // Flujo de notificación al alumno cuando se suma o resta disposición
    const specificReasonTemplate = getTemplateForReason(finalAction, delta > 0 ? 'positive' : 'negative');
    const activeConductPreset =
      savedPresets.find((p) => p.category === 'Disposición' && p.isDefault) ||
      savedPresets.find((p) => p.category === 'Disposición') ||
      DEFAULT_CONDUCT_PRESETS[0];

    const channelToUse = activeConductPreset.channel !== 'any' ? activeConductPreset.channel : notifSettings.channel;
    const personalizedMessage = formatTemplateForStudent(
      specificReasonTemplate,
      student,
      activeCourse.name,
      newDisposition,
      date,
      finalAction,
      delta
    );

    if (notifSettings.autoNotify) {
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
    } else if (notifSettings.dontShowPopupOnDisposition) {
      setToastMessage(
        delta > 0
          ? `Reconocimiento registrado (+${delta} pto). Aviso para ${student.firstName} ${student.lastName} pendiente para enviar.`
          : `Conducta registrada (${delta} pto). Aviso para ${student.firstName} ${student.lastName} pendiente para enviar.`
      );
      setTimeout(() => setToastMessage(null), 3500);
    } else {
      setAbsenceNotifModal({
        isOpen: true,
        historyItem: newHistoryEntry,
        student,
        channel: channelToUse,
        messageText: personalizedMessage,
        selectedPresetId: `reason-${finalAction}`,
        showSavePresetInput: false,
        newPresetName: '',
        isSending: false,
      });
      setSaveReasonAsDefaultOnSend(true);
    }
  };

  // 3. Confirmación desde modal de registrar conducta (suma o resta de puntos)
  const handleConfirmConductRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!conductRecordModal.student) return;

    const reason = conductRecordModal.customReason.trim();
    if (!reason) return;

    const isAdd = conductRecordModal.mode === 'add';
    const pts = Math.abs(conductRecordModal.points || 1);
    const delta = isAdd ? pts : -pts;

    if (conductRecordModal.saveToOptions) {
      const optionToSave = isAdd ? `+ ${reason}` : reason;
      handleAddConductOption(optionToSave);
    }

    handleRecordDispositionAction(conductRecordModal.student, reason, undefined, delta);
    setConductRecordModal({ isOpen: false, student: null, mode: 'subtract', points: 1, customReason: '', saveToOptions: false });
  };

  // 4. Eliminar entrada errónea del historial (revierte el punto sacado, o quita la ausencia o tardanza)
  const handleDeleteHistoryEntry = async (item: StudentHistoryItem) => {
    // 1. Mark permanently deleted in tombstone immediately
    markHistoryIdDeleted(item.id);

    const isAbsence =
      item.category === 'Ausencia' ||
      item.action === 'Ausencia' ||
      item.action?.toLowerCase().includes('ausencia') ||
      item.action?.toLowerCase().includes('falta');

    const isLate =
      item.category === 'Llegada tarde' ||
      item.action === 'Llegada tarde' ||
      item.action?.toLowerCase().includes('llegada tarde') ||
      item.action?.toLowerCase().includes('tardanza') ||
      item.action?.toLowerCase().includes('tarde');

    let pointsToReturn = 0;
    if (item.pointsChange !== undefined) {
      pointsToReturn = -item.pointsChange;
    } else if (
      item.previousDisposition !== undefined &&
      item.resultingDisposition !== undefined
    ) {
      pointsToReturn = item.previousDisposition - item.resultingDisposition;
    } else if (
      item.category === 'Disposición' ||
      (!isAbsence && !isLate && item.category !== 'Sistema' && item.category !== 'Calificación')
    ) {
      pointsToReturn = 1;
    }

    // Filter out of history immediately
    const updatedHistory = historyList.filter((h) => h.id !== item.id);
    setHistoryList(updatedHistory);

    // Calculate updated metrics for student directly from remaining history
    const studentRemainingHistory = updatedHistory.filter((h) => h.studentId === item.studentId);
    const newAbsences = studentRemainingHistory.filter(
      (h) =>
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta')
    ).length;

    const newLates = studentRemainingHistory.filter(
      (h) =>
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza')
    ).length;

    let calculatedDisp = 10;
    const sortedStudentEvents = [...studentRemainingHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    for (const ev of sortedStudentEvents) {
      const isReset =
        ev.category === 'Sistema' ||
        ev.action?.toLowerCase().includes('restablecid') ||
        ev.action?.toLowerCase().includes('reinicio');
      if (isReset) {
        calculatedDisp = 10;
        continue;
      }
      if (ev.pointsChange !== undefined) {
        calculatedDisp = Math.min(10, Math.max(0, calculatedDisp + ev.pointsChange));
      } else if (ev.category === 'Disposición') {
        calculatedDisp = Math.max(0, calculatedDisp - 1);
      }
    }

    const itemTerm: '1c' | '2c' = item.term === '2c' ? '2c' : '1c';
    const baseMap = itemTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[item.studentId] || getStudentMetrics(item.studentId, itemTerm);

    const finalAbsences = isAbsence
      ? Math.max(0, (current.totalAbsences !== undefined ? current.totalAbsences : 1) - 1)
      : newAbsences;

    const finalLates = isLate
      ? Math.max(0, (current.totalLates !== undefined ? current.totalLates : 1) - 1)
      : newLates;

    const finalDisposition = (isAbsence || isLate)
      ? (current.totalDisposition ?? 10)
      : (studentRemainingHistory.length > 0 ? calculatedDisp : Math.min(10, Math.max(0, (current.totalDisposition ?? 10) + pointsToReturn)));

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [item.studentId]: {
        ...current,
        totalAbsences: finalAbsences,
        totalLates: finalLates,
        totalDisposition: finalDisposition,
      },
    };

    saveTermDisposition(itemTerm, updatedMap, updatedHistory);

    const actionsTaken: string[] = [];
    if (isAbsence) actionsTaken.push('se restó la ausencia');
    if (isLate) actionsTaken.push('se quitó la tardanza');
    if (pointsToReturn > 0) actionsTaken.push(`se devolvió el punto (+${pointsToReturn} pto: ahora ${finalDisposition}/10)`);
    if (pointsToReturn < 0) actionsTaken.push(`se ajustó la nota (${pointsToReturn} pto: ahora ${finalDisposition}/10)`);

    const actionSummary = actionsTaken.length > 0 ? actionsTaken.join(' y ') : 'Registro eliminado';
    setToastMessage(`Historial actualizado para ${item.studentName || 'el alumno'}: ${actionSummary} (${itemTerm === '2c' ? '2°C' : '1°C'}).`);
    setTimeout(() => setToastMessage(null), 3500);

    // Sync immediately in real time to Google Sheets
    triggerSheetsSync(
      itemTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      itemTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    // Call server to delete and update backend + Firestore
    api
      .deleteDispositionHistory(item.id, {
        studentId: item.studentId,
        isAbsence,
        isLate,
        pointsToReturn,
        newAbsences: finalAbsences,
        newLates: finalLates,
        newDisposition: finalDisposition,
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});
  };

  // 4b. Borrar última falta del estudiante (por ejemplo, si llegó más tarde o fue un error)
  const handleDeleteLatestAbsence = async (student: Student) => {
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
    // Buscar la falta más reciente registrada para este alumno en este curso o en general
    const studentAbsences = historyList
      .filter(
        (h) =>
          h.studentId === student.id &&
          (targetTerm === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
          (h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta'))
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const latestAbsence = studentAbsences[0];

    if (latestAbsence) {
      await handleDeleteHistoryEntry(latestAbsence);
      return;
    }

    // Si no hay en el historial pero el contador tiene ausencias, descontamos manualmente
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || getStudentMetrics(student.id, targetTerm);
    if (current && current.totalAbsences > 0) {
      const finalAbsences = Math.max(0, current.totalAbsences - 1);
      const updatedMap = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalAbsences: finalAbsences,
        },
      };
      saveTermDisposition(targetTerm, updatedMap, historyList);
      triggerSheetsSync(
        targetTerm === '1c' ? updatedMap : dispositionMap,
        historyList,
        targetTerm === '2c' ? updatedMap : dispositionMap2c
      );
      setToastMessage(`Falta eliminada para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`);
      setTimeout(() => setToastMessage(null), 3000);
      if (onRefreshData) onRefreshData();
    } else {
      setToastMessage(`${student.firstName} ${student.lastName} no registra faltas en ${targetTerm === '2c' ? '2°C' : '1°C'} para borrar.`);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // 4b2. Borrar última llegada tarde del estudiante
  const handleDeleteLatestLate = async (student: Student) => {
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
    const studentLates = historyList
      .filter(
        (h) =>
          h.studentId === student.id &&
          (targetTerm === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
          (h.category === 'Llegada tarde' ||
            h.action === 'Llegada tarde' ||
            h.action?.toLowerCase().includes('llegada tarde') ||
            h.action?.toLowerCase().includes('tarde') ||
            h.action?.toLowerCase().includes('tardanza'))
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const latestLate = studentLates[0];

    if (latestLate) {
      await handleDeleteHistoryEntry(latestLate);
      return;
    }

    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || getStudentMetrics(student.id, targetTerm);
    if (current && (current.totalLates || 0) > 0) {
      const finalLates = Math.max(0, (current.totalLates || 0) - 1);
      const updatedMap = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalLates: finalLates,
        },
      };
      saveTermDisposition(targetTerm, updatedMap, historyList);
      triggerSheetsSync(
        targetTerm === '1c' ? updatedMap : dispositionMap,
        historyList,
        targetTerm === '2c' ? updatedMap : dispositionMap2c
      );
      setToastMessage(`Llegada tarde eliminada para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`);
      setTimeout(() => setToastMessage(null), 3000);
      if (onRefreshData) onRefreshData();
    } else {
      setToastMessage(`${student.firstName} ${student.lastName} no registra tardanzas en ${targetTerm === '2c' ? '2°C' : '1°C'} para borrar.`);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // 4c. LÓGICA PARA LLEGADA TARDE (Registra en historial sin descontar puntos, y si tenía falta hoy, la cancela/borra)
  const handleRecordLateArrival = async (student: Student) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const date = formatLocalDateDMY(now);
    const time = formatLocalTimeHMS(now);
    const timestamp = Date.now();
    const id = `rec-late-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';

    // Visual feedback
    setPulsingStudentId(`late-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const current = getStudentMetrics(student.id, targetTerm);

    // 2. Si el mismo día cambio a tarde automáticamente se borra la falta de hoy
    const isTodayAbsence = (h: StudentHistoryItem) => {
      if (h.studentId !== student.id) return false;
      const isAbs =
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta');
      if (!isAbs) return false;
      return isSameCalendarDay(h.date, h.timestamp, now) || !h.date;
    };

    let todayAbsencesToRemove: StudentHistoryItem[] = [];
    let cleanHistory = historyList.filter((h) => {
      if (isTodayAbsence(h)) {
        todayAbsencesToRemove.push(h);
        return false;
      }
      return true;
    });

    // Si no encontró por fecha de hoy pero el alumno tiene faltas registradas, quitar la falta más reciente
    if (todayAbsencesToRemove.length === 0 && current.totalAbsences > 0) {
      const studentAbsences = cleanHistory
        .filter(
          (h) =>
            h.studentId === student.id &&
            (h.category === 'Ausencia' ||
              h.action === 'Ausencia' ||
              h.action?.toLowerCase().includes('ausencia') ||
              h.action?.toLowerCase().includes('falta'))
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (studentAbsences.length > 0) {
        const latestAbs = studentAbsences[0];
        todayAbsencesToRemove.push(latestAbs);
        cleanHistory = cleanHistory.filter((h) => h.id !== latestAbs.id);
      }
    }

    const hadAbsenceToCancel = todayAbsencesToRemove.length > 0 || current.totalAbsences > 0;
    if (todayAbsencesToRemove.length > 0) {
      todayAbsencesToRemove.forEach((a) => markHistoryIdDeleted(a.id));
    }

    // Conteo exacto de ausencias restantes tras eliminar la falta
    const remainingStudentAbsences = Math.max(
      0,
      current.totalAbsences > 0
        ? current.totalAbsences - 1
        : cleanHistory.filter(
            (h) =>
              h.studentId === student.id &&
              (targetTerm === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
              (h.category === 'Ausencia' ||
                h.action === 'Ausencia' ||
                h.action?.toLowerCase().includes('ausencia') ||
                h.action?.toLowerCase().includes('falta'))
          ).length
    );

    const remainingStudentLates = (current.totalLates || 0) + 1;

    // Una asistencia no cambia el puntaje de disposición
    const newDisposition = current.totalDisposition ?? 10;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalAbsences: remainingStudentAbsences,
        totalLates: remainingStudentLates,
        totalDisposition: newDisposition,
      },
    };

    // Entrada en el historial para la llegada tarde
    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: 'Llegada tarde a clase',
      category: 'Llegada tarde',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...cleanHistory]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    if (hadAbsenceToCancel) {
      setToastMessage(`Llegada tarde registrada para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}. Se eliminó automáticamente la falta.`);
    } else {
      setToastMessage(`Llegada tarde registrada para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}.`);
    }
    setTimeout(() => setToastMessage(null), 4000);

    // Sync immediately in real time to Google Sheets
    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    // Eliminar del backend, Firestore (Vercel) y localStorage
    if (todayAbsencesToRemove.length > 0) {
      for (const item of todayAbsencesToRemove) {
        api.deleteDispositionHistory(item.id).catch(() => {});
      }
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.deleteTodayAbsencesForStudent(userId, student.id, now).catch(() => {});
    }

    // Persist to server / Firestore / localStorage with expectedSummary
    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: 'Llegada tarde a clase',
        category: 'Llegada tarde',
        date,
        time,
        timestamp,
        expectedSummary: {
          totalAbsences: remainingStudentAbsences,
          totalLates: remainingStudentLates,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});
  };

  // Helper to open notification modal from history tables (both for absences and disposition)
  const handleOpenNotifyModal = (item: StudentHistoryItem, student: Student | null) => {
    const isDisposition = item.category === 'Disposición';
    let text = '';
    let selectedPresetId = '';
    const curDisp = dispositionMap[item.studentId]?.totalDisposition ?? 10;
    const studentObj = student || { firstName: item.studentName, lastName: '', id: item.studentId };

    if (isDisposition) {
      const specificReasonTemplate = getTemplateForReason(item.action);
      selectedPresetId = `reason-${item.action}`;
      text = formatTemplateForStudent(
        specificReasonTemplate,
        studentObj,
        activeCourse.name,
        curDisp,
        item.date,
        item.action
      );
    } else {
      const activePreset =
        savedPresets.find((p) => (p.category === 'Ausencia' || !p.category) && p.isDefault) ||
        savedPresets.find((p) => p.category === 'Ausencia' || !p.category) ||
        DEFAULT_ABSENCE_PRESETS[0];
      selectedPresetId = activePreset.id;
      text = formatTemplateForStudent(
        activePreset.text,
        studentObj,
        activeCourse.name,
        curDisp,
        item.date
      );
    }

    setAbsenceNotifModal({
      isOpen: true,
      historyItem: item,
      student: student || null,
      channel: notifSettings.channel,
      messageText: text,
      selectedPresetId,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
    });
  };

  // 5. Copiar al portapapeles en formato Google Sheets (TSV: Alumno \t Fecha \t Hora \t Acción)
  const handleCopyForGoogleSheets = () => {
    const courseHistory = historyList.filter((h) => h.courseId === activeCourse?.id);
    if (courseHistory.length === 0) {
      alert('Aún no hay registros en el historial de este curso para copiar.');
      return;
    }

    // Sort matching the script: Alumno asc, Fecha desc, Hora desc
    const sorted = [...courseHistory].sort((a, b) => {
      const nameComp = a.studentName.localeCompare(b.studentName);
      if (nameComp !== 0) return nameComp;
      return b.timestamp - a.timestamp;
    });

    const lines = [
      ['Alumno', 'Fecha', 'Hora', 'Acción'].join('\t'),
      ...sorted.map((item) => [item.studentName, item.date, item.time, item.action].join('\t')),
    ];

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setToastMessage('¡Copiado al portapapeles! Ahora ve a tu Google Sheet y presiona Ctrl + V.');
      setTimeout(() => setToastMessage(null), 4500);
    });
  };

  // 6. Exportar CSV compatible con Excel y Google Sheets
  const handleExportHistoryCsv = () => {
    const courseHistory = historyList.filter((h) => h.courseId === activeCourse?.id);
    const sorted = [...courseHistory].sort((a, b) => b.timestamp - a.timestamp);

    const headers = ['Alumno', 'Fecha', 'Hora', 'Acción', 'Categoría'];
    const rows = sorted.map((h) => [
      `"${h.studentName}"`,
      `"${h.date}"`,
      `"${h.time}"`,
      `"${h.action.replace(/"/g, '""')}"`,
      `"${h.category}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Historial_Asistencia_Disposicion_${activeCourse.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 6b. Exportar Historial a Excel (.xlsx) nativo
  const handleExportHistoryExcel = () => {
    if (!activeCourse) return;
    const courseHistory = historyList.filter((h) => h.courseId === activeCourse.id);
    exportCourseClassHistoryToExcel(activeCourse.name, courseHistory);
  };

  // 7a. Abrir modal para editar manualmente la nota de disposición (por ej. si usó papel o no trajo computadora)
  const handleOpenEditDisposition = (student: Student, termOverride?: '1c' | '2c') => {
    const termToUse: '1c' | '2c' = termOverride || (attendanceTerm === '2c' ? '2c' : '1c');
    const currentMetrics = getStudentMetrics(student.id, termToUse);
    setEditingDispositionStudent(student);
    setEditingDispositionTerm(termToUse);
    setEditingDispositionScore(String(currentMetrics.totalDisposition));
    setEditingDispositionReason('');
  };

  const handleChangeEditingTerm = (newTerm: '1c' | '2c') => {
    setEditingDispositionTerm(newTerm);
    if (editingDispositionStudent) {
      const metrics = getStudentMetrics(editingDispositionStudent.id, newTerm);
      setEditingDispositionScore(String(metrics.totalDisposition));
    }
  };

  const handleNavigateEditStudent = (direction: -1 | 1) => {
    if (!editingDispositionStudent) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      const targetStudent = filteredStudents[targetIndex];
      const metrics = getStudentMetrics(targetStudent.id, editingDispositionTerm);
      setEditingDispositionStudent(targetStudent);
      setEditingDispositionScore(String(metrics.totalDisposition));
      setEditingDispositionReason('');
    }
  };

  const handleSaveStudentDisposition = async (moveToNext: boolean = false) => {
    if (!activeCourse || !editingDispositionStudent) return;

    const student = editingDispositionStudent;
    const term = editingDispositionTerm;
    const parsed = parseFloat(editingDispositionScore);
    if (isNaN(parsed) || parsed < 0 || parsed > 10) {
      setToastMessage('Ingresá una nota numérica válida entre 0 y 10.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const clampedScore = Math.min(10, Math.max(0, Math.round(parsed * 10) / 10));

    const baseMap = term === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    const oldScore = current.totalDisposition ?? 10;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: clampedScore,
      },
    };

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const studentFullName = `${student.lastName}, ${student.firstName}`;

    const termLabel = term === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
    const reasonTrimmed = editingDispositionReason.trim();
    const actionText = reasonTrimmed
      ? `Nota de disposición ajustada a ${clampedScore}/10 (${termLabel}) - Motivo: ${reasonTrimmed}`
      : `Nota de disposición ajustada a ${clampedScore}/10 (${termLabel})`;

    const editEntry: StudentHistoryItem = {
      id: `rec-disp-edit-${student.id}-${timestamp}`,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term,
      action: actionText,
      category: 'Disposición',
      pointsChange: Number((clampedScore - oldScore).toFixed(1)),
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([editEntry, ...historyList]);
    setHistoryList(updatedHistory);
    saveTermDisposition(term, updatedMap, updatedHistory);

    triggerSheetsSync(
      term === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      term === '2c' ? updatedMap : dispositionMap2c
    );

    api
      .recordDisposition({
        id: editEntry.id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: actionText,
        category: 'Disposición',
        term,
        date,
        time,
        timestamp,
        expectedSummary: {
          totalAbsences: current.totalAbsences ?? 0,
          totalLates: current.totalLates ?? 0,
          totalDisposition: clampedScore,
        },
      })
      .catch(() => {});

    setToastMessage(
      `Nota de disposición guardada: ${clampedScore}/10 para ${student.lastName}, ${student.firstName} (${term === '2c' ? '2°C' : '1°C'})`
    );
    setTimeout(() => setToastMessage(null), 3500);

    if (moveToNext) {
      const currentIndex = filteredStudents.findIndex((s) => s.id === student.id);
      if (currentIndex !== -1 && currentIndex < filteredStudents.length - 1) {
        const nextStudent = filteredStudents[currentIndex + 1];
        const nextMetrics = getStudentMetrics(nextStudent.id, term);
        setEditingDispositionStudent(nextStudent);
        setEditingDispositionScore(String(nextMetrics.totalDisposition));
        setEditingDispositionReason('');
        return;
      }
    }

    setEditingDispositionStudent(null);
  };

  // 7b. Abrir modal para editar la cantidad de faltas (pasaje de papel, fecha retroactiva y aviso)
  const handleOpenEditAbsences = (student: Student, termOverride?: '1c' | '2c') => {
    const termToUse: '1c' | '2c' = termOverride || (attendanceTerm === '2c' ? '2c' : '1c');
    const currentMetrics = getStudentMetrics(student.id, termToUse);
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const formattedDateDMY = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;

    setEditingAbsenceStudent(student);
    setEditingAbsenceTerm(termToUse);
    setEditingAbsenceCount(String(currentMetrics.totalAbsences));
    setEditingAbsenceDate(todayStr);
    setEditingAbsenceReason('Pasado de planilla en papel');
    setEditingAbsenceSendNotif(false);
    setEditingAbsenceChannel(notifSettings.channel || 'classroom');

    const curDisp = currentMetrics.totalDisposition ?? 10;
    const defaultAbsenceTpl =
      savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
      notifSettings.templateClassroom ||
      DEFAULT_ABSENCE_PRESETS[0].text;

    const defaultMsg = formatTemplateForStudent(
      defaultAbsenceTpl,
      student,
      activeCourse.name,
      curDisp,
      formattedDateDMY
    );
    setEditingAbsenceMessageText(defaultMsg);
  };

  const handleChangeEditingAbsenceTerm = (newTerm: '1c' | '2c') => {
    setEditingAbsenceTerm(newTerm);
    if (editingAbsenceStudent) {
      const metrics = getStudentMetrics(editingAbsenceStudent.id, newTerm);
      setEditingAbsenceCount(String(metrics.totalAbsences));
    }
  };

  const handleNavigateEditAbsenceStudent = (direction: -1 | 1) => {
    if (!editingAbsenceStudent) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === editingAbsenceStudent.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      const targetStudent = filteredStudents[targetIndex];
      const metrics = getStudentMetrics(targetStudent.id, editingAbsenceTerm);
      setEditingAbsenceStudent(targetStudent);
      setEditingAbsenceCount(String(metrics.totalAbsences));

      let dmy = '';
      if (editingAbsenceDate) {
        const parts = editingAbsenceDate.split('-');
        if (parts.length === 3) {
          dmy = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
      }
      const defaultAbsenceTpl =
        savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
        notifSettings.templateClassroom ||
        DEFAULT_ABSENCE_PRESETS[0].text;
      const defaultMsg = formatTemplateForStudent(
        defaultAbsenceTpl,
        targetStudent,
        activeCourse.name,
        metrics.totalDisposition ?? 10,
        dmy || formatLocalDateDMY()
      );
      setEditingAbsenceMessageText(defaultMsg);
    }
  };

  const handleSaveStudentAbsences = async (moveToNext: boolean = false) => {
    if (!activeCourse || !editingAbsenceStudent) return;

    const student = editingAbsenceStudent;
    const term = editingAbsenceTerm;
    const parsed = parseInt(editingAbsenceCount, 10);
    if (isNaN(parsed) || parsed < 0) {
      setToastMessage('Ingresá una cantidad de faltas válida (número entero mayor o igual a 0).');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const finalAbsences = Math.max(0, Math.floor(parsed));

    const baseMap = term === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || getStudentMetrics(student.id, term);
    const oldAbsences = current.totalAbsences ?? 0;
    const difference = finalAbsences - oldAbsences;

    // Parse user selected date (YYYY-MM-DD -> DD/MM/YYYY)
    let selectedDateDMY = formatLocalDateDMY();
    let recordTimestamp = Date.now();
    if (editingAbsenceDate) {
      const parts = editingAbsenceDate.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const pad = (n: number) => n.toString().padStart(2, '0');
        selectedDateDMY = `${pad(d)}/${pad(m)}/${y}`;
        const targetDateObj = new Date(y, m - 1, d, 12, 0, 0);
        if (!isNaN(targetDateObj.getTime())) {
          recordTimestamp = targetDateObj.getTime();
        }
      }
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const termLabel = term === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
    const reasonTrimmed = editingAbsenceReason.trim();

    setIsSavingAbsenceEdit(true);

    try {
      // 1. Update disposition map directly with edited count
      const updatedMap: Record<string, StudentDispositionData> = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalAbsences: finalAbsences,
        },
      };

      // 2. Generate history entry reflecting the manual update and retroactive date
      let newHistoryEntry: StudentHistoryItem | null = null;
      let newHistoryEntries: StudentHistoryItem[] = [];

      if (difference !== 0 || editingAbsenceSendNotif) {
        const actionText = difference > 0
          ? `Inasistencia asentada en fecha ${selectedDateDMY} (+${difference} ${difference === 1 ? 'falta' : 'faltas'} • Total: ${finalAbsences})`
          : difference < 0
          ? `Faltas ajustadas a ${finalAbsences} (descuento de ${Math.abs(difference)} en fecha ${selectedDateDMY})`
          : `Inasistencia registrada en fecha ${selectedDateDMY} (Total: ${finalAbsences} faltas)`;

        const fullActionDesc = reasonTrimmed
          ? `${actionText} - ${reasonTrimmed}`
          : actionText;

        newHistoryEntry = {
          id: `rec-abs-edit-${student.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          studentId: student.id,
          studentName: studentFullName,
          courseId: activeCourse.id,
          date: selectedDateDMY,
          time,
          term,
          action: fullActionDesc,
          category: 'Ausencia',
          pointsChange: 0,
          timestamp: recordTimestamp,
          messageSent: false,
          messageText: '',
          notificationMethod: 'none',
        };
        newHistoryEntries.push(newHistoryEntry);
      }

      // If user reduced absences, purge oldest non-notified absences for student if appropriate
      let updatedHistory = deduplicateHistory([...newHistoryEntries, ...historyList]);
      if (difference < 0) {
        const toRemoveCount = Math.abs(difference);
        let removed = 0;
        updatedHistory = updatedHistory.filter((h) => {
          if (
            removed < toRemoveCount &&
            h.studentId === student.id &&
            (term === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
            (h.category === 'Ausencia' || h.action?.toLowerCase().includes('ausencia') || h.action?.toLowerCase().includes('falta')) &&
            !newHistoryEntries.some(ne => ne.id === h.id)
          ) {
            markHistoryIdDeleted(h.id);
            api.deleteDispositionHistory(h.id).catch(() => {});
            removed++;
            return false;
          }
          return true;
        });
      }

      // 3. Optional message notification sending (even if not recorded the same day)
      if (editingAbsenceSendNotif && editingAbsenceMessageText.trim() && newHistoryEntry) {
        const channel = editingAbsenceChannel;
        const msgText = editingAbsenceMessageText.trim();
        let notifSuccess = false;

        if (channel === 'classroom') {
          const classroomCourseId = activeCourse.classroomCourseId || activeCourse.id;
          const res = await classroomService.createIndividualAnnouncement(
            classroomCourseId,
            student.id,
            msgText
          );
          notifSuccess = res.success;
        } else {
          const emailSubject = `Notificación de Inasistencia - ${activeCourse.name} (${selectedDateDMY})`;
          const res = await gmailService.sendEmail(
            student.email || '',
            emailSubject,
            msgText
          );
          notifSuccess = res.success;
        }

        const notifiedAt = new Date().toLocaleTimeString();
        newHistoryEntry.messageSent = true;
        newHistoryEntry.messageText = msgText;
        newHistoryEntry.notificationMethod = channel;
        newHistoryEntry.notifiedAt = notifiedAt;

        // Update in history list
        updatedHistory = updatedHistory.map((item) =>
          item.id === newHistoryEntry!.id
            ? {
                ...item,
                messageSent: true,
                messageText: msgText,
                notificationMethod: channel,
                notifiedAt,
              }
            : item
        );
      }

      setHistoryList(updatedHistory);
      saveTermDisposition(term, updatedMap, updatedHistory);

      triggerSheetsSync(
        term === '1c' ? updatedMap : dispositionMap,
        updatedHistory,
        term === '2c' ? updatedMap : dispositionMap2c
      );

      // Persist to API / backend
      if (newHistoryEntry) {
        api
          .recordDisposition({
            id: newHistoryEntry.id,
            studentId: student.id,
            studentName: studentFullName,
            courseId: activeCourse.id,
            action: newHistoryEntry.action,
            category: 'Ausencia',
            term,
            date: selectedDateDMY,
            time,
            timestamp: recordTimestamp,
            messageSent: newHistoryEntry.messageSent,
            messageText: newHistoryEntry.messageText,
            notificationMethod: newHistoryEntry.notificationMethod,
            notifiedAt: newHistoryEntry.notifiedAt,
            expectedSummary: {
              totalAbsences: finalAbsences,
              totalLates: current.totalLates ?? 0,
              totalDisposition: current.totalDisposition ?? 10,
            },
          })
          .catch(() => {});
      }

      const notifMsgPart = editingAbsenceSendNotif
        ? ` y aviso enviado por ${editingAbsenceChannel === 'classroom' ? 'Classroom' : 'Gmail'}`
        : '';
      setToastMessage(
        `Faltas actualizadas: ${finalAbsences} para ${student.lastName}, ${student.firstName} (fecha: ${selectedDateDMY} en ${term === '2c' ? '2°C' : '1°C'})${notifMsgPart}.`
      );
      setTimeout(() => setToastMessage(null), 4000);

      if (moveToNext) {
        const currentIndex = filteredStudents.findIndex((s) => s.id === student.id);
        if (currentIndex !== -1 && currentIndex < filteredStudents.length - 1) {
          const nextStudent = filteredStudents[currentIndex + 1];
          const nextMetrics = getStudentMetrics(nextStudent.id, term);
          setEditingAbsenceStudent(nextStudent);
          setEditingAbsenceCount(String(nextMetrics.totalAbsences));

          const defaultAbsenceTpl =
            savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
            notifSettings.templateClassroom ||
            DEFAULT_ABSENCE_PRESETS[0].text;
          const defaultMsg = formatTemplateForStudent(
            defaultAbsenceTpl,
            nextStudent,
            activeCourse.name,
            nextMetrics.totalDisposition ?? 10,
            selectedDateDMY
          );
          setEditingAbsenceMessageText(defaultMsg);
          return;
        }
      }

      setEditingAbsenceStudent(null);
    } catch (err: any) {
      setToastMessage(`Error al guardar: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setIsSavingAbsenceEdit(false);
    }
  };

  // -------------------------------------------------------------
  // CARGA MANUAL DE ALUMNOS (CON CORREO) Y MENSAJES DIRECTOS
  // -------------------------------------------------------------
  const handleOpenAddStudentModal = () => {
    setAddStudentFirstName('');
    setAddStudentLastName('');
    setAddStudentEmail('');
    setAddStudentPhone('');
    setAddStudentNotes('');
    setAddStudentTab('single');
    setBatchStudentsText('');
    setIsAddStudentModalOpen(true);
  };

  const handleSaveSingleStudent = async (addAnother: boolean = false) => {
    if (!activeCourse) return;
    const firstName = addStudentFirstName.trim();
    const lastName = addStudentLastName.trim();
    const email = addStudentEmail.trim();

    if (!firstName || !lastName) {
      setToastMessage('Por favor, ingresá el nombre y apellido del estudiante.');
      setTimeout(() => setToastMessage(null), 3500);
      return;
    }

    setIsSavingManualStudent(true);
    try {
      await api.createStudent({
        courseId: activeCourse.id,
        firstName,
        lastName,
        email: email || undefined,
      });

      // Notify listeners and reload data
      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();

      setToastMessage(`Alumno/a "${lastName}, ${firstName}" agregado con éxito.`);
      setTimeout(() => setToastMessage(null), 4000);

      if (addAnother) {
        setAddStudentFirstName('');
        setAddStudentLastName('');
        setAddStudentEmail('');
        setAddStudentPhone('');
        setAddStudentNotes('');
      } else {
        setIsAddStudentModalOpen(false);
      }
    } catch (err: any) {
      setToastMessage(`Error al guardar estudiante: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingManualStudent(false);
    }
  };

  const handleSaveBatchStudents = async () => {
    if (!activeCourse || !batchStudentsText.trim()) return;
    setIsSavingManualStudent(true);
    try {
      const lines = batchStudentsText.split('\n').map((l) => l.trim()).filter(Boolean);
      const parsed: Array<{ firstName: string; lastName: string; email?: string }> = [];

      for (const line of lines) {
        if (line.includes(',')) {
          const parts = line.split(',').map((p) => p.trim());
          if (parts.length >= 2) {
            const lastName = parts[0];
            const firstName = parts[1];
            const email = parts[2] || '';
            parsed.push({ firstName, lastName, email: email || undefined });
            continue;
          }
        }

        const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const email = emailMatch ? emailMatch[1] : '';
        const namePart = line.replace(email, '').trim().replace(/[,;\t]/g, ' ').replace(/\s+/g, ' ');
        const words = namePart.split(' ').filter(Boolean);
        if (words.length >= 2) {
          parsed.push({
            lastName: words[0],
            firstName: words.slice(1).join(' '),
            email: email || undefined,
          });
        } else if (words.length === 1) {
          parsed.push({
            lastName: words[0],
            firstName: 'Alumno',
            email: email || undefined,
          });
        }
      }

      if (parsed.length === 0) {
        setToastMessage('No se detectaron alumnos. Formato sugerido: Apellido, Nombre, correo@ejemplo.com');
        setTimeout(() => setToastMessage(null), 4000);
        setIsSavingManualStudent(false);
        return;
      }

      for (const item of parsed) {
        await api.createStudent({
          courseId: activeCourse.id,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
        });
      }

      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();

      setToastMessage(`¡Éxito! Se agregaron ${parsed.length} alumnos a ${activeCourse.name}.`);
      setTimeout(() => setToastMessage(null), 4500);
      setIsAddStudentModalOpen(false);
      setBatchStudentsText('');
    } catch (err: any) {
      setToastMessage(`Error al guardar lote: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingManualStudent(false);
    }
  };

  const handleOpenDirectMessageModal = (student: Student) => {
    const defaultSubject = `Comunicado de ${activeCourse.name}`;
    const defaultMsg = `Estimado/a ${student.firstName},\n\nNos comunicamos desde la materia ${activeCourse.name}.\n\nSaludos cordiales.`;
    setDirectMessageModal({
      isOpen: true,
      student,
      subject: defaultSubject,
      messageText: defaultMsg,
      channel: student.email ? 'gmail' : 'classroom',
      isSending: false,
    });
  };

  const handleSendDirectMessage = async () => {
    if (!directMessageModal.student || !directMessageModal.messageText.trim()) return;
    const { student, subject, messageText, channel } = directMessageModal;

    setDirectMessageModal((prev) => ({ ...prev, isSending: true }));
    try {
      if (channel === 'gmail') {
        if (!student.email) {
          throw new Error('El estudiante no tiene correo electrónico cargado.');
        }
        const res = await gmailService.sendEmail(student.email, subject, messageText);
        if (!res.success) {
          // Fallback to mailto link
          window.open(
            `mailto:${encodeURIComponent(student.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageText)}`
          );
        }
      } else if (channel === 'classroom') {
        const cid = activeCourse.classroomCourseId || activeCourse.id;
        await classroomService.createIndividualAnnouncement(cid, student.id, messageText);
      } else if (channel === 'whatsapp') {
        const phone = (student as any).phone ? (student as any).phone.replace(/[^0-9]/g, '') : '';
        const waUrl = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`
          : `https://wa.me/?text=${encodeURIComponent(messageText)}`;
        window.open(waUrl, '_blank');
      }

      // Log in permanent history
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const newHistoryItem: StudentHistoryItem = {
        id: `msg-${student.id}-${Date.now()}`,
        studentId: student.id,
        studentName: `${student.lastName}, ${student.firstName}`,
        courseId: activeCourse.id,
        date: formatLocalDateDMY(),
        time: timeStr,
        term: attendanceTerm === '2c' ? '2c' : '1c',
        action: `Mensaje directo enviado: "${subject}"`,
        category: 'Disposición',
        pointsChange: 0,
        timestamp: Date.now(),
        messageSent: true,
        messageText,
        notificationMethod: channel,
        notifiedAt: timeStr,
      };

      const updated = deduplicateHistory([newHistoryItem, ...historyList]);
      setHistoryList(updated);
      saveTermDisposition(
        attendanceTerm === '2c' ? '2c' : '1c',
        attendanceTerm === '2c' ? dispositionMap2c : dispositionMap,
        updated
      );
      api.recordDisposition({
        id: newHistoryItem.id,
        studentId: student.id,
        studentName: newHistoryItem.studentName,
        courseId: activeCourse.id,
        action: newHistoryItem.action,
        category: 'Disposición',
        term: newHistoryItem.term,
        date: newHistoryItem.date,
        time: newHistoryItem.time,
        timestamp: newHistoryItem.timestamp,
        messageSent: true,
        messageText,
        notificationMethod: channel,
        notifiedAt: newHistoryItem.notifiedAt,
      }).catch(() => {});

      setToastMessage(`Mensaje enviado a ${student.firstName} ${student.lastName} correctamente.`);
      setTimeout(() => setToastMessage(null), 4000);
      setDirectMessageModal((prev) => ({ ...prev, isOpen: false, isSending: false }));
    } catch (err: any) {
      setToastMessage(`Error al enviar mensaje: ${err?.message || 'intente de nuevo'}`);
      setTimeout(() => setToastMessage(null), 4000);
      setDirectMessageModal((prev) => ({ ...prev, isSending: false }));
    }
  };

  const handleSaveEditedStudentEmail = async () => {
    if (!selectedStudentForProfile || !editedStudentEmail.trim()) return;
    try {
      const emailTrimmed = editedStudentEmail.trim();
      await api.updateStudent(selectedStudentForProfile.id, activeCourse.id, {
        email: emailTrimmed,
      });
      setSelectedStudentForProfile({
        ...selectedStudentForProfile,
        email: emailTrimmed,
      });
      setIsEditingStudentEmail(false);
      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();
      setToastMessage(`Correo actualizado para ${selectedStudentForProfile.firstName}: ${emailTrimmed}`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      setToastMessage(`Error al actualizar correo: ${err?.message || 'intente de nuevo'}`);
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  // -------------------------------------------------------------
  // OBSERVACIONES Y FICHA DEL ESTUDIANTE (NOTAS / INFORMES)
  // -------------------------------------------------------------
  const handleOpenStudentProfile = (student: Student) => {
    setSelectedStudentForProfile(student);
    setNewObservationText('');
    setNewObservationUrl('');
  };

  const handleNavigateProfileStudent = (direction: -1 | 1) => {
    if (!selectedStudentForProfile) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === selectedStudentForProfile.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      setSelectedStudentForProfile(filteredStudents[targetIndex]);
      setNewObservationText('');
      setNewObservationUrl('');
    }
  };

  const handleSaveObservation = (student: Student) => {
    if (!newObservationText.trim() && !newObservationUrl.trim()) {
      setToastMessage('Escribí una observación o pegá un enlace al informe.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    let formattedUrl = newObservationUrl.trim();
    if (formattedUrl && !formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const newObs: StudentObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      studentId: student.id,
      courseId: activeCourse?.id || '',
      text: newObservationText.trim(),
      reportUrl: formattedUrl || undefined,
      date,
      timestamp: Date.now(),
    };

    const currentList = studentObservations[student.id] || [];
    const updatedList = [newObs, ...currentList];
    const updatedMap = {
      ...studentObservations,
      [student.id]: updatedList,
    };

    setStudentObservations(updatedMap);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          localStorage.setItem(`fds_student_observations_${activeCourse.id}`, JSON.stringify(updatedMap));
        }
      } catch (_) {}
    }

    setNewObservationText('');
    setNewObservationUrl('');
    setToastMessage(`Observación guardada para ${student.lastName}, ${student.firstName}`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDeleteObservation = (studentId: string, obsId: string) => {
    const currentList = studentObservations[studentId] || [];
    const updatedList = currentList.filter((o) => o.id !== obsId);
    const updatedMap = {
      ...studentObservations,
      [studentId]: updatedList,
    };

    setStudentObservations(updatedMap);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          localStorage.setItem(`fds_student_observations_${activeCourse.id}`, JSON.stringify(updatedMap));
        }
      } catch (_) {}
    }

    setToastMessage('Observación eliminada.');
    setTimeout(() => setToastMessage(null), 2500);
  };

  // 7b. Reiniciar / Borrar disposición por alumno individual
  const handleResetSingleStudentDisposition = async (student: Student, clearHistory: boolean = false) => {
    if (!activeCourse || !student) return;
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: 10,
      },
    };

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const studentFullName = `${student.lastName}, ${student.firstName}`;

    let updatedHistory = [...historyList];
    if (clearHistory) {
      const removedIds: string[] = [];
      updatedHistory = updatedHistory.filter((h) => {
        const isTarget =
          h.studentId === student.id &&
          (targetTerm === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
          (h.category === 'Disposición' || (h.pointsChange !== undefined && h.pointsChange < 0));
        if (isTarget) {
          removedIds.push(h.id);
          return false;
        }
        return true;
      });
      removedIds.forEach((id) => markHistoryIdDeleted(id));
    }

    const resetEntry: StudentHistoryItem = {
      id: `rec-reset-${student.id}-${timestamp}`,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: clearHistory
        ? `Disposición borrada y restablecida a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`
        : `Puntaje de disposición restablecido a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`,
      category: 'Sistema',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    updatedHistory = deduplicateHistory([resetEntry, ...updatedHistory]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    api
      .resetDisposition({
        studentId: student.id,
        courseId: activeCourse.id,
        resetWhat: 'disposition',
        clearHistory,
      })
      .catch(() => {});

    setToastMessage(
      clearHistory
        ? `Disposición restablecida a 10 para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}). Anotaciones de conducta limpiadas.`
        : `Disposición restablecida a 10 para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`
    );
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 7b. Reiniciar puntajes (Inicio de nuevo trimestre o para toda la clase)
  const handleResetCourseDisposition = (clearHistory: boolean = false) => {
    if (!activeCourse) return;
    const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const updated: Record<string, StudentDispositionData> = { ...baseMap };
    courseStudents.forEach((st) => {
      const current = updated[st.id] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
      updated[st.id] = {
        ...current,
        totalDisposition: 10,
      };
    });

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();

    let updatedHistory = [...historyList];
    if (clearHistory) {
      const removedIds: string[] = [];
      updatedHistory = updatedHistory.filter((h) => {
        const isTarget =
          h.courseId === activeCourse.id &&
          (targetTerm === '2c' ? h.term === '2c' : (h.term === '1c' || !h.term)) &&
          (h.category === 'Disposición' || (h.pointsChange !== undefined && h.pointsChange < 0));
        if (isTarget) {
          removedIds.push(h.id);
          return false;
        }
        return true;
      });
      removedIds.forEach((id) => markHistoryIdDeleted(id));
    }

    const resetEntry: StudentHistoryItem = {
      id: `rec-reset-${timestamp}`,
      studentId: 'all',
      studentName: 'Toda la clase',
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: clearHistory
        ? `Reinicio general de disposición a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`
        : `Reinicio general de puntaje de disposición a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`,
      category: 'Sistema',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };
    const updatedHistoryDedup = deduplicateHistory([resetEntry, ...updatedHistory]);
    setHistoryList(updatedHistoryDedup);
    saveTermDisposition(targetTerm, updated, updatedHistoryDedup);

    setToastMessage(
      clearHistory
        ? `Disposición restablecida a 10 para todos los estudiantes en ${targetTerm === '2c' ? '2°C' : '1°C'}.`
        : `Puntaje de disposición reiniciado a 10 en ${targetTerm === '2c' ? '2°C' : '1°C'}.`
    );
    setTimeout(() => setToastMessage(null), 3500);

    triggerSheetsSync(
      targetTerm === '1c' ? updated : dispositionMap,
      updatedHistoryDedup,
      targetTerm === '2c' ? updated : dispositionMap2c
    );
    api.resetDisposition({ courseId: activeCourse.id, resetWhat: 'disposition', clearHistory }).catch(() => {});
  };

  // Mandar la nota de disposición calculada (1 a 10) de todos los alumnos a Calificaciones
  // Se envía automáticamente al cuatrimestre seleccionado en la planilla (1° Cuatrimestre o 2° Cuatrimestre)
  const handleSendDispositionToGrades = (
    targetTermOverride?: '1c' | '2c',
    shouldNavigateToGrades = false
  ) => {
    if (!activeCourse) return;
    const term: '1c' | '2c' = targetTermOverride || (attendanceTerm === '2c' ? '2c' : '1c');
    const courseId = activeCourse.id;

    const catKey = `fds_grades_categories_${courseId}_${term}`;
    const gradesKey = `fds_grades_data_${courseId}_${term}`;

    // 1. Obtener o inicializar las categorías del cuatrimestre destino
    let categories: GradeCategory[] = [];
    try {
      const saved =
        localStorage.getItem(catKey) ||
        (term === '1c' ? localStorage.getItem(`fds_grades_categories_${courseId}`) : null);
      if (saved) {
        categories = JSON.parse(saved);
      }
    } catch (_) {}

    if (!Array.isArray(categories) || categories.length === 0) {
      categories =
        term === '2c'
          ? DEFAULT_CATEGORIES.map((cat) => ({
              ...cat,
              id: `c2-${cat.id}`,
              subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
            }))
          : DEFAULT_CATEGORIES.map((cat) => ({
              ...cat,
              subcategories: cat.subcategories.map((sub) => ({ ...sub })),
            }));
    }

    // 2. Buscar si ya existe una subcategoría de Disposición o Conducta
    let targetSubId: string | null = null;

    for (const cat of categories) {
      const foundSub = cat.subcategories?.find((s) => {
        const lower = s.name.toLowerCase();
        return (
          lower.includes('disposición') ||
          lower.includes('disposicion') ||
          lower.includes('conducta')
        );
      });
      if (foundSub) {
        targetSubId = foundSub.id;
        break;
      }
    }

    // 3. Si no existe, crear la columna "Nota de Disposición"
    if (!targetSubId) {
      let parentCat = categories.find((c) => {
        const lower = c.name.toLowerCase();
        return (
          lower.includes('desempeño') ||
          lower.includes('desempeno') ||
          lower.includes('participación') ||
          lower.includes('participacion') ||
          lower.includes('tareas')
        );
      });

      if (!parentCat && categories.length > 0) {
        parentCat = categories[categories.length - 1];
      }

      const newSubId = `sub-disp-${term}-${Date.now()}`;
      const newSub: GradeSubcategory = {
        id: newSubId,
        name: 'Nota de Disposición',
        maxScore: 10,
        date: new Date().toLocaleDateString('es-AR'),
      };

      if (parentCat) {
        if (!parentCat.subcategories) parentCat.subcategories = [];
        parentCat.subcategories.push(newSub);
      } else {
        const newCat: GradeCategory = {
          id: `cat-disp-${term}-${Date.now()}`,
          name: 'Desempeño y Conducta',
          color: 'bg-purple-500',
          subcategories: [newSub],
        };
        categories.push(newCat);
      }
      targetSubId = newSubId;

      // Guardar categorías actualizadas
      if (typeof window !== 'undefined') {
        localStorage.setItem(catKey, JSON.stringify(categories));
        if (term === '1c') {
          localStorage.setItem(`fds_grades_categories_${courseId}`, JSON.stringify(categories));
        }
      }
    }

    // 4. Obtener o inicializar las calificaciones del cuatrimestre
    let gradesMap: StudentGradesMap = {};
    try {
      const savedGrades =
        localStorage.getItem(gradesKey) ||
        (term === '1c' ? localStorage.getItem(`fds_grades_data_${courseId}`) : null);
      if (savedGrades) {
        gradesMap = JSON.parse(savedGrades);
      }
    } catch (_) {}

    // 5. Asignar la nota de disposición de cada alumno calculada para este cuatrimestre
    let transferredCount = 0;
    courseStudents.forEach((st) => {
      const metrics = getStudentMetrics(st.id, term);
      const score = String(metrics.totalDisposition);
      if (!gradesMap[st.id]) {
        gradesMap[st.id] = {};
      }
      gradesMap[st.id][targetSubId!] = score;
      transferredCount++;
    });

    // Guardar calificaciones actualizadas en localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(gradesKey, JSON.stringify(gradesMap));
      if (term === '1c') {
        localStorage.setItem(`fds_grades_data_${courseId}`, JSON.stringify(gradesMap));
      }
      localStorage.setItem(`fds_grades_active_term_${courseId}`, term);
      window.dispatchEvent(
        new CustomEvent('fds-grades-updated', {
          detail: { term, courseId },
        })
      );
    }

    const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const gradesEntry: StudentHistoryItem = {
      id: `rec-grades-${timestamp}`,
      studentId: 'all',
      studentName: 'Toda la clase',
      courseId: activeCourse.id,
      term,
      date,
      time,
      action: `Notas de disposición enviadas a Calificaciones (${termLabel})`,
      category: 'Calificación',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };
    const updatedHistory = deduplicateHistory([gradesEntry, ...historyList]);
    setHistoryList(updatedHistory);

    // 1. Registrar inmediatamente el evento en el Historial de Google Sheets
    triggerSheetsSync(
      term === '1c' ? dispositionMap : undefined,
      updatedHistory,
      term === '2c' ? dispositionMap2c : undefined
    );

    // 2. Guardar y sincronizar la matriz completa de Calificaciones del cuatrimestre en Google Sheets
    sheetsService
      .syncGradebookMatrixToSheet(
        activeCourse,
        term,
        courseStudents,
        categories,
        gradesMap,
        sheetConfig?.spreadsheetId || activeCourse.gradesSheetId,
        activeCourse.gradesFolderId,
        token || getCachedAccessToken() || undefined
      )
      .catch((err) => {
        console.warn('Could not auto-sync gradebook matrix to Google Sheets:', err);
      });

    // 3. Guardar snapshot del cierre de cuatrimestre en Firestore para respaldo permanente
    const currentUserId = getActiveUserId();
    if (currentUserId) {
      firestoreSync
        .saveTermSnapshot(currentUserId, courseId, term, {
          courseId,
          term,
          termLabel,
          categories,
          gradesMap,
          dispositionMap: term === '2c' ? dispositionMap2c : dispositionMap,
          transferredCount,
          date,
          time,
        })
        .catch(() => {});
    }

    // 4. Persistir registro en backend / Firestore / localStorage
    api
      .recordDisposition({
        id: gradesEntry.id,
        studentId: 'all',
        studentName: 'Toda la clase',
        courseId: activeCourse.id,
        term,
        action: gradesEntry.action,
        category: 'Calificación',
        date,
        time,
        timestamp,
      })
      .catch(() => {});

    setToastMessage(
      `✓ ¡Notas de disposición vinculadas en Calificaciones (${termLabel}) y sincronizadas con Google Sheets!`
    );
    setTimeout(() => setToastMessage(null), 5000);

    setIsSendDispositionModalOpen(false);

    if (shouldNavigateToGrades) {
      setActiveTab('grades');
    }
  };

  // Google Drive Folder Structure Handler:
  // Creates or finds:
  // [Nombre de la Materia]
  //   ├── Asistencia y Disposición (con hoja de Asistencia y Disposición)
  //   └── Calificaciones (con hoja de Calificaciones)
  const handleOpenCourseDriveFolder = async () => {
    if (!activeCourse) return;
    setIsSettingUpDriveFolder(true);
    try {
      // 1. Ensure course folder and subfolders exist in Google Drive
      const structure = await driveService.setupCourseFolderStructure(
        activeCourse.name,
        activeCourse.driveFolderId
      );

      // 2. Synchronize sheets into their respective subfolders
      let dispSheetUrl: string | undefined = activeCourse.dispositionSheetUrl;
      let gradesSheetUrl: string | undefined = activeCourse.gradesSheetUrl;

      // Sync disposition sheet to "Asistencia y Disposición" subfolder
      try {
        const dispRes = await sheetsService.syncDispositionSheet(
          activeCourse,
          courseStudents,
          dispositionMap,
          historyList,
          activeCourse.dispositionSheetId,
          structure.attendanceFolder.id
        );
        if (dispRes.url) dispSheetUrl = dispRes.url;
      } catch (err) {
        console.warn('Could not auto-sync disposition sheet to Drive folder:', err);
      }

      // Sync gradebook sheet to "Calificaciones" subfolder
      try {
        const evaluations = ['Diagnóstica', 'Trabajo Práctico 1', 'Evaluación Escrita', 'Desempeño'];
        const gradesRes = await sheetsService.syncGradebookToSheet(
          activeCourse,
          courseStudents,
          evaluations,
          [],
          structure.gradesFolder.id,
          activeCourse.gradesSheetId
        );
        if (gradesRes.url) gradesSheetUrl = gradesRes.url;
        if (gradesRes.spreadsheetId && isRealGoogleSpreadsheetId(gradesRes.spreadsheetId)) {
          activeCourse.gradesSheetId = gradesRes.spreadsheetId;
          activeCourse.gradesSheetUrl = gradesRes.url;
        }
      } catch (err) {
        console.warn('Could not auto-sync gradebook sheet to Drive folder:', err);
      }

      // 3. Update course with drive folder metadata
      const updatedCourseData: Partial<Course> = {
        driveFolderId: structure.mainFolder.id,
        driveFolderUrl: structure.mainFolder.url,
        attendanceFolderId: structure.attendanceFolder.id,
        attendanceFolderUrl: structure.attendanceFolder.url,
        gradesFolderId: structure.gradesFolder.id,
        gradesFolderUrl: structure.gradesFolder.url,
        dispositionSheetUrl: dispSheetUrl,
        gradesSheetUrl: gradesSheetUrl,
      };

      api.updateCourse(activeCourse.id, updatedCourseData).catch(() => {});
      Object.assign(activeCourse, updatedCourseData);

      setCourseDriveStructure({
        ...structure,
        attendanceSheetUrl: dispSheetUrl,
        gradesSheetUrl: gradesSheetUrl,
      });

      // 4. Open the main folder in a new tab
      window.open(structure.mainFolder.url, '_blank');

      // 5. Also show confirmation modal with direct links to both subfolders and sheets
      setDriveFolderModalOpen(true);
      setToastMessage(`Carpeta de Drive "${activeCourse.name}" creada/abierta con sus 2 subcarpetas.`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      console.error('Error creating Google Drive folders:', err);
      setToastMessage('Aviso: Se intentó abrir Drive. Si no estás conectado, inicia sesión con Google.');
    } finally {
      setIsSettingUpDriveFolder(false);
    }
  };

  // Calculations for summary pills & history
  const courseHistory = useMemo(() => {
    if (!activeCourse) return [];
    const courseStudentIds = new Set(courseStudents.map((s) => s.id));
    const relevant = historyList.filter(
      (h) =>
        h.courseId === activeCourse.id ||
        (activeCourse.classroomCourseId && h.courseId === activeCourse.classroomCourseId) ||
        courseStudentIds.has(h.studentId)
    );
    return deduplicateHistory(relevant).sort((a, b) => b.timestamp - a.timestamp);
  }, [historyList, activeCourse, courseStudents]);

  const distinctCourseDates = useMemo(() => {
    const dates = new Set<string>();
    courseHistory.forEach((h) => {
      if (h.date) dates.add(h.date);
    });
    return Array.from(dates);
  }, [courseHistory]);

  const filteredPermHistory = useMemo(() => {
    return courseHistory.filter((item) => {
      if (permHistoryCategory !== 'all' && item.category !== permHistoryCategory) {
        return false;
      }
      if (permHistoryDate !== 'all' && item.date !== permHistoryDate) {
        return false;
      }
      if (permHistorySearch.trim()) {
        const query = permHistorySearch.toLowerCase().trim();
        const matchesName = (item.studentName || '').toLowerCase().includes(query);
        const matchesAction = (item.action || '').toLowerCase().includes(query);
        const matchesDate = (item.date || '').toLowerCase().includes(query);
        const matchesMsg = (item.messageText || '').toLowerCase().includes(query);
        if (!matchesName && !matchesAction && !matchesDate && !matchesMsg) return false;
      }
      return true;
    });
  }, [courseHistory, permHistoryCategory, permHistoryDate, permHistorySearch]);

  const averageDisposition = useMemo(() => {
    if (courseStudents.length === 0) return 10;
    const sum = courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + metrics.totalDisposition;
    }, 0);
    return (sum / courseStudents.length).toFixed(1);
  }, [courseStudents, dispositionMap]);

  const totalCourseAbsences = useMemo(() => {
    return courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + metrics.totalAbsences;
    }, 0);
  }, [courseStudents, dispositionMap]);

  const totalCourseLates = useMemo(() => {
    return courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + (metrics.totalLates || 0);
    }, 0);
  }, [courseStudents, dispositionMap]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER                                                    */}
      {/* ------------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            <Users className="w-6 h-6 text-blue-500" />
            Estudiantes
          </h2>
        </div>
      </div>

      {activeCourse && (
        <>
          {/* ------------------------------------------------------------- */}
          {/* ACTIVE COURSE HEADER CARD & WORKSPACE LINKS                   */}
          {/* ------------------------------------------------------------- */}
          <div
            className={`rounded-xl border p-5 shadow-xs flex flex-col gap-4 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
            }`}
          >
            {/* Información del aula (nombre de la materia, división, horario, etc.) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-200/80 dark:border-slate-800">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    {activeCourse.grade} • {activeCourse.room}
                  </span>
                  {activeCourse.classroomSynced && (
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        isDarkMode
                          ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      }`}
                    >
                      <Check className="w-3 h-3" /> Conectado con Classroom
                    </span>
                  )}
                </div>

                {/* Nombre de la materia */}
                <div>
                  <h3 className={`text-xl sm:text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                    {activeCourse.name}
                  </h3>
                  <p className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                    {activeCourse.subject}
                  </p>
                </div>
              </div>
              
              {/* Horario con sincronización desde Google Calendar y edición */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Horario:
                  </span>
                  {activeCourse.schedule &&
                  activeCourse.schedule !== 'Lunes y Miércoles' &&
                  !activeCourse.schedule.toLowerCase().includes('coordinar') ? (
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-md ${
                        isDarkMode
                          ? 'bg-slate-800 text-blue-300 border border-slate-700'
                          : 'bg-blue-50 text-blue-800 border border-blue-200'
                      }`}
                    >
                      {activeCourse.schedule}
                    </span>
                  ) : (
                    <span
                      className={`font-medium italic px-2 py-0.5 rounded-md ${
                        isDarkMode
                          ? 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                      title="Horario pendiente de sincronizar con Google Calendar"
                    >
                      Pendiente de sincronizar con Calendar
                    </span>
                  )}
                </div>

                {/* Botón para sincronizar desde Google Calendar */}
                <button
                  type="button"
                  onClick={() => handleOpenCalendarSyncModal(activeCourse)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border-blue-800/70'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
                  }`}
                  title="Ver eventos y seleccionar módulos de tu Google Calendar"
                >
                  <Calendar className="w-3.5 h-3.5 text-blue-500" />
                  <span>Sincronizar con Calendar</span>
                </button>

                {/* Botón para editar datos específicos del curso */}
                <button
                  type="button"
                  onClick={() => handleOpenEditCourseDetailsModal(activeCourse)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
                  }`}
                  title="Editar aula, división, nombre y detalles específicos de la materia"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Editar datos</span>
                </button>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* TRES COLUMNAS DE ACCIONES                                     */}
            {/* ------------------------------------------------------------- */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {/* Columna 1: Classroom y Sincronizar Estudiantes */}
              <div
                className={`p-3 rounded-xl border flex flex-col gap-2 ${
                  isDarkMode ? 'bg-slate-950/40 border-slate-800/80' : 'bg-neutral-50/80 border-neutral-200/80'
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Classroom y Estudiantes
                  </span>
                </div>
                <div className="flex flex-col gap-2 flex-1 justify-center">
                  <button
                    type="button"
                    onClick={() => onNavigate('classroom', activeCourse.id)}
                    className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-green-950/40 hover:bg-green-950/60 text-green-300 border-green-800/60'
                        : 'bg-green-50 hover:bg-green-100 text-green-800 border-green-200'
                    }`}
                    title="Ir a Google Classroom de este curso"
                  >
                    <GraduationCap className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-green-700'}`} />
                    <span>Classroom</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncRoster}
                    disabled={isSyncingClassroomRoster}
                    className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-blue-950/40 hover:bg-blue-950/60 text-blue-300 border-blue-800/60'
                        : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
                    }`}
                    title="Sincronizar nómina real desde Google Classroom"
                  >
                    <RefreshCw className={`w-4 h-4 text-blue-500 ${isSyncingClassroomRoster ? 'animate-spin' : ''}`} />
                    <span>{isSyncingClassroomRoster ? 'Sincronizando...' : 'Sincronizar Estudiantes'}</span>
                  </button>
                </div>
              </div>

              {/* Columna 2: Carpeta Drive y Hacer informe */}
              <div
                className={`p-3 rounded-xl border flex flex-col gap-2 ${
                  isDarkMode ? 'bg-slate-950/40 border-slate-800/80' : 'bg-neutral-50/80 border-neutral-200/80'
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Carpeta Drive e Informes
                  </span>
                </div>
                <div className="flex flex-col gap-2 flex-1 justify-center">
                  <button
                    type="button"
                    onClick={handleOpenCourseDriveFolder}
                    disabled={isSettingUpDriveFolder}
                    className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border-amber-800/60'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200 shadow-2xs'
                    }`}
                    title={`Crear y abrir carpeta en Google Drive ("${activeCourse.name}") con subcarpetas Asistencia y Disposición y Calificaciones`}
                  >
                    {isSettingUpDriveFolder ? (
                      <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    ) : (
                      <FolderClosed className="w-4 h-4 text-amber-500" />
                    )}
                    <span>{isSettingUpDriveFolder ? 'Abriendo Drive...' : 'Carpeta Drive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCourseReportModalStudentId('all');
                      setCourseReportModalTab('course');
                      setCourseReportModalOpen(true);
                    }}
                    className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-purple-950/40 hover:bg-purple-950/60 text-purple-300 border-purple-800/60'
                        : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200 shadow-2xs'
                    }`}
                    title={`Generar informe oficial del curso "${activeCourse.name}" o constancias individuales de 1 página por alumno para guardar en Drive o imprimir`}
                  >
                    <FileText className="w-4 h-4 text-purple-500" />
                    <span>Hacer Informe</span>
                  </button>
                </div>
              </div>

              {/* Columna 3: Importar desde Excel y Vincular Sheet */}
              <div
                className={`p-3 rounded-xl border flex flex-col gap-2 ${
                  isDarkMode ? 'bg-slate-950/40 border-slate-800/80' : 'bg-neutral-50/80 border-neutral-200/80'
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Excel y Google Sheets
                  </span>
                </div>
                <div className="flex flex-col gap-2 flex-1 justify-center">
                  <button
                    type="button"
                    onClick={() => setIsHeaderImportModalOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border border-emerald-600/30 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                    title="Subir y verificar notas desde un archivo Excel (.xlsx, .xls, .csv) o Google Sheets"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importar desde Excel</span>
                  </button>

                  {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) ? (
                    <div className="grid grid-cols-2 gap-1.5 w-full">
                      <button
                        type="button"
                        onClick={() => {
                          const url = sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`;
                          window.open(url, '_blank');
                        }}
                        className={`inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
                          isDarkMode
                            ? 'bg-green-950/70 hover:bg-green-900 text-green-300 border-green-700'
                            : 'bg-green-100 hover:bg-green-200 text-green-800 border-green-300'
                        }`}
                        title="Abrir hoja vinculada de Google Sheets en una nueva pestaña"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
                        <span className="truncate">Sheet Vinculado</span>
                        <ExternalLink className="w-3 h-3 opacity-80 shrink-0" />
                      </button>

                      <button
                        type="button"
                        onClick={handleManualSheetsSync}
                        disabled={isSyncingSheet || isPullingFromSheet}
                        className={`inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
                          isDarkMode
                            ? 'bg-blue-950/70 hover:bg-blue-900 text-blue-300 border-blue-700'
                            : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
                        }`}
                        title="Sincronizar con Sheets: Doble entrada bidireccional. Si modificaste ausencias, tardanzas o notas en el Sheet, las trae a la app y actualiza la planilla en Google Drive"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-blue-500 shrink-0 ${isSyncingSheet || isPullingFromSheet ? 'animate-spin' : ''}`} />
                        <span className="truncate">{isSyncingSheet || isPullingFromSheet ? 'Sincronizando...' : 'Sincronizar con Sheets'}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSheetsConnectModal(true)}
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
                        isDarkMode
                          ? 'bg-green-950/60 hover:bg-green-900 text-green-300 border-green-800'
                          : 'bg-green-50 hover:bg-green-100 text-green-800 border-green-300'
                      }`}
                      title="Vincular una hoja de cálculo de Google Sheets con esta materia para sincronización bidireccional de doble entrada"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span>Vincular Sheet</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Roster Permission Notice if Google 403 */}
          {needsRosterPermission && (
            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in ${
                isDarkMode
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <p className="font-bold">Permiso de nómina de Google Classroom requerido</p>
                  <p className="text-[11px] opacity-90">
                    Google requiere autorización del permiso de lectura de estudiantes (classroom.rosters.readonly) para importar los estudiantes reales de tus clases.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setIsSyncingClassroomRoster(true);
                    await loginWithGoogle(user?.email);
                    setNeedsRosterPermission(false);
                    await handleSyncRoster();
                  } catch (e) {
                    console.warn('Re-auth error:', e);
                  } finally {
                    setIsSyncingClassroomRoster(false);
                  }
                }}
                disabled={isSyncingClassroomRoster}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition-all shrink-0 cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingClassroomRoster ? 'animate-spin' : ''}`} />
                <span>Autorizar y Cargar Estudiantes Reales</span>
              </button>
            </div>
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center justify-between gap-3 border animate-in fade-in ${
                isDarkMode
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{toastMessage}</span>
              </div>
              {toastMessage.includes('Calificaciones') && activeTab !== 'grades' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('grades')}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer transition-all shrink-0 flex items-center gap-1"
                >
                  <span>Ver en Calificaciones</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* VIEW SWITCHER TABS & ACTION BUTTONS                           */}
          {/* ------------------------------------------------------------- */}
          {/* ------------------------------------------------------------- */}
          {/* RENGLÓN SUPERIOR DE PESTAÑAS (A LO LARGO)                     */}
          {/* ------------------------------------------------------------- */}
          <div
            className={`p-1.5 rounded-xl border grid grid-cols-1 sm:grid-cols-3 gap-2 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'roster'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Asistencia y Disposición</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('grades')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'grades'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <Award className="w-4 h-4 shrink-0" />
              <span>Calificaciones</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <History className="w-4 h-4 shrink-0" />
              <span>Historial</span>
              {courseHistory.length > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'history'
                      ? 'bg-white/20 text-white'
                      : 'bg-blue-500/20 text-blue-600 dark:text-blue-300'
                  }`}
                >
                  {courseHistory.length}
                </span>
              )}
            </button>
          </div>

          {/* ------------------------------------------------------------- */}
          {/* BARRA DE HERRAMIENTAS (AGREGAR ALUMNO, MANDAR CALIFICACIONES, ETC.) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              {/* Search box */}
              <div className="relative flex items-center">
                <Search className={`absolute left-3 w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
                <input
                  type="text"
                  placeholder="Buscar estudiante..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`pl-8 pr-3 py-1.5 text-xs rounded-lg focus:outline-none w-44 sm:w-56 transition-colors border ${
                    isDarkMode
                      ? 'bg-slate-800 text-white placeholder-slate-500 border-slate-700 focus:border-blue-500'
                      : 'bg-white text-neutral-900 placeholder-neutral-400 border-neutral-200 focus:ring-1 focus:ring-blue-500'
                  }`}
                />
              </div>

              {/* Botones de acción: Agregar Alumno, Mandar a Calificaciones, etc. */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Botón para agregar alumno manualmente con su correo */}
                <button
                  type="button"
                  onClick={handleOpenAddStudentModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                  title="Agregar un nuevo alumno manualmente con su correo para pasar faltas y mandarle mensajes"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Agregar Alumno</span>
                </button>

                {/* Batch send button if students are selected */}
                {selectedStudentIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleOpenBatchFromSelectedStudents}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
                    title="Enviar aviso de inasistencia a todos los estudiantes seleccionados"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Avisar a seleccionados ({selectedStudentIds.length})</span>
                  </button>
                )}

                {/* Batch send button if there are pending notifications */}
                {selectedStudentIds.length === 0 && pendingAllItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleOpenBatchFromPending('all')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
                    title="Enviar avisos pendientes a todos los estudiantes (ausencias y conductas)"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>Avisos pendientes ({pendingAllItems.length})</span>
                  </button>
                )}

                {/* Botón principal: Mandar Nota de Disposición a Calificaciones según el cuatrimestre activo */}
                <button
                  type="button"
                  onClick={() => setIsSendDispositionModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl shadow-xs border border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white transition-all cursor-pointer"
                  title={`Mandar notas de disposición a Calificaciones (${attendanceTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
                >
                  <Award className="w-3.5 h-3.5 text-amber-300" />
                  <span>Mandar a Calificaciones</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsNotifConfigModalOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-blue-400 hover:text-blue-300 hover:bg-slate-800'
                      : 'border-blue-200 text-blue-700 hover:text-blue-800 hover:bg-blue-50'
                  }`}
                  title="Configurar mensajes preestablecidos y opciones de Classroom / Gmail"
                >
                  <Bookmark className="w-3.5 h-3.5 text-blue-500" />
                  <span>Mensajes Preestablecidos</span>
                </button>

                {/* Sincronizar con Sheets: Doble Entrada Bidireccional */}
                <button
                  type="button"
                  onClick={handleManualSheetsSync}
                  disabled={isSyncingSheet || isPullingFromSheet}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
                    isDarkMode
                      ? 'bg-blue-950/60 hover:bg-blue-900/70 text-blue-300 border-blue-800'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
                  }`}
                  title="Sincronizar con Sheets: Doble entrada bidireccional. Si modificaste ausencias, tardanzas o notas en el Google Sheet, las trae a la app y actualiza la planilla en Google Drive"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isSyncingSheet || isPullingFromSheet ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSheet || isPullingFromSheet ? 'Sincronizando...' : 'Sincronizar con Sheets'}</span>
                  {sheetConfig?.lastSyncedAt && !(isSyncingSheet || isPullingFromSheet) && (
                    <span className="hidden xl:inline text-[10px] opacity-75">({sheetConfig.lastSyncedAt})</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleOpenGoogleSheet}
                  disabled={isOpeningSheet}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                  title="Abrir la planilla vinculada en Google Sheets"
                >
                  {isOpeningSheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span className="hidden sm:inline">Abrir Sheet</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Bitácora de Sincronización e Historial ({courseHistory.length} registros)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenGoogleSheet}
                  disabled={isOpeningSheet}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                  title="Abrir o crear hoja oficial en Google Sheets"
                >
                  {isOpeningSheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5" />
                  )}
                  <span>Abrir en Google Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={handleManualSheetsSync}
                  disabled={isSyncingSheet || isPullingFromSheet}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                  title="Sincronizar con Google Sheets de forma bidireccional"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet || isPullingFromSheet ? 'animate-spin text-blue-500' : ''}`} />
                  <span>{isSyncingSheet || isPullingFromSheet ? 'Sincronizando...' : 'Sincronizar con Sheets'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSheetsModalFeedback(null);
                    setShowSheetsConnectModal(true);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                  title="Configurar y vincular hoja existente de Google Sheets"
                >
                  <Settings className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Vincular Sheet</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCourseReportModalTab('course');
                    setCourseReportModalOpen(true);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border-blue-700/60'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                  }`}
                  title="Generar informe oficial del curso o boletines individuales de 1 página para imprimir o guardar en Google Drive"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  <span>Informes y Reportes</span>
                </button>

                <button
                  onClick={handleCopyForGoogleSheets}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                  title="Copia los datos tabulados para pegar con Ctrl+V directamente en Google Sheets"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar datos</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportHistoryExcel}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                  title="Descargar historial en formato Excel (.xlsx) nativo"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Exportar Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportHistoryCsv}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar CSV</span>
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 1: STUDENT ROSTER WITH INTEGRATED SCRIPT CONTROLS        */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <div>
              {/* Academic Term Header & Switcher (1° Cuatrimestre / 2° Cuatrimestre / Resumen Anual) */}
              <div
                className={`p-3.5 rounded-xl border mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-lg ${
                      attendanceTerm === '1c'
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : attendanceTerm === '2c'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-xs ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                        Período de Asistencia y Disposición:
                      </span>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                          attendanceTerm === '1c'
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                            : attendanceTerm === '2c'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                            : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                        }`}
                      >
                        {attendanceTerm === '1c'
                          ? '📘 1° Cuatrimestre Activo'
                          : attendanceTerm === '2c'
                          ? '📗 2° Cuatrimestre Activo'
                          : '🎓 Resumen Anual Consolidado'}
                      </span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      {attendanceTerm === '1c'
                        ? 'Registro diario de inasistencias, tardanzas, llamados de atención y notas de disposición del 1° Cuatrimestre.'
                        : attendanceTerm === '2c'
                        ? 'Registro diario de inasistencias, tardanzas, llamados de atención y notas de disposición del 2° Cuatrimestre (inicia con 10 pts).'
                        : 'Planilla consolidada que compara ambos cuatrimestres, computa totales de faltas y calcula el promedio anual de disposición.'}
                    </p>
                  </div>
                </div>

                {/* Segmented term selector */}
                <div
                  className={`p-1 rounded-xl border flex items-center gap-1 shadow-2xs ${
                    isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-100 border-neutral-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setAttendanceTermHandler('1c')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                      attendanceTerm === '1c'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : isDarkMode
                        ? 'text-slate-400 hover:text-slate-200'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${attendanceTerm === '1c' ? 'bg-white' : 'bg-blue-400'}`} />
                    <span>1° Cuatrimestre</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAttendanceTermHandler('2c')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                      attendanceTerm === '2c'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : isDarkMode
                        ? 'text-slate-400 hover:text-slate-200'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${attendanceTerm === '2c' ? 'bg-white' : 'bg-emerald-400'}`} />
                    <span>2° Cuatrimestre</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAttendanceTermHandler('annual')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                      attendanceTerm === 'annual'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : isDarkMode
                        ? 'text-slate-400 hover:text-slate-200'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${attendanceTerm === 'annual' ? 'bg-white' : 'bg-purple-400'}`} />
                    <span>Resumen Anual</span>
                  </button>
                </div>
              </div>

              {/* ------------------------------------------------------------- */}
              {/* ANNUAL VIEW: CONSOLIDATED ATTENDANCE & DISPOSITION MATRIX     */}
              {/* ------------------------------------------------------------- */}
              {attendanceTerm === 'annual' ? (
                <div className="space-y-4">
                  {/* Overview stat cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(() => {
                      let totalAbs = 0;
                      let totalLats = 0;
                      let sumDisp = 0;
                      courseStudents.forEach((s) => {
                        const m1 = getStudentMetrics(s.id, '1c');
                        const m2 = getStudentMetrics(s.id, '2c');
                        totalAbs += m1.totalAbsences + m2.totalAbsences;
                        totalLats += (m1.totalLates || 0) + (m2.totalLates || 0);
                        sumDisp += (m1.totalDisposition + m2.totalDisposition) / 2;
                      });
                      const count = Math.max(1, courseStudents.length);
                      const avgDispGlobal = Number((sumDisp / count).toFixed(1));
                      const avgAttendanceRate = Math.max(0, Math.min(100, Math.round(100 - (totalAbs / count * 2.5) - (totalLats / count * 0.8))));

                      return (
                        <>
                          <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                              <span>Promedio Disposición Anual</span>
                              <Award className="w-4 h-4 text-purple-500" />
                            </div>
                            <div className="text-2xl font-black mt-1 text-purple-600 dark:text-purple-400">
                              {avgDispGlobal} <span className="text-xs font-normal text-neutral-400">/10</span>
                            </div>
                            <span className="text-[11px] text-neutral-400">Promedio de ambos cuatrimestres</span>
                          </div>

                          <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                              <span>Total Faltas Anuales</span>
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            </div>
                            <div className="text-2xl font-black mt-1 text-red-600 dark:text-red-400">
                              {totalAbs}
                            </div>
                            <span className="text-[11px] text-neutral-400">Acumulado 1°C + 2°C</span>
                          </div>

                          <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                              <span>Total Llegadas Tarde</span>
                              <Clock className="w-4 h-4 text-amber-500" />
                            </div>
                            <div className="text-2xl font-black mt-1 text-amber-600 dark:text-amber-400">
                              {totalLats}
                            </div>
                            <span className="text-[11px] text-neutral-400">Acumulado 1°C + 2°C</span>
                          </div>

                          <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                              <span>Asistencia Promedio</span>
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <div className="text-2xl font-black mt-1 text-emerald-600 dark:text-emerald-400">
                              {avgAttendanceRate}%
                            </div>
                            <span className="text-[11px] text-neutral-400">Tasa estimada del curso</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Consolidated Annual Table */}
                  <div
                    className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
                      isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-500" />
                        <span className="font-bold text-xs">Planilla Anual de Asistencia y Disposición ({courseStudents.length} estudiantes)</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const headers = [
                              'Estudiante',
                              'Email',
                              'Ausencias 1C',
                              'Tardanzas 1C',
                              'Disposición 1C',
                              'Ausencias 2C',
                              'Tardanzas 2C',
                              'Disposición 2C',
                              'Total Ausencias',
                              'Total Tardanzas',
                              'Promedio Disposición',
                              '% Asistencia',
                              'Condición',
                            ];
                            const rows = filteredStudents.map((s) => {
                              const m1 = getStudentMetrics(s.id, '1c');
                              const m2 = getStudentMetrics(s.id, '2c');
                              const tAbs = m1.totalAbsences + m2.totalAbsences;
                              const tLat = (m1.totalLates || 0) + (m2.totalLates || 0);
                              const aDisp = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
                              const est = Math.max(0, Math.min(100, Math.round(100 - (tAbs * 2.5) - (tLat * 0.8))));
                              const cond = est < 75 || aDisp < 6 ? 'Alerta' : aDisp >= 8 && est >= 85 ? 'Excelente' : 'Regular';
                              return [
                                `${s.lastName}, ${s.firstName}`,
                                s.email,
                                m1.totalAbsences,
                                m1.totalLates || 0,
                                m1.totalDisposition,
                                m2.totalAbsences,
                                m2.totalLates || 0,
                                m2.totalDisposition,
                                tAbs,
                                tLat,
                                aDisp,
                                `${est}%`,
                                cond,
                              ];
                            });
                            copyTableToClipboard(headers, rows);
                            setToastMessage('¡Planilla anual copiada al portapapeles para Google Sheets!');
                            setTimeout(() => setToastMessage(null), 3500);
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                            isDarkMode
                              ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                              : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar Resumen Anual</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleManualSheetsSync}
                          disabled={isSyncingSheet}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                          <span>Sincronizar Sheets</span>
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead
                          className={`border-b font-semibold uppercase tracking-wider ${
                            isDarkMode ? 'bg-slate-850 border-slate-800 text-slate-300' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                          }`}
                        >
                          <tr>
                            <th className="py-3 px-4">Estudiante</th>
                            <th className="py-3 px-3 text-center bg-blue-500/5 text-blue-700 dark:text-blue-300">
                              <div className="flex flex-col items-center">
                                <span>1° Cuatrimestre</span>
                                <span className="text-[10px] font-normal lowercase opacity-70">faltas / tard. / disp.</span>
                              </div>
                            </th>
                            <th className="py-3 px-3 text-center bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
                              <div className="flex flex-col items-center">
                                <span>2° Cuatrimestre</span>
                                <span className="text-[10px] font-normal lowercase opacity-70">faltas / tard. / disp.</span>
                              </div>
                            </th>
                            <th className="py-3 px-3 text-center bg-purple-500/5 text-purple-700 dark:text-purple-300">
                              <div className="flex flex-col items-center">
                                <span>Totales Anuales</span>
                                <span className="text-[10px] font-normal lowercase opacity-70">faltas / tardanzas</span>
                              </div>
                            </th>
                            <th className="py-3 px-3 text-center">
                              <div className="flex flex-col items-center">
                                <span>Promedio Disposición</span>
                                <span className="text-[10px] font-normal lowercase opacity-70">escala 10</span>
                              </div>
                            </th>
                            <th className="py-3 px-3 text-center">% Asistencia</th>
                            <th className="py-3 px-3 text-center">Condición</th>
                            <th className="py-3 px-3 text-center">Historial</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200 dark:divide-slate-800 font-medium">
                          {filteredStudents.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="py-8 text-center text-neutral-400">
                                No se encontraron estudiantes en este curso.
                              </td>
                            </tr>
                          ) : (
                            filteredStudents.map((student) => {
                              const m1 = getStudentMetrics(student.id, '1c');
                              const m2 = getStudentMetrics(student.id, '2c');
                              const totalAbs = m1.totalAbsences + m2.totalAbsences;
                              const totalLat = (m1.totalLates || 0) + (m2.totalLates || 0);
                              const avgDisp = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
                              const estAtt = Math.max(0, Math.min(100, Math.round(100 - (totalAbs * 2.5) - (totalLat * 0.8))));
                              const isAlert = estAtt < 75 || avgDisp < 6;

                              return (
                                <tr
                                  key={student.id}
                                  className={`transition-colors ${
                                    isDarkMode ? 'hover:bg-slate-850/50' : 'hover:bg-neutral-50'
                                  }`}
                                >
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-600 font-bold flex items-center justify-center text-xs">
                                        {student.firstName[0]}
                                        {student.lastName[0]}
                                      </div>
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenStudentProfile(student)}
                                          className="font-bold text-neutral-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer text-left block"
                                          title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
                                        >
                                          {student.lastName}, {student.firstName}
                                        </button>
                                        <div className="text-[11px] text-neutral-400">{student.email}</div>
                                      </div>
                                    </div>
                                  </td>

                                  {/* 1C */}
                                  <td className="py-3 px-3 text-center bg-blue-500/5">
                                    <div className="inline-flex items-center gap-2">
                                      <span className="text-red-600 dark:text-red-400 font-semibold" title="Faltas 1C">
                                        {m1.totalAbsences}F
                                      </span>
                                      <span className="text-amber-600 dark:text-amber-400 font-semibold" title="Tardanzas 1C">
                                        {m1.totalLates || 0}T
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded font-bold ${
                                          m1.totalDisposition >= 8
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                            : m1.totalDisposition >= 6
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                        }`}
                                      >
                                        {m1.totalDisposition}
                                      </span>
                                    </div>
                                  </td>

                                  {/* 2C */}
                                  <td className="py-3 px-3 text-center bg-emerald-500/5">
                                    <div className="inline-flex items-center gap-2">
                                      <span className="text-red-600 dark:text-red-400 font-semibold" title="Faltas 2C">
                                        {m2.totalAbsences}F
                                      </span>
                                      <span className="text-amber-600 dark:text-amber-400 font-semibold" title="Tardanzas 2C">
                                        {m2.totalLates || 0}T
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded font-bold ${
                                          m2.totalDisposition >= 8
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                            : m2.totalDisposition >= 6
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                        }`}
                                      >
                                        {m2.totalDisposition}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Totales Anuales */}
                                  <td className="py-3 px-3 text-center bg-purple-500/5">
                                    <span className="font-bold text-red-600 dark:text-red-400">{totalAbs} faltas</span>
                                    <span className="text-neutral-400 mx-1">•</span>
                                    <span className="font-bold text-amber-600 dark:text-amber-400">{totalLat} tard.</span>
                                  </td>

                                  {/* Promedio Disposición */}
                                  <td className="py-3 px-3 text-center font-bold">
                                    <span
                                      className={`px-2.5 py-1 rounded-full text-xs ${
                                        avgDisp >= 8
                                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                                          : avgDisp >= 6
                                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                          : 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 border border-red-300 dark:border-red-700'
                                      }`}
                                    >
                                      {avgDisp} / 10
                                    </span>
                                  </td>

                                  {/* % Asistencia */}
                                  <td className="py-3 px-3 text-center font-bold">
                                    <span className={estAtt < 75 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                                      {estAtt}%
                                    </span>
                                  </td>

                                  {/* Condición */}
                                  <td className="py-3 px-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                        isAlert
                                          ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                                          : avgDisp >= 8 && estAtt >= 85
                                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                          : 'bg-neutral-100 text-neutral-700 dark:bg-slate-800 dark:text-slate-300 border border-neutral-200 dark:border-slate-700'
                                      }`}
                                    >
                                      {isAlert ? 'Alerta' : avgDisp >= 8 && estAtt >= 85 ? 'Excelente' : 'Regular'}
                                    </span>
                                  </td>

                                  {/* Acciones */}
                                  <td className="py-3 px-3 text-center">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedStudentForHistory(student)}
                                      className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-slate-800 text-blue-600 dark:text-blue-400 cursor-pointer"
                                      title="Ver historial completo anual del estudiante"
                                    >
                                      <History className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                /* Regular Roster Tab (1° Cuatrimestre or 2° Cuatrimestre) */
                <div>
              {/* Batch actions bar when students are selected */}
              {selectedStudentIds.length > 0 && (
                <div
                  className={`mb-3 p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 ${
                    isDarkMode
                      ? 'bg-indigo-950/40 border-indigo-800 text-indigo-200'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CheckCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="font-semibold text-xs">
                      {selectedStudentIds.length} estudiante{selectedStudentIds.length > 1 ? 's' : ''} seleccionado{selectedStudentIds.length > 1 ? 's' : ''}
                    </span>
                    <span className="text-[11px] opacity-75">
                      (Puedes seleccionar varios para mandarles los mensajes juntos al final)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStudentIds([])}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg hover:underline opacity-80 cursor-pointer"
                    >
                      Deseleccionar
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenBatchFromSelectedStudents}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar aviso a seleccionados ({selectedStudentIds.length})</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Pending notifications notice bar (Absences and Conduct) */}
              {selectedStudentIds.length === 0 && pendingAllItems.length > 0 && (
                <div
                  className={`mb-3 p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 shadow-xs ${
                    isDarkMode
                      ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs">
                          {pendingAllItems.length} aviso{pendingAllItems.length > 1 ? 's' : ''} pendiente{pendingAllItems.length > 1 ? 's' : ''} de notificación
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {pendingAbsenceItems.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full font-semibold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                              {pendingAbsenceItems.length} ausencia{pendingAbsenceItems.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {pendingConductItems.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {pendingConductItems.length} conducta{pendingConductItems.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        Tienen las faltas y descuentos anotados. Puedes mandar todas las notificaciones juntas al final de la clase o ahora.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {pendingAbsenceItems.length > 0 && pendingConductItems.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenBatchFromPending('absences')}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-xs transition-all cursor-pointer"
                          title="Enviar solo los avisos de inasistencia"
                        >
                          Solo ausencias ({pendingAbsenceItems.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenBatchFromPending('conduct')}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-all cursor-pointer"
                          title="Enviar solo los avisos de llamados de atención y conducta"
                        >
                          Solo conductas ({pendingConductItems.length})
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpenBatchFromPending('all')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition-all cursor-pointer"
                      title="Abrir ventana para enviar todas las notificaciones pendientes juntas"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar todos juntos ({pendingAllItems.length})</span>
                    </button>
                  </div>
                </div>
              )}

              <div
                className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead
                      className={`border-b font-semibold uppercase tracking-wider ${
                        isDarkMode
                          ? 'bg-slate-850 border-slate-800 text-slate-300'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                      }`}
                    >
                      <tr>
                        <th className="py-3 px-3 w-10 text-center">
                          <button
                            type="button"
                            onClick={toggleSelectAllStudents}
                            className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            title={
                              selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0
                                ? 'Deseleccionar todos'
                                : 'Seleccionar todos los estudiantes'
                            }
                          >
                            {selectedStudentIds.length > 0 && selectedStudentIds.length === filteredStudents.length ? (
                              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            ) : selectedStudentIds.length > 0 ? (
                              <div className="w-4 h-4 rounded border-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-600 font-bold leading-none">
                                -
                              </div>
                            ) : (
                              <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                            )}
                          </button>
                        </th>
                        <th className="py-3 px-4">Estudiante</th>
                        <th className="py-3 px-3 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span>Asistencia</span>
                            <span className="text-[10px] font-normal lowercase opacity-70">acumulado</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span>Registrar asistencia</span>
                            <span className="text-[10px] font-normal lowercase opacity-70">falta / tarde / borrar</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1">
                              <span>Disposición</span>
                              <span className="text-[10px] font-normal lowercase opacity-70">escala 10</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsSendDispositionModalOpen(true)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950/80 dark:hover:bg-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 transition-all cursor-pointer shadow-2xs"
                              title={`Mandar notas de disposición a Calificaciones (${attendanceTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
                            >
                              <Award className="w-3 h-3 text-amber-500" />
                              <span>Mandar a Calificaciones</span>
                            </button>
                          </div>
                        </th>
                        <th className="py-3 px-4">
                          <div className="flex items-center justify-between gap-2">
                            <span>Registrar conducta</span>
                            <button
                              type="button"
                              onClick={() => setIsManageConductModalOpen(true)}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${
                                isDarkMode
                                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:bg-slate-700'
                                  : 'bg-white border-neutral-300 text-neutral-700 hover:text-blue-700 hover:border-blue-400 hover:bg-blue-50/50 shadow-2xs'
                              }`}
                              title="Configurar motivos de conducta personalizados"
                            >
                              <Settings className="w-3.5 h-3.5 text-blue-500" />
                              <span>Mis opciones ({teacherConductOptions.length})</span>
                            </button>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-center">Historial</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                      {filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 px-4 text-center">
                            <div className="max-w-md mx-auto flex flex-col items-center gap-3">
                              <div
                                className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-blue-50 text-blue-600'
                                }`}
                              >
                                <Users className="w-6 h-6" />
                              </div>
                              <div>
                                <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
                                  No hay estudiantes cargados para esta materia
                                </h4>
                                <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                                  ¿No usás Classroom? Podés agregar a tus alumnos manualmente con su correo para pasar asistencia de papel, registrar conducta y mandarles mensajes.
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
                                <button
                                  type="button"
                                  onClick={handleOpenAddStudentModal}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                                >
                                  <UserPlus className="w-4 h-4" />
                                  <span>+ Agregar Alumnos Manualmente</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSyncRoster}
                                  disabled={isSyncingClassroomRoster}
                                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                                    isDarkMode
                                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200 shadow-2xs'
                                  }`}
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingClassroomRoster ? 'animate-spin' : ''}`} />
                                  <span>{isSyncingClassroomRoster ? 'Sincronizando...' : 'Sincronizar desde Classroom'}</span>
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredStudents.map((student) => {
                          const metrics = getStudentMetrics(student.id);
                          const studentHistory = historyList.filter((h) => h.studentId === student.id);
                          const hasPendingAbsence = historyList.some(
                            (h) => h.courseId === activeCourse.id && h.studentId === student.id && h.category === 'Ausencia' && !h.messageSent
                          );

                          // Disposition score colors
                          const score = metrics.totalDisposition;
                          const scoreBadgeClass =
                            score >= 8
                              ? isDarkMode
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : score >= 6
                              ? isDarkMode
                                ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                              : isDarkMode
                              ? 'bg-red-950/60 text-red-300 border-red-800/60'
                              : 'bg-red-50 text-red-700 border-red-200';

                          const isSelected = selectedStudentIds.includes(student.id);

                          return (
                            <tr
                              key={student.id}
                              className={`transition-colors ${
                                isSelected
                                  ? isDarkMode
                                    ? 'bg-indigo-950/30'
                                    : 'bg-indigo-50/50'
                                  : isDarkMode
                                  ? 'hover:bg-slate-800/50'
                                  : 'hover:bg-neutral-50/70'
                              }`}
                            >
                              {/* Selection checkbox */}
                              <td className="py-3 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleSelectStudent(student.id)}
                                  className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                  title={isSelected ? 'Deseleccionar estudiante' : 'Seleccionar estudiante para aviso en lote'}
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                  ) : (
                                    <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                  )}
                                </button>
                              </td>

                              {/* Student info */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStudentProfile(student)}
                                    className="relative shrink-0 cursor-pointer group/avatar"
                                    title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
                                  >
                                    <img
                                      src={student.avatar}
                                      alt={student.firstName}
                                      className={`w-9 h-9 rounded-full object-cover border shrink-0 transition-transform group-hover/avatar:scale-105 group-hover/avatar:ring-2 group-hover/avatar:ring-indigo-400 ${
                                        isDarkMode ? 'border-slate-700' : 'border-neutral-200'
                                      }`}
                                    />
                                    {studentObservations[student.id]?.length > 0 && (
                                      <span
                                        className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[9px] font-bold border-2 border-white dark:border-slate-900 shadow-xs"
                                        title={`${studentObservations[student.id].length} observación(es) registrada(s)`}
                                      >
                                        {studentObservations[student.id].length}
                                      </span>
                                    )}
                                  </button>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenStudentProfile(student)}
                                        className={`font-semibold text-left transition-colors cursor-pointer group flex items-center gap-1.5 hover:underline ${
                                          isDarkMode
                                            ? 'text-slate-100 hover:text-indigo-400'
                                            : 'text-neutral-800 hover:text-indigo-600'
                                        }`}
                                        title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
                                      >
                                        <span>{student.lastName}, {student.firstName}</span>
                                      </button>

                                      {/* Badge si tiene observaciones registradas */}
                                      {studentObservations[student.id]?.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenStudentProfile(student)}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer shadow-2xs"
                                          title={`${studentObservations[student.id].length} observación(es) registrada(s). Clic para abrir ficha.`}
                                        >
                                          <FileText className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-400" />
                                          <span>{studentObservations[student.id].length}</span>
                                        </button>
                                      )}

                                      {hasPendingAbsence && (
                                        <span
                                          className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                                          title="Tiene una ausencia registrada pendiente de enviar notificación"
                                        >
                                          Aviso pendiente
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <span className={`text-[11px] font-mono ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                                        {student.email || 'Sin correo asignado'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenDirectMessageModal(student)}
                                        className="p-1 rounded text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                        title={`Enviar mensaje o correo a ${student.firstName} ${student.lastName}`}
                                      >
                                        <Mail className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Columna Asistencia: Conteo acumulado editable */}
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <div className="inline-flex flex-col items-center gap-1">
                                  {/* Badge contador de ausencias (clickable para editar) */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditAbsences(student)}
                                    className={`inline-flex items-center gap-1 justify-center min-w-[32px] px-2.5 py-0.5 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-2xs group ${
                                      metrics.totalAbsences > 0
                                        ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60 hover:bg-red-100 dark:hover:bg-red-900/60'
                                        : 'bg-neutral-100 dark:bg-slate-800 text-neutral-600 dark:text-slate-400 border-neutral-200 dark:border-slate-700 hover:bg-neutral-200 dark:hover:bg-slate-700'
                                    }`}
                                    title={`Total inasistencias: ${metrics.totalAbsences}. Hacé clic para editar la cantidad de faltas (pasar de papel, marcar fecha y enviar aviso).`}
                                  >
                                    <span>{metrics.totalAbsences} {metrics.totalAbsences === 1 ? 'falta' : 'faltas'}</span>
                                    <Pencil className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 transition-opacity ml-0.5" />
                                  </button>

                                  {/* Badge contador de llegadas tarde si tiene */}
                                  {(metrics.totalLates || 0) > 0 && (
                                    <span
                                      className="inline-flex items-center gap-1 justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60"
                                      title={`Llegadas tarde acumuladas: ${metrics.totalLates}`}
                                    >
                                      <Clock className="w-2.5 h-2.5 text-amber-500" />
                                      {metrics.totalLates} {metrics.totalLates === 1 ? 'tarde' : 'tardes'}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Columna Registrar asistencia: Botones separados */}
                              <td className="py-3 px-4 text-center">
                                <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                                  {/* Botón: +1 Falta */}
                                  <button
                                    type="button"
                                    onClick={() => handleAddAbsence(student)}
                                    className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-90 ${
                                      pulsingStudentId === `abs-${student.id}`
                                        ? 'bg-red-600 text-white border-red-600 scale-105'
                                        : isDarkMode
                                        ? 'border-slate-700 text-slate-300 hover:text-red-300 hover:border-red-800 hover:bg-red-950/40'
                                        : 'border-neutral-200 text-neutral-700 hover:text-red-700 hover:border-red-200 hover:bg-red-50 shadow-2xs'
                                    }`}
                                    title="Marcar falta (suma 1 ausencia sin descontar puntos de disposición)"
                                  >
                                    <span>+ Falta</span>
                                  </button>

                                  {/* Botón: Llegada Tarde */}
                                  <button
                                    type="button"
                                    onClick={() => handleRecordLateArrival(student)}
                                    className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-90 ${
                                      pulsingStudentId === `late-${student.id}`
                                        ? 'bg-amber-600 text-white border-amber-600 scale-105'
                                        : isDarkMode
                                        ? 'border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-800 hover:bg-amber-950/40'
                                        : 'border-neutral-200 text-neutral-700 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50 shadow-2xs'
                                    }`}
                                    title="Registrar llegada tarde. Si el alumno tenía una falta registrada hoy, se borra automáticamente."
                                  >
                                    <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                    <span>Tarde</span>
                                  </button>

                                  {/* Botón: Editar faltas (pasar de papel) */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditAbsences(student)}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer active:scale-90 shadow-2xs ${
                                      isDarkMode
                                        ? 'border-slate-700 text-slate-300 hover:text-red-300 hover:border-red-800 hover:bg-red-950/40'
                                        : 'border-neutral-200 text-neutral-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50'
                                    }`}
                                    title="Editar cantidad de faltas (pasar de papel, marcar fecha retroactiva y mandar mensaje)"
                                  >
                                    <Pencil className="w-3 h-3 text-red-500" />
                                    <span className="text-[11px]">Editar</span>
                                  </button>

                                  {/* Botón: Borrar falta */}
                                  {metrics.totalAbsences > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteLatestAbsence(student)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 text-xs font-medium text-neutral-600 dark:text-slate-300 hover:text-red-600 hover:border-red-200 dark:hover:border-red-800/60 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all cursor-pointer active:scale-90 shadow-2xs"
                                      title="Borrar falta: elimina la última inasistencia registrada y actualiza el contador"
                                    >
                                      <RotateCcw className="w-3 h-3 text-red-500" />
                                      <span className="text-[11px]">Borrar falta</span>
                                    </button>
                                  )}

                                  {/* Botón: Borrar tardanza */}
                                  {(metrics.totalLates || 0) > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteLatestLate(student)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 text-xs font-medium text-neutral-600 dark:text-slate-300 hover:text-amber-600 hover:border-amber-200 dark:hover:border-amber-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all cursor-pointer active:scale-90 shadow-2xs"
                                      title="Borrar tardanza: elimina la última llegada tarde registrada y actualiza el contador"
                                    >
                                      <RotateCcw className="w-3 h-3 text-amber-500" />
                                      <span className="text-[11px]">Borrar tarde</span>
                                    </button>
                                  )}
                                </div>
                              </td>

                            {/* Columna Disposición (Inicia en 10, editable o por incidencias) */}
                            <td className="py-3 px-4 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditDisposition(student)}
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-2xs group ${scoreBadgeClass}`}
                                  title={`Hacé clic para editar la nota de disposición de ${student.lastName}, ${student.firstName} (pasar de papel o ajustar)`}
                                >
                                  <span>{metrics.totalDisposition}</span>
                                  <span className="text-[10px] font-normal opacity-70">/ 10</span>
                                  <Pencil className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 transition-opacity ml-0.5" />
                                </button>

                                {/* Mini Progress bar visual */}
                                <div className="w-16 h-1 rounded-full bg-neutral-200 dark:bg-slate-700 overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-300 ${
                                      metrics.totalDisposition >= 8
                                        ? 'bg-emerald-500'
                                        : metrics.totalDisposition >= 6
                                        ? 'bg-amber-500'
                                        : 'bg-red-500'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, metrics.totalDisposition * 10))}%` }}
                                  />
                                </div>

                                {/* Botón: Editar nota de disposición (pasar de papel o ajustar nota) */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditDisposition(student)}
                                  className={`mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer shadow-2xs hover:scale-102 active:scale-95 ${
                                    isDarkMode
                                      ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 border border-indigo-800/60'
                                      : 'text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 border border-indigo-200'
                                  }`}
                                  title={`Editar nota de disposición para ${student.lastName}, ${student.firstName} (pasar de papel o ajustar)`}
                                >
                                  <Pencil className="w-2.5 h-2.5" />
                                  <span>Editar nota</span>
                                </button>
                              </div>
                            </td>

                            {/* Columna Registrar conducta (sumar o restar puntos) */}
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {teacherConductOptions.map((opt) => {
                                  const isPositive =
                                    opt.startsWith('+') ||
                                    opt.startsWith('[+]') ||
                                    opt.includes('(+') ||
                                    /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(opt);
                                  const cleanOpt = opt.replace(/^(\+|\[\+\])\s*/, '');
                                  const delta = isPositive ? 1 : -1;
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handleRecordDispositionAction(student, cleanOpt, undefined, delta)}
                                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 active:scale-95 ${
                                        pulsingStudentId === `disp-${student.id}`
                                          ? isPositive
                                            ? 'bg-emerald-600 text-white border-emerald-600 scale-105'
                                            : 'bg-rose-600 text-white border-rose-600 scale-105'
                                          : isPositive
                                          ? isDarkMode
                                            ? 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/60 hover:border-emerald-700'
                                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 hover:border-emerald-300 shadow-2xs'
                                          : isDarkMode
                                          ? 'bg-slate-800/90 hover:bg-slate-750 text-slate-200 border-slate-700 hover:border-slate-600'
                                          : 'bg-white hover:bg-rose-50 text-neutral-800 border-neutral-200 hover:border-rose-300 shadow-2xs'
                                      }`}
                                      title={isPositive ? `Sumar 1 punto por: ${cleanOpt}` : `Restar 1 punto por: ${cleanOpt}`}
                                    >
                                      <span>{cleanOpt}</span>
                                      <span className={`text-[10px] font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                                        {isPositive ? '+1' : '-1'}
                                      </span>
                                    </button>
                                  );
                                })}

                                {/* Botón rápido: Sumar puntos / Reconocimiento */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConductRecordModal({
                                      isOpen: true,
                                      student,
                                      mode: 'add',
                                      points: 1,
                                      customReason: '',
                                      saveToOptions: false,
                                    });
                                  }}
                                  className="px-2 py-1 rounded-lg border border-dashed border-emerald-500/80 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95"
                                  title={`Sumar puntos a ${student.lastName}, ${student.firstName} (participación, reconocimiento, tarea...)`}
                                >
                                  <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>+ Sumar</span>
                                </button>

                                {/* Botón rápido: Restar puntos / Llamado de atención */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConductRecordModal({
                                      isOpen: true,
                                      student,
                                      mode: 'subtract',
                                      points: 1,
                                      customReason: '',
                                      saveToOptions: false,
                                    });
                                  }}
                                  className="px-2 py-1 rounded-lg border border-dashed border-rose-400/80 bg-rose-50/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95"
                                  title={`Restar puntos a ${student.lastName}, ${student.firstName} (falta de tarea, libro, conducta...)`}
                                >
                                  <Minus className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                                  <span>- Restar</span>
                                </button>
                              </div>
                            </td>

                            {/* Columna Bitácora individual del alumno */}
                            <td className="py-3 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => setSelectedStudentForHistory(student)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                                  studentHistory.length > 0
                                    ? isDarkMode
                                      ? 'bg-blue-950/40 hover:bg-blue-950/70 text-blue-300 border-blue-800/60'
                                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                    : isDarkMode
                                    ? 'text-slate-500 border-transparent hover:border-slate-800'
                                    : 'text-neutral-400 border-transparent hover:border-neutral-200'
                                }`}
                                title="Ver historial de este alumno"
                              >
                                <History className="w-3.5 h-3.5" />
                                <span>{studentHistory.length}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* HISTORIAL PERMANENTE DE CLASES, ASISTENCIAS Y CONDUCTAS        */}
            {/* Permanece siempre visible en la pantalla principal             */}
            {/* ------------------------------------------------------------- */}
            <div
              className={`mt-8 rounded-xl border shadow-xs overflow-hidden transition-all ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
              }`}
            >
              {/* Header con botón para colapsar/expandir, badge de persistencia y acciones */}
              <div
                className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className={`text-sm sm:text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
                        Historial Permanente de Clases e Incidencias
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                        Siempre visible ({courseHistory.length})
                      </span>
                    </div>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Registro cronológico completo de inasistencias, tardanzas y observaciones de conducta guardados en el sistema y Google Sheets.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Botón copiar para Google Sheets */}
                  <button
                    type="button"
                    onClick={handleCopyForGoogleSheets}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300 shadow-2xs'
                    }`}
                    title="Copia los datos de historial tabulados para pegar con Ctrl+V en Google Sheets"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Copiar datos</span>
                  </button>

                  {/* Botón Excel */}
                  <button
                    type="button"
                    onClick={handleExportHistoryExcel}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300 shadow-2xs'
                    }`}
                    title="Descargar historial en formato Excel (.xlsx) nativo"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="hidden sm:inline">Exportar Excel</span>
                  </button>

                  {/* Botón CSV */}
                  <button
                    type="button"
                    onClick={handleExportHistoryCsv}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300 shadow-2xs'
                    }`}
                    title="Descargar archivo CSV compatible con Google Sheets y Excel"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Exportar CSV</span>
                  </button>

                  {/* Botón colapsar / expandir */}
                  <button
                    type="button"
                    onClick={() => setIsPermHistoryCollapsed(!isPermHistoryCollapsed)}
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                        : 'bg-white border-neutral-300 text-neutral-600 hover:text-neutral-900 shadow-2xs'
                    }`}
                    title={isPermHistoryCollapsed ? 'Expandir tabla de historial' : 'Minimizar tabla de historial'}
                  >
                    {isPermHistoryCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!isPermHistoryCollapsed && (
                <div>
                  {/* Barra de Filtros y Búsqueda */}
                  <div
                    className={`p-3 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
                      isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
                    }`}
                  >
                    {/* Filtros de Categoría */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`font-semibold mr-1 flex items-center gap-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                        <Filter className="w-3.5 h-3.5" />
                        Filtrar:
                      </span>
                      <button
                        type="button"
                        onClick={() => setPermHistoryCategory('all')}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                          permHistoryCategory === 'all'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        Todos ({courseHistory.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPermHistoryCategory('Ausencia')}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                          permHistoryCategory === 'Ausencia'
                            ? 'bg-red-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-red-300 hover:bg-slate-700'
                            : 'bg-white border border-neutral-200 text-red-700 hover:bg-red-50'
                        }`}
                      >
                        Faltas ({courseHistory.filter((h) => h.category === 'Ausencia').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPermHistoryCategory('Llegada tarde')}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                          permHistoryCategory === 'Llegada tarde'
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
                            : 'bg-white border border-neutral-200 text-amber-700 hover:bg-amber-50'
                        }`}
                      >
                        Llegadas tarde ({courseHistory.filter((h) => h.category === 'Llegada tarde').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPermHistoryCategory('Disposición')}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                          permHistoryCategory === 'Disposición'
                            ? 'bg-purple-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-purple-300 hover:bg-slate-700'
                            : 'bg-white border border-neutral-200 text-purple-700 hover:bg-purple-50'
                        }`}
                      >
                        Conducta ({courseHistory.filter((h) => h.category === 'Disposición').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPermHistoryCategory('Calificación')}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                          permHistoryCategory === 'Calificación'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-blue-300 hover:bg-slate-700'
                            : 'bg-white border border-neutral-200 text-blue-700 hover:bg-blue-50'
                        }`}
                      >
                        Notas y Sistema ({courseHistory.filter((h) => h.category === 'Calificación' || h.category === 'Sistema').length})
                      </button>
                    </div>

                    {/* Selector de Fecha y Buscador */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {distinctCourseDates.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className={`w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`} />
                          <select
                            value={permHistoryDate}
                            onChange={(e) => setPermHistoryDate(e.target.value)}
                            className={`px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${
                              isDarkMode
                                ? 'bg-slate-800 border-slate-700 text-white'
                                : 'bg-white border-neutral-300 text-neutral-800 shadow-2xs'
                            }`}
                          >
                            <option value="all">Todas las clases ({distinctCourseDates.length} fechas)</option>
                            {distinctCourseDates.map((d) => (
                              <option key={d} value={d}>
                                Clase del {d}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="relative">
                        <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
                        <input
                          type="text"
                          placeholder="Buscar alumno o motivo..."
                          value={permHistorySearch}
                          onChange={(e) => setPermHistorySearch(e.target.value)}
                          className={`pl-8 pr-3 py-1 rounded-lg border text-xs transition-colors w-48 sm:w-56 ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                              : 'bg-white border-neutral-300 text-neutral-800 placeholder-neutral-400 focus:border-blue-500 shadow-2xs'
                          }`}
                        />
                        {permHistorySearch && (
                          <button
                            type="button"
                            onClick={() => setPermHistorySearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tabla de Registros */}
                  <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead
                        className={`sticky top-0 z-10 border-b font-semibold uppercase tracking-wider ${
                          isDarkMode
                            ? 'bg-slate-800/95 border-slate-700 text-slate-300'
                            : 'bg-neutral-100/95 border-neutral-200 text-neutral-600'
                        }`}
                      >
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">
                            {pendingAllItems.length > 0 && (
                              <button
                                type="button"
                                onClick={toggleSelectAllPendingHistory}
                                className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                title="Seleccionar todos los avisos pendientes de la clase (ausencias y conductas)"
                              >
                                {selectedPendingHistoryIds.length > 0 && selectedPendingHistoryIds.length === pendingAllItems.length ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                ) : selectedPendingHistoryIds.length > 0 ? (
                                  <div className="w-4 h-4 rounded border-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-600 font-bold leading-none">
                                    -
                                  </div>
                                ) : (
                                  <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                )}
                              </button>
                            )}
                          </th>
                          <th className="py-2.5 px-3">Fecha y Hora</th>
                          <th className="py-2.5 px-4">Estudiante</th>
                          <th className="py-2.5 px-3">Tipo / Incidencia</th>
                          <th className="py-2.5 px-4">Detalle / Motivo</th>
                          <th className="py-2.5 px-3 text-center">Impacto</th>
                          <th className="py-2.5 px-3 text-center">Aviso</th>
                          <th className="py-2.5 px-3 text-center">Acción</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                        {filteredPermHistory.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 px-4 text-center">
                              <History className="w-8 h-8 mx-auto mb-2 opacity-30 text-blue-500" />
                              <p className={`font-semibold ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                                {courseHistory.length === 0
                                  ? 'Aún no se registraron incidencias en este curso.'
                                  : 'No se encontraron registros que coincidan con los filtros seleccionados.'}
                              </p>
                              {courseHistory.length === 0 && (
                                <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>
                                  Las inasistencias, llegadas tarde y observaciones de conducta quedarán registradas aquí de forma permanente.
                                </p>
                              )}
                            </td>
                          </tr>
                        ) : (
                          filteredPermHistory.map((item) => {
                            const isAbsence =
                              item.category === 'Ausencia' ||
                              item.action === 'Ausencia' ||
                              item.action?.toLowerCase().includes('ausencia') ||
                              item.action?.toLowerCase().includes('falta');
                            const isLate =
                              item.category === 'Llegada tarde' ||
                              item.action === 'Llegada tarde' ||
                              item.action?.toLowerCase().includes('llegada tarde') ||
                              item.action?.toLowerCase().includes('tarde') ||
                              item.action?.toLowerCase().includes('tardanza');

                            return (
                              <tr
                                key={item.id}
                                className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50/70'}`}
                              >
                                <td className="py-2.5 px-3 text-center w-10">
                                  {(item.category === 'Ausencia' || item.category === 'Disposición') && !item.messageSent ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleSelectPendingHistory(item.id)}
                                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                      title={selectedPendingHistoryIds.includes(item.id) ? 'Deseleccionar aviso' : 'Seleccionar aviso para envío grupal'}
                                    >
                                      {selectedPendingHistoryIds.includes(item.id) ? (
                                        <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                      ) : (
                                        <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-neutral-300 dark:text-slate-600">-</span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-neutral-900 dark:text-white">{item.date}</span>
                                    <span className={`text-[10px] font-mono ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>{item.time}</span>
                                  </div>
                                </td>

                                <td className="py-2.5 px-4 font-semibold text-neutral-900 dark:text-white">
                                  {item.studentName}
                                </td>

                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  {isAbsence ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60">
                                      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                      Ausencia
                                    </span>
                                  ) : isLate ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                                      <Clock className="w-3 h-3 text-amber-500" />
                                      Llegada tarde
                                    </span>
                                  ) : item.category === 'Calificación' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
                                      <Award className="w-3 h-3 text-blue-500" />
                                      Calificación
                                    </span>
                                  ) : item.category === 'Sistema' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                                      <RotateCcw className="w-3 h-3 text-indigo-500" />
                                      Sistema
                                    </span>
                                  ) : item.category === 'Asistencia' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                      Presente
                                    </span>
                                  ) : item.category === 'Disposición' && item.pointsChange !== undefined && item.pointsChange > 0 ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                      <Award className="w-3 h-3 text-emerald-500" />
                                      Reconocimiento
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                      Disposición
                                    </span>
                                  )}
                                </td>

                                <td className="py-2.5 px-4">
                                  <span className="font-medium text-neutral-800 dark:text-slate-200">{item.action}</span>
                                </td>

                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  {isAbsence ? (
                                    <span className="font-mono font-bold text-red-600 dark:text-red-400">Ausencia</span>
                                  ) : isLate ? (
                                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">Tardanza</span>
                                  ) : item.previousDisposition !== undefined && item.resultingDisposition !== undefined ? (
                                    <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                                      item.resultingDisposition > item.previousDisposition
                                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60'
                                        : 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800/60'
                                    }`}>
                                      {item.previousDisposition} → {item.resultingDisposition} pts
                                    </span>
                                  ) : item.pointsChange !== undefined && item.pointsChange !== 0 && !isAbsence && !isLate ? (
                                    <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                                      item.pointsChange > 0
                                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60'
                                        : 'text-neutral-700 dark:text-slate-300 border-transparent'
                                    }`}>
                                      {item.pointsChange > 0 ? `+${item.pointsChange}` : item.pointsChange} pto
                                    </span>
                                  ) : (
                                    <span className="text-neutral-400 font-mono text-[11px]">-</span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  {isAbsence || item.category === 'Disposición' ? (
                                    item.messageSent ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                                        title={item.messageText || 'Aviso enviado'}
                                      >
                                        <Check className="w-3 h-3 text-emerald-600" />
                                        Enviado
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const st = courseStudents.find((s) => s.id === item.studentId);
                                          handleOpenNotifyModal(item, st || { id: item.studentId, firstName: item.studentName, lastName: '', email: '' } as any);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 hover:bg-amber-200 cursor-pointer transition-colors"
                                        title={`Enviar aviso de ${isAbsence ? 'inasistencia' : 'conducta / disposición'} por Classroom o Gmail`}
                                      >
                                        <Send className="w-2.5 h-2.5" />
                                        Mandar
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-[11px] text-neutral-400 dark:text-slate-500">-</span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteHistoryEntry(item)}
                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                                    title="Borrar este registro del historial y revertir puntuación en Google Sheets"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Barra inferior al final del historial: botón 'Enviar a todos' para notificaciones acumuladas a lo largo de la clase */}
                  <div
                    className={`px-4 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
                      isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-50 border-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                        Total en historial: <strong>{filteredPermHistory.length}</strong> registro{filteredPermHistory.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-neutral-400">•</span>
                      {pendingAllItems.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/70">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          {pendingAllItems.length} notificación{pendingAllItems.length === 1 ? '' : 'es'} pendiente{pendingAllItems.length === 1 ? '' : 's'} de la clase
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                          <Check className="w-3 h-3 text-emerald-600" />
                          Todos los avisos de la clase están enviados
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                      {selectedPendingHistoryIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleOpenBatchFromSelectedHistory}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer"
                          title="Enviar aviso a los registros seleccionados"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Enviar a seleccionados ({selectedPendingHistoryIds.length})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        id="btn-enviar-notificaciones-todos-historial"
                        onClick={() => {
                          if (pendingAllItems.length === 0) {
                            setToastMessage('Todos los avisos de la clase ya han sido enviados (o no hay incidencias pendientes).');
                            setTimeout(() => setToastMessage(null), 3500);
                            return;
                          }
                          handleOpenBatchFromPending('all');
                        }}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold shadow-md transition-all cursor-pointer ${
                          pendingAllItems.length > 0
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:shadow-lg hover:scale-102 ring-2 ring-blue-500/30'
                            : 'bg-neutral-200 dark:bg-slate-700 text-neutral-600 dark:text-slate-300 hover:bg-neutral-300 dark:hover:bg-slate-600'
                        }`}
                        title="Enviar todas las notificaciones de ausencias y conductas acumuladas a lo largo de la clase a todos los alumnos correspondientes"
                      >
                        <Send className="w-4 h-4" />
                        <span>Enviar a todos</span>
                        {pendingAllItems.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white text-blue-700 shadow-xs">
                            {pendingAllItems.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 2: CALIFICACIONES (CATEGORÍAS Y SUBCATEGORÍAS CUSTOM)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'grades' && (
            <GradebookMatrix
              courseId={activeCourse.id}
              courseName={activeCourse.name}
              students={courseStudents}
              isDarkMode={isDarkMode}
              driveFolderId={activeCourse.driveFolderId}
              driveFolderUrl={activeCourse.driveFolderUrl}
            />
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 3: AUDITORÍA E HISTORIAL GENERAL (HOJA GOOGLE SHEETS)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {/* Google Sheets Live Status Banner */}
              <div
                className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-sm text-neutral-900 dark:text-white">
                        Google Sheets: {activeCourse.name}
                      </h4>
                      {isSyncingSheet ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Sincronizando...
                        </span>
                      ) : sheetConfig?.isLiveGoogle ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          En vivo en Google Drive
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          Guardado local
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Se sincroniza en tiempo real al registrar ausencias o notas de conducta, y se borra del Sheet cuando quitas un registro.
                      {sheetConfig?.lastSyncedAt && ` Última actualización: ${sheetConfig.lastSyncedAt}.`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                  <button
                    type="button"
                    onClick={handleOpenGoogleSheet}
                    disabled={isOpeningSheet}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    title="Abrir o sincronizar en Google Sheets"
                  >
                    {isOpeningSheet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5" />
                    )}
                    <span>Abrir Google Sheet</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleManualSheetsSync}
                    disabled={isSyncingSheet}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-300'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                    <span>Sincronizar Ahora</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSheetsModalFeedback(null);
                      setShowSheetsConnectModal(true);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-300'
                    }`}
                    title="Configurar y vincular hoja existente de Google Sheets"
                  >
                    <Settings className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Vincular Sheet</span>
                  </button>
                </div>
              </div>

              {/* Sub-tabs: Incidencias vs Resumen Alumnos y Disposición */}
              <div
                className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                {/* Sub-tab Navigation Bar */}
                <div
                  className={`p-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div
                    className={`inline-flex p-1 rounded-xl border text-xs font-semibold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('incidents')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                        historySubTab === 'incidents'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : isDarkMode
                          ? 'text-slate-400 hover:text-white'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Historial de Incidencias ({courseHistory.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('summary')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                        historySubTab === 'summary'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : isDarkMode
                          ? 'text-slate-400 hover:text-white'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Estudiantes y Disposición ({courseStudents.length})</span>
                    </button>
                  </div>

                  <span className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    {historySubTab === 'incidents'
                      ? 'Hoja 2 en Google Sheets (motivos y auditoría)'
                      : 'Hoja 1 en Google Sheets (ausencias y nota /10)'}
                  </span>
                </div>

                {/* SUBTAB 1: INCIDENCIAS DETALLADAS */}
                {historySubTab === 'incidents' && (
                  <div>
                    {/* Batch send bar in history tab */}
                    {selectedPendingHistoryIds.length > 0 && (
                      <div
                        className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 ${
                          isDarkMode ? 'bg-indigo-950/40 border-slate-800 text-indigo-200' : 'bg-indigo-50 border-neutral-200 text-indigo-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <CheckCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="font-semibold text-xs">
                            {selectedPendingHistoryIds.length} aviso{selectedPendingHistoryIds.length > 1 ? 's' : ''} pendiente{selectedPendingHistoryIds.length > 1 ? 's' : ''} seleccionado{selectedPendingHistoryIds.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPendingHistoryIds([])}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg hover:underline opacity-80 cursor-pointer"
                          >
                            Deseleccionar
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenBatchFromSelectedHistory}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Enviar aviso a seleccionados ({selectedPendingHistoryIds.length})</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead
                          className={`border-b font-semibold uppercase tracking-wider ${
                            isDarkMode
                              ? 'bg-slate-800/80 border-slate-800 text-slate-300'
                              : 'bg-neutral-100/70 border-neutral-200 text-neutral-600'
                          }`}
                        >
                          <tr>
                            <th className="py-3 px-3 w-10 text-center">
                              {pendingAllItems.length > 0 && (
                                <button
                                  type="button"
                                  onClick={toggleSelectAllPendingHistory}
                                  className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                  title="Seleccionar todos los avisos pendientes de notificación (ausencias y conductas)"
                                >
                                  {selectedPendingHistoryIds.length > 0 && selectedPendingHistoryIds.length === pendingAllItems.length ? (
                                    <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                  ) : selectedPendingHistoryIds.length > 0 ? (
                                    <div className="w-4 h-4 rounded border-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-600 font-bold leading-none">
                                      -
                                    </div>
                                  ) : (
                                    <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                  )}
                                </button>
                              )}
                            </th>
                            <th className="py-3 px-4">Estudiante</th>
                            <th className="py-3 px-4">Fecha</th>
                            <th className="py-3 px-4">Hora</th>
                            <th className="py-3 px-4">Acción / Motivo</th>
                            <th className="py-3 px-4 text-center">Tipo</th>
                            <th className="py-3 px-4 text-center">Mensaje Enviado</th>
                            <th className="py-3 px-4">Mensaje</th>
                            <th className="py-3 px-4 text-right">Borrar y Revertir</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                          {courseHistory.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="py-12 px-4 text-center text-neutral-400">
                                <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                <p className="font-semibold text-sm">No hay incidencias registradas aún en este curso.</p>
                                <p className="text-xs mt-1 max-w-md mx-auto">
                                  Al anotar una ausencia o marcar una falta en la lista de Estudiantes, se registra automáticamente aquí y en la hoja Google Sheets.
                                </p>
                              </td>
                            </tr>
                          ) : (
                            courseHistory.map((item) => {
                              const student = courseStudents.find((s) => s.id === item.studentId);
                              const isPendingNotif = (item.category === 'Ausencia' || item.category === 'Disposición') && !item.messageSent;
                              const isSelectedPending = selectedPendingHistoryIds.includes(item.id);

                              return (
                              <tr
                                key={item.id}
                                className={`transition-colors ${
                                  isSelectedPending
                                    ? isDarkMode
                                      ? 'bg-indigo-950/30'
                                      : 'bg-indigo-50/50'
                                    : isDarkMode
                                    ? 'hover:bg-slate-800/50'
                                    : 'hover:bg-neutral-50/70'
                                }`}
                              >
                                <td className="py-3 px-3 text-center">
                                  {isPendingNotif ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleSelectPendingHistory(item.id)}
                                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                      title={isSelectedPending ? 'Deseleccionar' : 'Seleccionar para aviso en lote'}
                                    >
                                      {isSelectedPending ? (
                                        <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                      ) : (
                                        <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-neutral-300 dark:text-slate-600 text-[10px]">—</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 font-semibold text-neutral-900 dark:text-white">
                                {item.studentName}
                              </td>
                              <td className="py-3 px-4 font-mono text-neutral-600 dark:text-slate-300">
                                {item.date}
                              </td>
                              <td className="py-3 px-4 font-mono text-neutral-600 dark:text-slate-300">
                                {item.time}
                              </td>
                              <td className="py-3 px-4">
                                {(() => {
                                  const isItemAbsence =
                                    item.category === 'Ausencia' ||
                                    item.action === 'Ausencia' ||
                                    item.action?.toLowerCase().includes('ausencia') ||
                                    item.action?.toLowerCase().includes('falta');
                                  const isItemLate =
                                    item.category === 'Llegada tarde' ||
                                    item.action === 'Llegada tarde' ||
                                    item.action?.toLowerCase().includes('llegada tarde') ||
                                    item.action?.toLowerCase().includes('tarde') ||
                                    item.action?.toLowerCase().includes('tardanza');

                                  return (
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                        isItemAbsence
                                          ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                                          : isItemLate
                                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                          : 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                      }`}
                                    >
                                      {item.action}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="text-[11px] font-semibold opacity-80">
                                  {(() => {
                                    const isItemAbsence =
                                      item.category === 'Ausencia' ||
                                      item.action === 'Ausencia' ||
                                      item.action?.toLowerCase().includes('ausencia') ||
                                      item.action?.toLowerCase().includes('falta');
                                    const isItemLate =
                                      item.category === 'Llegada tarde' ||
                                      item.action === 'Llegada tarde' ||
                                      item.action?.toLowerCase().includes('llegada tarde') ||
                                      item.action?.toLowerCase().includes('tarde') ||
                                      item.action?.toLowerCase().includes('tardanza');

                                    if (isItemAbsence) return 'Ausencia';
                                    if (isItemLate) return 'Tardanza';
                                    if (item.pointsChange !== undefined && item.pointsChange !== 0) {
                                      return `${item.pointsChange > 0 ? '+' : ''}${item.pointsChange} pto`;
                                    }
                                    return '-';
                                  })()}
                                </span>
                              </td>

                              {/* Columna Mensaje Enviado (con tick o botón para mandar si quedó pendiente) */}
                              <td className="py-3 px-4 text-center">
                                {item.category === 'Ausencia' || item.category === 'Disposición' ? (
                                  item.messageSent ? (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                      title={`Enviado por ${item.notificationMethod === 'gmail' ? 'Gmail' : 'Classroom'} (${item.notifiedAt || 'OK'})`}
                                    >
                                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                      <span>Enviado</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenNotifyModal(item, student || null)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer shadow-2xs"
                                      title={`Enviar aviso de ${item.category === 'Ausencia' ? 'inasistencia' : 'conducta'} al alumno ahora`}
                                    >
                                      <Send className="w-3 h-3" />
                                      <span>Mandar ahora</span>
                                    </button>
                                  )
                                ) : (
                                  <span className="text-[11px] text-neutral-400 dark:text-slate-500">—</span>
                                )}
                              </td>

                              {/* Columna Mensaje */}
                              <td className="py-3 px-4 max-w-xs">
                                {item.messageText ? (
                                  <p
                                    className="text-[11px] text-neutral-700 dark:text-slate-300 line-clamp-2"
                                    title={item.messageText}
                                  >
                                    {item.messageText}
                                  </p>
                                ) : (
                                  <span className="text-[11px] text-neutral-400 dark:text-slate-500 italic">
                                    {(item.category === 'Ausencia' || item.category === 'Disposición') ? 'Pendiente de envío' : 'N/A'}
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHistoryEntry(item)}
                                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                  title="Eliminar del historial, revertir puntuación y actualizar Google Sheets"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Barra inferior al final del historial: botón 'Enviar a todos' para notificaciones acumuladas a lo largo de la clase */}
                  <div
                    className={`px-4 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
                      isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-50 border-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                        Total en historial: <strong>{courseHistory.length}</strong> registro{courseHistory.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-neutral-400">•</span>
                      {pendingAllItems.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/70">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          {pendingAllItems.length} notificación{pendingAllItems.length === 1 ? '' : 'es'} pendiente{pendingAllItems.length === 1 ? '' : 's'} de la clase
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                          <Check className="w-3 h-3 text-emerald-600" />
                          Todos los avisos de la clase están enviados
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                      {selectedPendingHistoryIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleOpenBatchFromSelectedHistory}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer"
                          title="Enviar aviso a los registros seleccionados"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Enviar a seleccionados ({selectedPendingHistoryIds.length})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        id="btn-enviar-notificaciones-todos-tab3"
                        onClick={() => {
                          if (pendingAllItems.length === 0) {
                            setToastMessage('Todos los avisos de la clase ya han sido enviados (o no hay incidencias pendientes).');
                            setTimeout(() => setToastMessage(null), 3500);
                            return;
                          }
                          handleOpenBatchFromPending('all');
                        }}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold shadow-md transition-all cursor-pointer ${
                          pendingAllItems.length > 0
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:shadow-lg hover:scale-102 ring-2 ring-blue-500/30'
                            : 'bg-neutral-200 dark:bg-slate-700 text-neutral-600 dark:text-slate-300 hover:bg-neutral-300 dark:hover:bg-slate-600'
                        }`}
                        title="Enviar todas las notificaciones de ausencias y conductas acumuladas a lo largo de la clase a todos los alumnos correspondientes"
                      >
                        <Send className="w-4 h-4" />
                        <span>Enviar a todos</span>
                        {pendingAllItems.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white text-blue-700 shadow-xs">
                            {pendingAllItems.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

                {/* SUBTAB 2: RESUMEN DE ALUMNOS Y DISPOSICIÓN */}
                {historySubTab === 'summary' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead
                        className={`border-b font-semibold uppercase tracking-wider ${
                          isDarkMode
                            ? 'bg-slate-800/80 border-slate-800 text-slate-300'
                            : 'bg-neutral-100/70 border-neutral-200 text-neutral-600'
                        }`}
                      >
                        <tr>
                          <th className="py-3 px-4">Estudiante</th>
                          <th className="py-3 px-4 text-center">Total Ausencias</th>
                          <th className="py-3 px-4 text-center">Puntaje Disposición</th>
                          <th className="py-3 px-4">Último motivo de descuento</th>
                          <th className="py-3 px-4 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                        {courseStudents.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-12 px-4 text-center text-neutral-400">
                              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                              <p className="font-semibold">No hay estudiantes asignados a este curso.</p>
                            </td>
                          </tr>
                        ) : (
                          courseStudents.map((st) => {
                            const metrics = getStudentMetrics(st.id);
                            const studentIncidents = courseHistory.filter(
                              (h) => h.studentId === st.id && h.category === 'Disposición'
                            );
                            const lastIncident = studentIncidents[0]?.action || 'Sin conductas registradas';

                            return (
                              <tr
                                key={st.id}
                                className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50/70'}`}
                              >
                                <td className="py-3 px-4 font-semibold text-neutral-900 dark:text-white">
                                  {st.lastName}, {st.firstName}
                                </td>
                                <td className="py-3 px-4 text-center font-mono font-bold">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${
                                      metrics.totalAbsences > 0
                                        ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                        : 'bg-neutral-100 dark:bg-slate-800 text-neutral-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {metrics.totalAbsences}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-center font-mono font-bold">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${
                                      metrics.totalDisposition >= 8
                                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                        : metrics.totalDisposition >= 6
                                        ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                        : 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                    }`}
                                  >
                                    {metrics.totalDisposition} / 10
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-neutral-600 dark:text-slate-300">
                                  {lastIncident}
                                </td>
                                <td className="py-3 px-4 text-center">
                                  {metrics.totalDisposition >= 8 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Óptimo
                                    </span>
                                  ) : metrics.totalDisposition >= 6 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                      <AlertCircle className="w-3.5 h-3.5" /> Atención
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                                      <ShieldAlert className="w-3.5 h-3.5" /> Crítico
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: REGISTRAR CONDUCTA / RECONOCIMIENTO (SUMAR O RESTAR)    */}
      {/* ------------------------------------------------------------- */}
      {conductRecordModal.isOpen && conductRecordModal.student && (() => {
        const isAdd = conductRecordModal.mode === 'add';
        const currentPoints = conductRecordModal.points || 1;
        const currentStudent = conductRecordModal.student;
        const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
        const metrics = getStudentMetrics(currentStudent.id, targetTerm);
        const curDisp = metrics.totalDisposition !== undefined ? metrics.totalDisposition : 10;
        const projectedDisp = isAdd
          ? Math.min(10, curDisp + currentPoints)
          : Math.max(0, curDisp - currentPoints);

        const positiveSuggestions = [
          'Participación destacada',
          'Excelente trabajo en clase',
          'Colaboración con compañeros',
          'Tarea y materiales completos',
          'Compromiso y superación',
          ...teacherConductOptions.filter((opt) =>
            opt.startsWith('+') ||
            opt.startsWith('[+]') ||
            opt.includes('(+') ||
            /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(opt)
          ).map((o) => o.replace(/^(\+|\[\+\])\s*/, '')),
        ];

        const negativeSuggestions = [
          'Sin libro',
          'Falta de tarea',
          'Uso indebido de celular',
          'Interrupción de clase',
          'Falta de materiales',
          ...teacherConductOptions.filter((opt) =>
            !opt.startsWith('+') &&
            !opt.startsWith('[+]') &&
            !opt.includes('(+') &&
            !/^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(opt)
          ),
        ];

        const activeSuggestions = Array.from(new Set(isAdd ? positiveSuggestions : negativeSuggestions));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div
              className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
                isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
              }`}
            >
              {/* Modal Header */}
              <div className={`p-4 border-b flex items-center justify-between ${
                isDarkMode
                  ? isAdd ? 'border-slate-800 bg-emerald-950/20' : 'border-slate-800 bg-rose-950/20'
                  : isAdd ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/40'
              }`}>
                <div className="flex items-center gap-2">
                  {isAdd ? (
                    <Award className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-500" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {isAdd ? 'Sumar puntos de disposición' : 'Restar puntos de disposición'}
                    </h3>
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                      {isAdd ? 'Reconocimiento / conducta positiva' : 'Llamado de atención / falta de conducta'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConductRecordModal({ isOpen: false, student: null, mode: 'subtract', points: 1, customReason: '', saveToOptions: false })}
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleConfirmConductRecord} className="p-5 space-y-4">
                {/* Selector: Sumar o Restar puntos */}
                <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setConductRecordModal((prev) => ({ ...prev, mode: 'subtract' }))}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      !isAdd
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                    <span>Restar puntos (-)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConductRecordModal((prev) => ({ ...prev, mode: 'add' }))}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      isAdd
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Sumar puntos (+)</span>
                  </button>
                </div>

                {/* Info Estudiante y Vista Previa de Nota */}
                <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                  isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}>
                  <div>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 block font-medium">Estudiante:</span>
                    <strong className="text-sm font-bold">
                      {currentStudent.lastName}, {currentStudent.firstName}
                    </strong>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 block font-medium">Nota proyectada:</span>
                    <div className="inline-flex items-center gap-1 font-mono font-bold text-sm">
                      <span className="text-neutral-500">{curDisp}</span>
                      <span>→</span>
                      <span className={isAdd ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                        {projectedDisp}
                      </span>
                      <span className="text-neutral-400 text-xs font-normal">/ 10 pts</span>
                    </div>
                  </div>
                </div>

                {/* Cantidad de puntos */}
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300">
                    {isAdd ? 'Cantidad de puntos a sumar:' : 'Cantidad de puntos a restar:'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map((pts) => (
                      <button
                        key={pts}
                        type="button"
                        onClick={() => setConductRecordModal((prev) => ({ ...prev, points: pts }))}
                        className={`px-3 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                          currentPoints === pts
                            ? isAdd
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs scale-105'
                              : 'bg-rose-600 text-white border-rose-600 shadow-2xs scale-105'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {isAdd ? `+${pts}` : `-${pts}`} {pts === 1 ? 'punto' : 'puntos'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sugerencias rápidas según modo */}
                <div>
                  <label className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400 block mb-1.5">
                    {isAdd ? 'Opciones sugeridas de reconocimiento:' : 'Opciones habituales de conducta:'}
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                    {activeSuggestions.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setConductRecordModal((prev) => ({ ...prev, customReason: opt }))}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                          conductRecordModal.customReason === opt
                            ? isAdd
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                              : 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Motivo escrito */}
                <div>
                  <label className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400 block mb-1">
                    {isAdd ? 'Motivo del reconocimiento / puntos sumados:' : 'Motivo del llamado de atención:'}
                  </label>
                  <textarea
                    value={conductRecordModal.customReason}
                    onChange={(e) => setConductRecordModal((prev) => ({ ...prev, customReason: e.target.value }))}
                    placeholder={
                      isAdd
                        ? 'Escribí el motivo positivo (ej: Participación destacada, excelente trabajo en equipo, compromiso...)'
                        : 'Escribí el motivo (ej: Falta de tarea, no trajo materiales, uso de celular, interrupción...)'
                    }
                    rows={3}
                    autoFocus
                    required
                    className={`w-full p-3 rounded-xl border text-xs outline-none resize-none transition-all ${
                      isAdd ? 'focus:ring-2 focus:ring-emerald-500' : 'focus:ring-2 focus:ring-rose-500'
                    } ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                    }`}
                  />
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="saveToOptionsCheckbox"
                    checked={conductRecordModal.saveToOptions}
                    onChange={(e) => setConductRecordModal((prev) => ({ ...prev, saveToOptions: e.target.checked }))}
                    className={`w-4 h-4 rounded border-neutral-300 cursor-pointer ${
                      isAdd ? 'text-emerald-600 focus:ring-emerald-500' : 'text-rose-600 focus:ring-rose-500'
                    }`}
                  />
                  <label htmlFor="saveToOptionsCheckbox" className="text-xs text-neutral-600 dark:text-slate-300 cursor-pointer select-none">
                    Guardar este motivo en mis opciones para próximos registros
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setConductRecordModal({ isOpen: false, student: null, mode: 'subtract', points: 1, customReason: '', saveToOptions: false })}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                      isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!conductRecordModal.customReason.trim()}
                    className={`px-4 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 transition-all active:scale-95 ${
                      isAdd
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-rose-600 hover:bg-rose-700'
                    }`}
                  >
                    {isAdd ? (
                      <>
                        <Award className="w-3.5 h-3.5" />
                        <span>Sumar puntos (+{currentPoints} pto{currentPoints > 1 ? 's' : ''})</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Restar puntos (-{currentPoints} pto{currentPoints > 1 ? 's' : ''})</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: GESTIONAR OPCIONES DE CONDUCTA DEL PROFESOR            */}
      {/* ------------------------------------------------------------- */}
      {isManageConductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Modal Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-bold">Mis opciones de conducta</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsManageConductModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              <p className="text-xs text-neutral-600 dark:text-slate-300 leading-relaxed">
                Cada profesor puede definir sus propios motivos habituales de conducta para asignarlos con un solo clic a cualquier alumno.
              </p>

              {/* Form to add a new option */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = newConductInput.trim();
                  if (!trimmed) return;
                  const finalOpt = newConductType === 'add'
                    ? (trimmed.startsWith('+') ? trimmed : `+ ${trimmed}`)
                    : (trimmed.startsWith('+') ? trimmed.replace(/^\+\s*/, '') : trimmed);
                  handleAddConductOption(finalOpt);
                }}
                className="space-y-2"
              >
                <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setNewConductType('subtract')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      newConductType === 'subtract'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                    <span>Restar (-1 pto)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewConductType('add')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      newConductType === 'add'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Sumar (+1 pto)</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newConductInput}
                    onChange={(e) => setNewConductInput(e.target.value)}
                    placeholder={
                      newConductType === 'add'
                        ? 'Ej: Participación, Tarea completa, Buen compañerismo...'
                        : 'Ej: Falta de tarea, Sin carpeta, Uso de celular...'
                    }
                    className={`flex-1 px-3 py-2 rounded-xl border text-xs outline-none focus:ring-2 ${
                      newConductType === 'add' ? 'focus:ring-emerald-500' : 'focus:ring-rose-500'
                    } ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={!newConductInput.trim()}
                    className={`px-3 py-2 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                      newConductType === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar</span>
                  </button>
                </div>
              </form>

              {/* List of current options */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {teacherConductOptions.length === 0 ? (
                  <div className="py-6 text-center text-neutral-400 text-xs border border-dashed rounded-xl p-4">
                    <p>No tenés opciones guardadas todavía.</p>
                    <p className="text-[11px] mt-1 text-neutral-500">Agregá las tuyas arriba para verlas en los botones rápidos de cada alumno.</p>
                  </div>
                ) : (
                  teacherConductOptions.map((opt) => (
                    <div key={opt} className="space-y-1">
                      <div
                        className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${
                          isDarkMode ? 'bg-slate-800/80 border-slate-700 text-slate-200' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                        }`}
                      >
                        {editingConductOpt === opt ? (
                          <div className="flex items-center gap-1.5 flex-1 mr-2">
                            <input
                              type="text"
                              value={editConductInput}
                              onChange={(e) => setEditConductInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleEditConductOption(opt, editConductInput);
                                if (e.key === 'Escape') setEditingConductOpt(null);
                              }}
                              className={`flex-1 px-2.5 py-1 text-xs rounded-lg border outline-none ${
                                isDarkMode ? 'bg-slate-900 border-slate-600 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                              }`}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleEditConductOption(opt, editConductInput)}
                              className="p-1 text-emerald-600 hover:bg-emerald-500/10 rounded cursor-pointer"
                              title="Guardar cambio"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingConductOpt(null)}
                              className="p-1 text-neutral-400 hover:bg-neutral-500/10 rounded cursor-pointer"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              const isPositive =
                                opt.startsWith('+') ||
                                opt.startsWith('[+]') ||
                                opt.includes('(+') ||
                                /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(opt);
                              const cleanOptName = opt.replace(/^(\+|\[\+\])\s*/, '');
                              return (
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isPositive
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                                  }`}>
                                    {isPositive ? '+1 pto' : '-1 pto'}
                                  </span>
                                  <span className="font-medium">{cleanOptName}</span>
                                  {isReasonCustomized(opt) && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                                      <Sparkles className="w-2.5 h-2.5" />
                                      Mensaje propio
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingTemplateForReason === opt) {
                                    setEditingTemplateForReason(null);
                                  } else {
                                    setEditingTemplateForReason(opt);
                                    setReasonTemplateDraft(getTemplateForReason(opt));
                                  }
                                }}
                                className={`px-2 py-1 text-[11px] rounded-lg border flex items-center gap-1 cursor-pointer transition-colors ${
                                  editingTemplateForReason === opt
                                    ? 'bg-purple-600 border-purple-600 text-white font-semibold'
                                    : isReasonCustomized(opt)
                                    ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 font-medium'
                                    : isDarkMode
                                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                                }`}
                                title="Configurar mensaje predeterminado para este motivo"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>Mensaje</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingConductOpt(opt);
                                  setEditConductInput(opt);
                                }}
                                className="text-neutral-400 hover:text-blue-500 transition-colors p-1 rounded cursor-pointer"
                                title="Editar nombre de la opción"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteConductOption(opt)}
                                className="text-neutral-400 hover:text-red-500 transition-colors p-1 rounded cursor-pointer"
                                title="Eliminar opción"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Editor desplegable de mensaje predeterminado para esta opción */}
                      {editingTemplateForReason === opt && (
                        <div
                          className={`p-3 rounded-xl border space-y-2.5 text-xs animate-in fade-in duration-150 ${
                            isDarkMode
                              ? 'bg-purple-950/20 border-purple-800/60 text-slate-200'
                              : 'bg-purple-50/80 border-purple-200 text-purple-900'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold flex items-center gap-1.5 text-xs text-purple-800 dark:text-purple-300">
                              <Sparkles className="w-3.5 h-3.5" />
                              Mensaje por defecto para "{opt}"
                            </span>
                            {isReasonCustomized(opt) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  handleResetTemplateForReason(opt);
                                  setReasonTemplateDraft(getTemplateForReason(opt));
                                }}
                                className="text-[10px] text-rose-500 hover:underline cursor-pointer"
                              >
                                Restablecer a estándar
                              </button>
                            ) : (
                              <span className="text-[10px] text-neutral-400">Plantilla estándar</span>
                            )}
                          </div>

                          <textarea
                            rows={3}
                            value={reasonTemplateDraft}
                            onChange={(e) => setReasonTemplateDraft(e.target.value)}
                            placeholder="Escribe el mensaje que se cargará por defecto cuando un alumno tenga esta falta..."
                            className={`w-full p-2.5 rounded-lg border text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500/40 ${
                              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />

                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                            {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => setReasonTemplateDraft((prev) => `${prev} ${tag}`)}
                                className={`px-1.5 py-0.5 text-[10px] rounded border font-mono cursor-pointer ${
                                  isDarkMode ? 'bg-slate-800 border-slate-700 text-purple-300' : 'bg-white border-purple-200 text-purple-700'
                                }`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingTemplateForReason(null)}
                              className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${
                                isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                              }`}
                            >
                              Cerrar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleSaveTemplateForReason(opt, reasonTemplateDraft);
                                setEditingTemplateForReason(null);
                              }}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                            >
                              <Save className="w-3 h-3" />
                              <span>Guardar mensaje</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => setIsManageConductModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: HISTORIAL INDIVIDUAL DEL ESTUDIANTE                     */}
      {/* ------------------------------------------------------------- */}
      {selectedStudentForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Modal Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-3">
                <img
                  src={selectedStudentForHistory.avatar}
                  alt={selectedStudentForHistory.firstName}
                  className="w-9 h-9 rounded-full object-cover border border-neutral-300 dark:border-slate-700"
                />
                <div>
                  <h3 className="text-sm font-bold">
                    {selectedStudentForHistory.lastName}, {selectedStudentForHistory.firstName}
                  </h3>
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                    Historial de Conducta y Ausencias
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudentForHistory(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Summary badges */}
            <div className={`p-4 border-b grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-center text-xs ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-white'}`}>
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex flex-col items-center justify-between">
                <div>
                  <span className="text-[11px] text-red-600 dark:text-red-400 block font-medium">Ausencias</span>
                  <span className="text-base font-bold text-red-700 dark:text-red-300">
                    {getStudentMetrics(selectedStudentForHistory.id).totalAbsences}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 flex-wrap justify-center">
                  <button
                    type="button"
                    onClick={() => handleOpenEditAbsences(selectedStudentForHistory)}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 cursor-pointer shadow-2xs transition-colors inline-flex items-center gap-1"
                    title="Editar cantidad de faltas de este estudiante (pasar de papel, marcar fecha y avisar)"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                    <span>Editar faltas</span>
                  </button>
                  {getStudentMetrics(selectedStudentForHistory.id).totalAbsences > 0 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteLatestAbsence(selectedStudentForHistory)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 cursor-pointer shadow-2xs transition-colors"
                      title="Eliminar la última falta registrada de este estudiante y actualizar total"
                    >
                      Borrar última
                    </button>
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex flex-col items-center justify-between">
                <div>
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 block font-medium">Llegadas Tarde</span>
                  <span className="text-base font-bold text-amber-700 dark:text-amber-300">
                    {getStudentMetrics(selectedStudentForHistory.id).totalLates || 0}
                  </span>
                </div>
                {(getStudentMetrics(selectedStudentForHistory.id).totalLates || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteLatestLate(selectedStudentForHistory)}
                    className="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 cursor-pointer shadow-2xs transition-colors"
                    title="Eliminar la última llegada tarde de este estudiante y actualizar total"
                  >
                    Borrar tardanza
                  </button>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex flex-col items-center justify-between">
                <div>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block font-medium">Puntaje Disposición</span>
                  <span className="text-base font-bold text-emerald-700 dark:text-emerald-300">
                    {getStudentMetrics(selectedStudentForHistory.id).totalDisposition} / 10
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenEditDisposition(selectedStudentForHistory);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 cursor-pointer shadow-2xs transition-all active:scale-95"
                    title="Editar o fijar manualmente la nota de disposición de este alumno"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Editar nota de disposición</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResetSingleStudentDisposition(selectedStudentForHistory, true)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 cursor-pointer shadow-2xs transition-colors"
                    title="Borra la disposición y elimina las anotaciones de conducta de este alumno"
                  >
                    Borrar historial
                  </button>
                </div>
              </div>
            </div>

            {/* List of events */}
            <div className="p-4 overflow-y-auto space-y-2 text-xs flex-1">
              {historyList.filter((h) => h.studentId === selectedStudentForHistory.id).length === 0 ? (
                <div className="py-8 text-center text-neutral-400">
                  <p>No hay conductas ni incidencias registradas para este estudiante.</p>
                </div>
              ) : (
                historyList
                  .filter((h) => h.studentId === selectedStudentForHistory.id)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-neutral-900 dark:text-white">{item.action}</p>
                          {(item.category === 'Ausencia' || item.category === 'Disposición') && (
                            item.messageSent ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                title={`Notificación enviada por ${item.notificationMethod === 'gmail' ? 'Gmail' : 'Classroom'} (${item.notifiedAt || 'OK'})`}
                              >
                                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                <span>Aviso enviado</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenNotifyModal(item, selectedStudentForHistory)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer shadow-2xs"
                                title={`Enviar aviso de ${item.category === 'Ausencia' ? 'inasistencia' : 'conducta'} al estudiante`}
                              >
                                <Send className="w-2.5 h-2.5" />
                                <span>Mandar aviso</span>
                              </button>
                            )
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5 font-mono">
                          {item.date} a las {item.time}
                        </p>
                        {item.messageText && (
                          <p className="text-[11px] text-neutral-600 dark:text-slate-300 mt-1 italic border-l-2 border-blue-400 pl-2">
                            "{item.messageText}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {(() => {
                          const isItemAbsence =
                            item.category === 'Ausencia' ||
                            item.action === 'Ausencia' ||
                            item.action?.toLowerCase().includes('ausencia') ||
                            item.action?.toLowerCase().includes('falta');
                          const isItemLate =
                            item.category === 'Llegada tarde' ||
                            item.action === 'Llegada tarde' ||
                            item.action?.toLowerCase().includes('llegada tarde') ||
                            item.action?.toLowerCase().includes('tarde') ||
                            item.action?.toLowerCase().includes('tardanza');

                          return (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isItemAbsence
                                  ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                  : isItemLate
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                  : 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                              }`}
                            >
                              {isItemAbsence
                                ? 'Ausencia'
                                : isItemLate
                                ? 'Tardanza'
                                : item.pointsChange !== undefined && item.pointsChange !== 0
                                ? `${item.pointsChange > 0 ? '+' : ''}${item.pointsChange} pto`
                                : '-'}
                            </span>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => handleDeleteHistoryEntry(item)}
                          className="p-1 text-neutral-400 hover:text-red-500 rounded cursor-pointer"
                          title="Eliminar este registro y restaurar puntuación"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => setSelectedStudentForHistory(null)}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: MANDAR NOTAS DE DISPOSICIÓN A CALIFICACIONES          */}
      {/* ------------------------------------------------------------- */}
      {isSendDispositionModalOpen && (() => {
        const activeTargetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
        const activeTermLabel = activeTargetTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div
              className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 max-h-[90vh] flex flex-col ${
                isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
              }`}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Mandar Notas de Disposición a Calificaciones</h3>
                    <p className="text-xs text-neutral-500 dark:text-slate-400">
                      Materia: <strong className="text-neutral-700 dark:text-slate-200">{activeCourse.name}</strong> • Destino: <strong className="text-blue-600 dark:text-blue-400">{activeTermLabel}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSendDispositionModalOpen(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Description */}
              <p className="text-xs text-neutral-600 dark:text-slate-300 leading-relaxed">
                Esta función transfiere la nota de conducta y disposición (escala 1 a 10) de todos los estudiantes directamente a la pestaña de <strong>Calificaciones</strong> del <strong>{activeTermLabel}</strong> (según el cuatrimestre seleccionado en la planilla de asistencia).
              </p>

              {/* Target Banner */}
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                  activeTargetTerm === '1c'
                    ? isDarkMode
                      ? 'bg-blue-950/40 border-blue-800/80 text-blue-200'
                      : 'bg-blue-50/80 border-blue-200 text-blue-900'
                    : isDarkMode
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                }`}
              >
                <Info className="w-4 h-4 shrink-0" />
                <span className="text-[11px] leading-relaxed">
                  Se actualizará o creará automáticamente la columna <strong>"Nota de Disposición"</strong> dentro de <strong>Calificaciones</strong> para el <strong>{activeTermLabel}</strong>.
                </span>
              </div>

              {/* Preview of Students */}
              <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between text-xs font-semibold px-1">
                  <span>Vista previa ({courseStudents.length} estudiantes)</span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400">Nota a transferir ({activeTermLabel})</span>
                </div>
                <div
                  className={`flex-1 overflow-y-auto max-h-48 rounded-xl border divide-y p-1 ${
                    isDarkMode ? 'bg-slate-950/60 border-slate-800 divide-slate-800/60' : 'bg-neutral-50 border-neutral-200 divide-neutral-100'
                  }`}
                >
                  {courseStudents.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-500 dark:text-slate-400">
                      No hay estudiantes registrados en este curso.
                    </div>
                  ) : (
                    courseStudents.map((st) => {
                      const metrics = getStudentMetrics(st.id, activeTargetTerm);
                      return (
                        <div key={st.id} className="flex items-center justify-between py-1.5 px-2.5 text-xs">
                          <span className="font-medium truncate mr-2">
                            {st.lastName}, {st.firstName}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                              metrics.totalDisposition >= 8
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : metrics.totalDisposition >= 6
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            }`}
                          >
                            {metrics.totalDisposition} / 10
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSendDispositionModalOpen(false)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendDispositionToGrades(activeTargetTerm, false)}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-all"
                  >
                    Mandar a Calificaciones ({activeTermLabel})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendDispositionToGrades(activeTargetTerm, true)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-all flex items-center gap-1.5"
                    title="Mandar notas y abrir inmediatamente la pestaña Calificaciones"
                  >
                    <span>Mandar e Ir a Calificaciones</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: EDITAR NOTA DE DISPOSICIÓN DE UN ALUMNO (MANUAL/PAPEL) */}
      {/* ------------------------------------------------------------- */}
      {editingDispositionStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Nota de Disposición</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    Estudiante: <strong className="text-neutral-900 dark:text-slate-100">{editingDispositionStudent.lastName}, {editingDispositionStudent.firstName}</strong>
                    {activeCourse && ` • ${activeCourse.name}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingDispositionStudent(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Banner explicativo para notas en papel */}
            <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 text-xs flex items-start gap-2.5">
              <span className="text-base leading-none">📝</span>
              <p className="text-neutral-700 dark:text-slate-300 leading-relaxed">
                <strong>Carga manual o notas en papel:</strong> Podés definir directamente la nota de disposición de este estudiante. Es ideal si ese día no usaste computadora en clase o tomaste apuntes en papel y querés pasarlo al sistema.
              </p>
            </div>

            {/* Selector de Cuatrimestre */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Cuatrimestre a modificar:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleChangeEditingTerm('1c')}
                  className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                    editingDispositionTerm === '1c'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <span>1° Cuatrimestre</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      editingDispositionTerm === '1c'
                        ? 'bg-white/20 text-white'
                        : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                    }`}
                  >
                    Actual: {getStudentMetrics(editingDispositionStudent.id, '1c').totalDisposition}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleChangeEditingTerm('2c')}
                  className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                    editingDispositionTerm === '2c'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <span>2° Cuatrimestre</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      editingDispositionTerm === '2c'
                        ? 'bg-white/20 text-white'
                        : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                    }`}
                  >
                    Actual: {getStudentMetrics(editingDispositionStudent.id, '2c').totalDisposition}
                  </span>
                </button>
              </div>
            </div>

            {/* Input de la Nota de Disposición */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Nueva Nota de Disposición (0 a 10 puntos):
                </label>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Inicia en 10
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={editingDispositionScore}
                    onChange={(e) => setEditingDispositionScore(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
                        handleSaveStudentDisposition(currentIndex < filteredStudents.length - 1);
                      }
                    }}
                    autoFocus
                    placeholder="10"
                    className={`w-full px-4 py-2.5 rounded-xl border text-lg font-bold text-center outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                        : 'bg-white border-neutral-300 text-neutral-900 focus:border-indigo-500 shadow-inner'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 dark:text-slate-500">
                    / 10 pts
                  </span>
                </div>
              </div>

              {/* Botones rápidos de selección (10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0) */}
              <div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-slate-400 block mb-1">
                  Selección rápida:
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((num) => {
                    const isSelected = String(num) === editingDispositionScore;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setEditingDispositionScore(String(num))}
                        className={`h-7 min-w-7 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 scale-105 shadow-2xs'
                            : num >= 8
                            ? isDarkMode
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/60'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : num >= 6
                            ? isDarkMode
                              ? 'bg-amber-950/40 text-amber-300 border-amber-800/60 hover:bg-amber-900/60'
                              : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                            : isDarkMode
                            ? 'bg-red-950/40 text-red-300 border-red-800/60 hover:bg-red-900/60'
                            : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                        }`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Motivo u observación opcional */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Observación / Motivo (opcional):
              </label>
              <input
                type="text"
                value={editingDispositionReason}
                onChange={(e) => setEditingDispositionReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
                    handleSaveStudentDisposition(currentIndex < filteredStudents.length - 1);
                  }
                }}
                placeholder="Ej: Registro en papel, trabajo en clase, compromiso, etc."
                className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                {[
                  'Pasado de papel',
                  'Participación en clase',
                  'Trabajo práctico',
                  'Comportamiento',
                  'Restablecer a 10',
                ].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setEditingDispositionReason(tag)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                      editingDispositionReason === tag
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                        : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                    }`}
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Footer con Navegación y Acciones */}
            {(() => {
              const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
              const hasPrev = currentIndex > 0;
              const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

              return (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-neutral-100 dark:border-slate-800">
                  {/* Navegación entre alumnos */}
                  <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={() => handleNavigateEditStudent(-1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ir al alumno anterior"
                    >
                      ← Anterior
                    </button>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium">
                      {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={() => handleNavigateEditStudent(1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ir al alumno siguiente"
                    >
                      Siguiente →
                    </button>
                  </div>

                  {/* Botones de acción */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingDispositionStudent(null)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      Cancelar
                    </button>
                    {hasNext && (
                      <button
                        type="button"
                        onClick={() => handleSaveStudentDisposition(true)}
                        className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                        title="Guardar la nota de este alumno y pasar al siguiente en la lista"
                      >
                        <span>Guardar y siguiente</span>
                        <span>→</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSaveStudentDisposition(false)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar nota</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: EDITAR CANTIDAD DE FALTAS (PASAR DE PAPEL / FECHA / MENSAJE) */}
      {/* ------------------------------------------------------------- */}
      {editingAbsenceStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Inasistencias del Alumno</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    Estudiante: <strong className="text-neutral-900 dark:text-slate-100">{editingAbsenceStudent.lastName}, {editingAbsenceStudent.firstName}</strong>
                    {activeCourse && ` • ${activeCourse.name}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingAbsenceStudent(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Banner explicativo */}
            <div className="p-3 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs flex items-start gap-2.5">
              <span className="text-base leading-none">📋</span>
              <p className="text-neutral-700 dark:text-slate-300 leading-relaxed">
                <strong>Tomaste asistencia en papel:</strong> Podés definir directamente el total de faltas acumuladas, elegir el día exacto en que faltó (incluso fechas anteriores) y enviar el aviso por Classroom o Gmail aunque haya sido otro día.
              </p>
            </div>

            {/* Selector de Cuatrimestre */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Cuatrimestre a modificar:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleChangeEditingAbsenceTerm('1c')}
                  className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                    editingAbsenceTerm === '1c'
                      ? 'bg-red-600 text-white border-red-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <span>1° Cuatrimestre</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      editingAbsenceTerm === '1c'
                        ? 'bg-white/20 text-white'
                        : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                    }`}
                  >
                    Actual: {getStudentMetrics(editingAbsenceStudent.id, '1c').totalAbsences}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleChangeEditingAbsenceTerm('2c')}
                  className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                    editingAbsenceTerm === '2c'
                      ? 'bg-red-600 text-white border-red-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <span>2° Cuatrimestre</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      editingAbsenceTerm === '2c'
                        ? 'bg-white/20 text-white'
                        : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                    }`}
                  >
                    Actual: {getStudentMetrics(editingAbsenceStudent.id, '2c').totalAbsences}
                  </span>
                </button>
              </div>
            </div>

            {/* Input de Cantidad Total de Faltas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Cantidad Total de Inasistencias:
                </label>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Número de clases ausente
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const currentVal = parseInt(editingAbsenceCount, 10) || 0;
                    setEditingAbsenceCount(String(Math.max(0, currentVal - 1)));
                  }}
                  className="w-10 h-10 rounded-xl border border-neutral-300 dark:border-slate-700 flex items-center justify-center font-bold text-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                  title="Restar 1 falta"
                >
                  -
                </button>

                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingAbsenceCount}
                    onChange={(e) => setEditingAbsenceCount(e.target.value)}
                    placeholder="0"
                    className={`w-full px-4 py-2.5 rounded-xl border text-lg font-bold text-center outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white focus:border-red-500'
                        : 'bg-white border-neutral-300 text-neutral-900 focus:border-red-500 shadow-inner'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 dark:text-slate-500">
                    {parseInt(editingAbsenceCount, 10) === 1 ? 'falta' : 'faltas'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const currentVal = parseInt(editingAbsenceCount, 10) || 0;
                    setEditingAbsenceCount(String(currentVal + 1));
                  }}
                  className="w-10 h-10 rounded-xl border border-neutral-300 dark:border-slate-700 flex items-center justify-center font-bold text-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                  title="Sumar 1 falta"
                >
                  +
                </button>
              </div>

              {/* Botones rápidos de selección de faltas */}
              <div className="flex flex-wrap items-center gap-1 pt-1">
                <span className="text-[10px] text-neutral-500 dark:text-slate-400 mr-1 font-medium">Accesos rápidos:</span>
                {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setEditingAbsenceCount(String(num))}
                    className={`h-6 min-w-6 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                      editingAbsenceCount === String(num)
                        ? 'bg-red-600 text-white border-red-600 scale-105'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                        : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Fecha en que el alumno faltó (permite marcar fecha retroactiva) */}
            <div className="space-y-1.5 p-3 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50/70 dark:bg-slate-850">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-red-500" />
                  <span>Día en que el alumno faltó:</span>
                </label>
                <span className="text-[10px] text-neutral-500 dark:text-slate-400">
                  Podés elegir una fecha anterior
                </span>
              </div>
              <input
                type="date"
                value={editingAbsenceDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditingAbsenceDate(val);
                  if (val && editingAbsenceStudent) {
                    const parts = val.split('-');
                    if (parts.length === 3) {
                      const dmy = `${parts[2]}/${parts[1]}/${parts[0]}`;
                      const defaultAbsenceTpl =
                        savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
                        notifSettings.templateClassroom ||
                        DEFAULT_ABSENCE_PRESETS[0].text;
                      const updatedMsg = formatTemplateForStudent(
                        defaultAbsenceTpl,
                        editingAbsenceStudent,
                        activeCourse.name,
                        getStudentMetrics(editingAbsenceStudent.id, editingAbsenceTerm).totalDisposition,
                        dmy
                      );
                      setEditingAbsenceMessageText(updatedMsg);
                    }
                  }
                }}
                className={`w-full px-3 py-2 rounded-xl border text-xs font-medium outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    setEditingAbsenceDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    setEditingAbsenceDate(`${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
                >
                  Ayer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const lastWeek = new Date();
                    lastWeek.setDate(lastWeek.getDate() - 7);
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    setEditingAbsenceDate(`${lastWeek.getFullYear()}-${pad(lastWeek.getMonth() + 1)}-${pad(lastWeek.getDate())}`);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
                >
                  Hace 7 días
                </button>
              </div>
            </div>

            {/* Motivo o aclaración */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Aclaración / Motivo (opcional):
              </label>
              <input
                type="text"
                value={editingAbsenceReason}
                onChange={(e) => setEditingAbsenceReason(e.target.value)}
                placeholder="Ej: Pasado de planilla en papel, clase recuperatoria, etc."
                className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                {[
                  'Pasado de planilla en papel',
                  'Inasistencia justificada',
                  'Falta sin avisar',
                  'Ajuste de error',
                ].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setEditingAbsenceReason(tag)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                      editingAbsenceReason === tag
                        ? 'bg-red-600 text-white border-red-600'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                        : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                    }`}
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Opción para enviar mensaje al alumno (aunque no haya sido el mismo día) */}
            <div className={`p-3.5 rounded-xl border transition-all space-y-3 ${
              editingAbsenceSendNotif
                ? isDarkMode
                  ? 'bg-blue-950/30 border-blue-800/80'
                  : 'bg-blue-50/70 border-blue-200'
                : isDarkMode
                ? 'bg-slate-800/40 border-slate-700'
                : 'bg-neutral-50 border-neutral-200'
            }`}>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingAbsenceSendNotif}
                  onChange={(e) => setEditingAbsenceSendNotif(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-neutral-900 dark:text-slate-100 block">
                    Enviar mensaje/aviso al alumno sobre esta falta
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400 block">
                    Permite notificar al estudiante por Classroom o Gmail aunque la falta haya sido un día anterior
                  </span>
                </div>
              </label>

              {editingAbsenceSendNotif && (
                <div className="space-y-3 pt-2 border-t border-blue-200/60 dark:border-blue-900/40 animate-in fade-in duration-150">
                  {/* Selector de canal */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingAbsenceChannel('classroom')}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                        editingAbsenceChannel === 'classroom'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-white text-neutral-700 border-neutral-200'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Tablón Classroom</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingAbsenceChannel('gmail')}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                        editingAbsenceChannel === 'gmail'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-white text-neutral-700 border-neutral-200'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      <span>Correo Gmail</span>
                    </button>
                  </div>

                  {/* Cuadro de texto para editar el mensaje */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                        Mensaje a enviar:
                      </label>
                      <span className="text-[10px] text-neutral-400">Podés editar este texto antes de enviar</span>
                    </div>
                    <textarea
                      rows={3}
                      value={editingAbsenceMessageText}
                      onChange={(e) => setEditingAbsenceMessageText(e.target.value)}
                      placeholder="Escribe el mensaje..."
                      className={`w-full p-2.5 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                        isDarkMode
                          ? 'bg-slate-850 border-slate-700 text-white placeholder-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer con Navegación y Acciones */}
            {(() => {
              const currentIndex = filteredStudents.findIndex((s) => s.id === editingAbsenceStudent.id);
              const hasPrev = currentIndex > 0;
              const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

              return (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-neutral-100 dark:border-slate-800">
                  {/* Navegación entre alumnos */}
                  <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                    <button
                      type="button"
                      disabled={!hasPrev || isSavingAbsenceEdit}
                      onClick={() => handleNavigateEditAbsenceStudent(-1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ir al alumno anterior"
                    >
                      ← Anterior
                    </button>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium">
                      {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext || isSavingAbsenceEdit}
                      onClick={() => handleNavigateEditAbsenceStudent(1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ir al alumno siguiente"
                    >
                      Siguiente →
                    </button>
                  </div>

                  {/* Botones de acción */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      disabled={isSavingAbsenceEdit}
                      onClick={() => setEditingAbsenceStudent(null)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      Cancelar
                    </button>
                    {hasNext && (
                      <button
                        type="button"
                        disabled={isSavingAbsenceEdit}
                        onClick={() => handleSaveStudentAbsences(true)}
                        className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                        title="Guardar las faltas de este alumno y pasar al siguiente en la lista"
                      >
                        <span>Guardar y siguiente</span>
                        <span>→</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isSavingAbsenceEdit}
                      onClick={() => handleSaveStudentAbsences(false)}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                    >
                      {isSavingAbsenceEdit ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>{isSavingAbsenceEdit ? 'Guardando...' : 'Guardar faltas'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: FICHA DEL ESTUDIANTE Y OBSERVACIONES DOCENTE (INFORMES) */}
      {/* ------------------------------------------------------------- */}
      {selectedStudentForProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header: Datos del alumno */}
            <div className={`p-5 border-b flex items-start justify-between gap-4 ${isDarkMode ? 'border-slate-800 bg-slate-900/80' : 'border-neutral-200 bg-neutral-50/70'}`}>
              <div className="flex items-center gap-3.5">
                <img
                  src={selectedStudentForProfile.avatar}
                  alt={selectedStudentForProfile.firstName}
                  className={`w-14 h-14 rounded-2xl object-cover border-2 shadow-xs shrink-0 ${
                    isDarkMode ? 'border-indigo-500/40' : 'border-indigo-200'
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold">
                      {selectedStudentForProfile.lastName}, {selectedStudentForProfile.firstName}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      Ficha del Alumno
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {!isEditingStudentEmail ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-neutral-500 dark:text-slate-400 font-mono">
                          {selectedStudentForProfile.email || 'Sin correo registrado'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditedStudentEmail(selectedStudentForProfile.email || '');
                            setIsEditingStudentEmail(true);
                          }}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                          title="Modificar correo electrónico"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                          <span>Editar correo</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="email"
                          value={editedStudentEmail}
                          onChange={(e) => setEditedStudentEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="px-2 py-0.5 text-xs rounded border border-blue-400 bg-white dark:bg-slate-800 text-neutral-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={handleSaveEditedStudentEmail}
                          className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white cursor-pointer"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingStudentEmail(false)}
                          className="px-1.5 py-0.5 rounded text-[10px] text-neutral-400 hover:text-neutral-600 cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenDirectMessageModal(selectedStudentForProfile)}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:hover:bg-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Mail className="w-3 h-3 text-blue-500" />
                      <span>Enviar mensaje</span>
                    </button>
                  </div>
                  {activeCourse && (
                    <p className="text-xs text-neutral-600 dark:text-slate-300 mt-1 font-medium">
                      Materia: <span className="font-semibold">{activeCourse.name}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudentForProfile(null)}
                className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Cerrar ficha"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumen rápido de asistencia y conducta */}
            {(() => {
              const metrics1c = getStudentMetrics(selectedStudentForProfile.id, '1c');
              const metrics2c = getStudentMetrics(selectedStudentForProfile.id, '2c');
              const currentDisp = getStudentMetrics(selectedStudentForProfile.id, attendanceTerm).totalDisposition;

              return (
                <div className={`px-5 py-3 border-b grid grid-cols-3 gap-2 text-center text-xs ${
                  isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-100 bg-white'
                }`}>
                  <div className="p-2 rounded-xl bg-neutral-100/70 dark:bg-slate-800/60 flex flex-col items-center justify-between">
                    <div>
                      <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">Inasistencias</span>
                      <span className="text-sm font-bold text-red-600 dark:text-red-400">
                        {metrics1c.totalAbsences + metrics2c.totalAbsences}
                      </span>
                      <span className="text-[10px] text-neutral-400 block">
                        (1°C: {metrics1c.totalAbsences} • 2°C: {metrics2c.totalAbsences})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenEditAbsences(selectedStudentForProfile)}
                      className="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 cursor-pointer shadow-2xs transition-colors inline-flex items-center gap-1"
                      title="Editar cantidad de faltas (pasar de papel, marcar fecha y enviar aviso)"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>Editar faltas</span>
                    </button>
                  </div>

                  <div className="p-2 rounded-xl bg-neutral-100/70 dark:bg-slate-800/60">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">Llegadas Tarde</span>
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                      {(metrics1c.totalLates || 0) + (metrics2c.totalLates || 0)}
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      (1°C: {metrics1c.totalLates || 0} • 2°C: {metrics2c.totalLates || 0})
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-neutral-100/70 dark:bg-slate-800/60">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">Disposición ({attendanceTerm === '2c' ? '2°C' : attendanceTerm === '1c' ? '1°C' : 'Anual'})</span>
                    <span className={`text-sm font-bold ${
                      currentDisp >= 8 ? 'text-emerald-600 dark:text-emerald-400' : currentDisp >= 6 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {currentDisp} / 10
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      (1°C: {metrics1c.totalDisposition} • 2°C: {metrics2c.totalDisposition})
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Content: Observaciones e Informes */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Formulario Agregar Observación */}
              <div className={`p-3.5 rounded-2xl border space-y-2.5 ${
                isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-indigo-50/40 border-indigo-100'
              }`}>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-neutral-900 dark:text-slate-100">
                    Agregar Observación o Informe
                  </span>
                </div>

                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={newObservationText}
                    onChange={(e) => setNewObservationText(e.target.value)}
                    placeholder="Escribí una observación (ej: Presentó informe psicopedagógico con adecuaciones, observación de conducta, acuerdo con la familia)..."
                    className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden resize-none transition-all focus:ring-2 focus:ring-indigo-500 ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                    }`}
                  />

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Link className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        value={newObservationUrl}
                        onChange={(e) => setNewObservationUrl(e.target.value)}
                        placeholder="Pegar enlace al informe (ej: Google Drive, Docs, PDF) - opcional"
                        className={`w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                            : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                        }`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!newObservationText.trim() && !newObservationUrl.trim()}
                      onClick={() => handleSaveObservation(selectedStudentForProfile)}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center gap-1 active:scale-95 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Guardar</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Lista de Observaciones Guardadas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-neutral-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span>Observaciones registradas</span>
                    <span className="text-[11px] font-normal text-neutral-400">
                      ({studentObservations[selectedStudentForProfile.id]?.length || 0})
                    </span>
                  </h4>
                </div>

                {(!studentObservations[selectedStudentForProfile.id] || studentObservations[selectedStudentForProfile.id].length === 0) ? (
                  <div className="py-6 text-center text-neutral-400 dark:text-slate-500 border border-dashed rounded-xl p-4">
                    <p className="text-xs">No hay observaciones registradas para este estudiante.</p>
                    <p className="text-[11px] opacity-75 mt-0.5">
                      Podés escribir anotaciones de conducta o pegar el enlace a su informe psicopedagógico arriba.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {studentObservations[selectedStudentForProfile.id].map((obs) => (
                      <div
                        key={obs.id}
                        className={`p-3 rounded-xl border transition-all ${
                          isDarkMode
                            ? 'bg-slate-800/40 border-slate-700/80 hover:bg-slate-800/60'
                            : 'bg-white border-neutral-200 hover:border-neutral-300 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-[10px] text-neutral-400 dark:text-slate-500 font-medium">
                            📅 {obs.date}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteObservation(selectedStudentForProfile.id, obs.id)}
                            className="text-neutral-400 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer"
                            title="Eliminar observación"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {obs.text && (
                          <p className="text-xs text-neutral-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                            {obs.text}
                          </p>
                        )}

                        {obs.reportUrl && (
                          <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-slate-700/60 flex items-center justify-between gap-2">
                            <a
                              href={obs.reportUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 transition-colors shadow-2xs"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Abrir informe / documento</span>
                            </a>
                            <span className="text-[10px] text-neutral-400 truncate max-w-[200px]" title={obs.reportUrl}>
                              {obs.reportUrl}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer con Navegación entre alumnos */}
            {(() => {
              const currentIndex = filteredStudents.findIndex((s) => s.id === selectedStudentForProfile.id);
              const hasPrev = currentIndex > 0;
              const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

              return (
                <div className={`p-4 border-t flex items-center justify-between gap-2 ${
                  isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50/60'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={() => handleNavigateProfileStudent(-1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ver ficha del alumno anterior"
                    >
                      ← Anterior
                    </button>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium px-1">
                      {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={() => handleNavigateProfileStudent(1)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title="Ver ficha del alumno siguiente"
                    >
                      Siguiente →
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCourseReportModalStudentId(selectedStudentForProfile.id);
                        setCourseReportModalTab('individual');
                        setCourseReportModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 transition-colors cursor-pointer"
                      title="Ver e imprimir boletín individual de 1 página"
                    >
                      <Printer className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                      <span>Ficha 1 Pág.</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedStudentForProfile(null)}
                      className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold shadow-xs cursor-pointer transition-colors"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 1: SINCRONIZAR / SELECCIONAR CON GOOGLE CALENDAR        */}
      {/* ------------------------------------------------------------- */}
      {isCalendarModalOpen && calendarModalCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-5 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Sincronizar con Google Calendar</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    {calendarModalCourse.name} • {calendarModalCourse.grade}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCalendarModalOpen(false);
                  setCalendarModalCourse(null);
                }}
                className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveCalendarSelection} className="p-5 space-y-4">
              {/* Eventos detectados en Google Calendar */}
              <div className={`p-3.5 rounded-xl border ${
                isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-blue-50/50 border-blue-100'
              }`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-bold text-blue-900 dark:text-blue-300">
                      Módulos de tu Google Calendar
                    </span>
                  </div>
                  {isLoadingSlots && (
                    <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      Consultando eventos...
                    </span>
                  )}
                </div>

                {calendarSlots.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400 mb-1">
                      Hacé clic para tildar o destildar los módulos de esta materia:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {calendarSlots.map((slot) => {
                        const isSelected = calendarScheduleSelection.includes(slot.displayText);
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                const updated = calendarScheduleSelection
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter((s) => s !== slot.displayText)
                                  .join(', ');
                                setCalendarScheduleSelection(updated);
                              } else {
                                setCalendarScheduleSelection((prev) =>
                                  prev ? `${prev}, ${slot.displayText}` : slot.displayText
                                );
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border text-left transition-all cursor-pointer flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                : isDarkMode
                                ? 'bg-slate-700/80 hover:bg-slate-700 text-slate-200 border-slate-600'
                                : 'bg-white hover:bg-neutral-100 text-neutral-800 border-neutral-200'
                            }`}
                          >
                            <span>{isSelected ? '✓' : '+'}</span>
                            <span className="font-bold">{slot.displayText}</span>
                            <span className="opacity-70 text-[10px] truncate max-w-[100px]">({slot.title})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {isLoadingSlots
                      ? 'Buscando eventos en tu calendario...'
                      : 'No se detectaron eventos con horario en esta semana. Podés elegir un atajo de abajo o escribirlo directamente.'}
                  </p>
                )}
              </div>

              {/* Atajos de Módulos Escolares */}
              <div>
                <span className="block text-[11px] font-semibold text-neutral-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  O seleccionar atajo de módulo escolar
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Lunes 07:45 - 09:15',
                    'Martes 08:00 - 09:30',
                    'Miércoles 10:00 - 11:30',
                    'Jueves 09:30 - 11:00',
                    'Viernes 08:00 - 11:00',
                    'Martes y Jueves 08:00 - 09:30',
                    'Lunes y Miércoles 10:15 - 11:45',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        if (!calendarScheduleSelection) {
                          setCalendarScheduleSelection(preset);
                        } else if (!calendarScheduleSelection.includes(preset)) {
                          setCalendarScheduleSelection(`${calendarScheduleSelection}, ${preset}`);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'border-slate-800 bg-slate-800/60 hover:bg-slate-700 text-slate-300'
                          : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Campo con el horario seleccionado */}
              <div>
                <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                  Horario Seleccionado para la Materia
                </label>
                <input
                  type="text"
                  value={calendarScheduleSelection}
                  onChange={(e) => setCalendarScheduleSelection(e.target.value)}
                  placeholder="Ej: Martes 08:00 - 09:30, Jueves 10:00 - 11:30"
                  className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />
              </div>

              {/* Checkbox de sincronización bidireccional */}
              <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                isDarkMode ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="syncBidirectionalCheckbox"
                    checked={syncToGoogleFromModal}
                    onChange={(e) => setSyncToGoogleFromModal(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-emerald-300 cursor-pointer"
                  />
                  <label htmlFor="syncBidirectionalCheckbox" className="text-xs font-medium cursor-pointer">
                    <span className="font-bold">Sincronización bidireccional:</span> Actualizar o crear automáticamente las clases semanales en Google Calendar.
                  </label>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsCalendarModalOpen(false);
                    setCalendarModalCourse(null);
                  }}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!calendarScheduleSelection.trim() || isSavingCalendarSelection}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
                >
                  {isSavingCalendarSelection && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  <span>{isSavingCalendarSelection ? 'Guardando...' : 'Confirmar Horario'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 2: EDITAR DETALLES ESPECÍFICOS DEL CURSO                */}
      {/* ------------------------------------------------------------- */}
      {isEditCourseModalOpen && editCourseData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-5 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Editar Datos de la Materia</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">Modificá aula, división, asignatura y nombre</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditCourseModalOpen(false);
                  setEditCourseData(null);
                }}
                className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveCourseDetails} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Nombre del Curso / Materia
                  </label>
                  <input
                    type="text"
                    value={editCourseData.name}
                    onChange={(e) => setEditCourseData({ ...editCourseData, name: e.target.value })}
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Asignatura / Especialidad
                  </label>
                  <input
                    type="text"
                    value={editCourseData.subject}
                    onChange={(e) => setEditCourseData({ ...editCourseData, subject: e.target.value })}
                    placeholder="Ej: Historia, Física..."
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Curso / Año
                  </label>
                  <input
                    type="text"
                    value={editCourseData.grade}
                    onChange={(e) => setEditCourseData({ ...editCourseData, grade: e.target.value })}
                    placeholder="Ej: 3° Año, 5to Año..."
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    División / Comisión
                  </label>
                  <input
                    type="text"
                    value={editCourseData.division}
                    onChange={(e) => setEditCourseData({ ...editCourseData, division: e.target.value })}
                    placeholder="Ej: S2, B, Turno Mañana..."
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Aula / Salón
                  </label>
                  <input
                    type="text"
                    value={editCourseData.room}
                    onChange={(e) => setEditCourseData({ ...editCourseData, room: e.target.value })}
                    placeholder="Ej: Aula 12, Lab 1..."
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Horario de Cursada
                  </label>
                  <input
                    type="text"
                    value={editCourseData.schedule}
                    onChange={(e) => setEditCourseData({ ...editCourseData, schedule: e.target.value })}
                    placeholder="Ej: Martes 08:00 - 09:30"
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditCourseModalOpen(false);
                    setEditCourseData(null);
                  }}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!editCourseData.name.trim() || isSavingCourseDetails}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
                >
                  {isSavingCourseDetails && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  <span>{isSavingCourseDetails ? 'Guardando...' : 'Guardar Cambios'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: NOTIFICACIÓN DE AUSENCIA INDIVIDUAL (Aviso al Estudiante) */}
      {/* ------------------------------------------------------------- */}
      {absenceNotifModal.isOpen && (() => {
        const isDisposition = absenceNotifModal.historyItem?.category === 'Disposición';
        const pointsChange = absenceNotifModal.historyItem?.pointsChange;
        const isAdd = pointsChange !== undefined ? pointsChange > 0 : false;
        const pointsBadgeText = pointsChange !== undefined
          ? (pointsChange > 0 ? `+${pointsChange} pto` : `${pointsChange} pto`)
          : '-1 pto';

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${
                  isDisposition
                    ? isAdd
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                }`}>
                  {isDisposition ? (
                    isAdd ? <Award className="w-5 h-5 text-emerald-500" /> : <ShieldAlert className="w-5 h-5" />
                  ) : (
                    <Bell className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    {isDisposition
                      ? (isAdd ? 'Notificar Reconocimiento al Estudiante' : 'Notificar Observación de Conducta al Estudiante')
                      : 'Notificar Ausencia al Estudiante'}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {absenceNotifModal.student
                      ? `${absenceNotifModal.student.lastName}, ${absenceNotifModal.student.firstName}`
                      : 'Estudiante'} • {activeCourse.name}
                    {isDisposition && absenceNotifModal.historyItem?.action && (
                      <span className={`font-semibold ml-1.5 ${
                        isAdd ? 'text-emerald-600 dark:text-emerald-400' : 'text-purple-600 dark:text-purple-400'
                      }`}>
                        • {absenceNotifModal.historyItem.action} ({pointsBadgeText})
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              {/* Presets selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Mensaje preestablecido
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsNotifConfigModalOpen(true)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Bookmark className="w-3 h-3" />
                    <span>Administrar plantillas</span>
                  </button>
                </div>
                <select
                  value={absenceNotifModal.selectedPresetId}
                  onChange={(e) => {
                    const presetId = e.target.value;
                    if (presetId.startsWith('reason-')) {
                      const reasonKey = presetId.replace('reason-', '');
                      const reasonTpl = getTemplateForReason(reasonKey, isAdd ? 'positive' : 'negative');
                      const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 10;
                      const formatted = formatTemplateForStudent(
                        reasonTpl,
                        absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                        activeCourse.name,
                        curDisp,
                        absenceNotifModal.historyItem?.date || '',
                        reasonKey,
                        pointsChange
                      );
                      setAbsenceNotifModal((prev) => ({
                        ...prev,
                        selectedPresetId: presetId,
                        messageText: formatted,
                      }));
                      return;
                    }
                    const found = savedPresets.find((p) => p.id === presetId);
                    if (found && absenceNotifModal.student) {
                      const curDisp = dispositionMap[absenceNotifModal.student.id]?.totalDisposition ?? (isDisposition ? 10 : 10);
                      const formatted = formatTemplateForStudent(
                        found.text,
                        absenceNotifModal.student,
                        activeCourse.name,
                        curDisp,
                        absenceNotifModal.historyItem?.date || '',
                        absenceNotifModal.historyItem?.action || '',
                        pointsChange
                      );
                      const channelToUse = found.channel !== 'any' ? found.channel : absenceNotifModal.channel;
                      setAbsenceNotifModal((prev) => ({
                        ...prev,
                        selectedPresetId: presetId,
                        channel: channelToUse,
                        messageText: formatted,
                      }));
                    }
                  }}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 font-medium ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                >
                  {isDisposition ? (
                    <>
                      {absenceNotifModal.historyItem?.action && (
                        <optgroup label="⭐ Plantilla asignada a esta cuestión">
                          <option value={`reason-${absenceNotifModal.historyItem.action}`}>
                            ⭐ Predeterminado para "{absenceNotifModal.historyItem.action}" {conductReasonTemplates[absenceNotifModal.historyItem.action] ? '(Personalizado)' : ''}
                          </option>
                        </optgroup>
                      )}
                      <optgroup label="Otras cuestiones habituales">
                        {allKnownReasonKeys
                          .filter((k) => k !== absenceNotifModal.historyItem?.action)
                          .map((k) => (
                            <option key={`reason-${k}`} value={`reason-${k}`}>
                              Plantilla de "{k}" {conductReasonTemplates[k] ? '(Personalizado)' : ''}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Plantillas Generales de Conducta">
                        {savedPresets
                          .filter((p) => p.category === 'Disposición')
                          .map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Otras Plantillas">
                        {savedPresets
                          .filter((p) => p.category !== 'Disposición')
                          .map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                            </option>
                          ))}
                      </optgroup>
                    </>
                  ) : (
                    <>
                      <optgroup label="Plantillas de Inasistencias">
                        {savedPresets
                          .filter((p) => p.category !== 'Disposición')
                          .map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Plantillas de Conducta">
                        {savedPresets
                          .filter((p) => p.category === 'Disposición')
                          .map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                            </option>
                          ))}
                      </optgroup>
                    </>
                  )}
                </select>
              </div>

              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                  Canal de Notificación
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                      const rawTpl = isDisposition ? notifSettings.templateConductClassroom : notifSettings.templateClassroom;
                      const tpl = formatTemplateForStudent(
                        rawTpl,
                        absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                        activeCourse.name,
                        curDisp,
                        absenceNotifModal.historyItem?.date || '',
                        absenceNotifModal.historyItem?.action || ''
                      );
                      setAbsenceNotifModal((prev) => ({ ...prev, channel: 'classroom', messageText: tpl }));
                    }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                      absenceNotifModal.channel === 'classroom'
                        ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200 ring-2 ring-blue-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <MessageSquare className="w-4 h-4 text-blue-500" />
                      <span>Tablón de Classroom</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                      Aviso individual privado en el curso (sin enviar correos).
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                      const rawTpl = isDisposition ? notifSettings.templateConductGmail : notifSettings.templateGmail;
                      const tpl = formatTemplateForStudent(
                        rawTpl,
                        absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                        activeCourse.name,
                        curDisp,
                        absenceNotifModal.historyItem?.date || '',
                        absenceNotifModal.historyItem?.action || ''
                      );
                      setAbsenceNotifModal((prev) => ({ ...prev, channel: 'gmail', messageText: tpl }));
                    }}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                      absenceNotifModal.channel === 'gmail'
                        ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200 ring-2 ring-blue-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Mail className="w-4 h-4 text-amber-500" />
                      <span>Correo Gmail</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                      Envío directo a la casilla de correo del estudiante.
                    </span>
                  </button>
                </div>
              </div>

              {/* Banner de plantilla específica para esta cuestión */}
              {isDisposition && absenceNotifModal.historyItem?.action && (
                <div
                  className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all ${
                    isDarkMode
                      ? 'bg-purple-950/40 border-purple-800 text-purple-200'
                      : 'bg-purple-50/90 border-purple-200 text-purple-900'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-300 mt-0.5 shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs">
                          Mensaje para: "{absenceNotifModal.historyItem.action}"
                        </span>
                        {isReasonCustomized(absenceNotifModal.historyItem.action) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <Check className="w-2.5 h-2.5" />
                            Plantilla personalizada
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                            Plantilla predeterminada
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-600 dark:text-purple-300/80 mt-0.5">
                        Puedes editar este texto y guardarlo. La próxima vez que un alumno no traiga "{absenceNotifModal.historyItem.action}", aparecerá este mensaje por defecto.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (absenceNotifModal.historyItem?.action) {
                        handleSaveTemplateForReason(
                          absenceNotifModal.historyItem.action,
                          absenceNotifModal.messageText,
                          true,
                          absenceNotifModal.student
                        );
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar para "{absenceNotifModal.historyItem.action}"</span>
                  </button>
                </div>
              )}

              {/* Message preview / edit */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Mensaje para el Estudiante
                  </label>
                  <span className="text-[10px] text-neutral-400">Puedes editar este texto libremente</span>
                </div>
                <textarea
                  rows={4}
                  value={absenceNotifModal.messageText}
                  onChange={(e) => setAbsenceNotifModal((prev) => ({ ...prev, messageText: e.target.value }))}
                  placeholder="Escribe el mensaje..."
                  className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />

                {/* Variable chips */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const studentName = absenceNotifModal.student
                        ? `${absenceNotifModal.student.firstName} ${absenceNotifModal.student.lastName}`
                        : 'Estudiante';
                      setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${studentName}` }));
                    }}
                    className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
                  >
                    + Nombre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${activeCourse.name}` }));
                    }}
                    className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
                  >
                    + Materia
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                      setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${curDisp}/10` }));
                    }}
                    className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
                  >
                    + Disposición
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${absenceNotifModal.historyItem?.date || ''}` }));
                    }}
                    className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
                  >
                    + Fecha
                  </button>
                  {absenceNotifModal.historyItem?.action && (
                    <button
                      type="button"
                      onClick={() => {
                        setAbsenceNotifModal((prev) => ({
                          ...prev,
                          messageText: `${prev.messageText} "${absenceNotifModal.historyItem?.action}"`,
                        }));
                      }}
                      className="px-2 py-0.5 rounded text-[10px] bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/60 dark:hover:bg-purple-900 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-semibold cursor-pointer"
                    >
                      + Motivo ({absenceNotifModal.historyItem.action})
                    </button>
                  )}
                </div>

                {isDisposition && absenceNotifModal.historyItem?.action && (
                  <label className="flex items-center gap-2 pt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveReasonAsDefaultOnSend}
                      onChange={(e) => setSaveReasonAsDefaultOnSend(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                    <span className="text-xs font-medium text-purple-900 dark:text-purple-300">
                      Guardar automáticamente este mensaje como predeterminado para "{absenceNotifModal.historyItem.action}" al enviar
                    </span>
                  </label>
                )}
              </div>

              {/* Guardar este mensaje como nuevo mensaje preestablecido */}
              <div
                className={`p-3 rounded-xl border transition-all ${
                  isDarkMode ? 'bg-slate-850 border-slate-700/80' : 'bg-neutral-50/80 border-neutral-200'
                }`}
              >
                {!absenceNotifModal.showSavePresetInput ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-blue-500" />
                      <span className="text-xs font-semibold">¿Quieres guardar este mensaje para volver a usarlo?</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, showSavePresetInput: true }))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar preestablecido</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                        <Bookmark className="w-3.5 h-3.5" />
                        Guardar como nuevo mensaje preestablecido
                      </span>
                      <button
                        type="button"
                        onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, showSavePresetInput: false, newPresetName: '' }))}
                        className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={absenceNotifModal.newPresetName}
                        onChange={(e) => setAbsenceNotifModal((prev) => ({ ...prev, newPresetName: e.target.value }))}
                        placeholder={isDisposition ? "Nombre de la plantilla (ej: Falta de respeto, Llamado de atención)" : "Nombre de la plantilla (ej: Falta con recuperatorio, Aviso TP)"}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                      <button
                        type="button"
                        disabled={!absenceNotifModal.newPresetName.trim()}
                        onClick={() => {
                          const genericText = extractGenericTemplate(
                            absenceNotifModal.messageText,
                            absenceNotifModal.student,
                            activeCourse.name,
                            absenceNotifModal.historyItem?.date,
                            absenceNotifModal.historyItem?.action
                          );
                          const newId = handleSavePreset(
                            absenceNotifModal.newPresetName,
                            genericText,
                            absenceNotifModal.channel,
                            isDisposition ? 'Disposición' : 'Ausencia'
                          );
                          setAbsenceNotifModal((prev) => ({
                            ...prev,
                            selectedPresetId: newId,
                            showSavePresetInput: false,
                            newPresetName: '',
                          }));
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                      >
                        <Save className="w-3 h-3" />
                        <span>Guardar</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                      Las referencias al nombre, materia, motivo y fecha se convertirán en variables automáticas para reutilizarlas con cualquier estudiante.
                    </p>
                  </div>
                )}
              </div>

              {/* Fast mode option */}
              {isDisposition ? (
                <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-slate-400 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={!!notifSettings.dontShowPopupOnDisposition}
                    onChange={(e) => {
                      const updated = { ...notifSettings, dontShowPopupOnDisposition: e.target.checked };
                      handleSaveNotifSettings(updated);
                    }}
                    className="w-3.5 h-3.5 rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span>Modo rápido de conducta: no abrir esta ventana al registrar conducta (podrás mandar avisos desde el historial)</span>
                </label>
              ) : (
                <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-slate-400 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={!!notifSettings.dontShowPopupOnAbsence}
                    onChange={(e) => {
                      const updated = { ...notifSettings, dontShowPopupOnAbsence: e.target.checked };
                      handleSaveNotifSettings(updated);
                    }}
                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Tomar asistencia sin abrir esta ventana (marcar faltas y enviar avisos al final en lote)</span>
                </label>
              )}

              <div
                className={`p-3 rounded-xl border flex items-start gap-2 text-[11px] ${
                  isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
                }`}
              >
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p>
                  Al confirmar, se enviará el aviso al estudiante y se actualizarán inmediatamente las columnas
                  <strong> "Mensaje enviado"</strong> (✓) y <strong>"Mensaje"</strong> en el Historial y en la hoja Google Sheets.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex flex-wrap items-center justify-between gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => {
                  setAbsenceNotifModal((prev) => ({ ...prev, isOpen: false }));
                  setToastMessage(
                    `${isDisposition ? 'Conducta' : 'Falta'} registrada para ${absenceNotifModal.student?.lastName || 'el estudiante'}. El aviso quedó pendiente para mandarlo al final junto con los demás.`
                  );
                  setTimeout(() => setToastMessage(null), 4000);
                }}
                className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
                title="Cierra esta ventana dejando la anotación registrada; podrás mandar todos los avisos pendientes juntos al final de la clase"
              >
                Enviar al final (junto con los demás)
              </button>

              <button
                type="button"
                disabled={!absenceNotifModal.messageText.trim() || absenceNotifModal.isSending}
                onClick={async () => {
                  if (!absenceNotifModal.historyItem || !absenceNotifModal.student) return;
                  // Si está activada la opción de guardar por defecto para este motivo, persistirlo
                  if (isDisposition && absenceNotifModal.historyItem?.action && saveReasonAsDefaultOnSend) {
                    handleSaveTemplateForReason(
                      absenceNotifModal.historyItem.action,
                      absenceNotifModal.messageText,
                      false,
                      absenceNotifModal.student
                    );
                  }
                  setAbsenceNotifModal((prev) => ({ ...prev, isSending: true }));
                  await sendNotificationForItem(
                    absenceNotifModal.historyItem,
                    absenceNotifModal.student,
                    absenceNotifModal.channel,
                    absenceNotifModal.messageText
                  );
                  setAbsenceNotifModal({
                    isOpen: false,
                    historyItem: null,
                    student: null,
                    channel: 'classroom',
                    messageText: '',
                    isSending: false,
                    selectedPresetId: 'preset-standard',
                    showSavePresetInput: false,
                    newPresetName: '',
                  });
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
              >
                {absenceNotifModal.isSending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Enviando aviso...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar Notificación</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: ENVÍO MASIVO DE AVISOS DE AUSENCIA (LOTE / BATCH)      */}
      {/* ------------------------------------------------------------- */}
      {batchAbsenceModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    {(() => {
                      const hasAbsences = batchAbsenceModal.selectedItems.some((i) => i.historyItem.category === 'Ausencia');
                      const hasConduct = batchAbsenceModal.selectedItems.some((i) => i.historyItem.category === 'Disposición');
                      if (hasAbsences && hasConduct) return 'Envío Masivo de Avisos (Ausencias y Conductas)';
                      if (hasConduct) return 'Envío Masivo de Avisos de Conducta';
                      return 'Envío Masivo de Avisos de Inasistencia';
                    })()}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {activeCourse.name} • {batchAbsenceModal.selectedItems.length} registro{batchAbsenceModal.selectedItems.length > 1 ? 's' : ''} seleccionado{batchAbsenceModal.selectedItems.length > 1 ? 's' : ''}
                    {batchAbsenceModal.selectedItems.length > 0 && (
                      <span className="ml-1 opacity-75">
                        ({batchAbsenceModal.selectedItems.filter((i) => i.historyItem.category === 'Ausencia').length} ausencias, {batchAbsenceModal.selectedItems.filter((i) => i.historyItem.category === 'Disposición').length} conductas)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              {/* Selected students list as removable chips with badges */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Registros a Notificar ({batchAbsenceModal.selectedItems.length})
                  </label>
                  <div className="flex items-center gap-2">
                    {pendingAllItems.length > batchAbsenceModal.selectedItems.length && (
                      <button
                        type="button"
                        disabled={batchAbsenceModal.isSending}
                        onClick={() => {
                          const allSelected = pendingAllItems
                            .map((h) => {
                              const student = students.find((s) => s.id === h.studentId);
                              if (!student) return null;
                              return { historyItem: h, student };
                            })
                            .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];
                          setBatchAbsenceModal((prev) => ({
                            ...prev,
                            selectedItems: allSelected,
                            previewStudentId: allSelected[0]?.historyItem.id,
                          }));
                        }}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                      >
                        + Seleccionar todos los pendientes ({pendingAllItems.length})
                      </button>
                    )}
                    {batchAbsenceModal.selectedItems.length > 0 && (
                      <button
                        type="button"
                        disabled={batchAbsenceModal.isSending}
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, selectedItems: [] }))}
                        className="text-[11px] text-neutral-400 hover:text-red-500 hover:underline cursor-pointer"
                      >
                        Vaciar
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-850">
                  {batchAbsenceModal.selectedItems.map((item) => {
                    const student = item.student;
                    const h = item.historyItem;
                    const isAbsence = h.category === 'Ausencia';
                    const activePreviewId = batchAbsenceModal.previewStudentId || batchAbsenceModal.selectedItems[0]?.historyItem.id;
                    const isCurrentPreview = activePreviewId === h.id;

                    return (
                      <span
                        key={h.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                          isCurrentPreview
                            ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-950/60 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-500/20'
                            : 'bg-white dark:bg-slate-800 text-neutral-800 dark:text-slate-200 border-neutral-200 dark:border-slate-700'
                        } shadow-2xs`}
                      >
                        <button
                          type="button"
                          onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, previewStudentId: h.id }))}
                          className="hover:underline text-left cursor-pointer flex items-center gap-1.5"
                          title="Clic para previsualizar este mensaje"
                        >
                          <span>{student.lastName}, {student.firstName}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isAbsence
                                ? 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300'
                                : 'bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300'
                            }`}
                          >
                            {isAbsence ? 'Ausencia' : h.action}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={batchAbsenceModal.isSending}
                          onClick={() => {
                            setBatchAbsenceModal((prev) => ({
                              ...prev,
                              selectedItems: prev.selectedItems.filter((i) => i.historyItem.id !== h.id),
                            }));
                          }}
                          className="text-neutral-400 hover:text-red-500 dark:hover:text-red-400 cursor-pointer disabled:opacity-30 ml-1"
                          title="Quitar este aviso del lote"
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                  {batchAbsenceModal.selectedItems.length === 0 && (
                    <p className="text-neutral-400 text-xs py-2 px-1">
                      No hay registros en la lista para notificar.
                    </p>
                  )}
                </div>
              </div>

              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                  Canal de Notificación
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, channel: 'classroom' }))}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                      batchAbsenceModal.channel === 'classroom'
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <MessageSquare className="w-4 h-4 text-indigo-500" />
                      <span>Tablón de Classroom</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                      Publica en el tablón de cada estudiante de manera individual.
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, channel: 'gmail' }))}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                      batchAbsenceModal.channel === 'gmail'
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Mail className="w-4 h-4 text-amber-500" />
                      <span>Correo Gmail</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                      Envía correos electrónicos a la casilla de cada estudiante.
                    </span>
                  </button>
                </div>
              </div>

              {/* Message Mode: Smart per reason (recommended) vs Unified */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Modo de Redacción del Mensaje
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, useSmartTemplates: true }))}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      batchAbsenceModal.useSmartTemplates
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Mensajes según motivo (Recomendado)</span>
                    </div>
                    <p className="text-[10px] text-neutral-500 dark:text-slate-400 mt-1 leading-snug">
                      Aplica automáticamente la plantilla guardada para cada caso (aviso de inasistencia a las ausencias, y mensaje específico a cada conducta).
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, useSmartTemplates: false }))}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      !batchAbsenceModal.useSmartTemplates
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                        : isDarkMode
                        ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Plantilla unificada para todos</span>
                    </div>
                    <p className="text-[10px] text-neutral-500 dark:text-slate-400 mt-1 leading-snug">
                      Envía el mismo texto base a todos los alumnos seleccionados, completando variables dinámicas como {'{ESTUDIANTE}'} y {'{MOTIVO}'}.
                    </p>
                  </button>
                </div>
              </div>

              {/* If Unified Template Mode is selected: show preset selector and raw editor */}
              {!batchAbsenceModal.useSmartTemplates && (
                <div className="space-y-3 p-3 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50/60 dark:bg-slate-850/60">
                  {/* Preset Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                        Mensaje preestablecido
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsNotifConfigModalOpen(true)}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>Administrar plantillas</span>
                      </button>
                    </div>
                    <select
                      value={batchAbsenceModal.selectedPresetId}
                      disabled={batchAbsenceModal.isSending}
                      onChange={(e) => {
                        const presetId = e.target.value;
                        const found = savedPresets.find((p) => p.id === presetId);
                        if (found) {
                          const channelToUse = found.channel !== 'any' ? found.channel : batchAbsenceModal.channel;
                          setBatchAbsenceModal((prev) => ({
                            ...prev,
                            selectedPresetId: presetId,
                            rawTemplateText: found.text,
                            channel: channelToUse,
                          }));
                        }
                      }}
                      className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 font-medium ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    >
                      {savedPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name} {preset.category === 'Disposición' ? '(Conducta)' : '(Ausencia)'} {preset.channel !== 'any' ? `[${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Raw Template text editor */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                        Plantilla del Mensaje (con variables dinámicas)
                      </label>
                      <span className="text-[10px] text-neutral-400">Se adaptará a los datos de cada estudiante</span>
                    </div>
                    <textarea
                      rows={4}
                      disabled={batchAbsenceModal.isSending}
                      value={batchAbsenceModal.rawTemplateText}
                      onChange={(e) => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: e.target.value }))}
                      placeholder="Escribe el mensaje con variables..."
                      className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 font-mono ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                      }`}
                    />

                    {/* Insertion chips */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-neutral-400 mr-1">Insertar variable:</span>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} {ESTUDIANTE}` }))}
                        className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                      >
                        {'{ESTUDIANTE}'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} {MATERIA}` }))}
                        className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                      >
                        {'{MATERIA}'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} {DISPOSICION}` }))}
                        className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                      >
                        {'{DISPOSICION}'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} {FECHA}` }))}
                        className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                      >
                        {'{FECHA}'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} {MOTIVO}` }))}
                        className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                      >
                        {'{MOTIVO}'}
                      </button>
                    </div>
                  </div>

                  {/* Guardar este mensaje como nueva plantilla preestablecida */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      isDarkMode ? 'bg-slate-850 border-slate-700/80' : 'bg-neutral-50/80 border-neutral-200'
                    }`}
                  >
                    {!batchAbsenceModal.showSavePresetInput ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Bookmark className="w-4 h-4 text-indigo-500" />
                          <span className="text-xs font-semibold">¿Guardar esta plantilla para futuros avisos masivos?</span>
                        </div>
                        <button
                          type="button"
                          disabled={batchAbsenceModal.isSending}
                          onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, showSavePresetInput: true }))}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Guardar plantilla</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                            <Bookmark className="w-3.5 h-3.5" />
                            Guardar como nuevo mensaje preestablecido
                          </span>
                          <button
                            type="button"
                            onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, showSavePresetInput: false, newPresetName: '' }))}
                            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={batchAbsenceModal.newPresetName}
                            onChange={(e) => setBatchAbsenceModal((prev) => ({ ...prev, newPresetName: e.target.value }))}
                            placeholder="Nombre de la plantilla (ej: Aviso General de Clase, TP Vencido)"
                            className={`flex-1 px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-indigo-500 ${
                              isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />
                          <button
                            type="button"
                            disabled={!batchAbsenceModal.newPresetName.trim()}
                            onClick={() => {
                              const newId = handleSavePreset(batchAbsenceModal.newPresetName, batchAbsenceModal.rawTemplateText, batchAbsenceModal.channel, 'Ausencia');
                              setBatchAbsenceModal((prev) => ({
                                ...prev,
                                selectedPresetId: newId,
                                showSavePresetInput: false,
                                newPresetName: '',
                              }));
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" />
                            <span>Guardar</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Vista previa personalizada interactiva por estudiante y ajuste individual */}
              {batchAbsenceModal.selectedItems.length > 0 && (() => {
                const activePreviewItem =
                  batchAbsenceModal.selectedItems.find((i) => i.historyItem.id === batchAbsenceModal.previewStudentId) ||
                  batchAbsenceModal.selectedItems[0];
                if (!activePreviewItem) return null;

                const messageForStudent = getBatchMessageForItem(activePreviewItem, batchAbsenceModal);
                const isAbsence = activePreviewItem.historyItem.category === 'Ausencia';

                return (
                  <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-indigo-50/40 border-indigo-100'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-xs flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
                        <CheckCheck className="w-4 h-4" />
                        Vista previa y ajuste individual por estudiante:
                      </span>
                      <span className="text-[10px] text-neutral-500 dark:text-slate-400">
                        {activePreviewItem.student.email || 'Sin correo registrado'}
                      </span>
                    </div>

                    {/* Student selector buttons for preview */}
                    <div className="flex flex-wrap gap-1 mb-2 max-h-24 overflow-y-auto">
                      {batchAbsenceModal.selectedItems.map((item) => {
                        const isCurrent = (batchAbsenceModal.previewStudentId || batchAbsenceModal.selectedItems[0]?.historyItem.id) === item.historyItem.id;
                        const isAbs = item.historyItem.category === 'Ausencia';

                        return (
                          <button
                            key={item.historyItem.id}
                            type="button"
                            onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, previewStudentId: item.historyItem.id }))}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                              isCurrent
                                ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                                : isDarkMode
                                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                            }`}
                          >
                            <span>{item.student.firstName}</span>
                            <span className={`text-[9px] px-1 rounded font-bold ${isAbs ? 'bg-red-500/20 text-red-200' : 'bg-purple-500/20 text-purple-200'}`}>
                              {isAbs ? 'Falta' : item.historyItem.action}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Render editable preview for selected student */}
                    <div className={`p-3 rounded-lg border text-xs leading-relaxed space-y-2 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-neutral-200 text-neutral-800'
                    }`}>
                      <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500 pb-1 border-b border-neutral-100 dark:border-slate-800">
                        <span>
                          Para: <strong className="text-neutral-900 dark:text-white">{activePreviewItem.student.lastName}, {activePreviewItem.student.firstName}</strong> ({activePreviewItem.student.email})
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isAbsence
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                        }`}>
                          {isAbsence ? 'Inasistencia' : `Conducta: ${activePreviewItem.historyItem.action}`}
                        </span>
                      </div>

                      <textarea
                        rows={3}
                        value={messageForStudent}
                        disabled={batchAbsenceModal.isSending}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBatchAbsenceModal((prev) => ({
                            ...prev,
                            customPerItemMessages: {
                              ...(prev.customPerItemMessages || {}),
                              [activePreviewItem.historyItem.id]: val,
                            },
                          }));
                        }}
                        className={`w-full p-2 text-xs rounded border focus:outline-hidden focus:ring-1 focus:ring-indigo-500 ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-900'
                        }`}
                        title="Puedes ajustar el mensaje puntual para este estudiante antes de enviar el lote"
                      />

                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>Puedes retocar el mensaje antes de enviar todo el lote junto.</span>
                        {batchAbsenceModal.customPerItemMessages?.[activePreviewItem.historyItem.id] && (
                          <button
                            type="button"
                            onClick={() => {
                              setBatchAbsenceModal((prev) => {
                                const next = { ...(prev.customPerItemMessages || {}) };
                                delete next[activePreviewItem.historyItem.id];
                                return { ...prev, customPerItemMessages: next };
                              });
                            }}
                            className="text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            Restablecer al mensaje sugerido
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Progress bar during sending */}
              {batchAbsenceModal.isSending && (
                <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      {batchAbsenceModal.currentSendingStudentName
                        ? `Enviando a ${batchAbsenceModal.currentSendingStudentName}...`
                        : 'Enviando avisos...'}
                    </span>
                    <span>
                      {batchAbsenceModal.progress || 1} de {batchAbsenceModal.total || batchAbsenceModal.selectedItems.length}
                    </span>
                  </div>
                  <div className="w-full bg-indigo-200 dark:bg-indigo-900/50 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-2 transition-all duration-300 rounded-full"
                      style={{
                        width: `${batchAbsenceModal.total && batchAbsenceModal.total > 0 ? ((batchAbsenceModal.progress || 1) / batchAbsenceModal.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, isOpen: false }))}
                className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={batchAbsenceModal.selectedItems.length === 0 || batchAbsenceModal.isSending}
                onClick={handleSendBatchNotifications}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
              >
                {batchAbsenceModal.isSending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Enviando avisos ({batchAbsenceModal.progress || 0} de {batchAbsenceModal.total || batchAbsenceModal.selectedItems.length})...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar todos juntos ({batchAbsenceModal.selectedItems.length} avisos)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: CONFIGURAR PLANTILLAS Y AVISOS DE AUSENCIAS           */}
      {/* ------------------------------------------------------------- */}
      {isNotifConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    Configuración de Avisos por Ausencia / Disposición
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Personaliza los mensajes preconfigurados que se cargan automáticamente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNotifConfigModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className={`px-4 pt-2 border-b flex gap-1 overflow-x-auto ${isDarkMode ? 'border-slate-800 bg-slate-850/50' : 'border-neutral-200 bg-neutral-50/50'}`}>
              <button
                type="button"
                onClick={() => setNotifConfigActiveTab('reasons')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  notifConfigActiveTab === 'reasons'
                    ? 'border-purple-600 text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-900 shadow-xs'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Mensajes por Cuestión / Motivo</span>
                {Object.keys(conductReasonTemplates).length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                    {Object.keys(conductReasonTemplates).length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setNotifConfigActiveTab('presets')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  notifConfigActiveTab === 'presets'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Plantillas Generales e Inasistencias</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-600 dark:bg-slate-800 dark:text-slate-300">
                  {savedPresets.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setNotifConfigActiveTab('settings')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  notifConfigActiveTab === 'settings'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Modo Rápido y Canales</span>
              </button>
            </div>

            {/* Body */}
            {notifConfigActiveTab === 'reasons' && (
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* Banner explicativo */}
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                    isDarkMode ? 'bg-purple-950/20 border-purple-900/60 text-purple-200' : 'bg-purple-50/80 border-purple-200 text-purple-900'
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-xs leading-tight">
                      Mensajes predeterminados específicos para cada cuestión de conducta
                    </p>
                    <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-purple-300/80">
                      Configura un mensaje propio para cada situación (por ejemplo: <strong>"Sin libro"</strong>, <strong>"Falta de tarea"</strong>, etc.). La próxima vez que un alumno tenga esa falta y le descuentes un punto de disposición, <strong>se cargará automáticamente ese mensaje específico</strong>.
                    </p>
                  </div>
                </div>

                {/* Buscador y botón para agregar nueva cuestión con mensaje */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="text"
                      value={searchReasonQuery}
                      onChange={(e) => setSearchReasonQuery(e.target.value)}
                      placeholder="Buscar cuestión (ej: Sin libro, tarea, celular...)"
                      className={`w-full pl-8 pr-8 py-1.5 text-xs rounded-xl border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    />
                    {searchReasonQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchReasonQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsNewReasonFormOpen(!isNewReasonFormOpen)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isNewReasonFormOpen ? 'Cancelar' : 'Nueva Cuestión'}</span>
                  </button>
                </div>

                {/* Formulario desplegable para agregar nueva cuestión con mensaje propio */}
                {isNewReasonFormOpen && (
                  <div
                    className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                      isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-purple-50/60 border-purple-200'
                    }`}
                  >
                    <span className="font-bold text-xs flex items-center gap-1.5 text-purple-900 dark:text-purple-300">
                      <Sparkles className="w-3.5 h-3.5" />
                      Crear nueva cuestión y definir su mensaje predeterminado
                    </span>

                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                        Nombre de la cuestión (ej: "Sin libro", "Sin guardapolvo", "Falta TP práctico")
                      </label>
                      <input
                        type="text"
                        value={newReasonName}
                        onChange={(e) => setNewReasonName(e.target.value)}
                        placeholder="Ej: Sin libro"
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                          Mensaje que aparecerá por defecto
                        </label>
                        <span className="text-[10px] text-neutral-400">Variables automáticas disponibles</span>
                      </div>
                      <textarea
                        rows={3}
                        value={newReasonTemplateText}
                        onChange={(e) => setNewReasonTemplateText(e.target.value)}
                        placeholder="Estimado/a {ESTUDIANTE}, hoy {FECHA} se registró un llamado de atención en {MATERIA} por no traer... (-1 punto de disposición, actual: {DISPOSICION}/10)."
                        className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />

                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                        {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setNewReasonTemplateText((prev) => `${prev} ${tag}`)}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewReasonFormOpen(false);
                          setNewReasonName('');
                          setNewReasonTemplateText('');
                        }}
                        className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!newReasonName.trim()}
                        onClick={() => {
                          const name = newReasonName.trim();
                          const tpl = newReasonTemplateText.trim() || getTemplateForReason(name);
                          handleSaveTemplateForReason(name, tpl);
                          setIsNewReasonFormOpen(false);
                          setNewReasonName('');
                          setNewReasonTemplateText('');
                        }}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Guardar Cuestión y Mensaje</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Lista de todas las cuestiones conocidas */}
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {allKnownReasonKeys
                    .filter((r) => !searchReasonQuery.trim() || r.toLowerCase().includes(searchReasonQuery.toLowerCase().trim()))
                    .map((reasonKey) => {
                      const customized = isReasonCustomized(reasonKey);
                      const currentDraft = reasonCardDrafts[reasonKey] ?? getTemplateForReason(reasonKey);
                      const hasChanges = reasonCardDrafts[reasonKey] !== undefined && reasonCardDrafts[reasonKey] !== getTemplateForReason(reasonKey);

                      return (
                        <div
                          key={reasonKey}
                          className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                            customized
                              ? isDarkMode
                                ? 'bg-purple-950/20 border-purple-800/70'
                                : 'bg-purple-50/40 border-purple-200'
                              : isDarkMode
                              ? 'bg-slate-800/40 border-slate-700/80'
                              : 'bg-neutral-50/70 border-neutral-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-neutral-900 dark:text-white">
                                {reasonKey}
                              </span>
                              {customized ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  Mensaje propio guardado
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-200 text-neutral-600 dark:bg-slate-700 dark:text-slate-300">
                                  Plantilla estándar
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {customized && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleResetTemplateForReason(reasonKey);
                                    setReasonCardDrafts((prev) => {
                                      const n = { ...prev };
                                      delete n[reasonKey];
                                      return n;
                                    });
                                  }}
                                  className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                                  title="Volver a la plantilla predeterminada del sistema"
                                >
                                  Restablecer a estándar
                                </button>
                              )}
                            </div>
                          </div>

                          <textarea
                            rows={3}
                            value={currentDraft}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReasonCardDrafts((prev) => ({ ...prev, [reasonKey]: val }));
                            }}
                            placeholder="Escribe el mensaje por defecto para esta cuestión..."
                            className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                              {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => {
                                    setReasonCardDrafts((prev) => ({
                                      ...prev,
                                      [reasonKey]: `${currentDraft} ${tag}`,
                                    }));
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                handleSaveTemplateForReason(reasonKey, currentDraft);
                                setReasonCardDrafts((prev) => {
                                  const n = { ...prev };
                                  delete n[reasonKey];
                                  return n;
                                });
                              }}
                              className={`px-3 py-1 text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1 transition-all ${
                                hasChanges
                                  ? 'bg-purple-600 hover:bg-purple-700 text-white animate-pulse'
                                  : 'bg-purple-600 hover:bg-purple-700 text-white'
                              }`}
                            >
                              <Save className="w-3 h-3" />
                              <span>Guardar para "{reasonKey}"</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {notifConfigActiveTab === 'presets' && (
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* SECCIÓN: PLANTILLAS Y MENSAJES PREESTABLECIDOS */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <h4 className="font-bold text-xs text-neutral-900 dark:text-white">
                        Plantillas Generales y de Inasistencias ({savedPresets.length})
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: !p.isOpen }))}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{newConfigPreset.isOpen ? 'Cancelar' : 'Nueva plantilla'}</span>
                    </button>
                  </div>

                  {/* Form to create a new preset */}
                  {newConfigPreset.isOpen && (
                    <div
                      className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                        isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-blue-50/50 border-blue-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-blue-900 dark:text-blue-200">
                          Crear Nuevo Mensaje Preestablecido
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                            Nombre de la plantilla
                          </label>
                          <input
                            type="text"
                            value={newConfigPreset.name}
                            onChange={(e) => setNewConfigPreset((p) => ({ ...p, name: e.target.value }))}
                            placeholder="Ej: Falta con recuperatorio, TP..."
                            className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                            Tipo de Aviso
                          </label>
                          <select
                            value={newConfigPreset.category}
                            onChange={(e) => setNewConfigPreset((p) => ({ ...p, category: e.target.value as any }))}
                            className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          >
                            <option value="Ausencia">Inasistencia</option>
                            <option value="Disposición">Conducta / Disposición</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                            Canal recomendado
                          </label>
                          <select
                            value={newConfigPreset.channel}
                            onChange={(e) => setNewConfigPreset((p) => ({ ...p, channel: e.target.value as any }))}
                            className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          >
                            <option value="classroom">Tablón de Classroom</option>
                            <option value="gmail">Correo Gmail</option>
                            <option value="any">Cualquier canal</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-semibold text-neutral-600 dark:text-slate-300">
                            Texto del mensaje
                          </label>
                          <span className="text-[10px] text-neutral-400">Usa las variables dinámicas</span>
                        </div>
                        <textarea
                          rows={3}
                          value={newConfigPreset.text}
                          onChange={(e) => setNewConfigPreset((p) => ({ ...p, text: e.target.value }))}
                          placeholder="Estimado/a {ESTUDIANTE}, se ha registrado una inasistencia u observación en {MATERIA}..."
                          className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                            isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                          }`}
                        />

                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                          {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}', '{MOTIVO}'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setNewConfigPreset((p) => ({ ...p, text: `${p.text} ${tag}` }))}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: false, name: '', text: '', category: 'Ausencia' }))}
                          className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={!newConfigPreset.name.trim() || !newConfigPreset.text.trim()}
                          onClick={() => {
                            handleSavePreset(newConfigPreset.name, newConfigPreset.text, newConfigPreset.channel, newConfigPreset.category);
                            setNewConfigPreset({ name: '', text: '', channel: 'classroom', category: 'Ausencia', isOpen: false });
                          }}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Guardar Plantilla</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List of presets */}
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {savedPresets.map((preset) => (
                      <div
                        key={preset.id}
                        className={`p-3 rounded-xl border flex flex-col gap-1.5 transition-colors ${
                          isDarkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-neutral-900 dark:text-white">
                              {preset.name}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                preset.category === 'Disposición'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                  : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                              }`}
                            >
                              {preset.category === 'Disposición' ? 'Conducta' : 'Ausencia'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                preset.channel === 'classroom'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : preset.channel === 'gmail'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-neutral-200 text-neutral-700 dark:bg-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {preset.channel === 'classroom' ? 'Classroom' : preset.channel === 'gmail' ? 'Gmail' : 'Ambos canales'}
                            </span>
                          </div>
                          {savedPresets.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(preset.id)}
                              className="p-1 text-neutral-400 hover:text-red-500 rounded transition-colors cursor-pointer"
                              title="Eliminar esta plantilla"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-600 dark:text-slate-400 font-mono line-clamp-2">
                          {preset.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {notifConfigActiveTab === 'settings' && (
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* MODO RÁPIDO DE ASISTENCIA */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    notifSettings.dontShowPopupOnAbsence
                      ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-800'
                      : isDarkMode
                      ? 'bg-slate-800/40 border-slate-700'
                      : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!notifSettings.dontShowPopupOnAbsence}
                      onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnAbsence: e.target.checked }))}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mt-0.5"
                    />
                    <div>
                      <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                        Modo rápido de asistencia: No abrir ventana emergente en cada falta tomada
                      </span>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                        Al activar este modo, podrás tomar la asistencia de forma rápida haciendo clic en <strong>"+ Falta"</strong> sin interrupciones. Las inasistencias quedarán registradas como pendientes y luego podrás seleccionar a los ausentes para <strong>enviar todos los mensajes juntos en lote</strong> al finalizar la clase.
                      </span>
                    </div>
                  </label>
                </div>

                {/* MODO RÁPIDO DE CONDUCTA / DISPOSICIÓN */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    notifSettings.dontShowPopupOnDisposition
                      ? 'border-purple-400 bg-purple-50/60 dark:bg-purple-950/40 dark:border-purple-800'
                      : isDarkMode
                      ? 'bg-slate-800/40 border-slate-700'
                      : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!notifSettings.dontShowPopupOnDisposition}
                      onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnDisposition: e.target.checked }))}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 mt-0.5"
                    />
                    <div>
                      <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                        Modo rápido de conducta: No abrir ventana emergente al restar puntos de disposición
                      </span>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                        Al activar este modo, podrás registrar conductas y restar puntos de disposición de forma ágil. Las observaciones quedarán asentadas en el historial y podrás enviar los avisos a los alumnos cuando lo prefieras.
                      </span>
                    </div>
                  </label>
                </div>

                {/* Canal predeterminado */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                    Canal de envío predeterminado
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label
                      className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                        notifSettings.channel === 'classroom'
                          ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                          : isDarkMode
                          ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="notif_channel"
                        value="classroom"
                        checked={notifSettings.channel === 'classroom'}
                        onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'classroom' }))}
                        className="text-blue-600"
                      />
                      <div>
                        <span className="font-bold block">Tablón de Classroom</span>
                        <span className="text-[10px] text-neutral-500 dark:text-slate-400">Aviso individual en el curso (sin emails)</span>
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                        notifSettings.channel === 'gmail'
                          ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                          : isDarkMode
                          ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="notif_channel"
                        value="gmail"
                        checked={notifSettings.channel === 'gmail'}
                        onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'gmail' }))}
                        className="text-blue-600"
                      />
                      <div>
                        <span className="font-bold block">Correo Electrónico (Gmail)</span>
                        <span className="text-[10px] text-neutral-500 dark:text-slate-400">Envío por correo al estudiante</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Plantilla Classroom */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                      Mensaje por defecto para Classroom (Tablón individual)
                    </label>
                    <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
                  </div>
                  <textarea
                    rows={3}
                    value={notifSettings.templateClassroom}
                    onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateClassroom: e.target.value }))}
                    className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                {/* Plantilla Gmail */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                      Mensaje por defecto para Correo (Gmail)
                    </label>
                    <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
                  </div>
                  <textarea
                    rows={3}
                    value={notifSettings.templateGmail}
                    onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateGmail: e.target.value }))}
                    className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Footer */}
            <div className={`p-4 border-t flex justify-end gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => setIsNotifConfigModalOpen(false)}
                className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveNotifSettings(notifSettings);
                  setIsNotifConfigModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Guardar Configuración
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación y accesos directos a la Carpeta de Google Drive y sus 2 Subcarpetas */}
      {driveFolderModalOpen && courseDriveStructure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <FolderClosed className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Carpeta de Google Drive</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">{activeCourse.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDriveFolderModalOpen(false)}
                className="p-1 rounded-lg hover:bg-neutral-200 dark:hover:bg-slate-800 text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 dark:text-slate-300">
                Se ha sincronizado la estructura oficial de la materia en tu <strong>Google Drive institucional</strong> con sus dos subcarpetas didácticas:
              </p>

              {/* Carpeta Principal */}
              <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
              }`}>
                <div className="flex items-center gap-2.5">
                  <FolderClosed className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <span className="font-bold text-neutral-900 dark:text-white text-xs block">
                      📁 {courseDriveStructure.mainFolder.name}
                    </span>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400">Carpeta principal de la cátedra</span>
                  </div>
                </div>
                <a
                  href={courseDriveStructure.mainFolder.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors shadow-2xs"
                >
                  <span>Abrir</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Subcarpetas */}
              <div className="space-y-2.5 pl-3 border-l-2 border-amber-300 dark:border-amber-700">
                {/* 1. Asistencia y Disposición */}
                <div className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700/80' : 'bg-white border-neutral-200 shadow-2xs'
                }`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <FolderClosed className="w-4 h-4 text-purple-500" />
                      <span className="font-bold text-neutral-900 dark:text-white">
                        1. {courseDriveStructure.attendanceFolder.name}
                      </span>
                    </div>
                    <a
                      href={courseDriveStructure.attendanceFolder.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      <span>Abrir subcarpeta</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-slate-800 text-[11px]">
                    <span className="text-neutral-500 dark:text-slate-400 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                      Hoja de Asistencia, Disposición e Historial
                    </span>
                    {courseDriveStructure.attendanceSheetUrl && (
                      <a
                        href={courseDriveStructure.attendanceSheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        Ver Sheet ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* 2. Calificaciones */}
                <div className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700/80' : 'bg-white border-neutral-200 shadow-2xs'
                }`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <FolderClosed className="w-4 h-4 text-blue-500" />
                      <span className="font-bold text-neutral-900 dark:text-white">
                        2. {courseDriveStructure.gradesFolder.name}
                      </span>
                    </div>
                    <a
                      href={courseDriveStructure.gradesFolder.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <span>Abrir subcarpeta</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-slate-800 text-[11px]">
                    <span className="text-neutral-500 dark:text-slate-400 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500" />
                      Planilla Matriz de Calificaciones y Notas
                    </span>
                    {courseDriveStructure.gradesSheetUrl && (
                      <a
                        href={courseDriveStructure.gradesSheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Ver Sheet ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex justify-end gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => setDriveFolderModalOpen(false)}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cerrar
              </button>
              <a
                href={courseDriveStructure.mainFolder.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                <span>Ir a Google Drive</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Vincular / Abrir en Google Sheets */}
      {showSheetsConnectModal && activeCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-emerald-50/70 border-emerald-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Abrir en Google Sheets</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">{activeCourse.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSheetsConnectModal(false)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs">
              <div
                className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                  isDarkMode
                    ? 'bg-slate-850/80 border-slate-750 text-slate-300'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                }`}
              >
                <Info className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-white mb-0.5">
                    Planilla de Google Sheets para {activeCourse.name}
                  </p>
                  <p className="leading-relaxed">
                    Sincroniza en vivo la nómina de estudiantes, ausencias, tardanzas y notas de conducta con Google Sheets en tu Google Drive.
                  </p>
                </div>
              </div>

              {/* Status of Currently Linked Sheet */}
              {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) && (
                <div
                  className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                    isDarkMode
                      ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                      : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="font-bold text-xs">Hoja vinculada al curso</span>
                    </div>
                    {sheetConfig.lastSyncedAt && (
                      <span className="text-[10px] opacity-80">Última sync: {sheetConfig.lastSyncedAt}</span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] truncate opacity-90 select-all">
                    {sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const url = sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`;
                        window.open(url, '_blank');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir Planilla</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleManualSheetsSync}
                      disabled={isSyncingSheet}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'border-emerald-700/60 hover:bg-emerald-900/40 text-emerald-200'
                          : 'border-emerald-300 hover:bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                      <span>{isSyncingSheet ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Google Drive Folder Location & Configuration */}
              <div
                className={`p-3.5 rounded-xl border space-y-2.5 ${
                  isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-slate-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-neutral-900 dark:text-white">
                    <FolderClosed className="w-4 h-4 text-amber-500" />
                    <span>Carpeta en Google Drive</span>
                  </div>
                  {activeCourse.driveFolderUrl && (
                    <button
                      type="button"
                      onClick={() => window.open(activeCourse.driveFolderUrl, '_blank')}
                      className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline font-semibold cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Abrir en Drive</span>
                    </button>
                  )}
                </div>
                
                <div className="text-[11px] text-neutral-600 dark:text-slate-400 leading-relaxed">
                  Ubicación actual:{' '}
                  <strong className="text-neutral-800 dark:text-slate-200">
                    {activeCourse.name} / Asistencia y Disposición
                  </strong>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customFolderInput}
                    onChange={(e) => setCustomFolderInput(e.target.value)}
                    placeholder="Nombre de carpeta o link/ID de Google Drive"
                    className={`flex-1 px-3 py-2 text-xs rounded-xl border outline-none font-mono transition-colors ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-amber-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-amber-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomDriveFolder}
                    disabled={isLinkingCustomFolder || !customFolderInput.trim()}
                    className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer shrink-0"
                  >
                    {isLinkingCustomFolder ? 'Guardando...' : 'Asignar Carpeta'}
                  </button>
                </div>
              </div>

              {/* Paste / Link Existing Google Sheet */}
              <div
                className={`p-3.5 rounded-xl border space-y-2.5 ${
                  isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-slate-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 dark:text-white">
                    Vincular Hoja Existente de Google Sheets
                  </span>
                  <span className="text-[10px] text-neutral-500 dark:text-slate-400">Pega el link o ID</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customSheetInput}
                    onChange={(e) => setCustomSheetInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/... o ID"
                    className={`flex-1 px-3 py-2 text-xs rounded-xl border outline-none font-mono transition-colors ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-emerald-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleLinkCustomSpreadsheet}
                    disabled={isLinkingCustomSheet || !customSheetInput.trim()}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer shrink-0"
                  >
                    {isLinkingCustomSheet ? 'Vinculando...' : 'Vincular'}
                  </button>
                </div>
              </div>

              {sheetsModalFeedback && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{sheetsModalFeedback}</span>
                </div>
              )}

              {/* Doble Entrada: Traer cambios realizados directamente en el Sheet */}
              {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) && (
                <div
                  className={`p-3.5 rounded-xl border space-y-2 ${
                    isDarkMode ? 'bg-blue-950/20 border-blue-800/40 text-blue-200' : 'bg-blue-50/70 border-blue-200 text-blue-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <ArrowLeftRight className="w-4 h-4 text-blue-500" />
                      <span>Doble Entrada: Sincronización Bidireccional</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                      Activa
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-slate-300">
                    Si modificas ausencias, tardanzas o notas de conducta en las celdas de tu Google Sheet, este botón lee la hoja y vuelca los cambios automáticamente en la app.
                  </p>
                  <button
                    type="button"
                    onClick={() => handlePullFromGoogleSheet(true)}
                    disabled={isPullingFromSheet}
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-colors"
                  >
                    <ArrowLeftRight className={`w-3.5 h-3.5 ${isPullingFromSheet ? 'animate-spin' : ''}`} />
                    <span>{isPullingFromSheet ? 'Leyendo cambios en Google Sheets...' : 'Comprobar y Traer Cambios del Sheet (Doble Entrada)'}</span>
                  </button>
                </div>
              )}

              <div className="space-y-2.5 pt-1">
                {/* Option 1: Connect Google */}
                <button
                  type="button"
                  onClick={handleConnectGoogleForSheets}
                  disabled={isOpeningSheet}
                  className="w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs disabled:opacity-50"
                >
                  <div className="flex items-center gap-2.5">
                    {isOpeningSheet ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="currentColor"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                    )}
                    <div>
                      <span className="block text-xs font-bold">
                        {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId)
                          ? 'Conectar Google y Sincronizar Hoja'
                          : 'Conectar Google y Crear Hoja en Drive'}
                      </span>
                      <span className="block text-[10px] text-emerald-100 font-normal">
                        Conecta tu cuenta institucional con permisos para editar Google Sheets
                      </span>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-emerald-100" />
                </button>

                {/* Option 2: sheets.new with copied data */}
                <button
                  type="button"
                  onClick={handleOpenInSheetsNew}
                  className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                    <div>
                      <span className="block text-xs font-bold">Abrir Hoja Nueva con Datos Copiados</span>
                      <span className="block text-[10px] text-neutral-500 dark:text-slate-400 font-normal">
                        Abre sheets.new y copia los datos al portapapeles (pegar con Ctrl+V)
                      </span>
                    </div>
                  </div>
                  <Copy className="w-4 h-4 text-neutral-400" />
                </button>

                {/* Option 3: Download CSV */}
                <button
                  type="button"
                  onClick={handleDownloadCourseCsv}
                  className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Download className="w-4 h-4 text-blue-500" />
                    <div>
                      <span className="block text-xs font-bold">Descargar archivo CSV</span>
                      <span className="block text-[10px] text-neutral-500 dark:text-slate-400 font-normal">
                        Descarga toda la nómina y el historial listo para Excel
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                </button>
              </div>
            </div>

            {/* Footer */}
            <div
              className={`p-3.5 border-t flex justify-end ${
                isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              <button
                type="button"
                onClick={() => setShowSheetsConnectModal(false)}
                className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Exportar a Excel (.xlsx) desde la cabecera */}
      {isHeaderExportExcelModalOpen && activeCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-emerald-50/70 border-emerald-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Exportar a Excel (.xlsx)</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">{activeCourse.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHeaderExportExcelModalOpen(false)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-neutral-600 dark:text-slate-300">
                Selecciona qué archivo deseas descargar en formato Excel nativo (.xlsx):
              </p>

              {/* Opción 1: Asistencia y Disposición */}
              <button
                type="button"
                onClick={() => handleExportAllCourseExcel('disposition')}
                className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                    : 'bg-neutral-50 hover:bg-emerald-50/40 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold block text-sm">Asistencia y Disposición (.xlsx)</span>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                      Incluye hojas de 1° Cuatrimestre, 2° Cuatrimestre y Resumen Anual consolidado
                    </span>
                  </div>
                </div>
                <Download className="w-4 h-4 text-emerald-500" />
              </button>

              {/* Opción 2: Calificaciones */}
              <button
                type="button"
                onClick={() => handleExportAllCourseExcel('grades')}
                className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                    : 'bg-neutral-50 hover:bg-blue-50/40 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold block text-sm">Planilla de Calificaciones (.xlsx)</span>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                      Matriz completa de notas con columnas, promedios y notas finales
                    </span>
                  </div>
                </div>
                <Download className="w-4 h-4 text-blue-500" />
              </button>

              {/* Opción 3: Historial y Bitácora */}
              <button
                type="button"
                onClick={() => handleExportAllCourseExcel('history')}
                className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                    : 'bg-neutral-50 hover:bg-purple-50/40 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold block text-sm">Historial y Bitácora (.xlsx)</span>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                      Registro cronológico de faltas, observaciones, conducta y avisos
                    </span>
                  </div>
                </div>
                <Download className="w-4 h-4 text-purple-500" />
              </button>

              {/* Opción 4: Paquete Completo */}
              <button
                type="button"
                onClick={() => handleExportAllCourseExcel('all')}
                className="w-full p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-between shadow-xs transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-white" />
                  <span className="text-sm">Descargar Todo el Paquete del Curso</span>
                </div>
                <span className="text-xs opacity-90">Archivos .xlsx</span>
              </button>
            </div>

            <div
              className={`p-3.5 border-t flex justify-end ${
                isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              <button
                type="button"
                onClick={() => setIsHeaderExportExcelModalOpen(false)}
                className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Importar desde Excel / Sheets con Verificación Previa */}
      {isHeaderImportModalOpen && activeCourse && (
        <ImportGradesModal
          isOpen={isHeaderImportModalOpen}
          onClose={() => setIsHeaderImportModalOpen(false)}
          courseId={activeCourse.id}
          courseName={activeCourse.name}
          students={courseStudents}
          categories1c={getCategoriesForImport('1c')}
          categories2c={getCategoriesForImport('2c')}
          gradesMap1c={getGradesMapForImport('1c')}
          gradesMap2c={getGradesMapForImport('2c')}
          currentTerm={attendanceTerm === '2c' ? '2c' : '1c'}
          isDarkMode={isDarkMode}
          onApplyGrades={handleApplyImportFromClassesModule}
          historyEntries={(() => {
            try {
              const hKey = `fds_grade_history_${activeCourse.id}`;
              const savedHist = localStorage.getItem(hKey);
              return savedHist ? JSON.parse(savedHist) : [];
            } catch (_) {
              return [];
            }
          })()}
        />
      )}


      {/* Modal: Resumen de Doble Entrada (Cambios detectados desde Google Sheets) */}
      {isDobleEntradaModalOpen && activeCourse && dobleEntradaDiffs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-blue-50/70 border-blue-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Doble Entrada: Cambios desde Google Sheets</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {activeCourse.name} • {dobleEntradaDiffs.length} cambio(s) aplicados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDobleEntradaModalOpen(false)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs max-h-96 overflow-y-auto">
              <p className="text-neutral-600 dark:text-slate-300">
                Se detectaron y actualizaron las siguientes modificaciones hechas en Google Sheets:
              </p>

              <div className="divide-y divide-neutral-100 dark:divide-slate-800 border rounded-xl overflow-hidden">
                {dobleEntradaDiffs.map((diff, idx) => (
                  <div
                    key={idx}
                    className={`p-3 flex items-center justify-between gap-3 ${
                      isDarkMode ? 'bg-slate-850/60' : 'bg-neutral-50/50'
                    }`}
                  >
                    <div>
                      <span className="font-bold text-xs block">{diff.studentName}</span>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                        {diff.termLabel} • {diff.fieldLabel}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono font-bold text-xs bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        <span>{diff.oldValue}</span>
                        <span>→</span>
                        <span className="text-blue-600 dark:text-blue-400">{diff.newValue}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className={`p-3.5 border-t flex justify-end ${
                isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              <button
                type="button"
                onClick={() => setIsDobleEntradaModalOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: AGREGAR ALUMNO MANUALMENTE (CON CORREO ELECTRÓNICO)     */}
      {/* ------------------------------------------------------------- */}
      {isAddStudentModalOpen && activeCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Agregar Alumno a {activeCourse.name}</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    Carga manual para materias sin Google Classroom
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddStudentModalOpen(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Cerrar ventana"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pestañas: Individual vs Lote */}
            <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setAddStudentTab('single')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  addStudentTab === 'single'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Carga Individual
              </button>
              <button
                type="button"
                onClick={() => setAddStudentTab('batch')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  addStudentTab === 'batch'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Cargar varios a la vez (Pegar lista)
              </button>
            </div>

            {addStudentTab === 'single' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveSingleStudent(false);
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold">
                      Apellido <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. González"
                      value={addStudentLastName}
                      onChange={(e) => setAddStudentLastName(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold">
                      Nombre <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Martín"
                      value={addStudentFirstName}
                      onChange={(e) => setAddStudentFirstName(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold">
                      Correo Electrónico (Gmail / Institucional)
                    </label>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Para mandarle avisos y mensajes
                    </span>
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                    <input
                      type="email"
                      placeholder="alumno@ejemplo.com"
                      value={addStudentEmail}
                      onChange={(e) => setAddStudentEmail(e.target.value)}
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                  </div>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Al cargar el correo podrás enviarle avisos de inasistencia, conducta o mensajes directos.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold">
                    Teléfono / WhatsApp (Opcional)
                  </label>
                  <div className="relative">
                    <Smartphone className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                    <input
                      type="tel"
                      placeholder="+54 9 11 1234-5678"
                      value={addStudentPhone}
                      onChange={(e) => setAddStudentPhone(e.target.value)}
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold">
                    Observaciones o Nota Inicial (Opcional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ej. Alumno ingresante, libreta sanitaria entregada..."
                    value={addStudentNotes}
                    onChange={(e) => setAddStudentNotes(e.target.value)}
                    className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                    }`}
                  />
                </div>

                <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddStudentModalOpen(false)}
                    className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Cancelar
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isSavingManualStudent}
                      onClick={() => handleSaveSingleStudent(true)}
                      className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-neutral-100 dark:bg-slate-800 hover:bg-neutral-200 dark:hover:bg-slate-700 text-neutral-800 dark:text-slate-200 border border-neutral-200 dark:border-slate-700 cursor-pointer transition-colors"
                      title="Guardar este alumno y mantener el formulario abierto para cargar el siguiente"
                    >
                      Guardar y agregar otro
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingManualStudent}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isSavingManualStudent ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Guardar Alumno</span>
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs">
                  <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                    📋 Pegá una lista completa de alumnos desde Excel o Word:
                  </p>
                  <p className="text-neutral-600 dark:text-slate-400 mt-1">
                    Cada renglón debe tener el formato: <code>Apellido, Nombre, correo@ejemplo.com</code>
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold">
                    Lista de estudiantes (una fila por alumno):
                  </label>
                  <textarea
                    rows={8}
                    placeholder={`Pérez, Juan, juan.perez@colegio.edu.ar\nGómez, María, maria.gomez@gmail.com\nRodríguez, Lucas, lucas.rodriguez@gmail.com`}
                    value={batchStudentsText}
                    onChange={(e) => setBatchStudentsText(e.target.value)}
                    className={`w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                    }`}
                  />
                </div>

                <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddStudentModalOpen(false)}
                    className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isSavingManualStudent || !batchStudentsText.trim()}
                    onClick={handleSaveBatchStudents}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {isSavingManualStudent ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Importar lista de alumnos</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: ENVIAR MENSAJE DIRECTO AL ESTUDIANTE (CORREO / WHATSAPP) */}
      {/* ------------------------------------------------------------- */}
      {directMessageModal.isOpen && directMessageModal.student && activeCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Enviar Mensaje al Alumno</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    Destinatario: <strong className="text-neutral-900 dark:text-slate-100">{directMessageModal.student.lastName}, {directMessageModal.student.firstName}</strong>
                    {directMessageModal.student.email && ` (${directMessageModal.student.email})`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDirectMessageModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Canal de Envío */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Canal de comunicación:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDirectMessageModal(prev => ({ ...prev, channel: 'gmail' }))}
                  className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    directMessageModal.channel === 'gmail'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                      : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Correo / Gmail</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirectMessageModal(prev => ({ ...prev, channel: 'classroom' }))}
                  className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    directMessageModal.channel === 'classroom'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                      : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>Classroom</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirectMessageModal(prev => ({ ...prev, channel: 'whatsapp' }))}
                  className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    directMessageModal.channel === 'whatsapp'
                      ? 'bg-green-600 text-white border-green-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                      : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>WhatsApp</span>
                </button>
              </div>
            </div>

            {/* Asunto */}
            {directMessageModal.channel === 'gmail' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Asunto del mensaje:
                </label>
                <input
                  type="text"
                  value={directMessageModal.subject}
                  onChange={(e) => setDirectMessageModal(prev => ({ ...prev, subject: e.target.value }))}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
            )}

            {/* Plantillas Rápidas */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-neutral-500 dark:text-slate-400">
                Plantillas rápidas:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Recordatorio entrega', text: `Hola ${directMessageModal.student.firstName},\n\nTe recuerdo que tenés una actividad pendiente de entrega en la materia ${activeCourse.name}. Por favor completala a la brevedad.\n\nSaludos,\nProfesor/a.` },
                  { label: 'Consulta inasistencias', text: `Estimado/a ${directMessageModal.student.firstName},\n\nNos ponemos en contacto debido a que registrás faltas recientes en ${activeCourse.name}. Si necesitás el material de las clases o justificar la inasistencia, avisanos.\n\nSaludos cordiales.` },
                  { label: 'Felicitación y mérito', text: `¡Felicitaciones ${directMessageModal.student.firstName}!\n\nQueríamos destacar tu excelente participación y compromiso en las clases de ${activeCourse.name}. ¡Seguí así!\n\nSaludos.` },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => setDirectMessageModal(prev => ({ ...prev, messageText: tpl.text }))}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
                        : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
                    }`}
                  >
                    + {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Texto del Mensaje */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Mensaje:
              </label>
              <textarea
                rows={5}
                value={directMessageModal.messageText}
                onChange={(e) => setDirectMessageModal(prev => ({ ...prev, messageText: e.target.value }))}
                className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDirectMessageModal(prev => ({ ...prev, isOpen: false }))}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={directMessageModal.isSending || !directMessageModal.messageText.trim()}
                onClick={handleSendDirectMessage}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {directMessageModal.isSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Enviar {directMessageModal.channel === 'gmail' ? 'por Gmail / Correo' : directMessageModal.channel === 'whatsapp' ? 'por WhatsApp' : 'por Classroom'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Course & Student Reports Modal */}
      {courseReportModalOpen && activeCourse && (
        <CourseReportModal
          isOpen={courseReportModalOpen}
          onClose={() => setCourseReportModalOpen(false)}
          courseId={activeCourse.id}
          courseName={activeCourse.name}
          students={courseStudents}
          isDarkMode={isDarkMode}
          score1cMap={{}}
          score2cMap={{}}
          annualOverrides={{}}
          driveFolderId={activeCourse.driveFolderId}
          driveFolderUrl={activeCourse.driveFolderUrl}
          initialTab={courseReportModalTab}
          initialStudentId={courseReportModalStudentId}
        />
      )}
    </div>
  );
};

export default ClassesModule;
