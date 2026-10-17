import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Clock,
  RotateCcw,
  Save,
  RefreshCw,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  CalendarDays,
  CheckCircle2,
} from 'lucide-react';
import { Course, Student, StudentDispositionData } from '../../../types';
import {
  AttendanceSettings,
  DEFAULT_ATTENDANCE_SETTINGS,
  deriveClassesPerWeekFromSchedule,
  calculateWeeksBetweenDates,
  computeCourseAttendanceSummary,
} from '../../../utils/attendanceCalculations';
import {
  SchoolHolidayItem,
  WEEKDAY_LABELS,
  detectHolidaysForCourse,
  extractWeekdaysFromSchedule,
} from '../../../utils/schoolHolidays';
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

  // Weekdays and holiday detection states
  const [courseWeekdays, setCourseWeekdays] = useState<number[]>(() => {
    if (currentSettings.courseWeekdays && currentSettings.courseWeekdays.length > 0) {
      return currentSettings.courseWeekdays;
    }
    const extracted = extractWeekdaysFromSchedule(course.schedule);
    return extracted.length > 0 ? extracted : [1, 3];
  });
  const [customHolidays, setCustomHolidays] = useState<SchoolHolidayItem[]>(
    currentSettings.customHolidays || []
  );
  const [excludedHolidayIds, setExcludedHolidayIds] = useState<string[]>(
    currentSettings.excludedHolidayIds || []
  );
  const [showHolidayBreakdown, setShowHolidayBreakdown] = useState<boolean>(true);

  // New custom holiday form state
  const [isAddingCustom, setIsAddingCustom] = useState<boolean>(false);
  const [newHolidayName, setNewHolidayName] = useState<string>('');
  const [newHolidayDate, setNewHolidayDate] = useState<string>('2026-05-15');
  const [newHolidayTerm, setNewHolidayTerm] = useState<'1c' | '2c'>('1c');

  const [isSyncingCalendar, setIsSyncingCalendar] = useState<boolean>(false);
  const [calendarSyncMsg, setCalendarSyncMsg] = useState<string | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(
    (course as any).preferredCalendarId || 'primary'
  );
  const [availableCalendars, setAvailableCalendars] = useState<
    { id: string; summary: string; primary?: boolean }[]
  >([
    { id: 'primary', summary: 'Calendario Principal (Cuenta vinculada a Classroom)', primary: true },
  ]);
  const [detectedCalendarSlots, setDetectedCalendarSlots] = useState<
    {
      id: string;
      title: string;
      dayOfWeek: number;
      dayName: string;
      startTime: string;
      endTime: string;
      displayText: string;
      calendarName?: string;
    }[]
  >([]);

  // Compute detected holidays reactively
  const detectedInfo = useMemo(() => {
    return detectHolidaysForCourse({
      schedule,
      explicitWeekdays: courseWeekdays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays,
      excludedHolidayIds,
    });
  }, [schedule, courseWeekdays, startDate1c, endDate1c, startDate2c, endDate2c, customHolidays, excludedHolidayIds]);

  useEffect(() => {
    if (isOpen) {
      setWeeks1c(currentSettings.weeks1c);
      setWeeks2c(currentSettings.weeks2c);
      setClassesPerWeek(currentSettings.classesPerWeek);
      setMaxAbsencePercent(currentSettings.maxAbsencePercent);
      setHalfLatePenalty(currentSettings.halfLatePenalty);
      setSchedule(course.schedule || '');
      setSelectedCalendarId((course as any).preferredCalendarId || 'primary');
      setStartDate1c(currentSettings.termStartDate1c || '2026-03-02');
      setEndDate1c(currentSettings.termEndDate1c || '2026-07-10');
      setStartDate2c(currentSettings.termStartDate2c || '2026-08-03');
      setEndDate2c(currentSettings.termEndDate2c || '2026-12-04');

      const parsedWd = extractWeekdaysFromSchedule(course.schedule);
      const activeWd = currentSettings.courseWeekdays && currentSettings.courseWeekdays.length > 0
        ? currentSettings.courseWeekdays
        : (parsedWd.length > 0 ? parsedWd : [1, 3]);
      setCourseWeekdays(activeWd);

      const customHols = currentSettings.customHolidays || [];
      const excludedHols = currentSettings.excludedHolidayIds || [];
      setCustomHolidays(customHols);
      setExcludedHolidayIds(excludedHols);

      // If holidays are not set or 0, auto-populate from detector
      const auto = detectHolidaysForCourse({
        schedule: course.schedule,
        explicitWeekdays: activeWd,
        termStartDate1c: currentSettings.termStartDate1c,
        termEndDate1c: currentSettings.termEndDate1c,
        termStartDate2c: currentSettings.termStartDate2c,
        termEndDate2c: currentSettings.termEndDate2c,
        customHolidays: customHols,
        excludedHolidayIds: excludedHols,
      });

      const h1 = currentSettings.holidays1c !== undefined && currentSettings.holidays1c > 0
        ? currentSettings.holidays1c
        : auto.holidays1cCount;
      const h2 = currentSettings.holidays2c !== undefined && currentSettings.holidays2c > 0
        ? currentSettings.holidays2c
        : auto.holidays2cCount;

      setHolidays1c(h1);
      setHolidays2c(h2);
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

  // Toggle a weekday button (Lunes=1 to Sábado=6)
  const handleToggleWeekday = (day: number) => {
    const nextDays = courseWeekdays.includes(day)
      ? courseWeekdays.filter((d) => d !== day)
      : [...courseWeekdays, day].sort((a, b) => a - b);

    const finalDays = nextDays.length > 0 ? nextDays : [day];
    setCourseWeekdays(finalDays);
    setClassesPerWeek(finalDays.length);

    // Auto-update holidays count for the new days
    const res = detectHolidaysForCourse({
      schedule,
      explicitWeekdays: finalDays,
      termStartDate1c: startDate1c,
      termEndDate1c: endDate1c,
      termStartDate2c: startDate2c,
      termEndDate2c: endDate2c,
      customHolidays,
      excludedHolidayIds,
    });
    setHolidays1c(res.holidays1cCount);
    setHolidays2c(res.holidays2cCount);
    setCalendarSyncMsg(
      `Días actualizados a ${res.weekdaysLabels.join(', ')} (${finalDays.length} clases/sem). Feriados recalculados: -${res.holidays1cCount} en 1°C y -${res.holidays2cCount} en 2°C.`
    );
  };

  // Toggle individual holiday inclusion/exclusion
  const handleToggleHolidayInclusion = (id: string) => {
    const nextExcluded = excludedHolidayIds.includes(id)
      ? excludedHolidayIds.filter((x) => x !== id)
      : [...excludedHolidayIds, id];

    setExcludedHolidayIds(nextExcluded);

    const res = detectHolidaysForCourse({
      schedule,
      explicitWeekdays: courseWeekdays,
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
    setCalendarSyncMsg(
      `¡Feriados oficiales aplicados! Descontando ${detectedInfo.holidays1cCount} clases en 1°C y ${detectedInfo.holidays2cCount} en 2°C para tus días ${detectedInfo.weekdaysLabels.join(', ')}.`
    );
  };

  // Add custom school asueto / jornada
  const handleAddCustomHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayName.trim() || !newHolidayDate) return;
    const d = new Date(newHolidayDate + 'T12:00:00');
    const dow = d.getDay();
    const item: SchoolHolidayItem = {
      id: `custom_${Date.now()}`,
      date: newHolidayDate,
      name: newHolidayName.trim(),
      term: newHolidayTerm,
      type: 'asueto',
      dayOfWeek: dow,
      dayName: WEEKDAY_LABELS[dow] || 'Día',
      description: 'Asueto escolar / jornada agregada por el docente',
    };
    const nextCustom = [...customHolidays, item];
    setCustomHolidays(nextCustom);
    setNewHolidayName('');
    setIsAddingCustom(false);

    const res = detectHolidaysForCourse({
      schedule,
      explicitWeekdays: courseWeekdays,
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

  // Delete custom holiday
  const handleDeleteCustomHoliday = (id: string) => {
    const nextCustom = customHolidays.filter((h) => h.id !== id);
    setCustomHolidays(nextCustom);

    const res = detectHolidaysForCourse({
      schedule,
      explicitWeekdays: courseWeekdays,
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

  // Sync timetable and detect modules from the selected Google Calendar (defaults to primary linked to Classroom)
  const handleSyncWithCalendar = async (overrideCalId?: string) => {
    const calIdToUse = overrideCalId || selectedCalendarId || 'primary';
    setIsSyncingCalendar(true);
    setCalendarSyncMsg(null);
    try {
      const [calListRes, slotsRes, matchRes] = await Promise.all([
        calendarService.listCalendars(),
        calendarService.getWeeklyCalendarSlots(calIdToUse),
        calendarService.importSchedulesFromGoogleCalendar([course], calIdToUse, false),
      ]);

      if (calListRes.success && calListRes.calendars.length > 0) {
        setAvailableCalendars(calListRes.calendars);
      }

      if (slotsRes.success) {
        setDetectedCalendarSlots(slotsRes.slots);
      }

      if (matchRes.success && matchRes.schedulesMap[course.id]) {
        const foundSchedule = matchRes.schedulesMap[course.id];
        handleScheduleChange(foundSchedule);
        setCalendarSyncMsg(
          `¡Módulos de "${course.name}" detectados en el calendario seleccionado! También podés hacer clic en cualquier módulo de abajo para agregarlo o quitarlo.`
        );
      } else if (slotsRes.success && slotsRes.slots.length > 0) {
        setCalendarSyncMsg(
          `Se detectaron ${slotsRes.slots.length} módulos en el calendario seleccionado. Hacé clic en los que correspondan a esta clase para elegirlos como horarios predeterminados.`
        );
      } else {
        setCalendarSyncMsg(
          slotsRes.message || matchRes.message || 'No se encontraron módulos en el calendario seleccionado.'
        );
      }
    } catch (err: any) {
      setCalendarSyncMsg('Error al conectar con Google Calendar.');
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleToggleDetectedSlot = (slotDisplayText: string) => {
    const currentParts = schedule
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = currentParts.includes(slotDisplayText);
    const nextParts = exists
      ? currentParts.filter((p) => p !== slotDisplayText)
      : [...currentParts, slotDisplayText];
    handleScheduleChange(nextParts.join(', '));
  };

  const handleScheduleChange = (text: string) => {
    setSchedule(text);
    const derived = deriveClassesPerWeekFromSchedule(text);
    setClassesPerWeek(derived);
    const extractedWd = extractWeekdaysFromSchedule(text);
    if (extractedWd.length > 0) {
      setCourseWeekdays(extractedWd);
      const auto = detectHolidaysForCourse({
        schedule: text,
        explicitWeekdays: extractedWd,
        termStartDate1c: startDate1c,
        termEndDate1c: endDate1c,
        termStartDate2c: startDate2c,
        termEndDate2c: endDate2c,
        customHolidays,
        excludedHolidayIds,
      });
      setHolidays1c(auto.holidays1cCount);
      setHolidays2c(auto.holidays2cCount);
    }
  };

  const handleResetToDefaults = () => {
    const derived = deriveClassesPerWeekFromSchedule(course.schedule);
    const extractedWd = extractWeekdaysFromSchedule(course.schedule);
    const defaultWd = extractedWd.length > 0 ? extractedWd : [1, 3];

    setWeeks1c(DEFAULT_ATTENDANCE_SETTINGS.weeks1c);
    setWeeks2c(DEFAULT_ATTENDANCE_SETTINGS.weeks2c);
    setClassesPerWeek(derived);
    setCourseWeekdays(defaultWd);
    setMaxAbsencePercent(DEFAULT_ATTENDANCE_SETTINGS.maxAbsencePercent);
    setHalfLatePenalty(DEFAULT_ATTENDANCE_SETTINGS.halfLatePenalty);
    setStartDate1c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate1c || '2026-03-02');
    setEndDate1c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate1c || '2026-07-10');
    setStartDate2c(DEFAULT_ATTENDANCE_SETTINGS.termStartDate2c || '2026-08-03');
    setEndDate2c(DEFAULT_ATTENDANCE_SETTINGS.termEndDate2c || '2026-12-04');
    setCustomHolidays([]);
    setExcludedHolidayIds([]);

    const auto = detectHolidaysForCourse({
      schedule: course.schedule,
      explicitWeekdays: defaultWd,
    });
    setHolidays1c(auto.holidays1cCount);
    setHolidays2c(auto.holidays2cCount);
    setCalendarSyncMsg('Valores y feriados oficiales 2026 restablecidos automáticamente.');
  };

  // Computed total real classes subtracting holidays
  const totalClasses1c = Math.max(1, weeks1c * classesPerWeek - holidays1c);
  const totalClasses2c = Math.max(1, weeks2c * classesPerWeek - holidays2c);
  const totalClassesAnnual = totalClasses1c + totalClasses2c;
  const currentTotalClasses =
    currentTerm === 'annual' ? totalClassesAnnual : currentTerm === '2c' ? totalClasses2c : totalClasses1c;

  // Active settings for preview and save
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
    courseWeekdays,
    customHolidays,
    excludedHolidayIds,
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
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Semáforo de Asistencia y Semanas de Clase</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                {course.name} {course.division ? `• ${course.division}` : ''} • Ciclo Lectivo 2026
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
          {/* Horario y Días de la Materia */}
          <div
            className={`p-4 rounded-xl border ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-blue-50/50 border-blue-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="font-bold text-xs uppercase tracking-wider text-blue-900 dark:text-blue-300">
                  Días de Clase y Horario de la Materia
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedCalendarId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCalendarId(nextId);
                    handleSyncWithCalendar(nextId);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-lg border font-medium focus:outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-200'
                      : 'bg-white border-blue-200 text-neutral-700'
                  }`}
                  title="Seleccionar el calendario del cual extraer los módulos"
                >
                  {availableCalendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleSyncWithCalendar(selectedCalendarId)}
                  disabled={isSyncingCalendar}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  title="Detectar clases desde el calendario seleccionado"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
                  <span>{isSyncingCalendar ? 'Buscando en Calendar...' : 'Sincronizar con Google Calendar'}</span>
                </button>
              </div>
            </div>

            {/* Quick Weekday Selector */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300 mb-1.5">
                Días en que se dicta esta materia (hacé clic para activar o desactivar):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { day: 1, label: 'Lunes' },
                  { day: 2, label: 'Martes' },
                  { day: 3, label: 'Miércoles' },
                  { day: 4, label: 'Jueves' },
                  { day: 5, label: 'Viernes' },
                  { day: 6, label: 'Sábado' },
                ].map(({ day, label }) => {
                  const isActive = courseWeekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleToggleWeekday(day)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                          : 'bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-100'
                      }`}
                    >
                      {isActive ? '✓ ' : ''}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-600 dark:text-slate-300">
                Texto de horario / aula:
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
              <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-slate-400 pt-0.5">
                <span>
                  Frecuencia activa:{' '}
                  <strong className="text-blue-600 dark:text-blue-400 font-bold">
                    {classesPerWeek} clases por semana
                  </strong>{' '}
                  ({detectedInfo.weekdaysLabels.join(', ')})
                </span>
                <span className="text-[10px] opacity-75">Los feriados se calculan para estos días</span>
              </div>
              {calendarSyncMsg && (
                <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-1 animate-in fade-in">
                  {calendarSyncMsg}
                </p>
              )}

              {detectedCalendarSlots.length > 0 && (
                <div className="mt-3 pt-3 border-t border-blue-200/60 dark:border-slate-700">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 mb-2">
                    Módulos detectados en el calendario seleccionado (hacé clic para elegir como predeterminados):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {detectedCalendarSlots.map((slot) => {
                      const isSelected = schedule.includes(slot.displayText);
                      const courseKeyword = (course.name.split(' ')[0] || '').toLowerCase();
                      const isRecommended =
                        courseKeyword.length >= 3 && slot.title.toLowerCase().includes(courseKeyword);

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => handleToggleDetectedSlot(slot.displayText)}
                          className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all flex items-center justify-between gap-2 cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                              : isRecommended
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20'
                              : isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                              : 'bg-white border-neutral-200 text-neutral-700 hover:bg-blue-50/60'
                          }`}
                        >
                          <div className="truncate">
                            <div className="font-bold truncate flex items-center gap-1.5">
                              {isRecommended && !isSelected && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              )}
                              <span>{slot.title}</span>
                            </div>
                            <div
                              className={`text-[10px] ${
                                isSelected ? 'text-blue-100' : 'text-neutral-500 dark:text-slate-400'
                              }`}
                            >
                              {slot.displayText}
                            </div>
                          </div>
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                              isSelected
                                ? 'bg-white text-blue-600 border-white'
                                : 'border-neutral-300 dark:border-slate-600'
                            }`}
                          >
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

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
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 block">
                    Calcula automáticamente cuántas clases reales caen en feriado según tus días de cursada.
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
                    Feriados en tus días (1° Cuatrimestre)
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
                    Feriados en tus días (2° Cuatrimestre)
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
                    {showHolidayBreakdown ? 'Ocultar' : 'Ver'} lista detallada de feriados en tus días de cursada ({detectedInfo.detectedHolidays1c.length + detectedInfo.detectedHolidays2c.length} detectados)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAddingCustom(!isAddingCustom)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Agregar asueto / jornada</span>
                </button>
              </div>

              {/* Form to add custom asueto or pedagogical day */}
              {isAddingCustom && (
                <form
                  onSubmit={handleAddCustomHoliday}
                  className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-amber-300 dark:border-slate-700 space-y-2.5 animate-in fade-in"
                >
                  <div className="font-bold text-xs text-neutral-800 dark:text-slate-200">
                    Agregar Asueto Escolar, Jornada Institucional o Suspensión de Clases
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Nombre (ej: Jornada EMI)"
                      value={newHolidayName}
                      onChange={(e) => setNewHolidayName(e.target.value)}
                      required
                      className={`px-2.5 py-1.5 text-xs rounded border ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    />
                    <input
                      type="date"
                      value={newHolidayDate}
                      onChange={(e) => setNewHolidayDate(e.target.value)}
                      required
                      className={`px-2.5 py-1.5 text-xs rounded border ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    />
                    <select
                      value={newHolidayTerm}
                      onChange={(e) => setNewHolidayTerm(e.target.value as '1c' | '2c')}
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
                      Guardar Asueto
                    </button>
                  </div>
                </form>
              )}

              {/* Detailed list of detected holidays */}
              {showHolidayBreakdown && (
                <div className="mt-3 space-y-3">
                  {/* 1° Cuatrimestre Detected Holidays */}
                  <div>
                    <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 block mb-1">
                      1° Cuatrimestre (Marzo a Julio):
                    </span>
                    {detectedInfo.detectedHolidays1c.length === 0 ? (
                      <p className="text-[11px] text-neutral-400 italic">
                        No hay feriados oficiales que coincidan con tus días ({detectedInfo.weekdaysLabels.join(', ')}) en este período.
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
                                  onClick={() => handleDeleteCustomHoliday(h.id)}
                                  className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                  title="Eliminar asueto personalizado"
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
                        No hay feriados oficiales que coincidan con tus días ({detectedInfo.weekdaysLabels.join(', ')}) en este período.
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
                                  onClick={() => handleDeleteCustomHoliday(h.id)}
                                  className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                  title="Eliminar asueto personalizado"
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
                  {totalClasses1c} clases reales
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
                  {totalClasses2c} clases reales
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
