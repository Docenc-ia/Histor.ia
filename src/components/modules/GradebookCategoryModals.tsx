/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Trash2,
  Edit2,
  X,
  Check,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Upload,
  FileCheck,
  Link2,
  ClipboardPaste,
  RotateCcw,
  Bookmark,
} from 'lucide-react';
import { GradeCategory } from '../../types/grades';
import {
  CATEGORY_COLORS,
  getIntensificationDisplayLabel,
} from '../../utils/gradeCalculations';
import { INTENSIFICATION_LABEL_PRESETS } from '../../utils/terminologySettings';

export interface GradebookCategoryModalsProps {
  isDarkMode: boolean;
  categories: GradeCategory[];
  categoryToDelete: GradeCategory | null;
  setCategoryToDelete: (cat: GradeCategory | null) => void;
  confirmDeleteCategory: () => void;
  categoryToEdit: GradeCategory | null;
  setCategoryToEdit: (cat: GradeCategory | null) => void;
  editCatName: string;
  setEditCatName: (val: string) => void;
  editCatColor: string;
  setEditCatColor: (val: string) => void;
  handleSaveEditCategory: () => void;
  isManageCategoriesOpen: boolean;
  setIsManageCategoriesOpen: (open: boolean) => void;
  newCatName: string;
  setNewCatName: (val: string) => void;
  handleAddCategory: () => void;
  subcatToEdit: { catId: string; subId: string; name: string } | null;
  setSubcatToEdit: (sub: { catId: string; subId: string; name: string } | null) => void;
  editSubcatName: string;
  setEditSubcatName: (val: string) => void;
  handleSaveEditSubcategory: () => void;
  handleDeleteSubcategory: (catId: string, subId: string) => void;
  onMoveCategory?: (fromIndex: number, toIndex: number) => void;
  onMoveSubcategory?: (categoryId: string, fromIndex: number, toIndex: number) => void;
  onMoveSubcategoryToCategory?: (
    sourceCategoryId: string,
    subcategoryId: string,
    targetCategoryId: string
  ) => void;
  onImportIntoColumn?: (
    target: { categoryId: string; subcategoryId: string; subcategoryName: string },
    source: 'forms' | 'sheets' | 'file' | 'paste'
  ) => void;
  intensificationDefaultLabel?: string;
  onUpdateDefaultIntensificationLabel?: (nextLabel: string) => void;
  onAddIntensification?: (
    catId: string,
    subId: string,
    name: string,
    customTitle?: string
  ) => void;
  intensificationToEdit?: { catId: string; subId: string; instId: string } | null;
  setIntensificationToEdit?: (
    val: { catId: string; subId: string; instId: string } | null
  ) => void;
  onUpdateIntensification?: (
    catId: string,
    subId: string,
    instId: string,
    updates: { name: string; customTitle?: string }
  ) => void;
  onDeleteIntensification?: (catId: string, subId: string, instId: string) => void;
  onMoveIntensification?: (
    catId: string,
    subId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
}

export const GradebookCategoryModals: React.FC<GradebookCategoryModalsProps> = ({
  isDarkMode,
  categories,
  categoryToDelete,
  setCategoryToDelete,
  confirmDeleteCategory,
  categoryToEdit,
  setCategoryToEdit,
  editCatName,
  setEditCatName,
  editCatColor,
  setEditCatColor,
  handleSaveEditCategory,
  isManageCategoriesOpen,
  setIsManageCategoriesOpen,
  newCatName,
  setNewCatName,
  handleAddCategory,
  subcatToEdit,
  setSubcatToEdit,
  editSubcatName,
  setEditSubcatName,
  handleSaveEditSubcategory,
  handleDeleteSubcategory,
  onMoveCategory,
  onMoveSubcategory,
  onMoveSubcategoryToCategory,
  onImportIntoColumn,
  intensificationDefaultLabel = 'Intensificación',
  onUpdateDefaultIntensificationLabel,
  onAddIntensification,
  intensificationToEdit,
  setIntensificationToEdit,
  onUpdateIntensification,
  onDeleteIntensification,
  onMoveIntensification,
}) => {
  const activeEditCatIndex = categoryToEdit
    ? categories.findIndex((c) => c.id === categoryToEdit.id)
    : -1;
  const activeEditCategoryLive =
    activeEditCatIndex >= 0 ? categories[activeEditCatIndex] : categoryToEdit;

  const activeSubcatParentCat = subcatToEdit
    ? categories.find((c) => c.id === subcatToEdit.catId)
    : null;
  const activeSubcatIndex =
    activeSubcatParentCat && subcatToEdit
      ? activeSubcatParentCat.subcategories.findIndex((s) => s.id === subcatToEdit.subId)
      : -1;
  const activeSubcatLive =
    activeSubcatParentCat && activeSubcatIndex >= 0
      ? activeSubcatParentCat.subcategories[activeSubcatIndex]
      : null;

  // Draft state for adding a new intensification inside the Evaluation Edit modal
  const [newInstName, setNewInstName] = useState('');
  const [newInstCustomTitle, setNewInstCustomTitle] = useState('');
  const [saveAsDefaultTerm, setSaveAsDefaultTerm] = useState(false);

  const existingInstCount = activeSubcatLive?.intensifications?.length || 0;

  useEffect(() => {
    if (subcatToEdit) {
      const nextDefault =
        existingInstCount === 0
          ? intensificationDefaultLabel
          : `${intensificationDefaultLabel} ${existingInstCount + 1}`;
      setNewInstName(nextDefault);
      setNewInstCustomTitle('');
      setSaveAsDefaultTerm(false);
    }
  }, [subcatToEdit?.subId, existingInstCount, intensificationDefaultLabel]);

  // Live resolution for Editing an Intensification modal
  const activeInstParentCat = intensificationToEdit
    ? categories.find((c) => c.id === intensificationToEdit.catId)
    : null;
  const activeInstParentSub =
    activeInstParentCat && intensificationToEdit
      ? activeInstParentCat.subcategories.find((s) => s.id === intensificationToEdit.subId)
      : null;
  const activeInstList = activeInstParentSub?.intensifications || [];
  const activeInstIndex =
    intensificationToEdit
      ? activeInstList.findIndex((inst) => inst.id === intensificationToEdit.instId)
      : -1;
  const activeInstLive = activeInstIndex >= 0 ? activeInstList[activeInstIndex] : null;

  const [editInstName, setEditInstName] = useState('');
  const [editInstCustomTitle, setEditInstCustomTitle] = useState('');
  const [savedDefaultFeedback, setSavedDefaultFeedback] = useState(false);

  useEffect(() => {
    if (activeInstLive) {
      setEditInstName(activeInstLive.name);
      setEditInstCustomTitle(activeInstLive.customTitle || '');
      setSavedDefaultFeedback(false);
    }
  }, [activeInstLive?.id]);

  const handleConfirmAddIntensification = () => {
    if (!subcatToEdit || !onAddIntensification) return;
    const cleanName = newInstName.trim() || intensificationDefaultLabel;
    if (saveAsDefaultTerm && onUpdateDefaultIntensificationLabel) {
      const baseTerm = cleanName.replace(/\s+\d+$/, '').trim() || cleanName;
      onUpdateDefaultIntensificationLabel(baseTerm);
    }
    onAddIntensification(
      subcatToEdit.catId,
      subcatToEdit.subId,
      cleanName,
      newInstCustomTitle.trim() || undefined
    );
    setNewInstCustomTitle('');
  };

  const handleSaveEditIntensification = () => {
    if (!intensificationToEdit || !onUpdateIntensification || !editInstName.trim()) return;
    onUpdateIntensification(
      intensificationToEdit.catId,
      intensificationToEdit.subId,
      intensificationToEdit.instId,
      {
        name: editInstName.trim(),
        customTitle: editInstCustomTitle.trim() || undefined,
      }
    );
    setIntensificationToEdit?.(null);
  };

  return (
    <>
      {/* Modal de confirmación para eliminar Categoría Mayor */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md p-6 rounded-2xl shadow-2xl border space-y-4 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-2.5 rounded-xl bg-red-500/10 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold">¿Eliminar categoría mayor?</h3>
                <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Esta acción eliminará la categoría y sus columnas de evaluación.
                </p>
              </div>
            </div>

            <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              ¿Estás seguro de que deseas eliminar la categoría{' '}
              <strong className="text-blue-500">"{categoryToDelete.name}"</strong>
              {categoryToDelete.subcategories.length > 0 && (
                <>
                  {' '}y sus{' '}
                  <strong className="text-red-500">{categoryToDelete.subcategories.length}</strong>{' '}
                  columna(s) de evaluación asociadas
                </>
              )}
              ?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCategoryToDelete(null)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteCategory}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sí, eliminar categoría</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Categoría Mayor (Nombre, color, orden y subcolumnas) */}
      {activeEditCategoryLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Categoría Mayor</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Modificá el nombre, color o cambiá de lugar la categoría y sus columnas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-neutral-700 dark:text-slate-300">
                  Nombre de la Categoría Mayor
                </label>
                <input
                  type="text"
                  value={editCatName}
                  onChange={(e) => setEditCatName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditCategory()}
                  placeholder="Ej: Evaluaciones, Trabajos Prácticos..."
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  autoFocus
                />
              </div>

              {/* Importar notas directamente en esta columna / categoría */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/25 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Importar notas directamente en "
                      {activeEditCategoryLive.subcategories.length === 1
                        ? activeEditCategoryLive.subcategories[0].name
                        : editCatName.trim() || activeEditCategoryLive.name}
                      ":
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'forms'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-300'
                          : 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs'
                      }`}
                    >
                      <FileCheck className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Google Forms</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'sheets'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                          : 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs'
                      }`}
                    >
                      <Link2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Sheets / Docs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'file'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-300'
                          : 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Excel / Word / CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'paste'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-300'
                          : 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs'
                      }`}
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Pegar Notas</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Posición de la Categoría Mayor */}
              {onMoveCategory && categories.length > 1 && activeEditCatIndex >= 0 && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Posición en la planilla (Columna {activeEditCatIndex + 1} de {categories.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeEditCatIndex <= 0}
                      onClick={() => onMoveCategory(activeEditCatIndex, activeEditCatIndex - 1)}
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Mover a la izquierda</span>
                    </button>
                    <button
                      type="button"
                      disabled={activeEditCatIndex >= categories.length - 1}
                      onClick={() => onMoveCategory(activeEditCatIndex, activeEditCatIndex + 1)}
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <span>Mover a la derecha</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-slate-300">
                  Color distintivo
                </label>
                <div className="flex items-center gap-2">
                  {CATEGORY_COLORS.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => setEditCatColor(col.badge)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${col.badge} ${
                        editCatColor === col.badge ? 'ring-3 ring-offset-2 ring-blue-500 scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                      title={col.name}
                    >
                      {editCatColor === col.badge && <Check className="w-4 h-4 text-white stroke-[3]" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orden de las subcolumnas dentro de esta Categoría Mayor */}
              {onMoveSubcategory && activeEditCategoryLive.subcategories.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Orden de sus subcolumnas ({activeEditCategoryLive.subcategories.length})
                  </label>
                  <div
                    className={`rounded-xl border divide-y max-h-44 overflow-y-auto ${
                      isDarkMode
                        ? 'bg-slate-800/60 border-slate-700 divide-slate-700/70'
                        : 'bg-neutral-50 border-neutral-200 divide-neutral-200/70'
                    }`}
                  >
                    {activeEditCategoryLive.subcategories.map((sub, sIdx) => (
                      <div
                        key={sub.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold truncate">
                          {sIdx + 1}. {sub.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={sIdx === 0}
                            onClick={() =>
                              onMoveSubcategory(activeEditCategoryLive.id, sIdx, sIdx - 1)
                            }
                            className={`p-1 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 hover:bg-slate-700 text-slate-200'
                                : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                            }`}
                            title="Mover subcolumna a la izquierda (antes)"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={sIdx === activeEditCategoryLive.subcategories.length - 1}
                            onClick={() =>
                              onMoveSubcategory(activeEditCategoryLive.id, sIdx, sIdx + 1)
                            }
                            className={`p-1 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 hover:bg-slate-700 text-slate-200'
                                : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                            }`}
                            title="Mover subcolumna a la derecha (después)"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className={`p-3 rounded-xl border text-[11px] ${
                  isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
                }`}
              >
                <p>
                  Las <strong>{activeEditCategoryLive.subcategories.length} columna(s)</strong> y las notas ya cargadas para tus estudiantes se conservan intactas al cambiar de nombre o posición.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const cat = activeEditCategoryLive;
                  setCategoryToEdit(null);
                  setCategoryToDelete(cat);
                }}
                className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar categoría</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryToEdit(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editCatName.trim()}
                  onClick={handleSaveEditCategory}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer shadow-xs flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Opciones de Categorías Mayores */}
      {isManageCategoriesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Opciones y Orden de Categorías</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Administrá, renombrá o cambiá de lugar las categorías mayores y sus subcolumnas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 py-1">
              {categories.map((cat, catIdx) => (
                <div
                  key={cat.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                    isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${cat.color}`} />
                    <div className="min-w-0">
                      <span className="font-bold block truncate text-sm">{cat.name}</span>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                        {cat.subcategories.length} columna(s) de evaluación
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onMoveCategory && categories.length > 1 && (
                      <div className="flex items-center gap-1 mr-1">
                        <button
                          type="button"
                          disabled={catIdx === 0}
                          onClick={() => onMoveCategory(catIdx, catIdx - 1)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 hover:bg-slate-750 text-slate-200'
                              : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                          }`}
                          title="Mover categoría hacia la izquierda"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={catIdx === categories.length - 1}
                          onClick={() => onMoveCategory(catIdx, catIdx + 1)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 hover:bg-slate-750 text-slate-200'
                              : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                          }`}
                          title="Mover categoría hacia la derecha"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setCategoryToEdit(cat);
                        setEditCatName(cat.name);
                        setEditCatColor(cat.color);
                      }}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title={`Editar nombre de "${cat.name}"`}
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Editar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsManageCategoriesOpen(false);
                        setCategoryToDelete(cat);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                      title={`Eliminar categoría "${cat.name}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-neutral-200 dark:border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                placeholder="Nombre de nueva categoría mayor..."
                className={`flex-1 px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                }`}
              />
              <button
                type="button"
                disabled={!newCatName.trim()}
                onClick={handleAddCategory}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shrink-0 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar</span>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Subcategoría / Columna de Evaluación */}
      {subcatToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Columna / Evaluación</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Editá el título, agregá {intensificationDefaultLabel.toLowerCase()}es o importá notas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Nombre de la columna o evaluación
                </label>
                <input
                  type="text"
                  value={editSubcatName}
                  onChange={(e) => setEditSubcatName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditSubcategory()}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                  }`}
                  autoFocus
                />
              </div>

              {/* Sección: Instancias de Intensificación / Recuperación */}
              {onAddIntensification && activeSubcatLive && (
                <div
                  className={`p-3.5 rounded-xl border space-y-2.5 ${
                    isDarkMode
                      ? 'bg-amber-950/25 border-amber-500/40'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Instancias de {intensificationDefaultLabel} / Recuperación
                      </span>
                    </div>
                    {existingInstCount > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isDarkMode
                            ? 'bg-amber-900/60 text-amber-200'
                            : 'bg-amber-200/70 text-amber-900'
                        }`}
                      >
                        {existingInstCount} activa{existingInstCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Divide la columna bajo el título <strong>"{editSubcatName.trim() || subcatToEdit.name}"</strong>. Quienes tengan nota <strong>≥ 7</strong> muestran <strong>NI</strong> por defecto (editable si necesitás cargar nota). Las intensificaciones quedan fuera del promedio.
                  </p>

                  {/* Lista de intensificaciones ya creadas */}
                  {activeSubcatLive.intensifications && activeSubcatLive.intensifications.length > 0 && (
                    <div
                      className={`rounded-lg border divide-y ${
                        isDarkMode
                          ? 'bg-slate-900/80 border-slate-700 divide-slate-800'
                          : 'bg-white border-amber-200/80 divide-neutral-100'
                      }`}
                    >
                      {activeSubcatLive.intensifications.map((inst, iIdx) => (
                        <div
                          key={inst.id}
                          className="px-2.5 py-2 flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const catId = subcatToEdit.catId;
                              const subId = subcatToEdit.subId;
                              setSubcatToEdit(null);
                              setIntensificationToEdit?.({
                                catId,
                                subId,
                                instId: inst.id,
                              });
                            }}
                            className="text-left min-w-0 flex-1 hover:underline cursor-pointer"
                            title="Hacé clic para editar esta instancia o importar notas directamente"
                          >
                            <div className="font-bold text-xs truncate">
                              {iIdx + 1}. {inst.name}
                            </div>
                            {inst.customTitle && (
                              <div className="text-[10px] opacity-75 truncate">
                                Detalle: {inst.customTitle}
                              </div>
                            )}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const catId = subcatToEdit.catId;
                                const subId = subcatToEdit.subId;
                                setSubcatToEdit(null);
                                setIntensificationToEdit?.({
                                  catId,
                                  subId,
                                  instId: inst.id,
                                });
                              }}
                              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-slate-700 text-blue-300'
                                  : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                              }`}
                              title="Editar nombre o importar notas en esta instancia"
                            >
                              Editar / Importar
                            </button>
                            {onDeleteIntensification && (
                              <button
                                type="button"
                                onClick={() =>
                                  onDeleteIntensification(
                                    subcatToEdit.catId,
                                    subcatToEdit.subId,
                                    inst.id
                                  )
                                }
                                className="p-1 text-neutral-400 hover:text-red-500 rounded cursor-pointer"
                                title={`Eliminar "${inst.name}"`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Agregar nueva instancia */}
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-0.5">
                        Nombre sugerido:
                      </span>
                      {INTENSIFICATION_LABEL_PRESETS.slice(0, 3).map((preset) => {
                        const suggested =
                          existingInstCount === 0
                            ? preset
                            : `${preset} ${existingInstCount + 1}`;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setNewInstName(suggested)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                              newInstName.toLowerCase().startsWith(preset.toLowerCase())
                                ? 'bg-amber-600 text-white border-amber-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100/70'
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newInstName}
                        onChange={(e) => setNewInstName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleConfirmAddIntensification();
                          }
                        }}
                        placeholder={`Ej: ${intensificationDefaultLabel}, Recuperación...`}
                        className={`flex-1 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-amber-300 text-neutral-900'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleConfirmAddIntensification}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={newInstCustomTitle}
                      onChange={(e) => setNewInstCustomTitle(e.target.value)}
                      placeholder={`Especificación opcional (por defecto comparte "${editSubcatName.trim() || subcatToEdit.name}")`}
                      className={`w-full px-2.5 py-1.5 text-[11px] rounded-lg border focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                        isDarkMode
                          ? 'bg-slate-900/70 border-slate-700 text-slate-200 placeholder-slate-500'
                          : 'bg-white/90 border-amber-200/90 text-neutral-800 placeholder-neutral-400'
                      }`}
                    />

                    {onUpdateDefaultIntensificationLabel && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveAsDefaultTerm}
                          onChange={(e) => setSaveAsDefaultTerm(e.target.checked)}
                          className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <span>Guardar este nombre como predeterminado (por cambios de normativa)</span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Importar notas directamente con esta columna como destino */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Importar notas directamente en "{editSubcatName.trim() || subcatToEdit.name}":
                      </span>
                    </div>
                  </div>
                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Elegí desde dónde importar las calificaciones con esta columna ya seleccionada como destino:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'forms');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-200'
                          : 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs'
                      }`}
                    >
                      <FileCheck className="w-4 h-4 text-purple-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Google Forms</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Formulario o planilla de respuestas
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'sheets');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                          : 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs'
                      }`}
                    >
                      <Link2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Google Sheets / Docs</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Link o archivo de Google Drive
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'file');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-200'
                          : 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs'
                      }`}
                    >
                      <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Subir Archivo</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Excel (.xlsx), Word (.docx) o CSV
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'paste');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                          : 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs'
                      }`}
                    >
                      <ClipboardPaste className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Pegar Notas (Ctrl+V)</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Copiar y pegar alumnos y notas
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Cambiar de lugar dentro de la categoría */}
              {onMoveSubcategory &&
                activeSubcatParentCat &&
                activeSubcatParentCat.subcategories.length > 1 &&
                activeSubcatIndex >= 0 && (
                  <div className="space-y-1.5">
                    <label className="font-semibold text-neutral-700 dark:text-slate-300">
                      Posición dentro de "{activeSubcatParentCat.name}" ({activeSubcatIndex + 1} de{' '}
                      {activeSubcatParentCat.subcategories.length})
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={activeSubcatIndex <= 0}
                        onClick={() =>
                          onMoveSubcategory(
                            activeSubcatParentCat.id,
                            activeSubcatIndex,
                            activeSubcatIndex - 1
                          )
                        }
                        className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                            : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Mover antes (Izq.)</span>
                      </button>
                      <button
                        type="button"
                        disabled={
                          activeSubcatIndex >= activeSubcatParentCat.subcategories.length - 1
                        }
                        onClick={() =>
                          onMoveSubcategory(
                            activeSubcatParentCat.id,
                            activeSubcatIndex,
                            activeSubcatIndex + 1
                          )
                        }
                        className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                            : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <span>Mover después (Der.)</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              {/* Cambiar a otra Categoría Mayor */}
              {onMoveSubcategoryToCategory && categories.length > 1 && (
                <div className="space-y-1">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Categoría Mayor a la que pertenece:
                  </label>
                  <select
                    value={subcatToEdit.catId}
                    onChange={(e) => {
                      const nextCatId = e.target.value;
                      if (nextCatId && nextCatId !== subcatToEdit.catId) {
                        onMoveSubcategoryToCategory(
                          subcatToEdit.catId,
                          subcatToEdit.subId,
                          nextCatId
                        );
                        setSubcatToEdit({
                          ...subcatToEdit,
                          catId: nextCatId,
                        });
                      }
                    }}
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-hidden cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  handleDeleteSubcategory(subcatToEdit.catId, subcatToEdit.subId);
                  setSubcatToEdit(null);
                }}
                className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar columna</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubcatToEdit(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editSubcatName.trim()}
                  onClick={handleSaveEditSubcategory}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar / Importar en Instancia de Intensificación o Recuperación */}
      {intensificationToEdit && activeInstParentCat && activeInstParentSub && activeInstLive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIntensificationToEdit?.(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold truncate">
                    {activeInstLive.name}
                  </h3>
                  <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Evaluación: <strong>{activeInstParentSub.name}</strong> ({activeInstParentCat.name})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIntensificationToEdit?.(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Nombre de la instancia (por normativa o costumbre) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Nombre de esta instancia (etiqueta de la columna)
                  </label>
                  {onUpdateDefaultIntensificationLabel &&
                    editInstName.trim() &&
                    editInstName.trim().replace(/\s+\d+$/, '').toLowerCase() !==
                      intensificationDefaultLabel.toLowerCase() && (
                      <button
                        type="button"
                        onClick={() => {
                          const base =
                            editInstName.trim().replace(/\s+\d+$/, '').trim() ||
                            editInstName.trim();
                          onUpdateDefaultIntensificationLabel(base);
                          setSavedDefaultFeedback(true);
                          setTimeout(() => setSavedDefaultFeedback(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                        title="Usar este nombre por defecto cada vez que agregues nuevas instancias"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>
                          {savedDefaultFeedback
                            ? 'Guardado por defecto'
                            : 'Usar como predeterminado'}
                        </span>
                      </button>
                    )}
                </div>
                <input
                  type="text"
                  value={editInstName}
                  onChange={(e) => setEditInstName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditIntensification()}
                  placeholder="Ej: Intensificación, Recuperación, Recuperatorio..."
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-1">
                  {INTENSIFICATION_LABEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setEditInstName(
                          activeInstIndex > 0 ? `${preset} ${activeInstIndex + 1}` : preset
                        )
                      }
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                        editInstName.toLowerCase().startsWith(preset.toLowerCase())
                          ? 'bg-amber-600 text-white border-amber-600'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Especificación / Título editable */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Título / especificación (opcional — si queda vacío comparte "{activeInstParentSub.name}")
                </label>
                <input
                  type="text"
                  value={editInstCustomTitle}
                  onChange={(e) => setEditInstCustomTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditIntensification()}
                  placeholder={`Ej: ${activeInstParentSub.name} (Solo punto 2 / Oral / Diciembre)`}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  En informes y desglose figurará como:{' '}
                  <strong className={isDarkMode ? 'text-slate-200' : 'text-neutral-800'}>
                    {getIntensificationDisplayLabel(activeInstParentSub, {
                      ...activeInstLive,
                      name: editInstName.trim() || activeInstLive.name,
                      customTitle: editInstCustomTitle.trim() || undefined,
                    })}
                  </strong>
                </p>
              </div>

              {/* TODAS las opciones de importar notas (idénticas a evaluaciones y trabajos prácticos) */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Importar notas directamente en "{editInstName.trim() || activeInstLive.name}":
                    </span>
                  </div>
                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Elegí desde dónde importar las notas para esta instancia (quienes no figuren y tengan ≥ 7 permanecen en <strong>NI</strong>; no afecta el promedio):
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                    {(
                      [
                        {
                          source: 'forms' as const,
                          title: 'Google Forms',
                          subtitle: 'Formulario o planilla de respuestas',
                          icon: FileCheck,
                          iconColor: 'text-purple-500',
                          darkCls: 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-200',
                          lightCls: 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs',
                        },
                        {
                          source: 'sheets' as const,
                          title: 'Google Sheets / Docs',
                          subtitle: 'Link o archivo de Google Drive',
                          icon: Link2,
                          iconColor: 'text-emerald-500',
                          darkCls: 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-200',
                          lightCls: 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs',
                        },
                        {
                          source: 'file' as const,
                          title: 'Subir Archivo',
                          subtitle: 'Excel (.xlsx), Word (.docx) o CSV',
                          icon: Upload,
                          iconColor: 'text-blue-500',
                          darkCls: 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-200',
                          lightCls: 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs',
                        },
                        {
                          source: 'paste' as const,
                          title: 'Pegar Notas (Ctrl+V)',
                          subtitle: 'Copiar y pegar alumnos y notas',
                          icon: ClipboardPaste,
                          iconColor: 'text-indigo-500',
                          darkCls: 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-200',
                          lightCls: 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs',
                        },
                      ] as const
                    ).map((item) => {
                      const IconComp = item.icon;
                      return (
                        <button
                          key={item.source}
                          type="button"
                          onClick={() => {
                            const displayLabel = getIntensificationDisplayLabel(
                              activeInstParentSub,
                              {
                                ...activeInstLive,
                                name: editInstName.trim() || activeInstLive.name,
                                customTitle: editInstCustomTitle.trim() || undefined,
                              }
                            );
                            const target = {
                              categoryId: activeInstParentCat.id,
                              subcategoryId: activeInstLive.id,
                              subcategoryName: displayLabel,
                            };
                            setIntensificationToEdit?.(null);
                            onImportIntoColumn(target, item.source);
                          }}
                          className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                            isDarkMode ? item.darkCls : item.lightCls
                          }`}
                        >
                          <IconComp className={`w-4 h-4 ${item.iconColor} shrink-0`} />
                          <div className="min-w-0">
                            <div className="font-bold text-xs truncate">{item.title}</div>
                            <div className="text-[10px] opacity-75 truncate">{item.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Reordenar si hay más de una intensificación */}
              {onMoveIntensification && activeInstList.length > 1 && activeInstIndex >= 0 && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Orden de instancia ({activeInstIndex + 1} de {activeInstList.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeInstIndex <= 0}
                      onClick={() =>
                        onMoveIntensification(
                          activeInstParentCat.id,
                          activeInstParentSub.id,
                          activeInstIndex,
                          activeInstIndex - 1
                        )
                      }
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Mover antes</span>
                    </button>
                    <button
                      type="button"
                      disabled={activeInstIndex >= activeInstList.length - 1}
                      onClick={() =>
                        onMoveIntensification(
                          activeInstParentCat.id,
                          activeInstParentSub.id,
                          activeInstIndex,
                          activeInstIndex + 1
                        )
                      }
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <span>Mover después</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Atajo para agregar otra instancia a la misma evaluación */}
              {onAddIntensification && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = activeInstList.length + 1;
                      onAddIntensification(
                        activeInstParentCat.id,
                        activeInstParentSub.id,
                        `${intensificationDefaultLabel} ${nextIdx}`
                      );
                    }}
                    className={`w-full py-2 px-3 rounded-xl border border-dashed text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'border-amber-500/40 text-amber-300 hover:bg-amber-950/30'
                        : 'border-amber-300 text-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      Agregar otra instancia ({intensificationDefaultLabel} {activeInstList.length + 1}) a "{activeInstParentSub.name}"
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              {onDeleteIntensification ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteIntensification(
                      activeInstParentCat.id,
                      activeInstParentSub.id,
                      activeInstLive.id
                    );
                    setIntensificationToEdit?.(null);
                  }}
                  className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar instancia</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIntensificationToEdit?.(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editInstName.trim()}
                  onClick={handleSaveEditIntensification}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

