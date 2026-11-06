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

  // Support Google Forms "X / Y" score format (e.g. "8 / 10", "8,50 / 10", "75 / 100")
  if (kind === 'grade') {
    const fractionMatch = rawStr.match(
      /^(-?\d+(?:[.,]\d+)?)\s*(?:\/|de|sobre)\s*(\d+(?:[.,]\d+)?)$/i
    );
    if (fractionMatch) {
      const earned = parseFloat(fractionMatch[1].replace(',', '.'));
      const max = parseFloat(fractionMatch[2].replace(',', '.'));
      if (!isNaN(earned) && !isNaN(max) && max > 0) {
        const scaled = max === 10 ? earned : (earned / max) * 10;
        return {
          numVal: Number(scaled.toFixed(2)),
          isValid: scaled >= 0 && scaled <= 10,
        };
      }
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
      /^n$|^nro$|^numero$|^id$|^legajo$|^orden$|marca temporal|timestamp|promedio final|condicion|estado|ultima actualizacion|ultima incidencia|asistencia %|% asistencia|fecha|hora/i.test(
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

    // If we are in attendance/disposition import context and there is only 1 data column
    // that doesn't look like an evaluation/grade column, map it to Disposition; otherwise detect grades just like in Calificaciones.
    const nonIdentityCols = cols.filter(
      (c) => c !== nameCol && c !== secondaryNameCol && c !== emailCol
    );
    const looksLikeGradeCol =
      /nota|calific|tp|trabajo|practico|parcial|examen|eval|prueba|trimestre|cuatrimestre| Oral|escrito|entrega/i.test(
        lower
      );
    if (importContext === 'attendance' && nonIdentityCols.length === 1 && !looksLikeGradeCol) {
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
 * Parses free-form text lines (from Google Docs, Word, TXT, or pasted lists) into a 2D grid.
 * Supports tab/semicolon/pipe separated tables AND lines like:
 *   "1. García, Ana - 9.5"
 *   "Pérez, Juan: 8,5"
 *   "López María 10"
 */
export function parseTextLinesTo2DGrid(text: string): any[][] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // 1. Check if most lines use tab, semicolon, or pipe delimiters
  const tabCount = lines.filter((l) => l.includes('\t')).length;
  const semiCount = lines.filter((l) => l.includes(';')).length;
  const pipeCount = lines.filter((l) => l.includes('|')).length;

  let rows: string[][] = [];

  if (tabCount >= Math.max(1, Math.floor(lines.length * 0.4))) {
    rows = lines.map((l) => l.split('\t').map((c) => c.trim()));
  } else if (pipeCount >= Math.max(1, Math.floor(lines.length * 0.4))) {
    rows = lines
      .map((l) =>
        l
          .replace(/^\|+|\|+$/g, '')
          .split('|')
          .map((c) => c.trim())
      )
      .filter((r) => !r.every((c) => /^[-:]+$/.test(c)));
  } else if (semiCount >= Math.max(1, Math.floor(lines.length * 0.4))) {
    rows = lines.map((l) => l.split(';').map((c) => c.trim()));
  } else {
    // Parse line by line: strip leading numbering ("1.", "1)", "01 -") and separate Name from trailing score(s)
    rows = lines.map((line) => {
      const cleaned = line.replace(/^\d+\s*[.):\-]\s*/, '').trim();
      // Check for separator like " - ", " : ", " – ", " — " before a number or conceptual grade
      const dashOrColonMatch = cleaned.match(
        /^(.+?)\s*(?:[-–—:=]+)\s*(-?\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|EX|EXCELENTE|MB|MUY BUENO|B|BUENO|R|REGULAR|I|INSUFICIENTE)$/i
      );
      if (dashOrColonMatch) {
        return [dashOrColonMatch[1].trim(), dashOrColonMatch[2].trim()];
      }

      // Check for trailing number at the end of the line (e.g. "García, Ana 9,5")
      const trailingNumMatch = cleaned.match(
        /^([a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s,.'’-]+?)\s+(-?\d+(?:[.,]\d+)?|EX|MB|B|R)$/i
      );
      if (trailingNumMatch) {
        return [trailingNumMatch[1].trim(), trailingNumMatch[2].trim()];
      }

      // Check if comma-separated "Apellido, Nombre, 9"
      const commaParts = cleaned.split(',').map((p) => p.trim());
      if (
        commaParts.length >= 2 &&
        /^-?\d+(?:[.,]\d+)?$/.test(commaParts[commaParts.length - 1])
      ) {
        const scorePart = commaParts[commaParts.length - 1];
        const namePart = commaParts.slice(0, -1).join(', ');
        return [namePart, scorePart];
      }

      return [cleaned];
    });
  }

  return ensureHeaderRowIn2DGrid(rows);
}

/**
 * Ensures that if row 0 of a 2D grid already contains a student name + numeric score (instead of column headers),
 * synthetic headers ['Alumno', 'Disposición / Nota', ...] are prepended so the first student is not lost.
 */
export function ensureHeaderRowIn2DGrid(grid: any[][]): any[][] {
  const nonEmpty = grid.filter(
    (r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim() !== '')
  );
  if (nonEmpty.length === 0) return [];

  const firstRow = nonEmpty[0].map((c) => String(c ?? '').trim());
  const maxCols = Math.max(...nonEmpty.map((r) => r.length), 1);

  if (maxCols === 1) {
    const firstCell = firstRow[0] || '';
    const isHeaderWord = /^(alumno|estudiante|nombre|apellido|nota|disposicion|calificacion)/i.test(
      normalizeImportText(firstCell)
    );
    if (!isHeaderWord) {
      const looksNumeric = /^-?\d+(?:[.,]\d+)?$/.test(firstCell);
      return [[looksNumeric ? 'Disposición' : 'Alumno'], ...nonEmpty];
    }
    return nonEmpty;
  }

  // Check if any cell in firstRow looks like a known header keyword
  const hasExplicitHeaderWord = firstRow.some((cell) =>
    /^(alumno|alumnos|estudiante|estudiantes|nombre|nombres|apellido|apellidos|disposicion|nota|notas|calificacion|ausencia|falta|tardanza|email|correo|tp|examen|parcial|concepto|conducta)/i.test(
      normalizeImportText(cell)
    )
  );

  if (!hasExplicitHeaderWord) {
    // Check if any cell from index 1..end in firstRow is a valid number or conceptual grade
    const secondCellNumeric = firstRow
      .slice(1)
      .some((cell) => /^-?\d+(?:[.,]\d+)?$/.test(cell) || /^(EX|MB|B|R)$/i.test(cell));
    if (secondCellNumeric) {
      const synthHeaders = ['Alumno'];
      for (let i = 1; i < maxCols; i++) {
        synthHeaders.push(i === 1 ? 'Disposición' : `Columna ${i + 1}`);
      }
      return [synthHeaders, ...nonEmpty];
    }
  }

  return nonEmpty;
}

/**
 * Parses HTML (from Google Docs export, Word .doc/.html, or web tables) or plain text into a 2D grid.
 */
export function parseHtmlOrTextDocumentTo2DGrid(htmlOrText: string): any[][] {
  const raw = String(htmlOrText || '').trim();
  if (!raw) return [];

  if (typeof DOMParser !== 'undefined' && /<(table|tr|td|th|p|div|li|html|body)\b/i.test(raw)) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');

      // 1. Prefer HTML <table> if present
      const tables = Array.from(doc.querySelectorAll('table'));
      if (tables.length > 0) {
        let bestTableGrid: string[][] = [];
        for (const table of tables) {
          const trs = Array.from(table.querySelectorAll('tr'));
          const tableRows: string[][] = [];
          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
              (cell.textContent || '').replace(/\s+/g, ' ').trim()
            );
            if (cells.some((c) => c !== '')) {
              tableRows.push(cells);
            }
          }
          if (tableRows.length > bestTableGrid.length) {
            bestTableGrid = tableRows;
          }
        }
        if (bestTableGrid.length > 0) {
          return ensureHeaderRowIn2DGrid(bestTableGrid);
        }
      }

      // 2. Otherwise extract paragraphs and list items
      const blocks = Array.from(doc.querySelectorAll('p, li, h1, h2, h3, h4, tr'));
      if (blocks.length > 0) {
        const lines = blocks
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        if (lines.length > 0) {
          return parseTextLinesTo2DGrid(lines.join('\n'));
        }
      }

      const bodyText = doc.body?.innerText || doc.body?.textContent || '';
      if (bodyText.trim()) {
        return parseTextLinesTo2DGrid(bodyText);
      }
    } catch (err) {
      console.warn('Fallback to text parser after HTML parse notice:', err);
    }
  }

  return parseTextLinesTo2DGrid(raw);
}

/**
 * Extracts `word/document.xml` from a `.docx` ArrayBuffer in the browser (using DecompressionStream)
 * and parses Word tables (`<w:tbl>`) or paragraphs (`<w:p>`) into a 2D grid.
 */
export async function parseDocxArrayBufferTo2DGrid(buffer: ArrayBuffer): Promise<any[][]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Locate local file header for "word/document.xml"
  let offset = 0;
  let xmlText = '';

  while (offset + 30 < bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLen);
    const entryName = new TextDecoder('utf-8').decode(nameBytes);
    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (entryName === 'word/document.xml') {
      // Find next PK header if compressedSize is 0 (data descriptor bit set)
      let actualEnd = dataStart + compressedSize;
      if (compressedSize === 0 || actualEnd > bytes.length) {
        actualEnd = bytes.length;
        for (let i = dataStart; i < bytes.length - 4; i++) {
          if (
            bytes[i] === 0x50 &&
            bytes[i + 1] === 0x4b &&
            (bytes[i + 2] === 0x03 || bytes[i + 2] === 0x01 || bytes[i + 2] === 0x07)
          ) {
            actualEnd = i;
            break;
          }
        }
      }

      const rawSlice = bytes.subarray(dataStart, actualEnd);
      if (compressionMethod === 0) {
        xmlText = new TextDecoder('utf-8').decode(rawSlice);
      } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(rawSlice).catch(() => {});
        writer.close().catch(() => {});
        const decompressedBuf = await new Response(ds.readable).arrayBuffer();
        xmlText = new TextDecoder('utf-8').decode(decompressedBuf);
      }
      break;
    }

    offset = dataStart + (compressedSize > 0 ? compressedSize : 0);
  }

  if (!xmlText) {
    // Fallback: try decoding as plain text / HTML (.doc saved as HTML)
    const fallbackText = new TextDecoder('utf-8').decode(bytes);
    return parseHtmlOrTextDocumentTo2DGrid(fallbackText);
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

  // 1. Check for Word tables (<w:tbl>)
  const tables = Array.from(xmlDoc.getElementsByTagNameNS('*', 'tbl'));
  if (tables.length > 0) {
    let bestRows: string[][] = [];
    for (const tbl of tables) {
      const trs = Array.from(tbl.getElementsByTagNameNS('*', 'tr'));
      const tblRows: string[][] = [];
      for (const tr of trs) {
        const tcs = Array.from(tr.getElementsByTagNameNS('*', 'tc'));
        const rowCells = tcs.map((tc) => {
          const ts = Array.from(tc.getElementsByTagNameNS('*', 't'));
          return ts
            .map((t) => t.textContent || '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
        });
        if (rowCells.some((c) => c !== '')) {
          tblRows.push(rowCells);
        }
      }
      if (tblRows.length > bestRows.length) {
        bestRows = tblRows;
      }
    }
    if (bestRows.length > 0) {
      return ensureHeaderRowIn2DGrid(bestRows);
    }
  }

  // 2. Fallback: extract paragraphs (<w:p>)
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS('*', 'p'));
  const lines: string[] = [];
  for (const p of paragraphs) {
    const ts = Array.from(p.getElementsByTagNameNS('*', 't'));
    const line = ts
      .map((t) => t.textContent || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) lines.push(line);
  }

  return parseTextLinesTo2DGrid(lines.join('\n'));
}

/**
 * Extracts a readable label for each row in `rawRows` so the teacher can choose
 * which document row corresponds to which student in the course.
 */
export function buildDocumentRowOptions(
  rawRows: Array<Record<string, any>>,
  nameCol: string,
  secondaryNameCol: string,
  emailCol: string,
  colConfigs: DetectedColumnConfig[]
): Array<{
  rawRowIndex: number;
  rawName: string;
  rawEmail: string;
  summaryPreview: string;
}> {
  const includedConfigs = colConfigs.filter((c) => c.isIncluded && c.kind !== 'ignore');

  return rawRows
    .map((row, idx) => {
      const primaryName = nameCol && nameCol !== '__ORDER__' ? String(row[nameCol] ?? '').trim() : '';
      const secondaryName = secondaryNameCol ? String(row[secondaryNameCol] ?? '').trim() : '';
      const rawName =
        nameCol === '__ORDER__'
          ? `Fila #${idx + 1}`
          : primaryName && secondaryName
          ? `${primaryName}, ${secondaryName}`
          : primaryName || secondaryName || `Fila #${idx + 1}`;
      const rawEmail = emailCol ? String(row[emailCol] ?? '').trim() : '';

      const previews: string[] = [];
      for (const cfg of includedConfigs.slice(0, 3)) {
        const val = String(row[cfg.colKey] ?? '').trim();
        if (val && val !== '-') {
          const shortCol =
            cfg.kind === 'disposition'
              ? 'Disp'
              : cfg.kind === 'disposition_deduction'
              ? 'Desc'
              : cfg.kind === 'absences'
              ? 'Faltas'
              : cfg.kind === 'lates'
              ? 'Tardes'
              : cfg.subcategoryName || cfg.colKey;
          previews.push(`${shortCol}: ${val}`);
        }
      }

      return {
        rawRowIndex: idx,
        rawName,
        rawEmail,
        summaryPreview: previews.join(' · '),
      };
    })
    .filter((item) => {
      if (!item.rawName) return false;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(
          item.rawName
        )
      ) {
        return false;
      }
      return true;
    });
}

/**
 * Pure builder for the multi-column verification table for all students in the course + any new students in the file.
 * Supports `manualRowMatches` (mapping `studentId -> rawRowIndex | null`) so the teacher can manually choose
 * or override which name from the document belongs to each student.
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
  secondaryNameCol = '',
  manualRowMatches: Record<string, number | null> = {}
): {
  rowsResult: MultiVerifiedStudentRow[];
  shouldAutoEnableNewStudents: boolean;
} {
  const matchedByStudentId: Record<
    string,
    {
      rawRow: Record<string, any>;
      rawRowIndex: number;
      rawName: string;
      rawEmail: string;
      matchScore: number;
    }
  > = {};

  const usedRawRowIndices = new Set<number>();

  const getRowDisplayName = (row: Record<string, any>, idx: number) => {
    if (nameCol === '__ORDER__') return `Fila #${idx + 1} (Orden de lista)`;
    const primaryName = nameCol ? String(row[nameCol] ?? '').trim() : '';
    const secondaryName = secondaryNameCol ? String(row[secondaryNameCol] ?? '').trim() : '';
    return primaryName && secondaryName
      ? `${primaryName}, ${secondaryName}`
      : primaryName || secondaryName;
  };

  // 1. Apply explicit manual matches chosen by the teacher first
  Object.entries(manualRowMatches).forEach(([studentId, chosenIdx]) => {
    if (chosenIdx === null) {
      // Explicitly unassigned by teacher
      return;
    }
    if (typeof chosenIdx === 'number' && chosenIdx >= 0 && chosenIdx < rawRows.length) {
      const row = rawRows[chosenIdx];
      const rawNameVal = getRowDisplayName(row, chosenIdx) || `Fila #${chosenIdx + 1}`;
      const rawEmailVal = emailCol ? String(row[emailCol] ?? '').trim() : '';
      matchedByStudentId[studentId] = {
        rawRow: row,
        rawRowIndex: chosenIdx,
        rawName: rawNameVal,
        rawEmail: rawEmailVal,
        matchScore: 1.0,
      };
      usedRawRowIndices.add(chosenIdx);
    }
  });

  // 2. Mode: Order-by-roster matching when nameCol is '__ORDER__' (1-column paste mode)
  if (nameCol === '__ORDER__') {
    const sortedRoster = [...students].sort((a, b) =>
      `${a.lastName}, ${a.firstName}`.localeCompare(`${b.lastName}, ${b.firstName}`, 'es', {
        sensitivity: 'base',
      })
    );
    rawRows.forEach((row, idx) => {
      if (usedRawRowIndices.has(idx)) return;
      const targetStudent = sortedRoster[idx];
      if (
        targetStudent &&
        manualRowMatches[targetStudent.id] !== null &&
        !matchedByStudentId[targetStudent.id]
      ) {
        matchedByStudentId[targetStudent.id] = {
          rawRow: row,
          rawRowIndex: idx,
          rawName: `Fila #${idx + 1} (Orden de lista)`,
          rawEmail: targetStudent.email || '',
          matchScore: 1.0,
        };
        usedRawRowIndices.add(idx);
      }
    });
  } else {
    // Automatic fuzzy matching for remaining rows
    rawRows.forEach((row, idx) => {
      if (usedRawRowIndices.has(idx)) return;
      const rawNameVal = getRowDisplayName(row, idx);
      const rawEmailVal = emailCol ? String(row[emailCol] ?? '').trim() : '';
      if (!rawNameVal && !rawEmailVal) return;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(rawNameVal)
      ) {
        return;
      }

      // Only match against students not already matched or manually unassigned
      const availableStudents = students.filter(
        (s) => !matchedByStudentId[s.id] && manualRowMatches[s.id] !== null
      );
      const { student, score } = findBestStudentMatchInRoster(
        availableStudents,
        rawNameVal,
        rawEmailVal
      );
      if (student && score >= 0.5 && !matchedByStudentId[student.id]) {
        matchedByStudentId[student.id] = {
          rawRow: row,
          rawRowIndex: idx,
          rawName: rawNameVal,
          rawEmail: rawEmailVal,
          matchScore: score,
        };
        usedRawRowIndices.add(idx);
      }
    });
  }

  // Collect unmatched rows from the document
  const unmatchedRawRows: Array<{
    rawRow: Record<string, any>;
    rawRowIndex: number;
    rawName: string;
    rawEmail: string;
  }> = [];

  if (nameCol !== '__ORDER__') {
    rawRows.forEach((row, idx) => {
      if (usedRawRowIndices.has(idx)) return;
      const rawNameVal = getRowDisplayName(row, idx);
      const rawEmailVal = emailCol ? String(row[emailCol] ?? '').trim() : '';
      if (!rawNameVal) return;
      if (
        /^promedio|^total|^media|^resumen|^apellido y nombre|^estudiante|^alumno/i.test(rawNameVal)
      ) {
        return;
      }
      unmatchedRawRows.push({
        rawRow: row,
        rawRowIndex: idx,
        rawName: rawNameVal,
        rawEmail: rawEmailVal,
      });
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
      matchedRawRowIndex: matched?.rawRowIndex,
      matchScore: matched?.matchScore || 0,
      isIncluded: Boolean(matched && hasAnyValidChange),
      valuesByCol,
    };
  });

  unmatchedRawRows.forEach((unmatched, idx) => {
    const tempId = `new-student-${unmatched.rawRowIndex}-${idx}`;
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
      matchedRawRowIndex: unmatched.rawRowIndex,
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

