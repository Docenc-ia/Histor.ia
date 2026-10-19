import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Clock,
  RotateCcw,
  Save,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  CalendarDays,
} from 'lucide-react';
import { Course, Student, StudentDispositionData } from '../../../types';
import {
  AttendanceSettings,
  DEFAULT_ATTENDANCE_SETTINGS,
  calculateWeeksBetweenDates,
  getGlobalAttendanceSettings,
  saveGlobalAttendanceSettings,
} from '../../../utils/attendanceCalculations';
import {
  SchoolHolidayItem,
  WEEKDAY_LABELS,
  detectHolidaysForCourse,
} from '../../../utils/schoolHolidays';

interface AttendanceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  course?: Course | null;
  currentSettings?: AttendanceSettings;
  onSaveSettings?: (settings: AttendanceSettings, updatedSchedule?: string) => void;
  students?: Student[];
  studentMetricsMap?: Record<string, StudentDispositionData>;
  currentTerm?: '1c' | '2c' | 'annual';
  isDarkMode: boolean;
}

export const AttendanceSettingsModal: React.FC<AttendanceSettingsModalProps> = ({
  isOpen,
  onClose,
  course,
  currentSettings: propSettings,
  onSaveSettings,
  isDarkMode,
}) => {
  // Always initialize from global shared calendar settings as the master source
  const baseSettings = useMemo(() => {
    return propSettings || getGlobalAttendanceSettings();
  }, [propSettings]);

  const [weeks1c, setWeeks1c] = useState<number>(baseSettings.weeks1c);
  const [weeks2c, setWeeks2c] = useState<number>(baseSettings.weeks2c);
  const [maxAbsencePercent, setMaxAbsencePercent] = useState<number>(baseSettings.maxAbsencePercent);
  const [halfLatePenalty, setHalfLatePenalty] = useState<boolean>(baseSettings.halfLatePenalty);
  const [holidays1c, setHolidays1c] = useState<number>(baseSettings.holidays1c || 0);
  const [holidays2c, setHolidays2c] = useState<number>(baseSettings.holidays2c || 0);

  // Term date boundaries
  const [startDate1c, setStartDate1c] = useState<string>(baseSettings.termStartDate1c || '2026-03-02');
  const [endDate1c, setEndDate1c] = useState<string>(baseSettings.termEndDate1c || '2026-07-10');
  const [startDate2c, setStartDate2c] = useState<string>(baseSettings.termStartDate2c || '2026-08-03');
  const [endDate2c, setEndDate2c] = useState<string>(baseSettings.termEndDate2c || '2026-12-04');

  // School-wide events and custom holidays
  const [customHolidays, setCustomHolidays] = useState<SchoolHolidayItem[]>(
    baseSettings.customHolidays || []
  );
  const [excludedHolidayIds, setExcludedHolidayIds] = useState<string[]>(
    baseSettings.excludedHolidayIds || []
  );
  const [showHolidayBreakdown, setShowHolidayBreakdown] = useState<boolean>(true);

  // Form to add custom school event / jornada
  const [isAddingCustom, setIsAddingCustom] = useState<boolean>(false);
  const [newEventName, setNewEventName] = useState<string>('');
  const [newEventDate, setNewEventDate] = useState<string>('2026-05-15');
  const [newEventTerm, setNewEventTerm] = useState<'1c' | '2c'>('1c');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Common school week includes all days of the school week (Lunes a Sábado)
  const allSchoolWeekdays = useMemo(() => [1, 2, 3, 4, 5, 6], []);

  // Compute detected holidays reactively across all school days
  const detectedInfo = useMemo(() => {
    return detectHolidaysForCourse({
      explicitWeekdays: allSchoolWeekdays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays,
      excludedHolidayIds,
    });
  }, [allSchoolWeekdays, startDate1c, endDate1c, startDate2c, endDate2c, customHolidays, excludedHolidayIds]);

  useEffect(() => {
    if (isOpen) {
      const active = getGlobalAttendanceSettings();
      setWeeks1c(active.weeks1c);
      setWeeks2c(active.weeks2c);
      setMaxAbsencePercent(active.maxAbsencePercent);
      setHalfLatePenalty(active.halfLatePenalty);
      setStartDate1c(active.termStartDate1c || '2026-03-02');
      setEndDate1c(active.termEndDate1c || '2026-07-10');
      setStartDate2c(active.termStartDate2c || '2026-08-03');
      setEndDate2c(active.termEndDate2c || '2026-12-04');

      const customHols = active.customHolidays || [];
      const excludedHols = active.excludedHolidayIds || [];
      setCustomHolidays(customHols);
      setExcludedHolidayIds(excludedHols);

      const auto = detectHolidaysForCourse({
        explicitWeekdays: [1, 2, 3, 4, 5, 6],
        termStartDate1c: active.termStartDate1c,
        termEndDate1c: active.termEndDate1c,
        termStartDate2c: active.termStartDate2c,
        termEndDate2c: active.termEndDate2c,
        customHolidays: customHols,
        excludedHolidayIds: excludedHols,
      });

      setHolidays1c(active.holidays1c !== undefined && active.holidays1c > 0 ? active.holidays1c : auto.holidays1cCount);
      setHolidays2c(active.holidays2c !== undefined && active.holidays2c > 0 ? active.holidays2c : auto.holidays2cCount);
      setStatusNotice(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Auto calculate weeks when dates change
  const handleCalculateWeeksFromDates1c = () => {
    const calculated = calculateWeeksBetweenDates(startDate1c, endDate1c, 16);
    setWeeks1c(calculated);
  };

  const handleCalculateWeeksFromDates2c = () => {
    const calculated = calculateWeeksBetweenDates(startDate2c, endDate2c, 16);
    setWeeks2c(calculated);
  };

  // Toggle individual holiday inclusion/exclusion
  const handleToggleHolidayInclusion = (id: string) => {
    const nextExcluded = excludedHolidayIds.includes(id)
      ? excludedHolidayIds.filter((x) => x !== id)
      : [...excludedHolidayIds, id];

    setExcludedHolidayIds(nextExcluded);

    const res = detectHolidaysForCourse({
      explicitWeekdays: allSchoolWeekdays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays,
      excludedHolidayIds: nextExcluded,
    });
    setHolidays1c(res.holidays1cCount);
    setHolidays2c(res.holidays2cCount);
  };

  // Apply auto-detected holiday counts to inputs
  const handleApplyDetectedHolidays = () => {
    setHolidays1c(detectedInfo.holidays1cCount);
    setHolidays2c(detectedInfo.holidays2cCount);
    setStatusNotice(
      `¡Feriados oficiales actualizados! ${detectedInfo.holidays1cCount} días en 1°C y ${detectedInfo.holidays2cCount} días en 2°C para el calendario común.`
    );
  };

  // Add custom school event / jornada
  const handleAddCustomEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim() || !newEventDate) return;
    const d = new Date(newEventDate + 'T12:00:00');
    const dow = d.getDay();
    const item: SchoolHolidayItem = {
      id: `custom_${Date.now()}`,
      date: newEventDate,
      name: newEventName.trim(),
      term: newEventTerm,
      type: 'asueto',
      dayOfWeek: dow,
      dayName: WEEKDAY_LABELS[dow] || 'Día',
      description: 'Evento escolar / jornada agregada por el docente',
    };
    const nextCustom = [...customHolidays, item];
    setCustomHolidays(nextCustom);
    setNewEventName('');
    setIsAddingCustom(false);

    const res = detectHolidaysForCourse({
      explicitWeekdays: allSchoolWeekdays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays: nextCustom,
      excludedHolidayIds,
    });
    setHolidays1c(res.holidays1cCount);
    setHolidays2c(res.holidays2cCount);
  };

  // Delete custom event
  const handleDeleteCustomEvent = (id: string) => {
    const nextCustom = customHolidays.filter((h) => h.id !== id);
    setCustomHolidays(nextCustom);

    const res = detectHolidaysForCourse({
      explicitWeekdays: allSchoolWeekdays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays: nextCustom,
      excludedHolidayIds,
    });
    setHolidays1c(res.holidays1cCount);
    setHolidays2c(res.holidays2cCount);
  };

  const handleResetToDefaults = () => {
    setWeeks1c(DEFAULT_ATTENDANCE_SETTINGS.weeks1c);
    setWeeks2c(DEFAULT_ATTENDANCE_SETTINGS.weeks2c);
    setMaxAbsencePercent(DEFAULT_ATTENDANCE_SETTINGS.maxAbsencePercent);
    setHalfLatePenalty(DEFAULT_ATTENDANCE_SETTINGS.halfLatePenalty);
    setStartDate1c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate1c || '2026-03-02');
    setEndDate1c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate1c || '2026-07-10');
    setStartDate2c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate2c || '2026-08-03');
    setEndDate2c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate2c || '2026-12-04');
    setCustomHolidays([]);
    setExcludedHolidayIds([]);

    const auto = detectHolidaysForCourse({
      explicitWeekdays: allSchoolWeekdays,
    });
    setHolidays1c(auto.holidays1cCount);
    setHolidays2c(auto.holidays2cCount);
    setStatusNotice('Calendario y feriados oficiales 2026 restablecidos para todas las materias.');
  };

  // Active settings for saving
  const activeSettings: AttendanceSettings = {
    weeks1c,
    weeks2c,
    classesPerWeek: baseSettings.classesPerWeek || 2,
    maxAbsencePercent,
    halfLatePenalty,
    holidays1c,
    holidays2c,
    termStartDate1c: startDate1c,
    termEndDate1c: endDate1c,
    termStartDate2c: startDate2c,
    termEndDate2c: endDate2c,
    courseWeekdays: allSchoolWeekdays,
    customHolidays,
    excludedHolidayIds,
  };

  const handleSave = () => {
    saveGlobalAttendanceSettings(activeSettings);
    if (onSaveSettings) {
      onSaveSettings(activeSettings);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl flex flex-col transition-all ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`flex items-center justify-between p-4 border-b shrink-0 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Horarios y Semanas de Clase</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Fuente común para todas las materias • Ciclo Lectivo 2026
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 text-xs sm:text-sm">
          {/* DETECTOR INTELIGENTE DE FERIADOS Y ASUETOS */}
          <div
            className={`p-4 rounded-xl border ${
              isDarkMode ? 'bg-slate-850/80 border-slate-800' : 'bg-amber-50/50 border-amber-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-bold text-xs uppercase tracking-wider text-amber-900 dark:text-amber-300">
                    Detector de Feriados y Asuetos Escolares (Ciclo 2026)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyDetectedHolidays}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-all cursor-pointer"
                  title="Aplicar la cuenta de feriados detectados a las clases de 1°C y 2°C"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Aplicar Feriados Detectados</span>
                </button>
              </div>
            </div>

            {/* Banner de resumen de feriados detectados */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-500 dark:text-slate-400 block">
                    Feriados / Eventos (1° Cuatrimestre)
                  </span>
                  <span className="text-base font-extrabold text-amber-700 dark:text-amber-300">
                    {detectedInfo.holidays1cCount} días sin clase
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setHolidays1c(detectedInfo.holidays1cCount)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  Sincronizar 1°C
                </button>
              </div>

              <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-500 dark:text-slate-400 block">
                    Feriados / Eventos (2° Cuatrimestre)
                  </span>
                  <span className="text-base font-extrabold text-amber-700 dark:text-amber-300">
                    {detectedInfo.holidays2cCount} días sin clase
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setHolidays2c(detectedInfo.holidays2cCount)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  Sincronizar 2°C
                </button>
              </div>
            </div>

            {statusNotice && (
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-2.5 animate-in fade-in">
                {statusNotice}
              </p>
            )}

            {/* Toggle to view detailed list of holidays */}
            <div className="border-t border-dashed border-amber-200 dark:border-slate-700 pt-2.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowHolidayBreakdown(!showHolidayBreakdown)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                >
                  {showHolidayBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {showHolidayBreakdown ? 'Ocultar' : 'Ver'} lista de feriados y eventos del ciclo lectivo ({detectedInfo.detectedHolidays1c.length + detectedInfo.detectedHolidays2c.length} registrados)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAddingCustom(!isAddingCustom)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Agregar evento</span>
                </button>
              </div>

              {/* Form to add custom event, asueto or pedagogical day */}
              {isAddingCustom && (
                <form
                  onSubmit={handleAddCustomEvent}
                  className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-amber-300 dark:border-slate-700 space-y-2.5 animate-in fade-in"
                >
                  <div className="font-bold text-xs text-neutral-800 dark:text-slate-200">
                    Agregar Evento Escolar, Feriado o Jornada Institucional
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Nombre del evento (ej: Acto escolar, Jornada EMI)"
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      required
                      className={`px-2.5 py-1.5 text-xs rounded border ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    />
                    <input
                      type="date"
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      required
                      className={`px-2.5 py-1.5 text-xs rounded border ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    />
                    <select
                      value={newEventTerm}
                      onChange={(e) => setNewEventTerm(e.target.value as '1c' | '2c')}
                      className={`px-2.5 py-1.5 text-xs rounded border ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    >
                      <option value="1c">1° Cuatrimestre</option>
                      <option value="2c">2° Cuatrimestre</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingCustom(false)}
                      className="px-2.5 py-1 text-xs rounded border border-neutral-300 dark:border-slate-700 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 text-xs font-bold rounded bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                    >
                      Guardar Evento
                    </button>
                  </div>
                </form>
              )}

              {/* Detailed list of detected holidays and events */}
              {showHolidayBreakdown && (
                <div className="mt-3 space-y-3">
                  {/* 1° Cuatrimestre Detected Holidays */}
                  <div>
                    <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 block mb-1">
                      1° Cuatrimestre (Marzo a Julio):
                    </span>
                    {detectedInfo.detectedHolidays1c.length === 0 ? (
                      <p className="text-[11px] text-neutral-400 italic">
                        No hay feriados oficiales ni eventos en este período.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {detectedInfo.detectedHolidays1c.map((h) => {
                          const isExcluded = excludedHolidayIds.includes(h.id);
                          return (
                            <div
                              key={h.id}
                              className={`p-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 transition-colors ${
                                isExcluded
                                  ? 'opacity-50 bg-neutral-100 dark:bg-slate-800/40 line-through'
                                  : 'bg-white dark:bg-slate-800 border-neutral-200 dark:border-slate-700'
                              }`}
                            >
                              <label className="flex items-center gap-2 cursor-pointer flex-1">
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={() => handleToggleHolidayInclusion(h.id)}
                                  className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <div>
                                  <span className="font-bold block text-neutral-800 dark:text-slate-200">
                                    {h.date.split('-').reverse().join('/')} • {h.dayName}
                                  </span>
                                  <span className="text-neutral-500 dark:text-slate-400 text-[10px]">
                                    {h.name}
                                  </span>
                                </div>
                              </label>
                              {h.id.startsWith('custom_') && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomEvent(h.id)}
                                  className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                  title="Eliminar evento personalizado"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 2° Cuatrimestre Detected Holidays */}
                  <div>
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 block mb-1">
                      2° Cuatrimestre (Agosto a Diciembre):
                    </span>
                    {detectedInfo.detectedHolidays2c.length === 0 ? (
                      <p className="text-[11px] text-neutral-400 italic">
                        No hay feriados oficiales ni eventos en este período.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {detectedInfo.detectedHolidays2c.map((h) => {
                          const isExcluded = excludedHolidayIds.includes(h.id);
                          return (
                            <div
                              key={h.id}
                              className={`p-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 transition-colors ${
                                isExcluded
                                  ? 'opacity-50 bg-neutral-100 dark:bg-slate-800/40 line-through'
                                  : 'bg-white dark:bg-slate-800 border-neutral-200 dark:border-slate-700'
                              }`}
                            >
                              <label className="flex items-center gap-2 cursor-pointer flex-1">
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={() => handleToggleHolidayInclusion(h.id)}
                                  className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <div>
                                  <span className="font-bold block text-neutral-800 dark:text-slate-200">
                                    {h.date.split('-').reverse().join('/')} • {h.dayName}
                                  </span>
                                  <span className="text-neutral-500 dark:text-slate-400 text-[10px]">
                                    {h.name}
                                  </span>
                                </div>
                              </label>
                              {h.id.startsWith('custom_') && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomEvent(h.id)}
                                  className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                  title="Eliminar evento personalizado"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Academic Weeks Settings (1C / 2C) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1° Cuatrimestre */}
            <div
              className={`p-3.5 rounded-xl border ${
                isDarkMode ? 'bg-slate-850/60 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  1° Cuatrimestre
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                  {weeks1c} semanas lectivas
                </span>
              </div>

              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium">Semanas de clase:</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={weeks1c}
                    onChange={(e) => setWeeks1c(Math.max(1, parseInt(e.target.value) || 16))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <label className="text-xs font-medium">Días sin clase / Feriados:</label>
                    <span className="text-[10px] text-neutral-400">Total en el 1° cuatrimestre</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={holidays1c}
                      onChange={(e) => setHolidays1c(Math.max(0, parseInt(e.target.value) || 0))}
                      className={`w-16 px-2 py-1 text-center font-bold rounded-lg border text-xs text-amber-600 dark:text-amber-400 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setHolidays1c(detectedInfo.holidays1cCount)}
                      className="px-1.5 py-1 text-[10px] font-bold rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-200 cursor-pointer"
                      title="Usar número de feriados detectados"
                    >
                      Usar {detectedInfo.holidays1cCount}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed border-neutral-200 dark:border-slate-800 text-[11px] space-y-1">
                  <div className="text-neutral-500 dark:text-slate-400 flex items-center justify-between">
                    <span>Fechas del período:</span>
                    <button
                      type="button"
                      onClick={handleCalculateWeeksFromDates1c}
                      className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Calcular semanas
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="date"
                      value={startDate1c}
                      onChange={(e) => setStartDate1c(e.target.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    />
                    <input
                      type="date"
                      value={endDate1c}
                      onChange={(e) => setEndDate1c(e.target.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2° Cuatrimestre */}
            <div
              className={`p-3.5 rounded-xl border ${
                isDarkMode ? 'bg-slate-850/60 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  2° Cuatrimestre
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                  {weeks2c} semanas lectivas
                </span>
              </div>

              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium">Semanas de clase:</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={weeks2c}
                    onChange={(e) => setWeeks2c(Math.max(1, parseInt(e.target.value) || 16))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <label className="text-xs font-medium">Días sin clase / Feriados:</label>
                    <span className="text-[10px] text-neutral-400">Total en el 2° cuatrimestre</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={holidays2c}
                      onChange={(e) => setHolidays2c(Math.max(0, parseInt(e.target.value) || 0))}
                      className={`w-16 px-2 py-1 text-center font-bold rounded-lg border text-xs text-amber-600 dark:text-amber-400 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setHolidays2c(detectedInfo.holidays2cCount)}
                      className="px-1.5 py-1 text-[10px] font-bold rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-200 cursor-pointer"
                      title="Usar número de feriados detectados"
                    >
                      Usar {detectedInfo.holidays2cCount}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed border-neutral-200 dark:border-slate-800 text-[11px] space-y-1">
                  <div className="text-neutral-500 dark:text-slate-400 flex items-center justify-between">
                    <span>Fechas del período:</span>
                    <button
                      type="button"
                      onClick={handleCalculateWeeksFromDates2c}
                      className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Calcular semanas
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="date"
                      value={startDate2c}
                      onChange={(e) => setStartDate2c(e.target.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    />
                    <input
                      type="date"
                      value={endDate2c}
                      onChange={(e) => setEndDate2c(e.target.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Absence Thresholds & Criteria */}
          <div
            className={`p-4 rounded-xl border space-y-3 ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
            }`}
          >
            <div className="font-bold text-xs uppercase tracking-wider text-neutral-600 dark:text-slate-300">
              Régimen de Inasistencias y Criterios del Semáforo
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-slate-300 mb-1">
                  Máximo % de inasistencias permitido:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={maxAbsencePercent}
                    onChange={(e) => setMaxAbsencePercent(Math.max(5, parseInt(e.target.value) || 25))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                    }`}
                  />
                  <span className="text-xs text-neutral-500 font-semibold">% (típicamente 25% o 15%)</span>
                </div>
              </div>

              <div>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={halfLatePenalty}
                    onChange={(e) => setHalfLatePenalty(e.target.checked)}
                    className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-bold block">Computar 1 tardanza como 0.5 inasistencia</span>
                    <span className="text-[11px] text-neutral-400 block">
                      Conforme al régimen académico escolar, 2 llegadas tarde equivalen a 1 falta en el semáforo.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className={`flex items-center justify-between p-4 border-t shrink-0 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <button
            type="button"
            onClick={handleResetToDefaults}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restablecer estándar</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar Configuración para Todas las Materias</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
