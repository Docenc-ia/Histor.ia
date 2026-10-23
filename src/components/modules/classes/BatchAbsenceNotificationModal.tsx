import React from 'react';
import {
  Bookmark,
  MessageSquare,
  Mail,
  Sparkles,
  Save,
  Send,
  SlidersHorizontal,
  CheckCheck,
} from 'lucide-react';
import {
  Course,
  Student,
  StudentHistoryItem,
  AbsencePresetTemplate,
} from '../../../types';
import type { BatchAbsenceModalState } from './AbsenceAndConductNotificationModals';

export interface BatchAbsenceNotificationModalProps {
  batchAbsenceModal: BatchAbsenceModalState;
  setBatchAbsenceModal: React.Dispatch<React.SetStateAction<BatchAbsenceModalState>>;
  activeCourse: Course;
  isDarkMode: boolean;
  pendingAllItems: StudentHistoryItem[];
  students: Student[];
  savedPresets: AbsencePresetTemplate[];
  setIsNotifConfigModalOpen: (open: boolean) => void;
  handleSavePreset: (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any',
    category: 'Ausencia' | 'Disposición'
  ) => string;
  getBatchMessageForItem: (
    item: { historyItem: StudentHistoryItem; student: Student },
    modalState: BatchAbsenceModalState
  ) => string;
  handleSendBatchNotifications: () => void;
}

export const BatchAbsenceNotificationModal: React.FC<BatchAbsenceNotificationModalProps> = ({
  batchAbsenceModal,
  setBatchAbsenceModal,
  activeCourse,
  isDarkMode,
  pendingAllItems,
  students,
  savedPresets,
  setIsNotifConfigModalOpen,
  handleSavePreset,
  getBatchMessageForItem,
  handleSendBatchNotifications,
}) => {
  if (!batchAbsenceModal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">
                {(() => {
                  const hasAbsences = batchAbsenceModal.selectedItems.some((i) => i.historyItem.category === 'Ausencia');
                  const hasConduct = batchAbsenceModal.selectedItems.some((i) => i.historyItem.category === 'Disposición');
                  if (hasAbsences && hasConduct) return 'Envío Masivo de Avisos (Ausencias y Conductas)';
                  if (hasConduct) return 'Envío Masivo de Avisos de Conducta';
                  return 'Envío Masivo de Avisos de Inasistencia';
                })()}
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {activeCourse.name} • {batchAbsenceModal.selectedItems.length} registro{batchAbsenceModal.selectedItems.length > 1 ? 's' : ''} seleccionado{batchAbsenceModal.selectedItems.length > 1 ? 's' : ''}
                {batchAbsenceModal.selectedItems.length > 0 && (
                  <span className="ml-1 opacity-75">
                    ({batchAbsenceModal.selectedItems.filter((i) => i.historyItem.category === 'Ausencia').length} ausencias,{' '}
                    {batchAbsenceModal.selectedItems.filter((i) => i.historyItem.category === 'Disposición').length} conductas)
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={batchAbsenceModal.isSending}
            onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, isOpen: false }))}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto">
          {/* Selected students list as removable chips with badges */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Registros a Notificar ({batchAbsenceModal.selectedItems.length})
              </label>
              <div className="flex items-center gap-2">
                {pendingAllItems.length > batchAbsenceModal.selectedItems.length && (
                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => {
                      const allSelected = pendingAllItems
                        .map((h) => {
                          const student = students.find((s) => s.id === h.studentId);
                          if (!student) return null;
                          return { historyItem: h, student };
                        })
                        .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];
                      setBatchAbsenceModal((prev) => ({
                        ...prev,
                        selectedItems: allSelected,
                        previewStudentId: allSelected[0]?.historyItem.id,
                      }));
                    }}
                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                  >
                    + Seleccionar todos los pendientes ({pendingAllItems.length})
                  </button>
                )}
                {batchAbsenceModal.selectedItems.length > 0 && (
                  <button
                    type="button"
                    disabled={batchAbsenceModal.isSending}
                    onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, selectedItems: [] }))}
                    className="text-[11px] text-neutral-400 hover:text-red-500 hover:underline cursor-pointer"
                  >
                    Vaciar
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-850">
              {batchAbsenceModal.selectedItems.map((item) => {
                const student = item.student;
                const h = item.historyItem;
                const isAbsence = h.category === 'Ausencia';
                const activePreviewId = batchAbsenceModal.previewStudentId || batchAbsenceModal.selectedItems[0]?.historyItem.id;
                const isCurrentPreview = activePreviewId === h.id;

                return (
                  <span
                    key={h.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      isCurrentPreview
                        ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-950/60 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-500/20'
                        : 'bg-white dark:bg-slate-800 text-neutral-800 dark:text-slate-200 border-neutral-200 dark:border-slate-700'
                    } shadow-2xs`}
                  >
                    <button
                      type="button"
                      onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, previewStudentId: h.id }))}
                      className="hover:underline text-left cursor-pointer flex items-center gap-1.5"
                      title="Clic para previsualizar este mensaje"
                    >
                      <span>
                        {student.lastName}, {student.firstName}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isAbsence
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300'
                        }`}
                      >
                        {isAbsence ? 'Ausencia' : h.action}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={batchAbsenceModal.isSending}
                      onClick={() => {
                        setBatchAbsenceModal((prev) => ({
                          ...prev,
                          selectedItems: prev.selectedItems.filter((i) => i.historyItem.id !== h.id),
                        }));
                      }}
                      className="text-neutral-400 hover:text-red-500 dark:hover:text-red-400 cursor-pointer disabled:opacity-30 ml-1"
                      title="Quitar este aviso del lote"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
              {batchAbsenceModal.selectedItems.length === 0 && (
                <p className="text-neutral-400 text-xs py-2 px-1">
                  No hay registros en la lista para notificar.
                </p>
              )}
            </div>
          </div>

          {/* Channel Selector */}
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
              Canal de Notificación
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, channel: 'classroom' }))}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                  batchAbsenceModal.channel === 'classroom'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                    : isDarkMode
                    ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  <MessageSquare className="w-4 h-4 text-indigo-500" />
                  <span>Tablón de Classroom</span>
                </div>
                <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                  Publica en el tablón de cada estudiante de manera individual.
                </span>
              </button>

              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, channel: 'gmail' }))}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                  batchAbsenceModal.channel === 'gmail'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                    : isDarkMode
                    ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  <Mail className="w-4 h-4 text-amber-500" />
                  <span>Correo Gmail</span>
                </div>
                <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                  Envía correos electrónicos a la casilla de cada estudiante.
                </span>
              </button>
            </div>
          </div>

          {/* Message Mode: Smart per reason (recommended) vs Unified */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
              Modo de Redacción del Mensaje
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, useSmartTemplates: true }))}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  batchAbsenceModal.useSmartTemplates
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                    : isDarkMode
                    ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Mensajes según motivo (Recomendado)</span>
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-slate-400 mt-1 leading-snug">
                  Aplica automáticamente la plantilla guardada para cada caso (aviso de inasistencia a las ausencias, y mensaje específico a cada conducta).
                </p>
              </button>

              <button
                type="button"
                disabled={batchAbsenceModal.isSending}
                onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, useSmartTemplates: false }))}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  !batchAbsenceModal.useSmartTemplates
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                    : isDarkMode
                    ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Plantilla unificada para todos</span>
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-slate-400 mt-1 leading-snug">
                  Envía el mismo texto base a todos los alumnos seleccionados, completando variables dinámicas como {'{ESTUDIANTE}'} y {'{MOTIVO}'}.
                </p>
              </button>
            </div>
          </div>

          {/* If Unified Template Mode is selected: show preset selector and raw editor */}
          {!batchAbsenceModal.useSmartTemplates && (
            <div className="space-y-3 p-3 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50/60 dark:bg-slate-850/60">
              {/* Preset Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Mensaje preestablecido
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsNotifConfigModalOpen(true)}
                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Bookmark className="w-3 h-3" />
                    <span>Administrar plantillas</span>
                  </button>
                </div>
                <select
                  value={batchAbsenceModal.selectedPresetId}
                  disabled={batchAbsenceModal.isSending}
                  onChange={(e) => {
                    const presetId = e.target.value;
                    const found = savedPresets.find((p) => p.id === presetId);
                    if (found) {
                      const channelToUse = found.channel !== 'any' ? found.channel : batchAbsenceModal.channel;
                      setBatchAbsenceModal((prev) => ({
                        ...prev,
                        selectedPresetId: presetId,
                        rawTemplateText: found.text,
                        channel: channelToUse,
                      }));
                    }
                  }}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 font-medium ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                >
                  {savedPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} {preset.category === 'Disposición' ? '(Conducta)' : '(Ausencia)'}{' '}
                      {preset.channel !== 'any' ? `[${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Raw Template text editor */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Plantilla del Mensaje (con variables dinámicas)
                  </label>
                  <span className="text-[10px] text-neutral-400">Se adaptará a los datos de cada estudiante</span>
                </div>
                <textarea
                  rows={4}
                  disabled={batchAbsenceModal.isSending}
                  value={batchAbsenceModal.rawTemplateText}
                  onChange={(e) => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: e.target.value }))}
                  placeholder="Escribe el mensaje con variables..."
                  className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 font-mono ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />

                {/* Insertion chips */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-neutral-400 mr-1">Insertar variable:</span>
                  {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}', '{MOTIVO}'].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, rawTemplateText: `${prev.rawTemplateText} ${tag}` }))}
                      className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer font-mono"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Guardar este mensaje como nueva plantilla preestablecida */}
              <div
                className={`p-3 rounded-xl border transition-all ${
                  isDarkMode ? 'bg-slate-850 border-slate-700/80' : 'bg-neutral-50/80 border-neutral-200'
                }`}
              >
                {!batchAbsenceModal.showSavePresetInput ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs font-semibold">¿Guardar esta plantilla para futuros avisos masivos?</span>
                    </div>
                    <button
                      type="button"
                      disabled={batchAbsenceModal.isSending}
                      onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, showSavePresetInput: true }))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar plantilla</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                        <Bookmark className="w-3.5 h-3.5" />
                        Guardar como nuevo mensaje preestablecido
                      </span>
                      <button
                        type="button"
                        onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, showSavePresetInput: false, newPresetName: '' }))}
                        className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={batchAbsenceModal.newPresetName}
                        onChange={(e) => setBatchAbsenceModal((prev) => ({ ...prev, newPresetName: e.target.value }))}
                        placeholder="Nombre de la plantilla (ej: Aviso General de Clase, TP Vencido)"
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-indigo-500 ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                      <button
                        type="button"
                        disabled={!batchAbsenceModal.newPresetName.trim()}
                        onClick={() => {
                          const newId = handleSavePreset(
                            batchAbsenceModal.newPresetName,
                            batchAbsenceModal.rawTemplateText,
                            batchAbsenceModal.channel,
                            'Ausencia'
                          );
                          setBatchAbsenceModal((prev) => ({
                            ...prev,
                            selectedPresetId: newId,
                            showSavePresetInput: false,
                            newPresetName: '',
                          }));
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                      >
                        <Save className="w-3 h-3" />
                        <span>Guardar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vista previa personalizada interactiva por estudiante y ajuste individual */}
          {batchAbsenceModal.selectedItems.length > 0 &&
            (() => {
              const activePreviewItem =
                batchAbsenceModal.selectedItems.find((i) => i.historyItem.id === batchAbsenceModal.previewStudentId) ||
                batchAbsenceModal.selectedItems[0];
              if (!activePreviewItem) return null;

              const messageForStudent = getBatchMessageForItem(activePreviewItem, batchAbsenceModal);
              const isAbsence = activePreviewItem.historyItem.category === 'Ausencia';

              return (
                <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-indigo-50/40 border-indigo-100'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-xs flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
                      <CheckCheck className="w-4 h-4" />
                      Vista previa y ajuste individual por estudiante:
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400">
                      {activePreviewItem.student.email || 'Sin correo registrado'}
                    </span>
                  </div>

                  {/* Student selector buttons for preview */}
                  <div className="flex flex-wrap gap-1 mb-2 max-h-24 overflow-y-auto">
                    {batchAbsenceModal.selectedItems.map((item) => {
                      const isCurrent =
                        (batchAbsenceModal.previewStudentId || batchAbsenceModal.selectedItems[0]?.historyItem.id) ===
                        item.historyItem.id;
                      const isAbs = item.historyItem.category === 'Ausencia';

                      return (
                        <button
                          key={item.historyItem.id}
                          type="button"
                          onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, previewStudentId: item.historyItem.id }))}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                            isCurrent
                              ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                              : isDarkMode
                              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                          }`}
                        >
                          <span>{item.student.firstName}</span>
                          <span
                            className={`text-[9px] px-1 rounded font-bold ${
                              isAbs ? 'bg-red-500/20 text-red-200' : 'bg-purple-500/20 text-purple-200'
                            }`}
                          >
                            {isAbs ? 'Falta' : item.historyItem.action}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Render editable preview for selected student */}
                  <div
                    className={`p-3 rounded-lg border text-xs leading-relaxed space-y-2 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-neutral-200 text-neutral-800'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500 pb-1 border-b border-neutral-100 dark:border-slate-800">
                      <span>
                        Para:{' '}
                        <strong className="text-neutral-900 dark:text-white">
                          {activePreviewItem.student.lastName}, {activePreviewItem.student.firstName}
                        </strong>{' '}
                        ({activePreviewItem.student.email})
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isAbsence
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                        }`}
                      >
                        {isAbsence ? 'Inasistencia' : `Conducta: ${activePreviewItem.historyItem.action}`}
                      </span>
                    </div>

                    <textarea
                      rows={3}
                      value={messageForStudent}
                      disabled={batchAbsenceModal.isSending}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBatchAbsenceModal((prev) => ({
                          ...prev,
                          customPerItemMessages: {
                            ...(prev.customPerItemMessages || {}),
                            [activePreviewItem.historyItem.id]: val,
                          },
                        }));
                      }}
                      className={`w-full p-2 text-xs rounded border focus:outline-hidden focus:ring-1 focus:ring-indigo-500 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-900'
                      }`}
                      title="Puedes ajustar el mensaje puntual para este estudiante antes de enviar el lote"
                    />

                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>Puedes retocar el mensaje antes de enviar todo el lote junto.</span>
                      {batchAbsenceModal.customPerItemMessages?.[activePreviewItem.historyItem.id] && (
                        <button
                          type="button"
                          onClick={() => {
                            setBatchAbsenceModal((prev) => {
                              const next = { ...(prev.customPerItemMessages || {}) };
                              delete next[activePreviewItem.historyItem.id];
                              return { ...prev, customPerItemMessages: next };
                            });
                          }}
                          className="text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          Restablecer al mensaje sugerido
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Progress bar during sending */}
          {batchAbsenceModal.isSending && (
            <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                <span className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  {batchAbsenceModal.currentSendingStudentName
                    ? `Enviando a ${batchAbsenceModal.currentSendingStudentName}...`
                    : 'Enviando avisos...'}
                </span>
                <span>
                  {batchAbsenceModal.progress || 1} de {batchAbsenceModal.total || batchAbsenceModal.selectedItems.length}
                </span>
              </div>
              <div className="w-full bg-indigo-200 dark:bg-indigo-900/50 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 transition-all duration-300 rounded-full"
                  style={{
                    width: `${
                      batchAbsenceModal.total && batchAbsenceModal.total > 0
                        ? ((batchAbsenceModal.progress || 1) / batchAbsenceModal.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <button
            type="button"
            disabled={batchAbsenceModal.isSending}
            onClick={() => setBatchAbsenceModal((prev) => ({ ...prev, isOpen: false }))}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={batchAbsenceModal.selectedItems.length === 0 || batchAbsenceModal.isSending}
            onClick={handleSendBatchNotifications}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
          >
            {batchAbsenceModal.isSending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>
                  Enviando avisos ({batchAbsenceModal.progress || 0} de{' '}
                  {batchAbsenceModal.total || batchAbsenceModal.selectedItems.length})...
                </span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Enviar todos juntos ({batchAbsenceModal.selectedItems.length} avisos)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
