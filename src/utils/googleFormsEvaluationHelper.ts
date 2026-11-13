import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import { MultiImportApplyPayload } from '../types/gradeImport';
import { GradeHistoryEntry } from './excelExport';
import { CATEGORY_COLORS } from './gradeCalculations';
import {
  normalizeImportText,
  findBestStudentMatchInRoster,
} from './gradeImportParser';

const STANDARD_GRADE_SCALE_MAX = 10;
const PERCENTAGE_SCALE_MAX = 100;
const HALF_POINT_MULTIPLIER = 2;
const ONE_DECIMAL_PRECISION = 1;
const TWO_DECIMAL_PRECISION = 2;

const SCORE_SAMPLE_ROWS_LIMIT = 12;
const FRACTION_SAMPLE_THRESHOLD_RATIO = 0.4;
const NUMERIC_SAMPLE_ROWS_LIMIT = 10;
const NUMERIC_SAMPLE_THRESHOLD_RATIO = 0.5;
const ROSTER_SAMPLE_ROWS_LIMIT = 40;
const MIN_CANDIDATE_NAME_LENGTH = 3;
const HIGH_CONFIDENCE_ROSTER_MATCH_THRESHOLD = 0.6;
const MIN_SUBMISSION_MATCH_CONFIDENCE = 0.5;

const EMPTY_CELL_DASH = '-';
const DIRECT_CATEGORY_COLUMN_KEY = '__CATEGORY_DIRECT__';
const DEFAULT_EVALUATION_CATEGORY_NAME = 'Evaluaciones';
const DEFAULT_FORMS_SUBCATEGORY_NAME = 'Evaluación Forms';
const ARGENTINA_LOCALE = 'es-AR';
const FIRST_TERM_CODE = '1c';
const FIRST_TERM_LABEL = '1° Cuatrimestre';
const SECOND_TERM_LABEL = '2° Cuatrimestre';

export type FormsScaleMode = 'scale_10' | 'raw';
export type FormsRoundingMode = 'two_decimals' | 'one_decimal' | 'half_point' | 'integer';

export interface ParsedFormSubmission {
  rowIndex: number;
  rawRow: Record<string, any>;
  rawName: string;
  rawEmail: string;
  rawTimestamp: string;
  rawScoreText: string;
  earnedPoints: number | null;
  maxPoints: number | null;
}

export interface StudentFormsReviewRow {
  student: Student;
  matchedSubmissionIndex: number | null;
  matchConfidence: number;
  duplicateSubmissionsCount: number;
  rawScoreText: string;
  computedScore: string;
  editedScore: string;
  currentGradeInCol: string;
  isIncluded: boolean;
  isManuallyEdited: boolean;
}

export interface DetectedGoogleFormsColumns {
  nameCol: string;
  secondaryNameCol: string;
  emailCol: string;
  scoreCol: string;
  timestampCol: string;
  detectedMaxScore: number;
}

/**
 * Extrae el puntaje obtenido y el puntaje máximo posible desde una celda de Google Forms.
 * Soporta formatos compuestos ("8 / 10", "75 de 100"), porcentajes ("85%") y valores numéricos simples ("8,5").
 *
 * @param rawCellValue Valor crudo proveniente de la celda de puntuación del formulario o planilla.
 * @returns Objeto con el texto original limpio, los puntos obtenidos (`earned`) y el denominador máximo (`max`).
 */
export function parseGoogleFormsScoreCell(rawCellValue: any): {
  rawText: string;
  earned: number | null;
  max: number | null;
} {
  const rawText = String(rawCellValue ?? '').trim();
  if (!rawText || rawText === EMPTY_CELL_DASH) {
    return { rawText: '', earned: null, max: null };
  }

  const fractionMatch = rawText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:\/|de|sobre)\s*(\d+(?:[.,]\d+)?)/i
  );
  if (fractionMatch) {
    const earnedPoints = parseFloat(fractionMatch[1].replace(',', '.'));
    const maxPossiblePoints = parseFloat(fractionMatch[2].replace(',', '.'));
    if (
      Number.isFinite(earnedPoints) &&
      Number.isFinite(maxPossiblePoints) &&
      maxPossiblePoints > 0
    ) {
      return { rawText, earned: earnedPoints, max: maxPossiblePoints };
    }
  }

  const percentageMatch = rawText.match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (percentageMatch) {
    const percentageScore = parseFloat(percentageMatch[1].replace(',', '.'));
    if (Number.isFinite(percentageScore)) {
      return { rawText, earned: percentageScore, max: PERCENTAGE_SCALE_MAX };
    }
  }

  const singleNumberMatch = rawText.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (singleNumberMatch) {
    const earnedPoints = parseFloat(singleNumberMatch[0]);
    if (Number.isFinite(earnedPoints)) {
      return { rawText, earned: earnedPoints, max: null };
    }
  }

  return { rawText, earned: null, max: null };
}

/**
 * Convierte y redondea el puntaje bruto de Google Forms hacia la nota final pedagógica.
 *
 * @param earnedPoints Puntaje obtenido por el estudiante en el formulario.
 * @param maxPossiblePoints Puntaje máximo detectado explícitamente en la celda (ej. el `Y` de `X / Y`).
 * @param fallbackMaxPoints Puntaje máximo general del cuestionario cuando la celda no incluye denominador.
 * @param scaleMode Modo de escala (`'scale_10'` para convertir proporcionalmente a base 10, `'raw'` para mantener puntaje directo).
 * @param roundingMode Criterio de redondeo aplicable a la nota resultante.
 * @returns Representación en cadena de la nota final lista para persistir en la planilla, o `''` si el puntaje no es válido.
 */
export function formatConvertedFormsGrade(
  earnedPoints: number | null,
  maxPossiblePoints: number | null,
  fallbackMaxPoints: number,
  scaleMode: FormsScaleMode,
  roundingMode: FormsRoundingMode
): string {
  if (earnedPoints === null || !Number.isFinite(earnedPoints)) return '';

  const safeFallbackMax =
    Number.isFinite(fallbackMaxPoints) && fallbackMaxPoints > 0
      ? fallbackMaxPoints
      : STANDARD_GRADE_SCALE_MAX;
  const effectiveMaxPoints =
    maxPossiblePoints && Number.isFinite(maxPossiblePoints) && maxPossiblePoints > 0
      ? maxPossiblePoints
      : safeFallbackMax;
  let numericGrade = earnedPoints;

  if (scaleMode === 'scale_10') {
    if (effectiveMaxPoints > 0 && effectiveMaxPoints !== STANDARD_GRADE_SCALE_MAX) {
      numericGrade = (earnedPoints / effectiveMaxPoints) * STANDARD_GRADE_SCALE_MAX;
    } else if (
      !maxPossiblePoints &&
      earnedPoints > STANDARD_GRADE_SCALE_MAX &&
      earnedPoints <= PERCENTAGE_SCALE_MAX
    ) {
      // Cuando la planilla exportada omite el denominador "/ 100" pero el valor supera 10, se asume escala centesimal para evitar notas fuera de rango.
      numericGrade = (earnedPoints / PERCENTAGE_SCALE_MAX) * STANDARD_GRADE_SCALE_MAX;
    }
  }

  if (!Number.isFinite(numericGrade)) return '';

  if (roundingMode === 'integer') return String(Math.round(numericGrade));
  if (roundingMode === 'half_point') {
    const halfPointRounded =
      Math.round(numericGrade * HALF_POINT_MULTIPLIER) / HALF_POINT_MULTIPLIER;
    return String(Number(halfPointRounded.toFixed(ONE_DECIMAL_PRECISION)));
  }
  if (roundingMode === 'one_decimal') {
    return String(Number(numericGrade.toFixed(ONE_DECIMAL_PRECISION)));
  }
  return String(Number(numericGrade.toFixed(TWO_DECIMAL_PRECISION)));
}

/**
 * Identifica la columna de puntuación dentro de las cabeceras de un Google Forms,
 * priorizando coincidencias exactas de nombre y recurriendo luego a inspección de patrones fraccionarios ("X / Y").
 *
 * @param headers Lista de encabezados disponibles en la tabla.
 * @param rows Filas de datos para muestreo heurístico en caso de encabezados personalizados.
 * @param timestampColumnName Nombre de la columna de marca temporal para excluirla del muestreo numérico.
 * @returns El nombre de la columna de puntaje detectada o `''`.
 */
function detectScoreColumn(
  headers: string[],
  rows: Array<Record<string, any>>,
  timestampColumnName: string
): string {
  if (!Array.isArray(headers) || headers.length === 0) return '';
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];

  const exactScoreHeader = headers.find((headerName) =>
    /^puntuacion$|^score$|^puntaje$|^calificacion$|^nota$|^nota final$|^puntos$|^total points$|^puntaje total$/i.test(
      normalizeImportText(headerName)
    )
  );
  if (exactScoreHeader) return exactScoreHeader;

  const keywordScoreHeader = headers.find((headerName) =>
    /puntuacion|score|puntaje|calificacion|nota final|nota/i.test(normalizeImportText(headerName))
  );
  if (keywordScoreHeader) return keywordScoreHeader;

  for (const headerName of headers) {
    if (headerName === timestampColumnName) continue;
    const sampleCellValues = safeRows
      .slice(0, SCORE_SAMPLE_ROWS_LIMIT)
      .map((rowRecord) => String(rowRecord?.[headerName] ?? '').trim())
      .filter(Boolean);
    const fractionFormattedCount = sampleCellValues.filter((cellValue) =>
      /^\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?$/.test(cellValue)
    ).length;
    const requiredFractionCount = Math.ceil(
      sampleCellValues.length * FRACTION_SAMPLE_THRESHOLD_RATIO
    );
    if (fractionFormattedCount > 0 && fractionFormattedCount >= requiredFractionCount) {
      return headerName;
    }
  }

  return '';
}

/**
 * Evalúa qué columna candidata contiene la mayor cantidad de coincidencias reales contra el padrón de alumnos del curso.
 * Esto permite detectar la columna de identidad incluso cuando el docente tituló la pregunta como "Seleccioná tu nombre de la lista".
 *
 * @param candidateColumns Encabezados candidatos que no son ni fecha, ni email, ni puntuación.
 * @param rows Filas de respuestas del formulario.
 * @param students Lista oficial de estudiantes del curso.
 * @returns Nombre de la columna con mayor tasa de coincidencia contra el padrón o `''`.
 */
function findBestRosterMatchingColumn(
  candidateColumns: string[],
  rows: Array<Record<string, any>>,
  students: Student[]
): string {
  if (
    !Array.isArray(candidateColumns) ||
    !Array.isArray(students) ||
    students.length === 0 ||
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return '';
  }
  let bestMatchingColumn = '';
  let highestMatchCount = 0;

  for (const columnName of candidateColumns) {
    let matchedRowsCount = 0;
    for (const rowRecord of rows.slice(0, ROSTER_SAMPLE_ROWS_LIMIT)) {
      if (!rowRecord || typeof rowRecord !== 'object') continue;
      const cellText = String(rowRecord[columnName] ?? '').trim();
      if (!cellText || cellText.length < MIN_CANDIDATE_NAME_LENGTH) continue;
      const { student, score } = findBestStudentMatchInRoster(students, cellText);
      if (student && score >= HIGH_CONFIDENCE_ROSTER_MATCH_THRESHOLD) {
        matchedRowsCount++;
      }
    }
    if (matchedRowsCount > highestMatchCount) {
      highestMatchCount = matchedRowsCount;
      bestMatchingColumn = columnName;
    }
  }
  return highestMatchCount > 0 ? bestMatchingColumn : '';
}

/**
 * Detecta automáticamente las columnas de identidad (Nombre/Apellido, Nombre secundario, Email),
 * Marca temporal, Puntuación y el puntaje máximo de la evaluación en respuestas de Google Forms.
 *
 * @param headers Lista de nombres de columnas provenientes de Google Forms o de su hoja de respuestas.
 * @param rows Filas de respuestas del cuestionario.
 * @param students Padrón de alumnos del curso activo para asistir el reconocimiento por contenido.
 * @returns Configuración de columnas clave detectadas y el puntaje máximo inferido (`detectedMaxScore`).
 */
export function autoDetectGoogleFormsColumns(
  headers: string[],
  rows: Array<Record<string, any>>,
  students: Student[]
): DetectedGoogleFormsColumns {
  const safeHeaders = Array.isArray(headers)
    ? headers.filter((header) => typeof header === 'string' && header.trim() !== '')
    : [];
  const safeRows = Array.isArray(rows)
    ? rows.filter((rowRecord) => rowRecord && typeof rowRecord === 'object')
    : [];
  const safeStudents = Array.isArray(students) ? students : [];

  if (safeHeaders.length === 0) {
    return {
      nameCol: '',
      secondaryNameCol: '',
      emailCol: '',
      scoreCol: '',
      timestampCol: '',
      detectedMaxScore: STANDARD_GRADE_SCALE_MAX,
    };
  }

  const timestampCol =
    safeHeaders.find((headerName) =>
      /marca temporal|timestamp|fecha|enviado/i.test(normalizeImportText(headerName))
    ) || '';

  let scoreCol = detectScoreColumn(safeHeaders, safeRows, timestampCol);

  const emailCol =
    safeHeaders.find(
      (headerName) =>
        headerName !== scoreCol &&
        headerName !== timestampCol &&
        /correo|email|mail|direccion de correo/i.test(normalizeImportText(headerName))
    ) || '';

  const candidateColumns = safeHeaders.filter(
    (headerName) =>
      headerName !== scoreCol && headerName !== timestampCol && headerName !== emailCol
  );

  const exactLastNameColumn = candidateColumns.find((headerName) =>
    /^apellido(s)?$/i.test(normalizeImportText(headerName))
  );
  const exactFirstNameColumn = candidateColumns.find(
    (headerName) =>
      headerName !== exactLastNameColumn && /^nombre(s)?$/i.test(normalizeImportText(headerName))
  );

  let nameCol = '';
  let secondaryNameCol = '';

  if (exactLastNameColumn && exactFirstNameColumn) {
    nameCol = exactLastNameColumn;
    secondaryNameCol = exactFirstNameColumn;
  } else {
    nameCol =
      findBestRosterMatchingColumn(candidateColumns, safeRows, safeStudents) ||
      candidateColumns.find((headerName) =>
        /apellido y nombre|nombre y apellido|nombre completo|alumno|estudiante|selecciona tu nombre|tu nombre|nombre|apellido/i.test(
          normalizeImportText(headerName)
        )
      ) ||
      candidateColumns[0] ||
      emailCol ||
      safeHeaders[0] ||
      '';
  }

  if (!scoreCol) {
    const remainingColumns = candidateColumns.filter(
      (headerName) => headerName !== nameCol && headerName !== secondaryNameCol
    );
    const numericColumn = remainingColumns.find((columnName) => {
      const sampleCellValues = safeRows
        .slice(0, NUMERIC_SAMPLE_ROWS_LIMIT)
        .map((rowRecord) => String(rowRecord?.[columnName] ?? '').trim())
        .filter(Boolean);
      const numericCellCount = sampleCellValues.filter(
        (cellValue) => parseGoogleFormsScoreCell(cellValue).earned !== null
      ).length;
      const requiredNumericCount = Math.ceil(
        sampleCellValues.length * NUMERIC_SAMPLE_THRESHOLD_RATIO
      );
      return numericCellCount > 0 && numericCellCount >= requiredNumericCount;
    });
    scoreCol = numericColumn || remainingColumns[0] || '';
  }

  let detectedMaxScore = STANDARD_GRADE_SCALE_MAX;
  if (scoreCol) {
    for (const rowRecord of safeRows) {
      const parsedScore = parseGoogleFormsScoreCell(rowRecord?.[scoreCol]);
      if (parsedScore.max && parsedScore.max > 0) {
        detectedMaxScore = parsedScore.max;
        break;
      }
      if (parsedScore.earned !== null && parsedScore.earned > STANDARD_GRADE_SCALE_MAX) {
        detectedMaxScore = PERCENTAGE_SCALE_MAX;
      }
    }
  }

  return {
    nameCol,
    secondaryNameCol,
    emailCol,
    scoreCol,
    timestampCol,
    detectedMaxScore,
  };
}

/**
 * Filtra una tabla de Google Forms conservando únicamente las columnas de identidad del alumno y la de puntuación total.
 * Se descartan todas las preguntas individuales del examen para evitar que el importador cree decenas de subcategorías por cada consigna.
 *
 * @param rows Filas originales completas provenientes del formulario.
 * @param detectedColumns Columnas de identidad y puntaje identificadas previamente.
 * @returns Nuevo conjunto de encabezados (`filteredHeaders`) y filas proyectadas (`filteredRows`).
 */
export function filterFormsToIdentityAndScoreOnly(
  rows: Array<Record<string, any>>,
  detectedColumns: Pick<
    DetectedGoogleFormsColumns,
    'nameCol' | 'secondaryNameCol' | 'emailCol' | 'scoreCol'
  >
): {
  filteredHeaders: string[];
  filteredRows: Array<Record<string, any>>;
} {
  if (!Array.isArray(rows) || !detectedColumns) {
    return { filteredHeaders: [], filteredRows: [] };
  }

  const filteredHeaders: string[] = [];
  const appendUniqueColumn = (columnName?: string) => {
    if (columnName && !filteredHeaders.includes(columnName)) {
      filteredHeaders.push(columnName);
    }
  };

  appendUniqueColumn(detectedColumns.nameCol);
  appendUniqueColumn(detectedColumns.secondaryNameCol);
  appendUniqueColumn(detectedColumns.emailCol);
  appendUniqueColumn(detectedColumns.scoreCol);

  const filteredRows = rows
    .filter((rawRow) => rawRow && typeof rawRow === 'object')
    .map((rawRow) => {
      const cleanRowObject: Record<string, any> = {};
      filteredHeaders.forEach((headerName) => {
        cleanRowObject[headerName] = rawRow[headerName] !== undefined ? rawRow[headerName] : '';
      });
      return cleanRowObject;
    });

  return { filteredHeaders, filteredRows };
}

/**
 * Vincula las entregas de un formulario de Google Forms contra el padrón de alumnos del curso,
 * resolviendo duplicados (cuando un alumno envió más de una vez) y calculando la nota final convertida.
 *
 * @param params Parámetros de entrada con filas crudas, lista de estudiantes, configuración de columnas y reglas de conversión.
 * @returns Lista de entregas procesadas (`submissions`) y filas de revisión por estudiante (`reviewRows`).
 */
export function computeGoogleFormsMatching(params: {
  rows: Array<Record<string, any>>;
  students: Student[];
  activeGradesMap: StudentGradesMap;
  nameCol: string;
  secondaryNameCol: string;
  emailCol: string;
  scoreCol: string;
  timestampCol: string;
  scaleMode: FormsScaleMode;
  maxPoints: number;
  roundingMode: FormsRoundingMode;
  targetSubIdForExisting: string;
  colMode: 'existing_sub' | 'new_sub';
}): {
  submissions: ParsedFormSubmission[];
  reviewRows: StudentFormsReviewRow[];
} {
  const safeRows = Array.isArray(params?.rows) ? params.rows : [];
  const safeStudents = Array.isArray(params?.students) ? params.students : [];
  const safeGradesMap =
    params?.activeGradesMap && typeof params.activeGradesMap === 'object'
      ? params.activeGradesMap
      : {};
  const {
    nameCol = '',
    secondaryNameCol = '',
    emailCol = '',
    scoreCol = '',
    timestampCol = '',
    scaleMode = 'scale_10',
    maxPoints = STANDARD_GRADE_SCALE_MAX,
    roundingMode = 'two_decimals',
    targetSubIdForExisting = '',
    colMode = 'new_sub',
  } = params || {};

  const submissions: ParsedFormSubmission[] = [];
  safeRows.forEach((rowRecord, rowIndex) => {
    if (!rowRecord || typeof rowRecord !== 'object') return;
    const primaryName = nameCol ? String(rowRecord[nameCol] ?? '').trim() : '';
    const secondaryName = secondaryNameCol
      ? String(rowRecord[secondaryNameCol] ?? '').trim()
      : '';
    const combinedStudentName =
      primaryName && secondaryName ? `${primaryName}, ${secondaryName}` : primaryName || secondaryName;
    const emailAddress = emailCol ? String(rowRecord[emailCol] ?? '').trim() : '';
    const submissionTimestamp = timestampCol ? String(rowRecord[timestampCol] ?? '').trim() : '';
    const rawScoreCell = scoreCol ? rowRecord[scoreCol] : '';

    if (!combinedStudentName && !emailAddress && !String(rawScoreCell ?? '').trim()) return;
    if (/^promedio|^total|^media|^puntuacion$/i.test(combinedStudentName)) return;

    const parsedScore = parseGoogleFormsScoreCell(rawScoreCell);
    submissions.push({
      rowIndex,
      rawRow: rowRecord,
      rawName: combinedStudentName,
      rawEmail: emailAddress,
      rawTimestamp: submissionTimestamp,
      rawScoreText: parsedScore.rawText,
      earnedPoints: parsedScore.earned,
      maxPoints: parsedScore.max,
    });
  });

  const bestSubmissionByStudentId: Record<
    string,
    { submissionIndex: number; confidence: number; count: number }
  > = {};

  submissions.forEach((submission, submissionIndex) => {
    const { student, score } = findBestStudentMatchInRoster(
      safeStudents,
      submission.rawName,
      submission.rawEmail
    );
    if (!student || !student.id || score < MIN_SUBMISSION_MATCH_CONFIDENCE) return;

    const existingMatch = bestSubmissionByStudentId[student.id];
    // Se usa ">=" para que, ante igual nivel de confianza de identidad, prevalezca el intento más reciente enviado por el alumno.
    bestSubmissionByStudentId[student.id] = !existingMatch
      ? { submissionIndex, confidence: score, count: 1 }
      : {
          submissionIndex:
            score >= existingMatch.confidence ? submissionIndex : existingMatch.submissionIndex,
          confidence: Math.max(score, existingMatch.confidence),
          count: existingMatch.count + 1,
        };
  });

  const existingSubcategoryKey =
    colMode === 'existing_sub' && targetSubIdForExisting ? targetSubIdForExisting : '';

  const reviewRows: StudentFormsReviewRow[] = safeStudents
    .filter((student) => student && student.id)
    .map((student) => {
      const matchInfo = bestSubmissionByStudentId[student.id];
      const matchedSubmission =
        matchInfo !== undefined ? submissions[matchInfo.submissionIndex] : null;
      const computedGrade = matchedSubmission
        ? formatConvertedFormsGrade(
            matchedSubmission.earnedPoints,
            matchedSubmission.maxPoints,
            maxPoints,
            scaleMode,
            roundingMode
          )
        : '';
      const currentGrade = existingSubcategoryKey
        ? String(safeGradesMap[student.id]?.[existingSubcategoryKey] ?? '')
        : '';

      return {
        student,
        matchedSubmissionIndex: matchInfo !== undefined ? matchInfo.submissionIndex : null,
        matchConfidence: matchInfo ? matchInfo.confidence : 0,
        duplicateSubmissionsCount: matchInfo ? matchInfo.count : 0,
        rawScoreText: matchedSubmission ? matchedSubmission.rawScoreText : '',
        computedScore: computedGrade,
        editedScore: computedGrade,
        currentGradeInCol: currentGrade,
        isIncluded: Boolean(matchedSubmission && computedGrade !== ''),
        isManuallyEdited: false,
      };
    });

  return { submissions, reviewRows };
}

/**
 * Construye el payload de aplicación (`MultiImportApplyPayload`) a partir de las filas verificadas de Google Forms,
 * creando o reutilizando la categoría/subcategoría destino y generando el registro de auditoría histórica.
 *
 * @param params Datos del curso, cuatrimestre, categoría/columna destino y filas revisadas por el docente.
 * @returns El objeto `MultiImportApplyPayload` listo para persistir, o `null` si no hay filas válidas seleccionadas.
 */
export function buildGoogleFormsCommitPayload(params: {
  courseId: string;
  selectedTerm: '1c' | '2c';
  sourceTab: 'forms_direct' | 'file' | 'paste';
  sourceTitle: string;
  activeCategories: GradeCategory[];
  activeGradesMap: StudentGradesMap;
  targetCategoryMode: 'existing' | 'new';
  selectedCategoryId: string;
  newCategoryName: string;
  targetColumnMode: 'existing_sub' | 'new_sub';
  selectedSubcategoryId: string;
  newSubcategoryName: string;
  reviewRows: StudentFormsReviewRow[];
}): MultiImportApplyPayload | null {
  if (!params || !Array.isArray(params.reviewRows)) return null;

  const {
    courseId,
    selectedTerm,
    sourceTab,
    sourceTitle,
    activeCategories,
    activeGradesMap,
    targetCategoryMode,
    selectedCategoryId,
    newCategoryName = '',
    targetColumnMode,
    selectedSubcategoryId = '',
    newSubcategoryName = '',
    reviewRows,
  } = params;

  const rowsToSave = reviewRows.filter(
    (reviewRow) =>
      reviewRow &&
      reviewRow.student?.id &&
      reviewRow.isIncluded &&
      String(reviewRow.editedScore ?? '').trim() !== ''
  );
  if (rowsToSave.length === 0) return null;

  const safeCategories = Array.isArray(activeCategories) ? activeCategories : [];
  const workingCategories: GradeCategory[] = safeCategories
    .filter((category) => category && typeof category === 'object')
    .map((category) => ({
      ...category,
      subcategories: Array.isArray(category.subcategories) ? [...category.subcategories] : [],
    }));

  let targetCategory: GradeCategory | undefined;
  if (targetCategoryMode === 'new' && newCategoryName.trim()) {
    const cleanCategoryName = newCategoryName.trim();
    targetCategory = workingCategories.find(
      (category) => normalizeImportText(category.name) === normalizeImportText(cleanCategoryName)
    );
    if (!targetCategory) {
      targetCategory = {
        id: `cat-forms-${Date.now()}`,
        name: cleanCategoryName,
        color: CATEGORY_COLORS[workingCategories.length % CATEGORY_COLORS.length].badge,
        subcategories: [],
      };
      workingCategories.push(targetCategory);
    }
  } else {
    targetCategory =
      workingCategories.find((category) => category.id === selectedCategoryId) ||
      workingCategories[0];
    if (!targetCategory) {
      targetCategory = {
        id: `cat-forms-${Date.now()}`,
        name: DEFAULT_EVALUATION_CATEGORY_NAME,
        color: CATEGORY_COLORS[0].badge,
        subcategories: [],
      };
      workingCategories.push(targetCategory);
    }
  }

  let finalSubcategoryId = '';
  let finalSubcategoryName = '';

  if (targetColumnMode === 'existing_sub' && selectedSubcategoryId) {
    if (selectedSubcategoryId === DIRECT_CATEGORY_COLUMN_KEY) {
      // Cuando una categoría aún no tiene subcategorías, la grilla principal indexa la nota usando directamente el ID de la categoría.
      finalSubcategoryId = targetCategory.id;
      finalSubcategoryName = targetCategory.name;
    } else {
      const existingSubcategory = targetCategory.subcategories.find(
        (subcategory) => subcategory.id === selectedSubcategoryId
      );
      if (existingSubcategory) {
        finalSubcategoryId = existingSubcategory.id;
        finalSubcategoryName = existingSubcategory.name;
      }
    }
  }

  if (!finalSubcategoryId) {
    const cleanSubcategoryName = newSubcategoryName.trim() || DEFAULT_FORMS_SUBCATEGORY_NAME;
    const existingSameNameSubcategory = targetCategory.subcategories.find(
      (subcategory) =>
        normalizeImportText(subcategory.name) === normalizeImportText(cleanSubcategoryName)
    );
    if (existingSameNameSubcategory) {
      finalSubcategoryId = existingSameNameSubcategory.id;
      finalSubcategoryName = existingSameNameSubcategory.name;
    } else {
      finalSubcategoryId = `sub-forms-${Date.now()}`;
      finalSubcategoryName = cleanSubcategoryName;
      targetCategory.subcategories.push({
        id: finalSubcategoryId,
        name: finalSubcategoryName,
        maxScore: STANDARD_GRADE_SCALE_MAX,
      });
    }
  }

  const safeGradesMap =
    activeGradesMap && typeof activeGradesMap === 'object' ? activeGradesMap : {};
  const workingGradesMap: StudentGradesMap = {};
  Object.keys(safeGradesMap).forEach((studentId) => {
    workingGradesMap[studentId] = { ...(safeGradesMap[studentId] || {}) };
  });

  rowsToSave.forEach((reviewRow) => {
    const studentId = reviewRow.student.id;
    if (!workingGradesMap[studentId]) workingGradesMap[studentId] = {};
    const editedScoreString = String(reviewRow.editedScore ?? '').trim();
    const parsedScoreNumber = parseFloat(editedScoreString.replace(',', '.'));
    workingGradesMap[studentId][finalSubcategoryId] = Number.isFinite(parsedScoreNumber)
      ? String(Number(parsedScoreNumber.toFixed(TWO_DECIMAL_PRECISION)))
      : editedScoreString;
  });

  const numericScoreValues = rowsToSave
    .map((reviewRow) => parseFloat(String(reviewRow.editedScore ?? '').replace(',', '.')))
    .filter((numericScore) => Number.isFinite(numericScore));
  const averageScore =
    numericScoreValues.length > 0
      ? numericScoreValues.reduce((accumulator, scoreValue) => accumulator + scoreValue, 0) /
        numericScoreValues.length
      : undefined;

  const historyEntry: GradeHistoryEntry = {
    id: `gh-forms-${Date.now()}`,
    courseId,
    timestamp: Date.now(),
    date: new Date().toLocaleDateString(ARGENTINA_LOCALE),
    time: new Date().toLocaleTimeString(ARGENTINA_LOCALE, { hour: '2-digit', minute: '2-digit' }),
    term: selectedTerm,
    termLabel: selectedTerm === FIRST_TERM_CODE ? FIRST_TERM_LABEL : SECOND_TERM_LABEL,
    subcategoryId: finalSubcategoryId,
    evaluationName: finalSubcategoryName,
    categoryName: targetCategory.name,
    action: sourceTab === 'forms_direct' ? 'import_sheets' : 'import_excel',
    description: `Google Forms: Se cargaron ${rowsToSave.length} notas finales en "${targetCategory.name} → ${finalSubcategoryName}"`,
    updatedStudentsCount: rowsToSave.length,
    averageScore,
    sourceFile: `Google Forms: ${sourceTitle || DEFAULT_FORMS_SUBCATEGORY_NAME}`,
    changesSummary: rowsToSave.map((reviewRow) => {
      const cleanEditedScore = String(reviewRow.editedScore ?? '').trim();
      return {
        studentId: reviewRow.student.id,
        studentName: `${reviewRow.student.lastName || ''}, ${reviewRow.student.firstName || ''}`.replace(
          /^,\s*|\s*,\s*$/g,
          ''
        ),
        studentEmail: reviewRow.student.email,
        previousScore: reviewRow.currentGradeInCol || undefined,
        newScore: cleanEditedScore,
        status: !reviewRow.currentGradeInCol
          ? 'new'
          : reviewRow.currentGradeInCol === cleanEditedScore
          ? 'unchanged'
          : 'updated',
      };
    }),
  };

  return {
    term: selectedTerm,
    updatedCategories: workingCategories,
    updatedGradesMap: workingGradesMap,
    historyEntries: [historyEntry],
    attendanceUpdates: {},
    newStudentsToCreate: [],
    sourceLabel: `Google Forms (${sourceTitle || DEFAULT_FORMS_SUBCATEGORY_NAME})`,
  };
}
