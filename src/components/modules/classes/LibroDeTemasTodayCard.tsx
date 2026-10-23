import React from 'react';
import { Calendar, Pencil, Trash2 } from 'lucide-react';
import {
  LibroDeTemasEntry,
  NO_CLASS_PRESETS,
  ScheduledRow,
} from '../LibroDeTemasMatrix';

export interface LibroDeTemasTodayCardProps {
  activeTodayRow: ScheduledRow;
  todayRows: ScheduledRow[];
  selectedTodaySlotIndex: number;
  setSelectedTodaySlotIndex: React.Dispatch<React.SetStateAction<number>>;
  isDarkMode: boolean;
  activeWeekdays: number[];
  characterOptions: string[];
  termFilter: 'all' | '1c' | '2c' | 'until_today';
  setTermFilter: React.Dispatch<React.SetStateAction<'all' | '1c' | '2c' | 'until_today'>>;
  statusFilter: 'all' | 'completed' | 'pending' | 'holidays';
  setStatusFilter: React.Dispatch<
    React.SetStateAction<'all' | 'completed' | 'pending' | 'holidays'>
  >;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  todayRowRef: React.RefObject<HTMLTableRowElement | null>;
  handleOpenNoClassModal: (row: ScheduledRow) => void;
  handleDeleteOrClearRow: (row: ScheduledRow) => void;
  setShowCharacterOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  updateEntryField: (
    dateStr: string,
    updater: (current: LibroDeTemasEntry) => LibroDeTemasEntry
  ) => void;
  handleSignRow: (dateStr: string) => void;
}

export const LibroDeTemasTodayCard: React.FC<LibroDeTemasTodayCardProps> = ({
  activeTodayRow: row,
  todayRows,
  setSelectedTodaySlotIndex,
  isDarkMode,
  activeWeekdays,
  characterOptions,
  termFilter,
  setTermFilter,
  statusFilter,
  setStatusFilter,
  searchQuery,
  setSearchQuery,
  todayRowRef,
  handleOpenNoClassModal,
  handleDeleteOrClearRow,
  setShowCharacterOptionsModal,
  updateEntryField,
  handleSignRow,
}) => {
  const isHol = row.entry.isHoliday;
  const noClassPreset = NO_CLASS_PRESETS.find(
    (p) => p.id === (row.entry.noClassCategory || 'feriado')
  );
  const noClassBadgeText = noClassPreset?.badgeLabel || 'Sin clase';

  return (
    <div
      className={`rounded-xl border-2 overflow-hidden shadow-xs transition-colors mb-4 ${
        isDarkMode
          ? 'bg-slate-900 border-blue-600/80 shadow-blue-950/20'
          : 'bg-white border-blue-400 shadow-blue-500/5'
      }`}
    >
      {/* Cabecera de la tarjeta Clase de Hoy */}
      <div
        className={`px-3.5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
          isDarkMode
            ? 'bg-blue-950/75 border-blue-800/80'
            : 'bg-blue-50 border-blue-200'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-blue-600 text-white shadow-2xs shrink-0">
            <Calendar className="w-3 h-3" />
            Clase de Hoy
          </span>
          <span
            className={`text-xs font-extrabold ${
              isDarkMode ? 'text-blue-100' : 'text-blue-950'
            }`}
          >
            {row.weekdayFull} {row.day}/{row.month}
            {row.timeLabel ? ` · ${row.timeLabel}` : ''}
            {row.computedClassNumber !== '-'
              ? ` · Clase N° ${row.computedClassNumber}`
              : ' · Día sin dictado'}
          </span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isDarkMode
                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                : 'bg-white text-neutral-700 border border-neutral-200'
            }`}
          >
            {row.term === '1c' ? '1° Cuatr.' : '2° Cuatr.'}
          </span>
          <span
            className={`text-[10px] font-medium hidden sm:inline ${
              isDarkMode ? 'text-slate-400' : 'text-neutral-500'
            }`}
          >
            (Sincronizada con la fila de la tabla)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (termFilter !== 'all' || statusFilter !== 'all' || searchQuery) {
                setTermFilter('all');
                setStatusFilter('all');
                setSearchQuery('');
              }
              setTimeout(() => {
                const el = document.getElementById(`row-${row.rowKey}`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else if (todayRowRef.current) {
                  todayRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 50);
            }}
            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-semibold shrink-0 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-blue-500'
                : 'bg-white border-neutral-300 text-neutral-700 hover:border-blue-500'
            }`}
            title="Desplazarse hasta la fila de esta clase en la tabla cronológica de abajo"
          >
            Ver en la tabla ↓
          </button>

          <button
            type="button"
            onClick={() => handleOpenNoClassModal(row)}
            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-semibold shrink-0 ${
              isHol
                ? isDarkMode
                  ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                  : 'bg-amber-100 border-amber-300 text-amber-800'
                : isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-amber-500'
                : 'bg-white border-neutral-300 text-neutral-700 hover:border-amber-500'
            }`}
          >
            {isHol ? `Evento: ${noClassBadgeText} (Editar)` : 'Marcar Sin clase / Evento'}
          </button>

          {(!activeWeekdays.includes(row.dow) ||
            row.entry.isCustomDate ||
            Boolean(
              row.entry.contents.trim() ||
                row.entry.unitNumber.trim() ||
                row.entry.classCharacter.trim() ||
                row.entry.observations.trim() ||
                row.entry.teacherSignature.trim() ||
                row.entry.authoritySignature.trim() ||
                row.entry.isHoliday
            )) && (
            <button
              type="button"
              onClick={() => handleDeleteOrClearRow(row)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-semibold inline-flex items-center gap-1 shrink-0 ${
                isDarkMode
                  ? 'bg-red-950/50 border-red-800/80 text-red-300 hover:bg-red-900/60'
                  : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              }`}
              title={
                !activeWeekdays.includes(row.dow) || row.entry.isCustomDate
                  ? 'Eliminar esta fecha fuera del horario de cursada'
                  : 'Borrar / limpiar lo cargado en esta hora'
              }
            >
              <Trash2 className="w-3 h-3" />
              <span>
                {!activeWeekdays.includes(row.dow) || row.entry.isCustomDate
                  ? 'Eliminar fila'
                  : 'Limpiar hora'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Selector de Horas de Hoy (cuando el curso tiene 2 o más horas/módulos en el mismo día) */}
      {todayRows.length > 1 && (
        <div
          className={`px-3.5 py-2 border-b flex flex-wrap items-center gap-2 ${
            isDarkMode
              ? 'bg-slate-850/80 border-slate-800'
              : 'bg-blue-50/50 border-blue-100'
          }`}
        >
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
            Horas de esta fecha:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {todayRows.map((tr, idx) => {
              const isSelected = tr.rowKey === row.rowKey;
              const hasContent = tr.entry.contents.trim().length > 0;
              return (
                <button
                  key={tr.rowKey}
                  type="button"
                  onClick={() => setSelectedTodaySlotIndex(idx)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                      : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span>
                    {tr.timeLabel ? `${idx + 1}° Hora (${tr.timeLabel})` : `${idx + 1}° Hora`}
                  </span>
                  <span
                    className={`text-[10px] px-1 rounded ${
                      isSelected ? 'bg-blue-700 text-white' : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    N° {tr.computedClassNumber}
                  </span>
                  {hasContent && <span className="text-emerald-400 font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cuerpo adaptable de la tarjeta Clase de Hoy (sin scroll horizontal) */}
      <div className="p-3.5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Unidad N° */}
          <div className="sm:col-span-3 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              Unidad N°
            </label>
            {isHol ? (
              <div
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold text-center ${
                  isDarkMode
                    ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-500'
                }`}
              >
                -
              </div>
            ) : (
              <input
                type="text"
                value={row.entry.unitNumber}
                placeholder={row.suggestedUnit || '1'}
                onChange={(e) =>
                  updateEntryField(row.rowKey, (curr) => ({
                    ...curr,
                    unitNumber: e.target.value,
                  }))
                }
                onFocus={() => {
                  if (!row.entry.unitNumber && row.suggestedUnit) {
                    updateEntryField(row.rowKey, (curr) => ({
                      ...curr,
                      unitNumber: row.suggestedUnit,
                    }));
                  }
                }}
                className={`w-full px-3 py-1.5 text-center font-bold rounded-lg border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                }`}
              />
            )}
          </div>

          {/* Carácter de la clase */}
          <div className="sm:col-span-9 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                Carácter de la clase
              </label>
              <button
                type="button"
                onClick={() => setShowCharacterOptionsModal(true)}
                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer inline-flex items-center gap-1"
              >
                <Pencil className="w-2.5 h-2.5" />
                Editar opciones
              </button>
            </div>
            {isHol ? (
              <div
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold text-center ${
                  isDarkMode
                    ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-500'
                }`}
              >
                Sin dictado de clases
              </div>
            ) : (
              <select
                value={row.entry.classCharacter || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__EDIT_CHARACTER_OPTIONS__') {
                    setShowCharacterOptionsModal(true);
                    return;
                  }
                  updateEntryField(row.rowKey, (curr) => ({
                    ...curr,
                    classCharacter: val,
                  }));
                }}
                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-white border-neutral-300 text-neutral-800'
                }`}
              >
                <option value="">Seleccionar carácter...</option>
                {row.entry.classCharacter &&
                  !characterOptions.includes(row.entry.classCharacter) && (
                    <option value={row.entry.classCharacter}>
                      {row.entry.classCharacter}
                    </option>
                  )}
                {characterOptions.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
                <option value="__EDIT_CHARACTER_OPTIONS__">
                  ⚙️ Editar / agregar opciones...
                </option>
              </select>
            )}
          </div>
        </div>

        {/* Contenidos */}
        <div className="min-w-0">
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
            Contenidos {isHol ? '(Motivo sin dictado)' : 'de la Clase'} {row.timeLabel ? `(${row.timeLabel})` : ''}
          </label>
          <textarea
            rows={2}
            value={row.entry.contents}
            placeholder={
              isHol
                ? 'Escribir motivo por el cual no se dictó la clase (Feriado, Acto, Mocks, Deportes...)'
                : 'Escribir los contenidos dictados en esta hora...'
            }
            onChange={(e) => {
              const val = e.target.value;
              updateEntryField(row.rowKey, (curr) => ({
                ...curr,
                contents: val,
                noClassReason: curr.isHoliday ? val : curr.noClassReason,
                unitNumber:
                  !curr.isHoliday && !curr.unitNumber && val.trim()
                    ? row.suggestedUnit || '1'
                    : curr.unitNumber,
                classCharacter:
                  !curr.isHoliday && !curr.classCharacter && val.trim()
                    ? characterOptions[0] || 'Teórico - Práctica'
                    : curr.classCharacter,
              }));
            }}
            className={`w-full px-3 py-2 rounded-lg border text-xs resize-y leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
              isHol
                ? isDarkMode
                  ? 'bg-amber-950/30 border-amber-800/60 text-amber-200 font-semibold italic'
                  : 'bg-amber-50/70 border-amber-200 text-amber-900 font-semibold italic'
                : isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-400'
                : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
            }`}
          />
        </div>

        {/* Observaciones + Firmas */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-6 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              Observaciones
            </label>
            <input
              type="text"
              value={row.entry.observations}
              placeholder="Observaciones..."
              onChange={(e) =>
                updateEntryField(row.rowKey, (curr) => ({
                  ...curr,
                  observations: e.target.value,
                }))
              }
              className={`w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-800 placeholder:text-neutral-400'
              }`}
            />
          </div>

          <div className="sm:col-span-3 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              Firma Profesor
            </label>
            {row.entry.teacherSignature ? (
              <button
                type="button"
                onClick={() => handleSignRow(row.rowKey)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 text-xs font-serif italic cursor-pointer hover:bg-red-500/10 hover:text-red-500 truncate"
                title="Clic para quitar firma"
              >
                {row.entry.teacherSignature}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSignRow(row.rowKey)}
                className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-blue-950/60 border-blue-700 text-blue-300 hover:bg-blue-900/60'
                    : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
                }`}
              >
                Firmar clase
              </button>
            )}
          </div>

          <div className="sm:col-span-3 min-w-0">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
              Firma Autoridad
            </label>
            <input
              type="text"
              value={row.entry.authoritySignature}
              placeholder="Visado..."
              onChange={(e) =>
                updateEntryField(row.rowKey, (curr) => ({
                  ...curr,
                  authoritySignature: e.target.value,
                }))
              }
              className={`w-full px-3 py-1.5 rounded-lg border text-xs text-center focus:outline-hidden ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300 placeholder:text-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-700 placeholder:text-neutral-400'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
