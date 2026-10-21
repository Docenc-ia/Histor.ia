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

export type DetectedColumnKind = 'grade' | 'absences' | 'lates' | 'disposition' | 'ignore';

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
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedNameColumn, setSelectedNameColumn] = useState<string>('');
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

  // Paste state
  const [pasteText, setPasteText] = useState<string>('');

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

  const normalizeText = (text: string): string => {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
  };

  /**
   * Fuzzy match between raw student name/email in Excel/Sheets and course roster
   */
  const findBestStudentMatch = (
    rawName: string,
    rawEmail?: string
  ): { student: Student | null; score: number } => {
    const emailClean = rawEmail ? String(rawEmail).trim().toLowerCase() : '';
    if (emailClean) {
      const exactEmail = students.find(
        (s) => s.email && s.email.trim().toLowerCase() === emailClean
      );
      if (exactEmail) return { student: exactEmail, score: 1.0 };
    }

    const rawClean = normalizeText(rawName);
    if (!rawClean) return { student: null, score: 0 };

    let bestMatch: Student | null = null;
    let highestScore = 0;

    for (const student of students) {
      const lastClean = normalizeText(student.lastName);
      const firstClean = normalizeText(student.firstName);
      const fullLastFirst = `${lastClean} ${firstClean}`;
      const fullFirstLast = `${firstClean} ${lastClean}`;
      const stEmailClean = student.email ? normalizeText(student.email) : '';

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
  };

  /**
   * Auto-detects what each column in the uploaded Excel or Google Sheet represents:
   * - Student Name / Email
   * - Attendance / Disposition (Ausencias, Tardanzas, Disposición)
   * - Grade / Category columns (e.g. "Trabajos Prácticos - TP 1", "Parcial 1", "Exámenes", etc.)
   */
  const autoDetectColumnsConfiguration = (
    cols: string[],
    nameCol: string,
    emailCol: string,
    cats: GradeCategory[]
  ): DetectedColumnConfig[] => {
    const configs: DetectedColumnConfig[] = [];
    const defaultCat = cats[0] || { id: 'cat-default', name: 'Evaluaciones', weight: 100, subcategories: [] };

    cols.forEach((col) => {
      if (col === nameCol || col === emailCol) return;

      const clean = col.trim();
      const lower = normalizeText(clean);

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
      // Check if header has "Categoría - Evaluación" or "Categoría: Evaluación" format
      let parsedCatName = '';
      let parsedSubName = clean;
      if (clean.includes(' - ')) {
        const parts = clean.split(' - ').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          parsedCatName = parts[0];
          parsedSubName = parts.slice(1).join(' - ');
        }
      } else if (clean.includes(': ')) {
        const parts = clean.split(': ').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          parsedCatName = parts[0];
          parsedSubName = parts.slice(1).join(': ');
        }
      }

      // Try to match an existing category
      let matchedCategory: GradeCategory | undefined;
      if (parsedCatName) {
        const normCat = normalizeText(parsedCatName);
        matchedCategory = cats.find(
          (c) =>
            normalizeText(c.name) === normCat ||
            normalizeText(c.name).includes(normCat) ||
            normCat.includes(normalizeText(c.name))
        );
      }

      if (!matchedCategory) {
        // Infer from keywords in column header
        if (/^tp\b|trabajo practico|guia|entrega|actividad|tarea/i.test(lower)) {
          matchedCategory = cats.find((c) => /trabajo|practico|tp|actividad/i.test(normalizeText(c.name)));
        } else if (/examen|parcial|evaluacion|prueba|recuperatorio|integrador|diagnostica/i.test(lower)) {
          matchedCategory = cats.find((c) => /evaluacion|examen|parcial|prueba/i.test(normalizeText(c.name)));
        } else if (/concepto|participacion|desempeno|carpeta/i.test(lower)) {
          matchedCategory = cats.find((c) => /concepto|desempeno|participacion/i.test(normalizeText(c.name)));
        }
      }

      // Also check if any existing subcategory across any category matches `parsedSubName`
      let matchedSubId = '';
      for (const c of cats) {
        const foundSub = c.subcategories.find(
          (s) => normalizeText(s.name) === normalizeText(parsedSubName)
        );
        if (foundSub) {
          matchedCategory = c;
          matchedSubId = foundSub.id;
          break;
        }
      }

      if (matchedCategory) {
        // Check if subcategory exists inside matchedCategory
        if (!matchedSubId) {
          const subInCat = matchedCategory.subcategories.find(
            (s) => normalizeText(s.name) === normalizeText(parsedSubName)
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
        // Propose creating the new category detected in the header!
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
        // Default to first category and create new evaluation column
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
  };

  /**
   * Builds the multi-column verification table for all students in the course + any new students in the file
   */
  const buildMultiVerificationRows = (
    rawRows: Array<Record<string, any>>,
    nameCol: string,
    emailCol: string,
    colConfigs: DetectedColumnConfig[]
  ) => {
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
      // Skip total/average footer rows
      if (/^promedio|^total|^media|^resumen/i.test(rawNameVal)) return;

      const { student, score } = findBestStudentMatch(rawNameVal, rawEmailVal);
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
        // Strip trailing 'F' or 'T' if exported like '3F'
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

    // Also include unmatched rows from the Excel/Sheet so the teacher can either match them or create them as new students!
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
        isIncluded: students.length === 0, // Auto-check new students if course has 0 students!
        valuesByCol,
      });
    });

    if (students.length === 0 && unmatchedRawRows.length > 0) {
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
    autoAdvanceToVerify = true
  ) => {
    setRawTableRows(rows);
    setAvailableColumns(cols);
    setFileName(sourceTitle);

    const nameCol =
      cols.find((c) => /alumno|nombre|estudiante|apellido|nom|ape|persona/i.test(c)) || cols[0] || '';
    const emailCol =
      cols.find((c) => c !== nameCol && /email|correo|mail/i.test(c)) || '';

    setSelectedNameColumn(nameCol);
    setSelectedEmailColumn(emailCol);

    const detected = autoDetectColumnsConfiguration(cols, nameCol, emailCol, activeCategories);
    setDetectedColumns(detected);
    buildMultiVerificationRows(rows, nameCol, emailCol, detected);

    if (autoAdvanceToVerify) {
      setActiveStep('verify');
      setInspectionMode('table');
    }
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
    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(raw2D);
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

      if (result.rows.length === 0) {
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
   * Handle pasted cells from Excel or Sheets
   */
  const handleParsePaste = () => {
    if (!pasteText.trim()) return;
    const lines = pasteText
      .split('\n')
      .map((l) => l.replace(/\r/g, ''))
      .filter((l) => l.trim() !== '');
    if (lines.length === 0) return;

    const raw2D = lines.map((line) => line.split(/\t|,|;/).map((cell) => cell.trim()));
    // If first row doesn't look like headers, synthesize headers
    const firstRowJoined = raw2D[0].join(' ').toLowerCase();
    const hasHeader = /alumno|nombre|apellido|estudiante|nota|tp|eval|examen|falta|ausencia|disposicion/i.test(
      firstRowJoined
    );
    const final2D = hasHeader
      ? raw2D
      : [
          ['Apellido y Nombre', ...raw2D[0].slice(1).map((_, idx) => `Nota ${idx + 1}`)],
          ...raw2D,
        ];

    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(final2D);
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
    buildMultiVerificationRows(rawTableRows, selectedNameColumn, selectedEmailColumn, nextCols);
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
        if (cleanStr !== '') {
          const num = parseFloat(cleanStr);
          if (colCfg.kind === 'grade' || colCfg.kind === 'disposition') {
            isValid = !isNaN(num) && num >= 0 && num <= 10;
          } else {
            isValid = !isNaN(num) && num >= 0;
          }
        }

        let status: 'new' | 'update' | 'same' | 'empty' | 'invalid' = 'new';
        if (cleanStr === '') status = 'empty';
        else if (!isValid) status = 'invalid';
        else if (!prevCell.currentVal) status = 'new';
        else if (prevCell.currentVal === cleanStr) status = 'same';
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
      (c) => c.kind === 'absences' || c.kind === 'lates' || c.kind === 'disposition'
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

        if (colCfg.kind === 'grade') {
          const targetInfo = colKeyToSubcategoryId[colCfg.colKey];
          if (targetInfo) {
            workingGradesMap[row.studentId][targetInfo.subcategoryId] = cell.editedVal;
          }
        } else if (colCfg.kind === 'absences') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].absences = Math.max(0, Math.round(Number(cell.editedVal)));
        } else if (colCfg.kind === 'lates') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].lates = Math.max(0, Math.round(Number(cell.editedVal)));
        } else if (colCfg.kind === 'disposition') {
          if (!attendanceUpdates[row.studentId]) attendanceUpdates[row.studentId] = {};
          attendanceUpdates[row.studentId].disposition = Math.min(10, Math.max(1, Number(cell.editedVal)));
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
                  'Paso 1: Seleccioná tu documento de Excel o Google Sheets para que la app detecte las notas, categorías y asistencia'}
                {activeStep === 'verify' &&
                  'Paso 2: Interfaz de comprobación previa — Revisá y confirmá que las categorías, columnas y datos estén bien antes de guardar'}
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
                  <span>Pegar Celdas Copiadas (Ctrl+V)</span>
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
                    Si ya tenés una planilla armada en Excel, subila directamente: la aplicación detectará las columnas de alumnos, las categorías, las notas y/o las faltas y abrirá una pantalla de comprobación previa antes de guardar.
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
                    Pegá el enlace de cualquier hoja de cálculo de Google Sheets que ya tengas hecha para detectar automáticamente sus categorías, evaluaciones, notas o asistencia:
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
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>{isLoadingRemoteSheet ? 'Analizando Hoja...' : 'Detectar y Comprobar Datos'}</span>
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
                            Importar
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* MODO 3: PEGAR CELDAS COPIADAS */}
            {sourceType === 'paste' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                    Copiá las celdas desde tu tabla de Excel o Google Sheets (incluyendo los encabezados de categorías/notas) y pegalas aquí (Ctrl+V):
                  </label>
                  <textarea
                    rows={8}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`Ejemplo con encabezados:\nApellido y Nombre\tTP 1\tTP 2\tEvaluación Escrita\nGarcía, Juan\t8\t9\t8.5\nPérez, María\t9\t10\t9`}
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
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <span>Detectar Categorías y Comprobar Datos</span>
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
                      Revisá abajo las categorías y columnas detectadas antes de agregarlas a la materia.
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

                  {/* Selector de Columna de Nombre de Alumno */}
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
                          activeCategories
                        );
                        setDetectedColumns(nextDetected);
                        buildMultiVerificationRows(rawTableRows, nextNameCol, selectedEmailColumn, nextDetected);
                      }}
                      className={`px-2.5 py-1 rounded-lg border font-bold outline-hidden ${
                        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                      }`}
                    >
                      {availableColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

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
                                kind: checked && colCfg.kind === 'ignore' ? 'grade' : colCfg.kind,
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
                          <option value="grade">📊 Nota / Calificación</option>
                          <option value="absences">📅 Total Ausencias / Faltas</option>
                          <option value="lates">⏰ Llegadas Tarde / Tardanzas</option>
                          <option value="disposition">⭐ Nota de Disposición (1-10)</option>
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
