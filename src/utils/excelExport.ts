import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import { getTerminologySettings, getDerivedPeriodLabels } from './terminologySettings';
import { driveService } from '../services/workspace/driveService';

export interface GradeHistoryEntry {
  id: string;
  courseId: string;
  timestamp: number;
  date: string;
  time: string;
  term: '1c' | '2c';
  termLabel: string;
  subcategoryId: string;
  evaluationName: string;
  categoryName: string;
  action: 'import_excel' | 'import_sheets' | 'manual_update' | 'sheet_sync';
  description: string;
  updatedStudentsCount: number;
  averageScore?: number;
  sourceFile?: string;
  changesSummary: Array<{
    studentId: string;
    studentName: string;
    studentEmail?: string;
    previousScore?: string;
    newScore: string;
    status: 'new' | 'updated' | 'unchanged';
  }>;
}

let cachedXlsxPromise: Promise<typeof import('xlsx')> | null = null;

function loadXlsxModule(): Promise<typeof import('xlsx')> {
  if (!cachedXlsxPromise) {
    cachedXlsxPromise = import('xlsx');
  }
  return cachedXlsxPromise;
}

/**
 * Neutralizes Excel / CSV Formula Injection (ISO/IEC 27001 A.8.28)
 * Prefixes a leading space if a free-text string starts with '=', '+', '-', '@', '\t', or '\r'
 * (unless it is a pure numeric value or standard '-' placeholder).
 */
function sanitizeExcelText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '-' || str === '') return str;
  if (/^[=+\-@\t\r]/.test(str) && isNaN(Number(str.replace(',', '.')))) {
    return ` ${str}`;
  }
  return str;
}

/**
 * Exporta el historial de calificaciones / importaciones a un archivo Excel (.xlsx)
 */
export async function exportGradeHistoryToExcel(
  courseName: string,
  history: GradeHistoryEntry[]
) {
  const XLSX = await loadXlsxModule();
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen del Historial
  const summaryRows = history.map((h, idx) => ({
    'N°': idx + 1,
    'Fecha': sanitizeExcelText(h.date),
    'Hora': sanitizeExcelText(h.time),
    'Cuatrimestre': sanitizeExcelText(h.termLabel),
    'Evaluación': sanitizeExcelText(h.evaluationName),
    'Categoría': sanitizeExcelText(h.categoryName),
    'Tipo de Registro':
      h.action === 'import_excel'
        ? 'Importación Excel'
        : h.action === 'import_sheets'
        ? 'Importación Google Sheets'
        : h.action === 'manual_update'
        ? 'Carga Manual'
        : 'Sincronización Sheets',
    'Alumnos Registrados': h.updatedStudentsCount,
    'Promedio': h.averageScore ? h.averageScore.toFixed(2) : '-',
    'Archivo Origen': sanitizeExcelText(h.sourceFile || 'Carga Directa'),
    'Detalle': sanitizeExcelText(h.description),
  }));

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);

  // Anchos de columnas
  wsSummary['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 26 },
    { wch: 22 },
    { wch: 22 },
    { wch: 20 },
    { wch: 12 },
    { wch: 25 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Historial General');

  // Hoja 2: Detalle Alumno por Alumno de las Importaciones
  const detailRows: any[] = [];
  history.forEach((h) => {
    (h.changesSummary || []).forEach((c) => {
      detailRows.push({
        'Fecha': sanitizeExcelText(h.date),
        'Hora': sanitizeExcelText(h.time),
        'Evaluación': sanitizeExcelText(h.evaluationName),
        'Cuatrimestre': sanitizeExcelText(h.termLabel),
        'Alumno': sanitizeExcelText(c.studentName),
        'Email': sanitizeExcelText(c.studentEmail || '-'),
        'Nota Anterior': sanitizeExcelText(c.previousScore || '(sin nota)'),
        'Nota Asignada': sanitizeExcelText(c.newScore),
        'Estado':
          c.status === 'new'
            ? 'Nota Nueva'
            : c.status === 'updated'
            ? 'Modificación'
            : 'Sin Cambio',
      });
    });
  });

  if (detailRows.length > 0) {
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [
      { wch: 12 },
      { wch: 10 },
      { wch: 26 },
      { wch: 16 },
      { wch: 30 },
      { wch: 28 },
      { wch: 15 },
      { wch: 15 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle de Alumnos');
  }

  const safeName = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const filename = `Historial_Calificaciones_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);

  try {
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return await driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Calificaciones',
        fileName: filename,
        content: buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * Exporta el historial de asistencia y actividades del curso a un archivo Excel (.xlsx)
 */
export async function exportCourseClassHistoryToExcel(
  courseName: string,
  historyItems: Array<{
    studentName: string;
    date: string;
    time: string;
    action: string;
    category: string;
    timestamp?: number;
  }>,
  options?: { customFileName?: string; existingMainFolderId?: string; skipLocalDownload?: boolean }
) {
  const XLSX = await loadXlsxModule();
  const wb = XLSX.utils.book_new();

  const sorted = [...historyItems].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );

  const rows = sorted.map((item, idx) => ({
    'N°': idx + 1,
    'Alumno': sanitizeExcelText(item.studentName),
    'Fecha': sanitizeExcelText(item.date),
    'Hora': sanitizeExcelText(item.time),
    'Acción / Registro': sanitizeExcelText(item.action),
    'Categoría': sanitizeExcelText(item.category),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 32 },
    { wch: 14 },
    { wch: 12 },
    { wch: 45 },
    { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Historial Clase');

  const safeName = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const rawName =
    options?.customFileName?.trim() ||
    `Historial_Asistencia_Conducta_${safeName}_${new Date().toISOString().slice(0, 10)}`;
  const filename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;
  if (!options?.skipLocalDownload) {
    XLSX.writeFile(wb, filename);
  }

  try {
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return await driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Historial de Incidencias',
        fileName: filename,
        content: buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        existingMainFolderId: options?.existingMainFolderId,
      })
      .catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * Exporta la matriz completa de calificaciones a un archivo Excel (.xlsx) con columnas organizadas
 */
export async function exportGradebookMatrixToExcel(
  courseName: string,
  termLabel: string,
  students: Student[],
  categories: GradeCategory[],
  gradesMap: StudentGradesMap,
  options?: { customFileName?: string; existingMainFolderId?: string; skipLocalDownload?: boolean }
) {
  const XLSX = await loadXlsxModule();
  const wb = XLSX.utils.book_new();

  // Construir columnas: N°, Apellido y Nombre, Email, [cada subcategoría], Promedio / Final
  const rows: any[] = [];

  students.forEach((s, idx) => {
    const studentGrades = gradesMap[s.id] || {};
    const rowObj: any = {
      'N°': idx + 1,
      'Apellido': sanitizeExcelText(s.lastName),
      'Nombre': sanitizeExcelText(s.firstName),
      'Email': sanitizeExcelText(s.email || '-'),
    };

    let totalScore = 0;
    let scoredCount = 0;

    categories.forEach((cat) => {
      cat.subcategories.forEach((sub) => {
        const val = studentGrades[sub.id];
        const colHeader = `${sanitizeExcelText(cat.name)} - ${sanitizeExcelText(sub.name)}`;
        rowObj[colHeader] = val !== undefined && val !== '' ? sanitizeExcelText(val) : '-';

        const num = parseFloat(String(val).replace(',', '.'));
        if (!isNaN(num)) {
          totalScore += num;
          scoredCount += 1;
        }
      });
    });

    const average = scoredCount > 0 ? (totalScore / scoredCount).toFixed(2) : '-';
    const finalVal = studentGrades['__final__'] || average;

    rowObj['Promedio Parcial'] = average;
    rowObj['Calificación Final'] = sanitizeExcelText(finalVal);

    rows.push(rowObj);
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Calcular anchos dinámicos
  const cols = [
    { wch: 6 },
    { wch: 20 },
    { wch: 20 },
    { wch: 28 },
  ];
  categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      cols.push({ wch: Math.max(16, `${cat.name} - ${sub.name}`.length + 2) });
    });
  });
  cols.push({ wch: 18 });
  cols.push({ wch: 20 });

  ws['!cols'] = cols;

  const tabTitle = termLabel.slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, tabTitle);

  const safeName = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const rawName =
    options?.customFileName?.trim() ||
    `Planilla_Calificaciones_${safeName}_${termLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
  const filename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;
  if (!options?.skipLocalDownload) {
    XLSX.writeFile(wb, filename);
  }

  try {
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return await driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Calificaciones',
        fileName: filename,
        content: buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        existingMainFolderId: options?.existingMainFolderId,
      })
      .catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * Exporta Asistencia y Disposición (1C, 2C y Resumen Anual) a un archivo Excel (.xlsx) nativo
 */
export async function exportCourseDispositionToExcel(
  courseName: string,
  students: Student[],
  map1c: Record<string, any>,
  map2c: Record<string, any>,
  options?: { customFileName?: string; existingMainFolderId?: string; skipLocalDownload?: boolean }
) {
  const XLSX = await loadXlsxModule();
  const wb = XLSX.utils.book_new();
  const termSettings = getTerminologySettings();
  const {
    attendanceLabel,
    dispositionLabel,
    initialDispositionScore,
  } = termSettings;
  const baseScore = initialDispositionScore ?? 10;
  const {
    term1FullLabel,
    term2FullLabel,
    term1ShortLabel,
    term2ShortLabel,
  } = getDerivedPeriodLabels(termSettings.periodNameSingular);

  // Hoja 1: 1° Cuatrimestre
  const rows1c = students.map((s, idx) => {
    const d = map1c[s.id] || {};
    const absences = d.totalAbsences ?? 0;
    const lates = d.totalLates ?? 0;
    const score = d.totalDisposition ?? baseScore;
    return {
      'N°': idx + 1,
      'Apellido': sanitizeExcelText(s.lastName),
      'Nombre': sanitizeExcelText(s.firstName),
      'Email': sanitizeExcelText(s.email || '-'),
      [`Ausencias ${term1ShortLabel}`]: absences,
      [`Llegadas Tarde ${term1ShortLabel}`]: lates,
      [`${dispositionLabel} ${term1ShortLabel} (Escala 10)`]: score,
      'Condición':
        score >= 8
          ? 'Excelente (>=8)'
          : score >= 6
          ? 'Regular (6-7)'
          : 'Requiere atención (<6)',
    };
  });
  const ws1 = XLSX.utils.json_to_sheet(rows1c);
  ws1['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 20 },
    { wch: 28 },
    { wch: 15 },
    { wch: 18 },
    { wch: 28 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, term1FullLabel.slice(0, 31));

  // Hoja 2: 2° Cuatrimestre
  const rows2c = students.map((s, idx) => {
    const d = map2c[s.id] || {};
    const absences = d.totalAbsences ?? 0;
    const lates = d.totalLates ?? 0;
    const score = d.totalDisposition ?? baseScore;
    return {
      'N°': idx + 1,
      'Apellido': sanitizeExcelText(s.lastName),
      'Nombre': sanitizeExcelText(s.firstName),
      'Email': sanitizeExcelText(s.email || '-'),
      [`Ausencias ${term2ShortLabel}`]: absences,
      [`Llegadas Tarde ${term2ShortLabel}`]: lates,
      [`${dispositionLabel} ${term2ShortLabel} (Escala 10)`]: score,
      'Condición':
        score >= 8
          ? 'Excelente (>=8)'
          : score >= 6
          ? 'Regular (6-7)'
          : 'Requiere atención (<6)',
    };
  });
  const ws2 = XLSX.utils.json_to_sheet(rows2c);
  ws2['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 20 },
    { wch: 28 },
    { wch: 15 },
    { wch: 18 },
    { wch: 28 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, term2FullLabel.slice(0, 31));

  // Hoja 3: Resumen Anual
  const rowsAnnual = students.map((s, idx) => {
    const d1 = map1c[s.id] || {};
    const d2 = map2c[s.id] || {};
    const absTotal = (d1.totalAbsences ?? 0) + (d2.totalAbsences ?? 0);
    const latesTotal = (d1.totalLates ?? 0) + (d2.totalLates ?? 0);
    const disp1 = d1.totalDisposition ?? baseScore;
    const disp2 = d2.totalDisposition ?? baseScore;
    const avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));
    return {
      'N°': idx + 1,
      'Apellido': sanitizeExcelText(s.lastName),
      'Nombre': sanitizeExcelText(s.firstName),
      'Email': sanitizeExcelText(s.email || '-'),
      'Total Ausencias Anual': absTotal,
      'Total Tardanzas Anual': latesTotal,
      [`${dispositionLabel} ${term1ShortLabel}`]: disp1,
      [`${dispositionLabel} ${term2ShortLabel}`]: disp2,
      [`Promedio ${dispositionLabel}`]: avgDisp,
    };
  });
  const wsAnnual = XLSX.utils.json_to_sheet(rowsAnnual);
  wsAnnual['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 20 },
    { wch: 28 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAnnual, 'Resumen Anual');

  const safeName = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const safeAtt = attendanceLabel.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const safeDisp = dispositionLabel.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const rawName =
    options?.customFileName?.trim() ||
    `${safeAtt}_${safeDisp}_${safeName}_${new Date().toISOString().slice(0, 10)}`;
  const filename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;
  if (!options?.skipLocalDownload) {
    XLSX.writeFile(wb, filename);
  }

  try {
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return await driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Asistencia',
        fileName: filename,
        content: buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        alsoShortcutInCategories: ['Disposición'],
        existingMainFolderId: options?.existingMainFolderId,
      })
      .catch(() => null);
  } catch (_) {
    return null;
  }
}

