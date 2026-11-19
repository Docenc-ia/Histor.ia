import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { DetectedColumnConfig } from '../../../types/gradeImport';

export type VisualColumnRole =
  | 'student_name'
  | 'student_second_name'
  | 'student_email'
  | 'disposition'
  | 'disposition_deduction'
  | 'absences'
  | 'lates'
  | 'grade'
  | 'ignore';

function getColLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export interface ImportVisualMapperPanelProps {
  isDarkMode: boolean;
  raw2DGrid: any[][];
  selectedHeaderRowIndex: number;
  availableColumns: string[];
  selectedNameColumn: string;
  selectedSecondaryNameColumn: string;
  selectedEmailColumn: string;
  detectedColumns: DetectedColumnConfig[];
  onSelectCustomHeaderRowIndex: (newHeaderRowIdx: number) => void;
  onVisualColumnRoleChange: (colKey: string, role: VisualColumnRole) => void;
}

export const ImportVisualMapperPanel: React.FC<ImportVisualMapperPanelProps> = ({
  isDarkMode,
  raw2DGrid,
  selectedHeaderRowIndex,
  availableColumns,
  selectedNameColumn,
  selectedSecondaryNameColumn,
  selectedEmailColumn,
  detectedColumns,
  onSelectCustomHeaderRowIndex,
  onVisualColumnRoleChange,
}) => {
  return (
    <div
      className={`p-4 rounded-xl border space-y-3 ${
        isDarkMode
          ? 'bg-indigo-950/20 border-indigo-800/60'
          : 'bg-indigo-50/40 border-indigo-200'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300 flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              Mapeador Visual Interactivo — Elegí sobre tu planilla qué es cada fila y columna
            </span>
          </h4>
          <p className="text-[11px] text-neutral-600 dark:text-slate-400 mt-0.5">
            <strong>Paso A:</strong> Si tu planilla tiene encabezados arriba, hacé clic en la fila donde están los títulos (o elegí "Sin fila de títulos").{' '}
            <strong>Paso B:</strong> Usá el desplegable arriba de cada columna (Col A, Col B, Col C...) para indicar cuál es Alumno y cuál es Disposición.
          </p>
        </div>
      </div>

      {/* Paso A: Selector rápido de fila de encabezados */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-bold text-neutral-700 dark:text-slate-300 mr-1">
          Fila de títulos:
        </span>
        <button
          type="button"
          onClick={() => onSelectCustomHeaderRowIndex(-1)}
          className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
            selectedHeaderRowIndex === -1
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
              : isDarkMode
              ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
              : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          Sin títulos (Leer desde Fila 1)
        </button>
        {raw2DGrid.slice(0, 10).map((r, rIdx) => {
          const sampleText = (r || [])
            .map((c) => String(c ?? '').trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(' · ');
          return (
            <button
              key={rIdx}
              type="button"
              onClick={() => onSelectCustomHeaderRowIndex(rIdx)}
              className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all max-w-[190px] truncate ${
                selectedHeaderRowIndex === rIdx
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                  : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
              title={sampleText ? `Fila ${rIdx + 1}: ${sampleText}` : `Usar Fila ${rIdx + 1} como títulos`}
            >
              Fila {rIdx + 1}
              {sampleText ? `: ${sampleText}` : ''}
            </button>
          );
        })}
      </div>

      {/* Paso B: Tabla de vista previa real con desplegable por columna */}
      <div
        className={`border rounded-xl overflow-x-auto max-h-60 ${
          isDarkMode ? 'border-slate-750 bg-slate-900' : 'border-neutral-200 bg-white'
        }`}
      >
        <table className="w-full text-left text-[11px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr
              className={`border-b ${
                isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
              }`}
            >
              <th className="py-2 px-2.5 w-20 text-center font-bold text-neutral-500 border-r border-neutral-200 dark:border-slate-700">
                Fila
              </th>
              {availableColumns.map((colKey, colIdx) => {
                const colLetter = getColLetter(colIdx);
                const isPrimaryName = selectedNameColumn === colKey;
                const isSecondaryName = selectedSecondaryNameColumn === colKey;
                const isEmail = selectedEmailColumn === colKey;
                const detCfg = detectedColumns.find((c) => c.colKey === colKey);
                const currentRole = isPrimaryName
                  ? 'student_name'
                  : isSecondaryName
                  ? 'student_second_name'
                  : isEmail
                  ? 'student_email'
                  : detCfg?.isIncluded && detCfg.kind !== 'ignore'
                  ? detCfg.kind
                  : 'ignore';

                return (
                  <th
                    key={colKey}
                    className="p-2 min-w-[165px] border-r border-neutral-200 dark:border-slate-700 align-top"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-slate-700 text-[10px] font-mono font-bold">
                          Col {colLetter}
                        </span>
                        <span className="truncate font-bold text-neutral-700 dark:text-slate-200" title={colKey}>
                          {colKey}
                        </span>
                      </div>
                      <select
                        value={currentRole}
                        onChange={(e) =>
                          onVisualColumnRoleChange(colKey, e.target.value as VisualColumnRole)
                        }
                        className={`w-full px-2 py-1 rounded-lg border text-[11px] font-bold outline-hidden cursor-pointer ${
                          currentRole === 'student_name' || currentRole === 'student_second_name'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : currentRole === 'disposition' || currentRole === 'disposition_deduction'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : currentRole === 'absences' || currentRole === 'lates'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : currentRole === 'grade'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-slate-400'
                            : 'bg-white border-neutral-300 text-neutral-500'
                        }`}
                      >
                        <option value="ignore">🚫 Ignorar columna</option>
                        <option value="student_name">👤 Alumno (Apellido y Nombre)</option>
                        <option value="student_second_name">👤 2° Columna Alumno (Nombre)</option>
                        <option value="student_email">✉️ Correo / Email</option>
                        <option value="disposition">⭐ Nota de Disposición (1-10)</option>
                        <option value="disposition_deduction">➖ Descuento Disposición (resta de 10)</option>
                        <option value="absences">📅 Total Ausencias / Faltas</option>
                        <option value="lates">⏰ Total Llegadas Tarde</option>
                        <option value="grade">📊 Nota / Calificación</option>
                      </select>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-slate-800 font-mono">
            {raw2DGrid.slice(0, 7).map((rowArr, rIdx) => {
              const isHeaderRow = rIdx === selectedHeaderRowIndex;
              return (
                <tr
                  key={rIdx}
                  onClick={() => onSelectCustomHeaderRowIndex(rIdx)}
                  title="Hacé clic si querés usar esta fila como fila de títulos"
                  className={`cursor-pointer transition-colors ${
                    isHeaderRow
                      ? isDarkMode
                        ? 'bg-indigo-950/60 text-indigo-200 font-bold'
                        : 'bg-indigo-50 text-indigo-900 font-bold'
                      : isDarkMode
                      ? 'hover:bg-slate-800/50 text-slate-300'
                      : 'hover:bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <td className="py-1.5 px-2 text-center border-r border-neutral-100 dark:border-slate-800 whitespace-nowrap">
                    <span>Fila {rIdx + 1}</span>
                    {isHeaderRow && (
                      <span className="ml-1 px-1 py-0.2 rounded bg-indigo-600 text-white text-[9px] uppercase">
                        Títulos
                      </span>
                    )}
                  </td>
                  {availableColumns.map((colKey, colIdx) => (
                    <td
                      key={`${rIdx}-${colKey}`}
                      className="py-1.5 px-2.5 border-r border-neutral-100 dark:border-slate-800 truncate max-w-[180px]"
                    >
                      {String(rowArr?.[colIdx] ?? '') || '-'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
