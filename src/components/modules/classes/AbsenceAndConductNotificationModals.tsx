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
  SlidersHorizontal,
  CheckCheck,
  Settings,
  Search,
  Plus,
  Trash2,
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

interface BatchAbsenceNotificationModalProps {
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

interface NewConfigPresetState {
  name: string;
  text: string;
  channel: 'classroom' | 'gmail' | 'any';
  category: 'Ausencia' | 'Disposición';
  isOpen: boolean;
}

interface NotificationPresetsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  notifConfigActiveTab: 'reasons' | 'presets' | 'settings';
  setNotifConfigActiveTab: (tab: 'reasons' | 'presets' | 'settings') => void;
  conductReasonTemplates: Record<string, string>;
  savedPresets: AbsencePresetTemplate[];
  searchReasonQuery: string;
  setSearchReasonQuery: (val: string) => void;
  isNewReasonFormOpen: boolean;
  setIsNewReasonFormOpen: (open: boolean) => void;
  newReasonName: string;
  setNewReasonName: (val: string) => void;
  newReasonTemplateText: string;
  setNewReasonTemplateText: React.Dispatch<React.SetStateAction<string>>;
  getTemplateForReason: (reason: string, mode?: 'positive' | 'negative') => string;
  handleSaveTemplateForReason: (reason: string, tpl: string) => void;
  allKnownReasonKeys: string[];
  isReasonCustomized: (reason: string) => boolean;
  reasonCardDrafts: Record<string, string>;
  setReasonCardDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleResetTemplateForReason: (reason: string) => void;
  newConfigPreset: NewConfigPresetState;
  setNewConfigPreset: React.Dispatch<React.SetStateAction<NewConfigPresetState>>;
  handleSavePreset: (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any',
    category: 'Ausencia' | 'Disposición'
  ) => string;
  handleDeletePreset: (id: string) => void;
  notifSettings: AbsenceNotificationSettings;
  setNotifSettings: React.Dispatch<React.SetStateAction<AbsenceNotificationSettings>>;
  handleSaveNotifSettings: (settings: AbsenceNotificationSettings) => void;
}

export const NotificationPresetsConfigModal: React.FC<NotificationPresetsConfigModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  notifConfigActiveTab,
  setNotifConfigActiveTab,
  conductReasonTemplates,
  savedPresets,
  searchReasonQuery,
  setSearchReasonQuery,
  isNewReasonFormOpen,
  setIsNewReasonFormOpen,
  newReasonName,
  setNewReasonName,
  newReasonTemplateText,
  setNewReasonTemplateText,
  getTemplateForReason,
  handleSaveTemplateForReason,
  allKnownReasonKeys,
  isReasonCustomized,
  reasonCardDrafts,
  setReasonCardDrafts,
  handleResetTemplateForReason,
  newConfigPreset,
  setNewConfigPreset,
  handleSavePreset,
  handleDeletePreset,
  notifSettings,
  setNotifSettings,
  handleSaveNotifSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">
                Configuración de Avisos por Ausencia / Disposición
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                Personaliza los mensajes preconfigurados que se cargan automáticamente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className={`px-4 pt-2 border-b flex gap-1 overflow-x-auto ${isDarkMode ? 'border-slate-800 bg-slate-850/50' : 'border-neutral-200 bg-neutral-50/50'}`}>
          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('reasons')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'reasons'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Mensajes por Cuestión / Motivo</span>
            {Object.keys(conductReasonTemplates).length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                {Object.keys(conductReasonTemplates).length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('presets')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'presets'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Plantillas Generales e Inasistencias</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-600 dark:bg-slate-800 dark:text-slate-300">
              {savedPresets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('settings')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'settings'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Modo Rápido y Canales</span>
          </button>
        </div>

        {/* Body */}
        {notifConfigActiveTab === 'reasons' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* Banner explicativo */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                isDarkMode ? 'bg-purple-950/20 border-purple-900/60 text-purple-200' : 'bg-purple-50/80 border-purple-200 text-purple-900'
              }`}
            >
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-xs leading-tight">
                  Mensajes predeterminados específicos para cada cuestión de conducta
                </p>
                <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-purple-300/80">
                  Configura un mensaje propio para cada situación (por ejemplo: <strong>"Sin libro"</strong>, <strong>"Falta de tarea"</strong>, etc.). La próxima vez que un alumno tenga esa falta y le descuentes un punto de disposición, <strong>se cargará automáticamente ese mensaje específico</strong>.
                </p>
              </div>
            </div>

            {/* Buscador y botón para agregar nueva cuestión con mensaje */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={searchReasonQuery}
                  onChange={(e) => setSearchReasonQuery(e.target.value)}
                  placeholder="Buscar cuestión (ej: Sin libro, tarea, celular...)"
                  className={`w-full pl-8 pr-8 py-1.5 text-xs rounded-xl border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
                {searchReasonQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchReasonQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsNewReasonFormOpen(!isNewReasonFormOpen)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isNewReasonFormOpen ? 'Cancelar' : 'Nueva Cuestión'}</span>
              </button>
            </div>

            {/* Formulario desplegable para agregar nueva cuestión con mensaje propio */}
            {isNewReasonFormOpen && (
              <div
                className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                  isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-purple-50/60 border-purple-200'
                }`}
              >
                <span className="font-bold text-xs flex items-center gap-1.5 text-purple-900 dark:text-purple-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  Crear nueva cuestión y definir su mensaje predeterminado
                </span>

                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Nombre de la cuestión (ej: "Sin libro", "Sin guardapolvo", "Falta TP práctico")
                  </label>
                  <input
                    type="text"
                    value={newReasonName}
                    onChange={(e) => setNewReasonName(e.target.value)}
                    placeholder="Ej: Sin libro"
                    className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                      Mensaje que aparecerá por defecto
                    </label>
                    <span className="text-[10px] text-neutral-400">Variables automáticas disponibles</span>
                  </div>
                  <textarea
                    rows={3}
                    value={newReasonTemplateText}
                    onChange={(e) => setNewReasonTemplateText(e.target.value)}
                    placeholder="Estimado/a {ESTUDIANTE}, hoy {FECHA} se registró un llamado de atención en {MATERIA} por no traer... (-1 punto de disposición, actual: {DISPOSICION}/10)."
                    className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />

                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                    {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setNewReasonTemplateText((prev) => `${prev} ${tag}`)}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewReasonFormOpen(false);
                      setNewReasonName('');
                      setNewReasonTemplateText('');
                    }}
                    className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!newReasonName.trim()}
                    onClick={() => {
                      const name = newReasonName.trim();
                      const tpl = newReasonTemplateText.trim() || getTemplateForReason(name);
                      handleSaveTemplateForReason(name, tpl);
                      setIsNewReasonFormOpen(false);
                      setNewReasonName('');
                      setNewReasonTemplateText('');
                    }}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar Cuestión y Mensaje</span>
                  </button>
                </div>
              </div>
            )}

            {/* Lista de todas las cuestiones conocidas */}
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {allKnownReasonKeys
                .filter((r) => !searchReasonQuery.trim() || r.toLowerCase().includes(searchReasonQuery.toLowerCase().trim()))
                .map((reasonKey) => {
                  const customized = isReasonCustomized(reasonKey);
                  const currentDraft = reasonCardDrafts[reasonKey] ?? getTemplateForReason(reasonKey);
                  const hasChanges =
                    reasonCardDrafts[reasonKey] !== undefined && reasonCardDrafts[reasonKey] !== getTemplateForReason(reasonKey);

                  return (
                    <div
                      key={reasonKey}
                      className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                        customized
                          ? isDarkMode
                            ? 'bg-purple-950/20 border-purple-800/70'
                            : 'bg-purple-50/40 border-purple-200'
                          : isDarkMode
                          ? 'bg-slate-800/40 border-slate-700/80'
                          : 'bg-neutral-50/70 border-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-neutral-900 dark:text-white">
                            {reasonKey}
                          </span>
                          {customized ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              <Sparkles className="w-2.5 h-2.5" />
                              Mensaje propio guardado
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-200 text-neutral-600 dark:bg-slate-700 dark:text-slate-300">
                              Plantilla estándar
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {customized && (
                            <button
                              type="button"
                              onClick={() => {
                                handleResetTemplateForReason(reasonKey);
                                setReasonCardDrafts((prev) => {
                                  const n = { ...prev };
                                  delete n[reasonKey];
                                  return n;
                                });
                              }}
                              className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                              title="Volver a la plantilla predeterminada del sistema"
                            >
                              Restablecer a estándar
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        rows={3}
                        value={currentDraft}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReasonCardDrafts((prev) => ({ ...prev, [reasonKey]: val }));
                        }}
                        placeholder="Escribe el mensaje por defecto para esta cuestión..."
                        className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                          {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                setReasonCardDrafts((prev) => ({
                                  ...prev,
                                  [reasonKey]: `${currentDraft} ${tag}`,
                                }));
                              }}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            handleSaveTemplateForReason(reasonKey, currentDraft);
                            setReasonCardDrafts((prev) => {
                              const n = { ...prev };
                              delete n[reasonKey];
                              return n;
                            });
                          }}
                          className={`px-3 py-1 text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1 transition-all ${
                            hasChanges
                              ? 'bg-purple-600 hover:bg-purple-700 text-white animate-pulse'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          }`}
                        >
                          <Save className="w-3 h-3" />
                          <span>Guardar para "{reasonKey}"</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {notifConfigActiveTab === 'presets' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* SECCIÓN: PLANTILLAS Y MENSAJES PREESTABLECIDOS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="font-bold text-xs text-neutral-900 dark:text-white">
                    Plantillas Generales y de Inasistencias ({savedPresets.length})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: !p.isOpen }))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{newConfigPreset.isOpen ? 'Cancelar' : 'Nueva plantilla'}</span>
                </button>
              </div>

              {/* Form to create a new preset */}
              {newConfigPreset.isOpen && (
                <div
                  className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                    isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-blue-50/50 border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-blue-900 dark:text-blue-200">
                      Crear Nuevo Mensaje Preestablecido
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Nombre de la plantilla
                      </label>
                      <input
                        type="text"
                        value={newConfigPreset.name}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Ej: Falta con recuperatorio, TP..."
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Tipo de Aviso
                      </label>
                      <select
                        value={newConfigPreset.category}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, category: e.target.value as any }))}
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      >
                        <option value="Ausencia">Inasistencia</option>
                        <option value="Disposición">Conducta / Disposición</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Canal recomendado
                      </label>
                      <select
                        value={newConfigPreset.channel}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, channel: e.target.value as any }))}
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      >
                        <option value="classroom">Tablón de Classroom</option>
                        <option value="gmail">Correo Gmail</option>
                        <option value="any">Cualquier canal</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-neutral-600 dark:text-slate-300">
                        Texto del mensaje
                      </label>
                      <span className="text-[10px] text-neutral-400">Usa las variables dinámicas</span>
                    </div>
                    <textarea
                      rows={3}
                      value={newConfigPreset.text}
                      onChange={(e) => setNewConfigPreset((p) => ({ ...p, text: e.target.value }))}
                      placeholder="Estimado/a {ESTUDIANTE}, se ha registrado una inasistencia u observación en {MATERIA}..."
                      className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                        isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    />

                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                      {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}', '{MOTIVO}'].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setNewConfigPreset((p) => ({ ...p, text: `${p.text} ${tag}` }))}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: false, name: '', text: '', category: 'Ausencia' }))}
                      className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!newConfigPreset.name.trim() || !newConfigPreset.text.trim()}
                      onClick={() => {
                        handleSavePreset(newConfigPreset.name, newConfigPreset.text, newConfigPreset.channel, newConfigPreset.category);
                        setNewConfigPreset({ name: '', text: '', channel: 'classroom', category: 'Ausencia', isOpen: false });
                      }}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar Plantilla</span>
                    </button>
                  </div>
                </div>
              )}

              {/* List of presets */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {savedPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className={`p-3 rounded-xl border flex flex-col gap-1.5 transition-colors ${
                      isDarkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-neutral-900 dark:text-white">
                          {preset.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            preset.category === 'Disposición'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                              : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {preset.category === 'Disposición' ? 'Conducta' : 'Ausencia'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            preset.channel === 'classroom'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : preset.channel === 'gmail'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-neutral-200 text-neutral-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {preset.channel === 'classroom' ? 'Classroom' : preset.channel === 'gmail' ? 'Gmail' : 'Ambos canales'}
                        </span>
                      </div>
                      {savedPresets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="p-1 text-neutral-400 hover:text-red-500 rounded transition-colors cursor-pointer"
                          title="Eliminar esta plantilla"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-600 dark:text-slate-400 font-mono line-clamp-2">
                      {preset.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {notifConfigActiveTab === 'settings' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* MODO RÁPIDO DE ASISTENCIA */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                notifSettings.dontShowPopupOnAbsence
                  ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-800'
                  : isDarkMode
                  ? 'bg-slate-800/40 border-slate-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notifSettings.dontShowPopupOnAbsence}
                  onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnAbsence: e.target.checked }))}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                    Modo rápido de asistencia: No abrir ventana emergente en cada falta tomada
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                    Al activar este modo, podrás tomar la asistencia de forma rápida haciendo clic en <strong>"+ Falta"</strong> sin interrupciones. Las inasistencias quedarán registradas como pendientes y luego podrás seleccionar a los ausentes para <strong>enviar todos los mensajes juntos en lote</strong> al finalizar la clase.
                  </span>
                </div>
              </label>
            </div>

            {/* MODO RÁPIDO DE CONDUCTA / DISPOSICIÓN */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                notifSettings.dontShowPopupOnDisposition
                  ? 'border-purple-400 bg-purple-50/60 dark:bg-purple-950/40 dark:border-purple-800'
                  : isDarkMode
                  ? 'bg-slate-800/40 border-slate-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notifSettings.dontShowPopupOnDisposition}
                  onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnDisposition: e.target.checked }))}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                    Modo rápido de conducta: No abrir ventana emergente al restar puntos de disposición
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                    Al activar este modo, podrás registrar conductas y restar puntos de disposición de forma ágil. Las observaciones quedarán asentadas en el historial y podrás enviar los avisos a los alumnos cuando lo prefieras.
                  </span>
                </div>
              </label>
            </div>

            {/* Canal predeterminado */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                Canal de envío predeterminado
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                    notifSettings.channel === 'classroom'
                      ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                      : isDarkMode
                      ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="notif_channel"
                    value="classroom"
                    checked={notifSettings.channel === 'classroom'}
                    onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'classroom' }))}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="font-bold block">Tablón de Classroom</span>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400">Aviso individual en el curso (sin emails)</span>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                    notifSettings.channel === 'gmail'
                      ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                      : isDarkMode
                      ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="notif_channel"
                    value="gmail"
                    checked={notifSettings.channel === 'gmail'}
                    onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'gmail' }))}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="font-bold block">Correo Electrónico (Gmail)</span>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400">Envío por correo al estudiante</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Plantilla Classroom */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Mensaje por defecto para Classroom (Tablón individual)
                </label>
                <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
              </div>
              <textarea
                rows={3}
                value={notifSettings.templateClassroom}
                onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateClassroom: e.target.value }))}
                className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            {/* Plantilla Gmail */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Mensaje por defecto para Correo (Gmail)
                </label>
                <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
              </div>
              <textarea
                rows={3}
                value={notifSettings.templateGmail}
                onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateGmail: e.target.value }))}
                className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={`p-4 border-t flex justify-end gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => {
              handleSaveNotifSettings(notifSettings);
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
          >
            Guardar Configuración
          </button>
        </div>
      </div>
    </div>
  );
};
