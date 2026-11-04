import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import { getTerminologySettings, getDerivedPeriodLabels } from './terminologySettings';
import {
  CourseDriveCategory,
  driveService,
  formatCourseDriveFolderName,
} from '../services/workspace/driveService';

export type DriveSaveFormat = 'sheets' | 'gdoc' | 'xlsx' | 'csv' | 'html';

export interface SavedDriveFileResult {
  id?: string;
  name: string;
  url: string;
  folderUrl?: string;
  format: DriveSaveFormat;
  formatLabel: string;
  category: CourseDriveCategory;
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  const safe = /^[=+\-@\t\r]/.test(s) && isNaN(Number(s.replace(',', '.'))) ? ` ${s}` : s;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Generates a rich, editable HTML document for Asistencia y Disposición (1°C, 2°C, and Resumen Anual)
 * suitable both for native Google Docs (.gdoc) conversion and HTML/PDF printing.
 */
export function buildAttendanceDispositionHtml(params: {
  courseName: string;
  title?: string;
  students: Student[];
  map1c: Record<string, any>;
  map2c: Record<string, any>;
}): string {
  const { courseName, title, students, map1c, map2c } = params;
  const termSettings = getTerminologySettings();
  const { attendanceLabel, dispositionLabel, initialDispositionScore } = termSettings;
  const baseScore = initialDispositionScore ?? 10;
  const { term1FullLabel, term2FullLabel, term1ShortLabel, term2ShortLabel } =
    getDerivedPeriodLabels(termSettings.periodNameSingular);

  const docTitle =
    title?.trim() ||
    `${attendanceLabel} y ${dispositionLabel} - ${courseName} (${new Date().toLocaleDateString('es-AR')})`;

  const buildTermRows = (map: Record<string, any>) =>
    students
      .map((s, idx) => {
        const d = map[s.id] || {};
        const absences = d.totalAbsences ?? 0;
        const lates = d.totalLates ?? 0;
        const score = d.totalDisposition ?? baseScore;
        const cond =
          score >= 8
            ? 'Excelente (>=8)'
            : score >= 6
            ? 'Regular (6-7)'
            : 'Requiere atención (<6)';
        return `
          <tr>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:bold;">${escapeHtml(s.lastName)}, ${escapeHtml(s.firstName)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${absences}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${lates}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-weight:bold;">${score}/10</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(cond)}</td>
          </tr>`;
      })
      .join('');

  const annualRows = students
    .map((s, idx) => {
      const d1 = map1c[s.id] || {};
      const d2 = map2c[s.id] || {};
      const absTotal = (d1.totalAbsences ?? 0) + (d2.totalAbsences ?? 0);
      const latesTotal = (d1.totalLates ?? 0) + (d2.totalLates ?? 0);
      const disp1 = d1.totalDisposition ?? baseScore;
      const disp2 = d2.totalDisposition ?? baseScore;
      const avgDisp = ((disp1 + disp2) / 2).toFixed(1);
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:bold;">${escapeHtml(s.lastName)}, ${escapeHtml(s.firstName)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${absTotal}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${latesTotal}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${disp1}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${disp2}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-weight:bold;">${avgDisp}/10</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(docTitle)}</title>
</head>
<body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.45;padding:24px;">
  <h1 style="font-size:20px;margin-bottom:4px;color:#0f172a;">${escapeHtml(docTitle)}</h1>
  <p style="font-size:12px;color:#475569;margin-top:0;margin-bottom:18px;">
    Curso: <strong>${escapeHtml(courseName)}</strong> &bull; Carpeta Drive: <strong>${escapeHtml(formatCourseDriveFolderName(courseName))}</strong> &bull; Fecha de emisión: ${new Date().toLocaleString('es-AR')}
  </p>

  <h2 style="font-size:15px;color:#334155;margin-top:20px;margin-bottom:8px;">1. Resumen Anual (${escapeHtml(attendanceLabel)} y ${escapeHtml(dispositionLabel)})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;">
    <thead>
      <tr style="background-color:#f1f5f9;">
        <th style="border:1px solid #cbd5e1;padding:8px;">N°</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Alumno</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Ausencias Anual</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Tardanzas Anual</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">${escapeHtml(dispositionLabel)} ${escapeHtml(term1ShortLabel)}</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">${escapeHtml(dispositionLabel)} ${escapeHtml(term2ShortLabel)}</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Promedio ${escapeHtml(dispositionLabel)}</th>
      </tr>
    </thead>
    <tbody>
      ${annualRows}
    </tbody>
  </table>

  <h2 style="font-size:15px;color:#334155;margin-top:20px;margin-bottom:8px;">2. ${escapeHtml(term1FullLabel)}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;">
    <thead>
      <tr style="background-color:#f1f5f9;">
        <th style="border:1px solid #cbd5e1;padding:8px;">N°</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Alumno</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Ausencias</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Llegadas Tarde</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">${escapeHtml(dispositionLabel)}</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Condición</th>
      </tr>
    </thead>
    <tbody>
      ${buildTermRows(map1c)}
    </tbody>
  </table>

  <h2 style="font-size:15px;color:#334155;margin-top:20px;margin-bottom:8px;">3. ${escapeHtml(term2FullLabel)}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;">
    <thead>
      <tr style="background-color:#f1f5f9;">
        <th style="border:1px solid #cbd5e1;padding:8px;">N°</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Alumno</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Ausencias</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Llegadas Tarde</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">${escapeHtml(dispositionLabel)}</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Condición</th>
      </tr>
    </thead>
    <tbody>
      ${buildTermRows(map2c)}
    </tbody>
  </table>
</body>
</html>`;
}

export function buildAttendanceDispositionCsv(params: {
  students: Student[];
  map1c: Record<string, any>;
  map2c: Record<string, any>;
}): string {
  const { students, map1c, map2c } = params;
  const termSettings = getTerminologySettings();
  const { dispositionLabel, initialDispositionScore } = termSettings;
  const baseScore = initialDispositionScore ?? 10;
  const { term1ShortLabel, term2ShortLabel } = getDerivedPeriodLabels(
    termSettings.periodNameSingular
  );

  const headers = [
    'N°',
    'Apellido',
    'Nombre',
    'Email',
    `Ausencias ${term1ShortLabel}`,
    `Tardanzas ${term1ShortLabel}`,
    `${dispositionLabel} ${term1ShortLabel}`,
    `Ausencias ${term2ShortLabel}`,
    `Tardanzas ${term2ShortLabel}`,
    `${dispositionLabel} ${term2ShortLabel}`,
    'Total Ausencias Anual',
    'Total Tardanzas Anual',
    `Promedio ${dispositionLabel}`,
  ];

  const rows = students.map((s, idx) => {
    const d1 = map1c[s.id] || {};
    const d2 = map2c[s.id] || {};
    const abs1 = d1.totalAbsences ?? 0;
    const lat1 = d1.totalLates ?? 0;
    const disp1 = d1.totalDisposition ?? baseScore;
    const abs2 = d2.totalAbsences ?? 0;
    const lat2 = d2.totalLates ?? 0;
    const disp2 = d2.totalDisposition ?? baseScore;
    const avg = ((disp1 + disp2) / 2).toFixed(1);
    return [
      idx + 1,
      s.lastName,
      s.firstName,
      s.email || '-',
      abs1,
      lat1,
      disp1,
      abs2,
      lat2,
      disp2,
      abs1 + abs2,
      lat1 + lat2,
      avg,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}

/**
 * Generates a rich HTML document for Historial de Incidencias y Asistencia
 */
export function buildCourseHistoryHtml(params: {
  courseName: string;
  title?: string;
  historyItems: Array<{
    studentName: string;
    date: string;
    time: string;
    action: string;
    category: string;
    timestamp?: number;
  }>;
}): string {
  const { courseName, title, historyItems } = params;
  const sorted = [...historyItems].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const docTitle =
    title?.trim() ||
    `Historial de Incidencias y Asistencia - ${courseName} (${new Date().toLocaleDateString('es-AR')})`;

  const rowsHtml =
    sorted.length > 0
      ? sorted
          .map(
            (item, idx) => `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:bold;">${escapeHtml(item.studentName)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${escapeHtml(item.date)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${escapeHtml(item.time)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(item.action)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(item.category)}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="6" style="border:1px solid #cbd5e1;padding:12px;text-align:center;color:#64748b;">Sin registros en el historial para los filtros actuales.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(docTitle)}</title>
</head>
<body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.45;padding:24px;">
  <h1 style="font-size:20px;margin-bottom:4px;color:#0f172a;">${escapeHtml(docTitle)}</h1>
  <p style="font-size:12px;color:#475569;margin-top:0;margin-bottom:18px;">
    Curso: <strong>${escapeHtml(courseName)}</strong> &bull; Subcarpeta Drive: <strong>Historial de Incidencias</strong> &bull; Total de registros: <strong>${sorted.length}</strong> &bull; Emitido: ${new Date().toLocaleString('es-AR')}
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="background-color:#f1f5f9;">
        <th style="border:1px solid #cbd5e1;padding:8px;">N°</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Alumno</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Fecha</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Hora</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Acción / Registro</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Categoría</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}

export function buildCourseHistoryCsv(
  historyItems: Array<{
    studentName: string;
    date: string;
    time: string;
    action: string;
    category: string;
    timestamp?: number;
  }>
): string {
  const sorted = [...historyItems].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const headers = ['N°', 'Alumno', 'Fecha', 'Hora', 'Acción / Registro', 'Categoría'];
  const rows = sorted.map((item, idx) =>
    [idx + 1, item.studentName, item.date, item.time, item.action, item.category]
      .map(escapeCsvCell)
      .join(',')
  );
  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}

/**
 * Generates a rich HTML document for the Gradebook Matrix (Calificaciones)
 */
export function buildGradebookHtml(params: {
  courseName: string;
  termLabel: string;
  title?: string;
  students: Student[];
  categories: GradeCategory[];
  gradesMap: StudentGradesMap;
}): string {
  const { courseName, termLabel, title, students, categories, gradesMap } = params;
  const docTitle =
    title?.trim() ||
    `Planilla de Calificaciones (${termLabel}) - ${courseName} (${new Date().toLocaleDateString('es-AR')})`;

  const subColumns: Array<{ id: string; label: string }> = [];
  categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      subColumns.push({ id: sub.id, label: `${cat.name}: ${sub.name}` });
    });
  });

  const headerColsHtml = subColumns
    .map(
      (col) =>
        `<th style="border:1px solid #cbd5e1;padding:6px 8px;font-size:11px;">${escapeHtml(col.label)}</th>`
    )
    .join('');

  const rowsHtml = students
    .map((s, idx) => {
      const studentGrades = gradesMap[s.id] || {};
      let totalScore = 0;
      let scoredCount = 0;

      const cellsHtml = subColumns
        .map((col) => {
          const val = studentGrades[col.id];
          const num = parseFloat(String(val).replace(',', '.'));
          if (!isNaN(num)) {
            totalScore += num;
            scoredCount += 1;
          }
          return `<td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${
            val !== undefined && val !== '' ? escapeHtml(val) : '-'
          }</td>`;
        })
        .join('');

      const average = scoredCount > 0 ? (totalScore / scoredCount).toFixed(2) : '-';
      const finalVal = studentGrades['__final__'] || average;

      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:bold;">${escapeHtml(s.lastName)}, ${escapeHtml(s.firstName)}</td>
          ${cellsHtml}
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${escapeHtml(average)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-weight:bold;background-color:#f8fafc;">${escapeHtml(finalVal)}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(docTitle)}</title>
</head>
<body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.45;padding:24px;">
  <h1 style="font-size:20px;margin-bottom:4px;color:#0f172a;">${escapeHtml(docTitle)}</h1>
  <p style="font-size:12px;color:#475569;margin-top:0;margin-bottom:18px;">
    Curso: <strong>${escapeHtml(courseName)}</strong> &bull; Período: <strong>${escapeHtml(termLabel)}</strong> &bull; Subcarpeta Drive: <strong>Calificaciones</strong> &bull; Emitido: ${new Date().toLocaleString('es-AR')}
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="background-color:#f1f5f9;">
        <th style="border:1px solid #cbd5e1;padding:8px;">N°</th>
        <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Alumno</th>
        ${headerColsHtml}
        <th style="border:1px solid #cbd5e1;padding:8px;">Promedio</th>
        <th style="border:1px solid #cbd5e1;padding:8px;">Calificación Final</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}

export function buildGradebookCsv(params: {
  students: Student[];
  categories: GradeCategory[];
  gradesMap: StudentGradesMap;
}): string {
  const { students, categories, gradesMap } = params;
  const subColumns: Array<{ id: string; label: string }> = [];
  categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      subColumns.push({ id: sub.id, label: `${cat.name} - ${sub.name}` });
    });
  });

  const headers = [
    'N°',
    'Apellido',
    'Nombre',
    'Email',
    ...subColumns.map((c) => c.label),
    'Promedio Parcial',
    'Calificación Final',
  ];

  const rows = students.map((s, idx) => {
    const studentGrades = gradesMap[s.id] || {};
    let totalScore = 0;
    let scoredCount = 0;
    const subVals = subColumns.map((col) => {
      const val = studentGrades[col.id];
      const num = parseFloat(String(val).replace(',', '.'));
      if (!isNaN(num)) {
        totalScore += num;
        scoredCount += 1;
      }
      return val !== undefined && val !== '' ? val : '-';
    });
    const average = scoredCount > 0 ? (totalScore / scoredCount).toFixed(2) : '-';
    const finalVal = studentGrades['__final__'] || average;
    return [idx + 1, s.lastName, s.firstName, s.email || '-', ...subVals, average, finalVal]
      .map(escapeCsvCell)
      .join(',');
  });

  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}
