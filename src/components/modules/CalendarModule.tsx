/**
 * Google Calendar Oficial Module
 * Permite visualizar e incorporar múltiples calendarios de Google (por ID o correo)
 * directamente en el visor embebido oficial de Google Calendar, garantizando que
 * tome la cuenta institucional del colegio (jorge.cano@fds-esc.edu.ar) para mostrar
 * todos los eventos con sus nombres e información completa sin tocar el calendario personal.
 */

import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { calendarService } from '../../services/workspace/calendarService';
import { getUserStorageKey, isPrimaryOwnerAccount } from '../../services/storageHelpers';
import { GoogleCalendarInfo, Course } from '../../types';

export interface CalendarModuleProps {
  courses?: Course[];
  selectedCourseId?: string;
  onSelectCourse?: (courseId: string) => void;
  onNavigateToCourseDetail?: (courseId: string) => void;
}

export interface ConfiguredCalendar {
  id: string;          // Google Calendar ID or email address
  name: string;        // Human readable name (e.g., "Evaluaciones", "Colegio Oficial")
  color: string;       // Hex color for Google Calendar (&color=%23...)
  enabled: boolean;    // Whether it is visible in the embedded iframe
  isPrimary?: boolean; // Primary user calendar
  description?: string;
}

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

const STORAGE_KEY = 'fds_google_calendars_configured_v3';

type GCalViewMode = 'WEEK' | 'MONTH' | 'AGENDA';

/**
 * Resuelve el correo institucional del docente.
 * Si es el docente propietario titular en su Gmail de desarrollo, redirige a su cuenta oficial de escuela.
 * Si es cualquier otro colega docente, respeta su cuenta autenticada.
 */
const resolveInstitutionalCalendarEmail = (email?: string): string => {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || clean === 'primary') {
    return 'jorge.cano@fds-esc.edu.ar';
  }
  if (clean.startsWith('canomorenojj@') || clean.startsWith('jorge.cano@')) {
    return 'jorge.cano@fds-esc.edu.ar';
  }
  return clean;
};

const normalizeConfiguredCalendars = (
  list: ConfiguredCalendar[],
  schoolEmail: string
): ConfiguredCalendar[] => {
  const filtered = list.filter(
    (c: any) =>
      c &&
      c.id !== 'colegio@fds-esc.edu.ar' &&
      c.id !== 'evaluaciones@fds-esc.edu.ar' &&
      c.id !== 'es.ar#holiday@group.v.calendar.google.com'
  );

  if (filtered.length === 0) {
    return [
      {
        id: schoolEmail,
        name: 'Mi Calendario Docente (Colegio)',
        color: '#1a73e8',
        enabled: true,
        isPrimary: true,
        description: `Clases, horarios y eventos de ${schoolEmail}`,
      },
    ];
  }

  return filtered.map((c, idx) => {
    const cleanId = (c.id || '').trim().toLowerCase();
    // Si el calendario principal había quedado con el Gmail personal o 'primary', restaurar al del colegio
    if (
      c.isPrimary ||
      idx === 0 ||
      cleanId === 'primary' ||
      cleanId === 'canomorenojj@gmail.com'
    ) {
      return {
        ...c,
        id: schoolEmail,
        name:
          c.name && !c.name.toLowerCase().includes('canomorenojj')
            ? c.name
            : 'Mi Calendario Docente (Colegio)',
        isPrimary: true,
        description: `Clases, horarios y eventos de ${schoolEmail}`,
      };
    }
    return c;
  });
};

export const CalendarModule: React.FC<CalendarModuleProps> = () => {
  const { isDarkMode, user, token, loginWithGoogle } = useWorkspaceAuth();
  const institutionalEmail = resolveInstitutionalCalendarEmail(user?.email);

  // Load configured calendars: school calendar by default, user-scoped storage
  const [calendars, setCalendars] = useState<ConfiguredCalendar[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const scopedKey = getUserStorageKey(STORAGE_KEY);
        const saved =
          localStorage.getItem(scopedKey) ||
          (isPrimaryOwnerAccount() ? localStorage.getItem(STORAGE_KEY) : null);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return normalizeConfiguredCalendars(parsed, institutionalEmail);
          }
        }
      } catch (_) {}
    }

    return [
      {
        id: institutionalEmail,
        name: 'Mi Calendario Docente (Colegio)',
        color: '#1a73e8',
        enabled: true,
        isPrimary: true,
        description: `Clases, horarios y eventos de ${institutionalEmail}`,
      },
    ];
  });

  // Ensure primary calendar ID always uses the institutional school account (never overwritten by personal Gmail)
  useEffect(() => {
    setCalendars((prev) => {
      const normalized = normalizeConfiguredCalendars(prev, institutionalEmail);
      const changed = JSON.stringify(normalized) !== JSON.stringify(prev);
      return changed ? normalized : prev;
    });
  }, [institutionalEmail]);

  const [hasHydratedFromCloud, setHasHydratedFromCloud] = useState<boolean>(false);

  // Hydrate configured calendars from Firestore cloud on mount
  useEffect(() => {
    let mounted = true;
    import('../../services/firestoreSync')
      .then(async ({ firestoreSync, getActiveUserId }) => {
        const uid = getActiveUserId();
        if (!uid) return;
        const cloudCals = await firestoreSync.loadUserSetting<ConfiguredCalendar[]>(
          uid,
          'google_calendars_configured'
        );
        if (mounted && Array.isArray(cloudCals) && cloudCals.length > 0) {
          const updated = normalizeConfiguredCalendars(cloudCals, institutionalEmail);
          setCalendars(updated);
          try {
            const scopedKey = getUserStorageKey(STORAGE_KEY);
            localStorage.setItem(scopedKey, JSON.stringify(updated));
            if (isPrimaryOwnerAccount()) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            }
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
  }, [user?.id, institutionalEmail]);

  // Save to localStorage and Firestore whenever calendars state changes
  useEffect(() => {
    try {
      const scopedKey = getUserStorageKey(STORAGE_KEY);
      localStorage.setItem(scopedKey, JSON.stringify(calendars));
      if (isPrimaryOwnerAccount()) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(calendars));
      }
    } catch (_) {}
    if (!hasHydratedFromCloud) return;
    import('../../services/firestoreSync')
      .then(({ firestoreSync, getActiveUserId }) => {
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync
            .saveUserSetting(uid, 'google_calendars_configured', calendars)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [calendars, hasHydratedFromCloud]);

  const [viewMode, setViewMode] = useState<GCalViewMode>('WEEK');
  const [refreshKey, setRefreshKey] = useState<number>(Date.now());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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
  const [selectedGoogleCalendarId, setSelectedGoogleCalendarId] = useState<string>(institutionalEmail);

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
          // Filtrar el Gmail personal si estamos usando la cuenta del colegio
          const schoolFirst = res.calendars.filter(
            (c) => String(c.id || '').toLowerCase() !== 'canomorenojj@gmail.com'
          );
          const listToUse = schoolFirst.length > 0 ? schoolFirst : res.calendars;
          setAvailableGoogleCalendars(listToUse);
          const schoolCal =
            listToUse.find((c) => String(c.id || '').toLowerCase().includes('@fds-esc.edu.ar')) ||
            listToUse.find((c) => c.primary) ||
            listToUse[0];
          if (schoolCal) {
            setSelectedGoogleCalendarId(
              String(schoolCal.id || '').toLowerCase() === 'canomorenojj@gmail.com'
                ? institutionalEmail
                : schoolCal.id
            );
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [token, institutionalEmail]);

  // Active calendars for the embedded iframe
  const enabledCalendars = useMemo(() => {
    const list = calendars.filter((c) => c.enabled && c.id.trim().length > 0);
    if (list.length === 0 && calendars.length > 0) {
      return [calendars[0]];
    }
    return list;
  }, [calendars]);

  // Google Calendar Embed URL constructed with authuser=<school_email> and multiple &src= parameters
  // Incluir authuser=jorge.cano@fds-esc.edu.ar hace que el widget oficial de Google Calendar
  // se autentique con la sesión del colegio y muestre los nombres reales e información de cada evento
  // en lugar de "No disponible" (que ocurría cuando el navegador abría el iframe con la cuenta personal u/0).
  const iframeSrc = useMemo(() => {
    const base = `https://calendar.google.com/calendar/embed?authuser=${encodeURIComponent(
      institutionalEmail
    )}&ctz=America%2FArgentina%2FBuenos_Aires&showTitle=0&showNav=1&showDate=1&showPrint=1&showTabs=1&showCalendars=1&hl=es`;
    const viewParam = `&mode=${viewMode}`;

    const calendarParams = enabledCalendars
      .map((c) => {
        const cleanId = c.id.trim();
        const srcId =
          c.isPrimary ||
          cleanId === 'primary' ||
          cleanId.toLowerCase() === 'canomorenojj@gmail.com'
            ? institutionalEmail
            : cleanId;
        return `&src=${encodeURIComponent(srcId)}&color=${encodeURIComponent(c.color || '#1a73e8')}`;
      })
      .join('');

    return `${base}${viewParam}${calendarParams}`;
  }, [enabledCalendars, viewMode, institutionalEmail]);

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
      setAutoDetectMsg('Debes conservar al menos tu calendario principal del colegio.');
      setTimeout(() => setAutoDetectMsg(null), 4000);
      return;
    }
    setCalendars((prev) => prev.filter((c) => c.id !== id));
    setRefreshKey(Date.now());
  };

  // Sync ONLY the single selected calendar from dropdown (never importing all calendars in bulk)
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

      const targetId = overrideCalendarId || selectedGoogleCalendarId || institutionalEmail;
      const chosenCal =
        list.find((c) => c.id === targetId || (targetId === 'primary' && c.primary)) || list[0];

      if (!chosenCal) {
        setAutoDetectMsg('Selecciona un calendario válido de la lista.');
        return;
      }

      const rawId = (chosenCal.id || '').trim();
      const effectiveId =
        chosenCal.primary ||
        rawId === 'primary' ||
        rawId.toLowerCase() === 'canomorenojj@gmail.com'
          ? institutionalEmail
          : rawId;

      setCalendars((prev) => {
        const exists = prev.some(
          (c) =>
            c.id.toLowerCase() === effectiveId.toLowerCase() ||
            c.id.toLowerCase() === rawId.toLowerCase()
        );
        if (exists) {
          return prev.map((c) =>
            c.id.toLowerCase() === effectiveId.toLowerCase() ||
            c.id.toLowerCase() === rawId.toLowerCase()
              ? {
                  ...c,
                  id: effectiveId,
                  enabled: true,
                  name:
                    effectiveId === institutionalEmail
                      ? 'Mi Calendario Docente (Colegio)'
                      : chosenCal.summary || c.name,
                }
              : c
          );
        }
        return [
          ...prev,
          {
            id: effectiveId,
            name:
              effectiveId === institutionalEmail
                ? 'Mi Calendario Docente (Colegio)'
                : chosenCal.summary,
            color:
              chosenCal.backgroundColor ||
              PRESET_COLORS[(prev.length + 1) % PRESET_COLORS.length].hex,
            enabled: true,
            isPrimary: !!chosenCal.primary,
            description: chosenCal.description || undefined,
          },
        ];
      });

      setAutoDetectMsg(`¡Calendario "${effectiveId}" sincronizado y activado en el widget!`);
      setRefreshKey(Date.now());
    } catch (_) {
      setAutoDetectMsg('Error al sincronizar el calendario seleccionado.');
    } finally {
      setIsAutoDetecting(false);
      setTimeout(() => setAutoDetectMsg(null), 5000);
    }
  };

  return (
    <div
      className={`space-y-4 ${
        isFullscreen ? 'fixed inset-0 z-50 p-4 bg-white dark:bg-slate-950 overflow-auto' : ''
      }`}
    >
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
              <h1
                className={`text-lg font-bold tracking-tight ${
                  isDarkMode ? 'text-white' : 'text-neutral-900'
                }`}
              >
                Google Calendar Oficial
              </h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Cuenta Colegio: {institutionalEmail}
              </span>
            </div>
            <p
              className={`text-xs mt-0.5 flex items-center gap-1.5 ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>
                {enabledCalendars.length === 1
                  ? `1 calendario activo en el visor (${enabledCalendars[0].id})`
                  : `${enabledCalendars.length} calendarios superpuestos en el visor`}
              </span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Selector (Semana / Mes / Agenda) */}
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

          {/* Selector de calendario específico de la cuenta vinculada a Classroom */}
          <div className="flex items-center gap-1.5">
            {availableGoogleCalendars.length > 0 && (
              <select
                value={selectedGoogleCalendarId}
                onChange={(e) => setSelectedGoogleCalendarId(e.target.value)}
                className={`px-2.5 py-2 rounded-xl text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500/40 max-w-[220px] truncate ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-white border-neutral-200 text-neutral-700'
                }`}
                title="Elegir calendario específico de tu cuenta de Google"
              >
                {availableGoogleCalendars.map((gcal) => (
                  <option key={gcal.id} value={gcal.id}>
                    {gcal.summary}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => handleSyncSelectedCalendar()}
              disabled={isAutoDetecting}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-xs ${
                isDarkMode
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/80'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
              }`}
              title="Sincronizar únicamente el calendario elegido (vinculado al colegio)"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAutoDetecting ? 'animate-spin' : ''}`} />
              <span>{isAutoDetecting ? 'Sincronizando...' : 'Sincronizar este calendario'}</span>
            </button>
          </div>

          {/* Add Calendar by ID Button */}
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setIsAddByIdOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Incorporar por ID</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => setRefreshKey(Date.now())}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
            }`}
            title="Recargar visor de Google Calendar"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Recargar</span>
          </button>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
            }`}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Open in New Tab (forcing institutional school account) */}
          <a
            href={`https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(
              institutionalEmail
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-blue-400 border-slate-700'
                : 'bg-blue-50/70 hover:bg-blue-100/80 text-blue-700 border-blue-200'
            }`}
            title={`Abrir Google Calendar de ${institutionalEmail}`}
          >
            <span>Abrir en Google</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* BARRA DE CALENDARIOS INCORPORADOS (PÍLDORAS ACTIVABLES)       */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`px-5 py-3.5 rounded-2xl border shadow-xs flex flex-col gap-3 transition-colors ${
          isDarkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold uppercase tracking-wider ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              Calendarios Incorporados ({calendars.length}):
            </span>
          </div>

          {autoDetectMsg && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
              {autoDetectMsg}
            </span>
          )}
        </div>

        {/* List of Calendar Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {calendars.map((cal) => {
            const displayId =
              cal.isPrimary ||
              cal.id === 'primary' ||
              cal.id.toLowerCase() === 'canomorenojj@gmail.com'
                ? institutionalEmail
                : cal.id;
            return (
              <div
                key={cal.id}
                className={`group inline-flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl border text-xs transition-all ${
                  cal.enabled
                    ? isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white shadow-2xs'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 shadow-2xs'
                    : isDarkMode
                    ? 'bg-slate-900/40 border-slate-800/80 text-slate-500 opacity-60'
                    : 'bg-neutral-100/50 border-neutral-200/70 text-neutral-400 opacity-60'
                }`}
              >
                {/* Toggle Switch / Color Dot */}
                <button
                  type="button"
                  onClick={() => toggleCalendar(cal.id)}
                  className="flex items-center gap-2 cursor-pointer text-left"
                  title={
                    cal.enabled
                      ? `Ocultar "${cal.name}" (${displayId})`
                      : `Mostrar "${cal.name}" (${displayId})`
                  }
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{
                      backgroundColor: cal.enabled ? cal.color : 'transparent',
                      border: `2px solid ${cal.color}`,
                    }}
                  >
                    {cal.enabled && <Check className="w-2 h-2 text-white stroke-[3]" />}
                  </span>
                  <span className="font-semibold truncate max-w-[180px]">{cal.name}</span>
                  <span
                    className={`text-[10px] hidden sm:inline truncate max-w-[160px] ${
                      isDarkMode ? 'text-slate-400' : 'text-neutral-400'
                    }`}
                  >
                    ({displayId})
                  </span>
                </button>

                {/* Quick Actions: Visibility, Edit, Delete */}
                <div className="flex items-center gap-0.5 pl-1 border-l border-neutral-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => toggleCalendar(cal.id)}
                    className="p-1 rounded-md hover:bg-neutral-200/60 dark:hover:bg-slate-700/60 text-neutral-400 hover:text-neutral-700 dark:hover:text-slate-200 cursor-pointer"
                    title={cal.enabled ? 'Ocultar del visor' : 'Mostrar en el visor'}
                  >
                    {cal.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCalendar(cal)}
                    className="p-1 rounded-md hover:bg-neutral-200/60 dark:hover:bg-slate-700/60 text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                    title="Editar nombre, ID o color"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  {!cal.isPrimary && calendars.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCalendar(cal.id)}
                      className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                      title="Quitar calendario"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* VISOR EMBEBIDO OFICIAL DE GOOGLE CALENDAR (WIDGET ORIGINAL)   */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`rounded-2xl border overflow-hidden shadow-sm transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="relative w-full" style={{ height: isFullscreen ? 'calc(100vh - 210px)' : '720px' }}>
          <iframe
            key={`${refreshKey}-${viewMode}-${iframeSrc}`}
            src={iframeSrc}
            title="Google Calendar Oficial"
            className="w-full h-full border-0"
            style={{
              colorScheme: 'light',
              backgroundColor: '#ffffff',
            }}
            allowFullScreen
          />
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* MODAL: INCORPORAR CALENDARIO POR ID                           */}
      {/* ------------------------------------------------------------- */}
      {isAddByIdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Incorporar Calendario por ID</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Agrega otro calendario institucional, de curso o compartido
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddByIdOpen(false)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCalendar} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  ID del Calendario o Correo de Google *
                </label>
                <input
                  type="text"
                  value={newCalendarId}
                  onChange={(e) => setNewCalendarId(e.target.value)}
                  placeholder="ej: evaluaciones@fds-esc.edu.ar o ...@group.calendar.google.com"
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Nombre identificatorio (opcional)
                </label>
                <input
                  type="text"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                  placeholder="ej: Mesas de Examen / Actos Escolares / 4° Año"
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Color en el visor</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewCalendarColor(c.hex)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                        newCalendarColor === c.hex
                          ? 'scale-110 ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-slate-900'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    >
                      {newCalendarColor === c.hex && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-xs font-medium text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddByIdOpen(false)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm cursor-pointer"
                >
                  Incorporar al Calendario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: EDITAR CALENDARIO EXISTENTE                            */}
      {/* ------------------------------------------------------------- */}
      {editingCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Editar Calendario</h3>
              <button
                type="button"
                onClick={() => setEditingCalendar(null)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5">Nombre</label>
                <input
                  type="text"
                  value={editingCalendar.name}
                  onChange={(e) =>
                    setEditingCalendar({ ...editingCalendar, name: e.target.value })
                  }
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">ID / Correo de Google</label>
                <input
                  type="text"
                  value={editingCalendar.id}
                  onChange={(e) =>
                    setEditingCalendar({ ...editingCalendar, id: e.target.value })
                  }
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Color</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditingCalendar({ ...editingCalendar, color: c.hex })}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                        editingCalendar.color === c.hex
                          ? 'scale-110 ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-slate-900'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    >
                      {editingCalendar.color === c.hex && (
                        <Check className="w-3.5 h-3.5 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCalendar(null)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm cursor-pointer"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
