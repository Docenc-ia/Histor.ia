import type * as XLSXType from 'xlsx';
import { Student } from '../types';
import { GradeCategory } from '../types/grades';
import { DetectedColumnConfig, QuickPastePreset } from '../types/gradeImport';
import { driveService } from './workspace/driveService';
import { sheetsService } from './workspace/sheetsService';
import { formsService } from './workspace/formsService';
import {
  normalizeImportText,
  parseHtmlOrTextDocumentTo2DGrid,
  parseDocxArrayBufferTo2DGrid,
  ensureHeaderRowIn2DGrid,
} from '../utils/gradeImportParser';
import {
  autoDetectGoogleFormsColumns,
  filterFormsToIdentityAndScoreOnly,
  filterSheetToStudentAndGradeOnly,
} from '../utils/googleFormsEvaluationHelper';

const CSV_SAMPLE_LINES_COUNT = 5;
const DELIMITER_COMMA = ',';
const DELIMITER_SEMICOLON = ';';
const DELIMITER_TAB = '\t';
const DOUBLE_QUOTE_CHAR = '"';
const UTF8_BOM_REGEX = /^\uFEFF/;

const SHEET_LABEL_CSV = 'CSV';
const SHEET_LABEL_WORD_DOC = 'Documento Word';
const SHEET_LABEL_GENERIC_DOC = 'Documento';
const SHEET_LABEL_GOOGLE_FORMS = 'Google Forms';
const SHEET_LABEL_GOOGLE_DOCS = 'Google Docs';
const SHEET_LABEL_WEB_LINK = 'Enlace Web';
const SHEET_LABEL_PASTED = 'Pegado';

const DEFAULT_CATEGORY_ID = 'cat-default';
const DEFAULT_EVALUATION_CATEGORY_NAME = 'Evaluaciones';
const DEFAULT_CATEGORY_WEIGHT = 100;
const DEFAULT_FORMS_SUBCATEGORY_TITLE = 'Evaluación Forms';
const DEFAULT_SCORE_COLUMN_HEADER = 'Puntuación';

const ORDER_BY_ROSTER_KEY = '__ORDER__';
const HEADER_DISPOSITION = 'Disposición';
const HEADER_ABSENCES = 'Faltas';
const HEADER_ABSENCES_ALT = 'Ausencias';
const HEADER_GRADE = 'Nota';
const HEADER_FULL_NAME = 'Apellido y Nombre';
const HEADER_LAST_NAME = 'Apellido';
const HEADER_FIRST_NAME = 'Nombre';

const REMOTE_DOCUMENT_PROXY_ENDPOINT = '/api/workspace/fetch-remote-document';
const GOOGLE_FORMS_PUBLIC_ID_PREFIX = '1FAIpQL';

export interface LoadedImportDataset {
  rawWorkbook: XLSXType.WorkBook | null;
  sheetNames: string[];
  selectedSheetName: string;
  raw2DGrid: any[][];
  headerRowIndex: number;
  headers: string[];
  rows: Array<Record<string, any>>;
  sourceLabel: string;
  activeRemoteSpreadsheetId?: string;
  sheetUrlInput?: string;
  presetOverrides?: {
    nameCol?: string;
    secondaryNameCol?: string;
    emailCol?: string;
    colConfigs?: DetectedColumnConfig[];
  };
}

/**
 * Convierte contenido de texto CSV o TSV en una matriz bidimensional de celdas (`string[][]`),
 * detectando automáticamente el delimitador predominante (`,`, `;` o `\t`) y respetando comillas escapadas.
 *
 * @param csvText Texto plano del archivo CSV/TSV (con o sin marca BOM UTF-8).
 * @returns Matriz 2D de filas y celdas limpias, o `[]` si el texto está vacío o es inválido.
 */
export function parseCsvTextTo2D(csvText: string): string[][] {
  if (typeof csvText !== 'string' || !csvText.trim()) return [];

  try {
    const cleanText = csvText.replace(UTF8_BOM_REGEX, '');
    const nonEmptyLines = cleanText
      .split(/\r?\n/)
      .filter((line) => typeof line === 'string' && line.trim() !== '');
    if (nonEmptyLines.length === 0) return [];

    const countDelimiterOccurrences = (line: string, delimiterChar: string): number => {
      let isInsideQuotes = false;
      let occurrenceCount = 0;
      for (let charIndex = 0; charIndex < line.length; charIndex++) {
        const currentChar = line[charIndex];
        if (currentChar === DOUBLE_QUOTE_CHAR) {
          isInsideQuotes = !isInsideQuotes;
        } else if (!isInsideQuotes && currentChar === delimiterChar) {
          occurrenceCount++;
        }
      }
      return occurrenceCount;
    };

    const sampleLines = nonEmptyLines.slice(0, CSV_SAMPLE_LINES_COUNT);
    const semicolonTotalCount = sampleLines.reduce(
      (accumulator, line) => accumulator + countDelimiterOccurrences(line, DELIMITER_SEMICOLON),
      0
    );
    const commaTotalCount = sampleLines.reduce(
      (accumulator, line) => accumulator + countDelimiterOccurrences(line, DELIMITER_COMMA),
      0
    );
    const tabTotalCount = sampleLines.reduce(
      (accumulator, line) => accumulator + countDelimiterOccurrences(line, DELIMITER_TAB),
      0
    );

    // En configuraciones regionales de Argentina/España, Excel exporta CSV separado por punto y coma para no colisionar con la coma decimal.
    let detectedDelimiter = DELIMITER_COMMA;
    if (tabTotalCount > semicolonTotalCount && tabTotalCount > commaTotalCount) {
      detectedDelimiter = DELIMITER_TAB;
    } else if (semicolonTotalCount > commaTotalCount) {
      detectedDelimiter = DELIMITER_SEMICOLON;
    }

    const splitCsvLineIntoCells = (line: string): string[] => {
      const parsedCells: string[] = [];
      let currentCellBuffer = '';
      let isInsideQuotes = false;
      for (let charIndex = 0; charIndex < line.length; charIndex++) {
        const currentChar = line[charIndex];
        if (currentChar === DOUBLE_QUOTE_CHAR) {
          if (isInsideQuotes && line[charIndex + 1] === DOUBLE_QUOTE_CHAR) {
            currentCellBuffer += DOUBLE_QUOTE_CHAR;
            charIndex++;
          } else {
            isInsideQuotes = !isInsideQuotes;
          }
        } else if (currentChar === detectedDelimiter && !isInsideQuotes) {
          parsedCells.push(currentCellBuffer.trim());
          currentCellBuffer = '';
        } else {
          currentCellBuffer += currentChar;
        }
      }
      parsedCells.push(currentCellBuffer.trim());
      return parsedCells;
    };

    return nonEmptyLines.map(splitCsvLineIntoCells);
  } catch (csvParseError) {
    console.warn('Error defensivo al parsear texto CSV:', csvParseError);
    return [];
  }
}

/**
 * Divide una línea pegada desde el portapapeles en celdas individuales.
 * Soporta tabulaciones de Excel/Sheets, punto y coma, o texto libre con puntaje al final (ej. "García, Ana - 9,5").
 *
 * @param rawLine Línea individual de texto pegado por el docente.
 * @returns Arreglo de celdas extraídas de la línea.
 */
export function splitPasteLineSmart(rawLine: string): string[] {
  const safeLine = String(rawLine ?? '');
  if (!safeLine.trim()) return [];

  if (safeLine.includes(DELIMITER_TAB)) {
    return safeLine.split(DELIMITER_TAB).map((cellValue) => cellValue.trim());
  }
  if (safeLine.includes(DELIMITER_SEMICOLON)) {
    return safeLine.split(DELIMITER_SEMICOLON).map((cellValue) => cellValue.trim());
  }
  const trailingScoreMatch = safeLine.match(
    /^(.+?)(?:\s+[-|:]\s+|\s{2,}|\s+)(-?\d+(?:[.,]\d+)?(?:\s*(?:pts?|puntos?|mb|b|ex|r))?)$/i
  );
  if (trailingScoreMatch) {
    return [trailingScoreMatch[1].trim(), trailingScoreMatch[2].trim()];
  }
  return [safeLine.trim()];
}

/**
 * Extrae y normaliza una pestaña específica de un libro de Excel (`XLSX.WorkBook`) hacia un `LoadedImportDataset`.
 *
 * @param workbook Instancia del libro de Excel ya cargado en memoria.
 * @param sheetName Nombre exacto de la hoja a procesar.
 * @param sourceFileName Nombre opcional del archivo de origen para mostrar en la trazabilidad.
 * @returns El conjunto de datos estructurado o `null` si la hoja no existe o carece de datos.
 */
export async function extractExcelSheetDataset(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  sourceFileName?: string
): Promise<LoadedImportDataset | null> {
  if (!workbook || !workbook.Sheets || !sheetName) return null;
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return null;

  try {
    const XLSX = await import('xlsx');
    const raw2DFromSheet: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    });
    const normalized2DGrid = ensureHeaderRowIn2DGrid(
      Array.isArray(raw2DFromSheet) ? raw2DFromSheet : []
    );
    const { headers, rows, headerRowIndex } =
      sheetsService.convert2DArrayToTableObjects(normalized2DGrid);
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(headers) || headers.length === 0) {
      return null;
    }

    return {
      rawWorkbook: workbook,
      sheetNames: Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [sheetName],
      selectedSheetName: sheetName,
      raw2DGrid: normalized2DGrid,
      headerRowIndex,
      headers,
      rows,
      sourceLabel: sourceFileName ? `${sourceFileName} (${sheetName})` : sheetName,
    };
  } catch (sheetExtractionError) {
    console.warn(`Error al extraer la hoja "${sheetName}" del archivo Excel:`, sheetExtractionError);
    return null;
  }
}

/**
 * Procesa cualquier archivo local subido por el docente (`.xlsx`, `.xls`, `.csv`, `.tsv`, `.docx`, `.doc`, `.txt`, `.html`)
 * y lo unifica en un `LoadedImportDataset` listo para la vista previa de mapeo.
 *
 * @param uploadedFile Objeto `File` seleccionado desde el navegador.
 * @returns El dataset normalizado o `null` si el archivo está vacío o tiene un formato ilegible.
 */
export async function parseUploadedImportFile(
  uploadedFile: File
): Promise<LoadedImportDataset | null> {
  if (!uploadedFile || typeof uploadedFile.name !== 'string' || uploadedFile.size === 0) {
    return null;
  }

  try {
    const lowerCaseFileName = uploadedFile.name.toLowerCase();
    const isCsvFile =
      lowerCaseFileName.endsWith('.csv') ||
      lowerCaseFileName.endsWith('.tsv') ||
      uploadedFile.type === 'text/csv';
    const isDocxFile = lowerCaseFileName.endsWith('.docx');
    const isTextOrHtmlDocument =
      lowerCaseFileName.endsWith('.doc') ||
      lowerCaseFileName.endsWith('.txt') ||
      lowerCaseFileName.endsWith('.html') ||
      lowerCaseFileName.endsWith('.htm');

    if (isCsvFile) {
      const csvContent = await uploadedFile.text();
      const normalized2DGrid = ensureHeaderRowIn2DGrid(parseCsvTextTo2D(csvContent));
      if (normalized2DGrid.length === 0) return null;
      const { headers, rows, headerRowIndex } =
        sheetsService.convert2DArrayToTableObjects(normalized2DGrid);
      if (rows.length === 0 || headers.length === 0) return null;
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_CSV],
        selectedSheetName: SHEET_LABEL_CSV,
        raw2DGrid: normalized2DGrid,
        headerRowIndex,
        headers,
        rows,
        sourceLabel: `${uploadedFile.name} (${SHEET_LABEL_CSV})`,
      };
    }

    if (isDocxFile) {
      const fileArrayBuffer = await uploadedFile.arrayBuffer();
      const normalized2DGrid = await parseDocxArrayBufferTo2DGrid(fileArrayBuffer);
      if (normalized2DGrid.length === 0) return null;
      const { headers, rows, headerRowIndex } =
        sheetsService.convert2DArrayToTableObjects(normalized2DGrid);
      if (rows.length === 0 || headers.length === 0) return null;
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_WORD_DOC],
        selectedSheetName: SHEET_LABEL_WORD_DOC,
        raw2DGrid: normalized2DGrid,
        headerRowIndex,
        headers,
        rows,
        sourceLabel: `${uploadedFile.name} (Word)`,
      };
    }

    if (isTextOrHtmlDocument) {
      const textContent = await uploadedFile.text();
      const normalized2DGrid = parseHtmlOrTextDocumentTo2DGrid(textContent);
      if (normalized2DGrid.length === 0) return null;
      const { headers, rows, headerRowIndex } =
        sheetsService.convert2DArrayToTableObjects(normalized2DGrid);
      if (rows.length === 0 || headers.length === 0) return null;
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_GENERIC_DOC],
        selectedSheetName: SHEET_LABEL_GENERIC_DOC,
        raw2DGrid: normalized2DGrid,
        headerRowIndex,
        headers,
        rows,
        sourceLabel: uploadedFile.name,
      };
    }

    const excelArrayBuffer = await uploadedFile.arrayBuffer();
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(excelArrayBuffer, { type: 'array' });
    const firstSheetName = workbook?.SheetNames?.[0];
    if (!firstSheetName) return null;
    return await extractExcelSheetDataset(workbook, firstSheetName, uploadedFile.name);
  } catch (fileParseError) {
    console.warn(`Error defensivo al leer el archivo "${uploadedFile.name}":`, fileParseError);
    return null;
  }
}

/**
 * Descarga e interpreta un documento remoto de Google Workspace (Google Forms, Google Docs, Google Sheets)
 * o un enlace web directo (`.csv`/`.html`) hacia un `LoadedImportDataset`.
 * Cuando `importContext` es `'grades'`, filtra automáticamente las columnas intermedias o consignas
 * para conservar únicamente al Alumno y la Nota.
 *
 * @param params URL o ID del recurso remoto, pestaña opcional y contexto del curso activo.
 * @returns El conjunto de datos cargado y preconfigurado.
 * @throws {Error} Con mensaje descriptivo en español si el enlace es inválido, privado o no contiene datos.
 */
export async function loadRemoteImportDocument(params: {
  idOrUrl: string;
  targetTab?: string;
  explicitDocType?: 'sheet' | 'doc' | 'form';
  students: Student[];
  activeCategories: GradeCategory[];
  importContext?: 'grades' | 'attendance';
}): Promise<LoadedImportDataset> {
  const trimmedInputUrl = String(params?.idOrUrl ?? '').trim();
  if (!trimmedInputUrl) {
    throw new Error('Por favor ingresá un enlace o ID de documento válido.');
  }

  const targetTab = params?.targetTab;
  const explicitDocType = params?.explicitDocType;
  const safeStudents = Array.isArray(params?.students) ? params.students : [];
  const safeCategories = Array.isArray(params?.activeCategories) ? params.activeCategories : [];
  const importContext = params?.importContext || 'grades';

  const evaluationCategory =
    safeCategories.find((category) =>
      /evaluacion|examen|prueba|forms/i.test(normalizeImportText(category?.name || ''))
    ) ||
    safeCategories[0] || {
      id: DEFAULT_CATEGORY_ID,
      name: DEFAULT_EVALUATION_CATEGORY_NAME,
      weight: DEFAULT_CATEGORY_WEIGHT,
      subcategories: [],
    };

  const isGoogleFormsUrl =
    explicitDocType === 'form' ||
    /\/forms\/(?:u\/\d+\/)?d\//i.test(trimmedInputUrl) ||
    /forms\.gle\//i.test(trimmedInputUrl) ||
    trimmedInputUrl.startsWith(GOOGLE_FORMS_PUBLIC_ID_PREFIX);

  if (isGoogleFormsUrl) {
    const formEvaluationResult = await formsService.fetchGoogleFormEvaluations(trimmedInputUrl);
    const formHeaders = Array.isArray(formEvaluationResult?.headers)
      ? formEvaluationResult.headers
      : [];
    const formRows = Array.isArray(formEvaluationResult?.rows) ? formEvaluationResult.rows : [];
    if (!formHeaders.length || !formRows.length) {
      throw new Error('El formulario de Google Forms no contiene respuestas de alumnos.');
    }

    const detectedFormColumns = autoDetectGoogleFormsColumns(formHeaders, formRows, safeStudents);
    const { nameCol, secondaryNameCol, emailCol, scoreCol } = detectedFormColumns;
    // Se filtran las preguntas del cuestionario antes de construir el dataset para que el usuario solo vea Identidad + Nota Final.
    const { filteredHeaders, filteredRows } = filterFormsToIdentityAndScoreOnly(
      formRows,
      detectedFormColumns
    );

    const cleanEvaluationTitle =
      String(formEvaluationResult?.title || '')
        .replace(/\(respuestas.*?\)/gi, '')
        .replace(/\(responses.*?\)/gi, '')
        .trim() || DEFAULT_FORMS_SUBCATEGORY_TITLE;

    const columnConfigs: DetectedColumnConfig[] = [
      {
        colKey: scoreCol || DEFAULT_SCORE_COLUMN_HEADER,
        isIncluded: true,
        kind: 'grade',
        targetCategoryMode: 'existing',
        targetCategoryId: evaluationCategory.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: cleanEvaluationTitle,
      },
    ];

    const raw2DGrid = [
      filteredHeaders,
      ...filteredRows.map((rowRecord) =>
        filteredHeaders.map((headerName) => String(rowRecord?.[headerName] ?? ''))
      ),
    ];

    return {
      rawWorkbook: null,
      sheetNames: [SHEET_LABEL_GOOGLE_FORMS],
      selectedSheetName: SHEET_LABEL_GOOGLE_FORMS,
      raw2DGrid,
      headerRowIndex: 0,
      headers: filteredHeaders,
      rows: filteredRows,
      sourceLabel: `${SHEET_LABEL_GOOGLE_FORMS}: ${cleanEvaluationTitle}`,
      activeRemoteSpreadsheetId: '',
      sheetUrlInput: trimmedInputUrl,
      presetOverrides: {
        nameCol: nameCol || emailCol,
        secondaryNameCol,
        emailCol,
        colConfigs: columnConfigs,
      },
    };
  }

  const googleDocUrlMatch = trimmedInputUrl.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/i);
  if (googleDocUrlMatch || explicitDocType === 'doc') {
    const documentId = googleDocUrlMatch ? googleDocUrlMatch[1] : trimmedInputUrl;
    const exportedDocContent = await driveService.exportGoogleDocContent(documentId);
    if (!exportedDocContent || (!exportedDocContent.html && !exportedDocContent.text)) {
      throw new Error(
        'No se pudo leer el Google Doc. Verificá que el documento tenga permisos de lectura o que hayas conectado tu Google Drive.'
      );
    }
    const raw2DGrid = parseHtmlOrTextDocumentTo2DGrid(
      exportedDocContent.html || exportedDocContent.text || ''
    );
    if (raw2DGrid.length === 0) {
      throw new Error(
        'El documento de Google Docs no contiene tablas ni filas con nombres y notas.'
      );
    }
    const { headers, rows, headerRowIndex } =
      sheetsService.convert2DArrayToTableObjects(raw2DGrid);
    if (rows.length === 0 || headers.length === 0) {
      throw new Error('No se detectaron alumnos o notas en el Google Doc.');
    }
    return {
      rawWorkbook: null,
      sheetNames: [SHEET_LABEL_GOOGLE_DOCS],
      selectedSheetName: SHEET_LABEL_GOOGLE_DOCS,
      raw2DGrid,
      headerRowIndex,
      headers,
      rows,
      sourceLabel: `${SHEET_LABEL_GOOGLE_DOCS}: ${exportedDocContent.title}`,
      activeRemoteSpreadsheetId: '',
      sheetUrlInput: trimmedInputUrl,
    };
  }

  if (
    /^https?:\/\//i.test(trimmedInputUrl) &&
    !trimmedInputUrl.includes('docs.google.com/spreadsheets') &&
    !trimmedInputUrl.includes('drive.google.com')
  ) {
    try {
      let fetchedDocumentText = '';
      try {
        const directResponse = await fetch(trimmedInputUrl);
        if (directResponse.ok) fetchedDocumentText = await directResponse.text();
      } catch {}

      // Si el servidor externo bloquea CORS desde el navegador, se intenta recuperar el documento vía proxy backend.
      if (!fetchedDocumentText) {
        const proxyResponse = await fetch(REMOTE_DOCUMENT_PROXY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmedInputUrl }),
        });
        if (proxyResponse.ok) {
          const proxyPayload = await proxyResponse.json().catch(() => null);
          if (proxyPayload?.ok && proxyPayload.text) {
            fetchedDocumentText = proxyPayload.text;
          }
        }
      }

      if (fetchedDocumentText) {
        const raw2DGrid = trimmedInputUrl.toLowerCase().endsWith('.csv')
          ? ensureHeaderRowIn2DGrid(parseCsvTextTo2D(fetchedDocumentText))
          : parseHtmlOrTextDocumentTo2DGrid(fetchedDocumentText);
        if (raw2DGrid.length > 0) {
          const { headers, rows, headerRowIndex } =
            sheetsService.convert2DArrayToTableObjects(raw2DGrid);
          if (rows.length > 0 && headers.length > 0) {
            return {
              rawWorkbook: null,
              sheetNames: [SHEET_LABEL_WEB_LINK],
              selectedSheetName: SHEET_LABEL_WEB_LINK,
              raw2DGrid,
              headerRowIndex,
              headers,
              rows,
              sourceLabel: 'Documento desde Enlace',
              activeRemoteSpreadsheetId: '',
              sheetUrlInput: trimmedInputUrl,
            };
          }
        }
      }
    } catch {}
  }

  try {
    const spreadsheetResult = await sheetsService.fetchArbitrarySpreadsheetData(
      trimmedInputUrl,
      targetTab
    );
    const normalized2DGrid = ensureHeaderRowIn2DGrid(spreadsheetResult.raw2D || []);
    const parsedTableData =
      normalized2DGrid.length > 0
        ? sheetsService.convert2DArrayToTableObjects(normalized2DGrid)
        : {
            headers: spreadsheetResult.headers || [],
            rows: spreadsheetResult.rows || [],
            headerRowIndex: spreadsheetResult.headerRowIndex ?? 0,
          };

    if (parsedTableData.rows.length === 0 && normalized2DGrid.length === 0) {
      throw new Error(`La pestaña "${spreadsheetResult.selectedSheet}" no contiene filas de datos.`);
    }

    if (importContext === 'grades') {
      const reduced = filterSheetToStudentAndGradeOnly({
        headers: parsedTableData.headers,
        rows: parsedTableData.rows,
        students: safeStudents,
      });

      const cleanSheetTitle =
        String(spreadsheetResult.title || '')
          .replace(/\(respuestas.*?\)/gi, '')
          .replace(/\(responses.*?\)/gi, '')
          .trim() ||
        reduced.scoreCol ||
        HEADER_GRADE;

      const scoreColKey = reduced.scoreCol || HEADER_GRADE;
      const columnConfigs: DetectedColumnConfig[] = reduced.scoreCol
        ? [
            {
              colKey: scoreColKey,
              isIncluded: true,
              kind: 'grade',
              targetCategoryMode: 'existing',
              targetCategoryId: evaluationCategory.id,
              newCategoryName: '',
              targetSubcategoryMode: 'new',
              targetSubcategoryId: '',
              subcategoryName:
                /^(puntuacion|puntaje|score|nota|nota final|calificacion)$/i.test(
                  normalizeImportText(scoreColKey)
                )
                  ? cleanSheetTitle
                  : scoreColKey,
            },
          ]
        : undefined!;

      const filtered2DGrid = [
        reduced.filteredHeaders,
        ...reduced.filteredRows.map((rowRecord) =>
          reduced.filteredHeaders.map((headerName) => String(rowRecord?.[headerName] ?? ''))
        ),
      ];

      return {
        rawWorkbook: null,
        sheetNames: spreadsheetResult.sheetNames || [spreadsheetResult.selectedSheet],
        selectedSheetName: spreadsheetResult.selectedSheet,
        raw2DGrid: filtered2DGrid,
        headerRowIndex: 0,
        headers: reduced.filteredHeaders,
        rows: reduced.filteredRows,
        sourceLabel: `Google Sheet: ${spreadsheetResult.title} (${spreadsheetResult.selectedSheet})`,
        activeRemoteSpreadsheetId: spreadsheetResult.spreadsheetId,
        sheetUrlInput: trimmedInputUrl,
        presetOverrides: {
          nameCol: reduced.nameCol || reduced.emailCol,
          secondaryNameCol: reduced.secondaryNameCol,
          emailCol: reduced.emailCol,
          colConfigs: columnConfigs,
        },
      };
    }

    return {
      rawWorkbook: null,
      sheetNames: spreadsheetResult.sheetNames || [spreadsheetResult.selectedSheet],
      selectedSheetName: spreadsheetResult.selectedSheet,
      raw2DGrid: normalized2DGrid,
      headerRowIndex: parsedTableData.headerRowIndex ?? 0,
      headers: parsedTableData.headers,
      rows: parsedTableData.rows,
      sourceLabel: `Google Sheet: ${spreadsheetResult.title} (${spreadsheetResult.selectedSheet})`,
      activeRemoteSpreadsheetId: spreadsheetResult.spreadsheetId,
      sheetUrlInput: trimmedInputUrl,
    };
  } catch (spreadsheetLoadError: any) {
    // Algunos enlaces compartidos de Google Drive usan formato `/file/d/{id}` sin especificar si son Sheet o Doc; si falla como Sheet, se intenta como Google Doc.
    try {
      const genericDriveIdMatch = trimmedInputUrl.match(/[-\w]{25,}/);
      if (genericDriveIdMatch && !/\/forms\//i.test(trimmedInputUrl)) {
        const docFallbackResult = await driveService.exportGoogleDocContent(genericDriveIdMatch[0]);
        if (docFallbackResult && (docFallbackResult.html || docFallbackResult.text)) {
          const raw2DGrid = parseHtmlOrTextDocumentTo2DGrid(
            docFallbackResult.html || docFallbackResult.text || ''
          );
          if (raw2DGrid.length > 0) {
            const { headers, rows, headerRowIndex } =
              sheetsService.convert2DArrayToTableObjects(raw2DGrid);
            if (rows.length > 0 && headers.length > 0) {
              return {
                rawWorkbook: null,
                sheetNames: [SHEET_LABEL_GOOGLE_DOCS],
                selectedSheetName: SHEET_LABEL_GOOGLE_DOCS,
                raw2DGrid,
                headerRowIndex,
                headers,
                rows,
                sourceLabel: `${SHEET_LABEL_GOOGLE_DOCS}: ${docFallbackResult.title}`,
                activeRemoteSpreadsheetId: '',
                sheetUrlInput: trimmedInputUrl,
              };
            }
          }
        }
      }
    } catch {}

    throw new Error(
      spreadsheetLoadError?.message ||
        'No se pudo leer el documento desde el enlace. Verificá que el link sea de Google Sheets, Google Docs o Google Forms y que tengas acceso.'
    );
  }
}

/**
 * Construye un `LoadedImportDataset` a partir de texto pegado manualmente por el docente,
 * aplicando el preset rápido seleccionado (ej. solo notas por orden de lista, Alumno + Faltas, etc.).
 *
 * @param params Texto pegado, preset activo, categorías del curso y modo de destino (notas o asistencia).
 * @returns El dataset estructurado con encabezados sintéticos y `presetOverrides`, o `null` si el texto no contiene filas válidas.
 */
export function buildPasteImportDataset(params: {
  pasteText: string;
  quickPastePreset: QuickPastePreset;
  activeCategories: GradeCategory[];
  importContext: 'grades' | 'attendance';
  attendanceTargetMode: 'disposition' | 'absences' | 'both';
}): LoadedImportDataset | null {
  if (!params || typeof params.pasteText !== 'string' || !params.pasteText.trim()) {
    return null;
  }

  try {
    const {
      pasteText,
      quickPastePreset,
      activeCategories,
      importContext,
      attendanceTargetMode,
    } = params;

    const nonEmptyLines = pasteText
      .split('\n')
      .map((line) => line.replace(/\r/g, ''))
      .filter((line) => line.trim() !== '');
    if (nonEmptyLines.length === 0) return null;

    const raw2DGrid = nonEmptyLines
      .map((line) => splitPasteLineSmart(line))
      .filter((rowCells) => rowCells.length > 0);
    if (raw2DGrid.length === 0) return null;

    const safeCategories = Array.isArray(activeCategories) ? activeCategories : [];
    const defaultCategory = safeCategories[0] || {
      id: DEFAULT_CATEGORY_ID,
      name: DEFAULT_EVALUATION_CATEGORY_NAME,
      weight: DEFAULT_CATEGORY_WEIGHT,
      subcategories: [],
    };

    const createAttendanceColumnConfig = (
      columnKey: string,
      columnKind: 'disposition' | 'absences'
    ): DetectedColumnConfig => ({
      colKey: columnKey,
      isIncluded: true,
      kind: columnKind,
      targetCategoryMode: 'existing',
      targetCategoryId: defaultCategory.id,
      newCategoryName: '',
      targetSubcategoryMode: 'new',
      targetSubcategoryId: '',
      subcategoryName: columnKey,
    });

    const firstRowCells = Array.isArray(raw2DGrid[0]) ? raw2DGrid[0] : [];
    const firstRowJoinedText = firstRowCells.join(' ').toLowerCase();
    // Se ignora el índice 0 al buscar números porque una lista numerada ("1. García Ana") tiene un número en la primera celda aunque sea una fila de alumno.
    const firstRowContainsNumbers = firstRowCells.some((cellValue, cellIndex) => {
      if (cellIndex === 0 && firstRowCells.length > 1) return false;
      return /^-?\d+(?:[.,]\d+)?$/.test(String(cellValue ?? '').trim());
    });
    const hasExplicitHeaderRow =
      !firstRowContainsNumbers &&
      /alumno|nombre|apellido|estudiante|nota|tp|eval|examen|falta|ausencia|tardanza|disposicion|conducta|concepto/i.test(
        firstRowJoinedText
      );
    const dataRows2D = hasExplicitHeaderRow ? raw2DGrid.slice(1) : raw2DGrid;
    if (dataRows2D.length === 0) return null;

    if (quickPastePreset === 'only_disp_ordered' || quickPastePreset === 'only_abs_ordered') {
      const isDispositionMode = quickPastePreset === 'only_disp_ordered';
      const columnHeader = isDispositionMode ? HEADER_DISPOSITION : HEADER_ABSENCES;
      const normalized2DGrid = [
        [columnHeader],
        ...dataRows2D.map((rowCells) => [rowCells[rowCells.length - 1] ?? rowCells[0] ?? '']),
      ];
      const rows = dataRows2D.map((rowCells) => ({
        [columnHeader]: rowCells[rowCells.length - 1] ?? rowCells[0] ?? '',
      }));
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_PASTED],
        selectedSheetName: SHEET_LABEL_PASTED,
        raw2DGrid: normalized2DGrid,
        headerRowIndex: 0,
        headers: [columnHeader],
        rows,
        sourceLabel: isDispositionMode
          ? 'Pegado Rápido (Disposición por Orden de Lista)'
          : 'Pegado Rápido (Faltas por Orden de Lista)',
        presetOverrides: {
          nameCol: ORDER_BY_ROSTER_KEY,
          secondaryNameCol: '',
          emailCol: '',
          colConfigs: [
            createAttendanceColumnConfig(
              columnHeader,
              isDispositionMode ? 'disposition' : 'absences'
            ),
          ],
        },
      };
    }

    if (quickPastePreset === 'name_and_disp' || quickPastePreset === 'name_and_abs') {
      const isDispositionMode = quickPastePreset === 'name_and_disp';
      const metricHeader = isDispositionMode ? HEADER_DISPOSITION : HEADER_ABSENCES;
      const headers = [HEADER_FULL_NAME, metricHeader];
      const normalized2DGrid = [
        headers,
        ...dataRows2D.map((rowCells) => [rowCells[0] || '', rowCells[1] ?? '']),
      ];
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2DGrid, 0);
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_PASTED],
        selectedSheetName: SHEET_LABEL_PASTED,
        raw2DGrid: normalized2DGrid,
        headerRowIndex: 0,
        headers,
        rows,
        sourceLabel: isDispositionMode
          ? 'Pegado Rápido (Alumno + Disposición)'
          : 'Pegado Rápido (Alumno + Cantidad de Faltas)',
        presetOverrides: {
          nameCol: HEADER_FULL_NAME,
          secondaryNameCol: '',
          emailCol: '',
          colConfigs: [
            createAttendanceColumnConfig(
              metricHeader,
              isDispositionMode ? 'disposition' : 'absences'
            ),
          ],
        },
      };
    }

    if (quickPastePreset === 'last_first_disp' || quickPastePreset === 'last_first_abs') {
      const isDispositionMode = quickPastePreset === 'last_first_disp';
      const metricHeader = isDispositionMode ? HEADER_DISPOSITION : HEADER_ABSENCES;
      const headers = [HEADER_LAST_NAME, HEADER_FIRST_NAME, metricHeader];
      const normalized2DGrid = [
        headers,
        ...dataRows2D.map((rowCells) => [rowCells[0] || '', rowCells[1] || '', rowCells[2] ?? '']),
      ];
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2DGrid, 0);
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_PASTED],
        selectedSheetName: SHEET_LABEL_PASTED,
        raw2DGrid: normalized2DGrid,
        headerRowIndex: 0,
        headers,
        rows,
        sourceLabel: isDispositionMode
          ? 'Pegado Rápido (Apellido + Nombre + Disposición)'
          : 'Pegado Rápido (Apellido + Nombre + Faltas)',
        presetOverrides: {
          nameCol: HEADER_LAST_NAME,
          secondaryNameCol: HEADER_FIRST_NAME,
          emailCol: '',
          colConfigs: [
            createAttendanceColumnConfig(
              metricHeader,
              isDispositionMode ? 'disposition' : 'absences'
            ),
          ],
        },
      };
    }

    if (quickPastePreset === 'name_abs_disp') {
      const headers = [HEADER_FULL_NAME, HEADER_ABSENCES_ALT, HEADER_DISPOSITION];
      const normalized2DGrid = [
        headers,
        ...dataRows2D.map((rowCells) => [rowCells[0] || '', rowCells[1] ?? '', rowCells[2] ?? '']),
      ];
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2DGrid, 0);
      return {
        rawWorkbook: null,
        sheetNames: [SHEET_LABEL_PASTED],
        selectedSheetName: SHEET_LABEL_PASTED,
        raw2DGrid: normalized2DGrid,
        headerRowIndex: 0,
        headers,
        rows,
        sourceLabel: 'Pegado Rápido (Alumno + Ausencias + Disposición)',
        presetOverrides: {
          nameCol: HEADER_FULL_NAME,
          secondaryNameCol: '',
          emailCol: '',
          colConfigs: [
            createAttendanceColumnConfig(HEADER_ABSENCES_ALT, 'absences'),
            createAttendanceColumnConfig(HEADER_DISPOSITION, 'disposition'),
          ],
        },
      };
    }

    const defaultColumnLabel =
      importContext === 'attendance'
        ? attendanceTargetMode === 'absences'
          ? HEADER_ABSENCES
          : HEADER_DISPOSITION
        : HEADER_GRADE;
    const final2DGrid = hasExplicitHeaderRow
      ? raw2DGrid
      : [
          [
            HEADER_FULL_NAME,
            ...firstRowCells.slice(1).map((_, columnIndex) =>
              columnIndex === 0 && importContext === 'attendance'
                ? defaultColumnLabel
                : `${defaultColumnLabel} ${columnIndex + 1}`
            ),
          ],
          ...raw2DGrid,
        ];

    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(final2DGrid, 0);
    if (rows.length === 0) return null;

    return {
      rawWorkbook: null,
      sheetNames: [SHEET_LABEL_PASTED],
      selectedSheetName: SHEET_LABEL_PASTED,
      raw2DGrid: final2DGrid,
      headerRowIndex: 0,
      headers,
      rows,
      sourceLabel: 'Datos Pegados desde Planilla',
    };
  } catch (pasteBuildError) {
    console.warn('Error defensivo al procesar texto pegado:', pasteBuildError);
    return null;
  }
}
