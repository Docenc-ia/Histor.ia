/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Funciones puras de cálculo y transformación para la Valoración Preliminar (TEA / TEP / TED).
 * Desacopladas del DOM, el portapapeles y el ciclo de vida de React para garantizar testabilidad determinista.
 */

import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import { sanitizeSpreadsheetFormulaCell } from './htmlEscape';

export type QualitativeTrajectory = 'TEA' | 'TEP' | 'TED' | '';

export interface EvaluativeAssessmentMeta {
  id: string;
  name: string;
  categoryName: string;
  maxScore: number;
}

export interface StudentValuationEntry {
  trajectory: QualitativeTrajectory;
  observation: string;
}

export interface PreliminaryStudentRow {
  student: Student;
  numericScores: number[];
  averageScore: number | null;
  averageScoreStr: string;
  trajectory: QualitativeTrajectory;
  observation: string;
}

export interface PreliminaryValuationStats {
  total: number;
  teaCount: number;
  tepCount: number;
  tedCount: number;
  pendingCount: number;
}

const DEFAULT_MAX_SCORE = 10;
const TEA_MINIMUM_AVERAGE_THRESHOLD = 7;
const ONE_DECIMAL_PRECISION = 1;
const MISSING_GRADES_DEFAULT_OBSERVATION = 'Sin notas registradas aún';

/**
 * Aplana la jerarquía de categorías y subcategorías de un cuatrimestre en una lista lineal
 * de instancias evaluativas seleccionables para la valoración preliminar.
 *
 * @param categories Categorías configuradas en la planilla del cuatrimestre.
 * @returns Lista plana de metadatos de evaluación.
 */
export function flattenEvaluativeItems(categories: GradeCategory[]): EvaluativeAssessmentMeta[] {
  const assessments: EvaluativeAssessmentMeta[] = [];
  categories.forEach((category) => {
    if (category.subcategories.length === 0) {
      assessments.push({
        id: category.id,
        name: category.name,
        categoryName: category.name,
        maxScore: DEFAULT_MAX_SCORE,
      });
    } else {
      category.subcategories.forEach((subcategory) => {
        assessments.push({
          id: subcategory.id,
          name: subcategory.name,
          categoryName: category.name,
          maxScore: subcategory.maxScore || DEFAULT_MAX_SCORE,
        });
      });
    }
  });
  return assessments;
}

/**
 * Resuelve los metadatos completos de las evaluaciones seleccionadas manteniendo el orden de selección.
 *
 * @param selectedAssessmentIds Identificadores de las evaluaciones marcadas por el docente.
 * @param availableAssessments Catálogo plano de evaluaciones disponibles en el cuatrimestre.
 * @returns Arreglo de objetos de metadatos correspondientes a cada ID seleccionado.
 */
export function resolveSelectedAssessmentsMeta(
  selectedAssessmentIds: string[],
  availableAssessments: EvaluativeAssessmentMeta[]
): EvaluativeAssessmentMeta[] {
  return selectedAssessmentIds.map((assessmentId) => {
    const matchedAssessment = availableAssessments.find((item) => item.id === assessmentId);
    return (
      matchedAssessment || {
        id: assessmentId,
        name: assessmentId,
        categoryName: '',
        maxScore: DEFAULT_MAX_SCORE,
      }
    );
  });
}

/**
 * Calcula de forma pura las filas de valoración preliminar para todos los estudiantes del curso,
 * incluyendo sus notas numéricas filtradas por las evaluaciones activas y su promedio parcial.
 *
 * @param students Nómina de estudiantes del curso.
 * @param gradesMap Mapa de calificaciones del cuatrimestre.
 * @param selectedAssessmentIds Evaluaciones incluidas en el corte preliminar.
 * @param valuations Diccionario de trayectorias (`TEA`/`TEP`/`TED`) y observaciones asignadas.
 * @returns Lista de filas calculadas por estudiante lista para renderizar o exportar.
 */
export function computePreliminaryStudentRows(
  students: Student[],
  gradesMap: StudentGradesMap,
  selectedAssessmentIds: string[],
  valuations: Record<string, StudentValuationEntry>
): PreliminaryStudentRow[] {
  return students.map((student) => {
    const studentGrades = gradesMap[student.id] || {};
    const numericScores: number[] = [];

    selectedAssessmentIds.forEach((assessmentId) => {
      const rawScore = studentGrades[assessmentId];
      if (rawScore !== undefined && rawScore !== null) {
        const normalizedScore = String(rawScore).trim().replace(',', '.');
        if (normalizedScore !== '' && !isNaN(Number(normalizedScore))) {
          numericScores.push(Number(normalizedScore));
        }
      }
    });

    let averageScore: number | null = null;
    let averageScoreStr = '';
    if (numericScores.length > 0) {
      averageScore =
        numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length;
      averageScoreStr = averageScore.toFixed(ONE_DECIMAL_PRECISION).replace('.0', '');
    }

    const existingValuation = valuations[student.id] || { trajectory: '', observation: '' };

    return {
      student,
      numericScores,
      averageScore,
      averageScoreStr,
      trajectory: existingValuation.trajectory,
      observation: existingValuation.observation,
    };
  });
}

/**
 * Genera de forma pura un nuevo mapa de valoraciones sugiriendo automáticamente `TEA` (promedio >= 7)
 * o `TEP` (promedio < 7 o sin calificaciones registradas), preservando observaciones previas del docente.
 *
 * @param studentRows Filas calculadas con el promedio preliminar de cada estudiante.
 * @param currentValuations Mapa actual de valoraciones cargadas.
 * @returns Nuevo mapa inmutable de valoraciones sugeridas por `studentId`.
 */
export function suggestAllPreliminaryValuations(
  studentRows: PreliminaryStudentRow[],
  currentValuations: Record<string, StudentValuationEntry>
): Record<string, StudentValuationEntry> {
  const suggestedValuations: Record<string, StudentValuationEntry> = { ...currentValuations };

  studentRows.forEach((row) => {
    const existingObservation = suggestedValuations[row.student.id]?.observation || '';
    if (row.averageScore !== null) {
      const suggestedTrajectory: QualitativeTrajectory =
        row.averageScore >= TEA_MINIMUM_AVERAGE_THRESHOLD ? 'TEA' : 'TEP';
      suggestedValuations[row.student.id] = {
        trajectory: suggestedTrajectory,
        observation: existingObservation,
      };
    } else {
      suggestedValuations[row.student.id] = {
        trajectory: 'TEP',
        observation: existingObservation || MISSING_GRADES_DEFAULT_OBSERVATION,
      };
    }
  });

  return suggestedValuations;
}

/**
 * Filtra las filas de valoración preliminar por apellido, nombre o sigla de trayectoria (`TEA`/`TEP`/`TED`).
 *
 * @param studentRows Filas calculadas de valoración preliminar.
 * @param searchFilter Texto de búsqueda ingresado por el usuario.
 * @returns Subconjunto de filas que coinciden con el criterio.
 */
export function filterPreliminaryStudentRows(
  studentRows: PreliminaryStudentRow[],
  searchFilter: string
): PreliminaryStudentRow[] {
  const normalizedQuery = searchFilter.trim().toLowerCase();
  if (!normalizedQuery) return studentRows;

  return studentRows.filter(
    (row) =>
      row.student.lastName.toLowerCase().includes(normalizedQuery) ||
      row.student.firstName.toLowerCase().includes(normalizedQuery) ||
      row.trajectory.toLowerCase().includes(normalizedQuery)
  );
}

/**
 * Contabiliza los totales por tipo de trayectoria (`TEA`, `TEP`, `TED` y pendientes sin asignar).
 *
 * @param totalStudents Cantidad total de estudiantes en el curso.
 * @param studentRows Filas de valoración preliminar de los estudiantes.
 * @returns Resumen estadístico de la valoración preliminar.
 */
export function computePreliminaryValuationStats(
  totalStudents: number,
  studentRows: PreliminaryStudentRow[]
): PreliminaryValuationStats {
  let teaCount = 0;
  let tepCount = 0;
  let tedCount = 0;
  let pendingCount = 0;

  studentRows.forEach((row) => {
    if (row.trajectory === 'TEA') teaCount++;
    else if (row.trajectory === 'TEP') tepCount++;
    else if (row.trajectory === 'TED') tedCount++;
    else pendingCount++;
  });

  return {
    total: totalStudents,
    teaCount,
    tepCount,
    tedCount,
    pendingCount,
  };
}

/**
 * Devuelve la denominación pedagógica oficial correspondiente a la sigla de trayectoria cualitativa.
 *
 * @param trajectory Sigla cualitativa (`'TEA'`, `'TEP'`, `'TED'` o `''`).
 * @returns Descripción pedagógica completa.
 */
export function getTrajectoryFullDescription(trajectory: QualitativeTrajectory): string {
  if (trajectory === 'TEA') return 'Trayecto Educativo en Alcanzado';
  if (trajectory === 'TEP') return 'Trayecto Educativo en Proceso';
  if (trajectory === 'TED') return 'Trayecto Educativo Discontinuo';
  return '';
}

/**
 * Construye una cadena TSV (valores separados por tabulaciones) lista para pegar directamente en Google Sheets.
 *
 * @param studentRows Filas calculadas de valoración preliminar.
 * @param selectedAssessmentsMeta Metadatos de las columnas evaluativas seleccionadas.
 * @param gradesMap Mapa de calificaciones del cuatrimestre.
 * @returns Contenido TSV completo.
 */
export function buildPreliminaryValuationTsv(
  studentRows: PreliminaryStudentRow[],
  selectedAssessmentsMeta: EvaluativeAssessmentMeta[],
  gradesMap: StudentGradesMap
): string {
  const headers = [
    'Apellido y Nombre',
    'Correo Institucional',
    ...selectedAssessmentsMeta.map((assessment) =>
      assessment.categoryName ? `${assessment.name} (${assessment.categoryName})` : assessment.name
    ),
    'Promedio Preliminar',
    'Valoración Cualitativa',
    'Descripción Trayecto',
    'Observación Pedagógica',
  ];

  const lines = [headers.join('\t')];

  studentRows.forEach((row) => {
    const studentGrades = gradesMap[row.student.id] || {};
    const scoreCols = selectedAssessmentsMeta.map(
      (assessment) => studentGrades[assessment.id] || ''
    );
    const trajectoryLabel = row.trajectory || 'Pendiente';
    const trajectoryDescription = getTrajectoryFullDescription(row.trajectory);

    const rowCols = [
      `${row.student.lastName}, ${row.student.firstName}`,
      row.student.email || '',
      ...scoreCols,
      row.averageScoreStr || '-',
      trajectoryLabel,
      trajectoryDescription,
      row.observation || '',
    ];

    lines.push(rowCols.join('\t'));
  });

  return lines.join('\n');
}

/**
 * Construye el contenido CSV (con BOM UTF-8 y sanitización contra inyección de fórmulas)
 * para exportar la Valoración Preliminar a Excel o Google Drive.
 *
 * @param studentRows Filas calculadas de valoración preliminar.
 * @param selectedAssessmentsMeta Metadatos de las columnas evaluativas seleccionadas.
 * @param gradesMap Mapa de calificaciones del cuatrimestre.
 * @returns Cadena CSV con BOM UTF-8 lista para descargar o subir a Drive.
 */
export function buildPreliminaryValuationCsv(
  studentRows: PreliminaryStudentRow[],
  selectedAssessmentsMeta: EvaluativeAssessmentMeta[],
  gradesMap: StudentGradesMap
): string {
  let csv = '\uFEFF';
  const headers = [
    'Apellido y Nombre',
    'Correo Institucional',
    ...selectedAssessmentsMeta.map((assessment) => {
      const label = assessment.categoryName
        ? `${assessment.name} - ${assessment.categoryName}`
        : assessment.name;
      return `"${sanitizeSpreadsheetFormulaCell(label).replace(/"/g, '""')}"`;
    }),
    '"Promedio Preliminar"',
    '"Valoración Cualitativa"',
    '"Descripción Trayecto"',
    '"Observación Pedagógica"',
  ];

  csv += headers.join(',') + '\r\n';

  studentRows.forEach((row) => {
    const studentGrades = gradesMap[row.student.id] || {};
    const scoreCols = selectedAssessmentsMeta.map(
      (assessment) =>
        `"${sanitizeSpreadsheetFormulaCell(studentGrades[assessment.id] || '').replace(/"/g, '""')}"`
    );
    const safeFullName = sanitizeSpreadsheetFormulaCell(
      `${row.student.lastName}, ${row.student.firstName}`
    ).replace(/"/g, '""');
    const name = `"${safeFullName}"`;
    const email = `"${sanitizeSpreadsheetFormulaCell(row.student.email || '').replace(/"/g, '""')}"`;
    const avg = `"${sanitizeSpreadsheetFormulaCell(row.averageScoreStr || '').replace(/"/g, '""')}"`;
    const traj = `"${sanitizeSpreadsheetFormulaCell(row.trajectory || 'Pendiente').replace(/"/g, '""')}"`;
    const trajDesc = getTrajectoryFullDescription(row.trajectory);
    const obs = `"${sanitizeSpreadsheetFormulaCell(row.observation || '').replace(/"/g, '""')}"`;

    const rowParts = [name, email, ...scoreCols, avg, traj, `"${trajDesc}"`, obs];
    csv += rowParts.join(',') + '\r\n';
  });

  return csv;
}
