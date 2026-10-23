import React from 'react';
import {
  Award,
  ShieldAlert,
  Bell,
  Bookmark,
  MessageSquare,
  Mail,
  Sparkles,
  Check,
  Save,
  Info,
  Send,
  BellOff,
} from 'lucide-react';
import {
  Course,
  Student,
  StudentDispositionData,
  StudentHistoryItem,
  AbsencePresetTemplate,
  AbsenceNotificationSettings,
} from '../../../types';

export interface AbsenceNotifModalState {
  isOpen: boolean;
  historyItem: StudentHistoryItem | null;
  student: Student | null;
  channel: 'classroom' | 'gmail';
  messageText: string;
  isSending: boolean;
  selectedPresetId: string;
  showSavePresetInput: boolean;
  newPresetName: string;
}

export interface BatchAbsenceModalState {
  isOpen: boolean;
  selectedItems: { historyItem: StudentHistoryItem; student: Student }[];
  channel: 'classroom' | 'gmail';
  useSmartTemplates: boolean;
  selectedPresetId: string;
  rawTemplateText: string;
  isSending: boolean;
  progress?: number;
  total?: number;
  currentSendingStudentName?: string;
  showSavePresetInput?: boolean;
  newPresetName: string;
  previewStudentId?: string;
  customPerItemMessages?: Record<string, string>;
}

interface IndividualAbsenceNotificationModalProps {
  absenceNotifModal: AbsenceNotifModalState;
  setAbsenceNotifModal: React.Dispatch<React.SetStateAction<AbsenceNotifModalState>>;
  activeCourse: Course;
  isDarkMode: boolean;
  setIsNotifConfigModalOpen: (open: boolean) => void;
  getTemplateForReason: (reason: string, mode?: 'positive' | 'negative') => string;
  dispositionMap: Record<string, StudentDispositionData>;
  formatTemplateForStudent: (
    template: string,
    student: { firstName: string; lastName: string; id: string },
    courseName: string,
    currentDisp: number,
    dateStr: string,
    reason?: string,
    pointsDelta?: number
  ) => string;
  savedPresets: AbsencePresetTemplate[];
  conductReasonTemplates: Record<string, string>;
  allKnownReasonKeys: string[];
  notifSettings: AbsenceNotificationSettings;
  isReasonCustomized: (reason: string) => boolean;
  handleSaveTemplateForReason: (
    reason: string,
    templateText: string,
    showFeedback?: boolean,
    studentRef?: Student | null
  ) => void;
  saveReasonAsDefaultOnSend: boolean;
  setSaveReasonAsDefaultOnSend: (val: boolean) => void;
  extractGenericTemplate: (
    message: string,
    student: Student | null,
    courseName: string,
    dateStr?: string,
    reason?: string
  ) => string;
  handleSavePreset: (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any',
    category: 'Ausencia' | 'Disposición'
  ) => string;
  handleSaveNotifSettings: (settings: AbsenceNotificationSettings) => void;
  setToastMessage: (msg: string | null) => void;
  sendNotificationForItem: (
    historyItem: StudentHistoryItem,
    student: Student,
    channel: 'classroom' | 'gmail',
    messageText: string
  ) => Promise<void>;
  handleMarkOmitNotification?: (item: StudentHistoryItem) => void;
}

export const IndividualAbsenceNotificationModal: React.FC<IndividualAbsenceNotificationModalProps> = ({
  absenceNotifModal,
  setAbsenceNotifModal,
  activeCourse,
  isDarkMode,
  setIsNotifConfigModalOpen,
  getTemplateForReason,
  dispositionMap,
  formatTemplateForStudent,
  savedPresets,
  conductReasonTemplates,
  allKnownReasonKeys,
  notifSettings,
  isReasonCustomized,
  handleSaveTemplateForReason,
  saveReasonAsDefaultOnSend,
  setSaveReasonAsDefaultOnSend,
  extractGenericTemplate,
  handleSavePreset,
  handleSaveNotifSettings,
  setToastMessage,
  sendNotificationForItem,
  handleMarkOmitNotification,
}) => {
  if (!absenceNotifModal.isOpen) return null;

  const isDisposition = absenceNotifModal.historyItem?.category === 'Disposición';
  const pointsChange = absenceNotifModal.historyItem?.pointsChange;
  const isAdd = pointsChange !== undefined ? pointsChange > 0 : false;
  const pointsBadgeText =
    pointsChange !== undefined
      ? pointsChange > 0
        ? `+${pointsChange} pto`
        : `${pointsChange} pto`
      : '-1 pto';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                isDisposition
                  ? isAdd
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              }`}
            >
              {isDisposition ? (
                isAdd ? (
                  <Award className="w-5 h-5 text-emerald-500" />
                ) : (
                  <ShieldAlert className="w-5 h-5" />
                )
              ) : (
                <Bell className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">
                {isDisposition
                  ? isAdd
                    ? 'Notificar Reconocimiento al Estudiante'
                    : 'Notificar Observación de Conducta al Estudiante'
                  : 'Notificar Ausencia al Estudiante'}
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {absenceNotifModal.student
                  ? `${absenceNotifModal.student.lastName}, ${absenceNotifModal.student.firstName}`
                  : 'Estudiante'}{' '}
                • {activeCourse.name}
                {isDisposition && absenceNotifModal.historyItem?.action && (
                  <span
                    className={`font-semibold ml-1.5 ${
                      isAdd ? 'text-emerald-600 dark:text-emerald-400' : 'text-purple-600 dark:text-purple-400'
                    }`}
                  >
                    • {absenceNotifModal.historyItem.action} ({pointsBadgeText})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, isOpen: false }))}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto">
          {/* Presets selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Mensaje preestablecido
              </label>
              <button
                type="button"
                onClick={() => setIsNotifConfigModalOpen(true)}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Bookmark className="w-3 h-3" />
                <span>Administrar plantillas</span>
              </button>
            </div>
            <select
              value={absenceNotifModal.selectedPresetId}
              onChange={(e) => {
                const presetId = e.target.value;
                if (presetId.startsWith('reason-')) {
                  const reasonKey = presetId.replace('reason-', '');
                  const reasonTpl = getTemplateForReason(reasonKey, isAdd ? 'positive' : 'negative');
                  const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 10;
                  const formatted = formatTemplateForStudent(
                    reasonTpl,
                    absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                    activeCourse.name,
                    curDisp,
                    absenceNotifModal.historyItem?.date || '',
                    reasonKey,
                    pointsChange
                  );
                  setAbsenceNotifModal((prev) => ({
                    ...prev,
                    selectedPresetId: presetId,
                    messageText: formatted,
                  }));
                  return;
                }
                const found = savedPresets.find((p) => p.id === presetId);
                if (found && absenceNotifModal.student) {
                  const curDisp = dispositionMap[absenceNotifModal.student.id]?.totalDisposition ?? 10;
                  const formatted = formatTemplateForStudent(
                    found.text,
                    absenceNotifModal.student,
                    activeCourse.name,
                    curDisp,
                    absenceNotifModal.historyItem?.date || '',
                    absenceNotifModal.historyItem?.action || '',
                    pointsChange
                  );
                  const channelToUse = found.channel !== 'any' ? found.channel : absenceNotifModal.channel;
                  setAbsenceNotifModal((prev) => ({
                    ...prev,
                    selectedPresetId: presetId,
                    channel: channelToUse,
                    messageText: formatted,
                  }));
                }
              }}
              className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 font-medium ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
              }`}
            >
              {isDisposition ? (
                <>
                  {absenceNotifModal.historyItem?.action && (
                    <optgroup label="⭐ Plantilla asignada a esta cuestión">
                      <option value={`reason-${absenceNotifModal.historyItem.action}`}>
                        ⭐ Predeterminado para "{absenceNotifModal.historyItem.action}"{' '}
                        {conductReasonTemplates[absenceNotifModal.historyItem.action] ? '(Personalizado)' : ''}
                      </option>
                    </optgroup>
                  )}
                  <optgroup label="Otras cuestiones habituales">
                    {allKnownReasonKeys
                      .filter((k) => k !== absenceNotifModal.historyItem?.action)
                      .map((k) => (
                        <option key={`reason-${k}`} value={`reason-${k}`}>
                          Plantilla de "{k}" {conductReasonTemplates[k] ? '(Personalizado)' : ''}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Plantillas Generales de Conducta">
                    {savedPresets
                      .filter((p) => p.category === 'Disposición')
                      .map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{' '}
                          {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Otras Plantillas">
                    {savedPresets
                      .filter((p) => p.category !== 'Disposición')
                      .map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{' '}
                          {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                        </option>
                      ))}
                  </optgroup>
                </>
              ) : (
                <>
                  <optgroup label="Plantillas de Inasistencias">
                    {savedPresets
                      .filter((p) => p.category !== 'Disposición')
                      .map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{' '}
                          {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Plantillas de Conducta">
                    {savedPresets
                      .filter((p) => p.category === 'Disposición')
                      .map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{' '}
                          {preset.channel !== 'any' ? `(${preset.channel === 'classroom' ? 'Classroom' : 'Gmail'})` : ''}
                        </option>
                      ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>

          {/* Channel Selector */}
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
              Canal de Notificación
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                  const rawTpl = isDisposition ? notifSettings.templateConductClassroom : notifSettings.templateClassroom;
                  const tpl = formatTemplateForStudent(
                    rawTpl,
                    absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                    activeCourse.name,
                    curDisp,
                    absenceNotifModal.historyItem?.date || '',
                    absenceNotifModal.historyItem?.action || ''
                  );
                  setAbsenceNotifModal((prev) => ({ ...prev, channel: 'classroom', messageText: tpl }));
                }}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                  absenceNotifModal.channel === 'classroom'
                    ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200 ring-2 ring-blue-500/20'
                    : isDarkMode
                    ? 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span>Tablón de Classroom</span>
                </div>
                <span className="text-[10px] text-neutral-500 dark:text-slate-400 text-left">
                  Aviso individual privado en el curso (sin enviar correos).
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                  const rawTpl = isDisposition ? notifSettings.templateConductGmail : notifSettings.templateGmail;
                  const tpl = formatTemplateForStudent(
                    rawTpl,
                    absenceNotifModal.student || { firstName: '', lastName: '', id: '' },
                    activeCourse.name,
                    curDisp,
                    absenceNotifModal.historyItem?.date || '',
                    absenceNotifModal.historyItem?.action || ''
                  );
                  setAbsenceNotifModal((prev) => ({ ...prev, channel: 'gmail', messageText: tpl }));
                }}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 cursor-pointer transition-all ${
                  absenceNotifModal.channel === 'gmail'
                    ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200 ring-2 ring-blue-500/20'
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
                  Envío directo a la casilla de correo del estudiante.
                </span>
              </button>
            </div>
          </div>

          {/* Banner de plantilla específica para esta cuestión */}
          {isDisposition && absenceNotifModal.historyItem?.action && (
            <div
              className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all ${
                isDarkMode
                  ? 'bg-purple-950/40 border-purple-800 text-purple-200'
                  : 'bg-purple-50/90 border-purple-200 text-purple-900'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-300 mt-0.5 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs">
                      Mensaje para: "{absenceNotifModal.historyItem.action}"
                    </span>
                    {isReasonCustomized(absenceNotifModal.historyItem.action) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        <Check className="w-2.5 h-2.5" />
                        Plantilla personalizada
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                        Plantilla predeterminada
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-600 dark:text-purple-300/80 mt-0.5">
                    Puedes editar este texto y guardarlo. La próxima vez que un alumno no traiga "{absenceNotifModal.historyItem.action}", aparecerá este mensaje por defecto.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (absenceNotifModal.historyItem?.action) {
                    handleSaveTemplateForReason(
                      absenceNotifModal.historyItem.action,
                      absenceNotifModal.messageText,
                      true,
                      absenceNotifModal.student
                    );
                  }
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar para "{absenceNotifModal.historyItem.action}"</span>
              </button>
            </div>
          )}

          {/* Message preview / edit */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Mensaje para el Estudiante
              </label>
              <span className="text-[10px] text-neutral-400">Puedes editar este texto libremente</span>
            </div>
            <textarea
              rows={4}
              value={absenceNotifModal.messageText}
              onChange={(e) => setAbsenceNotifModal((prev) => ({ ...prev, messageText: e.target.value }))}
              placeholder="Escribe el mensaje..."
              className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
              }`}
            />

            {/* Variable chips */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
              <button
                type="button"
                onClick={() => {
                  const studentName = absenceNotifModal.student
                    ? `${absenceNotifModal.student.firstName} ${absenceNotifModal.student.lastName}`
                    : 'Estudiante';
                  setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${studentName}` }));
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
              >
                + Nombre
              </button>
              <button
                type="button"
                onClick={() => {
                  setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${activeCourse.name}` }));
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
              >
                + Materia
              </button>
              <button
                type="button"
                onClick={() => {
                  const curDisp = dispositionMap[absenceNotifModal.student?.id || '']?.totalDisposition ?? 9;
                  setAbsenceNotifModal((prev) => ({ ...prev, messageText: `${prev.messageText} ${curDisp}/10` }));
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
              >
                + Disposición
              </button>
              <button
                type="button"
                onClick={() => {
                  setAbsenceNotifModal((prev) => ({
                    ...prev,
                    messageText: `${prev.messageText} ${absenceNotifModal.historyItem?.date || ''}`,
                  }));
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 text-neutral-700 dark:text-slate-300 cursor-pointer"
              >
                + Fecha
              </button>
              {absenceNotifModal.historyItem?.action && (
                <button
                  type="button"
                  onClick={() => {
                    setAbsenceNotifModal((prev) => ({
                      ...prev,
                      messageText: `${prev.messageText} "${absenceNotifModal.historyItem?.action}"`,
                    }));
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/60 dark:hover:bg-purple-900 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-semibold cursor-pointer"
                >
                  + Motivo ({absenceNotifModal.historyItem.action})
                </button>
              )}
            </div>

            {isDisposition && absenceNotifModal.historyItem?.action && (
              <label className="flex items-center gap-2 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveReasonAsDefaultOnSend}
                  onChange={(e) => setSaveReasonAsDefaultOnSend(e.target.checked)}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-purple-900 dark:text-purple-300">
                  Guardar automáticamente este mensaje como predeterminado para "{absenceNotifModal.historyItem.action}" al enviar
                </span>
              </label>
            )}
          </div>

          {/* Guardar este mensaje como nuevo mensaje preestablecido */}
          <div
            className={`p-3 rounded-xl border transition-all ${
              isDarkMode ? 'bg-slate-850 border-slate-700/80' : 'bg-neutral-50/80 border-neutral-200'
            }`}
          >
            {!absenceNotifModal.showSavePresetInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-semibold">¿Quieres guardar este mensaje para volver a usarlo?</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, showSavePresetInput: true }))}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar preestablecido</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                    <Bookmark className="w-3.5 h-3.5" />
                    Guardar como nuevo mensaje preestablecido
                  </span>
                  <button
                    type="button"
                    onClick={() => setAbsenceNotifModal((prev) => ({ ...prev, showSavePresetInput: false, newPresetName: '' }))}
                    className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={absenceNotifModal.newPresetName}
                    onChange={(e) => setAbsenceNotifModal((prev) => ({ ...prev, newPresetName: e.target.value }))}
                    placeholder={
                      isDisposition
                        ? 'Nombre de la plantilla (ej: Falta de respeto, Llamado de atención)'
                        : 'Nombre de la plantilla (ej: Falta con recuperatorio, Aviso TP)'
                    }
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                  <button
                    type="button"
                    disabled={!absenceNotifModal.newPresetName.trim()}
                    onClick={() => {
                      const genericText = extractGenericTemplate(
                        absenceNotifModal.messageText,
                        absenceNotifModal.student,
                        activeCourse.name,
                        absenceNotifModal.historyItem?.date,
                        absenceNotifModal.historyItem?.action
                      );
                      const newId = handleSavePreset(
                        absenceNotifModal.newPresetName,
                        genericText,
                        absenceNotifModal.channel,
                        isDisposition ? 'Disposición' : 'Ausencia'
                      );
                      setAbsenceNotifModal((prev) => ({
                        ...prev,
                        selectedPresetId: newId,
                        showSavePresetInput: false,
                        newPresetName: '',
                      }));
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                  >
                    <Save className="w-3 h-3" />
                    <span>Guardar</span>
                  </button>
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                  Las referencias al nombre, materia, motivo y fecha se convertirán en variables automáticas para reutilizarlas con cualquier estudiante.
                </p>
              </div>
            )}
          </div>

          {/* Fast mode option */}
          {isDisposition ? (
            <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-slate-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={!!notifSettings.dontShowPopupOnDisposition}
                onChange={(e) => {
                  const updated = { ...notifSettings, dontShowPopupOnDisposition: e.target.checked };
                  handleSaveNotifSettings(updated);
                }}
                className="w-3.5 h-3.5 rounded text-purple-600 focus:ring-purple-500"
              />
              <span>Modo rápido de conducta: no abrir esta ventana al registrar conducta (podrás mandar avisos desde el historial)</span>
            </label>
          ) : (
            <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-slate-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={!!notifSettings.dontShowPopupOnAbsence}
                onChange={(e) => {
                  const updated = { ...notifSettings, dontShowPopupOnAbsence: e.target.checked };
                  handleSaveNotifSettings(updated);
                }}
                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
              />
              <span>Tomar asistencia sin abrir esta ventana (marcar faltas y enviar avisos al final en lote)</span>
            </label>
          )}

          <div
            className={`p-3 rounded-xl border flex items-start gap-2 text-[11px] ${
              isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
            }`}
          >
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p>
              Al confirmar, se enviará el aviso al estudiante y se actualizarán inmediatamente las columnas
              <strong> "Mensaje enviado"</strong> (✓) y <strong>"Mensaje"</strong> en el Historial y en la hoja Google Sheets.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex flex-wrap items-center justify-between gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (absenceNotifModal.historyItem && handleMarkOmitNotification) {
                  handleMarkOmitNotification(absenceNotifModal.historyItem);
                } else {
                  setToastMessage('Anotación registrada en el historial sin enviar mensaje.');
                  setTimeout(() => setToastMessage(null), 3500);
                }
                setAbsenceNotifModal((prev) => ({ ...prev, isOpen: false }));
              }}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 shadow-2xs'
              }`}
              title="No enviar mensaje: se guarda la anotación en tu historial docente sin dejar ningún aviso pendiente"
            >
              <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
              <span>No enviar mensaje</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAbsenceNotifModal((prev) => ({ ...prev, isOpen: false }));
                setToastMessage(
                  `${isDisposition ? 'Conducta' : 'Falta'} registrada para ${absenceNotifModal.student?.lastName || 'el estudiante'}. El aviso quedó pendiente para mandarlo al final junto con los demás.`
                );
                setTimeout(() => setToastMessage(null), 4000);
              }}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
              title="Cierra esta ventana dejando la anotación registrada; podrás mandar todos los avisos pendientes juntos al final de la clase"
            >
              Enviar al final
            </button>
          </div>

          <button
            type="button"
            disabled={!absenceNotifModal.messageText.trim() || absenceNotifModal.isSending}
            onClick={async () => {
              if (!absenceNotifModal.historyItem || !absenceNotifModal.student) return;
              if (isDisposition && absenceNotifModal.historyItem?.action && saveReasonAsDefaultOnSend) {
                handleSaveTemplateForReason(
                  absenceNotifModal.historyItem.action,
                  absenceNotifModal.messageText,
                  false,
                  absenceNotifModal.student
                );
              }
              setAbsenceNotifModal((prev) => ({ ...prev, isSending: true }));
              await sendNotificationForItem(
                absenceNotifModal.historyItem,
                absenceNotifModal.student,
                absenceNotifModal.channel,
                absenceNotifModal.messageText
              );
              setAbsenceNotifModal({
                isOpen: false,
                historyItem: null,
                student: null,
                channel: 'classroom',
                messageText: '',
                isSending: false,
                selectedPresetId: 'preset-standard',
                showSavePresetInput: false,
                newPresetName: '',
              });
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
          >
            {absenceNotifModal.isSending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Enviando aviso...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Enviar Notificación</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export { BatchAbsenceNotificationModal } from './BatchAbsenceNotificationModal';
export type { BatchAbsenceNotificationModalProps } from './BatchAbsenceNotificationModal';
export { NotificationPresetsConfigModal } from './NotificationPresetsConfigModal';
export type {
  NewConfigPresetState,
  NotificationPresetsConfigModalProps,
} from './NotificationPresetsConfigModal';

