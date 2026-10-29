import React from 'react';
import {
  Award,
  ShieldAlert,
  Minus,
  Plus,
  Settings,
  Check,
  X,
  Sparkles,
  MessageSquare,
  Pencil,
  Trash2,
  Save,
  Send,
  Info,
  ChevronRight,
} from 'lucide-react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../../../types';
import { getCurrentCalendarTerm, getGlobalAttendanceSettings } from '../../../utils/attendanceCalculations';
import {
  useTerminologySettings,
  DISPOSITION_LABEL_PRESETS,
  ATTENDANCE_LABEL_PRESETS,
} from '../../../utils/terminologySettings';

export interface ConductRecordModalState {
  isOpen: boolean;
  student: Student | null;
  mode: 'add' | 'subtract';
  points: number;
  customReason: string;
  saveToOptions: boolean;
}

export interface ConductRecordModalProps {
  conductRecordModal: ConductRecordModalState;
  setConductRecordModal: React.Dispatch<React.SetStateAction<ConductRecordModalState>>;
  attendanceTerm: '1c' | '2c' | 'all' | 'annual';
  getStudentMetrics: (studentId: string, termOverride?: '1c' | '2c' | 'all' | 'annual') => StudentDispositionData;
  teacherConductOptions: string[];
  handleConfirmConductRecord: (e: React.FormEvent) => void;
  isDarkMode: boolean;
}

export const ConductRecordModal: React.FC<ConductRecordModalProps> = React.memo(({
  conductRecordModal,
  setConductRecordModal,
  attendanceTerm,
  getStudentMetrics,
  teacherConductOptions,
  handleConfirmConductRecord,
  isDarkMode,
}) => {
  if (!conductRecordModal.isOpen || !conductRecordModal.student) return null;

  const isAdd = conductRecordModal.mode === 'add';
  const currentPoints = conductRecordModal.points || 1;
  const currentStudent = conductRecordModal.student;
  const targetTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
  const metrics = getStudentMetrics(currentStudent.id, targetTerm);
  const curDisp = metrics.totalDisposition !== undefined ? metrics.totalDisposition : 10;
  const projectedDisp = isAdd
    ? Math.min(10, curDisp + currentPoints)
    : Math.max(0, curDisp - currentPoints);

  const positiveSuggestions = [
    'Participación destacada',
    'Excelente trabajo en clase',
    'Colaboración con compañeros',
    'Tarea y materiales completos',
    'Compromiso y superación',
    ...teacherConductOptions
      .filter(
        (opt) =>
          opt.startsWith('+') ||
          opt.startsWith('[+]') ||
          opt.includes('(+') ||
          /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
            opt
          )
      )
      .map((o) => o.replace(/^(\+|\[\+\])\s*/, '')),
  ];

  const negativeSuggestions = [
    'Sin libro',
    'Falta de tarea',
    'Uso indebido de celular',
    'Interrupción de clase',
    'Falta de materiales',
    ...teacherConductOptions.filter(
      (opt) =>
        !opt.startsWith('+') &&
        !opt.startsWith('[+]') &&
        !opt.includes('(+') &&
        !/^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
          opt
        )
    ),
  ];

  const activeSuggestions = Array.from(new Set(isAdd ? positiveSuggestions : negativeSuggestions));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isDarkMode
              ? isAdd
                ? 'border-slate-800 bg-emerald-950/20'
                : 'border-slate-800 bg-rose-950/20'
              : isAdd
              ? 'border-emerald-100 bg-emerald-50/50'
              : 'border-rose-100 bg-rose-50/40'
          }`}
        >
          <div className="flex items-center gap-2">
            {isAdd ? (
              <Award className="w-5 h-5 text-emerald-500" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-500" />
            )}
            <div>
              <h3 className="text-sm font-bold">
                {isAdd ? 'Sumar puntos de disposición' : 'Restar puntos de disposición'}
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {isAdd ? 'Reconocimiento / conducta positiva' : 'Llamado de atención / falta de conducta'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setConductRecordModal({
                isOpen: false,
                student: null,
                mode: 'subtract',
                points: 1,
                customReason: '',
                saveToOptions: false,
              })
            }
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleConfirmConductRecord} className="p-5 space-y-4">
          {/* Selector: Sumar o Restar puntos */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setConductRecordModal((prev) => ({ ...prev, mode: 'subtract' }))}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                !isAdd
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Minus className="w-3.5 h-3.5" />
              <span>Restar puntos (-)</span>
            </button>
            <button
              type="button"
              onClick={() => setConductRecordModal((prev) => ({ ...prev, mode: 'add' }))}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                isAdd
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Sumar puntos (+)</span>
            </button>
          </div>

          {/* Info Estudiante y Vista Previa de Nota */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
            }`}
          >
            <div>
              <span className="text-[11px] text-neutral-500 dark:text-slate-400 block font-medium">Estudiante:</span>
              <strong className="text-sm font-bold">
                {currentStudent.lastName}, {currentStudent.firstName}
              </strong>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-neutral-500 dark:text-slate-400 block font-medium">Nota proyectada:</span>
              <div className="inline-flex items-center gap-1 font-mono font-bold text-sm">
                <span className="text-neutral-500">{curDisp}</span>
                <span>→</span>
                <span className={isAdd ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                  {projectedDisp}
                </span>
                <span className="text-neutral-400 text-xs font-normal">/ 10 pts</span>
              </div>
            </div>
          </div>

          {/* Cantidad de puntos */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300">
              {isAdd ? 'Cantidad de puntos a sumar:' : 'Cantidad de puntos a restar:'}
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((pts) => (
                <button
                  key={pts}
                  type="button"
                  onClick={() => setConductRecordModal((prev) => ({ ...prev, points: pts }))}
                  className={`px-3 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                    currentPoints === pts
                      ? isAdd
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs scale-105'
                        : 'bg-rose-600 text-white border-rose-600 shadow-2xs scale-105'
                      : isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {isAdd ? `+${pts}` : `-${pts}`} {pts === 1 ? 'punto' : 'puntos'}
                </button>
              ))}
            </div>
          </div>

          {/* Sugerencias rápidas según modo */}
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400 block mb-1.5">
              {isAdd ? 'Opciones sugeridas de reconocimiento:' : 'Opciones habituales de conducta:'}
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
              {activeSuggestions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setConductRecordModal((prev) => ({ ...prev, customReason: opt }))}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                    conductRecordModal.customReason === opt
                      ? isAdd
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                      : isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo escrito */}
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400 block mb-1">
              {isAdd ? 'Motivo del reconocimiento / puntos sumados:' : 'Motivo del llamado de atención:'}
            </label>
            <textarea
              value={conductRecordModal.customReason}
              onChange={(e) => setConductRecordModal((prev) => ({ ...prev, customReason: e.target.value }))}
              placeholder={
                isAdd
                  ? 'Escribí el motivo positivo (ej: Participación destacada, excelente trabajo en equipo, compromiso...)'
                  : 'Escribí el motivo (ej: Falta de tarea, no trajo materiales, uso de celular, interrupción...)'
              }
              rows={3}
              autoFocus
              required
              className={`w-full p-3 rounded-xl border text-xs outline-none resize-none transition-all ${
                isAdd ? 'focus:ring-2 focus:ring-emerald-500' : 'focus:ring-2 focus:ring-rose-500'
              } ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
              }`}
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="saveToOptionsCheckbox"
              checked={conductRecordModal.saveToOptions}
              onChange={(e) => setConductRecordModal((prev) => ({ ...prev, saveToOptions: e.target.checked }))}
              className={`w-4 h-4 rounded border-neutral-300 cursor-pointer ${
                isAdd ? 'text-emerald-600 focus:ring-emerald-500' : 'text-rose-600 focus:ring-rose-500'
              }`}
            />
            <label htmlFor="saveToOptionsCheckbox" className="text-xs text-neutral-600 dark:text-slate-300 cursor-pointer select-none">
              Guardar este motivo en mis opciones para próximos registros
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() =>
                setConductRecordModal({
                  isOpen: false,
                  student: null,
                  mode: 'subtract',
                  points: 1,
                  customReason: '',
                  saveToOptions: false,
                })
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!conductRecordModal.customReason.trim()}
              className={`px-4 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 transition-all active:scale-95 ${
                isAdd ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {isAdd ? (
                <>
                  <Award className="w-3.5 h-3.5" />
                  <span>Sumar puntos (+{currentPoints} pto{currentPoints > 1 ? 's' : ''})</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Restar puntos (-{currentPoints} pto{currentPoints > 1 ? 's' : ''})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export interface ManageConductOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacherConductOptions: string[];
  newConductInput: string;
  setNewConductInput: React.Dispatch<React.SetStateAction<string>>;
  newConductType: 'subtract' | 'add';
  setNewConductType: React.Dispatch<React.SetStateAction<'subtract' | 'add'>>;
  handleAddConductOption: (opt: string) => void;
  editingConductOpt: string | null;
  setEditingConductOpt: React.Dispatch<React.SetStateAction<string | null>>;
  editConductInput: string;
  setEditConductInput: React.Dispatch<React.SetStateAction<string>>;
  handleEditConductOption: (oldOpt: string, newOpt: string) => void;
  handleDeleteConductOption: (opt: string) => void;
  isReasonCustomized: (reason: string) => boolean;
  editingTemplateForReason: string | null;
  setEditingTemplateForReason: React.Dispatch<React.SetStateAction<string | null>>;
  reasonTemplateDraft: string;
  setReasonTemplateDraft: React.Dispatch<React.SetStateAction<string>>;
  getTemplateForReason: (reason: string) => string;
  handleResetTemplateForReason: (reason: string) => void;
  handleSaveTemplateForReason: (reason: string, template: string) => void;
  isDarkMode: boolean;
}

export const ManageConductOptionsModal: React.FC<ManageConductOptionsModalProps> = React.memo(({
  isOpen,
  onClose,
  teacherConductOptions,
  newConductInput,
  setNewConductInput,
  newConductType,
  setNewConductType,
  handleAddConductOption,
  editingConductOpt,
  setEditingConductOpt,
  editConductInput,
  setEditConductInput,
  handleEditConductOption,
  handleDeleteConductOption,
  isReasonCustomized,
  editingTemplateForReason,
  setEditingTemplateForReason,
  reasonTemplateDraft,
  setReasonTemplateDraft,
  getTemplateForReason,
  handleResetTemplateForReason,
  handleSaveTemplateForReason,
  isDarkMode,
}) => {
  const {
    attendanceLabel,
    dispositionLabel,
    updateTerminology,
  } = useTerminologySettings();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-bold">Configurar nombres y opciones de {dispositionLabel}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Bloque para cambiar el nombre de Asistencia y Disposición (ej. Concepto, Participación en clase) */}
          <div
            className={`p-3.5 rounded-xl border space-y-3 ${
              isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-blue-50/50 border-blue-200/80'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                Personalizar nombres de columnas y pestañas
              </span>
              {(attendanceLabel !== 'Asistencia' || dispositionLabel !== 'Disposición') && (
                <button
                  type="button"
                  onClick={() => updateTerminology({ attendanceLabel: 'Asistencia', dispositionLabel: 'Disposición' })}
                  className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Restaurar originales
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300 block mb-1">
                  ¿Cómo llamás a la nota de Disposición / Concepto en tu colegio?
                </label>
                <input
                  type="text"
                  value={dispositionLabel}
                  onChange={(e) => updateTerminology({ dispositionLabel: e.target.value })}
                  placeholder="Ej: Disposición, Concepto, Participación en clase..."
                  className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  <span className="text-[10px] text-neutral-500 dark:text-slate-400 mr-0.5">Sugerencias:</span>
                  {DISPOSITION_LABEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateTerminology({ dispositionLabel: preset })}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                        dispositionLabel === preset
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                          : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-1 border-t border-neutral-200/70 dark:border-slate-700/70">
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300 block mb-1">
                  ¿Cómo llamás a la columna de Asistencia?
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    type="text"
                    value={attendanceLabel}
                    onChange={(e) => updateTerminology({ attendanceLabel: e.target.value })}
                    placeholder="Ej: Asistencia, Presentismo..."
                    className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    {ATTENDANCE_LABEL_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateTerminology({ attendanceLabel: preset })}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                          attendanceLabel === preset
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                            : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-neutral-600 dark:text-slate-300 leading-relaxed">
            Definí tus propios motivos habituales de <strong>{dispositionLabel.toLowerCase()}</strong> para asignarlos con un solo clic a cualquier alumno.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newConductInput.trim();
              if (!trimmed) return;
              const finalOpt =
                newConductType === 'add'
                  ? trimmed.startsWith('+')
                    ? trimmed
                    : `+ ${trimmed}`
                  : trimmed.startsWith('+')
                  ? trimmed.replace(/^\+\s*/, '')
                  : trimmed;
              handleAddConductOption(finalOpt);
            }}
            className="space-y-2"
          >
            <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setNewConductType('subtract')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  newConductType === 'subtract'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <Minus className="w-3.5 h-3.5" />
                <span>Restar (-1 pto)</span>
              </button>
              <button
                type="button"
                onClick={() => setNewConductType('add')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  newConductType === 'add'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-neutral-600 dark:text-slate-300 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Sumar (+1 pto)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newConductInput}
                onChange={(e) => setNewConductInput(e.target.value)}
                placeholder={
                  newConductType === 'add'
                    ? 'Ej: Participación, Tarea completa, Buen compañerismo...'
                    : 'Ej: Falta de tarea, Sin carpeta, Uso de celular...'
                }
                className={`flex-1 px-3 py-2 rounded-xl border text-xs outline-none focus:ring-2 ${
                  newConductType === 'add' ? 'focus:ring-emerald-500' : 'focus:ring-rose-500'
                } ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
              <button
                type="submit"
                disabled={!newConductInput.trim()}
                className={`px-3 py-2 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  newConductType === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar</span>
              </button>
            </div>
          </form>

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {teacherConductOptions.length === 0 ? (
              <div className="py-6 text-center text-neutral-400 text-xs border border-dashed rounded-xl p-4">
                <p>No tenés opciones guardadas todavía.</p>
                <p className="text-[11px] mt-1 text-neutral-500">Agregá las tuyas arriba para verlas en los botones rápidos de cada alumno.</p>
              </div>
            ) : (
              teacherConductOptions.map((opt) => (
                <div key={opt} className="space-y-1">
                  <div
                    className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${
                      isDarkMode ? 'bg-slate-800/80 border-slate-700 text-slate-200' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                    }`}
                  >
                    {editingConductOpt === opt ? (
                      <div className="flex items-center gap-1.5 flex-1 mr-2">
                        <input
                          type="text"
                          value={editConductInput}
                          onChange={(e) => setEditConductInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleEditConductOption(opt, editConductInput);
                            if (e.key === 'Escape') setEditingConductOpt(null);
                          }}
                          className={`flex-1 px-2.5 py-1 text-xs rounded-lg border outline-none ${
                            isDarkMode ? 'bg-slate-900 border-slate-600 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                          }`}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleEditConductOption(opt, editConductInput)}
                          className="p-1 text-emerald-600 hover:bg-emerald-500/10 rounded cursor-pointer"
                          title="Guardar cambio"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingConductOpt(null)}
                          className="p-1 text-neutral-400 hover:bg-neutral-500/10 rounded cursor-pointer"
                          title="Cancelar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const isPositive =
                            opt.startsWith('+') ||
                            opt.startsWith('[+]') ||
                            opt.includes('(+') ||
                            /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
                              opt
                            );
                          const cleanOptName = opt.replace(/^(\+|\[\+\])\s*/, '');
                          return (
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  isPositive
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                                }`}
                              >
                                {isPositive ? '+1 pto' : '-1 pto'}
                              </span>
                              <span className="font-medium">{cleanOptName}</span>
                              {isReasonCustomized(opt) && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  Mensaje propio
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (editingTemplateForReason === opt) {
                                setEditingTemplateForReason(null);
                              } else {
                                setEditingTemplateForReason(opt);
                                setReasonTemplateDraft(getTemplateForReason(opt));
                              }
                            }}
                            className={`px-2 py-1 text-[11px] rounded-lg border flex items-center gap-1 cursor-pointer transition-colors ${
                              editingTemplateForReason === opt
                                ? 'bg-purple-600 border-purple-600 text-white font-semibold'
                                : isReasonCustomized(opt)
                                ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 font-medium'
                                : isDarkMode
                                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                            }`}
                            title="Configurar mensaje predeterminado para este motivo"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Mensaje</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingConductOpt(opt);
                              setEditConductInput(opt);
                            }}
                            className="text-neutral-400 hover:text-blue-500 transition-colors p-1 rounded cursor-pointer"
                            title="Editar nombre de la opción"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteConductOption(opt)}
                            className="text-neutral-400 hover:text-red-500 transition-colors p-1 rounded cursor-pointer"
                            title="Eliminar opción"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {editingTemplateForReason === opt && (
                    <div
                      className={`p-3 rounded-xl border space-y-2.5 text-xs animate-in fade-in duration-150 ${
                        isDarkMode
                          ? 'bg-purple-950/20 border-purple-800/60 text-slate-200'
                          : 'bg-purple-50/80 border-purple-200 text-purple-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center gap-1.5 text-xs text-purple-800 dark:text-purple-300">
                          <Sparkles className="w-3.5 h-3.5" />
                          Mensaje por defecto para "{opt}"
                        </span>
                        {isReasonCustomized(opt) ? (
                          <button
                            type="button"
                            onClick={() => {
                              handleResetTemplateForReason(opt);
                              setReasonTemplateDraft(getTemplateForReason(opt));
                            }}
                            className="text-[10px] text-rose-500 hover:underline cursor-pointer"
                          >
                            Restablecer a estándar
                          </button>
                        ) : (
                          <span className="text-[10px] text-neutral-400">Plantilla estándar</span>
                        )}
                      </div>

                      <textarea
                        rows={3}
                        value={reasonTemplateDraft}
                        onChange={(e) => setReasonTemplateDraft(e.target.value)}
                        placeholder="Escribe el mensaje que se cargará por defecto cuando un alumno tenga esta falta..."
                        className={`w-full p-2.5 rounded-lg border text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500/40 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                        {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setReasonTemplateDraft((prev) => `${prev} ${tag}`)}
                            className={`px-1.5 py-0.5 text-[10px] rounded border font-mono cursor-pointer ${
                              isDarkMode ? 'bg-slate-800 border-slate-700 text-purple-300' : 'bg-white border-purple-200 text-purple-700'
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingTemplateForReason(null)}
                          className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${
                            isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          Cerrar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleSaveTemplateForReason(opt, reasonTemplateDraft);
                            setEditingTemplateForReason(null);
                          }}
                          className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" />
                          <span>Guardar mensaje</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
});

export interface StudentIndividualHistoryModalProps {
  selectedStudentForHistory: Student | null;
  setSelectedStudentForHistory: React.Dispatch<React.SetStateAction<Student | null>>;
  getStudentMetrics: (studentId: string, termOverride?: '1c' | '2c' | 'all' | 'annual') => StudentDispositionData;
  handleOpenEditAbsences: (student: Student) => void;
  handleDeleteLatestAbsence: (student: Student) => void;
  handleDeleteLatestLate: (student: Student) => void;
  handleOpenEditDisposition: (student: Student) => void;
  handleResetSingleStudentDisposition: (student: Student, confirmPrompt: boolean) => void;
  historyList: StudentHistoryItem[];
  handleOpenNotifyModal: (item: StudentHistoryItem, student: Student) => void;
  handleDeleteHistoryEntry: (item: StudentHistoryItem) => void;
  isDarkMode: boolean;
}

export const StudentIndividualHistoryModal: React.FC<StudentIndividualHistoryModalProps> = React.memo(({
  selectedStudentForHistory,
  setSelectedStudentForHistory,
  getStudentMetrics,
  handleOpenEditAbsences,
  handleDeleteLatestAbsence,
  handleDeleteLatestLate,
  handleOpenEditDisposition,
  handleResetSingleStudentDisposition,
  historyList,
  handleOpenNotifyModal,
  handleDeleteHistoryEntry,
  isDarkMode,
}) => {
  const { dispositionLabel } = useTerminologySettings();

  if (!selectedStudentForHistory) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-3">
            <img
              src={selectedStudentForHistory.avatar}
              alt={selectedStudentForHistory.firstName}
              className="w-9 h-9 rounded-full object-cover border border-neutral-300 dark:border-slate-700"
            />
            <div>
              <h3 className="text-sm font-bold">
                {selectedStudentForHistory.lastName}, {selectedStudentForHistory.firstName}
              </h3>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                Historial de Conducta y Ausencias
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedStudentForHistory(null)}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className={`p-4 border-b grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-center text-xs ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-white'}`}>
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex flex-col items-center justify-between">
            <div>
              <span className="text-[11px] text-red-600 dark:text-red-400 block font-medium">Ausencias</span>
              <span className="text-base font-bold text-red-700 dark:text-red-300">
                {getStudentMetrics(selectedStudentForHistory.id).totalAbsences}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => handleOpenEditAbsences(selectedStudentForHistory)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 cursor-pointer shadow-2xs transition-colors inline-flex items-center gap-1"
                title="Editar cantidad de faltas de este estudiante (pasar de papel, marcar fecha y avisar)"
              >
                <Pencil className="w-2.5 h-2.5" />
                <span>Editar faltas</span>
              </button>
              {getStudentMetrics(selectedStudentForHistory.id).totalAbsences > 0 && (
                <button
                  type="button"
                  onClick={() => handleDeleteLatestAbsence(selectedStudentForHistory)}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 cursor-pointer shadow-2xs transition-colors"
                  title="Eliminar la última falta registrada de este estudiante y actualizar total"
                >
                  Borrar última
                </button>
              )}
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex flex-col items-center justify-between">
            <div>
              <span className="text-[11px] text-amber-600 dark:text-amber-400 block font-medium">Llegadas Tarde</span>
              <span className="text-base font-bold text-amber-700 dark:text-amber-300">
                {getStudentMetrics(selectedStudentForHistory.id).totalLates || 0}
              </span>
            </div>
            {(getStudentMetrics(selectedStudentForHistory.id).totalLates || 0) > 0 && (
              <button
                type="button"
                onClick={() => handleDeleteLatestLate(selectedStudentForHistory)}
                className="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 cursor-pointer shadow-2xs transition-colors"
                title="Eliminar la última llegada tarde de este estudiante y actualizar total"
              >
                Borrar tardanza
              </button>
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex flex-col items-center justify-between">
            <div>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block font-medium">Puntaje {dispositionLabel}</span>
              <span className="text-base font-bold text-emerald-700 dark:text-emerald-300">
                {getStudentMetrics(selectedStudentForHistory.id).totalDisposition} / 10
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => handleOpenEditDisposition(selectedStudentForHistory)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 cursor-pointer shadow-2xs transition-all active:scale-95"
                title="Editar o fijar manualmente la nota de este alumno"
              >
                <Pencil className="w-3 h-3" />
                <span>Editar nota</span>
              </button>
              <button
                type="button"
                onClick={() => handleResetSingleStudentDisposition(selectedStudentForHistory, true)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 cursor-pointer shadow-2xs transition-colors"
                title="Borra el puntaje y elimina las anotaciones de este alumno"
              >
                Borrar historial
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-2 text-xs flex-1">
          {historyList.filter(
            (h) =>
              h.studentId === selectedStudentForHistory.id &&
              (!selectedStudentForHistory.courseId || !h.courseId || h.courseId === selectedStudentForHistory.courseId)
          ).length === 0 ? (
            <div className="py-8 text-center text-neutral-400">
              <p>No hay conductas ni incidencias registradas para este estudiante.</p>
            </div>
          ) : (
            historyList
              .filter(
                (h) =>
                  h.studentId === selectedStudentForHistory.id &&
                  (!selectedStudentForHistory.courseId || !h.courseId || h.courseId === selectedStudentForHistory.courseId)
              )
              .map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-neutral-900 dark:text-white">{item.action}</p>
                      {(item.category === 'Ausencia' || item.category === 'Disposición') &&
                        (item.messageSent ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                            title={`Notificación enviada por ${item.notificationMethod === 'gmail' ? 'Gmail' : 'Classroom'} (${item.notifiedAt || 'OK'})`}
                          >
                            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                            <span>Aviso enviado</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenNotifyModal(item, selectedStudentForHistory)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer shadow-2xs"
                            title={`Enviar aviso de ${item.category === 'Ausencia' ? 'inasistencia' : 'conducta'} al estudiante`}
                          >
                            <Send className="w-2.5 h-2.5" />
                            <span>Mandar aviso</span>
                          </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5 font-mono">
                      {item.date} a las {item.time}
                    </p>
                    {item.messageText && (
                      <p className="text-[11px] text-neutral-600 dark:text-slate-300 mt-1 italic border-l-2 border-blue-400 pl-2">
                        "{item.messageText}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {(() => {
                      const isItemAbsence =
                        item.category === 'Ausencia' ||
                        item.action === 'Ausencia' ||
                        item.action?.toLowerCase().includes('ausencia') ||
                        item.action?.toLowerCase().includes('falta');
                      const isItemLate =
                        item.category === 'Llegada tarde' ||
                        item.action === 'Llegada tarde' ||
                        item.action?.toLowerCase().includes('llegada tarde') ||
                        item.action?.toLowerCase().includes('tarde') ||
                        item.action?.toLowerCase().includes('tardanza');

                      return (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isItemAbsence
                              ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                              : isItemLate
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                              : 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                          }`}
                        >
                          {isItemAbsence
                            ? 'Ausencia'
                            : isItemLate
                            ? 'Tardanza'
                            : item.pointsChange !== undefined && item.pointsChange !== 0
                            ? `${item.pointsChange > 0 ? '+' : ''}${item.pointsChange} pto`
                            : '-'}
                        </span>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryEntry(item)}
                      className="p-1 text-neutral-400 hover:text-red-500 rounded cursor-pointer"
                      title="Eliminar este registro y restaurar puntuación"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>

        <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <button
            type="button"
            onClick={() => setSelectedStudentForHistory(null)}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
});

export interface SendDispositionToGradesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course | undefined;
  courseStudents: Student[];
  attendanceTerm: '1c' | '2c' | 'all' | 'annual';
  getStudentMetrics: (studentId: string, termOverride?: '1c' | '2c' | 'all' | 'annual') => StudentDispositionData;
  handleSendDispositionToGrades: (term: '1c' | '2c', goToGrades: boolean) => void;
  isDarkMode: boolean;
}

export const SendDispositionToGradesModal: React.FC<SendDispositionToGradesModalProps> = React.memo(({
  isOpen,
  onClose,
  activeCourse,
  courseStudents,
  attendanceTerm,
  getStudentMetrics,
  handleSendDispositionToGrades,
  isDarkMode,
}) => {
  const { dispositionLabel, attendanceLabel } = useTerminologySettings();

  if (!isOpen || !activeCourse) return null;

  const activeTargetTerm: '1c' | '2c' =
    attendanceTerm === '1c' || attendanceTerm === '2c'
      ? attendanceTerm
      : getCurrentCalendarTerm(getGlobalAttendanceSettings());
  const activeTermLabel = activeTargetTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 max-h-[90vh] flex flex-col ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Mandar Notas de {dispositionLabel} a Calificaciones</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Materia: <strong className="text-neutral-700 dark:text-slate-200">{activeCourse.name}</strong> • Destino:{' '}
                <strong className="text-blue-600 dark:text-blue-400">{activeTermLabel}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-600 dark:text-slate-300 leading-relaxed">
          Esta función transfiere la nota de {dispositionLabel.toLowerCase()} (escala 1 a 10) de todos los estudiantes directamente a la pestaña de{' '}
          <strong>Calificaciones</strong> del <strong>{activeTermLabel}</strong> (según el cuatrimestre seleccionado en la planilla de {attendanceLabel.toLowerCase()}).
        </p>

        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
            activeTargetTerm === '1c'
              ? isDarkMode
                ? 'bg-blue-950/40 border-blue-800/80 text-blue-200'
                : 'bg-blue-50/80 border-blue-200 text-blue-900'
              : isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
              : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
          }`}
        >
          <Info className="w-4 h-4 shrink-0" />
          <span className="text-[11px] leading-relaxed">
            Se actualizará o creará automáticamente la columna <strong>"Nota de {dispositionLabel}"</strong> dentro de{' '}
            <strong>Calificaciones</strong> para el <strong>{activeTermLabel}</strong>.
          </span>
        </div>

        <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between text-xs font-semibold px-1">
            <span>Vista previa ({courseStudents.length} estudiantes)</span>
            <span className="text-[11px] text-neutral-500 dark:text-slate-400">Nota a transferir ({activeTermLabel})</span>
          </div>
          <div
            className={`flex-1 overflow-y-auto max-h-48 rounded-xl border divide-y p-1 ${
              isDarkMode ? 'bg-slate-950/60 border-slate-800 divide-slate-800/60' : 'bg-neutral-50 border-neutral-200 divide-neutral-100'
            }`}
          >
            {courseStudents.length === 0 ? (
              <div className="py-6 text-center text-xs text-neutral-500 dark:text-slate-400">
                No hay estudiantes registrados en este curso.
              </div>
            ) : (
              courseStudents.map((st) => {
                const metrics = getStudentMetrics(st.id, activeTargetTerm);
                return (
                  <div key={st.id} className="flex items-center justify-between py-1.5 px-2.5 text-xs">
                    <span className="font-medium truncate mr-2">
                      {st.lastName}, {st.firstName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                        metrics.totalDisposition >= 8
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : metrics.totalDisposition >= 6
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {metrics.totalDisposition} / 10
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cancelar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSendDispositionToGrades(activeTargetTerm, false)}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-all"
            >
              Mandar a Calificaciones ({activeTermLabel})
            </button>
            <button
              type="button"
              onClick={() => handleSendDispositionToGrades(activeTargetTerm, true)}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-all flex items-center gap-1.5"
              title="Mandar notas y abrir inmediatamente la pestaña Calificaciones"
            >
              <span>Mandar e Ir a Calificaciones</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
