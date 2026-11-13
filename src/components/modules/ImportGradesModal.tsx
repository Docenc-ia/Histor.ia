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
  FileText,
} from 'lucide-react';
import type * as XLSXType from 'xlsx';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { GradeHistoryEntry } from '../../utils/excelExport';
import { driveService } from '../../services/workspace/driveService';
import { sheetsService } from '../../services/workspace/sheetsService';
import {
  normalizeImportText,
  autoDetectIdentityColumns,
  autoDetectColumnsConfiguration,
  computeMultiVerificationRows,
  parseFlexibleCellNumber,
  buildDocumentRowOptions,
} from '../../utils/gradeImportParser';
import { buildGradeImportCommitPayload } from '../../utils/gradeImportCommitBuilder';
import { ImportHistoryTab } from './gradeImport/ImportHistoryTab';
import {
  LoadedImportDataset,
  splitPasteLineSmart,
  extractExcelSheetDataset,
  parseUploadedImportFile,
  loadRemoteImportDocument,
  buildPasteImportDataset,
} from '../../services/gradeImportDataService';
import type {
  ParsedStudentRow,
  DetectedColumnKind,
  QuickPastePreset,
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
  MultiImportApplyPayload,
} from '../../types/gradeImport';

export type {
  ParsedStudentRow,
  DetectedColumnKind,
  QuickPastePreset,
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
  MultiImportApplyPayload,
};

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
  initialSourceType?: 'file' | 'csv' | 'sheets' | 'paste';
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
  onSwitchToForms?: () => void;
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
  onSwitchToForms,
}) => {
  const [activeStep, setActiveStep] = useState<'upload' | 'verify' | 'history'>('upload');
  const [sourceType, setSourceType] = useState<'file' | 'csv' | 'sheets' | 'paste'>(initialSourceType);
  const [attendanceTargetMode, setAttendanceTargetMode] = useState<'disposition' | 'absences' | 'both'>('disposition');

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
    Array<{
      id: string;
      name: string;
      modifiedTime?: string;
      url: string;
      mimeType?: string;
      docType?: 'sheet' | 'doc' | 'form';
    }>
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
      setSourceType(initialSourceType);
      setActiveStep('upload');
      let defaultTarget: 'disposition' | 'absences' | 'both' = 'disposition';
      try {
        const storedTarget = sessionStorage.getItem('docencia_import_attendance_target_mode');
        if (
          storedTarget === 'absences' ||
          storedTarget === 'disposition' ||
          storedTarget === 'both'
        ) {
          defaultTarget = storedTarget;
          sessionStorage.removeItem('docencia_import_attendance_target_mode');
        }
      } catch {}
      setAttendanceTargetMode(defaultTarget);
      if (importContext === 'attendance') {
        setQuickPastePreset(
          defaultTarget === 'absences'
            ? 'name_and_abs'
            : defaultTarget === 'both'
            ? 'name_abs_disp'
            : 'name_and_disp'
        );
      } else {
        setQuickPastePreset('auto');
      }
    }
  }, [isOpen, initialSourceType, importContext]);

  // Multi-column auto-detection states
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumnConfig[]>([]);
  const [verifiedRows, setVerifiedRows] = useState<MultiVerifiedStudentRow[]>([]);
  const [manualRowMatches, setManualRowMatches] = useState<Record<string, number | null>>({});
  const [includeNewStudentsFromDoc, setIncludeNewStudentsFromDoc] = useState<boolean>(false);

  // Filters & inspection mode in Step 2
  const [filterMode, setFilterMode] = useState<'all' | 'changes' | 'missing'>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [inspectionMode, setInspectionMode] = useState<'table' | 'individual'>('table');
  const [selectedStudentIndex, setSelectedStudentIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load teacher's Google Spreadsheets, Docs & Forms when switching to 'sheets' tab or clicking "Buscar"
  const handleLoadDriveSpreadsheets = async (query?: string, interactive = false) => {
    setIsLoadingDriveSheets(true);
    setRemoteSheetError(null);
    try {
      const list = await driveService.listUserSpreadsheets(query, undefined, true, interactive);
      setDriveSpreadsheets(list);
    } catch (err: any) {
      console.warn('Error loading Drive spreadsheets:', err);
    } finally {
      setIsLoadingDriveSheets(false);
    }
  };

  useEffect(() => {
    if (isOpen && sourceType === 'sheets' && driveSpreadsheets.length === 0) {
      handleLoadDriveSpreadsheets(undefined, false);
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
    secondaryNameCol = selectedSecondaryNameColumn,
    customManualMatches: Record<string, number | null> = manualRowMatches
  ) => {
    const { rowsResult, shouldAutoEnableNewStudents } = computeMultiVerificationRows(
      students,
      rawRows,
      nameCol,
      emailCol,
      colConfigs,
      activeGradesMap,
      activeDispMap,
      secondaryNameCol,
      customManualMatches
    );

    if (shouldAutoEnableNewStudents) {
      setIncludeNewStudentsFromDoc(true);
    }

    setVerifiedRows(rowsResult);
  };

  /**
   * Switch between importing/updating Asistencia (Cantidad de Faltas), Disposición (1-10), or Ambos
   */
  const handleSwitchAttendanceTargetMode = (nextMode: 'disposition' | 'absences' | 'both') => {
    setAttendanceTargetMode(nextMode);
    if (nextMode === 'absences') {
      setQuickPastePreset((prev) =>
        prev === 'last_first_disp'
          ? 'last_first_abs'
          : prev === 'only_disp_ordered'
          ? 'only_abs_ordered'
          : 'name_and_abs'
      );
    } else if (nextMode === 'disposition') {
      setQuickPastePreset((prev) =>
        prev === 'last_first_abs'
          ? 'last_first_disp'
          : prev === 'only_abs_ordered'
          ? 'only_disp_ordered'
          : 'name_and_disp'
      );
    } else {
      setQuickPastePreset('name_abs_disp');
    }

    if (rawTableRows.length > 0 && availableColumns.length > 0) {
      const reDetected = autoDetectColumnsConfiguration(
        availableColumns,
        selectedNameColumn,
        selectedEmailColumn,
        activeCategories,
        selectedSecondaryNameColumn,
        importContext,
        nextMode
      );
      let finalCols = reDetected;
      // If user explicitly chose 'absences' or 'disposition' and there is a single active column, force its kind so switching in Step 2 is immediate
      const activeNonIgnored = finalCols.filter((c) => c.isIncluded && c.kind !== 'ignore');
      if (nextMode === 'absences' && activeNonIgnored.length === 1) {
        finalCols = finalCols.map((c) =>
          c.colKey === activeNonIgnored[0].colKey ? { ...c, kind: 'absences', isIncluded: true } : c
        );
      } else if (nextMode === 'disposition' && activeNonIgnored.length === 1) {
        finalCols = finalCols.map((c) =>
          c.colKey === activeNonIgnored[0].colKey
            ? { ...c, kind: 'disposition', isIncluded: true }
            : c
        );
      }
      setDetectedColumns(finalCols);
      buildMultiVerificationRows(
        rawTableRows,
        selectedNameColumn,
        selectedEmailColumn,
        finalCols,
        selectedSecondaryNameColumn,
        manualRowMatches
      );
    }
  };

  /**
   * Process any loaded table (from Excel, Google Sheets, Google Docs, Word, CSV, or Paste)
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
    setManualRowMatches({});

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
        importContext,
        attendanceTargetMode
      );

    setDetectedColumns(detected);
    buildMultiVerificationRows(rows, nameCol, emailCol, detected, secondaryNameCol, {});

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

    const createColumnConfig = (
      targetKey: string,
      kind: DetectedColumnConfig['kind']
    ): DetectedColumnConfig => ({
      colKey: targetKey,
      isIncluded: kind !== 'ignore',
      kind,
      targetCategoryMode: 'existing',
      targetCategoryId: defaultCat.id,
      newCategoryName: '',
      targetSubcategoryMode: 'new',
      targetSubcategoryId: '',
      subcategoryName: targetKey,
    });

    const isIdentityRole =
      role === 'student_name' || role === 'student_second_name' || role === 'student_email';

    let nextNameCol =
      role === 'student_name'
        ? colKey
        : selectedNameColumn === colKey
          ? availableColumns.find((c) => c !== colKey) || ''
          : selectedNameColumn;
    let nextSecCol =
      role === 'student_second_name'
        ? colKey
        : selectedSecondaryNameColumn === colKey
          ? ''
          : selectedSecondaryNameColumn;
    let nextEmailCol =
      role === 'student_email'
        ? colKey
        : selectedEmailColumn === colKey
          ? ''
          : selectedEmailColumn;

    setSelectedNameColumn(nextNameCol);
    setSelectedSecondaryNameColumn(nextSecCol);
    setSelectedEmailColumn(nextEmailCol);

    if (isIdentityRole) {
      const nextDetected = detectedColumns.filter((c) => c.colKey !== colKey);
      if (
        role === 'student_name' &&
        selectedNameColumn &&
        selectedNameColumn !== '__ORDER__' &&
        selectedNameColumn !== colKey &&
        !nextDetected.some((c) => c.colKey === selectedNameColumn)
      ) {
        nextDetected.unshift(createColumnConfig(selectedNameColumn, 'ignore'));
      }
      setDetectedColumns(nextDetected);
      buildMultiVerificationRows(rawTableRows, nextNameCol, nextEmailCol, nextDetected, nextSecCol);
      return;
    }

    const existsInDetected = detectedColumns.some((c) => c.colKey === colKey);
    const nextDetected = existsInDetected
      ? detectedColumns.map((c) =>
          c.colKey === colKey ? { ...c, kind: role, isIncluded: role !== 'ignore' } : c
        )
      : [...detectedColumns, createColumnConfig(colKey, role)];

    setDetectedColumns(nextDetected);
    buildMultiVerificationRows(rawTableRows, nextNameCol, nextEmailCol, nextDetected, nextSecCol);
  };

  const applyLoadedDataset = (dataset: LoadedImportDataset, autoAdvance = true) => {
    setRawWorkbook(dataset.rawWorkbook);
    setSheetNames(dataset.sheetNames);
    setSelectedSheetName(dataset.selectedSheetName);
    setRaw2DGrid(dataset.raw2DGrid);
    setSelectedHeaderRowIndex(dataset.headerRowIndex);
    if (dataset.activeRemoteSpreadsheetId !== undefined) {
      setActiveRemoteSpreadsheetId(dataset.activeRemoteSpreadsheetId);
    }
    if (dataset.sheetUrlInput !== undefined) {
      setSheetUrlInput(dataset.sheetUrlInput);
    }
    processLoadedTableData(
      dataset.rows,
      dataset.headers,
      dataset.sourceLabel,
      autoAdvance,
      dataset.presetOverrides
    );
  };

  /**
   * Handle Excel (.xlsx, .xls), CSV (.csv), Word (.docx, .doc), HTML (.html), or Text (.txt) upload
   */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const dataset = await parseUploadedImportFile(file);
      if (dataset) {
        applyLoadedDataset(dataset, true);
      }
    } catch (err) {
      console.error('Error al procesar archivo:', err);
    }
  };

  const parseExcelSheet = async (
    wb: XLSXType.WorkBook,
    sheetName: string,
    sourceFileName?: string,
    autoAdvance = false
  ) => {
    const dataset = await extractExcelSheetDataset(wb, sheetName, sourceFileName);
    if (dataset) {
      applyLoadedDataset(dataset, autoAdvance);
    }
  };

  /**
   * Handle loading a Google Sheet, Google Doc, Google Form, or direct CSV/web link by URL/ID or from Drive list
   */
  const handleLoadRemoteGoogleSheet = async (
    idOrUrl: string,
    targetTab?: string,
    explicitDocType?: 'sheet' | 'doc' | 'form'
  ) => {
    const trimmed = idOrUrl.trim();
    if (!trimmed) return;
    setIsLoadingRemoteSheet(true);
    setRemoteSheetError(null);
    try {
      const dataset = await loadRemoteImportDocument({
        idOrUrl: trimmed,
        targetTab,
        explicitDocType,
        students,
        activeCategories,
      });
      applyLoadedDataset(dataset, true);
    } catch (err: any) {
      setRemoteSheetError(
        err?.message ||
          'No se pudo leer el documento desde el enlace. Verificá que el link sea de Google Sheets, Google Docs o Google Forms y que tengas acceso.'
      );
    } finally {
      setIsLoadingRemoteSheet(false);
    }
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
    const dataset = buildPasteImportDataset({
      pasteText,
      quickPastePreset,
      activeCategories,
      importContext,
      attendanceTargetMode,
    });
    if (dataset) {
      applyLoadedDataset(dataset, true);
    }
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

  // Choose which row from the uploaded document corresponds to a specific student in the course
  const handleSelectDocumentRowForStudent = (
    studentId: string,
    rawRowIdxOrNull: number | null
  ) => {
    const nextMatches: Record<string, number | null> = { ...manualRowMatches };
    // If another student had this same rawRowIdx manually assigned, free it
    if (rawRowIdxOrNull !== null) {
      Object.keys(nextMatches).forEach((stId) => {
        if (stId !== studentId && nextMatches[stId] === rawRowIdxOrNull) {
          delete nextMatches[stId];
        }
      });
    }
    nextMatches[studentId] = rawRowIdxOrNull;
    setManualRowMatches(nextMatches);

    const { rowsResult } = computeMultiVerificationRows(
      students,
      rawTableRows,
      selectedNameColumn,
      selectedEmailColumn,
      detectedColumns,
      activeGradesMap,
      activeDispMap,
      selectedSecondaryNameColumn,
      nextMatches
    );

    setVerifiedRows(
      rowsResult.map((r) =>
        r.studentId === studentId
          ? { ...r, isIncluded: rawRowIdxOrNull !== null }
          : r
      )
    );
  };

  // Reassign an unmatched or matched row to another student in the course
  const handleReassignRowStudent = (rowId: string, targetStudentId: string) => {
    const sourceRow = verifiedRows.find((r) => r.rowId === rowId);
    if (sourceRow && typeof sourceRow.matchedRawRowIndex === 'number') {
      handleSelectDocumentRowForStudent(targetStudentId, sourceRow.matchedRawRowIndex);
      return;
    }

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

  const documentRowOptions = useMemo(
    () =>
      buildDocumentRowOptions(
        rawTableRows,
        selectedNameColumn,
        selectedSecondaryNameColumn,
        selectedEmailColumn,
        detectedColumns
      ),
    [
      rawTableRows,
      selectedNameColumn,
      selectedSecondaryNameColumn,
      selectedEmailColumn,
      detectedColumns,
    ]
  );

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
    const commitResult = buildGradeImportCommitPayload({
      courseId,
      selectedTerm,
      sourceType,
      fileName,
      activeCategories,
      activeGradesMap,
      verifiedRows,
      includedColumns,
      includeNewStudentsFromDoc,
    });
    if (!commitResult) return;

    if (onApplyMultiImport) {
      onApplyMultiImport(commitResult.multiPayload);
      onClose();
      return;
    }

    if (commitResult.legacySingleGradePayload) {
      onApplyGrades(commitResult.legacySingleGradePayload);
    }
    onClose();
  };

  const currentInspectedRow = displayedRows[selectedStudentIndex] || displayedRows[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all ${
          isDarkMode
            ? 'bg-slate-900 border-slate-750 text-slate-100'
            : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base leading-tight">
                  {importContext === 'grades' ? 'Importar Evaluación o Notas' : 'Importar'}
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {courseName}
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                {importContext === 'grades'
                  ? 'Importá una evaluación de Google Forms, un documento (Sheets, Docs, Excel, Word o CSV), un link o pegá la lista de notas'
                  : 'Subí un documento (Sheets, Docs, Excel, Word o CSV), pegá un link o pegá la lista para elegir los nombres y verificar todo'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Selector de Cuatrimestre Destino */}
            <div className="flex items-center gap-1.5 mr-1">
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
              className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-slate-750 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step Indicator Bar (ventanita style like Subir Evaluación de Forms) */}
        <div
          className={`px-5 py-2.5 border-b flex items-center justify-between text-xs shrink-0 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-100/70 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 font-bold ${
                activeStep === 'upload'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-neutral-500 dark:text-slate-400'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] ${
                  activeStep === 'upload'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                1
              </span>
              1. Seleccionar Documento o Link
            </span>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <span
              className={`inline-flex items-center gap-1.5 font-bold ${
                activeStep === 'verify'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-neutral-400 dark:text-slate-500'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] ${
                  activeStep === 'verify'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-300 dark:bg-slate-700 text-neutral-600 dark:text-slate-400'
                }`}
              >
                2
              </span>
              2. Elegir Nombres, Columna y Confirmar
            </span>
          </div>

          {activeStep === 'verify' && (
            <button
              type="button"
              onClick={() => setActiveStep('upload')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Cambiar documento
            </button>
          )}
        </div>

        {/* Selector de qué importar en Asistencia y Disposición (Faltas, Disposición o Ambos) */}
        {importContext === 'attendance' && activeStep !== 'history' && (
          <div
            className={`px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 shrink-0 ${
              isDarkMode ? 'bg-slate-850/90 border-slate-800' : 'bg-amber-50/50 border-amber-200/70'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-700 dark:text-slate-200">
              <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
              <span>¿Qué querés importar o actualizar?</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchAttendanceTargetMode('absences')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  attendanceTargetMode === 'absences'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-300 text-neutral-700 hover:bg-amber-50'
                }`}
              >
                <span>📅 Importar / Actualizar Asistencia (Cantidad de Faltas)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAttendanceTargetMode('disposition')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  attendanceTargetMode === 'disposition'
                    ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-300 text-neutral-700 hover:bg-purple-50'
                }`}
              >
                <span>⭐ Importar / Actualizar Disposición (1 a 10)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAttendanceTargetMode('both')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  attendanceTargetMode === 'both'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-300 text-neutral-700 hover:bg-emerald-50'
                }`}
              >
                <span>📅 + ⭐ Ambos (Faltas y Disposición)</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 1: SELECCIONAR DOCUMENTO, LINK O TEXTO PEGADO                        */}
        {/* ========================================================================= */}
        {activeStep === 'upload' && (
          <div className="p-5 overflow-y-auto space-y-5 flex-1">
            {/* Tarjetas de origen unificadas */}
            <div
              className={`grid grid-cols-1 ${
                importContext === 'grades' && onSwitchToForms ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
              } gap-2.5`}
            >
              {importContext === 'grades' && onSwitchToForms && (
                <button
                  type="button"
                  onClick={onSwitchToForms}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                    isDarkMode
                      ? 'bg-purple-950/40 border-purple-500/50 text-purple-200 hover:bg-purple-950/60'
                      : 'bg-purple-50/70 border-purple-300 text-purple-900 hover:bg-purple-100/70'
                  }`}
                >
                  <FileCheck className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">Evaluación de Google Forms</div>
                    <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
                      Elegí un cuestionario de Forms o hoja de respuestas con puntaje
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSourceType('sheets')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  sourceType === 'sheets'
                    ? isDarkMode
                      ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
                    : isDarkMode
                    ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <Link2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">Google Sheets / Docs (Link o Drive)</div>
                  <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
                    Pegá el link del Sheet o Doc o elegilo de tu cuenta de Google
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('file')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  sourceType === 'file' || sourceType === 'csv'
                    ? isDarkMode
                      ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
                    : isDarkMode
                    ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <Upload className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">Subir Archivo (.xlsx, .docx, .csv)</div>
                  <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
                    Subí un documento Excel, Word, Docs, CSV o TXT desde tu dispositivo
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('paste')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  sourceType === 'paste'
                    ? isDarkMode
                      ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
                    : isDarkMode
                    ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <ClipboardPaste className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">Pegar Nombres y Notas (Ctrl+V)</div>
                  <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
                    Copiá y pegá las columnas de alumnos y notas directamente
                  </div>
                </div>
              </button>
            </div>

            {/* MODO 1: SUBIR DOCUMENTO EXCEL, WORD (.docx, .doc), CSV, HTML O TXT */}
            {(sourceType === 'file' || sourceType === 'csv') && (
              <div className="space-y-4">
                <div className="flex justify-end">
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
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
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
                    accept={
                      sourceType === 'csv'
                        ? '.csv,.tsv,.txt,text/csv,text/plain'
                        : '.xlsx,.xls,.csv,.tsv,.docx,.doc,.txt,.html,.htm'
                    }
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-bold">
                    {fileName
                      ? `Documento cargado: ${fileName}`
                      : sourceType === 'csv'
                      ? 'Hacé clic aquí para seleccionar tu archivo CSV (.csv) o Texto (.txt)'
                      : 'Hacé clic aquí para subir tu documento (Excel .xlsx, Word .docx/.doc, CSV o TXT)'}
                  </p>
                  <p className={`text-xs mt-1.5 max-w-xl mx-auto ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Podés subir cualquier planilla o documento con nombres y notas de disposición. En el siguiente paso vas a poder <strong>elegir los nombres de los alumnos</strong> y verificar que esté todo bien antes de guardar.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      Excel (.xlsx / .xls)
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      Word / Docs (.docx / .doc)
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/15 text-teal-600 dark:text-teal-400">
                      CSV (.csv)
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400">
                      Texto / Tabla (.txt / .html)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* MODO 2: PEGAR UN LINK (GOOGLE SHEETS, GOOGLE DOCS, CSV) O ELEGIR DE GOOGLE DRIVE */}
            {sourceType === 'sheets' && (
              <div className="space-y-5">
                {/* Opción A: Pegar enlace o ID de Google Sheets, Google Docs, Google Forms o Web */}
                <div
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-blue-50/40 border-blue-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-blue-500" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Opción 1: Pegar un Link de Google Sheets, Google Docs, Forms o Documento
                    </h4>
                  </div>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                    Pegá el link de tu <strong>Google Sheet</strong>, <strong>Google Doc</strong>, <strong>Google Forms</strong> o archivo compartido. En el paso siguiente podrás <strong>elegir los nombres</strong> y ver si está todo bien antes de guardar:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={sheetUrlInput}
                      onChange={(e) => setSheetUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && sheetUrlInput.trim()) {
                          handleLoadRemoteGoogleSheet(sheetUrlInput);
                        }
                      }}
                      placeholder="Pegá acá el link (Google Sheets, Google Docs o Google Forms)..."
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
                      <span>{isLoadingRemoteSheet ? 'Leyendo Documento...' : 'Cargar desde Link y Revisar'}</span>
                    </button>
                  </div>

                  {remoteSheetError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{remoteSheetError}</span>
                    </div>
                  )}
                </div>

                {/* Opción B: Elegir un Google Sheet, Google Doc o Google Form directamente de Google Drive */}
                <div
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDarkMode ? 'bg-slate-850/40 border-slate-750' : 'bg-white border-neutral-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-emerald-500" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Opción 2: Elegir un Google Sheet, Google Doc o Forms de tu Google Drive
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
                            if (e.key === 'Enter') handleLoadDriveSpreadsheets(driveSearchQuery, true);
                          }}
                          placeholder="Buscar hoja, doc o form..."
                          className={`pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadDriveSpreadsheets(driveSearchQuery, true)}
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
                      <span>Buscando hojas de cálculo, documentos y formularios en tu Google Drive...</span>
                    </div>
                  ) : driveSpreadsheets.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-500 dark:text-slate-400">
                      No se encontraron documentos recientes o no has iniciado sesión en Google Drive. Podés pegar el link arriba o pulsar "Buscar" para conectar.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                      {driveSpreadsheets.map((sheet) => {
                        const isDoc = sheet.docType === 'doc';
                        const isForm = sheet.docType === 'form';
                        return (
                          <button
                            key={sheet.id}
                            type="button"
                            onClick={() =>
                              handleLoadRemoteGoogleSheet(sheet.id, undefined, sheet.docType)
                            }
                            disabled={isLoadingRemoteSheet}
                            className={`p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                              isDarkMode
                                ? 'bg-slate-800/70 hover:bg-slate-800 border-slate-700 hover:border-emerald-500/60'
                                : 'bg-neutral-50/70 hover:bg-emerald-50/50 border-neutral-200 hover:border-emerald-400'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {isForm ? (
                                <FileCheck className="w-4 h-4 text-purple-500 shrink-0" />
                              ) : isDoc ? (
                                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                              ) : (
                                <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold truncate">{sheet.name}</span>
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                                      isForm
                                        ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                        : isDoc
                                        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    }`}
                                  >
                                    {isForm ? 'Forms' : isDoc ? 'Docs' : 'Sheets'}
                                  </span>
                                </div>
                                {sheet.modifiedTime && (
                                  <div className="text-[10px] text-neutral-400">
                                    Modificado: {new Date(sheet.modifiedTime).toLocaleDateString('es-AR')}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold shrink-0">
                              Abrir
                            </span>
                          </button>
                        );
                      })}
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceTargetMode('absences');
                        setQuickPastePreset('name_and_abs');
                      }}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'name_and_abs'
                          ? 'bg-amber-600 text-white border-amber-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="font-bold">📅 2 Columnas: Alumno + Cantidad de Faltas</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'name_and_abs' ? 'text-amber-100' : 'text-neutral-400'
                        }`}
                      >
                        Ej: García, Juan [Tab] 3 (actualiza total de inasistencias)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceTargetMode('absences');
                        setQuickPastePreset('last_first_abs');
                      }}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'last_first_abs'
                          ? 'bg-amber-600 text-white border-amber-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="font-bold">👤+👤+📅 3 Cols: Apellido + Nombre + Faltas</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'last_first_abs' ? 'text-amber-100' : 'text-neutral-400'
                        }`}
                      >
                        Une Apellido y Nombre e importa la cantidad de faltas
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceTargetMode('disposition');
                        setQuickPastePreset('name_and_disp');
                      }}
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
                      onClick={() => {
                        setAttendanceTargetMode('disposition');
                        setQuickPastePreset('last_first_disp');
                      }}
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
                      onClick={() => {
                        setAttendanceTargetMode('both');
                        setQuickPastePreset('name_abs_disp');
                      }}
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
                      onClick={() => {
                        setAttendanceTargetMode('absences');
                        setQuickPastePreset('only_abs_ordered');
                      }}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'only_abs_ordered'
                          ? 'bg-amber-600 text-white border-amber-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="font-bold">🔢📅 1 Sola Columna de Faltas (Orden de lista)</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'only_abs_ordered' ? 'text-amber-100' : 'text-neutral-400'
                        }`}
                      >
                        Pegá solo la columna de cantidad de faltas en orden alfabético
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceTargetMode('disposition');
                        setQuickPastePreset('only_disp_ordered');
                      }}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        quickPastePreset === 'only_disp_ordered'
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs font-bold'
                          : isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className="font-bold">🔢⭐ 1 Sola Columna de Disp. (Orden de lista)</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          quickPastePreset === 'only_disp_ordered' ? 'text-indigo-100' : 'text-neutral-400'
                        }`}
                      >
                        Pegá solo la columna de notas de Disposición en orden alfabético
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
                    Seleccioná las celdas en tu Google Sheet o Excel, copialas (Ctrl+C) y pegalas aquí (Ctrl+V). Acepta números de faltas, decimales con coma (8,5), puntos o escala conceptual (MB, B, R):
                  </label>
                  <textarea
                    rows={8}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={
                      quickPastePreset === 'name_and_abs'
                        ? `Ejemplo de Cantidad de Faltas (con o sin fila de títulos):\nGarcía, Ana\t2\nLópez, Juan\t0\nMartínez, Sofía\t4`
                        : quickPastePreset === 'last_first_abs'
                        ? `Ejemplo con Apellido y Nombre separados + Cantidad de Faltas:\nGarcía\tAna\t2\nLópez\tJuan\t0`
                        : quickPastePreset === 'only_abs_ordered'
                        ? `Pegá directamente la columna de cantidad de faltas en el orden alfabético del curso:\n2\n0\n4\n1`
                        : quickPastePreset === 'name_and_disp'
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
                          importContext,
                          attendanceTargetMode
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
                            importContext,
                            attendanceTargetMode
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
                                      ? attendanceTargetMode === 'absences'
                                        ? 'absences'
                                        : 'disposition'
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
                              : colCfg.kind === 'absences' || colCfg.kind === 'lates'
                              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                          }`}
                        >
                          <option value="absences">📅 Total Ausencias / Cantidad de Faltas</option>
                          <option value="lates">⏰ Llegadas Tarde / Tardanzas</option>
                          <option value="disposition">⭐ Nota de Disposición (1-10)</option>
                          <option value="disposition_deduction">➖ Descuento Disposición (resta de 10)</option>
                          <option value="grade">📊 Nota / Calificación</option>
                          <option value="ignore">🚫 Ignorar columna</option>
                        </select>
                      </div>

                      {importContext === 'attendance' && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-neutral-100 dark:border-slate-700/60">
                          <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-1">
                            Asignar como:
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateColumnConfig(colCfg.colKey, {
                                kind: 'absences',
                                isIncluded: true,
                              })
                            }
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                              colCfg.isIncluded && colCfg.kind === 'absences'
                                ? 'bg-amber-600 text-white border-amber-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-amber-50'
                            }`}
                          >
                            📅 Cantidad de Faltas
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateColumnConfig(colCfg.colKey, {
                                kind: 'disposition',
                                isIncluded: true,
                              })
                            }
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                              colCfg.isIncluded && colCfg.kind === 'disposition'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-purple-50'
                            }`}
                          >
                            ⭐ Nota de Disposición
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateColumnConfig(colCfg.colKey, {
                                kind: 'lates',
                                isIncluded: true,
                              })
                            }
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                              colCfg.isIncluded && colCfg.kind === 'lates'
                                ? 'bg-amber-700 text-white border-amber-700'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-amber-50'
                            }`}
                          >
                            ⏰ Tardanzas
                          </button>
                        </div>
                      )}

                      {colCfg.isIncluded && colCfg.kind === 'grade' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-neutral-100 dark:border-slate-700/60 text-[11px]">
                          {/* Categoría Mayor destino */}
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className="font-semibold text-neutral-500 dark:text-slate-400">
                                Categoría Mayor:
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateColumnConfig(colCfg.colKey, {
                                    targetCategoryMode:
                                      colCfg.targetCategoryMode === 'new' ? 'existing' : 'new',
                                    newCategoryName: colCfg.newCategoryName || colCfg.colKey,
                                  })
                                }
                                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                {colCfg.targetCategoryMode === 'new'
                                  ? 'Elegir existente'
                                  : '+ Nueva categoría mayor'}
                              </button>
                            </div>
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
                              <option value="__NEW_CAT__">➕ + Crear Nueva Categoría Mayor...</option>
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
                                placeholder="Nombre de la nueva Categoría Mayor..."
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

              {/* 2. SECCIÓN DE COMPROBACIÓN DE ALUMNOS Y VALORES ("¿ESTÁ TODO BIEN?") */}
              <div className="space-y-3">
                {/* Banner de Verificación Rápida y Elección de Columnas */}
                <div
                  className={`p-3.5 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                    isDarkMode
                      ? 'bg-emerald-950/25 border-emerald-800/60 text-slate-100'
                      : 'bg-emerald-50/60 border-emerald-200 text-neutral-900'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-extrabold flex items-center gap-2 flex-wrap">
                        <span>¿Está todo bien? Verificación de Nombres y Notas</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          {verifiedRows.filter((r) => !r.isNewStudent && r.matchedFromRaw).length} de{' '}
                          {students.length} alumnos del curso vinculados
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-600 dark:text-slate-300 mt-0.5">
                        En la columna <strong>"Nombre en Documento (Elegir / Verificar)"</strong> podés desplegar la lista y elegir manualmente qué nombre del documento corresponde a cada alumno o corregir cualquier nota antes de guardar.
                      </p>
                    </div>
                  </div>

                  {/* Selectores rápidos de Columna de Nombres y Columna de Disposición */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-bold text-[11px] text-neutral-600 dark:text-slate-300">
                        Columna Nombres:
                      </span>
                      <select
                        value={selectedNameColumn}
                        onChange={(e) => {
                          const nextNameCol = e.target.value;
                          setSelectedNameColumn(nextNameCol);
                          setManualRowMatches({});
                          const nextDetected = autoDetectColumnsConfiguration(
                            availableColumns,
                            nextNameCol,
                            selectedEmailColumn,
                            activeCategories,
                            selectedSecondaryNameColumn,
                            importContext,
                            attendanceTargetMode
                          );
                          setDetectedColumns(nextDetected);
                          buildMultiVerificationRows(
                            rawTableRows,
                            nextNameCol,
                            selectedEmailColumn,
                            nextDetected,
                            selectedSecondaryNameColumn,
                            {}
                          );
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-bold outline-hidden cursor-pointer ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-blue-300'
                            : 'bg-white border-neutral-300 text-blue-800'
                        }`}
                      >
                        <option value="__ORDER__">🔢 Por orden de lista</option>
                        {availableColumns.map((col) => (
                          <option key={col} value={col}>
                            👤 {col}
                          </option>
                        ))}
                      </select>
                    </div>

                    {availableColumns.length > 1 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-bold text-[11px] text-neutral-600 dark:text-slate-300">
                          Columna Faltas:
                        </span>
                        <select
                          value={
                            detectedColumns.find(
                              (c) => c.isIncluded && c.kind === 'absences'
                            )?.colKey || ''
                          }
                          onChange={(e) => {
                            const chosenAbsCol = e.target.value;
                            if (!chosenAbsCol) return;
                            handleVisualColumnRoleChange(chosenAbsCol, 'absences');
                          }}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold outline-hidden cursor-pointer ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-amber-300'
                              : 'bg-white border-neutral-300 text-amber-800'
                          }`}
                        >
                          <option value="">-- Elegir columna de Faltas --</option>
                          {availableColumns
                            .filter((col) => col !== selectedNameColumn)
                            .map((col) => (
                              <option key={col} value={col}>
                                📅 {col}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {availableColumns.length > 1 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-bold text-[11px] text-neutral-600 dark:text-slate-300">
                          Columna Disposición:
                        </span>
                        <select
                          value={
                            detectedColumns.find(
                              (c) =>
                                c.isIncluded &&
                                (c.kind === 'disposition' || c.kind === 'disposition_deduction')
                            )?.colKey || ''
                          }
                          onChange={(e) => {
                            const chosenDispCol = e.target.value;
                            if (!chosenDispCol) return;
                            handleVisualColumnRoleChange(chosenDispCol, 'disposition');
                          }}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold outline-hidden cursor-pointer ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-emerald-300'
                              : 'bg-white border-neutral-300 text-emerald-800'
                          }`}
                        >
                          <option value="">-- Elegir columna de Disposición --</option>
                          {availableColumns
                            .filter((col) => col !== selectedNameColumn)
                            .map((col) => (
                              <option key={col} value={col}>
                                ⭐ {col}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

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

                    <div className="flex items-center gap-1 text-xs flex-wrap">
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
                      <button
                        type="button"
                        onClick={() => setFilterMode('missing')}
                        className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                          filterMode === 'missing'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-neutral-200 text-neutral-700'
                        }`}
                      >
                        Sin coincidencia ({verifiedRows.filter((r) => !r.isNewStudent && !r.matchedFromRaw).length})
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
                            <th className="py-2.5 px-3 font-bold min-w-[230px]">
                              Nombre en Documento (Elegir / Verificar)
                            </th>
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
                                        + Fila en doc sin vincular
                                      </span>
                                    )}
                                  </div>
                                  {row.isNewStudent && students.length > 0 && (
                                    <select
                                      value=""
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleReassignRowStudent(row.rowId, e.target.value);
                                        }
                                      }}
                                      className={`mt-1 w-full text-[10px] px-1.5 py-1 rounded border font-semibold outline-hidden cursor-pointer ${
                                        isDarkMode
                                          ? 'bg-slate-800 border-slate-700 text-blue-300'
                                          : 'bg-blue-50/60 border-blue-200 text-blue-800'
                                      }`}
                                      title="Asignar esta fila del documento a un alumno existente del curso"
                                    >
                                      <option value="">
                                        👉 Elegir a qué alumno del curso corresponde...
                                      </option>
                                      {students.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          Vincular con: {s.lastName}, {s.firstName}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>

                                <td className="py-2 px-3">
                                  {!row.isNewStudent && documentRowOptions.length > 0 ? (
                                    <div className="flex flex-col gap-1">
                                      <select
                                        value={
                                          typeof row.matchedRawRowIndex === 'number'
                                            ? String(row.matchedRawRowIndex)
                                            : ''
                                        }
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          handleSelectDocumentRowForStudent(
                                            row.studentId,
                                            val === '' ? null : Number(val)
                                          );
                                        }}
                                        className={`w-full text-[11px] px-2 py-1 rounded-lg border font-medium outline-hidden cursor-pointer ${
                                          row.matchedFromRaw
                                            ? isDarkMode
                                              ? 'bg-slate-800 border-emerald-700/70 text-slate-100'
                                              : 'bg-emerald-50/40 border-emerald-300 text-neutral-900'
                                            : isDarkMode
                                            ? 'bg-slate-800 border-amber-700/60 text-amber-300'
                                            : 'bg-amber-50/50 border-amber-300 text-amber-900'
                                        }`}
                                        title="Elegí qué nombre del documento corresponde a este alumno"
                                      >
                                        <option value="">
                                          — Sin vincular (elegir nombre del documento...) —
                                        </option>
                                        {documentRowOptions.map((opt) => (
                                          <option key={opt.rawRowIndex} value={String(opt.rawRowIndex)}>
                                            {opt.rawName}
                                            {opt.summaryPreview ? ` (${opt.summaryPreview})` : ''}
                                          </option>
                                        ))}
                                      </select>
                                      <span
                                        className={`text-[10px] font-semibold ${
                                          manualRowMatches[row.studentId] !== undefined &&
                                          manualRowMatches[row.studentId] !== null
                                            ? 'text-blue-600 dark:text-blue-400'
                                            : row.matchScore >= 0.9
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : row.matchedFromRaw
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-neutral-400'
                                        }`}
                                      >
                                        {manualRowMatches[row.studentId] !== undefined &&
                                        manualRowMatches[row.studentId] !== null
                                          ? '✓ Nombre elegido manualmente'
                                          : row.matchScore >= 0.9
                                          ? '✓ Coincidencia exacta'
                                          : row.matchedFromRaw
                                          ? '~ Coincidencia aproximada (revisar)'
                                          : 'Sin fila asignada — podés elegirla arriba'}
                                      </span>
                                    </div>
                                  ) : row.matchedFromRaw ? (
                                    <div className="flex flex-col">
                                      <span className="font-mono text-[11px]">{row.matchedFromRaw}</span>
                                      <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                                        Fila extra en documento (podés vincularla a la izquierda)
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
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-neutral-200 dark:border-slate-800">
                      <div className="space-y-1.5 flex-1">
                        <span className="text-[11px] font-bold uppercase text-blue-600 dark:text-blue-400">
                          Alumno {selectedStudentIndex + 1} de {displayedRows.length}
                        </span>
                        <h4 className="text-base font-bold">{currentInspectedRow.studentName}</h4>
                        {!currentInspectedRow.isNewStudent && documentRowOptions.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="text-xs text-neutral-500 dark:text-slate-400 font-semibold">
                              Nombre en el documento:
                            </span>
                            <select
                              value={
                                typeof currentInspectedRow.matchedRawRowIndex === 'number'
                                  ? String(currentInspectedRow.matchedRawRowIndex)
                                  : ''
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                handleSelectDocumentRowForStudent(
                                  currentInspectedRow.studentId,
                                  val === '' ? null : Number(val)
                                );
                              }}
                              className={`text-xs px-2.5 py-1 rounded-lg border font-semibold outline-hidden cursor-pointer ${
                                isDarkMode
                                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                                  : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                              }`}
                            >
                              <option value="">
                                — Sin vincular (elegir nombre del documento...) —
                              </option>
                              {documentRowOptions.map((opt) => (
                                <option key={opt.rawRowIndex} value={String(opt.rawRowIndex)}>
                                  {opt.rawName}
                                  {opt.summaryPreview ? ` (${opt.summaryPreview})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-500 dark:text-slate-400">
                            Detectado en documento como: "{currentInspectedRow.matchedFromRaw || 'No encontrado'}"
                          </p>
                        )}
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
          <ImportHistoryTab
            courseName={courseName}
            historyEntries={historyEntries}
            isDarkMode={isDarkMode}
            onBackToUpload={() => setActiveStep('upload')}
          />
        )}
      </div>
    </div>
  );
};
