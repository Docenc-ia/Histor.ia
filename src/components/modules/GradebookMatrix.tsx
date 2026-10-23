import React, { useState, useMemo, useRef, useEffect, Suspense, lazy } from 'react';
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
import {
  exportGradeHistoryToExcel,
  exportGradebookMatrixToExcel,
} from '../../utils/excelExport';
import { getCurrentCalendarTerm, getGlobalAttendanceSettings } from '../../utils/attendanceCalculations';
import {
  CATEGORY_COLORS,
  calculateFinalScoreForStudent,
  computeTermScoresMap,
  getScoreColorClass as computeScoreColorClass,
  buildGradesCsvContent,
} from '../../utils/gradeCalculations';
import { useGradebookSync, GradebookTerm } from '../../hooks/useGradebookSync';
import { GradebookCategoryModals } from './GradebookCategoryModals';

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
  const [importSourceType, setImportSourceType] = useState<'file' | 'sheets' | 'paste'>('file');

  const handleExportFullExcel = () => {
    const termLabel = currentTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
    exportGradebookMatrixToExcel(courseName, termLabel, students, categories, gradesMap);
  };

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

  // Cell edit handling
  const handleScoreChange = (studentId: string, colKey: string, val: string) => {
    // Clean input: allow numbers, comma, dot, or short text
    const cleanVal = val.replace(',', '.');
    const updated = {
      ...gradesMap,
      [studentId]: {
        ...(gradesMap[studentId] || {}),
        [colKey]: cleanVal,
      },
    };
    saveGrades(updated);
  };

  // Excel-like keyboard navigation across grade cells (Enter / ArrowUp / ArrowDown / ArrowLeft / ArrowRight)
  const handleGradeCellKeyDown = (
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
  };

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

  const calculateFinalForTerm = (
    term: '1c' | '2c',
    studentId: string
  ): { scoreStr: string; num: number | null } => {
    const termCats = term === '1c' ? categories1c : categories2c;
    const termGrades = term === '1c' ? gradesMap1c : gradesMap2c;
    const termCalc = term === '1c' ? overallCalc1c : overallCalc2c;
    return calculateFinalScoreForStudent(termCats, termGrades, termCalc, studentId);
  };

  const getFinalScore = (studentId: string): string => {
    return calculateFinalForTerm(is2c ? '2c' : '1c', studentId).scoreStr;
  };

  const score1cMap = useMemo(
    () => computeTermScoresMap(students, categories1c, gradesMap1c, overallCalc1c),
    [students, categories1c, gradesMap1c, overallCalc1c]
  );

  const score2cMap = useMemo(
    () => computeTermScoresMap(students, categories2c, gradesMap2c, overallCalc2c),
    [students, categories2c, gradesMap2c, overallCalc2c]
  );

  const handleExportCSV = () => {
    const csvContent = buildGradesCsvContent(
      students,
      categories,
      gradesMap,
      overallCalculation,
      activePreliminaryValuation
    );
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `Calificaciones_${currentTerm === '1c' ? '1er_Cuatrimestre' : '2do_Cuatrimestre'}_${courseName.replace(/\s+/g, '_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

              <div className="flex items-center gap-2">
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

            {/* Abajo de Planilla de Calificaciones (en el mismo cuadrado): Opciones con las 2 de Importar en una columna nueva al final */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full items-start">
              {/* Columna 1: Descargar Excel y Descargar CSV */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleExportFullExcel}
                  className={`w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                  }`}
                  title="Descargar planilla completa en formato Excel (.xlsx)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="truncate">Descargar Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className={`w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                  }`}
                  title="Descargar planilla en formato CSV para abrir en Excel o Google Sheets"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <span className="truncate">Descargar CSV</span>
                </button>
              </div>

              {/* Columna 2: Sincronizar Notas en Sheets */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleSyncCuatrimestreWithSheets}
                  disabled={isSavingSheets}
                  className="w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  title="Sincronizar notas con el documento de Calificaciones en la carpeta de Google Drive de la materia"
                >
                  {isSavingSheets ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-white shrink-0" />
                  )}
                  <span className="truncate">
                    {isSavingSheets ? 'Sincronizando...' : 'Sincronizar Notas en Sheets'}
                  </span>
                </button>

                {sheetsSavedInfo && (
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] mt-0.5">
                    {sheetsSavedInfo.pulledCount && sheetsSavedInfo.pulledCount > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 font-medium rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800 truncate"
                        title="Notas importadas y actualizadas desde Google Sheets"
                      >
                        <RefreshCw className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400 shrink-0" />
                        <span>{sheetsSavedInfo.pulledCount} sincronizada(s)</span>
                      </span>
                    ) : null}
                    {sheetsSavedInfo.isLiveGoogle && sheetsSavedInfo.url ? (
                      <a
                        href={sheetsSavedInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 font-semibold rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:underline truncate"
                        title="Abrir documento de Calificaciones en Google Sheets"
                      >
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        <span>Ver Sheet</span>
                      </a>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Columna 3: Generar Valoración Preliminar y Nota Final */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  id="btn-generar-valoracion-preliminar"
                  onClick={() => setIsPreliminaryModalOpen(true)}
                  className="w-full inline-flex items-center justify-between gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md transition-all cursor-pointer ring-2 ring-amber-500/20"
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

                {/* Criterio de Calificación Final Toggle */}
                <div
                  className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs ${
                    isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <span className={`font-semibold shrink-0 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Nota Final:
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
                    className={`px-2 py-0.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer truncate ${
                      overallCalculation === 'manual_final'
                        ? 'bg-purple-600 text-white shadow-2xs'
                        : 'bg-blue-600 text-white shadow-2xs'
                    }`}
                    title="Cambiar criterio para la calificación final"
                  >
                    {overallCalculation === 'manual_final'
                      ? '✍️ Manual'
                      : '📊 Promedio'}
                  </button>
                </div>
              </div>

              {/* Columna 4 (al final): Importar desde Excel e Importar desde Sheets */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setImportSourceType('file');
                    setIsImportModalOpen(true);
                  }}
                  className="w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                  title="Subir archivo Excel (.xlsx, .xls, .csv) para que la app detecte las notas y categorías con comprobación previa"
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Importar desde Excel</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImportSourceType('sheets');
                    setIsImportModalOpen(true);
                  }}
                  className={`w-full inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                    isDarkMode
                      ? 'bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border-emerald-800'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                  }`}
                  title="Importar documento existente de Google Sheets para que la app detecte las notas y categorías con comprobación previa"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">Importar desde Sheets</span>
                </button>
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
                  Estudiante ({students.length})
                </th>

                {/* Major Categories */}
                {categories.map((cat, catIdx) => {
                  const colSpan = Math.max(1, cat.subcategories.length);
                  const colorTheme = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];

                  return (
                    <th
                      key={cat.id}
                      colSpan={colSpan}
                      className={`p-2.5 text-center font-bold border-r border-b-2 transition-colors ${
                        colorTheme.border
                      } ${colorTheme.headerBg}`}
                    >
                      <div className="flex items-center justify-between px-2 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${colorTheme.badge}`} />
                          <span className="truncate text-xs uppercase tracking-wide font-bold">{cat.name}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Add Subcategory / Column button */}
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-xs flex items-center gap-0.5 cursor-pointer"
                            title={`Agregar columna de evaluación a ${cat.name}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline text-[10px] font-semibold">+ Col</span>
                          </button>

                          {/* Edit Category button */}
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryToEdit(cat);
                              setEditCatName(cat.name);
                              setEditCatColor(cat.color);
                            }}
                            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-xs flex items-center gap-0.5 cursor-pointer transition-colors"
                            title={`Editar nombre u opciones de categoría "${cat.name}"`}
                          >
                            <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                            <span className="hidden sm:inline text-[10px] font-semibold">Editar</span>
                          </button>

                          {/* Delete category */}
                          <button
                            type="button"
                            onClick={() => setCategoryToDelete(cat)}
                            className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors cursor-pointer"
                            title={`Eliminar categoría "${cat.name}"`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
                  className={`p-3 font-extrabold text-center uppercase tracking-wider text-[11px] min-w-[120px] ${
                    isDarkMode
                      ? 'bg-blue-950/40 text-blue-300 border-l border-slate-800'
                      : 'bg-blue-50 text-blue-800 border-l border-neutral-200'
                  }`}
                >
                  <div>Calificación Final</div>
                  <div className="text-[10px] font-normal opacity-80 mt-0.5">
                    {overallCalculation === 'manual_final' ? '(Criterio docente)' : '(Promedio)'}
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
                        className={`p-2 text-center font-medium border-r text-[11px] min-w-[110px] ${
                          isDarkMode ? 'border-slate-800 text-slate-400' : 'border-neutral-200 text-neutral-500'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Nota General</span>
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="text-blue-500 hover:underline text-[10px]"
                          >
                            (+sub)
                          </button>
                        </div>
                      </th>
                    );
                  }

                  return (
                    <React.Fragment key={`${cat.id}-subs`}>
                      {cat.subcategories.map((sub) => (
                        <th
                          key={sub.id}
                          className={`p-2 text-center font-medium border-r text-[11px] min-w-[120px] max-w-[160px] group ${
                            isDarkMode ? 'border-slate-800 text-slate-300' : 'border-neutral-200 text-neutral-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 px-1">
                            <span className="truncate font-semibold flex items-center gap-1" title={sub.name}>
                              {(sub.name.toLowerCase().includes('disposición') || sub.name.toLowerCase().includes('disposicion')) && (
                                <Award className="w-3 h-3 text-amber-500 shrink-0" />
                              )}
                              <span className="truncate">{sub.name}</span>
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                  setEditSubcatName(sub.name);
                                }}
                                className="p-0.5 text-neutral-400 hover:text-blue-500 cursor-pointer"
                                title={`Editar nombre de "${sub.name}"`}
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSubcategory(cat.id, sub.id)}
                                className="p-0.5 text-neutral-400 hover:text-red-500 cursor-pointer"
                                title={`Eliminar columna ${sub.name}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </th>
                      ))}
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
                students.map((student, idx) => {
                  const studentGrades = gradesMap[student.id] || {};
                  const finalScore = getFinalScore(student.id);
                  let runningColIdx = 0;

                  return (
                    <tr
                      key={student.id}
                      className={`group transition-colors ${
                        isDarkMode
                          ? 'hover:bg-slate-800/40'
                          : 'hover:bg-neutral-50/80'
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
                          <div className="min-w-0">
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
                        // Si no tiene subcategorías, celda directa para la categoría
                        if (cat.subcategories.length === 0) {
                          const val = studentGrades[cat.id] || '';
                          const thisColIdx = runningColIdx++;
                          return (
                            <td key={cat.id} className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800">
                              <input
                                type="text"
                                data-grade-row={idx}
                                data-grade-col={thisColIdx}
                                value={val}
                                onChange={(e) => handleScoreChange(student.id, cat.id, e.target.value)}
                                onKeyDown={(e) => handleGradeCellKeyDown(e, idx, thisColIdx)}
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

                        // Celdas de subcategorías
                        return (
                          <React.Fragment key={cat.id}>
                            {cat.subcategories.map((sub) => {
                              const val = studentGrades[sub.id] || '';
                              const thisColIdx = runningColIdx++;
                              return (
                                <td
                                  key={sub.id}
                                  className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800"
                                >
                                  <input
                                    type="text"
                                    data-grade-row={idx}
                                    data-grade-col={thisColIdx}
                                    value={val}
                                    onChange={(e) => handleScoreChange(student.id, sub.id, e.target.value)}
                                    onKeyDown={(e) => handleGradeCellKeyDown(e, idx, thisColIdx)}
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
                      {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                        <td
                          className={`p-2 border-l text-center font-bold text-xs ${
                            isDarkMode
                              ? 'bg-amber-950/20 border-slate-800'
                              : 'bg-amber-50/30 border-neutral-200'
                          }`}
                        >
                          {(() => {
                            const valData = activePreliminaryValuation.valuations[student.id];
                            const traj = valData?.trajectory;
                            if (traj === 'TEA') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TEA: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo en Alcanzado (Haz clic para editar)'}
                                >
                                  TEA
                                </button>
                              );
                            }
                            if (traj === 'TEP') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TEP: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo en Proceso (Haz clic para editar)'}
                                >
                                  TEP
                                </button>
                              );
                            }
                            if (traj === 'TED') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TED: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo Discontinuo (Haz clic para editar)'}
                                >
                                  TED
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => setIsPreliminaryModalOpen(true)}
                                className="text-[11px] text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 underline cursor-pointer"
                                title="Asignar TEA / TEP en Valoración Preliminar"
                              >
                                Asignar
                              </button>
                            );
                          })()}
                        </td>
                      )}

                      {/* Final Grade Cell: Either editable manual OR calculated automatically */}
                      <td
                        className={`p-2 border-l text-center font-extrabold text-sm ${
                          isDarkMode
                            ? 'bg-blue-950/20 border-slate-800'
                            : 'bg-blue-50/40 border-neutral-200'
                        }`}
                      >
                        {overallCalculation === 'manual_final' ? (
                          (() => {
                            const finalColIdx = runningColIdx++;
                            return (
                              <input
                                type="text"
                                data-grade-row={idx}
                                data-grade-col={finalColIdx}
                                value={studentGrades['__final__'] || ''}
                                onChange={(e) => handleScoreChange(student.id, '__final__', e.target.value)}
                                onKeyDown={(e) => handleGradeCellKeyDown(e, idx, finalColIdx)}
                                placeholder="-"
                                className={`w-16 text-center py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
                                  isDarkMode
                                    ? 'bg-purple-950/40 border-purple-800/80 text-purple-300 focus:border-purple-500'
                                    : 'bg-purple-50 border-purple-200 text-purple-900 focus:border-purple-400'
                                }`}
                                title="Nota final asignada a criterio del docente"
                              />
                            );
                          })()
                        ) : (
                          <span className={getScoreColorClass(finalScore)}>
                            {finalScore || '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
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

      {/* Modal: Importar y Registrar Notas desde Excel o Sheets con Verificación Previa */}
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
          />
        </Suspense>
      )}
        </>
      )}
    </div>
  );
};
export default GradebookMatrix;
