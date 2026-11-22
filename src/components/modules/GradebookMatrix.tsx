import React, { useState, useMemo, useRef, useEffect, useCallback, Suspense } from 'react';
import {
  Plus,
  Trash2,
  Calculator,
  Check,
  X,
  Settings,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Award,
  Copy,
  ClipboardCheck,
  Upload,
  Cloud,
  GripVertical,
  UserCheck,
  Columns,
  RotateCcw,
} from 'lucide-react';
import { Student } from '../../types';
import {
  GradeCategory,
  GradeSubcategory,
  GradeIntensification,
  StudentGradesMap,
  DEFAULT_CATEGORIES,
} from '../../types/grades';
import type { PreliminaryValuationRecord } from './PreliminaryValuationModal';
import { StudentGradeBreakdownModal, BreakdownPeriod } from './StudentGradeBreakdownModal';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const AnnualSummaryView = lazyWithRetry(() =>
  import('./AnnualSummaryView').then((m) => ({ default: m.AnnualSummaryView }))
);
const PreliminaryValuationModal = lazyWithRetry(() =>
  import('./PreliminaryValuationModal').then((m) => ({ default: m.PreliminaryValuationModal }))
);
const ImportGradesModal = lazyWithRetry(() =>
  import('./ImportGradesModal').then((m) => ({ default: m.ImportGradesModal }))
);
const ImportGoogleFormsModal = lazyWithRetry(() =>
  import('./ImportGoogleFormsModal').then((m) => ({ default: m.ImportGoogleFormsModal }))
);
import {
  exportGradebookMatrixToExcel,
} from '../../utils/excelExport';
import { getCurrentCalendarTerm, getGlobalAttendanceSettings } from '../../utils/attendanceCalculations';
import {
  CATEGORY_COLORS,
  INTENSIFICATION_EXEMPT_LABEL,
  calculateCategoryAverageForStudent,
  calculateFinalScoreForStudent,
  computeTermScoresMap,
  getScoreColorClass as computeScoreColorClass,
  getEffectiveIntensificationCell,
  getIntensificationDisplayLabel,
  reorderCategoriesList,
  reorderSubcategoriesInCategory,
  moveSubcategoryAcrossCategories,
} from '../../utils/gradeCalculations';
import { useTerminologySettings } from '../../utils/terminologySettings';
import { useGradebookSync, GradebookTerm } from '../../hooks/useGradebookSync';
import { GradebookCategoryModals } from './GradebookCategoryModals';
import { driveService } from '../../services/workspace/driveService';
import { DriveSaveFormatSelector } from '../common/DriveSaveFormatSelector';
import {
  buildGradebookHtml,
  buildGradebookCsv,
  DriveSaveFormat,
  SavedDriveFileResult,
} from '../../utils/driveFormatExporters';
import { safeSetLocalStorageItem } from '../../utils/storageGuard';

export type { GradebookTerm };

export interface GradebookMatrixProps {
  courseId: string;
  courseName: string;
  students: Student[];
  isDarkMode: boolean;
  activeTerm?: GradebookTerm;
  onTermChange?: (term: GradebookTerm) => void;
  driveFolderId?: string;
  driveFolderUrl?: string;
  onDeleteStudent?: (student: Student) => void;
}

export { DEFAULT_CATEGORIES };

const EMPTY_STUDENT_GRADES: Record<string, string> = {};

type ColumnDensity = 'compact' | 'normal' | 'wide';

const COLUMN_DENSITY_PRESETS: Record<
  ColumnDensity,
  { student: number; grade: number; prelim: number; final: number }
> = {
  compact: { student: 152, grade: 64, prelim: 84, final: 92 },
  normal: { student: 192, grade: 92, prelim: 104, final: 118 },
  wide: { student: 238, grade: 124, prelim: 128, final: 142 },
};

const COLUMN_MIN_MAX: Record<'student' | 'grade' | 'prelim' | 'final', { min: number; max: number }> = {
  student: { min: 115, max: 340 },
  grade: { min: 52, max: 240 },
  prelim: { min: 70, max: 180 },
  final: { min: 78, max: 210 },
};

interface GradebookStudentRowProps {
  student: Student;
  idx: number;
  studentGrades: Record<string, string>;
  categories: GradeCategory[];
  isDarkMode: boolean;
  overallCalculation: 'average_of_categories' | 'manual_final';
  finalScore: string;
  autoAverageScore: string;
  preliminaryValuation?: PreliminaryValuationRecord | null;
  onScoreChange: (studentId: string, colKey: string, val: string) => void;
  onCellBlur: () => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => void;
  onOpenPreliminaryModal: () => void;
  onSelectStudent: (student: Student) => void;
  onDeleteStudent?: (student: Student) => void;
}

const GradebookStudentRow = React.memo<GradebookStudentRowProps>(
  ({
    student,
    idx,
    studentGrades,
    categories,
    isDarkMode,
    overallCalculation,
    finalScore,
    autoAverageScore,
    preliminaryValuation,
    onScoreChange,
    onCellBlur,
    onCellKeyDown,
    onOpenPreliminaryModal,
    onSelectStudent,
    onDeleteStudent,
  }) => {
    const [isFinalFocused, setIsFinalFocused] = useState(false);
    let runningColIdx = 0;
    const getScoreColorClass = (valStr: string) => computeScoreColorClass(valStr, isDarkMode);

    return (
      <tr
        className={`group transition-colors ${
          isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-neutral-50/80'
        }`}
      >
        {/* Student Name (Sticky on horizontal scroll, clickable for breakdown) */}
        <td
          className={`sticky left-0 z-10 py-2 px-2.5 border-r font-medium transition-colors shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] overflow-hidden ${
            isDarkMode
              ? 'bg-slate-900 group-hover:bg-slate-800 border-slate-800 text-slate-200'
              : 'bg-white group-hover:bg-neutral-50 border-neutral-200 text-neutral-800'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[10px] text-neutral-400 w-4 shrink-0 tabular-nums">{idx + 1}</span>
              <button
                type="button"
                data-pii="student"
                onClick={() => onSelectStudent(student)}
                className={`font-semibold text-xs truncate text-left hover:underline cursor-pointer transition-colors min-w-0 ${
                  isDarkMode
                    ? 'text-slate-100 hover:text-blue-400'
                    : 'text-neutral-800 hover:text-blue-600'
                }`}
                title={`Ver desglose de calificaciones de ${student.lastName}, ${student.firstName}`}
              >
                {student.lastName}, {student.firstName}
              </button>
            </div>

            {onDeleteStudent && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteStudent(student);
                }}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-950/60 text-red-500 transition-all cursor-pointer shrink-0"
                title={`Quitar a ${student.lastName}, ${student.firstName} de la lista de esta materia`}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            )}
          </div>
        </td>

        {/* Grade Cells per Category & Subcategory */}
        {categories.map((cat) => {
          if (cat.subcategories.length === 0) {
            const val = studentGrades[cat.id] || '';
            const thisColIdx = runningColIdx++;
            return (
              <td key={cat.id} data-pii="student" className="p-1 border-r text-center border-neutral-200 dark:border-slate-800 overflow-hidden">
                <input
                  type="text"
                  data-grade-row={idx}
                  data-grade-col={thisColIdx}
                  value={val}
                  onChange={(e) => onScoreChange(student.id, cat.id, e.target.value)}
                  onBlur={onCellBlur}
                  onKeyDown={(e) => onCellKeyDown(e, idx, thisColIdx)}
                  placeholder="-"
                  className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                    isDarkMode
                      ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                  } ${getScoreColorClass(val)}`}
                />
              </td>
            );
          }

          return (
            <React.Fragment key={cat.id}>
              {cat.subcategories.map((sub) => {
                const val = studentGrades[sub.id] || '';
                const thisColIdx = runningColIdx++;
                const instList = sub.intensifications || [];
                return (
                  <React.Fragment key={sub.id}>
                    <td
                      data-pii="student"
                      className="p-1 border-r text-center border-neutral-200 dark:border-slate-800 overflow-hidden"
                    >
                      <input
                        type="text"
                        data-grade-row={idx}
                        data-grade-col={thisColIdx}
                        value={val}
                        onChange={(e) => onScoreChange(student.id, sub.id, e.target.value)}
                        onBlur={onCellBlur}
                        onKeyDown={(e) => onCellKeyDown(e, idx, thisColIdx)}
                        placeholder="-"
                        className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                          isDarkMode
                            ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                            : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                        } ${getScoreColorClass(val)}`}
                      />
                    </td>

                    {instList.map((inst, instIdx) => {
                      const instColIdx = runningColIdx++;
                      const rawInstVal = studentGrades[inst.id] || '';
                      const effective = getEffectiveIntensificationCell(
                        sub,
                        instIdx,
                        studentGrades
                      );
                      const isShowingNI = effective.isNI;
                      const isDefaultNI = effective.isDefaultNI && rawInstVal.trim() === '';
                      const tooltipText = isDefaultNI
                        ? `No intensifica por defecto (aprobado con ${effective.passingScore}). Hacé clic y escribí una nota si considerás que debe intensificar (no promedia).`
                        : isShowingNI
                        ? `${getIntensificationDisplayLabel(sub, inst)} — No intensifica. Podés editar o borrar este valor.`
                        : effective.passingScore !== null
                        ? `${getIntensificationDisplayLabel(sub, inst)} — Nota cargada manualmente, fuera del promedio (borrá la celda para volver a NI)`
                        : `${getIntensificationDisplayLabel(sub, inst)} — Ingresá la calificación (fuera del promedio)`;

                      return (
                        <td
                          key={inst.id}
                          data-pii="student"
                          className={`p-1 border-r text-center overflow-hidden ${
                            isShowingNI
                              ? isDarkMode
                                ? 'bg-slate-900/50 border-slate-800'
                                : 'bg-neutral-50/70 border-neutral-200'
                              : isDarkMode
                              ? 'bg-amber-950/15 border-slate-800'
                              : 'bg-amber-50/35 border-neutral-200'
                          }`}
                        >
                          <input
                            type="text"
                            data-grade-row={idx}
                            data-grade-col={instColIdx}
                            value={rawInstVal}
                            onChange={(e) => onScoreChange(student.id, inst.id, e.target.value)}
                            onBlur={onCellBlur}
                            onKeyDown={(e) => onCellKeyDown(e, idx, instColIdx)}
                            placeholder={isDefaultNI ? INTENSIFICATION_EXEMPT_LABEL : '-'}
                            title={tooltipText}
                            className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                              isShowingNI
                                ? isDarkMode
                                  ? 'bg-slate-800/80 border-slate-700 text-slate-400 placeholder:text-slate-400 placeholder:font-bold focus:bg-slate-800 focus:border-amber-400 focus:text-slate-100'
                                  : 'bg-neutral-100 border-neutral-200/90 text-neutral-500 placeholder:text-neutral-500 placeholder:font-bold focus:bg-white focus:border-amber-500 focus:text-neutral-900'
                                : isDarkMode
                                ? 'bg-slate-800/80 border-amber-700/60 focus:border-amber-400'
                                : 'bg-white border-amber-300/80 focus:border-amber-500'
                            } ${isShowingNI ? '' : getScoreColorClass(rawInstVal)}`}
                          />
                        </td>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}

        {/* Preliminary Valuation Cell (TEA / TEP) if enabled */}
        {preliminaryValuation && preliminaryValuation.showInMatrix && (
          <td
            data-pii="student"
            className={`p-2 border-l text-center font-bold text-xs ${
              isDarkMode ? 'bg-amber-950/20 border-slate-800' : 'bg-amber-50/30 border-neutral-200'
            }`}
          >
            {(() => {
              const valData = preliminaryValuation.valuations[student.id];
              const traj = valData?.trajectory;
              if (traj === 'TEA') {
                return (
                  <button
                    type="button"
                    onClick={onOpenPreliminaryModal}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:scale-105 transition-transform cursor-pointer"
                    title={
                      valData?.observation
                        ? `TEA: ${valData.observation} (Haz clic para editar)`
                        : 'Trayecto Educativo en Alcanzado (Haz clic para editar)'
                    }
                  >
                    TEA
                  </button>
                );
              }
              if (traj === 'TEP') {
                return (
                  <button
                    type="button"
                    onClick={onOpenPreliminaryModal}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:scale-105 transition-transform cursor-pointer"
                    title={
                      valData?.observation
                        ? `TEP: ${valData.observation} (Haz clic para editar)`
                        : 'Trayecto Educativo en Proceso (Haz clic para editar)'
                    }
                  >
                    TEP
                  </button>
                );
              }
              if (traj === 'TED') {
                return (
                  <button
                    type="button"
                    onClick={onOpenPreliminaryModal}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:scale-105 transition-transform cursor-pointer"
                    title={
                      valData?.observation
                        ? `TED: ${valData.observation} (Haz clic para editar)`
                        : 'Trayecto Educativo Discontinuo (Haz clic para editar)'
                    }
                  >
                    TED
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  onClick={onOpenPreliminaryModal}
                  className="text-[11px] text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 underline cursor-pointer"
                  title="Asignar TEA / TEP en Valoración Preliminar"
                >
                  Asignar
                </button>
              );
            })()}
          </td>
        )}

        {/* Final Grade Cell */}
        <td
          data-pii="student"
          className={`p-1.5 border-l text-center font-extrabold text-sm overflow-hidden ${
            isDarkMode ? 'bg-blue-950/20 border-slate-800' : 'bg-blue-50/40 border-neutral-200'
          }`}
        >
          {(() => {
            const finalColIdx = runningColIdx++;
            if (overallCalculation === 'manual_final') {
              const val = studentGrades['__final__'] || '';
              return (
                <input
                  type="text"
                  data-grade-row={idx}
                  data-grade-col={finalColIdx}
                  value={val}
                  onChange={(e) => onScoreChange(student.id, '__final__', e.target.value)}
                  onBlur={onCellBlur}
                  onKeyDown={(e) => onCellKeyDown(e, idx, finalColIdx)}
                  placeholder="-"
                  className={`w-full max-w-[64px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
                    isDarkMode
                      ? 'bg-purple-950/40 border-purple-800/80 focus:border-purple-500'
                      : 'bg-purple-50 border-purple-200 focus:border-purple-400'
                  } ${getScoreColorClass(val)}`}
                  title="Nota final asignada a criterio del docente"
                />
              );
            }

            const overrideVal = studentGrades['__final_avg_override__'];
            const hasManualOverride =
              overrideVal !== undefined && String(overrideVal).trim() !== '';
            const displayedVal = isFinalFocused
              ? overrideVal !== undefined
                ? overrideVal
                : autoAverageScore
              : hasManualOverride
              ? overrideVal
              : autoAverageScore;

            return (
              <input
                type="text"
                data-grade-row={idx}
                data-grade-col={finalColIdx}
                value={displayedVal}
                onFocus={() => setIsFinalFocused(true)}
                onChange={(e) => onScoreChange(student.id, '__final_avg_override__', e.target.value)}
                onBlur={() => {
                  setIsFinalFocused(false);
                  onCellBlur();
                }}
                onKeyDown={(e) => onCellKeyDown(e, idx, finalColIdx)}
                placeholder={autoAverageScore || '-'}
                className={`w-full max-w-[64px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
                  hasManualOverride && overrideVal !== autoAverageScore
                    ? isDarkMode
                      ? 'bg-purple-950/40 border-purple-700 focus:border-purple-500'
                      : 'bg-purple-50 border-purple-300 focus:border-purple-500'
                    : isDarkMode
                    ? 'bg-blue-950/40 border-blue-800/80 focus:border-blue-500'
                    : 'bg-blue-50/70 border-blue-200 focus:border-blue-400'
                } ${getScoreColorClass(displayedVal || finalScore)}`}
                title={
                  hasManualOverride && overrideVal !== autoAverageScore
                    ? `Nota modificada manualmente (Promedio de referencia: ${autoAverageScore || '-'}). Borrá el valor para volver al promedio automático.`
                    : `Promedio calculado: ${autoAverageScore || '-'}. Podés hacer clic y modificar la nota manualmente.`
                }
              />
            );
          })()}
        </td>
      </tr>
    );
  }
);

export const GradebookMatrix: React.FC<GradebookMatrixProps> = ({
  courseId,
  courseName,
  students,
  isDarkMode,
  activeTerm,
  onTermChange,
  driveFolderId,
  driveFolderUrl,
  onDeleteStudent,
}) => {
  const [internalTerm, setInternalTerm] = useState<GradebookTerm>(() =>
    getCurrentCalendarTerm(getGlobalAttendanceSettings())
  );
  const currentTerm = activeTerm || internalTerm;
  const setTerm = (t: GradebookTerm) => {
    setInternalTerm(t);
    if (typeof window !== 'undefined') {
      safeSetLocalStorageItem(`fds_grades_active_term_${courseId}`, t);
    }
    if (onTermChange) {
      onTermChange(t);
    }
  };

  const is2c = currentTerm === '2c';

  const {
    categories1c,
    categories2c,
    gradesMap1c,
    gradesMap2c,
    overallCalc1c,
    overallCalc2c,
    annualOverrides,
    activePreliminaryValuation,
    gradeHistory,
    categories,
    gradesMap,
    overallCalculation,
    cloudStatus,
    saveCategories,
    saveGrades,
    saveOverallCalc,
    saveAnnualOverride,
    handleCopyCategoriesFrom1c,
    handleSavePreliminaryValuation,
    handleApplyImportedGrades,
    handleApplyMultiImport,
  } = useGradebookSync({
    courseId,
    courseName,
    students,
    currentTerm,
    driveFolderId,
    onExternalTermSwitch: (term) => setInternalTerm(term),
  });

  const [isPreliminaryModalOpen, setIsPreliminaryModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isFormsModalOpen, setIsFormsModalOpen] = useState(false);
  const [importSourceType, setImportSourceType] = useState<'file' | 'csv' | 'sheets' | 'paste'>('sheets');
  const [importTargetColumn, setImportTargetColumn] = useState<{
    categoryId: string;
    subcategoryId: string;
    subcategoryName: string;
  } | null>(null);

  // Selected student for individual grade breakdown modal
  const [selectedBreakdownStudent, setSelectedBreakdownStudent] = useState<Student | null>(null);
  const [breakdownInitialPeriod, setBreakdownInitialPeriod] = useState<BreakdownPeriod>('1c');

  const handleOpenStudentBreakdown = useCallback(
    (student: Student, forcedPeriod?: BreakdownPeriod) => {
      const period: BreakdownPeriod =
        forcedPeriod ?? (currentTerm === 'annual' ? 'both' : currentTerm);
      setBreakdownInitialPeriod(period);
      setSelectedBreakdownStudent(student);
    },
    [currentTerm]
  );

  // Editable column widths & density preset (persisted per course in localStorage)
  const [colDensity, setColDensity] = useState<ColumnDensity>(() => {
    try {
      const saved = window.localStorage.getItem(`fds_grades_col_density_${courseId}`);
      if (saved === 'compact' || saved === 'normal' || saved === 'wide') return saved;
    } catch {}
    return 'normal';
  });

  const [customColWidths, setCustomColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = window.localStorage.getItem(`fds_grades_col_widths_${courseId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {};
  });

  const [isResizingColumn, setIsResizingColumn] = useState(false);

  // Reload density & custom widths when switching courses
  useEffect(() => {
    try {
      const savedDensity = window.localStorage.getItem(`fds_grades_col_density_${courseId}`);
      if (savedDensity === 'compact' || savedDensity === 'normal' || savedDensity === 'wide') {
        setColDensity(savedDensity);
      } else {
        setColDensity('normal');
      }
      const savedWidths = window.localStorage.getItem(`fds_grades_col_widths_${courseId}`);
      setCustomColWidths(savedWidths ? JSON.parse(savedWidths) : {});
    } catch {
      setColDensity('normal');
      setCustomColWidths({});
    }
  }, [courseId]);

  const handleSelectDensity = (next: ColumnDensity) => {
    setColDensity(next);
    safeSetLocalStorageItem(`fds_grades_col_density_${courseId}`, next);
  };

  const getColWidth = useCallback(
    (colKey: string, kind: 'student' | 'grade' | 'prelim' | 'final') => {
      const custom = customColWidths[colKey];
      if (typeof custom === 'number' && !isNaN(custom)) return custom;
      return COLUMN_DENSITY_PRESETS[colDensity][kind];
    },
    [customColWidths, colDensity]
  );

  const handleResetSingleColWidth = useCallback(
    (colKey: string) => {
      setCustomColWidths((prev) => {
        if (!(colKey in prev)) return prev;
        const next = { ...prev };
        delete next[colKey];
        safeSetLocalStorageItem(`fds_grades_col_widths_${courseId}`, JSON.stringify(next));
        return next;
      });
    },
    [courseId]
  );

  const handleResetAllColWidths = useCallback(() => {
    setCustomColWidths({});
    safeSetLocalStorageItem(`fds_grades_col_widths_${courseId}`, JSON.stringify({}));
  }, [courseId]);

  const startColumnResize = useCallback(
    (e: React.MouseEvent, colKey: string, kind: 'student' | 'grade' | 'prelim' | 'final') => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = getColWidth(colKey, kind);
      const { min, max } = COLUMN_MIN_MAX[kind];
      let latestWidth = startWidth;

      setIsResizingColumn(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvt: MouseEvent) => {
        const delta = moveEvt.clientX - startX;
        latestWidth = Math.max(min, Math.min(max, Math.round(startWidth + delta)));
        setCustomColWidths((prev) =>
          prev[colKey] === latestWidth ? prev : { ...prev, [colKey]: latestWidth }
        );
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        setIsResizingColumn(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setCustomColWidths((prev) => {
          const updated = { ...prev, [colKey]: latestWidth };
          safeSetLocalStorageItem(`fds_grades_col_widths_${courseId}`, JSON.stringify(updated));
          return updated;
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [courseId, getColWidth]
  );

  const { intensificationLabel, updateTerminology } = useTerminologySettings();

  const hasAnyIntensifications = useMemo(
    () =>
      categories.some((cat) =>
        cat.subcategories.some((sub) => (sub.intensifications?.length || 0) > 0)
      ),
    [categories]
  );

  const headerRowSpan = hasAnyIntensifications ? 3 : 2;

  const totalTableWidth = useMemo(() => {
    let total = getColWidth('__student__', 'student');
    categories.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        total += getColWidth(cat.id, 'grade');
      } else {
        cat.subcategories.forEach((sub) => {
          total += getColWidth(sub.id, 'grade');
          (sub.intensifications || []).forEach((inst) => {
            total += getColWidth(inst.id, 'grade');
          });
        });
      }
    });
    if (activePreliminaryValuation && activePreliminaryValuation.showInMatrix) {
      total += getColWidth('__prelim__', 'prelim');
    }
    total += getColWidth('__final__', 'final');
    return total;
  }, [categories, activePreliminaryValuation, getColWidth]);

  // Double Scrollbar Synchronization: Top scrollbar & Bottom Table scrollbar
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [tableWidth, setTableWidth] = useState<number>(0);

  // Sync scroll positions without infinite loops
  const isSyncingTopScroll = useRef(false);
  const isSyncingBottomScroll = useRef(false);

  const handleTopScroll = () => {
    if (isSyncingTopScroll.current) {
      isSyncingTopScroll.current = false;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      isSyncingBottomScroll.current = true;
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleBottomScroll = () => {
    if (isSyncingBottomScroll.current) {
      isSyncingBottomScroll.current = false;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      isSyncingTopScroll.current = true;
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
  };

  // Measure and keep tableWidth updated for the top scrollbar dummy spacer
  useEffect(() => {
    let rafId: number | null = null;
    const updateWidth = () => {
      if (tableRef.current) {
        const sw = tableRef.current.scrollWidth;
        if (sw > 0) {
          setTableWidth((prev) => (Math.abs(prev - sw) > 2 ? sw : prev));
        }
      }
    };
    updateWidth();

    // Use ResizeObserver for responsive table width changes (e.g. columns added/removed/resized)
    if (tableRef.current && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateWidth);
      });
      ro.observe(tableRef.current);
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }
  }, [categories, students, totalTableWidth]);

  // Quick arrow scroll buttons
  const scrollTableBy = (delta: number) => {
    if (bottomScrollRef.current) {
      bottomScrollRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  // Local draft map for 0ms typing responsiveness with debounced persistence (220ms)
  const [draftGradesMap, setDraftGradesMap] = useState<StudentGradesMap>(gradesMap);
  const pendingGradesSaveRef = useRef<StudentGradesMap | null>(null);
  const gradesSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGradesRef = useRef(saveGrades);
  saveGradesRef.current = saveGrades;

  const flushPendingGradesSave = useCallback(() => {
    if (gradesSaveTimerRef.current) {
      clearTimeout(gradesSaveTimerRef.current);
      gradesSaveTimerRef.current = null;
    }
    if (pendingGradesSaveRef.current) {
      const toSave = pendingGradesSaveRef.current;
      pendingGradesSaveRef.current = null;
      saveGradesRef.current(toSave);
    }
  }, []);

  // Sync draftGradesMap when underlying gradesMap or term/course changes externally
  useEffect(() => {
    if (!pendingGradesSaveRef.current) {
      setDraftGradesMap(gradesMap);
    }
  }, [gradesMap]);

  // Flush any pending keystroke saves when switching term/course or unmounting
  useEffect(() => {
    return () => {
      flushPendingGradesSave();
    };
  }, [courseId, currentTerm, flushPendingGradesSave]);

  // Cell edit handling: immediate UI update + debounced storage/cloud write
  const handleScoreChange = useCallback((studentId: string, colKey: string, val: string) => {
    const cleanVal = val.replace(',', '.');
    setDraftGradesMap((prev) => {
      const nextStudentGrades: Record<string, string> = {
        ...(prev[studentId] || {}),
        [colKey]: cleanVal,
      };
      if (colKey === '__final_avg_override__' && cleanVal.trim() !== '') {
        nextStudentGrades['__final__'] = cleanVal;
      }
      const updated: StudentGradesMap = {
        ...prev,
        [studentId]: nextStudentGrades,
      };
      pendingGradesSaveRef.current = updated;
      if (gradesSaveTimerRef.current) {
        clearTimeout(gradesSaveTimerRef.current);
      }
      gradesSaveTimerRef.current = setTimeout(() => {
        gradesSaveTimerRef.current = null;
        if (pendingGradesSaveRef.current) {
          const toCommit = pendingGradesSaveRef.current;
          pendingGradesSaveRef.current = null;
          saveGradesRef.current(toCommit);
        }
      }, 220);
      return updated;
    });
  }, []);

  // Excel-like keyboard navigation across grade cells (skips non-editable NI cells smoothly)
  const handleGradeCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      rowIdx: number,
      colIdx: number
    ) => {
      let rowStep = 0;
      let colStep = 0;

      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        rowStep = 1;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        rowStep = -1;
      } else if (
        e.key === 'ArrowRight' &&
        e.currentTarget.selectionStart === e.currentTarget.value.length
      ) {
        e.preventDefault();
        colStep = 1;
      } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
        e.preventDefault();
        colStep = -1;
      } else {
        return;
      }

      if (tableRef.current) {
        for (let step = 1; step <= 60; step++) {
          const nextRow = rowIdx + rowStep * step;
          const nextCol = colIdx + colStep * step;
          if (nextRow < 0 || nextCol < 0) break;
          const target = tableRef.current.querySelector<HTMLInputElement>(
            `input[data-grade-row="${nextRow}"][data-grade-col="${nextCol}"]`
          );
          if (target) {
            target.focus();
            target.select();
            break;
          }
        }
      }
    },
    []
  );

  const handleOpenPreliminaryModal = useCallback(() => {
    setIsPreliminaryModalOpen(true);
  }, []);

  // Modals / State for adding & editing categories/subcategories
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<GradeCategory | null>(null);

  // Category Edit state & Manage Categories Modal
  const [categoryToEdit, setCategoryToEdit] = useState<GradeCategory | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);

  // Subcategory Edit state
  const [subcatToEdit, setSubcatToEdit] = useState<{ catId: string; subId: string; name: string } | null>(null);
  const [editSubcatName, setEditSubcatName] = useState('');

  // Intensification / Recuperación Edit state
  const [intensificationToEdit, setIntensificationToEdit] = useState<{
    catId: string;
    subId: string;
    instId: string;
  } | null>(null);

  const [addingSubcatForCatId, setAddingSubcatForCatId] = useState<string | null>(null);
  const [newSubcatName, setNewSubcatName] = useState('');

  // Add Category Handler
  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const newCat: GradeCategory = {
      id: `cat-${Date.now()}`,
      name: newCatName.trim(),
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length].badge,
      subcategories: [],
    };
    saveCategories([...categories, newCat]);
    setNewCatName('');
    setIsAddCategoryOpen(false);
  };

  // Save Edited Category Name & Color
  const handleSaveEditCategory = () => {
    if (!categoryToEdit || !editCatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== categoryToEdit.id) return cat;
      return {
        ...cat,
        name: editCatName.trim(),
        color: editCatColor || cat.color,
      };
    });
    saveCategories(updated);
    setCategoryToEdit(null);
  };

  // Save Edited Subcategory Name
  const handleSaveEditSubcategory = () => {
    if (!subcatToEdit || !editSubcatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== subcatToEdit.catId) return cat;
      return {
        ...cat,
        subcategories: cat.subcategories.map((sub) =>
          sub.id === subcatToEdit.subId ? { ...sub, name: editSubcatName.trim() } : sub
        ),
      };
    });
    saveCategories(updated);
    setSubcatToEdit(null);
  };

  // Add Subcategory Handler
  const handleAddSubcategory = (catId: string) => {
    if (!newSubcatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== catId) return cat;
      const newSub: GradeSubcategory = {
        id: `sub-${Date.now()}`,
        name: newSubcatName.trim(),
        maxScore: 10,
      };
      return {
        ...cat,
        subcategories: [...cat.subcategories, newSub],
      };
    });
    saveCategories(updated);
    setNewSubcatName('');
    setAddingSubcatForCatId(null);
  };

  // Delete Category with in-app confirmation modal (safe inside iframes)
  const confirmDeleteCategory = () => {
    if (!categoryToDelete) return;
    saveCategories(categories.filter((c) => c.id !== categoryToDelete.id));
    setCategoryToDelete(null);
  };

  // Delete Subcategory
  const handleDeleteSubcategory = (catId: string, subId: string) => {
    const updated = categories.map((cat) => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        subcategories: cat.subcategories.filter((s) => s.id !== subId),
      };
    });
    saveCategories(updated);
  };

  // Add Intensification / Recuperación to an evaluation
  const handleAddIntensification = useCallback(
    (catId: string, subId: string, name: string, customTitle?: string) => {
      const cleanName = name.trim() || intensificationLabel;
      const newInst: GradeIntensification = {
        id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        ...(customTitle?.trim() ? { customTitle: customTitle.trim() } : {}),
      };
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const prevInsts = Array.isArray(sub.intensifications) ? sub.intensifications : [];
            return {
              ...sub,
              intensifications: [...prevInsts, newInst],
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories, intensificationLabel]
  );

  // Update Intensification / Recuperación label or custom specification
  const handleUpdateIntensification = useCallback(
    (
      catId: string,
      subId: string,
      instId: string,
      updates: { name: string; customTitle?: string }
    ) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            return {
              ...sub,
              intensifications: (sub.intensifications || []).map((inst) =>
                inst.id === instId
                  ? {
                      ...inst,
                      name: updates.name.trim() || inst.name,
                      customTitle: updates.customTitle?.trim() || undefined,
                    }
                  : inst
              ),
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Delete Intensification / Recuperación
  const handleDeleteIntensification = useCallback(
    (catId: string, subId: string, instId: string) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const nextInsts = (sub.intensifications || []).filter((inst) => inst.id !== instId);
            return {
              ...sub,
              intensifications: nextInsts.length > 0 ? nextInsts : undefined,
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Reorder Intensifications within an evaluation
  const handleMoveIntensification = useCallback(
    (catId: string, subId: string, fromIndex: number, toIndex: number) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const list = [...(sub.intensifications || [])];
            if (
              fromIndex < 0 ||
              toIndex < 0 ||
              fromIndex >= list.length ||
              toIndex >= list.length ||
              fromIndex === toIndex
            ) {
              return sub;
            }
            const [moved] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, moved);
            return {
              ...sub,
              intensifications: list,
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Reorder Major Categories (moves the category along with all its subcolumns and grades)
  const handleMoveCategory = useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = reorderCategoriesList(categories, fromIndex, toIndex);
      if (next !== categories) {
        saveCategories(next);
      }
    },
    [categories, saveCategories]
  );

  // Reorder Subcategories / Evaluations within a Category
  const handleMoveSubcategory = useCallback(
    (catId: string, fromIndex: number, toIndex: number) => {
      const next = reorderSubcategoriesInCategory(categories, catId, fromIndex, toIndex);
      if (next !== categories) {
        saveCategories(next);
      }
    },
    [categories, saveCategories]
  );

  // Move a Subcategory / Evaluation to another Category (or specific position)
  const handleMoveSubcategoryToCategory = useCallback(
    (sourceCatId: string, subId: string, targetCatId: string, targetIndex?: number) => {
      const next = moveSubcategoryAcrossCategories(
        categories,
        sourceCatId,
        subId,
        targetCatId,
        targetIndex
      );
      if (next !== categories) {
        saveCategories(next);
      }
    },
    [categories, saveCategories]
  );

  // Drag & Drop state for categories and subcategories in the table header
  const [draggedCatIdx, setDraggedCatIdx] = useState<number | null>(null);
  const [dragOverCatIdx, setDragOverCatIdx] = useState<number | null>(null);
  const [draggedSubcat, setDraggedSubcat] = useState<{
    catId: string;
    subId: string;
    subIdx: number;
  } | null>(null);
  const [dragOverSubcat, setDragOverSubcat] = useState<{
    catId: string;
    subIdx: number;
  } | null>(null);

  const calculateFinalForTerm = (
    term: '1c' | '2c',
    studentId: string
  ): { scoreStr: string; num: number | null } => {
    const termCats = term === '1c' ? categories1c : categories2c;
    const termGrades =
      term === (is2c ? '2c' : '1c')
        ? draftGradesMap
        : term === '1c'
        ? gradesMap1c
        : gradesMap2c;
    const termCalc = term === '1c' ? overallCalc1c : overallCalc2c;
    return calculateFinalScoreForStudent(termCats, termGrades, termCalc, studentId);
  };

  const getFinalScore = (studentId: string): string => {
    return calculateFinalForTerm(is2c ? '2c' : '1c', studentId).scoreStr;
  };

  const getAutoAverageScore = (studentId: string): string => {
    const termCats = is2c ? categories2c : categories1c;
    return calculateCategoryAverageForStudent(termCats, draftGradesMap, studentId).scoreStr;
  };

  const score1cMap = useMemo(
    () => computeTermScoresMap(students, categories1c, gradesMap1c, overallCalc1c),
    [students, categories1c, gradesMap1c, overallCalc1c]
  );

  const score2cMap = useMemo(
    () => computeTermScoresMap(students, categories2c, gradesMap2c, overallCalc2c),
    [students, categories2c, gradesMap2c, overallCalc2c]
  );

  const handleSaveGradesInFormat = async (
    format: DriveSaveFormat,
    customTitle: string
  ): Promise<SavedDriveFileResult | null> => {
    const termLabel = currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    if (format === 'sheets') {
      const csv = buildGradebookCsv({
        students,
        categories,
        gradesMap: draftGradesMap,
      });
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Calificaciones',
        fileName: customTitle,
        content: csv,
        mimeType: 'text/csv',
        existingMainFolderId: driveFolderId,
        convertToGoogleFormat: 'sheet',
      });
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'sheets',
        formatLabel: 'Google Sheets (.gsheet)',
        category: 'Calificaciones',
      };
    }

    if (format === 'gdoc') {
      const html = buildGradebookHtml({
        courseName,
        termLabel,
        title: customTitle,
        students,
        categories,
        gradesMap: draftGradesMap,
      });
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Calificaciones',
        fileName: customTitle,
        content: html,
        mimeType: 'text/html',
        existingMainFolderId: driveFolderId,
        convertToGoogleFormat: 'doc',
      });
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'gdoc',
        formatLabel: 'Google Docs (.gdoc editable)',
        category: 'Calificaciones',
      };
    }

    if (format === 'xlsx') {
      const uploaded = await exportGradebookMatrixToExcel(
        courseName,
        termLabel,
        students,
        categories,
        draftGradesMap,
        {
          customFileName: customTitle,
          existingMainFolderId: driveFolderId,
        }
      );
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'xlsx',
        formatLabel: 'Microsoft Excel (.xlsx)',
        category: 'Calificaciones',
      };
    }

    if (format === 'csv') {
      const csv = buildGradebookCsv({
        students,
        categories,
        gradesMap: draftGradesMap,
      });
      const fileNameCsv = customTitle.toLowerCase().endsWith('.csv')
        ? customTitle
        : `${customTitle}.csv`;
      try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileNameCsv;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (_) {}
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Calificaciones',
        fileName: fileNameCsv,
        content: csv,
        mimeType: 'text/csv',
        existingMainFolderId: driveFolderId,
        convertToGoogleFormat: false,
      });
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'csv',
        formatLabel: 'Archivo CSV (.csv)',
        category: 'Calificaciones',
      };
    }

    const html = buildGradebookHtml({
      courseName,
      termLabel,
      title: customTitle,
      students,
      categories,
      gradesMap: draftGradesMap,
    });
    const fileNameHtml = customTitle.toLowerCase().endsWith('.html')
      ? customTitle
      : `${customTitle}.html`;
    const uploaded = await driveService.uploadFileToCourseCategory({
      courseName,
      category: 'Calificaciones',
      fileName: fileNameHtml,
      content: html,
      mimeType: 'text/html',
      existingMainFolderId: driveFolderId,
      convertToGoogleFormat: false,
    });
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 2000);
      }, 300);
    }
    if (!uploaded) return null;
    return {
      id: uploaded.id,
      name: uploaded.name,
      url: uploaded.url,
      folderUrl: uploaded.folderUrl,
      format: 'html',
      formatLabel: 'Reporte Imprimible HTML / PDF',
      category: 'Calificaciones',
    };
  };

  return (
    <div className="space-y-4">
      {/* Interruptor de Cuatrimestres Unificado */}
      <div
        className={`px-3.5 py-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-slate-400">
          <Calendar
            className={`w-4 h-4 shrink-0 ${
              currentTerm === '1c'
                ? 'text-blue-600 dark:text-blue-400'
                : currentTerm === '2c'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-violet-600 dark:text-violet-400'
            }`}
          />
          <span>Período Académico</span>
        </div>

        {/* Interruptor segmentado sobrio con acento por período */}
        <div
          className={`inline-flex items-center p-1 rounded-lg border ${
            isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-neutral-100 border-neutral-200/80'
          }`}
          role="tablist"
          aria-label="Período de calificaciones"
        >
          <button
            type="button"
            id="switch-term-1c"
            role="tab"
            aria-selected={currentTerm === '1c'}
            onClick={() => setTerm('1c')}
            className={`px-3 py-1.5 rounded-md font-semibold text-xs transition-all cursor-pointer whitespace-nowrap ${
              currentTerm === '1c'
                ? isDarkMode
                  ? 'bg-blue-950/80 text-blue-300 ring-1 ring-blue-700/70 shadow-xs'
                  : 'bg-white text-blue-700 ring-1 ring-blue-200 shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            1° Cuatrimestre
          </button>

          <button
            type="button"
            id="switch-term-2c"
            role="tab"
            aria-selected={currentTerm === '2c'}
            onClick={() => setTerm('2c')}
            className={`px-3 py-1.5 rounded-md font-semibold text-xs transition-all cursor-pointer whitespace-nowrap ${
              currentTerm === '2c'
                ? isDarkMode
                  ? 'bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-700/70 shadow-xs'
                  : 'bg-white text-emerald-700 ring-1 ring-emerald-200 shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            2° Cuatrimestre
          </button>

          <button
            type="button"
            id="switch-term-annual"
            role="tab"
            aria-selected={currentTerm === 'annual'}
            onClick={() => setTerm('annual')}
            className={`px-3 py-1.5 rounded-md font-semibold text-xs inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              currentTerm === 'annual'
                ? isDarkMode
                  ? 'bg-violet-950/80 text-violet-300 ring-1 ring-violet-700/70 shadow-xs'
                  : 'bg-white text-violet-700 ring-1 ring-violet-200 shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Award className="w-3.5 h-3.5 shrink-0" />
            <span>Cierre Anual</span>
          </button>
        </div>
      </div>

      {currentTerm === 'annual' ? (
        <Suspense fallback={<div className="p-8 text-center text-xs text-neutral-500">Cargando Resumen Anual...</div>}>
          <AnnualSummaryView
            courseId={courseId}
            courseName={courseName}
            students={students}
            isDarkMode={isDarkMode}
            score1cMap={score1cMap}
            score2cMap={score2cMap}
            annualOverrides={annualOverrides}
            onSaveOverride={saveAnnualOverride}
            onSwitchTerm={(t) => setTerm(t)}
            driveFolderId={driveFolderId}
            driveFolderUrl={driveFolderUrl}
            onSelectStudent={(st) => handleOpenStudentBreakdown(st, 'both')}
          />
        </Suspense>
      ) : (
        <>
          {/* Top Controls & Configuration Bar */}
          <div
            className={`p-4 rounded-xl border flex flex-col gap-3.5 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            {/* Arriba: Título Planilla de Calificaciones y Cuatrimestre */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-neutral-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className={`font-bold text-base lg:text-lg leading-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                  Planilla de Calificaciones
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                    cloudStatus.state === 'syncing'
                      ? isDarkMode
                        ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                        : 'bg-blue-50 border-blue-200 text-blue-700'
                      : cloudStatus.state === 'offline'
                      ? isDarkMode
                        ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                      : isDarkMode
                      ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  }`}
                  title="Cada nota o categoría que edites se guarda automáticamente en el dispositivo y en tu cuenta en la nube"
                >
                  <Cloud className={`w-3 h-3 shrink-0 ${cloudStatus.state === 'syncing' ? 'animate-pulse' : ''}`} />
                  <span>
                    {cloudStatus.state === 'syncing'
                      ? 'Guardando...'
                      : cloudStatus.state === 'offline'
                      ? 'Guardado local'
                      : `Guardado${cloudStatus.lastSyncedAt ? ` (${cloudStatus.lastSyncedAt})` : ''}`}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {is2c && (
                  <button
                    type="button"
                    onClick={handleCopyCategoriesFrom1c}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-emerald-950/35 hover:bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                        : 'bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-800 border-emerald-200/80'
                    }`}
                    title="Copiar las categorías creadas en el 1° Cuatrimestre para utilizarlas en este 2° Cuatrimestre"
                  >
                    <Copy className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Copiar de 1° C</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsManageCategoriesOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                  }`}
                  title="Ordenar o administrar todas las Categorías Mayores y sus columnas"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0 text-neutral-500 dark:text-slate-400" />
                  <span>Ordenar Categorías</span>
                </button>

                <button
                  type="button"
                  id="btn-agregar-categoria-mayor"
                  onClick={() => setIsAddCategoryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  title="Crear una nueva Categoría Mayor en la planilla (ej: Evaluaciones, Trabajos Prácticos, Concepto, etc.)"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Agregar Categoría</span>
                </button>
              </div>
            </div>

            {/* Abajo de Planilla de Calificaciones: Acciones Secundarias con Tinte Semántico */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full items-center">
              <button
                type="button"
                onClick={() => {
                  setImportTargetColumn(null);
                  setImportSourceType('sheets');
                  setIsImportModalOpen(true);
                }}
                className={`w-full inline-flex items-center justify-center sm:justify-start gap-2 px-3 py-2 border text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-emerald-950/35 hover:bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                    : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200/80 text-emerald-800'
                }`}
                title="Importar una evaluación o notas desde Google Forms, Google Sheets, Google Docs, Excel, Word, CSV o texto pegado"
              >
                <Upload className={`w-3.5 h-3.5 shrink-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
                <span className="truncate">Importar Evaluación o Notas</span>
              </button>

              <button
                type="button"
                id="btn-generar-valoracion-preliminar"
                onClick={() => setIsPreliminaryModalOpen(true)}
                className={`w-full inline-flex items-center justify-between gap-2 px-3 py-2 border text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-amber-950/35 hover:bg-amber-950/60 border-amber-800/60 text-amber-300'
                    : 'bg-amber-50/80 hover:bg-amber-100/80 border-amber-200/90 text-amber-900'
                }`}
                title={`Generar Valoración Preliminar para ${currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'} con selección de notas y escala TEA / TEP`}
              >
                <div className="inline-flex items-center gap-2 truncate">
                  <ClipboardCheck className={`w-3.5 h-3.5 shrink-0 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                  <span className="truncate">Valoración Preliminar</span>
                </div>
                {activePreliminaryValuation && (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                    <Check className="w-3 h-3" />
                    TEA/TEP
                  </span>
                )}
              </button>

              <div className="w-full [&>div]:w-full [&>div>button]:w-full [&>div>button]:py-2 [&>div>button]:justify-center sm:[&>div>button]:justify-start">
                <DriveSaveFormatSelector
                  courseName={courseName}
                  category="Calificaciones"
                  defaultTitle={`Calificaciones (${currentTerm === '1c' ? '1C' : '2C'}) - ${courseName} (${new Date().toISOString().slice(0, 10)})`}
                  buttonLabel="Guardar en Drive"
                  compact
                  onSaveFormat={handleSaveGradesInFormat}
                />
              </div>
            </div>
          </div>

      {/* Modal / Inline form to add Category */}
      {isAddCategoryOpen && (
        <div
          className={`p-4 rounded-xl border animate-in fade-in space-y-3 ${
            isDarkMode ? 'bg-slate-850 border-blue-500/40' : 'bg-blue-50/50 border-blue-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-blue-300' : 'text-blue-900'}`}>
              Nueva Categoría Mayor (ej: Evaluaciones, Trabajos Prácticos, Tareas Diarias...)
            </h4>
            <button
              type="button"
              onClick={() => setIsAddCategoryOpen(false)}
              className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 items-end">
            <div className="flex-1 w-full space-y-1">
              <label className={`text-[11px] font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Nombre de la Categoría Mayor
              </label>
              <input
                type="text"
                placeholder="Ej: Evaluaciones Cuatrimestrales, Trabajos Prácticos..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={handleAddCategory}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 h-[38px]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Crear Categoría</span>
            </button>
          </div>
        </div>
      )}

      {/* Adding Subcategory Form Drawer / Modal */}
      {addingSubcatForCatId && (
        <div
          className={`p-4 rounded-xl border animate-in fade-in space-y-3 ${
            isDarkMode ? 'bg-slate-850 border-emerald-500/40' : 'bg-emerald-50/50 border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-emerald-300' : 'text-emerald-900'}`}>
              Agregar Subcategoría / Columna a: "
              {categories.find((c) => c.id === addingSubcatForCatId)?.name}"
            </h4>
            <button
              type="button"
              onClick={() => setAddingSubcatForCatId(null)}
              className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ej: Evaluación Escrita Unidad 1, Exposición Oral, TP Integrador..."
              value={newSubcatName}
              onChange={(e) => setNewSubcatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubcategory(addingSubcatForCatId)}
              className={`flex-1 px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
              }`}
              autoFocus
            />
            <button
              type="button"
              onClick={() => handleAddSubcategory(addingSubcatForCatId)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar Columna</span>
            </button>
          </div>
        </div>
      )}

      {/* TOP HORIZONTAL SCROLLBAR & COLUMN WIDTH CONTROLS */}
      <div
        className={`px-3.5 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 shadow-2xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollTableBy(-220)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la izquierda"
              aria-label="Desplazar a la izquierda"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollTableBy(220)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la derecha"
              aria-label="Desplazar a la derecha"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Top Scrollbar Track synchronized with table */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="flex-1 min-w-[120px] overflow-x-auto overflow-y-hidden h-4 rounded-md scrollbar-thin transition-colors"
          style={{
            scrollbarWidth: 'auto',
          }}
        >
          {/* Invisible placeholder matching the exact width of the table */}
          <div style={{ width: `${Math.max(tableWidth, totalTableWidth)}px`, height: '1px' }} />
        </div>

        {/* Column Width Preset + Reset Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
              isDarkMode ? 'text-slate-400' : 'text-neutral-500'
            }`}
            title="Cambiá el ancho general de las columnas o arrastrá el borde derecho de cualquier encabezado para ajustarlo a medida"
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Columnas:</span>
          </span>
          <div
            className={`inline-flex items-center p-0.5 rounded-lg border ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
            }`}
            role="group"
            aria-label="Ancho de columnas"
          >
            {(
              [
                { id: 'compact', label: 'Compacto' },
                { id: 'normal', label: 'Normal' },
                { id: 'wide', label: 'Amplio' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelectDensity(opt.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  colDensity === opt.id
                    ? isDarkMode
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'bg-blue-600 text-white shadow-2xs'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {Object.keys(customColWidths).length > 0 && (
            <button
              type="button"
              onClick={handleResetAllColWidths}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100'
              }`}
              title="Restablecer anchos personalizados de columnas"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden lg:inline">Restablecer</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Gradebook Matrix Table */}
      <div
        className={`border rounded-2xl overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div
          ref={bottomScrollRef}
          onScroll={handleBottomScroll}
          className="overflow-x-auto max-w-full"
        >
          <table
            ref={tableRef}
            className="table-fixed text-left text-xs border-collapse"
            style={{ width: `${totalTableWidth}px` }}
          >
            <colgroup>
              <col style={{ width: `${getColWidth('__student__', 'student')}px` }} />
              {categories.map((cat) =>
                cat.subcategories.length === 0 ? (
                  <col key={`col-${cat.id}`} style={{ width: `${getColWidth(cat.id, 'grade')}px` }} />
                ) : (
                  cat.subcategories.map((sub) => (
                    <React.Fragment key={`colgroup-${sub.id}`}>
                      <col style={{ width: `${getColWidth(sub.id, 'grade')}px` }} />
                      {(sub.intensifications || []).map((inst) => (
                        <col
                          key={`col-${inst.id}`}
                          style={{ width: `${getColWidth(inst.id, 'grade')}px` }}
                        />
                      ))}
                    </React.Fragment>
                  ))
                )
              )}
              {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                <col style={{ width: `${getColWidth('__prelim__', 'prelim')}px` }} />
              )}
              <col style={{ width: `${getColWidth('__final__', 'final')}px` }} />
            </colgroup>
            <thead>
              {/* ROW 1: Super Header - Categories */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-neutral-100 border-neutral-200'}`}>
                {/* Student info fixed col */}
                <th
                  rowSpan={headerRowSpan}
                  className={`sticky left-0 z-20 p-2.5 font-bold border-r uppercase tracking-wider text-[11px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] relative select-none ${
                    isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 pr-1.5 min-w-0">
                    <span className="truncate">Estudiante ({students.length})</span>
                  </div>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(e) => startColumnResize(e, '__student__', 'student')}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleResetSingleColWidth('__student__');
                    }}
                    className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-30"
                    title="Arrastrá para ajustar el ancho de esta columna (doble clic para restablecer)"
                  />
                </th>

                {/* Major Categories */}
                {categories.map((cat, catIdx) => {
                  const colSpan =
                    cat.subcategories.length === 0
                      ? 1
                      : cat.subcategories.reduce(
                          (acc, sub) => acc + 1 + (sub.intensifications?.length || 0),
                          0
                        );
                  const colorTheme = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];
                  const isDragOverCat =
                    dragOverCatIdx === catIdx &&
                    draggedCatIdx !== null &&
                    draggedCatIdx !== catIdx;

                  return (
                    <th
                      key={cat.id}
                      colSpan={colSpan}
                      draggable={categories.length > 1}
                      onDragStart={(e) => {
                        setDraggedCatIdx(catIdx);
                        setDraggedSubcat(null);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', `cat:${catIdx}`);
                      }}
                      onDragOver={(e) => {
                        if (draggedCatIdx !== null && draggedCatIdx !== catIdx) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverCatIdx !== catIdx) {
                            setDragOverCatIdx(catIdx);
                          }
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverCatIdx === catIdx) {
                          setDragOverCatIdx(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedCatIdx !== null && draggedCatIdx !== catIdx) {
                          handleMoveCategory(draggedCatIdx, catIdx);
                        }
                        setDraggedCatIdx(null);
                        setDragOverCatIdx(null);
                      }}
                      onDragEnd={() => {
                        setDraggedCatIdx(null);
                        setDragOverCatIdx(null);
                      }}
                      className={`group/cat p-1.5 text-center font-bold border-r border-b-2 transition-all overflow-hidden ${
                        colorTheme.border
                      } ${colorTheme.headerBg} ${
                        draggedCatIdx === catIdx ? 'opacity-50' : ''
                      } ${isDragOverCat ? 'ring-2 ring-inset ring-blue-500' : ''}`}
                    >
                      <div className="flex items-center justify-center px-1 gap-0.5 min-w-0">
                        {categories.length > 1 && (
                          <button
                            type="button"
                            disabled={catIdx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveCategory(catIdx, catIdx - 1);
                            }}
                            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 disabled:pointer-events-none text-current opacity-60 group-hover/cat:opacity-100 transition-opacity cursor-pointer shrink-0"
                            title={`Mover categoría "${cat.name}" y sus subcolumnas hacia la izquierda`}
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                        )}

                        {categories.length > 1 && (
                          <span
                            className="cursor-grab active:cursor-grabbing opacity-40 group-hover/cat:opacity-80 transition-opacity shrink-0 hidden sm:inline"
                            title="Arrastrá para cambiar de lugar esta Categoría Mayor con todas sus subcolumnas"
                          >
                            <GripVertical className="w-3 h-3" />
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setCategoryToEdit(cat);
                            setEditCatName(cat.name);
                            setEditCatColor(cat.color);
                          }}
                          className="text-[11px] uppercase tracking-wide font-extrabold truncate hover:underline cursor-pointer transition-opacity hover:opacity-80 min-w-0"
                          title={`Hacé clic para editar, ordenar subcolumnas o eliminar "${cat.name}"`}
                        >
                          {cat.name}
                        </button>

                        {/* Add Subcategory / Column button (+ solamente) */}
                        <button
                          type="button"
                          onClick={() => setAddingSubcatForCatId(cat.id)}
                          className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                          title={`Agregar columna a "${cat.name}"`}
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        </button>

                        {categories.length > 1 && (
                          <button
                            type="button"
                            disabled={catIdx === categories.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveCategory(catIdx, catIdx + 1);
                            }}
                            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 disabled:pointer-events-none text-current opacity-60 group-hover/cat:opacity-100 transition-opacity cursor-pointer shrink-0"
                            title={`Mover categoría "${cat.name}" y sus subcolumnas hacia la derecha`}
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}

                {/* Preliminary Valuation Col (TEA / TEP) if enabled */}
                {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                  <th
                    rowSpan={headerRowSpan}
                    className={`p-2 font-extrabold text-center uppercase tracking-wider text-[10px] border-l relative select-none overflow-hidden ${
                      isDarkMode
                        ? 'bg-amber-950/40 text-amber-300 border-slate-800'
                        : 'bg-amber-50/80 text-amber-900 border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setIsPreliminaryModalOpen(true)}
                      className="inline-flex flex-col items-center hover:opacity-80 transition-opacity cursor-pointer mx-auto max-w-full"
                      title="Haz clic para editar la Valoración Preliminar (TEA / TEP)"
                    >
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 max-w-full">
                        <ClipboardCheck className="w-3 h-3 shrink-0" />
                        <span className="truncate">Preliminar</span>
                      </div>
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 opacity-90 mt-0.5 truncate">
                        (TEA/TEP)
                      </div>
                    </button>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(e) => startColumnResize(e, '__prelim__', 'prelim')}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleResetSingleColWidth('__prelim__');
                      }}
                      className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                      title="Arrastrá para ajustar el ancho de esta columna (doble clic para restablecer)"
                    />
                  </th>
                )}

                {/* Final Grade Col */}
                <th
                  rowSpan={headerRowSpan}
                  className={`p-2 font-extrabold text-center uppercase tracking-wider text-[10px] relative select-none overflow-hidden ${
                    isDarkMode
                      ? 'bg-blue-950/40 text-blue-300 border-l border-slate-800'
                      : 'bg-blue-50 text-blue-800 border-l border-neutral-200'
                  }`}
                >
                  <div className="flex flex-col items-center justify-center gap-1 min-w-0">
                    <span className="truncate max-w-full" title="Calificación Final">
                      Nota Final
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        saveOverallCalc(
                          overallCalculation === 'manual_final'
                            ? 'average_of_categories'
                            : 'manual_final'
                        )
                      }
                      className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] normal-case tracking-normal transition-all cursor-pointer shadow-2xs max-w-full ${
                        overallCalculation === 'manual_final'
                          ? 'bg-purple-600 hover:bg-purple-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                      title="Hacé clic para alternar entre Promedio (con posibilidad de editar la nota manualmente) y Criterio docente"
                    >
                      {overallCalculation === 'manual_final' ? (
                        <>
                          <UserCheck className="w-3 h-3 shrink-0" />
                          <span className="truncate">Criterio</span>
                        </>
                      ) : (
                        <>
                          <Calculator className="w-3 h-3 shrink-0" />
                          <span className="truncate">Promedio</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(e) => startColumnResize(e, '__final__', 'final')}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleResetSingleColWidth('__final__');
                    }}
                    className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                    title="Arrastrá para ajustar el ancho de esta columna (doble clic para restablecer)"
                  />
                </th>
              </tr>

              {/* ROW 2: Subcategories / Evaluations Header (spans 1 + N intensifications when split) */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
                {categories.map((cat) => {
                  if (cat.subcategories.length === 0) {
                    return (
                      <th
                        key={`${cat.id}-empty`}
                        rowSpan={hasAnyIntensifications ? 2 : 1}
                        onDragOver={(e) => {
                          if (draggedSubcat && draggedSubcat.catId !== cat.id) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggedSubcat && draggedSubcat.catId !== cat.id) {
                            handleMoveSubcategoryToCategory(
                              draggedSubcat.catId,
                              draggedSubcat.subId,
                              cat.id,
                              0
                            );
                          }
                          setDraggedSubcat(null);
                          setDragOverSubcat(null);
                        }}
                        className={`p-1.5 text-center font-medium border-r text-[11px] relative select-none overflow-hidden ${
                          isDarkMode ? 'border-slate-800 text-slate-400' : 'border-neutral-200 text-neutral-500'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-0.5 pr-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryToEdit(cat);
                              setEditCatName(cat.name);
                              setEditCatColor(cat.color);
                            }}
                            className="hover:underline cursor-pointer transition-opacity hover:opacity-80 truncate"
                            title={`Nota General — Hacé clic para editar o eliminar "${cat.name}"`}
                          >
                            Nota
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center cursor-pointer shrink-0"
                            title={`Agregar subcolumna a "${cat.name}"`}
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(e) => startColumnResize(e, cat.id, 'grade')}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleResetSingleColWidth(cat.id);
                          }}
                          className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                          title="Arrastrá para ajustar el ancho de esta columna (doble clic para restablecer)"
                        />
                      </th>
                    );
                  }

                  return (
                    <React.Fragment key={`${cat.id}-subs`}>
                      {cat.subcategories.map((sub, subIdx) => {
                        const instList = sub.intensifications || [];
                        const hasInsts = instList.length > 0;
                        const colW = getColWidth(sub.id, 'grade');
                        const totalGroupW = hasInsts
                          ? colW + instList.reduce((acc, inst) => acc + getColWidth(inst.id, 'grade'), 0)
                          : colW;
                        const showInlineArrows = cat.subcategories.length > 1 && totalGroupW >= 88;
                        const isDraggingThisSub =
                          draggedSubcat?.catId === cat.id && draggedSubcat?.subId === sub.id;
                        const isDragOverThisSub =
                          dragOverSubcat?.catId === cat.id &&
                          dragOverSubcat?.subIdx === subIdx &&
                          !isDraggingThisSub;

                        return (
                          <th
                            key={sub.id}
                            colSpan={hasInsts ? 1 + instList.length : 1}
                            rowSpan={hasInsts ? 1 : hasAnyIntensifications ? 2 : 1}
                            draggable={!isResizingColumn}
                            onDragStart={(e) => {
                              if (isResizingColumn) {
                                e.preventDefault();
                                return;
                              }
                              e.stopPropagation();
                              setDraggedSubcat({ catId: cat.id, subId: sub.id, subIdx });
                              setDraggedCatIdx(null);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', `sub:${cat.id}:${sub.id}`);
                            }}
                            onDragOver={(e) => {
                              if (draggedSubcat) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = 'move';
                                if (
                                  dragOverSubcat?.catId !== cat.id ||
                                  dragOverSubcat?.subIdx !== subIdx
                                ) {
                                  setDragOverSubcat({ catId: cat.id, subIdx });
                                }
                              }
                            }}
                            onDragLeave={() => {
                              if (
                                dragOverSubcat?.catId === cat.id &&
                                dragOverSubcat?.subIdx === subIdx
                              ) {
                                setDragOverSubcat(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (draggedSubcat) {
                                if (draggedSubcat.catId === cat.id) {
                                  if (draggedSubcat.subIdx !== subIdx) {
                                    handleMoveSubcategory(cat.id, draggedSubcat.subIdx, subIdx);
                                  }
                                } else {
                                  handleMoveSubcategoryToCategory(
                                    draggedSubcat.catId,
                                    draggedSubcat.subId,
                                    cat.id,
                                    subIdx
                                  );
                                }
                              }
                              setDraggedSubcat(null);
                              setDragOverSubcat(null);
                            }}
                            onDragEnd={() => {
                              setDraggedSubcat(null);
                              setDragOverSubcat(null);
                            }}
                            className={`group/sub p-1.5 text-center font-medium border-r text-[11px] transition-all relative select-none overflow-hidden ${
                              isDarkMode ? 'border-slate-800 text-slate-300' : 'border-neutral-200 text-neutral-700'
                            } ${isDraggingThisSub ? 'opacity-45' : ''} ${
                              isDragOverThisSub ? 'ring-2 ring-inset ring-blue-500 bg-blue-500/10' : ''
                            }`}
                          >
                            <div className="flex items-center justify-center gap-0.5 pr-1 text-center min-w-0">
                              {showInlineArrows && (
                                <button
                                  type="button"
                                  disabled={subIdx === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveSubcategory(cat.id, subIdx, subIdx - 1);
                                  }}
                                  className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 disabled:opacity-15 disabled:pointer-events-none text-neutral-500 dark:text-slate-400 opacity-50 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la izquierda (antes)`}
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                  setEditSubcatName(sub.name);
                                }}
                                className="font-semibold inline-flex items-center justify-center gap-1 text-center hover:underline hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors min-w-0 max-w-full"
                                title={`${sub.name} — Hacé clic para editar, agregar ${intensificationLabel.toLowerCase()} / recuperación o importar notas`}
                              >
                                {(sub.name.toLowerCase().includes('disposición') ||
                                  sub.name.toLowerCase().includes('disposicion')) && (
                                  <Award className="w-3 h-3 text-amber-500 shrink-0" />
                                )}
                                <span className="truncate">{sub.name}</span>
                              </button>

                              {showInlineArrows && (
                                <button
                                  type="button"
                                  disabled={subIdx === cat.subcategories.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveSubcategory(cat.id, subIdx, subIdx + 1);
                                  }}
                                  className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 disabled:opacity-15 disabled:pointer-events-none text-neutral-500 dark:text-slate-400 opacity-50 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la derecha (después)`}
                                >
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Column resize handle (only when unsplit; split sub-columns have their own handles in Row 3) */}
                            {!hasInsts && (
                              <div
                                role="separator"
                                aria-orientation="vertical"
                                draggable={false}
                                onMouseDown={(e) => startColumnResize(e, sub.id, 'grade')}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleResetSingleColWidth(sub.id);
                                }}
                                className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                                title="Arrastrá para ajustar el ancho de esta columna (doble clic para restablecer)"
                              />
                            )}
                          </th>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tr>

              {/* ROW 3: Split Sub-headers for evaluations that have Intensification / Recuperación instances */}
              {hasAnyIntensifications && (
                <tr className={`border-b ${isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-neutral-50/80 border-neutral-200'}`}>
                  {categories.map((cat) =>
                    cat.subcategories.map((sub) => {
                      const instList = sub.intensifications || [];
                      if (instList.length === 0) return null;
                      return (
                        <React.Fragment key={`${sub.id}-split-row`}>
                          {/* Original Exam Sub-header */}
                          <th
                            className={`py-1 px-1.5 text-center font-semibold border-r text-[10px] relative select-none overflow-hidden ${
                              isDarkMode
                                ? 'border-slate-800 text-slate-400 bg-slate-900'
                                : 'border-neutral-200 text-neutral-600 bg-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                setEditSubcatName(sub.name);
                              }}
                              className="w-full truncate hover:underline hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer pr-1"
                              title={`Nota original de "${sub.name}" — Hacé clic para editar o importar`}
                            >
                              Nota
                            </button>
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              onMouseDown={(e) => startColumnResize(e, sub.id, 'grade')}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleResetSingleColWidth(sub.id);
                              }}
                              className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                              title="Arrastrá para ajustar el ancho de esta subcolumna (doble clic para restablecer)"
                            />
                          </th>

                          {/* Intensification / Recuperación Sub-headers */}
                          {instList.map((inst) => {
                            const fullLabel = getIntensificationDisplayLabel(sub, inst);
                            return (
                              <th
                                key={inst.id}
                                className={`py-1 px-1.5 text-center font-bold border-r text-[10px] relative select-none overflow-hidden ${
                                  isDarkMode
                                    ? 'border-slate-800 bg-amber-950/35 text-amber-300'
                                    : 'border-neutral-200 bg-amber-50/90 text-amber-900'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setIntensificationToEdit({
                                      catId: cat.id,
                                      subId: sub.id,
                                      instId: inst.id,
                                    })
                                  }
                                  className="w-full flex flex-col items-center justify-center hover:underline cursor-pointer pr-1 min-w-0"
                                  title={`${fullLabel} — Hacé clic para renombrar, especificar detalle o importar notas`}
                                >
                                  <span className="truncate max-w-full leading-tight">
                                    {inst.name}
                                  </span>
                                  {inst.customTitle && (
                                    <span className="text-[9px] font-medium opacity-75 truncate max-w-full leading-tight">
                                      {inst.customTitle}
                                    </span>
                                  )}
                                </button>
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  onMouseDown={(e) => startColumnResize(e, inst.id, 'grade')}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleResetSingleColWidth(inst.id);
                                  }}
                                  className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                                  title="Arrastrá para ajustar el ancho de esta subcolumna (doble clic para restablecer)"
                                />
                              </th>
                            );
                          })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tr>
              )}
            </thead>

            {/* TABLE BODY: Students Rows */}
            <tbody className="divide-y divide-neutral-200 dark:divide-slate-800">
              {students.length === 0 ? (
                <tr>
                  <td
                    colSpan={20}
                    className="p-8 text-center text-xs text-neutral-500 dark:text-slate-400"
                  >
                    No hay estudiantes cargados en este curso.
                  </td>
                </tr>
              ) : (
                students.map((student, idx) => (
                  <GradebookStudentRow
                    key={student.id}
                    student={student}
                    idx={idx}
                    studentGrades={draftGradesMap[student.id] || EMPTY_STUDENT_GRADES}
                    categories={categories}
                    isDarkMode={isDarkMode}
                    overallCalculation={overallCalculation}
                    finalScore={getFinalScore(student.id)}
                    autoAverageScore={getAutoAverageScore(student.id)}
                    preliminaryValuation={activePreliminaryValuation}
                    onScoreChange={handleScoreChange}
                    onCellBlur={flushPendingGradesSave}
                    onCellKeyDown={handleGradeCellKeyDown}
                    onOpenPreliminaryModal={handleOpenPreliminaryModal}
                    onSelectStudent={handleOpenStudentBreakdown}
                    onDeleteStudent={onDeleteStudent}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Info / Legend */}
      <div
        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
          isDarkMode ? 'bg-slate-900/60 border-slate-800 text-slate-400' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-neutral-700 dark:text-slate-300">Criterio Pedagógico:</span>
          <span>• Puedes ingresar notas numéricas (1 al 10 con decimales) o conceptuales.</span>
          <span>• Si una categoría o la nota final está en modo manual, eres libre de ponderar según tu criterio.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Aprobado (≥ 7)
          </span>
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Regular (6)
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Desaprobado (&lt; 6)
          </span>
          {hasAnyIntensifications && (
            <span className="flex items-center gap-1 font-bold text-slate-600 dark:text-slate-300">
              <span className="px-1.5 py-0.5 rounded bg-neutral-200/80 dark:bg-slate-800 text-[10px]">
                NI
              </span>{' '}
              No intensifica (≥ 7 por defecto, editable) · Las intensificaciones no afectan el promedio
            </span>
          )}
        </div>
      </div>

      <GradebookCategoryModals
        isDarkMode={isDarkMode}
        categories={categories}
        categoryToDelete={categoryToDelete}
        setCategoryToDelete={setCategoryToDelete}
        confirmDeleteCategory={confirmDeleteCategory}
        categoryToEdit={categoryToEdit}
        setCategoryToEdit={setCategoryToEdit}
        editCatName={editCatName}
        setEditCatName={setEditCatName}
        editCatColor={editCatColor}
        setEditCatColor={setEditCatColor}
        handleSaveEditCategory={handleSaveEditCategory}
        isManageCategoriesOpen={isManageCategoriesOpen}
        setIsManageCategoriesOpen={setIsManageCategoriesOpen}
        newCatName={newCatName}
        setNewCatName={setNewCatName}
        handleAddCategory={handleAddCategory}
        subcatToEdit={subcatToEdit}
        setSubcatToEdit={setSubcatToEdit}
        editSubcatName={editSubcatName}
        setEditSubcatName={setEditSubcatName}
        handleSaveEditSubcategory={handleSaveEditSubcategory}
        handleDeleteSubcategory={handleDeleteSubcategory}
        onMoveCategory={handleMoveCategory}
        onMoveSubcategory={handleMoveSubcategory}
        onMoveSubcategoryToCategory={handleMoveSubcategoryToCategory}
        intensificationDefaultLabel={intensificationLabel}
        onUpdateDefaultIntensificationLabel={(nextLabel) =>
          updateTerminology({ intensificationLabel: nextLabel })
        }
        onAddIntensification={handleAddIntensification}
        intensificationToEdit={intensificationToEdit}
        setIntensificationToEdit={setIntensificationToEdit}
        onUpdateIntensification={handleUpdateIntensification}
        onDeleteIntensification={handleDeleteIntensification}
        onMoveIntensification={handleMoveIntensification}
        onImportIntoColumn={(target, source) => {
          setImportTargetColumn(target);
          if (source === 'forms') {
            setIsImportModalOpen(false);
            setIsFormsModalOpen(true);
          } else {
            setImportSourceType(source);
            setIsFormsModalOpen(false);
            setIsImportModalOpen(true);
          }
        }}
      />
      {/* Modal: Generar Valoración Preliminar (TEA / TEP) */}
      {isPreliminaryModalOpen && (
        <Suspense fallback={null}>
          <PreliminaryValuationModal
            isOpen={isPreliminaryModalOpen}
            onClose={() => setIsPreliminaryModalOpen(false)}
            courseId={courseId}
            courseName={courseName}
            term={is2c ? '2c' : '1c'}
            students={students}
            categories={categories}
            gradesMap={gradesMap}
            isDarkMode={isDarkMode}
            savedValuation={activePreliminaryValuation}
            onSaveValuation={handleSavePreliminaryValuation}
            driveFolderId={driveFolderId}
          />
        </Suspense>
      )}

      {/* Modal: Importar Evaluación o Notas con Verificación Previa */}
      {isImportModalOpen && (
        <Suspense fallback={null}>
          <ImportGradesModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            courseId={courseId}
            courseName={courseName}
            students={students}
            categories1c={categories1c}
            categories2c={categories2c}
            gradesMap1c={gradesMap1c}
            gradesMap2c={gradesMap2c}
            currentTerm={is2c ? '2c' : '1c'}
            isDarkMode={isDarkMode}
            initialSourceType={importSourceType}
            importContext="grades"
            onApplyGrades={handleApplyImportedGrades}
            onApplyMultiImport={handleApplyMultiImport}
            historyEntries={gradeHistory}
            initialTargetColumn={importTargetColumn}
            onSwitchToForms={(selectedTargetCol) => {
              if (selectedTargetCol !== undefined) {
                setImportTargetColumn(selectedTargetCol);
              }
              setIsImportModalOpen(false);
              setIsFormsModalOpen(true);
            }}
          />
        </Suspense>
      )}

      {/* Modal: Subir Evaluación de Google Forms con Detección de Alumnos, Puntaje y Columna Destino */}
      {isFormsModalOpen && (
        <Suspense fallback={null}>
          <ImportGoogleFormsModal
            isOpen={isFormsModalOpen}
            onClose={() => setIsFormsModalOpen(false)}
            courseId={courseId}
            courseName={courseName}
            students={students}
            categories1c={categories1c}
            categories2c={categories2c}
            gradesMap1c={gradesMap1c}
            gradesMap2c={gradesMap2c}
            currentTerm={is2c ? '2c' : '1c'}
            isDarkMode={isDarkMode}
            onApplyMultiImport={handleApplyMultiImport}
            initialTargetColumn={importTargetColumn}
          />
        </Suspense>
      )}
        </>
      )}

      {/* Modal: Desglose de Calificaciones por Alumno (1°C, 2°C o Ambos en tabla) */}
      <StudentGradeBreakdownModal
        student={selectedBreakdownStudent}
        students={students}
        onSelectStudent={setSelectedBreakdownStudent}
        courseName={courseName}
        isDarkMode={isDarkMode}
        initialPeriod={breakdownInitialPeriod}
        categories1c={categories1c}
        categories2c={categories2c}
        gradesMap1c={currentTerm === '1c' ? draftGradesMap : gradesMap1c}
        gradesMap2c={currentTerm === '2c' ? draftGradesMap : gradesMap2c}
        score1cMap={score1cMap}
        score2cMap={score2cMap}
        annualOverrides={annualOverrides}
      />
    </div>
  );
};
export default GradebookMatrix;
