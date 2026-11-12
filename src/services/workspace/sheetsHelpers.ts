import {
  getCachedAccessToken,
  isValidGoogleAccessToken,
  fetchGoogleApiWithRetry,
  requestGoogleAccessToken,
} from './googleAuth';
import { Student } from '../../types';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';

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
        try {
          const folders = await driveService.setupCourseFolderStructure(
            courseName,
            undefined,
            token
          );
          const targetReportsFolderId = folders.reportsFolder?.id || folders.mainFolder.id;
          if (targetReportsFolderId) {
            await driveService.moveFileToFolder(
              sheetData.spreadsheetId,
              targetReportsFolderId,
              token
            );
          }
          if (folders.gradesFolder?.id) {
            await driveService.ensureShortcutInFolder(
              sheetTitle,
              sheetData.spreadsheetId,
              folders.gradesFolder.id,
              token
            );
          }
        } catch (_) {}
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
  const match = trimmed.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/i);
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
    try {
      const metaRes = await fetchGoogleApiWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`,
        {},
        token
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
        const valRes = await fetchGoogleApiWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
          {},
          getCachedAccessToken() || token
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
    } catch (apiErr) {
      console.warn('Sheets API v4 fallback notice:', apiErr);
    }
  }

  // Fallback 1: Server-side proxy (bypasses browser CORS on docs.google.com)
  try {
    const proxyRes = await fetch('/api/workspace/fetch-remote-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: trimmed.startsWith('http')
          ? trimmed
          : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        sheetName: targetSheetTitle || '',
      }),
    });
    if (proxyRes.ok) {
      const proxyData = await proxyRes.json();
      if (proxyData?.ok && (proxyData.csvText || proxyData.htmlText)) {
        const XLSX = await import('xlsx');
        const contentStr = proxyData.csvText || proxyData.htmlText;
        const wb = XLSX.read(contentStr, { type: 'string' });
        const firstSheet = wb.SheetNames[0];
        if (firstSheet && wb.Sheets[firstSheet]) {
          const rawValues: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
            header: 1,
            defval: '',
          });
          const { headers, rows, headerRowIndex } = convert2DArrayToTableObjectsHelper(rawValues);
          return {
            spreadsheetId,
            title: proxyData.title || 'Hoja de Google Sheets',
            sheetNames: [targetSheetTitle || 'Hoja 1'],
            selectedSheet: targetSheetTitle || 'Hoja 1',
            headers,
            rows,
            raw2D: rawValues,
            headerRowIndex,
          };
        }
      }
    }
  } catch (_) {}

  // Fallback 2: Direct browser CSV export
  const csvUrl = targetSheetTitle
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(targetSheetTitle)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;

  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) {
    throw new Error(
      'No se pudo acceder a la hoja de Google Sheets. Asegúrate de haber iniciado sesión con tu cuenta de Google o que el documento tenga acceso por enlace.'
    );
  }

  const csvText = await csvRes.text();
  if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.includes('accounts.google.com')) {
    throw new Error(
      'La hoja de Google Sheets es privada. Pulsa "Buscar" abajo para conectar tu Google Drive o habilita el acceso por enlace.'
    );
  }

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
