/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import { sanitizeSpreadsheetFormulaCell } from './htmlEscape';

const MANUAL_FINAL_GRADE_KEY = '__final__';
const FINAL_AVERAGE_OVERRIDE_KEY = '__final_avg_override__';
const DEFAULT_DISPOSITION_LABEL = 'Disposición';
const MIN_CUSTOM_LABEL_MATCH_LENGTH = 3;
const ONE_DECIMAL_PRECISION = 1;
const PASSING_EXCELLENT_SCORE_THRESHOLD = 7;
const PASSING_REGULAR_SCORE_THRESHOLD = 6;

export type AnnualConditionTone = 'approved' | 'regular' | 'compensation' | 'pending';

export interface StudentAnnualSummaryRow {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  calcAvgStr: string;
  calcAvgNum: number | null;
  finalVal: string;
  finalNum: number | null;
  hasOverride: boolean;
  condition: string;
  conditionTone: AnnualConditionTone;
}

export interface AnnualCourseKpis {
  total: number;
  with1cCount: number;
  with2cCount: number;
  avg1c: string;
  avg2c: string;
  avgFinal: string;
  approvedCount: number;
  approvedPercent: number;
}

export const CATEGORY_COLORS = [
  {
    name: 'Azul',
    border: 'border-blue-500',
    headerBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
    badge: 'bg-blue-500',
  },
  {
    name: 'Esmeralda',
    border: 'border-emerald-500',
    headerBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40',
    badge: 'bg-emerald-500',
  },
  {
    name: 'Púrpura',
    border: 'border-purple-500',
    headerBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
    badge: 'bg-purple-500',
  },
  {
    name: 'Ámbar',
    border: 'border-amber-500',
    headerBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40',
    badge: 'bg-amber-500',
  },
  {
    name: 'Índigo',
    border: 'border-indigo-500',
    headerBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40',
    badge: 'bg-indigo-500',
  },
  {
    name: 'Rosa',
    border: 'border-rose-500',
    headerBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:bg-rose-950/40',
    badge: 'bg-rose-500',
  },
];

/**
 * Calcula el promedio aritmético de todas las calificaciones registradas para un estudiante en el cuatrimestre.
 *
 * @param termCategories Categorías y subcategorías configuradas en el cuatrimestre.
 * @param termGrades Mapa de notas de los estudiantes en el cuatrimestre.
 * @param studentId Identificador del estudiante a evaluar.
 * @returns El promedio formateado (`scoreStr`) y su valor numérico exacto (`num`), o `{ scoreStr: '', num: null }` si no registra notas.
 */
export function calculateCategoryAverageForStudent(
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  studentId: string
): { scoreStr: string; num: number | null } {
  const studentGradeRecord = termGrades[studentId] || {};
  const numericScores: number[] = [];

  termCategories.forEach((category) => {
    if (category.subcategories.length === 0) {
      // Cuando una categoría no tiene subcategorías hijas, la calificación se almacena indexada directamente bajo el ID de la categoría.
      const directCategoryScore = studentGradeRecord[category.id];
      if (
        directCategoryScore !== undefined &&
        directCategoryScore !== '' &&
        !isNaN(Number(directCategoryScore))
      ) {
        numericScores.push(Number(directCategoryScore));
      }
    } else {
      category.subcategories.forEach((subcategory) => {
        const subcategoryScore = studentGradeRecord[subcategory.id];
        if (
          subcategoryScore !== undefined &&
          subcategoryScore !== '' &&
          !isNaN(Number(subcategoryScore))
        ) {
          numericScores.push(Number(subcategoryScore));
        }
      });
    }
  });

  if (numericScores.length === 0) return { scoreStr: '', num: null };
  const averageValue =
    numericScores.reduce((accumulator, currentScore) => accumulator + currentScore, 0) /
    numericScores.length;
  return {
    scoreStr: averageValue.toFixed(ONE_DECIMAL_PRECISION).replace('.0', ''),
    num: averageValue,
  };
}

/**
 * Determina la calificación final del cuatrimestre para un estudiante según el modo de cierre configurado
 * (`'average_of_categories'` o `'manual_final'`), respetando las sobrescrituras manuales puntuales del docente.
 *
 * @param termCategories Categorías de evaluación del cuatrimestre.
 * @param termGrades Mapa de calificaciones del cuatrimestre.
 * @param termCalculationMode Criterio de cálculo de nota final para el cuatrimestre.
 * @param studentId Identificador del estudiante.
 * @returns La calificación final en formato texto (`scoreStr`) y número (`num`).
 */
export function calculateFinalScoreForStudent(
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalculationMode: 'average_of_categories' | 'manual_final',
  studentId: string
): { scoreStr: string; num: number | null } {
  const studentGradeRecord = termGrades[studentId] || {};
  if (termCalculationMode === 'manual_final') {
    const manualFinalString = studentGradeRecord[MANUAL_FINAL_GRADE_KEY] || '';
    const manualFinalNumber =
      manualFinalString !== '' && !isNaN(Number(manualFinalString))
        ? Number(manualFinalString)
        : null;
    return { scoreStr: manualFinalString, num: manualFinalNumber };
  }

  // En modo promedio automático, se prioriza `__final_avg_override__` si el docente redondeó o ajustó manualmente la nota conceptual de ese alumno en particular.
  const averageOverrideString =
    studentGradeRecord[FINAL_AVERAGE_OVERRIDE_KEY] !== undefined
      ? String(studentGradeRecord[FINAL_AVERAGE_OVERRIDE_KEY]).trim()
      : '';
  if (averageOverrideString !== '') {
    const overrideNumber = !isNaN(Number(averageOverrideString))
      ? Number(averageOverrideString)
      : null;
    return { scoreStr: averageOverrideString, num: overrideNumber };
  }

  return calculateCategoryAverageForStudent(termCategories, termGrades, studentId);
}

/**
 * Localiza el identificador de la columna (subcategoría o categoría directa) que representa la nota de Disposición/Concepto,
 * permitiendo sincronizar automáticamente los descuentos por incidencias o faltas con la planilla de calificaciones.
 *
 * @param categories Categorías activas del cuatrimestre.
 * @param customDispositionLabel Etiqueta personalizada opcional configurada por el docente para la columna de disposición.
 * @returns El ID de la subcategoría o categoría encontrada, o `null` si el curso no posee una columna de disposición.
 */
export function findDispositionColumnKey(
  categories: GradeCategory[],
  customDispositionLabel?: string
): string | null {
  const normalizedTargetLabel = (customDispositionLabel || DEFAULT_DISPOSITION_LABEL)
    .trim()
    .toLowerCase();
  const matchesDispositionKeyword = (candidateName: string) => {
    const normalizedCandidate = (candidateName || '').trim().toLowerCase();
    return (
      normalizedCandidate === normalizedTargetLabel ||
      normalizedCandidate.includes('disposición') ||
      normalizedCandidate.includes('disposicion') ||
      normalizedCandidate.includes('conducta') ||
      normalizedCandidate.includes('concepto') ||
      (normalizedTargetLabel.length >= MIN_CUSTOM_LABEL_MATCH_LENGTH &&
        normalizedCandidate.includes(normalizedTargetLabel))
    );
  };

  for (const category of categories) {
    const matchingSubcategory = category.subcategories.find((subcategory) =>
      matchesDispositionKeyword(subcategory.name)
    );
    if (matchingSubcategory) {
      return matchingSubcategory.id;
    }
  }

  const matchingCategory = categories.find((category) => matchesDispositionKeyword(category.name));
  if (matchingCategory) {
    if (matchingCategory.subcategories.length === 0) {
      return matchingCategory.id;
    }
    if (matchingCategory.subcategories.length === 1) {
      return matchingCategory.subcategories[0].id;
    }
  }

  return null;
}

/**
 * Calcula en lote el mapa de calificaciones finales de todos los estudiantes de un curso para un cuatrimestre.
 *
 * @param students Lista de estudiantes del curso.
 * @param termCategories Categorías del cuatrimestre.
 * @param termGrades Mapa de calificaciones del cuatrimestre.
 * @param termCalculationMode Modo de cálculo final (`'average_of_categories'` o `'manual_final'`).
 * @returns Diccionario indexado por `studentId` con la nota final formateada y numérica.
 */
export function computeTermScoresMap(
  students: Student[],
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalculationMode: 'average_of_categories' | 'manual_final'
): Record<string, { scoreStr: string; num: number | null }> {
  const finalScoresByStudentId: Record<string, { scoreStr: string; num: number | null }> = {};
  students.forEach((student) => {
    finalScoresByStudentId[student.id] = calculateFinalScoreForStudent(
      termCategories,
      termGrades,
      termCalculationMode,
      student.id
    );
  });
  return finalScoresByStudentId;
}

/**
 * Devuelve las clases utilitarias de color de Tailwind CSS según el tramo pedagógico de la nota
 * (`>= 7` aprobado/TEA en verde, `>= 6` regular/en proceso en ámbar, `< 6` desaprobado/TED en rojo).
 *
 * @param scoreValueString Cadena con la nota numérica a colorear.
 * @param isDarkMode Indicador de tema oscuro activo para el texto neutro cuando la celda no es numérica.
 * @returns Clases de Tailwind CSS correspondientes al color de la calificación.
 */
export function getScoreColorClass(scoreValueString: string, isDarkMode: boolean): string {
  if (!scoreValueString || isNaN(Number(scoreValueString))) {
    return isDarkMode ? 'text-slate-200' : 'text-neutral-800';
  }
  const numericScore = Number(scoreValueString);
  if (numericScore >= PASSING_EXCELLENT_SCORE_THRESHOLD) {
    return 'text-emerald-600 dark:text-emerald-400 font-bold';
  }
  if (numericScore >= PASSING_REGULAR_SCORE_THRESHOLD) {
    return 'text-amber-600 dark:text-amber-400 font-semibold';
  }
  return 'text-red-600 dark:text-red-400 font-bold';
}

/**
 * Calcula de forma pura la consolidación anual de calificaciones por estudiante (1°C, 2°C, promedio sugerido,
 * calificación definitiva con prioridad de sobrescritura manual y condición pedagógica resultante),
 * completamente desacoplada del tema visual (`isDarkMode`) y del DOM.
 *
 * @param students Lista de estudiantes del curso.
 * @param score1cMap Mapa de calificaciones finales del 1° cuatrimestre.
 * @param score2cMap Mapa de calificaciones finales del 2° cuatrimestre.
 * @param annualOverrides Mapa de notas definitivas ajustadas manualmente por el docente.
 * @returns Arreglo de filas anuales consolidadas por estudiante.
 */
export function computeStudentAnnualSummaryRows(
  students: Student[],
  score1cMap: Record<string, { scoreStr: string; num: number | null }>,
  score2cMap: Record<string, { scoreStr: string; num: number | null }>,
  annualOverrides: Record<string, string>
): StudentAnnualSummaryRow[] {
  return students.map((student) => {
    const term1Score = score1cMap[student.id] || { scoreStr: '', num: null };
    const term2Score = score2cMap[student.id] || { scoreStr: '', num: null };
    const manualOverride = annualOverrides[student.id];

    let calcAvgStr = '';
    let calcAvgNum: number | null = null;

    if (term1Score.num !== null && term2Score.num !== null) {
      calcAvgNum = (term1Score.num + term2Score.num) / 2;
      calcAvgStr = calcAvgNum.toFixed(ONE_DECIMAL_PRECISION).replace('.0', '');
    } else if (term1Score.num !== null) {
      calcAvgNum = term1Score.num;
      calcAvgStr = term1Score.scoreStr;
    } else if (term2Score.num !== null) {
      calcAvgNum = term2Score.num;
      calcAvgStr = term2Score.scoreStr;
    }

    const hasOverride = manualOverride !== undefined && manualOverride !== '';
    const finalVal = hasOverride ? manualOverride : calcAvgStr;
    const finalNum =
      finalVal !== '' && !isNaN(Number(finalVal)) ? Number(finalVal) : null;

    let condition = 'Pendiente';
    let conditionTone: AnnualConditionTone = 'pending';

    if (finalNum !== null) {
      if (finalNum >= PASSING_EXCELLENT_SCORE_THRESHOLD) {
        condition = 'Aprobado';
        conditionTone = 'approved';
      } else if (finalNum >= PASSING_REGULAR_SCORE_THRESHOLD) {
        condition = 'Aprobado (Regular)';
        conditionTone = 'regular';
      } else {
        condition = 'Compensación Diciembre / Feb';
        conditionTone = 'compensation';
      }
    }

    return {
      student,
      score1c: term1Score.scoreStr,
      score1cNum: term1Score.num,
      score2c: term2Score.scoreStr,
      score2cNum: term2Score.num,
      calcAvgStr,
      calcAvgNum,
      finalVal,
      finalNum,
      hasOverride,
      condition,
      conditionTone,
    };
  });
}

/**
 * Traduce el tono semántico de condición anual (`AnnualConditionTone`) a sus clases de insignia en Tailwind CSS.
 *
 * @param conditionTone Tono pedagógico calculado para el estudiante.
 * @param isDarkMode Indicador de modo oscuro activo.
 * @returns Clases CSS para la insignia de condición anual.
 */
export function getAnnualConditionBadgeClass(
  conditionTone: AnnualConditionTone,
  isDarkMode: boolean
): string {
  if (conditionTone === 'approved') {
    return isDarkMode
      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (conditionTone === 'regular') {
    return isDarkMode
      ? 'bg-amber-950/60 text-amber-300 border-amber-800/80'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (conditionTone === 'compensation') {
    return isDarkMode
      ? 'bg-rose-950/60 text-rose-300 border-rose-800/80'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  }
  return isDarkMode
    ? 'bg-slate-800 text-slate-400 border-slate-700'
    : 'bg-neutral-100 text-neutral-500 border-neutral-200';
}

/**
 * Calcula los indicadores clave de rendimiento (KPIs) anuales del curso a partir de las filas consolidadas.
 *
 * @param totalStudents Cantidad total de estudiantes en el curso.
 * @param studentAnnualRows Filas anuales calculadas por `computeStudentAnnualSummaryRows`.
 * @returns Objeto con promedios por cuatrimestre, promedio final y tasa de aprobación.
 */
export function computeAnnualCourseKpis(
  totalStudents: number,
  studentAnnualRows: StudentAnnualSummaryRow[]
): AnnualCourseKpis {
  const with1c = studentAnnualRows.filter((row) => row.score1cNum !== null);
  const with2c = studentAnnualRows.filter((row) => row.score2cNum !== null);
  const withFinal = studentAnnualRows.filter((row) => row.finalNum !== null);
  const approved = studentAnnualRows.filter(
    (row) => row.finalNum !== null && row.finalNum >= PASSING_EXCELLENT_SCORE_THRESHOLD
  );

  const avg1c =
    with1c.length > 0
      ? (
          with1c.reduce((sum, row) => sum + (row.score1cNum || 0), 0) / with1c.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  const avg2c =
    with2c.length > 0
      ? (
          with2c.reduce((sum, row) => sum + (row.score2cNum || 0), 0) / with2c.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  const avgFinal =
    withFinal.length > 0
      ? (
          withFinal.reduce((sum, row) => sum + (row.finalNum || 0), 0) / withFinal.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  return {
    total: totalStudents,
    with1cCount: with1c.length,
    with2cCount: with2c.length,
    avg1c,
    avg2c,
    avgFinal,
    approvedCount: approved.length,
    approvedPercent:
      totalStudents > 0 ? Math.round((approved.length / totalStudents) * 100) : 0,
  };
}

/**
 * Filtra de manera pura las filas del resumen anual según texto de búsqueda (apellido, nombre o correo).
 *
 * @param studentAnnualRows Filas anuales calculadas.
 * @param searchQuery Consulta de búsqueda ingresada por el docente.
 * @returns Filas que coinciden con el filtro.
 */
export function filterAnnualSummaryRows(
  studentAnnualRows: StudentAnnualSummaryRow[],
  searchQuery: string
): StudentAnnualSummaryRow[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return studentAnnualRows;

  return studentAnnualRows.filter(
    (row) =>
      row.student.lastName.toLowerCase().includes(normalizedQuery) ||
      row.student.firstName.toLowerCase().includes(normalizedQuery) ||
      (row.student.email && row.student.email.toLowerCase().includes(normalizedQuery))
  );
}

/**
 * Genera de forma pura el contenido CSV del cierre anual de calificaciones, aplicando sanitización
 * preventiva contra inyección de fórmulas en hojas de cálculo.
 *
 * @param studentAnnualRows Filas anuales consolidadas del curso.
 * @returns Cadena CSV sin prefijo `data:` lista para codificar o almacenar en Google Drive.
 */
export function buildAnnualSummaryCsvContent(
  studentAnnualRows: StudentAnnualSummaryRow[]
): string {
  let csv =
    'Apellido y Nombre,1° Cuatrimestre,2° Cuatrimestre,Promedio Anual Sugerido,Calificación Final Definitiva,Condición\r\n';

  studentAnnualRows.forEach((row) => {
    const safeFullName = sanitizeSpreadsheetFormulaCell(
      `${row.student.lastName}, ${row.student.firstName}`
    ).replace(/"/g, '""');
    const name = `"${safeFullName}"`;
    const s1 = `"${sanitizeSpreadsheetFormulaCell(row.score1c || '').replace(/"/g, '""')}"`;
    const s2 = `"${sanitizeSpreadsheetFormulaCell(row.score2c || '').replace(/"/g, '""')}"`;
    const avg = `"${sanitizeSpreadsheetFormulaCell(row.calcAvgStr || '').replace(/"/g, '""')}"`;
    const fin = `"${sanitizeSpreadsheetFormulaCell(row.finalVal || '').replace(/"/g, '""')}"`;
    const cond = `"${sanitizeSpreadsheetFormulaCell(row.condition).replace(/"/g, '""')}"`;
    csv += [name, s1, s2, avg, fin, cond].join(',') + '\r\n';
  });

  return csv;
}

/**
 * Reordena de forma pura e inmutable la lista de Categorías Mayores (y sus respectivas subcolumnas)
 * moviendo la categoría desde `fromIndex` hacia `toIndex`.
 */
export function reorderCategoriesList(
  categories: GradeCategory[],
  fromIndex: number,
  toIndex: number
): GradeCategory[] {
  if (
    !Array.isArray(categories) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= categories.length ||
    toIndex >= categories.length ||
    fromIndex === toIndex
  ) {
    return categories;
  }
  const nextCategories = [...categories];
  const [movedCategory] = nextCategories.splice(fromIndex, 1);
  nextCategories.splice(toIndex, 0, movedCategory);
  return nextCategories;
}

/**
 * Reordena de forma pura e inmutable las subcolumnas (evaluaciones) dentro de una Categoría Mayor
 * moviendo la subcolumna desde `fromIndex` hacia `toIndex`.
 */
export function reorderSubcategoriesInCategory(
  categories: GradeCategory[],
  categoryId: string,
  fromIndex: number,
  toIndex: number
): GradeCategory[] {
  if (!Array.isArray(categories) || !categoryId) return categories;
  return categories.map((category) => {
    if (category.id !== categoryId) return category;
    const subList = Array.isArray(category.subcategories) ? [...category.subcategories] : [];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= subList.length ||
      toIndex >= subList.length ||
      fromIndex === toIndex
    ) {
      return category;
    }
    const [movedSub] = subList.splice(fromIndex, 1);
    subList.splice(toIndex, 0, movedSub);
    return {
      ...category,
      subcategories: subList,
    };
  });
}

/**
 * Mueve de forma pura e inmutable una subcolumna (evaluación) de una categoría a otra
 * (o a una posición específica dentro de la categoría destino) conservando intacto su `id`
 * para que todas las notas cargadas de los alumnos se mantengan vinculadas automáticamente.
 */
export function moveSubcategoryAcrossCategories(
  categories: GradeCategory[],
  sourceCategoryId: string,
  subcategoryId: string,
  targetCategoryId: string,
  targetIndex?: number
): GradeCategory[] {
  if (!Array.isArray(categories) || !sourceCategoryId || !subcategoryId || !targetCategoryId) {
    return categories;
  }

  const sourceCategory = categories.find((cat) => cat.id === sourceCategoryId);
  if (!sourceCategory) return categories;
  const sourceIndex = sourceCategory.subcategories.findIndex((sub) => sub.id === subcategoryId);
  if (sourceIndex === -1) return categories;

  if (sourceCategoryId === targetCategoryId) {
    if (targetIndex === undefined || targetIndex === sourceIndex) return categories;
    return reorderSubcategoriesInCategory(categories, sourceCategoryId, sourceIndex, targetIndex);
  }

  const movedSubcategory = sourceCategory.subcategories[sourceIndex];
  return categories.map((cat) => {
    if (cat.id === sourceCategoryId) {
      return {
        ...cat,
        subcategories: cat.subcategories.filter((sub) => sub.id !== subcategoryId),
      };
    }
    if (cat.id === targetCategoryId) {
      const nextSubs = [...cat.subcategories];
      const insertAt =
        targetIndex !== undefined && targetIndex >= 0 && targetIndex <= nextSubs.length
          ? targetIndex
          : nextSubs.length;
      nextSubs.splice(insertAt, 0, movedSubcategory);
      return {
        ...cat,
        subcategories: nextSubs,
      };
    }
    return cat;
  });
}

