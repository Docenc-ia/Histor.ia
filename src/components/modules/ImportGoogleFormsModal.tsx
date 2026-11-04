import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileCheck,
  Upload,
  FileSpreadsheet,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  X,
  Search,
  Check,
  RefreshCw,
  Sparkles,
  ChevronRight,
  SlidersHorizontal,
  Layers,
  Edit3,
  Link2,
} from 'lucide-react';
import type * as XLSXType from 'xlsx';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { GradeHistoryEntry } from '../../utils/excelExport';
import { driveService } from '../../services/workspace/driveService';
import { sheetsService } from '../../services/workspace/sheetsService';
import { formsService, GoogleFormListItem } from '../../services/workspace/formsService';
import {
  normalizeImportText,
  findBestStudentMatchInRoster,
} from '../../utils/gradeImportParser';
import { CATEGORY_COLORS, getScoreColorClass } from '../../utils/gradeCalculations';
import type { MultiImportApplyPayload } from './ImportGradesModal';

export interface ImportGoogleFormsModalProps {
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
  onApplyMultiImport: (payload: MultiImportApplyPayload) => void;
}

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

/**
 * Parses a Google Forms score cell such as:
 * - "8 / 10", "8,50 / 10", "8.00 / 10"
 * - "75 / 100", "14 / 20"
 * - "85%"
 * - "8,5" or "9"
 */
export function parseGoogleFormsScoreCell(rawCell: any): {
  rawText: string;
  earned: number | null;
  max: number | null;
} {
  const rawText = String(rawCell ?? '').trim();
  if (!rawText || rawText === '-') {
    return { rawText: '', earned: null, max: null };
  }

  // Pattern 1: "X / Y" or "X de Y" (standard Google Forms Puntuación / Score format)
  const fractionMatch = rawText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:\/|de|sobre)\s*(\d+(?:[.,]\d+)?)/i
  );
  if (fractionMatch) {
    const earned = parseFloat(fractionMatch[1].replace(',', '.'));
    const max = parseFloat(fractionMatch[2].replace(',', '.'));
    if (!isNaN(earned) && !isNaN(max) && max > 0) {
      return { rawText, earned, max };
    }
  }

  // Pattern 2: Percentage "85%"
  const percentMatch = rawText.match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (percentMatch) {
    const pct = parseFloat(percentMatch[1].replace(',', '.'));
    if (!isNaN(pct)) {
      return { rawText, earned: pct, max: 100 };
    }
  }

  // Pattern 3: Single numeric score "8.5" or "8,5" or "80"
  const singleMatch = rawText.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (singleMatch) {
    const earned = parseFloat(singleMatch[0]);
    if (!isNaN(earned)) {
      return { rawText, earned, max: null };
    }
  }

  return { rawText, earned: null, max: null };
}

/**
 * Formats and scales the extracted score into the Final Grade (Nota Final)
 */
export function formatConvertedFormsGrade(
  earned: number | null,
  max: number | null,
  fallbackMaxPoints: number,
  scaleMode: FormsScaleMode,
  roundingMode: FormsRoundingMode
): string {
  if (earned === null || isNaN(earned)) return '';

  let numericGrade = earned;
  const effectiveMax = max && max > 0 ? max : fallbackMaxPoints;

  if (scaleMode === 'scale_10') {
    if (effectiveMax > 0 && effectiveMax !== 10) {
      numericGrade = (earned / effectiveMax) * 10;
    } else if (!max && earned > 10 && earned <= 100) {
      numericGrade = (earned / 100) * 10;
    }
  }

  if (roundingMode === 'integer') {
    return String(Math.round(numericGrade));
  }
  if (roundingMode === 'half_point') {
    const half = Math.round(numericGrade * 2) / 2;
    return String(Number(half.toFixed(1)));
  }
  if (roundingMode === 'one_decimal') {
    return String(Number(numericGrade.toFixed(1)));
  }
  return String(Number(numericGrade.toFixed(2)));
}

/**
 * Automatically detects the Student Name column, optional Secondary Name column, Email column,
 * and Score (Puntuación / Nota Final) column from a Google Forms evaluation.
 */
export function autoDetectGoogleFormsColumns(
  headers: string[],
  rows: Array<Record<string, any>>,
  students: Student[]
): {
  nameCol: string;
  secondaryNameCol: string;
  emailCol: string;
  scoreCol: string;
  timestampCol: string;
  detectedMaxScore: number;
} {
  const timestampCol =
    headers.find((h) => /marca temporal|timestamp|fecha|enviado/i.test(normalizeImportText(h))) || '';

  // 1. Detect Score / Puntuación / Nota Final column
  let scoreCol =
    headers.find((h) =>
      /^puntuacion$|^score$|^puntaje$|^calificacion$|^nota$|^nota final$|^puntos$|^total points$|^puntaje total$/i.test(
        normalizeImportText(h)
      )
    ) ||
    headers.find((h) =>
      /puntuacion|score|puntaje|calificacion|nota final|nota/i.test(normalizeImportText(h))
    ) ||
    '';

  if (!scoreCol) {
    for (const h of headers) {
      if (h === timestampCol) continue;
      const sampleVals = rows
        .slice(0, 12)
        .map((r) => String(r[h] ?? '').trim())
        .filter(Boolean);
      const fractionCount = sampleVals.filter((v) =>
        /^\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?$/.test(v)
      ).length;
      if (fractionCount > 0 && fractionCount >= Math.ceil(sampleVals.length * 0.4)) {
        scoreCol = h;
        break;
      }
    }
  }

  // 2. Detect Email column
  const emailCol =
    headers.find(
      (h) =>
        h !== scoreCol &&
        h !== timestampCol &&
        /correo|email|mail|direccion de correo/i.test(normalizeImportText(h))
    ) || '';

  // 3. Detect Student Name column(s)
  const exactLastCol = headers.find(
    (h) =>
      h !== scoreCol &&
      h !== timestampCol &&
      h !== emailCol &&
      /^apellido(s)?$/i.test(normalizeImportText(h))
  );
  const exactFirstCol = headers.find(
    (h) =>
      h !== scoreCol &&
      h !== timestampCol &&
      h !== emailCol &&
      h !== exactLastCol &&
      /^nombre(s)?$/i.test(normalizeImportText(h))
  );

  let nameCol = '';
  let secondaryNameCol = '';

  if (exactLastCol && exactFirstCol) {
    nameCol = exactLastCol;
    secondaryNameCol = exactFirstCol;
  } else {
    let bestRosterMatchCol = '';
    let bestRosterMatchCount = 0;

    const candidateCols = headers.filter(
      (h) => h !== scoreCol && h !== timestampCol && h !== emailCol
    );

    if (students.length > 0 && rows.length > 0) {
      for (const col of candidateCols) {
        let matches = 0;
        for (const r of rows.slice(0, 40)) {
          const val = String(r[col] ?? '').trim();
          if (!val || val.length < 3) continue;
          const { student, score } = findBestStudentMatchInRoster(students, val);
          if (student && score >= 0.6) {
            matches++;
          }
        }
        if (matches > bestRosterMatchCount) {
          bestRosterMatchCount = matches;
          bestRosterMatchCol = col;
        }
      }
    }

    if (bestRosterMatchCol && bestRosterMatchCount > 0) {
      nameCol = bestRosterMatchCol;
    } else {
      nameCol =
        candidateCols.find((h) =>
          /apellido y nombre|nombre y apellido|nombre completo|alumno|estudiante|selecciona tu nombre|tu nombre|nombre|apellido/i.test(
            normalizeImportText(h)
          )
        ) ||
        candidateCols[0] ||
        '';
    }
  }

  if (!scoreCol) {
    const remaining = headers.filter(
      (h) => h !== timestampCol && h !== emailCol && h !== nameCol && h !== secondaryNameCol
    );
    for (const col of remaining) {
      const sampleVals = rows
        .slice(0, 10)
        .map((r) => String(r[col] ?? '').trim())
        .filter(Boolean);
      const numericCount = sampleVals.filter(
        (v) => parseGoogleFormsScoreCell(v).earned !== null
      ).length;
      if (numericCount > 0 && numericCount >= Math.ceil(sampleVals.length * 0.5)) {
        scoreCol = col;
        break;
      }
    }
    if (!scoreCol && remaining.length > 0) {
      scoreCol = remaining[0];
    }
  }

  let detectedMaxScore = 10;
  if (scoreCol) {
    for (const r of rows) {
      const parsed = parseGoogleFormsScoreCell(r[scoreCol]);
      if (parsed.max && parsed.max > 0) {
        detectedMaxScore = parsed.max;
        break;
      }
      if (parsed.earned !== null && parsed.earned > 10) {
        detectedMaxScore = 100;
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

export const ImportGoogleFormsModal: React.FC<ImportGoogleFormsModalProps> = ({
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
  onApplyMultiImport,
}) => {
  const [step, setStep] = useState<'source' | 'review'>('source');
  // 'forms_direct' = Cargar el Google Forms en sí (o Hoja de Google Drive)
  // 'file' = Subir archivo (.csv / .xlsx)
  // 'paste' = Pegar nombres y notas
  const [sourceTab, setSourceTab] = useState<'forms_direct' | 'file' | 'paste'>('forms_direct');

  // Academic period & Target Column selection ("bajo qué columna va")
  const [selectedTerm, setSelectedTerm] = useState<'1c' | '2c'>(initialTerm);
  const activeCategories = selectedTerm === '1c' ? categories1c : categories2c;
  const activeGradesMap = selectedTerm === '1c' ? gradesMap1c : gradesMap2c;

  const [targetCategoryMode, setTargetCategoryMode] = useState<'existing' | 'new'>('existing');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState<string>('Evaluaciones');

  const [targetColumnMode, setTargetColumnMode] = useState<'existing_sub' | 'new_sub'>('new_sub');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>('');
  const [newSubcategoryName, setNewSubcategoryName] = useState<string>('Evaluación Forms');

  // Loaded data state
  const [sourceTitle, setSourceTitle] = useState<string>('');
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, any>>>([]);

  // Detected column mappings
  const [nameCol, setNameCol] = useState<string>('');
  const [secondaryNameCol, setSecondaryNameCol] = useState<string>('');
  const [emailCol, setEmailCol] = useState<string>('');
  const [scoreCol, setScoreCol] = useState<string>('');
  const [timestampCol, setTimestampCol] = useState<string>('');

  // Score scale & conversion settings
  const [scaleMode, setScaleMode] = useState<FormsScaleMode>('scale_10');
  const [customMaxScore, setCustomMaxScore] = useState<number>(10);
  const [roundingMode, setRoundingMode] = useState<FormsRoundingMode>('two_decimals');
  const [showColumnMappingConfig, setShowColumnMappingConfig] = useState<boolean>(false);

  // Parsed Form submissions & Review Rows per student in the class
  const [parsedSubmissions, setParsedSubmissions] = useState<ParsedFormSubmission[]>([]);
  const [reviewRows, setReviewRows] = useState<StudentFormsReviewRow[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterView, setFilterView] = useState<'all' | 'matched' | 'unmatched'>('all');

  // Direct Google Forms / Sheets link & Drive picker state
  const [formOrSheetUrlInput, setFormOrSheetUrlInput] = useState<string>('');
  const [isLoadingRemote, setIsLoadingRemote] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [driveItems, setDriveItems] = useState<
    Array<{ id: string; name: string; kind: 'form' | 'sheet'; modifiedTime?: string; url: string }>
  >([]);
  const [isLoadingDriveList, setIsLoadingDriveList] = useState<boolean>(false);
  const [driveSearch, setDriveSearch] = useState<string>('');

  // Paste state
  const [pasteText, setPasteText] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedTerm(initialTerm);
    setStep('source');
    setRemoteError(null);
  }, [isOpen, initialTerm]);

  useEffect(() => {
    const cats = selectedTerm === '1c' ? categories1c : categories2c;
    if (cats.length > 0) {
      setTargetCategoryMode('existing');
      const evalCat =
        cats.find((c) => /evaluacion|examen|prueba|forms/i.test(normalizeImportText(c.name))) ||
        cats[0];
      setSelectedCategoryId(evalCat.id);
      if (evalCat.subcategories.length > 0) {
        setSelectedSubcategoryId(evalCat.subcategories[0].id);
        setTargetColumnMode('existing_sub');
      } else {
        setSelectedSubcategoryId('');
        setTargetColumnMode('new_sub');
      }
    } else {
      setTargetCategoryMode('new');
      setNewCategoryName('Evaluaciones');
      setTargetColumnMode('new_sub');
    }
  }, [selectedTerm, categories1c, categories2c]);

  const selectedCategoryObj = useMemo(
    () => activeCategories.find((c) => c.id === selectedCategoryId) || activeCategories[0],
    [activeCategories, selectedCategoryId]
  );

  const handleCategorySelectionChange = (catId: string) => {
    if (catId === '__NEW__') {
      setTargetCategoryMode('new');
      setTargetColumnMode('new_sub');
      return;
    }
    setTargetCategoryMode('existing');
    setSelectedCategoryId(catId);
    const catObj = activeCategories.find((c) => c.id === catId);
    if (catObj && catObj.subcategories.length > 0) {
      setSelectedSubcategoryId(catObj.subcategories[0].id);
    } else {
      setSelectedSubcategoryId('');
      setTargetColumnMode('new_sub');
    }
  };

  /**
   * Loads both native Google Forms and response Google Sheets from the teacher's Drive
   */
  const loadDriveFormsAndSheets = async (query?: string) => {
    setIsLoadingDriveList(true);
    setRemoteError(null);
    try {
      const [formsList, sheetsList] = await Promise.all([
        formsService.listUserGoogleForms(query),
        driveService.listUserSpreadsheets(query),
      ]);

      const merged: Array<{
        id: string;
        name: string;
        kind: 'form' | 'sheet';
        modifiedTime?: string;
        url: string;
      }> = [
        ...formsList.map((f: GoogleFormListItem) => ({
          id: f.id,
          name: f.name,
          kind: 'form' as const,
          modifiedTime: f.modifiedTime,
          url: f.url,
        })),
        ...sheetsList.map((s) => ({
          id: s.id,
          name: s.name,
          kind: 'sheet' as const,
          modifiedTime: s.modifiedTime,
          url: s.url,
        })),
      ];

      // Prioritize native Google Forms and files with "respuesta" / "form" / "evaluación"
      merged.sort((a, b) => {
        if (a.kind === 'form' && b.kind !== 'form') return -1;
        if (a.kind !== 'form' && b.kind === 'form') return 1;
        const aIsForm = /respuesta|form|evaluacion|cuestionario/i.test(a.name) ? 0 : 1;
        const bIsForm = /respuesta|form|evaluacion|cuestionario/i.test(b.name) ? 0 : 1;
        return aIsForm - bIsForm;
      });

      setDriveItems(merged);
    } catch (err) {
      console.warn('Error listando formularios de Google:', err);
    } finally {
      setIsLoadingDriveList(false);
    }
  };

  useEffect(() => {
    if (isOpen && sourceTab === 'forms_direct' && driveItems.length === 0) {
      loadDriveFormsAndSheets();
    }
  }, [isOpen, sourceTab]);

  /**
   * Matches each Form submission against the course's student roster and calculates the Final Grade (Nota Final)
   */
  const recomputeFormsMatching = (
    rowsToProcess: Array<Record<string, any>>,
    cName: string,
    cSecName: string,
    cEmail: string,
    cScore: string,
    cTimestamp: string,
    sMode: FormsScaleMode,
    maxPts: number,
    rMode: FormsRoundingMode,
    targetSubIdForExisting: string,
    colMode: 'existing_sub' | 'new_sub'
  ) => {
    const submissions: ParsedFormSubmission[] = [];
    rowsToProcess.forEach((row, idx) => {
      const primaryName = cName ? String(row[cName] ?? '').trim() : '';
      const secName = cSecName ? String(row[cSecName] ?? '').trim() : '';
      const fullName =
        primaryName && secName ? `${primaryName}, ${secName}` : primaryName || secName;
      const emailVal = cEmail ? String(row[cEmail] ?? '').trim() : '';
      const tsVal = cTimestamp ? String(row[cTimestamp] ?? '').trim() : '';
      const rawScoreCell = cScore ? row[cScore] : '';

      if (!fullName && !emailVal && !String(rawScoreCell ?? '').trim()) return;
      if (/^promedio|^total|^media|^puntuacion$/i.test(fullName)) return;

      const parsedScore = parseGoogleFormsScoreCell(rawScoreCell);
      submissions.push({
        rowIndex: idx,
        rawRow: row,
        rawName: fullName,
        rawEmail: emailVal,
        rawTimestamp: tsVal,
        rawScoreText: parsedScore.rawText,
        earnedPoints: parsedScore.earned,
        maxPoints: parsedScore.max,
      });
    });

    setParsedSubmissions(submissions);

    const matchedByStudentId: Record<
      string,
      { subIdx: number; confidence: number; count: number }
    > = {};

    submissions.forEach((sub, subIdx) => {
      const { student, score } = findBestStudentMatchInRoster(
        students,
        sub.rawName,
        sub.rawEmail
      );
      if (student && score >= 0.5) {
        const existing = matchedByStudentId[student.id];
        if (!existing) {
          matchedByStudentId[student.id] = {
            subIdx,
            confidence: score,
            count: 1,
          };
        } else {
          matchedByStudentId[student.id] = {
            subIdx: score >= existing.confidence ? subIdx : existing.subIdx,
            confidence: Math.max(score, existing.confidence),
            count: existing.count + 1,
          };
        }
      }
    });

    const existingColKey =
      colMode === 'existing_sub' && targetSubIdForExisting
        ? targetSubIdForExisting
        : '';

    const nextReviewRows: StudentFormsReviewRow[] = students.map((st) => {
      const matchInfo = matchedByStudentId[st.id];
      const sub = matchInfo !== undefined ? submissions[matchInfo.subIdx] : null;

      const computedGrade = sub
        ? formatConvertedFormsGrade(
            sub.earnedPoints,
            sub.maxPoints,
            maxPts,
            sMode,
            rMode
          )
        : '';

      const currentGrade = existingColKey
        ? String(activeGradesMap[st.id]?.[existingColKey] ?? '')
        : '';

      return {
        student: st,
        matchedSubmissionIndex: matchInfo !== undefined ? matchInfo.subIdx : null,
        matchConfidence: matchInfo ? matchInfo.confidence : 0,
        duplicateSubmissionsCount: matchInfo ? matchInfo.count : 0,
        rawScoreText: sub ? sub.rawScoreText : '',
        computedScore: computedGrade,
        editedScore: computedGrade,
        currentGradeInCol: currentGrade,
        isIncluded: Boolean(sub && computedGrade !== ''),
        isManuallyEdited: false,
      };
    });

    setReviewRows(nextReviewRows);
  };

  /**
   * Process newly loaded table headers & rows from any source (Direct Google Forms API, Sheet, CSV/XLSX, Paste)
   */
  const handleLoadedFormsTable = (
    headers: string[],
    rows: Array<Record<string, any>>,
    title: string,
    explicitMaxScore?: number
  ) => {
    setAvailableHeaders(headers);
    setRawRows(rows);
    setSourceTitle(title);

    const cleanEvalTitle = title
      .replace(/\.(csv|xlsx|xls)$/i, '')
      .replace(/\(respuestas.*?\)/gi, '')
      .replace(/respuestas de formulario \d*/gi, '')
      .replace(/google sheet:\s*/gi, '')
      .trim();
    if (cleanEvalTitle) {
      setNewSubcategoryName(cleanEvalTitle.slice(0, 42));
    } else {
      setNewSubcategoryName('Evaluación Forms');
    }

    const detected = autoDetectGoogleFormsColumns(headers, rows, students);
    const effectiveMax = explicitMaxScore && explicitMaxScore > 0 ? explicitMaxScore : detected.detectedMaxScore;

    setNameCol(detected.nameCol);
    setSecondaryNameCol(detected.secondaryNameCol);
    setEmailCol(detected.emailCol);
    setScoreCol(detected.scoreCol);
    setTimestampCol(detected.timestampCol);
    setCustomMaxScore(effectiveMax);

    const defaultScale: FormsScaleMode = 'scale_10';
    setScaleMode(defaultScale);

    const cats = selectedTerm === '1c' ? categories1c : categories2c;
    const currentCat = cats.find((c) => c.id === selectedCategoryId) || cats[0];
    let initialColMode: 'existing_sub' | 'new_sub' =
      currentCat && currentCat.subcategories.length > 0 ? 'existing_sub' : 'new_sub';
    let initialSubId =
      currentCat && currentCat.subcategories.length > 0
        ? currentCat.subcategories[0].id
        : '';

    if (currentCat && cleanEvalTitle) {
      const matchingSub = currentCat.subcategories.find(
        (s) => normalizeImportText(s.name) === normalizeImportText(cleanEvalTitle)
      );
      if (matchingSub) {
        initialColMode = 'existing_sub';
        initialSubId = matchingSub.id;
      }
    }
    setTargetColumnMode(initialColMode);
    setSelectedSubcategoryId(initialSubId);

    recomputeFormsMatching(
      rows,
      detected.nameCol,
      detected.secondaryNameCol,
      detected.emailCol,
      detected.scoreCol,
      detected.timestampCol,
      defaultScale,
      effectiveMax,
      roundingMode,
      initialSubId,
      initialColMode
    );

    setStep('review');
  };

  const handleMappingOrScaleChange = (patch: {
    nextNameCol?: string;
    nextSecNameCol?: string;
    nextEmailCol?: string;
    nextScoreCol?: string;
    nextScaleMode?: FormsScaleMode;
    nextMaxScore?: number;
    nextRoundingMode?: FormsRoundingMode;
    nextSubId?: string;
    nextColMode?: 'existing_sub' | 'new_sub';
  }) => {
    const cName = patch.nextNameCol !== undefined ? patch.nextNameCol : nameCol;
    const cSec = patch.nextSecNameCol !== undefined ? patch.nextSecNameCol : secondaryNameCol;
    const cEmail = patch.nextEmailCol !== undefined ? patch.nextEmailCol : emailCol;
    const cScore = patch.nextScoreCol !== undefined ? patch.nextScoreCol : scoreCol;
    const sMode = patch.nextScaleMode !== undefined ? patch.nextScaleMode : scaleMode;
    const mScore = patch.nextMaxScore !== undefined ? patch.nextMaxScore : customMaxScore;
    const rMode = patch.nextRoundingMode !== undefined ? patch.nextRoundingMode : roundingMode;
    const subId = patch.nextSubId !== undefined ? patch.nextSubId : selectedSubcategoryId;
    const cMode = patch.nextColMode !== undefined ? patch.nextColMode : targetColumnMode;

    setNameCol(cName);
    setSecondaryNameCol(cSec);
    setEmailCol(cEmail);
    setScoreCol(cScore);
    setScaleMode(sMode);
    setCustomMaxScore(mScore);
    setRoundingMode(rMode);
    setSelectedSubcategoryId(subId);
    setTargetColumnMode(cMode);

    recomputeFormsMatching(
      rawRows,
      cName,
      cSec,
      cEmail,
      cScore,
      timestampCol,
      sMode,
      mScore,
      rMode,
      subId,
      cMode
    );
  };

  /**
   * Loads either a direct Google Form (via Google Forms API v1) or a Google Sheet response spreadsheet
   */
  const handleLoadRemoteFormOrSheet = async (
    idOrUrl: string,
    forcedKind?: 'form' | 'sheet'
  ) => {
    const cleanInput = idOrUrl.trim();
    if (!cleanInput) return;

    setIsLoadingRemote(true);
    setRemoteError(null);

    const isSheetUrl =
      forcedKind === 'sheet' || /\/spreadsheets\/d\//i.test(cleanInput);
    const isFormUrl =
      forcedKind === 'form' || /\/forms\/(?:u\/\d+\/)?d\//i.test(cleanInput);

    try {
      if (isSheetUrl && !isFormUrl) {
        const result = await sheetsService.fetchArbitrarySpreadsheetData(cleanInput);
        if (result.rows.length === 0 || result.headers.length === 0) {
          setRemoteError(`La hoja "${result.selectedSheet}" no contiene calificaciones.`);
          return;
        }
        handleLoadedFormsTable(result.headers, result.rows, result.title);
        return;
      }

      // Default: Load the Google Form directly via Google Forms API v1
      try {
        const formResult = await formsService.fetchGoogleFormEvaluations(cleanInput);
        handleLoadedFormsTable(
          formResult.headers,
          formResult.rows,
          formResult.title,
          formResult.maxScore
        );
        return;
      } catch (formErr: any) {
        // If user pasted a raw ID that turned out to be a Sheet ID instead of a Form ID, try Sheets as fallback
        if (!isFormUrl) {
          try {
            const sheetRes = await sheetsService.fetchArbitrarySpreadsheetData(cleanInput);
            if (sheetRes.rows.length > 0 && sheetRes.headers.length > 0) {
              handleLoadedFormsTable(sheetRes.headers, sheetRes.rows, sheetRes.title);
              return;
            }
          } catch {
            // Keep original formErr
          }
        }
        throw formErr;
      }
    } catch (err: any) {
      setRemoteError(
        err?.message ||
          'No se pudo cargar el Google Forms. Asegúrate de pegar el enlace de edición del formulario (docs.google.com/forms/d/.../edit).'
      );
    } finally {
      setIsLoadingRemote(false);
    }
  };

  /**
   * File upload handler (.csv or .xlsx exported from Google Forms)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const buffer = evt.target?.result as ArrayBuffer;
        let wb: XLSXType.WorkBook;

        if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.tsv')) {
          const utf8Text = new TextDecoder('utf-8').decode(buffer);
          wb = XLSX.read(utf8Text, { type: 'string', raw: false });
        } else {
          wb = XLSX.read(buffer, { type: 'array', codepage: 65001 });
        }

        const firstSheet = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheet];
        if (!ws) return;

        const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const { headers, rows } = sheetsService.convert2DArrayToTableObjects(raw2D);
        if (headers.length === 0 || rows.length === 0) return;

        handleLoadedFormsTable(headers, rows, file.name);
      } catch (err) {
        console.error('Error al leer el archivo de Google Forms:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  /**
   * Paste handler for copied names & final grades
   */
  const handleParsePastedResponses = () => {
    if (!pasteText.trim()) return;
    const lines = pasteText
      .split('\n')
      .map((l) => l.replace(/\r/g, ''))
      .filter((l) => l.trim() !== '');
    if (lines.length === 0) return;

    const raw2D = lines.map((line) => {
      if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
      if (line.includes(';')) return line.split(';').map((c) => c.trim());
      return line.split(',').map((c) => c.trim());
    });

    const firstRowText = raw2D[0].join(' ').toLowerCase();
    const hasHeader =
      /marca temporal|timestamp|puntuacion|score|puntaje|nota|nombre|apellido|alumno|correo|email/i.test(
        firstRowText
      );

    const final2D = hasHeader
      ? raw2D
      : [
          raw2D[0].map((_, idx) =>
            idx === 0 ? 'Alumno' : idx === 1 ? 'Puntuación' : `Columna ${idx + 1}`
          ),
          ...raw2D,
        ];

    const { headers, rows } = sheetsService.convert2DArrayToTableObjects(final2D, 0);
    if (rows.length === 0) return;

    handleLoadedFormsTable(headers, rows, ' Evaluación Forms');
  };

  const handleAssignSubmissionToStudent = (studentId: string, subIndexStr: string) => {
    const subIdx = subIndexStr === '' ? null : parseInt(subIndexStr, 10);
    const sub = subIdx !== null && !isNaN(subIdx) ? parsedSubmissions[subIdx] : null;

    const computedGrade = sub
      ? formatConvertedFormsGrade(
          sub.earnedPoints,
          sub.maxPoints,
          customMaxScore,
          scaleMode,
          roundingMode
        )
      : '';

    setReviewRows((prev) =>
      prev.map((row) => {
        if (row.student.id !== studentId) return row;
        return {
          ...row,
          matchedSubmissionIndex: sub ? subIdx : null,
          matchConfidence: sub ? 1.0 : 0,
          rawScoreText: sub ? sub.rawScoreText : '',
          computedScore: computedGrade,
          editedScore: computedGrade,
          isIncluded: Boolean(sub && computedGrade !== ''),
          isManuallyEdited: false,
        };
      })
    );
  };

  const handleEditStudentScore = (studentId: string, newScore: string) => {
    const clean = newScore.replace(',', '.');
    setReviewRows((prev) =>
      prev.map((row) => {
        if (row.student.id !== studentId) return row;
        return {
          ...row,
          editedScore: clean,
          isIncluded: clean.trim() !== '',
          isManuallyEdited: true,
        };
      })
    );
  };

  const handleToggleStudentInclude = (studentId: string) => {
    setReviewRows((prev) =>
      prev.map((row) =>
        row.student.id === studentId ? { ...row, isIncluded: !row.isIncluded } : row
      )
    );
  };

  const unmatchedSubmissions = useMemo(() => {
    const usedIndices = new Set<number>();
    reviewRows.forEach((r) => {
      if (r.matchedSubmissionIndex !== null) {
        usedIndices.add(r.matchedSubmissionIndex);
      }
    });
    return parsedSubmissions.filter((_, idx) => !usedIndices.has(idx));
  }, [parsedSubmissions, reviewRows]);

  const filteredReviewRows = useMemo(() => {
    return reviewRows.filter((r) => {
      if (filterView === 'matched' && r.matchedSubmissionIndex === null && !r.isManuallyEdited) {
        return false;
      }
      if (filterView === 'unmatched' && (r.matchedSubmissionIndex !== null || r.isManuallyEdited)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = normalizeImportText(searchQuery);
        const fullStName = normalizeImportText(`${r.student.lastName}, ${r.student.firstName}`);
        if (!fullStName.includes(q)) return false;
      }
      return true;
    });
  }, [reviewRows, filterView, searchQuery]);

  const stats = useMemo(() => {
    const matchedCount = reviewRows.filter((r) => r.matchedSubmissionIndex !== null).length;
    const toApplyRows = reviewRows.filter(
      (r) => r.isIncluded && r.editedScore.trim() !== '' && !isNaN(Number(r.editedScore))
    );
    const numericScores = toApplyRows.map((r) => Number(r.editedScore));
    const avg =
      numericScores.length > 0
        ? (numericScores.reduce((a, b) => a + b, 0) / numericScores.length).toFixed(2)
        : null;

    return {
      totalStudents: students.length,
      totalSubmissions: parsedSubmissions.length,
      matchedCount,
      toApplyCount: toApplyRows.length,
      averageScore: avg,
    };
  }, [reviewRows, students.length, parsedSubmissions.length]);

  const handleAcceptAndApplyGrades = () => {
    const rowsToSave = reviewRows.filter(
      (r) => r.isIncluded && r.editedScore.trim() !== ''
    );
    if (rowsToSave.length === 0) return;

    const workingCategories: GradeCategory[] = activeCategories.map((c) => ({
      ...c,
      subcategories: [...c.subcategories],
    }));

    let targetCat: GradeCategory | undefined;
    if (targetCategoryMode === 'new' && newCategoryName.trim()) {
      const cleanCatName = newCategoryName.trim();
      targetCat = workingCategories.find(
        (c) => normalizeImportText(c.name) === normalizeImportText(cleanCatName)
      );
      if (!targetCat) {
        targetCat = {
          id: `cat-forms-${Date.now()}`,
          name: cleanCatName,
          color: CATEGORY_COLORS[workingCategories.length % CATEGORY_COLORS.length].badge,
          subcategories: [],
        };
        workingCategories.push(targetCat);
      }
    } else {
      targetCat =
        workingCategories.find((c) => c.id === selectedCategoryId) || workingCategories[0];
      if (!targetCat) {
        targetCat = {
          id: `cat-forms-${Date.now()}`,
          name: 'Evaluaciones',
          color: CATEGORY_COLORS[0].badge,
          subcategories: [],
        };
        workingCategories.push(targetCat);
      }
    }

    let finalColId = '';
    let finalColName = '';

    if (targetColumnMode === 'existing_sub' && selectedSubcategoryId) {
      if (selectedSubcategoryId === '__CATEGORY_DIRECT__') {
        finalColId = targetCat.id;
        finalColName = targetCat.name;
      } else {
        const existingSub = targetCat.subcategories.find((s) => s.id === selectedSubcategoryId);
        if (existingSub) {
          finalColId = existingSub.id;
          finalColName = existingSub.name;
        }
      }
    }

    if (!finalColId) {
      const cleanSubName = newSubcategoryName.trim() || 'Evaluación Forms';
      const existingSameName = targetCat.subcategories.find(
        (s) => normalizeImportText(s.name) === normalizeImportText(cleanSubName)
      );
      if (existingSameName) {
        finalColId = existingSameName.id;
        finalColName = existingSameName.name;
      } else {
        finalColId = `sub-forms-${Date.now()}`;
        finalColName = cleanSubName;
        targetCat.subcategories.push({
          id: finalColId,
          name: finalColName,
          maxScore: 10,
        });
      }
    }

    const workingGradesMap: StudentGradesMap = {};
    Object.keys(activeGradesMap).forEach((stId) => {
      workingGradesMap[stId] = { ...(activeGradesMap[stId] || {}) };
    });

    rowsToSave.forEach((row) => {
      const stId = row.student.id;
      if (!workingGradesMap[stId]) {
        workingGradesMap[stId] = {};
      }
      const numVal = parseFloat(row.editedScore.replace(',', '.'));
      workingGradesMap[stId][finalColId] = !isNaN(numVal)
        ? String(Number(numVal.toFixed(2)))
        : row.editedScore.trim();
    });

    const numericVals = rowsToSave
      .map((r) => parseFloat(r.editedScore.replace(',', '.')))
      .filter((n) => !isNaN(n));
    const avg =
      numericVals.length > 0
        ? numericVals.reduce((a, b) => a + b, 0) / numericVals.length
        : undefined;

    const historyEntry: GradeHistoryEntry = {
      id: `gh-forms-${Date.now()}`,
      courseId,
      timestamp: Date.now(),
      date: new Date().toLocaleDateString('es-AR'),
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      term: selectedTerm,
      termLabel: selectedTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
      subcategoryId: finalColId,
      evaluationName: finalColName,
      categoryName: targetCat.name,
      action: sourceTab === 'forms_direct' ? 'import_sheets' : 'import_excel',
      description: `Google Forms: Se cargaron ${rowsToSave.length} notas finales en "${targetCat.name} → ${finalColName}"`,
      updatedStudentsCount: rowsToSave.length,
      averageScore: avg,
      sourceFile: `Google Forms: ${sourceTitle}`,
      changesSummary: rowsToSave.map((r) => ({
        studentId: r.student.id,
        studentName: `${r.student.lastName}, ${r.student.firstName}`,
        studentEmail: r.student.email,
        previousScore: r.currentGradeInCol || undefined,
        newScore: r.editedScore.trim(),
        status: !r.currentGradeInCol
          ? 'new'
          : r.currentGradeInCol === r.editedScore.trim()
          ? 'unchanged'
          : 'updated',
      })),
    };

    onApplyMultiImport({
      term: selectedTerm,
      updatedCategories: workingCategories,
      updatedGradesMap: workingGradesMap,
      historyEntries: [historyEntry],
      attendanceUpdates: {},
      newStudentsToCreate: [],
      sourceLabel: `Google Forms (${sourceTitle})`,
    });

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-slate-100'
            : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-purple-50/60 border-purple-200/80'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-600 text-white shadow-xs">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base leading-tight">
                  Cargar Evaluación de Google Forms
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                  {courseName}
                </span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {students.length} alumnos en lista
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-slate-400 mt-0.5">
                Extrae los nombres de la clase y la nota final desde tu Google Forms, elige bajo qué columna va y acepta.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Bar */}
        <div
          className={`px-5 py-2.5 border-b flex items-center justify-between text-xs shrink-0 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep('source')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                step === 'source'
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60'
              }`}
            >
              <span>1. Seleccionar Google Forms</span>
            </button>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <button
              type="button"
              disabled={rawRows.length === 0}
              onClick={() => rawRows.length > 0 && setStep('review')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all ${
                step === 'review'
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : rawRows.length > 0
                  ? 'text-purple-600 dark:text-purple-400 hover:underline cursor-pointer'
                  : 'text-neutral-400 opacity-50 cursor-not-allowed'
              }`}
            >
              <span>2. Elegir Columna y Confirmar Notas Finales</span>
            </button>
          </div>

          {step === 'review' && (
            <button
              type="button"
              onClick={() => setStep('source')}
              className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
            >
              Cambiar formulario
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {step === 'source' ? (
            <div className="space-y-5">
              {/* Source Method Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSourceTab('forms_direct')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                    sourceTab === 'forms_direct'
                      ? isDarkMode
                        ? 'bg-purple-950/50 border-purple-500 text-white ring-2 ring-purple-500/20'
                        : 'bg-purple-50 border-purple-500 text-purple-950 ring-2 ring-purple-500/20'
                      : isDarkMode
                      ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <FileCheck className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-xs">Google Forms Directo (o Sheet)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Pega el link del Google Forms en sí o elígelo de tu cuenta de Google
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSourceTab('file')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                    sourceTab === 'file'
                      ? isDarkMode
                        ? 'bg-purple-950/50 border-purple-500 text-white ring-2 ring-purple-500/20'
                        : 'bg-purple-50 border-purple-500 text-purple-950 ring-2 ring-purple-500/20'
                      : isDarkMode
                      ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-xs">Subir Archivo (.csv / .xlsx)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Sube el archivo descargado desde Google Forms o Excel
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSourceTab('paste')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                    sourceTab === 'paste'
                      ? isDarkMode
                        ? 'bg-purple-950/50 border-purple-500 text-white ring-2 ring-purple-500/20'
                        : 'bg-purple-50 border-purple-500 text-purple-950 ring-2 ring-purple-500/20'
                      : isDarkMode
                      ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <ClipboardPaste className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-xs">Pegar Nombres y Notas (Ctrl+V)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Copia y pega las columnas de alumnos y nota final
                    </div>
                  </div>
                </button>
              </div>

              {/* TAB 1: Direct Google Forms (URL or Picker) */}
              {sourceTab === 'forms_direct' && (
                <div className="space-y-4">
                  <div
                    className={`p-4 rounded-xl border space-y-3 ${
                      isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-purple-50/40 border-purple-200'
                    }`}
                  >
                    <label className="block text-xs font-bold">
                      Pega el enlace de tu Google Forms (o de su Hoja de cálculo):
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link2 className="w-4 h-4 text-purple-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={formOrSheetUrlInput}
                          onChange={(e) => setFormOrSheetUrlInput(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' &&
                            formOrSheetUrlInput.trim() &&
                            handleLoadRemoteFormOrSheet(formOrSheetUrlInput)
                          }
                          placeholder="https://docs.google.com/forms/d/.../edit"
                          className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-white'
                              : 'bg-white border-neutral-300 text-neutral-900'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={isLoadingRemote || !formOrSheetUrlInput.trim()}
                        onClick={() => handleLoadRemoteFormOrSheet(formOrSheetUrlInput)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shrink-0"
                      >
                        {isLoadingRemote ? 'Extrayendo notas...' : 'Extraer Notas del Forms'}
                      </button>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                      Acepta tanto el link directo del <strong>Google Forms</strong> (<code>docs.google.com/forms/d/.../edit</code>) como el de su hoja de cálculo vinculada.
                    </p>

                    {remoteError && (
                      <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{remoteError}</span>
                      </div>
                    )}
                  </div>

                  {/* List of Forms & Response Sheets from Drive */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">
                        O selecciona un Formulario o Planilla de tu Google Drive:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={driveSearch}
                          onChange={(e) => setDriveSearch(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && loadDriveFormsAndSheets(driveSearch)}
                          placeholder="Buscar evaluación..."
                          className={`px-2.5 py-1 text-xs rounded-lg border ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-white'
                              : 'bg-white border-neutral-300 text-neutral-800'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => loadDriveFormsAndSheets(driveSearch)}
                          className="p-1.5 rounded-lg border border-neutral-300 dark:border-slate-700 hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="Actualizar lista"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDriveList ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    <div
                      className={`max-h-56 overflow-y-auto rounded-xl border divide-y ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-800 divide-slate-800'
                          : 'bg-white border-neutral-200 divide-neutral-100'
                      }`}
                    >
                      {isLoadingDriveList ? (
                        <div className="p-6 text-center text-xs text-neutral-500">
                          Buscando tus formularios de Google Forms...
                        </div>
                      ) : driveItems.length === 0 ? (
                        <div className="p-6 text-center text-xs text-neutral-500">
                          Pega el enlace de tu Google Forms arriba para extraer directamente los alumnos y sus notas finales.
                        </div>
                      ) : (
                        driveItems.map((item) => (
                          <button
                            key={`${item.kind}-${item.id}`}
                            type="button"
                            onClick={() => handleLoadRemoteFormOrSheet(item.id, item.kind)}
                            className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                              isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-purple-50/60'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {item.kind === 'form' ? (
                                <FileCheck className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                              ) : (
                                <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              <span className="font-semibold truncate">{item.name}</span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                                  item.kind === 'form'
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}
                              >
                                {item.kind === 'form' ? 'Google Forms' : 'Google Sheet'}
                              </span>
                            </div>
                            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-bold shrink-0">
                              Extraer notas →
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Upload CSV or XLSX from Google Forms */}
              {sourceTab === 'file' && (
                <div className="space-y-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                      isDarkMode
                        ? 'border-purple-500/40 bg-purple-950/15 hover:bg-purple-950/30 hover:border-purple-400'
                        : 'border-purple-300 bg-purple-50/40 hover:bg-purple-50/80 hover:border-purple-500'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls,.tsv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mx-auto mb-3">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="font-bold text-sm">
                      Seleccionar archivo de Google Forms (.csv o .xlsx)
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-slate-400 mt-1 max-w-lg mx-auto">
                      Extraeremos únicamente los nombres de los alumnos de la clase y su nota final.
                    </p>
                    <button
                      type="button"
                      className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                    >
                      Elegir archivo
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: Paste */}
              {sourceTab === 'paste' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold">
                    Pega aquí las filas con los nombres y puntajes del Forms:
                  </label>
                  <textarea
                    rows={7}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`Puntuación\tApellido y Nombre\n8 / 10\tGarcía, Juan\n9 / 10\tLópez, María`}
                    className={`w-full p-3 rounded-xl border text-xs font-mono focus:outline-none ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-700 text-slate-200'
                        : 'bg-neutral-50 border-neutral-300 text-neutral-800'
                    }`}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!pasteText.trim()}
                      onClick={handleParsePastedResponses}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                    >
                      Detectar Alumnos y Nota Final →
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* STEP 2: CHOOSE TARGET COLUMN & CONFIRM FINAL GRADES */
            <div className="space-y-4">
              {/* SECTION A: Target Column Selection ("Bajo qué columna va") */}
              <div
                className={`p-4 rounded-2xl border-2 space-y-3.5 ${
                  isDarkMode
                    ? 'bg-purple-950/20 border-purple-500/50'
                    : 'bg-purple-50/50 border-purple-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <h4 className="font-bold text-xs sm:text-sm uppercase tracking-wide text-purple-900 dark:text-purple-200">
                      ¿Bajo qué columna de Calificaciones va esta evaluación?
                    </h4>
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400">
                    Formulario: <strong>{sourceTitle}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* 1. Cuatrimestre */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-neutral-600 dark:text-slate-300">
                      Período / Cuatrimestre:
                    </label>
                    <select
                      value={selectedTerm}
                      onChange={(e) => setSelectedTerm(e.target.value as '1c' | '2c')}
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    >
                      <option value="1c">📘 1° Cuatrimestre</option>
                      <option value="2c">📗 2° Cuatrimestre</option>
                    </select>
                  </div>

                  {/* 2. Categoría Mayor */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-neutral-600 dark:text-slate-300">
                      Categoría Mayor:
                    </label>
                    <select
                      value={targetCategoryMode === 'new' ? '__NEW__' : selectedCategoryId}
                      onChange={(e) => handleCategorySelectionChange(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    >
                      {activeCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                      <option value="__NEW__">+ Crear nueva categoría...</option>
                    </select>
                    {targetCategoryMode === 'new' && (
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Nombre de la nueva categoría..."
                        className={`w-full mt-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                    )}
                  </div>

                  {/* 3. Columna / Subcategoría destino */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-neutral-600 dark:text-slate-300">
                      Columna de destino:
                    </label>
                    <select
                      value={
                        targetColumnMode === 'new_sub'
                          ? '__NEW_COL__'
                          : selectedSubcategoryId
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__NEW_COL__') {
                          handleMappingOrScaleChange({
                            nextColMode: 'new_sub',
                          });
                        } else {
                          handleMappingOrScaleChange({
                            nextColMode: 'existing_sub',
                            nextSubId: val,
                          });
                        }
                      }}
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    >
                      {targetCategoryMode === 'existing' &&
                        selectedCategoryObj &&
                        selectedCategoryObj.subcategories.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            📌 Columna existente: {sub.name}
                          </option>
                        ))}
                      {targetCategoryMode === 'existing' &&
                        selectedCategoryObj &&
                        selectedCategoryObj.subcategories.length === 0 && (
                          <option value="__CATEGORY_DIRECT__">
                            📌 Nota General de "{selectedCategoryObj.name}"
                          </option>
                        )}
                      <option value="__NEW_COL__">✨ + Crear nueva columna de evaluación</option>
                    </select>

                    {targetColumnMode === 'new_sub' && (
                      <div className="pt-1">
                        <input
                          type="text"
                          value={newSubcategoryName}
                          onChange={(e) => setNewSubcategoryName(e.target.value)}
                          placeholder="Ej: Evaluación Forms Unidad 1"
                          className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                            isDarkMode
                              ? 'bg-slate-900 border-purple-500/60 text-white'
                              : 'bg-white border-purple-400 text-neutral-900'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION B: Compact Scale & Column Adjustment Bar */}
              <div
                className={`p-3 rounded-xl border space-y-2.5 ${
                  isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <span className="font-bold flex items-center gap-1.5 text-neutral-700 dark:text-slate-200">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-purple-500" />
                      Nota Final:
                    </span>

                    <select
                      value={scaleMode}
                      onChange={(e) =>
                        handleMappingOrScaleChange({
                          nextScaleMode: e.target.value as FormsScaleMode,
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-800'
                      }`}
                    >
                      <option value="scale_10">Escala 1 a 10 automática</option>
                      <option value="raw">Puntaje directo sin escalar</option>
                    </select>

                    <select
                      value={roundingMode}
                      onChange={(e) =>
                        handleMappingOrScaleChange({
                          nextRoundingMode: e.target.value as FormsRoundingMode,
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-800'
                      }`}
                    >
                      <option value="two_decimals">Decimales exactos (ej: 7.75)</option>
                      <option value="one_decimal">1 decimal (ej: 7.8)</option>
                      <option value="half_point">Medio punto (ej: 7.5 / 8)</option>
                      <option value="integer">Número entero (ej: 8)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowColumnMappingConfig((v) => !v)}
                    className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>
                      {showColumnMappingConfig ? 'Ocultar ajuste de campos' : 'Cambiar campo de Nombre / Nota'}
                    </span>
                  </button>
                </div>

                {showColumnMappingConfig && (
                  <div className="pt-2 border-t border-neutral-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        Pregunta de Nombre / Alumno en el Forms:
                      </label>
                      <select
                        value={nameCol}
                        onChange={(e) =>
                          handleMappingOrScaleChange({ nextNameCol: e.target.value })
                        }
                        className={`w-full px-2.5 py-1.5 rounded-lg border ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-neutral-300 text-neutral-800'
                        }`}
                      >
                        <option value="">-- Ninguna --</option>
                        {availableHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        2da columna de Nombre (opcional):
                      </label>
                      <select
                        value={secondaryNameCol}
                        onChange={(e) =>
                          handleMappingOrScaleChange({ nextSecNameCol: e.target.value })
                        }
                        className={`w-full px-2.5 py-1.5 rounded-lg border ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-neutral-300 text-neutral-800'
                        }`}
                      >
                        <option value="">-- No usar --</option>
                        {availableHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold mb-1">
                        Campo de Nota / Puntuación:
                      </label>
                      <select
                        value={scoreCol}
                        onChange={(e) =>
                          handleMappingOrScaleChange({ nextScoreCol: e.target.value })
                        }
                        className={`w-full px-2.5 py-1.5 rounded-lg border ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-neutral-300 text-neutral-800'
                        }`}
                      >
                        {availableHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Filter & Search Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFilterView('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      filterView === 'all'
                        ? 'bg-purple-600 text-white'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    Todos ({students.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterView('matched')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      filterView === 'matched'
                        ? 'bg-emerald-600 text-white'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    Con Nota Detectada ({stats.matchedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterView('unmatched')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      filterView === 'unmatched'
                        ? 'bg-amber-600 text-white'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    Sin entregar ({students.length - stats.matchedCount})
                  </button>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar alumno..."
                    className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border focus:outline-none ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-800'
                    }`}
                  />
                </div>
              </div>

              {/* SECTION C: Clean Student + Final Grade Table (No clutter, just Student & Nota Final!) */}
              <div
                className={`border rounded-2xl overflow-hidden ${
                  isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead
                      className={`sticky top-0 z-10 border-b text-[11px] uppercase tracking-wider font-bold ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-300'
                          : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                      }`}
                    >
                      <tr>
                        <th className="p-2.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              filteredReviewRows.length > 0 &&
                              filteredReviewRows.every((r) => r.isIncluded)
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setReviewRows((prev) =>
                                prev.map((r) =>
                                  r.editedScore.trim() !== ''
                                    ? { ...r, isIncluded: checked }
                                    : r
                                )
                              );
                            }}
                            className="rounded cursor-pointer"
                            title="Seleccionar todos"
                          />
                        </th>
                        <th className="p-2.5">Alumno de la Clase</th>
                        <th className="p-2.5">Estado de Detección</th>
                        {targetColumnMode === 'existing_sub' && (
                          <th className="p-2.5 text-center">Nota Anterior</th>
                        )}
                        <th className="p-2.5 text-center">Nota Final</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-slate-800">
                      {filteredReviewRows.map((row, idx) => {
                        const isMatched = row.matchedSubmissionIndex !== null;

                        return (
                          <tr
                            key={row.student.id}
                            className={`transition-colors ${
                              !row.isIncluded
                                ? 'opacity-60'
                                : isDarkMode
                                ? 'hover:bg-slate-800/50'
                                : 'hover:bg-purple-50/30'
                            }`}
                          >
                            {/* Include Checkbox */}
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={row.isIncluded}
                                onChange={() => handleToggleStudentInclude(row.student.id)}
                                className="rounded cursor-pointer"
                              />
                            </td>

                            {/* Student in Course Roster */}
                            <td className="p-2.5 font-semibold" data-pii="student">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-neutral-400 w-4">
                                  {idx + 1}
                                </span>
                                <div>
                                  <div className="text-xs font-bold">
                                    {row.student.lastName}, {row.student.firstName}
                                  </div>
                                  {row.student.email && (
                                    <div className="text-[10px] text-neutral-400">
                                      {row.student.email}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Detection Status (or manual link if unmatched and there are leftover Form names) */}
                            <td className="p-2.5" data-pii="student">
                              {isMatched ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Detectado en Forms
                                </span>
                              ) : unmatchedSubmissions.length > 0 ? (
                                <select
                                  value=""
                                  onChange={(e) =>
                                    handleAssignSubmissionToStudent(
                                      row.student.id,
                                      e.target.value
                                    )
                                  }
                                  className={`px-2 py-1 rounded-lg border text-[11px] ${
                                    isDarkMode
                                      ? 'bg-slate-800 border-amber-700/60 text-amber-300'
                                      : 'bg-amber-50 border-amber-300 text-amber-900'
                                  }`}
                                >
                                  <option value="">Sin coincidencia (Vincular nombre...)</option>
                                  {parsedSubmissions.map((sub, sIdx) => (
                                    <option key={sIdx} value={String(sIdx)}>
                                      {sub.rawName || sub.rawEmail || `Envío #${sIdx + 1}`} — Nota:{' '}
                                      {formatConvertedFormsGrade(
                                        sub.earnedPoints,
                                        sub.maxPoints,
                                        customMaxScore,
                                        scaleMode,
                                        roundingMode
                                      )}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-[11px] text-neutral-400">
                                  No figura en el Forms
                                </span>
                              )}
                            </td>

                            {/* Previous Grade if updating existing column */}
                            {targetColumnMode === 'existing_sub' && (
                              <td className="p-2.5 text-center font-semibold" data-pii="student">
                                {row.currentGradeInCol ? (
                                  <span className="text-neutral-500 dark:text-slate-400">
                                    {row.currentGradeInCol}
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">-</span>
                                )}
                              </td>
                            )}

                            {/* Final Grade (Nota Final) */}
                            <td className="p-2.5 text-center" data-pii="student">
                              <input
                                type="text"
                                value={row.editedScore}
                                onChange={(e) =>
                                  handleEditStudentScore(row.student.id, e.target.value)
                                }
                                placeholder="-"
                                className={`w-16 text-center py-1 rounded-lg text-xs font-extrabold border focus:outline-none transition-all ${
                                  isDarkMode
                                    ? 'bg-slate-800 border-slate-700 focus:border-purple-500'
                                    : 'bg-white border-neutral-300 focus:border-purple-500'
                                } ${getScoreColorClass(row.editedScore, isDarkMode)}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3.5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          {step === 'review' ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-bold text-purple-600 dark:text-purple-400">
                  ✓ {stats.toApplyCount} de {stats.totalStudents} notas finales listas para cargar
                </span>
                {stats.averageScore && (
                  <span className="text-neutral-500 dark:text-slate-400">
                    • Promedio: <strong>{stats.averageScore}</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={stats.toApplyCount === 0}
                  onClick={handleAcceptAndApplyGrades}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Aceptar y Cargar Notas ({stats.toApplyCount})</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between w-full text-xs text-neutral-500 dark:text-slate-400">
              <span>
                Se detectarán únicamente los nombres de la clase y su nota final para que elijas la columna antes de aceptar.
              </span>
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-1.5 rounded-xl font-semibold border cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportGoogleFormsModal;
