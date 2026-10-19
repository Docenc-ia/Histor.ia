/**
 * Attendance Calculations & Traffic Light (Semáforo de Asistencia)
 *
 * Computes exact attendance percentages based on class weeks, weekly schedule frequency,
 * tardiness penalties (0.5 absence per late arrival), and evaluates traffic light risk:
 * - Green (Regular): >= 85% attendance
 * - Yellow (Warning / Precaución): 75% to 84% attendance (or near maximum allowed absences)
 * - Red (Alert / Riesgo Crítico): < 75% attendance or exceeded maximum allowed absences
 */

import {
  SchoolHolidayItem,
  detectHolidaysForCourse,
  extractWeekdaysFromSchedule,
} from './schoolHolidays';
import { getUserScopedItem, setUserScopedItem } from '../services/storageHelpers';

export interface AttendanceSettings {
  weeks1c: number;          // Default: 16 weeks in 1st term
  weeks2c: number;          // Default: 16 weeks in 2nd term
  classesPerWeek: number;   // Classes/sessions per week (e.g. 2 times a week)
  maxAbsencePercent: number;// Maximum allowed absence % (typically 25% in secondary schools)
  halfLatePenalty: boolean; // Whether 1 late = 0.5 absence (true by default)
  holidays1c?: number;      // Classes not held in 1st term (feriados, asuetos, jornadas institucionales)
  holidays2c?: number;      // Classes not held in 2nd term (feriados, asuetos, jornadas institucionales)
  termStartDate1c?: string; // Optional start date for 1st term (e.g. "2026-03-02")
  termEndDate1c?: string;   // Optional end date for 1st term (e.g. "2026-07-10")
  termStartDate2c?: string; // Optional start date for 2nd term (e.g. "2026-08-03")
  termEndDate2c?: string;   // Optional end date for 2nd term (e.g. "2026-12-04")
  courseWeekdays?: number[]; // Active class days of week (1=Lunes, ..., 5=Viernes)
  customHolidays?: SchoolHolidayItem[]; // Custom school asuetos / jornadas
  excludedHolidayIds?: string[]; // IDs of holidays deactivated by teacher
}

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  weeks1c: 16,
  weeks2c: 16,
  classesPerWeek: 2,
  maxAbsencePercent: 25,
  halfLatePenalty: true,
  holidays1c: 0,
  holidays2c: 0,
  termStartDate1c: '2026-03-02',
  termEndDate1c: '2026-07-10',
  termStartDate2c: '2026-08-03',
  termEndDate2c: '2026-12-04',
  courseWeekdays: [1, 3],
  customHolidays: [],
  excludedHolidayIds: [],
};

/**
 * Calculates academic weeks between two date strings (YYYY-MM-DD)
 */
export function calculateWeeksBetweenDates(startStr?: string, endStr?: string, defaultWeeks = 16): number {
  if (!startStr || !endStr) return defaultWeeks;
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end.getTime() - start.getTime();
    if (isNaN(diffMs) || diffMs <= 0) return defaultWeeks;
    const weeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(30, weeks));
  } catch (_) {
    return defaultWeeks;
  }
}

export interface StudentAttendanceTrafficLight {
  studentId: string;
  totalClasses: number;
  attendedClasses: number;
  totalAbsences: number;
  totalLates: number;
  computedAbsences: number;
  percentage: number;
  maxAllowedAbsences: number;
  remainingAbsences: number;
  status: 'regular' | 'warning' | 'alert';
  statusLabel: string;
}

export interface CourseAttendanceSummary {
  term: '1c' | '2c' | 'annual';
  termLabel: string;
  weeksCount: number;
  classesPerWeek: number;
  holidaysCount: number;
  totalClasses: number;
  maxAllowedAbsences: number;
  regularCount: number;
  warningCount: number;
  alertCount: number;
  avgAttendanceRate: number;
}

/**
 * Extracts classes per week from a schedule string (e.g., "Lunes 08:00 - 09:30, Miércoles 10:00 - 11:30" => 2)
 */
export function deriveClassesPerWeekFromSchedule(schedule?: string): number {
  if (!schedule || typeof schedule !== 'string') return 2;
  const trimmed = schedule.trim();
  if (!trimmed) return 2;

  // Split by comma or semicolon
  const parts = trimmed.split(/[,;\n]/).filter((p) => p.trim().length > 0);
  if (parts.length > 0) {
    return Math.min(6, Math.max(1, parts.length));
  }
  return 2;
}

/**
 * Loads course attendance settings from localStorage or defaults, automatically
 * detecting holidays and asuetos for the course schedule.
 */
export function getCourseAttendanceSettings(courseId?: string, schedule?: string): AttendanceSettings {
  const fallbackClassesPerWeek = deriveClassesPerWeekFromSchedule(schedule);
  const parsedWeekdays = extractWeekdaysFromSchedule(schedule);
  const detectedDefaults = detectHolidaysForCourse({
    schedule,
    explicitWeekdays: parsedWeekdays.length > 0 ? parsedWeekdays : undefined,
  });

  if (typeof window !== 'undefined' && courseId) {
    try {
      const stored = getUserScopedItem(`fds_attendance_settings_${courseId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const storedWeekdays = Array.isArray(parsed.courseWeekdays) && parsed.courseWeekdays.length > 0
          ? parsed.courseWeekdays
          : (parsedWeekdays.length > 0 ? parsedWeekdays : [1, 3]);

        const customHolidays = Array.isArray(parsed.customHolidays) ? parsed.customHolidays : [];
        const excludedHolidayIds = Array.isArray(parsed.excludedHolidayIds) ? parsed.excludedHolidayIds : [];

        // If holidays were not explicitly set or were 0, recalculate using detected holidays
        let holidays1c = Number(parsed.holidays1c);
        let holidays2c = Number(parsed.holidays2c);
        if (isNaN(holidays1c) || isNaN(holidays2c) || (holidays1c === 0 && holidays2c === 0)) {
          const auto = detectHolidaysForCourse({
            schedule,
            explicitWeekdays: storedWeekdays,
            termStartDate1c: parsed.termStartDate1c,
            termEndDate1c: parsed.termEndDate1c,
            termStartDate2c: parsed.termStartDate2c,
            termEndDate2c: parsed.termEndDate2c,
            customHolidays,
            excludedHolidayIds,
          });
          if (isNaN(holidays1c) || holidays1c === 0) holidays1c = auto.holidays1cCount;
          if (isNaN(holidays2c) || holidays2c === 0) holidays2c = auto.holidays2cCount;
        }

        return {
          weeks1c: Number(parsed.weeks1c) || DEFAULT_ATTENDANCE_SETTINGS.weeks1c,
          weeks2c: Number(parsed.weeks2c) || DEFAULT_ATTENDANCE_SETTINGS.weeks2c,
          classesPerWeek: Number(parsed.classesPerWeek) || fallbackClassesPerWeek,
          maxAbsencePercent: Number(parsed.maxAbsencePercent) || DEFAULT_ATTENDANCE_SETTINGS.maxAbsencePercent,
          halfLatePenalty: parsed.halfLatePenalty !== false,
          holidays1c: holidays1c || 0,
          holidays2c: holidays2c || 0,
          termStartDate1c: parsed.termStartDate1c || DEFAULT_ATTENDANCE_SETTINGS.termStartDate1c,
          termEndDate1c: parsed.termEndDate1c || DEFAULT_ATTENDANCE_SETTINGS.termEndDate1c,
          termStartDate2c: parsed.termStartDate2c || DEFAULT_ATTENDANCE_SETTINGS.termStartDate2c,
          termEndDate2c: parsed.termEndDate2c || DEFAULT_ATTENDANCE_SETTINGS.termEndDate2c,
          courseWeekdays: storedWeekdays,
          customHolidays,
          excludedHolidayIds,
        };
      }
    } catch (_) {}
  }

  return {
    ...DEFAULT_ATTENDANCE_SETTINGS,
    classesPerWeek: fallbackClassesPerWeek,
    holidays1c: detectedDefaults.holidays1cCount,
    holidays2c: detectedDefaults.holidays2cCount,
    courseWeekdays: detectedDefaults.weekdays,
  };
}

/**
 * Saves course attendance settings locally and persists to Firestore cloud
 */
export function saveCourseAttendanceSettings(courseId: string, settings: AttendanceSettings): void {
  if (typeof window !== 'undefined' && courseId) {
    setUserScopedItem(`fds_attendance_settings_${courseId}`, JSON.stringify(settings));
    import('../services/firestoreSync')
      .then(({ firestoreSync, getActiveUserId }) => {
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveUserSetting(uid, `attendance_settings_${courseId}`, settings).catch(() => {});
        }
      })
      .catch(() => {});
  }
}

/**
 * Loads course attendance settings from Firestore cloud and updates local cache if found
 */
export async function loadCourseAttendanceSettingsFromCloud(
  courseId: string,
  schedule?: string
): Promise<AttendanceSettings | null> {
  if (!courseId) return null;
  try {
    const { firestoreSync, getActiveUserId } = await import('../services/firestoreSync');
    const uid = getActiveUserId();
    if (!uid) return null;
    const cloudSettings = await firestoreSync.loadUserSetting<AttendanceSettings>(
      uid,
      `attendance_settings_${courseId}`
    );
    if (cloudSettings && typeof cloudSettings === 'object') {
      if (typeof window !== 'undefined') {
        setUserScopedItem(`fds_attendance_settings_${courseId}`, JSON.stringify(cloudSettings));
      }
      return getCourseAttendanceSettings(courseId, schedule);
    }
  } catch (_) {}
  return null;
}

/**
 * Helper to get badge visual styling for the traffic light status
 */
export function getTrafficLightBadgeStyle(status: 'regular' | 'warning' | 'alert', isDarkMode = false): {
  bg: string;
  text: string;
  border: string;
  dotBg: string;
  label: string;
} {
  if (status === 'regular') {
    return {
      bg: isDarkMode ? 'bg-emerald-950/60' : 'bg-emerald-50',
      text: isDarkMode ? 'text-emerald-300' : 'text-emerald-700',
      border: isDarkMode ? 'border-emerald-800/80' : 'border-emerald-200',
      dotBg: 'bg-emerald-500',
      label: 'Regular',
    };
  }
  if (status === 'warning') {
    return {
      bg: isDarkMode ? 'bg-amber-950/60' : 'bg-amber-50',
      text: isDarkMode ? 'text-amber-300' : 'text-amber-700',
      border: isDarkMode ? 'border-amber-800/80' : 'border-amber-200',
      dotBg: 'bg-amber-500',
      label: 'Precaución',
    };
  }
  return {
    bg: isDarkMode ? 'bg-red-950/60' : 'bg-red-50',
    text: isDarkMode ? 'text-red-300' : 'text-red-700',
    border: isDarkMode ? 'border-red-800/80' : 'border-red-200',
    dotBg: 'bg-red-500',
    label: 'Riesgo',
  };
}

/**
 * Computes the traffic light and percentage for a student in a given term
 */
export function computeStudentAttendanceTrafficLight(
  studentId: string,
  totalAbsences: number,
  totalLates: number,
  term: '1c' | '2c' | 'annual',
  settings: AttendanceSettings
): StudentAttendanceTrafficLight {
  const weeksCount = term === 'annual' ? settings.weeks1c + settings.weeks2c : term === '2c' ? settings.weeks2c : settings.weeks1c;
  const holidaysCount = term === 'annual' ? (settings.holidays1c || 0) + (settings.holidays2c || 0) : term === '2c' ? (settings.holidays2c || 0) : (settings.holidays1c || 0);
  const totalClasses = Math.max(1, (weeksCount * settings.classesPerWeek) - holidaysCount);

  const latePenalty = settings.halfLatePenalty ? 0.5 : 0;
  const computedAbsences = Number((totalAbsences + (totalLates * latePenalty)).toFixed(1));
  const attendedClasses = Math.max(0, Number((totalClasses - computedAbsences).toFixed(1)));
  const percentage = Math.max(0, Math.min(100, Math.round((attendedClasses / totalClasses) * 100)));

  const maxAllowedAbsences = Math.floor(totalClasses * (settings.maxAbsencePercent / 100));
  const remainingAbsences = Number((maxAllowedAbsences - computedAbsences).toFixed(1));

  let status: 'regular' | 'warning' | 'alert';
  let statusLabel: string;

  // Criterios de semáforo:
  // Verde: si no hay riesgo (> 80% de asistencia)
  // Amarillo: (80% - 75%) si está al límite
  // Rojo: (menos de 75%) si no cuenta con el mínimo de asistencia
  if (percentage < 75 || computedAbsences > maxAllowedAbsences) {
    status = 'alert';
    statusLabel = 'Riesgo (< 75% asistencia)';
  } else if (percentage <= 80 || remainingAbsences <= 1) {
    status = 'warning';
    statusLabel = 'Al límite (75% - 80% asistencia)';
  } else {
    status = 'regular';
    statusLabel = 'Sin riesgo (> 80% asistencia)';
  }

  return {
    studentId,
    totalClasses,
    attendedClasses,
    totalAbsences,
    totalLates,
    computedAbsences,
    percentage,
    maxAllowedAbsences,
    remainingAbsences,
    status,
    statusLabel,
  };
}

/**
 * Computes course summary metrics for all students
 */
export function computeCourseAttendanceSummary(
  studentsMetrics: { studentId: string; totalAbsences: number; totalLates: number }[],
  term: '1c' | '2c' | 'annual',
  settings: AttendanceSettings
): CourseAttendanceSummary {
  const weeksCount = term === 'annual' ? settings.weeks1c + settings.weeks2c : term === '2c' ? settings.weeks2c : settings.weeks1c;
  const holidaysCount = term === 'annual' ? (settings.holidays1c || 0) + (settings.holidays2c || 0) : term === '2c' ? (settings.holidays2c || 0) : (settings.holidays1c || 0);
  const totalClasses = Math.max(1, (weeksCount * settings.classesPerWeek) - holidaysCount);
  const maxAllowedAbsences = Math.floor(totalClasses * (settings.maxAbsencePercent / 100));

  let regularCount = 0;
  let warningCount = 0;
  let alertCount = 0;
  let totalPercentSum = 0;

  studentsMetrics.forEach((m) => {
    const res = computeStudentAttendanceTrafficLight(m.studentId, m.totalAbsences, m.totalLates, term, settings);
    if (res.status === 'regular') regularCount++;
    else if (res.status === 'warning') warningCount++;
    else alertCount++;
    totalPercentSum += res.percentage;
  });

  const count = Math.max(1, studentsMetrics.length);
  const avgAttendanceRate = Math.round(totalPercentSum / count);

  const termLabel = term === '1c' ? '1° Cuatrimestre' : term === '2c' ? '2° Cuatrimestre' : 'Resumen Anual';

  return {
    term,
    termLabel,
    weeksCount,
    classesPerWeek: settings.classesPerWeek,
    holidaysCount,
    totalClasses,
    maxAllowedAbsences,
    regularCount,
    warningCount,
    alertCount,
    avgAttendanceRate,
  };
}
