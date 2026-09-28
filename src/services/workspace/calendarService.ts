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

export const calendarService = {
  /**
   * Fetch calendars list from user's Google account
   */
  async listCalendars(): Promise<{ success: boolean; calendars: GoogleCalendarInfo[]; isLive: boolean; message?: string }> {
    const token = getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        calendars: [
          { id: 'primary', summary: 'Calendario Principal (Local)', primary: true, backgroundColor: '#2563eb' },
          { id: 'school', summary: 'Calendario Institucional Colegio', backgroundColor: '#0284c7' },
        ],
        isLive: false,
        message: 'Sesión de Google no conectada. Conecta tu cuenta de Google Workspace para sincronizar en tiempo real.',
      };
    }

    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const calendars: GoogleCalendarInfo[] = (data.items || []).map((c: any) => ({
          id: c.id,
          summary: c.summary || 'Calendario sin título',
          description: c.description || '',
          primary: !!c.primary,
          backgroundColor: c.backgroundColor || '#2563eb',
          foregroundColor: c.foregroundColor || '#ffffff',
          selected: !!c.selected,
        }));
        return { success: true, calendars, isLive: true };
      }
    } catch (err: any) {
      console.warn('Live Google Calendar fetch error:', err);
    }

    return {
      success: false,
      calendars: [
        { id: 'primary', summary: 'Calendario Principal Docente', primary: true, backgroundColor: '#2563eb' },
      ],
      isLive: false,
      message: 'No se pudo conectar directamente con Google Calendar. Mostrando datos locales.',
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

            return {
              id: item.id,
              calendarId,
              title: item.summary || 'Evento sin título',
              description: item.description || '',
              location: item.location || '',
              start: startRaw,
              end: endRaw,
              isAllDay,
              category,
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
  ): Promise<{ success: boolean; createdCount: number; message: string }> {
    const token = getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        createdCount: 0,
        message: 'No hay sesión de Google activa para sincronizar con Calendar.',
      };
    }

    // Days mapping in Spanish
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

    const parts = (scheduleString || '').split(',');
    let createdCount = 0;

    for (const part of parts) {
      const match = part.trim().match(/(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s*([0-9]{1,2}:[0-9]{2})\s*[-aà]\s*([0-9]{1,2}:[0-9]{2})/i);
      if (!match) continue;

      const dayName = match[1].toLowerCase();
      const dayNum = dayMap[dayName] ?? 1;
      const startTime = match[2].padStart(5, '0');
      const endTime = match[3].padStart(5, '0');

      // Calculate next upcoming date for this day of week
      const today = new Date();
      const currentDay = today.getDay();
      let diff = dayNum - currentDay;
      if (diff < 0) diff += 7;
      const classDate = new Date(today);
      classDate.setDate(today.getDate() + diff);

      const yyyy = classDate.getFullYear();
      const mm = String(classDate.getMonth() + 1).padStart(2, '0');
      const dd = String(classDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const startDateTime = `${dateStr}T${startTime}:00`;
      const endDateTime = `${dateStr}T${endTime}:00`;

      const dayCode = rruleDays[dayNum] || 'MO';

      const googlePayload = {
        summary: `Clase: ${course.name}`,
        description: `Materia escolar: ${course.name}\nDivisión / Curso: ${course.division || course.section || 'General'}\nAula: ${course.room || 'Aula asignada'}\nSincronizado desde el Cuaderno de Cátedra Digital.`,
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
          ? `¡Sincronizado con Google Calendar! Se crearon ${createdCount} bloque(s) de clase semanales en tu calendario.`
          : 'No se pudieron crear los eventos en Google Calendar.',
    };
  },

  /**
   * Ultra-fast helper: returns all weekly class slots detected in Google Calendar this week
   * Allows the teacher to click and pick their class block instantly without waiting or fuzzy guessing.
   */
  async getWeeklyCalendarSlots(
    calendarId: string = 'primary'
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
    const token = getCachedAccessToken();
    if (!token) {
      return { success: false, slots: [], message: 'Inicia sesión con Google Workspace para ver tu calendario.' };
    }

    try {
      // Current week: Monday 00:00 to Sunday 23:59
      const now = new Date();
      const currentDay = now.getDay(); // 0 is Sunday
      const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;

      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayDiff);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', '150');
      params.set('timeMin', monday.toISOString());
      params.set('timeMax', sunday.toISOString());

      // Parallel fetch for primary + any immediate secondary calendar if present
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        return { success: false, slots: [], message: 'No se pudo conectar a Google Calendar.' };
      }

      const data = await res.json();
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const rawItems = data.items || [];
      const slots: any[] = [];
      const seen = new Set<string>();

      for (const item of rawItems) {
        const title = (item.summary || '').trim();
        if (!title) continue;
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

        const key = `${dow}_${startTime}_${endTime}_${title.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          slots.push({
            id: item.id,
            title,
            dayOfWeek: dow,
            dayName,
            startTime,
            endTime,
            displayText,
          });
        }
      }

      // Sort by day of week (Mon to Fri) then time
      const daySortOrder = (d: number) => (d === 0 ? 7 : d);
      slots.sort((a, b) => daySortOrder(a.dayOfWeek) - daySortOrder(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));

      return {
        success: true,
        slots,
        message: `Se encontraron ${slots.length} bloques horarios en tu calendario esta semana.`,
      };
    } catch (err: any) {
      return { success: false, slots: [], message: err.message || 'Error al obtener bloques de Calendar.' };
    }
  },

  /**
   * Ultra-fast Auto Sync: inspects current week + 1 week in parallel (< 800ms)
   * instead of scanning past 120 days across endless calendars.
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
    const token = getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        totalFound: 0,
        matchedClasses: 0,
        importedSchoolEvents: 0,
        updatedCoursesCount: 0,
        events: [],
        schedulesMap: {},
        message: 'Debes iniciar sesión con Google Workspace para importar desde Google Calendar.',
      };
    }

    try {
      // 1. Scan only the current full 7-day week (Monday to Sunday) - Ultra Fast
      const now = new Date();
      const currentDay = now.getDay();
      const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;

      const timeMin = new Date(now);
      timeMin.setDate(now.getDate() + mondayDiff);
      timeMin.setHours(0, 0, 0, 0);

      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMin.getDate() + 13); // 2 weeks window is sufficient to catch every repeating class
      timeMax.setHours(23, 59, 59, 999);

      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', '250');
      params.set('timeMin', timeMin.toISOString());
      params.set('timeMax', timeMax.toISOString());

      // Fetch primary calendar instantly in 1 quick call
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        throw new Error(`Google Calendar API respondió con status ${res.status}`);
      }

      const data = await res.json();
      const rawItems: any[] = data.items || [];

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
};
