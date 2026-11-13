import React, { useState, useMemo, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Calculator,
  FileSpreadsheet,
  Download,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Award,
  Copy,
  ClipboardCheck,
  ExternalLink,
  Upload,
  History,
  RefreshCw,
  Cloud,
  FileCheck,
  GripVertical,
} from 'lucide-react';
import { Student } from '../../types';
import { GradeCategory, GradeSubcategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../../types/grades';
import type { PreliminaryValuationRecord } from './PreliminaryValuationModal';

const AnnualSummaryView = lazy(() =>
  import('./AnnualSummaryView').then((m) => ({ default: m.AnnualSummaryView }))
);
const PreliminaryValuationModal = lazy(() =>
  import('./PreliminaryValuationModal').then((m) => ({ default: m.PreliminaryValuationModal }))
);
const ImportGradesModal = lazy(() =>
  import('./ImportGradesModal').then((m) => ({ default: m.ImportGradesModal }))
);
const ImportGoogleFormsModal = lazy(() =>
  import('./ImportGoogleFormsModal').then((m) => ({ default: m.ImportGoogleFormsModal }))
);
import {
  exportGradebookMatrixToExcel,
} from '../../utils/excelExport';
import { getCurrentCalendarTerm, getGlobalAttendanceSettings } from '../../utils/attendanceCalculations';
import {
  CATEGORY_COLORS,
  calculateCategoryAverageForStudent,
  calculateFinalScoreForStudent,
  computeTermScoresMap,
  getScoreColorClass as computeScoreColorClass,
  reorderCategoriesList,
  reorderSubcategoriesInCategory,
  moveSubcategoryAcrossCategories,
} from '../../utils/gradeCalculations';
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
        {/* Student Name (Sticky on horizontal scroll) */}
        <td
          className={`sticky left-0 z-10 p-3 border-r font-medium flex items-center justify-between gap-2 transition-colors shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] ${
            isDarkMode
              ? 'bg-slate-900 group-hover:bg-slate-800 border-slate-800 text-slate-200'
              : 'bg-white group-hover:bg-neutral-50 border-neutral-200 text-neutral-800'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[10px] text-neutral-400 w-4">{idx + 1}</span>
            <div data-pii="student" className="min-w-0">
              <p className="font-semibold text-xs truncate">
                {student.lastName}, {student.firstName}
              </p>
              <p className="text-[10px] text-neutral-400 dark:text-slate-500 truncate">
                {student.email || 'Sin correo'}
              </p>
            </div>
          </div>

          {onDeleteStudent && (
            <button
              type="button"
              onClick={() => onDeleteStudent(student)}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-950/60 text-red-500 transition-all cursor-pointer shrink-0"
              title={`Quitar a ${student.lastName}, ${student.firstName} de la lista de esta materia`}
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
        </td>

        {/* Grade Cells per Category & Subcategory */}
        {categories.map((cat) => {
          if (cat.subcategories.length === 0) {
            const val = studentGrades[cat.id] || '';
            const thisColIdx = runningColIdx++;
            return (
              <td key={cat.id} data-pii="student" className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800">
                <input
                  type="text"
                  data-grade-row={idx}
                  data-grade-col={thisColIdx}
                  value={val}
                  onChange={(e) => onScoreChange(student.id, cat.id, e.target.value)}
                  onBlur={onCellBlur}
                  onKeyDown={(e) => onCellKeyDown(e, idx, thisColIdx)}
                  placeholder="-"
                  className={`w-14 text-center py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
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
                return (
                  <td
                    key={sub.id}
                    data-pii="student"
                    className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800"
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
                      className={`w-14 text-center py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                        isDarkMode
                          ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                          : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                      } ${getScoreColorClass(val)}`}
                    />
                  </td>
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
          className={`p-2 border-l text-center font-extrabold text-sm ${
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
                  className={`w-16 text-center py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
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
                className={`w-16 text-center py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
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
      localStorage.setItem(`fds_grades_active_term_${courseId}`, t);
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
    isSavingSheets,
    sheetsSavedInfo,
    cloudStatus,
    saveCategories,
    saveGrades,
    saveOverallCalc,
    saveAnnualOverride,
    handleCopyCategoriesFrom1c,
    handleSavePreliminaryValuation,
    handleApplyImportedGrades,
    handleApplyMultiImport,
    handleSyncCuatrimestreWithSheets,
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

    // Use ResizeObserver for responsive table width changes (e.g. columns added/removed)
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
  }, [categories, students]);

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

  // Excel-like keyboard navigation across grade cells (Enter / ArrowUp / ArrowDown / ArrowLeft / ArrowRight)
  const handleGradeCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      rowIdx: number,
      colIdx: number
    ) => {
      let nextRow = rowIdx;
      let nextCol = colIdx;

      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextRow = rowIdx + 1;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextRow = rowIdx - 1;
      } else if (
        e.key === 'ArrowRight' &&
        e.currentTarget.selectionStart === e.currentTarget.value.length
      ) {
        e.preventDefault();
        nextCol = colIdx + 1;
      } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
        e.preventDefault();
        nextCol = colIdx - 1;
      } else {
        return;
      }

      if (tableRef.current) {
        const target = tableRef.current.querySelector<HTMLInputElement>(
          `input[data-grade-row="${nextRow}"][data-grade-col="${nextCol}"]`
        );
        if (target) {
          target.focus();
          target.select();
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

  const getScoreColorClass = (valStr: string) => computeScoreColorClass(valStr, isDarkMode);

  return (
    <div className="space-y-4">
      {/* Interruptor de Cuatrimestres */}
      <div
        className={`p-3 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-xl ${
              currentTerm === '1c'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : currentTerm === '2c'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                Período Académico:
              </span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  currentTerm === '1c'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                    : currentTerm === '2c'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                }`}
              >
                {currentTerm === '1c'
                  ? '📘 1° Cuatrimestre Activo'
                  : currentTerm === '2c'
                  ? '📗 2° Cuatrimestre Activo'
                  : '🎓 Cierre y Calificación Anual'}
              </span>
            </div>
          </div>
        </div>

        {/* Interruptor segmentado */}
        <div
          className={`p-1 rounded-xl border flex items-center gap-1 shadow-2xs ${
            isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-100 border-neutral-200'
          }`}
        >
          <button
            type="button"
            id="switch-term-1c"
            onClick={() => setTerm('1c')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === '1c'
                ? 'bg-blue-600 text-white shadow-sm scale-102 ring-2 ring-blue-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${currentTerm === '1c' ? 'bg-white' : 'bg-blue-400'}`} />
            <span>1° Cuatrimestre</span>
          </button>

          <button
            type="button"
            id="switch-term-2c"
            onClick={() => setTerm('2c')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === '2c'
                ? 'bg-emerald-600 text-white shadow-sm scale-102 ring-2 ring-emerald-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${currentTerm === '2c' ? 'bg-white' : 'bg-emerald-400'}`} />
            <span>2° Cuatrimestre</span>
          </button>

          <button
            type="button"
            id="switch-term-annual"
            onClick={() => setTerm('annual')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === 'annual'
                ? 'bg-purple-600 text-white shadow-sm scale-102 ring-2 ring-purple-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
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
                      : `✓ Guardado${cloudStatus.lastSyncedAt ? ` (${cloudStatus.lastSyncedAt})` : ''}`}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsManageCategoriesOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
                  }`}
                  title="Ordenar o administrar todas las Categorías Mayores y sus columnas"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span>Ordenar Categorías</span>
                </button>

                <button
                  type="button"
                  id="btn-agregar-categoria-mayor"
                  onClick={() => setIsAddCategoryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  title="Crear una nueva Categoría Mayor en la planilla (ej: Evaluaciones, Trabajos Prácticos, Concepto, etc.)"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>+ Agregar Categoría Mayor</span>
                </button>

                <span className={`text-xs font-semibold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {currentTerm === '1c' ? '1º Cuatrimestre' : '2º Cuatrimestre'}
                </span>
                {is2c && (
                  <button
                    type="button"
                    onClick={handleCopyCategoriesFrom1c}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                        : 'bg-white hover:bg-emerald-50 text-emerald-700 border-neutral-200'
                    }`}
                    title="Copiar las categorías creadas en el 1° Cuatrimestre para utilizarlas en este 2° Cuatrimestre"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copiar de 1° C</span>
                  </button>
                )}
              </div>
            </div>

            {/* Abajo de Planilla de Calificaciones: Opciones Unificadas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full items-center">
              <button
                type="button"
                onClick={() => {
                  setImportSourceType('sheets');
                  setIsImportModalOpen(true);
                }}
                className="w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                title="Importar una evaluación o notas desde Google Forms, Google Sheets, Google Docs, Excel, Word, CSV o texto pegado"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Importar Evaluación o Notas</span>
              </button>

              <button
                type="button"
                id="btn-generar-valoracion-preliminar"
                onClick={() => setIsPreliminaryModalOpen(true)}
                className="w-full inline-flex items-center justify-between gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md transition-all cursor-pointer ring-2 ring-amber-500/20"
                title={`Generar Valoración Preliminar para ${currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'} con selección de notas y escala TEA / TEP`}
              >
                <div className="inline-flex items-center gap-1.5 truncate">
                  <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Generar Valoración Preliminar</span>
                </div>
                {activePreliminaryValuation && (
                  <span className="px-1 py-0.2 rounded-full text-[9px] bg-white text-amber-800 font-extrabold shadow-2xs shrink-0">
                    TEA/TEP ✓
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

      {/* TOP HORIZONTAL SCROLLBAR & CONTROLS */}
      <div
        className={`px-4 py-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Desplazamiento horizontal:
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollTableBy(-250)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la izquierda"
              aria-label="Desplazar a la izquierda"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollTableBy(250)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la derecha"
              aria-label="Desplazar a la derecha"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Scrollbar Track synchronized with table */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="flex-1 overflow-x-auto overflow-y-hidden h-4 rounded-md scrollbar-thin transition-colors"
          style={{
            scrollbarWidth: 'auto',
          }}
        >
          {/* Invisible placeholder matching the exact width of the table */}
          <div style={{ width: `${Math.max(tableWidth, 900)}px`, height: '1px' }} />
        </div>

        <button
          type="button"
          onClick={() => setIsAddCategoryOpen(true)}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer shrink-0 ${
            isDarkMode
              ? 'bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border-blue-800'
              : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
          }`}
          title="Agregar una nueva Categoría Mayor a la planilla de calificaciones"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Categoría Mayor</span>
        </button>
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
          <table ref={tableRef} className="w-full text-left text-xs border-collapse">
            <thead>
              {/* ROW 1: Super Header - Categories */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-neutral-100 border-neutral-200'}`}>
                {/* Student info fixed cols */}
                <th
                  rowSpan={2}
                  className={`sticky left-0 z-20 p-3 font-bold border-r uppercase tracking-wider text-[11px] min-w-[200px] w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] ${
                    isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>Estudiante ({students.length})</span>
                    <button
                      type="button"
                      onClick={() => setIsAddCategoryOpen(true)}
                      className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold normal-case tracking-normal inline-flex items-center gap-1 shadow-2xs transition-all cursor-pointer shrink-0"
                      title="Agregar una nueva Categoría Mayor (ej: Evaluaciones, Trabajos Prácticos)"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Categoría</span>
                    </button>
                  </div>
                </th>

                {/* Major Categories */}
                {categories.map((cat, catIdx) => {
                  const colSpan = Math.max(1, cat.subcategories.length);
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
                      className={`group/cat p-2 text-center font-bold border-r border-b-2 transition-all min-w-[140px] ${
                        colorTheme.border
                      } ${colorTheme.headerBg} ${
                        draggedCatIdx === catIdx ? 'opacity-50' : ''
                      } ${isDragOverCat ? 'ring-2 ring-inset ring-blue-500' : ''}`}
                    >
                      <div className="flex items-center justify-center px-1.5 gap-1">
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
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {categories.length > 1 && (
                          <span
                            className="cursor-grab active:cursor-grabbing opacity-40 group-hover/cat:opacity-80 transition-opacity shrink-0"
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
                          className="text-xs uppercase tracking-wide font-extrabold whitespace-nowrap hover:underline cursor-pointer transition-opacity hover:opacity-80"
                          title={`Hacé clic para editar, ordenar subcolumnas o eliminar "${cat.name}"`}
                        >
                          {cat.name}
                        </button>

                        {/* Add Subcategory / Column button (+ solamente) */}
                        <button
                          type="button"
                          onClick={() => setAddingSubcatForCatId(cat.id)}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
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
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}

                {/* Preliminary Valuation Col (TEA / TEP) if enabled */}
                {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                  <th
                    rowSpan={2}
                    className={`p-2.5 font-extrabold text-center uppercase tracking-wider text-[11px] min-w-[130px] border-l ${
                      isDarkMode
                        ? 'bg-amber-950/40 text-amber-300 border-slate-800'
                        : 'bg-amber-50/80 text-amber-900 border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setIsPreliminaryModalOpen(true)}
                      className="inline-flex flex-col items-center hover:opacity-80 transition-opacity cursor-pointer mx-auto"
                      title="Haz clic para editar la Valoración Preliminar (TEA / TEP)"
                    >
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        <span>Val. Preliminar</span>
                      </div>
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 opacity-90 mt-0.5">
                        (TEA / TEP)
                      </div>
                    </button>
                  </th>
                )}

                {/* Final Grade Col */}
                <th
                  rowSpan={2}
                  className={`p-2.5 font-extrabold text-center uppercase tracking-wider text-[11px] min-w-[140px] ${
                    isDarkMode
                      ? 'bg-blue-950/40 text-blue-300 border-l border-slate-800'
                      : 'bg-blue-50 text-blue-800 border-l border-neutral-200'
                  }`}
                >
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <span>Calificación Final</span>
                    <button
                      type="button"
                      onClick={() =>
                        saveOverallCalc(
                          overallCalculation === 'manual_final'
                            ? 'average_of_categories'
                            : 'manual_final'
                        )
                      }
                      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-[11px] normal-case tracking-normal transition-all cursor-pointer shadow-2xs ${
                        overallCalculation === 'manual_final'
                          ? 'bg-purple-600 hover:bg-purple-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                      title="Hacé clic para alternar entre Promedio (con posibilidad de editar la nota manualmente) y Criterio docente"
                    >
                      {overallCalculation === 'manual_final' ? (
                        <>
                          <span className="text-sm leading-none" role="img" aria-label="Docente">
                            👨‍🏫
                          </span>
                          <span>Criterio docente</span>
                        </>
                      ) : (
                        <>
                          <Calculator className="w-3.5 h-3.5 shrink-0" />
                          <span>Promedio</span>
                        </>
                      )}
                    </button>
                  </div>
                </th>
              </tr>

              {/* ROW 2: Subcategories Header */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
                {categories.map((cat) => {
                  if (cat.subcategories.length === 0) {
                    return (
                      <th
                        key={`${cat.id}-empty`}
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
                        className={`p-2 text-center font-medium border-r text-[11px] min-w-[120px] ${
                          isDarkMode ? 'border-slate-800 text-slate-400' : 'border-neutral-200 text-neutral-500'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryToEdit(cat);
                              setEditCatName(cat.name);
                              setEditCatColor(cat.color);
                            }}
                            className="hover:underline cursor-pointer transition-opacity hover:opacity-80"
                            title={`Hacé clic para editar o eliminar "${cat.name}"`}
                          >
                            Nota General
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center cursor-pointer"
                            title={`Agregar subcolumna a "${cat.name}"`}
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                      </th>
                    );
                  }

                  return (
                    <React.Fragment key={`${cat.id}-subs`}>
                      {cat.subcategories.map((sub, subIdx) => {
                        const isDraggingThisSub =
                          draggedSubcat?.catId === cat.id && draggedSubcat?.subId === sub.id;
                        const isDragOverThisSub =
                          dragOverSubcat?.catId === cat.id &&
                          dragOverSubcat?.subIdx === subIdx &&
                          !isDraggingThisSub;

                        return (
                          <th
                            key={sub.id}
                            draggable
                            onDragStart={(e) => {
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
                            className={`group/sub p-1.5 text-center font-medium border-r text-[11px] min-w-[125px] transition-all ${
                              isDarkMode ? 'border-slate-800 text-slate-300' : 'border-neutral-200 text-neutral-700'
                            } ${isDraggingThisSub ? 'opacity-45' : ''} ${
                              isDragOverThisSub ? 'ring-2 ring-inset ring-blue-500 bg-blue-500/10' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-0.5 px-0.5 text-center">
                              {cat.subcategories.length > 1 ? (
                                <button
                                  type="button"
                                  disabled={subIdx === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveSubcategory(cat.id, subIdx, subIdx - 1);
                                  }}
                                  className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 disabled:opacity-15 disabled:pointer-events-none text-neutral-500 dark:text-slate-400 opacity-55 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la izquierda (antes)`}
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="w-3" />
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                  setEditSubcatName(sub.name);
                                }}
                                className="font-semibold inline-flex items-center justify-center gap-1 text-center hover:underline hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors min-w-0"
                                title={`Hacé clic para editar, cambiar de lugar o eliminar "${sub.name}" (o arrastrá la columna)`}
                              >
                                {(sub.name.toLowerCase().includes('disposición') ||
                                  sub.name.toLowerCase().includes('disposicion')) && (
                                  <Award className="w-3 h-3 text-amber-500 shrink-0" />
                                )}
                                <span className="truncate">{sub.name}</span>
                              </button>

                              {cat.subcategories.length > 1 ? (
                                <button
                                  type="button"
                                  disabled={subIdx === cat.subcategories.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveSubcategory(cat.id, subIdx, subIdx + 1);
                                  }}
                                  className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 disabled:opacity-15 disabled:pointer-events-none text-neutral-500 dark:text-slate-400 opacity-55 group-hover/sub:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Mover "${sub.name}" hacia la derecha (después)`}
                                >
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="w-3" />
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tr>
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
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Aprobado (≥ 7)
          </span>
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Regular (6)
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Desaprobado (&lt; 6)
          </span>
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
            onSwitchToForms={() => {
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
          />
        </Suspense>
      )}
        </>
      )}
    </div>
  );
};
export default GradebookMatrix;
