import { GradeCategory, StudentGradesMap } from '../types/grades';
import {
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
  MultiImportApplyPayload,
} from '../types/gradeImport';
import { GradeHistoryEntry } from './excelExport';
import { normalizeImportText, parseFlexibleCellNumber } from './gradeImportParser';

const DEFAULT_CATEGORY_NAME = 'Calificaciones';
const DEFAULT_CATEGORY_WEIGHT = 100;
const NEW_CUSTOM_CATEGORY_WEIGHT = 0;
const STANDARD_MAX_SCORE = 10;
const MIN_DISPOSITION_SCORE = 1;
const MAX_DISPOSITION_SCORE = 10;
const MIN_ATTENDANCE_COUNT = 0;
const TWO_DECIMAL_PRECISION = 2;

const ARGENTINA_LOCALE = 'es-AR';
const FIRST_TERM_CODE = '1c';
const FIRST_TERM_LABEL = '1° Cuatrimestre';
const SECOND_TERM_LABEL = '2° Cuatrimestre';
const SOURCE_LABEL_EXCEL = 'Excel';
const SOURCE_LABEL_SHEETS = 'Google Sheets';

export interface GradeImportCommitResult {
  multiPayload: MultiImportApplyPayload;
  legacySingleGradePayload?: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>;
    historyEntry: GradeHistoryEntry;
  };
}

/**
 * Transforma las filas de alumnos verificadas y la configuración de columnas mapeadas
 * en el payload transaccional (`MultiImportApplyPayload`) para actualizar calificaciones,
 * inasistencias, disposición, nuevos alumnos e historial de auditoría.
 *
 * @param params Datos de contexto del curso, cuatrimestre, mapa de notas actual, filas verificadas y columnas incluidas.
 * @returns Estructura con el payload multicolumna y el payload de compatibilidad simple, o `null` si no hay datos aplicables.
 */
export function buildGradeImportCommitPayload(params: {
  courseId: string;
  selectedTerm: '1c' | '2c';
  sourceType: 'file' | 'csv' | 'sheets' | 'paste';
  fileName: string;
  activeCategories: GradeCategory[];
  activeGradesMap: StudentGradesMap;
  verifiedRows: MultiVerifiedStudentRow[];
  includedColumns: DetectedColumnConfig[];
  includeNewStudentsFromDoc: boolean;
}): GradeImportCommitResult | null {
  if (!params || !Array.isArray(params.verifiedRows) || !Array.isArray(params.includedColumns)) {
    return null;
  }

  const {
    courseId,
    selectedTerm,
    sourceType,
    fileName = '',
    activeCategories,
    activeGradesMap,
    verifiedRows,
    includedColumns,
    includeNewStudentsFromDoc,
  } = params;

  const activeRows = verifiedRows.filter(
    (studentRow) =>
      studentRow &&
      studentRow.studentId &&
      studentRow.isIncluded &&
      (!studentRow.isNewStudent || includeNewStudentsFromDoc)
  );
  if (activeRows.length === 0 || includedColumns.length === 0) return null;

  const safeCategories = Array.isArray(activeCategories) ? activeCategories : [];
  // Se clonan profundamente las listas de subcategorías para evitar mutar por referencia el estado de React antes del commit.
  const workingCategories: GradeCategory[] = safeCategories
    .filter((category) => category && typeof category === 'object')
    .map((category) => ({
      ...category,
      subcategories: Array.isArray(category.subcategories) ? [...category.subcategories] : [],
    }));

  const columnKeyToSubcategoryMap: Record<
    string,
    { categoryId: string; categoryName: string; subcategoryId: string; subcategoryName: string }
  > = {};

  includedColumns.forEach((columnConfig, columnIndex) => {
    if (!columnConfig || columnConfig.kind !== 'grade') return;

    let targetCategory: GradeCategory | undefined;
    const rawNewCatName = String(columnConfig.newCategoryName ?? '').trim();
    if (columnConfig.targetCategoryMode === 'new' && rawNewCatName) {
      targetCategory = workingCategories.find(
        (category) => normalizeImportText(category.name) === normalizeImportText(rawNewCatName)
      );
      if (!targetCategory) {
        // Las categorías creadas durante una importación nacen con peso 0 para no desbalancear una ponderación porcentual ya cerrada al 100%.
        targetCategory = {
          id: `cat-imp-${Date.now()}-${columnIndex}`,
          name: rawNewCatName,
          weight: NEW_CUSTOM_CATEGORY_WEIGHT,
          subcategories: [],
        };
        workingCategories.push(targetCategory);
      }
    } else {
      targetCategory =
        workingCategories.find((category) => category.id === columnConfig.targetCategoryId) ||
        workingCategories[0];
      if (!targetCategory) {
        targetCategory = {
          id: `cat-imp-${Date.now()}-${columnIndex}`,
          name: DEFAULT_CATEGORY_NAME,
          weight: DEFAULT_CATEGORY_WEIGHT,
          subcategories: [],
        };
        workingCategories.push(targetCategory);
      }
    }

    let resolvedSubcategoryId = columnConfig.targetSubcategoryId || '';
    const cleanSubcategoryName =
      String(columnConfig.subcategoryName ?? '').trim() || columnConfig.colKey;

    if (columnConfig.targetSubcategoryMode === 'existing' && resolvedSubcategoryId) {
      const existingSubcategory = targetCategory.subcategories.find(
        (subcategory) => subcategory.id === resolvedSubcategoryId
      );
      if (!existingSubcategory) {
        resolvedSubcategoryId = `sub-imp-${Date.now()}-${columnIndex}`;
        targetCategory.subcategories.push({
          id: resolvedSubcategoryId,
          name: cleanSubcategoryName,
          maxScore: STANDARD_MAX_SCORE,
        });
      }
    } else {
      const matchingSubcategoryByName = targetCategory.subcategories.find(
        (subcategory) =>
          normalizeImportText(subcategory.name) === normalizeImportText(cleanSubcategoryName)
      );
      if (matchingSubcategoryByName) {
        resolvedSubcategoryId = matchingSubcategoryByName.id;
      } else {
        resolvedSubcategoryId = `sub-imp-${Date.now()}-${columnIndex}`;
        targetCategory.subcategories.push({
          id: resolvedSubcategoryId,
          name: cleanSubcategoryName,
          maxScore: STANDARD_MAX_SCORE,
        });
      }
    }

    columnKeyToSubcategoryMap[columnConfig.colKey] = {
      categoryId: targetCategory.id,
      categoryName: targetCategory.name,
      subcategoryId: resolvedSubcategoryId,
      subcategoryName: cleanSubcategoryName,
    };
  });

  const safeGradesMap =
    activeGradesMap && typeof activeGradesMap === 'object' ? activeGradesMap : {};
  const workingGradesMap: StudentGradesMap = {};
  Object.keys(safeGradesMap).forEach((studentId) => {
    workingGradesMap[studentId] = { ...(safeGradesMap[studentId] || {}) };
  });

  const attendanceUpdates: MultiImportApplyPayload['attendanceUpdates'] = {};
  const newStudentsToCreate: MultiImportApplyPayload['newStudentsToCreate'] = [];

  activeRows.forEach((studentRow) => {
    if (studentRow.isNewStudent && includeNewStudentsFromDoc) {
      newStudentsToCreate.push({
        id: studentRow.studentId,
        firstName: studentRow.firstName || 'Alumno',
        lastName: studentRow.lastName || '',
        email: studentRow.studentEmail || '',
      });
    }

    if (!workingGradesMap[studentRow.studentId]) {
      workingGradesMap[studentRow.studentId] = {};
    }

    includedColumns.forEach((columnConfig) => {
      if (!columnConfig) return;
      const evaluatedCell = studentRow.valuesByCol?.[columnConfig.colKey];
      if (!evaluatedCell || !evaluatedCell.isValid || evaluatedCell.editedVal === '') return;

      const parsedCell = parseFlexibleCellNumber(evaluatedCell.editedVal, columnConfig.kind);
      const numericValue = parsedCell.isValid ? parsedCell.numVal : Number(evaluatedCell.editedVal);

      if (columnConfig.kind === 'grade') {
        const targetSubcategoryInfo = columnKeyToSubcategoryMap[columnConfig.colKey];
        if (targetSubcategoryInfo) {
          workingGradesMap[studentRow.studentId][targetSubcategoryInfo.subcategoryId] =
            Number.isFinite(numericValue)
              ? String(Number(numericValue.toFixed(TWO_DECIMAL_PRECISION)))
              : evaluatedCell.editedVal;
        }
      } else if (columnConfig.kind === 'absences') {
        if (!Number.isFinite(numericValue)) return;
        if (!attendanceUpdates[studentRow.studentId]) attendanceUpdates[studentRow.studentId] = {};
        attendanceUpdates[studentRow.studentId].absences = Math.max(
          MIN_ATTENDANCE_COUNT,
          Math.round(numericValue)
        );
      } else if (columnConfig.kind === 'lates') {
        if (!Number.isFinite(numericValue)) return;
        if (!attendanceUpdates[studentRow.studentId]) attendanceUpdates[studentRow.studentId] = {};
        attendanceUpdates[studentRow.studentId].lates = Math.max(
          MIN_ATTENDANCE_COUNT,
          Math.round(numericValue)
        );
      } else if (
        columnConfig.kind === 'disposition' ||
        columnConfig.kind === 'disposition_deduction'
      ) {
        if (!Number.isFinite(numericValue)) return;
        if (!attendanceUpdates[studentRow.studentId]) attendanceUpdates[studentRow.studentId] = {};
        attendanceUpdates[studentRow.studentId].disposition = Math.min(
          MAX_DISPOSITION_SCORE,
          Math.max(MIN_DISPOSITION_SCORE, Number(numericValue.toFixed(TWO_DECIMAL_PRECISION)))
        );
      }
    });
  });

  const newHistoryEntries: GradeHistoryEntry[] = [];
  Object.entries(columnKeyToSubcategoryMap).forEach(
    ([columnKey, subcategoryInfo], entryIndex) => {
      const updatedRowsForColumn = activeRows.filter((studentRow) => {
        const evaluatedCell = studentRow.valuesByCol?.[columnKey];
        return evaluatedCell && evaluatedCell.isValid && evaluatedCell.editedVal !== '';
      });
      if (updatedRowsForColumn.length === 0) return;

      const numericScores = updatedRowsForColumn
        .map((studentRow) => parseFloat(studentRow.valuesByCol[columnKey].editedVal))
        .filter((scoreNumber) => Number.isFinite(scoreNumber));
      const averageScore =
        numericScores.length > 0
          ? numericScores.reduce((accumulator, scoreValue) => accumulator + scoreValue, 0) /
            numericScores.length
          : undefined;

      newHistoryEntries.push({
        id: `gh-${Date.now()}-${entryIndex}`,
        courseId,
        timestamp: Date.now(),
        date: new Date().toLocaleDateString(ARGENTINA_LOCALE),
        time: new Date().toLocaleTimeString(ARGENTINA_LOCALE, {
          hour: '2-digit',
          minute: '2-digit',
        }),
        term: selectedTerm,
        termLabel: selectedTerm === FIRST_TERM_CODE ? FIRST_TERM_LABEL : SECOND_TERM_LABEL,
        subcategoryId: subcategoryInfo.subcategoryId,
        evaluationName: subcategoryInfo.subcategoryName,
        categoryName: subcategoryInfo.categoryName,
        action: sourceType === 'file' ? 'import_excel' : 'import_sheets',
        description: `Se importaron ${updatedRowsForColumn.length} calificaciones en "${subcategoryInfo.categoryName} - ${subcategoryInfo.subcategoryName}"`,
        updatedStudentsCount: updatedRowsForColumn.length,
        averageScore,
        sourceFile: fileName || undefined,
        changesSummary: updatedRowsForColumn.map((studentRow) => ({
          studentId: studentRow.studentId,
          studentName: studentRow.studentName,
          studentEmail: studentRow.studentEmail,
          previousScore: studentRow.valuesByCol[columnKey].currentVal || undefined,
          newScore: studentRow.valuesByCol[columnKey].editedVal,
          status:
            studentRow.valuesByCol[columnKey].status === 'new'
              ? 'new'
              : studentRow.valuesByCol[columnKey].status === 'update'
              ? 'updated'
              : 'unchanged',
        })),
      });
    }
  );

  const multiPayload: MultiImportApplyPayload = {
    term: selectedTerm,
    updatedCategories: workingCategories,
    updatedGradesMap: workingGradesMap,
    historyEntries: newHistoryEntries,
    attendanceUpdates,
    newStudentsToCreate,
    sourceLabel:
      fileName || (sourceType === 'file' ? SOURCE_LABEL_EXCEL : SOURCE_LABEL_SHEETS),
  };

  // Se mantiene el payload de columna única para consumidores heredados que aún no implementen `onApplyMultiImport`.
  let legacySingleGradePayload: GradeImportCommitResult['legacySingleGradePayload'];
  const firstColumnMapping = Object.entries(columnKeyToSubcategoryMap)[0];
  if (firstColumnMapping && newHistoryEntries[0]) {
    const [firstColumnKey, firstSubcategoryInfo] = firstColumnMapping;
    const singleColumnUpdates: Record<string, string> = {};
    activeRows.forEach((studentRow) => {
      const evaluatedCell = studentRow.valuesByCol?.[firstColumnKey];
      if (evaluatedCell && evaluatedCell.isValid && evaluatedCell.editedVal !== '') {
        singleColumnUpdates[studentRow.studentId] = evaluatedCell.editedVal;
      }
    });
    legacySingleGradePayload = {
      term: selectedTerm,
      categoryId: firstSubcategoryInfo.categoryId,
      subcategoryId: firstSubcategoryInfo.subcategoryId,
      newSubcategoryName: firstSubcategoryInfo.subcategoryName,
      updates: singleColumnUpdates,
      historyEntry: newHistoryEntries[0],
    };
  }

  return {
    multiPayload,
    legacySingleGradePayload,
  };
}
