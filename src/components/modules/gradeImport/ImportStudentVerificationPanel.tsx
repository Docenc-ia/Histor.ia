import React from 'react';
import { CheckCircle2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Student } from '../../../types';
import type {
  DetectedColumnConfig,
  MultiVerifiedStudentRow,
} from '../../../types/gradeImport';
import type { VisualColumnRole } from './ImportVisualMapperPanel';

export interface DocumentRowOptionItem {
  rawRowIndex: number;
  rawName: string;
  summaryPreview?: string;
}

export interface ImportStudentVerificationPanelProps {
  isDarkMode: boolean;
  importContext: 'grades' | 'attendance';
  students: Student[];
  availableColumns: string[];
  selectedNameColumn: string;
  detectedColumns: DetectedColumnConfig[];
  includedColumns: DetectedColumnConfig[];
  verifiedRows: MultiVerifiedStudentRow[];
  displayedRows: MultiVerifiedStudentRow[];
  includeNewStudentsFromDoc: boolean;
  includedRowsCount: number;
  filterMode: 'all' | 'changes' | 'missing';
  onChangeFilterMode: (mode: 'all' | 'changes' | 'missing') => void;
  searchFilter: string;
  onChangeSearchFilter: (val: string) => void;
  inspectionMode: 'table' | 'individual';
  selectedStudentIndex: number;
  onChangeSelectedStudentIndex: React.Dispatch<React.SetStateAction<number>>;
  currentInspectedRow?: MultiVerifiedStudentRow;
  documentRowOptions: DocumentRowOptionItem[];
  onVisualColumnRoleChange: (colKey: string, role: VisualColumnRole) => void;
  onToggleAllRows: (checked: boolean) => void;
  onToggleRowIncluded: (rowId: string) => void;
  onSelectDocumentRowForStudent: (studentId: string, rawRowIdxOrNull: number | null) => void;
  onReassignRowStudent: (rowId: string, targetStudentId: string) => void;
  onCellEdit: (rowId: string, colKey: string, newVal: string) => void;
}

export const ImportStudentVerificationPanel: React.FC<ImportStudentVerificationPanelProps> = ({
  isDarkMode,
  importContext,
  students,
  availableColumns,
  selectedNameColumn,
  detectedColumns,
  includedColumns,
  verifiedRows,
  displayedRows,
  includeNewStudentsFromDoc,
  includedRowsCount,
  filterMode,
  onChangeFilterMode,
  searchFilter,
  onChangeSearchFilter,
  inspectionMode,
  selectedStudentIndex,
  onChangeSelectedStudentIndex,
  currentInspectedRow,
  documentRowOptions,
  onVisualColumnRoleChange,
  onToggleAllRows,
  onToggleRowIncluded,
  onSelectDocumentRowForStudent,
  onReassignRowStudent,
  onCellEdit,
}) => {
  return (
    <div className="space-y-3">
      {/* Banner de Verificación Rápida */}
      {importContext === 'attendance' && (
        <div
          className={`p-3.5 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
            isDarkMode
              ? 'bg-emerald-950/25 border-emerald-800/60 text-slate-100'
              : 'bg-emerald-50/60 border-emerald-200 text-neutral-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-extrabold flex items-center gap-2 flex-wrap">
                <span>Verificación de Nombres y Datos</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  {verifiedRows.filter((r) => !r.isNewStudent && r.matchedFromRaw).length} de{' '}
                  {students.length} alumnos del curso vinculados
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {availableColumns.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-bold text-[11px] text-neutral-600 dark:text-slate-300">
                  Columna Faltas:
                </span>
                <select
                  value={
                    detectedColumns.find(
                      (c) => c.isIncluded && c.kind === 'absences'
                    )?.colKey || ''
                  }
                  onChange={(e) => {
                    const chosenAbsCol = e.target.value;
                    if (!chosenAbsCol) return;
                    onVisualColumnRoleChange(chosenAbsCol, 'absences');
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-bold outline-hidden cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-amber-300'
                      : 'bg-white border-neutral-300 text-amber-800'
                  }`}
                >
                  <option value="">-- Elegir columna de Faltas --</option>
                  {availableColumns
                    .filter((col) => col !== selectedNameColumn)
                    .map((col) => (
                      <option key={col} value={col}>
                        📅 {col}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {availableColumns.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-bold text-[11px] text-neutral-600 dark:text-slate-300">
                  Columna Disposición:
                </span>
                <select
                  value={
                    detectedColumns.find(
                      (c) =>
                        c.isIncluded &&
                        (c.kind === 'disposition' || c.kind === 'disposition_deduction')
                    )?.colKey || ''
                  }
                  onChange={(e) => {
                    const chosenDispCol = e.target.value;
                    if (!chosenDispCol) return;
                    onVisualColumnRoleChange(chosenDispCol, 'disposition');
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-bold outline-hidden cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-emerald-300'
                      : 'bg-white border-neutral-300 text-emerald-800'
                  }`}
                >
                  <option value="">-- Elegir columna de Disposición --</option>
                  {availableColumns
                    .filter((col) => col !== selectedNameColumn)
                    .map((col) => (
                      <option key={col} value={col}>
                        ⭐ {col}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <button
              type="button"
              onClick={() => onChangeFilterMode('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300'
                  : 'bg-white border-neutral-200 text-neutral-700'
              }`}
            >
              Todos ({verifiedRows.filter((r) => !r.isNewStudent || includeNewStudentsFromDoc).length})
            </button>
            <button
              type="button"
              onClick={() => onChangeFilterMode('changes')}
              className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                filterMode === 'changes'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300'
                  : 'bg-white border-neutral-200 text-neutral-700'
              }`}
            >
              Con nota ({includedRowsCount})
            </button>
            <button
              type="button"
              onClick={() => onChangeFilterMode('missing')}
              className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                filterMode === 'missing'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300'
                  : 'bg-white border-neutral-200 text-neutral-700'
              }`}
            >
              Sin nota ({verifiedRows.filter((r) => !r.isNewStudent && !r.matchedFromRaw).length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => onChangeSearchFilter(e.target.value)}
              placeholder="Buscar alumno..."
              className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
              }`}
            />
          </div>
        </div>
      </div>

      {/* VISTA TABLA DE COMPROBACIÓN COMPACTA (ALUMNO Y NOTA JUNTOS SIN ESPACIO GRANDE) */}
      {inspectionMode === 'table' && (
        <div
          className={`border rounded-xl overflow-hidden shadow-xs ${
            isDarkMode ? 'border-slate-750 bg-slate-900' : 'border-neutral-200 bg-white'
          }`}
        >
          <div className="overflow-x-auto max-h-[48vh]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr
                  className={`border-b ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-750 text-slate-200'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                  }`}
                >
                  <th className="py-2.5 px-2.5 w-10 text-center font-bold">
                    <input
                      type="checkbox"
                      checked={
                        displayedRows.length > 0 &&
                        displayedRows.every((r) => r.isIncluded)
                      }
                      onChange={(e) => onToggleAllRows(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                      title="Seleccionar o desmarcar todos"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-bold">Alumno</th>
                  {includedColumns.map((col) => (
                    <th
                      key={col.colKey}
                      className="py-2.5 px-4 text-left font-bold w-36 whitespace-nowrap"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">
                          {col.kind === 'grade'
                            ? 'Nota'
                            : col.kind === 'absences'
                            ? 'Asistencia'
                            : col.kind === 'lates'
                            ? 'Tardanzas'
                            : col.kind === 'disposition_deduction'
                            ? 'Disposición (10 - Desc.)'
                            : 'Disposición'}
                        </span>
                        <span className="truncate max-w-[130px]">
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
                      colSpan={2 + includedColumns.length}
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
                      <td className="py-2 px-2.5 text-center w-10">
                        <input
                          type="checkbox"
                          checked={row.isIncluded}
                          onChange={() => onToggleRowIncluded(row.rowId)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                        />
                      </td>

                      <td className="py-2 px-3 font-semibold">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs">{row.studentName}</span>
                            {row.matchedFromRaw ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                ✓ Detectado
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-neutral-200/70 dark:bg-slate-800 text-neutral-500 dark:text-slate-400">
                                Sin nota en planilla
                              </span>
                            )}
                            {row.isNewStudent && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                + Alumno nuevo
                              </span>
                            )}
                          </div>

                          {!row.isNewStudent &&
                            !row.matchedFromRaw &&
                            documentRowOptions.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  onSelectDocumentRowForStudent(
                                    row.studentId,
                                    val === '' ? null : Number(val)
                                  );
                                }}
                                className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium outline-hidden cursor-pointer max-w-[210px] truncate ${
                                  isDarkMode
                                    ? 'bg-slate-800 border-amber-700/60 text-amber-300'
                                    : 'bg-amber-50/60 border-amber-300 text-amber-900'
                                }`}
                                title="Vincular manualmente con una fila de la planilla"
                              >
                                <option value="">Vincular fila...</option>
                                {documentRowOptions.map((opt) => (
                                  <option key={opt.rawRowIndex} value={String(opt.rawRowIndex)}>
                                    {opt.rawName}
                                    {opt.summaryPreview ? ` (${opt.summaryPreview})` : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                        </div>
                        {row.isNewStudent && students.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                onReassignRowStudent(row.rowId, e.target.value);
                              }
                            }}
                            className={`mt-1 w-full text-[10px] px-1.5 py-1 rounded border font-semibold outline-hidden cursor-pointer ${
                              isDarkMode
                                ? 'bg-slate-800 border-slate-700 text-blue-300'
                                : 'bg-blue-50/60 border-blue-200 text-blue-800'
                            }`}
                            title="Asignar esta fila del documento a un alumno existente del curso"
                          >
                            <option value="">
                              👉 Elegir a qué alumno del curso corresponde...
                            </option>
                            {students.map((s) => (
                              <option key={s.id} value={s.id}>
                                Vincular con: {s.lastName}, {s.firstName}
                              </option>
                            ))}
                          </select>
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
                          <td
                            key={col.colKey}
                            className="py-2 px-4 text-left w-36 whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={cell.editedVal}
                                onChange={(e) =>
                                  onCellEdit(row.rowId, col.colKey, e.target.value)
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
                                  (era {cell.currentVal})
                                </span>
                              )}
                              {!cell.isValid && (
                                <span className="text-[10px] text-red-500 font-bold">
                                  Inválido
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-neutral-200 dark:border-slate-800">
            <div className="space-y-1.5 flex-1">
              <span className="text-[11px] font-bold uppercase text-blue-600 dark:text-blue-400">
                Alumno {selectedStudentIndex + 1} de {displayedRows.length}
              </span>
              <h4 className="text-base font-bold">{currentInspectedRow.studentName}</h4>
              {!currentInspectedRow.isNewStudent && documentRowOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-neutral-500 dark:text-slate-400 font-semibold">
                    Nombre en el documento:
                  </span>
                  <select
                    value={
                      typeof currentInspectedRow.matchedRawRowIndex === 'number'
                        ? String(currentInspectedRow.matchedRawRowIndex)
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      onSelectDocumentRowForStudent(
                        currentInspectedRow.studentId,
                        val === '' ? null : Number(val)
                      );
                    }}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-semibold outline-hidden cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-100'
                        : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                    }`}
                  >
                    <option value="">
                      — Sin vincular (elegir nombre del documento...) —
                    </option>
                    {documentRowOptions.map((opt) => (
                      <option key={opt.rawRowIndex} value={String(opt.rawRowIndex)}>
                        {opt.rawName}
                        {opt.summaryPreview ? ` (${opt.summaryPreview})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-slate-400">
                  Detectado en documento como: "{currentInspectedRow.matchedFromRaw || 'No encontrado'}"
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedStudentIndex <= 0}
                onClick={() => onChangeSelectedStudentIndex((i) => Math.max(0, i - 1))}
                className="p-2 rounded-xl border disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={selectedStudentIndex >= displayedRows.length - 1}
                onClick={() =>
                  onChangeSelectedStudentIndex((i) => Math.min(displayedRows.length - 1, i + 1))
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
                        onCellEdit(currentInspectedRow.rowId, col.colKey, e.target.value)
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
  );
};
