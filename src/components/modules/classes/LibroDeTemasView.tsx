import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  PenLine,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import { Course } from '../../../types';
import { AttendanceSettings } from '../../../utils/attendanceCalculations';
import {
  OFFICIAL_HOLIDAYS_2026,
  WEEKDAY_LABELS,
  extractWeekdaysFromSchedule,
} from '../../../utils/schoolHolidays';
import { driveService } from '../../../services/workspace/driveService';
import { copyTableToClipboard } from '../../../utils/sheetsUtils';
import { firestoreSync, getActiveUserId } from '../../../services/firestoreSync';

export interface LibroDeTemasEntry {
  dateIso: string; // YYYY-MM-DD
  day: string; // DD
  month: string; // MM
  term: '1c' | '2c';
  classNumberOverride?: string;
  unitNumber: string;
  classCharacter: string;
  contents: string;
  activities: string;
  teacherSignature: string;
  observations: string;
  authoritySignature: string;
  isManualDate?: boolean;
  isHolidayOverrideTaught?: boolean; // If true, treat holiday date as a normal taught class
}

export interface LibroDeTemasHeaderMeta {
  asignatura: string;
  profTitular: string;
  profProvisional: string;
  profSuplente: string;
  folioNumber: string;
  horarioGrid: {
    L: string;
    M: string;
    X: string; // Miércoles
    J: string;
    V: string;
  };
}

interface LibroDeTemasViewProps {
  course: Course;
  teacherName: string;
  attendanceSettings: AttendanceSettings;
  onUpdateAttendanceSettings: (newSettings: AttendanceSettings) => void;
  onOpenCalendarSettings: () => void;
  onOpenGoogleCalendarModal?: () => void;
  courseDriveFolderId?: string;
  isDarkMode?: boolean;
  onToast?: (msg: string) => void;
}

const CLASS_CHARACTER_SUGGESTIONS = [
  'Teórico-Práctica',
  'Teórica',
  'Práctica',
  'Evaluación Escrita',
  'Evaluación Oral',
  'Trabajo Práctico',
  'Repaso / Integración',
  'Diagnóstico',
  'Exposición Grupal',
  'Sin Actividad / Feriado',
];

function parseInitialHorarioGrid(schedule?: string, weekdays?: number[]) {
  const grid = { L: '', M: '', X: '', J: '', V: '' };
  const s = (schedule || '').trim();

  // Extract time range if present in schedule string (e.g. "08:00 - 09:30" or "8:00 a 9:30")
  const timeMatch = s.match(/(\d{1,2}:\d{2}(?:\s*[-a]\s*\d{1,2}:\d{2})?)/i);
  const defaultTime = timeMatch ? timeMatch[1] : 'X';

  const activeDays =
    Array.isArray(weekdays) && weekdays.length > 0
      ? weekdays
      : extractWeekdaysFromSchedule(schedule);

  if (activeDays.includes(1)) grid.L = defaultTime;
  if (activeDays.includes(2)) grid.M = defaultTime;
  if (activeDays.includes(3)) grid.X = defaultTime;
  if (activeDays.includes(4)) grid.J = defaultTime;
  if (activeDays.includes(5)) grid.V = defaultTime;

  return grid;
}

export const LibroDeTemasView: React.FC<LibroDeTemasViewProps> = ({
  course,
  teacherName,
  attendanceSettings,
  onUpdateAttendanceSettings,
  onOpenCalendarSettings,
  onOpenGoogleCalendarModal,
  courseDriveFolderId,
  isDarkMode = false,
  onToast,
}) => {
  const storageKey = `fds_libro_temas_v1_${course.id}`;
  const headerStorageKey = `fds_libro_temas_header_v1_${course.id}`;

  // Load saved entries map: dateIso -> LibroDeTemasEntry
  const [entriesMap, setEntriesMap] = useState<Record<string, LibroDeTemasEntry>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    return {};
  });

  // Load saved folio header metadata
  const [headerMeta, setHeaderMeta] = useState<LibroDeTemasHeaderMeta>(() => {
    const defaultHeader: LibroDeTemasHeaderMeta = {
      asignatura: course.name || '',
      profTitular: teacherName || '',
      profProvisional: '',
      profSuplente: '',
      folioNumber: '61',
      horarioGrid: parseInitialHorarioGrid(course.schedule, attendanceSettings.courseWeekdays),
    };
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(headerStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            ...defaultHeader,
            ...parsed,
            horarioGrid: {
              ...defaultHeader.horarioGrid,
              ...(parsed.horarioGrid || {}),
            },
          };
        }
      } catch (_) {}
    }
    return defaultHeader;
  });

  const [termFilter, setTermFilter] = useState<'all' | '1c' | '2c'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHolidaysInTable, setShowHolidaysInTable] = useState(true);
  const [onlyFilledFilter, setOnlyFilledFilter] = useState(false);

  // Manual date addition state
  const [isAddingManualDate, setIsAddingManualDate] = useState(false);
  const [newManualDateIso, setNewManualDateIso] = useState(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

  // Save to Google Drive (.gdoc) confirmation state
  const [showDriveConfirm, setShowDriveConfirm] = useState(false);
  const [driveDocTitle, setDriveDocTitle] = useState('');
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveSaveError, setDriveSaveError] = useState<string | null>(null);
  const [savedDriveDoc, setSavedDriveDoc] = useState<{
    id: string;
    name: string;
    webViewLink: string;
  } | null>(null);

  const cloudSyncTimeoutRef = useRef<number | null>(null);

  // Reload when course changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const rawEntries = localStorage.getItem(storageKey);
      setEntriesMap(rawEntries ? JSON.parse(rawEntries) : {});
    } catch {
      setEntriesMap({});
    }

    const defaultHeader: LibroDeTemasHeaderMeta = {
      asignatura: course.name || '',
      profTitular: teacherName || '',
      profProvisional: '',
      profSuplente: '',
      folioNumber: '61',
      horarioGrid: parseInitialHorarioGrid(course.schedule, attendanceSettings.courseWeekdays),
    };
    try {
      const rawHeader = localStorage.getItem(headerStorageKey);
      if (rawHeader) {
        const parsed = JSON.parse(rawHeader);
        setHeaderMeta({
          ...defaultHeader,
          ...parsed,
          horarioGrid: {
            ...defaultHeader.horarioGrid,
            ...(parsed.horarioGrid || {}),
          },
        });
      } else {
        setHeaderMeta(defaultHeader);
      }
    } catch {
      setHeaderMeta(defaultHeader);
    }

    // Also load from Firestore cloud if available
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync
        .loadUserSetting<{
          entries?: Record<string, LibroDeTemasEntry>;
          header?: LibroDeTemasHeaderMeta;
        }>(uid, `libro_temas_${course.id}`)
        .then((cloudData) => {
          if (cloudData && typeof cloudData === 'object') {
            if (cloudData.entries && Object.keys(cloudData.entries).length > 0) {
              setEntriesMap((prev) => {
                const merged = { ...cloudData.entries, ...prev };
                try {
                  localStorage.setItem(storageKey, JSON.stringify(merged));
                } catch (_) {}
                return merged;
              });
            }
            if (cloudData.header) {
              setHeaderMeta((prev) => {
                const merged = { ...cloudData.header!, ...prev };
                try {
                  localStorage.setItem(headerStorageKey, JSON.stringify(merged));
                } catch (_) {}
                return merged;
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [course.id]);

  // Persist helper with debounced cloud sync
  const persistState = (
    nextEntries: Record<string, LibroDeTemasEntry>,
    nextHeader: LibroDeTemasHeaderMeta
  ) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify(nextEntries));
        localStorage.setItem(headerStorageKey, JSON.stringify(nextHeader));
      } catch (_) {}
    }

    if (cloudSyncTimeoutRef.current) {
      window.clearTimeout(cloudSyncTimeoutRef.current);
    }
    cloudSyncTimeoutRef.current = window.setTimeout(() => {
      const uid = getActiveUserId();
      if (uid) {
        firestoreSync
          .saveUserSetting(uid, `libro_temas_${course.id}`, {
            entries: nextEntries,
            header: nextHeader,
            updatedAt: Date.now(),
          })
          .catch(() => {});
      }
    }, 2500);
  };

  // Active weekdays coordinated with the course calendar
  const activeWeekdays = useMemo(() => {
    if (
      Array.isArray(attendanceSettings.courseWeekdays) &&
      attendanceSettings.courseWeekdays.length > 0
    ) {
      return attendanceSettings.courseWeekdays;
    }
    const parsed = extractWeekdaysFromSchedule(course.schedule);
    return parsed.length > 0 ? parsed : [1, 3];
  }, [attendanceSettings.courseWeekdays, course.schedule]);

  // Toggle a weekday directly from the L | M | M | J | V header table
  const handleToggleWeekday = (dayNum: number) => {
    const exists = activeWeekdays.includes(dayNum);
    const nextDays = exists
      ? activeWeekdays.filter((d) => d !== dayNum)
      : [...activeWeekdays, dayNum].sort((a, b) => a - b);

    if (nextDays.length === 0) return; // Keep at least 1 class day per week

    const updatedSettings: AttendanceSettings = {
      ...attendanceSettings,
      courseWeekdays: nextDays,
      classesPerWeek: nextDays.length,
    };
    onUpdateAttendanceSettings(updatedSettings);

    const dayKeyMap: Record<number, keyof LibroDeTemasHeaderMeta['horarioGrid']> = {
      1: 'L',
      2: 'M',
      3: 'X',
      4: 'J',
      5: 'V',
    };
    const key = dayKeyMap[dayNum];
    if (key) {
      const nextHeader: LibroDeTemasHeaderMeta = {
        ...headerMeta,
        horarioGrid: {
          ...headerMeta.horarioGrid,
          [key]: exists ? '' : headerMeta.horarioGrid[key] || 'Clase',
        },
      };
      setHeaderMeta(nextHeader);
      persistState(entriesMap, nextHeader);
    }
  };

  // Holiday lookup map (YYYY-MM-DD -> Holiday Info)
  const holidaysByDate = useMemo(() => {
    const excluded = new Set(attendanceSettings.excludedHolidayIds || []);
    const custom = Array.isArray(attendanceSettings.customHolidays)
      ? attendanceSettings.customHolidays
      : [];
    const all = [...OFFICIAL_HOLIDAYS_2026, ...custom];
    const map: Record<string, { name: string; type: string }> = {};
    for (const h of all) {
      if (!excluded.has(h.id)) {
        map[h.date] = { name: h.name, type: h.type };
      }
    }
    return map;
  }, [attendanceSettings.customHolidays, attendanceSettings.excludedHolidayIds]);

  // Generate all scheduled class dates from the course calendar (1°C and 2°C) + any manual dates
  const scheduledRows = useMemo(() => {
    const start1c = attendanceSettings.termStartDate1c || '2026-03-02';
    const end1c = attendanceSettings.termEndDate1c || '2026-07-10';
    const start2c = attendanceSettings.termStartDate2c || '2026-08-03';
    const end2c = attendanceSettings.termEndDate2c || '2026-12-04';

    const dateSet = new Map<string, { term: '1c' | '2c'; isCalendarDay: boolean }>();

    const generateRange = (startIso: string, endIso: string, term: '1c' | '2c') => {
      const partsStart = startIso.split('-').map(Number);
      const partsEnd = endIso.split('-').map(Number);
      if (partsStart.length !== 3 || partsEnd.length !== 3) return;

      const cur = new Date(partsStart[0], partsStart[1] - 1, partsStart[2], 12, 0, 0);
      const end = new Date(partsEnd[0], partsEnd[1] - 1, partsEnd[2], 12, 0, 0);
      if (isNaN(cur.getTime()) || isNaN(end.getTime()) || cur > end) return;

      const pad = (n: number) => n.toString().padStart(2, '0');
      let safety = 0;
      while (cur <= end && safety < 400) {
        safety++;
        const dow = cur.getDay();
        if (activeWeekdays.includes(dow)) {
          const iso = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
          dateSet.set(iso, { term, isCalendarDay: true });
        }
        cur.setDate(cur.getDate() + 1);
      }
    };

    generateRange(start1c, end1c, '1c');
    generateRange(start2c, end2c, '2c');

    // Include any manual dates or existing saved entries
    Object.keys(entriesMap).forEach((iso) => {
      if (!dateSet.has(iso)) {
        const entry = entriesMap[iso];
        const term = entry.term || (iso < start2c ? '1c' : '2c');
        dateSet.set(iso, { term, isCalendarDay: false });
      }
    });

    const sortedDates = Array.from(dateSet.keys()).sort();
    let sequentialClassCounter = 0;

    return sortedDates.map((iso) => {
      const meta = dateSet.get(iso)!;
      const saved = entriesMap[iso];
      const holiday = holidaysByDate[iso];
      const isHoliday = Boolean(holiday) && !saved?.isHolidayOverrideTaught;

      if (!isHoliday) {
        sequentialClassCounter++;
      }

      const [yyyy, mm, dd] = iso.split('-');
      const dateObj = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
      const dayOfWeek = dateObj.getDay();
      const dayName = WEEKDAY_LABELS[dayOfWeek] || '';

      const computedClassNum = isHoliday
        ? '—'
        : saved?.classNumberOverride?.trim()
        ? saved.classNumberOverride
        : String(sequentialClassCounter);

      const defaultCharacter = isHoliday
        ? 'Sin Actividad / Feriado'
        : saved?.classCharacter || '';

      const defaultContents = isHoliday
        ? saved?.contents || `Feriado / Asueto: ${holiday.name}`
        : saved?.contents || '';

      const defaultObservations = isHoliday
        ? saved?.observations || 'Sin dictado de clases por calendario escolar'
        : saved?.observations || '';

      return {
        dateIso: iso,
        day: dd,
        month: mm,
        year: yyyy,
        dayName,
        term: meta.term,
        isCalendarDay: meta.isCalendarDay,
        isManualDate: Boolean(saved?.isManualDate || !meta.isCalendarDay),
        isHoliday,
        holidayName: holiday?.name,
        computedClassNum,
        entry: {
          dateIso: iso,
          day: dd,
          month: mm,
          term: meta.term,
          classNumberOverride: saved?.classNumberOverride || '',
          unitNumber: saved?.unitNumber || '',
          classCharacter: defaultCharacter,
          contents: defaultContents,
          activities: saved?.activities || '',
          teacherSignature: saved?.teacherSignature || '',
          observations: defaultObservations,
          authoritySignature: saved?.authoritySignature || '',
          isManualDate: saved?.isManualDate,
          isHolidayOverrideTaught: saved?.isHolidayOverrideTaught,
        } as LibroDeTemasEntry,
      };
    });
  }, [
    attendanceSettings.termStartDate1c,
    attendanceSettings.termEndDate1c,
    attendanceSettings.termStartDate2c,
    attendanceSettings.termEndDate2c,
    activeWeekdays,
    entriesMap,
    holidaysByDate,
  ]);

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    return scheduledRows.filter((row) => {
      if (!showHolidaysInTable && row.isHoliday) return false;
      if (termFilter !== 'all' && row.term !== termFilter) return false;
      if (onlyFilledFilter) {
        const hasData =
          Boolean(row.entry.contents.trim()) ||
          Boolean(row.entry.activities.trim()) ||
          Boolean(row.entry.unitNumber.trim());
        if (!hasData || row.isHoliday) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          row.entry.contents.toLowerCase().includes(q) ||
          row.entry.activities.toLowerCase().includes(q) ||
          row.entry.unitNumber.toLowerCase().includes(q) ||
          row.entry.classCharacter.toLowerCase().includes(q) ||
          row.entry.observations.toLowerCase().includes(q) ||
          `${row.day}/${row.month}`.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [scheduledRows, showHolidaysInTable, termFilter, onlyFilledFilter, searchQuery]);

  // Today's ISO string to highlight today's or next class
  const todayIso = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, []);

  // Update a specific field of a row
  const handleUpdateRowField = (
    dateIso: string,
    term: '1c' | '2c',
    field: keyof LibroDeTemasEntry,
    value: any
  ) => {
    const [_, mm, dd] = dateIso.split('-');
    const existing = entriesMap[dateIso] || {
      dateIso,
      day: dd,
      month: mm,
      term,
      unitNumber: '',
      classCharacter: '',
      contents: '',
      activities: '',
      teacherSignature: '',
      observations: '',
      authoritySignature: '',
    };

    const updatedEntry: LibroDeTemasEntry = {
      ...existing,
      [field]: value,
    };

    // If teacher edits contents or activities on a holiday row, allow it or keep it
    const nextMap = {
      ...entriesMap,
      [dateIso]: updatedEntry,
    };
    setEntriesMap(nextMap);
    persistState(nextMap, headerMeta);
  };

  // Sign a single row with teacher's name
  const handleSignRow = (dateIso: string, term: '1c' | '2c') => {
    const sigName =
      headerMeta.profTitular.trim() ||
      headerMeta.profProvisional.trim() ||
      headerMeta.profSuplente.trim() ||
      teacherName ||
      'Firmado';
    handleUpdateRowField(dateIso, term, 'teacherSignature', sigName);
  };

  // Sign all rows that have contents written
  const handleSignAllFilledRows = () => {
    const sigName =
      headerMeta.profTitular.trim() ||
      headerMeta.profProvisional.trim() ||
      headerMeta.profSuplente.trim() ||
      teacherName ||
      'Firmado';

    const nextMap = { ...entriesMap };
    let count = 0;
    scheduledRows.forEach((r) => {
      if (!r.isHoliday && r.entry.contents.trim() && !r.entry.teacherSignature.trim()) {
        nextMap[r.dateIso] = {
          ...r.entry,
          teacherSignature: sigName,
        };
        count++;
      }
    });

    if (count > 0) {
      setEntriesMap(nextMap);
      persistState(nextMap, headerMeta);
      onToast?.(`Se firmaron ${count} clases registradas con "${sigName}".`);
    } else {
      onToast?.('Todas las clases con contenidos cargados ya están firmadas.');
    }
  };

  // Add manual class date
  const handleAddManualDate = () => {
    if (!newManualDateIso) return;
    const [_, mm, dd] = newManualDateIso.split('-');
    const start2c = attendanceSettings.termStartDate2c || '2026-08-03';
    const term: '1c' | '2c' = newManualDateIso >= start2c ? '2c' : '1c';

    const existing = entriesMap[newManualDateIso];
    const nextMap: Record<string, LibroDeTemasEntry> = {
      ...entriesMap,
      [newManualDateIso]: existing || {
        dateIso: newManualDateIso,
        day: dd,
        month: mm,
        term,
        unitNumber: '',
        classCharacter: 'Teórico-Práctica',
        contents: '',
        activities: '',
        teacherSignature: '',
        observations: '',
        authoritySignature: '',
        isManualDate: true,
      },
    };
    setEntriesMap(nextMap);
    persistState(nextMap, headerMeta);
    setIsAddingManualDate(false);
    onToast?.(`Fecha ${dd}/${mm} agregada al Libro de Temas.`);
  };

  const handleDeleteManualDate = (dateIso: string) => {
    const nextMap = { ...entriesMap };
    delete nextMap[dateIso];
    setEntriesMap(nextMap);
    persistState(nextMap, headerMeta);
  };

  // Scroll to today's or next upcoming class row
  const handleScrollToToday = () => {
    const targetRow =
      filteredRows.find((r) => r.dateIso >= todayIso && !r.isHoliday) ||
      filteredRows[filteredRows.length - 1];
    if (targetRow) {
      const el = document.getElementById(`libro-temas-row-${targetRow.dateIso}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  // Build Official HTML Folio matching the exact 2-page spread from the user's images
  const buildLibroDeTemasHtml = () => {
    const rowsHtml = filteredRows
      .map((r) => {
        const bgStyle = r.isHoliday ? 'background-color: #fffbeb; color: #92400e;' : '';
        return `
        <tr style="${bgStyle}">
          <td style="text-align: center; font-family: monospace; font-weight: bold;">${r.day}</td>
          <td style="text-align: center; font-family: monospace; font-weight: bold;">${r.month}</td>
          <td style="text-align: center; font-family: monospace; font-weight: bold;">${r.computedClassNum}</td>
          <td style="text-align: center;">${r.entry.unitNumber || ''}</td>
          <td>${r.entry.classCharacter || ''}</td>
          <td>${(r.entry.contents || '').replace(/\n/g, '<br/>')}</td>
          <td>${(r.entry.activities || '').replace(/\n/g, '<br/>')}</td>
          <td style="text-align: center; font-style: italic;">${r.entry.teacherSignature || ''}</td>
          <td>${(r.entry.observations || '').replace(/\n/g, '<br/>')}</td>
          <td style="text-align: center;">${r.entry.authoritySignature || ''}</td>
        </tr>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Libro de Temas - ${headerMeta.asignatura || course.name} (Folio N° ${headerMeta.folioNumber})</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 1.2cm;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      font-size: 9.5pt;
      line-height: 1.35;
      margin: 0;
      padding: 0;
    }
    .folio-header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      border: none;
    }
    .folio-header-table td {
      border: none;
      vertical-align: top;
      padding: 2px 4px;
    }
    .horario-mini-table {
      border-collapse: collapse;
      width: 240px;
    }
    .horario-mini-table th, .horario-mini-table td {
      border: 1px solid #1f2937;
      text-align: center;
      padding: 4px 6px;
      font-size: 8.5pt;
      width: 20%;
    }
    .horario-mini-table th {
      background-color: #d1d5db;
      font-weight: bold;
    }
    .main-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.5px solid #111827;
    }
    .main-table th, .main-table td {
      border: 1px solid #374151;
      padding: 5px 6px;
      vertical-align: top;
      font-size: 9pt;
    }
    .main-table thead th {
      background-color: #d1d5db;
      color: #111827;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 0.2px;
    }
  </style>
</head>
<body>
  <table class="folio-header-table">
    <tr>
      <td style="width: 26%;">
        <div style="font-weight: bold; font-size: 10pt; margin-bottom: 14px; text-transform: uppercase;">ASIGNATURA</div>
        <div style="border-bottom: 1px dotted #111827; padding-bottom: 3px; font-weight: bold; font-size: 11pt; margin-right: 16px;">
          ${headerMeta.asignatura || course.name}
        </div>
      </td>
      <td style="width: 38%;">
        <div style="margin-bottom: 6px; font-size: 9pt;">
          <strong>PROF. TITULAR:</strong>
          <span style="border-bottom: 1px dotted #111827; display: inline-block; min-width: 220px; padding-left: 4px;">
            ${headerMeta.profTitular || ''}
          </span>
        </div>
        <div style="margin-bottom: 6px; font-size: 9pt;">
          <strong>PROF. PROVISIONAL:</strong>
          <span style="border-bottom: 1px dotted #111827; display: inline-block; min-width: 195px; padding-left: 4px;">
            ${headerMeta.profProvisional || ''}
          </span>
        </div>
        <div style="font-size: 9pt;">
          <strong>PROF. SUPLENTE:</strong>
          <span style="border-bottom: 1px dotted #111827; display: inline-block; min-width: 210px; padding-left: 4px;">
            ${headerMeta.profSuplente || ''}
          </span>
        </div>
      </td>
      <td style="width: 24%;">
        <div style="font-weight: bold; font-size: 9pt; margin-bottom: 4px; text-align: center; width: 240px;">HORARIO</div>
        <table class="horario-mini-table">
          <thead>
            <tr>
              <th>L</th>
              <th>M</th>
              <th>M</th>
              <th>J</th>
              <th>V</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="height: 20px;">${headerMeta.horarioGrid.L || ''}</td>
              <td style="height: 20px;">${headerMeta.horarioGrid.M || ''}</td>
              <td style="height: 20px;">${headerMeta.horarioGrid.X || ''}</td>
              <td style="height: 20px;">${headerMeta.horarioGrid.J || ''}</td>
              <td style="height: 20px;">${headerMeta.horarioGrid.V || ''}</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td style="width: 12%; text-align: right;">
        <div style="font-weight: bold; font-size: 11pt;">FOLIO N° ${headerMeta.folioNumber || '1'}</div>
      </td>
    </tr>
  </table>

  <table class="main-table">
    <thead>
      <tr>
        <th colspan="2" style="width: 7%;">FECHA</th>
        <th rowspan="2" style="width: 5%;">CLASE<br/>N°</th>
        <th rowspan="2" style="width: 5%;">UNIDAD<br/>N°</th>
        <th rowspan="2" style="width: 11%;">CARÁCTER DE<br/>LA CLASE</th>
        <th rowspan="2" style="width: 26%;">CONTENIDOS<br/><span style="font-weight: normal; text-transform: none; font-size: 7.5pt;">(Expresarlo con precisión y legiblemente)</span></th>
        <th rowspan="2" style="width: 21%;">ACTIVIDADES QUE SE DESARROLLAN</th>
        <th rowspan="2" style="width: 8%;">FIRMA DEL<br/>PROFESOR</th>
        <th rowspan="2" style="width: 10%;">OBSERVACIONES</th>
        <th rowspan="2" style="width: 7%;">FIRMA DE LA<br/>AUTORIDAD QUE<br/>VISITÓ LA CLASE</th>
      </tr>
      <tr>
        <th style="width: 3.5%;">Día</th>
        <th style="width: 3.5%;">Mes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
  };

  // Save Libro de Temas to Google Drive as a native editable .gdoc
  const handleConfirmSaveToDrive = async () => {
    setIsSavingToDrive(true);
    setDriveSaveError(null);
    try {
      const html = buildLibroDeTemasHtml();
      const title =
        driveDocTitle.trim() ||
        `📖 Libro de Temas - ${headerMeta.asignatura || course.name} (Folio N° ${headerMeta.folioNumber || '1'})`;

      let parentFolderId = courseDriveFolderId;
      if (!parentFolderId) {
        try {
          const struct = await driveService.ensureCourseFolderStructure(course.name, course.id);
          parentFolderId = struct.mainFolder.id;
        } catch (_) {}
      }

      const uploaded = await driveService.uploadReportFile(
        title,
        html,
        'application/vnd.google-apps.document',
        parentFolderId
      );

      setSavedDriveDoc({
        id: uploaded.id,
        name: uploaded.name,
        webViewLink: uploaded.webViewLink,
      });
      setShowDriveConfirm(false);
      onToast?.('Libro de Temas guardado en Google Drive como documento editable (.gdoc).');
    } catch (err: any) {
      setDriveSaveError(
        err?.message || 'Error al guardar en Google Drive. Verificá tu conexión con Google Workspace.'
      );
    } finally {
      setIsSavingToDrive(false);
    }
  };

  // Copy for Google Sheets
  const handleCopyForSheets = () => {
    const headers = [
      'Día',
      'Mes',
      'Clase N°',
      'Unidad N°',
      'Carácter de la Clase',
      'Contenidos',
      'Actividades que se desarrollan',
      'Firma del Profesor',
      'Observaciones',
      'Firma de la Autoridad',
    ];
    const rows = filteredRows.map((r) => [
      r.day,
      r.month,
      r.computedClassNum,
      r.entry.unitNumber || '',
      r.entry.classCharacter || '',
      r.entry.contents || '',
      r.entry.activities || '',
      r.entry.teacherSignature || '',
      r.entry.observations || '',
      r.entry.authoritySignature || '',
    ]);
    copyTableToClipboard(headers, rows);
    onToast?.('¡Libro de Temas copiado al portapapeles para pegar en Google Sheets o Excel!');
  };

  // Download standalone HTML / Print view
  const handleDownloadFolioHtml = () => {
    const html = buildLibroDeTemasHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Libro_de_Temas_${(headerMeta.asignatura || course.name).replace(/\s+/g, '_')}_Folio_${headerMeta.folioNumber || '1'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Statistics
  const stats = useMemo(() => {
    const totalScheduled = scheduledRows.filter((r) => !r.isHoliday).length;
    const filledCount = scheduledRows.filter(
      (r) => !r.isHoliday && (r.entry.contents.trim() !== '' || r.entry.activities.trim() !== '')
    ).length;
    const holidaysCount = scheduledRows.filter((r) => r.isHoliday).length;
    return { totalScheduled, filledCount, holidaysCount };
  }, [scheduledRows]);

  return (
    <div className="space-y-4">
      {/* Top Toolbar & Calendar Coordination Bar */}
      <div
        className={`p-4 rounded-xl border transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-slate-800">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                Libro de Temas Oficial • Coordinado con el Calendario Escolar
              </h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400 mt-0.5">
                {stats.filledCount} de {stats.totalScheduled} clases registradas ·{' '}
                {stats.holidaysCount} feriados/asuetos detectados en los días de cursada
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleScrollToToday}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border-slate-700'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
              }`}
              title="Saltar directamente a la clase de hoy o la próxima fecha en el calendario"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Ir a clase de hoy</span>
            </button>

            <button
              type="button"
              onClick={onOpenCalendarSettings}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Configurar fechas de inicio/fin de cuatrimestres, días de cursada y feriados"
            >
              <Settings className="w-3.5 h-3.5 text-indigo-500" />
              <span>Configurar Calendario y Feriados</span>
            </button>

            <button
              type="button"
              onClick={handleSignAllFilledRows}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Estampar la firma del profesor en todas las clases que ya tienen contenidos registrados"
            >
              <PenLine className="w-3.5 h-3.5 text-emerald-500" />
              <span>Firmar clases cargadas</span>
            </button>

            <button
              type="button"
              onClick={handleCopyForSheets}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Copiar toda la tabla para pegar en Google Sheets o Excel"
            >
              <Copy className="w-3.5 h-3.5 text-blue-500" />
              <span>Copiar para Sheets</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadFolioHtml}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Descargar el Folio Oficial en formato HTML apaisado listo para imprimir"
            >
              <Download className="w-3.5 h-3.5 text-indigo-500" />
              <span>Descargar Folio</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDriveDocTitle(
                  `📖 Libro de Temas - ${headerMeta.asignatura || course.name} (Folio N° ${headerMeta.folioNumber || '61'})`
                );
                setDriveSaveError(null);
                setShowDriveConfirm(true);
              }}
              disabled={isSavingToDrive}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Guardar el Libro de Temas directamente en Google Drive como un documento Google Doc (.gdoc) editable"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Guardar en Drive (.gdoc)</span>
            </button>
          </div>
        </div>

        {/* Confirmation Banner for Google Doc Export */}
        {showDriveConfirm && (
          <div
            className={`mt-3 p-3.5 rounded-xl border space-y-2.5 ${
              isDarkMode
                ? 'bg-slate-800/90 border-emerald-700/70 text-slate-100'
                : 'bg-emerald-50/70 border-emerald-300 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-bold">
                  Exportar Folio del Libro de Temas a Google Drive (.gdoc editable)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDriveConfirm(false)}
                className="text-neutral-400 hover:text-neutral-600 p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="text"
                value={driveDocTitle}
                onChange={(e) => setDriveDocTitle(e.target.value)}
                className={`flex-1 px-3 py-1.5 rounded-lg border text-xs outline-hidden focus:ring-2 focus:ring-emerald-500 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowDriveConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 dark:text-slate-300 hover:bg-neutral-200/60 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSaveToDrive}
                  disabled={isSavingToDrive}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingToDrive ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creando .gdoc...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirmar y crear Google Doc</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {driveSaveError && (
              <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{driveSaveError}</span>
              </div>
            )}
          </div>
        )}

        {/* Created Google Doc Banner */}
        {savedDriveDoc && (
          <div
            className={`mt-3 p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
              isDarkMode
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Libro de Temas guardado en Drive: <strong>{savedDriveDoc.name}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={savedDriveDoc.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir y editar en Google Docs</span>
              </a>
              <button
                type="button"
                onClick={() => setSavedDriveDoc(null)}
                className="p-1 text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Filter & Search Controls */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              className={`inline-flex rounded-lg p-0.5 border ${
                isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setTermFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  termFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900'
                }`}
              >
                Ciclo Anual ({scheduledRows.length})
              </button>
              <button
                type="button"
                onClick={() => setTermFilter('1c')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  termFilter === '1c'
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900'
                }`}
              >
                1° Cuatrimestre
              </button>
              <button
                type="button"
                onClick={() => setTermFilter('2c')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  termFilter === '2c'
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900'
                }`}
              >
                2° Cuatrimestre
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHolidaysInTable}
                onChange={(e) => setShowHolidaysInTable(e.target.checked)}
                className="rounded border-neutral-300 text-blue-600"
              />
              <span className="text-neutral-700 dark:text-slate-300 font-medium">
                Mostrar feriados ({stats.holidaysCount})
              </span>
            </label>

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyFilledFilter}
                onChange={(e) => setOnlyFilledFilter(e.target.checked)}
                className="rounded border-neutral-300 text-blue-600"
              />
              <span className="text-neutral-700 dark:text-slate-300 font-medium">
                Solo clases con tema cargado
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar tema, actividad, fecha..."
                className={`w-full pl-8 pr-3 py-1.5 rounded-lg border text-xs outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
            </div>

            {!isAddingManualDate ? (
              <button
                type="button"
                onClick={() => setIsAddingManualDate(true)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
                title="Agregar una fecha de clase especial o recuperatorio fuera de los días habituales"
              >
                <Plus className="w-3.5 h-3.5 text-blue-500" />
                <span>Agregar fecha</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={newManualDateIso}
                  onChange={(e) => setNewManualDateIso(e.target.value)}
                  className={`px-2 py-1 rounded-lg border text-xs ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleAddManualDate}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold cursor-pointer"
                >
                  Sumar
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingManualDate(false)}
                  className="p-1 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* OFFICIAL LIBRO DE TEMAS FOLIO HEADER & TABLE (MATCHING UPLOADED IMGS) */}
      {/* ===================================================================== */}
      <div
        className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-300'
        }`}
      >
        {/* ENCABEZADO OFICIAL DEL FOLIO (ASIGNATURA / PROFESORES / HORARIO L M M J V / FOLIO N°) */}
        <div
          className={`p-4 border-b ${
            isDarkMode ? 'bg-slate-850/90 border-slate-800' : 'bg-neutral-50/70 border-neutral-300'
          }`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Columna 1: ASIGNATURA */}
            <div className="lg:col-span-3 space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-300">
                ASIGNATURA
              </label>
              <input
                type="text"
                value={headerMeta.asignatura}
                onChange={(e) => {
                  const next = { ...headerMeta, asignatura: e.target.value };
                  setHeaderMeta(next);
                  persistState(entriesMap, next);
                }}
                placeholder="Nombre de la asignatura..."
                className={`w-full px-2.5 py-1.5 text-xs font-bold border-b border-dotted focus:outline-hidden ${
                  isDarkMode
                    ? 'bg-slate-900/60 border-slate-600 text-white focus:border-blue-400'
                    : 'bg-white border-neutral-400 text-neutral-900 focus:border-blue-600'
                }`}
              />
              <div className="text-[11px] text-neutral-500 dark:text-slate-400 pt-1">
                Curso: <strong>{course.grade} {course.division || ''}</strong> · Turno/Aula:{' '}
                <strong>{course.room || course.schedule || 'Regular'}</strong>
              </div>
            </div>

            {/* Columna 2: PROF. TITULAR / PROVISIONAL / SUPLENTE */}
            <div className="lg:col-span-5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-300 w-36 shrink-0">
                  PROF. TITULAR
                </span>
                <input
                  type="text"
                  value={headerMeta.profTitular}
                  onChange={(e) => {
                    const next = { ...headerMeta, profTitular: e.target.value };
                    setHeaderMeta(next);
                    persistState(entriesMap, next);
                  }}
                  placeholder="........................................................................"
                  className={`flex-1 px-2 py-1 text-xs border-b border-dotted focus:outline-hidden ${
                    isDarkMode
                      ? 'bg-slate-900/60 border-slate-600 text-white'
                      : 'bg-white border-neutral-400 text-neutral-900'
                  }`}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-300 w-36 shrink-0">
                  PROF. PROVISIONAL
                </span>
                <input
                  type="text"
                  value={headerMeta.profProvisional}
                  onChange={(e) => {
                    const next = { ...headerMeta, profProvisional: e.target.value };
                    setHeaderMeta(next);
                    persistState(entriesMap, next);
                  }}
                  placeholder="........................................................................"
                  className={`flex-1 px-2 py-1 text-xs border-b border-dotted focus:outline-hidden ${
                    isDarkMode
                      ? 'bg-slate-900/60 border-slate-600 text-white'
                      : 'bg-white border-neutral-400 text-neutral-900'
                  }`}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-300 w-36 shrink-0">
                  PROF. SUPLENTE
                </span>
                <input
                  type="text"
                  value={headerMeta.profSuplente}
                  onChange={(e) => {
                    const next = { ...headerMeta, profSuplente: e.target.value };
                    setHeaderMeta(next);
                    persistState(entriesMap, next);
                  }}
                  placeholder="........................................................................"
                  className={`flex-1 px-2 py-1 text-xs border-b border-dotted focus:outline-hidden ${
                    isDarkMode
                      ? 'bg-slate-900/60 border-slate-600 text-white'
                      : 'bg-white border-neutral-400 text-neutral-900'
                  }`}
                />
              </div>
            </div>

            {/* Columna 3: HORARIO (L | M | M | J | V) y FOLIO N° */}
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:justify-between items-start gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-300">
                    HORARIO (Días de clase)
                  </span>
                </div>
                <table className="border-collapse border border-neutral-500 dark:border-slate-600 text-center text-xs">
                  <thead>
                    <tr className={isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-neutral-300 text-neutral-900'}>
                      {[
                        { label: 'L', dayNum: 1, key: 'L' as const, title: 'Lunes' },
                        { label: 'M', dayNum: 2, key: 'M' as const, title: 'Martes' },
                        { label: 'M', dayNum: 3, key: 'X' as const, title: 'Miércoles' },
                        { label: 'J', dayNum: 4, key: 'J' as const, title: 'Jueves' },
                        { label: 'V', dayNum: 5, key: 'V' as const, title: 'Viernes' },
                      ].map((col) => {
                        const isActive = activeWeekdays.includes(col.dayNum);
                        return (
                          <th
                            key={col.key}
                            onClick={() => handleToggleWeekday(col.dayNum)}
                            title={`${col.title}: Clic para activar/desactivar este día en el calendario del Libro de Temas`}
                            className={`border border-neutral-500 dark:border-slate-600 px-2.5 py-1 font-bold cursor-pointer select-none transition-colors ${
                              isActive
                                ? 'bg-blue-600 text-white'
                                : 'hover:bg-neutral-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {col.label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {(['L', 'M', 'X', 'J', 'V'] as const).map((k) => (
                        <td
                          key={k}
                          className="border border-neutral-500 dark:border-slate-600 p-0 w-14"
                        >
                          <input
                            type="text"
                            value={headerMeta.horarioGrid[k]}
                            onChange={(e) => {
                              const next: LibroDeTemasHeaderMeta = {
                                ...headerMeta,
                                horarioGrid: {
                                  ...headerMeta.horarioGrid,
                                  [k]: e.target.value,
                                },
                              };
                              setHeaderMeta(next);
                              persistState(entriesMap, next);
                            }}
                            placeholder="—"
                            className={`w-14 text-center py-1 text-[10px] font-mono focus:outline-hidden ${
                              isDarkMode ? 'bg-slate-900 text-slate-200' : 'bg-white text-neutral-800'
                            }`}
                            title="Podés anotar el horario o módulo de este día (ej: 8:00)"
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <span className="text-[10px] text-neutral-500 dark:text-slate-400 block mt-1">
                  Clic en L/M/M/J/V para coordinar días de clase
                </span>
              </div>

              {/* FOLIO N° */}
              <div className="flex items-center gap-1.5 self-end sm:self-start">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-200 whitespace-nowrap">
                  FOLIO N°
                </span>
                <input
                  type="text"
                  value={headerMeta.folioNumber}
                  onChange={(e) => {
                    const next = { ...headerMeta, folioNumber: e.target.value };
                    setHeaderMeta(next);
                    persistState(entriesMap, next);
                  }}
                  className={`w-14 px-2 py-1 text-center text-xs font-mono font-bold rounded border ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-white'
                      : 'bg-white border-neutral-400 text-neutral-900'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* TABLA PRINCIPAL DEL LIBRO DE TEMAS (PÁGINA IZQUIERDA + DERECHA)   */}
        {/* ================================================================= */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr
                className={`border-b text-[11px] font-bold uppercase tracking-wider text-center ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-neutral-300/90 border-neutral-400 text-neutral-900'
                }`}
              >
                <th
                  colSpan={2}
                  className="py-2 px-2 border-r border-neutral-400 dark:border-slate-700 w-24"
                >
                  FECHA
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-2 border-r border-neutral-400 dark:border-slate-700 w-16"
                >
                  CLASE
                  <br />
                  N°
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-2 border-r border-neutral-400 dark:border-slate-700 w-16"
                >
                  UNIDAD
                  <br />
                  N°
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-2.5 border-r border-neutral-400 dark:border-slate-700 w-40"
                >
                  CARÁCTER DE
                  <br />
                  LA CLASE
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-3 border-r border-neutral-400 dark:border-slate-700 min-w-[260px]"
                >
                  <div>CONTENIDOS</div>
                  <div className="text-[10px] font-normal normal-case opacity-80">
                    (Expresarlo con precisión y legiblemente)
                  </div>
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-3 border-r border-neutral-400 dark:border-slate-700 min-w-[220px]"
                >
                  ACTIVIDADES QUE SE DESARROLLAN
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-2.5 border-r border-neutral-400 dark:border-slate-700 w-36"
                >
                  FIRMA DEL
                  <br />
                  PROFESOR
                </th>
                <th
                  rowSpan={2}
                  className="py-2 px-2.5 border-r border-neutral-400 dark:border-slate-700 min-w-[160px]"
                >
                  OBSERVACIONES
                </th>
                <th rowSpan={2} className="py-2 px-2.5 w-36">
                  FIRMA DE LA
                  <br />
                  AUTORIDAD QUE
                  <br />
                  VISITÓ LA CLASE
                </th>
              </tr>
              <tr
                className={`border-b text-[10px] font-bold uppercase text-center ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300'
                    : 'bg-neutral-300/70 border-neutral-400 text-neutral-800'
                }`}
              >
                <th className="py-1 px-1.5 border-r border-neutral-400 dark:border-slate-700 w-12">
                  Día
                </th>
                <th className="py-1 px-1.5 border-r border-neutral-400 dark:border-slate-700 w-12">
                  Mes
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-300 dark:divide-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-neutral-400">
                    No hay fechas de clase para el filtro seleccionado. Verificá los días activos (L, M, M, J, V) en el encabezado.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isToday = row.dateIso === todayIso;
                  return (
                    <tr
                      key={row.dateIso}
                      id={`libro-temas-row-${row.dateIso}`}
                      className={`transition-colors ${
                        row.isHoliday
                          ? isDarkMode
                            ? 'bg-amber-950/20 text-amber-200/90'
                            : 'bg-amber-50/60 text-amber-950'
                          : isToday
                          ? isDarkMode
                            ? 'bg-blue-950/30'
                            : 'bg-blue-50/50'
                          : isDarkMode
                          ? 'hover:bg-slate-800/40'
                          : 'hover:bg-neutral-50/80'
                      }`}
                    >
                      {/* FECHA: Día */}
                      <td className="py-2 px-1.5 text-center font-mono tabular-nums font-bold border-r border-neutral-300 dark:border-slate-800 align-middle">
                        <div>{row.day}</div>
                        <div className="text-[9px] font-sans font-normal text-neutral-400">
                          {row.dayName.slice(0, 3)}
                        </div>
                      </td>

                      {/* FECHA: Mes */}
                      <td className="py-2 px-1.5 text-center font-mono tabular-nums font-bold border-r border-neutral-300 dark:border-slate-800 align-middle">
                        <div>{row.month}</div>
                        {isToday && (
                          <span className="text-[9px] font-sans font-bold text-blue-600 dark:text-blue-400 block">
                            HOY
                          </span>
                        )}
                      </td>

                      {/* CLASE N° */}
                      <td className="py-1.5 px-1.5 text-center font-mono tabular-nums font-bold border-r border-neutral-300 dark:border-slate-800 align-middle">
                        {row.isHoliday ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateRowField(
                                row.dateIso,
                                row.term,
                                'isHolidayOverrideTaught',
                                true
                              )
                            }
                            title="Este día figura como feriado/asueto. Clic si igualmente se dictó clase."
                            className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            Feriado
                          </button>
                        ) : (
                          <input
                            type="text"
                            value={
                              row.entry.classNumberOverride !== undefined &&
                              row.entry.classNumberOverride !== ''
                                ? row.entry.classNumberOverride
                                : row.computedClassNum
                            }
                            onChange={(e) =>
                              handleUpdateRowField(
                                row.dateIso,
                                row.term,
                                'classNumberOverride',
                                e.target.value
                              )
                            }
                            className="w-12 text-center font-mono tabular-nums font-bold bg-transparent rounded px-1 py-1 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                          />
                        )}
                      </td>

                      {/* UNIDAD N° */}
                      <td className="py-1.5 px-1.5 text-center border-r border-neutral-300 dark:border-slate-800 align-middle">
                        <input
                          type="text"
                          value={row.entry.unitNumber}
                          onChange={(e) =>
                            handleUpdateRowField(
                              row.dateIso,
                              row.term,
                              'unitNumber',
                              e.target.value
                            )
                          }
                          placeholder={row.isHoliday ? '—' : 'N°'}
                          className="w-12 text-center font-mono tabular-nums bg-transparent rounded px-1 py-1 focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600"
                        />
                      </td>

                      {/* CARÁCTER DE LA CLASE */}
                      <td className="py-1.5 px-2 border-r border-neutral-300 dark:border-slate-800 align-top">
                        <input
                          type="text"
                          list={`caracter-list-${course.id}`}
                          value={row.entry.classCharacter}
                          onChange={(e) =>
                            handleUpdateRowField(
                              row.dateIso,
                              row.term,
                              'classCharacter',
                              e.target.value
                            )
                          }
                          placeholder="Ej: Teórico-Práctica"
                          className="w-full bg-transparent rounded px-1.5 py-1 text-xs focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600"
                        />
                      </td>

                      {/* CONTENIDOS */}
                      <td className="py-1.5 px-2 border-r border-neutral-300 dark:border-slate-800 align-top">
                        <textarea
                          rows={2}
                          value={row.entry.contents}
                          onChange={(e) =>
                            handleUpdateRowField(
                              row.dateIso,
                              row.term,
                              'contents',
                              e.target.value
                            )
                          }
                          placeholder="Registrar tema dictado en la clase..."
                          className="w-full bg-transparent rounded px-1.5 py-1 text-xs resize-y focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600 leading-snug"
                        />
                      </td>

                      {/* ACTIVIDADES QUE SE DESARROLLAN */}
                      <td className="py-1.5 px-2 border-r border-neutral-300 dark:border-slate-800 align-top">
                        <textarea
                          rows={2}
                          value={row.entry.activities}
                          onChange={(e) =>
                            handleUpdateRowField(
                              row.dateIso,
                              row.term,
                              'activities',
                              e.target.value
                            )
                          }
                          placeholder="Ej: Análisis de fuentes, resolución de guía..."
                          className="w-full bg-transparent rounded px-1.5 py-1 text-xs resize-y focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600 leading-snug"
                        />
                      </td>

                      {/* FIRMA DEL PROFESOR */}
                      <td className="py-1.5 px-2 border-r border-neutral-300 dark:border-slate-800 align-middle text-center">
                        <div className="flex flex-col items-center gap-1">
                          <input
                            type="text"
                            value={row.entry.teacherSignature}
                            onChange={(e) =>
                              handleUpdateRowField(
                                row.dateIso,
                                row.term,
                                'teacherSignature',
                                e.target.value
                              )
                            }
                            placeholder="Sin firmar"
                            className="w-full text-center italic text-xs bg-transparent rounded px-1 py-0.5 focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600"
                          />
                          {!row.entry.teacherSignature && !row.isHoliday && (
                            <button
                              type="button"
                              onClick={() => handleSignRow(row.dateIso, row.term)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              Firmar
                            </button>
                          )}
                        </div>
                      </td>

                      {/* OBSERVACIONES */}
                      <td className="py-1.5 px-2 border-r border-neutral-300 dark:border-slate-800 align-top">
                        <textarea
                          rows={2}
                          value={row.entry.observations}
                          onChange={(e) =>
                            handleUpdateRowField(
                              row.dateIso,
                              row.term,
                              'observations',
                              e.target.value
                            )
                          }
                          placeholder="Observaciones..."
                          className="w-full bg-transparent rounded px-1.5 py-1 text-xs resize-y focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600 leading-snug"
                        />
                      </td>

                      {/* FIRMA DE LA AUTORIDAD QUE VISITÓ LA CLASE */}
                      <td className="py-1.5 px-2 align-middle text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            value={row.entry.authoritySignature}
                            onChange={(e) =>
                              handleUpdateRowField(
                                row.dateIso,
                                row.term,
                                'authoritySignature',
                                e.target.value
                              )
                            }
                            placeholder="—"
                            className="w-full text-center text-xs bg-transparent rounded px-1 py-1 focus:outline-hidden focus:ring-1 focus:ring-blue-500 placeholder-neutral-300 dark:placeholder-slate-600"
                          />
                          {row.isManualDate && (
                            <button
                              type="button"
                              onClick={() => handleDeleteManualDate(row.dateIso)}
                              title="Eliminar fecha manual"
                              className="text-neutral-400 hover:text-red-500 p-1 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <datalist id={`caracter-list-${course.id}`}>
            {CLASS_CHARACTER_SUGGESTIONS.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  );
};
