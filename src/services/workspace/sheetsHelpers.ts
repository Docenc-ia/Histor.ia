import {
  getCachedAccessToken,
  isValidGoogleAccessToken,
  fetchGoogleApiWithRetry,
  requestGoogleAccessToken,
} from './googleAuth';
import { Student, GradeEntry, StudentHistoryItem, StudentDispositionData } from '../../types';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import { getUserStorageKey } from '../storageHelpers';
import { api } from '../api';

/**
 * Generates a downloadable CSV directly formatted for Google Sheets import (Gradebook)
 */
export function exportGradebookToCsv(
  courseName: string,
  students: Student[],
  evaluations: string[],
  grades: GradeEntry[]
) {
  const headers = [
    'Apellido y Nombre',
    'Correo Institucional',
    ...evaluations,
    'Promedio',
    'Condición',
  ];
  const rows = students.map((student) => {
    const studentGrades = evaluations.map((evalTitle) => {
      const entry = grades.find(
        (g) => g.studentId === student.id && g.evaluationTitle === evalTitle
      );
      return entry ? entry.score : '';
    });
    const validScores = studentGrades.filter((s) => typeof s === 'number') as number[];
    const avg =
      validScores.length > 0
        ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)
        : '-';
    const condition =
      validScores.length > 0 && parseFloat(avg as string) >= 6 ? 'Aprobado' : 'En proceso';

    return [
      `"${student.lastName}, ${student.firstName}"`,
      `"${student.email}"`,
      ...studentGrades.map((g) => `"${g}"`),
      `"${avg}"`,
      `"${condition}"`,
    ].join(',');
  });

  const csvContent = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Calificaciones_${courseName.replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates a downloadable CSV directly formatted for Google Sheets import (Attendance & Disposition)
 */
export function exportDispositionToCsv(
  courseName: string,
  students: Student[],
  dispositionMap: Record<string, StudentDispositionData>,
  historyList: StudentHistoryItem[]
) {
  const sortedStudents = [...students].sort((a, b) => {
    const lastA = (a.lastName || '').trim();
    const lastB = (b.lastName || '').trim();
    const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', {
      sensitivity: 'base',
    });
  });

  const summaryHeaders = [
    'Apellido y Nombre',
    'Email',
    'Total Ausencias',
    'Llegadas Tarde',
    'Disposición (1-10)',
    'Última Incidencia',
    'Estado',
  ];
  const summaryRows = sortedStudents.map((student) => {
    const absences = dispositionMap[student.id]?.totalAbsences ?? 0;
    const lates = dispositionMap[student.id]?.totalLates ?? 0;
    const score = dispositionMap[student.id]?.totalDisposition ?? 10;
    const studentHistory = historyList
      .filter((h) => h.studentId === student.id)
      .sort((a, b) => b.timestamp - a.timestamp);
    const last = studentHistory[0]
      ? `${studentHistory[0].action} (${studentHistory[0].date})`
      : 'Sin registros';
    const cond = score >= 8 ? 'Excelente' : score >= 6 ? 'Regular' : 'Requiere atención (<6)';
    return [
      `"${student.lastName}, ${student.firstName}"`,
      `"${student.email}"`,
      absences,
      lates,
      score,
      `"${last}"`,
      `"${cond}"`,
    ].join(',');
  });

  const historyHeaders = [
    'Fecha',
    'Hora',
    'Estudiante',
    'Categoría',
    'Motivo de Conducta',
    'Impacto',
    'Disposición Resultante',
    'Mensaje enviado',
    'Mensaje',
  ];
  const historyRows = historyList.map((h) => {
    const score = dispositionMap[h.studentId]?.totalDisposition ?? 10;
    const isOmittedOrNone =
      h.omitNotification ||
      h.notificationMethod === 'omitted' ||
      h.notificationMethod === 'none' ||
      h.notifiedAt === 'No enviar' ||
      h.notifiedAt === 'Omitido';

    const sentTick = h.messageSent
      ? '✓'
      : isOmittedOrNone
      ? 'No enviar'
      : h.category === 'Ausencia' || h.category === 'Disposición'
      ? 'Pendiente'
      : '-';

    const cleanMsg = (
      h.messageText ||
      (h.messageSent ? '(Sin texto adicional)' : isOmittedOrNone ? '(Sin mensaje)' : '-')
    ).replace(/"/g, '""');

    const isItemAbsence =
      h.category === 'Ausencia' ||
      h.action === 'Ausencia' ||
      h.action?.toLowerCase().includes('ausencia') ||
      h.action?.toLowerCase().includes('falta');
    const isItemLate =
      h.category === 'Llegada tarde' ||
      h.action === 'Llegada tarde' ||
      h.action?.toLowerCase().includes('llegada tarde') ||
      h.action?.toLowerCase().includes('tarde') ||
      h.action?.toLowerCase().includes('tardanza');

    const impact = isItemAbsence
      ? 'Ausencia'
      : isItemLate
      ? 'Tardanza'
      : h.pointsChange !== undefined && h.pointsChange !== 0
      ? h.pointsChange > 0
        ? `+${h.pointsChange} pto`
        : `${h.pointsChange} pto`
      : '-';

    return [
      `"${h.date}"`,
      `"${h.time}"`,
      `"${h.studentName}"`,
      `"${h.category}"`,
      `"${h.action}"`,
      `"${impact}"`,
      score,
      `"${sentTick}"`,
      `"${cleanMsg}"`,
    ].join(',');
  });

  const csvContent = [
    '# HOJA 1: RESUMEN Y DISPOSICIÓN DE ALUMNOS',
    summaryHeaders.join(','),
    ...summaryRows,
    '',
    '# HOJA 2: HISTORIAL DE INCIDENCIAS DETALLADAS',
    historyHeaders.join(','),
    ...historyRows,
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Registro_Asistencia_Disposicion_${courseName.replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export or synchronize Preliminary Valuation (Valoración Preliminar) with Google Sheets
 */
export async function syncPreliminaryValuationSheetHelper(
  courseName: string,
  termLabel: string,
  students: Student[],
  assessmentHeaders: Array<{ id: string; name: string; categoryName: string }>,
  gradesMap: Record<string, Record<string, string>>,
  valuations: Record<string, { trajectory: string; observation: string }>,
  existingSpreadsheetId?: string
): Promise<{
  spreadsheetId: string;
  url: string;
  isLiveGoogle: boolean;
  updatedAt: string;
}> {
  const token = getCachedAccessToken();
  const sheetTitle = `📋 Valoración Preliminar (${termLabel}) - ${courseName}`;

  const headers = [
    'Apellido y Nombre',
    'Correo Institucional',
    ...assessmentHeaders.map((a) => (a.categoryName ? `${a.name} (${a.categoryName})` : a.name)),
    'Promedio Preliminar',
    'Valoración Cualitativa',
    'Descripción Trayecto',
    'Observación Pedagógica',
  ];

  const sortedStudents = [...students].sort((a, b) => {
    const lastA = (a.lastName || '').trim();
    const lastB = (b.lastName || '').trim();
    const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', {
      sensitivity: 'base',
    });
  });

  const rows = sortedStudents.map((student) => {
    const stGrades = gradesMap[student.id] || {};
    const scoreCols = assessmentHeaders.map((a) => stGrades[a.id] || '');

    const numScores = scoreCols
      .filter((s) => s !== '' && !isNaN(Number(s)))
      .map((s) => Number(s));

    const avgStr =
      numScores.length > 0
        ? (numScores.reduce((acc, curr) => acc + curr, 0) / numScores.length).toFixed(1)
        : '-';

    const v = valuations[student.id];
    const traj = v?.trajectory || 'Sin asignar';
    let trajDesc = '';
    if (traj === 'TEA') trajDesc = 'Trayecto Educativo en Alcanzado';
    else if (traj === 'TEP') trajDesc = 'Trayecto Educativo en Proceso';
    else if (traj === 'TED') trajDesc = 'Trayecto Educativo Discontinuo';
    const obs = v?.observation || '';

    return [
      `${student.lastName}, ${student.firstName}`,
      student.email || '',
      ...scoreCols,
      avgStr,
      traj,
      trajDesc,
      obs,
    ];
  });

  if (token && isValidGoogleAccessToken(token)) {
    try {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { title: sheetTitle },
          sheets: [
            {
              properties: {
                title: `Valoración Preliminar`,
                gridProperties: { frozenRowCount: 1 },
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: headers.map((h) => ({
                        userEnteredValue: { stringValue: h },
                        userEnteredFormat: {
                          textFormat: { bold: true },
                          backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
                        },
                      })),
                    },
                    ...rows.map((row) => ({
                      values: row.map((cell) => {
                        const isNum =
                          typeof cell === 'number' ||
                          (!isNaN(Number(cell)) && cell !== '' && cell !== '-');
                        return {
                          userEnteredValue: isNum
                            ? { numberValue: Number(cell) }
                            : { stringValue: String(cell) },
                        };
                      }),
                    })),
                  ],
                },
              ],
            },
          ],
        }),
      });

      if (createRes.ok) {
        const sheetData = await createRes.json();
        return {
          spreadsheetId: sheetData.spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
          isLiveGoogle: true,
          updatedAt: new Date().toLocaleTimeString(),
        };
      }
    } catch (err) {
      console.warn('Live Google Sheets call failed for preliminary valuation:', err);
    }
  }

  const isReal = isRealGoogleSpreadsheetId(existingSpreadsheetId);
  const fallbackId = isReal
    ? existingSpreadsheetId!
    : `sheet-val-${Date.now().toString().slice(-4)}`;
  return {
    spreadsheetId: fallbackId,
    url: isReal ? `https://docs.google.com/spreadsheets/d/${fallbackId}/edit` : undefined,
    isLiveGoogle: isReal,
    updatedAt: new Date().toLocaleTimeString(),
  };
}

/**
 * Create or update the dedicated "Libro de Temas" Google Spreadsheet inside the course's Drive folder
 */
export async function syncLibroDeTemasToSheetHelper(
  ensureSheetsExist: (
    spreadsheetId: string,
    token: string,
    sheetTitles: string[],
    minRows?: number
  ) => Promise<void>,
  course: { id: string; name: string; subject?: string; schedule?: string },
  teacherName?: string,
  folderId?: string,
  existingSpreadsheetId?: string,
  providedToken?: string
): Promise<{ spreadsheetId: string; url?: string; isLiveGoogle: boolean }> {
  const token =
    providedToken && isValidGoogleAccessToken(providedToken)
      ? providedToken
      : getCachedAccessToken();
  const tabName = 'Libro de Temas';
  const sheetTitle = `📖 Libro de Temas - ${course.name}`;

  let storedEntries: Record<string, any> = {};
  let storedMeta: { asignatura?: string; profTitular?: string } = {};
  let targetSpreadsheetId =
    existingSpreadsheetId && isRealGoogleSpreadsheetId(existingSpreadsheetId)
      ? existingSpreadsheetId
      : undefined;

  if (typeof window !== 'undefined') {
    try {
      const keysToTry = [
        getUserStorageKey(`fds_libro_temas_${course.id}`),
        `fds_libro_temas_${course.id}`,
        `fds_libro_temas_v1_${course.id}`,
        ...Object.keys(localStorage).filter(
          (k) =>
            k.endsWith(`fds_libro_temas_${course.id}`) ||
            k.endsWith(`fds_libro_temas_v1_${course.id}`)
        ),
      ];
      for (const k of keysToTry) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.entries && Object.keys(parsed.entries).length > 0) {
            storedEntries = parsed.entries;
          }
          if (parsed?.metadata) {
            storedMeta = parsed.metadata;
          }
          if (
            !targetSpreadsheetId &&
            parsed?.sheetInfo?.spreadsheetId &&
            isRealGoogleSpreadsheetId(parsed.sheetInfo.spreadsheetId)
          ) {
            targetSpreadsheetId = parsed.sheetInfo.spreadsheetId;
          }
          if (Object.keys(storedEntries).length > 0 || parsed?.metadata) {
            break;
          }
        }
      }
    } catch (_) {}
  }

  if (token) {
    try {
      if (targetSpreadsheetId) {
        const isActive = await driveService.verifyFileIsActive(targetSpreadsheetId, token);
        if (!isActive) {
          targetSpreadsheetId = undefined;
        }
      }
      if (!targetSpreadsheetId) {
        const found = await driveService.findCourseSpreadsheet(
          folderId,
          course.name,
          token,
          'Libro de Temas'
        );
        if (found?.id && isRealGoogleSpreadsheetId(found.id)) {
          targetSpreadsheetId = found.id;
        }
      }

      const sortedEntryKeys = Object.keys(storedEntries)
        .filter((k) => !k.endsWith('__0'))
        .sort();
      const nowStr = `${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`;
      const metaRow = [
        'ASIGNATURA:',
        storedMeta.asignatura || course.subject || course.name,
        'PROF. TITULAR:',
        storedMeta.profTitular || teacherName || 'Docente',
        'HORARIO:',
        course.schedule || 'A coordinar',
        'ÚLTIMA SINCRONIZACIÓN:',
        nowStr,
        '',
        '',
      ];
      const emptyRow = ['', '', '', '', '', '', '', '', '', ''];
      const headerRow = [
        'Fecha (ISO)',
        'FECHA (Día / Mes)',
        'Horario / Módulo',
        'Clase N°',
        'Unidad N°',
        'CONTENIDOS',
        'Carácter de la clase',
        'OBSERVACIONES',
        'Firma del Profesor',
        'Firma de la Autoridad',
      ];

      let classCounter = 1;
      const dataRows = sortedEntryKeys.map((key) => {
        const entry = storedEntries[key] || {};
        const dateStr = String(entry.date || key.split('__')[0] || '');
        const parts = dateStr.split('-');
        const dayMonth =
          parts.length === 3 ? `${Number(parts[2])}/${Number(parts[1])}` : dateStr;
        const isHol = Boolean(entry.isHoliday);
        const classNum = isHol
          ? '-'
          : entry.customClassNumber?.trim() || String(classCounter++);
        return [
          dateStr,
          dayMonth,
          entry.timeLabel ||
            (key.includes('__') ? `${Number(key.split('__')[1] || 0) + 1}° Hora` : '-'),
          classNum,
          isHol ? '-' : entry.unitNumber || '1',
          entry.contents || (isHol && entry.holidayName ? `Feriado: ${entry.holidayName}` : ''),
          isHol ? '-' : entry.classCharacter || 'Teórico - Práctica',
          entry.observations || '',
          entry.teacherSignature || '',
          entry.authoritySignature || '',
        ];
      });

      if (!targetSpreadsheetId) {
        const createRes = await fetchGoogleApiWithRetry(
          'https://sheets.googleapis.com/v4/spreadsheets',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: { title: sheetTitle },
              sheets: [
                {
                  properties: {
                    title: tabName,
                    gridProperties: {
                      rowCount: Math.max(120, dataRows.length + 20),
                      columnCount: 10,
                      frozenRowCount: 3,
                    },
                  },
                },
              ],
            }),
          },
          token
        );
        if (createRes.ok) {
          const created = await createRes.json();
          targetSpreadsheetId = created.spreadsheetId;
          if (folderId && !folderId.startsWith('folder-') && !folderId.startsWith('f-')) {
            await driveService.moveFileToFolder(targetSpreadsheetId!, folderId, token);
          }
        }
      }

      if (targetSpreadsheetId && isRealGoogleSpreadsheetId(targetSpreadsheetId)) {
        await ensureSheetsExist(targetSpreadsheetId, token, [tabName]);
        await fetchGoogleApiWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [metaRow, emptyRow, headerRow, ...dataRows],
            }),
          },
          token
        );

        const url = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
        api
          .updateCourse(course.id, {
            libroDeTemasSheetId: targetSpreadsheetId,
            libroDeTemasSheetUrl: url,
          })
          .catch(() => {});
        return {
          spreadsheetId: targetSpreadsheetId,
          url,
          isLiveGoogle: true,
        };
      }
    } catch (err) {
      console.warn('Error syncing Libro de Temas to Google Sheets:', err);
    }
  }

  return {
    spreadsheetId: targetSpreadsheetId || `sheet-libro-${course.id}`,
    url: targetSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`
      : undefined,
    isLiveGoogle: false,
  };
}

/**
 * Smartly finds the header row in a 2D array (skipping empty rows or title banners)
 * and converts the subsequent rows into objects keyed by column header.
 */
function getSpreadsheetColLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Smartly finds the header row in a 2D array (skipping empty rows or title banners)
 * or uses an explicit headerRowIndex chosen by the teacher in the visual mapper
 * (-1 means the sheet has no header row and data starts at row 0).
 */
export function convert2DArrayToTableObjectsHelper(
  rawValues: any[][],
  explicitHeaderRowIndex?: number
): {
  headers: string[];
  rows: Array<Record<string, any>>;
  headerRowIndex: number;
} {
  if (!rawValues || rawValues.length === 0) {
    return { headers: [], rows: [], headerRowIndex: 0 };
  }

  // Find max column count across the first 30 rows
  let maxCols = 0;
  for (let i = 0; i < Math.min(30, rawValues.length); i++) {
    const r = rawValues[i] || [];
    if (r.length > maxCols) maxCols = r.length;
  }
  if (maxCols === 0) {
    return { headers: [], rows: [], headerRowIndex: 0 };
  }

  let headerRowIndex = 0;

  if (typeof explicitHeaderRowIndex === 'number') {
    headerRowIndex = explicitHeaderRowIndex;
  } else {
    let bestScore = -1;
    for (let i = 0; i < Math.min(15, rawValues.length); i++) {
      const r = rawValues[i] || [];
      const nonEmptyCells = r.filter((c) => String(c || '').trim() !== '');
      if (nonEmptyCells.length < 2) continue;

      let score = nonEmptyCells.length;
      const joined = nonEmptyCells.map((c) => String(c).toLowerCase()).join(' ');
      if (/alumno|estudiante|apellido|nombre|email|correo|legajo/i.test(joined)) score += 25;
      if (
        /nota|tp|eval|examen|parcial|falta|ausencia|inasistencia|tardanza|disposicion|conducta|concepto|actitud|desempeno|1c|2c|cuatrimestre/i.test(
          joined
        )
      ) {
        score += 20;
      }

      if (score > bestScore) {
        bestScore = score;
        headerRowIndex = i;
      }
    }
  }

  const rawHeaders = headerRowIndex >= 0 ? rawValues[headerRowIndex] || [] : [];
  const prevRow = headerRowIndex > 0 ? rawValues[headerRowIndex - 1] || [] : [];

  const seenHeaders = new Set<string>();
  const headers: string[] = [];

  for (let idx = 0; idx < maxCols; idx++) {
    const colLetter = getSpreadsheetColLetter(idx);
    let clean = headerRowIndex >= 0 ? String(rawHeaders[idx] ?? '').trim() : '';
    const upperClean = headerRowIndex > 0 ? String(prevRow[idx] ?? '').trim() : '';

    // If current header cell is empty, fall back to cell directly above (merged/multi-row header)
    if (!clean && upperClean && upperClean.length < 40) {
      clean = upperClean;
    }

    let baseHeader = clean || `Columna ${colLetter}`;
    if (seenHeaders.has(baseHeader)) {
      baseHeader = `${baseHeader} (Col ${colLetter})`;
    }
    seenHeaders.add(baseHeader);
    headers.push(baseHeader);
  }

  const startDataRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const rows: Array<Record<string, any>> = [];
  for (let r = startDataRow; r < rawValues.length; r++) {
    const rowArr = rawValues[r] || [];
    const nonEmpty = rowArr.some((cell) => String(cell ?? '').trim() !== '');
    if (!nonEmpty) continue;

    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      obj[h] = rowArr[idx] !== undefined ? rowArr[idx] : '';
    });
    rows.push(obj);
  }

  return { headers, rows, headerRowIndex };
}

/**
 * Read an existing Google Spreadsheet (by URL or ID) so the teacher can import grades, categories,
 * or attendance/disposition data with pre-verification in the UI.
 */
export async function fetchArbitrarySpreadsheetDataHelper(
  spreadsheetIdOrUrl: string,
  targetSheetTitle?: string,
  providedToken?: string
): Promise<{
  spreadsheetId: string;
  title: string;
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  rows: Array<Record<string, any>>;
  raw2D: any[][];
  headerRowIndex: number;
}> {
  const trimmed = spreadsheetIdOrUrl.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = match ? match[1] : trimmed;

  if (!spreadsheetId || spreadsheetId.length < 10) {
    throw new Error('El enlace o ID de Google Sheets no es válido.');
  }

  let token = providedToken || getCachedAccessToken();
  if (!token || !isValidGoogleAccessToken(token)) {
    try {
      token = await requestGoogleAccessToken();
    } catch (_) {}
  }

  if (token && isValidGoogleAccessToken(token)) {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (metaRes.ok) {
      const meta = await metaRes.json();
      const title = meta.properties?.title || 'Documento de Google Sheets';
      const sheetNames: string[] = (meta.sheets || [])
        .map((s: any) => s.properties?.title)
        .filter(Boolean);
      const selectedSheet =
        targetSheetTitle && sheetNames.includes(targetSheetTitle)
          ? targetSheetTitle
          : sheetNames[0] || 'Hoja 1';

      const range = encodeURIComponent(`'${selectedSheet}'!A1:ZZ500`);
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (valRes.ok) {
        const valData = await valRes.json();
        const rawValues: any[][] = valData.values || [];
        const { headers, rows, headerRowIndex } = convert2DArrayToTableObjectsHelper(rawValues);
        return {
          spreadsheetId,
          title,
          sheetNames,
          selectedSheet,
          headers,
          rows,
          raw2D: rawValues,
          headerRowIndex,
        };
      }
    }
  }

  const csvUrl = targetSheetTitle
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(targetSheetTitle)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;

  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) {
    throw new Error(
      'No se pudo acceder a la hoja de Google Sheets. Asegúrate de haber iniciado sesión con tu cuenta de Google o que el documento sea accesible.'
    );
  }

  const csvText = await csvRes.text();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(csvText, { type: 'string' });
  const firstSheet = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheet];
  const rawValues: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const { headers, rows, headerRowIndex } = convert2DArrayToTableObjectsHelper(rawValues);

  return {
    spreadsheetId,
    title: 'Hoja de Google Sheets',
    sheetNames: [targetSheetTitle || 'Hoja 1'],
    selectedSheet: targetSheetTitle || 'Hoja 1',
    headers,
    rows,
    raw2D: rawValues,
    headerRowIndex,
  };
}
