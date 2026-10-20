/**
 * Google Calendar Oficial Module
 * Vista directa y en tiempo real de Google Calendar oficial.
 * Utiliza la API oficial de Google Calendar v3 (con token OAuth) y el cruce automático
 * con las Materias del docente para mostrar siempre los nombres reales de las materias
 * y eventos (evitando el bloqueo "No disponible" del widget iframe por privacidad/cookies),
 * además de permitir actualizar los nombres de las materias directamente en Google Calendar.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ExternalLink,
  RotateCw,
  Clock,
  ShieldCheck,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  HelpCircle,
  Eye,
  EyeOff,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  MapPin,
  CheckCircle2,
  AlertCircle,
  LayoutGrid,
  Globe,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import {
  calendarService,
  getEffectiveCourseSchedule,
  formatCourseCalendarTitle,
} from '../../services/workspace/calendarService';
import { GoogleCalendarInfo, Course, CalendarEventItem } from '../../types';
import { getLocalCourses } from '../../services/storageHelpers';

export interface CalendarModuleProps {
  courses?: Course[];
  selectedCourseId?: string;
  onSelectCourse?: (courseId: string) => void;
  onNavigateToCourseDetail?: (courseId: string) => void;
}

export interface ConfiguredCalendar {
  id: string;          // Google Calendar ID or email address
  name: string;        // Human readable name (e.g., "Evaluaciones", "Colegio Oficial")
  color: string;       // Hex color for Google Calendar
  enabled: boolean;    // Whether it is visible in the current view
  isPrimary?: boolean; // Primary user calendar
  description?: string;
}

type EnrichedCalendarEvent = CalendarEventItem & {
  calendarName?: string;
  courseDivision?: string;
  courseRoom?: string;
};

const PRESET_COLORS = [
  { name: 'Azul Google', hex: '#1a73e8' },
  { name: 'Verde Esmeralda', hex: '#0d904f' },
  { name: 'Rojo Carmesí', hex: '#d93025' },
  { name: 'Ámbar Cálido', hex: '#f29900' },
  { name: 'Púrpura Amatista', hex: '#9334e6' },
  { name: 'Turquesa', hex: '#00897b' },
  { name: 'Rosa Vivo', hex: '#e91e63' },
  { name: 'Gris Grafito', hex: '#5f6368' },
];

const COURSE_PALETTE = [
  '#1a73e8',
  '#0d904f',
  '#9334e6',
  '#e65100',
  '#00897b',
  '#d93025',
  '#3949ab',
  '#c2185b',
];

const STORAGE_KEY = 'fds_google_calendars_configured_v3';

type GCalViewMode = 'WEEK' | 'MONTH' | 'AGENDA';
type CalendarRenderMode = 'LIVE_API' | 'IFRAME';

const SHORT_DAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const FULL_DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const toLocalYMD = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const CalendarModule: React.FC<CalendarModuleProps> = ({
  courses: propCourses,
  onNavigateToCourseDetail,
}) => {
  const { isDarkMode, user, token } = useWorkspaceAuth();
  const userEmail = user?.email || 'primary';

  const activeCourses = useMemo(() => {
    if (propCourses && propCourses.length > 0) return propCourses;
    return getLocalCourses();
  }, [propCourses]);

  // Assign a consistent color per course
  const courseColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    activeCourses.forEach((c, idx) => {
      map[c.id] = COURSE_PALETTE[idx % COURSE_PALETTE.length];
    });
    return map;
  }, [activeCourses]);

  // Load configured calendars: ONLY user calendar by default
  const [calendars, setCalendars] = useState<ConfiguredCalendar[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const filtered = parsed.filter(
              (c: any) =>
                c.id !== 'colegio@fds-esc.edu.ar' &&
                c.id !== 'evaluaciones@fds-esc.edu.ar' &&
                c.id !== 'es.ar#holiday@group.v.calendar.google.com'
            );
            if (filtered.length > 0) return filtered;
          }
        }
      } catch (_) {}
    }

    return [
      {
        id: userEmail,
        name: 'Mi Calendario Docente',
        color: '#1a73e8',
        enabled: true,
        isPrimary: true,
        description: 'Clases, horarios y eventos de tu cuenta vinculada',
      },
    ];
  });

  // Ensure primary calendar ID always matches the currently logged-in user's email
  useEffect(() => {
    if (!user?.email) return;
    setCalendars((prev) => {
      const needsUpdate = prev.some(
        (c) => (c.isPrimary || c.id === 'jorge.cano@fds-esc.edu.ar' || c.id === 'primary') && c.id !== user.email
      );
      if (!needsUpdate) return prev;
      return prev.map((c, idx) =>
        c.isPrimary || idx === 0 || c.id === 'jorge.cano@fds-esc.edu.ar' || c.id === 'primary'
          ? { ...c, id: user.email, isPrimary: true }
          : c
      );
    });
  }, [user?.email]);

  const [hasHydratedFromCloud, setHasHydratedFromCloud] = useState<boolean>(false);

  // Hydrate configured calendars from Firestore cloud on mount
  useEffect(() => {
    let mounted = true;
    import('../../services/firestoreSync')
      .then(async ({ firestoreSync, getActiveUserId }) => {
        const uid = getActiveUserId();
        if (!uid) return;
        const cloudCals = await firestoreSync.loadUserSetting<ConfiguredCalendar[]>(uid, 'google_calendars_configured');
        if (mounted && Array.isArray(cloudCals) && cloudCals.length > 0) {
          const updated = cloudCals.map((c, idx) =>
            (c.isPrimary || idx === 0) && user?.email ? { ...c, id: user.email, isPrimary: true } : c
          );
          setCalendars(updated);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch (_) {}
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setHasHydratedFromCloud(true);
      });
    return () => {
      mounted = false;
    };
  }, [user?.id, user?.email]);

  // Save to localStorage and Firestore whenever calendars state changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(calendars));
    } catch (_) {}
    if (!hasHydratedFromCloud) return;
    import('../../services/firestoreSync')
      .then(({ firestoreSync, getActiveUserId }) => {
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveUserSetting(uid, 'google_calendars_configured', calendars).catch(() => {});
        }
      })
      .catch(() => {});
  }, [calendars, hasHydratedFromCloud]);

  const [viewMode, setViewMode] = useState<GCalViewMode>('WEEK');
  const [renderMode, setRenderMode] = useState<CalendarRenderMode>('LIVE_API');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [refreshKey, setRefreshKey] = useState<number>(Date.now());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live events fetched via OAuth API + merged with Materias
  const [liveEvents, setLiveEvents] = useState<EnrichedCalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);
  const [selectedEventDetail, setSelectedEventDetail] = useState<EnrichedCalendarEvent | null>(null);

  // Confirmation modal for writing/updating Materia names in Google Calendar
  const [isConfirmSyncToGoogleOpen, setIsConfirmSyncToGoogleOpen] = useState<boolean>(false);
  const [isPushingCourseNames, setIsPushingCourseNames] = useState<boolean>(false);

  // Modal / dialog for adding calendar by ID
  const [isAddByIdOpen, setIsAddByIdOpen] = useState<boolean>(false);
  const [newCalendarId, setNewCalendarId] = useState<string>('');
  const [newCalendarName, setNewCalendarName] = useState<string>('');
  const [newCalendarColor, setNewCalendarColor] = useState<string>('#0d904f');
  const [newCalendarDesc, setNewCalendarDesc] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Quick guide modal
  const [showIdGuide, setShowIdGuide] = useState<boolean>(false);

  // Auto-detection & specific calendar selector state
  const [isAutoDetecting, setIsAutoDetecting] = useState<boolean>(false);
  const [autoDetectMsg, setAutoDetectMsg] = useState<string | null>(null);
  const [availableGoogleCalendars, setAvailableGoogleCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [selectedGoogleCalendarId, setSelectedGoogleCalendarId] = useState<string>('primary');

  // Edit Calendar state
  const [editingCalendar, setEditingCalendar] = useState<ConfiguredCalendar | null>(null);

  // Load available calendars from the user's Google account when token is present
  useEffect(() => {
    if (!token) return;
    let mounted = true;
    calendarService
      .listCalendars()
      .then((res) => {
        if (mounted && res.success && res.calendars.length > 0) {
          setAvailableGoogleCalendars(res.calendars);
          const primaryCal = res.calendars.find((c) => c.primary) || res.calendars[0];
          if (primaryCal) {
            setSelectedGoogleCalendarId(primaryCal.id);
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [token]);

  // Active calendars
  const enabledCalendars = useMemo(() => {
    const list = calendars.filter((c) => c.enabled && c.id.trim().length > 0);
    if (list.length === 0 && calendars.length > 0) {
      return [calendars[0]];
    }
    return list;
  }, [calendars]);

  // Compute date range for current view
  const dateRange = useMemo(() => {
    const base = new Date(currentDate);
    base.setHours(0, 0, 0, 0);

    if (viewMode === 'WEEK') {
      const dow = base.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const start = new Date(base);
      start.setDate(base.getDate() + mondayOffset);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(d);
      }
      return { start, end, days };
    }

    if (viewMode === 'MONTH') {
      const firstOfMonth = new Date(base.getFullYear(), base.getMonth(), 1);
      const startDow = firstOfMonth.getDay();
      const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
      const start = new Date(firstOfMonth);
      start.setDate(firstOfMonth.getDate() + mondayOffset);
      start.setHours(0, 0, 0, 0);

      const days: Date[] = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(d);
      }
      const end = new Date(days[41]);
      end.setHours(23, 59, 59, 999);
      return { start, end, days };
    }

    // AGENDA: 30 days starting from Monday of current week
    const dow = base.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const start = new Date(base);
    start.setDate(base.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 27);
    end.setHours(23, 59, 59, 999);

    const days: Date[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return { start, end, days };
  }, [currentDate, viewMode]);

  // Fetch live events from Google Calendar API + enrich with Materia names
  const loadCalendarEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const res = await calendarService.fetchMultiCalendarLiveEvents(
        enabledCalendars,
        dateRange.start.toISOString(),
        dateRange.end.toISOString(),
        activeCourses
      );
      if (res.success) {
        setLiveEvents(res.events);
      }
    } catch (e) {
      console.warn('Error loading live calendar events:', e);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [enabledCalendars, dateRange.start, dateRange.end, activeCourses]);

  useEffect(() => {
    loadCalendarEvents();
  }, [loadCalendarEvents, refreshKey, token]);

  // Google Calendar Embed URL constructed with multiple &src= parameters
  const iframeSrc = useMemo(() => {
    const base =
      'https://calendar.google.com/calendar/embed?ctz=America%2FArgentina%2FBuenos_Aires&showTitle=0&showNav=1&showDate=1&showPrint=1&showTabs=1&showCalendars=1';
    const viewParam = `&mode=${viewMode}`;

    const calendarParams = enabledCalendars
      .map((c) => {
        const srcId = c.isPrimary && user?.email ? user.email : c.id.trim();
        return `&src=${encodeURIComponent(srcId)}&color=${encodeURIComponent(c.color || '#1a73e8')}`;
      })
      .join('');

    return `${base}${viewParam}${calendarParams}`;
  }, [enabledCalendars, viewMode, user?.email]);

  // Navigation handlers
  const handlePrevPeriod = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (viewMode === 'MONTH') {
        next.setMonth(next.getMonth() - 1);
      } else {
        next.setDate(next.getDate() - 7);
      }
      return next;
    });
  };

  const handleNextPeriod = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (viewMode === 'MONTH') {
        next.setMonth(next.getMonth() + 1);
      } else {
        next.setDate(next.getDate() + 7);
      }
      return next;
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const periodHeaderLabel = useMemo(() => {
    if (viewMode === 'MONTH') {
      return `${MONTHS_ES[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
    }
    const s = dateRange.start;
    const e = dateRange.days[Math.min(6, dateRange.days.length - 1)];
    if (s.getMonth() === e.getMonth()) {
      return `${s.getDate()} – ${e.getDate()} de ${MONTHS_ES[s.getMonth()]} ${s.getFullYear()}`;
    }
    return `${s.getDate()} ${MONTHS_ES[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS_ES[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
  }, [viewMode, currentDate, dateRange]);

  // Toggle calendar visibility
  const toggleCalendar = (id: string) => {
    setCalendars((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
    setRefreshKey(Date.now());
  };

  // Handle Add Calendar by ID
  const handleAddCalendar = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanId = newCalendarId.trim();
    let cleanName = newCalendarName.trim();

    if (!cleanId) {
      setFormError('Ingresa el ID o dirección de correo del calendario.');
      return;
    }

    if (!cleanName) {
      if (cleanId.includes('@')) {
        const prefix = cleanId.split('@')[0];
        cleanName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      } else {
        cleanName = 'Calendario Incorporado';
      }
    }

    if (calendars.some((c) => c.id.toLowerCase() === cleanId.toLowerCase())) {
      setFormError('Este calendario ya está incorporado en tu lista.');
      return;
    }

    const newCal: ConfiguredCalendar = {
      id: cleanId,
      name: cleanName,
      color: newCalendarColor,
      enabled: true,
      description: newCalendarDesc.trim() || undefined,
    };

    setCalendars((prev) => [...prev, newCal]);
    setNewCalendarId('');
    setNewCalendarName('');
    setNewCalendarDesc('');
    setIsAddByIdOpen(false);
    setRefreshKey(Date.now());
  };

  // Handle Edit Calendar
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCalendar) return;

    setCalendars((prev) => prev.map((c) => (c.id === editingCalendar.id ? editingCalendar : c)));
    setEditingCalendar(null);
    setRefreshKey(Date.now());
  };

  // Handle Delete Calendar
  const handleDeleteCalendar = (id: string) => {
    if (calendars.length <= 1) {
      setAutoDetectMsg('Debes conservar al menos tu calendario principal.');
      setTimeout(() => setAutoDetectMsg(null), 4000);
      return;
    }
    setCalendars((prev) => prev.filter((c) => c.id !== id));
    setRefreshKey(Date.now());
  };

  // Sync selected calendar from dropdown
  const handleSyncSelectedCalendar = async (overrideCalendarId?: string) => {
    setIsAutoDetecting(true);
    setAutoDetectMsg(null);

    try {
      let list = availableGoogleCalendars;
      if (list.length === 0) {
        const result = await calendarService.listCalendars();
        if (result.success && result.calendars && result.calendars.length > 0) {
          list = result.calendars;
          setAvailableGoogleCalendars(result.calendars);
        } else {
          setAutoDetectMsg(
            result.message || 'No se pudieron obtener los calendarios de tu cuenta de Google.'
          );
          return;
        }
      }

      const targetId = overrideCalendarId || selectedGoogleCalendarId || 'primary';
      const chosenCal =
        list.find((c) => c.id === targetId || (targetId === 'primary' && c.primary)) || list[0];

      if (!chosenCal) {
        setAutoDetectMsg('Selecciona un calendario válido de la lista.');
        return;
      }

      const effectiveId = chosenCal.primary ? (user?.email || 'primary') : chosenCal.id;

      setCalendars((prev) => {
        const exists = prev.some(
          (c) =>
            c.id.toLowerCase() === effectiveId.toLowerCase() ||
            c.id.toLowerCase() === chosenCal.id.toLowerCase()
        );
        if (exists) {
          return prev.map((c) =>
            c.id.toLowerCase() === effectiveId.toLowerCase() ||
            c.id.toLowerCase() === chosenCal.id.toLowerCase()
              ? { ...c, enabled: true, name: chosenCal.summary || c.name }
              : c
          );
        }
        return [
          ...prev,
          {
            id: effectiveId,
            name: chosenCal.summary,
            color: chosenCal.backgroundColor || PRESET_COLORS[(prev.length + 1) % PRESET_COLORS.length].hex,
            enabled: true,
            isPrimary: !!chosenCal.primary,
            description: chosenCal.description || undefined,
          },
        ];
      });

      setAutoDetectMsg(`¡Calendario "${chosenCal.summary}" sincronizado y activado!`);
      setRefreshKey(Date.now());
    } catch (_) {
      setAutoDetectMsg('Error al sincronizar el calendario seleccionado.');
    } finally {
      setIsAutoDetecting(false);
      setTimeout(() => setAutoDetectMsg(null), 5000);
    }
  };

  // Push and update Materia names directly into Google Calendar
  const handleConfirmPushCourseNamesToGoogle = async () => {
    setIsPushingCourseNames(true);
    try {
      const res = await calendarService.syncAllCoursesToGoogleCalendar(
        activeCourses,
        selectedGoogleCalendarId || 'primary'
      );
      setAutoDetectMsg(res.message);
      setIsConfirmSyncToGoogleOpen(false);
      setRefreshKey(Date.now());
      await loadCalendarEvents();
    } catch (_) {
      setAutoDetectMsg('No se pudieron actualizar los eventos en Google Calendar.');
    } finally {
      setIsPushingCourseNames(false);
      setTimeout(() => setAutoDetectMsg(null), 6000);
    }
  };

  const todayYMD = useMemo(() => toLocalYMD(new Date()), []);

  // Group events by YYYY-MM-DD for quick lookup in Week / Month / Agenda views
  const eventsByDateMap = useMemo(() => {
    const map: Record<string, EnrichedCalendarEvent[]> = {};
    for (const ev of liveEvents) {
      const dateStr = (ev.start || '').slice(0, 10);
      if (!dateStr) continue;
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    }
    for (const dKey of Object.keys(map)) {
      map[dKey].sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
    }
    return map;
  }, [liveEvents]);

  // Courses with configured schedules for the confirmation summary
  const coursesWithSchedules = useMemo(() => {
    return activeCourses
      .map((c) => ({
        course: c,
        schedule: getEffectiveCourseSchedule(c),
        title: formatCourseCalendarTitle(c),
      }))
      .filter((x) => x.schedule.trim().length > 0);
  }, [activeCourses]);

  // Visible weekdays for WEEK view: Monday to Friday (plus Saturday/Sunday if there are events on weekend)
  const weekViewDays = useMemo(() => {
    if (viewMode !== 'WEEK') return dateRange.days;
    const hasWeekendEvents = dateRange.days.some((d) => {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) return false;
      const ymd = toLocalYMD(d);
      return (eventsByDateMap[ymd]?.length || 0) > 0;
    });
    return hasWeekendEvents ? dateRange.days : dateRange.days.filter((d) => d.getDay() >= 1 && d.getDay() <= 5);
  }, [viewMode, dateRange.days, eventsByDateMap]);

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 p-4 bg-white dark:bg-slate-950 overflow-auto' : ''}`}>
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER: TITULO, CONTROLES DE VISTA Y ACCIONES             */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`p-5 rounded-2xl border shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors ${
          isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        {/* Title and institutional badge */}
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/50 flex items-center justify-center shrink-0 shadow-sm">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-lg font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Google Calendar Oficial
              </h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Nombres de materias sincronizados
              </span>
            </div>
            <p className={`text-xs mt-0.5 flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>
                {enabledCalendars.length === 1 ? '1 calendario activo' : `${enabledCalendars.length} calendarios superpuestos`} • {activeCourses.length} materia(s) vinculadas
              </span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Switch between Live API Grid (with Materia names) and Raw Google Iframe */}
          <div
            className={`inline-flex p-1 rounded-xl border text-xs font-semibold ${
              isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setRenderMode('LIVE_API')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                renderMode === 'LIVE_API'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
              title="Muestra todos tus eventos y materias con sus nombres reales usando tu conexión de Google"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Con Nombres de Materias</span>
            </button>
            <button
              type="button"
              onClick={() => setRenderMode('IFRAME')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                renderMode === 'IFRAME'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
              title="Vista embebida directa de calendar.google.com"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Widget Web</span>
            </button>
          </div>

          {/* Mode switch buttons (Semana / Mes / Agenda) */}
          <div
            className={`inline-flex p-1 rounded-xl border text-xs font-semibold ${
              isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setViewMode('WEEK')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'WEEK'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Semana
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MONTH')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'MONTH'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Mes
            </button>
            <button
              type="button"
              onClick={() => setViewMode('AGENDA')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'AGENDA'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Agenda
            </button>
          </div>

          {/* Button to push/rename Materia names directly into Google Calendar */}
          <button
            type="button"
            onClick={() => setIsConfirmSyncToGoogleOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 cursor-pointer"
            title="Actualiza en tu Google Calendar oficial los bloques sin nombre o 'No disponible' poniéndoles el nombre de cada materia"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Poner nombres en Google Calendar</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => setRefreshKey(Date.now())}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 shadow-sm'
            }`}
            title="Recargar eventos de Google Calendar"
          >
            <RotateCw className={`w-4 h-4 ${isLoadingEvents ? 'animate-spin text-blue-500' : ''}`} />
          </button>

          {/* Toggle Fullscreen */}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 shadow-sm'
            }`}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Open directly in Google Calendar in new tab */}
          <a
            href={`https://calendar.google.com/calendar/u/0/r/${viewMode.toLowerCase()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-all active:scale-95"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Abrir en Google</span>
          </a>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* BARRA DE CALENDARIOS: MI CALENDARIO + AGREGAR POR ID AL LADO  */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`px-4 py-3 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition-colors ${
          isDarkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-neutral-200 shadow-sm'
        }`}
      >
        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none flex-wrap">
          {calendars.map((cal) => (
            <div
              key={cal.id}
              className={`group inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm ${
                cal.enabled
                  ? isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                  : isDarkMode
                  ? 'bg-slate-900/40 border-slate-800/80 text-slate-500 line-through opacity-60'
                  : 'bg-white border-dashed border-neutral-200 text-neutral-400 line-through opacity-60'
              }`}
            >
              <button
                type="button"
                onClick={() => toggleCalendar(cal.id)}
                className="inline-flex items-center gap-2 outline-none cursor-pointer"
                title={cal.enabled ? `Ocultar ${cal.name}` : `Mostrar ${cal.name}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform"
                  style={{
                    backgroundColor: cal.color,
                    boxShadow: cal.enabled ? `0 0 6px ${cal.color}90` : 'none',
                    opacity: cal.enabled ? 1 : 0.4,
                  }}
                />
                <span className="whitespace-nowrap">{cal.name}</span>
                {cal.enabled ? (
                  <Eye className="w-3 h-3 text-neutral-400 shrink-0" />
                ) : (
                  <EyeOff className="w-3 h-3 text-neutral-400 shrink-0" />
                )}
              </button>

              {!cal.isPrimary && (
                <div className="flex items-center gap-1 border-l pl-1.5 border-neutral-200 dark:border-slate-700 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditingCalendar({ ...cal })}
                    className="p-1 hover:text-blue-500 rounded transition-colors cursor-pointer"
                    title="Editar nombre o color"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCalendar(cal.id)}
                    className="p-1 hover:text-rose-500 rounded transition-colors cursor-pointer"
                    title="Eliminar este calendario"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setIsAddByIdOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/50 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/70 font-semibold text-xs shadow-sm transition-all active:scale-95 cursor-pointer"
            title="Incorpora el calendario oficial del colegio, de evaluaciones o de materias pegando su ID de Google Calendar"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>+ Agregar calendario por ID</span>
          </button>
        </div>

        {/* Right side: Dropdown selector for choosing a specific Google Calendar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-auto">
          <div className="flex items-center gap-1.5">
            <select
              value={selectedGoogleCalendarId}
              onChange={(e) => setSelectedGoogleCalendarId(e.target.value)}
              onFocus={async () => {
                if (availableGoogleCalendars.length === 0) {
                  const res = await calendarService.listCalendars();
                  if (res.success && res.calendars.length > 0) {
                    setAvailableGoogleCalendars(res.calendars);
                  }
                }
              }}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-medium focus:outline-none max-w-[230px] truncate ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-200'
                  : 'bg-neutral-50 border-neutral-200 text-neutral-700'
              }`}
              title="Seleccionar un calendario específico de tu cuenta de Google"
            >
              {availableGoogleCalendars.length > 0 ? (
                availableGoogleCalendars.map((gCal) => (
                  <option key={gCal.id} value={gCal.id}>
                    {gCal.summary}
                  </option>
                ))
              ) : (
                <option value="primary">Mi Calendario Principal (Cuenta Classroom)</option>
              )}
            </select>

            <button
              type="button"
              onClick={() => handleSyncSelectedCalendar(selectedGoogleCalendarId)}
              disabled={isAutoDetecting}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-blue-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              title="Sincronizar únicamente el calendario seleccionado en el desplegable"
            >
              <Sparkles className={`w-3 h-3 text-blue-500 ${isAutoDetecting ? 'animate-spin' : ''}`} />
              <span>{isAutoDetecting ? 'Sincronizando...' : 'Sincronizar seleccionado'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowIdGuide(true)}
            className="text-[11px] font-medium text-neutral-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 cursor-pointer"
          >
            <HelpCircle className="w-3 h-3" />
            <span>¿Dónde encuentro la ID?</span>
          </button>
        </div>
      </div>

      {/* Auto-detect notification toast if active */}
      {autoDetectMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2.5 ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="font-medium">{autoDetectMsg}</span>
          </div>
          <button onClick={() => setAutoDetectMsg(null)} className="text-neutral-400 hover:text-neutral-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* VISTA 1: GRILLA OFICIAL CON NOMBRES DE MATERIAS (API OAUTH)    */}
      {/* ------------------------------------------------------------- */}
      {renderMode === 'LIVE_API' ? (
        <div
          className={`rounded-2xl border shadow-sm overflow-hidden flex flex-col ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
          }`}
          style={{ minHeight: '640px' }}
        >
          {/* Sub-header: Date Navigation + Course Legend */}
          <div
            className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToday}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100 shadow-2xs'
                }`}
              >
                Hoy
              </button>
              <div className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={handlePrevPeriod}
                  className={`p-1.5 transition-colors cursor-pointer ${
                    isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-white hover:bg-neutral-100 text-neutral-700'
                  }`}
                  title="Período anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextPeriod}
                  className={`p-1.5 border-l border-neutral-200 dark:border-slate-700 transition-colors cursor-pointer ${
                    isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-white hover:bg-neutral-100 text-neutral-700'
                  }`}
                  title="Período siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <h2 className={`text-sm sm:text-base font-bold ml-1 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                {periodHeaderLabel}
              </h2>
            </div>

            {/* Course pills legend */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {coursesWithSchedules.map(({ course, title }) => {
                const cColor = courseColorMap[course.id] || '#1a73e8';
                return (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => onNavigateToCourseDetail && onNavigateToCourseDetail(course.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer hover:opacity-90 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-neutral-200 text-neutral-800 shadow-2xs'
                    }`}
                    title={`Ir a ${title}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cColor }} />
                    <span className="truncate max-w-[170px]">{title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* WEEK VIEW */}
          {viewMode === 'WEEK' && (
            <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-slate-800 flex-1">
              {weekViewDays.map((dayDate) => {
                const ymd = toLocalYMD(dayDate);
                const isToday = ymd === todayYMD;
                const dayEvents = eventsByDateMap[ymd] || [];
                const dow = dayDate.getDay();

                return (
                  <div
                    key={ymd}
                    className={`flex flex-col min-h-[520px] ${
                      isToday
                        ? isDarkMode
                          ? 'bg-blue-950/15'
                          : 'bg-blue-50/30'
                        : ''
                    }`}
                  >
                    {/* Column Day Header */}
                    <div
                      className={`p-3 border-b text-center ${
                        isDarkMode ? 'border-slate-800 bg-slate-900/60' : 'border-neutral-200 bg-neutral-50/50'
                      }`}
                    >
                      <div
                        className={`text-[11px] font-bold uppercase tracking-wider ${
                          isToday ? 'text-blue-600 dark:text-blue-400' : isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                        }`}
                      >
                        {SHORT_DAYS_ES[dow]}
                      </div>
                      <div
                        className={`mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-extrabold ${
                          isToday
                            ? 'bg-blue-600 text-white shadow-xs'
                            : isDarkMode
                            ? 'text-slate-100'
                            : 'text-neutral-800'
                        }`}
                      >
                        {dayDate.getDate()}
                      </div>
                    </div>

                    {/* Day Events List */}
                    <div className="p-2.5 space-y-2 flex-1">
                      {dayEvents.length === 0 ? (
                        <div className="h-32 flex items-center justify-center text-[11px] text-neutral-400 dark:text-slate-600 italic">
                          Sin eventos
                        </div>
                      ) : (
                        dayEvents.map((ev) => {
                          const accentColor = ev.courseId
                            ? courseColorMap[ev.courseId] || ev.color || '#1a73e8'
                            : ev.color || '#1a73e8';

                          return (
                            <div
                              key={ev.id}
                              onClick={() => setSelectedEventDetail(ev)}
                              className={`group rounded-xl p-2.5 border text-left transition-all cursor-pointer shadow-2xs hover:shadow-md ${
                                isDarkMode
                                  ? 'bg-slate-800/90 hover:bg-slate-800 border-slate-700 text-white'
                                  : 'bg-white hover:bg-blue-50/40 border-neutral-200 text-neutral-900'
                              }`}
                              style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}
                            >
                              {ev.startTime ? (
                                <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 mb-1">
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3 shrink-0" />
                                    {ev.startTime}
                                    {ev.endTime ? ` - ${ev.endTime}` : ''}
                                  </span>
                                  {ev.courseId && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-blue-500/10 text-blue-600 dark:text-blue-300">
                                      Materia
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 mb-1">
                                  Todo el día
                                </div>
                              )}

                              <div className="text-xs font-extrabold leading-snug break-words">
                                {ev.title}
                              </div>

                              {(ev.courseRoom || ev.location) && (
                                <div className="mt-1 flex items-center gap-1 text-[10px] text-neutral-500 dark:text-slate-400">
                                  <MapPin className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate">{ev.location || `Aula ${ev.courseRoom}`}</span>
                                </div>
                              )}

                              {ev.courseId && onNavigateToCourseDetail && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateToCourseDetail(ev.courseId!);
                                  }}
                                  className="mt-2 w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-600/10 hover:bg-blue-600 text-blue-600 dark:text-blue-300 hover:text-white transition-colors cursor-pointer"
                                >
                                  <BookOpen className="w-3 h-3" />
                                  <span>Abrir materia</span>
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MONTH VIEW */}
          {viewMode === 'MONTH' && (
            <div className="flex-1 flex flex-col">
              <div className="grid grid-cols-7 border-b border-neutral-200 dark:border-slate-800">
                {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((d) => (
                  <div
                    key={d}
                    className={`py-2 text-center text-[11px] font-bold uppercase ${
                      isDarkMode ? 'text-slate-400 bg-slate-900' : 'text-neutral-500 bg-neutral-50'
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 flex-1 divide-x divide-y divide-neutral-200 dark:divide-slate-800">
                {dateRange.days.map((dayDate) => {
                  const ymd = toLocalYMD(dayDate);
                  const isCurrentMonth = dayDate.getMonth() === currentDate.getMonth();
                  const isToday = ymd === todayYMD;
                  const dayEvents = eventsByDateMap[ymd] || [];

                  return (
                    <div
                      key={ymd}
                      className={`min-h-[105px] p-1.5 flex flex-col gap-1 ${
                        !isCurrentMonth
                          ? isDarkMode
                            ? 'bg-slate-950/50 opacity-50'
                            : 'bg-neutral-50/80 opacity-60'
                          : ''
                      }`}
                    >
                      <div className="flex justify-end">
                        <span
                          className={`w-6 h-6 rounded-full text-xs font-bold inline-flex items-center justify-center ${
                            isToday
                              ? 'bg-blue-600 text-white'
                              : isDarkMode
                              ? 'text-slate-300'
                              : 'text-neutral-700'
                          }`}
                        >
                          {dayDate.getDate()}
                        </span>
                      </div>
                      <div className="space-y-1 overflow-y-auto max-h-24 pr-0.5">
                        {dayEvents.map((ev) => {
                          const accentColor = ev.courseId
                            ? courseColorMap[ev.courseId] || ev.color || '#1a73e8'
                            : ev.color || '#1a73e8';
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => setSelectedEventDetail(ev)}
                              className="w-full text-left px-1.5 py-0.5 rounded text-[10px] font-bold text-white truncate transition-opacity hover:opacity-90 cursor-pointer"
                              style={{ backgroundColor: accentColor }}
                              title={`${ev.startTime ? `${ev.startTime} ` : ''}${ev.title}`}
                            >
                              {ev.startTime ? `${ev.startTime} ` : ''}
                              {ev.title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AGENDA VIEW */}
          {viewMode === 'AGENDA' && (
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {dateRange.days.map((dayDate) => {
                const ymd = toLocalYMD(dayDate);
                const dayEvents = eventsByDateMap[ymd] || [];
                if (dayEvents.length === 0) return null;
                const isToday = ymd === todayYMD;

                return (
                  <div
                    key={ymd}
                    className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-start gap-4 ${
                      isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
                    }`}
                  >
                    <div className="w-36 shrink-0 flex items-center gap-2.5">
                      <div
                        className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center font-extrabold text-xs ${
                          isToday
                            ? 'bg-blue-600 text-white'
                            : isDarkMode
                            ? 'bg-slate-800 text-slate-200 border border-slate-700'
                            : 'bg-white text-neutral-800 border border-neutral-200'
                        }`}
                      >
                        <span>{dayDate.getDate()}</span>
                        <span className="text-[9px] uppercase">{SHORT_DAYS_ES[dayDate.getDay()]}</span>
                      </div>
                      <div>
                        <div className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                          {FULL_DAYS_ES[dayDate.getDay()]}
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-slate-400">
                          {dayDate.getDate()} de {MONTHS_ES[dayDate.getMonth()]}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-2">
                      {dayEvents.map((ev) => {
                        const accentColor = ev.courseId
                          ? courseColorMap[ev.courseId] || ev.color || '#1a73e8'
                          : ev.color || '#1a73e8';
                        return (
                          <div
                            key={ev.id}
                            onClick={() => setSelectedEventDetail(ev)}
                            className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors ${
                              isDarkMode
                                ? 'bg-slate-900 hover:bg-slate-850 border-slate-700 text-white'
                                : 'bg-white hover:bg-blue-50/30 border-neutral-200 text-neutral-900'
                            }`}
                            style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                  {ev.startTime
                                    ? `${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ''}`
                                    : 'Todo el día'}
                                </span>
                                <span className="text-xs font-extrabold">{ev.title}</span>
                              </div>
                              {(ev.description || ev.location) && (
                                <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                                  {ev.location ? `${ev.location} • ` : ''}
                                  {ev.description}
                                </p>
                              )}
                            </div>

                            {ev.courseId && onNavigateToCourseDetail && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavigateToCourseDetail(ev.courseId!);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs cursor-pointer"
                              >
                                <BookOpen className="w-3.5 h-3.5" />
                                <span>Ir a la materia</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* VISTA 2: IFRAME WEB EMBEBIDO DE GOOGLE CALENDAR               */
        /* ------------------------------------------------------------- */
        <div className="space-y-3">
          <div
            className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isDarkMode
                ? 'bg-amber-950/30 border-amber-800/70 text-amber-200'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  ¿Por qué el widget web de Google a veces muestra «No disponible» en lugar del nombre de la materia?
                </p>
                <p className="text-[11px] opacity-90 mt-0.5">
                  Por privacidad, el visor externo de Google oculta los títulos de calendarios privados como «No disponible». Usá la vista{' '}
                  <strong>Con Nombres de Materias</strong> o hacé clic en{' '}
                  <strong>Poner nombres en Google Calendar</strong> para marcar tus bloques de clase como visibles con el nombre de cada materia.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsConfirmSyncToGoogleOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
              >
                Poner nombres en Google Calendar
              </button>
              <button
                type="button"
                onClick={() => setRenderMode('LIVE_API')}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer"
              >
                Ver con Nombres
              </button>
            </div>
          </div>

          <div
            className={`rounded-2xl border shadow-sm overflow-hidden bg-white ${
              isDarkMode ? 'border-slate-800' : 'border-neutral-200'
            }`}
            style={{ height: isFullscreen ? 'calc(100vh - 220px)' : 'calc(100vh - 310px)', minHeight: '640px' }}
          >
            <iframe
              key={refreshKey}
              title="Google Calendar Oficial"
              src={iframeSrc}
              style={{ border: 0 }}
              width="100%"
              height="100%"
              frameBorder="0"
              scrolling="no"
              className="w-full h-full"
            />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL DE DETALLE DE EVENTO / MATERIA                          */}
      {/* ------------------------------------------------------------- */}
      {selectedEventDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  {selectedEventDetail.courseId ? 'Clase de Materia' : 'Evento de Calendario'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventDetail(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <h3 className="text-base font-extrabold">{selectedEventDetail.title}</h3>

              <div className="flex items-center gap-2 text-neutral-600 dark:text-slate-300">
                <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                <span>
                  {selectedEventDetail.start.slice(0, 10)}{' '}
                  {selectedEventDetail.startTime
                    ? `• ${selectedEventDetail.startTime}${selectedEventDetail.endTime ? ` a ${selectedEventDetail.endTime}` : ''}`
                    : '(Todo el día)'}
                </span>
              </div>

              {(selectedEventDetail.location || selectedEventDetail.courseRoom) && (
                <div className="flex items-center gap-2 text-neutral-600 dark:text-slate-300">
                  <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{selectedEventDetail.location || `Aula ${selectedEventDetail.courseRoom}`}</span>
                </div>
              )}

              {selectedEventDetail.description && (
                <p className="p-3 rounded-xl bg-neutral-100 dark:bg-slate-800 text-neutral-700 dark:text-slate-300 whitespace-pre-line">
                  {selectedEventDetail.description}
                </p>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-slate-800">
                {selectedEventDetail.htmlLink && (
                  <a
                    href={selectedEventDetail.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                        : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ver en Google Calendar</span>
                  </a>
                )}
                {selectedEventDetail.courseId && onNavigateToCourseDetail && (
                  <button
                    type="button"
                    onClick={() => {
                      const cId = selectedEventDetail.courseId!;
                      setSelectedEventDetail(null);
                      onNavigateToCourseDetail(cId);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Ir a la Materia</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL DE CONFIRMACIÓN: ACTUALIZAR NOMBRES EN GOOGLE CALENDAR  */}
      {/* ------------------------------------------------------------- */}
      {isConfirmSyncToGoogleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-5 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Poner nombres de materias en Google Calendar</h3>
                  <p className="text-xs text-neutral-500 dark:text-slate-400">
                    Actualiza tus eventos en Google Calendar para que no figuren como «No disponible»
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmSyncToGoogleOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 dark:text-slate-300 leading-relaxed">
                ¿Confirmás actualizar en tu Google Calendar los bloques horarios de tus materias para que muestren el{' '}
                <strong>nombre de cada materia</strong> con visibilidad pública de título?
              </p>

              {coursesWithSchedules.length > 0 ? (
                <div
                  className={`p-3 rounded-xl border space-y-2 max-h-48 overflow-y-auto ${
                    isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                    Materias y horarios a actualizar ({coursesWithSchedules.length}):
                  </div>
                  {coursesWithSchedules.map(({ course, schedule, title }) => (
                    <div key={course.id} className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0 border-neutral-200/60 dark:border-slate-700/60">
                      <span className="font-bold">{title}</span>
                      <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">{schedule}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                  Aún no hay horarios específicos guardados en las materias. También se actualizará la visibilidad de los eventos existentes en tu calendario.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isPushingCourseNames}
                  onClick={() => setIsConfirmSyncToGoogleOpen(false)}
                  className={`px-3.5 py-2 rounded-xl border font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isPushingCourseNames}
                  onClick={handleConfirmPushCourseNamesToGoogle}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isPushingCourseNames ? (
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{isPushingCourseNames ? 'Actualizando en Google...' : 'Confirmar y Actualizar'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: AGREGAR CALENDARIO POR ID                              */}
      {/* ------------------------------------------------------------- */}
      {isAddByIdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className={`p-5 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50/80'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Agregar Calendario por ID</h2>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Incorpora el calendario oficial del colegio, evaluaciones o materias
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsAddByIdOpen(false)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isDarkMode ? 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCalendar} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                  ID o Correo de Google Calendar *
                </label>
                <input
                  type="text"
                  value={newCalendarId}
                  onChange={(e) => setNewCalendarId(e.target.value)}
                  placeholder="ej: evaluaciones@fds-esc.edu.ar o ...@group.calendar.google.com"
                  autoFocus
                  className={`w-full px-3.5 py-2 rounded-xl border text-xs outline-none font-mono focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                  required
                />
                <p className="text-[11px] text-neutral-500 dark:text-slate-400 mt-1">
                  Puede ser la dirección del calendario compartido del colegio, el correo del calendario de evaluaciones o su ID largo de Google.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                  Nombre para mostrar en tu barra *
                </label>
                <input
                  type="text"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                  placeholder="Ej: Calendario Oficial Colegio, Evaluaciones 2026, 4to Año"
                  className={`w-full px-3.5 py-2 rounded-xl border text-xs outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2 text-neutral-700 dark:text-slate-300">
                  Color con el que se mostrarán sus eventos en la grilla:
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewCalendarColor(c.hex)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                        newCalendarColor === c.hex ? 'ring-2 ring-offset-2 ring-blue-500 scale-110 shadow-sm' : 'hover:scale-105 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    >
                      {newCalendarColor === c.hex && <Check className="w-4 h-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-neutral-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowIdGuide(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>¿Dónde encuentro el ID?</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddByIdOpen(false)}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-semibold ${
                      isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-600/20 transition-all active:scale-95"
                  >
                    Incorporar a mi Calendar
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: EDITAR CALENDARIO EXISTENTE                            */}
      {/* ------------------------------------------------------------- */}
      {editingCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50'}`}>
              <h3 className="text-sm font-bold">Editar Calendario</h3>
              <button
                onClick={() => setEditingCalendar(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Nombre</label>
                <input
                  type="text"
                  value={editingCalendar.name}
                  onChange={(e) => setEditingCalendar({ ...editingCalendar, name: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">ID o Correo de Google</label>
                <input
                  type="text"
                  value={editingCalendar.id}
                  onChange={(e) => setEditingCalendar({ ...editingCalendar, id: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none font-mono ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2">Color</label>
                <div className="flex flex-wrap items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditingCalendar({ ...editingCalendar, color: c.hex })}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        editingCalendar.color === c.hex ? 'ring-2 ring-blue-500 scale-110' : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    >
                      {editingCalendar.color === c.hex && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCalendar(null)}
                  className={`px-3 py-1.5 rounded-lg border text-xs ${
                    isDarkMode ? 'border-slate-700 text-slate-300' : 'border-neutral-200 text-neutral-600'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL GUIA: ¿DONDE ENCONTRAR LA ID DE UN CALENDARIO?          */}
      {/* ------------------------------------------------------------- */}
      {showIdGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className={`p-5 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50'}`}>
              <div className="flex items-center gap-2.5">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                <h3 className="text-sm font-bold">Cómo encontrar el ID en Google Calendar</h3>
              </div>
              <button
                onClick={() => setShowIdGuide(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3.5 text-xs text-neutral-700 dark:text-slate-300 leading-relaxed">
              <p>
                Para vincular el calendario oficial del colegio, el de evaluaciones o cualquier otro que te hayan compartido:
              </p>
              <ol className="list-decimal list-inside space-y-2 pl-1">
                <li>
                  Ingresa a <strong>Google Calendar</strong> en tu computadora con tu cuenta del colegio (<code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-slate-800 font-mono text-[11px]">{userEmail}</code>).
                </li>
                <li>
                  En la columna izquierda, busca el calendario bajo <strong>«Mis calendarios»</strong> u <strong>«Otros calendarios»</strong>.
                </li>
                <li>
                  Pasa el mouse sobre él y haz clic en los <strong>tres puntos (⋮)</strong> &gt; <strong>«Configuración y uso compartido»</strong>.
                </li>
                <li>
                  Baja hasta la sección <strong>«Integrar el calendario»</strong>.
                </li>
                <li>
                  Copia el texto del campo <strong>«ID de calendario»</strong> (ej: <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-slate-800 font-mono text-[11px]">...group.calendar.google.com</code> o la dirección de correo del calendario).
                </li>
                <li>
                  Pégalo en el botón <strong>«+ Agregar calendario por ID»</strong> y quedará superpuesto al instante.
                </li>
              </ol>
            </div>

            <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50'}`}>
              <button
                type="button"
                onClick={() => setShowIdGuide(false)}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarModule;
