import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  Settings,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Save,
  RefreshCw,
  Sparkles,
  Info,
} from 'lucide-react';
import { Course, Student, StudentDispositionData } from '../../../types';
import {
  AttendanceSettings,
  DEFAULT_ATTENDANCE_SETTINGS,
  deriveClassesPerWeekFromSchedule,
  calculateWeeksBetweenDates,
  computeCourseAttendanceSummary,
} from '../../../utils/attendanceCalculations';
import { calendarService } from '../../../services/workspace/calendarService';

interface AttendanceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  currentSettings: AttendanceSettings;
  onSaveSettings: (settings: AttendanceSettings, updatedSchedule?: string) => void;
  students: Student[];
  studentMetricsMap: Record<string, StudentDispositionData>;
  currentTerm: '1c' | '2c' | 'annual';
  isDarkMode: boolean;
}

export const AttendanceSettingsModal: React.FC<AttendanceSettingsModalProps> = ({
  isOpen,
  onClose,
  course,
  currentSettings,
  onSaveSettings,
  students,
  studentMetricsMap,
  currentTerm,
  isDarkMode,
}) => {
  const [weeks1c, setWeeks1c] = useState<number>(currentSettings.weeks1c);
  const [weeks2c, setWeeks2c] = useState<number>(currentSettings.weeks2c);
  const [classesPerWeek, setClassesPerWeek] = useState<number>(currentSettings.classesPerWeek);
  const [maxAbsencePercent, setMaxAbsencePercent] = useState<number>(currentSettings.maxAbsencePercent);
  const [halfLatePenalty, setHalfLatePenalty] = useState<boolean>(currentSettings.halfLatePenalty);
  const [schedule, setSchedule] = useState<string>(course.schedule || '');
  const [holidays1c, setHolidays1c] = useState<number>(currentSettings.holidays1c || 0);
  const [holidays2c, setHolidays2c] = useState<number>(currentSettings.holidays2c || 0);

  // Dates for terms
  const [startDate1c, setStartDate1c] = useState<string>(currentSettings.termStartDate1c || '2026-03-02');
  const [endDate1c, setEndDate1c] = useState<string>(currentSettings.termEndDate1c || '2026-07-10');
  const [startDate2c, setStartDate2c] = useState<string>(currentSettings.termStartDate2c || '2026-08-03');
  const [endDate2c, setEndDate2c] = useState<string>(currentSettings.termEndDate2c || '2026-12-04');

  const [isSyncingCalendar, setIsSyncingCalendar] = useState<boolean>(false);
  const [calendarSyncMsg, setCalendarSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWeeks1c(currentSettings.weeks1c);
      setWeeks2c(currentSettings.weeks2c);
      setClassesPerWeek(currentSettings.classesPerWeek);
      setMaxAbsencePercent(currentSettings.maxAbsencePercent);
      setHalfLatePenalty(currentSettings.halfLatePenalty);
      setHolidays1c(currentSettings.holidays1c || 0);
      setHolidays2c(currentSettings.holidays2c || 0);
      setSchedule(course.schedule || '');
      setStartDate1c(currentSettings.termStartDate1c || '2026-03-02');
      setEndDate1c(currentSettings.termEndDate1c || '2026-07-10');
      setStartDate2c(currentSettings.termStartDate2c || '2026-08-03');
      setEndDate2c(currentSettings.termEndDate2c || '2026-12-04');
      setCalendarSyncMsg(null);
    }
  }, [isOpen, currentSettings, course.schedule]);

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

  // Sync timetable from Google Calendar
  const handleSyncWithCalendar = async () => {
    setIsSyncingCalendar(true);
    setCalendarSyncMsg(null);
    try {
      const res = await calendarService.importSchedulesFromGoogleCalendar([course], 'primary', false);
      if (res.success && res.schedulesMap[course.id]) {
        const foundSchedule = res.schedulesMap[course.id];
        setSchedule(foundSchedule);
        const derived = deriveClassesPerWeekFromSchedule(foundSchedule);
        setClassesPerWeek(derived);
        setCalendarSyncMsg(`¡Horario detectado en Google Calendar! (${derived} clases/semana)`);
      } else {
        setCalendarSyncMsg(res.message || 'No se encontraron eventos coincidentes para este curso en Google Calendar.');
      }
    } catch (err: any) {
      setCalendarSyncMsg('Error al conectar con Google Calendar.');
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleScheduleChange = (text: string) => {
    setSchedule(text);
    const derived = deriveClassesPerWeekFromSchedule(text);
    setClassesPerWeek(derived);
  };

  const handleResetToDefaults = () => {
    const derived = deriveClassesPerWeekFromSchedule(course.schedule);
    setWeeks1c(DEFAULT_ATTENDANCE_SETTINGS.weeks1c);
    setWeeks2c(DEFAULT_ATTENDANCE_SETTINGS.weeks2c);
    setClassesPerWeek(derived);
    setMaxAbsencePercent(DEFAULT_ATTENDANCE_SETTINGS.maxAbsencePercent);
    setHalfLatePenalty(DEFAULT_ATTENDANCE_SETTINGS.halfLatePenalty);
    setHolidays1c(0);
    setHolidays2c(0);
    setStartDate1c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate1c || '2026-03-02');
    setEndDate1c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate1c || '2026-07-10');
    setStartDate2c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate2c || '2026-08-03');
    setEndDate2c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate2c || '2026-12-04');
    setCalendarSyncMsg('Valores restablecidos a los parámetros escolares estándar.');
  };

  // Computed values subtracting holidays/classes not held
  const totalClasses1c = Math.max(1, (weeks1c * classesPerWeek) - holidays1c);
  const totalClasses2c = Math.max(1, (weeks2c * classesPerWeek) - holidays2c);
  const totalClassesAnnual = totalClasses1c + totalClasses2c;
  const currentTotalClasses =
    currentTerm === 'annual' ? totalClassesAnnual : currentTerm === '2c' ? totalClasses2c : totalClasses1c;

  const maxAllowedAbsencesTerm = Math.floor(currentTotalClasses * (maxAbsencePercent / 100));

  // Current simulation preview with students
  const activeSettings: AttendanceSettings = {
    weeks1c,
    weeks2c,
    classesPerWeek,
    maxAbsencePercent,
    halfLatePenalty,
    holidays1c,
    holidays2c,
    termStartDate1c: startDate1c,
    termEndDate1c: endDate1c,
    termStartDate2c: startDate2c,
    termEndDate2c: endDate2c,
  };

  const studentsMetricsList = students.map((s) => {
    const m = studentMetricsMap[s.id] || { totalAbsences: 0, totalLates: 0 };
    return {
      studentId: s.id,
      totalAbsences: m.totalAbsences || 0,
      totalLates: m.totalLates || 0,
    };
  });

  const summary = computeCourseAttendanceSummary(studentsMetricsList, currentTerm, activeSettings);

  const handleSave = () => {
    onSaveSettings(activeSettings, schedule !== (course.schedule || '') ? schedule : undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl flex flex-col transition-all ${
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
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Semáforo de Asistencia y Semanas de Clase</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                {course.name} {course.division ? `• ${course.division}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-6 text-xs sm:text-sm">
          {/* Calendar Sync & Course Schedule section */}
          <div
            className={`p-4 rounded-xl border ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-blue-50/50 border-blue-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="font-bold text-xs uppercase tracking-wider text-blue-900 dark:text-blue-300">
                  Horario Escolar y Frecuencia Semanal
                </span>
              </div>
              <button
                type="button"
                onClick={handleSyncWithCalendar}
                disabled={isSyncingCalendar}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                title="Detectar clases automáticamente desde eventos recurrentes en tu Google Calendar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
                <span>{isSyncingCalendar ? 'Buscando en Calendar...' : 'Sincronizar con Google Calendar'}</span>
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-neutral-600 dark:text-slate-300">
                Horario de clase del curso (ej. días y horarios):
              </label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => handleScheduleChange(e.target.value)}
                placeholder="Ej: Lunes 08:00 - 09:30, Miércoles 10:00 - 11:30"
                className={`w-full px-3 py-2 rounded-lg border text-xs font-mono focus:outline-none transition-colors ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                    : 'bg-white border-neutral-300 text-neutral-900 focus:border-blue-600'
                }`}
              />
              <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-slate-400 pt-1">
                <span>
                  Frecuencia detectada:{' '}
                  <strong className="text-blue-600 dark:text-blue-400 font-bold">{classesPerWeek} clases por semana</strong>
                </span>
                <span className="text-[10px] opacity-75">Separar por comas para múltiples días</span>
              </div>
              {calendarSyncMsg && (
                <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-1 animate-in fade-in">
                  {calendarSyncMsg}
                </p>
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
                  {totalClasses1c} clases totales
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
                    <span className="text-[10px] text-neutral-400">Resta clases al total del 1°C</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={holidays1c}
                    onChange={(e) => setHolidays1c(Math.max(0, parseInt(e.target.value) || 0))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs text-amber-600 dark:text-amber-400 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  />
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
                  {totalClasses2c} clases totales
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
                    <span className="text-[10px] text-neutral-400">Resta clases al total del 2°C</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={holidays2c}
                    onChange={(e) => setHolidays2c(Math.max(0, parseInt(e.target.value) || 0))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs text-amber-600 dark:text-amber-400 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  />
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
                    min={10}
                    max={50}
                    value={maxAbsencePercent}
                    onChange={(e) => setMaxAbsencePercent(Math.max(5, parseInt(e.target.value) || 25))}
                    className={`w-20 px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                    }`}
                  />
                  <span className="text-xs font-semibold">% (típico 25% para no perder regularidad)</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Límite resultante: <strong>{maxAllowedAbsencesTerm} faltas permitidas</strong> en el{' '}
                  {currentTerm === '2c' ? '2° Cuatrimestre' : currentTerm === 'annual' ? 'Año' : '1° Cuatrimestre'}.
                </p>
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="halfLatePenalty"
                  checked={halfLatePenalty}
                  onChange={(e) => setHalfLatePenalty(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="halfLatePenalty" className="text-xs text-neutral-600 dark:text-slate-300 cursor-pointer">
                  <span className="font-bold block">Computar 1 tardanza como 0.5 inasistencia</span>
                  <span className="text-[11px] text-neutral-400 block">
                    Conforme al régimen académico escolar, 2 llegadas tarde equivalen a 1 falta en el semáforo.
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Real-time Traffic Light Preview for Course */}
          <div
            className={`p-4 rounded-xl border ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-xs uppercase tracking-wider text-neutral-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Semáforo del Curso ({summary.termLabel})
              </span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                Asistencia promedio: {summary.avgAttendanceRate}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {/* Green / Regular */}
              <div className="p-3 rounded-xl border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-center">
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span>Regular (&ge;85%)</span>
                </div>
                <div className="text-xl font-black text-emerald-800 dark:text-emerald-200">
                  {summary.regularCount}
                </div>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">alumnos</span>
              </div>

              {/* Yellow / Warning */}
              <div className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-center">
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>Precaución (75-84%)</span>
                </div>
                <div className="text-xl font-black text-amber-800 dark:text-amber-200">
                  {summary.warningCount}
                </div>
                <span className="text-[10px] text-amber-600 dark:text-amber-400">alumnos</span>
              </div>

              {/* Red / Alert */}
              <div className="p-3 rounded-xl border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-center">
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-red-700 dark:text-red-300 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span>Riesgo (&lt;75%)</span>
                </div>
                <div className="text-xl font-black text-red-800 dark:text-red-200">
                  {summary.alertCount}
                </div>
                <span className="text-[10px] text-red-600 dark:text-red-400">alumnos</span>
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
              <span>Guardar Configuración</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
