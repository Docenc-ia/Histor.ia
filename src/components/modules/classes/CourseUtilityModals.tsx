import React from 'react';
import {
  Mail,
  Smartphone,
  GraduationCap,
  Send,
  Loader2,
  X,
  UserPlus,
  Check,
  ArrowLeftRight,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
import { Course, Student } from '../../../types';

export interface DirectMessageModalState {
  isOpen: boolean;
  student: Student | null;
  channel: 'gmail' | 'classroom' | 'whatsapp';
  subject: string;
  messageText: string;
  isSending: boolean;
}

interface DirectMessageModalProps {
  directMessageModal: DirectMessageModalState;
  setDirectMessageModal: React.Dispatch<React.SetStateAction<DirectMessageModalState>>;
  activeCourse: Course;
  isDarkMode: boolean;
  handleSendDirectMessage: () => void;
}

export const DirectMessageModal: React.FC<DirectMessageModalProps> = ({
  directMessageModal,
  setDirectMessageModal,
  activeCourse,
  isDarkMode,
  handleSendDirectMessage,
}) => {
  if (!directMessageModal.isOpen || !directMessageModal.student || !activeCourse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Enviar Mensaje al Alumno</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Destinatario:{' '}
                <strong className="text-neutral-900 dark:text-slate-100">
                  {directMessageModal.student.lastName}, {directMessageModal.student.firstName}
                </strong>
                {directMessageModal.student.email && ` (${directMessageModal.student.email})`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDirectMessageModal((prev) => ({ ...prev, isOpen: false }))}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canal de Envío */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Canal de comunicación:
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setDirectMessageModal((prev) => ({ ...prev, channel: 'gmail' }))}
              className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                directMessageModal.channel === 'gmail'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                  : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>Correo / Gmail</span>
            </button>
            <button
              type="button"
              onClick={() => setDirectMessageModal((prev) => ({ ...prev, channel: 'classroom' }))}
              className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                directMessageModal.channel === 'classroom'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                  : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              <span>Classroom</span>
            </button>
            <button
              type="button"
              onClick={() => setDirectMessageModal((prev) => ({ ...prev, channel: 'whatsapp' }))}
              className={`p-2 rounded-xl text-xs font-semibold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                directMessageModal.channel === 'whatsapp'
                  ? 'bg-green-600 text-white border-green-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                  : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>WhatsApp</span>
            </button>
          </div>
        </div>

        {/* Asunto */}
        {directMessageModal.channel === 'gmail' && (
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
              Asunto del mensaje:
            </label>
            <input
              type="text"
              value={directMessageModal.subject}
              onChange={(e) => setDirectMessageModal((prev) => ({ ...prev, subject: e.target.value }))}
              className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
              }`}
            />
          </div>
        )}

        {/* Plantillas Rápidas */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-neutral-500 dark:text-slate-400">
            Plantillas rápidas:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              {
                label: 'Recordatorio entrega',
                text: `Hola ${directMessageModal.student.firstName},\n\nTe recuerdo que tenés una actividad pendiente de entrega en la materia ${activeCourse.name}. Por favor completala a la brevedad.\n\nSaludos,\nProfesor/a.`,
              },
              {
                label: 'Consulta inasistencias',
                text: `Estimado/a ${directMessageModal.student.firstName},\n\nNos ponemos en contacto debido a que registrás faltas recientes en ${activeCourse.name}. Si necesitás el material de las clases o justificar la inasistencia, avisanos.\n\nSaludos cordiales.`,
              },
              {
                label: 'Felicitación y mérito',
                text: `¡Felicitaciones ${directMessageModal.student.firstName}!\n\nQueríamos destacar tu excelente participación y compromiso en las clases de ${activeCourse.name}. ¡Seguí así!\n\nSaludos.`,
              },
            ].map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => setDirectMessageModal((prev) => ({ ...prev, messageText: tpl.text }))}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
                }`}
              >
                + {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Texto del Mensaje */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Mensaje:
          </label>
          <textarea
            rows={5}
            value={directMessageModal.messageText}
            onChange={(e) => setDirectMessageModal((prev) => ({ ...prev, messageText: e.target.value }))}
            className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
            }`}
          />
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDirectMessageModal((prev) => ({ ...prev, isOpen: false }))}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={directMessageModal.isSending || !directMessageModal.messageText.trim()}
            onClick={handleSendDirectMessage}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {directMessageModal.isSending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>
              Enviar{' '}
              {directMessageModal.channel === 'gmail'
                ? 'por Gmail / Correo'
                : directMessageModal.channel === 'whatsapp'
                ? 'por WhatsApp'
                : 'por Classroom'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  isDarkMode: boolean;
  addStudentTab: 'single' | 'batch';
  setAddStudentTab: (tab: 'single' | 'batch') => void;
  addStudentLastName: string;
  setAddStudentLastName: (v: string) => void;
  addStudentFirstName: string;
  setAddStudentFirstName: (v: string) => void;
  addStudentEmail: string;
  setAddStudentEmail: (v: string) => void;
  addStudentPhone: string;
  setAddStudentPhone: (v: string) => void;
  addStudentNotes: string;
  setAddStudentNotes: (v: string) => void;
  batchStudentsText: string;
  setBatchStudentsText: (v: string) => void;
  isSavingManualStudent: boolean;
  handleSaveSingleStudent: (keepOpen: boolean) => void;
  handleSaveBatchStudents: () => void;
}

export const AddStudentModal: React.FC<AddStudentModalProps> = ({
  isOpen,
  onClose,
  activeCourse,
  isDarkMode,
  addStudentTab,
  setAddStudentTab,
  addStudentLastName,
  setAddStudentLastName,
  addStudentFirstName,
  setAddStudentFirstName,
  addStudentEmail,
  setAddStudentEmail,
  addStudentPhone,
  setAddStudentPhone,
  addStudentNotes,
  setAddStudentNotes,
  batchStudentsText,
  setBatchStudentsText,
  isSavingManualStudent,
  handleSaveSingleStudent,
  handleSaveBatchStudents,
}) => {
  if (!isOpen || !activeCourse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Agregar Alumno a {activeCourse.name}</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Carga manual para materias sin Google Classroom
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Pestañas: Individual vs Lote */}
        <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setAddStudentTab('single')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              addStudentTab === 'single'
                ? 'bg-emerald-600 text-white shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-white'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Carga Individual
          </button>
          <button
            type="button"
            onClick={() => setAddStudentTab('batch')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              addStudentTab === 'batch'
                ? 'bg-emerald-600 text-white shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-white'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Cargar varios a la vez (Pegar lista)
          </button>
        </div>

        {addStudentTab === 'single' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveSingleStudent(false);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold">
                  Apellido <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. González"
                  value={addStudentLastName}
                  onChange={(e) => setAddStudentLastName(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Martín"
                  value={addStudentFirstName}
                  onChange={(e) => setAddStudentFirstName(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold">
                  Correo Electrónico (Gmail / Institucional)
                </label>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Para mandarle avisos y mensajes
                </span>
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                <input
                  type="email"
                  placeholder="alumno@ejemplo.com"
                  value={addStudentEmail}
                  onChange={(e) => setAddStudentEmail(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                Al cargar el correo podrás enviarle avisos de inasistencia, conducta o mensajes directos.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold">
                Teléfono / WhatsApp (Opcional)
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                <input
                  type="tel"
                  placeholder="+54 9 11 1234-5678"
                  value={addStudentPhone}
                  onChange={(e) => setAddStudentPhone(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold">
                Observaciones o Nota Inicial (Opcional)
              </label>
              <textarea
                rows={2}
                placeholder="Ej. Alumno ingresante, libreta sanitaria entregada..."
                value={addStudentNotes}
                onChange={(e) => setAddStudentNotes(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
            </div>

            <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingManualStudent}
                  onClick={() => handleSaveSingleStudent(true)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-neutral-100 dark:bg-slate-800 hover:bg-neutral-200 dark:hover:bg-slate-700 text-neutral-800 dark:text-slate-200 border border-neutral-200 dark:border-slate-700 cursor-pointer transition-colors"
                  title="Guardar este alumno y mantener el formulario abierto para cargar el siguiente"
                >
                  Guardar y agregar otro
                </button>
                <button
                  type="submit"
                  disabled={isSavingManualStudent}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isSavingManualStudent ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>Guardar Alumno</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs">
              <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                📋 Pegá una lista completa de alumnos desde Excel o Word:
              </p>
              <p className="text-neutral-600 dark:text-slate-400 mt-1">
                Cada renglón debe tener el formato: <code>Apellido, Nombre, correo@ejemplo.com</code>
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold">
                Lista de estudiantes (una fila por alumno):
              </label>
              <textarea
                rows={8}
                placeholder={`Pérez, Juan, juan.perez@colegio.edu.ar\nGómez, María, maria.gomez@gmail.com\nRodríguez, Lucas, lucas.rodriguez@gmail.com`}
                value={batchStudentsText}
                onChange={(e) => setBatchStudentsText(e.target.value)}
                className={`w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
              />
            </div>

            <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingManualStudent || !batchStudentsText.trim()}
                onClick={handleSaveBatchStudents}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isSavingManualStudent ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Importar lista de alumnos</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface DobleEntradaDiffItem {
  studentId: string;
  studentName: string;
  termLabel: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

interface DobleEntradaModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  dobleEntradaDiffs: DobleEntradaDiffItem[] | null;
  isDarkMode: boolean;
}

export const DobleEntradaModal: React.FC<DobleEntradaModalProps> = ({
  isOpen,
  onClose,
  activeCourse,
  dobleEntradaDiffs,
  isDarkMode,
}) => {
  if (!isOpen || !activeCourse || !dobleEntradaDiffs) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-blue-50/70 border-blue-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Doble Entrada: Cambios desde Google Sheets</h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {activeCourse.name} • {dobleEntradaDiffs.length} cambio(s) aplicados
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs max-h-96 overflow-y-auto">
          <p className="text-neutral-600 dark:text-slate-300">
            Se detectaron y actualizaron las siguientes modificaciones hechas en Google Sheets:
          </p>

          <div className="divide-y divide-neutral-100 dark:divide-slate-800 border rounded-xl overflow-hidden">
            {dobleEntradaDiffs.map((diff, idx) => (
              <div
                key={idx}
                className={`p-3 flex items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-850/60' : 'bg-neutral-50/50'
                }`}
              >
                <div>
                  <span className="font-bold text-xs block">{diff.studentName}</span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {diff.termLabel} • {diff.fieldLabel}
                  </span>
                </div>

                <div className="text-right">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono font-bold text-xs bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    <span>{diff.oldValue}</span>
                    <span>→</span>
                    <span className="text-blue-600 dark:text-blue-400">{diff.newValue}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`p-3.5 border-t flex justify-end ${
            isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};

interface HeaderExportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  isDarkMode: boolean;
  handleExportAllCourseExcel: (type: 'disposition' | 'grades' | 'history' | 'all') => void;
  HistoryIcon: React.ElementType;
}

export const HeaderExportExcelModal: React.FC<HeaderExportExcelModalProps> = ({
  isOpen,
  onClose,
  activeCourse,
  isDarkMode,
  handleExportAllCourseExcel,
  HistoryIcon,
}) => {
  if (!isOpen || !activeCourse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-emerald-50/70 border-emerald-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Exportar a Excel (.xlsx)</h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">{activeCourse.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <p className="text-neutral-600 dark:text-slate-300">
            Selecciona qué archivo deseas descargar en formato Excel nativo (.xlsx):
          </p>

          {/* Opción 1: Asistencia y Disposición */}
          <button
            type="button"
            onClick={() => handleExportAllCourseExcel('disposition')}
            className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                : 'bg-neutral-50 hover:bg-emerald-50/40 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold block text-sm">Asistencia y Disposición (.xlsx)</span>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Incluye hojas de 1° Cuatrimestre, 2° Cuatrimestre y Resumen Anual consolidado
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-emerald-500" />
          </button>

          {/* Opción 2: Calificaciones */}
          <button
            type="button"
            onClick={() => handleExportAllCourseExcel('grades')}
            className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                : 'bg-neutral-50 hover:bg-blue-50/40 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold block text-sm">Planilla de Calificaciones (.xlsx)</span>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Matriz completa de notas con columnas, promedios y notas finales
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-blue-500" />
          </button>

          {/* Opción 3: Historial y Bitácora */}
          <button
            type="button"
            onClick={() => handleExportAllCourseExcel('history')}
            className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-850 hover:bg-slate-800 border-slate-750'
                : 'bg-neutral-50 hover:bg-purple-50/40 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600">
                <HistoryIcon className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold block text-sm">Historial y Bitácora (.xlsx)</span>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Registro cronológico de faltas, observaciones, conducta y avisos
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-purple-500" />
          </button>

          {/* Opción 4: Paquete Completo */}
          <button
            type="button"
            onClick={() => handleExportAllCourseExcel('all')}
            className="w-full p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-between shadow-xs transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-white" />
              <span className="text-sm">Descargar Todo el Paquete del Curso</span>
            </div>
            <span className="text-xs opacity-90">Archivos .xlsx</span>
          </button>
        </div>

        <div
          className={`p-3.5 border-t flex justify-end ${
            isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
