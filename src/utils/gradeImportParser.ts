import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import type {
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
} from '../types/gradeImport';
import { sanitizePlainTextInput } from './htmlEscape';

const EXACT_EMAIL_MATCH_SCORE = 1.0;
const EXACT_FULL_NAME_MATCH_SCORE = 0.99;
const BOTH_NAMES_CONTAINED_SCORE = 0.92;
const MIN_FUZZY_MATCH_SCORE_THRESHOLD = 0.5;
const NO_MATCH_SCORE = 0;

const CONCEPTUAL_GRADE_EXCELLENT = 10;
const CONCEPTUAL_GRADE_VERY_GOOD = 9;
const CONCEPTUAL_GRADE_GOOD = 8;
const CONCEPTUAL_GRADE_REGULAR = 6;
const CONCEPTUAL_GRADE_INSUFFICIENT = 4;

const MIN_GRADE_SCORE = 0;
const MAX_GRADE_SCORE = 10;
const MIN_DISPOSITION_SCORE = 1;
const MAX_DISPOSITION_SCORE = 10;
const MAX_NEGATIVE_DISPOSITION_DEDUCTION = -9;
const TWO_DECIMAL_PRECISION = 2;
const DEFAULT_DISPOSITION_FALLBACK_STRING = '10';
const DEFAULT_ATTENDANCE_FALLBACK_STRING = '0';

const MAX_HEADER_TEXT_LENGTH_BEFORE_QUESTION = 50;
const DELIMITER_LINE_RATIO_THRESHOLD = 0.4;
const MAX_PREVIEW_COLUMNS_PER_ROW = 3;
const EMPTY_CELL_DASH = '-';
const ORDER_BY_ROSTER_KEY = '__ORDER__';
const DEFAULT_CATEGORY_ID = 'cat-default';
const DEFAULT_EVALUATION_CATEGORY_NAME = 'Evaluaciones';
const DEFAULT_GRADES_CATEGORY_NAME = 'Calificaciones';
const DEFAULT_CATEGORY_WEIGHT = 100;
const SYNTHETIC_HEADER_STUDENT = 'Alumno';
const SYNTHETIC_HEADER_DISPOSITION = 'Disposición';

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_HEADER_MIN_BYTES = 30;
const ZIP_COMPRESSION_METHOD_OFFSET = 8;
const ZIP_COMPRESSED_SIZE_OFFSET = 18;
const ZIP_FILENAME_LENGTH_OFFSET = 26;
const ZIP_EXTRA_FIELD_LENGTH_OFFSET = 28;
const ZIP_COMPRESSION_STORED = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const WORD_DOCUMENT_XML_ENTRY_PATH = 'word/document.xml';
const PK_SIGNATURE_BYTE_0 = 0x50;
const PK_SIGNATURE_BYTE_1 = 0x4b;
const PK_LOCAL_HEADER_MARKER = 0x03;
const PK_CENTRAL_DIR_MARKER = 0x01;
const PK_DATA_DESCRIPTOR_MARKER = 0x07;

/**
 * Normaliza un texto eliminando tildes, signos de puntuación y convirtiendo a minúsculas
 * para permitir comparaciones tolerantes a errores de tipeo entre planillas y el padrón.
 *
 * @param text Cadena de entrada a normalizar.
 * @returns Cadena alfanumérica en minúsculas separada por espacios simples.
 */
export function normalizeImportText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

const MAX_STUDENT_NAME_CHAR_LENGTH = 65;
const MAX_STUDENT_NAME_WORD_COUNT = 6;
const EMAIL_LOCAL_PART_MATCH_SCORE = 0.95;
const MAX_SHORT_HEADER_LENGTH = 42;
const QUESTION_SAMPLE_ROWS_LIMIT = 15;
const MAX_AVERAGE_NAME_CELL_LENGTH = 45;
const MAX_SINGLE_NAME_CELL_LENGTH = 70;

/**
 * Determina si una columna corresponde a una consigna de evaluación o respuesta de desarrollo extenso
 * (por ejemplo, preguntas abiertas de Google Forms como "Explicar por qué..."), evitando que se confunda
 * con una columna de nombre de alumno o de calificación numérica.
 *
 * @param headerName Título de la columna.
 * @param sampleRows Filas opcionales de la tabla para inspeccionar la longitud del texto en las celdas.
 * @returns `true` si el encabezado o el contenido de la columna corresponde a una pregunta o texto largo.
 */
export function isQuestionOrLongTextColumn(
  headerName: string,
  sampleRows?: Array<Record<string, any>>
): boolean {
  const trimmedHeader = String(headerName || '').trim();
  if (!trimmedHeader) return false;

  if (
    trimmedHeader.length > MAX_SHORT_HEADER_LENGTH ||
    trimmedHeader.includes('?') ||
    trimmedHeader.includes('¿')
  ) {
    return true;
  }

  const normalizedHeader = normalizeImportText(trimmedHeader);
  if (
    /\b(explicar|explica|describir|describe|desarrollar|desarrolla|analizar|analiza|justificar|justifica|comparar|indicar|responder|mencionar|definir|caracterizar|relacionar|consigna|pregunta|fundamentar|elaborar|redactar|sintetizar)\b/i.test(
      normalizedHeader
    )
  ) {
    return true;
  }

  if (Array.isArray(sampleRows) && sampleRows.length > 0) {
    const nonEmptyCells = sampleRows
      .slice(0, QUESTION_SAMPLE_ROWS_LIMIT)
      .map((row) => String(row?.[headerName] ?? '').trim())
      .filter((val) => val.length > 0 && !val.includes('@'));

    if (nonEmptyCells.length > 0) {
      const totalChars = nonEmptyCells.reduce((sum, val) => sum + val.length, 0);
      const avgLength = totalChars / nonEmptyCells.length;
      const longCellsCount = nonEmptyCells.filter(
        (val) => val.length > MAX_SINGLE_NAME_CELL_LENGTH
      ).length;
      if (avgLength > MAX_AVERAGE_NAME_CELL_LENGTH || longCellsCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extrae un nombre candidato a partir de la parte local de un correo electrónico institucional
 * (por ejemplo, `"simon.kaplan@fds-escuela.edu.ar"` -> `"simon kaplan"`).
 *
 * @param emailText Dirección de correo electrónico.
 * @returns Tokens alfanuméricos de nombre/apellido extraídos antes de `@`, o `''` si no es un correo.
 */
function extractNameCandidateFromEmail(emailText: string): string {
  const trimmed = String(emailText || '').trim().toLowerCase();
  if (!trimmed.includes('@')) return '';
  const localPart = trimmed.split('@')[0] || '';
  return normalizeImportText(localPart.replace(/\d+$/g, '').replace(/[._-]+/g, ' '));
}

/**
 * Busca la mejor coincidencia para un alumno dentro del padrón del curso utilizando
 * coincidencia exacta de correo electrónico, inferencia de nombre desde el usuario del correo (`nombre.apellido@...`),
 * inversión de orden Apellido/Nombre y similitud por tokens, descartando respuestas de texto largo.
 *
 * @param students Lista oficial de alumnos del curso.
 * @param rawName Nombre completo o parcial leído desde la fila importada.
 * @param rawEmail Correo electrónico opcional leído desde la fila importada.
 * @returns El alumno mejor posicionado (`student`) y su índice de confianza (`score` entre `0` y `1`).
 */
export function findBestStudentMatchInRoster(
  students: Student[],
  rawName: string,
  rawEmail?: string
): { student: Student | null; score: number } {
  if (!Array.isArray(students) || students.length === 0) {
    return { student: null, score: NO_MATCH_SCORE };
  }

  const trimmedRawName = String(rawName || '').trim();
  const effectiveEmail =
    rawEmail && String(rawEmail).trim()
      ? String(rawEmail).trim().toLowerCase()
      : trimmedRawName.includes('@')
      ? trimmedRawName.toLowerCase()
      : '';

  if (effectiveEmail) {
    const exactEmailStudent = students.find(
      (student) =>
        student && student.email && student.email.trim().toLowerCase() === effectiveEmail
    );
    if (exactEmailStudent) {
      return { student: exactEmailStudent, score: EXACT_EMAIL_MATCH_SCORE };
    }
  }

  const isRawNameAnEmail = trimmedRawName.includes('@');
  const isRawNameTooLongForPerson =
    !isRawNameAnEmail && trimmedRawName.length > MAX_STUDENT_NAME_CHAR_LENGTH;

  const candidateSearchStrings: Array<{ text: string; isFromEmailPrefix: boolean }> = [];
  if (!isRawNameTooLongForPerson && !isRawNameAnEmail) {
    const normalizedName = normalizeImportText(trimmedRawName);
    const wordCount = normalizedName ? normalizedName.split(/\s+/).filter(Boolean).length : 0;
    if (normalizedName && wordCount <= MAX_STUDENT_NAME_WORD_COUNT) {
      candidateSearchStrings.push({ text: normalizedName, isFromEmailPrefix: false });
    }
  }

  if (effectiveEmail) {
    const emailNameCandidate = extractNameCandidateFromEmail(effectiveEmail);
    if (emailNameCandidate) {
      candidateSearchStrings.push({ text: emailNameCandidate, isFromEmailPrefix: true });
    }
  }

  if (candidateSearchStrings.length === 0) {
    return { student: null, score: NO_MATCH_SCORE };
  }

  let bestMatchedStudent: Student | null = null;
  let highestSimilarityScore = NO_MATCH_SCORE;

  for (const candidate of candidateSearchStrings) {
    const normalizedCandidate = candidate.text;
    for (const student of students) {
      if (!student) continue;
      const normalizedLastName = normalizeImportText(student.lastName);
      const normalizedFirstName = normalizeImportText(student.firstName);
      const fullLastFirst = `${normalizedLastName} ${normalizedFirstName}`;
      const fullFirstLast = `${normalizedFirstName} ${normalizedLastName}`;
      const normalizedStudentEmail = student.email ? normalizeImportText(student.email) : '';

      if (
        normalizedStudentEmail &&
        (normalizedCandidate === normalizedStudentEmail ||
          normalizedCandidate.includes(normalizedStudentEmail))
      ) {
        return { student, score: EXACT_EMAIL_MATCH_SCORE };
      }

      if (normalizedCandidate === fullLastFirst || normalizedCandidate === fullFirstLast) {
        return {
          student,
          score: candidate.isFromEmailPrefix
            ? EMAIL_LOCAL_PART_MATCH_SCORE
            : EXACT_FULL_NAME_MATCH_SCORE,
        };
      }

      if (
        normalizedLastName &&
        normalizedFirstName &&
        normalizedCandidate.includes(normalizedLastName) &&
        normalizedCandidate.includes(normalizedFirstName)
      ) {
        return {
          student,
          score: candidate.isFromEmailPrefix
            ? EMAIL_LOCAL_PART_MATCH_SCORE
            : BOTH_NAMES_CONTAINED_SCORE,
        };
      }

      const rawNameTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
      const studentNameTokens = `${normalizedLastName} ${normalizedFirstName}`
        .split(/\s+/)
        .filter(Boolean);
      let matchedTokenCount = 0;
      for (const token of rawNameTokens) {
        if (studentNameTokens.includes(token)) {
          matchedTokenCount++;
        }
      }
      const tokenSimilarityScore =
        matchedTokenCount / Math.max(rawNameTokens.length, studentNameTokens.length, 1);
      if (tokenSimilarityScore > highestSimilarityScore) {
        highestSimilarityScore = tokenSimilarityScore;
        bestMatchedStudent = student;
      }
    }
  }

  if (highestSimilarityScore >= MIN_FUZZY_MATCH_SCORE_THRESHOLD) {
    return { student: bestMatchedStudent, score: highestSimilarityScore };
  }

  return { student: null, score: NO_MATCH_SCORE };
}

/**
 * Identifica automáticamente las columnas de identidad del estudiante (Apellido/Nombre principal,
 * Nombre separado secundario y Correo electrónico) a partir de los encabezados de la tabla,
 * excluyendo preguntas de examen y columnas de respuestas extensas.
 *
 * @param columnHeaders Lista de encabezados de la hoja o documento importado.
 * @param sampleRows Filas opcionales para descartar columnas con texto largo de desarrollo.
 * @returns Nombres de las columnas asignadas a identidad (`nameCol`, `secondaryNameCol`, `emailCol`).
 */
export function autoDetectIdentityColumns(
  columnHeaders: string[],
  sampleRows?: Array<Record<string, any>>
): {
  nameCol: string;
  secondaryNameCol: string;
  emailCol: string;
} {
  const safeHeaders = Array.isArray(columnHeaders)
    ? columnHeaders.filter((header) => typeof header === 'string' && header.trim() !== '')
    : [];
  if (safeHeaders.length === 0) {
    return { nameCol: '', secondaryNameCol: '', emailCol: '' };
  }

  const emailCol =
    safeHeaders.find((columnName) =>
      /\b(email|correo|mail)\b|direccion de correo/i.test(normalizeImportText(columnName))
    ) || '';

  const nonQuestionHeaders = safeHeaders.filter(
    (columnName) =>
      columnName !== emailCol &&
      !/^(marca temporal|timestamp|puntuacion|score|puntaje|nota|calificacion|nota final)$/i.test(
        normalizeImportText(columnName)
      ) &&
      !isQuestionOrLongTextColumn(columnName, sampleRows)
  );

  let nameCol = '';
  let secondaryNameCol = '';

  const exactLastNameColumn = nonQuestionHeaders.find((columnName) =>
    /^apellido(s)?$/i.test(normalizeImportText(columnName))
  );
  const exactFirstNameColumn = nonQuestionHeaders.find(
    (columnName) =>
      columnName !== exactLastNameColumn && /^nombre(s)?$/i.test(normalizeImportText(columnName))
  );

  if (exactLastNameColumn && exactFirstNameColumn) {
    nameCol = exactLastNameColumn;
    secondaryNameCol = exactFirstNameColumn;
  } else {
    nameCol =
      nonQuestionHeaders.find((columnName) =>
        /\b(alumno|alumnos|nombre|nombres|estudiante|estudiantes|apellido|apellidos|nom|ape|persona)\b/i.test(
          normalizeImportText(columnName)
        )
      ) ||
      emailCol ||
      nonQuestionHeaders[0] ||
      safeHeaders[0] ||
      '';
  }

  return { nameCol, secondaryNameCol, emailCol };
}

/**
 * Interpreta el valor de una celda hacia un número válido según el rol de la columna.
 * Soporta decimales con coma o punto, fracciones ("8 / 10"), descuentos negativos ("-1,5")
 * y escalas conceptuales argentinas (`EX`=10, `MB`=9, `B`=8, `R`=6, `I`=4).
 *
 * @param rawCellValue Valor crudo de la celda.
 * @param columnKind Tipo semántico asignado a la columna (`grade`, `disposition`, `disposition_deduction`, `absences`, `lates`).
 * @returns El valor numérico normalizado (`numVal`) y un indicador booleano de validez (`isValid`) dentro del rango permitido.
 */
export function parseFlexibleCellNumber(
  rawCellValue: any,
  columnKind: DetectedColumnConfig['kind']
): { numVal: number; isValid: boolean } {
  const rawCellString = String(rawCellValue ?? '').trim();
  if (!rawCellString || rawCellString === EMPTY_CELL_DASH) {
    return { numVal: NaN, isValid: false };
  }

  const upperCaseText = rawCellString.toUpperCase();
  if (columnKind === 'disposition' || columnKind === 'grade') {
    if (
      upperCaseText === 'EX' ||
      upperCaseText === 'EXCELENTE' ||
      upperCaseText === 'S' ||
      upperCaseText === 'SOBRESALIENTE'
    ) {
      return { numVal: CONCEPTUAL_GRADE_EXCELLENT, isValid: true };
    }
    if (upperCaseText === 'MB' || upperCaseText === 'MUY BUENO') {
      return { numVal: CONCEPTUAL_GRADE_VERY_GOOD, isValid: true };
    }
    if (upperCaseText === 'B' || upperCaseText === 'BUENO') {
      return { numVal: CONCEPTUAL_GRADE_GOOD, isValid: true };
    }
    if (upperCaseText === 'R' || upperCaseText === 'REGULAR') {
      return { numVal: CONCEPTUAL_GRADE_REGULAR, isValid: true };
    }
    if (
      upperCaseText === 'M' ||
      upperCaseText === 'MALO' ||
      upperCaseText === 'I' ||
      upperCaseText === 'INSUFICIENTE'
    ) {
      return { numVal: CONCEPTUAL_GRADE_INSUFFICIENT, isValid: true };
    }
  }

  if (columnKind === 'grade') {
    const fractionMatch = rawCellString.match(
      /^(-?\d+(?:[.,]\d+)?)\s*(?:\/|de|sobre)\s*(\d+(?:[.,]\d+)?)$/i
    );
    if (fractionMatch) {
      const earnedPoints = parseFloat(fractionMatch[1].replace(',', '.'));
      const maxPossiblePoints = parseFloat(fractionMatch[2].replace(',', '.'));
      if (!isNaN(earnedPoints) && !isNaN(maxPossiblePoints) && maxPossiblePoints > 0) {
        const scaledGrade =
          maxPossiblePoints === MAX_GRADE_SCORE
            ? earnedPoints
            : (earnedPoints / maxPossiblePoints) * MAX_GRADE_SCORE;
        return {
          numVal: Number(scaledGrade.toFixed(TWO_DECIMAL_PRECISION)),
          isValid: scaledGrade >= MIN_GRADE_SCORE && scaledGrade <= MAX_GRADE_SCORE,
        };
      }
    }
  }

  const normalizedDecimalText = rawCellString.replace(',', '.');
  const numericTokenMatch = normalizedDecimalText.match(/-?\d+(?:\.\d+)?/);
  if (!numericTokenMatch) {
    return { numVal: NaN, isValid: false };
  }

  const parsedNumber = parseFloat(numericTokenMatch[0]);
  if (isNaN(parsedNumber)) {
    return { numVal: NaN, isValid: false };
  }

  if (columnKind === 'disposition_deduction') {
    const absoluteDeduction = Math.abs(parsedNumber);
    const resultingDisposition = Math.max(
      MIN_DISPOSITION_SCORE,
      Math.min(MAX_DISPOSITION_SCORE, MAX_DISPOSITION_SCORE - absoluteDeduction)
    );
    return {
      numVal: resultingDisposition,
      isValid: absoluteDeduction >= MIN_GRADE_SCORE && absoluteDeduction <= MAX_DISPOSITION_SCORE,
    };
  }

  if (columnKind === 'disposition') {
    // Muchos docentes anotan "-1" o "-2" directamente en la columna de Disposición como puntos a descontar sobre la base de 10.
    if (parsedNumber < 0 && parsedNumber >= MAX_NEGATIVE_DISPOSITION_DEDUCTION) {
      return {
        numVal: Math.max(MIN_DISPOSITION_SCORE, MAX_DISPOSITION_SCORE + parsedNumber),
        isValid: true,
      };
    }
    return {
      numVal: parsedNumber,
      isValid: parsedNumber >= MIN_GRADE_SCORE && parsedNumber <= MAX_DISPOSITION_SCORE,
    };
  }

  if (columnKind === 'grade') {
    return {
      numVal: parsedNumber,
      isValid: parsedNumber >= MIN_GRADE_SCORE && parsedNumber <= MAX_GRADE_SCORE,
    };
  }

  if (columnKind === 'absences' || columnKind === 'lates') {
    const absoluteAttendanceCount = Math.abs(parsedNumber);
    return {
      numVal: absoluteAttendanceCount,
      isValid: absoluteAttendanceCount >= MIN_GRADE_SCORE,
    };
  }

  return { numVal: parsedNumber, isValid: true };
}

/**
 * Clasifica automáticamente cada columna no-identitaria de una planilla importada
 * en su rol pedagógico (Calificación + Categoría/Subcategoría, Inasistencias, Tardanzas, Disposición o Ignorar).
 *
 * @param columnHeaders Encabezados de la tabla importada.
 * @param nameCol Columna asignada al nombre principal del alumno.
 * @param emailCol Columna asignada al correo electrónico.
 * @param categories Categorías de calificación existentes en el curso/cuatrimestre activo.
 * @param secondaryNameCol Columna opcional asignada al nombre de pila cuando viene separado del apellido.
 * @param importContext Contexto desde el cual se abrió el importador (`'grades'` o `'attendance'`).
 * @param attendanceDefaultKind Tipo por defecto cuando se importa una única columna desde el módulo de Asistencia.
 * @returns Arreglo de configuraciones detectadas (`DetectedColumnConfig[]`) para todas las columnas de datos.
 */
export function autoDetectColumnsConfiguration(
  columnHeaders: string[],
  nameCol: string,
  emailCol: string,
  categories: GradeCategory[],
  secondaryNameCol = '',
  importContext: 'grades' | 'attendance' = 'grades',
  attendanceDefaultKind: 'disposition' | 'absences' | 'both' = 'disposition',
  sampleRows?: Array<Record<string, any>>
): DetectedColumnConfig[] {
  const columnConfigurations: DetectedColumnConfig[] = [];
  const defaultCategory = categories[0] || {
    id: DEFAULT_CATEGORY_ID,
    name: DEFAULT_EVALUATION_CATEGORY_NAME,
    weight: DEFAULT_CATEGORY_WEIGHT,
    subcategories: [],
  };

  const includeAttendanceColumns = importContext === 'attendance';

  const createNonGradeConfig = (
    columnKey: string,
    subcategoryLabel: string,
    kind: DetectedColumnConfig['kind'],
    isIncluded = true
  ): DetectedColumnConfig => ({
    colKey: columnKey,
    isIncluded,
    kind,
    targetCategoryMode: 'existing',
    targetCategoryId: defaultCategory.id,
    newCategoryName: '',
    targetSubcategoryMode: 'new',
    targetSubcategoryId: '',
    subcategoryName: subcategoryLabel,
  });

  columnHeaders.forEach((columnHeader) => {
    if (
      columnHeader === nameCol ||
      columnHeader === secondaryNameCol ||
      columnHeader === emailCol
    ) {
      return;
    }

    const trimmedHeader = columnHeader.trim();
    const normalizedHeader = normalizeImportText(trimmedHeader);

    const hasValidGradeSample =
      !Array.isArray(sampleRows) || sampleRows.length === 0
        ? true
        : sampleRows
            .slice(0, 20)
            .some(
              (rowRecord) =>
                rowRecord &&
                typeof rowRecord === 'object' &&
                parseFlexibleCellNumber(rowRecord[columnHeader], 'grade').isValid
            );

    const isSummaryOrMetadataColumn =
      /^n$|^nro$|^numero$|^id$|^legajo$|^orden$|^dni$|^documento$|^curso$|^division$|marca temporal|timestamp|condicion|estado|ultima actualizacion|ultima incidencia|asistencia %|% asistencia|fecha|hora|pregunta|consigna|observacion|comentario|devolucion|feedback|descripcion|respuesta/i.test(
        normalizedHeader
      ) ||
      isQuestionOrLongTextColumn(trimmedHeader, sampleRows) ||
      (importContext === 'grades' && !hasValidGradeSample);

    if (
      /ausencia|falta|inasistencia|ausentes/i.test(normalizedHeader) &&
      !/justificada/i.test(normalizedHeader)
    ) {
      columnConfigurations.push(
        createNonGradeConfig(columnHeader, trimmedHeader, 'absences', includeAttendanceColumns)
      );
      return;
    }

    if (/tardanza|llegada tarde|tardes|\btarde\b|demora/i.test(normalizedHeader)) {
      columnConfigurations.push(
        createNonGradeConfig(columnHeader, trimmedHeader, 'lates', includeAttendanceColumns)
      );
      return;
    }

    if (/descuento|puntos menos|resta|sancion|negativo/i.test(normalizedHeader)) {
      columnConfigurations.push(
        createNonGradeConfig(
          columnHeader,
          trimmedHeader,
          'disposition_deduction',
          includeAttendanceColumns
        )
      );
      return;
    }

    if (
      /disposicion|conducta|actitud|comportamiento|nota disp|concepto|participacion|desempeno/i.test(
        normalizedHeader
      ) &&
      (importContext === 'attendance' ||
        /disposicion|conducta|actitud|comportamiento|nota disp/i.test(normalizedHeader))
    ) {
      columnConfigurations.push(
        createNonGradeConfig(columnHeader, trimmedHeader, 'disposition', includeAttendanceColumns)
      );
      return;
    }

    const nonIdentityColumns = columnHeaders.filter(
      (candidateCol) =>
        candidateCol !== nameCol &&
        candidateCol !== secondaryNameCol &&
        candidateCol !== emailCol
    );
    const nonIdentityColumnIndex = nonIdentityColumns.indexOf(columnHeader);
    const looksLikeExplicitEvaluationColumn =
      /calific|tp|trabajo|practico|parcial|examen|eval|prueba|trimestre|cuatrimestre|oral|escrito|entrega/i.test(
        normalizedHeader
      );

    if (
      importContext === 'attendance' &&
      nonIdentityColumns.length === 1 &&
      !looksLikeExplicitEvaluationColumn
    ) {
      const targetAttendanceKind =
        attendanceDefaultKind === 'absences' ? 'absences' : 'disposition';
      columnConfigurations.push(
        createNonGradeConfig(columnHeader, trimmedHeader, targetAttendanceKind)
      );
      return;
    }

    if (
      importContext === 'attendance' &&
      attendanceDefaultKind === 'both' &&
      nonIdentityColumns.length === 2 &&
      !looksLikeExplicitEvaluationColumn
    ) {
      const pairedAttendanceKind = nonIdentityColumnIndex === 0 ? 'absences' : 'disposition';
      columnConfigurations.push(
        createNonGradeConfig(columnHeader, trimmedHeader, pairedAttendanceKind)
      );
      return;
    }

    if (isSummaryOrMetadataColumn) {
      columnConfigurations.push(createNonGradeConfig(columnHeader, trimmedHeader, 'ignore', false));
      return;
    }

    let parsedCategoryName = '';
    let parsedSubcategoryName = trimmedHeader;
    if (trimmedHeader.includes(' - ')) {
      const headerSegments = trimmedHeader
        .split(' - ')
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (headerSegments.length >= 2) {
        parsedCategoryName = headerSegments[0];
        parsedSubcategoryName = headerSegments.slice(1).join(' - ');
      }
    } else if (trimmedHeader.includes(': ')) {
      const headerSegments = trimmedHeader
        .split(': ')
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (headerSegments.length >= 2) {
        parsedCategoryName = headerSegments[0];
        parsedSubcategoryName = headerSegments.slice(1).join(': ');
      }
    }

    let matchedCategory: GradeCategory | undefined;
    if (parsedCategoryName) {
      const normalizedParsedCategory = normalizeImportText(parsedCategoryName);
      matchedCategory = categories.find(
        (category) =>
          normalizeImportText(category.name) === normalizedParsedCategory ||
          normalizeImportText(category.name).includes(normalizedParsedCategory) ||
          normalizedParsedCategory.includes(normalizeImportText(category.name))
      );
    }

    if (!matchedCategory) {
      if (/^tp\b|trabajo practico|guia|entrega|actividad|tarea/i.test(normalizedHeader)) {
        matchedCategory = categories.find((category) =>
          /trabajo|practico|tp|actividad/i.test(normalizeImportText(category.name))
        );
      } else if (
        /examen|parcial|evaluacion|prueba|recuperatorio|integrador|diagnostica|puntuacion|puntaje|score|nota/i.test(
          normalizedHeader
        )
      ) {
        matchedCategory = categories.find((category) =>
          /evaluacion|examen|parcial|prueba/i.test(normalizeImportText(category.name))
        );
      } else if (/concepto|participacion|desempeno|carpeta/i.test(normalizedHeader)) {
        matchedCategory = categories.find((category) =>
          /concepto|desempeno|participacion/i.test(normalizeImportText(category.name))
        );
      }
    }

    let matchedSubcategoryId = '';
    for (const category of categories) {
      const existingSubcategory = category.subcategories.find(
        (subcategory) =>
          normalizeImportText(subcategory.name) === normalizeImportText(parsedSubcategoryName)
      );
      if (existingSubcategory) {
        matchedCategory = category;
        matchedSubcategoryId = existingSubcategory.id;
        break;
      }
    }

    if (matchedCategory) {
      if (!matchedSubcategoryId) {
        const subcategoryInMatchedCategory = matchedCategory.subcategories.find(
          (subcategory) =>
            normalizeImportText(subcategory.name) === normalizeImportText(parsedSubcategoryName)
        );
        if (subcategoryInMatchedCategory) {
          matchedSubcategoryId = subcategoryInMatchedCategory.id;
        }
      }

      columnConfigurations.push({
        colKey: columnHeader,
        isIncluded: importContext === 'grades',
        kind: 'grade',
        targetCategoryMode: 'existing',
        targetCategoryId: matchedCategory.id,
        newCategoryName: parsedCategoryName || matchedCategory.name,
        targetSubcategoryMode: matchedSubcategoryId ? 'existing' : 'new',
        targetSubcategoryId: matchedSubcategoryId || '',
        subcategoryName: parsedSubcategoryName,
      });
    } else if (parsedCategoryName) {
      columnConfigurations.push({
        colKey: columnHeader,
        isIncluded: importContext === 'grades',
        kind: 'grade',
        targetCategoryMode: 'new',
        targetCategoryId: defaultCategory.id,
        newCategoryName: parsedCategoryName,
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: parsedSubcategoryName,
      });
    } else {
      columnConfigurations.push({
        colKey: columnHeader,
        isIncluded: importContext === 'grades',
        kind: 'grade',
        targetCategoryMode: categories.length > 0 ? 'existing' : 'new',
        targetCategoryId: defaultCategory.id,
        newCategoryName: DEFAULT_GRADES_CATEGORY_NAME,
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: parsedSubcategoryName,
      });
    }
  });

  // En el contexto de Calificaciones, si hay múltiples columnas numéricas intermedias,
  // se selecciona únicamente la columna principal de Nota/Puntuación por defecto para mostrar solo Alumno + Nota.
  if (importContext === 'grades') {
    const includedGradeConfigs = columnConfigurations.filter(
      (config) => config.isIncluded && config.kind === 'grade'
    );
    if (includedGradeConfigs.length > 1) {
      const explicitPrimaryGrade =
        includedGradeConfigs.find((config) =>
          /^(nota|nota final|calificacion|calificacion final|puntuacion|puntaje|puntaje total|score|promedio)$/i.test(
            normalizeImportText(config.colKey)
          )
        ) ||
        includedGradeConfigs.find((config) =>
          /\b(nota|calificacion|puntuacion|puntaje|score|evaluacion|parcial|examen|tp)\b/i.test(
            normalizeImportText(config.colKey)
          )
        ) ||
        includedGradeConfigs[0];

      return columnConfigurations.map((config) => {
        if (config.kind !== 'grade') return { ...config, isIncluded: false };
        return {
          ...config,
          isIncluded: config.colKey === explicitPrimaryGrade.colKey,
        };
      });
    }
  }

  return columnConfigurations;
}

/**
 * Convierte bloques de texto libre (provenientes de Google Docs, Word, archivos `.txt` o listas pegadas)
 * en una matriz bidimensional normalizada con fila de encabezado garantizada.
 *
 * @param textContent Texto plano con líneas de alumnos y calificaciones.
 * @returns Matriz 2D lista para transformarse en objetos de tabla.
 */
export function parseTextLinesTo2DGrid(textContent: string): any[][] {
  const nonEmptyLines = String(textContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length === 0) return [];

  const minDelimitedLinesThreshold = Math.max(
    1,
    Math.floor(nonEmptyLines.length * DELIMITER_LINE_RATIO_THRESHOLD)
  );
  const tabDelimitedCount = nonEmptyLines.filter((line) => line.includes('\t')).length;
  const semicolonDelimitedCount = nonEmptyLines.filter((line) => line.includes(';')).length;
  const pipeDelimitedCount = nonEmptyLines.filter((line) => line.includes('|')).length;

  let parsedRows: string[][] = [];

  if (tabDelimitedCount >= minDelimitedLinesThreshold) {
    parsedRows = nonEmptyLines.map((line) => line.split('\t').map((cell) => cell.trim()));
  } else if (pipeDelimitedCount >= minDelimitedLinesThreshold) {
    parsedRows = nonEmptyLines
      .map((line) =>
        line
          .replace(/^\|+|\|+$/g, '')
          .split('|')
          .map((cell) => cell.trim())
      )
      // Se descartan las filas separadoras de tablas Markdown (ej. `|---|---|`) para que no se interpreten como alumnos.
      .filter((rowCells) => !rowCells.every((cell) => /^[-:]+$/.test(cell)));
  } else if (semicolonDelimitedCount >= minDelimitedLinesThreshold) {
    parsedRows = nonEmptyLines.map((line) => line.split(';').map((cell) => cell.trim()));
  } else {
    parsedRows = nonEmptyLines.map((rawLine) => {
      const lineWithoutLeadingIndex = rawLine.replace(/^\d+\s*[.):\-]\s*/, '').trim();
      const dashOrColonScoreMatch = lineWithoutLeadingIndex.match(
        /^(.+?)\s*(?:[-–—:=]+)\s*(-?\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|EX|EXCELENTE|MB|MUY BUENO|B|BUENO|R|REGULAR|I|INSUFICIENTE)$/i
      );
      if (dashOrColonScoreMatch) {
        return [dashOrColonScoreMatch[1].trim(), dashOrColonScoreMatch[2].trim()];
      }

      const trailingNumberMatch = lineWithoutLeadingIndex.match(
        /^([a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s,.'’-]+?)\s+(-?\d+(?:[.,]\d+)?|EX|MB|B|R)$/i
      );
      if (trailingNumberMatch) {
        return [trailingNumberMatch[1].trim(), trailingNumberMatch[2].trim()];
      }

      const commaSeparatedParts = lineWithoutLeadingIndex
        .split(',')
        .map((segment) => segment.trim());
      if (
        commaSeparatedParts.length >= 2 &&
        /^-?\d+(?:[.,]\d+)?$/.test(commaSeparatedParts[commaSeparatedParts.length - 1])
      ) {
        const trailingScoreSegment = commaSeparatedParts[commaSeparatedParts.length - 1];
        const studentNameSegment = commaSeparatedParts.slice(0, -1).join(', ');
        return [studentNameSegment, trailingScoreSegment];
      }

      return [lineWithoutLeadingIndex];
    });
  }

  return ensureHeaderRowIn2DGrid(parsedRows);
}

/**
 * Garantiza que la primera fila de una matriz 2D corresponda a encabezados de columna.
 * Si detecta que la fila 0 ya contiene directamente el nombre de un alumno y una nota numérica,
 * antepone encabezados sintéticos para evitar que el primer alumno de la lista se pierda como cabecera.
 *
 * @param rawGrid Matriz 2D original.
 * @returns Matriz 2D con fila de encabezados en la posición `0`.
 */
export function ensureHeaderRowIn2DGrid(rawGrid: any[][]): any[][] {
  const nonEmptyRows = rawGrid.filter(
    (rowCells) =>
      Array.isArray(rowCells) && rowCells.some((cellValue) => String(cellValue ?? '').trim() !== '')
  );
  if (nonEmptyRows.length === 0) return [];

  const firstRowCells = nonEmptyRows[0].map((cellValue) => String(cellValue ?? '').trim());
  const maxColumnCount = Math.max(...nonEmptyRows.map((rowCells) => rowCells.length), 1);

  if (maxColumnCount === 1) {
    const firstCellText = firstRowCells[0] || '';
    const isKnownHeaderKeyword =
      /^(alumno|estudiante|nombre|apellido|nota|disposicion|calificacion)/i.test(
        normalizeImportText(firstCellText)
      );
    if (!isKnownHeaderKeyword) {
      const looksNumeric = /^-?\d+(?:[.,]\d+)?$/.test(firstCellText);
      return [
        [looksNumeric ? SYNTHETIC_HEADER_DISPOSITION : SYNTHETIC_HEADER_STUDENT],
        ...nonEmptyRows,
      ];
    }
    return nonEmptyRows;
  }

  const hasExplicitHeaderKeyword = firstRowCells.some((cellText) =>
    /^(alumno|alumnos|estudiante|estudiantes|nombre|nombres|apellido|apellidos|disposicion|nota|notas|calificacion|ausencia|falta|tardanza|email|correo|tp|examen|parcial|concepto|conducta)/i.test(
      normalizeImportText(cellText)
    )
  );

  if (!hasExplicitHeaderKeyword) {
    const hasNumericOrConceptualValueInFirstRow = firstRowCells
      .slice(1)
      .some((cellText) => /^-?\d+(?:[.,]\d+)?$/.test(cellText) || /^(EX|MB|B|R)$/i.test(cellText));
    if (hasNumericOrConceptualValueInFirstRow) {
      const syntheticHeaders = [SYNTHETIC_HEADER_STUDENT];
      for (let columnIndex = 1; columnIndex < maxColumnCount; columnIndex++) {
        syntheticHeaders.push(
          columnIndex === 1 ? SYNTHETIC_HEADER_DISPOSITION : `Columna ${columnIndex + 1}`
        );
      }
      return [syntheticHeaders, ...nonEmptyRows];
    }
  }

  return nonEmptyRows;
}

/**
 * Extrae una matriz 2D desde contenido HTML (exportación de Google Docs, archivos `.doc`/`.html` o tablas web)
 * o recurre al parser de líneas de texto si el documento no contiene tablas HTML.
 *
 * @param htmlOrTextContent Cadena con marcado HTML o texto plano.
 * @returns Matriz 2D normalizada con encabezados y filas de datos.
 */
export function parseHtmlOrTextDocumentTo2DGrid(htmlOrTextContent: string): any[][] {
  const trimmedContent = String(htmlOrTextContent || '').trim();
  if (!trimmedContent) return [];

  if (
    typeof DOMParser !== 'undefined' &&
    /<(table|tr|td|th|p|div|li|html|body)\b/i.test(trimmedContent)
  ) {
    try {
      const domParser = new DOMParser();
      const htmlDocument = domParser.parseFromString(trimmedContent, 'text/html');

      const tableElements = Array.from(htmlDocument.querySelectorAll('table'));
      if (tableElements.length > 0) {
        let largestTableGrid: string[][] = [];
        for (const tableElement of tableElements) {
          const tableRowElements = Array.from(tableElement.querySelectorAll('tr'));
          const extractedTableRows: string[][] = [];
          for (const rowElement of tableRowElements) {
            const rowCells = Array.from(rowElement.querySelectorAll('th, td')).map((cellElement) =>
              (cellElement.textContent || '').replace(/\s+/g, ' ').trim()
            );
            if (rowCells.some((cellText) => cellText !== '')) {
              extractedTableRows.push(rowCells);
            }
          }
          // Cuando un documento tiene un encabezado institucional en una tabla pequeña arriba y la nómina de alumnos abajo, se elige la tabla con más filas.
          if (extractedTableRows.length > largestTableGrid.length) {
            largestTableGrid = extractedTableRows;
          }
        }
        if (largestTableGrid.length > 0) {
          return ensureHeaderRowIn2DGrid(largestTableGrid);
        }
      }

      const textBlockElements = Array.from(
        htmlDocument.querySelectorAll('p, li, h1, h2, h3, h4, tr')
      );
      if (textBlockElements.length > 0) {
        const extractedLines = textBlockElements
          .map((blockElement) => (blockElement.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        if (extractedLines.length > 0) {
          return parseTextLinesTo2DGrid(extractedLines.join('\n'));
        }
      }

      const documentBodyText =
        htmlDocument.body?.innerText || htmlDocument.body?.textContent || '';
      if (documentBodyText.trim()) {
        return parseTextLinesTo2DGrid(documentBodyText);
      }
    } catch (htmlParseError) {
      console.warn('Fallback to text parser after HTML parse notice:', htmlParseError);
    }
  }

  return parseTextLinesTo2DGrid(trimmedContent);
}

/**
 * Descomprime en el navegador la entrada `word/document.xml` de un archivo binario `.docx` (contenedor ZIP)
 * utilizando `DecompressionStream` nativo y transforma sus tablas (`<w:tbl>`) o párrafos (`<w:p>`) en una matriz 2D.
 *
 * @param arrayBuffer Buffer binario del archivo `.docx`.
 * @returns Promesa con la matriz 2D extraída o `[]` si el archivo está corrupto o vacío.
 */
export async function parseDocxArrayBufferTo2DGrid(arrayBuffer: ArrayBuffer): Promise<any[][]> {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) return [];

  try {
    const archiveBytes = new Uint8Array(arrayBuffer);
    const dataView = new DataView(arrayBuffer);

    let byteOffset = 0;
    let documentXmlText = '';

    while (byteOffset + ZIP_HEADER_MIN_BYTES < archiveBytes.length) {
      const headerSignature = dataView.getUint32(byteOffset, true);
      if (headerSignature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        byteOffset++;
        continue;
      }

      const compressionMethod = dataView.getUint16(
        byteOffset + ZIP_COMPRESSION_METHOD_OFFSET,
        true
      );
      const compressedSize = dataView.getUint32(byteOffset + ZIP_COMPRESSED_SIZE_OFFSET, true);
      const fileNameLength = dataView.getUint16(byteOffset + ZIP_FILENAME_LENGTH_OFFSET, true);
      const extraFieldLength = dataView.getUint16(
        byteOffset + ZIP_EXTRA_FIELD_LENGTH_OFFSET,
        true
      );

      if (byteOffset + ZIP_HEADER_MIN_BYTES + fileNameLength > archiveBytes.length) {
        break;
      }

      const fileNameBytes = archiveBytes.subarray(
        byteOffset + ZIP_HEADER_MIN_BYTES,
        byteOffset + ZIP_HEADER_MIN_BYTES + fileNameLength
      );
      const zipEntryName = new TextDecoder('utf-8').decode(fileNameBytes);
      const payloadStartOffset =
        byteOffset + ZIP_HEADER_MIN_BYTES + fileNameLength + extraFieldLength;

      if (zipEntryName === WORD_DOCUMENT_XML_ENTRY_PATH) {
        let payloadEndOffset = payloadStartOffset + compressedSize;
        // Cuando un generador ZIP activa el bit de Data Descriptor (bit 3), `compressedSize` viene en 0 en la cabecera local y es necesario escanear hasta la próxima firma PK.
        if (compressedSize === 0 || payloadEndOffset > archiveBytes.length) {
          payloadEndOffset = archiveBytes.length;
          for (
            let scanOffset = payloadStartOffset;
            scanOffset < archiveBytes.length - 4;
            scanOffset++
          ) {
            const isNextPkHeader =
              archiveBytes[scanOffset] === PK_SIGNATURE_BYTE_0 &&
              archiveBytes[scanOffset + 1] === PK_SIGNATURE_BYTE_1 &&
              (archiveBytes[scanOffset + 2] === PK_LOCAL_HEADER_MARKER ||
                archiveBytes[scanOffset + 2] === PK_CENTRAL_DIR_MARKER ||
                archiveBytes[scanOffset + 2] === PK_DATA_DESCRIPTOR_MARKER);
            if (isNextPkHeader) {
              payloadEndOffset = scanOffset;
              break;
            }
          }
        }

        const compressedPayloadSlice = archiveBytes.subarray(payloadStartOffset, payloadEndOffset);
        if (compressionMethod === ZIP_COMPRESSION_STORED) {
          documentXmlText = new TextDecoder('utf-8').decode(compressedPayloadSlice);
        } else if (
          compressionMethod === ZIP_COMPRESSION_DEFLATE &&
          typeof DecompressionStream !== 'undefined'
        ) {
          const decompressionStream = new DecompressionStream('deflate-raw');
          const streamWriter = decompressionStream.writable.getWriter();
          streamWriter.write(compressedPayloadSlice).catch(() => {});
          streamWriter.close().catch(() => {});
          const decompressedBuffer = await new Response(
            decompressionStream.readable
          ).arrayBuffer();
          documentXmlText = new TextDecoder('utf-8').decode(decompressedBuffer);
        }
        break;
      }

      // Se garantiza un avance mínimo de 1 byte cuando `compressedSize` es 0 para impedir bucles infinitos ante entradas ZIP con Data Descriptor.
      byteOffset = payloadStartOffset + (compressedSize > 0 ? compressedSize : 1);
    }

    if (!documentXmlText) {
      const fallbackDecodedText = new TextDecoder('utf-8').decode(archiveBytes);
      return parseHtmlOrTextDocumentTo2DGrid(fallbackDecodedText);
    }

    const domParser = new DOMParser();
    const xmlDocument = domParser.parseFromString(documentXmlText, 'application/xml');

    const wordTables = Array.from(xmlDocument.getElementsByTagNameNS('*', 'tbl'));
    if (wordTables.length > 0) {
      let largestTableRows: string[][] = [];
      for (const tableNode of wordTables) {
        const tableRowNodes = Array.from(tableNode.getElementsByTagNameNS('*', 'tr'));
        const currentTableRows: string[][] = [];
        for (const rowNode of tableRowNodes) {
          const tableCellNodes = Array.from(rowNode.getElementsByTagNameNS('*', 'tc'));
          const rowCellStrings = tableCellNodes.map((cellNode) => {
            const textNodes = Array.from(cellNode.getElementsByTagNameNS('*', 't'));
            return textNodes
              .map((textNode) => textNode.textContent || '')
              .join('')
              .replace(/\s+/g, ' ')
              .trim();
          });
          if (rowCellStrings.some((cellText) => cellText !== '')) {
            currentTableRows.push(rowCellStrings);
          }
        }
        if (currentTableRows.length > largestTableRows.length) {
          largestTableRows = currentTableRows;
        }
      }
      if (largestTableRows.length > 0) {
        return ensureHeaderRowIn2DGrid(largestTableRows);
      }
    }

    const wordParagraphs = Array.from(xmlDocument.getElementsByTagNameNS('*', 'p'));
    const paragraphLines: string[] = [];
    for (const paragraphNode of wordParagraphs) {
      const textNodes = Array.from(paragraphNode.getElementsByTagNameNS('*', 't'));
      const paragraphText = textNodes
        .map((textNode) => textNode.textContent || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (paragraphText) paragraphLines.push(paragraphText);
    }

    return parseTextLinesTo2DGrid(paragraphLines.join('\n'));
  } catch (docxParseError) {
    console.warn('Error defensivo al decodificar archivo DOCX:', docxParseError);
    return [];
  }
}

/**
 * Construye una lista de opciones legibles por cada fila del documento importado
 * para que el docente pueda reasignar manualmente en un selector desplegable qué fila pertenece a cada alumno.
 *
 * @param rawRows Filas de datos del documento importado.
 * @param nameCol Columna de nombre principal.
 * @param secondaryNameCol Columna de nombre secundario.
 * @param emailCol Columna de correo electrónico.
 * @param columnConfigs Configuraciones de columnas para mostrar un resumen de valores junto al nombre.
 * @returns Arreglo de opciones descriptivas por fila excluyendo filas de totales o promedios.
 */
export function buildDocumentRowOptions(
  rawRows: Array<Record<string, any>>,
  nameCol: string,
  secondaryNameCol: string,
  emailCol: string,
  columnConfigs: DetectedColumnConfig[]
): Array<{
  rawRowIndex: number;
  rawName: string;
  rawEmail: string;
  summaryPreview: string;
}> {
  const includedColumnConfigs = columnConfigs.filter(
    (config) => config.isIncluded && config.kind !== 'ignore'
  );

  return rawRows
    .map((rowRecord, rowIndex) => {
      const primaryName =
        nameCol && nameCol !== ORDER_BY_ROSTER_KEY ? String(rowRecord[nameCol] ?? '').trim() : '';
      const secondaryName = secondaryNameCol
        ? String(rowRecord[secondaryNameCol] ?? '').trim()
        : '';
      const rawName =
        nameCol === ORDER_BY_ROSTER_KEY
          ? `Fila #${rowIndex + 1}`
          : primaryName && secondaryName
          ? `${primaryName}, ${secondaryName}`
          : primaryName || secondaryName || `Fila #${rowIndex + 1}`;
      const rawEmail = emailCol ? String(rowRecord[emailCol] ?? '').trim() : '';

      const cellPreviews: string[] = [];
      for (const columnConfig of includedColumnConfigs.slice(0, MAX_PREVIEW_COLUMNS_PER_ROW)) {
        const cellValue = String(rowRecord[columnConfig.colKey] ?? '').trim();
        if (cellValue && cellValue !== EMPTY_CELL_DASH) {
          const shortColumnLabel =
            columnConfig.kind === 'disposition'
              ? 'Disp'
              : columnConfig.kind === 'disposition_deduction'
              ? 'Desc'
              : columnConfig.kind === 'absences'
              ? 'Faltas'
              : columnConfig.kind === 'lates'
              ? 'Tardes'
              : columnConfig.subcategoryName || columnConfig.colKey;
          cellPreviews.push(`${shortColumnLabel}: ${cellValue}`);
        }
      }

      return {
        rawRowIndex: rowIndex,
        rawName,
        rawEmail,
        summaryPreview: cellPreviews.join(' · '),
      };
    })
    .filter((optionItem) => {
      if (!optionItem.rawName) return false;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(
          optionItem.rawName
        )
      ) {
        return false;
      }
      return true;
    });
}

/**
 * Genera la tabla completa de verificación multicolumna cruzando el padrón del curso con las filas importadas,
 * respetando primero las vinculaciones manuales del docente (`manualRowMatches`), luego el modo por orden de lista
 * o la coincidencia difusa, y anexando al final los alumnos nuevos presentes en el archivo.
 *
 * @param students Padrón actual de alumnos del curso.
 * @param rawRows Filas extraídas del documento importado.
 * @param nameCol Columna de nombre o `'__ORDER__'` para asignación posicional por orden alfabético.
 * @param emailCol Columna de correo electrónico.
 * @param columnConfigs Configuración de cada columna a importar.
 * @param activeGradesMap Mapa de calificaciones vigentes del cuatrimestre para detectar altas vs. modificaciones.
 * @param activeDispositionMap Mapa de inasistencias, tardanzas y disposición vigentes por alumno.
 * @param secondaryNameCol Columna de nombre secundario opcional.
 * @param manualRowMatches Diccionario de sobrescrituras manuales (`studentId -> rawRowIndex | null`).
 * @returns Filas verificadas (`rowsResult`) y bandera `shouldAutoEnableNewStudents` cuando el curso aún no tenía alumnos cargados.
 */
export function computeMultiVerificationRows(
  students: Student[],
  rawRows: Array<Record<string, any>>,
  nameCol: string,
  emailCol: string,
  columnConfigs: DetectedColumnConfig[],
  activeGradesMap: StudentGradesMap,
  activeDispositionMap: Record<
    string,
    { totalAbsences: number; totalLates?: number; totalDisposition: number }
  >,
  secondaryNameCol = '',
  manualRowMatches: Record<string, number | null> = {}
): {
  rowsResult: MultiVerifiedStudentRow[];
  shouldAutoEnableNewStudents: boolean;
} {
  const matchedRowByStudentId: Record<
    string,
    {
      rawRow: Record<string, any>;
      rawRowIndex: number;
      rawName: string;
      rawEmail: string;
      matchScore: number;
    }
  > = {};

  const consumedRawRowIndices = new Set<number>();

  const formatRowDisplayName = (rowRecord: Record<string, any>, rowIndex: number) => {
    if (nameCol === ORDER_BY_ROSTER_KEY) return `Fila #${rowIndex + 1} (Orden de lista)`;
    const primaryName = nameCol
      ? sanitizePlainTextInput(rowRecord[nameCol], 160)
      : '';
    const secondaryName = secondaryNameCol
      ? sanitizePlainTextInput(rowRecord[secondaryNameCol], 160)
      : '';
    return primaryName && secondaryName
      ? `${primaryName}, ${secondaryName}`
      : primaryName || secondaryName;
  };

  // Las vinculaciones elegidas manualmente por el docente se reservan primero para que el matcher automático no reutilice esas filas en otro alumno.
  Object.entries(manualRowMatches).forEach(([studentId, chosenRowIndex]) => {
    if (chosenRowIndex === null) {
      return;
    }
    if (
      typeof chosenRowIndex === 'number' &&
      chosenRowIndex >= 0 &&
      chosenRowIndex < rawRows.length
    ) {
      const chosenRowRecord = rawRows[chosenRowIndex];
      const rawNameValue =
        formatRowDisplayName(chosenRowRecord, chosenRowIndex) || `Fila #${chosenRowIndex + 1}`;
      const rawEmailValue = emailCol ? String(chosenRowRecord[emailCol] ?? '').trim() : '';
      matchedRowByStudentId[studentId] = {
        rawRow: chosenRowRecord,
        rawRowIndex: chosenRowIndex,
        rawName: rawNameValue,
        rawEmail: rawEmailValue,
        matchScore: EXACT_EMAIL_MATCH_SCORE,
      };
      consumedRawRowIndices.add(chosenRowIndex);
    }
  });

  if (nameCol === ORDER_BY_ROSTER_KEY) {
    const alphabeticallySortedRoster = [...students].sort((studentA, studentB) =>
      `${studentA.lastName}, ${studentA.firstName}`.localeCompare(
        `${studentB.lastName}, ${studentB.firstName}`,
        'es',
        { sensitivity: 'base' }
      )
    );
    rawRows.forEach((rowRecord, rowIndex) => {
      if (consumedRawRowIndices.has(rowIndex)) return;
      const targetStudent = alphabeticallySortedRoster[rowIndex];
      if (
        targetStudent &&
        manualRowMatches[targetStudent.id] !== null &&
        !matchedRowByStudentId[targetStudent.id]
      ) {
        matchedRowByStudentId[targetStudent.id] = {
          rawRow: rowRecord,
          rawRowIndex: rowIndex,
          rawName: `Fila #${rowIndex + 1} (Orden de lista)`,
          rawEmail: targetStudent.email || '',
          matchScore: EXACT_EMAIL_MATCH_SCORE,
        };
        consumedRawRowIndices.add(rowIndex);
      }
    });
  } else {
    rawRows.forEach((rowRecord, rowIndex) => {
      if (consumedRawRowIndices.has(rowIndex)) return;
      const rawNameValue = formatRowDisplayName(rowRecord, rowIndex);
      const rawEmailValue = emailCol ? String(rowRecord[emailCol] ?? '').trim() : '';
      if (!rawNameValue && !rawEmailValue) return;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(
          rawNameValue
        )
      ) {
        return;
      }

      const availableStudents = students.filter(
        (student) => !matchedRowByStudentId[student.id] && manualRowMatches[student.id] !== null
      );
      const { student, score } = findBestStudentMatchInRoster(
        availableStudents,
        rawNameValue,
        rawEmailValue
      );
      if (
        student &&
        score >= MIN_FUZZY_MATCH_SCORE_THRESHOLD &&
        !matchedRowByStudentId[student.id]
      ) {
        matchedRowByStudentId[student.id] = {
          rawRow: rowRecord,
          rawRowIndex: rowIndex,
          rawName: rawNameValue,
          rawEmail: rawEmailValue,
          matchScore: score,
        };
        consumedRawRowIndices.add(rowIndex);
      }
    });
  }

  const unmatchedRawRows: Array<{
    rawRow: Record<string, any>;
    rawRowIndex: number;
    rawName: string;
    rawEmail: string;
  }> = [];

  if (nameCol !== ORDER_BY_ROSTER_KEY) {
    rawRows.forEach((rowRecord, rowIndex) => {
      if (consumedRawRowIndices.has(rowIndex)) return;
      const rawNameValue = formatRowDisplayName(rowRecord, rowIndex);
      const rawEmailValue = emailCol ? String(rowRecord[emailCol] ?? '').trim() : '';
      if (!rawNameValue) return;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(
          rawNameValue
        )
      ) {
        return;
      }
      unmatchedRawRows.push({
        rawRow: rowRecord,
        rawRowIndex: rowIndex,
        rawName: rawNameValue,
        rawEmail: rawEmailValue,
      });
    });
  }

  const evaluateStudentCell = (
    studentId: string,
    rawCellValue: any,
    columnConfig: DetectedColumnConfig
  ): MultiVerifiedStudentRow['valuesByCol'][string] => {
    const cleanCellString = String(rawCellValue ?? '').trim();

    let currentStoredValue = '';
    if (columnConfig.kind === 'grade') {
      if (
        columnConfig.targetSubcategoryMode === 'existing' &&
        columnConfig.targetSubcategoryId
      ) {
        currentStoredValue = String(
          activeGradesMap[studentId]?.[columnConfig.targetSubcategoryId] ?? ''
        );
      }
    } else if (columnConfig.kind === 'absences') {
      const currentAbsences = activeDispositionMap[studentId]?.totalAbsences;
      currentStoredValue =
        currentAbsences !== undefined ? String(currentAbsences) : DEFAULT_ATTENDANCE_FALLBACK_STRING;
    } else if (columnConfig.kind === 'lates') {
      const currentLates = activeDispositionMap[studentId]?.totalLates;
      currentStoredValue =
        currentLates !== undefined ? String(currentLates) : DEFAULT_ATTENDANCE_FALLBACK_STRING;
    } else if (
      columnConfig.kind === 'disposition' ||
      columnConfig.kind === 'disposition_deduction'
    ) {
      const currentDisposition = activeDispositionMap[studentId]?.totalDisposition;
      currentStoredValue =
        currentDisposition !== undefined
          ? String(currentDisposition)
          : DEFAULT_DISPOSITION_FALLBACK_STRING;
    }

    if (cleanCellString === '' || cleanCellString === EMPTY_CELL_DASH) {
      return {
        currentVal: currentStoredValue,
        importedVal: '',
        editedVal: '',
        isValid: true,
        status: 'empty',
      };
    }

    const { numVal, isValid } = parseFlexibleCellNumber(rawCellValue, columnConfig.kind);

    if (isValid && (columnConfig.kind === 'absences' || columnConfig.kind === 'lates')) {
      const formattedAttendanceValue = String(Number(numVal.toFixed(TWO_DECIMAL_PRECISION)));
      return {
        currentVal: currentStoredValue,
        importedVal: formattedAttendanceValue,
        editedVal: formattedAttendanceValue,
        isValid: true,
        status: !currentStoredValue
          ? 'new'
          : currentStoredValue === formattedAttendanceValue
          ? 'same'
          : 'update',
      };
    }

    const normalizedCellValue = isValid
      ? String(Number(numVal.toFixed(TWO_DECIMAL_PRECISION)))
      : cleanCellString;
    let cellChangeStatus: 'new' | 'update' | 'same' | 'empty' | 'invalid' = 'new';
    if (!isValid) {
      cellChangeStatus = 'invalid';
    } else if (!currentStoredValue) {
      cellChangeStatus = 'new';
    } else if (
      String(Number(parseFloat(currentStoredValue).toFixed(TWO_DECIMAL_PRECISION))) ===
      normalizedCellValue
    ) {
      cellChangeStatus = 'same';
    } else {
      cellChangeStatus = 'update';
    }

    return {
      currentVal: currentStoredValue,
      importedVal: normalizedCellValue,
      editedVal: normalizedCellValue,
      isValid,
      status: cellChangeStatus,
    };
  };

  const rowsResult: MultiVerifiedStudentRow[] = students.map((student) => {
    const matchedRowInfo = matchedRowByStudentId[student.id];
    const valuesByCol: MultiVerifiedStudentRow['valuesByCol'] = {};

    columnConfigs.forEach((columnConfig) => {
      const rawCell = matchedRowInfo ? matchedRowInfo.rawRow[columnConfig.colKey] : '';
      valuesByCol[columnConfig.colKey] = evaluateStudentCell(student.id, rawCell, columnConfig);
    });

    const hasAnyValidChange = columnConfigs.some((columnConfig) => {
      if (!columnConfig.isIncluded || columnConfig.kind === 'ignore') return false;
      const evaluatedCell = valuesByCol[columnConfig.colKey];
      return (
        evaluatedCell &&
        evaluatedCell.isValid &&
        evaluatedCell.editedVal !== '' &&
        evaluatedCell.status !== 'same'
      );
    });

    return {
      rowId: student.id,
      studentId: student.id,
      isNewStudent: false,
      studentName: `${student.lastName}, ${student.firstName}`,
      firstName: student.firstName,
      lastName: student.lastName,
      studentEmail: student.email || matchedRowInfo?.rawEmail || '',
      matchedFromRaw: matchedRowInfo?.rawName || '',
      matchedRawRowIndex: matchedRowInfo?.rawRowIndex,
      matchScore: matchedRowInfo?.matchScore || NO_MATCH_SCORE,
      isIncluded: Boolean(matchedRowInfo && hasAnyValidChange),
      valuesByCol,
    };
  });

  unmatchedRawRows.forEach((unmatchedRow, unmatchedIndex) => {
    const temporaryStudentId = `new-student-${unmatchedRow.rawRowIndex}-${unmatchedIndex}`;
    const valuesByCol: MultiVerifiedStudentRow['valuesByCol'] = {};
    columnConfigs.forEach((columnConfig) => {
      valuesByCol[columnConfig.colKey] = evaluateStudentCell(
        temporaryStudentId,
        unmatchedRow.rawRow[columnConfig.colKey],
        columnConfig
      );
    });

    let parsedLastName = unmatchedRow.rawName;
    let parsedFirstName = '';
    if (unmatchedRow.rawName.includes(',')) {
      const commaNameSegments = unmatchedRow.rawName.split(',').map((segment) => segment.trim());
      parsedLastName = commaNameSegments[0] || unmatchedRow.rawName;
      parsedFirstName = commaNameSegments.slice(1).join(' ') || SYNTHETIC_HEADER_STUDENT;
    } else {
      const spaceNameSegments = unmatchedRow.rawName.split(/\s+/);
      if (spaceNameSegments.length >= 2) {
        parsedLastName = spaceNameSegments[0];
        parsedFirstName = spaceNameSegments.slice(1).join(' ');
      } else {
        parsedLastName = unmatchedRow.rawName;
        parsedFirstName = '';
      }
    }

    rowsResult.push({
      rowId: temporaryStudentId,
      studentId: temporaryStudentId,
      isNewStudent: true,
      studentName: parsedFirstName ? `${parsedLastName}, ${parsedFirstName}` : parsedLastName,
      firstName: parsedFirstName || SYNTHETIC_HEADER_STUDENT,
      lastName: parsedLastName,
      studentEmail: unmatchedRow.rawEmail || '',
      matchedFromRaw: unmatchedRow.rawName,
      matchedRawRowIndex: unmatchedRow.rawRowIndex,
      matchScore: NO_MATCH_SCORE,
      isIncluded: students.length === 0,
      valuesByCol,
    });
  });

  return {
    rowsResult,
    shouldAutoEnableNewStudents: students.length === 0 && unmatchedRawRows.length > 0,
  };
}
