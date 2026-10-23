import React from 'react';
import { Calendar, Check, Pencil, Plus, RotateCcw, Settings, Trash2, X } from 'lucide-react';
import { NoClassCategory, NO_CLASS_PRESETS } from '../LibroDeTemasMatrix';

export interface NoClassModalRowState {
  rowKey: string;
  dateStr: string;
  slotIndex: number;
  timeLabel?: string;
  day: number;
  month: number;
  weekdayFull: string;
  isCurrentlyNoClass: boolean;
  category: NoClassCategory;
  reasonText: string;
  observations: string;
  applyToAllDaySlots?: boolean;
}

export interface LibroDeTemasModalsProps {
  isDarkMode: boolean;
  noClassModalRow: NoClassModalRowState | null;
  setNoClassModalRow: React.Dispatch<React.SetStateAction<NoClassModalRowState | null>>;
  handleConfirmNoClassReason: (e: React.FormEvent) => void;
  handleRevertToNormalClass: (dateStr: string) => void;

  showCharacterOptionsModal: boolean;
  setShowCharacterOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  characterOptions: string[];
  newCharacterOptionText: string;
  setNewCharacterOptionText: React.Dispatch<React.SetStateAction<string>>;
  editingOptionIndex: number | null;
  setEditingOptionIndex: React.Dispatch<React.SetStateAction<number | null>>;
  editingOptionValue: string;
  setEditingOptionValue: React.Dispatch<React.SetStateAction<string>>;
  handleAddCharacterOption: (e: React.FormEvent) => void;
  handleSaveEditedCharacterOption: (idx: number) => void;
  handleDeleteCharacterOption: (opt: string) => void;
  handleRestoreDefaultCharacterOptions: () => void;

  showAddDateModal: boolean;
  setShowAddDateModal: React.Dispatch<React.SetStateAction<boolean>>;
  newCustomDate: string;
  setNewCustomDate: React.Dispatch<React.SetStateAction<string>>;
  newCustomUnit: string;
  setNewCustomUnit: React.Dispatch<React.SetStateAction<string>>;
  newCustomCharacter: string;
  setNewCustomCharacter: React.Dispatch<React.SetStateAction<string>>;
  newCustomContents: string;
  setNewCustomContents: React.Dispatch<React.SetStateAction<string>>;
  handleAddCustomDate: (e: React.FormEvent) => void;
}

export const LibroDeTemasModals: React.FC<LibroDeTemasModalsProps> = ({
  isDarkMode,
  noClassModalRow,
  setNoClassModalRow,
  handleConfirmNoClassReason,
  handleRevertToNormalClass,
  showCharacterOptionsModal,
  setShowCharacterOptionsModal,
  characterOptions,
  newCharacterOptionText,
  setNewCharacterOptionText,
  editingOptionIndex,
  setEditingOptionIndex,
  editingOptionValue,
  setEditingOptionValue,
  handleAddCharacterOption,
  handleSaveEditedCharacterOption,
  handleDeleteCharacterOption,
  handleRestoreDefaultCharacterOptions,
  showAddDateModal,
  setShowAddDateModal,
  newCustomDate,
  setNewCustomDate,
  newCustomUnit,
  setNewCustomUnit,
  newCustomCharacter,
  setNewCustomCharacter,
  newCustomContents,
  setNewCustomContents,
  handleAddCustomDate,
}) => {
  return (
    <>
      {/* ===================================================================== */}
      {/* MODAL 1: MARCAR DÍA SIN DICTADO DE CLASE (FERIADO, ACTO, MOCKS, ETC.) */}
      {/* ===================================================================== */}
      {noClassModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    Día sin dictado de clase ({noClassModalRow.weekdayFull} {noClassModalRow.day}/
                    {noClassModalRow.month})
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Coloca &quot;-&quot; en Clase N° y registra la razón (Feriado, Acto, Mocks,
                    Exámenes Internacionales, Deportes, etc.)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNoClassModalRow(null)}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmNoClassReason} className="p-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold mb-2 text-neutral-700 dark:text-slate-300">
                  1. Seleccioná el tipo de evento o motivo:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {NO_CLASS_PRESETS.map((preset) => {
                    const isSelected = noClassModalRow.category === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setNoClassModalRow((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  category: preset.id,
                                  reasonText: preset.defaultText,
                                }
                              : null
                          );
                        }}
                        className={`px-3 py-2 rounded-xl border text-left font-semibold transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500 text-amber-800 dark:text-amber-300 shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        <span>{preset.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-neutral-700 dark:text-slate-300">
                  2. Escribí la razón exacta por la cual no se dictó la clase (se mostrará en
                  CONTENIDOS):
                </label>
                <input
                  type="text"
                  value={noClassModalRow.reasonText}
                  onChange={(e) =>
                    setNoClassModalRow((prev) =>
                      prev ? { ...prev, reasonText: e.target.value } : null
                    )
                  }
                  placeholder="Ej: Sin dictado de clases por Mocks / Exámenes Internacionales / Acto Escolar / Torneo Deportivo..."
                  required
                  className={`w-full px-3 py-2 rounded-xl border font-semibold focus:outline-hidden focus:ring-2 focus:ring-amber-500/40 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-neutral-700 dark:text-slate-300">
                  Observaciones adicionales (opcional):
                </label>
                <input
                  type="text"
                  value={noClassModalRow.observations}
                  onChange={(e) =>
                    setNoClassModalRow((prev) =>
                      prev ? { ...prev, observations: e.target.value } : null
                    )
                  }
                  placeholder="Ej: Disposición de Dirección / Turno mañana completo..."
                  className={`w-full px-3 py-2 rounded-xl border font-medium focus:outline-hidden ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="pt-2 border-t border-neutral-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                {noClassModalRow.isCurrentlyNoClass ? (
                  <button
                    type="button"
                    onClick={() => handleRevertToNormalClass(noClassModalRow.dateStr)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold cursor-pointer hover:bg-blue-100"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Habilitar como clase dictada normal</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNoClassModalRow(null)}
                    className="px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Guardar día sin dictado
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: EDITAR OPCIONES DEL DESPLEGABLE "CARÁCTER DE LA CLASE"       */}
      {/* ===================================================================== */}
      {showCharacterOptionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-purple-500" />
                <div>
                  <h3 className="text-sm font-bold">
                    Editar opciones de &quot;Carácter de la clase&quot;
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Agregá, modificá o eliminá opciones del menú desplegable
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCharacterOptionsModal(false);
                  setEditingOptionIndex(null);
                }}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              {/* Formulario para agregar nueva opción */}
              <form onSubmit={handleAddCharacterOption} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCharacterOptionText}
                  onChange={(e) => setNewCharacterOptionText(e.target.value)}
                  placeholder="Nueva opción (ej: Laboratorio, Seminario, Debate...)"
                  className={`flex-1 px-3 py-2 rounded-xl border font-medium focus:outline-hidden focus:ring-2 focus:ring-purple-500/40 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar</span>
                </button>
              </form>

              {/* Lista de opciones actuales */}
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {characterOptions.map((opt, idx) => {
                  const isDash = opt === '-';
                  const isEditingThis = editingOptionIndex === idx;

                  return (
                    <div
                      key={`${opt}-${idx}`}
                      className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${
                        isDarkMode
                          ? 'bg-slate-800/70 border-slate-700/80'
                          : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      {isEditingThis ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editingOptionValue}
                            onChange={(e) => setEditingOptionValue(e.target.value)}
                            autoFocus
                            className={`flex-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-600 text-white'
                                : 'bg-white border-neutral-300 text-neutral-900'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEditedCharacterOption(idx)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOptionIndex(null)}
                            className="px-2 py-1 rounded-lg text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="font-semibold">{opt}</span>
                          {!isDash && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingOptionIndex(idx);
                                  setEditingOptionValue(opt);
                                }}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-blue-500 hover:bg-neutral-200/50 dark:hover:bg-slate-700 cursor-pointer"
                                title="Renombrar esta opción"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCharacterOption(opt)}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                                title="Eliminar esta opción"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-neutral-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDefaultCharacterOptions}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restaurar predeterminadas</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowCharacterOptionsModal(false);
                    setEditingOptionIndex(null);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: AGREGAR FECHA ESPECIAL FUERA DE LOS DÍAS HABITUALES          */}
      {/* ===================================================================== */}
      {showAddDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-bold">Agregar Fecha Especial al Libro de Temas</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddDateModal(false)}
                className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomDate} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Fecha de la clase:</label>
                <input
                  type="date"
                  value={newCustomDate}
                  onChange={(e) => setNewCustomDate(e.target.value)}
                  required
                  className={`w-full px-3 py-2 rounded-lg border font-medium ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Unidad N°:</label>
                  <input
                    type="text"
                    value={newCustomUnit}
                    onChange={(e) => setNewCustomUnit(e.target.value)}
                    placeholder="1"
                    className={`w-full px-3 py-2 rounded-lg border font-medium ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Carácter de la clase:</label>
                  <select
                    value={newCustomCharacter}
                    onChange={(e) => setNewCustomCharacter(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border font-medium ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  >
                    {characterOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Contenidos dictados:</label>
                <textarea
                  rows={3}
                  value={newCustomContents}
                  onChange={(e) => setNewCustomContents(e.target.value)}
                  placeholder="Describí los contenidos dados en la clase..."
                  className={`w-full px-3 py-2 rounded-lg border font-medium ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDateModal(false)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                >
                  Agregar al Libro de Temas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
