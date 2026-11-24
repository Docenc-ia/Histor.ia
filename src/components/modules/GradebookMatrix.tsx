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
  Layers,
} from 'lucide-react';
import { Student } from '../../types';
import {
  EvaluationInstancesCombineMode,
  GradeCategory,
  GradeEvaluationInstance,
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
  convertScoreFrom100ToGeneral,
  getScoreColorClass as computeScoreColorClass,
  getEffectiveIntensificationCell,
  getEvaluationInstanceDisplayLabel,
  getIntensificationDisplayLabel,
  getIntensificationPassingThreshold,
  getPrimaryInstanceDisplayLabel,
  getPrimaryInstanceLabel,
  getSumGroupPeers,
  isExemptMarkerValue,
  normalizeScoreWithResolvedScale,
  normalizeSubcategoryScoreForAverage,
  parseGradeNumber,
  reorderCategoriesList,
  reorderSubcategoriesInCategory,
  moveSubcategoryAcrossCategories,
  resolveInstanceScale,
  resolveSubcategoryScale,
} from '../../utils/gradeCalculations';
import { useTerminologySettings } from '../../utils/terminologySettings';
import { useGradebookSync, GradebookTerm } from '../../hooks/useGradebookSync';
import {
  GradebookCategoryModals,
  SubcategoryScaleEditPayload,
} from './GradebookCategoryModals';
import { GradebookScaleSettingsModal } from './GradebookScaleSettingsModal';
import { GradeScaleSettings } from '../../types/grades';
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
  generalGradeScale: GradeScaleSettings;
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
    generalGradeScale,
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
    const getScoreColorClass = (
      valStr: string,
      scaleOverride?: Parameters<typeof computeScoreColorClass>[2]
    ) => computeScoreColorClass(valStr, isDarkMode, scaleOverride);

    return (
      <tr
        className={`group transition-colors ${
          isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-neutral-50/80'
        }`}
      >
        {/* Student Name (Sticky on horizontal scroll, clickable for breakdown) */}
        <td
          className={`sticky left-0 z-10 py-2 px-2.5 border-r-[3px] font-medium transition-colors shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] overflow-hidden ${
            isDarkMode
              ? 'bg-slate-900 group-hover:bg-slate-800 border-r-slate-500 text-slate-200'
              : 'bg-white group-hover:bg-neutral-50 border-r-slate-400 text-neutral-800'
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
          const catRightBorder = isDarkMode
            ? 'border-r-[3px] border-r-slate-500'
            : 'border-r-[3px] border-r-slate-400';

          if (cat.subcategories.length === 0) {
            const val = studentGrades[cat.id] || '';
            const thisColIdx = runningColIdx++;
            return (
              <td
                key={cat.id}
                data-pii="student"
                className={`p-1 text-center overflow-hidden ${catRightBorder}`}
              >
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
              {cat.subcategories.map((sub, subIdx) => {
                const val = studentGrades[sub.id] || '';
                const thisColIdx = runningColIdx++;
                const evalInstances = sub.instances || [];
                const instList = sub.intensifications || [];
                const hasEvalInstances = evalInstances.length > 0;
                const hasInsts = instList.length > 0;
                const isGrouped = hasEvalInstances || hasInsts;
                const isLastSubInCat = subIdx === cat.subcategories.length - 1;
                const resolvedScale = resolveSubcategoryScale(sub, generalGradeScale);
                const parsedSubVal = parseGradeNumber(val);

                const groupLeftBorder = isGrouped
                  ? hasEvalInstances
                    ? isDarkMode
                      ? 'border-l-[3px] border-l-indigo-500'
                      : 'border-l-[3px] border-l-indigo-400'
                    : isDarkMode
                    ? 'border-l-[3px] border-l-amber-500'
                    : 'border-l-[3px] border-l-amber-400'
                  : '';

                const groupRightBorder = isLastSubInCat
                  ? catRightBorder
                  : isGrouped
                  ? hasEvalInstances
                    ? isDarkMode
                      ? 'border-r-[3px] border-r-indigo-500'
                      : 'border-r-[3px] border-r-indigo-400'
                    : isDarkMode
                    ? 'border-r-[3px] border-r-amber-500'
                    : 'border-r-[3px] border-r-amber-400'
                  : isDarkMode
                  ? 'border-r border-r-slate-800'
                  : 'border-r border-r-neutral-200';

                const innerGroupBorder = hasEvalInstances
                  ? isDarkMode
                    ? 'border-r border-dashed border-r-indigo-700/70'
                    : 'border-r border-dashed border-r-indigo-300'
                  : isDarkMode
                  ? 'border-r border-dashed border-r-amber-700/70'
                  : 'border-r border-dashed border-r-amber-300';

                let cellTooltip: string | undefined;
                const primaryLabelPrefix = hasEvalInstances
                  ? `${getPrimaryInstanceDisplayLabel(sub)} · `
                  : '';
                if (resolvedScale.mode === 'convert_100') {
                  cellTooltip = `${primaryLabelPrefix}Escala 0–100 → pasa automáticamente a escala sobre ${generalGradeScale.maxScore} al confirmar`;
                } else if (resolvedScale.mode === 'sum_group' && sub.sumGroupId) {
                  const peers = getSumGroupPeers(categories, sub.sumGroupId);
                  const peerNames = peers
                    .filter((p) => p.subcategory.id !== sub.id)
                    .map((p) => p.subcategory.name);
                  const groupSum = peers.reduce((acc, p) => {
                    const n = parseGradeNumber(studentGrades[p.subcategory.id]);
                    return acc + (n !== null ? n : 0);
                  }, 0);
                  const groupMax = peers.reduce(
                    (acc, p) => acc + resolveSubcategoryScale(p.subcategory, generalGradeScale).maxScore,
                    0
                  );
                  cellTooltip =
                    peerNames.length > 0
                      ? `${primaryLabelPrefix}Escala ${resolvedScale.minScore}–${resolvedScale.maxScore} (aprueba ≥ ${resolvedScale.passingScore}) · Suma con ${peerNames.join(' + ')} (${groupSum.toFixed(1).replace(/\.0$/, '')} / ${groupMax})`
                      : `${primaryLabelPrefix}Escala ${resolvedScale.minScore}–${resolvedScale.maxScore} (aprueba ≥ ${resolvedScale.passingScore})`;
                } else if (resolvedScale.mode === 'custom') {
                  const normalizedForAvg =
                    parsedSubVal !== null && resolvedScale.convertToGeneralOnAverage
                      ? normalizeSubcategoryScoreForAverage(parsedSubVal, sub, generalGradeScale)
                      : null;
                  cellTooltip =
                    normalizedForAvg !== null && resolvedScale.maxScore !== generalGradeScale.maxScore
                      ? `${primaryLabelPrefix}Escala ${resolvedScale.minScore}–${resolvedScale.maxScore} (aprueba ≥ ${resolvedScale.passingScore}) · Equivale a ${normalizedForAvg.toFixed(1).replace(/\.0$/, '')} / ${generalGradeScale.maxScore} en el promedio`
                      : `${primaryLabelPrefix}Escala ${resolvedScale.minScore}–${resolvedScale.maxScore} (aprueba ≥ ${resolvedScale.passingScore})`;
                } else if (hasEvalInstances) {
                  cellTooltip = `${getPrimaryInstanceDisplayLabel(sub)} — Instancia principal (para todos los alumnos)`;
                }

                const primaryTdBg = hasEvalInstances
                  ? isDarkMode
                    ? 'bg-indigo-950/20'
                    : 'bg-indigo-50/40'
                  : hasInsts
                  ? isDarkMode
                    ? 'bg-amber-950/15'
                    : 'bg-amber-50/25'
                  : '';

                const primaryTdRightBorder = isGrouped ? innerGroupBorder : groupRightBorder;

                return (
                  <React.Fragment key={sub.id}>
                    <td
                      data-pii="student"
                      className={`p-1 text-center overflow-hidden ${primaryTdBg} ${groupLeftBorder} ${primaryTdRightBorder}`}
                    >
                      <input
                        type="text"
                        data-grade-row={idx}
                        data-grade-col={thisColIdx}
                        value={val}
                        onChange={(e) => onScoreChange(student.id, sub.id, e.target.value)}
                        onBlur={() => {
                          if (resolvedScale.mode === 'convert_100') {
                            const converted = convertScoreFrom100ToGeneral(val, generalGradeScale);
                            if (converted !== null && converted !== val) {
                              onScoreChange(student.id, sub.id, converted);
                            }
                          }
                          onCellBlur();
                        }}
                        onKeyDown={(e) => onCellKeyDown(e, idx, thisColIdx)}
                        placeholder="-"
                        title={cellTooltip}
                        className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                          hasEvalInstances
                            ? isDarkMode
                              ? 'bg-slate-800/80 border-indigo-700/60 focus:border-indigo-400'
                              : 'bg-white border-indigo-200 focus:border-indigo-500'
                            : isDarkMode
                            ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                            : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                        } ${getScoreColorClass(val, resolvedScale)}`}
                      />
                    </td>

                    {/* Extra Evaluation Instances (for ALL students, included in averages) */}
                    {evalInstances.map((evalInst, evalInstIdx) => {
                      const evalColIdx = runningColIdx++;
                      const evalVal = studentGrades[evalInst.id] || '';
                      const instScale = resolveInstanceScale(sub, evalInst, generalGradeScale);
                      const parsedEvalVal = parseGradeNumber(evalVal);
                      const isLastColOfSub =
                        evalInstIdx === evalInstances.length - 1 && instList.length === 0;
                      const evalTdRightBorder = isLastColOfSub
                        ? groupRightBorder
                        : innerGroupBorder;

                      let evalTooltip = `${getEvaluationInstanceDisplayLabel(sub, evalInst)} — Instancia de evaluación (para todos los alumnos)`;
                      if (instScale.mode === 'convert_100') {
                        evalTooltip += ` · Escala 0–100 → sobre ${generalGradeScale.maxScore}`;
                      } else if (instScale.isCustom) {
                        const norm =
                          parsedEvalVal !== null && instScale.convertToGeneralOnAverage
                            ? normalizeScoreWithResolvedScale(
                                parsedEvalVal,
                                instScale,
                                generalGradeScale
                              )
                            : null;
                        evalTooltip +=
                          norm !== null && instScale.maxScore !== generalGradeScale.maxScore
                            ? ` · Escala ${instScale.minScore}–${instScale.maxScore} (aprueba ≥ ${instScale.passingScore}, equiv. ${norm.toFixed(1).replace(/\.0$/, '')}/${generalGradeScale.maxScore})`
                            : ` · Escala ${instScale.minScore}–${instScale.maxScore} (aprueba ≥ ${instScale.passingScore})`;
                      }

                      return (
                        <td
                          key={evalInst.id}
                          data-pii="student"
                          className={`p-1 text-center overflow-hidden ${
                            isDarkMode ? 'bg-indigo-950/20' : 'bg-indigo-50/40'
                          } ${evalTdRightBorder}`}
                        >
                          <input
                            type="text"
                            data-grade-row={idx}
                            data-grade-col={evalColIdx}
                            value={evalVal}
                            onChange={(e) => onScoreChange(student.id, evalInst.id, e.target.value)}
                            onBlur={() => {
                              if (instScale.mode === 'convert_100') {
                                const converted = convertScoreFrom100ToGeneral(
                                  evalVal,
                                  generalGradeScale
                                );
                                if (converted !== null && converted !== evalVal) {
                                  onScoreChange(student.id, evalInst.id, converted);
                                }
                              }
                              onCellBlur();
                            }}
                            onKeyDown={(e) => onCellKeyDown(e, idx, evalColIdx)}
                            placeholder="-"
                            title={evalTooltip}
                            className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                              isDarkMode
                                ? 'bg-slate-800/80 border-indigo-700/60 focus:border-indigo-400'
                                : 'bg-white border-indigo-200 focus:border-indigo-500'
                            } ${getScoreColorClass(evalVal, instScale)}`}
                          />
                        </td>
                      );
                    })}

                    {/* Intensification / Recuperación sub-columns */}
                    {instList.map((inst, instIdx) => {
                      const instColIdx = runningColIdx++;
                      const rawInstVal = studentGrades[inst.id] || '';
                      const effective = getEffectiveIntensificationCell(
                        sub,
                        instIdx,
                        studentGrades
                      );
                      const isShowingExempt = effective.isExempt;
                      const isLegacyOrDefaultExempt =
                        effective.isDefaultExempt &&
                        (rawInstVal.trim() === '' || isExemptMarkerValue(rawInstVal));
                      const displayInputVal = isLegacyOrDefaultExempt
                        ? ''
                        : isExemptMarkerValue(rawInstVal)
                        ? INTENSIFICATION_EXEMPT_LABEL
                        : rawInstVal;
                      const tooltipText = isLegacyOrDefaultExempt
                        ? `Aprobado con ${effective.passingScore} (nota mínima: ${effective.threshold}). Queda con línea (—) por defecto; hacé clic y escribí una nota si decidís evaluarlo igual (no promedia).`
                        : isShowingExempt
                        ? `${getIntensificationDisplayLabel(sub, inst)} — Sin instancia pendiente (—). Podés editar o borrar este valor.`
                        : effective.passingScore !== null
                        ? `${getIntensificationDisplayLabel(sub, inst)} — Nota cargada manualmente, fuera del promedio (borrá la celda para volver a —)`
                        : `${getIntensificationDisplayLabel(sub, inst)} — Nota mínima: ${effective.threshold}. Ingresá la calificación (fuera del promedio)`;

                      const isLastColOfSub = instIdx === instList.length - 1;
                      const instTdRightBorder = isLastColOfSub
                        ? groupRightBorder
                        : isDarkMode
                        ? 'border-r border-dashed border-r-amber-700/70'
                        : 'border-r border-dashed border-r-amber-300';

                      return (
                        <td
                          key={inst.id}
                          data-pii="student"
                          className={`p-1 text-center overflow-hidden ${
                            isShowingExempt
                              ? isDarkMode
                                ? 'bg-slate-900/50'
                                : 'bg-neutral-50/70'
                              : isDarkMode
                              ? 'bg-amber-950/20'
                              : 'bg-amber-50/45'
                          } ${instTdRightBorder}`}
                        >
                          <input
                            type="text"
                            data-grade-row={idx}
                            data-grade-col={instColIdx}
                            value={displayInputVal}
                            onChange={(e) => onScoreChange(student.id, inst.id, e.target.value)}
                            onBlur={onCellBlur}
                            onKeyDown={(e) => onCellKeyDown(e, idx, instColIdx)}
                            placeholder={isLegacyOrDefaultExempt ? INTENSIFICATION_EXEMPT_LABEL : ''}
                            title={tooltipText}
                            className={`w-full max-w-[58px] min-w-0 text-center px-1 py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                              isShowingExempt
                                ? isDarkMode
                                  ? 'bg-slate-800/80 border-slate-700 text-slate-400 placeholder:text-slate-400 placeholder:font-bold focus:bg-slate-800 focus:border-amber-400 focus:text-slate-100'
                                  : 'bg-neutral-100 border-neutral-200/90 text-neutral-500 placeholder:text-neutral-500 placeholder:font-bold focus:bg-white focus:border-amber-500 focus:text-neutral-900'
                                : isDarkMode
                                ? 'bg-slate-800/80 border-amber-700/60 focus:border-amber-400'
                                : 'bg-white border-amber-300/80 focus:border-amber-500'
                            } ${
                              isShowingExempt
                                ? ''
                                : getScoreColorClass(
                                    rawInstVal,
                                    resolvedScale.mode === 'custom' ||
                                      resolvedScale.mode === 'sum_group'
                                      ? {
                                          ...resolvedScale,
                                          passingScore: effective.threshold,
                                        }
                                      : undefined
                                  )
                            }`}
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
            className={`p-2 border-l-[3px] text-center font-bold text-xs ${
              isDarkMode ? 'bg-amber-950/20 border-l-slate-500' : 'bg-amber-50/30 border-l-slate-400'
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
          className={`p-1.5 text-center font-extrabold text-sm overflow-hidden ${
            preliminaryValuation && preliminaryValuation.showInMatrix
              ? isDarkMode
                ? 'bg-blue-950/20 border-l-2 border-l-slate-700'
                : 'bg-blue-50/40 border-l-2 border-l-neutral-300'
              : isDarkMode
              ? 'bg-blue-950/20 border-l-[3px] border-l-slate-500'
              : 'bg-blue-50/40 border-l-[3px] border-l-slate-400'
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

  const {
    intensificationLabel,
    intensificationPassingScore,
    generalGradeScale,
    updateTerminology,
  } = useTerminologySettings();

  const hasAnyIntensifications = useMemo(
    () =>
      categories.some((cat) =>
        cat.subcategories.some((sub) => (sub.intensifications?.length || 0) > 0)
      ),
    [categories]
  );

  const hasAnyEvaluationInstances = useMemo(
    () =>
      categories.some((cat) =>
        cat.subcategories.some((sub) => (sub.instances?.length || 0) > 0)
      ),
    [categories]
  );

  const hasAnySplitColumns = hasAnyIntensifications || hasAnyEvaluationInstances;

  const headerRowSpan = hasAnySplitColumns ? 3 : 2;

  const totalTableWidth = useMemo(() => {
    let total = getColWidth('__student__', 'student');
    categories.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        total += getColWidth(cat.id, 'grade');
      } else {
        cat.subcategories.forEach((sub) => {
          total += getColWidth(sub.id, 'grade');
          (sub.instances || []).forEach((evalInst) => {
            total += getColWidth(evalInst.id, 'grade');
          });
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

  // Category Edit state & Scale Settings Modal
  const [categoryToEdit, setCategoryToEdit] = useState<GradeCategory | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  const [isScaleSettingsOpen, setIsScaleSettingsOpen] = useState(false);

  // Subcategory Edit state
  const [subcatToEdit, setSubcatToEdit] = useState<{ catId: string; subId: string; name: string } | null>(null);
  const [editSubcatName, setEditSubcatName] = useState('');

  // Intensification / Recuperación Edit state
  const [intensificationToEdit, setIntensificationToEdit] = useState<{
    catId: string;
    subId: string;
    instId: string;
  } | null>(null);

  // Multi-instance Evaluation Edit state (instanceId === '__primary__' for primary col)
  const [evaluationInstanceToEdit, setEvaluationInstanceToEdit] = useState<{
    catId: string;
    subId: string;
    instanceId: string;
  } | null>(null);

  const [addingSubcatForCatId, setAddingSubcatForCatId] = useState<string | null>(null);
  const [newSubcatName, setNewSubcatName] = useState('');
  const [newSubcatQuickScale, setNewSubcatQuickScale] = useState<'general' | 'scale_5' | 'scale_100'>('general');
  const [newSubcatUseInstances, setNewSubcatUseInstances] = useState(false);
  const [newSubcatInstanceNames, setNewSubcatInstanceNames] = useState<string[]>([
    'Escrita',
    'Oral',
  ]);
  const [newSubcatCombineMode, setNewSubcatCombineMode] =
    useState<EvaluationInstancesCombineMode>('average');

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

  // Save Edited Subcategory Name, Scale & Sum Group Links
  const handleSaveEditSubcategory = (scalePayload?: SubcategoryScaleEditPayload) => {
    if (!subcatToEdit || !editSubcatName.trim()) return;

    const targetSubId = subcatToEdit.subId;
    const currentSub = categories
      .flatMap((c) => c.subcategories)
      .find((s) => s.id === targetSubId);
    const previousGroupId =
      currentSub?.scaleMode === 'sum_group' ? currentSub.sumGroupId : undefined;

    let nextGroupId: string | undefined;
    const selectedPeerIds = new Set(scalePayload?.sumPeerSubIds || []);

    if (scalePayload?.scaleMode === 'sum_group') {
      if (previousGroupId) {
        nextGroupId = previousGroupId;
      } else {
        // Reuse existing groupId of a selected peer if any
        const existingPeerGroup = categories
          .flatMap((c) => c.subcategories)
          .find(
            (s) => selectedPeerIds.has(s.id) && s.scaleMode === 'sum_group' && s.sumGroupId
          )?.sumGroupId;
        nextGroupId =
          existingPeerGroup ||
          `sum-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    let updated = categories.map((cat) => ({
      ...cat,
      subcategories: cat.subcategories.map((sub) => {
        if (sub.id === targetSubId) {
          if (!scalePayload) {
            return { ...sub, name: editSubcatName.trim() };
          }
          if (scalePayload.scaleMode === 'general') {
            return {
              ...sub,
              name: editSubcatName.trim(),
              scaleMode: 'general' as const,
              minScore: undefined,
              maxScore: generalGradeScale.maxScore,
              passingScore: undefined,
              convertToGeneralOnAverage: undefined,
              sumGroupId: undefined,
            };
          }
          if (scalePayload.scaleMode === 'convert_100') {
            return {
              ...sub,
              name: editSubcatName.trim(),
              scaleMode: 'convert_100' as const,
              minScore: 0,
              maxScore: 100,
              passingScore: undefined,
              convertToGeneralOnAverage: true,
              sumGroupId: undefined,
            };
          }
          if (scalePayload.scaleMode === 'sum_group') {
            return {
              ...sub,
              name: editSubcatName.trim(),
              scaleMode: 'sum_group' as const,
              minScore: scalePayload.minScore,
              maxScore: scalePayload.maxScore,
              passingScore: scalePayload.passingScore,
              convertToGeneralOnAverage: false,
              sumGroupId: nextGroupId,
            };
          }
          return {
            ...sub,
            name: editSubcatName.trim(),
            scaleMode: 'custom' as const,
            minScore: scalePayload.minScore,
            maxScore: scalePayload.maxScore,
            passingScore: scalePayload.passingScore,
            convertToGeneralOnAverage: scalePayload.convertToGeneralOnAverage,
            sumGroupId: undefined,
          };
        }

        // Symmetrically link selected peers into the same sum group
        if (scalePayload?.scaleMode === 'sum_group' && nextGroupId && selectedPeerIds.has(sub.id)) {
          const resolvedPeer = resolveSubcategoryScale(sub, generalGradeScale);
          return {
            ...sub,
            scaleMode: 'sum_group' as const,
            minScore: sub.minScore !== undefined ? sub.minScore : resolvedPeer.minScore,
            maxScore: sub.maxScore !== undefined ? sub.maxScore : resolvedPeer.maxScore,
            passingScore:
              sub.passingScore !== undefined ? sub.passingScore : resolvedPeer.passingScore,
            convertToGeneralOnAverage: false,
            sumGroupId: nextGroupId,
          };
        }

        // Unlink peers that were unchecked from this sum group
        if (
          scalePayload?.scaleMode === 'sum_group' &&
          previousGroupId &&
          sub.scaleMode === 'sum_group' &&
          sub.sumGroupId === previousGroupId &&
          !selectedPeerIds.has(sub.id)
        ) {
          const isCustomMax =
            sub.maxScore !== undefined && sub.maxScore !== generalGradeScale.maxScore;
          return {
            ...sub,
            scaleMode: isCustomMax ? ('custom' as const) : ('general' as const),
            sumGroupId: undefined,
          };
        }

        return sub;
      }),
    }));

    // Clean up orphaned 1-member sum groups if the edited column left a previous group
    if (previousGroupId && (!scalePayload || scalePayload.scaleMode !== 'sum_group')) {
      const remaining = getSumGroupPeers(updated, previousGroupId);
      if (remaining.length === 1) {
        const loneId = remaining[0].subcategory.id;
        updated = updated.map((cat) => ({
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== loneId) return sub;
            const isCustomMax =
              sub.maxScore !== undefined && sub.maxScore !== generalGradeScale.maxScore;
            return {
              ...sub,
              scaleMode: isCustomMax ? ('custom' as const) : ('general' as const),
              sumGroupId: undefined,
            };
          }),
        }));
      }
    }

    saveCategories(updated);
    setSubcatToEdit(null);
  };

  // Convert all existing scores > generalGradeScale.maxScore in a 0-100 column
  const handleConvertSubcat100ToGeneral = useCallback(
    (subId: string): number => {
      let convertedCount = 0;
      const nextMap: StudentGradesMap = { ...draftGradesMap };
      students.forEach((st) => {
        const stGrades = nextMap[st.id];
        if (!stGrades) return;
        const rawVal = stGrades[subId];
        if (!rawVal) return;
        const converted = convertScoreFrom100ToGeneral(rawVal, generalGradeScale);
        if (converted !== null && converted !== rawVal) {
          nextMap[st.id] = { ...stGrades, [subId]: converted };
          convertedCount += 1;
        }
      });
      if (convertedCount > 0) {
        setDraftGradesMap(nextMap);
        saveGrades(nextMap);
      }
      return convertedCount;
    },
    [draftGradesMap, students, generalGradeScale, saveGrades]
  );

  const convertible100CountInSubcat = useMemo(() => {
    if (!subcatToEdit) return 0;
    let count = 0;
    students.forEach((st) => {
      const rawVal = draftGradesMap[st.id]?.[subcatToEdit.subId];
      if (!rawVal) return;
      if (convertScoreFrom100ToGeneral(rawVal, generalGradeScale) !== null) {
        count += 1;
      }
    });
    return count;
  }, [subcatToEdit, students, draftGradesMap, generalGradeScale]);

  // Add Subcategory Handler
  const handleAddSubcategory = (catId: string) => {
    if (!newSubcatName.trim()) return;
    const baseTs = Date.now();
    const cleanedInstances = newSubcatUseInstances
      ? newSubcatInstanceNames.map((n) => n.trim()).filter(Boolean)
      : [];

    const updated = categories.map((cat) => {
      if (cat.id !== catId) return cat;
      let newSub: GradeSubcategory = {
        id: `sub-${baseTs}`,
        name: newSubcatName.trim(),
        maxScore: generalGradeScale.maxScore,
        scaleMode: 'general',
      };
      if (newSubcatQuickScale === 'scale_5') {
        const suggestedPass5 =
          Math.round(((5 * generalGradeScale.passingScore) / generalGradeScale.maxScore) * 10) / 10;
        newSub = {
          ...newSub,
          scaleMode: 'custom',
          minScore: 1,
          maxScore: 5,
          passingScore: suggestedPass5,
          convertToGeneralOnAverage: true,
        };
      } else if (newSubcatQuickScale === 'scale_100') {
        newSub = {
          ...newSub,
          scaleMode: 'convert_100',
          minScore: 0,
          maxScore: 100,
          convertToGeneralOnAverage: true,
        };
      }
      if (cleanedInstances.length >= 2) {
        newSub = {
          ...newSub,
          primaryInstanceName: cleanedInstances[0],
          instancesCombineMode: newSubcatCombineMode,
          instances: cleanedInstances.slice(1).map((instName, idx) => ({
            id: `evinst-${baseTs}-${idx + 1}`,
            name: instName,
          })),
        };
      }
      return {
        ...cat,
        subcategories: [...cat.subcategories, newSub],
      };
    });
    saveCategories(updated);
    setNewSubcatName('');
    setNewSubcatQuickScale('general');
    setNewSubcatUseInstances(false);
    setNewSubcatInstanceNames(['Escrita', 'Oral']);
    setNewSubcatCombineMode('average');
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
    (
      catId: string,
      subId: string,
      name: string,
      customTitle?: string,
      passingScore?: number
    ) => {
      const cleanName = name.trim() || intensificationLabel;
      const resolvedPassingScore =
        typeof passingScore === 'number' &&
        Number.isFinite(passingScore) &&
        passingScore > 0 &&
        passingScore <= 10
          ? Math.round(passingScore * 10) / 10
          : intensificationPassingScore;
      const newInst: GradeIntensification = {
        id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        passingScore: resolvedPassingScore,
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
    [categories, saveCategories, intensificationLabel, intensificationPassingScore]
  );

  // Update Intensification / Recuperación label, specification, or minimum passing score
  const handleUpdateIntensification = useCallback(
    (
      catId: string,
      subId: string,
      instId: string,
      updates: { name: string; customTitle?: string; passingScore?: number }
    ) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            return {
              ...sub,
              intensifications: (sub.intensifications || []).map((inst) => {
                if (inst.id !== instId) return inst;
                const nextPassingScore =
                  typeof updates.passingScore === 'number' &&
                  Number.isFinite(updates.passingScore) &&
                  updates.passingScore > 0 &&
                  updates.passingScore <= 10
                    ? Math.round(updates.passingScore * 10) / 10
                    : inst.passingScore;
                return {
                  ...inst,
                  name: updates.name.trim() || inst.name,
                  customTitle: updates.customTitle?.trim() || undefined,
                  ...(nextPassingScore !== undefined ? { passingScore: nextPassingScore } : {}),
                };
              }),
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

  // Add Multi-Instance Evaluation sub-column (applies to ALL students)
  const handleAddEvaluationInstance = useCallback(
    (
      catId: string,
      subId: string,
      name: string,
      options?: {
        primaryInstanceName?: string;
        customTitle?: string;
        combineMode?: EvaluationInstancesCombineMode;
      }
    ) => {
      const cleanName = name.trim() || 'Instancia';
      const newInstance: GradeEvaluationInstance = {
        id: `evinst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        ...(options?.customTitle?.trim() ? { customTitle: options.customTitle.trim() } : {}),
      };
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const prev = Array.isArray(sub.instances) ? sub.instances : [];
            const nextPrimary =
              options?.primaryInstanceName?.trim() ||
              sub.primaryInstanceName?.trim() ||
              '1° Inst.';
            return {
              ...sub,
              primaryInstanceName: nextPrimary,
              instancesCombineMode:
                options?.combineMode || sub.instancesCombineMode || 'average',
              instances: [...prev, newInstance],
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Update primary instance label or combine mode of a multi-instance evaluation
  const handleUpdateEvaluationInstancesMeta = useCallback(
    (
      catId: string,
      subId: string,
      updates: {
        primaryInstanceName?: string;
        instancesCombineMode?: EvaluationInstancesCombineMode;
      }
    ) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            return {
              ...sub,
              ...(updates.primaryInstanceName !== undefined
                ? { primaryInstanceName: updates.primaryInstanceName.trim() || undefined }
                : {}),
              ...(updates.instancesCombineMode !== undefined
                ? { instancesCombineMode: updates.instancesCombineMode }
                : {}),
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Update an individual extra evaluation instance (name, customTitle, custom scale)
  const handleUpdateEvaluationInstance = useCallback(
    (
      catId: string,
      subId: string,
      instanceId: string,
      updates: {
        name: string;
        customTitle?: string;
        scaleMode?: GradeSubcategory['scaleMode'];
        minScore?: number;
        maxScore?: number;
        passingScore?: number;
        convertToGeneralOnAverage?: boolean;
      }
    ) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            return {
              ...sub,
              instances: (sub.instances || []).map((inst) => {
                if (inst.id !== instanceId) return inst;
                return {
                  ...inst,
                  name: updates.name.trim() || inst.name,
                  customTitle: updates.customTitle?.trim() || undefined,
                  scaleMode: updates.scaleMode === 'general' ? undefined : updates.scaleMode,
                  minScore: updates.minScore,
                  maxScore: updates.maxScore,
                  passingScore: updates.passingScore,
                  convertToGeneralOnAverage: updates.convertToGeneralOnAverage,
                };
              }),
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Delete an extra evaluation instance
  const handleDeleteEvaluationInstance = useCallback(
    (catId: string, subId: string, instanceId: string) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const next = (sub.instances || []).filter((inst) => inst.id !== instanceId);
            return {
              ...sub,
              instances: next.length > 0 ? next : undefined,
              ...(next.length === 0 ? { primaryInstanceName: undefined } : {}),
            };
          }),
        };
      });
      saveCategories(updated);
    },
    [categories, saveCategories]
  );

  // Reorder extra evaluation instances within an evaluation
  const handleMoveEvaluationInstance = useCallback(
    (catId: string, subId: string, fromIndex: number, toIndex: number) => {
      const updated = categories.map((cat) => {
        if (cat.id !== catId) return cat;
        return {
          ...cat,
          subcategories: cat.subcategories.map((sub) => {
            if (sub.id !== subId) return sub;
            const list = [...(sub.instances || [])];
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
              instances: list,
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
                  onClick={() => setIsScaleSettingsOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                  }`}
                  title={`Configurar escala general de calificaciones (actual: ${generalGradeScale.minScore} al ${generalGradeScale.maxScore}, aprueba con ${generalGradeScale.passingScore})`}
                >
                  <Settings className="w-3.5 h-3.5 shrink-0 text-neutral-500 dark:text-slate-400" />
                  <span>Configuración</span>
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

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={isDarkMode ? 'text-slate-400 font-semibold' : 'text-neutral-600 font-semibold'}>
              Escala inicial:
            </span>
            {(
              [
                {
                  id: 'general' as const,
                  label: `General (${generalGradeScale.minScore}–${generalGradeScale.maxScore}, ≥ ${generalGradeScale.passingScore})`,
                },
                { id: 'scale_5' as const, label: 'Sobre 5 (1–5)' },
                { id: 'scale_100' as const, label: `Sobre 100 → /${generalGradeScale.maxScore}` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setNewSubcatQuickScale(opt.id)}
                className={`px-2 py-0.5 rounded-md font-semibold border transition-colors cursor-pointer ${
                  newSubcatQuickScale === opt.id
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'bg-white border-emerald-200 text-emerald-900 hover:bg-emerald-50'
                }`}
              >
                {opt.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setNewSubcatUseInstances((prev) => !prev)}
              className={`ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-semibold border transition-colors cursor-pointer ${
                newSubcatUseInstances
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : isDarkMode
                  ? 'bg-slate-900 border-indigo-500/50 text-indigo-300 hover:bg-indigo-950/40'
                  : 'bg-white border-indigo-300 text-indigo-800 hover:bg-indigo-50'
              }`}
              title="Dividí esta evaluación en dos o más instancias para todos los alumnos (por ejemplo: Escrita y Oral)"
            >
              <Layers className="w-3 h-3 shrink-0" />
              <span>
                {newSubcatUseInstances
                  ? 'Con múltiples instancias ✓'
                  : '+ Agregar instancias (ej. Escrita / Oral)'}
              </span>
            </button>
          </div>

          {newSubcatUseInstances && (
            <div
              className={`p-3 rounded-xl border space-y-2.5 text-xs ${
                isDarkMode
                  ? 'bg-indigo-950/30 border-indigo-700/50 text-indigo-100'
                  : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-[11px]">
                  <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Instancias de esta evaluación (para todos los alumnos)</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="opacity-70">Plantillas:</span>
                  {(
                    [
                      { label: 'Escrita + Oral', vals: ['Escrita', 'Oral'] },
                      { label: 'Teórico + Práctico', vals: ['Teórico', 'Práctico'] },
                      { label: 'Parte 1 + Parte 2', vals: ['Parte 1', 'Parte 2'] },
                    ] as const
                  ).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setNewSubcatInstanceNames([...preset.vals])}
                      className={`px-2 py-0.5 rounded border font-semibold cursor-pointer transition-colors ${
                        isDarkMode
                          ? 'bg-slate-900 border-indigo-700/60 text-indigo-200 hover:bg-indigo-900/50'
                          : 'bg-white border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {newSubcatInstanceNames.map((instName, idx) => (
                  <div key={`new-inst-${idx}`} className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-70">{idx + 1}°</span>
                    <input
                      type="text"
                      value={instName}
                      onChange={(e) =>
                        setNewSubcatInstanceNames((prev) =>
                          prev.map((v, i) => (i === idx ? e.target.value : v))
                        )
                      }
                      placeholder={`Instancia ${idx + 1}`}
                      className={`w-28 px-2 py-1 text-xs rounded-lg border focus:outline-none ${
                        isDarkMode
                          ? 'bg-slate-900 border-indigo-700/70 text-white placeholder-slate-500'
                          : 'bg-white border-indigo-300 text-neutral-900 placeholder-neutral-400'
                      }`}
                    />
                    {newSubcatInstanceNames.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setNewSubcatInstanceNames((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                        title="Quitar instancia"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setNewSubcatInstanceNames((prev) => [...prev, `Instancia ${prev.length + 1}`])
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed text-[11px] font-semibold cursor-pointer transition-colors ${
                    isDarkMode
                      ? 'border-indigo-500/50 text-indigo-300 hover:bg-indigo-950/50'
                      : 'border-indigo-400 text-indigo-800 hover:bg-indigo-100/70'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  <span>Otra instancia</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-0.5">
                <span className="font-semibold opacity-80">Cómo promedian:</span>
                {(
                  [
                    { id: 'average' as const, label: 'Promediar (1 nota)' },
                    { id: 'sum' as const, label: 'Sumar puntajes (ej. 5 + 5 = 10)' },
                    { id: 'separate' as const, label: 'Por separado' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setNewSubcatCombineMode(mode.id)}
                    className={`px-2 py-0.5 rounded-md font-semibold border cursor-pointer transition-colors ${
                      newSubcatCombineMode === mode.id
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : isDarkMode
                        ? 'bg-slate-900 border-indigo-700/60 text-indigo-200 hover:bg-indigo-900/40'
                        : 'bg-white border-indigo-200 text-indigo-800 hover:bg-indigo-50'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!newSubcatUseInstances && (
            <p className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Luego podés hacer clic en el título de la evaluación para personalizar su escala, agregar instancias o sumar intensificaciones.
            </p>
          )}
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
                      {(sub.instances || []).map((evalInst) => (
                        <col
                          key={`col-${evalInst.id}`}
                          style={{ width: `${getColWidth(evalInst.id, 'grade')}px` }}
                        />
                      ))}
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
                  className={`sticky left-0 z-20 p-2.5 font-bold border-r-[3px] uppercase tracking-wider text-[11px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] relative select-none ${
                    isDarkMode
                      ? 'bg-slate-950 border-r-slate-500 text-slate-300'
                      : 'bg-neutral-100 border-r-slate-400 text-neutral-700'
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
                          (acc, sub) =>
                            acc +
                            1 +
                            (sub.instances?.length || 0) +
                            (sub.intensifications?.length || 0),
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
                      className={`group/cat p-1.5 text-center font-bold border-r-[3px] border-b-2 transition-all overflow-hidden ${
                        colorTheme.border
                      } ${
                        isDarkMode ? 'border-r-slate-500' : 'border-r-slate-400'
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
                    className={`p-2 font-extrabold text-center uppercase tracking-wider text-[10px] border-l-[3px] relative select-none overflow-hidden ${
                      isDarkMode
                        ? 'bg-amber-950/40 text-amber-300 border-l-slate-500'
                        : 'bg-amber-50/80 text-amber-900 border-l-slate-400'
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
                    activePreliminaryValuation && activePreliminaryValuation.showInMatrix
                      ? isDarkMode
                        ? 'bg-blue-950/40 text-blue-300 border-l-2 border-l-slate-700'
                        : 'bg-blue-50 text-blue-800 border-l-2 border-l-neutral-300'
                      : isDarkMode
                      ? 'bg-blue-950/40 text-blue-300 border-l-[3px] border-l-slate-500'
                      : 'bg-blue-50 text-blue-800 border-l-[3px] border-l-slate-400'
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

              {/* ROW 2: Subcategories / Evaluations Header (spans 1 + N instances + M intensifications when split) */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
                {categories.map((cat) => {
                  const catRightBorder = isDarkMode
                    ? 'border-r-[3px] border-r-slate-500'
                    : 'border-r-[3px] border-r-slate-400';

                  if (cat.subcategories.length === 0) {
                    return (
                      <th
                        key={`${cat.id}-empty`}
                        rowSpan={hasAnySplitColumns ? 2 : 1}
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
                        className={`p-1.5 text-center font-medium text-[11px] relative select-none overflow-hidden ${catRightBorder} ${
                          isDarkMode ? 'text-slate-400' : 'text-neutral-500'
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
                        const evalInstances = sub.instances || [];
                        const instList = sub.intensifications || [];
                        const hasEvalInstances = evalInstances.length > 0;
                        const hasInsts = instList.length > 0;
                        const isSplit = hasEvalInstances || hasInsts;
                        const isLastSubInCat = subIdx === cat.subcategories.length - 1;
                        const colW = getColWidth(sub.id, 'grade');
                        const totalGroupW = isSplit
                          ? colW +
                            evalInstances.reduce(
                              (acc, ei) => acc + getColWidth(ei.id, 'grade'),
                              0
                            ) +
                            instList.reduce((acc, inst) => acc + getColWidth(inst.id, 'grade'), 0)
                          : colW;
                        const showInlineArrows = cat.subcategories.length > 1 && totalGroupW >= 88;
                        const isDraggingThisSub =
                          draggedSubcat?.catId === cat.id && draggedSubcat?.subId === sub.id;
                        const isDragOverThisSub =
                          dragOverSubcat?.catId === cat.id &&
                          dragOverSubcat?.subIdx === subIdx &&
                          !isDraggingThisSub;

                        const groupHeaderClasses = hasEvalInstances
                          ? isDarkMode
                            ? 'bg-indigo-950/65 text-indigo-200 border-t-2 border-t-indigo-400 border-l-[3px] border-l-indigo-500'
                            : 'bg-indigo-100/85 text-indigo-950 border-t-2 border-t-indigo-500 border-l-[3px] border-l-indigo-400'
                          : hasInsts
                          ? isDarkMode
                            ? 'bg-amber-950/55 text-amber-200 border-t-2 border-t-amber-400 border-l-[3px] border-l-amber-500'
                            : 'bg-amber-100/80 text-amber-950 border-t-2 border-t-amber-500 border-l-[3px] border-l-amber-400'
                          : isDarkMode
                          ? 'text-slate-300'
                          : 'text-neutral-700';

                        const rightEdgeClass = isLastSubInCat
                          ? catRightBorder
                          : isSplit
                          ? hasEvalInstances
                            ? isDarkMode
                              ? 'border-r-[3px] border-r-indigo-500'
                              : 'border-r-[3px] border-r-indigo-400'
                            : isDarkMode
                            ? 'border-r-[3px] border-r-amber-500'
                            : 'border-r-[3px] border-r-amber-400'
                          : isDarkMode
                          ? 'border-r border-r-slate-800'
                          : 'border-r border-r-neutral-200';

                        return (
                          <th
                            key={sub.id}
                            colSpan={1 + evalInstances.length + instList.length}
                            rowSpan={isSplit ? 1 : hasAnySplitColumns ? 2 : 1}
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
                            className={`group/sub p-1.5 text-center font-medium text-[11px] transition-all relative select-none overflow-hidden ${groupHeaderClasses} ${rightEdgeClass} ${
                              isDraggingThisSub ? 'opacity-45' : ''
                            } ${
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
                                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-15 disabled:pointer-events-none text-current opacity-50 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la izquierda (antes)`}
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                              )}

                              {(() => {
                                const subScale = resolveSubcategoryScale(sub, generalGradeScale);
                                const sumPeers =
                                  subScale.mode === 'sum_group' && sub.sumGroupId
                                    ? getSumGroupPeers(categories, sub.sumGroupId).filter(
                                        (p) => p.subcategory.id !== sub.id
                                      )
                                    : [];
                                const scaleHint = subScale.isCustom
                                  ? subScale.mode === 'convert_100'
                                    ? ` · Escala 0–100 → sobre ${generalGradeScale.maxScore}`
                                    : subScale.mode === 'sum_group'
                                    ? ` · Escala ${subScale.minScore}–${subScale.maxScore} (aprueba ≥ ${subScale.passingScore})${
                                        sumPeers.length > 0
                                          ? ` · Suma con ${sumPeers.map((p) => p.subcategory.name).join(' + ')}`
                                          : ''
                                      }`
                                    : ` · Escala ${subScale.minScore}–${subScale.maxScore} (aprueba ≥ ${subScale.passingScore})`
                                  : '';
                                const instancesHint = hasEvalInstances
                                  ? ` · ${1 + evalInstances.length} instancias (${
                                      sub.instancesCombineMode === 'sum'
                                        ? 'suman'
                                        : sub.instancesCombineMode === 'separate'
                                        ? 'por separado'
                                        : 'promedian'
                                    })`
                                  : '';
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                      setEditSubcatName(sub.name);
                                    }}
                                    className="font-semibold inline-flex flex-col items-center justify-center text-center hover:underline hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors min-w-0 max-w-full"
                                    title={`${sub.name}${scaleHint}${instancesHint} — Hacé clic para editar, configurar escala, agregar instancias, ${intensificationLabel.toLowerCase()} / recuperación o importar notas`}
                                  >
                                    <span className="inline-flex items-center justify-center gap-1 min-w-0 max-w-full">
                                      {hasEvalInstances ? (
                                        <Layers className="w-3 h-3 text-indigo-600 dark:text-indigo-300 shrink-0" />
                                      ) : hasInsts ? (
                                        <RotateCcw className="w-3 h-3 text-amber-600 dark:text-amber-300 shrink-0" />
                                      ) : (sub.name.toLowerCase().includes('disposición') ||
                                          sub.name.toLowerCase().includes('disposicion')) ? (
                                        <Award className="w-3 h-3 text-amber-500 shrink-0" />
                                      ) : null}
                                      <span className="truncate font-bold">{sub.name}</span>
                                    </span>
                                    {(subScale.badgeText || hasEvalInstances) && (
                                      <span className="mt-0.5 inline-flex items-center gap-1 flex-wrap justify-center">
                                        {subScale.badgeText && (
                                          <span
                                            className={`px-1 py-0 rounded text-[9px] font-bold leading-tight ${
                                              subScale.mode === 'sum_group'
                                                ? isDarkMode
                                                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-700/60'
                                                  : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                                : isDarkMode
                                                ? 'bg-slate-800 text-sky-300 border border-slate-700'
                                                : 'bg-sky-50 text-sky-800 border border-sky-200'
                                            }`}
                                          >
                                            {subScale.badgeText}
                                          </span>
                                        )}
                                        {hasEvalInstances && (
                                          <span
                                            className={`px-1 py-0 rounded text-[9px] font-bold leading-tight ${
                                              isDarkMode
                                                ? 'bg-indigo-900/80 text-indigo-200 border border-indigo-600/60'
                                                : 'bg-white/90 text-indigo-800 border border-indigo-300'
                                            }`}
                                          >
                                            {1 + evalInstances.length} inst. ·{' '}
                                            {sub.instancesCombineMode === 'sum'
                                              ? 'Suma'
                                              : sub.instancesCombineMode === 'separate'
                                              ? 'Sep.'
                                              : 'Prom.'}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </button>
                                );
                              })()}

                              {showInlineArrows && (
                                <button
                                  type="button"
                                  disabled={subIdx === cat.subcategories.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveSubcategory(cat.id, subIdx, subIdx + 1);
                                  }}
                                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-15 disabled:pointer-events-none text-current opacity-50 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la derecha (después)`}
                                >
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Column resize handle (only when unsplit; split sub-columns have their own handles in Row 3) */}
                            {!isSplit && (
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

              {/* ROW 3: Split Sub-headers for evaluations with multiple instances and/or Intensification / Recuperación */}
              {hasAnySplitColumns && (
                <tr className={`border-b ${isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-neutral-50/80 border-neutral-200'}`}>
                  {categories.map((cat) => {
                    const catRightBorder = isDarkMode
                      ? 'border-r-[3px] border-r-slate-500'
                      : 'border-r-[3px] border-r-slate-400';

                    return cat.subcategories.map((sub, subIdx) => {
                      const evalInstances = sub.instances || [];
                      const instList = sub.intensifications || [];
                      const hasEvalInstances = evalInstances.length > 0;
                      const hasInsts = instList.length > 0;
                      if (!hasEvalInstances && !hasInsts) return null;

                      const isLastSubInCat = subIdx === cat.subcategories.length - 1;
                      const groupLeftBorder = hasEvalInstances
                        ? isDarkMode
                          ? 'border-l-[3px] border-l-indigo-500'
                          : 'border-l-[3px] border-l-indigo-400'
                        : isDarkMode
                        ? 'border-l-[3px] border-l-amber-500'
                        : 'border-l-[3px] border-l-amber-400';

                      const groupRightBorder = isLastSubInCat
                        ? catRightBorder
                        : hasEvalInstances
                        ? isDarkMode
                          ? 'border-r-[3px] border-r-indigo-500'
                          : 'border-r-[3px] border-r-indigo-400'
                        : isDarkMode
                        ? 'border-r-[3px] border-r-amber-500'
                        : 'border-r-[3px] border-r-amber-400';

                      const innerDashBorder = hasEvalInstances
                        ? isDarkMode
                          ? 'border-r border-dashed border-r-indigo-700/70'
                          : 'border-r border-dashed border-r-indigo-300'
                        : isDarkMode
                        ? 'border-r border-dashed border-r-amber-700/70'
                        : 'border-r border-dashed border-r-amber-300';

                      const primarySubLabel = getPrimaryInstanceLabel(sub);

                      return (
                        <React.Fragment key={`${sub.id}-split-row`}>
                          {/* Primary Instance / Original Exam Sub-header */}
                          <th
                            className={`py-1 px-1.5 text-center font-bold text-[10px] relative select-none overflow-hidden ${groupLeftBorder} ${innerDashBorder} ${
                              hasEvalInstances
                                ? isDarkMode
                                  ? 'bg-indigo-950/45 text-indigo-200'
                                  : 'bg-indigo-50/90 text-indigo-900'
                                : isDarkMode
                                ? 'bg-amber-950/25 text-amber-200/90'
                                : 'bg-amber-50/60 text-amber-950'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (hasEvalInstances) {
                                  setEvaluationInstanceToEdit({
                                    catId: cat.id,
                                    subId: sub.id,
                                    instanceId: '__primary__',
                                  });
                                } else {
                                  setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                  setEditSubcatName(sub.name);
                                }
                              }}
                              className="w-full truncate hover:underline cursor-pointer pr-1"
                              title={
                                hasEvalInstances
                                  ? `${getPrimaryInstanceDisplayLabel(sub)} — Hacé clic para renombrar o importar notas en esta instancia`
                                  : `Nota original de "${sub.name}" — Hacé clic para editar o importar`
                              }
                            >
                              {primarySubLabel}
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

                          {/* Extra Evaluation Instances Sub-headers (for ALL students) */}
                          {evalInstances.map((evalInst, evalInstIdx) => {
                            const fullLabel = getEvaluationInstanceDisplayLabel(sub, evalInst);
                            const instScale = resolveInstanceScale(
                              sub,
                              evalInst,
                              generalGradeScale
                            );
                            const isLastColOfSub =
                              evalInstIdx === evalInstances.length - 1 && instList.length === 0;
                            const cellRightBorder = isLastColOfSub
                              ? groupRightBorder
                              : innerDashBorder;

                            return (
                              <th
                                key={evalInst.id}
                                className={`py-1 px-1.5 text-center font-bold text-[10px] relative select-none overflow-hidden ${cellRightBorder} ${
                                  isDarkMode
                                    ? 'bg-indigo-950/45 text-indigo-200'
                                    : 'bg-indigo-50/90 text-indigo-900'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEvaluationInstanceToEdit({
                                      catId: cat.id,
                                      subId: sub.id,
                                      instanceId: evalInst.id,
                                    })
                                  }
                                  className="w-full flex flex-col items-center justify-center hover:underline cursor-pointer pr-1 min-w-0"
                                  title={`${fullLabel} — Hacé clic para renombrar, ajustar escala o importar notas en esta instancia`}
                                >
                                  <span className="truncate max-w-full leading-tight">
                                    {evalInst.name}
                                  </span>
                                  {evalInst.customTitle ? (
                                    <span className="text-[9px] font-medium opacity-75 truncate max-w-full leading-tight">
                                      {evalInst.customTitle}
                                    </span>
                                  ) : evalInst.scaleMode && instScale.badgeText ? (
                                    <span className="text-[8px] font-bold opacity-80 truncate max-w-full leading-tight">
                                      {instScale.badgeText}
                                    </span>
                                  ) : null}
                                </button>
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  onMouseDown={(e) => startColumnResize(e, evalInst.id, 'grade')}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleResetSingleColWidth(evalInst.id);
                                  }}
                                  className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500 transition-colors z-20"
                                  title="Arrastrá para ajustar el ancho de esta subcolumna (doble clic para restablecer)"
                                />
                              </th>
                            );
                          })}

                          {/* Intensification / Recuperación Sub-headers */}
                          {instList.map((inst, instIdx) => {
                            const fullLabel = getIntensificationDisplayLabel(sub, inst);
                            const threshold = getIntensificationPassingThreshold(inst, sub);
                            const isLastColOfSub = instIdx === instList.length - 1;
                            const cellRightBorder = isLastColOfSub
                              ? groupRightBorder
                              : isDarkMode
                              ? 'border-r border-dashed border-r-amber-700/70'
                              : 'border-r border-dashed border-r-amber-300';

                            return (
                              <th
                                key={inst.id}
                                className={`py-1 px-1.5 text-center font-bold text-[10px] relative select-none overflow-hidden ${cellRightBorder} ${
                                  isDarkMode
                                    ? 'bg-amber-950/45 text-amber-300'
                                    : 'bg-amber-100/75 text-amber-900'
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
                                  title={`${fullLabel} (nota mínima: ${threshold}) — Hacé clic para renombrar, cambiar nota mínima, especificar detalle o importar notas`}
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
                    });
                  })}
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
                    generalGradeScale={generalGradeScale}
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
          <span className="font-semibold text-neutral-700 dark:text-slate-300">
            Escala general ({generalGradeScale.minScore} al {generalGradeScale.maxScore}):
          </span>
          <span>• Hacé clic en cualquier evaluación para ajustar su escala propia, convertir sobre 100 o sumarla con otra.</span>
          <span>• En modo Criterio docente podés cargar la nota final manualmente.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Aprobado (≥ {generalGradeScale.passingScore})
          </span>
          {generalGradeScale.regularScore !== null && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Regular ({generalGradeScale.regularScore}–
              {Number((generalGradeScale.passingScore - 0.1).toFixed(1))})
            </span>
          )}
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Desaprobado (&lt;{' '}
            {generalGradeScale.regularScore !== null
              ? generalGradeScale.regularScore
              : generalGradeScale.passingScore}
            )
          </span>
          {hasAnyEvaluationInstances && (
            <span className="flex items-center gap-1 font-bold text-indigo-700 dark:text-indigo-300">
              <Layers className="w-3 h-3 shrink-0" />
              Evaluaciones con instancias (para todos los alumnos, delimitadas con borde grueso)
            </span>
          )}
          {hasAnyIntensifications && (
            <span className="flex items-center gap-1 font-bold text-slate-600 dark:text-slate-300">
              <span className="px-1.5 py-0.5 rounded bg-neutral-200/80 dark:bg-slate-800 text-[10px]">
                {INTENSIFICATION_EXEMPT_LABEL}
              </span>{' '}
              Aprobado (≥ nota mínima por defecto, editable) · Las intensificaciones no afectan el promedio
            </span>
          )}
        </div>
      </div>

      <GradebookScaleSettingsModal
        isOpen={isScaleSettingsOpen}
        onClose={() => setIsScaleSettingsOpen(false)}
        isDarkMode={isDarkMode}
        generalGradeScale={generalGradeScale}
        intensificationLabel={intensificationLabel}
        intensificationPassingScore={intensificationPassingScore}
        onSave={(updates) => {
          updateTerminology(updates);
        }}
      />

      <GradebookCategoryModals
        isDarkMode={isDarkMode}
        categories={categories}
        generalGradeScale={generalGradeScale}
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
        subcatToEdit={subcatToEdit}
        setSubcatToEdit={setSubcatToEdit}
        editSubcatName={editSubcatName}
        setEditSubcatName={setEditSubcatName}
        handleSaveEditSubcategory={handleSaveEditSubcategory}
        handleDeleteSubcategory={handleDeleteSubcategory}
        convertible100CountInSubcat={convertible100CountInSubcat}
        onConvertSubcat100ToGeneral={handleConvertSubcat100ToGeneral}
        onMoveCategory={handleMoveCategory}
        onMoveSubcategory={handleMoveSubcategory}
        onMoveSubcategoryToCategory={handleMoveSubcategoryToCategory}
        intensificationDefaultLabel={intensificationLabel}
        onUpdateDefaultIntensificationLabel={(nextLabel) =>
          updateTerminology({ intensificationLabel: nextLabel })
        }
        intensificationDefaultPassingScore={intensificationPassingScore}
        onUpdateDefaultIntensificationPassingScore={(nextScore) =>
          updateTerminology({ intensificationPassingScore: nextScore })
        }
        onAddIntensification={handleAddIntensification}
        intensificationToEdit={intensificationToEdit}
        setIntensificationToEdit={setIntensificationToEdit}
        onUpdateIntensification={handleUpdateIntensification}
        onDeleteIntensification={handleDeleteIntensification}
        onMoveIntensification={handleMoveIntensification}
        onAddEvaluationInstance={handleAddEvaluationInstance}
        onUpdateEvaluationInstancesMeta={handleUpdateEvaluationInstancesMeta}
        evaluationInstanceToEdit={evaluationInstanceToEdit}
        setEvaluationInstanceToEdit={setEvaluationInstanceToEdit}
        onUpdateEvaluationInstance={handleUpdateEvaluationInstance}
        onDeleteEvaluationInstance={handleDeleteEvaluationInstance}
        onMoveEvaluationInstance={handleMoveEvaluationInstance}
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
