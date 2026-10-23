import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import type {
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
} from '../components/modules/ImportGradesModal';

export function normalizeImportText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

/**
 * Fuzzy match between raw student name/email in Excel/Sheets and course roster
 */
export function findBestStudentMatchInRoster(
  students: Student[],
  rawName: string,
  rawEmail?: string
): { student: Student | null; score: number } {
  const emailClean = rawEmail ? String(rawEmail).trim().toLowerCase() : '';
  if (emailClean) {
    const exactEmail = students.find(
      (s) => s.email && s.email.trim().toLowerCase() === emailClean
    );
    if (exactEmail) return { student: exactEmail, score: 1.0 };
  }

  const rawClean = normalizeImportText(rawName);
  if (!rawClean) return { student: null, score: 0 };

  let bestMatch: Student | null = null;
  let highestScore = 0;

  for (const student of students) {
    const lastClean = normalizeImportText(student.lastName);
    const firstClean = normalizeImportText(student.firstName);
    const fullLastFirst = `${lastClean} ${firstClean}`;
    const fullFirstLast = `${firstClean} ${lastClean}`;
    const stEmailClean = student.email ? normalizeImportText(student.email) : '';

    if (stEmailClean && (rawClean === stEmailClean || rawClean.includes(stEmailClean))) {
      return { student, score: 1.0 };
    }

    if (rawClean === fullLastFirst || rawClean === fullFirstLast) {
      return { student, score: 0.99 };
    }

    if (lastClean && firstClean && rawClean.includes(lastClean) && rawClean.includes(firstClean)) {
      return { student, score: 0.92 };
    }

    const rawTokens = rawClean.split(/\s+/).filter(Boolean);
    const studentTokens = `${lastClean} ${firstClean}`.split(/\s+/).filter(Boolean);
    let matchedTokens = 0;
    for (const t of rawTokens) {
      if (studentTokens.includes(t)) {
        matchedTokens++;
      }
    }
    const tokenScore = matchedTokens / Math.max(rawTokens.length, studentTokens.length, 1);
    if (tokenScore > highestScore) {
      highestScore = tokenScore;
      bestMatch = student;
    }
  }

  if (highestScore >= 0.5) {
    return { student: bestMatch, score: highestScore };
  }

  return { student: null, score: 0 };
}

/**
 * Auto-detects primary student Name column, optional secondary First Name column (when Apellido and Nombre are separated),
 * and Email column.
 */
export function autoDetectIdentityColumns(cols: string[]): {
  nameCol: string;
  secondaryNameCol: string;
  emailCol: string;
} {
  let nameCol = '';
  let secondaryNameCol = '';

  const exactLastCol = cols.find((c) => /^apellido(s)?$/i.test(normalizeImportText(c)));
  const exactFirstCol = cols.find(
    (c) => c !== exactLastCol && /^nombre(s)?$/i.test(normalizeImportText(c))
  );

  if (exactLastCol && exactFirstCol) {
    nameCol = exactLastCol;
    secondaryNameCol = exactFirstCol;
  } else {
    nameCol =
      cols.find((c) => /alumno|nombre|estudiante|apellido|nom|ape|persona/i.test(c)) ||
      cols[0] ||
      '';
  }

  const emailCol =
    cols.find(
      (c) => c !== nameCol && c !== secondaryNameCol && /email|correo|mail/i.test(c)
    ) || '';

  return { nameCol, secondaryNameCol, emailCol };
}

/**
 * Extracts a clean numeric value from cells like "8,5", "8.50 (MB)", "9 pts", "-1,5", "3 faltas",
 * or standard Argentine conceptual scales (EX=10, MB=9, B=8, R=6).
 */
export function parseFlexibleCellNumber(
  rawVal: any,
  kind: DetectedColumnConfig['kind']
): { numVal: number; isValid: boolean } {
  const rawStr = String(rawVal ?? '').trim();
  if (!rawStr || rawStr === '-') {
    return { numVal: NaN, isValid: false };
  }

  const upper = rawStr.toUpperCase();
  if (kind === 'disposition' || kind === 'grade') {
    if (upper === 'EX' || upper === 'EXCELENTE' || upper === 'S' || upper === 'SOBRESALIENTE') {
      return { numVal: 10, isValid: true };
    }
    if (upper === 'MB' || upper === 'MUY BUENO') {
      return { numVal: 9, isValid: true };
    }
    if (upper === 'B' || upper === 'BUENO') {
      return { numVal: 8, isValid: true };
    }
    if (upper === 'R' || upper === 'REGULAR') {
      return { numVal: 6, isValid: true };
    }
    if (upper === 'M' || upper === 'MALO' || upper === 'I' || upper === 'INSUFICIENTE') {
      return { numVal: 4, isValid: true };
    }
  }

  // Extract first number (supporting comma or dot decimals and optional negative sign)
  const normalizedDecimals = rawStr.replace(',', '.');
  const numMatch = normalizedDecimals.match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) {
    return { numVal: NaN, isValid: false };
  }

  const parsed = parseFloat(numMatch[0]);
  if (isNaN(parsed)) {
    return { numVal: NaN, isValid: false };
  }

  if (kind === 'disposition_deduction') {
    // Converts a deduction (e.g. -1.5 or 1.5 points deducted) into final disposition on 1-10 scale
    const deduction = Math.abs(parsed);
    const resultingDisp = Math.max(1, Math.min(10, 10 - deduction));
    return { numVal: resultingDisp, isValid: deduction >= 0 && deduction <= 10 };
  }

  if (kind === 'disposition') {
    // If teacher wrote a negative number like -1 or -2 in a disposition column, treat as deduction from 10
    if (parsed < 0 && parsed >= -9) {
      return { numVal: Math.max(1, 10 + parsed), isValid: true };
    }
    return { numVal: parsed, isValid: parsed >= 0 && parsed <= 10 };
  }

  if (kind === 'grade') {
    return { numVal: parsed, isValid: parsed >= 0 && parsed <= 10 };
  }

  if (kind === 'absences' || kind === 'lates') {
    return { numVal: Math.abs(parsed), isValid: Math.abs(parsed) >= 0 };
  }

  return { numVal: parsed, isValid: true };
}

/**
 * Auto-detects what each column in the uploaded Excel or Google Sheet represents:
 * - Student Name / Secondary Name / Email
 * - Attendance / Disposition (Ausencias, Tardanzas, Disposición, Descuento)
 * - Grade / Category columns (e.g. "Trabajos Prácticos - TP 1", "Parcial 1", "Exámenes", etc.)
 */
export function autoDetectColumnsConfiguration(
  cols: string[],
  nameCol: string,
  emailCol: string,
  cats: GradeCategory[],
  secondaryNameCol = '',
  importContext: 'grades' | 'attendance' = 'grades'
): DetectedColumnConfig[] {
  const configs: DetectedColumnConfig[] = [];
  const defaultCat = cats[0] || {
    id: 'cat-default',
    name: 'Evaluaciones',
    weight: 100,
    subcategories: [],
  };

  cols.forEach((col) => {
    if (col === nameCol || col === secondaryNameCol || col === emailCol) return;

    const clean = col.trim();
    const lower = normalizeImportText(clean);

    // Ignore obvious non-data or calculated summary columns by default (teacher can still enable them)
    const isSummaryOrMeta =
      /^n$|^nro$|^numero$|^id$|^legajo$|^orden$|promedio final|condicion|estado|ultima actualizacion|ultima incidencia|asistencia %|% asistencia|fecha|hora/i.test(
        lower
      );

    // Check if it's an Attendance or Disposition column
    if (/ausencia|falta|inasistencia|ausentes/i.test(lower) && !/justificada/i.test(lower)) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'absences',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    if (/tardanza|llegada tarde|tardes|\btarde\b|demora/i.test(lower)) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'lates',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    if (/descuento|puntos menos|resta|sancion|negativo/i.test(lower)) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'disposition_deduction',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    if (
      /disposicion|conducta|actitud|comportamiento|nota disp|concepto|participacion|desempeno/i.test(
        lower
      ) &&
      (importContext === 'attendance' || /disposicion|conducta|actitud|comportamiento|nota disp/i.test(lower))
    ) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'disposition',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    // If we are in attendance/disposition import context and there is only 1 data column (e.g. 2-column sheet),
    // automatically map it to Disposition so the teacher doesn't even have to select it manually!
    const nonIdentityCols = cols.filter(
      (c) => c !== nameCol && c !== secondaryNameCol && c !== emailCol
    );
    if (importContext === 'attendance' && nonIdentityCols.length === 1) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'disposition',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    if (isSummaryOrMeta || importContext === 'attendance') {
      configs.push({
        colKey: col,
        isIncluded: false,
        kind: 'ignore',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: clean,
      });
      return;
    }

    // Otherwise treat as a Grade / Category column!
    let parsedCatName = '';
    let parsedSubName = clean;
    if (clean.includes(' - ')) {
      const parts = clean
        .split(' - ')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        parsedCatName = parts[0];
        parsedSubName = parts.slice(1).join(' - ');
      }
    } else if (clean.includes(': ')) {
      const parts = clean
        .split(': ')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        parsedCatName = parts[0];
        parsedSubName = parts.slice(1).join(': ');
      }
    }

    let matchedCategory: GradeCategory | undefined;
    if (parsedCatName) {
      const normCat = normalizeImportText(parsedCatName);
      matchedCategory = cats.find(
        (c) =>
          normalizeImportText(c.name) === normCat ||
          normalizeImportText(c.name).includes(normCat) ||
          normCat.includes(normalizeImportText(c.name))
      );
    }

    if (!matchedCategory) {
      if (/^tp\b|trabajo practico|guia|entrega|actividad|tarea/i.test(lower)) {
        matchedCategory = cats.find((c) =>
          /trabajo|practico|tp|actividad/i.test(normalizeImportText(c.name))
        );
      } else if (
        /examen|parcial|evaluacion|prueba|recuperatorio|integrador|diagnostica/i.test(lower)
      ) {
        matchedCategory = cats.find((c) =>
          /evaluacion|examen|parcial|prueba/i.test(normalizeImportText(c.name))
        );
      } else if (/concepto|participacion|desempeno|carpeta/i.test(lower)) {
        matchedCategory = cats.find((c) =>
          /concepto|desempeno|participacion/i.test(normalizeImportText(c.name))
        );
      }
    }

    let matchedSubId = '';
    for (const c of cats) {
      const foundSub = c.subcategories.find(
        (s) => normalizeImportText(s.name) === normalizeImportText(parsedSubName)
      );
      if (foundSub) {
        matchedCategory = c;
        matchedSubId = foundSub.id;
        break;
      }
    }

    if (matchedCategory) {
      if (!matchedSubId) {
        const subInCat = matchedCategory.subcategories.find(
          (s) => normalizeImportText(s.name) === normalizeImportText(parsedSubName)
        );
        if (subInCat) matchedSubId = subInCat.id;
      }

      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'grade',
        targetCategoryMode: 'existing',
        targetCategoryId: matchedCategory.id,
        newCategoryName: parsedCatName || matchedCategory.name,
        targetSubcategoryMode: matchedSubId ? 'existing' : 'new',
        targetSubcategoryId: matchedSubId || '',
        subcategoryName: parsedSubName,
      });
    } else if (parsedCatName) {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'grade',
        targetCategoryMode: 'new',
        targetCategoryId: defaultCat.id,
        newCategoryName: parsedCatName,
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: parsedSubName,
      });
    } else {
      configs.push({
        colKey: col,
        isIncluded: true,
        kind: 'grade',
        targetCategoryMode: cats.length > 0 ? 'existing' : 'new',
        targetCategoryId: defaultCat.id,
        newCategoryName: 'Calificaciones',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: parsedSubName,
      });
    }
  });

  return configs;
}

/**
 * Pure builder for the multi-column verification table for all students in the course + any new students in the file
 */
export function computeMultiVerificationRows(
  students: Student[],
  rawRows: Array<Record<string, any>>,
  nameCol: string,
  emailCol: string,
  colConfigs: DetectedColumnConfig[],
  activeGradesMap: StudentGradesMap,
  activeDispMap: Record<
    string,
    { totalAbsences: number; totalLates?: number; totalDisposition: number }
  >,
  secondaryNameCol = ''
): {
  rowsResult: MultiVerifiedStudentRow[];
  shouldAutoEnableNewStudents: boolean;
} {
  const matchedByStudentId: Record<
    string,
    { rawRow: Record<string, any>; rawName: string; rawEmail: string; matchScore: number }
  > = {};

  const unmatchedRawRows: Array<{
    rawRow: Record<string, any>;
    rawName: string;
    rawEmail: string;
  }> = [];

  // Mode: Order-by-roster matching when nameCol is '__ORDER__' (1-column paste mode)
  if (nameCol === '__ORDER__') {
    const sortedRoster = [...students].sort((a, b) =>
      `${a.lastName}, ${a.firstName}`.localeCompare(`${b.lastName}, ${b.firstName}`, 'es', {
        sensitivity: 'base',
      })
    );
    rawRows.forEach((row, idx) => {
      const targetStudent = sortedRoster[idx];
      if (targetStudent) {
        matchedByStudentId[targetStudent.id] = {
          rawRow: row,
          rawName: `Fila #${idx + 1} (Orden de lista)`,
          rawEmail: targetStudent.email || '',
          matchScore: 1.0,
        };
      }
    });
  } else {
    rawRows.forEach((row) => {
      const primaryName = nameCol ? String(row[nameCol] ?? '').trim() : '';
      const secondaryName = secondaryNameCol ? String(row[secondaryNameCol] ?? '').trim() : '';
      const rawNameVal =
        primaryName && secondaryName
          ? `${primaryName}, ${secondaryName}`
          : primaryName || secondaryName;

      const rawEmailVal = emailCol ? String(row[emailCol] ?? '').trim() : '';
      if (!rawNameVal && !rawEmailVal) return;
      if (/^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(rawNameVal)) {
        return;
      }

      const { student, score } = findBestStudentMatchInRoster(students, rawNameVal, rawEmailVal);
      if (student && score >= 0.5 && !matchedByStudentId[student.id]) {
        matchedByStudentId[student.id] = {
          rawRow: row,
          rawName: rawNameVal,
          rawEmail: rawEmailVal,
          matchScore: score,
        };
      } else if (rawNameVal) {
        unmatchedRawRows.push({
          rawRow: row,
          rawName: rawNameVal,
          rawEmail: rawEmailVal,
        });
      }
    });
  }

  const evaluateCell = (
    studentId: string,
    rawVal: any,
    colCfg: DetectedColumnConfig
  ): MultiVerifiedStudentRow['valuesByCol'][string] => {
    const cleanStr = String(rawVal ?? '').trim();

    let currentVal = '';
    if (colCfg.kind === 'grade') {
      if (colCfg.targetSubcategoryMode === 'existing' && colCfg.targetSubcategoryId) {
        currentVal = String(activeGradesMap[studentId]?.[colCfg.targetSubcategoryId] ?? '');
      }
    } else if (colCfg.kind === 'absences') {
      const cur = activeDispMap[studentId]?.totalAbsences;
      currentVal = cur !== undefined ? String(cur) : '0';
    } else if (colCfg.kind === 'lates') {
      const cur = activeDispMap[studentId]?.totalLates;
      currentVal = cur !== undefined ? String(cur) : '0';
    } else if (colCfg.kind === 'disposition' || colCfg.kind === 'disposition_deduction') {
      const cur = activeDispMap[studentId]?.totalDisposition;
      currentVal = cur !== undefined ? String(cur) : '10';
    }

    if (cleanStr === '' || cleanStr === '-') {
      return {
        currentVal,
        importedVal: '',
        editedVal: '',
        isValid: true,
        status: 'empty',
      };
    }

    const { numVal, isValid } = parseFlexibleCellNumber(rawVal, colCfg.kind);

    if (isValid && (colCfg.kind === 'absences' || colCfg.kind === 'lates')) {
      const rounded = String(Number(numVal.toFixed(2)));
      return {
        currentVal,
        importedVal: rounded,
        editedVal: rounded,
        isValid: true,
        status: !currentVal ? 'new' : currentVal === rounded ? 'same' : 'update',
      };
    }

    const normalizedVal = isValid ? String(Number(numVal.toFixed(2))) : cleanStr;
    let status: 'new' | 'update' | 'same' | 'empty' | 'invalid' = 'new';
    if (!isValid) {
      status = 'invalid';
    } else if (!currentVal) {
      status = 'new';
    } else if (String(Number(parseFloat(currentVal).toFixed(2))) === normalizedVal) {
      status = 'same';
    } else {
      status = 'update';
    }

    return {
      currentVal,
      importedVal: normalizedVal,
      editedVal: normalizedVal,
      isValid,
      status,
    };
  };

  const rowsResult: MultiVerifiedStudentRow[] = students.map((st) => {
    const matched = matchedByStudentId[st.id];
    const valuesByCol: MultiVerifiedStudentRow['valuesByCol'] = {};

    colConfigs.forEach((cfg) => {
      const rawCell = matched ? matched.rawRow[cfg.colKey] : '';
      valuesByCol[cfg.colKey] = evaluateCell(st.id, rawCell, cfg);
    });

    const hasAnyValidChange = colConfigs.some((cfg) => {
      if (!cfg.isIncluded || cfg.kind === 'ignore') return false;
      const cell = valuesByCol[cfg.colKey];
      return cell && cell.isValid && cell.editedVal !== '' && cell.status !== 'same';
    });

    return {
      rowId: st.id,
      studentId: st.id,
      isNewStudent: false,
      studentName: `${st.lastName}, ${st.firstName}`,
      firstName: st.firstName,
      lastName: st.lastName,
      studentEmail: st.email || matched?.rawEmail || '',
      matchedFromRaw: matched?.rawName || '',
      matchScore: matched?.matchScore || 0,
      isIncluded: Boolean(matched && hasAnyValidChange),
      valuesByCol,
    };
  });

  unmatchedRawRows.forEach((unmatched, idx) => {
    const tempId = `new-student-${Date.now()}-${idx}`;
    const valuesByCol: MultiVerifiedStudentRow['valuesByCol'] = {};
    colConfigs.forEach((cfg) => {
      valuesByCol[cfg.colKey] = evaluateCell(tempId, unmatched.rawRow[cfg.colKey], cfg);
    });

    let lastName = unmatched.rawName;
    let firstName = '';
    if (unmatched.rawName.includes(',')) {
      const parts = unmatched.rawName.split(',').map((s) => s.trim());
      lastName = parts[0] || unmatched.rawName;
      firstName = parts.slice(1).join(' ') || 'Alumno';
    } else {
      const parts = unmatched.rawName.split(/\s+/);
      if (parts.length >= 2) {
        lastName = parts[0];
        firstName = parts.slice(1).join(' ');
      } else {
        lastName = unmatched.rawName;
        firstName = '';
      }
    }

    rowsResult.push({
      rowId: tempId,
      studentId: tempId,
      isNewStudent: true,
      studentName: firstName ? `${lastName}, ${firstName}` : lastName,
      firstName: firstName || 'Alumno',
      lastName,
      studentEmail: unmatched.rawEmail || '',
      matchedFromRaw: unmatched.rawName,
      matchScore: 0,
      isIncluded: students.length === 0,
      valuesByCol,
    });
  });

  return {
    rowsResult,
    shouldAutoEnableNewStudents: students.length === 0 && unmatchedRawRows.length > 0,
  };
}
