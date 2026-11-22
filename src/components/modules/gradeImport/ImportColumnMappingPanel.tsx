import React from 'react';
import { Layers, UserPlus, Calendar, Star, Clock } from 'lucide-react';
import { Student } from '../../../types';
import { GradeCategory, StudentGradesMap } from '../../../types/grades';
import type { DetectedColumnConfig, DetectedColumnKind } from '../../../types/gradeImport';
import type { PreferredTargetColumn } from './ImportUploadStep';
import {
  findGradeColumnById,
  getIntensificationDisplayLabel,
} from '../../../utils/gradeCalculations';

export interface ImportColumnMappingPanelProps {
  isDarkMode: boolean;
  importContext: 'grades' | 'attendance';
  attendanceTargetMode: 'disposition' | 'absences' | 'both';
  students: Student[];
  activeCategories: GradeCategory[];
  activeGradesMap: StudentGradesMap;
  detectedColumns: DetectedColumnConfig[];
  includedColumnsCount: number;
  newStudentsCount: number;
  includeNewStudentsFromDoc: boolean;
  onToggleIncludeNewStudents: (checked: boolean) => void;
  onSetPreferredTargetColumn: (target: PreferredTargetColumn | null) => void;
  onUpdateColumnConfig: (colKey: string, patch: Partial<DetectedColumnConfig>) => void;
}

export const ImportColumnMappingPanel: React.FC<ImportColumnMappingPanelProps> = ({
  isDarkMode,
  importContext,
  attendanceTargetMode,
  students,
  activeCategories,
  activeGradesMap,
  detectedColumns,
  includedColumnsCount,
  newStudentsCount,
  includeNewStudentsFromDoc,
  onToggleIncludeNewStudents,
  onSetPreferredTargetColumn,
  onUpdateColumnConfig,
}) => {
  return (
    <>
      {/* 1. SECCIÓN DE DESTINO DE LA NOTA / CATEGORÍA */}
      <div
        className={`p-3.5 rounded-xl border space-y-2.5 ${
          isDarkMode ? 'bg-slate-850/70 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {importContext === 'grades'
                ? 'Destino de la Calificación'
                : `1. Columnas Detectadas (${includedColumnsCount} seleccionadas)`}
            </h4>
          </div>
          <span className="text-[11px] text-neutral-500 dark:text-slate-400">
            {importContext === 'grades'
              ? 'Elegí en qué categoría y con qué nombre guardar la evaluación.'
              : 'Podés elegir qué columnas importar.'}
          </span>
        </div>

        <div
          className={`grid grid-cols-1 ${
            importContext === 'grades' ? '' : 'md:grid-cols-2'
          } gap-2.5`}
        >
          {(importContext === 'grades'
            ? detectedColumns.filter((c) => c.isIncluded && c.kind === 'grade')
            : detectedColumns
          ).map((colCfg) => (
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
              {importContext !== 'grades' && (
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-xs">
                    <input
                      type="checkbox"
                      checked={colCfg.isIncluded && colCfg.kind !== 'ignore'}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onUpdateColumnConfig(colCfg.colKey, {
                          isIncluded: checked,
                          kind:
                            checked && colCfg.kind === 'ignore'
                              ? importContext === 'attendance'
                                ? attendanceTargetMode === 'absences'
                                  ? 'absences'
                                  : 'disposition'
                                : 'grade'
                              : colCfg.kind,
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
                      onUpdateColumnConfig(colCfg.colKey, {
                        kind: nextKind,
                        isIncluded: nextKind !== 'ignore',
                      });
                    }}
                    className={`px-2 py-1 text-[11px] rounded-lg border font-bold outline-hidden ${
                      colCfg.kind === 'grade'
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                        : colCfg.kind === 'ignore'
                        ? 'bg-neutral-100 dark:bg-slate-800 text-neutral-500 border-neutral-300 dark:border-slate-700'
                        : colCfg.kind === 'absences' || colCfg.kind === 'lates'
                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                        : 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                    }`}
                  >
                    <option value="absences">Total Ausencias / Cantidad de Faltas</option>
                    <option value="lates">Llegadas Tarde / Tardanzas</option>
                    <option value="disposition">Nota de Disposición (1-10)</option>
                    <option value="disposition_deduction">Descuento Disposición (resta de 10)</option>
                    <option value="grade">Nota / Calificación</option>
                    <option value="ignore">Ignorar columna</option>
                  </select>
                </div>
              )}

              {importContext === 'attendance' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-neutral-100 dark:border-slate-700/60">
                  <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-1">
                    Asignar como:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateColumnConfig(colCfg.colKey, {
                        kind: 'absences',
                        isIncluded: true,
                      })
                    }
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                      colCfg.isIncluded && colCfg.kind === 'absences'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>Cantidad de Faltas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateColumnConfig(colCfg.colKey, {
                        kind: 'disposition',
                        isIncluded: true,
                      })
                    }
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                      colCfg.isIncluded && colCfg.kind === 'disposition'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <Star className="w-3 h-3 shrink-0" />
                    <span>Nota de Disposición</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateColumnConfig(colCfg.colKey, {
                        kind: 'lates',
                        isIncluded: true,
                      })
                    }
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                      colCfg.isIncluded && colCfg.kind === 'lates'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Tardanzas</span>
                  </button>
                </div>
              )}

              {colCfg.isIncluded && colCfg.kind === 'grade' && (
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${
                    importContext === 'grades'
                      ? ''
                      : 'pt-1 border-t border-neutral-100 dark:border-slate-700/60'
                  } text-[11px]`}
                >
                  {/* Categoría Mayor destino */}
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-neutral-500 dark:text-slate-400">
                        Categoría Mayor:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateColumnConfig(colCfg.colKey, {
                            targetCategoryMode:
                              colCfg.targetCategoryMode === 'new' ? 'existing' : 'new',
                            newCategoryName: colCfg.newCategoryName || colCfg.colKey,
                          })
                        }
                        className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        {colCfg.targetCategoryMode === 'new'
                          ? 'Elegir existente'
                          : '+ Nueva categoría'}
                      </button>
                    </div>
                    <select
                      value={
                        colCfg.targetCategoryMode === 'new'
                          ? '__NEW_CAT__'
                          : colCfg.targetCategoryId
                      }
                      onChange={(e) => {
                        if (e.target.value === '__NEW_CAT__') {
                          onSetPreferredTargetColumn(null);
                          onUpdateColumnConfig(colCfg.colKey, {
                            targetCategoryMode: 'new',
                            newCategoryName: colCfg.newCategoryName || colCfg.colKey,
                            targetSubcategoryMode: 'new',
                            targetSubcategoryId: '',
                          });
                        } else {
                          const nextCatId = e.target.value;
                          const nextCat = activeCategories.find((c) => c.id === nextCatId);
                          if (colCfg.targetSubcategoryMode === 'existing' && nextCat) {
                            const firstSub = nextCat.subcategories[0];
                            if (firstSub) {
                              onSetPreferredTargetColumn({
                                categoryId: nextCat.id,
                                subcategoryId: firstSub.id,
                                subcategoryName: firstSub.name,
                              });
                              onUpdateColumnConfig(colCfg.colKey, {
                                targetCategoryMode: 'existing',
                                targetCategoryId: nextCat.id,
                                targetSubcategoryMode: 'existing',
                                targetSubcategoryId: firstSub.id,
                                subcategoryName: firstSub.name,
                              });
                            } else {
                              onSetPreferredTargetColumn({
                                categoryId: nextCat.id,
                                subcategoryId: '__CATEGORY_DIRECT__',
                                subcategoryName: nextCat.name,
                              });
                              onUpdateColumnConfig(colCfg.colKey, {
                                targetCategoryMode: 'existing',
                                targetCategoryId: nextCat.id,
                                targetSubcategoryMode: 'existing',
                                targetSubcategoryId: '__CATEGORY_DIRECT__',
                                subcategoryName: nextCat.name,
                              });
                            }
                          } else {
                            onUpdateColumnConfig(colCfg.colKey, {
                              targetCategoryMode: 'existing',
                              targetCategoryId: nextCatId,
                            });
                          }
                        }
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg border font-medium outline-hidden ${
                        isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                      }`}
                    >
                      {activeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value="__NEW_CAT__">+ Crear Nueva Categoría Mayor...</option>
                    </select>

                    {colCfg.targetCategoryMode === 'new' && (
                      <input
                        type="text"
                        value={colCfg.newCategoryName}
                        onChange={(e) =>
                          onUpdateColumnConfig(colCfg.colKey, {
                            newCategoryName: e.target.value,
                          })
                        }
                        placeholder="Nombre de la nueva Categoría Mayor..."
                        className={`mt-1 w-full px-2.5 py-1.5 rounded-lg border font-semibold ${
                          isDarkMode
                            ? 'bg-slate-900 border-emerald-700 text-emerald-300'
                            : 'bg-emerald-50/50 border-emerald-300 text-emerald-800'
                        }`}
                      />
                    )}
                  </div>

                  {/* Columna / Evaluación de destino (permite elegir cualquier columna existente con o sin notas, o crear una nueva) */}
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-neutral-500 dark:text-slate-400">
                        Columna / Evaluación de destino:
                      </span>
                      {colCfg.targetCategoryMode === 'existing' && (
                        <button
                          type="button"
                          onClick={() => {
                            const currentCat = activeCategories.find(
                              (c) => c.id === colCfg.targetCategoryId
                            );
                            const firstSub = currentCat?.subcategories[0];
                            if (colCfg.targetSubcategoryMode === 'existing') {
                              onUpdateColumnConfig(colCfg.colKey, {
                                targetSubcategoryMode: 'new',
                                targetSubcategoryId: '',
                                subcategoryName: colCfg.subcategoryName || colCfg.colKey,
                              });
                            } else if (firstSub) {
                              onUpdateColumnConfig(colCfg.colKey, {
                                targetSubcategoryMode: 'existing',
                                targetSubcategoryId: firstSub.id,
                                subcategoryName: firstSub.name,
                              });
                            } else if (currentCat && currentCat.subcategories.length === 0) {
                              onUpdateColumnConfig(colCfg.colKey, {
                                targetSubcategoryMode: 'existing',
                                targetSubcategoryId: '__CATEGORY_DIRECT__',
                                subcategoryName: currentCat.name,
                              });
                            }
                          }}
                          className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {colCfg.targetSubcategoryMode === 'existing'
                            ? '+ Crear columna nueva'
                            : 'Elegir columna existente'}
                        </button>
                      )}
                    </div>

                    {colCfg.targetCategoryMode === 'existing' && (
                      <select
                        value={
                          colCfg.targetSubcategoryMode === 'existing' &&
                          colCfg.targetSubcategoryId
                            ? `${colCfg.targetCategoryId}:::${colCfg.targetSubcategoryId}`
                            : '__NEW_SUB__'
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__NEW_SUB__') {
                            onSetPreferredTargetColumn(null);
                            onUpdateColumnConfig(colCfg.colKey, {
                              targetSubcategoryMode: 'new',
                              targetSubcategoryId: '',
                              subcategoryName: colCfg.subcategoryName || colCfg.colKey,
                            });
                            return;
                          }

                          const [chosenCatId, chosenSubId] = val.split(':::');
                          const chosenCat = activeCategories.find(
                            (c) => c.id === chosenCatId
                          );
                          if (!chosenCat) return;

                          if (chosenSubId === '__CATEGORY_DIRECT__') {
                            const nextTarget = {
                              categoryId: chosenCat.id,
                              subcategoryId: '__CATEGORY_DIRECT__',
                              subcategoryName: chosenCat.name,
                            };
                            onSetPreferredTargetColumn(nextTarget);
                            onUpdateColumnConfig(colCfg.colKey, {
                              targetCategoryMode: 'existing',
                              targetCategoryId: chosenCat.id,
                              targetSubcategoryMode: 'existing',
                              targetSubcategoryId: '__CATEGORY_DIRECT__',
                              subcategoryName: chosenCat.name,
                            });
                          } else {
                            const matched = findGradeColumnById(activeCategories, chosenSubId);
                            if (!matched) return;
                            const nextTarget = {
                              categoryId: matched.category.id,
                              subcategoryId: chosenSubId,
                              subcategoryName: matched.displayLabel,
                            };
                            onSetPreferredTargetColumn(nextTarget);
                            onUpdateColumnConfig(colCfg.colKey, {
                              targetCategoryMode: 'existing',
                              targetCategoryId: matched.category.id,
                              targetSubcategoryMode: 'existing',
                              targetSubcategoryId: chosenSubId,
                              subcategoryName: matched.displayLabel,
                            });
                          }
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-lg border font-semibold outline-hidden cursor-pointer ${
                          colCfg.targetSubcategoryMode === 'existing'
                            ? isDarkMode
                              ? 'bg-slate-900 border-emerald-600 text-emerald-300'
                              : 'bg-emerald-50/70 border-emerald-400 text-emerald-900'
                            : isDarkMode
                            ? 'bg-slate-900 border-slate-700'
                            : 'bg-neutral-50 border-neutral-300'
                        }`}
                      >
                        {(() => {
                          const selectedCat = activeCategories.find(
                            (c) => c.id === colCfg.targetCategoryId
                          );
                          const otherCats = activeCategories.filter(
                            (c) => c.id !== colCfg.targetCategoryId
                          );
                          return (
                            <>
                              {selectedCat && selectedCat.subcategories.length > 0 && (
                                <optgroup
                                  label={`Columnas existentes en "${selectedCat.name}"`}
                                >
                                  {selectedCat.subcategories.map((sub) => {
                                    const existingCount = students.filter(
                                      (st) =>
                                        String(
                                          activeGradesMap[st.id]?.[sub.id] ?? ''
                                        ).trim() !== ''
                                    ).length;
                                    const instList = sub.intensifications || [];
                                    return (
                                      <React.Fragment key={sub.id}>
                                        <option
                                          value={`${selectedCat.id}:::${sub.id}`}
                                        >
                                          Columna existente: {sub.name}
                                          {existingCount > 0
                                            ? ` (${existingCount} notas cargadas)`
                                            : ''}
                                        </option>
                                        {instList.map((inst) => {
                                          const instCount = students.filter(
                                            (st) =>
                                              String(
                                                activeGradesMap[st.id]?.[inst.id] ?? ''
                                              ).trim() !== ''
                                          ).length;
                                          return (
                                            <option
                                              key={inst.id}
                                              value={`${selectedCat.id}:::${inst.id}`}
                                            >
                                              ↳ {getIntensificationDisplayLabel(sub, inst)}
                                              {instCount > 0 ? ` (${instCount} notas)` : ''}
                                            </option>
                                          );
                                        })}
                                      </React.Fragment>
                                    );
                                  })}
                                </optgroup>
                              )}
                              {selectedCat && selectedCat.subcategories.length === 0 && (
                                <option
                                  value={`${selectedCat.id}:::__CATEGORY_DIRECT__`}
                                >
                                  Nota General de "{selectedCat.name}"
                                </option>
                              )}
                              {otherCats.map((otherCat) =>
                                otherCat.subcategories.length > 0 ? (
                                  <optgroup
                                    key={otherCat.id}
                                    label={`Otras columnas (${otherCat.name})`}
                                  >
                                    {otherCat.subcategories.map((sub) => {
                                      const existingCount = students.filter(
                                        (st) =>
                                          String(
                                            activeGradesMap[st.id]?.[sub.id] ?? ''
                                          ).trim() !== ''
                                      ).length;
                                      const instList = sub.intensifications || [];
                                      return (
                                        <React.Fragment key={sub.id}>
                                          <option
                                            value={`${otherCat.id}:::${sub.id}`}
                                          >
                                            {otherCat.name} → {sub.name}
                                            {existingCount > 0
                                              ? ` (${existingCount} notas cargadas)`
                                              : ''}
                                          </option>
                                          {instList.map((inst) => {
                                            const instCount = students.filter(
                                              (st) =>
                                                String(
                                                  activeGradesMap[st.id]?.[inst.id] ?? ''
                                                ).trim() !== ''
                                            ).length;
                                            return (
                                              <option
                                                key={inst.id}
                                                value={`${otherCat.id}:::${inst.id}`}
                                              >
                                                {otherCat.name} → {getIntensificationDisplayLabel(sub, inst)}
                                                {instCount > 0 ? ` (${instCount} notas)` : ''}
                                              </option>
                                            );
                                          })}
                                        </React.Fragment>
                                      );
                                    })}
                                  </optgroup>
                                ) : null
                              )}
                              <option value="__NEW_SUB__">
                                + Crear nueva columna de evaluación...
                              </option>
                            </>
                          );
                        })()}
                      </select>
                    )}

                    {(colCfg.targetCategoryMode === 'new' ||
                      colCfg.targetSubcategoryMode === 'new') && (
                      <input
                        type="text"
                        value={colCfg.subcategoryName}
                        onChange={(e) =>
                          onUpdateColumnConfig(colCfg.colKey, {
                            subcategoryName: e.target.value,
                          })
                        }
                        placeholder="Nombre de la nueva columna (ej. Dictadura / TP 1)"
                        className={`${
                          colCfg.targetCategoryMode === 'existing' ? 'mt-1 ' : ''
                        }w-full px-2.5 py-1.5 rounded-lg border font-semibold ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700'
                            : 'bg-white border-neutral-300'
                        }`}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Opción para agregar alumnos nuevos si el documento tiene alumnos que aún no están en el curso */}
      {newStudentsCount > 0 && (
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
              Se detectaron <strong>{newStudentsCount} alumno(s)</strong> en el documento que aún no estaban en la lista del curso.
            </span>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={includeNewStudentsFromDoc}
              onChange={(e) => onToggleIncludeNewStudents(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
            />
            <span>Agregar también estos alumnos al curso e importar sus datos</span>
          </label>
        </div>
      )}
    </>
  );
};
