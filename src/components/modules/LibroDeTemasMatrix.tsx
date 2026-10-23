import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Pencil,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  AttendanceSettings,
  saveCourseAttendanceSettings,
} from '../../utils/attendanceCalculations';
import {
  OFFICIAL_HOLIDAYS_2026,
  SchoolHolidayItem,
  WEEKDAY_LABELS,
  extractWeekdaysFromSchedule,
  extractDailySlotsFromSchedule,
  CourseDayTimeSlot,
} from '../../utils/schoolHolidays';
import { sheetsSyncQueue } from '../../services/workspace/sheetsSyncQueue';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import {
  firestoreSync,
  getActiveUserId,
  subscribeToCloudSyncStatus,
  CloudSyncStatusInfo,
  registerCloudFlushHandler,
  notifyDebouncedSyncPending,
} from '../../services/firestoreSync';
import { api, getUserStorageKey } from '../../services/api';
import {
  getCachedAccessToken,
  isValidGoogleAccessToken,
} from '../../services/workspace/googleAuth';
import { LibroDeTemasModals } from './classes/LibroDeTemasModals';
import { LibroDeTemasHeaderToolbar } from './classes/LibroDeTemasHeaderToolbar';
import { LibroDeTemasTodayCard } from './classes/LibroDeTemasTodayCard';
import { useLibroDeTemasSync } from '../../hooks/useLibroDeTemasSync';
import { isValidCourseSchedule } from '../../utils/courseFormatting';

export type NoClassCategory =
  | 'feriado'
  | 'acto'
  | 'mocks'
  | 'examen_internacional'
  | 'deportes'
  | 'jornada'
  | 'ausencia_docente'
  | 'otro';

export interface LibroDeTemasEntry {
  date: string; // YYYY-MM-DD
  slotIndex?: number; // 0 para 1° hora, 1 para 2° hora, etc.
  timeLabel?: string; // Ej: "07:50 - 08:50"
  isHoliday?: boolean; // Si no se dictó clase (Feriado, Acto, Mocks, Exámenes Internacionales, Deportes, etc.) -> Clase N° = "-"
  noClassCategory?: NoClassCategory;
  noClassReason?: string; // Razón específica por la cual no se dio la clase
  holidayName?: string;
  customClassNumber?: string; // Opcional por si el docente desea forzar un N° de clase manual
  unitNumber: string; // Ej: "1", "2", "-"
  contents: string; // CONTENIDOS dictados en la clase (o motivo por el cual no se dio clase)
  classCharacter: string; // Ej: "Teórico - Práctica", "Evaluativa", "Práctica", "Teórica", "-"
  observations: string; // OBSERVACIONES
  teacherSignature: string; // Firma del Profesor
  authoritySignature: string; // Firma de la Autoridad
  isCustomDate?: boolean; // Fecha agregada manualmente fuera de los días habituales
}

export interface LibroDeTemasMetadata {
  asignatura: string;
  profTitular: string;
  horario: string;
  folioNumero: string;
  configuredWeekdays?: number[]; // Días de clase guardados permanentemente para este curso
  isScheduleLocked?: boolean; // Si el día y horario ya quedaron fijados (editables con botón)
  slotsConfig?: Record<number, CourseDayTimeSlot[]>; // Horas y módulos configurados por día
}

export interface ScheduledRow {
  rowKey: string; // Identificador único de fila (ej: "2026-03-05" o "2026-03-05__1")
  dateStr: string;
  slotIndex: number;
  totalSlotsForDay: number;
  timeLabel: string;
  day: number;
  month: number;
  dow: number;
  weekdayShort: string;
  weekdayFull: string;
  term: '1c' | '2c';
  computedClassNumber: string;
  calendarHoliday?: SchoolHolidayItem;
  suggestedUnit: string;
  entry: LibroDeTemasEntry;
}

export interface LibroDeTemasSheetInfo {
  spreadsheetId: string;
  url: string;
  lastSyncedAt?: string;
}

export interface LibroDeTemasStorageData {
  metadata: LibroDeTemasMetadata;
  entries: Record<string, LibroDeTemasEntry>; // key: YYYY-MM-DD
  characterOptions?: string[]; // Opciones personalizadas del desplegable "Carácter de la clase"
  sheetInfo?: LibroDeTemasSheetInfo | null;
  updatedAt: string;
}

export interface LibroDeTemasMatrixProps {
  courseId: string;
  courseName: string;
  courseSubject?: string;
  courseSchedule?: string;
  teacherName?: string;
  attendanceSettings: AttendanceSettings;
  onUpdateAttendanceSettings?: (next: AttendanceSettings) => void;
  onRefreshCourse?: () => void;
  onOpenAttendanceSettingsModal?: () => void;
  onOpenBackupModal?: () => void;
  isDarkMode: boolean;
  driveFolderId?: string;
  driveFolderUrl?: string;
}

export const DEFAULT_CHARACTER_OPTIONS: string[] = [
  'Teórico - Práctica',
  'Teórica',
  'Práctica',
  'Evaluativa',
  'Diagnóstica',
  'Expositiva',
  'Aula Taller',
  'Repaso / Integración',
  '-',
];

export const NO_CLASS_PRESETS: {
  id: NoClassCategory;
  label: string;
  badgeLabel: string;
  defaultText: string;
}[] = [
  {
    id: 'feriado',
    label: 'Feriado / Asueto Escolar',
    badgeLabel: 'Feriado',
    defaultText: 'Feriado',
  },
  {
    id: 'acto',
    label: 'Acto Escolar / Conmemoración',
    badgeLabel: 'Acto Escolar',
    defaultText: 'Sin dictado de clases: Acto Escolar',
  },
  {
    id: 'mocks',
    label: 'Mocks / Simulacros de Examen',
    badgeLabel: 'Mocks',
    defaultText: 'Sin dictado de clases: Mocks / Simulacros',
  },
  {
    id: 'examen_internacional',
    label: 'Exámenes Internacionales',
    badgeLabel: 'Ex. Internacional',
    defaultText: 'Sin dictado de clases: Exámenes Internacionales',
  },
  {
    id: 'deportes',
    label: 'Deportes / Torneo / Salida Educativa',
    badgeLabel: 'Deportes / Salida',
    defaultText: 'Sin dictado de clases: Actividad Deportiva / Salida Educativa',
  },
  {
    id: 'jornada',
    label: 'Jornada Institucional / EMI',
    badgeLabel: 'Jornada',
    defaultText: 'Sin dictado de clases: Jornada Institucional',
  },
  {
    id: 'ausencia_docente',
    label: 'Suspensión / Licencia / Mesa de Examen',
    badgeLabel: 'Sin dictado',
    defaultText: 'Sin dictado de clases',
  },
  {
    id: 'otro',
    label: 'Otro motivo (escribir razón...)',
    badgeLabel: 'Sin clase',
    defaultText: 'Sin dictado de clases: ',
  },
];

const SHORT_WEEKDAYS: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
};

const GLOBAL_CHARACTER_OPTIONS_KEY = 'fds_libro_temas_character_options_v1';

function getStorageKey(courseId: string): string {
  return getUserStorageKey(`fds_libro_temas_${courseId}`);
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0);
}

function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadGlobalCharacterOptions(): string[] {
  if (typeof window === 'undefined') return DEFAULT_CHARACTER_OPTIONS;
  try {
    const raw = localStorage.getItem(GLOBAL_CHARACTER_OPTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}
  return DEFAULT_CHARACTER_OPTIONS;
}

export const LibroDeTemasMatrix: React.FC<LibroDeTemasMatrixProps> = ({
  courseId,
  courseName,
  courseSubject,
  courseSchedule,
  teacherName,
  attendanceSettings,
  onUpdateAttendanceSettings,
  onRefreshCourse,
  onOpenAttendanceSettingsModal,
  onOpenBackupModal,
  isDarkMode,
  driveFolderId,
}) => {
  // Días iniciales detectados desde el horario del curso (prioritario) o configuración previa
  const initialWeekdays = useMemo<number[]>(() => {
    const fromSchedule = extractWeekdaysFromSchedule(courseSchedule);
    if (fromSchedule.length > 0) return fromSchedule;

    if (
      Array.isArray(attendanceSettings?.courseWeekdays) &&
      attendanceSettings.courseWeekdays.length > 0
    ) {
      return [...attendanceSettings.courseWeekdays].sort((a, b) => a - b);
    }
    return [1, 3];
  }, [attendanceSettings?.courseWeekdays, courseSchedule]);

  const defaultMetadata = useMemo<LibroDeTemasMetadata>(
    () => ({
      asignatura: courseSubject ? `${courseSubject} (${courseName})` : courseName,
      profTitular: teacherName || 'Profesor/a Titular',
      horario: isValidCourseSchedule(courseSchedule) ? courseSchedule!.trim() : 'Sin horario especificado',
      folioNumero: '1',
      configuredWeekdays: initialWeekdays,
      isScheduleLocked: isValidCourseSchedule(courseSchedule),
    }),
    [courseId, courseName, courseSubject, courseSchedule, teacherName, initialWeekdays]
  );

  // Estado principal del Libro de Temas
  const [metadata, setMetadata] = useState<LibroDeTemasMetadata>(defaultMetadata);
  const [entriesMap, setEntriesMap] = useState<Record<string, LibroDeTemasEntry>>({});
  const [characterOptions, setCharacterOptions] = useState<string[]>(() =>
    loadGlobalCharacterOptions()
  );

  // Modo edición de días y horarios (cuando ya están guardados se muestran bloqueados para no alterarlos por error)
  const [isEditingScheduleConfig, setIsEditingScheduleConfig] = useState<boolean>(false);
  const [customScheduleInput, setCustomScheduleInput] = useState<string>('');

  // Selector de hora para la tarjeta "Clase de Hoy" cuando el día tiene múltiples horas (módulos)
  const [selectedTodaySlotIndex, setSelectedTodaySlotIndex] = useState<number>(0);

  // Modal para editar las opciones del desplegable "Carácter de la clase"
  const [showCharacterOptionsModal, setShowCharacterOptionsModal] = useState(false);
  const [newCharacterOptionText, setNewCharacterOptionText] = useState('');
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);
  const [editingOptionValue, setEditingOptionValue] = useState('');

  // Modal para marcar una fecha como "Sin dictado de clase" (Feriado, Acto, Mocks, Exámenes Internacionales, Deportes, etc.)
  const [noClassModalRow, setNoClassModalRow] = useState<{
    rowKey: string;
    dateStr: string;
    slotIndex: number;
    timeLabel?: string;
    day: number;
    month: number;
    weekdayFull: string;
    isCurrentlyNoClass: boolean;
    category: NoClassCategory;
    reasonText: string;
    observations: string;
    applyToAllDaySlots?: boolean;
  } | null>(null);

  // Filtros de vista
  const [termFilter, setTermFilter] = useState<'all' | '1c' | '2c' | 'until_today'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'holidays'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Modal para agregar fecha especial fuera de cronograma
  const [showAddDateModal, setShowAddDateModal] = useState(false);
  const [newCustomDate, setNewCustomDate] = useState(() => formatYYYYMMDD(new Date()));
  const [newCustomUnit, setNewCustomUnit] = useState('1');
  const [newCustomContents, setNewCustomContents] = useState('');
  const [newCustomCharacter, setNewCustomCharacter] = useState('Teórico - Práctica');

  // Exportación a Google Docs (.gdoc) en Drive y Sincronización con Google Sheets
  const [showDriveConfirm, setShowDriveConfirm] = useState(false);
  const [driveDocTitle, setDriveDocTitle] = useState('');
  const [isExportingDoc, setIsExportingDoc] = useState(false);
  const [exportedDocLink, setExportedDocLink] = useState<{ url: string; name: string } | null>(
    null
  );
  const [sheetInfo, setSheetInfo] = useState<LibroDeTemasSheetInfo | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isOpeningSheet, setIsOpeningSheet] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatusInfo>({
    state: 'synced',
    lastSyncedAt: null,
    pendingCount: 0,
  });

  useEffect(() => {
    return subscribeToCloudSyncStatus((st) => setCloudStatus(st));
  }, []);

  const cloudSyncTimeoutRef = useRef<number | null>(null);
  const todayRowRef = useRef<HTMLTableRowElement | null>(null);
  const latestStateRef = useRef<{
    metadata: LibroDeTemasMetadata;
    entries: Record<string, LibroDeTemasEntry>;
    characterOptions: string[];
    sheetInfo: LibroDeTemasSheetInfo | null;
  }>({
    metadata,
    entries: entriesMap,
    characterOptions,
    sheetInfo,
  });

  useEffect(() => {
    latestStateRef.current = { metadata, entries: entriesMap, characterOptions, sheetInfo };
  }, [metadata, entriesMap, characterOptions, sheetInfo]);

  const todayStr = useMemo(() => formatYYYYMMDD(new Date()), []);

  // Cargar datos guardados del curso (localStorage + Firestore)
  useEffect(() => {
    if (!courseId) return;
    let hasLocalData = false;
    const globalCharOpts = loadGlobalCharacterOptions();

    try {
      const raw = localStorage.getItem(getStorageKey(courseId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LibroDeTemasStorageData>;
        if (parsed.metadata) {
          const fromSchedule = extractWeekdaysFromSchedule(courseSchedule);
          const savedWeekdays =
            fromSchedule.length > 0
              ? fromSchedule
              : Array.isArray(parsed.metadata.configuredWeekdays) &&
                parsed.metadata.configuredWeekdays.length > 0
              ? parsed.metadata.configuredWeekdays
              : initialWeekdays;

          const resolvedLocalHorario = isValidCourseSchedule(courseSchedule)
            ? courseSchedule!.trim()
            : isValidCourseSchedule(parsed.metadata.horario)
            ? parsed.metadata.horario!.trim()
            : defaultMetadata.horario;

          if (!isValidCourseSchedule(courseSchedule) && isValidCourseSchedule(resolvedLocalHorario)) {
            api.updateCourse(courseId, { schedule: resolvedLocalHorario }).catch(() => {});
          }

          const loadedMeta: LibroDeTemasMetadata = {
            asignatura: parsed.metadata.asignatura || defaultMetadata.asignatura,
            profTitular: parsed.metadata.profTitular || defaultMetadata.profTitular,
            horario: resolvedLocalHorario,
            folioNumero: parsed.metadata.folioNumero || '1',
            configuredWeekdays: savedWeekdays,
            isScheduleLocked: parsed.metadata.isScheduleLocked ?? true,
          };
          setMetadata(loadedMeta);
          setIsEditingScheduleConfig(!loadedMeta.isScheduleLocked);
        } else {
          setMetadata(defaultMetadata);
          setIsEditingScheduleConfig(!defaultMetadata.isScheduleLocked);
        }

        if (parsed.entries && typeof parsed.entries === 'object') {
          setEntriesMap(parsed.entries);
        } else {
          setEntriesMap({});
        }

        if (Array.isArray(parsed.characterOptions) && parsed.characterOptions.length > 0) {
          setCharacterOptions(parsed.characterOptions);
        } else {
          setCharacterOptions(globalCharOpts);
        }

        if (parsed.sheetInfo && isRealGoogleSpreadsheetId(parsed.sheetInfo.spreadsheetId)) {
          setSheetInfo(parsed.sheetInfo);
        } else {
          setSheetInfo(null);
        }

        hasLocalData = true;
      } else {
        setMetadata(defaultMetadata);
        setEntriesMap({});
        setCharacterOptions(globalCharOpts);
        setSheetInfo(null);
        setIsEditingScheduleConfig(!defaultMetadata.isScheduleLocked);
      }
    } catch (_) {
      setMetadata(defaultMetadata);
      setEntriesMap({});
      setCharacterOptions(globalCharOpts);
      setSheetInfo(null);
    }

    // Cargar desde Firestore en segundo plano y fusionar inteligentemente para no perder ningún registro entre dispositivos
    let mounted = true;
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync
        .loadUserSetting<LibroDeTemasStorageData>(uid, `libro_temas_${courseId}`)
        .then((cloudData) => {
          if (!mounted || !cloudData || typeof cloudData !== 'object') return;
          const currentLocalRaw = localStorage.getItem(getStorageKey(courseId));
          let localParsed: Partial<LibroDeTemasStorageData> | null = null;
          try {
            if (currentLocalRaw) localParsed = JSON.parse(currentLocalRaw);
          } catch (_) {}

          const localUpdatedAt = localParsed?.updatedAt ? String(localParsed.updatedAt) : '';
          const cloudUpdatedAt = cloudData.updatedAt ? String(cloudData.updatedAt) : '';
          const isCloudNewer = !hasLocalData || !currentLocalRaw || (cloudUpdatedAt && (!localUpdatedAt || cloudUpdatedAt >= localUpdatedAt));

          if (cloudData.entries && typeof cloudData.entries === 'object' && Object.keys(cloudData.entries).length > 0) {
            setEntriesMap((prev) => {
              const mergedEntries = isCloudNewer
                ? { ...prev, ...cloudData.entries }
                : { ...cloudData.entries, ...prev };
              try {
                const updatedPayload: LibroDeTemasStorageData = {
                  metadata: isCloudNewer && cloudData.metadata ? { ...latestStateRef.current.metadata, ...cloudData.metadata } : latestStateRef.current.metadata,
                  entries: mergedEntries,
                  characterOptions:
                    isCloudNewer && Array.isArray(cloudData.characterOptions) && cloudData.characterOptions.length > 0
                      ? cloudData.characterOptions
                      : latestStateRef.current.characterOptions,
                  sheetInfo:
                    cloudData.sheetInfo && isRealGoogleSpreadsheetId(cloudData.sheetInfo.spreadsheetId)
                      ? cloudData.sheetInfo
                      : latestStateRef.current.sheetInfo,
                  updatedAt: isCloudNewer && cloudUpdatedAt ? cloudUpdatedAt : localUpdatedAt || new Date().toISOString(),
                };
                localStorage.setItem(getStorageKey(courseId), JSON.stringify(updatedPayload));
              } catch (_) {}
              return mergedEntries;
            });
          }

          if (isCloudNewer && cloudData.metadata) {
            const fromSchedule = extractWeekdaysFromSchedule(courseSchedule);
            const cloudWeekdays =
              fromSchedule.length > 0
                ? fromSchedule
                : Array.isArray(cloudData.metadata.configuredWeekdays) &&
                  cloudData.metadata.configuredWeekdays.length > 0
                ? cloudData.metadata.configuredWeekdays
                : initialWeekdays;

            const resolvedCloudHorario = isValidCourseSchedule(courseSchedule)
              ? courseSchedule!.trim()
              : isValidCourseSchedule(cloudData.metadata.horario)
              ? cloudData.metadata.horario!.trim()
              : isValidCourseSchedule(localParsed?.metadata?.horario)
              ? localParsed!.metadata!.horario!.trim()
              : defaultMetadata.horario;

            if (!isValidCourseSchedule(courseSchedule) && isValidCourseSchedule(resolvedCloudHorario)) {
              api.updateCourse(courseId, { schedule: resolvedCloudHorario }).catch(() => {});
            }

            const mergedMeta: LibroDeTemasMetadata = {
              asignatura: cloudData.metadata.asignatura || defaultMetadata.asignatura,
              profTitular: cloudData.metadata.profTitular || defaultMetadata.profTitular,
              horario: resolvedCloudHorario,
              folioNumero: cloudData.metadata.folioNumero || '1',
              configuredWeekdays: cloudWeekdays,
              isScheduleLocked: cloudData.metadata.isScheduleLocked ?? true,
            };
            setMetadata(mergedMeta);
            setIsEditingScheduleConfig(!mergedMeta.isScheduleLocked);
          }

          if (
            isCloudNewer &&
            Array.isArray(cloudData.characterOptions) &&
            cloudData.characterOptions.length > 0
          ) {
            setCharacterOptions(cloudData.characterOptions);
          }

          if (cloudData.sheetInfo && isRealGoogleSpreadsheetId(cloudData.sheetInfo.spreadsheetId)) {
            setSheetInfo((prev) => (isCloudNewer ? cloudData.sheetInfo! : prev || cloudData.sheetInfo || null));
          }
        })
        .catch(() => {});
    }

    const handleBackupRestored = (e: any) => {
      if (e?.detail?.courseId && e.detail.courseId !== courseId) return;
      try {
        const raw = localStorage.getItem(getStorageKey(courseId));
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<LibroDeTemasStorageData>;
          if (parsed.metadata) setMetadata(parsed.metadata);
          if (parsed.entries) setEntriesMap(parsed.entries);
          if (Array.isArray(parsed.characterOptions)) setCharacterOptions(parsed.characterOptions);
          if (parsed.sheetInfo) setSheetInfo(parsed.sheetInfo);
        }
      } catch (_) {}
    };

    window.addEventListener('docencia_libro_temas_restored', handleBackupRestored);

    const flushKey = `libro_temas_${courseId}`;
    const flushNow = () => {
      if (cloudSyncTimeoutRef.current) {
        window.clearTimeout(cloudSyncTimeoutRef.current);
        cloudSyncTimeoutRef.current = null;
      }
      notifyDebouncedSyncPending(flushKey, false);
      const activeUid = getActiveUserId();
      if (activeUid && courseId) {
        firestoreSync
          .saveUserSetting(activeUid, `libro_temas_${courseId}`, {
            metadata: latestStateRef.current.metadata,
            entries: latestStateRef.current.entries,
            characterOptions: latestStateRef.current.characterOptions,
            sheetInfo: latestStateRef.current.sheetInfo,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }
    };

    const unregFlush = registerCloudFlushHandler(flushKey, () => {
      if (cloudSyncTimeoutRef.current) {
        flushNow();
      }
    });

    return () => {
      mounted = false;
      window.removeEventListener('docencia_libro_temas_restored', handleBackupRestored);
      unregFlush();
      // Si había un guardado en la nube pendiente al cambiar de curso o pestaña, ejecutarlo inmediatamente
      if (cloudSyncTimeoutRef.current) {
        flushNow();
      }
    };
  }, [courseId]);

  // Guardar cambios en localStorage y sincronizar con Firestore
  const persistLibroData = (
    nextMetadata: LibroDeTemasMetadata,
    nextEntries: Record<string, LibroDeTemasEntry>,
    nextCharacterOptions: string[] = characterOptions,
    immediateCloud = false,
    nextSheetInfo: LibroDeTemasSheetInfo | null = sheetInfo
  ) => {
    if (!courseId) return;
    const flushKey = `libro_temas_${courseId}`;
    const payload: LibroDeTemasStorageData = {
      metadata: nextMetadata,
      entries: nextEntries,
      characterOptions: nextCharacterOptions,
      sheetInfo: nextSheetInfo,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(getStorageKey(courseId), JSON.stringify(payload));
      localStorage.setItem(GLOBAL_CHARACTER_OPTIONS_KEY, JSON.stringify(nextCharacterOptions));
    } catch (_) {}

    if (cloudSyncTimeoutRef.current) {
      window.clearTimeout(cloudSyncTimeoutRef.current);
      cloudSyncTimeoutRef.current = null;
    }

    const syncToCloud = () => {
      cloudSyncTimeoutRef.current = null;
      notifyDebouncedSyncPending(flushKey, false);
      const uid = getActiveUserId();
      if (uid) {
        firestoreSync.saveUserSetting(uid, `libro_temas_${courseId}`, payload).catch(() => {});
      }
    };

    if (immediateCloud) {
      syncToCloud();
    } else {
      notifyDebouncedSyncPending(flushKey, true);
      cloudSyncTimeoutRef.current = window.setTimeout(syncToCloud, 1400);
    }

    // Si ya hay una planilla de Google Sheets vinculada, encolar sincronización automática con debounce
    const activeSpreadsheetId = nextSheetInfo?.spreadsheetId || sheetInfo?.spreadsheetId;
    if (activeSpreadsheetId && isRealGoogleSpreadsheetId(activeSpreadsheetId)) {
      const token = getCachedAccessToken();
      if (token && isValidGoogleAccessToken(token)) {
        sheetsSyncQueue.enqueue(
          courseId,
          'libro_de_temas',
          async () => {
            await pushLibroSnapshotToSheets(activeSpreadsheetId, nextMetadata, nextEntries);
          },
          3500
        );
      }
    }
  };

  const handleMetadataChange = (field: keyof LibroDeTemasMetadata, value: any) => {
    setMetadata((prev) => {
      const next = { ...prev, [field]: value };
      persistLibroData(next, entriesMap, characterOptions);
      return next;
    });
  };

  // Sincronizar automáticamente cuando cambie o se cargue courseSchedule (desde Calendar o edición del curso)
  useEffect(() => {
    if (!isValidCourseSchedule(courseSchedule)) return;
    const fromSchedule = extractWeekdaysFromSchedule(courseSchedule);
    if (fromSchedule.length === 0) return;

    setMetadata((prev) => {
      const prevDaysStr = (prev.configuredWeekdays || []).join(',');
      const newDaysStr = fromSchedule.join(',');
      if (prevDaysStr === newDaysStr && prev.horario === courseSchedule) {
        return prev;
      }
      const updatedMeta: LibroDeTemasMetadata = {
        ...prev,
        horario: courseSchedule,
        configuredWeekdays: fromSchedule,
      };
      persistLibroData(updatedMeta, entriesMap, characterOptions, true);
      return updatedMeta;
    });

    const nextSettings: AttendanceSettings = {
      ...attendanceSettings,
      courseWeekdays: fromSchedule,
      classesPerWeek: fromSchedule.length,
    };
    saveCourseAttendanceSettings(courseId, nextSettings);
    if (onUpdateAttendanceSettings) {
      onUpdateAttendanceSettings(nextSettings);
    }
  }, [courseSchedule, courseId]);

  // Días de cursada activos: el horario superior (Google Calendar o edición del curso) es la fuente directa
  const activeWeekdays = useMemo<number[]>(() => {
    // 1. Si el horario del curso tiene días explícitos, siempre tiene prioridad absoluta para coincidir con "Horario"
    const fromSchedule = extractWeekdaysFromSchedule(courseSchedule || metadata.horario);
    if (fromSchedule.length > 0) {
      return fromSchedule;
    }

    // 2. Si no hay horario de texto pero sí días configurados en metadata
    if (
      Array.isArray(metadata.configuredWeekdays) &&
      metadata.configuredWeekdays.length > 0
    ) {
      return [...metadata.configuredWeekdays].sort((a, b) => a - b);
    }

    // 3. Configuración de asistencia
    if (
      Array.isArray(attendanceSettings?.courseWeekdays) &&
      attendanceSettings.courseWeekdays.length > 0
    ) {
      return [...attendanceSettings.courseWeekdays].sort((a, b) => a - b);
    }

    return [1, 3];
  }, [courseSchedule, metadata.horario, metadata.configuredWeekdays, attendanceSettings?.courseWeekdays]);

  // Módulos y horas diarias extraídas del horario del curso (Google Calendar o edición)
  // Cada hora/módulo genera una fila independiente en el Libro de Temas
  const dailySlots = useMemo<Record<number, CourseDayTimeSlot[]>>(() => {
    const raw = courseSchedule || metadata.horario;
    const parsed = extractDailySlotsFromSchedule(raw, activeWeekdays);
    if (metadata.slotsConfig) {
      for (const d of activeWeekdays) {
        if (metadata.slotsConfig[d] && metadata.slotsConfig[d].length > 0) {
          parsed[d] = metadata.slotsConfig[d];
        }
      }
    }
    return parsed;
  }, [courseSchedule, metadata.horario, metadata.slotsConfig, activeWeekdays]);

  // Resumen legible de módulos y horas por día para el encabezado
  const scheduleSummaryText = useMemo(() => {
    return activeWeekdays
      .map((d) => {
        const slots = dailySlots[d] || [];
        const dayLabel = WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d] || `Día ${d}`;
        if (slots.length > 1) {
          const times = slots.map((s) => s.timeLabel).filter(Boolean).join(' y ');
          return `${dayLabel}: ${slots.length} horas${times ? ` (${times})` : ''}`;
        }
        if (slots.length === 1 && slots[0].timeLabel) {
          return `${dayLabel}: ${slots[0].timeLabel}`;
        }
        return dayLabel;
      })
      .join(' · ');
  }, [activeWeekdays, dailySlots]);

  // Alternar día de cursada semanal
  const handleToggleCourseWeekday = (dayNumber: number) => {
    const exists = activeWeekdays.includes(dayNumber);
    const nextWeekdays = exists
      ? activeWeekdays.filter((d) => d !== dayNumber)
      : [...activeWeekdays, dayNumber].sort((a, b) => a - b);

    if (nextWeekdays.length === 0) return; // Al menos 1 día de cursada

    const nextMeta: LibroDeTemasMetadata = {
      ...metadata,
      configuredWeekdays: nextWeekdays,
    };
    setMetadata(nextMeta);
    persistLibroData(nextMeta, entriesMap, characterOptions, true);

    const nextSettings: AttendanceSettings = {
      ...attendanceSettings,
      courseWeekdays: nextWeekdays,
      classesPerWeek: nextWeekdays.length,
    };
    saveCourseAttendanceSettings(courseId, nextSettings);
    if (onUpdateAttendanceSettings) {
      onUpdateAttendanceSettings(nextSettings);
    }
  };

  // Guardar permanentemente Día y Horario de las clases
  const handleSavePermanentScheduleAndDays = async () => {
    const newScheduleLabel = activeWeekdays
      .map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d])
      .join(', ');

    const fromPreviousSchedule = extractWeekdaysFromSchedule(courseSchedule || metadata.horario);
    const daysChanged = fromPreviousSchedule.join(',') !== activeWeekdays.join(',');

    let updatedScheduleText = courseSchedule || metadata.horario;
    if (
      daysChanged ||
      !updatedScheduleText ||
      updatedScheduleText === 'Sin horario especificado' ||
      updatedScheduleText === 'Lunes y Miércoles'
    ) {
      updatedScheduleText = newScheduleLabel;
    }

    const nextMeta: LibroDeTemasMetadata = {
      ...metadata,
      horario: updatedScheduleText,
      configuredWeekdays: activeWeekdays,
      isScheduleLocked: true,
    };
    setMetadata(nextMeta);
    setIsEditingScheduleConfig(false);
    persistLibroData(nextMeta, entriesMap, characterOptions, true);

    // Sincronizar también en AttendanceSettings y en el Curso para que quede en toda la app
    const nextSettings: AttendanceSettings = {
      ...attendanceSettings,
      courseWeekdays: activeWeekdays,
      classesPerWeek: activeWeekdays.length,
    };
    saveCourseAttendanceSettings(courseId, nextSettings);
    if (onUpdateAttendanceSettings) {
      onUpdateAttendanceSettings(nextSettings);
    }

    try {
      await api.updateCourse(courseId, { schedule: updatedScheduleText });
      if (onRefreshCourse) {
        onRefreshCourse();
      }
    } catch (_) {}

    setToastMsg(
      'Días y horario de cursada sincronizados correctamente para toda la materia.'
    );
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Gestión de opciones personalizadas de "Carácter de la clase"
  const handleAddCharacterOption = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCharacterOptionText.trim();
    if (!trimmed) return;
    if (characterOptions.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
      setNewCharacterOptionText('');
      return;
    }
    // Insertar antes de "-" si existe al final
    const withoutDash = characterOptions.filter((o) => o !== '-');
    const nextOptions = [...withoutDash, trimmed, '-'];
    setCharacterOptions(nextOptions);
    setNewCharacterOptionText('');
    persistLibroData(metadata, entriesMap, nextOptions, true);
  };

  const handleSaveEditedCharacterOption = (index: number) => {
    const trimmed = editingOptionValue.trim();
    if (!trimmed) return;
    const oldOption = characterOptions[index];
    const nextOptions = characterOptions.map((opt, idx) => (idx === index ? trimmed : opt));
    setCharacterOptions(nextOptions);
    setEditingOptionIndex(null);
    setEditingOptionValue('');

    // Actualizar filas que tuvieran el nombre anterior
    const nextEntries = { ...entriesMap };
    Object.keys(nextEntries).forEach((dateKey) => {
      if (nextEntries[dateKey]?.classCharacter === oldOption) {
        nextEntries[dateKey] = {
          ...nextEntries[dateKey],
          classCharacter: trimmed,
        };
      }
    });
    setEntriesMap(nextEntries);
    persistLibroData(metadata, nextEntries, nextOptions, true);
  };

  const handleDeleteCharacterOption = (optionToRemove: string) => {
    if (optionToRemove === '-') return; // Mantener siempre "-" para días sin clase
    const nextOptions = characterOptions.filter((o) => o !== optionToRemove);
    setCharacterOptions(nextOptions);
    persistLibroData(metadata, entriesMap, nextOptions, true);
  };

  const handleRestoreDefaultCharacterOptions = () => {
    setCharacterOptions(DEFAULT_CHARACTER_OPTIONS);
    persistLibroData(metadata, entriesMap, DEFAULT_CHARACTER_OPTIONS, true);
  };

  // Mapa de feriados activos para este curso
  const holidaysByDate = useMemo<Record<string, SchoolHolidayItem>>(() => {
    const excluded = new Set(attendanceSettings?.excludedHolidayIds || []);
    const custom = Array.isArray(attendanceSettings?.customHolidays)
      ? attendanceSettings.customHolidays
      : [];
    const map: Record<string, SchoolHolidayItem> = {};

    for (const h of [...OFFICIAL_HOLIDAYS_2026, ...custom]) {
      if (!excluded.has(h.id)) {
        map[h.date] = h;
      }
    }
    return map;
  }, [attendanceSettings?.excludedHolidayIds, attendanceSettings?.customHolidays]);

  // Generar todas las fechas de clase del calendario (1°C + 2°C + fechas personalizadas)
  const scheduledRows = useMemo(() => {
    const start1c = attendanceSettings?.termStartDate1c || '2026-03-02';
    const end1c = attendanceSettings?.termEndDate1c || '2026-07-10';
    const start2c = attendanceSettings?.termStartDate2c || '2026-08-03';
    const end2c = attendanceSettings?.termEndDate2c || '2026-12-04';

    const dateSet = new Set<string>();
    const dateTermMap: Record<string, '1c' | '2c'> = {};

    const generateForRange = (startStr: string, endStr: string, term: '1c' | '2c') => {
      const start = parseLocalDate(startStr);
      const end = parseLocalDate(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;

      const cursor = new Date(start);
      let safety = 0;
      while (cursor <= end && safety < 400) {
        safety++;
        const dow = cursor.getDay();
        if (activeWeekdays.includes(dow)) {
          const dStr = formatYYYYMMDD(cursor);
          dateSet.add(dStr);
          dateTermMap[dStr] = term;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    };

    generateForRange(start1c, end1c, '1c');
    generateForRange(start2c, end2c, '2c');

    // Agregar cualquier fecha personalizada guardada en entriesMap (ignorando claves de 2°/3° hora como YYYY-MM-DD__1)
    Object.keys(entriesMap).forEach((dStr) => {
      if (dStr.includes('__') || !/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return;
      const savedEntry = entriesMap[dStr];
      if (!savedEntry) return;

      const hasMeaningfulData = Boolean(
        savedEntry.isCustomDate ||
          savedEntry.isHoliday ||
          savedEntry.contents?.trim() ||
          savedEntry.observations?.trim() ||
          savedEntry.teacherSignature?.trim() ||
          savedEntry.authoritySignature?.trim()
      );

      if (savedEntry.isCustomDate || (!dateSet.has(dStr) && hasMeaningfulData)) {
        dateSet.add(dStr);
        if (!dateTermMap[dStr]) {
          dateTermMap[dStr] = dStr <= end1c ? '1c' : '2c';
        }
      }
    });

    const sortedDates = Array.from(dateSet).sort();

    // Construir filas y numerar secuencialmente Clase N°: CADA HORA/MÓDULO ES UNA FILA
    // Si un día tiene 2 horas (ej: 07:50 - 08:50 y 08:50 - 09:50), se generan 2 filas consecutivas
    const rows: ScheduledRow[] = [];
    let sequentialClassCounter = 0;
    let lastKnownUnit = '1';

    for (const dateStr of sortedDates) {
      const dateObj = parseLocalDate(dateStr);
      const day = dateObj.getDate();
      const month = dateObj.getMonth() + 1;
      const dow = dateObj.getDay();
      const weekdayShort = SHORT_WEEKDAYS[dow] || '';
      const weekdayFull = WEEKDAY_LABELS[dow] || '';
      const calendarHoliday = holidaysByDate[dateStr];
      const slots =
        dailySlots[dow] && dailySlots[dow].length > 0
          ? dailySlots[dow]
          : [{ slotIndex: 0, timeLabel: '' }];

      slots.forEach((slot, sIdx) => {
        const rowKey = sIdx === 0 ? dateStr : `${dateStr}__${sIdx}`;
        // Compatibilidad: buscar primero en rowKey específico, o en dateStr para el slot 0
        const saved = entriesMap[rowKey] || (sIdx === 0 ? entriesMap[dateStr] : undefined);

        // Feriado en todo el día (desde el calendario escolar o marcado en dateStr)
        const dayWideHoliday =
          Boolean(calendarHoliday) || Boolean(entriesMap[dateStr]?.isHoliday);
        const isHoliday =
          saved?.isHoliday !== undefined ? saved.isHoliday : dayWideHoliday;

        const noClassCategory: NoClassCategory | undefined = isHoliday
          ? saved?.noClassCategory || entriesMap[dateStr]?.noClassCategory || 'feriado'
          : undefined;

        let computedClassNumber = '-';
        if (!isHoliday) {
          sequentialClassCounter += 1;
          computedClassNumber = saved?.customClassNumber?.trim()
            ? saved.customClassNumber.trim()
            : String(sequentialClassCounter);
        }

        if (saved?.unitNumber && saved.unitNumber !== '-') {
          lastKnownUnit = saved.unitNumber;
        }

        const defaultNoClassContents =
          saved?.noClassReason?.trim() ||
          entriesMap[dateStr]?.noClassReason?.trim() ||
          (calendarHoliday ? 'Feriado' : 'Sin dictado de clases');

        const entry: LibroDeTemasEntry = {
          date: dateStr,
          slotIndex: sIdx,
          timeLabel: slot.timeLabel,
          isHoliday,
          noClassCategory,
          noClassReason: saved?.noClassReason || entriesMap[dateStr]?.noClassReason,
          holidayName:
            calendarHoliday?.name || saved?.holidayName || entriesMap[dateStr]?.holidayName,
          customClassNumber: saved?.customClassNumber || '',
          unitNumber: isHoliday ? '-' : saved?.unitNumber ?? '',
          contents: isHoliday
            ? saved?.contents !== undefined && saved.contents !== ''
              ? saved.contents
              : defaultNoClassContents
            : saved?.contents ?? '',
          classCharacter: isHoliday
            ? '-'
            : saved?.classCharacter !== undefined
            ? saved.classCharacter
            : saved?.contents
            ? characterOptions[0] || 'Teórico - Práctica'
            : '',
          observations:
            saved?.observations ??
            (isHoliday && calendarHoliday ? calendarHoliday.name : ''),
          teacherSignature: saved?.teacherSignature ?? '',
          authoritySignature: saved?.authoritySignature ?? '',
          isCustomDate: saved?.isCustomDate,
        };

        rows.push({
          rowKey,
          dateStr,
          slotIndex: sIdx,
          totalSlotsForDay: slots.length,
          timeLabel: slot.timeLabel,
          day,
          month,
          dow,
          weekdayShort,
          weekdayFull,
          term: dateTermMap[dateStr] || '1c',
          computedClassNumber,
          calendarHoliday,
          suggestedUnit: lastKnownUnit,
          entry,
        });
      });
    }

    return rows;
  }, [
    attendanceSettings,
    activeWeekdays,
    dailySlots,
    holidaysByDate,
    entriesMap,
    characterOptions,
  ]);

  // Actualizar una celda de una fila específica (identificada por su rowKey)
  const updateEntryField = (
    rowKey: string,
    updater: (
      current: LibroDeTemasEntry,
      rowMeta?: (typeof scheduledRows)[0]
    ) => LibroDeTemasEntry,
    immediateCloud = false
  ) => {
    const rowMeta = scheduledRows.find((r) => r.rowKey === rowKey || r.dateStr === rowKey);
    const dateStr = rowMeta ? rowMeta.dateStr : rowKey.split('__')[0];
    const current: LibroDeTemasEntry = rowMeta
      ? { ...rowMeta.entry }
      : entriesMap[rowKey] || entriesMap[dateStr] || {
          date: dateStr,
          slotIndex: rowMeta?.slotIndex || 0,
          timeLabel: rowMeta?.timeLabel,
          unitNumber: '1',
          contents: '',
          classCharacter: characterOptions[0] || 'Teórico - Práctica',
          observations: '',
          teacherSignature: '',
          authoritySignature: '',
        };

    const updated = updater(current, rowMeta);
    setEntriesMap((prev) => {
      const next = { ...prev, [rowKey]: updated };
      if (rowMeta && rowMeta.slotIndex === 0) {
        next[dateStr] = updated;
      }
      persistLibroData(metadata, next, characterOptions, immediateCloud);
      return next;
    });
  };

  // Abrir modal para marcar día como "Sin clase" (Feriado, Acto, Mocks, Exámenes Internacionales, Deportes, u otro motivo)
  const handleOpenNoClassModal = (row: (typeof scheduledRows)[0]) => {
    const currentCat: NoClassCategory = row.entry.noClassCategory || 'feriado';
    const presetObj =
      NO_CLASS_PRESETS.find((p) => p.id === currentCat) || NO_CLASS_PRESETS[0];

    const initialReason = row.entry.isHoliday
      ? row.entry.contents || row.entry.noClassReason || presetObj.defaultText
      : row.calendarHoliday
      ? `Feriado (${row.calendarHoliday.name})`
      : 'Feriado';

    setNoClassModalRow({
      rowKey: row.rowKey,
      dateStr: row.dateStr,
      slotIndex: row.slotIndex,
      timeLabel: row.timeLabel,
      day: row.day,
      month: row.month,
      weekdayFull: row.weekdayFull,
      isCurrentlyNoClass: Boolean(row.entry.isHoliday),
      category: currentCat,
      reasonText: initialReason,
      observations: row.entry.observations || row.calendarHoliday?.name || '',
      applyToAllDaySlots: true,
    });
  };

  // Confirmar día sin dictado de clase (Feriado o Evento especial con razón escrita)
  const handleConfirmNoClassReason = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noClassModalRow) return;

    const reasonClean = noClassModalRow.reasonText.trim() || 'Sin dictado de clases';
    const updater = (curr: LibroDeTemasEntry): LibroDeTemasEntry => ({
      ...curr,
      isHoliday: true,
      noClassCategory: noClassModalRow.category,
      noClassReason: reasonClean,
      unitNumber: '-',
      contents: reasonClean,
      classCharacter: '-',
      observations: noClassModalRow.observations.trim(),
    });

    const siblingRows = scheduledRows.filter((r) => r.dateStr === noClassModalRow.dateStr);
    setEntriesMap((prev) => {
      const next = { ...prev };
      next[noClassModalRow.dateStr] = updater(prev[noClassModalRow.dateStr] || {
        date: noClassModalRow.dateStr,
        unitNumber: '-',
        contents: reasonClean,
        classCharacter: '-',
        observations: '',
        teacherSignature: '',
        authoritySignature: '',
      });
      siblingRows.forEach((sr) => {
        next[sr.rowKey] = updater(prev[sr.rowKey] || sr.entry);
      });
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });

    setNoClassModalRow(null);
    setToastMsg(
      `Fecha ${noClassModalRow.day}/${noClassModalRow.month} registrada sin dictado de clases (${reasonClean}).`
    );
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Restaurar un día sin clase a clase normal dictada
  const handleRevertToNormalClass = (dateStr: string) => {
    const siblingRows = scheduledRows.filter((r) => r.dateStr === dateStr);
    setEntriesMap((prev) => {
      const next = { ...prev };
      const revertEntry = (curr: LibroDeTemasEntry, sr?: (typeof scheduledRows)[0]): LibroDeTemasEntry => ({
        ...curr,
        isHoliday: false,
        noClassCategory: undefined,
        noClassReason: undefined,
        unitNumber: curr.unitNumber === '-' ? sr?.suggestedUnit || '1' : curr.unitNumber,
        contents:
          curr.contents === 'Feriado' ||
          curr.contents.startsWith('Sin dictado') ||
          curr.contents === curr.noClassReason
            ? ''
            : curr.contents,
        classCharacter:
          curr.classCharacter === '-'
            ? characterOptions[0] || 'Teórico - Práctica'
            : curr.classCharacter,
      });

      if (next[dateStr]) next[dateStr] = revertEntry(next[dateStr]);
      siblingRows.forEach((sr) => {
        if (next[sr.rowKey]) next[sr.rowKey] = revertEntry(next[sr.rowKey], sr);
      });
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });
    setNoClassModalRow(null);
  };

  // Firmar digitalmente una fila con el nombre del profesor
  const handleSignRow = (rowKey: string) => {
    const sig = metadata.profTitular.trim() || teacherName || 'Firmado';
    updateEntryField(rowKey, (curr) => ({
      ...curr,
      teacherSignature: curr.teacherSignature ? '' : sig,
    }));
  };

  // Firmar todas las clases que ya tienen contenidos registrados
  const handleSignAllCompletedClasses = () => {
    const sig = metadata.profTitular.trim() || teacherName || 'Firmado';
    let count = 0;
    const nextEntries = { ...entriesMap };

    scheduledRows.forEach((row) => {
      const hasContent = row.entry.contents.trim().length > 0;
      if (hasContent && !row.entry.teacherSignature) {
        nextEntries[row.rowKey] = {
          ...row.entry,
          teacherSignature: sig,
        };
        count++;
      }
    });

    if (count > 0) {
      setEntriesMap(nextEntries);
      persistLibroData(metadata, nextEntries, characterOptions, true);
      setToastMsg(`Se firmaron ${count} fechas registradas en el Libro de Temas.`);
      setTimeout(() => setToastMsg(null), 3500);
    } else {
      setToastMsg('Todas las clases con contenidos ya están firmadas.');
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  // Agregar una fecha especial al Libro de Temas
  const handleAddCustomDate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomDate) return;

    const nextEntry: LibroDeTemasEntry = {
      date: newCustomDate,
      isHoliday: false,
      unitNumber: newCustomUnit || '1',
      contents: newCustomContents.trim(),
      classCharacter: newCustomCharacter || characterOptions[0] || 'Teórico - Práctica',
      observations: 'Clase / Mesa especial agregada al cronograma',
      teacherSignature: metadata.profTitular.trim() || '',
      authoritySignature: '',
      isCustomDate: true,
    };

    setEntriesMap((prev) => {
      const next = { ...prev, [newCustomDate]: nextEntry };
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });

    setShowAddDateModal(false);
    setNewCustomContents('');
    setToastMsg(`Fecha ${newCustomDate} agregada al Libro de Temas.`);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Eliminar fecha especial agregada manualmente o fecha fuera de los días habituales de cursada
  const handleDeleteCustomDate = (dateStr: string) => {
    setEntriesMap((prev) => {
      const next = { ...prev };
      delete next[dateStr];
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`${dateStr}__`)) delete next[k];
      });
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });
    setToastMsg(`Fila del ${dateStr} eliminada del Libro de Temas.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Borrar una fila fuera de horario o limpiar todos los datos cargados por error en una fila del calendario
  const handleDeleteOrClearRow = (row: ScheduledRow) => {
    const isOutOfSchedule = !activeWeekdays.includes(row.dow) || Boolean(row.entry.isCustomDate);
    if (isOutOfSchedule) {
      handleDeleteCustomDate(row.dateStr);
      return;
    }

    setEntriesMap((prev) => {
      const next = { ...prev };
      delete next[row.rowKey];
      if (row.slotIndex === 0) {
        delete next[row.dateStr];
      }
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });
    setToastMsg(
      `Se borraron los datos cargados en la fila del ${row.day}/${row.month}${
        row.timeLabel ? ` (${row.timeLabel})` : ''
      }.`
    );
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Filas que quedaron en días de semana que no pertenecen al horario actual del curso
  const outOfScheduleDates = useMemo(() => {
    const dates = new Set<string>();
    scheduledRows.forEach((r) => {
      if (!activeWeekdays.includes(r.dow) && !r.entry.isCustomDate) {
        dates.add(r.dateStr);
      }
    });
    return Array.from(dates);
  }, [scheduledRows, activeWeekdays]);

  const handleRemoveAllOutOfScheduleDates = () => {
    if (outOfScheduleDates.length === 0) return;
    setEntriesMap((prev) => {
      const next = { ...prev };
      outOfScheduleDates.forEach((dStr) => {
        delete next[dStr];
        Object.keys(next).forEach((k) => {
          if (k.startsWith(`${dStr}__`)) delete next[k];
        });
      });
      persistLibroData(metadata, next, characterOptions, true);
      return next;
    });
    setToastMsg(
      `Se eliminaron ${outOfScheduleDates.length} fecha(s) que no correspondían a los días actuales de cursada.`
    );
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Filtrado de filas para la tabla
  const filteredRows = useMemo(() => {
    return scheduledRows.filter((row) => {
      if (termFilter === '1c' && row.term !== '1c') return false;
      if (termFilter === '2c' && row.term !== '2c') return false;
      if (termFilter === 'until_today' && row.dateStr > todayStr) return false;

      const hasTopics = !row.entry.isHoliday && row.entry.contents.trim().length > 0;
      if (statusFilter === 'completed' && !hasTopics) return false;
      if (statusFilter === 'pending' && (row.entry.isHoliday || hasTopics)) return false;
      if (statusFilter === 'holidays' && !row.entry.isHoliday) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const dateFormatted = `${row.day}/${row.month}`;
        const match =
          row.entry.contents.toLowerCase().includes(q) ||
          row.entry.observations.toLowerCase().includes(q) ||
          row.entry.classCharacter.toLowerCase().includes(q) ||
          row.entry.unitNumber.toLowerCase().includes(q) ||
          (row.timeLabel && row.timeLabel.toLowerCase().includes(q)) ||
          row.computedClassNumber.toLowerCase().includes(q) ||
          dateFormatted.includes(q) ||
          row.dateStr.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [scheduledRows, termFilter, statusFilter, searchQuery, todayStr]);

  // "Clase de Hoy": avanza automáticamente según pasan los días del calendario,
  // independientemente de si el docente completó o no las clases anteriores.
  const todayClassRow = useMemo(() => {
    if (scheduledRows.length === 0) return null;
    const currentOrNext = scheduledRows.find((r) => r.dateStr >= todayStr);
    if (currentOrNext) return currentOrNext;
    return scheduledRows[scheduledRows.length - 1];
  }, [scheduledRows, todayStr]);

  // Todas las horas/módulos programados para la fecha seleccionada en "Clase de Hoy"
  const todayRows = useMemo(() => {
    if (!todayClassRow) return [];
    return scheduledRows.filter((r) => r.dateStr === todayClassRow.dateStr);
  }, [scheduledRows, todayClassRow]);

  // Fila activa que se muestra y edita en la tarjeta superior "Clase de Hoy"
  const activeTodayRow = useMemo(() => {
    if (todayRows.length === 0) return null;
    return todayRows[selectedTodaySlotIndex] || todayRows[0];
  }, [todayRows, selectedTodaySlotIndex]);

  // Estadísticas rápidas del Libro de Temas
  const stats = useMemo(() => {
    const totalScheduled = scheduledRows.length;
    const holidaysCount = scheduledRows.filter((r) => r.entry.isHoliday).length;
    const effectiveClasses = totalScheduled - holidaysCount;
    const completedClasses = scheduledRows.filter(
      (r) => !r.entry.isHoliday && r.entry.contents.trim().length > 0
    ).length;
    const classesUpToToday = scheduledRows.filter(
      (r) => !r.entry.isHoliday && r.dateStr <= todayStr
    ).length;
    const pendingUpToToday = scheduledRows.filter(
      (r) =>
        !r.entry.isHoliday &&
        r.dateStr <= todayStr &&
        r.entry.contents.trim().length === 0
    ).length;

    return {
      totalScheduled,
      holidaysCount,
      effectiveClasses,
      completedClasses,
      classesUpToToday,
      pendingUpToToday,
    };
  }, [scheduledRows, todayStr]);

  const activeWeekdaysLabel = useMemo(() => {
    return activeWeekdays.map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]).join(', ');
  }, [activeWeekdays]);

  const {
    pushLibroSnapshotToSheets,
    handleSyncWithSheets,
    handleOpenGoogleSheet,
    handleExportToGoogleDoc,
    handlePrintLibro,
    handleDownloadLibro,
    handleOpenOrDownloadBackup,
  } = useLibroDeTemasSync({
    courseId,
    courseName,
    driveFolderId,
    todayStr,
    metadata,
    entriesMap,
    setEntriesMap,
    characterOptions,
    scheduledRows,
    filteredRows,
    activeWeekdaysLabel,
    scheduleSummaryText,
    holidaysByDate,
    sheetInfo,
    setSheetInfo,
    isSyncingSheet,
    setIsSyncingSheet,
    setIsOpeningSheet,
    driveDocTitle,
    setIsExportingDoc,
    setExportedDocLink,
    setShowDriveConfirm,
    setToastMsg,
    onOpenBackupModal,
    persistLibroData,
  });

  return (
    <div className="space-y-4">
      {/* Notificación flotante / Toast */}
      {toastMsg && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in ${
            isDarkMode
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Banner de documento Google Doc (.gdoc) recién creado */}
      {exportedDocLink && (
        <div
          className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 animate-in fade-in ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
              : 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Libro de Temas guardado en Google Drive (.gdoc): </span>
              <span className="opacity-90">{exportedDocLink.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={exportedDocLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir y editar en Google Docs</span>
            </a>
            <button
              type="button"
              onClick={() => setExportedDocLink(null)}
              className="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <LibroDeTemasHeaderToolbar
        courseId={courseId}
        courseName={courseName}
        courseSchedule={courseSchedule}
        todayStr={todayStr}
        isDarkMode={isDarkMode}
        stats={stats}
        cloudStatus={cloudStatus}
        metadata={metadata}
        setMetadata={setMetadata}
        entriesMap={entriesMap}
        characterOptions={characterOptions}
        activeWeekdays={activeWeekdays}
        activeWeekdaysLabel={activeWeekdaysLabel}
        scheduleSummaryText={scheduleSummaryText}
        isEditingScheduleConfig={isEditingScheduleConfig}
        setIsEditingScheduleConfig={setIsEditingScheduleConfig}
        customScheduleInput={customScheduleInput}
        setCustomScheduleInput={setCustomScheduleInput}
        attendanceSettings={attendanceSettings}
        onUpdateAttendanceSettings={onUpdateAttendanceSettings}
        onRefreshCourse={onRefreshCourse}
        onOpenAttendanceSettingsModal={onOpenAttendanceSettingsModal}
        sheetInfo={sheetInfo}
        isOpeningSheet={isOpeningSheet}
        isSyncingSheet={isSyncingSheet}
        isExportingDoc={isExportingDoc}
        showDriveConfirm={showDriveConfirm}
        setShowDriveConfirm={setShowDriveConfirm}
        driveDocTitle={driveDocTitle}
        setDriveDocTitle={setDriveDocTitle}
        termFilter={termFilter}
        setTermFilter={setTermFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        scheduledRows={scheduledRows}
        handleSignAllCompletedClasses={handleSignAllCompletedClasses}
        setShowCharacterOptionsModal={setShowCharacterOptionsModal}
        setShowAddDateModal={setShowAddDateModal}
        handleOpenGoogleSheet={handleOpenGoogleSheet}
        handleSyncWithSheets={handleSyncWithSheets}
        handlePrintLibro={handlePrintLibro}
        handleDownloadLibro={handleDownloadLibro}
        handleOpenOrDownloadBackup={handleOpenOrDownloadBackup}
        handleExportToGoogleDoc={handleExportToGoogleDoc}
        handleMetadataChange={handleMetadataChange}
        handleToggleCourseWeekday={handleToggleCourseWeekday}
        persistLibroData={persistLibroData}
        setToastMsg={setToastMsg}
      />

      {activeTodayRow && (
        <LibroDeTemasTodayCard
          activeTodayRow={activeTodayRow}
          todayRows={todayRows}
          selectedTodaySlotIndex={selectedTodaySlotIndex}
          setSelectedTodaySlotIndex={setSelectedTodaySlotIndex}
          isDarkMode={isDarkMode}
          activeWeekdays={activeWeekdays}
          characterOptions={characterOptions}
          termFilter={termFilter}
          setTermFilter={setTermFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          todayRowRef={todayRowRef}
          handleOpenNoClassModal={handleOpenNoClassModal}
          handleDeleteOrClearRow={handleDeleteOrClearRow}
          setShowCharacterOptionsModal={setShowCharacterOptionsModal}
          updateEntryField={updateEntryField}
          handleSignRow={handleSignRow}
        />
      )}

      {/* Aviso si existen fechas cargadas en días que no coinciden con los días actuales de cursada */}
      {outOfScheduleDates.length > 0 && (
        <div
          className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-xs ${
            isDarkMode
              ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              Hay <strong>{outOfScheduleDates.length}</strong> fecha(s) en la tabla que no corresponden a tus días actuales de cursada (<strong>{activeWeekdaysLabel}</strong>). Podés borrarlas con el botón de papelera al final de la fila o quitar todas juntas.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRemoveAllOutOfScheduleDates}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-2xs transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar fechas fuera de horario ({outOfScheduleDates.length})</span>
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TABLA OFICIAL DEL LIBRO DE TEMAS (PÁGINA IZQUIERDA + PÁGINA DERECHA)  */}
      {/* ===================================================================== */}
      <div
        className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-300'
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              {/* Primera fila de encabezados (igual al libro físico) */}
              <tr
                className={`border-b text-[11px] font-extrabold uppercase tracking-wider ${
                  isDarkMode
                    ? 'bg-slate-800/95 border-slate-700 text-slate-200'
                    : 'bg-stone-100 border-neutral-300 text-neutral-800'
                }`}
              >
                <th
                  colSpan={3}
                  className={`py-2 px-2 text-center border-r ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  FECHA
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-2 text-center border-r w-20 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Clase
                  <br />
                  N°
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-2 text-center border-r w-20 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Unidad
                  <br />
                  N°
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-4 text-center border-r min-w-[320px] tracking-widest ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  CONTENIDOS
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-3 text-center border-r w-48 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>
                      Carácter de
                      <br />
                      la clase
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCharacterOptionsModal(true)}
                      className={`p-1 rounded-md border transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-700/70 border-slate-600 text-slate-300 hover:text-white'
                          : 'bg-white border-neutral-300 text-neutral-600 hover:text-blue-600'
                      }`}
                      title="Editar opciones del desplegable Carácter de la clase"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-3 text-center border-r min-w-[180px] ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  OBSERVACIONES
                </th>
                <th
                  rowSpan={2}
                  className={`py-2 px-2 text-center border-r w-32 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Firma del
                  <br />
                  Profesor
                </th>
                <th rowSpan={2} className="py-2 px-2 text-center w-32">
                  Firma de la
                  <br />
                  Autoridad
                </th>
              </tr>

              {/* Segunda fila de encabezados para Día | Mes | Horario */}
              <tr
                className={`border-b text-[10px] font-bold uppercase ${
                  isDarkMode
                    ? 'bg-slate-800/70 border-slate-700 text-slate-300'
                    : 'bg-stone-50 border-neutral-300 text-neutral-700'
                }`}
              >
                <th
                  className={`py-1.5 px-2 text-center border-r w-12 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Día
                </th>
                <th
                  className={`py-1.5 px-2 text-center border-r w-12 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Mes
                </th>
                <th
                  className={`py-1.5 px-2 text-center border-r w-28 ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-300'
                  }`}
                >
                  Horario
                </th>
              </tr>
            </thead>

            <tbody
              className={`divide-y ${
                isDarkMode ? 'divide-slate-800' : 'divide-neutral-200'
              }`}
            >
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 px-4 text-center text-neutral-400">
                    <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-semibold text-sm">
                      No hay clases que coincidan con el filtro seleccionado.
                    </p>
                    <p className="text-xs mt-1">
                      Verificá los días de cursada seleccionados arriba o cambiá el filtro de
                      período.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isHol = row.entry.isHoliday;
                  const isToday = todayClassRow?.dateStr === row.dateStr;
                  const isSelectedTodaySlot =
                    isToday && row.slotIndex === (selectedTodaySlotIndex || 0);
                  const isPastOrToday = row.dateStr <= todayStr;
                  const isEmptyPast =
                    isPastOrToday && !isHol && row.entry.contents.trim().length === 0;

                  const noClassPreset = NO_CLASS_PRESETS.find(
                    (p) => p.id === (row.entry.noClassCategory || 'feriado')
                  );
                  const noClassBadgeText = noClassPreset?.badgeLabel || 'Sin clase';

                  return (
                    <tr
                      key={row.rowKey}
                      ref={isSelectedTodaySlot ? todayRowRef : undefined}
                      className={`transition-colors group ${
                        isToday
                          ? isDarkMode
                            ? 'bg-blue-950/45 border-l-4 border-l-blue-500'
                            : 'bg-blue-50/85 border-l-4 border-l-blue-600'
                          : isHol
                          ? isDarkMode
                            ? 'bg-amber-950/15 text-amber-200/90'
                            : 'bg-amber-50/40 text-neutral-600'
                          : isDarkMode
                          ? 'hover:bg-slate-800/40'
                          : 'hover:bg-stone-50/80'
                      }`}
                    >
                      {/* COLUMNA 1A: DÍA */}
                      <td
                        className={`py-2 px-1.5 text-center font-mono font-bold border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="text-xs">{row.day}</span>
                          <span className="text-[9px] font-semibold uppercase opacity-60">
                            {row.weekdayShort}
                          </span>
                          {isToday && (
                            <span className="mt-0.5 px-1.5 py-0.2 rounded text-[8px] font-extrabold bg-blue-600 text-white tracking-wider shadow-2xs">
                              HOY
                            </span>
                          )}
                        </div>
                      </td>

                      {/* COLUMNA 1B: MES */}
                      <td
                        className={`py-2 px-1.5 text-center font-mono font-bold border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center">
                          <span className="text-xs">{row.month}</span>
                          <span className="text-[9px] opacity-50 font-sans">
                            {row.term === '1c' ? '1°C' : '2°C'}
                          </span>
                        </div>
                      </td>

                      {/* COLUMNA 1C: HORARIO / MÓDULO */}
                      <td
                        className={`py-2 px-1.5 text-center font-mono border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center leading-tight gap-0.5">
                          {row.timeLabel ? (
                            <>
                              <span className="text-[11px] font-bold text-neutral-800 dark:text-slate-200 whitespace-nowrap">
                                {row.timeLabel}
                              </span>
                              {row.totalSlotsForDay > 1 && (
                                <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400">
                                  {row.slotIndex + 1}° Hora
                                </span>
                              )}
                            </>
                          ) : row.totalSlotsForDay > 1 ? (
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                              {row.slotIndex + 1}° Hora
                            </span>
                          ) : !activeWeekdays.includes(row.dow) ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold ${
                                isDarkMode
                                  ? 'bg-red-950/70 text-red-300 border border-red-800/70'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                              title="Esta fecha no pertenece a los días habituales configurados en el curso"
                            >
                              Fuera de horario
                            </span>
                          ) : (
                            <span className="text-[10px] text-neutral-400">-</span>
                          )}
                        </div>
                      </td>

                      {/* COLUMNA 2: CLASE N° (Secuencial o "-" cuando no se dictó clase por feriado o evento) */}
                      <td
                        className={`py-2 px-1.5 text-center border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center gap-1">
                          <span
                            className={`text-xs font-extrabold font-mono ${
                              isHol
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-neutral-900 dark:text-white'
                            }`}
                          >
                            {row.computedClassNumber}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleOpenNoClassModal(row)}
                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-all cursor-pointer leading-tight ${
                              isHol
                                ? isDarkMode
                                  ? 'bg-amber-950/80 border-amber-800 text-amber-300 font-semibold'
                                  : 'bg-amber-100 border-amber-300 text-amber-800 font-semibold'
                                : 'opacity-70 group-hover:opacity-100 border-neutral-300 dark:border-slate-700 text-neutral-500 dark:text-slate-400 hover:border-amber-500 hover:text-amber-600'
                            }`}
                            title={
                              isHol
                                ? 'Día sin dictado de clases (Feriado, Acto, Mocks, Exámenes Internacionales, Deportes, etc.). Clic para editar la razón o volver a clase normal.'
                                : 'Marcar día sin dictado de clase (Feriado, Acto, Mocks, Exámenes Internacionales, Deportes, etc.) y escribir la razón'
                            }
                          >
                            {isHol ? noClassBadgeText : 'Sin clase / Evento'}
                          </button>
                        </div>
                      </td>

                      {/* COLUMNA 3: UNIDAD N° */}
                      <td
                        className={`py-2 px-1.5 text-center border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        {isHol ? (
                          <span className="font-mono font-bold text-neutral-400">-</span>
                        ) : (
                          <input
                            type="text"
                            value={row.entry.unitNumber}
                            placeholder={row.suggestedUnit || '1'}
                            onChange={(e) =>
                              updateEntryField(row.rowKey, (curr) => ({
                                ...curr,
                                unitNumber: e.target.value,
                              }))
                            }
                            onFocus={() => {
                              if (!row.entry.unitNumber && row.suggestedUnit) {
                                updateEntryField(row.rowKey, (curr) => ({
                                  ...curr,
                                  unitNumber: row.suggestedUnit,
                                }));
                              }
                            }}
                            className={`w-12 px-1.5 py-1 text-center font-bold rounded-md border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                              isDarkMode
                                ? 'bg-slate-800/80 border-slate-700 text-white placeholder:text-slate-600'
                                : 'bg-white border-neutral-200 text-neutral-900 placeholder:text-neutral-300'
                            }`}
                          />
                        )}
                      </td>

                      {/* COLUMNA 4: CONTENIDOS (O RAZÓN POR LA CUAL NO SE DIO LA CLASE) */}
                      <td
                        className={`py-2 px-2.5 border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <div className="relative">
                          <textarea
                            rows={row.entry.contents.length > 95 ? 2 : 1}
                            value={row.entry.contents}
                            placeholder={
                              isHol
                                ? 'Escribir motivo por el cual no se dictó la clase (Feriado, Acto, Mocks, Deportes...)'
                                : isEmptyPast
                                ? 'Escribir contenidos dictados en esta clase...'
                                : 'Contenidos de la clase...'
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              updateEntryField(row.rowKey, (curr) => ({
                                ...curr,
                                contents: val,
                                noClassReason: curr.isHoliday ? val : curr.noClassReason,
                                // Auto-completar Unidad y Carácter si el docente empieza a escribir en una clase normal vacía
                                unitNumber:
                                  !curr.isHoliday && !curr.unitNumber && val.trim()
                                    ? row.suggestedUnit || '1'
                                    : curr.unitNumber,
                                classCharacter:
                                  !curr.isHoliday && !curr.classCharacter && val.trim()
                                    ? characterOptions[0] || 'Teórico - Práctica'
                                    : curr.classCharacter,
                              }));
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-lg border text-xs resize-y leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                              isHol
                                ? isDarkMode
                                  ? 'bg-amber-950/30 border-amber-800/60 text-amber-200 font-semibold italic'
                                  : 'bg-amber-50/70 border-amber-200 text-amber-900 font-semibold italic'
                                : isEmptyPast
                                ? isDarkMode
                                  ? 'bg-slate-800/90 border-amber-700/60 text-white placeholder:text-amber-400/60'
                                  : 'bg-amber-50/20 border-amber-300 text-neutral-900 placeholder:text-amber-700/60'
                                : isDarkMode
                                ? 'bg-slate-800/70 border-slate-700/80 text-white placeholder:text-slate-500'
                                : 'bg-white border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
                            }`}
                          />
                        </div>
                      </td>

                      {/* COLUMNA 5: CARÁCTER DE LA CLASE (CON OPCIONES EDITABLES POR EL DOCENTE) */}
                      <td
                        className={`py-2 px-2 border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        {isHol ? (
                          <div className="text-center font-mono font-bold text-neutral-400">-</div>
                        ) : (
                          <select
                            value={row.entry.classCharacter || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__EDIT_CHARACTER_OPTIONS__') {
                                setShowCharacterOptionsModal(true);
                                return;
                              }
                              updateEntryField(row.rowKey, (curr) => ({
                                ...curr,
                                classCharacter: val,
                              }));
                            }}
                            className={`w-full px-2 py-1.5 rounded-lg border text-xs font-medium text-center focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                              isDarkMode
                                ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                                : 'bg-white border-neutral-200 text-neutral-800'
                            }`}
                          >
                            <option value="">Seleccionar...</option>
                            {/* Si la fila tiene un valor personalizado que aún no está en characterOptions, mostrarlo */}
                            {row.entry.classCharacter &&
                              !characterOptions.includes(row.entry.classCharacter) && (
                                <option value={row.entry.classCharacter}>
                                  {row.entry.classCharacter}
                                </option>
                              )}
                            {characterOptions.map((preset) => (
                              <option key={preset} value={preset}>
                                {preset}
                              </option>
                            ))}
                            <option value="__EDIT_CHARACTER_OPTIONS__">
                              ⚙️ Editar / agregar opciones...
                            </option>
                          </select>
                        )}
                      </td>

                      {/* COLUMNA 6: OBSERVACIONES */}
                      <td
                        className={`py-2 px-2 border-r align-middle ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        <input
                          type="text"
                          value={row.entry.observations}
                          placeholder="Observaciones..."
                          onChange={(e) =>
                            updateEntryField(row.rowKey, (curr) => ({
                              ...curr,
                              observations: e.target.value,
                            }))
                          }
                          className={`w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                            isDarkMode
                              ? 'bg-slate-800/60 border-slate-700/80 text-slate-200 placeholder:text-slate-600'
                              : 'bg-white border-neutral-200 text-neutral-800 placeholder:text-neutral-300'
                          }`}
                        />
                      </td>

                      {/* COLUMNA 7: FIRMA DEL PROFESOR */}
                      <td
                        className={`py-2 px-2 border-r align-middle text-center ${
                          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
                        }`}
                      >
                        {row.entry.teacherSignature ? (
                          <div className="flex items-center justify-center gap-1">
                            <span
                              onClick={() => handleSignRow(row.rowKey)}
                              className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 text-[11px] font-serif italic cursor-pointer hover:bg-red-500/10 hover:text-red-500"
                              title="Clic para quitar firma"
                            >
                              {row.entry.teacherSignature}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSignRow(row.rowKey)}
                            className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                              isDarkMode
                                ? 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'
                                : 'border-neutral-200 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
                            }`}
                            title="Firmar esta clase con tus datos de Profesor Titular"
                          >
                            Firmar
                          </button>
                        )}
                      </td>

                      {/* COLUMNA 8: FIRMA DE LA AUTORIDAD + ACCIÓN BORRAR/LIMPIAR FILA */}
                      <td className="py-2 px-2 align-middle text-center">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={row.entry.authoritySignature}
                            placeholder="Visado..."
                            onChange={(e) =>
                              updateEntryField(row.rowKey, (curr) => ({
                                ...curr,
                                authoritySignature: e.target.value,
                              }))
                            }
                            className={`w-full px-2 py-1 rounded-md border text-[11px] text-center focus:outline-hidden ${
                              isDarkMode
                                ? 'bg-slate-800/40 border-slate-700/70 text-slate-300 placeholder:text-slate-600'
                                : 'bg-white border-neutral-200 text-neutral-700 placeholder:text-neutral-300'
                            }`}
                          />
                          {(!activeWeekdays.includes(row.dow) ||
                            row.entry.isCustomDate ||
                            Boolean(
                              row.entry.contents.trim() ||
                                row.entry.unitNumber.trim() ||
                                row.entry.classCharacter.trim() ||
                                row.entry.observations.trim() ||
                                row.entry.teacherSignature.trim() ||
                                row.entry.authoritySignature.trim() ||
                                row.entry.isHoliday
                            )) && (
                            <button
                              type="button"
                              onClick={() => handleDeleteOrClearRow(row)}
                              className={`p-1.5 rounded-md border transition-colors cursor-pointer shrink-0 ${
                                !activeWeekdays.includes(row.dow) || row.entry.isCustomDate
                                  ? isDarkMode
                                    ? 'bg-red-950/60 border-red-800 text-red-300 hover:bg-red-900'
                                    : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                                  : isDarkMode
                                  ? 'border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-800 hover:bg-red-950/40'
                                  : 'border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50'
                              }`}
                              title={
                                !activeWeekdays.includes(row.dow) || row.entry.isCustomDate
                                  ? 'Eliminar esta fila fuera del horario habitual de cursada'
                                  : 'Borrar / limpiar los datos cargados en esta fila'
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LibroDeTemasModals
        isDarkMode={isDarkMode}
        noClassModalRow={noClassModalRow}
        setNoClassModalRow={setNoClassModalRow}
        handleConfirmNoClassReason={handleConfirmNoClassReason}
        handleRevertToNormalClass={handleRevertToNormalClass}
        showCharacterOptionsModal={showCharacterOptionsModal}
        setShowCharacterOptionsModal={setShowCharacterOptionsModal}
        characterOptions={characterOptions}
        newCharacterOptionText={newCharacterOptionText}
        setNewCharacterOptionText={setNewCharacterOptionText}
        editingOptionIndex={editingOptionIndex}
        setEditingOptionIndex={setEditingOptionIndex}
        editingOptionValue={editingOptionValue}
        setEditingOptionValue={setEditingOptionValue}
        handleAddCharacterOption={handleAddCharacterOption}
        handleSaveEditedCharacterOption={handleSaveEditedCharacterOption}
        handleDeleteCharacterOption={handleDeleteCharacterOption}
        handleRestoreDefaultCharacterOptions={handleRestoreDefaultCharacterOptions}
        showAddDateModal={showAddDateModal}
        setShowAddDateModal={setShowAddDateModal}
        newCustomDate={newCustomDate}
        setNewCustomDate={setNewCustomDate}
        newCustomUnit={newCustomUnit}
        setNewCustomUnit={setNewCustomUnit}
        newCustomCharacter={newCustomCharacter}
        setNewCustomCharacter={setNewCustomCharacter}
        newCustomContents={newCustomContents}
        setNewCustomContents={setNewCustomContents}
        handleAddCustomDate={handleAddCustomDate}
      />
    </div>
  );
};

