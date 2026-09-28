/**
 * Google Calendar Oficial Module
 * Vista exclusiva y directa de Google Calendar oficial.
 * Solo muestra "Mi Calendario Docente" por defecto, con la opción directa
 * de agregar otros calendarios por su ID de Google Calendar (como el calendario
 * oficial del colegio o el de evaluaciones) justo al lado.
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
  Layers,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { calendarService } from '../../services/workspace/calendarService';
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
  color: string;       // Hex color for Google Calendar embed
  enabled: boolean;    // Whether it is visible in the current view
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

export const CalendarModule: React.FC<CalendarModuleProps> = () => {
  const { isDarkMode, user, token, loginWithGoogle } = useWorkspaceAuth();
  const userEmail = user?.email || 'jorge.cano@fds-esc.edu.ar';

  // Load configured calendars: ONLY user calendar by default (no hardcoded presets)
  const [calendars, setCalendars] = useState<ConfiguredCalendar[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Strip out any legacy hardcoded mock presets if present
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

    // Default: ONLY "Mi Calendario Docente"
    return [
      {
        id: userEmail,
        name: 'Mi Calendario Docente',
        color: '#1a73e8', // Blue
        enabled: true,
        isPrimary: true,
        description: 'Clases, horarios y eventos de tu cuenta personal institucional',
      },
    ];
  });

  // Save to localStorage whenever calendars state changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(calendars));
    } catch (_) {}
  }, [calendars]);

  const [viewMode, setViewMode] = useState<GCalViewMode>('WEEK');
  const [refreshKey, setRefreshKey] = useState<number>(Date.now());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Modal / dialog for adding calendar by ID
  const [isAddByIdOpen, setIsAddByIdOpen] = useState<boolean>(false);
  const [newCalendarId, setNewCalendarId] = useState<string>('');
  const [newCalendarName, setNewCalendarName] = useState<string>('');
  const [newCalendarColor, setNewCalendarColor] = useState<string>('#0d904f'); // Green default for 2nd calendar
  const [newCalendarDesc, setNewCalendarDesc] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Quick guide modal
  const [showIdGuide, setShowIdGuide] = useState<boolean>(false);

  // Auto-detection state
  const [isAutoDetecting, setIsAutoDetecting] = useState<boolean>(false);
  const [autoDetectMsg, setAutoDetectMsg] = useState<string | null>(null);

  // Edit Calendar state
  const [editingCalendar, setEditingCalendar] = useState<ConfiguredCalendar | null>(null);

  // Active calendars for the iframe
  const enabledCalendars = useMemo(() => {
    const list = calendars.filter((c) => c.enabled && c.id.trim().length > 0);
    if (list.length === 0 && calendars.length > 0) {
      return [calendars[0]];
    }
    return list;
  }, [calendars]);

  // Google Calendar Embed URL constructed with multiple &src= parameters
  const iframeSrc = useMemo(() => {
    const base = 'https://calendar.google.com/calendar/embed?ctz=America%2FArgentina%2FBuenos_Aires&showTitle=0&showNav=1&showDate=1&showPrint=1&showTabs=1&showCalendars=1';
    const viewParam = `&mode=${viewMode}`;

    const calendarParams = enabledCalendars
      .map((c) => `&src=${encodeURIComponent(c.id.trim())}&color=${encodeURIComponent(c.color || '#1a73e8')}`)
      .join('');

    return `${base}${viewParam}${calendarParams}`;
  }, [enabledCalendars, viewMode]);

  // Toggle calendar visibility
  const toggleCalendar = (id: string) => {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
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

    // Auto-generate name if user left it blank
    if (!cleanName) {
      if (cleanId.includes('@')) {
        const prefix = cleanId.split('@')[0];
        cleanName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      } else {
        cleanName = 'Calendario Incorporado';
      }
    }

    // Check duplicate ID
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

    setCalendars((prev) =>
      prev.map((c) => (c.id === editingCalendar.id ? editingCalendar : c))
    );
    setEditingCalendar(null);
    setRefreshKey(Date.now());
  };

  // Handle Delete Calendar
  const handleDeleteCalendar = (id: string) => {
    if (calendars.length <= 1) {
      alert('Debes conservar al menos tu calendario principal.');
      return;
    }
    setCalendars((prev) => prev.filter((c) => c.id !== id));
    setRefreshKey(Date.now());
  };

  // Auto-detect calendars from Google Workspace API (optional helper)
  const handleAutoDetect = async () => {
    setIsAutoDetecting(true);
    setAutoDetectMsg(null);

    try {
      const result = await calendarService.listCalendars();

      if (result.success && result.calendars && result.calendars.length > 0) {
        setCalendars((prev) => {
          const currentIds = new Set(prev.map((c) => c.id.toLowerCase()));
          const newOnes: ConfiguredCalendar[] = [];

          result.calendars.forEach((gCal: GoogleCalendarInfo, idx: number) => {
            if (!currentIds.has(gCal.id.toLowerCase())) {
              newOnes.push({
                id: gCal.id,
                name: gCal.summary,
                color: gCal.backgroundColor || PRESET_COLORS[(idx + 1) % PRESET_COLORS.length].hex,
                enabled: true,
                isPrimary: !!gCal.primary,
                description: gCal.description || undefined,
              });
            }
          });

          return [...prev, ...newOnes];
        });

        setAutoDetectMsg(`¡Se incorporaron los calendarios disponibles de tu cuenta de Google!`);
        setRefreshKey(Date.now());
      } else {
        setAutoDetectMsg(
          result.message || 'No se detectaron calendarios adicionales. Puedes agregarlos por ID directamente.'
        );
      }
    } catch (err: any) {
      setAutoDetectMsg('Puedes agregar directamente el ID de cualquier calendario de Google.');
    } finally {
      setIsAutoDetecting(false);
      setTimeout(() => setAutoDetectMsg(null), 6000);
    }
  };

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 p-4 bg-white dark:bg-slate-950 overflow-auto' : ''}`}>
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER: TITULO, CONTROLES DE VISTA Y ACCIONES             */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`p-5 rounded-2xl border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
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
                Oficial y en tiempo real
              </span>
            </div>
            <p className={`text-xs mt-0.5 flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>
                {enabledCalendars.length === 1 ? '1 calendario activo' : `${enabledCalendars.length} calendarios superpuestos`} • Zona horaria: America/Argentina/Buenos_Aires (GMT-3)
              </span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode switch buttons (Semana / Mes / Agenda) */}
          <div
            className={`inline-flex p-1 rounded-xl border text-xs font-semibold ${
              isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              onClick={() => setViewMode('WEEK')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
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
              onClick={() => setViewMode('MONTH')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
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
              onClick={() => setViewMode('AGENDA')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
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

          {/* Refresh iframe */}
          <button
            onClick={() => setRefreshKey(Date.now())}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 shadow-sm'
            }`}
            title="Recargar vista de Google Calendar"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          {/* Toggle Fullscreen */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
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
          {/* List of Calendars (Starting with Mi Calendario Docente) */}
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
              {/* Click to toggle on/off */}
              <button
                type="button"
                onClick={() => toggleCalendar(cal.id)}
                className="inline-flex items-center gap-2 outline-none"
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

              {/* Action for custom added calendars: Edit or Delete */}
              {!cal.isPrimary && (
                <div className="flex items-center gap-1 border-l pl-1.5 border-neutral-200 dark:border-slate-700 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditingCalendar({ ...cal })}
                    className="p-1 hover:text-blue-500 rounded transition-colors"
                    title="Editar nombre o color"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCalendar(cal.id)}
                    className="p-1 hover:text-rose-500 rounded transition-colors"
                    title="Eliminar este calendario"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* BOTON SOLICITADO: Agregar calendario por ID DIRECTAMENTE AL LADO */}
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setIsAddByIdOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/50 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/70 font-semibold text-xs shadow-sm transition-all active:scale-95"
            title="Incorpora el calendario oficial del colegio, de evaluaciones o de materias pegando su ID de Google Calendar"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>+ Agregar calendario por ID</span>
          </button>
        </div>

        {/* Right side helper links */}
        <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
          {token && (
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={isAutoDetecting}
              className="text-[11px] font-medium text-neutral-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
              title="Detectar automáticamente otros calendarios que ya tengas en tu cuenta de Google"
            >
              <Sparkles className={`w-3 h-3 text-blue-500 ${isAutoDetecting ? 'animate-spin' : ''}`} />
              <span>{isAutoDetecting ? 'Detectando...' : 'Detectar de mi cuenta'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowIdGuide(true)}
            className="text-[11px] font-medium text-neutral-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
          >
            <HelpCircle className="w-3 h-3" />
            <span>¿Dónde encuentro la ID?</span>
          </button>
        </div>
      </div>

      {/* Auto-detect notification toast if active */}
      {autoDetectMsg && (
        <div className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2.5 ${isDarkMode ? 'bg-blue-950/40 border-blue-800 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-900'}`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
            <span>{autoDetectMsg}</span>
          </div>
          <button onClick={() => setAutoDetectMsg(null)} className="text-neutral-400 hover:text-neutral-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* IFRAME PRINCIPAL DE GOOGLE CALENDAR OFICIAL                    */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden bg-white ${
          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
        }`}
        style={{ height: isFullscreen ? 'calc(100vh - 180px)' : 'calc(100vh - 270px)', minHeight: '680px' }}
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
            {/* Header */}
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

            {/* Form */}
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
