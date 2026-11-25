import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Upload,
  CheckCircle2,
  X,
  Eye,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  Calendar,
  History,
  Star,
  Layers,
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
import { filterSheetToStudentAndGradeOnly } from '../../utils/googleFormsEvaluationHelper';
import { buildGradeImportCommitPayload } from '../../utils/gradeImportCommitBuilder';
import { ImportHistoryTab } from './gradeImport/ImportHistoryTab';
import { ImportUploadStep } from './gradeImport/ImportUploadStep';
import {
  ImportVisualMapperPanel,
  type VisualColumnRole,
} from './gradeImport/ImportVisualMapperPanel';
import { ImportColumnMappingPanel } from './gradeImport/ImportColumnMappingPanel';
import { ImportStudentVerificationPanel } from './gradeImport/ImportStudentVerificationPanel';
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
  onSwitchToForms?: (
    targetColumn?: {
      categoryId: string;
      subcategoryId: string;
      subcategoryName: string;
    } | null
  ) => void;
  initialTargetColumn?: {
    categoryId: string;
    subcategoryId: string;
    subcategoryName: string;
  } | null;
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
  initialTargetColumn = null,
}) => {
  const [activeStep, setActiveStep] = useState<'upload' | 'verify' | 'history'>('upload');
  const [sourceType, setSourceType] = useState<'file' | 'csv' | 'sheets' | 'paste'>(initialSourceType);
  const [attendanceTargetMode, setAttendanceTargetMode] = useState<'disposition' | 'absences' | 'both'>('disposition');
  const [preferredTargetColumn, setPreferredTargetColumn] = useState<{
    categoryId: string;
    subcategoryId: string;
    subcategoryName: string;
  } | null>(initialTargetColumn);

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
  const [showVisualSheetMapper, setShowVisualSheetMapper] = useState<boolean>(false);
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
      setSelectedTerm(initialTerm);
      setSourceType(initialSourceType);
      setActiveStep('upload');
      setPreferredTargetColumn(initialTargetColumn || null);
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
  }, [isOpen, initialTerm, initialSourceType, importContext, initialTargetColumn]);

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
        nextMode,
        rawTableRows
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
    let effectiveRows = rows;
    let effectiveCols = cols;
    let effectiveOverride = overridePreset;

    if (importContext === 'grades' && !overridePreset && cols.length > 2) {
      const reduced = filterSheetToStudentAndGradeOnly({
        headers: cols,
        rows,
        students,
      });
      if (reduced.filteredHeaders.length > 0 && reduced.scoreCol) {
        effectiveCols = reduced.filteredHeaders;
        effectiveRows = reduced.filteredRows;
        effectiveOverride = {
          nameCol: reduced.nameCol || reduced.emailCol,
          secondaryNameCol: reduced.secondaryNameCol,
          emailCol: reduced.emailCol,
        };
      }
    }

    setRawTableRows(effectiveRows);
    setAvailableColumns(effectiveCols);
    setFileName(sourceTitle);
    setManualRowMatches({});

    const detectedIdentity = autoDetectIdentityColumns(effectiveCols, effectiveRows);
    const nameCol =
      effectiveOverride?.nameCol !== undefined
        ? effectiveOverride.nameCol
        : detectedIdentity.nameCol;
    const secondaryNameCol =
      effectiveOverride?.secondaryNameCol !== undefined
        ? effectiveOverride.secondaryNameCol
        : detectedIdentity.secondaryNameCol;
    const emailCol =
      effectiveOverride?.emailCol !== undefined
        ? effectiveOverride.emailCol
        : detectedIdentity.emailCol;

    setSelectedNameColumn(nameCol);
    setSelectedSecondaryNameColumn(secondaryNameCol);
    setSelectedEmailColumn(emailCol);

    const rawDetected =
      effectiveOverride?.colConfigs ||
      autoDetectColumnsConfiguration(
        effectiveCols,
        nameCol,
        emailCol,
        activeCategories,
        secondaryNameCol,
        importContext,
        attendanceTargetMode,
        effectiveRows
      );

    const detected =
      importContext === 'grades' && preferredTargetColumn
        ? rawDetected.map((c) =>
            c.kind === 'grade'
              ? {
                  ...c,
                  targetCategoryMode: 'existing' as const,
                  targetCategoryId: preferredTargetColumn.categoryId,
                  targetSubcategoryMode: 'existing' as const,
                  targetSubcategoryId: preferredTargetColumn.subcategoryId,
                  subcategoryName: preferredTargetColumn.subcategoryName,
                }
              : c
          )
        : rawDetected;

    setDetectedColumns(detected);
    buildMultiVerificationRows(
      effectiveRows,
      nameCol,
      emailCol,
      detected,
      secondaryNameCol,
      {}
    );

    if (autoAdvanceToVerify) {
      setActiveStep('verify');
      setInspectionMode('table');
      setShowVisualSheetMapper(false);
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
    role: VisualColumnRole
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
    ): DetectedColumnConfig => {
      if (kind === 'grade' && preferredTargetColumn) {
        return {
          colKey: targetKey,
          isIncluded: true,
          kind,
          targetCategoryMode: 'existing',
          targetCategoryId: preferredTargetColumn.categoryId,
          newCategoryName: '',
          targetSubcategoryMode: 'existing',
          targetSubcategoryId: preferredTargetColumn.subcategoryId,
          subcategoryName: preferredTargetColumn.subcategoryName,
        };
      }
      return {
        colKey: targetKey,
        isIncluded: kind !== 'ignore',
        kind,
        targetCategoryMode: 'existing',
        targetCategoryId: defaultCat.id,
        newCategoryName: '',
        targetSubcategoryMode: 'new',
        targetSubcategoryId: '',
        subcategoryName: targetKey,
      };
    };

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
        importContext,
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
        className={`w-full ${
          activeStep === 'verify' && importContext === 'grades' && !showVisualSheetMapper
            ? 'max-w-2xl'
            : 'max-w-4xl'
        } max-h-[94vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all ${
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  attendanceTargetMode === 'absences'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>Asistencia (Cantidad de Faltas)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAttendanceTargetMode('disposition')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  attendanceTargetMode === 'disposition'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <Star className="w-3.5 h-3.5 shrink-0" />
                <span>Disposición (1 a 10)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAttendanceTargetMode('both')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  attendanceTargetMode === 'both'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>Ambos (Faltas y Disposición)</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 1: SELECCIONAR DOCUMENTO, LINK O TEXTO PEGADO                        */}
        {/* ========================================================================= */}
        {activeStep === 'upload' && (
          <ImportUploadStep
            isDarkMode={isDarkMode}
            importContext={importContext}
            courseName={courseName}
            selectedTerm={selectedTerm}
            students={students}
            activeCategories={activeCategories}
            activeGradesMap={activeGradesMap}
            currentDispositionMap1c={currentDispositionMap1c}
            currentDispositionMap2c={currentDispositionMap2c}
            preferredTargetColumn={preferredTargetColumn}
            onChangePreferredTargetColumn={setPreferredTargetColumn}
            onSwitchToForms={onSwitchToForms}
            sourceType={sourceType}
            onChangeSourceType={setSourceType}
            fileName={fileName}
            fileInputRef={fileInputRef}
            onFileUpload={handleFileUpload}
            sheetUrlInput={sheetUrlInput}
            onChangeSheetUrlInput={setSheetUrlInput}
            isLoadingRemoteSheet={isLoadingRemoteSheet}
            remoteSheetError={remoteSheetError}
            onLoadRemoteGoogleSheet={handleLoadRemoteGoogleSheet}
            driveSpreadsheets={driveSpreadsheets}
            isLoadingDriveSheets={isLoadingDriveSheets}
            driveSearchQuery={driveSearchQuery}
            onChangeDriveSearchQuery={setDriveSearchQuery}
            onLoadDriveSpreadsheets={handleLoadDriveSpreadsheets}
            pasteText={pasteText}
            onChangePasteText={setPasteText}
            quickPastePreset={quickPastePreset}
            onChangeQuickPastePreset={setQuickPastePreset}
            onChangeAttendanceTargetMode={setAttendanceTargetMode}
            pastePreviewStats={pastePreviewStats}
            onParsePaste={handleParsePaste}
          />
        )}

        {/* ========================================================================= */}
        {/* PASO 2: INTERFAZ DE COMPROBACIÓN PREVIA (CATEGORÍAS, NOTAS Y ASISTENCIA)  */}
        {/* ========================================================================= */}
        {activeStep === 'verify' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {/* Barra de documento cargado y selector de Pestaña (si el Excel o Google Sheet tiene varias hojas) */}
              <div
                className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 ${
                  isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-emerald-50/60 border-emerald-200'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{fileName}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-slate-400">
                      {importContext === 'grades'
                        ? 'Se detectaron automáticamente los alumnos del curso y su nota.'
                        : 'Si tu planilla tiene otro formato, podés ajustar las columnas.'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Selector de Pestaña / Hoja si hay múltiples */}
                  {sheetNames.length > 1 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold">Pestaña:</span>
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
                        className={`px-2 py-1 rounded-lg border font-bold outline-hidden ${
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

                  {importContext === 'attendance' && (
                    <>
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
                              attendanceTargetMode,
                              rawTableRows
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
                          className={`px-2.5 py-1 rounded-lg border font-bold outline-hidden max-w-[200px] truncate ${
                            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                          }`}
                        >
                          <option value="__ORDER__">Sin columna de nombre (Seguir orden de lista)</option>
                          {availableColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </div>

                      {raw2DGrid.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowVisualSheetMapper((v) => !v)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                            showVisualSheetMapper
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-indigo-300'
                              : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>
                            {showVisualSheetMapper ? 'Ocultar Mapeador' : 'Mapeador Visual'}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* ALTERNATIVA 1: MAPEADOR VISUAL INTERACTIVO SOBRE TU PLANILLA REAL        */}
              {/* ========================================================================= */}
              {showVisualSheetMapper && raw2DGrid.length > 0 && (
                <ImportVisualMapperPanel
                  isDarkMode={isDarkMode}
                  raw2DGrid={raw2DGrid}
                  selectedHeaderRowIndex={selectedHeaderRowIndex}
                  availableColumns={availableColumns}
                  selectedNameColumn={selectedNameColumn}
                  selectedSecondaryNameColumn={selectedSecondaryNameColumn}
                  selectedEmailColumn={selectedEmailColumn}
                  detectedColumns={detectedColumns}
                  onSelectCustomHeaderRowIndex={handleSelectCustomHeaderRowIndex}
                  onVisualColumnRoleChange={handleVisualColumnRoleChange}
                />
              )}

              <ImportColumnMappingPanel
                isDarkMode={isDarkMode}
                importContext={importContext}
                attendanceTargetMode={attendanceTargetMode}
                students={students}
                activeCategories={activeCategories}
                activeGradesMap={activeGradesMap}
                detectedColumns={detectedColumns}
                includedColumnsCount={includedColumns.length}
                newStudentsCount={summaryMetrics.newStudentsCount}
                includeNewStudentsFromDoc={includeNewStudentsFromDoc}
                onToggleIncludeNewStudents={(checked) => {
                  setIncludeNewStudentsFromDoc(checked);
                  setVerifiedRows((prev) =>
                    prev.map((r) => (r.isNewStudent ? { ...r, isIncluded: checked } : r))
                  );
                }}
                onSetPreferredTargetColumn={setPreferredTargetColumn}
                onUpdateColumnConfig={handleUpdateColumnConfig}
              />

              <ImportStudentVerificationPanel
                isDarkMode={isDarkMode}
                importContext={importContext}
                students={students}
                availableColumns={availableColumns}
                selectedNameColumn={selectedNameColumn}
                detectedColumns={detectedColumns}
                includedColumns={includedColumns}
                verifiedRows={verifiedRows}
                displayedRows={displayedRows}
                includeNewStudentsFromDoc={includeNewStudentsFromDoc}
                includedRowsCount={summaryMetrics.includedRowsCount}
                filterMode={filterMode}
                onChangeFilterMode={setFilterMode}
                searchFilter={searchFilter}
                onChangeSearchFilter={setSearchFilter}
                inspectionMode={inspectionMode}
                selectedStudentIndex={selectedStudentIndex}
                onChangeSelectedStudentIndex={setSelectedStudentIndex}
                currentInspectedRow={currentInspectedRow}
                documentRowOptions={documentRowOptions}
                onVisualColumnRoleChange={handleVisualColumnRoleChange}
                onToggleAllRows={(checked) =>
                  setVerifiedRows((prev) => prev.map((r) => ({ ...r, isIncluded: checked })))
                }
                onToggleRowIncluded={(rowId) =>
                  setVerifiedRows((prev) =>
                    prev.map((r) =>
                      r.rowId === rowId ? { ...r, isIncluded: !r.isIncluded } : r
                    )
                  )
                }
                onSelectDocumentRowForStudent={handleSelectDocumentRowForStudent}
                onReassignRowStudent={handleReassignRowStudent}
                onCellEdit={handleCellEdit}
              />
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
