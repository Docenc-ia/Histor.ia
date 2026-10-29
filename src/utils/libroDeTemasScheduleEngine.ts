/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Schedule & Calendar Engine for Libro de Temas.
 * Generates the chronological list of scheduled rows (1°C, 2°C, holidays,
 * multi-slot class days, and custom exam/event dates) cleanly separated from React UI.
 */

import { AttendanceSettings } from './attendanceCalculations';
import {
  OFFICIAL_HOLIDAYS_2026,
  SchoolHolidayItem,
  WEEKDAY_LABELS,
  CourseDayTimeSlot,
} from './schoolHolidays';
import type {
  LibroDeTemasEntry,
  NoClassCategory,
  ScheduledRow,
} from '../components/modules/LibroDeTemasMatrix';

export const SHORT_WEEKDAYS: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
};

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildHolidaysByDateMap(
  attendanceSettings?: AttendanceSettings
): Record<string, SchoolHolidayItem> {
  const excluded = new Set(attendanceSettings?.excludedHolidayIds || []);
  const custom = Array.isArray(attendanceSettings?.customHolidays)
    ? attendanceSettings.customHolidays
    : [];
  const map: Record<string, SchoolHolidayItem> = {};

  for (const h of [...OFFICIAL_HOLIDAYS_2026, ...custom]) {
    if (!excluded.has(h.id)) {
      map[h.date] = h;
    }
  }
  return map;
}

export function buildScheduledLibroRows(params: {
  attendanceSettings?: AttendanceSettings;
  activeWeekdays: number[];
  dailySlots: Record<number, CourseDayTimeSlot[]>;
  holidaysByDate: Record<string, SchoolHolidayItem>;
  entriesMap: Record<string, LibroDeTemasEntry>;
  characterOptions: string[];
}): ScheduledRow[] {
  const {
    attendanceSettings,
    activeWeekdays,
    dailySlots,
    holidaysByDate,
    entriesMap,
    characterOptions,
  } = params;

  const start1c = attendanceSettings?.termStartDate1c || '2026-03-02';
  const end1c = attendanceSettings?.termEndDate1c || '2026-07-10';
  const start2c = attendanceSettings?.termStartDate2c || '2026-08-03';
  const end2c = attendanceSettings?.termEndDate2c || '2026-12-04';

  const dateSet = new Set<string>();
  const dateTermMap: Record<string, '1c' | '2c'> = {};

  const generateForRange = (startStr: string, endStr: string, term: '1c' | '2c') => {
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;

    const cursor = new Date(start);
    let safety = 0;
    while (cursor <= end && safety < 400) {
      safety++;
      const dow = cursor.getDay();
      if (activeWeekdays.includes(dow)) {
        const dStr = formatYYYYMMDD(cursor);
        dateSet.add(dStr);
        dateTermMap[dStr] = term;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  };

  generateForRange(start1c, end1c, '1c');
  generateForRange(start2c, end2c, '2c');

  Object.keys(entriesMap).forEach((dStr) => {
    if (dStr.includes('__') || !/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return;
    const savedEntry = entriesMap[dStr];
    if (!savedEntry) return;

    const hasMeaningfulData = Boolean(
      savedEntry.isCustomDate ||
        savedEntry.isHoliday ||
        savedEntry.contents?.trim() ||
        savedEntry.observations?.trim() ||
        savedEntry.teacherSignature?.trim() ||
        savedEntry.authoritySignature?.trim()
    );

    if (savedEntry.isCustomDate || (!dateSet.has(dStr) && hasMeaningfulData)) {
      dateSet.add(dStr);
      if (!dateTermMap[dStr]) {
        dateTermMap[dStr] = dStr <= end1c ? '1c' : '2c';
      }
    }
  });

  const sortedDates = Array.from(dateSet).sort();

  const rows: ScheduledRow[] = [];
  let sequentialClassCounter = 0;
  let lastKnownUnit = '1';

  for (const dateStr of sortedDates) {
    const dateObj = parseLocalDate(dateStr);
    const day = dateObj.getDate();
    const month = dateObj.getMonth() + 1;
    const dow = dateObj.getDay();
    const weekdayShort = SHORT_WEEKDAYS[dow] || '';
    const weekdayFull = WEEKDAY_LABELS[dow] || '';
    const calendarHoliday = holidaysByDate[dateStr];
    const slots =
      dailySlots[dow] && dailySlots[dow].length > 0
        ? dailySlots[dow]
        : [{ slotIndex: 0, timeLabel: '' }];

    slots.forEach((slot, sIdx) => {
      const rowKey = sIdx === 0 ? dateStr : `${dateStr}__${sIdx}`;
      const saved = entriesMap[rowKey] || (sIdx === 0 ? entriesMap[dateStr] : undefined);

      const dayWideHoliday =
        Boolean(calendarHoliday) || Boolean(entriesMap[dateStr]?.isHoliday);
      const isHoliday =
        saved?.isHoliday !== undefined ? saved.isHoliday : dayWideHoliday;

      const noClassCategory: NoClassCategory | undefined = isHoliday
        ? saved?.noClassCategory || entriesMap[dateStr]?.noClassCategory || 'feriado'
        : undefined;

      let computedClassNumber = '-';
      if (!isHoliday) {
        sequentialClassCounter += 1;
        computedClassNumber = saved?.customClassNumber?.trim()
          ? saved.customClassNumber.trim()
          : String(sequentialClassCounter);
      }

      if (saved?.unitNumber && saved.unitNumber !== '-') {
        lastKnownUnit = saved.unitNumber;
      }

      const defaultNoClassContents =
        saved?.noClassReason?.trim() ||
        entriesMap[dateStr]?.noClassReason?.trim() ||
        (calendarHoliday ? 'Feriado' : 'Sin dictado de clases');

      const entry: LibroDeTemasEntry = {
        date: dateStr,
        slotIndex: sIdx,
        timeLabel: slot.timeLabel,
        isHoliday,
        noClassCategory,
        noClassReason: saved?.noClassReason || entriesMap[dateStr]?.noClassReason,
        holidayName:
          calendarHoliday?.name || saved?.holidayName || entriesMap[dateStr]?.holidayName,
        customClassNumber: saved?.customClassNumber || '',
        unitNumber: isHoliday ? '-' : saved?.unitNumber ?? '',
        contents: isHoliday
          ? saved?.contents !== undefined && saved.contents !== ''
            ? saved.contents
            : defaultNoClassContents
          : saved?.contents ?? '',
        classCharacter: isHoliday
          ? '-'
          : saved?.classCharacter !== undefined
          ? saved.classCharacter
          : saved?.contents
          ? characterOptions[0] || 'Teórico - Práctica'
          : '',
        observations:
          saved?.observations ??
          (isHoliday && calendarHoliday ? calendarHoliday.name : ''),
        teacherSignature: saved?.teacherSignature ?? '',
        authoritySignature: saved?.authoritySignature ?? '',
        isCustomDate: saved?.isCustomDate,
      };

      rows.push({
        rowKey,
        dateStr,
        slotIndex: sIdx,
        totalSlotsForDay: slots.length,
        timeLabel: slot.timeLabel,
        day,
        month,
        dow,
        weekdayShort,
        weekdayFull,
        term: dateTermMap[dateStr] || '1c',
        computedClassNumber,
        calendarHoliday,
        suggestedUnit: lastKnownUnit,
        entry,
      });
    });
  }

  return rows;
}
