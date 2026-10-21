import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
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
  BellOff,
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
import {
  exportCourseClassHistoryToExcel,
  exportCourseDispositionToExcel,
  exportGradebookMatrixToExcel,
  GradeHistoryEntry,
} from '../../utils/excelExport';
import { GradeCategory, GradeSubcategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../../types/grades';
import { ErrorBoundary } from '../common/ErrorBoundary';

const GradebookMatrix = lazy(() =>
  import('./GradebookMatrix').then((m) => ({ default: m.GradebookMatrix }))
);
const LibroDeTemasMatrix = lazy(() =>
  import('./LibroDeTemasMatrix').then((m) => ({ default: m.LibroDeTemasMatrix }))
);
const ImportGradesModal = lazy(() =>
  import('./ImportGradesModal').then((m) => ({ default: m.ImportGradesModal }))
);
const CourseReportModal = lazy(() =>
  import('./CourseReportModal').then((m) => ({ default: m.CourseReportModal }))
);
import { Course, Student, AttendanceStatus, StudentHistoryItem, StudentDispositionData, AbsenceNotificationSettings, AbsencePresetTemplate, StudentObservation } from '../../types';
import {
  api,
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
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
import { extractWeekdaysFromSchedule } from '../../utils/schoolHolidays';
import { firestoreSync, getActiveUserId } from '../../services/firestoreSync';
import { enqueueOfflineAction, flushOfflineSyncQueue } from '../../services/offlineSyncQueue';
import { isRealGoogleSpreadsheetId, copyTableToClipboard, extractSpreadsheetIdFromInput } from '../../utils/sheetsUtils';
import { AttendanceHeader } from './classes/AttendanceHeader';
import { CourseHeaderCard } from './classes/CourseHeaderCard';
import { StudentAttendanceRow } from './classes/StudentAttendanceRow';
import { GoogleSyncManager } from './classes/GoogleSyncManager';
import { GoogleSessionExpiryBanner } from './classes/GoogleSessionExpiryBanner';
import { sheetsSyncQueue } from '../../services/workspace/sheetsSyncQueue';
import { AttendanceSettingsModal } from './classes/AttendanceSettingsModal';
import { BackupRestoreModal } from './classes/BackupRestoreModal';
import { QuickRollCallModal } from './classes/QuickRollCallModal';
import {
  DirectMessageModal,
  AddStudentModal,
  DobleEntradaModal,
  HeaderExportExcelModal,
} from './classes/CourseUtilityModals';
import { DriveFolderModal, SheetsConnectModal } from './classes/DriveSheetsModals';
import { CalendarSyncModal, EditCourseDetailsModal } from './classes/CourseCalendarAndEditModals';
import { CourseHistoryTabView } from './classes/CourseHistoryTabView';
import { StudentProfileObservationsModal } from './classes/StudentProfileObservationsModal';
import { PendingNotificationsInbox } from './classes/PendingNotificationsInbox';
import {
  ConductRecordModal,
  ManageConductOptionsModal,
  StudentIndividualHistoryModal,
  SendDispositionToGradesModal,
} from './classes/ConductAndHistoryModals';
import {
  EditStudentDispositionModal,
  EditStudentAbsencesModal,
} from './classes/EditDispositionAndAbsencesModals';
import {
  IndividualAbsenceNotificationModal,
  BatchAbsenceNotificationModal,
  NotificationPresetsConfigModal,
} from './classes/AbsenceAndConductNotificationModals';
import { useAttendanceSync } from '../../hooks/useAttendanceSync';
import {
  AttendanceSettings,
  getCourseAttendanceSettings,
  saveCourseAttendanceSettings,
  loadCourseAttendanceSettingsFromCloud,
  computeStudentAttendanceTrafficLight,
  computeCourseAttendanceSummary,
  getCurrentCalendarTerm,
} from '../../utils/attendanceCalculations';

interface ClassesModuleProps {
  courses: Course[];
  students: Student[];
  selectedCourseId?: string;
  initialSubTab?: 'roster' | 'libro_temas' | 'grades' | 'history';
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
  initialSubTab,
  onSelectCourse,
  onRefreshData,
  onNavigate,
  onOpenNewModal,
}) => {
  const { isDarkMode, token, user, loginWithGoogle, requestAccessToken, isTokenExpired, renewGoogleSession } = useWorkspaceAuth();
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

  // Active view: 'roster' (Alumnos/as) vs 'libro_temas' (Libro de Temas) vs 'grades' (Calificaciones) vs 'history' (Bitácora / Historial Google Sheets)
  const [activeTab, setActiveTab] = useState<'roster' | 'libro_temas' | 'grades' | 'history'>(
    initialSubTab || 'roster'
  );

  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(initialSubTab);
    }
  }, [initialSubTab]);

  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSyncingClassroomRoster, setIsSyncingClassroomRoster] = useState(false);
  const [needsRosterPermission, setNeedsRosterPermission] = useState(false);

  // Semáforo de asistencia, semanas de clase y calendario escolar
  const [isAttendanceSettingsModalOpen, setIsAttendanceSettingsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isQuickRollCallOpen, setIsQuickRollCallOpen] = useState(false);
  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettings>(() =>
    getCourseAttendanceSettings(activeCourse?.id, activeCourse?.schedule)
  );

  useEffect(() => {
    if (activeCourse) {
      setAttendanceSettings(getCourseAttendanceSettings(activeCourse.id, activeCourse.schedule));
      let mounted = true;
      loadCourseAttendanceSettingsFromCloud(activeCourse.id, activeCourse.schedule)
        .then((cloudSettings) => {
          if (mounted && cloudSettings) {
            setAttendanceSettings(cloudSettings);
          }
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }
  }, [activeCourse?.id, activeCourse?.schedule]);

  // Listen to open attendance settings triggered from Sidebar
  useEffect(() => {
    const handleOpenSettingsEvent = () => {
      setIsAttendanceSettingsModalOpen(true);
    };
    const handleGlobalUpdate = () => {
      if (activeCourse) {
        setAttendanceSettings(getCourseAttendanceSettings(activeCourse.id, activeCourse.schedule));
      }
    };
    window.addEventListener('docencia_open_attendance_settings', handleOpenSettingsEvent);
    window.addEventListener('docencia_global_attendance_settings_updated', handleGlobalUpdate);
    return () => {
      window.removeEventListener('docencia_open_attendance_settings', handleOpenSettingsEvent);
      window.removeEventListener('docencia_global_attendance_settings_updated', handleGlobalUpdate);
    };
  }, [activeCourse?.id, activeCourse?.schedule]);

  // Modal 1: Sincronizar / Seleccionar Horarios con Google Calendar (manual, sin auto-adivinar)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [calendarModalCourse, setCalendarModalCourse] = useState<Course | null>(null);
  const [calendarScheduleSelection, setCalendarScheduleSelection] = useState('');
  const [syncToGoogleFromModal, setSyncToGoogleFromModal] = useState(true);
  const [isSavingCalendarSelection, setIsSavingCalendarSelection] = useState(false);

  // Fast Slot Picker from Calendar (defaults only to primary Classroom-linked calendar, with selector)
  const [selectedCalendarForSlots, setSelectedCalendarForSlots] = useState<string>('primary');
  const [availableCalendarsForSlots, setAvailableCalendarsForSlots] = useState<
    { id: string; summary: string; primary?: boolean }[]
  >([
    { id: 'primary', summary: 'Calendario Principal (Cuenta Classroom)', primary: true },
  ]);
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
        const stored = getUserScopedItem('fds_disposition_data_2c');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return {};
  });

  // Academic term for Attendance & Disposition & Grades: '1c' | '2c' | 'annual'
  // Defaults automatically to the current cuatrimestre according to the school calendar (1°C or 2°C),
  // while allowing the teacher to freely move/switch between 1°C, 2°C and Resumen Anual.
  const [hasManuallySelectedTerm, setHasManuallySelectedTerm] = useState(false);
  const [attendanceTerm, setAttendanceTerm] = useState<'1c' | '2c' | 'annual'>(() =>
    getCurrentCalendarTerm(attendanceSettings)
  );

  // Keep default term aligned with calendar settings unless the teacher manually moved it
  useEffect(() => {
    if (!hasManuallySelectedTerm) {
      setAttendanceTerm(getCurrentCalendarTerm(attendanceSettings));
    }
  }, [
    attendanceSettings.termStartDate1c,
    attendanceSettings.termEndDate1c,
    attendanceSettings.termStartDate2c,
    attendanceSettings.termEndDate2c,
    hasManuallySelectedTerm,
  ]);

  const activeConcreteTerm: '1c' | '2c' =
    attendanceTerm === '1c' || attendanceTerm === '2c'
      ? attendanceTerm
      : getCurrentCalendarTerm(attendanceSettings);

  const setAttendanceTermHandler = (term: '1c' | '2c' | 'annual') => {
    setHasManuallySelectedTerm(true);
    setAttendanceTerm(term);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fds_attendance_active_term', term);
      if (activeCourse?.id) {
        localStorage.setItem(`fds_attendance_active_term_${activeCourse.id}`, term);
        localStorage.setItem(`fds_grades_active_term_${activeCourse.id}`, term);
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

  // Carga inicial y sincronización con el backend y Firestore para plantillas de conducta, presets, ajustes y 2°C
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

    const uid = getActiveUserId();
    if (uid) {
      firestoreSync
        .loadUserSetting<AbsencePresetTemplate[]>(uid, 'notification_presets')
        .then((cloudPresets) => {
          if (!isMounted || !Array.isArray(cloudPresets) || cloudPresets.length === 0) return;
          setSavedPresets((prev) => {
            const byId = new Map<string, AbsencePresetTemplate>();
            prev.forEach((p) => byId.set(p.id, p));
            cloudPresets.forEach((p) => {
              if (p && p.id && p.text) byId.set(p.id, p);
            });
            const merged = Array.from(byId.values());
            try {
              localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});

      firestoreSync
        .loadUserSetting<AbsenceNotificationSettings>(uid, 'notification_settings')
        .then((cloudSettings) => {
          if (!isMounted || !cloudSettings || typeof cloudSettings !== 'object') return;
          setNotifSettings((prev) => {
            const merged = { ...prev, ...cloudSettings };
            try {
              localStorage.setItem(LOCAL_NOTIF_SETTINGS_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});

      firestoreSync
        .loadUserSetting<Record<string, StudentDispositionData>>(uid, 'disposition_map_2c')
        .then((cloud2c) => {
          if (!isMounted || !cloud2c || typeof cloud2c !== 'object' || Object.keys(cloud2c).length === 0) return;
          setDispositionMap2c((prev) => {
            const merged = { ...cloud2c, ...prev };
            try {
              setUserScopedItem('fds_disposition_data_2c', JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});
    }

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
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_presets', updated).catch(() => {});
    }
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
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_presets', updated).catch(() => {});
    }
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
      dontShowPopupOnAbsence: true,
      dontShowPopupOnDisposition: true,
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
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_settings', newSettings).catch(() => {});
    }
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
    selectedPresetId: string;
    showSavePresetInput: boolean;
    newPresetName: string;
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
      (h) =>
        h.courseId === activeCourse.id &&
        h.category === 'Ausencia' &&
        !h.messageSent &&
        !h.omitNotification &&
        h.notificationMethod !== 'omitted'
    );
  }, [historyList, activeCourse?.id]);

  // Pending conduct items for current course (without sent notification)
  const pendingConductItems = useMemo(() => {
    if (!activeCourse) return [];
    return historyList.filter(
      (h) =>
        h.courseId === activeCourse.id &&
        h.category === 'Disposición' &&
        !h.messageSent &&
        !h.omitNotification &&
        h.notificationMethod !== 'omitted'
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
        const stored = getUserScopedItem('fds_student_observations');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return {};
  });

  // Load student observations from Firestore on mount & whenever user or network changes
  useEffect(() => {
    let isMounted = true;

    const loadCloudObservations = async () => {
      const uid = getActiveUserId();
      if (!uid) return;
      try {
        const cloudMap = await firestoreSync.loadStudentObservationsMap(uid);
        if (!isMounted || !cloudMap || typeof cloudMap !== 'object') return;
        setStudentObservations((prev) => {
          const merged: Record<string, StudentObservation[]> = { ...prev };
          let changed = false;
          for (const [stId, cloudList] of Object.entries(cloudMap)) {
            if (!Array.isArray(cloudList)) continue;
            const localList = merged[stId] || [];
            const existingIds = new Set(localList.map((o) => o.id));
            const newItems = cloudList.filter((o) => o && o.id && !existingIds.has(o.id));
            if (newItems.length > 0 || (localList.length === 0 && cloudList.length > 0)) {
              merged[stId] = [...localList, ...newItems].sort(
                (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
              );
              changed = true;
            }
          }
          if (changed && typeof window !== 'undefined') {
            setUserScopedItem('fds_student_observations', JSON.stringify(merged));
          }
          return changed ? merged : prev;
        });
      } catch (_) {}
    };

    loadCloudObservations();

    // Automatically flush pending offline observations and re-sync when network returns
    const handleNetworkRestored = () => {
      flushOfflineSyncQueue(async (action) => {
        const uid = getActiveUserId();
        if (!uid) return false;
        try {
          if (action.type === 'observation_save' && action.payload?.obs) {
            await firestoreSync.saveStudentObservation(uid, action.payload.obs, action.payload.map);
            return true;
          } else if (action.type === 'observation_delete' && action.payload?.map) {
            await firestoreSync.saveStudentObservationsMap(uid, action.payload.map);
            return true;
          }
        } catch (_) {
          return false;
        }
        return true;
      });
      loadCloudObservations();
    };

    window.addEventListener('docencia_network_restored', handleNetworkRestored);
    window.addEventListener('docencia_trigger_queue_flush', handleNetworkRestored);

    return () => {
      isMounted = false;
      window.removeEventListener('docencia_network_restored', handleNetworkRestored);
      window.removeEventListener('docencia_trigger_queue_flush', handleNetworkRestored);
    };
  }, [user?.email, user?.id, activeCourse?.id]);

  // Exportación directa de la Ficha de Seguimiento del Alumno a Google Drive como Google Doc (.gdoc) editable
  const [showProfileDocConfirm, setShowProfileDocConfirm] = useState(false);
  const [profileDocTitle, setProfileDocTitle] = useState('');
  const [profileDocLinkToObs, setProfileDocLinkToObs] = useState(true);
  const [isExportingProfileDoc, setIsExportingProfileDoc] = useState(false);
  const [exportedProfileDoc, setExportedProfileDoc] = useState<{
    id: string;
    name: string;
    webViewLink: string;
    studentId: string;
  } | null>(null);
  const [profileDocError, setProfileDocError] = useState<string | null>(null);

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

  // Modal de Importar desde Excel / Sheets en Asistencia y Disposición
  const [isHeaderImportModalOpen, setIsHeaderImportModalOpen] = useState(false);
  const [headerImportSourceType, setHeaderImportSourceType] = useState<'file' | 'sheets' | 'paste'>('file');
  const [headerImportContext, setHeaderImportContext] = useState<'grades' | 'attendance'>('attendance');

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
    reportsFolder?: { id: string; name: string; url: string };
    attendanceFolder: { id: string; name: string; url: string };
    gradesFolder: { id: string; name: string; url: string };
    attendanceSheetUrl?: string;
    gradesSheetUrl?: string;
    libroDeTemasSheetUrl?: string;
  } | null>(null);

  // Course and Student report modal state
  const [courseReportModalOpen, setCourseReportModalOpen] = useState<boolean>(false);
  const [courseReportModalTab, setCourseReportModalTab] = useState<'course' | 'individual'>('course');
  const [courseReportModalStudentId, setCourseReportModalStudentId] = useState<string>('all');

  // Auto-open modal if specified in URL query params (?openReport=true or ?studentId=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlStudentId = params.get('studentId');
      const urlOpenReport = params.get('openReport') === 'true' || params.get('report') === 'true';
      const urlReportTab = params.get('reportTab');

      if (urlOpenReport) {
        if (urlReportTab === 'course' || urlReportTab === 'individual') {
          setCourseReportModalTab(urlReportTab);
        }
        if (urlStudentId) {
          setCourseReportModalStudentId(urlStudentId);
        }
        setCourseReportModalOpen(true);
      } else if (urlStudentId && courseStudents.length > 0) {
        const target = courseStudents.find((s) => s.id === urlStudentId);
        if (target) {
          setSelectedStudentForProfile(target);
        }
      }
    } catch (_) {}
  }, [courseStudents]);

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

    // Cross-tab real-time sync: when another tab updates attendance/disposition
    const handleCrossTabStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key.includes('fds_disposition') ||
        e.key.includes('docencia_disposition') ||
        e.key.includes('fds_grade')
      ) {
        try {
          const stored = getAllDispositionStorage();
          handleStorageChange({ detail: stored });
          const raw2c = getUserScopedItem('fds_disposition_data_2c');
          if (raw2c) {
            setDispositionMap2c(JSON.parse(raw2c));
          }
        } catch (_) {}
      }
    };
    window.addEventListener('storage', handleCrossTabStorage);

    return () => {
      window.removeEventListener('docencia_disposition_storage_change', handleStorageChange);
      window.removeEventListener('storage', handleCrossTabStorage);
    };
  }, []);

  // Load from Compact v2 Cloud Engine / backend API, keeping localStorage synced (1°C, 2°C & History in a single round-trip)
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
          if (res.disposition2c && Object.keys(res.disposition2c).length > 0) {
            setDispositionMap2c((prev) => {
              const incoming2c = res.disposition2c!;
              const incomingKeys = Object.keys(incoming2c);
              let hasChanged = false;
              for (const k of incomingKeys) {
                if (
                  !prev[k] ||
                  prev[k].totalAbsences !== incoming2c[k]?.totalAbsences ||
                  prev[k].totalLates !== incoming2c[k]?.totalLates ||
                  prev[k].totalDisposition !== incoming2c[k]?.totalDisposition
                ) {
                  hasChanged = true;
                  break;
                }
              }
              return hasChanged ? { ...prev, ...incoming2c } : prev;
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
        setToastMessage('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
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
        setToastMessage('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
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
      const termToExport = activeConcreteTerm;
      const termLabel = termToExport === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
      const catsRaw =
        localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${termToExport}`)) ||
        localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${termToExport}`) ||
        (termToExport === '1c' ? localStorage.getItem(`fds_grades_categories_${activeCourse.id}`) : null);
      const parsedCats = catsRaw ? JSON.parse(catsRaw) : DEFAULT_CATEGORIES;
      const gradesData =
        localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${termToExport}`)) ||
        localStorage.getItem(`fds_grades_data_${activeCourse.id}_${termToExport}`) ||
        (termToExport === '1c' ? localStorage.getItem(`fds_grades_data_${activeCourse.id}`) : null);
      const parsedGrades = gradesData ? JSON.parse(gradesData) : {};
      exportGradebookMatrixToExcel(activeCourse.name, termLabel, courseStudents, parsedCats, parsedGrades);
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

  const handleApplyMultiImportFromClassesModule = async (payload: {
    term: '1c' | '2c';
    updatedCategories: GradeCategory[];
    updatedGradesMap: StudentGradesMap;
    historyEntries: any[];
    attendanceUpdates: Record<
      string,
      {
        absences?: number;
        lates?: number;
        disposition?: number;
      }
    >;
    newStudentsToCreate: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    }>;
    sourceLabel: string;
    fromGradebookEvent?: boolean;
  }) => {
    if (!activeCourse) return;
    try {
      // 1. Si no vino ya guardado desde GradebookMatrix, persistir categorías y notas
      if (!payload.fromGradebookEvent) {
        const catKey = getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${payload.term}`);
        const gradesKey = getUserStorageKey(`fds_grades_data_${activeCourse.id}_${payload.term}`);
        localStorage.setItem(catKey, JSON.stringify(payload.updatedCategories));
        localStorage.setItem(gradesKey, JSON.stringify(payload.updatedGradesMap));

        if (Array.isArray(payload.historyEntries) && payload.historyEntries.length > 0) {
          const hKey = getUserStorageKey(`fds_grade_history_${activeCourse.id}`);
          const savedHist = localStorage.getItem(hKey);
          const prevHist = savedHist ? JSON.parse(savedHist) : [];
          const updatedHist = [...payload.historyEntries, ...prevHist];
          localStorage.setItem(hKey, JSON.stringify(updatedHist));
        }

        const userId = getActiveUserId();
        if (userId) {
          firestoreSync
            .saveTermSnapshot(userId, activeCourse.id, payload.term, {
              courseId: activeCourse.id,
              term: payload.term,
              termLabel: payload.term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
              categories: payload.updatedCategories,
              gradesMap: payload.updatedGradesMap,
              updatedAt: new Date().toISOString(),
            })
            .catch(() => {});
        }

        window.dispatchEvent(
          new CustomEvent('fds-grades-updated', {
            detail: { term: payload.term, courseId: activeCourse.id },
          })
        );
      }

      // 2. Crear alumnos nuevos detectados en el archivo si corresponde (tanto desde Asistencia como desde Calificaciones)
      if (Array.isArray(payload.newStudentsToCreate) && payload.newStudentsToCreate.length > 0) {
        for (const st of payload.newStudentsToCreate) {
          const newStudentObj: Student = {
            id: st.id,
            firstName: st.firstName,
            lastName: st.lastName,
            email:
              st.email ||
              `${st.firstName.toLowerCase()}.${st.lastName.toLowerCase()}@alumno.edu.ar`.replace(
                /\s+/g,
                ''
              ),
            courseId: activeCourse.id,
            attendanceRate: 100,
            averageGrade: 0,
            notes: (st as any).notes || 'Importado desde archivo',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(st.firstName + ' ' + st.lastName)}&background=1a73e8&color=ffffff&bold=true`,
          };
          await api.createStudent(newStudentObj).catch(() => {});
        }
        onRefreshData();
      }

      // 3. Aplicar actualizaciones de asistencia y disposición si el documento tenía columnas de faltas/tardanzas/disposición
      const attEntries = Object.entries(payload.attendanceUpdates || {});
      if (attEntries.length > 0) {
        const userId = getActiveUserId();
        const is2c = payload.term === '2c';
        let updatedMapForEvent: Record<string, StudentDispositionData>;

        if (is2c) {
          const updatedMap2c: Record<string, StudentDispositionData> = { ...dispositionMap2c };
          attEntries.forEach(([stId, upd]) => {
            const current = updatedMap2c[stId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
            updatedMap2c[stId] = {
              ...current,
              totalAbsences: upd.absences !== undefined ? upd.absences : current.totalAbsences,
              totalLates: upd.lates !== undefined ? upd.lates : current.totalLates || 0,
              totalDisposition:
                upd.disposition !== undefined ? upd.disposition : current.totalDisposition,
            };
          });

          setDispositionMap2c(updatedMap2c);
          updatedMapForEvent = updatedMap2c;
          if (typeof window !== 'undefined') {
            setUserScopedItem('fds_disposition_data_2c', JSON.stringify(updatedMap2c));
            if (activeCourse?.id) {
              setUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(updatedMap2c));
            }
          }
          saveAllDispositionStorage(dispositionMap, historyList);
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
          triggerSheetsSync(dispositionMap, historyList, updatedMap2c);
        } else {
          const updatedMap1c: Record<string, StudentDispositionData> = { ...dispositionMap };
          attEntries.forEach(([stId, upd]) => {
            const current = updatedMap1c[stId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
            updatedMap1c[stId] = {
              ...current,
              totalAbsences: upd.absences !== undefined ? upd.absences : current.totalAbsences,
              totalLates: upd.lates !== undefined ? upd.lates : current.totalLates || 0,
              totalDisposition:
                upd.disposition !== undefined ? upd.disposition : current.totalDisposition,
            };
          });

          setDispositionMap(updatedMap1c);
          updatedMapForEvent = updatedMap1c;
          if (typeof window !== 'undefined' && activeCourse?.id) {
            setUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(updatedMap1c));
          }
          saveAllDispositionStorage(updatedMap1c, historyList);
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
          triggerSheetsSync(updatedMap1c, historyList, dispositionMap2c);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('docencia_disposition_storage_change', {
              detail: {
                disposition: updatedMapForEvent,
                history: historyList,
              },
            })
          );
        }
      }

      const summaryParts: string[] = [];
      if (payload.historyEntries?.length > 0) {
        summaryParts.push(`${payload.historyEntries.length} columna(s) de notas`);
      }
      if (attEntries.length > 0) {
        summaryParts.push(`asistencia/disposición de ${attEntries.length} alumno(s)`);
      }
      if (payload.newStudentsToCreate?.length > 0) {
        summaryParts.push(`${payload.newStudentsToCreate.length} alumno(s) nuevo(s)`);
      }

      setIsHeaderImportModalOpen(false);
      setToastMessage(
        `✓ ¡Importación completada (${summaryParts.join(', ') || 'datos actualizados'}) en ${
          payload.term === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'
        }!`
      );
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err) {
      console.error('Error aplicando importación múltiple:', err);
    }
  };

  useEffect(() => {
    const onMultiImportEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !activeCourse || detail.courseId !== activeCourse.id) return;
      handleApplyMultiImportFromClassesModule({
        ...detail,
        fromGradebookEvent: true,
      });
    };
    window.addEventListener('fds-multi-import-applied', onMultiImportEvent);
    return () => window.removeEventListener('fds-multi-import-applied', onMultiImportEvent);
  }, [activeCourse?.id, courseStudents]);

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

  // Abre el modal de Sincronización con Calendar y carga los eventos del calendario vinculado a Classroom (primary por defecto)
  const handleOpenCalendarSyncModal = async (course: Course, overrideCalId?: string) => {
    setCalendarModalCourse(course);
    const defaultCalId = course.preferredCalendarId || 'primary';
    if (!overrideCalId) {
      setSelectedCalendarForSlots(defaultCalId);
      setCalendarScheduleSelection(
        course.schedule &&
          course.schedule !== 'Lunes y Miércoles' &&
          !course.schedule.toLowerCase().includes('coordinar')
          ? course.schedule
          : ''
      );
      setIsCalendarModalOpen(true);
    }

    const calIdToFetch = overrideCalId || defaultCalId;

    // Cargar automáticamente los bloques de eventos del calendario seleccionado
    try {
      setIsLoadingSlots(true);
      const [calListRes, res] = await Promise.all([
        calendarService.listCalendars(),
        calendarService.getWeeklyCalendarSlots(calIdToFetch, courses),
      ]);
      if (calListRes.success && calListRes.calendars.length > 0) {
        setAvailableCalendarsForSlots(calListRes.calendars);
      }
      if (res.success) {
        setCalendarSlots(res.slots);
      } else {
        setToastMessage(res.message);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (err) {
      console.warn('Error loading calendar slots:', err);
    } finally {
      setIsLoadingSlots(false);
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
      const extractedWeekdays = extractWeekdaysFromSchedule(cleanSchedule);

      // 1. Guardar en la base de datos y Firestore (horario + calendario preferido)
      await api.updateCourse(calendarModalCourse.id, {
        schedule: cleanSchedule,
        preferredCalendarId: selectedCalendarForSlots || 'primary',
      });

      // 1b. Impactar directamente en la configuración de asistencia y libro de temas de este curso
      if (extractedWeekdays.length > 0) {
        const nextSettings: AttendanceSettings = {
          ...attendanceSettings,
          courseWeekdays: extractedWeekdays,
          classesPerWeek: extractedWeekdays.length,
        };
        saveCourseAttendanceSettings(calendarModalCourse.id, nextSettings);
        setAttendanceSettings(nextSettings);

        try {
          const libroKey = `fds_libro_temas_${calendarModalCourse.id}`;
          const currentLibroRaw = localStorage.getItem(libroKey);
          if (currentLibroRaw) {
            const parsed = JSON.parse(currentLibroRaw);
            const updatedLibro = {
              ...parsed,
              metadata: {
                ...(parsed.metadata || {}),
                horario: cleanSchedule,
                configuredWeekdays: extractedWeekdays,
              },
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(libroKey, JSON.stringify(updatedLibro));
            const uid = getActiveUserId();
            if (uid) {
              firestoreSync.saveUserSetting(uid, `libro_temas_${calendarModalCourse.id}`, updatedLibro).catch(() => {});
            }
          }
        } catch (_) {}
      }

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
              selectedCalendarForSlots || 'primary'
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
      const cleanSchedule = editCourseData.schedule.trim();
      const extractedWeekdays = extractWeekdaysFromSchedule(cleanSchedule);

      await api.updateCourse(editCourseData.id, {
        name: editCourseData.name.trim(),
        subject: editCourseData.subject.trim(),
        grade: editCourseData.grade.trim(),
        room: editCourseData.room.trim(),
        division: editCourseData.division.trim(),
        schedule: cleanSchedule,
      });

      if (extractedWeekdays.length > 0) {
        const nextSettings: AttendanceSettings = {
          ...attendanceSettings,
          courseWeekdays: extractedWeekdays,
          classesPerWeek: extractedWeekdays.length,
        };
        saveCourseAttendanceSettings(editCourseData.id, nextSettings);
        setAttendanceSettings(nextSettings);

        try {
          const libroKey = `fds_libro_temas_${editCourseData.id}`;
          const currentLibroRaw = localStorage.getItem(libroKey);
          if (currentLibroRaw) {
            const parsed = JSON.parse(currentLibroRaw);
            const updatedLibro = {
              ...parsed,
              metadata: {
                ...(parsed.metadata || {}),
                asignatura: `${editCourseData.name.trim()} (${editCourseData.division.trim() || editCourseData.grade.trim() || 'Curso'})`,
                horario: cleanSchedule,
                configuredWeekdays: extractedWeekdays,
              },
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(libroKey, JSON.stringify(updatedLibro));
            const uid = getActiveUserId();
            if (uid) {
              firestoreSync.saveUserSetting(uid, `libro_temas_${editCourseData.id}`, updatedLibro).catch(() => {});
            }
          }
        } catch (_) {}
      }

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
    targetTerm: '1c' | '2c' | 'annual' | 'all' = attendanceTerm
  ): StudentDispositionData => {
    if (targetTerm === 'annual' || targetTerm === 'all') {
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

  // Course attendance summary and traffic light calculations
  const currentAttendanceSummary = useMemo(() => {
    if (!activeCourse) return undefined;
    const studentMetricsList = courseStudents.map((s) => {
      const m = getStudentMetrics(s.id, attendanceTerm);
      return {
        studentId: s.id,
        totalAbsences: m.totalAbsences,
        totalLates: m.totalLates || 0,
      };
    });
    return computeCourseAttendanceSummary(
      studentMetricsList,
      attendanceTerm,
      attendanceSettings
    );
  }, [activeCourse, courseStudents, dispositionMap, dispositionMap2c, historyList, attendanceTerm, attendanceSettings]);

  const handleSaveAttendanceSettings = (newSettings: AttendanceSettings, updatedSchedule?: string) => {
    if (!activeCourse) return;
    saveCourseAttendanceSettings(activeCourse.id, newSettings);
    setAttendanceSettings(newSettings);
    if (updatedSchedule && updatedSchedule !== activeCourse.schedule) {
      activeCourse.schedule = updatedSchedule;
      fetch(`/api/courses/${encodeURIComponent(activeCourse.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: updatedSchedule }),
      }).catch(() => {});
    }
    setToastMessage('¡Parámetros del semáforo y semanas guardados exitosamente!');
    setTimeout(() => setToastMessage(null), 3500);
  };

  const saveTermDisposition = (
    term: '1c' | '2c',
    updatedMap: Record<string, StudentDispositionData>,
    updatedHistory: StudentHistoryItem[]
  ) => {
    const uid = getActiveUserId();
    if (term === '2c') {
      setDispositionMap2c(updatedMap);
      if (typeof window !== 'undefined') {
        setUserScopedItem('fds_disposition_data_2c', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          setUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(updatedMap));
        }
      }
      saveAllDispositionStorage(dispositionMap, updatedHistory);
      if (uid) {
        firestoreSync.syncCompactDispositionNow(uid, false);
      }
    } else {
      setDispositionMap(updatedMap);
      if (typeof window !== 'undefined' && activeCourse?.id) {
        setUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(updatedMap));
      }
      saveAllDispositionStorage(updatedMap, updatedHistory);
      if (uid) {
        firestoreSync.syncCompactDispositionNow(uid, false);
      }
    }
  };

  // -------------------------------------------------------------
  // LÓGICA DE REGISTRO IDÉNTICA AL SCRIPT DE GOOGLE SHEETS
  // -------------------------------------------------------------

  // 1. LÓGICA PARA AUSENCIAS (Columna B / número 2 del script + si tenía llegada tarde hoy, la reemplaza atómicamente)
  const handleAddAbsence = async (student: Student) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const id = `rec-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;

    // Visual feedback
    setPulsingStudentId(`abs-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const current = getStudentMetrics(student.id, targetTerm);

    // Si el mismo día el alumno tenía una Llegada Tarde registrada, se cancela automáticamente al pasarlo a Ausente
    const isTodayLate = (h: StudentHistoryItem) => {
      if (h.studentId !== student.id) return false;
      const isLate =
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza');
      if (!isLate) return false;
      return isSameCalendarDay(h.date, h.timestamp, now) || !h.date;
    };

    const todayLatesToRemove: StudentHistoryItem[] = [];
    const cleanHistory = historyList.filter((h) => {
      if (isTodayLate(h)) {
        todayLatesToRemove.push(h);
        return false;
      }
      return true;
    });

    if (todayLatesToRemove.length > 0) {
      todayLatesToRemove.forEach((l) => markHistoryIdDeleted(l.id));
    }

    const newAbsences = current.totalAbsences + 1;
    const newLates =
      todayLatesToRemove.length > 0
        ? Math.max(0, (current.totalLates || 0) - todayLatesToRemove.length)
        : current.totalLates || 0;
    const newDisposition = current.totalDisposition;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalAbsences: newAbsences,
        totalLates: newLates,
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

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...cleanHistory]);
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

    if (todayLatesToRemove.length > 0) {
      for (const item of todayLatesToRemove) {
        api.deleteDispositionHistory(item.id).catch(() => {});
      }
      const userId = getActiveUserId();
      if (userId) {
        firestoreSync.deleteTodayLatesForStudent(userId, student.id, now).catch(() => {});
      }
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
          totalLates: newLates,
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
      // Auto-send directly only if teacher configured automatic notification
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
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
      .filter(
        (item) =>
          (item.category === 'Ausencia' || item.category === 'Disposición') &&
          !item.messageSent &&
          !item.omitNotification &&
          item.notificationMethod !== 'omitted'
      )
      .map((item) => item.id);
    if (selectedPendingHistoryIds.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedPendingHistoryIds([]);
    } else {
      setSelectedPendingHistoryIds(pendingIds);
    }
  };

  // Marcar aviso como "No mandar" (sale de los pendientes pero queda en el historial docente)
  const handleMarkOmitNotification = (item: StudentHistoryItem) => {
    const updatedHistory = historyList.map((h) => {
      if (h.id === item.id) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    setSelectedPendingHistoryIds((prev) => prev.filter((id) => id !== item.id));

    // Sincronizar inmediatamente a Google Sheets para que figure 'No enviar' y no 'Pendiente'
    triggerSheetsSync(dispositionMap, updatedHistory, dispositionMap2c);

    api
      .recordDisposition({
        id: item.id,
        studentId: item.studentId,
        studentName: item.studentName,
        courseId: activeCourse.id,
        action: item.action,
        category: item.category,
        date: item.date,
        time: item.time,
        timestamp: item.timestamp,
        messageSent: false,
        notificationMethod: 'omitted',
        omitNotification: true,
        notifiedAt: 'No enviar',
      })
      .catch(() => {});

    setToastMessage(`Aviso marcado como "No mandar" para ${item.studentName}. Permanece registrado en tu historial docente.`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Marcar selección como "No mandar" en lote
  const handleBatchMarkOmitNotification = () => {
    if (selectedPendingHistoryIds.length === 0) return;
    const idsSet = new Set(selectedPendingHistoryIds);
    const updatedHistory = historyList.map((h) => {
      if (idsSet.has(h.id)) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    const count = selectedPendingHistoryIds.length;
    setSelectedPendingHistoryIds([]);

    setToastMessage(`${count} aviso${count > 1 ? 's' : ''} marcado${count > 1 ? 's' : ''} como "No mandar". Permanecen intactos en tu historial docente.`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Descartar todos los pendientes a la vez (salen de pendientes pero quedan en historial)
  const handleMarkAllPendingAsOmitted = () => {
    if (pendingAllItems.length === 0) return;
    const pendingIdsSet = new Set(pendingAllItems.map((p) => p.id));
    const updatedHistory = historyList.map((h) => {
      if (pendingIdsSet.has(h.id)) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    setSelectedPendingHistoryIds([]);
    const count = pendingAllItems.length;

    setToastMessage(`${count} aviso${count > 1 ? 's' : ''} marcado${count > 1 ? 's' : ''} como "No mandar". Todos quedan registrados en tu historial docente.`);
    setTimeout(() => setToastMessage(null), 3500);
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

    const targetTerm: '1c' | '2c' = activeConcreteTerm;
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
      // Auto-send directly only if teacher configured automatic notification
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
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
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
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
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
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
    const targetTerm: '1c' | '2c' = activeConcreteTerm;

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
      setToastMessage('Aún no hay registros en el historial de este curso para copiar.');
      setTimeout(() => setToastMessage(null), 3500);
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
    const termToUse: '1c' | '2c' = termOverride || activeConcreteTerm;
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
    const termToUse: '1c' | '2c' = termOverride || activeConcreteTerm;
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

        const willSendNotification = editingAbsenceSendNotif && editingAbsenceMessageText.trim().length > 0;
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
          messageText: willSendNotification ? editingAbsenceMessageText.trim() : '',
          notificationMethod: willSendNotification ? editingAbsenceChannel : ('omitted' as const),
          omitNotification: !willSendNotification,
          notifiedAt: !willSendNotification ? 'No enviar' : undefined,
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
        term: activeConcreteTerm,
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
        activeConcreteTerm,
        activeConcreteTerm === '2c' ? dispositionMap2c : dispositionMap,
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
        setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          setUserScopedItem(`fds_student_observations_${activeCourse.id}`, JSON.stringify(updatedMap));
        }
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveStudentObservation(uid, newObs, updatedMap).catch(() => {
            enqueueOfflineAction('observation_save', { obs: newObs, map: updatedMap });
          });
        } else {
          enqueueOfflineAction('observation_save', { obs: newObs, map: updatedMap });
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
        setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          setUserScopedItem(`fds_student_observations_${activeCourse.id}`, JSON.stringify(updatedMap));
        }
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveStudentObservationsMap(uid, updatedMap).catch(() => {
            enqueueOfflineAction('observation_delete', { map: updatedMap });
          });
        } else {
          enqueueOfflineAction('observation_delete', { map: updatedMap });
        }
      } catch (_) {}
    }

    setToastMessage('Observación eliminada.');
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Generar el HTML formateado para Google Docs (.gdoc) de la Ficha de Seguimiento del Alumno
  const buildStudentTrackingDocHtml = (
    student: Student,
    tl: any,
    disp: number,
    m1: StudentDispositionData,
    m2: StudentDispositionData
  ) => {
    const observations = studentObservations[student.id] || [];
    const termLabel =
      attendanceTerm === 'annual'
        ? 'Ciclo Lectivo Anual'
        : attendanceTerm === '1c'
        ? '1° Cuatrimestre'
        : '2° Cuatrimestre';

    const currentDateStr = new Date().toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const statusBadgeColor =
      tl.status === 'alert'
        ? '#dc2626'
        : tl.status === 'warning'
        ? '#d97706'
        : '#059669';

    const statusBg =
      tl.status === 'alert'
        ? '#fef2f2'
        : tl.status === 'warning'
        ? '#fffbeb'
        : '#ecfdf5';

    // Cargar notas de exámenes y TPs de la pestaña Calificaciones (1°C y 2°C)
    const loadTermExamsForDoc = (term: '1c' | '2c') => {
      if (!activeCourse) return [];
      try {
        const catRaw =
          localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${term}`)) ||
          localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${term}`) ||
          (term === '1c'
            ? localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}`)) ||
              localStorage.getItem(`fds_grades_categories_${activeCourse.id}`)
            : null) ||
          localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}_${term}`) ||
          (term === '1c' ? localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}`) : null);
        const cats: GradeCategory[] = catRaw ? JSON.parse(catRaw) : DEFAULT_CATEGORIES;

        const gradesRaw =
          localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${term}`)) ||
          localStorage.getItem(`fds_grades_data_${activeCourse.id}_${term}`) ||
          (term === '1c'
            ? localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}`)) ||
              localStorage.getItem(`fds_grades_data_${activeCourse.id}`)
            : null) ||
          localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}_${term}`) ||
          (term === '1c' ? localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}`) : null);
        const gMap: Record<string, Record<string, string | number>> = gradesRaw ? JSON.parse(gradesRaw) : {};
        const stGrades = gMap[student.id] || {};

        const items: { id: string; name: string; weight: number; score: number | null }[] = [];
        for (const cat of cats) {
          if (cat.id === 'cat-conceptual' || /disposici[oó]n|conducta/i.test(cat.name)) continue;
          if (!cat.subcategories || cat.subcategories.length === 0) {
            const rawVal = stGrades[cat.id];
            const parsedNum =
              rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                ? Number(String(rawVal).replace(',', '.'))
                : NaN;
            items.push({
              id: cat.id,
              name: cat.name,
              weight: (cat as any).weight ?? 0,
              score: !isNaN(parsedNum) ? parsedNum : null,
            });
          } else {
            for (const sub of cat.subcategories) {
              if (/disposici[oó]n|conducta/i.test(sub.name)) continue;
              const rawVal = stGrades[sub.id];
              const parsedNum =
                rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                  ? Number(String(rawVal).replace(',', '.'))
                  : NaN;
              items.push({
                id: sub.id,
                name: sub.name,
                weight: (sub as any).weight ?? (cat as any).weight ?? 0,
                score: !isNaN(parsedNum) ? parsedNum : null,
              });
            }
          }
        }
        return items;
      } catch {
        return [];
      }
    };

    const exams1c = loadTermExamsForDoc('1c');
    const exams2c = loadTermExamsForDoc('2c');

    // Calcular promedios de 1°C, 2°C y Final si hay notas cargadas
    const computeWeightedAvg = (items: { weight: number; score: number | null }[]) => {
      const valid = items.filter((i) => i.score !== null);
      if (valid.length === 0) return null;
      const totalWeight = valid.reduce((acc, cur) => acc + (cur.weight || 1), 0);
      if (totalWeight <= 0) return null;
      const sum = valid.reduce((acc, cur) => acc + (cur.score || 0) * (cur.weight || 1), 0);
      return Number((sum / totalWeight).toFixed(2));
    };

    const avg1c = computeWeightedAvg(exams1c);
    const avg2c = computeWeightedAvg(exams2c);
    const finalAvg =
      avg1c !== null && avg2c !== null
        ? Number(((avg1c + avg2c) / 2).toFixed(2))
        : avg1c !== null
        ? avg1c
        : avg2c;

    // Historial de eventos del estudiante en el curso actual
    const studentHistoryEvents = historyList
      .filter((h) => h.studentId === student.id && (!activeCourse || h.courseId === activeCourse.id))
      .slice(0, 25);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Ficha de Seguimiento - ${student.lastName}, ${student.firstName}</title>
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      font-size: 11pt;
      margin: 24px;
    }
    h1 {
      font-size: 16pt;
      color: #1e3a8a;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    h2 {
      font-size: 12pt;
      color: #1e40af;
      border-bottom: 2px solid #cbd5e1;
      padding-bottom: 4px;
      margin-top: 20px;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 10px;
      font-size: 10pt;
      text-align: left;
      vertical-align: top;
    }
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <table style="border: none; border-bottom: 3px solid #2563eb; margin-bottom: 16px;">
    <tr>
      <td style="border: none; padding: 0 0 10px 0;">
        <h1>Ficha de Seguimiento Académico y Pedagógico</h1>
        <div style="font-size: 10pt; color: #64748b;">Documento editable de seguimiento individual • Ciclo Lectivo ${new Date().getFullYear()}</div>
      </td>
      <td style="border: none; padding: 0 0 10px 0; text-align: right; font-size: 10pt; color: #475569;">
        <div><strong>Fecha de emisión:</strong> ${currentDateStr}</div>
        <div><strong>Período evaluado:</strong> ${termLabel}</div>
      </td>
    </tr>
  </table>

  <table>
    <tr>
      <th style="width: 35%;">Estudiante</th>
      <th style="width: 35%;">Materia / Espacio Curricular</th>
      <th style="width: 30%;">Curso / Aula / Contacto</th>
    </tr>
    <tr>
      <td><strong>${student.lastName}, ${student.firstName}</strong></td>
      <td><strong>${activeCourse?.name || 'Materia'}</strong> (${activeCourse?.grade || ''} ${activeCourse?.division || ''})</td>
      <td>${activeCourse?.room || activeCourse?.schedule || 'Turno Regular'}<br/><span style="font-size: 9pt; color: #64748b;">${student.email || 'Sin correo registrado'}</span></td>
    </tr>
  </table>

  <h2>1. Resumen de Asistencia, Regularidad y Disposición</h2>
  <table>
    <tr>
      <td colspan="4" style="background-color: ${statusBg}; border-color: ${statusBadgeColor};">
        <strong style="color: ${statusBadgeColor}; font-size: 11pt;">● Estado de Regularidad: ${tl.statusLabel} (${tl.percentage}% de asistencia)</strong><br/>
        <span style="font-size: 9.5pt; color: #334155;">
          Límite permitido: <strong>${tl.maxAllowedAbsences} inasistencias</strong> • 
          ${
            tl.remainingAbsences >= 0
              ? `Margen disponible: <strong>${tl.remainingAbsences} faltas</strong>`
              : `<strong style="color: #dc2626;">Excedido por ${Math.abs(tl.remainingAbsences)} faltas</strong>`
          }
        </span>
      </td>
    </tr>
    <tr>
      <th style="width: 25%; text-align: center;">Clases Dictadas</th>
      <th style="width: 25%; text-align: center;">Inasistencias Totales</th>
      <th style="width: 25%; text-align: center;">Llegadas Tarde</th>
      <th style="width: 25%; text-align: center;">Disposición / Conducta</th>
    </tr>
    <tr>
      <td style="text-align: center;">
        <strong style="font-size: 13pt;">${tl.totalClasses}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">${tl.attendedClasses} asistidas</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: ${tl.totalAbsences > 0 ? '#dc2626' : '#059669'};">${m1.totalAbsences + m2.totalAbsences}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalAbsences} | 2°C: ${m2.totalAbsences}</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: #d97706;">${(m1.totalLates || 0) + (m2.totalLates || 0)}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalLates || 0} | 2°C: ${m2.totalLates || 0}</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: ${disp >= 8 ? '#059669' : disp >= 6 ? '#d97706' : '#dc2626'};">${disp} / 10</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalDisposition}/10 | 2°C: ${m2.totalDisposition}/10</span>
      </td>
    </tr>
  </table>

  <h2>2. Rendimiento Académico, Exámenes y Trabajos Prácticos</h2>
  <table>
    <tr>
      <th style="width: 33%; text-align: center;">Promedio 1° Cuatrimestre</th>
      <th style="width: 33%; text-align: center;">Promedio 2° Cuatrimestre</th>
      <th style="width: 34%; text-align: center;">Promedio General / Final</th>
    </tr>
    <tr>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${avg1c !== null ? (avg1c >= 7 ? '#059669' : avg1c >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${avg1c !== null ? avg1c : 'Sin calificar'}
      </td>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${avg2c !== null ? (avg2c >= 7 ? '#059669' : avg2c >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${avg2c !== null ? avg2c : 'Sin calificar'}
      </td>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${finalAvg !== null ? (finalAvg >= 7 ? '#059669' : finalAvg >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${finalAvg !== null ? finalAvg : 'En curso'}
      </td>
    </tr>
  </table>

  <table>
    <tr>
      <th colspan="2" style="width: 50%; background-color: #eef2ff; color: #312e81;">1° Cuatrimestre (Exámenes / TPs)</th>
      <th colspan="2" style="width: 50%; background-color: #eef2ff; color: #312e81;">2° Cuatrimestre (Exámenes / TPs)</th>
    </tr>
    <tr>
      <th style="width: 35%;">Instancia Evaluativa</th>
      <th style="width: 15%; text-align: center;">Nota</th>
      <th style="width: 35%;">Instancia Evaluativa</th>
      <th style="width: 15%; text-align: center;">Nota</th>
    </tr>
    ${(() => {
      const maxRows = Math.max(exams1c.length, exams2c.length, 1);
      let rowsHtml = '';
      for (let i = 0; i < maxRows; i++) {
        const e1 = exams1c[i];
        const e2 = exams2c[i];
        const c1Color = e1 && e1.score !== null ? (e1.score >= 7 ? '#059669' : e1.score >= 4 ? '#d97706' : '#dc2626') : '#94a3b8';
        const c2Color = e2 && e2.score !== null ? (e2.score >= 7 ? '#059669' : e2.score >= 4 ? '#d97706' : '#dc2626') : '#94a3b8';
        rowsHtml += `
          <tr>
            <td>${e1 ? `${e1.name} <span style="color:#64748b;font-size:9pt;">(${e1.weight}%)</span>` : '-'}</td>
            <td style="text-align: center; font-weight: bold; color: ${c1Color};">${e1 ? (e1.score !== null ? e1.score : 'S/C') : '-'}</td>
            <td>${e2 ? `${e2.name} <span style="color:#64748b;font-size:9pt;">(${e2.weight}%)</span>` : '-'}</td>
            <td style="text-align: center; font-weight: bold; color: ${c2Color};">${e2 ? (e2.score !== null ? e2.score : 'S/C') : '-'}</td>
          </tr>
        `;
      }
      return rowsHtml;
    })()}
  </table>

  <h2>3. Observaciones Pedagógicas y Acuerdos Registrados</h2>
  ${
    observations.length === 0
      ? `<p style="color: #64748b; font-style: italic;">No se registran observaciones particulares previas. El docente puede redactar observaciones adicionales a continuación:</p>`
      : `<table>
          <tr>
            <th style="width: 18%;">Fecha</th>
            <th style="width: 82%;">Detalle de la Observación / Informe</th>
          </tr>
          ${observations
            .map(
              (obs: any) => `
            <tr>
              <td><strong>${obs.date}</strong></td>
              <td>
                ${obs.text || 'Sin detalle de texto'}
                ${obs.reportUrl ? `<br/><a href="${obs.reportUrl}" style="color: #2563eb; font-size: 9pt;">Enlace adjunto: ${obs.reportUrl}</a>` : ''}
              </td>
            </tr>
          `
            )
            .join('')}
        </table>`
  }

  <h2>4. Registro Cronológico de Seguimiento en Clase</h2>
  ${
    studentHistoryEvents.length === 0
      ? `<p style="color: #64748b; font-style: italic;">No se registran novedades de asistencia o disposición en el historial reciente.</p>`
      : `<table>
          <tr>
            <th style="width: 18%;">Fecha</th>
            <th style="width: 18%;">Categoría</th>
            <th style="width: 64%;">Detalle / Motivo</th>
          </tr>
          ${studentHistoryEvents
            .map(
              (ev) => `
            <tr>
              <td>${ev.date}</td>
              <td><strong>${ev.category}</strong> (${ev.term === '2c' ? '2°C' : '1°C'})</td>
              <td>${ev.action}${ev.pointsChange ? ` (${ev.pointsChange > 0 ? `+${ev.pointsChange}` : ev.pointsChange} pts)` : ''}</td>
            </tr>
          `
            )
            .join('')}
        </table>`
  }

  <h2>5. Espacio Editable para Intervención Docente y Acuerdos</h2>
  <table>
    <tr>
      <td style="height: 85px; background-color: #fafafa; color: #475569;">
        <strong>Observaciones / Compromisos acordados (espacio editable en Google Docs):</strong><br/><br/>
        • Fortalezas observadas:<br/>
        • Aspectos a mejorar / contenidos pendientes:<br/>
        • Acuerdos con el estudiante y la familia:
      </td>
    </tr>
  </table>

  <table style="border: none; margin-top: 36px;">
    <tr>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Firma y Aclaración Docente</strong>
      </td>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Firma Estudiante / Familia</strong>
      </td>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Equipo Directivo / Preceptoría</strong>
      </td>
    </tr>
  </table>
</body>
</html>`;
  };

  const handleOpenExportProfileDocConfirm = (student: Student) => {
    const defaultTitle = `📄 Ficha de Seguimiento - ${student.lastName}, ${student.firstName} (${activeCourse?.name || 'Materia'})`;
    setProfileDocTitle(defaultTitle);
    setProfileDocError(null);
    setShowProfileDocConfirm(true);
  };

  const handleConfirmExportProfileToGoogleDoc = async (
    student: Student,
    tl: any,
    disp: number,
    m1: StudentDispositionData,
    m2: StudentDispositionData
  ) => {
    if (!student || !activeCourse) return;
    setIsExportingProfileDoc(true);
    setProfileDocError(null);

    try {
      const htmlContent = buildStudentTrackingDocHtml(student, tl, disp, m1, m2);
      const finalDocTitle =
        profileDocTitle.trim() ||
        `📄 Ficha de Seguimiento - ${student.lastName}, ${student.firstName} (${activeCourse.name})`;

      // Obtener o asegurar la carpeta del curso en Google Drive
      let parentFolderId = courseDriveStructure?.mainFolder?.id;
      if (!parentFolderId) {
        try {
          const folderStruct = await driveService.ensureCourseFolderStructure(
            activeCourse.name,
            activeCourse.id
          );
          parentFolderId = folderStruct.mainFolder.id;
          setCourseDriveStructure(folderStruct);
        } catch {
          // Si no se pudo crear carpeta, se guarda en Mi Unidad de Drive
        }
      }

      // Crear el documento nativo editable de Google Docs (.gdoc) mediante la API de Google Drive
      const uploadedDoc = await driveService.uploadReportFile(
        finalDocTitle,
        htmlContent,
        parentFolderId,
        true
      );

      const docLink = uploadedDoc.webViewLink || uploadedDoc.url;

      setExportedProfileDoc({
        id: uploadedDoc.id,
        name: uploadedDoc.name,
        webViewLink: docLink,
        studentId: student.id,
      });
      setShowProfileDocConfirm(false);

      // Si el docente eligió vincular automáticamente el .gdoc a las Observaciones de la Ficha:
      if (profileDocLinkToObs) {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const newObs: StudentObservation = {
          id: `obs-gdoc-${Date.now()}`,
          studentId: student.id,
          courseId: activeCourse.id,
          date: dateStr,
          text: `Ficha de Seguimiento exportada a Google Docs (.gdoc editable): "${uploadedDoc.name}"`,
          reportUrl: docLink,
          timestamp: Date.now(),
        };
        const currentList = studentObservations[student.id] || [];
        const updatedMap = {
          ...studentObservations,
          [student.id]: [newObs, ...currentList],
        };
        setStudentObservations(updatedMap);
        try {
          setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
          if (activeCourse.id) {
            setUserScopedItem(`fds_student_observations_${activeCourse.id}`, JSON.stringify(updatedMap));
          }
          const uid = getActiveUserId();
          if (uid) {
            firestoreSync.saveStudentObservation(uid, newObs, updatedMap).catch(() => {});
          }
        } catch (_) {}
      }

      setToastMessage(`Ficha de seguimiento creada en Google Drive (.gdoc editable).`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setProfileDocError(
        err?.message || 'No se pudo exportar la ficha a Google Drive. Verificá tu conexión con Google Workspace.'
      );
    } finally {
      setIsExportingProfileDoc(false);
    }
  };

  // Imprimir o descargar en PDF la ficha pedagógica individual del alumno
  const handlePrintStudentProfile = (
    student: Student,
    _tl: any,
    _disp: number,
    _m1: StudentDispositionData,
    _m2: StudentDispositionData
  ) => {
    if (!student) return;
    // Open the full interactive customizable report modal for this student
    setCourseReportModalStudentId(student.id);
    setCourseReportModalTab('individual');
    setCourseReportModalOpen(true);
  };

  // 7b. Reiniciar / Borrar disposición por alumno individual
  const handleResetSingleStudentDisposition = async (student: Student, clearHistory: boolean = false) => {
    if (!activeCourse || !student) return;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
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
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
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
    const term: '1c' | '2c' = targetTermOverride || activeConcreteTerm;
    const courseId = activeCourse.id;

    const catKey = getUserStorageKey(`fds_grades_categories_${courseId}_${term}`);
    const gradesKey = getUserStorageKey(`fds_grades_data_${courseId}_${term}`);

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
  // Creates or finds inside the Course Folder:
  // [Nombre de la Materia]
  //   ├── 📄 Asistencia y Disposición - [Materia]
  //   ├── 📄 Libro de Temas - [Materia] (reproduciendo la tabla de temas)
  //   ├── 📄 Calificaciones - [Materia]
  //   └── 📁 Informes (subcarpeta)
  const handleOpenCourseDriveFolder = async () => {
    if (!activeCourse || isSettingUpDriveFolder) return;
    setIsSettingUpDriveFolder(true);
    try {
      // 1. Ensure course folder and "Informes" subfolder exist in Google Drive
      const structure = await driveService.setupCourseFolderStructure(
        activeCourse.name,
        activeCourse.driveFolderId
      );

      // 2. Generate/update the 3 function documents inside the main course folder
      let dispSheetUrl: string | undefined = activeCourse.dispositionSheetUrl;
      let dispSheetId: string | undefined = activeCourse.dispositionSheetId;
      let libroSheetUrl: string | undefined = activeCourse.libroDeTemasSheetUrl;
      let libroSheetId: string | undefined = activeCourse.libroDeTemasSheetId;
      let gradesSheetUrl: string | undefined = activeCourse.gradesSheetUrl;
      let gradesSheetId: string | undefined = activeCourse.gradesSheetId;

      // 2a. Documento 1: Asistencia y Disposición
      try {
        const dispRes = await sheetsService.syncDispositionSheet(
          activeCourse,
          courseStudents,
          dispositionMap,
          historyList,
          activeCourse.dispositionSheetId,
          structure.mainFolder.id
        );
        if (dispRes.url) dispSheetUrl = dispRes.url;
        if (dispRes.spreadsheetId && isRealGoogleSpreadsheetId(dispRes.spreadsheetId)) {
          dispSheetId = dispRes.spreadsheetId;
        }
      } catch (err) {
        console.warn('Could not auto-sync disposition sheet to Drive folder:', err);
      }

      // 2b. Documento 2: Libro de Temas (reproduciendo la tabla de temas del curso)
      try {
        const libroRes = await sheetsService.syncLibroDeTemasToSheet(
          {
            id: activeCourse.id,
            name: activeCourse.name,
            subject: activeCourse.subject,
            schedule: activeCourse.schedule,
          },
          undefined,
          structure.mainFolder.id,
          activeCourse.libroDeTemasSheetId
        );
        if (libroRes.url) libroSheetUrl = libroRes.url;
        if (libroRes.spreadsheetId && isRealGoogleSpreadsheetId(libroRes.spreadsheetId)) {
          libroSheetId = libroRes.spreadsheetId;
        }
      } catch (err) {
        console.warn('Could not auto-sync Libro de Temas sheet to Drive folder:', err);
      }

      // 2c. Documento 3: Calificaciones (sincroniza la matriz real de 1°C y 2°C del curso)
      try {
        const loadStoredTermGrades = (term: '1c' | '2c') => {
          const catRaw =
            localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${term}`)) ||
            localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${term}`) ||
            (term === '1c'
              ? localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}`)) ||
                localStorage.getItem(`fds_grades_categories_${activeCourse.id}`)
              : null);
          const gradesRaw =
            localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${term}`)) ||
            localStorage.getItem(`fds_grades_data_${activeCourse.id}_${term}`) ||
            (term === '1c'
              ? localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}`)) ||
                localStorage.getItem(`fds_grades_data_${activeCourse.id}`)
              : null);
          const cats: GradeCategory[] = catRaw ? JSON.parse(catRaw) : DEFAULT_CATEGORIES;
          const gMap: Record<string, Record<string, string>> = gradesRaw ? JSON.parse(gradesRaw) : {};
          return { cats, gMap, hasSavedData: Boolean(catRaw || gradesRaw) };
        };

        const term1Data = loadStoredTermGrades('1c');
        const gradesRes1c = await sheetsService.syncGradebookMatrixToSheet(
          activeCourse,
          '1c',
          courseStudents,
          term1Data.cats,
          term1Data.gMap,
          activeCourse.gradesSheetId,
          structure.mainFolder.id
        );
        if (gradesRes1c.url) gradesSheetUrl = gradesRes1c.url;
        if (gradesRes1c.spreadsheetId && isRealGoogleSpreadsheetId(gradesRes1c.spreadsheetId)) {
          gradesSheetId = gradesRes1c.spreadsheetId;
          activeCourse.gradesSheetId = gradesRes1c.spreadsheetId;
          activeCourse.gradesSheetUrl = gradesRes1c.url;
        }

        const term2Data = loadStoredTermGrades('2c');
        if (term2Data.hasSavedData && gradesSheetId) {
          await sheetsService.syncGradebookMatrixToSheet(
            activeCourse,
            '2c',
            courseStudents,
            term2Data.cats,
            term2Data.gMap,
            gradesSheetId,
            structure.mainFolder.id
          );
        }
      } catch (err) {
        console.warn('Could not auto-sync gradebook sheet to Drive folder:', err);
      }

      // 3. Update course with drive folder metadata
      const updatedCourseData: Partial<Course> = {
        driveFolderId: structure.mainFolder.id,
        driveFolderUrl: structure.mainFolder.url,
        reportsFolderId: structure.reportsFolder.id,
        reportsFolderUrl: structure.reportsFolder.url,
        dispositionSheetId: dispSheetId,
        dispositionSheetUrl: dispSheetUrl,
        libroDeTemasSheetId: libroSheetId,
        libroDeTemasSheetUrl: libroSheetUrl,
        gradesSheetId: gradesSheetId,
        gradesSheetUrl: gradesSheetUrl,
      };

      api.updateCourse(activeCourse.id, updatedCourseData).catch(() => {});
      Object.assign(activeCourse, updatedCourseData);

      setCourseDriveStructure({
        ...structure,
        attendanceSheetUrl: dispSheetUrl,
        libroDeTemasSheetUrl: libroSheetUrl,
        gradesSheetUrl: gradesSheetUrl,
      });

      // 4. Show modal with direct links to the 3 documents and the Informes subfolder
      setDriveFolderModalOpen(true);
      setToastMessage(
        `Carpeta de Drive "${activeCourse.name}" preparada con los 3 documentos (Asistencia y Disposición, Libro de Temas, Calificaciones) y la subcarpeta Informes.`
      );
      setTimeout(() => setToastMessage(null), 4500);
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

  const filteredPendingMessages = useMemo(() => {
    return pendingAllItems.filter((item) => {
      if (permHistoryCategory !== 'all') {
        if (permHistoryCategory === 'Ausencia' && item.category !== 'Ausencia') return false;
        if (permHistoryCategory === 'Disposición' && item.category !== 'Disposición') return false;
      }
      if (permHistorySearch.trim()) {
        const query = permHistorySearch.toLowerCase().trim();
        const matchesName = (item.studentName || '').toLowerCase().includes(query);
        const matchesAction = (item.action || '').toLowerCase().includes(query);
        const matchesDate = (item.date || '').toLowerCase().includes(query);
        if (!matchesName && !matchesAction && !matchesDate) return false;
      }
      return true;
    });
  }, [pendingAllItems, permHistoryCategory, permHistorySearch]);

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
          <CourseHeaderCard
            activeCourse={activeCourse}
            isDarkMode={isDarkMode}
            userEmail={user?.email}
            isSettingUpDriveFolder={isSettingUpDriveFolder}
            onOpenCalendarSyncModal={handleOpenCalendarSyncModal}
            onOpenEditCourseDetailsModal={handleOpenEditCourseDetailsModal}
            onOpenCourseDriveFolder={handleOpenCourseDriveFolder}
            onOpenCourseReport={() => {
              setCourseReportModalStudentId('all');
              setCourseReportModalTab('course');
              setCourseReportModalOpen(true);
            }}
          />

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
            className={`p-1.5 rounded-xl border grid grid-cols-1 sm:grid-cols-4 gap-2 transition-colors ${
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
              onClick={() => setActiveTab('libro_temas')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'libro_temas'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>Libro de Temas</span>
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
          {/* BARRA DE HERRAMIENTAS Y CONTROL DE PERÍODO (AttendanceHeader) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <AttendanceHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedStudentCount={selectedStudentIds.length}
              onOpenBatchSelected={handleOpenBatchFromSelectedStudents}
              pendingCount={selectedStudentIds.length === 0 ? pendingAllItems.length : 0}
              onOpenBatchPending={() => handleOpenBatchFromPending('all')}
              onOpenAddStudentModal={handleOpenAddStudentModal}
              onOpenSendDispositionModal={() => setIsSendDispositionModalOpen(true)}
              onOpenNotifConfigModal={() => setIsNotifConfigModalOpen(true)}
              isSyncingSheet={isSyncingSheet}
              isPullingFromSheet={isPullingFromSheet}
              lastSyncedAt={sheetConfig?.lastSyncedAt}
              onManualSheetsSync={handleManualSheetsSync}
              isOpeningSheet={isOpeningSheet}
              onOpenGoogleSheet={handleOpenGoogleSheet}
              onOpenImportExcel={() => {
                setHeaderImportContext('attendance');
                setHeaderImportSourceType('file');
                setIsHeaderImportModalOpen(true);
              }}
              onOpenImportSheets={() => {
                setHeaderImportContext('attendance');
                setHeaderImportSourceType('sheets');
                setIsHeaderImportModalOpen(true);
              }}
              attendanceTerm={attendanceTerm}
              onSelectTerm={setAttendanceTermHandler}
              attendanceSummary={currentAttendanceSummary}
              onOpenAttendanceSettings={() => setIsAttendanceSettingsModalOpen(true)}
              onOpenBackupModal={() => setIsBackupModalOpen(true)}
              onOpenQuickRollCall={() => setIsQuickRollCallOpen(true)}
              isDarkMode={isDarkMode}
            />
          )}

          {activeTab === 'history' && (
            <div
              className={`p-3.5 rounded-xl border transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-800 dark:text-slate-100">
                  Historial
                </h3>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  {courseHistory.length} registros en la bitácora
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* COLUMNA 1: Informes y Reportes, Abrir en Google Sheets */}
                <div className="flex flex-col gap-2 justify-center">
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setCourseReportModalTab('course');
                        setCourseReportModalOpen(true);
                      }}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border-blue-700/60'
                          : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                      }`}
                      title="Generar informe oficial del curso o boletines individuales de 1 página para imprimir o guardar en Google Drive"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-500" />
                      <span>Informes y Reportes</span>
                    </button>
                    <a
                      href={`?course=${activeCourse.id}&view=course_detail&openReport=true${user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                        isDarkMode
                          ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border-slate-700'
                          : 'bg-white hover:bg-blue-50 text-blue-700 border-neutral-200'
                      }`}
                      title="Abrir Informes y Reportes en otra pestaña o ventana"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenGoogleSheet}
                    disabled={isOpeningSheet}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Abrir o crear hoja oficial en Google Sheets"
                  >
                    {isOpeningSheet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span>Abrir en Google Sheets</span>
                  </button>
                </div>

                {/* COLUMNA 2: Vincular Sheet y Copiar datos */}
                <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 sm:border-x border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0 sm:px-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSheetsModalFeedback(null);
                      setShowSheetsConnectModal(true);
                    }}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
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
                    onClick={handleCopyForGoogleSheets}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Copia los datos tabulados para pegar con Ctrl+V directamente en Google Sheets"
                  >
                    <Copy className="w-3.5 h-3.5 text-blue-500" />
                    <span>Copiar datos</span>
                  </button>
                </div>

                {/* COLUMNA 3: Exportar Excel y Descargar CSV */}
                <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0">
                  <button
                    type="button"
                    onClick={handleExportHistoryExcel}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
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
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Descargar historial en formato CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-purple-500" />
                    <span>Descargar CSV</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 1: STUDENT ROSTER (1C / 2C / ANNUAL VIEW)                 */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <div className="space-y-4">

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
                      const avgAttendanceRate = currentAttendanceSummary?.avgAttendanceRate ?? 95;

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
                              <span>Alumnos Sin Riesgo</span>
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <div className="text-2xl font-black mt-1 text-emerald-600 dark:text-emerald-400">
                              {currentAttendanceSummary?.regularCount ?? courseStudents.length}
                              <span className="text-xs font-normal text-neutral-400"> /{count}</span>
                            </div>
                            <span className="text-[11px] text-neutral-400">
                              {currentAttendanceSummary?.warningCount ? `${currentAttendanceSummary.warningCount} al límite • ` : ''}
                              {currentAttendanceSummary?.alertCount ? `${currentAttendanceSummary.alertCount} en riesgo` : 'Regularidad óptima'}
                            </span>
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
                              const tl = computeStudentAttendanceTrafficLight(s.id, tAbs, tLat, 'annual', attendanceSettings);
                              const est = tl.percentage;
                              const cond = tl.status === 'alert' || aDisp < 6 ? 'Alerta' : aDisp >= 8 && tl.percentage >= 85 ? 'Excelente' : 'Regular';
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
                            <th className="py-3 px-3 text-center">Semáforo</th>
                            <th className="py-3 px-3 text-center">Condición</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200 dark:divide-slate-800 font-medium">
                          {filteredStudents.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-neutral-400">
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
                              const tlAnnual = computeStudentAttendanceTrafficLight(
                                student.id,
                                totalAbs,
                                totalLat,
                                'annual',
                                attendanceSettings
                              );
                              const estAtt = tlAnnual.percentage;
                              const isAlert = tlAnnual.status === 'alert' || avgDisp < 6;

                              return (
                                <tr
                                  key={student.id}
                                  className={`group transition-colors ${
                                    isDarkMode ? 'hover:bg-slate-850/50' : 'hover:bg-neutral-50'
                                  }`}
                                >
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-600 font-bold flex items-center justify-center text-xs">
                                        {student.firstName[0]}
                                        {student.lastName[0]}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => handleOpenStudentProfile(student)}
                                          className="font-bold text-neutral-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer text-left block"
                                          title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
                                        >
                                          {student.lastName}, {student.firstName}
                                        </button>
                                        <a
                                          href={`?course=${activeCourse.id}&view=course_detail&studentId=${student.id}${user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-all opacity-0 group-hover:opacity-100"
                                          title={`Abrir ficha y observaciones de ${student.lastName}, ${student.firstName} en otra pestaña`}
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                        </a>
                                      </div>
                                    </div>
                                  </td>

                                  {/* 1C */}
                                  <td className="py-3 px-3 text-center bg-blue-500/5">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditAbsences(student, '1c')}
                                        className="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                        title="Faltas 1° Cuatrimestre (clic para editar)"
                                      >
                                        {m1.totalAbsences}F
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditAbsences(student, '1c')}
                                        className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                        title="Tardanzas 1° Cuatrimestre (clic para editar)"
                                      >
                                        {m1.totalLates || 0}T
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditDisposition(student, '1c')}
                                        className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all hover:scale-105 shadow-2xs ${
                                          m1.totalDisposition >= 8
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                            : m1.totalDisposition >= 6
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                        }`}
                                        title="Disposición 1° Cuatrimestre (clic para editar)"
                                      >
                                        {m1.totalDisposition}
                                      </button>
                                    </div>
                                  </td>

                                  {/* 2C */}
                                  <td className="py-3 px-3 text-center bg-emerald-500/5">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditAbsences(student, '2c')}
                                        className="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                        title="Faltas 2° Cuatrimestre (clic para editar)"
                                      >
                                        {m2.totalAbsences}F
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditAbsences(student, '2c')}
                                        className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                        title="Tardanzas 2° Cuatrimestre (clic para editar)"
                                      >
                                        {m2.totalLates || 0}T
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditDisposition(student, '2c')}
                                        className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all hover:scale-105 shadow-2xs ${
                                          m2.totalDisposition >= 8
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                            : m2.totalDisposition >= 6
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                        }`}
                                        title="Disposición 2° Cuatrimestre (clic para editar)"
                                      >
                                        {m2.totalDisposition}
                                      </button>
                                    </div>
                                  </td>

                                  {/* Totales Anuales con Semáforo en la cantidad de faltas */}
                                  <td className="py-3 px-3 text-center bg-purple-500/5">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditAbsences(student)}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 ${
                                        tlAnnual.status === 'alert'
                                          ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800'
                                          : tlAnnual.status === 'warning'
                                          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                                          : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                                      }`}
                                      title={`Inasistencias anuales: ${totalAbs}. Semáforo: ${tlAnnual.statusLabel}. Hacé clic para editar faltas o clic en el nombre para ver el total detallado.`}
                                    >
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                          tlAnnual.status === 'alert'
                                            ? 'bg-red-500 animate-pulse'
                                            : tlAnnual.status === 'warning'
                                            ? 'bg-amber-500'
                                            : 'bg-emerald-500'
                                        }`}
                                      />
                                      <span>{totalAbs} {totalAbs === 1 ? 'falta' : 'faltas'}</span>
                                    </button>
                                    {totalLat > 0 && (
                                      <span className="font-semibold text-amber-600 dark:text-amber-400 text-xs ml-1.5">
                                        • {totalLat} tard.
                                      </span>
                                    )}
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

                                  {/* % Asistencia con Semáforo */}
                                  <td className="py-3 px-3 text-center font-bold">
                                    <button
                                      type="button"
                                      onClick={() => setIsAttendanceSettingsModalOpen(true)}
                                      className="inline-flex items-center justify-center gap-1.5 hover:underline cursor-pointer group"
                                      title={`Semáforo Anual: ${tlAnnual.statusLabel} • Asistió a ${tlAnnual.attendedClasses} de ${tlAnnual.totalClasses} clases anuales (${attendanceSettings.weeks1c + attendanceSettings.weeks2c} semanas • ${attendanceSettings.classesPerWeek} clases/sem.). Faltas computadas: ${tlAnnual.computedAbsences}. Máximo permitido: ${tlAnnual.maxAllowedAbsences} faltas. Hacé clic para configurar semanas o parámetros.`}
                                    >
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          tlAnnual.status === 'regular'
                                            ? 'bg-emerald-500'
                                            : tlAnnual.status === 'warning'
                                            ? 'bg-amber-500'
                                            : 'bg-red-500 animate-pulse'
                                        }`}
                                      />
                                      <span className={`text-xs ${tlAnnual.status === 'alert' ? 'text-red-600 dark:text-red-400' : tlAnnual.status === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {tlAnnual.status === 'alert' ? 'Riesgo' : tlAnnual.status === 'warning' ? 'Al límite' : 'Sin riesgo'}
                                      </span>
                                    </button>
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
                          <span>Asistencia</span>
                        </th>
                        <th className="py-3 px-4 text-center">
                          <span>Registrar asistencia</span>
                        </th>
                        <th className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span>Disposición</span>
                            <button
                              type="button"
                              onClick={() => setIsSendDispositionModalOpen(true)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950/80 dark:hover:bg-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 transition-all cursor-pointer shadow-2xs"
                              title={`Mandar notas de disposición a Calificaciones (${activeConcreteTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
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
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                      {filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 px-4 text-center">
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
                          const trafficLight = computeStudentAttendanceTrafficLight(
                            student.id,
                            metrics.totalAbsences,
                            metrics.totalLates || 0,
                            attendanceTerm,
                            attendanceSettings
                          );
                          const studentHistory = historyList.filter((h) => h.studentId === student.id);
                          const hasPendingAbsence = historyList.some(
                            (h) =>
                              h.courseId === activeCourse.id &&
                              h.studentId === student.id &&
                              h.category === 'Ausencia' &&
                              !h.messageSent &&
                              !h.omitNotification &&
                              h.notificationMethod !== 'omitted' &&
                              h.notificationMethod !== 'none'
                          );
                          const isSelected = selectedStudentIds.includes(student.id);

                          return (
                            <StudentAttendanceRow
                              key={student.id}
                              student={student}
                              isSelected={isSelected}
                              onToggleSelect={toggleSelectStudent}
                              metrics={metrics}
                              trafficLight={trafficLight}
                              observationsCount={studentObservations[student.id]?.length || 0}
                              hasPendingAbsence={hasPendingAbsence}
                              studentHistory={studentHistory}
                              teacherConductOptions={teacherConductOptions}
                              pulsingStudentId={pulsingStudentId}
                              onOpenProfile={handleOpenStudentProfile}
                              onOpenEditAbsences={handleOpenEditAbsences}
                              onOpenEditDisposition={handleOpenEditDisposition}
                              onOpenTrafficLightSettings={() => setIsAttendanceSettingsModalOpen(true)}
                              onAddAbsence={handleAddAbsence}
                              onRecordLateArrival={handleRecordLateArrival}
                              onDeleteLatestAbsence={handleDeleteLatestAbsence}
                              onDeleteLatestLate={handleDeleteLatestLate}
                              onRecordDispositionAction={handleRecordDispositionAction}
                              onOpenConductModal={(s, mode) =>
                                setConductRecordModal({
                                  isOpen: true,
                                  student: s,
                                  mode,
                                  points: 1,
                                  customReason: '',
                                  saveToOptions: false,
                                })
                              }
                              onOpenStudentHistory={setSelectedStudentForHistory}
                              isDarkMode={isDarkMode}
                            />
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
            {/* ------------------------------------------------------------- */}
            {/* BANDEJA DE AVISOS Y MENSAJES PENDIENTES (MANDAR O NO MANDAR)  */}
            {/* ------------------------------------------------------------- */}
            <PendingNotificationsInbox
              isDarkMode={isDarkMode}
              pendingAllItems={pendingAllItems}
              pendingAbsenceItems={pendingAbsenceItems}
              pendingConductItems={pendingConductItems}
              filteredPendingMessages={filteredPendingMessages}
              courseHistory={courseHistory}
              courseStudents={courseStudents}
              isPermHistoryCollapsed={isPermHistoryCollapsed}
              setIsPermHistoryCollapsed={setIsPermHistoryCollapsed}
              permHistoryCategory={(permHistoryCategory === 'Ausencia' || permHistoryCategory === 'Disposición') ? permHistoryCategory : 'all'}
              setPermHistoryCategory={setPermHistoryCategory as any}
              permHistorySearch={permHistorySearch}
              setPermHistorySearch={setPermHistorySearch}
              selectedPendingHistoryIds={selectedPendingHistoryIds}
              setSelectedPendingHistoryIds={setSelectedPendingHistoryIds}
              handleBatchMarkOmitNotification={handleBatchMarkOmitNotification}
              handleOpenBatchFromSelectedHistory={handleOpenBatchFromSelectedHistory}
              toggleSelectAllPendingHistory={toggleSelectAllPendingHistory}
              toggleSelectPendingHistory={toggleSelectPendingHistory}
              handleOpenNotifyModal={handleOpenNotifyModal}
              handleMarkOmitNotification={handleMarkOmitNotification}
              handleDeleteHistoryEntry={handleDeleteHistoryEntry}
              handleMarkAllPendingAsOmitted={handleMarkAllPendingAsOmitted}
              handleOpenBatchFromPending={(filter) => handleOpenBatchFromPending(filter === 'Ausencia' ? 'absences' : filter === 'Disposición' ? 'conduct' : 'all')}
              setActiveTab={(tab) => setActiveTab(tab === 'attendance' ? 'roster' : tab)}
              setToastMessage={setToastMessage}
            />
          </div>
        )}
      </div>
    )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 1.5: LIBRO DE TEMAS (COORDINADO CON EL CALENDARIO)        */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'libro_temas' && (
            <ErrorBoundary
              key={`eb-libro-${activeCourse.id}`}
              fallbackTitle="Se produjo un inconveniente al cargar el Libro de Temas"
            >
              <Suspense fallback={null}>
                <LibroDeTemasMatrix
                  courseId={activeCourse.id}
                  courseName={activeCourse.name}
                  courseSubject={activeCourse.subject}
                  courseSchedule={activeCourse.schedule}
                  teacherName={user?.name}
                  attendanceSettings={attendanceSettings}
                  onUpdateAttendanceSettings={(next) => setAttendanceSettings(next)}
                  onRefreshCourse={onRefreshData}
                  onOpenAttendanceSettingsModal={() => setIsAttendanceSettingsModalOpen(true)}
                  onOpenBackupModal={() => setIsBackupModalOpen(true)}
                  isDarkMode={isDarkMode}
                  driveFolderId={activeCourse.driveFolderId}
                  driveFolderUrl={activeCourse.driveFolderUrl}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 2: CALIFICACIONES (CATEGORÍAS Y SUBCATEGORÍAS CUSTOM)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'grades' && (
            <ErrorBoundary
              key={`eb-grades-${activeCourse.id}`}
              fallbackTitle="Se produjo un inconveniente al cargar la Planilla de Calificaciones"
            >
              <Suspense fallback={null}>
                <GradebookMatrix
                  courseId={activeCourse.id}
                  courseName={activeCourse.name}
                  students={courseStudents}
                  isDarkMode={isDarkMode}
                  activeTerm={attendanceTerm}
                  onTermChange={setAttendanceTermHandler}
                  driveFolderId={activeCourse.driveFolderId}
                  driveFolderUrl={activeCourse.driveFolderUrl}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 3: AUDITORÍA E HISTORIAL GENERAL (HOJA GOOGLE SHEETS)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'history' && (
            <CourseHistoryTabView
              activeCourse={activeCourse}
              courseStudents={courseStudents}
              courseHistory={courseHistory}
              pendingAllItems={pendingAllItems}
              selectedPendingHistoryIds={selectedPendingHistoryIds}
              setSelectedPendingHistoryIds={setSelectedPendingHistoryIds}
              historySubTab={historySubTab}
              setHistorySubTab={setHistorySubTab}
              isSyncingSheet={isSyncingSheet}
              sheetConfig={sheetConfig}
              isOpeningSheet={isOpeningSheet}
              isTokenExpired={isTokenExpired}
              handleOpenGoogleSheet={handleOpenGoogleSheet}
              handleManualSheetsSync={handleManualSheetsSync}
              setSheetsModalFeedback={setSheetsModalFeedback}
              setShowSheetsConnectModal={setShowSheetsConnectModal}
              renewGoogleSession={renewGoogleSession}
              isDarkMode={isDarkMode}
              handleBatchMarkOmitNotification={handleBatchMarkOmitNotification}
              handleOpenBatchFromSelectedHistory={handleOpenBatchFromSelectedHistory}
              toggleSelectAllPendingHistory={toggleSelectAllPendingHistory}
              toggleSelectPendingHistory={toggleSelectPendingHistory}
              handleOpenNotifyModal={handleOpenNotifyModal}
              handleMarkOmitNotification={handleMarkOmitNotification}
              handleDeleteHistoryEntry={handleDeleteHistoryEntry}
              handleMarkAllPendingAsOmitted={handleMarkAllPendingAsOmitted}
              handleOpenBatchFromPending={handleOpenBatchFromPending}
              setToastMessage={setToastMessage}
              getStudentMetrics={getStudentMetrics}
            />
          )}
        </>
      )}

      {/* Modales de Conducta, Historial Individual y Envío de Disposición a Calificaciones */}
      <ConductRecordModal
        conductRecordModal={conductRecordModal}
        setConductRecordModal={setConductRecordModal}
        attendanceTerm={attendanceTerm}
        getStudentMetrics={getStudentMetrics}
        teacherConductOptions={teacherConductOptions}
        handleConfirmConductRecord={handleConfirmConductRecord}
        isDarkMode={isDarkMode}
      />

      <ManageConductOptionsModal
        isOpen={isManageConductModalOpen}
        onClose={() => setIsManageConductModalOpen(false)}
        teacherConductOptions={teacherConductOptions}
        newConductInput={newConductInput}
        setNewConductInput={setNewConductInput}
        newConductType={newConductType}
        setNewConductType={setNewConductType}
        handleAddConductOption={handleAddConductOption}
        editingConductOpt={editingConductOpt}
        setEditingConductOpt={setEditingConductOpt}
        editConductInput={editConductInput}
        setEditConductInput={setEditConductInput}
        handleEditConductOption={handleEditConductOption}
        handleDeleteConductOption={handleDeleteConductOption}
        isReasonCustomized={isReasonCustomized}
        editingTemplateForReason={editingTemplateForReason}
        setEditingTemplateForReason={setEditingTemplateForReason}
        reasonTemplateDraft={reasonTemplateDraft}
        setReasonTemplateDraft={setReasonTemplateDraft}
        getTemplateForReason={getTemplateForReason}
        handleResetTemplateForReason={handleResetTemplateForReason}
        handleSaveTemplateForReason={handleSaveTemplateForReason}
        isDarkMode={isDarkMode}
      />

      <StudentIndividualHistoryModal
        selectedStudentForHistory={selectedStudentForHistory}
        setSelectedStudentForHistory={setSelectedStudentForHistory}
        getStudentMetrics={getStudentMetrics}
        handleOpenEditAbsences={handleOpenEditAbsences}
        handleDeleteLatestAbsence={handleDeleteLatestAbsence}
        handleDeleteLatestLate={handleDeleteLatestLate}
        handleOpenEditDisposition={handleOpenEditDisposition}
        handleResetSingleStudentDisposition={handleResetSingleStudentDisposition}
        historyList={historyList}
        handleOpenNotifyModal={handleOpenNotifyModal}
        handleDeleteHistoryEntry={handleDeleteHistoryEntry}
        isDarkMode={isDarkMode}
      />

      <SendDispositionToGradesModal
        isOpen={isSendDispositionModalOpen}
        onClose={() => setIsSendDispositionModalOpen(false)}
        activeCourse={activeCourse}
        courseStudents={courseStudents}
        attendanceTerm={attendanceTerm}
        getStudentMetrics={getStudentMetrics}
        handleSendDispositionToGrades={handleSendDispositionToGrades}
        isDarkMode={isDarkMode}
      />

      {/* Modales de Edición Manual de Disposición e Inasistencias */}
      <EditStudentDispositionModal
        editingDispositionStudent={editingDispositionStudent}
        setEditingDispositionStudent={setEditingDispositionStudent}
        activeCourse={activeCourse}
        editingDispositionTerm={editingDispositionTerm}
        handleChangeEditingTerm={handleChangeEditingTerm}
        getStudentMetrics={getStudentMetrics}
        editingDispositionScore={editingDispositionScore}
        setEditingDispositionScore={setEditingDispositionScore}
        editingDispositionReason={editingDispositionReason}
        setEditingDispositionReason={setEditingDispositionReason}
        filteredStudents={filteredStudents}
        handleNavigateEditStudent={handleNavigateEditStudent}
        handleSaveStudentDisposition={handleSaveStudentDisposition}
        isDarkMode={isDarkMode}
      />

      <EditStudentAbsencesModal
        editingAbsenceStudent={editingAbsenceStudent}
        setEditingAbsenceStudent={setEditingAbsenceStudent}
        activeCourse={activeCourse}
        editingAbsenceTerm={editingAbsenceTerm}
        handleChangeEditingAbsenceTerm={handleChangeEditingAbsenceTerm}
        getStudentMetrics={getStudentMetrics}
        editingAbsenceCount={editingAbsenceCount}
        setEditingAbsenceCount={setEditingAbsenceCount}
        editingAbsenceDate={editingAbsenceDate}
        setEditingAbsenceDate={setEditingAbsenceDate}
        editingAbsenceReason={editingAbsenceReason}
        setEditingAbsenceReason={setEditingAbsenceReason}
        editingAbsenceSendNotif={editingAbsenceSendNotif}
        setEditingAbsenceSendNotif={setEditingAbsenceSendNotif}
        editingAbsenceChannel={editingAbsenceChannel}
        setEditingAbsenceChannel={setEditingAbsenceChannel}
        editingAbsenceMessageText={editingAbsenceMessageText}
        setEditingAbsenceMessageText={setEditingAbsenceMessageText}
        savedPresets={savedPresets}
        notifSettings={notifSettings}
        defaultAbsencePresets={DEFAULT_ABSENCE_PRESETS}
        formatTemplateForStudent={formatTemplateForStudent}
        filteredStudents={filteredStudents}
        isSavingAbsenceEdit={isSavingAbsenceEdit}
        handleNavigateEditAbsenceStudent={handleNavigateEditAbsenceStudent}
        handleSaveStudentAbsences={handleSaveStudentAbsences}
        isDarkMode={isDarkMode}
      />

      {/* ------------------------------------------------------------- */}
      {/* MODAL: FICHA DEL ESTUDIANTE Y OBSERVACIONES DOCENTE (INFORMES) */}
      {/* ------------------------------------------------------------- */}
      <StudentProfileObservationsModal
        selectedStudentForProfile={selectedStudentForProfile}
        setSelectedStudentForProfile={setSelectedStudentForProfile}
        activeCourse={activeCourse}
        user={user}
        isDarkMode={isDarkMode}
        isEditingStudentEmail={isEditingStudentEmail}
        setIsEditingStudentEmail={setIsEditingStudentEmail}
        editedStudentEmail={editedStudentEmail}
        setEditedStudentEmail={setEditedStudentEmail}
        handleSaveEditedStudentEmail={handleSaveEditedStudentEmail}
        handleOpenDirectMessageModal={handleOpenDirectMessageModal}
        getStudentMetrics={getStudentMetrics}
        attendanceTerm={attendanceTerm}
        attendanceSettings={attendanceSettings}
        handleOpenEditAbsences={handleOpenEditAbsences}
        setIsAttendanceSettingsModalOpen={setIsAttendanceSettingsModalOpen}
        handleOpenExportProfileDocConfirm={handleOpenExportProfileDocConfirm}
        isExportingProfileDoc={isExportingProfileDoc}
        showProfileDocConfirm={showProfileDocConfirm}
        setShowProfileDocConfirm={setShowProfileDocConfirm}
        profileDocTitle={profileDocTitle}
        setProfileDocTitle={setProfileDocTitle}
        profileDocLinkToObs={profileDocLinkToObs}
        setProfileDocLinkToObs={setProfileDocLinkToObs}
        profileDocError={profileDocError}
        handleConfirmExportProfileToGoogleDoc={handleConfirmExportProfileToGoogleDoc}
        exportedProfileDoc={exportedProfileDoc}
        setExportedProfileDoc={setExportedProfileDoc}
        newObservationText={newObservationText}
        setNewObservationText={setNewObservationText}
        newObservationUrl={newObservationUrl}
        setNewObservationUrl={setNewObservationUrl}
        handleSaveObservation={handleSaveObservation}
        studentObservations={studentObservations}
        handleDeleteObservation={handleDeleteObservation}
        filteredStudents={filteredStudents}
        handleNavigateProfileStudent={handleNavigateProfileStudent}
        setCourseReportModalStudentId={setCourseReportModalStudentId}
        setCourseReportModalTab={setCourseReportModalTab}
        setCourseReportModalOpen={setCourseReportModalOpen}
      />

      {/* ------------------------------------------------------------- */}
      {/* MODAL 1: SINCRONIZAR / SELECCIONAR CON GOOGLE CALENDAR        */}
      {/* ------------------------------------------------------------- */}
      <CalendarSyncModal
        isOpen={isCalendarModalOpen}
        calendarModalCourse={calendarModalCourse}
        onClose={() => {
          setIsCalendarModalOpen(false);
          setCalendarModalCourse(null);
        }}
        isDarkMode={isDarkMode}
        handleSaveCalendarSelection={handleSaveCalendarSelection}
        selectedCalendarForSlots={selectedCalendarForSlots}
        setSelectedCalendarForSlots={setSelectedCalendarForSlots}
        handleOpenCalendarSyncModal={handleOpenCalendarSyncModal}
        availableCalendarsForSlots={availableCalendarsForSlots}
        isLoadingSlots={isLoadingSlots}
        calendarSlots={calendarSlots}
        calendarScheduleSelection={calendarScheduleSelection}
        setCalendarScheduleSelection={setCalendarScheduleSelection}
        syncToGoogleFromModal={syncToGoogleFromModal}
        setSyncToGoogleFromModal={setSyncToGoogleFromModal}
        isSavingCalendarSelection={isSavingCalendarSelection}
      />

      {/* ------------------------------------------------------------- */}
      {/* MODAL 2: EDITAR DETALLES ESPECÍFICOS DEL CURSO                */}
      {/* ------------------------------------------------------------- */}
      <EditCourseDetailsModal
        isOpen={isEditCourseModalOpen}
        editCourseData={editCourseData}
        setEditCourseData={setEditCourseData}
        onClose={() => {
          setIsEditCourseModalOpen(false);
          setEditCourseData(null);
        }}
        isDarkMode={isDarkMode}
        handleSaveCourseDetails={handleSaveCourseDetails}
        isSavingCourseDetails={isSavingCourseDetails}
      />

      {/* Modales de Notificaciones Individuales, en Lote y Configuración de Plantillas */}
      <IndividualAbsenceNotificationModal
        absenceNotifModal={absenceNotifModal}
        setAbsenceNotifModal={setAbsenceNotifModal}
        activeCourse={activeCourse}
        setIsNotifConfigModalOpen={setIsNotifConfigModalOpen}
        getTemplateForReason={getTemplateForReason}
        dispositionMap={dispositionMap}
        formatTemplateForStudent={formatTemplateForStudent}
        savedPresets={savedPresets}
        conductReasonTemplates={conductReasonTemplates}
        allKnownReasonKeys={allKnownReasonKeys}
        notifSettings={notifSettings}
        isReasonCustomized={isReasonCustomized}
        handleSaveTemplateForReason={handleSaveTemplateForReason}
        saveReasonAsDefaultOnSend={saveReasonAsDefaultOnSend}
        setSaveReasonAsDefaultOnSend={setSaveReasonAsDefaultOnSend}
        extractGenericTemplate={extractGenericTemplate}
        handleSavePreset={handleSavePreset}
        handleSaveNotifSettings={handleSaveNotifSettings}
        setToastMessage={setToastMessage}
        sendNotificationForItem={sendNotificationForItem}
        handleMarkOmitNotification={handleMarkOmitNotification}
        isDarkMode={isDarkMode}
      />

      <BatchAbsenceNotificationModal
        batchAbsenceModal={batchAbsenceModal}
        setBatchAbsenceModal={setBatchAbsenceModal}
        activeCourse={activeCourse}
        pendingAllItems={pendingAllItems}
        students={students}
        setIsNotifConfigModalOpen={setIsNotifConfigModalOpen}
        savedPresets={savedPresets}
        handleSavePreset={handleSavePreset}
        getBatchMessageForItem={getBatchMessageForItem}
        handleSendBatchNotifications={handleSendBatchNotifications}
        isDarkMode={isDarkMode}
      />

      <NotificationPresetsConfigModal
        isOpen={isNotifConfigModalOpen}
        onClose={() => setIsNotifConfigModalOpen(false)}
        notifConfigActiveTab={notifConfigActiveTab}
        setNotifConfigActiveTab={setNotifConfigActiveTab}
        conductReasonTemplates={conductReasonTemplates}
        savedPresets={savedPresets}
        searchReasonQuery={searchReasonQuery}
        setSearchReasonQuery={setSearchReasonQuery}
        isNewReasonFormOpen={isNewReasonFormOpen}
        setIsNewReasonFormOpen={setIsNewReasonFormOpen}
        newReasonName={newReasonName}
        setNewReasonName={setNewReasonName}
        newReasonTemplateText={newReasonTemplateText}
        setNewReasonTemplateText={setNewReasonTemplateText}
        getTemplateForReason={getTemplateForReason}
        handleSaveTemplateForReason={handleSaveTemplateForReason}
        allKnownReasonKeys={allKnownReasonKeys}
        isReasonCustomized={isReasonCustomized}
        reasonCardDrafts={reasonCardDrafts}
        setReasonCardDrafts={setReasonCardDrafts}
        handleResetTemplateForReason={handleResetTemplateForReason}
        newConfigPreset={newConfigPreset}
        setNewConfigPreset={setNewConfigPreset}
        handleSavePreset={handleSavePreset}
        handleDeletePreset={handleDeletePreset}
        notifSettings={notifSettings}
        setNotifSettings={setNotifSettings}
        handleSaveNotifSettings={handleSaveNotifSettings}
        isDarkMode={isDarkMode}
      />

      {/* Modal de confirmación y accesos directos a la Carpeta de Google Drive y sus 2 Subcarpetas */}
      <DriveFolderModal
        isOpen={driveFolderModalOpen}
        onClose={() => setDriveFolderModalOpen(false)}
        activeCourse={activeCourse}
        courseDriveStructure={courseDriveStructure}
        isDarkMode={isDarkMode}
      />

      {/* Modal para Vincular / Abrir en Google Sheets */}
      <SheetsConnectModal
        isOpen={showSheetsConnectModal}
        onClose={() => setShowSheetsConnectModal(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        sheetConfig={sheetConfig}
        isSyncingSheet={isSyncingSheet}
        isOpeningSheet={isOpeningSheet}
        handleManualSheetsSync={handleManualSheetsSync}
        customFolderInput={customFolderInput}
        setCustomFolderInput={setCustomFolderInput}
        handleSaveCustomDriveFolder={handleSaveCustomDriveFolder}
        isLinkingCustomFolder={isLinkingCustomFolder}
        customSheetInput={customSheetInput}
        setCustomSheetInput={setCustomSheetInput}
        handleLinkCustomSpreadsheet={handleLinkCustomSpreadsheet}
        isLinkingCustomSheet={isLinkingCustomSheet}
        sheetsModalFeedback={sheetsModalFeedback}
        handlePullFromGoogleSheet={handlePullFromGoogleSheet}
        isPullingFromSheet={isPullingFromSheet}
        handleConnectGoogleForSheets={handleConnectGoogleForSheets}
        handleOpenInSheetsNew={handleOpenInSheetsNew}
        handleDownloadCourseCsv={handleDownloadCourseCsv}
      />

      {/* Modal: Exportar a Excel (.xlsx) desde la cabecera */}
      <HeaderExportExcelModal
        isOpen={isHeaderExportExcelModalOpen}
        onClose={() => setIsHeaderExportExcelModalOpen(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        handleExportAllCourseExcel={handleExportAllCourseExcel}
        HistoryIcon={History}
      />

      {/* Modal: Importar desde Excel / Sheets con Verificación Previa */}
      {isHeaderImportModalOpen && activeCourse && (
        <Suspense fallback={null}>
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
            currentTerm={activeConcreteTerm}
            isDarkMode={isDarkMode}
            initialSourceType={headerImportSourceType}
            importContext={headerImportContext}
            currentDispositionMap1c={(() => {
              const map: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
              courseStudents.forEach((s) => {
                const m = getStudentMetrics(s.id, '1c');
                map[s.id] = {
                  totalAbsences: m.totalAbsences,
                  totalLates: m.totalLates || 0,
                  totalDisposition: m.totalDisposition,
                };
              });
              return map;
            })()}
            currentDispositionMap2c={(() => {
              const map: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};
              courseStudents.forEach((s) => {
                const m = getStudentMetrics(s.id, '2c');
                map[s.id] = {
                  totalAbsences: m.totalAbsences,
                  totalLates: m.totalLates || 0,
                  totalDisposition: m.totalDisposition,
                };
              });
              return map;
            })()}
            onApplyGrades={handleApplyImportFromClassesModule}
            onApplyMultiImport={handleApplyMultiImportFromClassesModule}
            historyEntries={(() => {
              try {
                const hKey = getUserStorageKey(`fds_grade_history_${activeCourse.id}`);
                const savedHist = localStorage.getItem(hKey);
                return savedHist ? JSON.parse(savedHist) : [];
              } catch (_) {
                return [];
              }
            })()}
          />
        </Suspense>
      )}


      {/* Modal: Resumen de Doble Entrada (Cambios detectados desde Google Sheets) */}
      <DobleEntradaModal
        isOpen={isDobleEntradaModalOpen}
        onClose={() => setIsDobleEntradaModalOpen(false)}
        activeCourse={activeCourse}
        dobleEntradaDiffs={dobleEntradaDiffs}
        isDarkMode={isDarkMode}
      />

      {/* ------------------------------------------------------------- */}
      {/* MODAL: AGREGAR ALUMNO MANUALMENTE (CON CORREO ELECTRÓNICO)     */}
      {/* ------------------------------------------------------------- */}
      <AddStudentModal
        isOpen={isAddStudentModalOpen}
        onClose={() => setIsAddStudentModalOpen(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        addStudentTab={addStudentTab}
        setAddStudentTab={setAddStudentTab}
        addStudentLastName={addStudentLastName}
        setAddStudentLastName={setAddStudentLastName}
        addStudentFirstName={addStudentFirstName}
        setAddStudentFirstName={setAddStudentFirstName}
        addStudentEmail={addStudentEmail}
        setAddStudentEmail={setAddStudentEmail}
        addStudentPhone={addStudentPhone}
        setAddStudentPhone={setAddStudentPhone}
        addStudentNotes={addStudentNotes}
        setAddStudentNotes={setAddStudentNotes}
        batchStudentsText={batchStudentsText}
        setBatchStudentsText={setBatchStudentsText}
        isSavingManualStudent={isSavingManualStudent}
        handleSaveSingleStudent={handleSaveSingleStudent}
        handleSaveBatchStudents={handleSaveBatchStudents}
      />

      {/* ------------------------------------------------------------- */}
      {/* MODAL: ENVIAR MENSAJE DIRECTO AL ESTUDIANTE (CORREO / WHATSAPP) */}
      {/* ------------------------------------------------------------- */}
      <DirectMessageModal
        directMessageModal={directMessageModal}
        setDirectMessageModal={setDirectMessageModal}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        handleSendDirectMessage={handleSendDirectMessage}
      />

      {/* Course & Student Reports Modal */}
      {courseReportModalOpen && activeCourse && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* Attendance & Calendar Weeks Settings Modal (Semáforo de Asistencia) */}
      {isAttendanceSettingsModalOpen && activeCourse && (
        <AttendanceSettingsModal
          isOpen={isAttendanceSettingsModalOpen}
          onClose={() => setIsAttendanceSettingsModalOpen(false)}
          course={activeCourse}
          currentSettings={attendanceSettings}
          onSaveSettings={handleSaveAttendanceSettings}
          students={courseStudents}
          studentMetricsMap={(() => {
            const map: Record<string, StudentDispositionData> = {};
            courseStudents.forEach((s) => {
              map[s.id] = getStudentMetrics(s.id, attendanceTerm);
            });
            return map;
          })()}
          currentTerm={attendanceTerm}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Backup and Restore Modal (Copia de Seguridad JSON 1 Clic) */}
      {isBackupModalOpen && activeCourse && (
        <BackupRestoreModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          course={activeCourse}
          students={courseStudents}
          courseHistory={courseHistory}
          studentObservations={studentObservations}
          onRestoreObservations={(merged) => setStudentObservations(merged)}
          onRestoreSuccess={(msg) => {
            setToastMessage(msg);
            setTimeout(() => setToastMessage(null), 4000);
            onRefreshData();
          }}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Quick Roll-Call Modal (Pasar Lista Rápido) */}
      {isQuickRollCallOpen && activeCourse && (
        <QuickRollCallModal
          isOpen={isQuickRollCallOpen}
          onClose={() => setIsQuickRollCallOpen(false)}
          courseId={activeCourse.id}
          courseName={activeCourse.name}
          students={courseStudents}
          attendanceTerm={attendanceTerm}
          attendanceSettings={attendanceSettings}
          historyList={historyList}
          getStudentMetrics={getStudentMetrics}
          teacherConductOptions={teacherConductOptions}
          onAddAbsence={handleAddAbsence}
          onRecordLateArrival={handleRecordLateArrival}
          onDeleteLatestAbsence={handleDeleteLatestAbsence}
          onDeleteLatestLate={handleDeleteLatestLate}
          onRecordDispositionAction={handleRecordDispositionAction}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

export default ClassesModule;
