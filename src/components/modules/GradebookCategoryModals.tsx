/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
} from 'lucide-react';
import { GradeCategory } from '../../types/grades';
import { CATEGORY_COLORS } from '../../utils/gradeCalculations';

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
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 ${
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
                    Cambiá el nombre, movela de lugar o pasala a otra categoría.
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
    </>
  );
};

