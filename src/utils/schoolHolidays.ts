/**
 * School Holidays & Asuetos Engine for Argentine Academic Calendar 2026.
 *
 * Provides official holidays, bridge holidays, and educational asuetos (Día del Maestro,
 * Día del Estudiante, Jornadas Institucionales), and automatically matches them against
 * course weekday schedules to determine the exact number of class sessions affected.
 */

export interface SchoolHolidayItem {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  term: '1c' | '2c';
  type: 'nacional' | 'puente' | 'asueto' | 'jornada';
  dayOfWeek: number; // 0=Domingo, 1=Lunes, ..., 6=Sábado
  dayName: string; // "Lunes", "Martes", etc.
  description?: string;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  0: 'Domingo',
};

/**
 * Official Argentine National Holidays and School Asuetos for Ciclo Lectivo 2026
 */
export const OFFICIAL_HOLIDAYS_2026: SchoolHolidayItem[] = [
  // 1° Cuatrimestre (Marzo - Julio 2026)
  {
    id: '2026-03-24',
    date: '2026-03-24',
    name: 'Día Nacional de la Memoria por la Verdad y la Justicia',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 2,
    dayName: 'Martes',
    description: 'Feriado nacional inamovible.',
  },
  {
    id: '2026-04-02',
    date: '2026-04-02',
    name: 'Día del Veterano y de los Caídos en Malvinas',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 4,
    dayName: 'Jueves',
    description: 'Feriado nacional inamovible.',
  },
  {
    id: '2026-04-03',
    date: '2026-04-03',
    name: 'Viernes Santo',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Feriado nacional religioso.',
  },
  {
    id: '2026-05-01',
    date: '2026-05-01',
    name: 'Día Internacional del Trabajador',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Feriado nacional inamovible.',
  },
  {
    id: '2026-05-25',
    date: '2026-05-25',
    name: 'Día de la Revolución de Mayo',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Feriado nacional patrio.',
  },
  {
    id: '2026-06-17',
    date: '2026-06-17',
    name: 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 3,
    dayName: 'Miércoles',
    description: 'Feriado nacional.',
  },
  {
    id: '2026-06-19',
    date: '2026-06-19',
    name: 'Feriado Puente Turístico',
    term: '1c',
    type: 'puente',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Feriado puente con fines turísticos.',
  },
  {
    id: '2026-06-20',
    date: '2026-06-20',
    name: 'Paso a la Inmortalidad del Gral. Manuel Belgrano (Día de la Bandera)',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 6,
    dayName: 'Sábado',
    description: 'Feriado nacional inamovible.',
  },
  {
    id: '2026-07-09',
    date: '2026-07-09',
    name: 'Día de la Independencia',
    term: '1c',
    type: 'nacional',
    dayOfWeek: 4,
    dayName: 'Jueves',
    description: 'Feriado nacional patrio.',
  },
  {
    id: '2026-07-10',
    date: '2026-07-10',
    name: 'Feriado Puente Turístico',
    term: '1c',
    type: 'puente',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Feriado con fines turísticos previo a vacaciones.',
  },

  // 2° Cuatrimestre (Agosto - Diciembre 2026)
  {
    id: '2026-08-17',
    date: '2026-08-17',
    name: 'Paso a la Inmortalidad del Gral. José de San Martín',
    term: '2c',
    type: 'nacional',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Feriado nacional trasladable.',
  },
  {
    id: '2026-09-11',
    date: '2026-09-11',
    name: 'Día del Maestro (Asueto Escolar)',
    term: '2c',
    type: 'asueto',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Asueto escolar en conmemoración de Domingo F. Sarmiento.',
  },
  {
    id: '2026-09-21',
    date: '2026-09-21',
    name: 'Día del Estudiante (Asueto Educación Secundaria)',
    term: '2c',
    type: 'asueto',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Asueto escolar de nivel secundario / jornada de la juventud.',
  },
  {
    id: '2026-10-12',
    date: '2026-10-12',
    name: 'Día del Respeto a la Diversidad Cultural',
    term: '2c',
    type: 'nacional',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Feriado nacional.',
  },
  {
    id: '2026-11-20',
    date: '2026-11-20',
    name: 'Día de la Soberanía Nacional',
    term: '2c',
    type: 'nacional',
    dayOfWeek: 5,
    dayName: 'Viernes',
    description: 'Feriado nacional.',
  },
  {
    id: '2026-11-23',
    date: '2026-11-23',
    name: 'Feriado con Fines Turísticos / Traslado Soberanía',
    term: '2c',
    type: 'puente',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Fin de semana largo turístico.',
  },
  {
    id: '2026-12-07',
    date: '2026-12-07',
    name: 'Feriado Puente Turístico',
    term: '2c',
    type: 'puente',
    dayOfWeek: 1,
    dayName: 'Lunes',
    description: 'Feriado turístico.',
  },
  {
    id: '2026-12-08',
    date: '2026-12-08',
    name: 'Inmaculada Concepción de María',
    term: '2c',
    type: 'nacional',
    dayOfWeek: 2,
    dayName: 'Martes',
    description: 'Feriado nacional inamovible.',
  },
];

/**
 * Extracts weekdays (1=Lunes, 2=Martes, 3=Miércoles, 4=Jueves, 5=Viernes) from a schedule text.
 * Examples:
 * "Lunes 08:00 - 09:30, Miércoles 10:00 - 11:30" => [1, 3]
 * "Martes y Jueves" => [2, 4]
 * "Viernes 07:45 - 11:50" => [5]
 */
export function extractWeekdaysFromSchedule(schedule?: string): number[] {
  if (!schedule || typeof schedule !== 'string') return [];
  const trimmed = schedule.trim();
  if (!trimmed || trimmed === 'Lunes y Miércoles') return [];
  const lower = trimmed.toLowerCase();
  if (
    lower === 'sin horario especificado' ||
    lower.includes('coordinar') ||
    lower.includes('sin horario') ||
    lower.includes('pendiente')
  ) {
    return [];
  }
  const days: number[] = [];

  const patterns: { day: number; regex: RegExp }[] = [
    { day: 1, regex: /\b(lunes|lun|lu)\b/i },
    { day: 2, regex: /\b(martes|mar|ma)\b/i },
    { day: 3, regex: /\b(mi[eé]rcoles|mi[eé]|mie|mi)\b/i },
    { day: 4, regex: /\b(jueves|jue|ju)\b/i },
    { day: 5, regex: /\b(viernes|vie|vi)\b/i },
    { day: 6, regex: /\b(s[aá]bado|sab|sa)\b/i },
  ];

  for (const p of patterns) {
    if (p.regex.test(lower)) {
      days.push(p.day);
    }
  }

  return days.sort((a, b) => a - b);
}

export interface CourseDayTimeSlot {
  slotIndex: number;
  startTime?: string;
  endTime?: string;
  timeLabel: string;
}

/**
 * Parses a schedule text and extracts the time slots / hours for each day of the week.
 * In secondary schools, each hour / module corresponds to one class row in the Libro de Temas.
 * Supports:
 * - Multiple blocks on the same day: "Jueves 07:50 - 08:50, Jueves 08:50 - 09:50" -> 2 slots for Thursday
 * - Continuous 2-hour blocks: "Jueves 07:50 - 09:50" -> 2 slots (07:50 - 08:50 and 08:50 - 09:50)
 * - Explicit hours counts: "Jueves (2 horas)" -> 2 slots
 * - Single blocks: "Martes 13:10 - 14:10" -> 1 slot
 */
export function extractDailySlotsFromSchedule(
  schedule?: string,
  activeWeekdays?: number[]
): Record<number, CourseDayTimeSlot[]> {
  const result: Record<number, CourseDayTimeSlot[]> = {};

  if (!schedule || typeof schedule !== 'string') {
    if (activeWeekdays) {
      for (const d of activeWeekdays) {
        result[d] = [{ slotIndex: 0, timeLabel: '' }];
      }
    }
    return result;
  }

  const dayPatterns: { day: number; regex: RegExp }[] = [
    { day: 1, regex: /\b(lunes|lun|lu)\b/i },
    { day: 2, regex: /\b(martes|mar|ma)\b/i },
    { day: 3, regex: /\b(mi[eé]rcoles|mi[eé]|mie|mi)\b/i },
    { day: 4, regex: /\b(jueves|jue|ju)\b/i },
    { day: 5, regex: /\b(viernes|vie|vi)\b/i },
    { day: 6, regex: /\b(s[aá]bado|sab|sa)\b/i },
  ];

  const toMin = (t: string) => {
    const parts = t.split(':').map((p) => parseInt(p, 10));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
    return parts[0] * 60 + parts[1];
  };

  const toTimeStr = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Split schedule into chunks by comma, semicolon, newline, slash, or " y "
  const rawChunks = schedule.split(/[,;\n/]+|\s+y\s+(?=[a-záéíóú]+\s+\d|\d)/i);
  let currentDay: number | null = null;

  for (const chunk of rawChunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    for (const { day, regex } of dayPatterns) {
      if (regex.test(trimmed)) {
        currentDay = day;
        break;
      }
    }

    if (currentDay === null) {
      if (activeWeekdays && activeWeekdays.length > 0) {
        currentDay = activeWeekdays[0];
      }
    }

    if (currentDay === null) continue;

    if (!result[currentDay]) {
      result[currentDay] = [];
    }

    const hoursMatch = trimmed.match(/(\d+)\s*(?:horas|hs|m[oó]dulos)/i);
    const explicitHoursCount = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;

    const timeRangeRegex = /(\d{1,2}:\d{2})\s*(?:-|a|–|al)\s*(\d{1,2}:\d{2})/g;
    const matches = Array.from(trimmed.matchAll(timeRangeRegex));

    if (matches.length > 0) {
      for (const m of matches) {
        const start = m[1].length === 4 ? `0${m[1]}` : m[1];
        const end = m[2].length === 4 ? `0${m[2]}` : m[2];
        const startMin = toMin(start);
        const endMin = toMin(end);
        const duration = endMin > startMin ? endMin - startMin : 60;

        const splitCount =
          explicitHoursCount > 1
            ? explicitHoursCount
            : duration >= 150
            ? Math.round(duration / 60)
            : duration >= 75
            ? 2
            : 1;

        if (splitCount > 1) {
          const slotDur = Math.round(duration / splitCount);
          for (let s = 0; s < splitCount; s++) {
            const sMin = startMin + s * slotDur;
            const eMin = s === splitCount - 1 ? endMin : startMin + (s + 1) * slotDur;
            const sStr = toTimeStr(sMin);
            const eStr = toTimeStr(eMin);
            result[currentDay].push({
              slotIndex: result[currentDay].length,
              startTime: sStr,
              endTime: eStr,
              timeLabel: `${sStr} - ${eStr}`,
            });
          }
        } else {
          result[currentDay].push({
            slotIndex: result[currentDay].length,
            startTime: start,
            endTime: end,
            timeLabel: `${start} - ${end}`,
          });
        }
      }
    } else if (explicitHoursCount > 1) {
      for (let s = 0; s < explicitHoursCount; s++) {
        result[currentDay].push({
          slotIndex: result[currentDay].length,
          timeLabel: `${s + 1}° Hora`,
        });
      }
    } else {
      if (result[currentDay].length === 0) {
        result[currentDay].push({
          slotIndex: 0,
          timeLabel: '',
        });
      }
    }
  }

  // Deduplicate identical time slots for the same day and sort by start time
  for (const d of Object.keys(result).map(Number)) {
    const seenTimes = new Set<string>();
    result[d] = result[d]
      .filter((slot) => {
        const key = `${slot.startTime || ''}_${slot.endTime || ''}_${slot.timeLabel || ''}`;
        if (!key || key === '__') return true;
        if (seenTimes.has(key)) return false;
        seenTimes.add(key);
        return true;
      })
      .sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
        return a.slotIndex - b.slotIndex;
      });
  }

  // Ensure every active weekday has at least one slot
  if (activeWeekdays) {
    for (const d of activeWeekdays) {
      if (!result[d] || result[d].length === 0) {
        result[d] = [{ slotIndex: 0, timeLabel: '' }];
      }
    }
  }

  // Clean slot indices and assign clear labels
  for (const d of Object.keys(result).map(Number)) {
    result[d] = result[d].map((slot, idx) => ({
      ...slot,
      slotIndex: idx,
      timeLabel:
        slot.timeLabel ||
        (slot.startTime && slot.endTime
          ? `${slot.startTime} - ${slot.endTime}`
          : result[d].length > 1
          ? `${idx + 1}° Hora`
          : ''),
    }));
  }

  return result;
}

/**
 * Detects holidays and asuetos that coincide with a course's weekdays and academic term ranges.
 */
export function detectHolidaysForCourse(params: {
  schedule?: string;
  explicitWeekdays?: number[];
  termStartDate1c?: string;
  termEndDate1c?: string;
  termStartDate2c?: string;
  termEndDate2c?: string;
  customHolidays?: SchoolHolidayItem[];
  excludedHolidayIds?: string[];
}): {
  weekdays: number[];
  weekdaysLabels: string[];
  holidays1cCount: number;
  holidays2cCount: number;
  detectedHolidays1c: SchoolHolidayItem[];
  detectedHolidays2c: SchoolHolidayItem[];
  allEligibleHolidays: SchoolHolidayItem[];
} {
  const {
    schedule = '',
    explicitWeekdays,
    termStartDate1c = '2026-03-02',
    termEndDate1c = '2026-07-10',
    termStartDate2c = '2026-08-03',
    termEndDate2c = '2026-12-04',
    customHolidays = [],
    excludedHolidayIds = [],
  } = params;

  // Resolve active weekdays
  let weekdays: number[] = explicitWeekdays && explicitWeekdays.length > 0
    ? explicitWeekdays
    : extractWeekdaysFromSchedule(schedule);

  // If no weekdays could be inferred, default to Lunes & Miércoles (most common 2x/wk pattern)
  if (weekdays.length === 0) {
    weekdays = [1, 3];
  }

  const weekdaysLabels = weekdays.map((d) => WEEKDAY_LABELS[d] || `Día ${d}`);
  const excludedSet = new Set(excludedHolidayIds);

  // Combine official holidays with any custom school asuetos
  const combined = [...OFFICIAL_HOLIDAYS_2026, ...customHolidays];

  const detectedHolidays1c: SchoolHolidayItem[] = [];
  const detectedHolidays2c: SchoolHolidayItem[] = [];

  for (const hol of combined) {
    if (excludedSet.has(hol.id)) continue;

    // Check if the holiday falls on one of the course's class days
    if (!weekdays.includes(hol.dayOfWeek)) {
      continue;
    }

    // Check date bounds for 1° Cuatrimestre
    if (hol.term === '1c') {
      if (hol.date >= termStartDate1c && hol.date <= termEndDate1c) {
        detectedHolidays1c.push(hol);
      }
    } else if (hol.term === '2c') {
      if (hol.date >= termStartDate2c && hol.date <= termEndDate2c) {
        detectedHolidays2c.push(hol);
      }
    }
  }

  // Sort by date ascending
  detectedHolidays1c.sort((a, b) => a.date.localeCompare(b.date));
  detectedHolidays2c.sort((a, b) => a.date.localeCompare(b.date));

  return {
    weekdays,
    weekdaysLabels,
    holidays1cCount: detectedHolidays1c.length,
    holidays2cCount: detectedHolidays2c.length,
    detectedHolidays1c,
    detectedHolidays2c,
    allEligibleHolidays: combined,
  };
}
