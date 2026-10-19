import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Database,
  Download,
  Edit2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Lock,
  Loader2,
  Pencil,
  PenTool,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  Unlock,
  X,
  AlertCircle,
  Cloud,
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
import { driveService } from '../../services/workspace/driveService';
import {
  getCachedAccessToken,
  requestGoogleAccessToken,
  isValidGoogleAccessToken,
} from '../../services/workspace/googleAuth';
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
      horario: courseSchedule || 'Sin horario especificado',
      folioNumero: '1',
      configuredWeekdays: initialWeekdays,
      isScheduleLocked: Boolean(courseSchedule && courseSchedule.trim().length > 0),
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

          const loadedMeta: LibroDeTemasMetadata = {
            asignatura: parsed.metadata.asignatura || defaultMetadata.asignatura,
            profTitular: parsed.metadata.profTitular || defaultMetadata.profTitular,
            horario:
              courseSchedule ||
              (parsed.metadata.horario &&
              parsed.metadata.horario !== 'Sin horario especificado'
                ? parsed.metadata.horario
                : defaultMetadata.horario),
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

            const mergedMeta: LibroDeTemasMetadata = {
              asignatura: cloudData.metadata.asignatura || defaultMetadata.asignatura,
              profTitular: cloudData.metadata.profTitular || defaultMetadata.profTitular,
              horario: courseSchedule || cloudData.metadata.horario || defaultMetadata.horario,
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
    if (!courseSchedule) return;
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

    // Agregar cualquier fecha personalizada guardada en entriesMap
    Object.keys(entriesMap).forEach((dStr) => {
      if (entriesMap[dStr]?.isCustomDate || !dateSet.has(dStr)) {
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

  // Eliminar fecha especial agregada manualmente
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

  // Construcción del HTML oficial del Libro de Temas para exportar a Google Docs (.gdoc) o imprimir
  const buildOfficialLibroDeTemasHtml = () => {
    const rowsHtml = filteredRows
      .map((row) => {
        const isHol = row.entry.isHoliday;
        const bgRow = isHol ? '#f8fafc' : '#ffffff';
        const textStyle = isHol ? 'color:#475569;font-style:italic;' : 'color:#0f172a;';
        return `<tr style="background-color:${bgRow};${textStyle}">
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:36px;">${row.day}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:36px;">${row.month}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-family:monospace;font-size:8.5pt;width:80px;">${row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-')}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:54px;">${row.computedClassNumber}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;width:58px;">${
            isHol ? '-' : row.entry.unitNumber || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 8px;text-align:left;width:340px;">${
            (row.entry.contents || '').replace(/\n/g, '<br/>')
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;width:120px;">${
            isHol ? '-' : row.entry.classCharacter || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 8px;text-align:left;width:160px;">${
            (row.entry.observations || '').replace(/\n/g, '<br/>')
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;font-style:italic;width:95px;">${
            row.entry.teacherSignature || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;width:95px;">${
            row.entry.authoritySignature || ''
          }</td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Libro de Temas - ${metadata.asignatura}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:20px;font-size:10pt;">
  <!-- ENCABEZADO OFICIAL DEL LIBRO DE TEMAS -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:2px solid #0f172a;">
    <tr>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:40%;font-size:10.5pt;">
        <strong>ASIGNATURA:</strong> ${metadata.asignatura}
      </td>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:30%;font-size:10.5pt;">
        <strong>PROF. TITULAR:</strong> ${metadata.profTitular}
      </td>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:30%;font-size:10.5pt;">
        <strong>DÍAS DE CLASE:</strong> ${activeWeekdaysLabel}${scheduleSummaryText ? ` (${scheduleSummaryText})` : ''}
      </td>
    </tr>
  </table>

  <!-- TABLA OFICIAL DEL LIBRO DE TEMAS -->
  <table style="width:100%;border-collapse:collapse;border:2px solid #0f172a;font-size:9.5pt;">
    <thead>
      <tr style="background-color:#e2e8f0;color:#0f172a;">
        <th colspan="3" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">FECHA</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Clase<br/>N°</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Unidad<br/>N°</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 8px;text-align:center;font-weight:bold;letter-spacing:1px;">CONTENIDOS</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 6px;text-align:center;font-weight:bold;">Carácter de<br/>la clase</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 8px;text-align:center;font-weight:bold;letter-spacing:0.5px;">OBSERVACIONES</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Firma del<br/>Profesor</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Firma de la<br/>Autoridad</th>
      </tr>
      <tr style="background-color:#f1f5f9;color:#0f172a;">
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Día</th>
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Mes</th>
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Hora</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
  };

  // Exportar a Google Drive como Google Doc nativo (.gdoc)
  const handleExportToGoogleDoc = async () => {
    setIsExportingDoc(true);
    try {
      const htmlContent = buildOfficialLibroDeTemasHtml();
      const docName =
        driveDocTitle.trim() ||
        `Libro de Temas - ${courseName} (${todayStr})`;

      let targetFolderId = driveFolderId;
      if (!targetFolderId) {
        const structure = await driveService.ensureCourseFolderStructure(courseName);
        targetFolderId = structure.mainFolder.id;
      }

      const uploaded = await driveService.uploadReportFile(
        docName,
        htmlContent,
        targetFolderId,
        true // Convert to editable Google Doc (.gdoc)
      );

      if (uploaded) {
        const editUrl = uploaded.url.includes('drive.google.com/my-drive')
          ? uploaded.url
          : `https://docs.google.com/document/d/${uploaded.id}/edit`;
        setExportedDocLink({ url: editUrl, name: uploaded.name });
        setShowDriveConfirm(false);
        setToastMsg(
          'Libro de Temas exportado a Google Drive como documento editable (.gdoc).'
        );
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (_) {
      setToastMsg('No se pudo exportar el Libro de Temas a Google Drive.');
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setIsExportingDoc(false);
    }
  };

  // Imprimir folio oficial en formato horizontal
  const handlePrintLibro = () => {
    const html = buildOfficialLibroDeTemasHtml();
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(
        html.replace(
          '</head>',
          `<style>@page { size: A4 landscape; margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style></head>`
        )
      );
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    }
  };

  // Crear o sincronizar el Libro de Temas con Google Sheets en la carpeta de Drive de la materia
  const handleSyncWithSheets = async (openAfterSync = false) => {
    if (isSyncingSheet) return;
    setIsSyncingSheet(true);
    if (openAfterSync) setIsOpeningSheet(true);

    try {
      let token = getCachedAccessToken();
      if (!token || !isValidGoogleAccessToken(token)) {
        try {
          token = await requestGoogleAccessToken();
        } catch (_) {}
      }

      if (!token || !isValidGoogleAccessToken(token)) {
        setToastMsg(
          'Se requiere autorización de tu cuenta de Google para crear y sincronizar la hoja en Google Sheets.'
        );
        setTimeout(() => setToastMsg(null), 4000);
        return;
      }

      const tabName = 'Libro de Temas';
      const sheetTitle = `📖 Libro de Temas - ${courseName}`;
      let targetSpreadsheetId =
        sheetInfo?.spreadsheetId && isRealGoogleSpreadsheetId(sheetInfo.spreadsheetId)
          ? sheetInfo.spreadsheetId
          : undefined;

      let workingEntries = { ...entriesMap };
      let pulledChangesCount = 0;

      // 1. Doble entrada (Pull): Si ya existe la hoja de Google Sheets, leer cambios hechos por el docente en Sheets
      if (targetSpreadsheetId) {
        try {
          const range = encodeURIComponent(`'${tabName}'!A4:I500`);
          const getRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${range}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (getRes.ok) {
            const data = await getRes.json();
            const sheetRows: any[][] = data.values || [];

            sheetRows.forEach((r) => {
              const dateIso = String(r[0] || '').trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return;

              const unitCell = String(r[3] ?? '').trim();
              const contentsCell = String(r[4] ?? '').trim();
              const characterCell = String(r[5] ?? '').trim();
              const obsCell = String(r[6] ?? '').trim();
              const profSigCell = String(r[7] ?? '').trim();
              const authSigCell = String(r[8] ?? '').trim();

              const existing = workingEntries[dateIso] || {
                date: dateIso,
                isHoliday: Boolean(holidaysByDate[dateIso]),
                holidayName: holidaysByDate[dateIso]?.name,
                unitNumber: holidaysByDate[dateIso] ? '-' : '1',
                contents: holidaysByDate[dateIso]
                  ? `Feriado: ${holidaysByDate[dateIso].name}`
                  : '',
                classCharacter: holidaysByDate[dateIso]
                  ? '-'
                  : characterOptions[0] || 'Teórico - Práctica',
                observations: '',
                teacherSignature: '',
                authoritySignature: '',
              };

              let rowChanged = false;
              const updatedEntry = { ...existing };

              if (!existing.isHoliday) {
                if (unitCell && unitCell !== '-' && unitCell !== existing.unitNumber) {
                  updatedEntry.unitNumber = unitCell;
                  rowChanged = true;
                }
                if (contentsCell !== existing.contents && contentsCell !== '') {
                  updatedEntry.contents = contentsCell;
                  rowChanged = true;
                }
                if (characterCell && characterCell !== '-' && characterCell !== existing.classCharacter) {
                  updatedEntry.classCharacter = characterCell;
                  rowChanged = true;
                }
              }

              if (obsCell !== existing.observations && obsCell !== '') {
                updatedEntry.observations = obsCell;
                rowChanged = true;
              }
              if (profSigCell !== existing.teacherSignature && profSigCell !== '') {
                updatedEntry.teacherSignature = profSigCell;
                rowChanged = true;
              }
              if (authSigCell !== existing.authoritySignature && authSigCell !== '') {
                updatedEntry.authoritySignature = authSigCell;
                rowChanged = true;
              }

              if (rowChanged) {
                workingEntries[dateIso] = updatedEntry;
                pulledChangesCount++;
              }
            });

            if (pulledChangesCount > 0) {
              setEntriesMap(workingEntries);
            }
          } else if (getRes.status === 404) {
            targetSpreadsheetId = undefined;
          }
        } catch (_) {}
      }

      // 2. Si no existe aún el Google Sheet para el Libro de Temas de esta materia, crearlo dentro de la carpeta de Drive de la materia
      if (!targetSpreadsheetId) {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [
              {
                properties: {
                  title: tabName,
                  gridProperties: {
                    rowCount: Math.max(120, scheduledRows.length + 20),
                    columnCount: 10,
                    frozenRowCount: 3,
                  },
                },
              },
            ],
          }),
        });

        if (!createRes.ok) {
          throw new Error('No se pudo crear la hoja de Google Sheets');
        }

        const createdData = await createRes.json();
        targetSpreadsheetId = createdData.spreadsheetId;

        // Asegurar la estructura de carpetas de la materia en Google Drive y mover el Sheet allí
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            courseName,
            driveFolderId,
            token
          );
          const targetFolderToMove =
            folderStruct.libroDeTemasFolder?.id ||
            folderStruct.mainFolder?.id ||
            driveFolderId;

          if (targetFolderToMove && !targetFolderToMove.startsWith('folder-') && !targetFolderToMove.startsWith('f-')) {
            await driveService.moveFileToFolder(targetSpreadsheetId!, targetFolderToMove, token);
          }

          if (folderStruct.mainFolder?.id && !folderStruct.mainFolder.id.startsWith('folder-')) {
            api
              .updateCourse(courseId, {
                driveFolderId: folderStruct.mainFolder.id,
                driveFolderUrl: folderStruct.mainFolder.url,
              })
              .catch(() => {});
          }
        } catch (folderErr) {
          console.warn('Error ubicando Sheet de Libro de Temas en carpeta de Drive:', folderErr);
        }
      }

      // 3. Construir las filas actualizadas para escribir en el Sheet
      const nowStr = `${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`;
      const metaRow = [
        'ASIGNATURA:',
        metadata.asignatura,
        'PROF. TITULAR:',
        metadata.profTitular,
        'DÍAS DE CLASE:',
        activeWeekdaysLabel,
        'ÚLTIMA SINCRONIZACIÓN:',
        nowStr,
        '',
      ];
      const emptyRow = ['', '', '', '', '', '', '', '', '', ''];
      const headerRow = [
        'Fecha (ISO)',
        'FECHA (Día / Mes)',
        'Horario / Módulo',
        'Clase N°',
        'Unidad N°',
        'CONTENIDOS',
        'Carácter de la clase',
        'OBSERVACIONES',
        'Firma del Profesor',
        'Firma de la Autoridad',
      ];

      const dataRows = scheduledRows.map((row) => {
        const entry = workingEntries[row.rowKey] || workingEntries[row.dateStr] || row.entry;
        const isHol = Boolean(entry.isHoliday);
        return [
          row.dateStr,
          `${row.day}/${row.month}`,
          row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-'),
          row.computedClassNumber,
          isHol ? '-' : entry.unitNumber || '',
          entry.contents || '',
          isHol ? '-' : entry.classCharacter || '',
          entry.observations || '',
          entry.teacherSignature || '',
          entry.authoritySignature || '',
        ];
      });

      // Limpiar rango previo y actualizar valores
      try {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1:Z600`)}:clear`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      } catch (_) {}

      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [metaRow, emptyRow, headerRow, ...dataRows],
          }),
        }
      );

      if (updateRes.ok && targetSpreadsheetId) {
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
        const nextSheetInfo: LibroDeTemasSheetInfo = {
          spreadsheetId: targetSpreadsheetId,
          url: sheetUrl,
          lastSyncedAt: new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setSheetInfo(nextSheetInfo);
        persistLibroData(metadata, workingEntries, characterOptions, true, nextSheetInfo);

        if (openAfterSync) {
          window.open(sheetUrl, '_blank', 'noopener,noreferrer');
        }

        setToastMsg(
          pulledChangesCount > 0
            ? `¡Sincronizado con Google Sheets! Se incorporaron ${pulledChangesCount} cambio(s) desde Sheets.`
            : '¡Libro de Temas sincronizado con Google Sheets en la carpeta de Drive de la materia!'
        );
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (err) {
      console.warn('Error sincronizando Libro de Temas con Google Sheets:', err);
      setToastMsg('No se pudo sincronizar con Google Sheets. Verificá tu conexión de Google.');
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setIsSyncingSheet(false);
      setIsOpeningSheet(false);
    }
  };

  // Abrir directamente la planilla en Google Sheets (o crearla en la carpeta de la materia si aún no existe)
  const handleOpenGoogleSheet = async () => {
    if (sheetInfo?.spreadsheetId && isRealGoogleSpreadsheetId(sheetInfo.spreadsheetId)) {
      const url =
        sheetInfo.url || `https://docs.google.com/spreadsheets/d/${sheetInfo.spreadsheetId}/edit`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await handleSyncWithSheets(true);
  };

  // Copia de seguridad (abre el modal general del curso o descarga respaldo JSON directo)
  const handleOpenOrDownloadBackup = () => {
    if (onOpenBackupModal) {
      onOpenBackupModal();
      return;
    }
    try {
      const payload = {
        app: 'Docenc.IA',
        version: '2.0',
        exportDate: new Date().toISOString(),
        course: { id: courseId, name: courseName },
        libroDeTemas: {
          metadata,
          entries: entriesMap,
          characterOptions,
          sheetInfo,
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Respaldo_LibroDeTemas_${courseName.replace(/\s+/g, '_')}_${todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {}
  };

  // Descargar Libro de Temas en formato Excel (.xlsx)
  const handleDownloadLibro = () => {
    try {
      const wb = XLSX.utils.book_new();
      const aoa: any[][] = [
        [
          'ASIGNATURA:',
          metadata.asignatura,
          '',
          'PROF. TITULAR:',
          metadata.profTitular,
          '',
          'DÍAS DE CLASE:',
          activeWeekdaysLabel,
          '',
        ],
        [],
        [
          'Día',
          'Mes',
          'Clase N°',
          'Unidad N°',
          'CONTENIDOS',
          'Carácter de la clase',
          'OBSERVACIONES',
          'Firma del Profesor',
          'Firma de la Autoridad',
        ],
        ...filteredRows.map((row) => {
          const isHol = Boolean(row.entry.isHoliday);
          return [
            row.day,
            row.month,
            row.computedClassNumber,
            isHol ? '-' : row.entry.unitNumber || '',
            row.entry.contents || '',
            isHol ? '-' : row.entry.classCharacter || '',
            row.entry.observations || '',
            row.entry.teacherSignature || '',
            row.entry.authoritySignature || '',
          ];
        }),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 6 },
        { wch: 10 },
        { wch: 10 },
        { wch: 48 },
        { wch: 22 },
        { wch: 28 },
        { wch: 20 },
        { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Libro de Temas');

      const safeCourse = courseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      XLSX.writeFile(wb, `Libro_de_Temas_${safeCourse}_${todayStr}.xlsx`);

      setToastMsg('Libro de Temas descargado en formato Excel (.xlsx).');
      setTimeout(() => setToastMsg(null), 3500);
    } catch (err) {
      console.warn('Error descargando Libro de Temas:', err);
    }
  };

  const activeWeekdaysLabel = useMemo(() => {
    return activeWeekdays.map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]).join(', ');
  }, [activeWeekdays]);

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

      {/* ===================================================================== */}
      {/* ENCABEZADO OFICIAL DEL FOLIO (ASIGNATURA / PROF. TITULAR / DÍAS)      */}
      {/* ===================================================================== */}
      <div
        className={`rounded-xl border overflow-hidden shadow-2xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        {/* Encabezado: Título arriba y las 3 columnas de opciones debajo */}
        <div
          className={`p-3 sm:p-4 border-b flex flex-col gap-3.5 min-w-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-stone-50 border-neutral-200'
          }`}
        >
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/20 shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-white tracking-tight">
                Libro de Temas Oficial
              </h3>
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-bold border max-w-full truncate ${
                  isDarkMode
                    ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                    : 'bg-blue-50 border-blue-200 text-blue-700'
                }`}
              >
                {stats.completedClasses} / {stats.effectiveClasses} clases registradas
              </span>
              {stats.holidaysCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border max-w-full truncate ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-300'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  {stats.holidaysCount} sin dictado (feriados / eventos)
                </span>
              )}
              {stats.pendingUpToToday > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold border max-w-full truncate ${
                    isDarkMode
                      ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                >
                  {stats.pendingUpToToday} pendiente{stats.pendingUpToToday === 1 ? '' : 's'}{' '}
                  hasta hoy
                </span>
              )}
              <span
                className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                  cloudStatus.state === 'syncing'
                    ? isDarkMode
                      ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                      : 'bg-blue-50 border-blue-200 text-blue-700'
                    : cloudStatus.state === 'offline'
                    ? isDarkMode
                      ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                    : isDarkMode
                    ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}
                title="Todo cambio que escribas en el Libro de Temas se guarda automáticamente en el dispositivo y en tu cuenta en la nube"
              >
                <Cloud className={`w-3 h-3 shrink-0 ${cloudStatus.state === 'syncing' ? 'animate-pulse' : ''}`} />
                <span>
                  {cloudStatus.state === 'syncing'
                    ? 'Guardando cambios...'
                    : cloudStatus.state === 'offline'
                    ? 'Guardado local (sin red)'
                    : `✓ Guardado automático${cloudStatus.lastSyncedAt ? ` (${cloudStatus.lastSyncedAt})` : ''}`}
                </span>
              </span>
            </div>
          </div>

          {/* 3 Columnas de Opciones debajo del título y arriba de Asignatura, Prof. Titular, etc. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 w-full min-w-0 pt-2 border-t border-neutral-200/70 dark:border-slate-800">
            {/* COLUMNA 1: Firmar clases cargadas, Opciones de carácter y Agregar Fecha */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <button
                type="button"
                onClick={handleSignAllCompletedClasses}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Estampar la firma del profesor en todas las clases que ya tienen contenidos cargados"
              >
                <PenTool className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="truncate">Firmar clases cargadas</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCharacterOptionsModal(true)}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Personalizar las opciones del desplegable Carácter de la clase"
              >
                <Settings className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="truncate">Opciones de carácter</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAddDateModal(true)}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Agregar una fecha especial o clase adicional fuera de los días habituales"
              >
                <Plus className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate">Agregar Fecha</span>
              </button>
            </div>

            {/* COLUMNA 2: Abrir Sheets, Sincronizar Sheets y Guardar Drive */}
            <div className="flex flex-col gap-1.5 min-w-0 sm:border-l sm:pl-2.5 border-neutral-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleOpenGoogleSheet}
                disabled={isOpeningSheet || isSyncingSheet}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Abrir o crear la planilla del Libro de Temas en Google Sheets dentro de la carpeta de Drive de la materia"
              >
                {isOpeningSheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500 shrink-0" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                )}
                <span className="truncate">Abrir Sheets</span>
              </button>

              <button
                type="button"
                onClick={() => handleSyncWithSheets(false)}
                disabled={isSyncingSheet}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                  isDarkMode
                    ? 'bg-blue-950/60 hover:bg-blue-900/70 text-blue-300 border-blue-800'
                    : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
                }`}
                title="Sincronizar Libro de Temas con Google Sheets en la carpeta de Drive de la materia (doble entrada)"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-blue-500 shrink-0 ${
                    isSyncingSheet ? 'animate-spin' : ''
                  }`}
                />
                <span className="truncate">
                  {isSyncingSheet ? 'Sincronizando...' : 'Sincronizar Sheets'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDriveDocTitle(`Libro de Temas - ${courseName} (${todayStr})`);
                  setShowDriveConfirm((prev) => !prev);
                }}
                disabled={isExportingDoc}
                className="w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                title="Guardar el Libro de Temas directamente en Google Drive como documento editable (.gdoc)"
              >
                {isExportingDoc ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Save className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">Guardar Drive</span>
              </button>
            </div>

            {/* COLUMNA 3: Imprimir, Descargar y Copia de Seguridad */}
            <div className="flex flex-col gap-1.5 min-w-0 sm:col-span-2 lg:col-span-1 lg:border-l lg:pl-2.5 border-neutral-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handlePrintLibro}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Imprimir folio del Libro de Temas en formato horizontal"
              >
                <Printer className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">Imprimir</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadLibro}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                }`}
                title="Descargar Libro de Temas en formato Excel (.xlsx)"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">Descargar</span>
              </button>

              <button
                type="button"
                onClick={handleOpenOrDownloadBackup}
                className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-900/60 hover:border-indigo-700'
                    : 'bg-white hover:bg-indigo-50/60 text-indigo-700 border-indigo-200'
                }`}
                title="Copia de seguridad local: Descargar respaldo o restaurar Libro de Temas y datos del curso"
              >
                <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="truncate">Copia de Seguridad</span>
              </button>
            </div>
          </div>
        </div>

        {/* Panel de confirmación para Guardar en Drive (.gdoc) */}
        {showDriveConfirm && (
          <div
            className={`px-3 sm:px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0 animate-in fade-in ${
              isDarkMode
                ? 'bg-emerald-950/30 border-emerald-800/60'
                : 'bg-emerald-50/70 border-emerald-200'
            }`}
          >
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 shrink-0">
                Nombre del Google Doc (.gdoc):
              </span>
              <input
                type="text"
                value={driveDocTitle}
                onChange={(e) => setDriveDocTitle(e.target.value)}
                className={`flex-1 min-w-0 px-3 py-1.5 rounded-lg border text-xs font-medium focus:outline-hidden ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white'
                    : 'bg-white border-emerald-300 text-neutral-900'
                }`}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleExportToGoogleDoc}
                disabled={isExportingDoc}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
              >
                {isExportingDoc ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Crear .gdoc ahora</span>
              </button>
              <button
                type="button"
                onClick={() => setShowDriveConfirm(false)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-700 dark:text-slate-400 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Campos del Encabezado del Libro de Temas: ASIGNATURA, PROF. TITULAR, DÍAS DE CLASE y CALENDARIO ESCOLAR Y FERIADOS */}
        <div
          className={`p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3 border-b min-w-0 ${
            isDarkMode
              ? 'bg-slate-900/90 border-slate-800'
              : 'bg-amber-50/20 border-neutral-200'
          }`}
        >
          <div className="sm:col-span-1 xl:col-span-3 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              ASIGNATURA:
            </label>
            <input
              type="text"
              value={metadata.asignatura}
              onChange={(e) => handleMetadataChange('asignatura', e.target.value)}
              placeholder="Ej: Historia 2° Año"
              className={`w-full min-w-0 px-3 py-1.5 rounded-lg border text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'bg-white border-neutral-300 text-neutral-900'
              }`}
            />
          </div>

          <div className="sm:col-span-1 xl:col-span-3 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              PROF. TITULAR:
            </label>
            <input
              type="text"
              value={metadata.profTitular}
              onChange={(e) => handleMetadataChange('profTitular', e.target.value)}
              placeholder="Nombre y Apellido del docente"
              className={`w-full min-w-0 px-3 py-1.5 rounded-lg border text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'bg-white border-neutral-300 text-neutral-900'
              }`}
            />
          </div>

          <div className="sm:col-span-2 xl:col-span-6 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              DÍAS DE CLASE:
            </label>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <div className="flex-1 min-w-[200px] max-w-full">
                {!isEditingScheduleConfig ? (
                  <div
                    className={`w-full px-3 py-1.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 min-w-0 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-200'
                        : 'bg-white border-neutral-300 text-neutral-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400 truncate">
                          {activeWeekdaysLabel}
                        </span>
                        {scheduleSummaryText && (
                          <span className="text-[10px] font-medium text-neutral-500 dark:text-slate-400 truncate">
                            {scheduleSummaryText}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomScheduleInput(courseSchedule || metadata.horario || '');
                        setIsEditingScheduleConfig(true);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer shrink-0 ${
                        isDarkMode
                          ? 'border-slate-600 bg-slate-700/80 text-slate-200 hover:bg-slate-700'
                          : 'border-neutral-200 bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                      title="Modificar los días y horas de cursada"
                    >
                      <Pencil className="w-3 h-3 text-blue-500 shrink-0" />
                      <span>Editar</span>
                    </button>
                  </div>
                ) : (
                  <div
                    className={`w-full p-2.5 rounded-lg border space-y-2 min-w-0 ${
                      isDarkMode
                        ? 'bg-slate-800 border-blue-500/60 text-slate-200'
                        : 'bg-white border-blue-400 text-neutral-800'
                    }`}
                  >
                    {/* Días de la semana */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-neutral-500 dark:text-slate-400">
                        Días de cursada:
                      </span>
                      <div className="inline-flex items-center gap-1 flex-wrap min-w-0">
                        {[
                          { day: 1, label: 'Lun' },
                          { day: 2, label: 'Mar' },
                          { day: 3, label: 'Mié' },
                          { day: 4, label: 'Jue' },
                          { day: 5, label: 'Vie' },
                        ].map((d) => {
                          const isSelected = activeWeekdays.includes(d.day);
                          return (
                            <button
                              key={d.day}
                              type="button"
                              onClick={() => handleToggleCourseWeekday(d.day)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                                  : isDarkMode
                                  ? 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                                  : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Horarios específicos por día (cada hora genera una fila) */}
                    <div className="space-y-1.5 pt-1 border-t border-neutral-200 dark:border-slate-700/60">
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <span className="text-[10px] font-bold uppercase text-neutral-500 dark:text-slate-400">
                          Horario (cada hora es una fila en la tabla):
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const daysNames = activeWeekdays.map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]);
                            const formatted = daysNames
                              .map((dn) => `${dn} 07:50 - 08:50, ${dn} 08:50 - 09:50`)
                              .join(', ');
                            setCustomScheduleInput(formatted);
                          }}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-bold cursor-pointer"
                        >
                          Usar 2 horas (07:50 - 08:50 y 08:50 - 09:50)
                        </button>
                      </div>

                      <input
                        type="text"
                        value={customScheduleInput}
                        onChange={(e) => setCustomScheduleInput(e.target.value)}
                        placeholder="Ej: Jueves 07:50 - 08:50, Jueves 08:50 - 09:50"
                        className={`w-full px-2.5 py-1 text-xs rounded-md border font-medium focus:outline-hidden ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                        }`}
                      />
                      <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                        Si tenés 2 horas un día (ej: 7:50 a 8:50 y 8:50 a 9:50), se generan automáticamente 2 filas en el Libro de Temas.
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsEditingScheduleConfig(false)}
                        className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-neutral-500 dark:text-slate-400 hover:text-neutral-700 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const scheduleToSave = customScheduleInput.trim() || activeWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
                          const nextWeekdays = extractWeekdaysFromSchedule(scheduleToSave);
                          const finalWeekdays = nextWeekdays.length > 0 ? nextWeekdays : activeWeekdays;

                          const nextMeta: LibroDeTemasMetadata = {
                            ...metadata,
                            horario: scheduleToSave,
                            configuredWeekdays: finalWeekdays,
                            isScheduleLocked: true,
                          };
                          setMetadata(nextMeta);
                          setIsEditingScheduleConfig(false);
                          persistLibroData(nextMeta, entriesMap, characterOptions, true);

                          const nextSettings: AttendanceSettings = {
                            ...attendanceSettings,
                            courseWeekdays: finalWeekdays,
                            classesPerWeek: finalWeekdays.length,
                          };
                          saveCourseAttendanceSettings(courseId, nextSettings);
                          if (onUpdateAttendanceSettings) onUpdateAttendanceSettings(nextSettings);

                          try {
                            await api.updateCourse(courseId, { schedule: scheduleToSave });
                            if (onRefreshCourse) onRefreshCourse();
                          } catch (_) {}

                          setToastMsg('Días y horas de cursada guardados correctamente.');
                          setTimeout(() => setToastMsg(null), 3500);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>Guardar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {onOpenAttendanceSettingsModal && (
                <button
                  type="button"
                  onClick={onOpenAttendanceSettingsModal}
                  className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer min-w-0 ${
                    isDarkMode
                      ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-750'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                  }`}
                  title="Configurar fechas de inicio/fin de cuatrimestres y feriados del calendario escolar"
                >
                  <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="truncate">Calendario Escolar y Feriados</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barra de Filtros y Buscador 100% Elástica */}
        <div
          className={`px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 min-w-0 ${
            isDarkMode ? 'bg-slate-850/60' : 'bg-neutral-50/80'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
            {sheetInfo?.url && (
              <a
                href={sheetInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors max-w-full min-w-0 ${
                  isDarkMode
                    ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                }`}
                title="Abrir hoja de Google Sheets vinculada en la carpeta de Drive de la materia"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">
                  Sheet en Drive{sheetInfo.lastSyncedAt ? ` (${sheetInfo.lastSyncedAt})` : ''}
                </span>
                <ExternalLink className="w-3 h-3 opacity-80 shrink-0" />
              </a>
            )}
          </div>

          {/* Filtros de período, estado y buscador */}
          <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto flex-1 justify-end min-w-0">
            <div
              className={`flex flex-wrap p-0.5 rounded-lg border text-[11px] font-semibold w-full sm:w-auto min-w-0 ${
                isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
              }`}
            >
              {[
                { id: 'all', label: 'Todo el año' },
                { id: '1c', label: '1° Cuatr.' },
                { id: '2c', label: '2° Cuatr.' },
                { id: 'until_today', label: 'Hasta hoy' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTermFilter(tab.id as any)}
                  className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-md transition-colors cursor-pointer text-center whitespace-nowrap ${
                    termFilter === tab.id
                      ? 'bg-blue-600 text-white'
                      : isDarkMode
                      ? 'text-slate-400 hover:text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={`w-full sm:w-auto max-w-full min-w-0 flex-1 sm:flex-initial px-2.5 py-1.5 sm:py-1 rounded-lg border text-[11px] font-semibold focus:outline-hidden truncate ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-200'
                  : 'bg-white border-neutral-200 text-neutral-700'
              }`}
            >
              <option value="all">Todas las fechas ({scheduledRows.length})</option>
              <option value="completed">Con tema registrado ({stats.completedClasses})</option>
              <option value="pending">Pendientes de completar</option>
              <option value="holidays">
                Sin dictado: Feriados / Eventos ({stats.holidaysCount})
              </option>
            </select>

            <div className="relative w-full sm:w-52 flex-1 sm:flex-initial min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar tema, unidad, fecha..."
                className={`w-full min-w-0 pl-8 pr-7 py-1.5 sm:py-1 rounded-lg border text-xs focus:outline-hidden ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                    : 'bg-white border-neutral-200 text-neutral-800 placeholder:text-neutral-400'
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODO TARJETA COMPACTA PARA "CLASE DE HOY" (CELULAR Y ZOOM CERCANO)     */}
      {/* ===================================================================== */}
      {activeTodayRow && (() => {
        const row = activeTodayRow;
        const isHol = row.entry.isHoliday;
        const noClassPreset = NO_CLASS_PRESETS.find(
          (p) => p.id === (row.entry.noClassCategory || 'feriado')
        );
        const noClassBadgeText = noClassPreset?.badgeLabel || 'Sin clase';

        return (
          <div
            className={`rounded-xl border-2 overflow-hidden shadow-xs transition-colors mb-4 ${
              isDarkMode
                ? 'bg-slate-900 border-blue-600/80 shadow-blue-950/20'
                : 'bg-white border-blue-400 shadow-blue-500/5'
            }`}
          >
            {/* Cabecera de la tarjeta Clase de Hoy */}
            <div
              className={`px-3.5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
                isDarkMode
                  ? 'bg-blue-950/75 border-blue-800/80'
                  : 'bg-blue-50 border-blue-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-blue-600 text-white shadow-2xs shrink-0">
                  <Calendar className="w-3 h-3" />
                  Clase de Hoy
                </span>
                <span
                  className={`text-xs font-extrabold ${
                    isDarkMode ? 'text-blue-100' : 'text-blue-950'
                  }`}
                >
                  {row.weekdayFull} {row.day}/{row.month}
                  {row.timeLabel ? ` · ${row.timeLabel}` : ''}
                  {row.computedClassNumber !== '-'
                    ? ` · Clase N° ${row.computedClassNumber}`
                    : ' · Día sin dictado'}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isDarkMode
                      ? 'bg-slate-800 text-slate-300 border border-slate-700'
                      : 'bg-white text-neutral-700 border border-neutral-200'
                  }`}
                >
                  {row.term === '1c' ? '1° Cuatr.' : '2° Cuatr.'}
                </span>
                <span
                  className={`text-[10px] font-medium hidden sm:inline ${
                    isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                  }`}
                >
                  (Sincronizada con la fila de la tabla)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (termFilter !== 'all' || statusFilter !== 'all' || searchQuery) {
                      setTermFilter('all');
                      setStatusFilter('all');
                      setSearchQuery('');
                    }
                    setTimeout(() => {
                      const el = document.getElementById(`row-${row.rowKey}`);
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } else if (todayRowRef.current) {
                        todayRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 50);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-semibold shrink-0 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-blue-500'
                      : 'bg-white border-neutral-300 text-neutral-700 hover:border-blue-500'
                  }`}
                  title="Desplazarse hasta la fila de esta clase en la tabla cronológica de abajo"
                >
                  Ver en la tabla ↓
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenNoClassModal(row)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-semibold shrink-0 ${
                    isHol
                      ? isDarkMode
                        ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                        : 'bg-amber-100 border-amber-300 text-amber-800'
                      : isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-amber-500'
                      : 'bg-white border-neutral-300 text-neutral-700 hover:border-amber-500'
                  }`}
                >
                  {isHol ? `Evento: ${noClassBadgeText} (Editar)` : 'Marcar Sin clase / Evento'}
                </button>
              </div>
            </div>

            {/* Selector de Horas de Hoy (cuando el curso tiene 2 o más horas/módulos en el mismo día) */}
            {todayRows.length > 1 && (
              <div
                className={`px-3.5 py-2 border-b flex flex-wrap items-center gap-2 ${
                  isDarkMode
                    ? 'bg-slate-850/80 border-slate-800'
                    : 'bg-blue-50/50 border-blue-100'
                }`}
              >
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                  Horas de esta fecha:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {todayRows.map((tr, idx) => {
                    const isSelected = tr.rowKey === row.rowKey;
                    const hasContent = tr.entry.contents.trim().length > 0;
                    return (
                      <button
                        key={tr.rowKey}
                        type="button"
                        onClick={() => setSelectedTodaySlotIndex(idx)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                            : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        <span>
                          {tr.timeLabel ? `${idx + 1}° Hora (${tr.timeLabel})` : `${idx + 1}° Hora`}
                        </span>
                        <span
                          className={`text-[10px] px-1 rounded ${
                            isSelected ? 'bg-blue-700 text-white' : 'bg-neutral-200 dark:bg-slate-700'
                          }`}
                        >
                          N° {tr.computedClassNumber}
                        </span>
                        {hasContent && <span className="text-emerald-400 font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cuerpo adaptable de la tarjeta Clase de Hoy (sin scroll horizontal) */}
            <div className="p-3.5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                {/* Unidad N° */}
                <div className="sm:col-span-3 min-w-0">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
                    Unidad N°
                  </label>
                  {isHol ? (
                    <div
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold text-center ${
                        isDarkMode
                          ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                          : 'bg-neutral-100 border-neutral-200 text-neutral-500'
                      }`}
                    >
                      -
                    </div>
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
                      className={`w-full px-3 py-1.5 text-center font-bold rounded-lg border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                      }`}
                    />
                  )}
                </div>

                {/* Carácter de la clase */}
                <div className="sm:col-span-9 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                      Carácter de la clase
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCharacterOptionsModal(true)}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer inline-flex items-center gap-1"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      Editar opciones
                    </button>
                  </div>
                  {isHol ? (
                    <div
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold text-center ${
                        isDarkMode
                          ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                          : 'bg-neutral-100 border-neutral-200 text-neutral-500'
                      }`}
                    >
                      Sin dictado de clases
                    </div>
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
                      className={`w-full px-3 py-1.5 rounded-lg border text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-200'
                          : 'bg-white border-neutral-300 text-neutral-800'
                      }`}
                    >
                      <option value="">Seleccionar carácter...</option>
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
                </div>
              </div>

              {/* Contenidos */}
              <div className="min-w-0">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
                  Contenidos {isHol ? '(Motivo sin dictado)' : 'de la Clase'} {row.timeLabel ? `(${row.timeLabel})` : ''}
                </label>
                <textarea
                  rows={2}
                  value={row.entry.contents}
                  placeholder={
                    isHol
                      ? 'Escribir motivo por el cual no se dictó la clase (Feriado, Acto, Mocks, Deportes...)'
                      : 'Escribir los contenidos dictados en esta hora...'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    updateEntryField(row.rowKey, (curr) => ({
                      ...curr,
                      contents: val,
                      noClassReason: curr.isHoliday ? val : curr.noClassReason,
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
                  className={`w-full px-3 py-2 rounded-lg border text-xs resize-y leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                    isHol
                      ? isDarkMode
                        ? 'bg-amber-950/30 border-amber-800/60 text-amber-200 font-semibold italic'
                        : 'bg-amber-50/70 border-amber-200 text-amber-900 font-semibold italic'
                      : isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-400'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />
              </div>

              {/* Observaciones + Firmas */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-6 min-w-0">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
                    Observaciones
                  </label>
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
                    className={`w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-800 placeholder:text-neutral-400'
                    }`}
                  />
                </div>

                <div className="sm:col-span-3 min-w-0">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
                    Firma Profesor
                  </label>
                  {row.entry.teacherSignature ? (
                    <button
                      type="button"
                      onClick={() => handleSignRow(row.rowKey)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 text-xs font-serif italic cursor-pointer hover:bg-red-500/10 hover:text-red-500 truncate"
                      title="Clic para quitar firma"
                    >
                      {row.entry.teacherSignature}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSignRow(row.rowKey)}
                      className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'bg-blue-950/60 border-blue-700 text-blue-300 hover:bg-blue-900/60'
                          : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      Firmar clase
                    </button>
                  )}
                </div>

                <div className="sm:col-span-3 min-w-0">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
                    Firma Autoridad
                  </label>
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
                    className={`w-full px-3 py-1.5 rounded-lg border text-xs text-center focus:outline-hidden ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 placeholder:text-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-700 placeholder:text-neutral-400'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
                        <div className="flex flex-col items-center justify-center leading-tight">
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

                      {/* COLUMNA 8: FIRMA DE LA AUTORIDAD */}
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
                          {row.entry.isCustomDate && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomDate(row.dateStr)}
                              className="p-1 text-neutral-400 hover:text-red-500 cursor-pointer shrink-0"
                              title="Eliminar esta fecha agregada manualmente"
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

      {/* ===================================================================== */}
      {/* MODAL 1: MARCAR DÍA SIN DICTADO DE CLASE (FERIADO, ACTO, MOCKS, ETC.) */}
      {/* ===================================================================== */}
      {noClassModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    Día sin dictado de clase ({noClassModalRow.weekdayFull} {noClassModalRow.day}/
                    {noClassModalRow.month})
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Coloca &quot;-&quot; en Clase N° y registra la razón (Feriado, Acto, Mocks,
                    Exámenes Internacionales, Deportes, etc.)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNoClassModalRow(null)}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmNoClassReason} className="p-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold mb-2 text-neutral-700 dark:text-slate-300">
                  1. Seleccioná el tipo de evento o motivo:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {NO_CLASS_PRESETS.map((preset) => {
                    const isSelected = noClassModalRow.category === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setNoClassModalRow((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  category: preset.id,
                                  reasonText: preset.defaultText,
                                }
                              : null
                          );
                        }}
                        className={`px-3 py-2 rounded-xl border text-left font-semibold transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500 text-amber-800 dark:text-amber-300 shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        <span>{preset.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-neutral-700 dark:text-slate-300">
                  2. Escribí la razón exacta por la cual no se dictó la clase (se mostrará en
                  CONTENIDOS):
                </label>
                <input
                  type="text"
                  value={noClassModalRow.reasonText}
                  onChange={(e) =>
                    setNoClassModalRow((prev) =>
                      prev ? { ...prev, reasonText: e.target.value } : null
                    )
                  }
                  placeholder="Ej: Sin dictado de clases por Mocks / Exámenes Internacionales / Acto Escolar / Torneo Deportivo..."
                  required
                  className={`w-full px-3 py-2 rounded-xl border font-semibold focus:outline-hidden focus:ring-2 focus:ring-amber-500/40 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-neutral-700 dark:text-slate-300">
                  Observaciones adicionales (opcional):
                </label>
                <input
                  type="text"
                  value={noClassModalRow.observations}
                  onChange={(e) =>
                    setNoClassModalRow((prev) =>
                      prev ? { ...prev, observations: e.target.value } : null
                    )
                  }
                  placeholder="Ej: Disposición de Dirección / Turno mañana completo..."
                  className={`w-full px-3 py-2 rounded-xl border font-medium focus:outline-hidden ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="pt-2 border-t border-neutral-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                {noClassModalRow.isCurrentlyNoClass ? (
                  <button
                    type="button"
                    onClick={() => handleRevertToNormalClass(noClassModalRow.dateStr)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold cursor-pointer hover:bg-blue-100"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Habilitar como clase dictada normal</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNoClassModalRow(null)}
                    className="px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Guardar día sin dictado
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: EDITAR OPCIONES DEL DESPLEGABLE "CARÁCTER DE LA CLASE"       */}
      {/* ===================================================================== */}
      {showCharacterOptionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-purple-500" />
                <div>
                  <h3 className="text-sm font-bold">
                    Editar opciones de &quot;Carácter de la clase&quot;
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Agregá, modificá o eliminá opciones del menú desplegable
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCharacterOptionsModal(false);
                  setEditingOptionIndex(null);
                }}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              {/* Formulario para agregar nueva opción */}
              <form onSubmit={handleAddCharacterOption} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCharacterOptionText}
                  onChange={(e) => setNewCharacterOptionText(e.target.value)}
                  placeholder="Nueva opción (ej: Laboratorio, Seminario, Debate...)"
                  className={`flex-1 px-3 py-2 rounded-xl border font-medium focus:outline-hidden focus:ring-2 focus:ring-purple-500/40 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar</span>
                </button>
              </form>

              {/* Lista de opciones actuales */}
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {characterOptions.map((opt, idx) => {
                  const isDash = opt === '-';
                  const isEditingThis = editingOptionIndex === idx;

                  return (
                    <div
                      key={`${opt}-${idx}`}
                      className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${
                        isDarkMode
                          ? 'bg-slate-800/70 border-slate-700/80'
                          : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      {isEditingThis ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editingOptionValue}
                            onChange={(e) => setEditingOptionValue(e.target.value)}
                            autoFocus
                            className={`flex-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-600 text-white'
                                : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEditedCharacterOption(idx)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOptionIndex(null)}
                            className="px-2 py-1 rounded-lg text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="font-semibold">{opt}</span>
                          {!isDash && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingOptionIndex(idx);
                                  setEditingOptionValue(opt);
                                }}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-blue-500 hover:bg-neutral-200/50 dark:hover:bg-slate-700 cursor-pointer"
                                title="Renombrar esta opción"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCharacterOption(opt)}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                                title="Eliminar esta opción"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-neutral-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDefaultCharacterOptions}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restaurar predeterminadas</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowCharacterOptionsModal(false);
                    setEditingOptionIndex(null);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: AGREGAR FECHA ESPECIAL FUERA DE LOS DÍAS HABITUALES          */}
      {/* ===================================================================== */}
      {showAddDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-bold">Agregar Fecha Especial al Libro de Temas</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddDateModal(false)}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomDate} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Fecha de la clase:</label>
                <input
                  type="date"
                  value={newCustomDate}
                  onChange={(e) => setNewCustomDate(e.target.value)}
                  required
                  className={`w-full px-3 py-2 rounded-lg border font-medium ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Unidad N°:</label>
                  <input
                    type="text"
                    value={newCustomUnit}
                    onChange={(e) => setNewCustomUnit(e.target.value)}
                    placeholder="1"
                    className={`w-full px-3 py-2 rounded-lg border font-medium ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Carácter de la clase:</label>
                  <select
                    value={newCustomCharacter}
                    onChange={(e) => setNewCustomCharacter(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border font-medium ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  >
                    {characterOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Contenidos dictados:</label>
                <textarea
                  rows={3}
                  value={newCustomContents}
                  onChange={(e) => setNewCustomContents(e.target.value)}
                  placeholder="Describí los contenidos dados en la clase..."
                  className={`w-full px-3 py-2 rounded-lg border font-medium ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDateModal(false)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                >
                  Agregar al Libro de Temas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
