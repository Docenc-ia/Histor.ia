/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Trash2, Edit2, X, Check, Settings, Plus } from 'lucide-react';
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
}) => {
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

      {/* Modal: Editar Categoría Mayor (Nombre y color) */}
      {categoryToEdit && (
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
                  <h3 className="text-base font-bold">Editar Categoría Mayor</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Modifica el nombre o color distintivo de esta categoría.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
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

              <div
                className={`p-3 rounded-xl border text-[11px] ${
                  isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
                }`}
              >
                <p>
                  Las <strong>{categoryToEdit.subcategories.length} columna(s)</strong> y las notas ya cargadas para tus estudiantes se conservan intactas al cambiar de nombre.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const cat = categoryToEdit;
                  setCategoryToEdit(null);
                  setCategoryToDelete(cat);
                }}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 cursor-pointer"
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
                  <h3 className="text-base font-bold">Opciones de Categorías Mayores</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Administra y edita los nombres de las categorías de evaluación.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 py-1">
              {categories.map((cat) => (
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
            className={`w-full max-w-sm rounded-2xl border shadow-2xl p-5 space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold">Editar Columna de Evaluación</h3>
              </div>
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Nombre de la columna
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

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300' : 'border-neutral-200 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!editSubcatName.trim()}
                onClick={handleSaveEditSubcategory}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
