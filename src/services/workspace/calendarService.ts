/**
 * Google Calendar Integration Service
 * Endpoints:
 * - https://www.googleapis.com/calendar/v3/users/me/calendarList
 * - https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
 * Scopes:
 * - https://www.googleapis.com/auth/calendar.readonly
 * - https://www.googleapis.com/auth/calendar.events
 */

import { getCachedAccessToken } from './googleAuth';
import { CalendarEventItem, GoogleCalendarInfo, Course, CalendarEventCategory } from '../../types';
import { extractDailySlotsFromSchedule, extractWeekdaysFromSchedule } from '../../utils/schoolHolidays';
import { getLocalCourses } from '../storageHelpers';

export function isBusyOrGenericTitle(title?: string | null): boolean {
  if (!title) return true;
  const clean = title.trim().toLowerCase();
  if (!clean) return true;
  return /^(no disponible|ocupado|busy|sin t[ií]tulo|evento sin t[ií]tulo|clase|m[oó]dulo|bloque|horario|evento|-)$/i.test(clean);
}

export function getEffectiveCourseSchedule(course: Course): string {
  if (
    course.schedule &&
    course.schedule !== 'Lunes y Miércoles' &&
    !course.schedule.toLowerCase().includes('coordinar') &&
    course.schedule.trim().length > 0
  ) {
    return course.schedule.trim();
  }
  if (typeof window !== 'undefined' && course.id) {
    try {
      const raw = localStorage.getItem(`fds_libro_temas_${course.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const h = parsed?.metadata?.horario;
        if (h && typeof h === 'string' && h !== 'Sin horario especificado' && h !== 'Lunes y Miércoles') {
          return h.trim();
        }
      }
    } catch (_) {}
  }
  return course.schedule || '';
}

export function formatCourseCalendarTitle(course: Course): string {
  const baseName = (course.name || course.subject || 'Materia').trim();
  const extra = (course.division || course.grade || course.section || '').trim();
  if (extra && !baseName.toLowerCase().includes(extra.toLowerCase())) {
    return `${baseName} (${extra})`;
  }
  return baseName;
}

const timeToMinutes = (t?: string): number | null => {
  if (!t || !t.includes(':')) return null;
  const [h, m] = t.split(':').map((n) => parseInt(n, 10));
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

export function resolveCourseForEvent(
  courses: Course[],
  dayOfWeek?: number,
  startTime?: string,
  endTime?: string,
  rawTitle?: string
): Course | undefined {
  if (!Array.isArray(courses) || courses.length === 0) return undefined;

  const cleanStr = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // 1. First try matching by title if title is not generic/"No disponible"
  if (rawTitle && !isBusyOrGenericTitle(rawTitle)) {
    const titleClean = cleanStr(rawTitle);
    let bestCourse: Course | undefined;
    let bestScore = 0;

    for (const c of courses) {
      let score = 0;
      const cName = cleanStr(c.name);
      const cSubj = cleanStr(c.subject || '');
      const cGrade = cleanStr(c.grade || '');
      const cDiv = cleanStr(c.division || '');
      const cSec = cleanStr(c.section || '');

      if (cName && (titleClean === cName || titleClean.includes(cName))) score += 120;
      if (cSubj && titleClean.includes(cSubj)) score += 60;
      for (const tag of [cGrade, cDiv, cSec].filter((t) => t && t.length >= 2)) {
        if (titleClean.includes(tag)) score += 70;
      }

      if (score > bestScore && score >= 60) {
        bestScore = score;
        bestCourse = c;
      }
    }
    if (bestCourse) return bestCourse;
  }

  // 2. Match by dayOfWeek and time slot in the course's schedule
  if (dayOfWeek !== undefined && startTime) {
    const evStartMin = timeToMinutes(startTime);
    const evEndMin = timeToMinutes(endTime) ?? (evStartMin !== null ? evStartMin + 60 : null);

    for (const c of courses) {
      const sched = getEffectiveCourseSchedule(c);
      if (!sched) continue;
      const weekdays = extractWeekdaysFromSchedule(sched);
      if (!weekdays.includes(dayOfWeek)) continue;

      const dailySlots = extractDailySlotsFromSchedule(sched, weekdays);
      const daySlots = dailySlots[dayOfWeek] || [];

      for (const slot of daySlots) {
        if (!slot.startTime) continue;
        if (slot.startTime === startTime) {
          return c;
        }
        const sMin = timeToMinutes(slot.startTime);
        const eMin = timeToMinutes(slot.endTime) ?? (sMin !== null ? sMin + 60 : null);
        if (
          evStartMin !== null &&
          evEndMin !== null &&
          sMin !== null &&
          eMin !== null &&
          Math.max(evStartMin, sMin) < Math.min(evEndMin, eMin)
        ) {
          return c;
        }
      }
    }
  }

  return undefined;
}

export const calendarService = {
  /**
   * Fetch calendars list from user's Google account (excludes generic holiday/contact calendars by default)
   */
  async listCalendars(): Promise<{ success: boolean; calendars: GoogleCalendarInfo[]; isLive: boolean; message?: string }> {
    let token = await this.ensureValidToken();
    if (!token) {
      return {
        success: false,
        calendars: [
          { id: 'primary', summary: 'Mi Calendario Principal (Cuenta vinculada a Classroom)', primary: true, backgroundColor: '#2563eb' },
        ],
        isLive: false,
        message: 'Sesión de Google no conectada. Conecta tu cuenta de Google Workspace para sincronizar en tiempo real.',
      };
    }

    const fetchCalList = async (activeToken: string) => {
      const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (res.status === 401) return { unauthorized: true, items: [] };
      if (!res.ok) return { unauthorized: false, items: null };
      const data = await res.json();
      return { unauthorized: false, items: data.items || [] };
    };

    try {
      let attempt = await fetchCalList(token);
      if (attempt.unauthorized) {
        const { setCachedAccessToken, requestAccessToken } = await import('./googleAuth');
        setCachedAccessToken(null);
        token = await requestAccessToken();
        if (token) {
          attempt = await fetchCalList(token);
        }
      }

      if (attempt.items) {
        const calendars: GoogleCalendarInfo[] = attempt.items
          .filter(
            (c: any) =>
              !c.deleted &&
              !String(c.id || '').includes('#holiday@group') &&
              !String(c.id || '').includes('#contacts@group')
          )
          .map((c: any) => ({
            id: c.id || 'primary',
            summary: c.primary
              ? `${c.summaryOverride || c.summary || c.id || 'Calendario Principal'} (${String(c.id || '').includes('@fds-esc.edu.ar') ? 'Cuenta Colegio' : 'Cuenta Principal'})`
              : c.summaryOverride || c.summary || 'Calendario sin título',
            description: c.description || '',
            primary: !!c.primary,
            backgroundColor: c.backgroundColor || '#2563eb',
            foregroundColor: c.foregroundColor || '#ffffff',
            selected: !!c.selected,
          }));

        // Sort so primary is always first
        calendars.sort((a, b) => (a.primary === b.primary ? 0 : a.primary ? -1 : 1));

        return { success: true, calendars, isLive: true };
      }
    } catch (err: any) {
      console.warn('Live Google Calendar fetch error:', err);
    }

    return {
      success: false,
      calendars: [
        { id: 'primary', summary: 'Mi Calendario Principal (Cuenta Classroom)', primary: true, backgroundColor: '#2563eb' },
      ],
      isLive: false,
      message: 'No se pudo conectar directamente con Google Calendar.',
    };
  },

  /**
   * Fetch events from Google Calendar and merge with institutional events
   */
  async listEvents(options: {
    calendarId?: string;
    courseId?: string;
    category?: string;
    timeMin?: string;
    timeMax?: string;
  } = {}): Promise<{ success: boolean; events: CalendarEventItem[]; isLive: boolean; error?: string }> {
    const token = getCachedAccessToken();
    const calendarId = options.calendarId || 'primary';
    let googleEvents: CalendarEventItem[] = [];
    let isLive = false;

    if (token) {
      try {
        const params = new URLSearchParams();
        params.set('singleEvents', 'true');
        params.set('orderBy', 'startTime');
        params.set('maxResults', '150');

        if (options.timeMin) {
          params.set('timeMin', options.timeMin);
        } else {
          // Default to beginning of current month
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          params.set('timeMin', startOfMonth.toISOString());
        }

        if (options.timeMax) {
          params.set('timeMax', options.timeMax);
        } else {
          // Default to 2 months ahead
          const endFuture = new Date();
          endFuture.setMonth(endFuture.getMonth() + 2);
          params.set('timeMax', endFuture.toISOString());
        }

        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (res.ok) {
          const data = await res.json();
          isLive = true;
          googleEvents = (data.items || []).map((item: any) => {
            const startRaw = item.start?.dateTime || item.start?.date || '';
            const endRaw = item.end?.dateTime || item.end?.date || startRaw;
            const isAllDay = !item.start?.dateTime;

            // Detect category from title or summary
            const summaryLower = (item.summary || '').toLowerCase();
            let category: 'materia' | 'colegio' | 'examen' | 'reunion' | 'feriado' = 'materia';
            if (summaryLower.includes('feriado') || summaryLower.includes('asueto')) {
              category = 'feriado';
            } else if (summaryLower.includes('examen') || summaryLower.includes('evaluaci') || summaryLower.includes('parcial') || summaryLower.includes('recuperatorio')) {
              category = 'examen';
            } else if (summaryLower.includes('jornada') || summaryLower.includes('acto') || summaryLower.includes('colegio') || summaryLower.includes('libreta')) {
              category = 'colegio';
            } else if (summaryLower.includes('reuni') || summaryLower.includes('claustro') || summaryLower.includes('departamento')) {
              category = 'reunion';
            }

            // Extract start / end times and day of week for weekly timetable grilla
            let dayOfWeek: number | undefined = undefined;
            let startTime: string | undefined = undefined;
            let endTime: string | undefined = undefined;

            if (startRaw && !isAllDay) {
              try {
                const sDate = new Date(startRaw);
                const dow = sDate.getDay();
                if (dow >= 1 && dow <= 5) {
                  dayOfWeek = dow;
                }
                const sh = String(sDate.getHours()).padStart(2, '0');
                const sm = String(sDate.getMinutes()).padStart(2, '0');
                startTime = `${sh}:${sm}`;
              } catch (e) {}
            }

            if (endRaw && !isAllDay) {
              try {
                const eDate = new Date(endRaw);
                const eh = String(eDate.getHours()).padStart(2, '0');
                const em = String(eDate.getMinutes()).padStart(2, '0');
                endTime = `${eh}:${em}`;
              } catch (e) {}
            }

            const availableCourses = getLocalCourses();
            const matchedCourse = resolveCourseForEvent(
              availableCourses,
              dayOfWeek,
              startTime,
              endTime,
              item.summary
            );

            const resolvedTitle =
              matchedCourse && isBusyOrGenericTitle(item.summary)
                ? formatCourseCalendarTitle(matchedCourse)
                : matchedCourse && !String(item.summary || '').toLowerCase().includes((matchedCourse.name || '').toLowerCase())
                ? `${formatCourseCalendarTitle(matchedCourse)} (${item.summary})`
                : item.summary || (matchedCourse ? formatCourseCalendarTitle(matchedCourse) : 'Clase / Evento');

            return {
              id: item.id,
              calendarId,
              title: resolvedTitle,
              description: item.description || (matchedCourse ? `Materia: ${matchedCourse.name}` : ''),
              location: item.location || (matchedCourse?.room ? `Aula ${matchedCourse.room}` : ''),
              start: startRaw,
              end: endRaw,
              isAllDay,
              category: matchedCourse ? 'materia' : category,
              courseId: matchedCourse?.id,
              courseName: matchedCourse?.name,
              color: item.colorId ? '#2563eb' : '#3b82f6',
              dayOfWeek,
              startTime,
              endTime,
              htmlLink: item.htmlLink,
              syncedToGoogle: true,
            };
          });
        }
      } catch (err: any) {
        console.warn('Error fetching events from Google Calendar:', err);
      }
    }

    // Always fetch local backend calendar events (which include school events and course schedules)
    try {
      const query = new URLSearchParams();
      if (options.courseId) query.set('courseId', options.courseId);
      if (options.category) query.set('category', options.category);

      const localRes = await fetch(`/api/calendar/events?${query.toString()}`);
      if (localRes.ok) {
        const localData = await localRes.json();
        const localEvents: CalendarEventItem[] = localData.events || [];

        // Merge: avoid duplicate titles/dates if already present in Google events
        const merged = [...googleEvents];
        for (const le of localEvents) {
          const alreadyInGoogle = merged.some(
            ge => ge.title.toLowerCase().trim() === le.title.toLowerCase().trim() &&
                  ge.start.slice(0, 10) === le.start.slice(0, 10)
          );
          if (!alreadyInGoogle) {
            merged.push(le);
          }
        }

        return {
          success: true,
          events: merged,
          isLive,
        };
      }
    } catch (err: any) {
      console.warn('Error fetching local calendar events:', err);
    }

    return {
      success: true,
      events: googleEvents,
      isLive,
    };
  },

  /**
   * Create a new event in Google Calendar and sync to local backend
   */
  async createEvent(
    eventData: {
      title: string;
      description?: string;
      location?: string;
      start: string; // ISO string e.g. "2026-09-18T08:00:00"
      end: string;
      isAllDay?: boolean;
      category?: 'materia' | 'colegio' | 'examen' | 'reunion' | 'feriado';
      courseId?: string;
      courseName?: string;
      color?: string;
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      recurrence?: string;
    },
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; event: CalendarEventItem; googleEventId?: string; message: string }> {
    const token = getCachedAccessToken();
    let googleEventId: string | undefined;
    let htmlLink: string | undefined;

    // 1. If Google token available, create in Google Calendar via REST API
    if (token) {
      try {
        const googlePayload: any = {
          summary: eventData.title,
          description: eventData.description || '',
          location: eventData.location || '',
          visibility: 'public',
          transparency: 'opaque',
        };

        if (eventData.isAllDay) {
          googlePayload.start = { date: eventData.start.split('T')[0] };
          googlePayload.end = { date: eventData.end.split('T')[0] };
        } else {
          googlePayload.start = { dateTime: new Date(eventData.start).toISOString() };
          googlePayload.end = { dateTime: new Date(eventData.end).toISOString() };
        }

        // Add recurrence if requested
        if (eventData.recurrence && eventData.recurrence.toLowerCase().includes('semanal')) {
          googlePayload.recurrence = ['RRULE:FREQ=WEEKLY;COUNT=20'];
        }

        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(googlePayload),
          }
        );

        if (res.ok) {
          const gData = await res.json();
          googleEventId = gData.id;
          htmlLink = gData.htmlLink;
        }
      } catch (gErr) {
        console.warn('Could not create event in Google Calendar API:', gErr);
      }
    }

    // 2. Persist to backend
    const localRes = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...eventData,
        calendarId,
        htmlLink,
        syncedToGoogle: !!googleEventId,
      }),
    });

    const localData = await localRes.json();
    return {
      success: true,
      event: localData.event,
      googleEventId,
      message: googleEventId
        ? '¡Evento creado y sincronizado con tu Google Calendar exitosamente!'
        : 'Evento guardado en el calendario de la plataforma.',
    };
  },

  /**
   * Delete an event from Google Calendar and backend
   */
  async deleteEvent(eventId: string, calendarId: string = 'primary'): Promise<{ success: boolean; message: string }> {
    const token = getCachedAccessToken();
    if (token && !eventId.startsWith('sched-') && !eventId.startsWith('cal-ev-')) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      } catch (err) {
        console.warn('Error deleting event in Google Calendar API:', err);
      }
    }

    const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
    return res.json();
  },

  /**
   * Automatically sync timetable schedules from courses into the calendar
   */
  async syncCourseSchedules(targetCourseId?: string): Promise<{
    success: boolean;
    syncedCount: number;
    events: CalendarEventItem[];
    message: string;
  }> {
    const res = await fetch('/api/calendar/sync-course-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCourseId }),
    });
    return res.json();
  },

  /**
   * Import and cross-reference schedules and events directly from Google Calendar into the app
   */
  /**
   * Sync a course's weekly schedule to Google Calendar (Bidirectional: App -> Google Calendar)
   */
  async syncCourseScheduleToGoogle(
    course: Course,
    scheduleString: string,
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; createdCount: number; updatedCount?: number; message: string }> {
    let token = await this.ensureValidToken();
    if (!token) {
      return {
        success: false,
        createdCount: 0,
        message: 'No hay sesión de Google activa para sincronizar con Calendar.',
      };
    }

    // Evitar que se modifique el calendario personal (canomorenojj@gmail.com) al sincronizar materias del colegio
    let targetCalendarId =
      !calendarId || calendarId === 'all' || calendarId.toLowerCase() === 'canomorenojj@gmail.com'
        ? 'jorge.cano@fds-esc.edu.ar'
        : calendarId;

    // Verificar si el token actual pertenece al Gmail personal en vez de la cuenta del colegio
    try {
      const checkRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkRes.ok) {
        const primaryData = await checkRes.json();
        const primaryEmail = String(primaryData?.id || '').toLowerCase();
        if (primaryEmail === 'canomorenojj@gmail.com') {
          const { requestAccessToken } = await import('./googleAuth');
          const schoolToken = await requestAccessToken(true, 'jorge.cano@fds-esc.edu.ar');
          if (schoolToken) {
            token = schoolToken;
          } else {
            return {
              success: false,
              createdCount: 0,
              message: 'Para no modificar tu calendario personal, selecciona tu cuenta del colegio (jorge.cano@fds-esc.edu.ar) en la ventana de Google.',
            };
          }
        }
      }
    } catch (_) {}

    // RRULE day codes
    const rruleDays: { [key: number]: string } = {
      0: 'SU',
      1: 'MO',
      2: 'TU',
      3: 'WE',
      4: 'TH',
      5: 'FR',
      6: 'SA',
    };

    const dayMap: { [key: string]: number } = {
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

    const parts = (scheduleString || course.schedule || '').split(',');
    let createdCount = 0;

    for (const part of parts) {
      const clean = part.trim();
      if (!clean) continue;

      const match = clean.match(
        /(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s*([0-9]{1,2}:[0-9]{2})\s*[-aà]\s*([0-9]{1,2}:[0-9]{2})/i
      );
      if (!match) continue;

      const dayName = match[1].toLowerCase();
      const startTime = match[2].padStart(5, '0');
      const endTime = match[3].padStart(5, '0');
      const targetDayNum = dayMap[dayName] ?? 1;

      const today = new Date();
      const currentDay = today.getDay();
      let diff = targetDayNum - currentDay;
      if (diff < 0) diff += 7;
      const classDate = new Date(today);
      classDate.setDate(today.getDate() + diff);

      const yyyy = classDate.getFullYear();
      const mm = String(classDate.getMonth() + 1).padStart(2, '0');
      const dd = String(classDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const startDateTime = `${dateStr}T${startTime}:00`;
      const endDateTime = `${dateStr}T${endTime}:00`;
      const dayCode = rruleDays[targetDayNum] || 'MO';

      const googlePayload = {
        summary: `${course.name} (${course.division || course.grade || 'Curso'})`,
        description: `[DocencIA-Curso:${course.id}] Clase regular de ${course.subject || course.name}. Sincronizado desde DocencIA Pro.`,
        location: course.room ? `Aula ${course.room}` : 'Colegio',
        start: {
          dateTime: new Date(startDateTime).toISOString(),
        },
        end: {
          dateTime: new Date(endDateTime).toISOString(),
        },
        recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`],
      };

      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(googlePayload),
          }
        );
        if (res.ok) {
          createdCount++;
        }
      } catch (err) {
        console.warn('Error creating recurring course event in Google Calendar:', err);
      }
    }

    return {
      success: createdCount > 0,
      createdCount,
      message:
        createdCount > 0
          ? `¡Se crearon ${createdCount} bloque(s) semanal(es) de "${course.name}" en el calendario del colegio!`
          : 'El horario se guardó en la materia (usa formato "Lunes 08:00 - 09:30" para crear bloques en Google Calendar).',
    };
  },

  /**
   * Helper to ensure a valid Google OAuth token, requesting one interactively if missing or expired
   */
  async ensureValidToken(): Promise<string | null> {
    let token = getCachedAccessToken();
    if (!token) {
      try {
        const { requestAccessToken } = await import('./googleAuth');
        token = await requestAccessToken(false, 'jorge.cano@fds-esc.edu.ar');
      } catch (err) {
        console.warn('Could not obtain fresh Google OAuth token:', err);
        return null;
      }
    }
    return token;
  },

  /**
   * Ultra-fast helper: returns all weekly class slots detected in the selected Google Calendar
   * Defaults to 'primary' (the calendar linked to the user's Classroom/Google account).
   */
  async getWeeklyCalendarSlots(
    calendarId: string = 'primary',
    courses?: Course[]
  ): Promise<{
    success: boolean;
    slots: {
      id: string;
      title: string;
      dayOfWeek: number;
      dayName: string;
      startTime: string;
      endTime: string;
      displayText: string;
      calendarName?: string;
    }[];
    message: string;
  }> {
    let token = await this.ensureValidToken();
    if (!token) {
      return { success: false, slots: [], message: 'Inicia sesión con Google Workspace para ver los módulos de tu calendario.' };
    }

    const targetCalendarId =
      !calendarId || calendarId === 'all' || calendarId.toLowerCase() === 'canomorenojj@gmail.com'
        ? 'primary'
        : calendarId;

    const fetchSlotsWithToken = async (activeToken: string) => {
      // Scan 14-day window starting from current week's Monday (to catch bi-weekly or next-week modules if current week had a holiday)
      const now = new Date();
      const currentDay = now.getDay(); // 0 is Sunday
      const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;

      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayDiff);
      monday.setHours(0, 0, 0, 0);

      const twoWeeksEnd = new Date(monday);
      twoWeeksEnd.setDate(monday.getDate() + 13);
      twoWeeksEnd.setHours(23, 59, 59, 999);

      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', '250');
      params.set('timeMin', monday.toISOString());
      params.set('timeMax', twoWeeksEnd.toISOString());

      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?${params.toString()}`,
          { headers: { Authorization: `Bearer ${activeToken}` } }
        );
        if (res.status === 401) {
          return { unauthorized: true, rawEntries: [] };
        }
        if (!res.ok) {
          return { unauthorized: false, rawEntries: [] };
        }
        const data = await res.json();
        const calSummary = data.summary || (targetCalendarId === 'primary' ? 'Calendario Principal (Cuenta Colegio)' : targetCalendarId);
        const rawEntries = (data.items || []).map((item: any) => ({
          item,
          calName: calSummary,
        }));
        return { unauthorized: false, rawEntries };
      } catch (_) {
        return { unauthorized: false, rawEntries: [] };
      }
    };

    try {
      let attempt = await fetchSlotsWithToken(token);
      if (attempt.unauthorized) {
        // Token expired -> clear and request a fresh one automatically
        const { setCachedAccessToken, requestAccessToken } = await import('./googleAuth');
        setCachedAccessToken(null);
        token = await requestAccessToken(false, 'jorge.cano@fds-esc.edu.ar');
        if (!token) {
          return { success: false, slots: [], message: 'Tu sesión de Google expiró. Vuelve a intentar para autorizar.' };
        }
        attempt = await fetchSlotsWithToken(token);
      }

      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const slots: any[] = [];
      const seen = new Set<string>();

      const availableCourses = courses && courses.length > 0 ? courses : getLocalCourses();

      for (const { item, calName } of attempt.rawEntries) {
        if (item.status === 'cancelled') continue;
        if (!item.start?.dateTime || !item.end?.dateTime) continue; // skip all-day notes

        const sDate = new Date(item.start.dateTime);
        const eDate = new Date(item.end.dateTime);
        const dow = sDate.getDay();
        const sh = String(sDate.getHours()).padStart(2, '0');
        const sm = String(sDate.getMinutes()).padStart(2, '0');
        const eh = String(eDate.getHours()).padStart(2, '0');
        const em = String(eDate.getMinutes()).padStart(2, '0');

        const startTime = `${sh}:${sm}`;
        const endTime = `${eh}:${em}`;
        const dayName = dayNames[dow];
        const displayText = `${dayName} ${startTime} - ${endTime}`;

        const rawSummary = (item.summary || '').trim();
        const matchedCourse = resolveCourseForEvent(availableCourses, dow, startTime, endTime, rawSummary);
        const title =
          matchedCourse && isBusyOrGenericTitle(rawSummary)
            ? formatCourseCalendarTitle(matchedCourse)
            : rawSummary || (matchedCourse ? formatCourseCalendarTitle(matchedCourse) : 'Bloque de clase');

        const key = `${dow}_${startTime}_${endTime}_${title.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          slots.push({
            id: item.id || key,
            title,
            dayOfWeek: dow,
            dayName,
            startTime,
            endTime,
            displayText,
            calendarName: calName,
          });
        }
      }

      // Sort by day of week (Mon to Sun) then time
      const daySortOrder = (d: number) => (d === 0 ? 7 : d);
      slots.sort((a, b) => daySortOrder(a.dayOfWeek) - daySortOrder(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));

      return {
        success: true,
        slots,
        message:
          slots.length > 0
            ? `Se encontraron ${slots.length} módulos horarios en el calendario seleccionado.`
            : 'No se encontraron bloques con horario específico en el calendario seleccionado.',
      };
    } catch (err: any) {
      return { success: false, slots: [], message: err.message || 'Error al obtener bloques de Calendar.' };
    }
  },

  /**
   * Ultra-fast Auto Sync: inspects current week + 1 week in the selected Google Calendar (defaults to 'primary')
   */
  async importSchedulesFromGoogleCalendar(
    courses: Course[],
    calendarId: string = 'primary',
    autoUpdateCourseScheduleStrings: boolean = true
  ): Promise<{
    success: boolean;
    totalFound: number;
    matchedClasses: number;
    importedSchoolEvents: number;
    updatedCoursesCount: number;
    events: CalendarEventItem[];
    schedulesMap: Record<string, string>;
    message: string;
  }> {
    let token = await this.ensureValidToken();
    if (!token) {
      return {
        success: false,
        totalFound: 0,
        matchedClasses: 0,
        importedSchoolEvents: 0,
        updatedCoursesCount: 0,
        events: [],
        schedulesMap: {},
        message: 'Debes autorizar tu cuenta de Google para importar desde Google Calendar.',
      };
    }

    const targetCalendarId = !calendarId || calendarId === 'all' ? 'primary' : calendarId;

    try {
      // 1. Scan 2-week window (Monday of current week to Sunday of next week)
      const now = new Date();
      const currentDay = now.getDay();
      const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;

      const timeMin = new Date(now);
      timeMin.setDate(now.getDate() + mondayDiff);
      timeMin.setHours(0, 0, 0, 0);

      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMin.getDate() + 13);
      timeMax.setHours(23, 59, 59, 999);

      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', '250');
      params.set('timeMin', timeMin.toISOString());
      params.set('timeMax', timeMax.toISOString());

      const fetchItemsFromSelectedCalendar = async (activeToken: string) => {
        try {
          const r = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?${params.toString()}`,
            { headers: { Authorization: `Bearer ${activeToken}` } }
          );
          if (r.status === 401) return { unauthorized: true, items: [] };
          if (!r.ok) return { unauthorized: false, items: [] };
          const d = await r.json();
          return { unauthorized: false, items: d.items || [] };
        } catch (_) {
          return { unauthorized: false, items: [] };
        }
      };

      let fetchAttempt = await fetchItemsFromSelectedCalendar(token);
      if (fetchAttempt.unauthorized) {
        const { setCachedAccessToken, requestAccessToken } = await import('./googleAuth');
        setCachedAccessToken(null);
        token = await requestAccessToken();
        if (!token) {
          throw new Error('La sesión de Google Calendar expiró. Intenta nuevamente.');
        }
        fetchAttempt = await fetchItemsFromSelectedCalendar(token);
      }

      const rawItems: any[] = fetchAttempt.items || [];

      let matchedClassesCount = 0;
      let importedSchoolEventsCount = 0;
      const importedEvents: CalendarEventItem[] = [];
      
      // Structure to aggregate slot records per course
      interface SlotItem {
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        text: string;
      }
      const courseSlotsMap: Record<string, SlotItem[]> = {};

      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const seenWeeklyKeys = new Set<string>();

      // String normalization helper
      const cleanStr = (s: string) =>
        (s || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // remove accents
          .replace(/[^a-z0-9]/g, ' ')      // replace punctuation with spaces
          .replace(/\s+/g, ' ')
          .trim();

      for (const item of rawItems) {
        const title = (item.summary || '').trim();
        if (!title) continue;

        const startRaw = item.start?.dateTime || item.start?.date || '';
        const endRaw = item.end?.dateTime || item.end?.date || startRaw;
        const isAllDay = !item.start?.dateTime;

        const summaryLower = title.toLowerCase();

        // Categorize non-class events
        let category: CalendarEventCategory = 'colegio';
        if (summaryLower.includes('feriado') || summaryLower.includes('asueto')) {
          category = 'feriado';
        } else if (summaryLower.includes('examen') || summaryLower.includes('parcial') || summaryLower.includes('evaluaci') || summaryLower.includes('mesa')) {
          category = 'examen';
        } else if (summaryLower.includes('reuni') || summaryLower.includes('claustro') || summaryLower.includes('departamento')) {
          category = 'reunion';
        } else if (summaryLower.includes('jornada') || summaryLower.includes('acto') || summaryLower.includes('libreta')) {
          category = 'colegio';
        }

        // High-precision Course Matcher
        const fullEventText = cleanStr(`${title} ${item.description || ''} ${item.location || ''}`);
        const summaryClean = cleanStr(title);

        let matchedCourse: Course | undefined = undefined;
        let highestScore = 0;

        for (const c of courses) {
          let score = 0;
          const courseNameClean = cleanStr(c.name);
          const subjClean = cleanStr(c.subject || '');
          const secClean = cleanStr(c.section || '');
          const gradeClean = cleanStr(c.grade || '');
          const divClean = cleanStr(c.division || '');

          // 1. Exact or contained full course name
          if (summaryClean === courseNameClean) {
            score += 200;
          } else if (fullEventText.includes(courseNameClean)) {
            score += 150;
          }

          // 2. Specific section / division / grade match
          const specificTags = [secClean, divClean, gradeClean].filter((t) => t && t.length >= 2);
          for (const tag of specificTags) {
            if (summaryClean.includes(tag)) {
              score += 90;
            } else if (fullEventText.includes(tag)) {
              score += 60;
            }
          }

          // Negative penalty if this course has a specific section, but event explicitly contains another course's section
          for (const otherC of courses) {
            if (otherC.id === c.id) continue;
            const otherSec = cleanStr(otherC.section || '');
            if (otherSec && otherSec !== secClean && (summaryClean.includes(otherSec) || fullEventText.includes(otherSec))) {
              score -= 80;
            }
          }

          // 3. Subject match
          if (subjClean && (summaryClean.includes(subjClean) || fullEventText.includes(subjClean))) {
            score += 35;
          }

          // 4. Token overlap
          const courseTokens = courseNameClean.split(' ').filter((w) => w.length >= 2);
          let matchedTokens = 0;
          for (const token of courseTokens) {
            if (summaryClean.includes(token)) matchedTokens++;
          }
          if (courseTokens.length > 0 && matchedTokens === courseTokens.length) {
            score += 45;
          }

          if (score > highestScore && score >= 50) {
            highestScore = score;
            matchedCourse = c;
          }
        }

        if (matchedCourse) {
          category = 'materia';
        }

        // Detect day of week and times
        let dayOfWeek: number | undefined = undefined;
        let startTime: string | undefined = undefined;
        let endTime: string | undefined = undefined;

        if (startRaw && !isAllDay) {
          const sDate = new Date(startRaw);
          const dow = sDate.getDay();
          // Monday through Friday (or weekend if applicable)
          dayOfWeek = dow;
          const sh = String(sDate.getHours()).padStart(2, '0');
          const sm = String(sDate.getMinutes()).padStart(2, '0');
          startTime = `${sh}:${sm}`;
        }

        if (endRaw && !isAllDay) {
          const eDate = new Date(endRaw);
          const eh = String(eDate.getHours()).padStart(2, '0');
          const em = String(eDate.getMinutes()).padStart(2, '0');
          endTime = `${eh}:${em}`;
        }

        // For weekly classes, deduplicate identical recurring slots
        if (dayOfWeek !== undefined && startTime) {
          const dedupeWeeklyKey = `${matchedCourse?.id || summaryLower}_d${dayOfWeek}_${startTime}`;
          if (seenWeeklyKeys.has(dedupeWeeklyKey)) {
            continue;
          }
          seenWeeklyKeys.add(dedupeWeeklyKey);
        }

        if (matchedCourse && dayOfWeek !== undefined && startTime && endTime) {
          matchedClassesCount++;
          const dayLabel = dayNames[dayOfWeek];
          const slotText = `${dayLabel} ${startTime} - ${endTime}`;

          if (!courseSlotsMap[matchedCourse.id]) {
            courseSlotsMap[matchedCourse.id] = [];
          }

          if (!courseSlotsMap[matchedCourse.id].some((s) => s.dayOfWeek === dayOfWeek && s.startTime === startTime)) {
            courseSlotsMap[matchedCourse.id].push({
              dayOfWeek,
              startTime,
              endTime,
              text: slotText,
            });
          }
        } else if (category !== 'materia') {
          importedSchoolEventsCount++;
        }

        // Save into app backend calendar
        const eventPayload: any = {
          id: `gcal-${item.id}`,
          title: matchedCourse && !title.toLowerCase().startsWith('clase') ? `Clase: ${title}` : title,
          description: item.description || (matchedCourse ? `Materia: ${matchedCourse.name}` : ''),
          location: item.location || (matchedCourse?.room ? `Aula ${matchedCourse.room}` : ''),
          start: startRaw,
          end: endRaw,
          isAllDay,
          category,
          courseId: matchedCourse?.id,
          courseName: matchedCourse?.name,
          color: matchedCourse?.color || (category === 'feriado' ? '#16a34a' : category === 'examen' ? '#dc2626' : '#2563eb'),
          dayOfWeek,
          startTime,
          endTime,
          recurrence: item.recurrence ? 'Semanal en Calendar' : (dayOfWeek !== undefined ? 'Semanal' : 'Única vez'),
          htmlLink: item.htmlLink,
          syncedToGoogle: true,
        };

        try {
          const saveRes = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventPayload),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            importedEvents.push(saved.event);
          }
        } catch (e) {
          console.warn('Error saving imported event to backend:', e);
        }
      }

      // 3. Format ordered schedule strings: Monday (1) to Friday (5), then Saturday (6), Sunday (0)
      const daySortOrder = (d: number) => (d === 0 ? 7 : d);
      const schedulesMap: Record<string, string> = {};
      let updatedCoursesCount = 0;

      for (const [courseId, slots] of Object.entries(courseSlotsMap)) {
        slots.sort((a, b) => daySortOrder(a.dayOfWeek) - daySortOrder(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));
        const scheduleStr = slots.map((s) => s.text).join(', ');
        schedulesMap[courseId] = scheduleStr;

        if (autoUpdateCourseScheduleStrings && scheduleStr) {
          try {
            const patchRes = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ schedule: scheduleStr }),
            });
            if (patchRes.ok) {
              updatedCoursesCount++;
            }
          } catch (pErr) {
            console.warn('Error patching course schedule:', pErr);
          }
        }
      }

      return {
        success: true,
        totalFound: rawItems.length,
        matchedClasses: matchedClassesCount,
        importedSchoolEvents: importedSchoolEventsCount,
        updatedCoursesCount,
        events: importedEvents,
        schedulesMap,
        message:
          updatedCoursesCount > 0
            ? `Se sincronizaron con éxito los días y horarios de ${updatedCoursesCount} materia(s) desde Google Calendar.`
            : `Se analizaron ${rawItems.length} eventos de Google Calendar.`,
      };
    } catch (err: any) {
      console.error('Error importing from Google Calendar:', err);
      return {
        success: false,
        totalFound: 0,
        matchedClasses: 0,
        importedSchoolEvents: 0,
        updatedCoursesCount: 0,
        events: [],
        schedulesMap: {},
        message: err.message || 'Error al conectar con Google Calendar.',
      };
    }
  },

  /**
   * Cleans up repeated/redundant calendar events in the database
   */
  async deduplicateEvents(): Promise<{ success: boolean; removedCount: number; remainingCount: number; message: string }> {
    try {
      const res = await fetch('/api/calendar/deduplicate', {
        method: 'POST',
      });
      if (res.ok) {
        return await res.json();
      }
      throw new Error(`Error ${res.status} al deduplicar eventos.`);
    } catch (err: any) {
      return {
        success: false,
        removedCount: 0,
        remainingCount: 0,
        message: err.message || 'Error al limpiar eventos duplicados.',
      };
    }
  },

  /**
   * Resets class blocks in the calendar to allow a fresh, clean configuration
   */
  async clearClassSchedules(): Promise<{ success: boolean; clearedCount: number; remainingCount: number; message: string }> {
    try {
      const res = await fetch('/api/calendar/clear-classes', {
        method: 'POST',
      });
      if (res.ok) {
        return await res.json();
      }
      throw new Error(`Error ${res.status} al limpiar horarios de materias.`);
    } catch (err: any) {
      return {
        success: false,
        clearedCount: 0,
        remainingCount: 0,
        message: err.message || 'Error al restablecer horarios.',
      };
    }
  },

  /**
   * Syncs all teacher courses to Google Calendar and updates any "No disponible" / unnamed events
   * so that Google Calendar Oficial shows the exact name of each Materia.
   */
  async syncAllCoursesToGoogleCalendar(
    courses: Course[],
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; totalUpdated: number; totalCreated: number; message: string }> {
    const token = await this.ensureValidToken();
    if (!token) {
      return {
        success: false,
        totalUpdated: 0,
        totalCreated: 0,
        message: 'Conecta tu sesión de Google para actualizar los nombres de las materias en Google Calendar.',
      };
    }

    const activeCourses = (courses && courses.length > 0 ? courses : getLocalCourses()).filter(
      (c) => getEffectiveCourseSchedule(c).trim().length > 0
    );

    let totalUpdated = 0;
    let totalCreated = 0;

    for (const course of activeCourses) {
      const sched = getEffectiveCourseSchedule(course);
      const targetCal = course.preferredCalendarId || calendarId || 'primary';
      const res = await this.syncCourseScheduleToGoogle(course, sched, targetCal);
      totalCreated += res.createdCount || 0;
      totalUpdated += res.updatedCount || 0;
    }

    // Also inspect current 2-week window in primary calendar for any events that match a course by name/time
    // or have visibility='private' so they become visible with full title in Google Calendar Oficial
    try {
      const targetCalId = !calendarId || calendarId === 'all' ? 'primary' : calendarId;
      const now = new Date();
      const mondayDiff = now.getDay() === 0 ? -6 : 1 - now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayDiff);
      monday.setHours(0, 0, 0, 0);
      const twoWeeksEnd = new Date(monday);
      twoWeeksEnd.setDate(monday.getDate() + 13);
      twoWeeksEnd.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        timeMin: monday.toISOString(),
        timeMax: twoWeeksEnd.toISOString(),
      });

      const listRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (listRes.ok) {
        const data = await listRes.json();
        const items: any[] = data.items || [];
        const patchedMasters = new Set<string>();
        const allCourses = courses && courses.length > 0 ? courses : getLocalCourses();

        for (const item of items) {
          if (item.status === 'cancelled' || !item.start?.dateTime) continue;
          const sDate = new Date(item.start.dateTime);
          const eDate = item.end?.dateTime ? new Date(item.end.dateTime) : sDate;
          const dow = sDate.getDay();
          const startTime = `${String(sDate.getHours()).padStart(2, '0')}:${String(sDate.getMinutes()).padStart(2, '0')}`;
          const endTime = `${String(eDate.getHours()).padStart(2, '0')}:${String(eDate.getMinutes()).padStart(2, '0')}`;

          const matched = resolveCourseForEvent(allCourses, dow, startTime, endTime, item.summary);
          const needsTitleFix = matched && (isBusyOrGenericTitle(item.summary) || item.visibility === 'private' || item.visibility === 'confidential');
          const needsVisibilityFix = item.visibility === 'private' || item.visibility === 'confidential';

          if (needsTitleFix || needsVisibilityFix) {
            const masterId = item.recurringEventId || item.id;
            if (masterId && !patchedMasters.has(masterId)) {
              patchedMasters.add(masterId);
              const patchBody: any = {
                visibility: 'public',
                transparency: 'opaque',
              };
              if (matched) {
                patchBody.summary = formatCourseCalendarTitle(matched);
              }
              const pRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events/${encodeURIComponent(masterId)}`,
                {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(patchBody),
                }
              );
              if (pRes.ok) totalUpdated++;
            }
          }
        }
      }
    } catch (_) {}

    const total = totalUpdated + totalCreated;
    return {
      success: total > 0 || activeCourses.length > 0,
      totalUpdated,
      totalCreated,
      message:
        total > 0
          ? `¡Listo! Se actualizaron ${totalUpdated} evento(s) y se crearon ${totalCreated} bloque(s) con el nombre de tus materias en Google Calendar.`
          : 'Tus materias ya están sincronizadas con Google Calendar.',
    };
  },

  /**
   * Fetches live Google Calendar events across multiple configured calendars for a specific date range
   * AND enriches/merges them with the teacher's Materias so no event ever appears as "No disponible".
   */
  async fetchMultiCalendarLiveEvents(
    configuredCalendars: { id: string; name: string; color: string; isPrimary?: boolean }[],
    timeMinISO: string,
    timeMaxISO: string,
    coursesInput?: Course[]
  ): Promise<{
    success: boolean;
    isLive: boolean;
    events: (CalendarEventItem & { calendarName?: string; courseDivision?: string; courseRoom?: string })[];
  }> {
    const courses = coursesInput && coursesInput.length > 0 ? coursesInput : getLocalCourses();
    let token = getCachedAccessToken();
    const allEvents: (CalendarEventItem & { calendarName?: string; courseDivision?: string; courseRoom?: string })[] = [];
    let isLive = false;

    if (token && configuredCalendars.length > 0) {
      const fetchForCalendar = async (cal: { id: string; name: string; color: string; isPrimary?: boolean }, activeToken: string) => {
        const targetId = cal.isPrimary ? 'primary' : cal.id;
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          timeMin: timeMinISO,
          timeMax: timeMaxISO,
        });
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetId)}/events?${params.toString()}`,
          { headers: { Authorization: `Bearer ${activeToken}` } }
        );
        if (res.status === 401) return { unauthorized: true, items: [] };
        if (!res.ok && targetId !== 'primary' && cal.id.includes('@')) {
          // Fallback to 'primary' if primary email was passed
          const retryPrimary = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
            { headers: { Authorization: `Bearer ${activeToken}` } }
          );
          if (retryPrimary.ok) {
            const d = await retryPrimary.json();
            return { unauthorized: false, items: d.items || [] };
          }
        }
        if (!res.ok) return { unauthorized: false, items: [] };
        const data = await res.json();
        return { unauthorized: false, items: data.items || [] };
      };

      for (const cal of configuredCalendars) {
        try {
          let attempt = await fetchForCalendar(cal, token);
          if (attempt.unauthorized) {
            const { setCachedAccessToken, requestAccessToken } = await import('./googleAuth');
            setCachedAccessToken(null);
            const fresh = await requestAccessToken();
            if (fresh) {
              token = fresh;
              attempt = await fetchForCalendar(cal, fresh);
            }
          }

          if (attempt.items && attempt.items.length > 0) {
            isLive = true;
            for (const item of attempt.items) {
              if (item.status === 'cancelled') continue;
              const startRaw = item.start?.dateTime || item.start?.date || '';
              const endRaw = item.end?.dateTime || item.end?.date || startRaw;
              if (!startRaw) continue;
              const isAllDay = !item.start?.dateTime;

              let dayOfWeek: number | undefined;
              let startTime: string | undefined;
              let endTime: string | undefined;

              if (!isAllDay) {
                const sDate = new Date(startRaw);
                const eDate = new Date(endRaw);
                dayOfWeek = sDate.getDay();
                startTime = `${String(sDate.getHours()).padStart(2, '0')}:${String(sDate.getMinutes()).padStart(2, '0')}`;
                endTime = `${String(eDate.getHours()).padStart(2, '0')}:${String(eDate.getMinutes()).padStart(2, '0')}`;
              }

              const rawSummary = (item.summary || '').trim();
              const matchedCourse = resolveCourseForEvent(courses, dayOfWeek, startTime, endTime, rawSummary);

              let resolvedTitle = rawSummary;
              if (matchedCourse) {
                const courseTitle = formatCourseCalendarTitle(matchedCourse);
                if (isBusyOrGenericTitle(rawSummary)) {
                  resolvedTitle = courseTitle;
                } else if (!rawSummary.toLowerCase().includes((matchedCourse.name || '').toLowerCase())) {
                  resolvedTitle = `${courseTitle} • ${rawSummary}`;
                } else {
                  resolvedTitle = rawSummary;
                }
              } else if (isBusyOrGenericTitle(rawSummary)) {
                resolvedTitle = cal.name || 'Evento de Calendario';
              }

              const summaryLower = resolvedTitle.toLowerCase();
              let category: CalendarEventCategory = matchedCourse ? 'materia' : 'colegio';
              if (summaryLower.includes('feriado') || summaryLower.includes('asueto')) category = 'feriado';
              else if (summaryLower.includes('examen') || summaryLower.includes('evaluaci') || summaryLower.includes('parcial')) category = 'examen';
              else if (summaryLower.includes('reuni') || summaryLower.includes('departamento')) category = 'reunion';

              allEvents.push({
                id: `${cal.id}_${item.id}`,
                calendarId: cal.id,
                calendarName: cal.name,
                title: resolvedTitle,
                description: item.description || (matchedCourse ? `Materia: ${matchedCourse.name}` : ''),
                location: item.location || (matchedCourse?.room ? `Aula ${matchedCourse.room}` : ''),
                start: startRaw,
                end: endRaw,
                isAllDay,
                category,
                courseId: matchedCourse?.id,
                courseName: matchedCourse?.name,
                courseDivision: matchedCourse?.division || matchedCourse?.grade || matchedCourse?.section,
                courseRoom: matchedCourse?.room,
                color: cal.color || '#1a73e8',
                dayOfWeek,
                startTime,
                endTime,
                htmlLink: item.htmlLink,
                syncedToGoogle: true,
              });
            }
          }
        } catch (e) {
          console.warn('Error fetching calendar events for view:', e);
        }
      }
    }

    // Also synthesize weekly class occurrences from the teacher's Materias (courses) inside [timeMinISO, timeMaxISO]
    // so that any Materia whose schedule is configured in the app ALWAYS appears with its Materia name on the calendar!
    try {
      const rangeStart = new Date(timeMinISO);
      const rangeEnd = new Date(timeMaxISO);

      for (const course of courses) {
        const sched = getEffectiveCourseSchedule(course);
        if (!sched) continue;
        const weekdays = extractWeekdaysFromSchedule(sched);
        if (weekdays.length === 0) continue;
        const dailySlots = extractDailySlotsFromSchedule(sched, weekdays);
        const courseTitle = formatCourseCalendarTitle(course);

        const cursor = new Date(rangeStart);
        cursor.setHours(0, 0, 0, 0);

        while (cursor <= rangeEnd) {
          const dow = cursor.getDay();
          const daySlots = dailySlots[dow] || [];
          if (daySlots.length > 0) {
            const yyyy = cursor.getFullYear();
            const mm = String(cursor.getMonth() + 1).padStart(2, '0');
            const dd = String(cursor.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            for (const slot of daySlots) {
              const sTime = slot.startTime || '08:00';
              const eTime = slot.endTime || '09:00';
              const sMin = timeToMinutes(sTime) ?? 480;
              const eMin = timeToMinutes(eTime) ?? sMin + 60;

              // Check if an event on this exact date & overlapping time already exists in allEvents
              const existingIdx = allEvents.findIndex((ev) => {
                if (ev.isAllDay || !ev.start.startsWith(dateStr)) return false;
                if (ev.startTime === sTime) return true;
                const evS = timeToMinutes(ev.startTime);
                const evE = timeToMinutes(ev.endTime);
                if (evS !== null && evE !== null) {
                  return Math.max(sMin, evS) < Math.min(eMin, evE);
                }
                return false;
              });

              if (existingIdx >= 0) {
                // Ensure the existing event has the Materia name and course metadata attached!
                const ex = allEvents[existingIdx];
                if (!ex.courseId) {
                  ex.courseId = course.id;
                  ex.courseName = course.name;
                  ex.courseDivision = course.division || course.grade || course.section;
                  ex.courseRoom = course.room;
                  ex.category = 'materia';
                }
                if (isBusyOrGenericTitle(ex.title) || ex.title === ex.calendarName) {
                  ex.title = courseTitle;
                }
              } else {
                allEvents.push({
                  id: `course-slot-${course.id}-${dateStr}-${sTime}`,
                  calendarId: 'primary',
                  calendarName: 'Horario de Materia',
                  title: courseTitle,
                  description: `Materia: ${course.name}${course.subject ? ` • ${course.subject}` : ''}`,
                  location: course.room ? `Aula ${course.room}` : '',
                  start: `${dateStr}T${sTime}:00`,
                  end: `${dateStr}T${eTime}:00`,
                  isAllDay: false,
                  category: 'materia',
                  courseId: course.id,
                  courseName: course.name,
                  courseDivision: course.division || course.grade || course.section,
                  courseRoom: course.room,
                  color: '#1a73e8',
                  dayOfWeek: dow,
                  startTime: sTime,
                  endTime: eTime,
                  syncedToGoogle: false,
                });
              }
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    } catch (e) {
      console.warn('Error synthesizing course schedule events:', e);
    }

    allEvents.sort((a, b) => a.start.localeCompare(b.start));

    return {
      success: true,
      isLive,
      events: allEvents,
    };
  },
};
