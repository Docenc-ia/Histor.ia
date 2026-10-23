import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  Upload,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  X,
  Search,
  ArrowRight,
  Eye,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Download,
  FileCheck,
  Info,
  Check,
  Calendar,
  History,
  Layers,
  Link2,
  FolderOpen,
  Loader2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import type * as XLSXType from 'xlsx';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import {
  GradeHistoryEntry,
  exportGradeHistoryToExcel,
} from '../../utils/excelExport';
import { driveService } from '../../services/workspace/driveService';
import { sheetsService } from '../../services/workspace/sheetsService';
import {
  normalizeImportText,
  autoDetectIdentityColumns,
  autoDetectColumnsConfiguration,
  computeMultiVerificationRows,
  parseFlexibleCellNumber,
} from '../../utils/gradeImportParser';

export interface ParsedStudentRow {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  matchedFromRaw: string;
  matchScore: number; // 0 to 1
  currentScore?: string;
  importedScore: string;
  editedScore: string;
  isValid: boolean;
  isIncluded: boolean;
  status: 'new' | 'update' | 'same' | 'missing_in_file' | 'invalid';
  note?: string;
}

export type DetectedColumnKind =
  | 'grade'
  | 'absences'
  | 'lates'
  | 'disposition'
  | 'disposition_deduction'
  | 'ignore';

export type QuickPastePreset =
  | 'auto'
  | 'name_and_disp'
  | 'last_first_disp'
  | 'name_abs_disp'
  | 'only_disp_ordered';

export interface DetectedColumnConfig {
  colKey: string; // Raw column header in Excel/Sheets
  isIncluded: boolean;
  kind: DetectedColumnKind;
  // For 'grade' columns:
  targetCategoryMode: 'existing' | 'new';
  targetCategoryId: string;
  newCategoryName: string;
  targetSubcategoryMode: 'existing' | 'new';
  targetSubcategoryId: string;
  subcategoryName: string;
}

export interface MultiVerifiedStudentRow {
  rowId: string;
  studentId: string; // Either existing student.id or `new-st-...`
  isNewStudent: boolean;
  studentName: string;
  firstName: string;
  lastName: string;
  studentEmail: string;
  matchedFromRaw: string;
  matchScore: number;
  isIncluded: boolean;
  // Values keyed by colKey
  valuesByCol: Record<
    string,
    {
      currentVal: string;
      importedVal: string;
      editedVal: string;
      isValid: boolean;
      status: 'new' | 'update' | 'same' | 'empty' | 'invalid';
    }
  >;
}

export interface MultiImportApplyPayload {
  term: '1c' | '2c';
  updatedCategories: GradeCategory[];
  updatedGradesMap: StudentGradesMap;
  historyEntries: GradeHistoryEntry[];
  attendanceUpdates: Record<
    string,
    {
      absences?: number;
      lates?: number;
      disposition?: number;
    }
  >;
  newStudentsToCreate: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
  sourceLabel: string;
}

export interface ImportGradesModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  students: Student[];
  categories1c: GradeCategory[];
  categories2c: GradeCategory[];
  gradesMap1c: StudentGradesMap;
  gradesMap2c: StudentGradesMap;
  currentTerm: '1c' | '2c';
  isDarkMode: boolean;
  initialSourceType?: 'file' | 'sheets' | 'paste';
  importContext?: 'grades' | 'attendance';
  currentDispositionMap1c?: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
  currentDispositionMap2c?: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }>;
  onApplyGrades: (data: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>;
    historyEntry: GradeHistoryEntry;
  }) => void;
  onApplyMultiImport?: (payload: MultiImportApplyPayload) => void;
  historyEntries?: GradeHistoryEntry[];
}

function getColLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export const ImportGradesModal: React.FC<ImportGradesModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  students,
  categories1c,
  categories2c,
  gradesMap1c,
  gradesMap2c,
  currentTerm: initialTerm,
  isDarkMode,
  initialSourceType = 'file',
  importContext = 'grades',
  currentDispositionMap1c = {},
  currentDispositionMap2c = {},
  onApplyGrades,
  onApplyMultiImport,
  historyEntries = [],
}) => {
  const [activeStep, setActiveStep] = useState<'upload' | 'verify' | 'history'>('upload');
  const [sourceType, setSourceType] = useState<'file' | 'sheets' | 'paste'>(initialSourceType);

  useEffect(() => {
    if (isOpen) {
      setSourceType(initialSourceType);
      setActiveStep('upload');
    }
  }, [isOpen, initialSourceType]);

  const [selectedTerm, setSelectedTerm] = useState<'1c' | '2c'>(initialTerm);
  const activeCategories = selectedTerm === '1c' ? categories1c : categories2c;
  const activeGradesMap = selectedTerm === '1c' ? gradesMap1c : gradesMap2c;
  const activeDispMap = selectedTerm === '1c' ? currentDispositionMap1c : currentDispositionMap2c;

  // File / Sheet states
  const [fileName, setFileName] = useState<string>('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [rawWorkbook, setRawWorkbook] = useState<XLSXType.WorkBook | null>(null);
  const [raw2DGrid, setRaw2DGrid] = useState<any[][]>([]);
  const [selectedHeaderRowIndex, setSelectedHeaderRowIndex] = useState<number>(0);
  const [showVisualSheetMapper, setShowVisualSheetMapper] = useState<boolean>(true);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedNameColumn, setSelectedNameColumn] = useState<string>('');
  const [selectedSecondaryNameColumn, setSelectedSecondaryNameColumn] = useState<string>('');
  const [selectedEmailColumn, setSelectedEmailColumn] = useState<string>('');
  const [rawTableRows, setRawTableRows] = useState<Array<Record<string, any>>>([]);

  // Google Sheets remote loading states
  const [sheetUrlInput, setSheetUrlInput] = useState<string>('');
  const [isLoadingRemoteSheet, setIsLoadingRemoteSheet] = useState<boolean>(false);
  const [remoteSheetError, setRemoteSheetError] = useState<string | null>(null);
  const [activeRemoteSpreadsheetId, setActiveRemoteSpreadsheetId] = useState<string>('');
  const [driveSpreadsheets, setDriveSpreadsheets] = useState<
    Array<{ id: string; name: string; modifiedTime?: string; url: string }>
  >([]);
  const [isLoadingDriveSheets, setIsLoadingDriveSheets] = useState<boolean>(false);
  const [driveSearchQuery, setDriveSearchQuery] = useState<string>('');

  // Paste state (Alternativa 3: Pegado rápido de 2 columnas o tabla)
  const [pasteText, setPasteText] = useState<string>('');
  const [quickPastePreset, setQuickPastePreset] = useState<QuickPastePreset>(() =>
    importContext === 'attendance' ? 'name_and_disp' : 'auto'
  );

  useEffect(() => {
    if (isOpen) {
      setQuickPastePreset(importContext === 'attendance' ? 'name_and_disp' : 'auto');
    }
  }, [isOpen, importContext]);

  // Multi-column auto-detection states
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumnConfig[]>([]);
  const [verifiedRows, setVerifiedRows] = useState<MultiVerifiedStudentRow[]>([]);
  const [includeNewStudentsFromDoc, setIncludeNewStudentsFromDoc] = useState<boolean>(false);

  // Filters & inspection mode in Step 2
  const [filterMode, setFilterMode] = useState<'all' | 'changes' | 'missing'>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [inspectionMode, setInspectionMode] = useState<'table' | 'individual'>('table');
  const [selectedStudentIndex, setSelectedStudentIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load teacher's Google Spreadsheets when switching to 'sheets' tab
  const handleLoadDriveSpreadsheets = async (query?: string) => {
    setIsLoadingDriveSheets(true);
    setRemoteSheetError(null);
    try {
      const list = await driveService.listUserSpreadsheets(query);
      setDriveSpreadsheets(list);
    } catch (err: any) {
      console.warn('Error loading Drive spreadsheets:', err);
    } finally {
      setIsLoadingDriveSheets(false);
    }
  };

  useEffect(() => {
    if (isOpen && sourceType === 'sheets' && driveSpreadsheets.length === 0) {
      handleLoadDriveSpreadsheets();
    }
  }, [isOpen, sourceType]);

  const normalizeText = normalizeImportText;

  /**
   * Builds the multi-column verification table for all students in the course + any new students in the file
   */
  const buildMultiVerificationRows = (
    rawRows: Array<Record<string, any>>,
    nameCol: string,
    emailCol: string,
    colConfigs: DetectedColumnConfig[],
    secondaryNameCol = selectedSecondaryNameColumn
  ) => {
    const { rowsResult, shouldAutoEnableNewStudents } = computeMultiVerificationRows(
      students,
      rawRows,
      nameCol,
      emailCol,
      colConfigs,
      activeGradesMap,
      activeDispMap,
      secondaryNameCol
    );

    if (shouldAutoEnableNewStudents) {
      setIncludeNewStudentsFromDoc(true);
    }

    setVerifiedRows(rowsResult);
  };

  /**
   * Process any loaded table (from Excel, Google Sheets, or Paste)
   */
  const processLoadedTableData = (
    rows: Array<Record<string, any>>,
    cols: string[],
    sourceTitle: string,
    autoAdvanceToVerify = true,
    overridePreset?: {
      nameCol?: string;
      secondaryNameCol?: string;
      emailCol?: string;
      colConfigs?: DetectedColumnConfig[];
    }
  ) => {
    setRawTableRows(rows);
    setAvailableColumns(cols);
    setFileName(sourceTitle);

    const detectedIdentity = autoDetectIdentityColumns(cols);
    const nameCol =
      overridePreset?.nameCol !== undefined ? overridePreset.nameCol : detectedIdentity.nameCol;
    const secondaryNameCol =
      overridePreset?.secondaryNameCol !== undefined
        ? overridePreset.secondaryNameCol
        : detectedIdentity.secondaryNameCol;
    const emailCol =
      overridePreset?.emailCol !== undefined ? overridePreset.emailCol : detectedIdentity.emailCol;

    setSelectedNameColumn(nameCol);
    setSelectedSecondaryNameColumn(secondaryNameCol);
    setSelectedEmailColumn(emailCol);

    const detected =
      overridePreset?.colConfigs ||
      autoDetectColumnsConfiguration(
        cols,
        nameCol,
        emailCol,
        activeCategories,
        secondaryNameCol,
        importContext
      );

    setDetectedColumns(detected);
    buildMultiVerificationRows(rows, nameCol, emailCol, detected, secondaryNameCol);

    if (autoAdvanceToVerify) {
      setActiveStep('verify');
      setInspectionMode('table');
      setShowVisualSheetMapper(true);
    }
  };

  /**
   * Re-parse the currently loaded raw2DGrid using a specific row index chosen by the teacher
   * in the interactive visual mapper (-1 = no header row, data starts at row 0).
   */
  const handleSelectCustomHeaderRowIndex = (newHeaderRowIdx: number) => {
    if (!raw2DGrid || raw2DGrid.length === 0) return;
    setSelectedHeaderRowIndex(newHeaderRowIdx);
    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(
      raw2DGrid,
      newHeaderRowIdx
    );
    if (headers.length === 0) return;
    processLoadedTableData(rows, headers, fileName, false);
  };

  /**
   * Assign a role directly to a column from the Visual Sheet Mapper header dropdown
   */
  const handleVisualColumnRoleChange = (
    colKey: string,
    role:
      | 'student_name'
      | 'student_second_name'
      | 'student_email'
      | 'disposition'
      | 'disposition_deduction'
      | 'absences'
      | 'lates'
      | 'grade'
      | 'ignore'
  ) => {
    const defaultCat = activeCategories[0] || {
      id: 'cat-default',
      name: 'Evaluaciones',
      weight: 100,
      subcategories: [],
    };

    if (role === 'student_name') {
      const nextNameCol = colKey;
      const nextSecCol = selectedSecondaryNameColumn === colKey ? '' : selectedSecondaryNameColumn;
      const nextEmailCol = selectedEmailColumn === colKey ? '' : selectedEmailColumn;
      setSelectedNameColumn(nextNameCol);
      setSelectedSecondaryNameColumn(nextSecCol);
      setSelectedEmailColumn(nextEmailCol);
      const nextDetected = detectedColumns.filter((c) => c.colKey !== colKey);
      // If previous selectedNameColumn was a real column, add it back as ignored so it remains visible
      if (
        selectedNameColumn &&
        selectedNameColumn !== '__ORDER__' &&
        selectedNameColumn !== colKey &&
        !nextDetected.some((c) => c.colKey === selectedNameColumn)
      ) {
        nextDetected.unshift({
          colKey: selectedNameColumn,
          isIncluded: false,
          kind: 'ignore',
          targetCategoryMode: 'existing',
          targetCategoryId: defaultCat.id,
          newCategoryName: '',
          targetSubcategoryMode: 'new',
          targetSubcategoryId: '',
          subcategoryName: selectedNameColumn,
        });
      }
      setDetectedColumns(nextDetected);
      buildMultiVerificationRows(rawTableRows, nextNameCol, nextEmailCol, nextDetected, nextSecCol);
      return;
    }

    if (role === 'student_second_name') {
      const nextSecCol = colKey;
      const nextNameCol =
        selectedNameColumn === colKey ? availableColumns[0] || '' : selectedNameColumn;
      setSelectedNameColumn(nextNameCol);
      setSelectedSecondaryNameColumn(nextSecCol);
      const nextDetected = detectedColumns.filter((c) => c.colKey !== colKey);
      setDetectedColumns(nextDetected);
      buildMultiVerificationRows(
        rawTableRows,
        nextNameCol,
        selectedEmailColumn,
        nextDetected,
        nextSecCol
      );
      return;
    }

    if (role === 'student_email') {
      const nextEmailCol = colKey;
      const nextSecCol = selectedSecondaryNameColumn === colKey ? '' : selectedSecondaryNameColumn;
      setSelectedEmailColumn(nextEmailCol);
      setSelectedSecondaryNameColumn(nextSecCol);
      const nextDetected = detectedColumns.filter((c) => c.colKey !== colKey);
      setDetectedColumns(nextDetected);
      buildMultiVerificationRows(
        rawTableRows,
        selectedNameColumn,
        nextEmailCol,
        nextDetected,
        nextSecCol
      );
      return;
    }

    // Otherwise it's a data column ('disposition' | 'disposition_deduction' | 'absences' | 'lates' | 'grade' | 'ignore')
    let nextNameCol = selectedNameColumn;
    let nextSecCol = selectedSecondaryNameColumn;
    let nextEmailCol = selectedEmailColumn;
    if (nextNameCol === colKey) {
      nextNameCol = availableColumns.find((c) => c !== colKey) || '';
      setSelectedNameColumn(nextNameCol);
    }
    if (nextSecCol === colKey) {
      nextSecCol = '';
      setSelectedSecondaryNameColumn('');
    }
    if (nextEmailCol === colKey) {
      nextEmailCol = '';
      setSelectedEmailColumn('');
    }

    const existsInDetected = detectedColumns.some((c) => c.colKey === colKey);
    let nextDetected: DetectedColumnConfig[];
    if (existsInDetected) {
      nextDetected = detectedColumns.map((c) =>
        c.colKey === colKey
          ? {
              ...c,
              kind: role,
              isIncluded: role !== 'ignore',
            }
          : c
      );
    } else {
      nextDetected = [
        ...detectedColumns,
        {
          colKey,
          isIncluded: role !== 'ignore',
          kind: role,
          targetCategoryMode: 'existing',
          targetCategoryId: defaultCat.id,
          newCategoryName: '',
          targetSubcategoryMode: 'new',
          targetSubcategoryId: '',
          subcategoryName: colKey,
        },
      ];
    }

    setDetectedColumns(nextDetected);
    buildMultiVerificationRows(rawTableRows, nextNameCol, nextEmailCol, nextDetected, nextSecCol);
  };

  /**
   * Handle Excel (.xlsx, .xls, .csv) upload
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        setRawWorkbook(wb);
        setSheetNames(wb.SheetNames);
        const firstSheet = wb.SheetNames[0];
        setSelectedSheetName(firstSheet);
        await parseExcelSheet(wb, firstSheet, file.name, true);
      } catch (err) {
        console.error('Error al procesar archivo Excel:', err);
      }
    };
    reader.readAsBinaryString(file);
  };

  const parseExcelSheet = async (
    wb: XLSXType.WorkBook,
    sheetName: string,
    sourceFileName?: string,
    autoAdvance = false
  ) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;

    const XLSX = await import('xlsx');
    const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    setRaw2DGrid(raw2D);
    const { headers, rows, headerRowIndex } = sheetsService.convert2DArrayToTableObjects(raw2D);
    setSelectedHeaderRowIndex(headerRowIndex);
    if (rows.length === 0 || headers.length === 0) return;

    processLoadedTableData(
      rows,
      headers,
      sourceFileName ? `${sourceFileName} (${sheetName})` : sheetName,
      autoAdvance
    );
  };

  /**
   * Handle loading a Google Sheet by URL/ID or from Drive list
   */
  const handleLoadRemoteGoogleSheet = async (idOrUrl: string, targetTab?: string) => {
    if (!idOrUrl.trim()) return;
    setIsLoadingRemoteSheet(true);
    setRemoteSheetError(null);
    try {
      const result = await sheetsService.fetchArbitrarySpreadsheetData(idOrUrl, targetTab);
      setActiveRemoteSpreadsheetId(result.spreadsheetId);
      setSheetUrlInput(idOrUrl);
      setSheetNames(result.sheetNames);
      setSelectedSheetName(result.selectedSheet);
      setRawWorkbook(null);
      setRaw2DGrid(result.raw2D || []);
      setSelectedHeaderRowIndex(result.headerRowIndex ?? 0);

      if (result.rows.length === 0 && (!result.raw2D || result.raw2D.length === 0)) {
        setRemoteSheetError(`La pestaña "${result.selectedSheet}" no contiene filas de datos.`);
        return;
      }

      processLoadedTableData(
        result.rows,
        result.headers,
        `Google Sheet: ${result.title} (${result.selectedSheet})`,
        true
      );
    } catch (err: any) {
      setRemoteSheetError(
        err?.message || 'No se pudo leer el documento de Google Sheets. Verifica el enlace o tu conexión con Google.'
      );
    } finally {
      setIsLoadingRemoteSheet(false);
    }
  };

  /**
   * Splits a pasted line into cells:
   * 1. First tries Tab (\t) — standard when copying from Google Sheets or Excel.
   * 2. Next tries semicolon (;) — standard Argentine CSV format.
   * 3. If neither is present, checks if line ends with a number (e.g. "García, Juan 8,5" or "García Juan - 9")
   *    so 2-column paste works even when tab characters were lost!
   */
  const splitPasteLineSmart = (line: string): string[] => {
    if (line.includes('\t')) {
      return line.split('\t').map((c) => c.trim());
    }
    if (line.includes(';')) {
      return line.split(';').map((c) => c.trim());
    }
    // Check if the line has a name (possibly with comma "Apellido, Nombre") followed by a separator/space and a score
    const trailingScoreMatch = line.match(
      /^(.+?)(?:\s+[-|:]\s+|\s{2,}|\s+)(-?\d+(?:[.,]\d+)?(?:\s*(?:pts?|puntos?|mb|b|ex|r))?)$/i
    );
    if (trailingScoreMatch) {
      return [trailingScoreMatch[1].trim(), trailingScoreMatch[2].trim()];
    }
    return [line.trim()];
  };

  /**
   * Live preview stats for the paste box (Alternativa 3)
   */
  const pastePreviewStats = useMemo(() => {
    if (!pasteText.trim()) return { rowCount: 0, colCount: 0 };
    const lines = pasteText
      .split('\n')
      .map((l) => l.replace(/\r/g, ''))
      .filter((l) => l.trim() !== '');
    if (lines.length === 0) return { rowCount: 0, colCount: 0 };
    const sampleCols = Math.max(...lines.slice(0, 10).map((l) => splitPasteLineSmart(l).length));
    return { rowCount: lines.length, colCount: sampleCols };
  }, [pasteText]);

  /**
   * Handle pasted cells from Excel or Sheets (with support for Alternativa 3 Quick Presets)
   */
  const handleParsePaste = () => {
    if (!pasteText.trim()) return;
    const lines = pasteText
      .split('\n')
      .map((l) => l.replace(/\r/g, ''))
      .filter((l) => l.trim() !== '');
    if (lines.length === 0) return;

    const raw2D = lines.map((line) => splitPasteLineSmart(line));
    const defaultCat = activeCategories[0] || {
      id: 'cat-default',
      name: 'Evaluaciones',
      weight: 100,
      subcategories: [],
    };

    const firstRowJoined = raw2D[0].join(' ').toLowerCase();
    const firstRowHasNumbers = raw2D[0].some((cell, idx) => {
      if (idx === 0 && raw2D[0].length > 1) return false;
      return /^-?\d+(?:[.,]\d+)?$/.test(cell.trim());
    });
    const hasHeader =
      !firstRowHasNumbers &&
      /alumno|nombre|apellido|estudiante|nota|tp|eval|examen|falta|ausencia|tardanza|disposicion|conducta|concepto/i.test(
        firstRowJoined
      );

    // Preset 1: 1 Single Column of Disposition numbers in alphabetical roster order
    if (quickPastePreset === 'only_disp_ordered') {
      const dataRows2D = hasHeader ? raw2D.slice(1) : raw2D;
      const colHeader = 'Disposición';
      const final2D = [[colHeader], ...dataRows2D.map((r) => [r[r.length - 1] ?? r[0] ?? ''])];
      setRaw2DGrid(final2D);
      setSelectedHeaderRowIndex(0);
      const rows = dataRows2D.map((r) => ({
        [colHeader]: r[r.length - 1] ?? r[0] ?? '',
      }));
      const colCfg: DetectedColumnConfig = {
        colKey: colHeader,
        isIncluded: true,
        kind: 'disposition',
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: colHeader,
      };
      processLoadedTableData(rows, [colHeader], 'Pegado Rápido (Disposición por Orden de Lista)', true, {
        nameCol: '__ORDER__',
        secondaryNameCol: '',
        emailCol: '',
        colConfigs: [colCfg],
      });
      return;
    }

    // Preset 2: 2 Columns -> [Alumno] + [Disposición]
    if (quickPastePreset === 'name_and_disp') {
      const dataRows2D = hasHeader ? raw2D.slice(1) : raw2D;
      const headers = ['Apellido y Nombre', 'Disposición'];
      const normalized2D = [
        headers,
        ...dataRows2D.map((r) => [r[0] || '', r[1] ?? '']),
      ];
      setRaw2DGrid(normalized2D);
      setSelectedHeaderRowIndex(0);
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2D, 0);
      processLoadedTableData(rows, headers, 'Pegado Rápido (Alumno + Disposición)', true, {
        nameCol: 'Apellido y Nombre',
        secondaryNameCol: '',
        emailCol: '',
        colConfigs: [
          {
            colKey: 'Disposición',
            isIncluded: true,
            kind: 'disposition',
            targetCategoryMode: 'existing',
            targetCategoryId: defaultCat.id,
            newCategoryName: '',
            targetSubcategoryMode: 'new',
            targetSubcategoryId: '',
            subcategoryName: 'Disposición',
          },
        ],
      });
      return;
    }

    // Preset 3: 3 Columns -> [Apellido] + [Nombre] + [Disposición]
    if (quickPastePreset === 'last_first_disp') {
      const dataRows2D = hasHeader ? raw2D.slice(1) : raw2D;
      const headers = ['Apellido', 'Nombre', 'Disposición'];
      const normalized2D = [
        headers,
        ...dataRows2D.map((r) => [r[0] || '', r[1] || '', r[2] ?? '']),
      ];
      setRaw2DGrid(normalized2D);
      setSelectedHeaderRowIndex(0);
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2D, 0);
      processLoadedTableData(rows, headers, 'Pegado Rápido (Apellido + Nombre + Disposición)', true, {
        nameCol: 'Apellido',
        secondaryNameCol: 'Nombre',
        emailCol: '',
        colConfigs: [
          {
            colKey: 'Disposición',
            isIncluded: true,
            kind: 'disposition',
            targetCategoryMode: 'existing',
            targetCategoryId: defaultCat.id,
            newCategoryName: '',
            targetSubcategoryMode: 'new',
            targetSubcategoryId: '',
            subcategoryName: 'Disposición',
          },
        ],
      });
      return;
    }

    // Preset 4: 3 Columns -> [Alumno] + [Ausencias] + [Disposición]
    if (quickPastePreset === 'name_abs_disp') {
      const dataRows2D = hasHeader ? raw2D.slice(1) : raw2D;
      const headers = ['Apellido y Nombre', 'Ausencias', 'Disposición'];
      const normalized2D = [
        headers,
        ...dataRows2D.map((r) => [r[0] || '', r[1] ?? '', r[2] ?? '']),
      ];
      setRaw2DGrid(normalized2D);
      setSelectedHeaderRowIndex(0);
      const { rows } = sheetsService.convert2DArrayToTableObjects(normalized2D, 0);
      processLoadedTableData(rows, headers, 'Pegado Rápido (Alumno + Ausencias + Disposición)', true, {
        nameCol: 'Apellido y Nombre',
        secondaryNameCol: '',
        emailCol: '',
        colConfigs: [
          {
            colKey: 'Ausencias',
            isIncluded: true,
            kind: 'absences',
            targetCategoryMode: 'existing',
            targetCategoryId: defaultCat.id,
            newCategoryName: '',
            targetSubcategoryMode: 'new',
            targetSubcategoryId: '',
            subcategoryName: 'Ausencias',
          },
          {
            colKey: 'Disposición',
            isIncluded: true,
            kind: 'disposition',
            targetCategoryMode: 'existing',
            targetCategoryId: defaultCat.id,
            newCategoryName: '',
            targetSubcategoryMode: 'new',
            targetSubcategoryId: '',
            subcategoryName: 'Disposición',
          },
        ],
      });
      return;
    }

    // Automatic mode
    const defaultColLabel = importContext === 'attendance' ? 'Disposición' : 'Nota';
    const final2D = hasHeader
      ? raw2D
      : [
          [
            'Apellido y Nombre',
            ...raw2D[0].slice(1).map((_, idx) =>
              idx === 0 && importContext === 'attendance' ? 'Disposición' : `${defaultColLabel} ${idx + 1}`
            ),
          ],
          ...raw2D,
        ];

    setRaw2DGrid(final2D);
    setSelectedHeaderRowIndex(0);
    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(final2D, 0);
    if (rows.length === 0) return;

    processLoadedTableData(rows, headers, 'Datos Pegados desde Planilla', true);
  };

  // Update a column's configuration in Step 2 and recompute cell statuses if needed
  const handleUpdateColumnConfig = (
    colKey: string,
    patch: Partial<DetectedColumnConfig>
  ) => {
    const nextCols = detectedColumns.map((c) => (c.colKey === colKey ? { ...c, ...patch } : c));
    setDetectedColumns(nextCols);
    buildMultiVerificationRows(
      rawTableRows,
      selectedNameColumn,
      selectedEmailColumn,
      nextCols,
      selectedSecondaryNameColumn
    );
  };

  // Edit an individual cell in Step 2
  const handleCellEdit = (rowId: string, colKey: string, newVal: string) => {
    const colCfg = detectedColumns.find((c) => c.colKey === colKey);
    if (!colCfg) return;

    setVerifiedRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const prevCell = row.valuesByCol[colKey];
        if (!prevCell) return row;

        const cleanStr = newVal.replace(',', '.').trim();
        let isValid = true;
        let finalStr = cleanStr;
        if (cleanStr !== '') {
          const parsed = parseFlexibleCellNumber(cleanStr, colCfg.kind);
          isValid = parsed.isValid;
          if (isValid) {
            finalStr = String(Number(parsed.numVal.toFixed(2)));
          }
        }

        let status: 'new' | 'update' | 'same' | 'empty' | 'invalid' = 'new';
        if (cleanStr === '') status = 'empty';
        else if (!isValid) status = 'invalid';
        else if (!prevCell.currentVal) status = 'new';
        else if (prevCell.currentVal === finalStr) status = 'same';
        else status = 'update';

        const nextValuesByCol = {
          ...row.valuesByCol,
          [colKey]: {
            ...prevCell,
            editedVal: cleanStr,
            isValid,
            status,
          },
        };

        return {
          ...row,
          isIncluded: cleanStr !== '' && isValid ? true : row.isIncluded,
          valuesByCol: nextValuesByCol,
        };
      })
    );
  };

  // Reassign an unmatched or matched row to another student in the course
  const handleReassignRowStudent = (rowId: string, targetStudentId: string) => {
    const targetSt = students.find((s) => s.id === targetStudentId);
    if (!targetSt) return;

    setVerifiedRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        return {
          ...r,
          studentId: targetSt.id,
          isNewStudent: false,
          studentName: `${targetSt.lastName}, ${targetSt.firstName}`,
          firstName: targetSt.firstName,
          lastName: targetSt.lastName,
          studentEmail: targetSt.email || r.studentEmail,
          matchScore: 1.0,
          isIncluded: true,
        };
      })
    );
  };

  const includedColumns = useMemo(
    () => detectedColumns.filter((c) => c.isIncluded && c.kind !== 'ignore'),
    [detectedColumns]
  );

  const displayedRows = useMemo(() => {
    return verifiedRows.filter((r) => {
      if (r.isNewStudent && !includeNewStudentsFromDoc) return false;
      if (filterMode === 'changes' && !r.isIncluded) return false;
      if (filterMode === 'missing' && r.matchedFromRaw !== '') return false;

      if (searchFilter.trim()) {
        const q = normalizeText(searchFilter);
        const m1 = normalizeText(r.studentName).includes(q);
        const m2 = normalizeText(r.matchedFromRaw).includes(q);
        const m3 = normalizeText(r.studentEmail).includes(q);
        if (!m1 && !m2 && !m3) return false;
      }
      return true;
    });
  }, [verifiedRows, includeNewStudentsFromDoc, filterMode, searchFilter]);

  const summaryMetrics = useMemo(() => {
    const activeRows = verifiedRows.filter((r) => !r.isNewStudent || includeNewStudentsFromDoc);
    const includedRowsCount = activeRows.filter((r) => r.isIncluded).length;
    const gradeColsCount = includedColumns.filter((c) => c.kind === 'grade').length;
    const attColsCount = includedColumns.filter(
      (c) =>
        c.kind === 'absences' ||
        c.kind === 'lates' ||
        c.kind === 'disposition' ||
        c.kind === 'disposition_deduction'
    ).length;
    const newStudentsCount = verifiedRows.filter((r) => r.isNewStudent).length;

    let totalCellsToApply = 0;
    activeRows.forEach((r) => {
      if (!r.isIncluded) return;
      includedColumns.forEach((col) => {
        const cell = r.valuesByCol[col.colKey];
        if (cell && cell.isValid && cell.editedVal !== '' && cell.status !== 'same') {
          totalCellsToApply++;
        }
      });
    });

    return {
      totalRows: activeRows.length,
      includedRowsCount,
      gradeColsCount,
      attColsCount,
      newStudentsCount,
      totalCellsToApply,
    };
  }, [verifiedRows, includeNewStudentsFromDoc, includedColumns]);

  /**
   * Confirm & Apply all verified Categories, Evaluations, Grades, Attendance/Disposition, and New Students!
   */
  const handleConfirmAllVerifiedData = () => {
    const activeRows = verifiedRows.filter(
      (r) => r.isIncluded && (!r.isNewStudent || includeNewStudentsFromDoc)
    );
    if (activeRows.length === 0 || includedColumns.length === 0) return;

    // 1. Build updated Categories and Subcategories
    const workingCategories: GradeCategory[] = activeCategories.map((c) => ({
      ...c,
      subcategories: [...c.subcategories],
    }));

    const colKeyToSubcategoryId: Record<string, { categoryId: string; categoryName: string; subcategoryId: string; subcategoryName: string }> = {};

    includedColumns.forEach((colCfg, idx) => {
      if (colCfg.kind !== 'grade') return;

      let targetCat: GradeCategory | undefined;
      if (colCfg.targetCategoryMode === 'new' && colCfg.newCategoryName.trim()) {
        const cleanCatName = colCfg.newCategoryName.trim();
        targetCat = workingCategories.find(
          (c) => normalizeText(c.name) === normalizeText(cleanCatName)
        );
        if (!targetCat) {
          targetCat = {
            id: `cat-imp-${Date.now()}-${idx}`,
            name: cleanCatName,
            weight: 0,
            subcategories: [],
          };
          workingCategories.push(targetCat);
        }
      } else {
        targetCat =
          workingCategories.find((c) => c.id === colCfg.targetCategoryId) ||
          workingCategories[0];
        if (!targetCat) {
          targetCat = {
            id: `cat-imp-${Date.now()}-${idx}`,
            name: 'Calificaciones',
            weight: 100,
            subcategories: [],
          };
          workingCategories.push(targetCat);
        }
      }

      let subId = colCfg.targetSubcategoryId;
      const cleanSubName = colCfg.subcategoryName.trim() || colCfg.colKey;

      if (colCfg.targetSubcategoryMode === 'existing' && subId) {
        const exists = targetCat.subcategories.find((s) => s.id === subId);
        if (!exists) {
          subId = `sub-imp-${Date.now()}-${idx}`;
          targetCat.subcategories.push({
            id: subId,
            name: cleanSubName,
            maxScore: 10,
          });
        }
      } else {
        // Check if a subcategory with the same name already exists in targetCat
        const sameNameSub = targetCat.subcategories.find(
          (s) => normalizeText(s.name) === normalizeText(cleanSubName)
        );
        if (sameNameSub) {
          subId = sameNameSub.id;
        } else {
          subId = `sub-imp-${Date.now()}-${idx}`;
          targetCat.subcategories.push({
            id: subId,
            name: cleanSubName,
            maxScore: 10,
          });
        }
      }

      colKeyToSubcategoryId[colCfg.colKey] = {
        categoryId: targetCat.id,
        categoryName: targetCat.name,
        subcategoryId: subId,
        subcategoryName: cleanSubName,
      };
    });

    // 2. Build updated Grades Map & Attendance Updates & New Students
    const workingGradesMap: StudentGradesMap = {};
    Object.keys(activeGradesMap).forEach((stId) => {
      workingGradesMap[stId] = { ...(activeGradesMap[stId] || {}) };
    });

    const attendanceUpdates: MultiImportApplyPayload['attendanceUpdates'] = {};
    const newStudentsToCreate: MultiImportApplyPayload['newStudentsToCreate'] = [];

    activeRows.forEach((row) => {
      if (row.isNewStudent && includeNewStudentsFromDoc) {
        newStudentsToCreate.push({
          id: row.studentId,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.studentEmail,
        });
      }

      if (!workingGradesMap[row.studentId]) {
        workingGradesMap[row.studentId] = {};
      }

      includedColumns.forEach((colCfg) => {
        const cell = row.valuesByCol[colCfg.colKey];
        if (!cell || !cell.isValid || cell.editedVal === '') return;

        const parsedCell = parseFlexibleCellNumber(cell.editedVal, colCfg.kind);
        const numericVal = parsedCell.isValid ? parsedCell.numVal : Number(cell.editedVal);

        if (colCfg.kind === 'grade') {
          const targetInfo = colKeyToSubcategoryId[colCfg.colKey];
          if (targetInfo) {
            workingGradesMap[row.studentId][targetInfo.subcategoryId] = !isNaN(numericVal)
              ? String(Number(numericVal.toFixed(2)))
              : cell.editedVal;
          }
        } else if (colCfg.kind === 'absences') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].absences = Math.max(0, Math.round(numericVal));
        } else if (colCfg.kind === 'lates') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].lates = Math.max(0, Math.round(numericVal));
        } else if (colCfg.kind === 'disposition' || colCfg.kind === 'disposition_deduction') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].disposition = Math.min(
            10,
            Math.max(1, Number(numericVal.toFixed(2)))
          );
        }
      });
    });

    // 3. Build GradeHistoryEntries for each imported grade column
    const newHistoryEntries: GradeHistoryEntry[] = [];
    Object.entries(colKeyToSubcategoryId).forEach(([colKey, info], idx) => {
      const colRows = activeRows.filter((r) => {
        const cell = r.valuesByCol[colKey];
        return cell && cell.isValid && cell.editedVal !== '';
      });
      if (colRows.length === 0) return;

      const scores = colRows
        .map((r) => parseFloat(r.valuesByCol[colKey].editedVal))
        .filter((n) => !isNaN(n));
      const avg =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;

      newHistoryEntries.push({
        id: `gh-${Date.now()}-${idx}`,
        courseId,
        timestamp: Date.now(),
        date: new Date().toLocaleDateString('es-AR'),
        time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        term: selectedTerm,
        termLabel: selectedTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
        subcategoryId: info.subcategoryId,
        evaluationName: info.subcategoryName,
        categoryName: info.categoryName,
        action: sourceType === 'file' ? 'import_excel' : 'import_sheets',
        description: `Se importaron ${colRows.length} calificaciones en "${info.categoryName} - ${info.subcategoryName}"`,
        updatedStudentsCount: colRows.length,
        averageScore: avg,
        sourceFile: fileName || undefined,
        changesSummary: colRows.map((r) => ({
          studentId: r.studentId,
          studentName: r.studentName,
          studentEmail: r.studentEmail,
          previousScore: r.valuesByCol[colKey].currentVal || undefined,
          newScore: r.valuesByCol[colKey].editedVal,
          status:
            r.valuesByCol[colKey].status === 'new'
              ? 'new'
              : r.valuesByCol[colKey].status === 'update'
              ? 'updated'
              : 'unchanged',
        })),
      });
    });

    if (onApplyMultiImport) {
      onApplyMultiImport({
        term: selectedTerm,
        updatedCategories: workingCategories,
        updatedGradesMap: workingGradesMap,
        historyEntries: newHistoryEntries,
        attendanceUpdates,
        newStudentsToCreate,
        sourceLabel: fileName || (sourceType === 'file' ? 'Excel' : 'Google Sheets'),
      });
      onClose();
      return;
    }

    // Fallback to legacy single-column callback if onApplyMultiImport is not provided
    const firstColEntry = Object.entries(colKeyToSubcategoryId)[0];
    if (firstColEntry) {
      const [colKey, info] = firstColEntry;
      const updates: Record<string, string> = {};
      activeRows.forEach((r) => {
        const cell = r.valuesByCol[colKey];
        if (cell && cell.isValid && cell.editedVal !== '') {
          updates[r.studentId] = cell.editedVal;
        }
      });
      if (newHistoryEntries[0]) {
        onApplyGrades({
          term: selectedTerm,
          categoryId: info.categoryId,
          subcategoryId: info.subcategoryId,
          newSubcategoryName: info.subcategoryName,
          updates,
          historyEntry: newHistoryEntries[0],
        });
      }
    }
    onClose();
  };

  const currentInspectedRow = displayedRows[selectedStudentIndex] || displayedRows[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-6xl max-h-[94vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all ${
          isDarkMode
            ? 'bg-slate-900 border-slate-750 text-slate-100'
            : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base leading-tight">
                  {sourceType === 'sheets'
                    ? 'Importar Documento desde Google Sheets'
                    : sourceType === 'paste'
                    ? 'Pegado Rápido desde Planilla (Ctrl+V)'
                    : 'Importar Documento desde Excel (.xlsx, .xls, .csv)'}
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {courseName}
                </span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {importContext === 'attendance' ? 'Asistencia, Disposición y Notas' : 'Detección de Categorías y Notas'}
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                {activeStep === 'upload' &&
                  'Paso 1: Subí tu planilla, conectá tu Google Sheet o pegá 2 columnas para mapear tus datos sin errores'}
                {activeStep === 'verify' &&
                  'Paso 2: Mapeador Visual e Interfaz de Comprobación — Elegí qué es cada columna sobre tu planilla y verificá antes de guardar'}
                {activeStep === 'history' && 'Historial de importaciones realizadas'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Selector de Cuatrimestre Destino */}
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-[11px] font-bold text-neutral-500 dark:text-slate-400 hidden sm:inline">
                Período:
              </span>
              <select
                value={selectedTerm}
                onChange={(e) => setSelectedTerm(e.target.value as '1c' | '2c')}
                className={`px-2.5 py-1.5 text-xs rounded-xl border font-bold outline-hidden cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-blue-300'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}
              >
                <option value="1c">1° Cuatrimestre</option>
                <option value="2c">2° Cuatrimestre</option>
              </select>
            </div>

            {historyEntries.length > 0 && activeStep !== 'history' && (
              <button
                type="button"
                onClick={() => setActiveStep('history')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300'
                }`}
              >
                <History className="w-3.5 h-3.5 text-blue-500" />
                <span className="hidden sm:inline">Historial ({historyEntries.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PASO 1: SELECCIONAR ARCHIVO EXCEL O DOCUMENTO DE GOOGLE SHEETS            */}
        {/* ========================================================================= */}
        {activeStep === 'upload' && (
          <div className="p-6 overflow-y-auto space-y-5">
            {/* Pestañas de origen: Importar desde Excel vs Importar desde Google Sheets vs Pegar + Descargar Plantilla */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 border-neutral-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSourceType('file')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sourceType === 'file'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 hover:text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Importar desde Excel (.xlsx, .xls, .csv)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSourceType('sheets')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sourceType === 'sheets'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 hover:text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Importar desde Google Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSourceType('paste')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sourceType === 'paste'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 hover:text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span>Pegado Rápido de Columnas (Ctrl+V)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const XLSX = await import('xlsx');
                    const sorted = [...students].sort((a, b) =>
                      `${a.lastName}, ${a.firstName}`.localeCompare(`${b.lastName}, ${b.firstName}`, 'es')
                    );

                    const gradeCols: string[] = [];
                    activeCategories.forEach((cat) => {
                      if (cat.subcategories.length > 0) {
                        cat.subcategories.forEach((sub) => {
                          gradeCols.push(`${cat.name} - ${sub.name}`);
                        });
                      } else {
                        gradeCols.push(`${cat.name} - Evaluación 1`);
                      }
                    });
                    if (gradeCols.length === 0) {
                      gradeCols.push('Exámenes - Parcial 1', 'Trabajos Prácticos - TP 1');
                    }

                    const activeDispositionMap =
                      selectedTerm === '2c' ? currentDispositionMap2c : currentDispositionMap1c;

                    const templateRows = (sorted.length > 0
                      ? sorted
                      : [
                          { id: '1', lastName: 'García', firstName: 'Ana', email: 'ana.garcia@escuela.edu.ar' } as Student,
                          { id: '2', lastName: 'López', firstName: 'Juan', email: 'juan.lopez@escuela.edu.ar' } as Student,
                        ]
                    ).map((st) => {
                      const row: Record<string, any> = {
                        'Apellido y Nombre': `${st.lastName}, ${st.firstName}`,
                        'Correo Institucional': st.email || '',
                      };
                      if (importContext === 'attendance') {
                        const d = activeDispositionMap?.[st.id];
                        row['Faltas'] = d?.totalAbsences ?? 0;
                        row['Tardanzas'] = d?.totalLates ?? 0;
                        row['Disposición'] = d?.totalDisposition ?? 10;
                      }
                      gradeCols.forEach((colLabel) => {
                        row[colLabel] = '';
                      });
                      return row;
                    });

                    const ws = XLSX.utils.json_to_sheet(templateRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(
                      wb,
                      ws,
                      importContext === 'attendance' ? 'Asistencia y Notas' : 'Calificaciones'
                    );
                    const safeCourse = courseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                    XLSX.writeFile(
                      wb,
                      `Plantilla_Modelo_${importContext === 'attendance' ? 'Asistencia' : 'Calificaciones'}_${safeCourse}_${selectedTerm.toUpperCase()}.xlsx`
                    );
                  } catch (err) {
                    console.error('Error generating template:', err);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 shadow-2xs'
                }`}
                title="Descargar una planilla Excel pre-cargada con la lista de alumnos y columnas listas para completar y volver a subir"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar plantilla modelo (.xlsx)</span>
              </button>
            </div>

            {/* MODO 1: SUBIR ARCHIVO EXCEL */}
            {sourceType === 'file' && (
              <div className="space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    isDarkMode
                      ? 'border-slate-700 hover:border-emerald-500 bg-slate-850/40 hover:bg-slate-800/60'
                      : 'border-neutral-300 hover:border-emerald-500 bg-neutral-50/50 hover:bg-emerald-50/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-bold">
                    {fileName
                      ? `Documento cargado: ${fileName}`
                      : 'Hacé clic aquí para seleccionar tu archivo Excel (.xlsx, .xls o .csv)'}
                  </p>
                  <p className={`text-xs mt-1.5 max-w-xl mx-auto ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Subí cualquier planilla tuya: en el siguiente paso verás tu hoja en pantalla y podrás elegir con un clic en qué fila están los títulos y qué columna corresponde a Alumno, Disposición, Faltas o Notas.
                  </p>
                </div>
              </div>
            )}

            {/* MODO 2: IMPORTAR DESDE GOOGLE SHEETS */}
            {sourceType === 'sheets' && (
              <div className="space-y-5">
                {/* Opción A: Pegar enlace o ID de Google Sheets */}
                <div
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-blue-50/40 border-blue-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-blue-500" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Opción 1: Cargar mediante enlace o ID de Google Sheets
                    </h4>
                  </div>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                    Pegá el enlace de cualquier Google Sheet que tengas armado. En el paso siguiente podrás **ver las filas reales de tu hoja** y señalar con un clic cuál es la columna de Disposición, Ausencias o Alumno:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={sheetUrlInput}
                      onChange={(e) => setSheetUrlInput(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                      className={`flex-1 px-3.5 py-2 text-xs rounded-xl border outline-hidden ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handleLoadRemoteGoogleSheet(sheetUrlInput)}
                      disabled={isLoadingRemoteSheet || !sheetUrlInput.trim()}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer shrink-0"
                    >
                      {isLoadingRemoteSheet ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                      <span>{isLoadingRemoteSheet ? 'Leyendo Hoja...' : 'Abrir en Mapeador Visual'}</span>
                    </button>
                  </div>

                  {remoteSheetError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{remoteSheetError}</span>
                    </div>
                  )}
                </div>

                {/* Opción B: Elegir un Google Sheet directamente de Google Drive */}
                <div
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDarkMode ? 'bg-slate-850/40 border-slate-750' : 'bg-white border-neutral-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-emerald-500" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Opción 2: Seleccionar una hoja existente de tu Google Drive
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="text"
                          value={driveSearchQuery}
                          onChange={(e) => setDriveSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleLoadDriveSpreadsheets(driveSearchQuery);
                          }}
                          placeholder="Buscar por nombre en Drive..."
                          className={`pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadDriveSpreadsheets(driveSearchQuery)}
                        disabled={isLoadingDriveSheets}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                          isDarkMode
                            ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                            : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-neutral-700'
                        }`}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDriveSheets ? 'animate-spin' : ''}`} />
                        <span>Buscar</span>
                      </button>
                    </div>
                  </div>

                  {isLoadingDriveSheets ? (
                    <div className="py-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                      <span>Buscando hojas de cálculo en tu Google Drive...</span>
                    </div>
                  ) : driveSpreadsheets.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-500 dark:text-slate-400">
                      No se encontraron hojas recientes o no has iniciado sesión en Google Drive. Podés pegar el enlace arriba o pulsar "Buscar" para conectar.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                      {driveSpreadsheets.map((sheet) => (
                        <button
                          key={sheet.id}
                          type="button"
                          onClick={() => handleLoadRemoteGoogleSheet(sheet.id)}
                          disabled={isLoadingRemoteSheet}
                          className={`p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                            isDarkMode
                              ? 'bg-slate-800/70 hover:bg-slate-800 border-slate-700 hover:border-emerald-500/60'
                              : 'bg-neutral-50/70 hover:bg-emerald-50/50 border-neutral-200 hover:border-emerald-400'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{sheet.name}</div>
                              {sheet.modifiedTime && (
                                <div className="text-[10px] text-neutral-400">
                                  Modificado: {new Date(sheet.modifiedTime).toLocaleDateString('es-AR')}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold shrink-0">
                            Mapear Hoja
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* MODO 3: PEGADO RÁPIDO DE 2 COLUMNAS / CELDAS COPIADAS (ALTERNATIVA 3) */}
            {sourceType === 'paste' && (
              <div className="space-y-4">
                <div
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDarkMode ? 'bg-indigo-950/25 border-indigo-800/60' : 'bg-indigo-50/60 border-indigo-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ClipboardPaste className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                        Elegí qué formato estás pegando desde tu Google Sheet o Excel:
                      </span>
                    </div>
                    {pastePreviewStats.rowCount > 0 && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                        ✓ Detectadas {pastePreviewStats.rowCount} fila(s) · {pastePreviewStats.colCount} columna(s)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickPastePreset('name_and_disp')}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'name_and_disp'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">⭐ 2 Columnas: Alumno + Disposición</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'name_and_disp' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Ej: García, Juan [Tab] 8,5 (con o sin títulos)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQuickPastePreset('last_first_disp')}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'last_first_disp'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">👤+👤+⭐ 3 Cols: Apellido + Nombre + Disp.</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'last_first_disp' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Une automáticamente Apellido (Col A) y Nombre (Col B)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQuickPastePreset('name_abs_disp')}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'name_abs_disp'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">📅+⭐ 3 Cols: Alumno + Faltas + Disp.</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'name_abs_disp' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Carga el total de inasistencias y la disposición juntos
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQuickPastePreset('only_disp_ordered')}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'only_disp_ordered'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">🔢 1 Sola Columna (En orden de lista)</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'only_disp_ordered' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Pegá solo la columna de números de Disposición en orden alfabético
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQuickPastePreset('auto')}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'auto'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">✨ Tabla Libre / Varias Columnas</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'auto' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Pegá cualquier bloque de celdas y mapealo en el paso siguiente
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                    Seleccioná las celdas en tu Google Sheet o Excel, copialas (Ctrl+C) y pegalas aquí (Ctrl+V). Acepta decimales con coma (8,5), puntos o escala conceptual (MB, B, R):
                  </label>
                  <textarea
                    rows={8}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={
                      quickPastePreset === 'name_and_disp'
                        ? `Ejemplo (con o sin fila de títulos):\nGarcía, Ana\t9,5\nLópez, Juan\t8\nMartínez, Sofía\t10`
                        : quickPastePreset === 'last_first_disp'
                        ? `Ejemplo con Apellido y Nombre separados:\nGarcía\tAna\t9,5\nLópez\tJuan\t8`
                        : quickPastePreset === 'only_disp_ordered'
                        ? `Pegá directamente la columna de notas en el orden alfabético del curso:\n9,5\n8\n10\n7,5`
                        : `Ejemplo:\nApellido y Nombre\tAusencias\tDisposición\nGarcía, Ana\t1\t9,5\nLópez, Juan\t3\t8`
                    }
                    className={`w-full p-3 font-mono text-xs rounded-xl border outline-hidden ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-750 text-slate-200'
                        : 'bg-white border-neutral-300 text-neutral-800'
                    }`}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleParsePaste}
                    disabled={!pasteText.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <span>Procesar y Verificar Datos</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 2: INTERFAZ DE COMPROBACIÓN PREVIA (CATEGORÍAS, NOTAS Y ASISTENCIA)  */}
        {/* ========================================================================= */}
        {activeStep === 'verify' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {/* Barra de documento cargado y selector de Pestaña (si el Excel o Google Sheet tiene varias hojas) */}
              <div
                className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-emerald-50/60 border-emerald-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">{fileName}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-slate-400">
                      Si tu planilla tiene otro formato o encabezados combinados, usá el Mapeador Visual de abajo para señalar qué es cada columna.
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Selector de Pestaña / Hoja si hay múltiples */}
                  {sheetNames.length > 1 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold">Pestaña del documento:</span>
                      <select
                        value={selectedSheetName}
                        onChange={(e) => {
                          const nextTab = e.target.value;
                          setSelectedSheetName(nextTab);
                          if (rawWorkbook) {
                            parseExcelSheet(rawWorkbook, nextTab, fileName.split(' (')[0], false);
                          } else if (activeRemoteSpreadsheetId) {
                            handleLoadRemoteGoogleSheet(activeRemoteSpreadsheetId, nextTab);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg border font-bold outline-hidden ${
                          isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                        }`}
                      >
                        {sheetNames.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Selector de Columna Principal de Alumno */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-semibold">Columna Alumno:</span>
                    <select
                      value={selectedNameColumn}
                      onChange={(e) => {
                        const nextNameCol = e.target.value;
                        setSelectedNameColumn(nextNameCol);
                        const nextDetected = autoDetectColumnsConfiguration(
                          availableColumns,
                          nextNameCol,
                          selectedEmailColumn,
                          activeCategories,
                          selectedSecondaryNameColumn,
                          importContext
                        );
                        setDetectedColumns(nextDetected);
                        buildMultiVerificationRows(
                          rawTableRows,
                          nextNameCol,
                          selectedEmailColumn,
                          nextDetected,
                          selectedSecondaryNameColumn
                        );
                      }}
                      className={`px-2.5 py-1 rounded-lg border font-bold outline-hidden ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                      }`}
                    >
                      <option value="__ORDER__">🔢 Sin columna de nombre (Seguir orden de lista)</option>
                      {availableColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Selector Opcional de 2° Columna de Nombre (si Apellido y Nombre vienen separados) */}
                  {selectedNameColumn !== '__ORDER__' && availableColumns.length >= 2 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-neutral-500 dark:text-slate-400">
                        + 2° Columna Nombre:
                      </span>
                      <select
                        value={selectedSecondaryNameColumn}
                        onChange={(e) => {
                          const nextSec = e.target.value;
                          setSelectedSecondaryNameColumn(nextSec);
                          const nextDetected = autoDetectColumnsConfiguration(
                            availableColumns,
                            selectedNameColumn,
                            selectedEmailColumn,
                            activeCategories,
                            nextSec,
                            importContext
                          );
                          setDetectedColumns(nextDetected);
                          buildMultiVerificationRows(
                            rawTableRows,
                            selectedNameColumn,
                            selectedEmailColumn,
                            nextDetected,
                            nextSec
                          );
                        }}
                        className={`px-2 py-1 rounded-lg border font-semibold outline-hidden ${
                          isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                        }`}
                        title="Si tu planilla tiene el Apellido en una columna y el Nombre en otra, elegila aquí para unirlas"
                      >
                        <option value="">(En una sola columna)</option>
                        {availableColumns
                          .filter((c) => c !== selectedNameColumn)
                          .map((col) => (
                            <option key={col} value={col}>
                              Unir con: {col}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {raw2DGrid.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowVisualSheetMapper((v) => !v)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                        showVisualSheetMapper
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-indigo-300'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>
                        {showVisualSheetMapper
                          ? 'Ocultar Mapeador Visual'
                          : 'Abrir Mapeador Visual de tu Planilla'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* ALTERNATIVA 1: MAPEADOR VISUAL INTERACTIVO SOBRE TU PLANILLA REAL        */}
              {/* ========================================================================= */}
              {showVisualSheetMapper && raw2DGrid.length > 0 && (
                <div
                  className={`p-4 rounded-xl border space-y-3 ${
                    isDarkMode
                      ? 'bg-indigo-950/20 border-indigo-800/60'
                      : 'bg-indigo-50/40 border-indigo-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300 flex items-center gap-1.5">
                        <FileSpreadsheet className="w-4 h-4" />
                        <span>
                          Mapeador Visual Interactivo — Elegí sobre tu planilla qué es cada fila y columna
                        </span>
                      </h4>
                      <p className="text-[11px] text-neutral-600 dark:text-slate-400 mt-0.5">
                        <strong>Paso A:</strong> Si tu planilla tiene encabezados arriba, hacé clic en la fila donde están los títulos (o elegí "Sin fila de títulos").{' '}
                        <strong>Paso B:</strong> Usá el desplegable arriba de cada columna (Col A, Col B, Col C...) para indicar cuál es Alumno y cuál es Disposición.
                      </p>
                    </div>
                  </div>

                  {/* Paso A: Selector rápido de fila de encabezados */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-bold text-neutral-700 dark:text-slate-300 mr-1">
                      Fila de títulos:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectCustomHeaderRowIndex(-1)}
                      className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                        selectedHeaderRowIndex === -1
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                          : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      Sin títulos (Leer desde Fila 1)
                    </button>
                    {raw2DGrid.slice(0, 10).map((r, rIdx) => {
                      const sampleText = (r || [])
                        .map((c) => String(c ?? '').trim())
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(' · ');
                      return (
                        <button
                          key={rIdx}
                          type="button"
                          onClick={() => handleSelectCustomHeaderRowIndex(rIdx)}
                          className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all max-w-[190px] truncate ${
                            selectedHeaderRowIndex === rIdx
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                              : isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                              : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                          }`}
                          title={sampleText ? `Fila ${rIdx + 1}: ${sampleText}` : `Usar Fila ${rIdx + 1} como títulos`}
                        >
                          Fila {rIdx + 1}
                          {sampleText ? `: ${sampleText}` : ''}
                        </button>
                      );
                    })}
                  </div>

                  {/* Paso B: Tabla de vista previa real con desplegable por columna */}
                  <div
                    className={`border rounded-xl overflow-x-auto max-h-60 ${
                      isDarkMode ? 'border-slate-750 bg-slate-900' : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr
                          className={`border-b ${
                            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
                          }`}
                        >
                          <th className="py-2 px-2.5 w-20 text-center font-bold text-neutral-500 border-r border-neutral-200 dark:border-slate-700">
                            Fila
                          </th>
                          {availableColumns.map((colKey, colIdx) => {
                            const colLetter = getColLetter(colIdx);
                            const isPrimaryName = selectedNameColumn === colKey;
                            const isSecondaryName = selectedSecondaryNameColumn === colKey;
                            const isEmail = selectedEmailColumn === colKey;
                            const detCfg = detectedColumns.find((c) => c.colKey === colKey);
                            const currentRole = isPrimaryName
                              ? 'student_name'
                              : isSecondaryName
                              ? 'student_second_name'
                              : isEmail
                              ? 'student_email'
                              : detCfg?.isIncluded && detCfg.kind !== 'ignore'
                              ? detCfg.kind
                              : 'ignore';

                            return (
                              <th
                                key={colKey}
                                className="p-2 min-w-[165px] border-r border-neutral-200 dark:border-slate-700 align-top"
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-slate-700 text-[10px] font-mono font-bold">
                                      Col {colLetter}
                                    </span>
                                    <span className="truncate font-bold text-neutral-700 dark:text-slate-200" title={colKey}>
                                      {colKey}
                                    </span>
                                  </div>
                                  <select
                                    value={currentRole}
                                    onChange={(e) =>
                                      handleVisualColumnRoleChange(colKey, e.target.value as any)
                                    }
                                    className={`w-full px-2 py-1 rounded-lg border text-[11px] font-bold outline-hidden cursor-pointer ${
                                      currentRole === 'student_name' || currentRole === 'student_second_name'
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : currentRole === 'disposition' || currentRole === 'disposition_deduction'
                                        ? 'bg-purple-600 text-white border-purple-600'
                                        : currentRole === 'absences' || currentRole === 'lates'
                                        ? 'bg-amber-600 text-white border-amber-600'
                                        : currentRole === 'grade'
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : isDarkMode
                                        ? 'bg-slate-900 border-slate-700 text-slate-400'
                                        : 'bg-white border-neutral-300 text-neutral-500'
                                    }`}
                                  >
                                    <option value="ignore">🚫 Ignorar columna</option>
                                    <option value="student_name">👤 Alumno (Apellido y Nombre)</option>
                                    <option value="student_second_name">👤 2° Columna Alumno (Nombre)</option>
                                    <option value="student_email">✉️ Correo / Email</option>
                                    <option value="disposition">⭐ Nota de Disposición (1-10)</option>
                                    <option value="disposition_deduction">➖ Descuento Disposición (resta de 10)</option>
                                    <option value="absences">📅 Total Ausencias / Faltas</option>
                                    <option value="lates">⏰ Total Llegadas Tarde</option>
                                    <option value="grade">📊 Nota / Calificación</option>
                                  </select>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-slate-800 font-mono">
                        {raw2DGrid.slice(0, 7).map((rowArr, rIdx) => {
                          const isHeaderRow = rIdx === selectedHeaderRowIndex;
                          return (
                            <tr
                              key={rIdx}
                              onClick={() => handleSelectCustomHeaderRowIndex(rIdx)}
                              title="Hacé clic si querés usar esta fila como fila de títulos"
                              className={`cursor-pointer transition-colors ${
                                isHeaderRow
                                  ? isDarkMode
                                    ? 'bg-indigo-950/60 text-indigo-200 font-bold'
                                    : 'bg-indigo-50 text-indigo-900 font-bold'
                                  : isDarkMode
                                  ? 'hover:bg-slate-800/50 text-slate-300'
                                  : 'hover:bg-neutral-50 text-neutral-700'
                              }`}
                            >
                              <td className="py-1.5 px-2 text-center border-r border-neutral-100 dark:border-slate-800 whitespace-nowrap">
                                <span>Fila {rIdx + 1}</span>
                                {isHeaderRow && (
                                  <span className="ml-1 px-1 py-0.2 rounded bg-indigo-600 text-white text-[9px] uppercase">
                                    Títulos
                                  </span>
                                )}
                              </td>
                              {availableColumns.map((colKey, colIdx) => (
                                <td
                                  key={`${rIdx}-${colKey}`}
                                  className="py-1.5 px-2.5 border-r border-neutral-100 dark:border-slate-800 truncate max-w-[180px]"
                                >
                                  {String(rowArr?.[colIdx] ?? '') || '-'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 1. SECCIÓN DE CATEGORÍAS Y COLUMNAS DETECTADAS */}
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDarkMode ? 'bg-slate-850/70 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      1. Categorías, Notas y Columnas Detectadas ({includedColumns.length} seleccionadas)
                    </h4>
                  </div>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Podés elegir a qué categoría va cada nota (o crear una categoría nueva) y editar su nombre.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {detectedColumns.map((colCfg) => (
                    <div
                      key={colCfg.colKey}
                      className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                        !colCfg.isIncluded || colCfg.kind === 'ignore'
                          ? isDarkMode
                            ? 'bg-slate-900/40 border-slate-800 opacity-60'
                            : 'bg-neutral-100/60 border-neutral-200 opacity-60'
                          : isDarkMode
                          ? 'bg-slate-800/90 border-slate-700'
                          : 'bg-white border-blue-200 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-xs">
                          <input
                            type="checkbox"
                            checked={colCfg.isIncluded && colCfg.kind !== 'ignore'}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              handleUpdateColumnConfig(colCfg.colKey, {
                                isIncluded: checked,
                                kind:
                                  checked && colCfg.kind === 'ignore'
                                    ? importContext === 'attendance'
                                      ? 'disposition'
                                      : 'grade'
                                    : colCfg.kind,
                              });
                            }}
                            className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                          />
                          <span className="truncate" title={colCfg.colKey}>
                            Columna: "{colCfg.colKey}"
                          </span>
                        </label>

                        {/* Tipo de dato detectado */}
                        <select
                          value={colCfg.kind}
                          onChange={(e) => {
                            const nextKind = e.target.value as DetectedColumnKind;
                            handleUpdateColumnConfig(colCfg.colKey, {
                              kind: nextKind,
                              isIncluded: nextKind !== 'ignore',
                            });
                          }}
                          className={`px-2 py-1 text-[11px] rounded-lg border font-bold outline-hidden ${
                            colCfg.kind === 'grade'
                              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                              : colCfg.kind === 'ignore'
                              ? 'bg-neutral-100 dark:bg-slate-800 text-neutral-500 border-neutral-300 dark:border-slate-700'
                              : 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                          }`}
                        >
                          <option value="disposition">⭐ Nota de Disposición (1-10)</option>
                          <option value="disposition_deduction">➖ Descuento Disposición (resta de 10)</option>
                          <option value="absences">📅 Total Ausencias / Faltas</option>
                          <option value="lates">⏰ Llegadas Tarde / Tardanzas</option>
                          <option value="grade">📊 Nota / Calificación</option>
                          <option value="ignore">🚫 Ignorar columna</option>
                        </select>
                      </div>

                      {colCfg.isIncluded && colCfg.kind === 'grade' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-neutral-100 dark:border-slate-700/60 text-[11px]">
                          {/* Categoría destino */}
                          <div>
                            <span className="block font-semibold text-neutral-500 dark:text-slate-400 mb-0.5">
                              Categoría en la App:
                            </span>
                            <select
                              value={
                                colCfg.targetCategoryMode === 'new'
                                  ? '__NEW_CAT__'
                                  : colCfg.targetCategoryId
                              }
                              onChange={(e) => {
                                if (e.target.value === '__NEW_CAT__') {
                                  handleUpdateColumnConfig(colCfg.colKey, {
                                    targetCategoryMode: 'new',
                                    newCategoryName: colCfg.newCategoryName || colCfg.colKey,
                                  });
                                } else {
                                  handleUpdateColumnConfig(colCfg.colKey, {
                                    targetCategoryMode: 'existing',
                                    targetCategoryId: e.target.value,
                                  });
                                }
                              }}
                              className={`w-full px-2 py-1 rounded-lg border font-medium outline-hidden ${
                                isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                              }`}
                            >
                              {activeCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                              <option value="__NEW_CAT__">➕ + Crear Nueva Categoría...</option>
                            </select>

                            {colCfg.targetCategoryMode === 'new' && (
                              <input
                                type="text"
                                value={colCfg.newCategoryName}
                                onChange={(e) =>
                                  handleUpdateColumnConfig(colCfg.colKey, {
                                    newCategoryName: e.target.value,
                                  })
                                }
                                placeholder="Nombre de la nueva categoría"
                                className={`mt-1 w-full px-2 py-1 rounded-lg border font-semibold ${
                                  isDarkMode
                                    ? 'bg-slate-900 border-emerald-700 text-emerald-300'
                                    : 'bg-emerald-50/50 border-emerald-300 text-emerald-800'
                                }`}
                              />
                            )}
                          </div>

                          {/* Nombre de la evaluación / subcategoría */}
                          <div>
                            <span className="block font-semibold text-neutral-500 dark:text-slate-400 mb-0.5">
                              Nombre de Evaluación / Nota:
                            </span>
                            <input
                              type="text"
                              value={colCfg.subcategoryName}
                              onChange={(e) =>
                                handleUpdateColumnConfig(colCfg.colKey, {
                                  subcategoryName: e.target.value,
                                })
                              }
                              placeholder="Ej. TP 1 / Parcial 1"
                              className={`w-full px-2 py-1 rounded-lg border font-semibold ${
                                isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-neutral-300'
                              }`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Opción para agregar alumnos nuevos si el documento tiene alumnos que aún no están en el curso */}
              {summaryMetrics.newStudentsCount > 0 && (
                <div
                  className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                    isDarkMode
                      ? 'bg-indigo-950/40 border-indigo-800/70 text-indigo-200'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <UserPlus className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="text-xs font-semibold">
                      Se detectaron <strong>{summaryMetrics.newStudentsCount} alumno(s)</strong> en el documento que aún no estaban en la lista del curso.
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeNewStudentsFromDoc}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIncludeNewStudentsFromDoc(checked);
                        setVerifiedRows((prev) =>
                          prev.map((r) => (r.isNewStudent ? { ...r, isIncluded: checked } : r))
                        );
                      }}
                      className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                    />
                    <span>Agregar también estos alumnos al curso e importar sus datos</span>
                  </label>
                </div>
              )}

              {/* 2. SECCIÓN DE COMPROBACIÓN DE ALUMNOS Y VALORES */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className={`p-1 rounded-xl border flex items-center gap-1 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setInspectionMode('table')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          inspectionMode === 'table'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'text-slate-400 hover:text-white'
                            : 'text-neutral-600 hover:text-neutral-900'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Vista Tabla de Comprobación ({displayedRows.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectionMode('individual')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          inspectionMode === 'individual'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : isDarkMode
                            ? 'text-slate-400 hover:text-white'
                            : 'text-neutral-600 hover:text-neutral-900'
                        }`}
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Revisar Alumno por Alumno</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setFilterMode('all')}
                        className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                          filterMode === 'all'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-neutral-200 text-neutral-700'
                        }`}
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterMode('changes')}
                        className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                          filterMode === 'changes'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-neutral-200 text-neutral-700'
                        }`}
                      >
                        Con datos a importar ({summaryMetrics.includedRowsCount})
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-52">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input
                        type="text"
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        placeholder="Buscar alumno..."
                        className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                          isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                        }`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setVerifiedRows((prev) => prev.map((r) => ({ ...r, isIncluded: true })))
                      }
                      className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border cursor-pointer ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    >
                      Marcar todos
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setVerifiedRows((prev) => prev.map((r) => ({ ...r, isIncluded: false })))
                      }
                      className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border cursor-pointer ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
                      }`}
                    >
                      Desmarcar
                    </button>
                  </div>
                </div>

                {/* VISTA A: TABLA DE COMPROBACIÓN COMPLETA */}
                {inspectionMode === 'table' && (
                  <div
                    className={`border rounded-xl overflow-hidden shadow-xs ${
                      isDarkMode ? 'border-slate-750 bg-slate-900' : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <div className="overflow-x-auto max-h-[46vh]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="sticky top-0 z-10">
                          <tr
                            className={`border-b ${
                              isDarkMode
                                ? 'bg-slate-800 border-slate-750 text-slate-200'
                                : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                            }`}
                          >
                            <th className="py-2.5 px-3 w-10 text-center font-bold">Inc.</th>
                            <th className="py-2.5 px-3 font-bold min-w-[190px]">Alumno en la App</th>
                            <th className="py-2.5 px-3 font-bold min-w-[160px]">Nombre en Documento</th>
                            {includedColumns.map((col) => (
                              <th key={col.colKey} className="py-2.5 px-3 text-center font-bold min-w-[130px]">
                                <div className="flex flex-col items-center">
                                  <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                    {col.kind === 'grade'
                                      ? col.targetCategoryMode === 'new'
                                        ? `+ ${col.newCategoryName}`
                                        : activeCategories.find((c) => c.id === col.targetCategoryId)?.name ||
                                          'Calificación'
                                      : col.kind === 'absences'
                                      ? 'Asistencia'
                                      : col.kind === 'lates'
                                      ? 'Tardanzas'
                                      : col.kind === 'disposition_deduction'
                                      ? 'Disposición (10 - Desc.)'
                                      : 'Disposición'}
                                  </span>
                                  <span className="truncate max-w-[140px]">
                                    {col.kind === 'grade' ? col.subcategoryName : col.colKey}
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100 dark:divide-slate-800">
                          {displayedRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3 + includedColumns.length}
                                className="py-8 text-center text-neutral-400"
                              >
                                No hay filas para mostrar con el filtro actual.
                              </td>
                            </tr>
                          ) : (
                            displayedRows.map((row) => (
                              <tr
                                key={row.rowId}
                                className={`transition-colors ${
                                  !row.isIncluded
                                    ? 'opacity-55 bg-neutral-50/40 dark:bg-slate-900/40'
                                    : isDarkMode
                                    ? 'hover:bg-slate-800/40'
                                    : 'hover:bg-blue-50/20'
                                }`}
                              >
                                <td className="py-2 px-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={row.isIncluded}
                                    onChange={() =>
                                      setVerifiedRows((prev) =>
                                        prev.map((r) =>
                                          r.rowId === row.rowId ? { ...r, isIncluded: !r.isIncluded } : r
                                        )
                                      )
                                    }
                                    className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                                  />
                                </td>

                                <td className="py-2 px-3 font-semibold">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>{row.studentName}</span>
                                    {row.isNewStudent && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                        + Nuevo
                                      </span>
                                    )}
                                  </div>
                                  {students.length > 0 && (
                                    <select
                                      value={row.isNewStudent ? '' : row.studentId}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleReassignRowStudent(row.rowId, e.target.value);
                                        }
                                      }}
                                      className={`mt-1 w-full text-[10px] px-1.5 py-0.5 rounded border outline-hidden ${
                                        isDarkMode
                                          ? 'bg-slate-800 border-slate-700 text-slate-300'
                                          : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                                      }`}
                                      title="Cambiar asignación de alumno manualmente si es necesario"
                                    >
                                      {row.isNewStudent && (
                                        <option value="">-- Crear como alumno nuevo --</option>
                                      )}
                                      {students.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          Vincular con: {s.lastName}, {s.firstName}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>

                                <td className="py-2 px-3">
                                  {row.matchedFromRaw ? (
                                    <div className="flex flex-col">
                                      <span className="font-mono text-[11px]">{row.matchedFromRaw}</span>
                                      <span
                                        className={`text-[10px] font-semibold ${
                                          row.matchScore >= 0.9
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : row.isNewStudent
                                            ? 'text-indigo-600 dark:text-indigo-400'
                                            : 'text-blue-600 dark:text-blue-400'
                                        }`}
                                      >
                                        {row.matchScore >= 0.9
                                          ? '✓ Coincidencia exacta'
                                          : row.isNewStudent
                                          ? 'Alumno nuevo detectado'
                                          : '~ Coincidencia aproximada'}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] italic text-neutral-400">
                                      Sin fila en documento
                                    </span>
                                  )}
                                </td>

                                {includedColumns.map((col) => {
                                  const cell = row.valuesByCol[col.colKey] || {
                                    currentVal: '',
                                    importedVal: '',
                                    editedVal: '',
                                    isValid: true,
                                    status: 'empty',
                                  };
                                  return (
                                    <td key={col.colKey} className="py-2 px-2.5 text-center">
                                      <div className="flex flex-col items-center gap-1">
                                        <input
                                          type="text"
                                          value={cell.editedVal}
                                          onChange={(e) =>
                                            handleCellEdit(row.rowId, col.colKey, e.target.value)
                                          }
                                          placeholder="-"
                                          className={`w-20 px-2 py-1 text-center font-mono text-xs font-bold rounded-lg border outline-hidden ${
                                            !cell.isValid
                                              ? 'border-red-500 bg-red-500/10 text-red-600'
                                              : cell.status === 'update'
                                              ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                              : cell.status === 'new'
                                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                              : isDarkMode
                                              ? 'bg-slate-800 border-slate-700 text-slate-200'
                                              : 'bg-white border-neutral-300 text-neutral-800'
                                          }`}
                                        />
                                        {cell.currentVal !== '' && cell.status === 'update' && (
                                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                            Antes: {cell.currentVal}
                                          </span>
                                        )}
                                        {!cell.isValid && (
                                          <span className="text-[10px] text-red-500 font-bold">
                                            Valor inválido
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* VISTA B: REVISIÓN ALUMNO POR ALUMNO */}
                {inspectionMode === 'individual' && currentInspectedRow && (
                  <div
                    className={`p-5 rounded-2xl border space-y-4 ${
                      isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-white border-neutral-200 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 border-b pb-3 border-neutral-200 dark:border-slate-800">
                      <div>
                        <span className="text-[11px] font-bold uppercase text-blue-600 dark:text-blue-400">
                          Alumno {selectedStudentIndex + 1} de {displayedRows.length}
                        </span>
                        <h4 className="text-base font-bold">{currentInspectedRow.studentName}</h4>
                        <p className="text-xs text-neutral-500 dark:text-slate-400">
                          Detectado en documento como: "{currentInspectedRow.matchedFromRaw || 'No encontrado'}"
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={selectedStudentIndex <= 0}
                          onClick={() => setSelectedStudentIndex((i) => Math.max(0, i - 1))}
                          className="p-2 rounded-xl border disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={selectedStudentIndex >= displayedRows.length - 1}
                          onClick={() =>
                            setSelectedStudentIndex((i) => Math.min(displayedRows.length - 1, i + 1))
                          }
                          className="p-2 rounded-xl border disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {includedColumns.map((col) => {
                        const cell = currentInspectedRow.valuesByCol[col.colKey];
                        return (
                          <div
                            key={col.colKey}
                            className={`p-3 rounded-xl border ${
                              isDarkMode ? 'bg-slate-900 border-slate-750' : 'bg-neutral-50 border-neutral-200'
                            }`}
                          >
                            <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                              {col.kind === 'grade' ? col.subcategoryName : col.colKey}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-xs text-neutral-500">
                                Actual: <strong>{cell?.currentVal || '-'}</strong>
                              </span>
                              <input
                                type="text"
                                value={cell?.editedVal || ''}
                                onChange={(e) =>
                                  handleCellEdit(currentInspectedRow.rowId, col.colKey, e.target.value)
                                }
                                className={`w-24 px-2.5 py-1 text-center font-mono text-xs font-bold rounded-lg border ${
                                  isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pie de Comprobación Previa */}
            <div
              className={`px-5 py-3.5 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 ${
                isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveStep('upload')}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-300 text-neutral-700 hover:bg-white'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Volver al Paso 1</span>
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-neutral-500 dark:text-slate-400">
                  Se importarán <strong>{ includedColumns.length } columna(s)</strong> en{' '}
                  <strong>{summaryMetrics.includedRowsCount} alumno(s)</strong>
                </span>
                <button
                  type="button"
                  onClick={handleConfirmAllVerifiedData}
                  disabled={summaryMetrics.includedRowsCount === 0 || includedColumns.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
                >
                  <FileCheck className="w-4 h-4" />
                  <span>Confirmar y Agregar Datos Verificados</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 3: HISTORIAL DE IMPORTACIONES                                        */}
        {/* ========================================================================= */}
        {activeStep === 'history' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="p-5 flex-1 overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm">Historial de Importaciones de la Materia</h4>
                <button
                  type="button"
                  onClick={() => exportGradeHistoryToExcel(courseName, historyEntries)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar Historial a Excel</span>
                </button>
              </div>
              {historyEntries.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                    isDarkMode ? 'bg-slate-800/60 border-slate-750' : 'bg-white border-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      {item.categoryName} — {item.evaluationName} ({item.termLabel})
                    </span>
                    <span className="text-neutral-400">
                      {item.date} {item.time}
                    </span>
                  </div>
                  <p className="text-neutral-500 dark:text-slate-400">{item.description}</p>
                </div>
              ))}
            </div>
            <div
              className={`px-5 py-3 border-t flex justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveStep('upload')}
                className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
              >
                ← Volver a Importar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
