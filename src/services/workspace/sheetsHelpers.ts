import {
  getCachedAccessToken,
  isValidGoogleAccessToken,
  fetchGoogleApiWithRetry,
  requestGoogleAccessToken,
} from './googleAuth';
import { Student } from '../../types';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import { sanitizeSpreadsheetFormulaCell } from '../../utils/htmlEscape';

/**
 * Crea o sincroniza en Google Sheets la planilla de Valoración Preliminar del cuatrimestre
 * y la ubica dentro de la subcarpeta de Informes del curso en Google Drive.
 *
 * @param courseName Nombre del curso activo.
 * @param termLabel Etiqueta legible del cuatrimestre (ej. "1° Cuatrimestre").
 * @param students Lista de alumnos del curso.
 * @param assessmentHeaders Columnas de evaluaciones que componen el promedio preliminar.
 * @param gradesMap Mapa de calificaciones por alumno y subcategoría.
 * @param valuations Valoraciones cualitativas (`TEA`, `TEP`, `TED`) y observaciones por alumno.
 * @param existingSpreadsheetId ID opcional de una planilla previamente creada.
 * @returns Metadatos de la planilla sincronizada (`spreadsheetId`, `url`, `isLiveGoogle`, `updatedAt`).
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
                        userEnteredValue: { stringValue: sanitizeSpreadsheetFormulaCell(h) },
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
                            : { stringValue: sanitizeSpreadsheetFormulaCell(cell) },
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
          const driveTasks: Promise<unknown>[] = [];
          if (targetReportsFolderId) {
            driveTasks.push(
              driveService.moveFileToFolder(
                sheetData.spreadsheetId,
                targetReportsFolderId,
                token
              )
            );
          }
          if (folders.gradesFolder?.id) {
            driveTasks.push(
              driveService.ensureShortcutInFolder(
                sheetTitle,
                sheetData.spreadsheetId,
                folders.gradesFolder.id,
                token
              )
            );
          }
          if (driveTasks.length > 0) {
            await Promise.all(driveTasks);
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
 * Convierte un índice numérico de columna (base 0) en su letra equivalente de hoja de cálculo (`A`, `B`, ..., `Z`, `AA`).
 *
 * @param colIndex Índice de columna en base 0.
 * @returns Letra o combinación de letras de columna estilo Excel/Sheets.
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
 * Detecta la fila de encabezados en una matriz 2D (saltando filas vacías o membretes institucionales)
 * y transforma las filas subsiguientes en diccionarios indexados por nombre de columna.
 *
 * @param rawValues Matriz 2D de celdas crudas.
 * @param explicitHeaderRowIndex Índice de fila de encabezado elegido manualmente por el docente (`-1` si no tiene encabezados).
 * @returns Los encabezados normalizados (`headers`), las filas como objetos (`rows`) y el índice de cabecera utilizado (`headerRowIndex`).
 */
export function convert2DArrayToTableObjectsHelper(
  rawValues: any[][],
  explicitHeaderRowIndex?: number
): {
  headers: string[];
  rows: Array<Record<string, any>>;
  headerRowIndex: number;
} {
  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    return { headers: [], rows: [], headerRowIndex: 0 };
  }

  let maxCols = 0;
  for (let i = 0; i < Math.min(30, rawValues.length); i++) {
    const r = Array.isArray(rawValues[i]) ? rawValues[i] : [];
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
      const r = Array.isArray(rawValues[i]) ? rawValues[i] : [];
      const nonEmptyCells = r.filter((c) => String(c ?? '').trim() !== '');
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

  const rawHeaders =
    headerRowIndex >= 0 && Array.isArray(rawValues[headerRowIndex])
      ? rawValues[headerRowIndex]
      : [];
  const prevRow =
    headerRowIndex > 0 && Array.isArray(rawValues[headerRowIndex - 1])
      ? rawValues[headerRowIndex - 1]
      : [];

  const seenHeaders = new Set<string>();
  const headers: string[] = [];

  for (let idx = 0; idx < maxCols; idx++) {
    const colLetter = getSpreadsheetColLetter(idx);
    let clean = headerRowIndex >= 0 ? String(rawHeaders[idx] ?? '').trim() : '';
    const upperClean = headerRowIndex > 0 ? String(prevRow[idx] ?? '').trim() : '';

    // En planillas escolares con celdas combinadas en dos filas de cabecera, si la celda inferior está vacía se hereda el título de la fila superior.
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
    const rowArr = Array.isArray(rawValues[r]) ? rawValues[r] : [];
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
 * Descarga y estructura los datos de una planilla de Google Sheets a partir de su URL o ID.
 * Utiliza en cascada: (1) Google Sheets API v4 autenticada, (2) proxy backend para sortear CORS y (3) exportación CSV pública (`gviz/tq`).
 *
 * @param spreadsheetIdOrUrl URL completa o ID de la hoja de cálculo de Google Sheets.
 * @param targetSheetTitle Nombre opcional de la pestaña a leer; si se omite, lee la primera pestaña.
 * @param providedToken Token OAuth 2.0 explícito opcional.
 * @returns Metadatos de la planilla, lista de pestañas, matriz 2D cruda y filas convertidas en objetos.
 * @throws {Error} Con mensaje claro en español si la planilla es privada, inválida o hay un corte de red.
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
  const trimmed = String(spreadsheetIdOrUrl ?? '').trim();
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
        const meta = await metaRes.json().catch(() => ({}));
        const title = meta.properties?.title || 'Documento de Google Sheets';
        const sheetNames: string[] = (meta.sheets || [])
          .map((s: any) => s?.properties?.title)
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
          const valData = await valRes.json().catch(() => ({}));
          const rawValues: any[][] = Array.isArray(valData.values) ? valData.values : [];
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
      const proxyData = await proxyRes.json().catch(() => null);
      if (proxyData?.ok && (proxyData.csvText || proxyData.htmlText)) {
        const XLSX = await import('xlsx');
        const contentStr = proxyData.csvText || proxyData.htmlText;
        const wb = XLSX.read(contentStr, { type: 'string' });
        const firstSheet = wb?.SheetNames?.[0];
        if (firstSheet && wb.Sheets?.[firstSheet]) {
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

  const csvUrl = targetSheetTitle
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(targetSheetTitle)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;

  let csvText = '';
  try {
    const csvRes = await fetch(csvUrl);
    if (!csvRes.ok) {
      throw new Error(
        'No se pudo acceder a la hoja de Google Sheets. Asegúrate de haber iniciado sesión con tu cuenta de Google o que el documento tenga acceso por enlace.'
      );
    }
    csvText = await csvRes.text();
  } catch (networkErr: any) {
    throw new Error(
      networkErr?.message && !networkErr.message.includes('Failed to fetch')
        ? networkErr.message
        : 'No se pudo conectar con Google Sheets. Verificá tu conexión a internet, iniciá sesión con tu cuenta de Google o habilitá el acceso por enlace en la planilla.'
    );
  }

  // Cuando una planilla es privada, el endpoint `gviz/tq` devuelve un código 200 con la página HTML de inicio de sesión de Google en vez de un CSV.
  if (
    !csvText ||
    csvText.trim().startsWith('<!DOCTYPE html') ||
    csvText.includes('accounts.google.com')
  ) {
    throw new Error(
      'La hoja de Google Sheets es privada. Pulsa "Buscar" abajo para conectar tu Google Drive o habilita el acceso por enlace.'
    );
  }

  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(csvText, { type: 'string' });
    const firstSheet = wb?.SheetNames?.[0];
    const ws = firstSheet ? wb.Sheets?.[firstSheet] : null;
    const rawValues: any[][] = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) : [];
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
  } catch {
    throw new Error('No se pudo interpretar el contenido de la hoja de Google Sheets.');
  }
}
