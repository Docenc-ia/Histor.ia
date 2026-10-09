import * as XLSX from 'xlsx';
import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';

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

/**
 * Exporta el historial de calificaciones / importaciones a un archivo Excel (.xlsx)
 */
export function exportGradeHistoryToExcel(
  courseName: string,
  history: GradeHistoryEntry[]
) {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen del Historial
  const summaryRows = history.map((h, idx) => ({
    'N°': idx + 1,
    'Fecha': h.date,
    'Hora': h.time,
    'Cuatrimestre': h.termLabel,
    'Evaluación': h.evaluationName,
    'Categoría': h.categoryName,
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
    'Archivo Origen': h.sourceFile || 'Carga Directa',
    'Detalle': h.description,
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
        'Fecha': h.date,
        'Hora': h.time,
        'Evaluación': h.evaluationName,
        'Cuatrimestre': h.termLabel,
        'Alumno': c.studentName,
        'Email': c.studentEmail || '-',
        'Nota Anterior': c.previousScore || '(sin nota)',
        'Nota Asignada': c.newScore,
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
}

/**
 * Exporta el historial de asistencia y actividades del curso a un archivo Excel (.xlsx)
 */
export function exportCourseClassHistoryToExcel(
  courseName: string,
  historyItems: Array<{
    studentName: string;
    date: string;
    time: string;
    action: string;
    category: string;
    timestamp?: number;
  }>
) {
  const wb = XLSX.utils.book_new();

  const sorted = [...historyItems].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );

  const rows = sorted.map((item, idx) => ({
    'N°': idx + 1,
    'Alumno': item.studentName,
    'Fecha': item.date,
    'Hora': item.time,
    'Acción / Registro': item.action,
    'Categoría': item.category,
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
  const filename = `Historial_Asistencia_Conducta_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Exporta la matriz completa de calificaciones a un archivo Excel (.xlsx) con columnas organizadas
 */
export function exportGradebookMatrixToExcel(
  courseName: string,
  termLabel: string,
  students: Student[],
  categories: GradeCategory[],
  gradesMap: StudentGradesMap
) {
  const wb = XLSX.utils.book_new();

  // Construir columnas: N°, Apellido y Nombre, Email, [cada subcategoría], Promedio / Final
  const rows: any[] = [];

  students.forEach((s, idx) => {
    const studentGrades = gradesMap[s.id] || {};
    const rowObj: any = {
      'N°': idx + 1,
      'Apellido': s.lastName,
      'Nombre': s.firstName,
      'Email': s.email || '-',
    };

    let totalScore = 0;
    let scoredCount = 0;

    categories.forEach((cat) => {
      cat.subcategories.forEach((sub) => {
        const val = studentGrades[sub.id];
        const colHeader = `${cat.name} - ${sub.name}`;
        rowObj[colHeader] = val !== undefined && val !== '' ? val : '-';

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
    rowObj['Calificación Final'] = finalVal;

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
  const filename = `Planilla_Calificaciones_${safeName}_${termLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Exporta Asistencia y Disposición (1C, 2C y Resumen Anual) a un archivo Excel (.xlsx) nativo
 */
export function exportCourseDispositionToExcel(
  courseName: string,
  students: Student[],
  map1c: Record<string, any>,
  map2c: Record<string, any>
) {
  const wb = XLSX.utils.book_new();

  // Hoja 1: 1° Cuatrimestre
  const rows1c = students.map((s, idx) => {
    const d = map1c[s.id] || {};
    const absences = d.totalAbsences ?? 0;
    const lates = d.totalLates ?? 0;
    const score = d.totalDisposition ?? 10;
    return {
      'N°': idx + 1,
      'Apellido': s.lastName,
      'Nombre': s.firstName,
      'Email': s.email || '-',
      'Ausencias 1C': absences,
      'Llegadas Tarde 1C': lates,
      'Disposición 1C (Escala 10)': score,
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
    { wch: 25 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '1° Cuatrimestre');

  // Hoja 2: 2° Cuatrimestre
  const rows2c = students.map((s, idx) => {
    const d = map2c[s.id] || {};
    const absences = d.totalAbsences ?? 0;
    const lates = d.totalLates ?? 0;
    const score = d.totalDisposition ?? 10;
    return {
      'N°': idx + 1,
      'Apellido': s.lastName,
      'Nombre': s.firstName,
      'Email': s.email || '-',
      'Ausencias 2C': absences,
      'Llegadas Tarde 2C': lates,
      'Disposición 2C (Escala 10)': score,
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
    { wch: 25 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '2° Cuatrimestre');

  // Hoja 3: Resumen Anual
  const rowsAnnual = students.map((s, idx) => {
    const d1 = map1c[s.id] || {};
    const d2 = map2c[s.id] || {};
    const absTotal = (d1.totalAbsences ?? 0) + (d2.totalAbsences ?? 0);
    const latesTotal = (d1.totalLates ?? 0) + (d2.totalLates ?? 0);
    const disp1 = d1.totalDisposition ?? 10;
    const disp2 = d2.totalDisposition ?? 10;
    const avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));
    return {
      'N°': idx + 1,
      'Apellido': s.lastName,
      'Nombre': s.firstName,
      'Email': s.email || '-',
      'Total Ausencias Anual': absTotal,
      'Total Tardanzas Anual': latesTotal,
      'Disposición 1C': disp1,
      'Disposición 2C': disp2,
      'Promedio Disposición': avgDisp,
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
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAnnual, 'Resumen Anual');

  const safeName = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
  const filename = `Asistencia_Disposicion_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
