import { Course } from '../types';

/**
 * Standardizes course labels across the sidebar, navigation, and dropdowns
 * to follow the school format requested by the teacher:
 * "Materia (Orientación y División)"
 *
 * Examples:
 *  - "Historia (S2 Nat)"
 *  - "Historia (S1 Soc1)"
 *  - "Matemática (S5 Eco)"
 */
export function formatCourseSidebarLabel(course: Course | null | undefined): string {
  if (!course) return '';

  const name = (course.name || '').trim();
  const subject = (course.subject || '').trim();
  const orientation = (course.orientation || '').trim();
  const division = (course.division || '').trim();
  const section = (course.section || '').trim();
  const grade = (course.grade || '').trim();

  // 1. If course name is already in the format "Materia (Orientación y División)"
  // e.g., "Historia (S2 Nat)" or "Historia (S1 Soc1)"
  const parenMatch = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const subjPart = parenMatch[1].trim();
    const groupPart = parenMatch[2].trim();
    return `${subjPart} (${groupPart})`;
  }

  // 2. If explicit division and orientation exist (e.g. division: "S2", orientation: "Nat")
  if (division && orientation) {
    const mainSubject = subject || name;
    return `${mainSubject} (${division} ${orientation})`;
  }

  // 3. If explicit division or section with standard secondary codes (e.g. "S2 Nat", "S1 Soc1")
  const combinedGroup = [division, orientation].filter(Boolean).join(' ').trim() || section;
  if (
    combinedGroup &&
    (combinedGroup.match(/^[Ss]\d+/) ||
      combinedGroup.match(/\b(Nat|Soc|Soc\d+|Eco|Arte|Hum|Exa|Bio|Com|Tec)/i))
  ) {
    const mainSubject = subject || name.replace(/[-–—]\s*[Ss]\d+.*$/, '').trim();
    return `${mainSubject} (${combinedGroup})`;
  }

  // 4. Check if course name has hyphen separator like "Historia - S2 Nat" or "Historia - S1 Soc1"
  const dashMatch = name.match(/^([^-–—]+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim();

    // Check if right looks like "S2 Nat", "S1 Soc1", etc.
    if (right.match(/^[Ss]\d+/) || right.match(/\b(Nat|Soc|Soc\d+|Eco|Arte)/i)) {
      return `${left} (${right})`;
    }

    // Check if left is grade/level like "4to Año A" and right is orientation "Ciencias Naturales"
    if (
      (left.toLowerCase().includes('año') ||
        left.toLowerCase().includes('grado') ||
        left.match(/^[Ss]\d+/i)) &&
      subject
    ) {
      const divMatch =
        left.match(/[Ss]\d+/i)?.[0] ||
        left.match(/\d+[°º]?\s*[a-zA-Z]?/)?.[0]?.replace(/\s+/g, '') ||
        left;
      let orientShort = 'Nat';
      const rLower = right.toLowerCase();
      if (rLower.includes('natural')) orientShort = 'Nat';
      else if (rLower.includes('social')) orientShort = 'Soc';
      else if (rLower.includes('econom')) orientShort = 'Eco';
      else if (rLower.includes('comput') || rLower.includes('infor')) orientShort = 'Info';
      else if (rLower.includes('matem')) orientShort = 'Mat';
      else orientShort = right.slice(0, 4);

      // Clean subject (take primary subject name e.g. "Biología" or "Matemática")
      const primarySubj = subject.split(' ')[0] || subject;
      return `${primarySubj} (${divMatch} ${orientShort})`;
    }

    // Default hyphen format: Subject - Group -> Subject (Group)
    return `${left} (${right})`;
  }

  // 5. Check if course name ends with S<num> <orient> pattern, e.g., "Historia S2 Nat" or "Historia S1 Soc1"
  const sPatternMatch = name.match(/^(.+?)\s+([Ss]\d+\s+[A-Za-z0-9]+)$/);
  if (sPatternMatch) {
    return `${sPatternMatch[1].trim()} (${sPatternMatch[2].trim()})`;
  }

  // 6. Check section or grade with secondary division (S1, S2, etc.)
  if (section) {
    const mainSubject = subject || name;
    return `${mainSubject} (${section})`;
  }

  if (
    grade &&
    (grade.match(/^[Ss]\d+/) ||
      grade.includes('°') ||
      grade.toLowerCase().includes('secundaria'))
  ) {
    const cleanGrade = grade.replace(/secundaria\s*[-–—]?\s*/i, '').trim();
    const mainSubject = subject || name;
    if (cleanGrade) {
      return `${mainSubject} (${cleanGrade})`;
    }
  }

  // 7. Fallback if both subject and name exist and differ
  if (subject && name && subject !== name) {
    return `${subject} (${name})`;
  }

  return name || subject || 'Materia';
}

export interface NextCourseClassInfo {
  minutesUntil: number;
  status: 'in_progress' | 'today' | 'tomorrow' | 'upcoming' | 'unscheduled';
  badgeText: string | null;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function parseMinutes(hhmm?: string): number | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [hStr, mStr] = hhmm.trim().split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function isValidCourseSchedule(sched?: string | null): boolean {
  if (!sched || typeof sched !== 'string') return false;
  const raw = sched.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (
    raw === 'Lunes y Miércoles' ||
    lower === 'sin horario especificado' ||
    lower === 'horario escolar' ||
    lower.includes('coordinar') ||
    lower.includes('sin horario') ||
    lower.includes('pendiente')
  ) {
    return false;
  }
  return true;
}

export function getEffectiveScheduleStringForCourse(course?: Partial<Course> | null): string {
  if (!course) return '';
  const rawSched = (course.schedule || '').trim();
  if (isValidCourseSchedule(rawSched)) return rawSched;

  if (typeof window !== 'undefined' && course.id) {
    try {
      const uid =
        sessionStorage.getItem('docencia_teacher_email') ||
        localStorage.getItem('docencia_teacher_email') ||
        '';
      const sanitizedUid = uid ? uid.replace(/[^a-zA-Z0-9]/g, '_') : '';
      const candidateKeys = new Set<string>([
        `fds_libro_temas_${course.id}`,
        ...(uid ? [`fds_libro_temas_${course.id}_${uid}`] : []),
        ...(sanitizedUid ? [`fds_libro_temas_${course.id}_teacher_${sanitizedUid}`] : []),
      ]);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`fds_libro_temas_${course.id}`)) {
          candidateKeys.add(k);
        }
      }
      for (const k of candidateKeys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const h = parsed?.metadata?.horario;
        if (isValidCourseSchedule(h)) {
          return String(h).trim();
        }
      }

      // Fallback: reconstruct schedule from saved attendance settings (dailySlots or courseWeekdays)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`fds_course_attendance_settings_${course.id}`)) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const settings = JSON.parse(raw);
          if (settings?.dailySlots && typeof settings.dailySlots === 'object') {
            const parts: string[] = [];
            const dayKeys = Object.keys(settings.dailySlots)
              .map(Number)
              .filter((n) => !isNaN(n))
              .sort((a, b) => a - b);
            for (const dNum of dayKeys) {
              const slotsArr = settings.dailySlots[dNum] || settings.dailySlots[String(dNum)];
              if (!Array.isArray(slotsArr) || slotsArr.length === 0) continue;
              const validSlots = slotsArr.filter((s: any) => s && s.startTime);
              if (validSlots.length > 0) {
                const sorted = [...validSlots].sort((a: any, b: any) =>
                  String(a.startTime).localeCompare(String(b.startTime))
                );
                const firstStart = String(sorted[0].startTime).padStart(5, '0');
                const lastEnd = String(
                  sorted[sorted.length - 1].endTime || sorted[0].startTime
                ).padStart(5, '0');
                const dayName = DAY_NAMES_ES[dNum] || `Día ${dNum}`;
                parts.push(
                  lastEnd && lastEnd !== firstStart
                    ? `${dayName} ${firstStart} - ${lastEnd}`
                    : `${dayName} ${firstStart}`
                );
              }
            }
            if (parts.length > 0) {
              return parts.join(', ');
            }
          }
          break;
        }
      }
    } catch (_) {}
  }

  return '';
}

/**
 * Calculates how many minutes remain from `now` until the next class of `course`
 * and returns a formatted badge (e.g. "Hoy · 10:10 - 12:10 hs", "Mañana (Martes) · 08:00 - 09:30 hs").
 */
export function getNextCourseClassInfo(
  course: Course,
  now: Date = new Date(),
  externalSlots?: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    title: string;
  }[]
): NextCourseClassInfo {
  const effectiveSchedule = getEffectiveScheduleStringForCourse(course);

  // Collect weekly blocks { dayOfWeek, startTime, endTime }
  const rawBlocks: { dayOfWeek: number; startTime: string; endTime: string; hasExplicitTime: boolean }[] = [];

  // 1. Check attendance settings saved in localStorage for this course
  if (typeof window !== 'undefined' && course.id) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`fds_course_attendance_settings_${course.id}`)) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const settings = JSON.parse(raw);
          if (settings?.dailySlots && typeof settings.dailySlots === 'object') {
            for (const [dayKey, slotsArr] of Object.entries(settings.dailySlots)) {
              const dNum = Number(dayKey);
              if (isNaN(dNum) || !Array.isArray(slotsArr) || slotsArr.length === 0) continue;
              const validSlots = slotsArr.filter((s: any) => s && s.startTime);
              if (validSlots.length > 0) {
                const sorted = [...validSlots].sort((a: any, b: any) =>
                  String(a.startTime).localeCompare(String(b.startTime))
                );
                const firstStart = String(sorted[0].startTime).padStart(5, '0');
                const lastEnd = String(sorted[sorted.length - 1].endTime || sorted[0].startTime).padStart(5, '0');
                rawBlocks.push({
                  dayOfWeek: dNum,
                  startTime: firstStart,
                  endTime: lastEnd,
                  hasExplicitTime: true,
                });
              }
            }
          }
          break;
        }
      }
    } catch (_) {}
  }

  // 2. Parse schedule string (e.g. "Martes 08:00 - 09:30, Jueves 10:10 - 11:10")
  if (effectiveSchedule) {
    const dayMap: Record<string, number> = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miercoles: 3,
      miércoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6,
      sábado: 6,
    };

    const parts = effectiveSchedule.split(/[,;|/]+/);
    for (const part of parts) {
      const clean = part.trim();
      if (!clean) continue;

      // Match day(s) and time range
      const timeMatch = clean.match(/([0-9]{1,2}:[0-9]{2})\s*(?:[-–—aà]|hasta)\s*([0-9]{1,2}:[0-9]{2})/i);
      const singleTimeMatch = !timeMatch ? clean.match(/([0-9]{1,2}:[0-9]{2})/) : null;

      const startTime = timeMatch
        ? timeMatch[1].padStart(5, '0')
        : singleTimeMatch
        ? singleTimeMatch[1].padStart(5, '0')
        : '';
      const endTime = timeMatch ? timeMatch[2].padStart(5, '0') : '';

      const matchedDays: number[] = [];
      for (const [dName, dIdx] of Object.entries(dayMap)) {
        const regex = new RegExp(`\\b${dName}\\b`, 'i');
        if (regex.test(clean)) {
          if (!matchedDays.includes(dIdx)) matchedDays.push(dIdx);
        }
      }

      for (const dNum of matchedDays) {
        const alreadyHasWithTime = rawBlocks.some(
          (b) => b.dayOfWeek === dNum && b.hasExplicitTime
        );
        if (alreadyHasWithTime && !startTime) continue;
        if (startTime) {
          // Remove any fallback without explicit time for this day
          const existingIdx = rawBlocks.findIndex(
            (b) => b.dayOfWeek === dNum && !b.hasExplicitTime
          );
          if (existingIdx !== -1) rawBlocks.splice(existingIdx, 1);
        }
        rawBlocks.push({
          dayOfWeek: dNum,
          startTime: startTime || '08:00',
          endTime: endTime || (startTime ? startTime : '09:30'),
          hasExplicitTime: Boolean(startTime),
        });
      }
    }
  }

  // 3. Also check external Google Calendar slots if matched by course name/division
  if (rawBlocks.length === 0 && Array.isArray(externalSlots) && externalSlots.length > 0) {
    const cleanStr = (s: string) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const cName = cleanStr(course.name);
    const cDiv = cleanStr(course.division || course.grade || course.section || '');
    for (const slot of externalSlots) {
      const sTitle = cleanStr(slot.title);
      if (
        (cName && sTitle.includes(cName) && (!cDiv || sTitle.includes(cDiv))) ||
        (cName && sTitle === cName)
      ) {
        rawBlocks.push({
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          hasExplicitTime: true,
        });
      }
    }
  }

  if (rawBlocks.length === 0) {
    return {
      minutesUntil: Number.MAX_SAFE_INTEGER,
      status: 'unscheduled',
      badgeText: null,
    };
  }

  // Merge multiple blocks on the same day into earliest startTime and latest endTime
  const byDay = new Map<
    number,
    { dayOfWeek: number; startTime: string; endTime: string; hasExplicitTime: boolean }
  >();
  for (const b of rawBlocks) {
    const existing = byDay.get(b.dayOfWeek);
    if (!existing) {
      byDay.set(b.dayOfWeek, { ...b });
    } else {
      const start = b.startTime < existing.startTime ? b.startTime : existing.startTime;
      const end = b.endTime > existing.endTime ? b.endTime : existing.endTime;
      byDay.set(b.dayOfWeek, {
        dayOfWeek: b.dayOfWeek,
        startTime: start,
        endTime: end,
        hasExplicitTime: existing.hasExplicitTime || b.hasExplicitTime,
      });
    }
  }

  const nowDay = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let bestCandidate: NextCourseClassInfo = {
    minutesUntil: Number.MAX_SAFE_INTEGER,
    status: 'unscheduled',
    badgeText: null,
  };

  for (const block of byDay.values()) {
    const startMin = parseMinutes(block.startTime) ?? 8 * 60;
    const parsedEnd = parseMinutes(block.endTime);
    const endMin = parsedEnd !== null && parsedEnd > startMin ? parsedEnd : startMin + 60;

    const dayName = DAY_NAMES_ES[block.dayOfWeek] || 'Día';
    const timeLabel = block.hasExplicitTime
      ? block.endTime && block.endTime !== block.startTime
        ? `${block.startTime} - ${block.endTime} hs`
        : `${block.startTime} hs`
      : '';

    let minutesUntil: number;
    let status: NextCourseClassInfo['status'];
    let badgeText: string;

    if (block.dayOfWeek === nowDay) {
      if (nowMinutes >= startMin && nowMinutes < endMin) {
        // Class is currently happening right now
        minutesUntil = -1000 + (startMin - nowMinutes);
        status = 'in_progress';
        badgeText = timeLabel ? `En curso · Hoy ${timeLabel}` : `Hoy (${dayName})`;
      } else if (startMin > nowMinutes) {
        // Class starts later today
        minutesUntil = startMin - nowMinutes;
        status = 'today';
        badgeText = timeLabel ? `Hoy · ${timeLabel}` : `Hoy (${dayName})`;
      } else {
        // Class already ended today -> next occurrence is next week
        minutesUntil = 7 * 1440 + (startMin - nowMinutes);
        status = 'upcoming';
        badgeText = timeLabel ? `${dayName} · ${timeLabel}` : dayName;
      }
    } else {
      const daysAhead = (block.dayOfWeek - nowDay + 7) % 7;
      minutesUntil = daysAhead * 1440 + (startMin - nowMinutes);
      if (daysAhead === 1) {
        status = 'tomorrow';
        badgeText = timeLabel ? `Mañana (${dayName}) · ${timeLabel}` : `Mañana (${dayName})`;
      } else {
        status = 'upcoming';
        badgeText = timeLabel ? `${dayName} · ${timeLabel}` : dayName;
      }
    }

    if (minutesUntil < bestCandidate.minutesUntil) {
      bestCandidate = {
        minutesUntil,
        status,
        badgeText,
        dayOfWeek: block.dayOfWeek,
        startTime: block.hasExplicitTime ? block.startTime : undefined,
        endTime: block.hasExplicitTime ? block.endTime : undefined,
      };
    }
  }

  return bestCandidate;
}

/**
 * Sorts courses chronologically according to the next upcoming class in the calendar.
 */
export function sortCoursesByUpcomingSchedule(
  courses: Course[],
  now: Date = new Date(),
  externalSlots?: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    title: string;
  }[]
): { course: Course; nextClass: NextCourseClassInfo }[] {
  return [...courses]
    .map((course) => ({
      course,
      nextClass: getNextCourseClassInfo(course, now, externalSlots),
    }))
    .sort((a, b) => {
      if (a.nextClass.minutesUntil !== b.nextClass.minutesUntil) {
        return a.nextClass.minutesUntil - b.nextClass.minutesUntil;
      }
      return formatCourseSidebarLabel(a.course).localeCompare(formatCourseSidebarLabel(b.course));
    });
}

