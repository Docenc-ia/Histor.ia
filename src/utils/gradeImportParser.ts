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
 * Auto-detects what each column in the uploaded Excel or Google Sheet represents:
 * - Student Name / Email
 * - Attendance / Disposition (Ausencias, Tardanzas, Disposición)
 * - Grade / Category columns (e.g. "Trabajos Prácticos - TP 1", "Parcial 1", "Exámenes", etc.)
 */
export function autoDetectColumnsConfiguration(
  cols: string[],
  nameCol: string,
  emailCol: string,
  cats: GradeCategory[]
): DetectedColumnConfig[] {
  const configs: DetectedColumnConfig[] = [];
  const defaultCat = cats[0] || {
    id: 'cat-default',
    name: 'Evaluaciones',
    weight: 100,
    subcategories: [],
  };

  cols.forEach((col) => {
    if (col === nameCol || col === emailCol) return;

    const clean = col.trim();
    const lower = normalizeImportText(clean);

    // Ignore obvious non-data or calculated summary columns by default (teacher can still enable them)
    const isSummaryOrMeta =
      /^n$|^nro$|^numero$|^id$|^legajo$|promedio final|condicion|estado|ultima actualizacion|ultima incidencia|asistencia %|% asistencia|fecha|hora/i.test(
        lower
      );

    // Check if it's an Attendance or Disposition column
    if (/ausencia|falta|inasistencia/i.test(lower) && !/justificada/i.test(lower)) {
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

    if (/tardanza|llegada tarde|tardes/i.test(lower)) {
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

    if (/disposicion|conducta/i.test(lower)) {
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

    if (isSummaryOrMeta) {
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
  >
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

  rawRows.forEach((row) => {
    const rawNameVal = String(row[nameCol] ?? '').trim();
    const rawEmailVal = emailCol ? String(row[emailCol] ?? '').trim() : '';
    if (!rawNameVal && !rawEmailVal) return;
    if (/^promedio|^total|^media|^resumen/i.test(rawNameVal)) return;

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

  const evaluateCell = (
    studentId: string,
    rawVal: any,
    colCfg: DetectedColumnConfig
  ): MultiVerifiedStudentRow['valuesByCol'][string] => {
    const cleanStr = String(rawVal ?? '')
      .replace(',', '.')
      .trim();

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
    } else if (colCfg.kind === 'disposition') {
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

    const numVal = parseFloat(cleanStr);
    let isValid = !isNaN(numVal);
    if (colCfg.kind === 'grade' || colCfg.kind === 'disposition') {
      isValid = !isNaN(numVal) && numVal >= 0 && numVal <= 10;
    } else if (colCfg.kind === 'absences' || colCfg.kind === 'lates') {
      const stripped = cleanStr.replace(/[fFtT]$/g, '').trim();
      const nStripped = parseFloat(stripped);
      if (!isNaN(nStripped) && nStripped >= 0) {
        return {
          currentVal,
          importedVal: String(nStripped),
          editedVal: String(nStripped),
          isValid: true,
          status: !currentVal ? 'new' : currentVal === String(nStripped) ? 'same' : 'update',
        };
      }
      isValid = false;
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
