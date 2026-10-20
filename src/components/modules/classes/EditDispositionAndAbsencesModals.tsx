import React from 'react';
import {
  Pencil,
  X,
  Check,
  Calendar,
  MessageSquare,
  Mail,
  Loader2,
} from 'lucide-react';
import {
  Course,
  Student,
  StudentDispositionData,
  AbsencePresetTemplate,
  AbsenceNotificationSettings,
} from '../../../types';

export interface EditStudentDispositionModalProps {
  editingDispositionStudent: Student | null;
  setEditingDispositionStudent: React.Dispatch<React.SetStateAction<Student | null>>;
  activeCourse: Course | undefined;
  editingDispositionTerm: '1c' | '2c';
  handleChangeEditingTerm: (term: '1c' | '2c') => void;
  getStudentMetrics: (studentId: string, termOverride?: '1c' | '2c' | 'all') => StudentDispositionData;
  editingDispositionScore: string;
  setEditingDispositionScore: React.Dispatch<React.SetStateAction<string>>;
  editingDispositionReason: string;
  setEditingDispositionReason: React.Dispatch<React.SetStateAction<string>>;
  filteredStudents: Student[];
  handleNavigateEditStudent: (direction: number) => void;
  handleSaveStudentDisposition: (advanceToNext?: boolean) => void;
  isDarkMode: boolean;
}

export const EditStudentDispositionModal: React.FC<EditStudentDispositionModalProps> = React.memo(({
  editingDispositionStudent,
  setEditingDispositionStudent,
  activeCourse,
  editingDispositionTerm,
  handleChangeEditingTerm,
  getStudentMetrics,
  editingDispositionScore,
  setEditingDispositionScore,
  editingDispositionReason,
  setEditingDispositionReason,
  filteredStudents,
  handleNavigateEditStudent,
  handleSaveStudentDisposition,
  isDarkMode,
}) => {
  if (!editingDispositionStudent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Editar Nota de Disposición</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Estudiante:{' '}
                <strong className="text-neutral-900 dark:text-slate-100">
                  {editingDispositionStudent.lastName}, {editingDispositionStudent.firstName}
                </strong>
                {activeCourse && ` • ${activeCourse.name}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditingDispositionStudent(null)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 text-xs flex items-start gap-2.5">
          <span className="text-base leading-none">📝</span>
          <p className="text-neutral-700 dark:text-slate-300 leading-relaxed">
            <strong>Carga manual o notas en papel:</strong> Podés definir directamente la nota de disposición de este estudiante. Es ideal para pasar notas tomadas en papel o cuaderno. Se guarda directamente en la planilla sin enviar avisos ni notificaciones al alumno.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Cuatrimestre a modificar:
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleChangeEditingTerm('1c')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                editingDispositionTerm === '1c'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                  : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
              }`}
            >
              <span>1° Cuatrimestre</span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  editingDispositionTerm === '1c'
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                }`}
              >
                Actual: {getStudentMetrics(editingDispositionStudent.id, '1c').totalDisposition}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleChangeEditingTerm('2c')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                editingDispositionTerm === '2c'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                  : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
              }`}
            >
              <span>2° Cuatrimestre</span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  editingDispositionTerm === '2c'
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                }`}
              >
                Actual: {getStudentMetrics(editingDispositionStudent.id, '2c').totalDisposition}
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
              Nueva Nota de Disposición (0 a 10 puntos):
            </label>
            <span className="text-[11px] text-neutral-500 dark:text-slate-400">Inicia en 10</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                value={editingDispositionScore}
                onChange={(e) => setEditingDispositionScore(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
                    handleSaveStudentDisposition(currentIndex < filteredStudents.length - 1);
                  }
                }}
                autoFocus
                placeholder="10"
                className={`w-full px-4 py-2.5 rounded-xl border text-lg font-bold text-center outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                    : 'bg-white border-neutral-300 text-neutral-900 focus:border-indigo-500 shadow-inner'
                }`}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 dark:text-slate-500">
                / 10 pts
              </span>
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-slate-400 block mb-1">
              Selección rápida:
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((num) => {
                const isSelected = String(num) === editingDispositionScore;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setEditingDispositionScore(String(num))}
                    className={`h-7 min-w-7 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 scale-105 shadow-2xs'
                        : num >= 8
                        ? isDarkMode
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/60'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        : num >= 6
                        ? isDarkMode
                          ? 'bg-amber-950/40 text-amber-300 border-amber-800/60 hover:bg-amber-900/60'
                          : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                        : isDarkMode
                        ? 'bg-red-950/40 text-red-300 border-red-800/60 hover:bg-red-900/60'
                        : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Observación / Motivo (opcional):
          </label>
          <input
            type="text"
            value={editingDispositionReason}
            onChange={(e) => setEditingDispositionReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
                handleSaveStudentDisposition(currentIndex < filteredStudents.length - 1);
              }
            }}
            placeholder="Ej: Registro en papel, trabajo en clase, compromiso, etc."
            className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
            }`}
          />
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {['Pasado de papel', 'Participación en clase', 'Trabajo práctico', 'Comportamiento', 'Restablecer a 10'].map(
              (tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setEditingDispositionReason(tag)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                    editingDispositionReason === tag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                      : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                  }`}
                >
                  + {tag}
                </button>
              )
            )}
          </div>
        </div>

        {(() => {
          const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
          const hasPrev = currentIndex > 0;
          const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

          return (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-neutral-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => handleNavigateEditStudent(-1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ir al alumno anterior"
                >
                  ← Anterior
                </button>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium">
                  {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => handleNavigateEditStudent(1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ir al alumno siguiente"
                >
                  Siguiente →
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setEditingDispositionStudent(null)}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                {hasNext && (
                  <button
                    type="button"
                    onClick={() => handleSaveStudentDisposition(true)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                    title="Guardar la nota de este alumno y pasar al siguiente en la lista"
                  >
                    <span>Guardar y siguiente</span>
                    <span>→</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveStudentDisposition(false)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar nota</span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export interface EditStudentAbsencesModalProps {
  editingAbsenceStudent: Student | null;
  setEditingAbsenceStudent: React.Dispatch<React.SetStateAction<Student | null>>;
  activeCourse: Course | undefined;
  editingAbsenceTerm: '1c' | '2c';
  handleChangeEditingAbsenceTerm: (term: '1c' | '2c') => void;
  getStudentMetrics: (studentId: string, termOverride?: '1c' | '2c' | 'all') => StudentDispositionData;
  editingAbsenceCount: string;
  setEditingAbsenceCount: React.Dispatch<React.SetStateAction<string>>;
  editingAbsenceDate: string;
  setEditingAbsenceDate: React.Dispatch<React.SetStateAction<string>>;
  editingAbsenceReason: string;
  setEditingAbsenceReason: React.Dispatch<React.SetStateAction<string>>;
  editingAbsenceSendNotif: boolean;
  setEditingAbsenceSendNotif: React.Dispatch<React.SetStateAction<boolean>>;
  editingAbsenceChannel: 'classroom' | 'gmail';
  setEditingAbsenceChannel: React.Dispatch<React.SetStateAction<'classroom' | 'gmail'>>;
  editingAbsenceMessageText: string;
  setEditingAbsenceMessageText: React.Dispatch<React.SetStateAction<string>>;
  savedPresets: AbsencePresetTemplate[];
  notifSettings: AbsenceNotificationSettings;
  defaultAbsencePresets: AbsencePresetTemplate[];
  formatTemplateForStudent: (
    tpl: string,
    student: Student,
    courseName: string,
    dispositionScore: number,
    dateStr?: string
  ) => string;
  filteredStudents: Student[];
  isSavingAbsenceEdit: boolean;
  handleNavigateEditAbsenceStudent: (direction: number) => void;
  handleSaveStudentAbsences: (advanceToNext?: boolean) => void;
  isDarkMode: boolean;
}

export const EditStudentAbsencesModal: React.FC<EditStudentAbsencesModalProps> = React.memo(({
  editingAbsenceStudent,
  setEditingAbsenceStudent,
  activeCourse,
  editingAbsenceTerm,
  handleChangeEditingAbsenceTerm,
  getStudentMetrics,
  editingAbsenceCount,
  setEditingAbsenceCount,
  editingAbsenceDate,
  setEditingAbsenceDate,
  editingAbsenceReason,
  setEditingAbsenceReason,
  editingAbsenceSendNotif,
  setEditingAbsenceSendNotif,
  editingAbsenceChannel,
  setEditingAbsenceChannel,
  editingAbsenceMessageText,
  setEditingAbsenceMessageText,
  savedPresets,
  notifSettings,
  defaultAbsencePresets,
  formatTemplateForStudent,
  filteredStudents,
  isSavingAbsenceEdit,
  handleNavigateEditAbsenceStudent,
  handleSaveStudentAbsences,
  isDarkMode,
}) => {
  if (!editingAbsenceStudent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Editar Inasistencias del Alumno</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Estudiante:{' '}
                <strong className="text-neutral-900 dark:text-slate-100">
                  {editingAbsenceStudent.lastName}, {editingAbsenceStudent.firstName}
                </strong>
                {activeCourse && ` • ${activeCourse.name}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditingAbsenceStudent(null)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-neutral-200 dark:border-slate-700 text-xs flex items-start gap-2.5">
          <span className="text-base leading-none">📋</span>
          <p className="text-neutral-700 dark:text-slate-300 leading-relaxed">
            <strong>Carga de planilla / notas en papel:</strong> Podés definir directamente el total de faltas y la fecha.{' '}
            <strong>No se envía ninguna notificación al estudiante</strong> a menos que actives expresamente la casilla opcional de abajo.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Cuatrimestre a modificar:
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleChangeEditingAbsenceTerm('1c')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                editingAbsenceTerm === '1c'
                  ? 'bg-red-600 text-white border-red-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                  : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
              }`}
            >
              <span>1° Cuatrimestre</span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  editingAbsenceTerm === '1c'
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                }`}
              >
                Actual: {getStudentMetrics(editingAbsenceStudent.id, '1c').totalAbsences}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleChangeEditingAbsenceTerm('2c')}
              className={`p-2 rounded-xl text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                editingAbsenceTerm === '2c'
                  ? 'bg-red-600 text-white border-red-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                  : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
              }`}
            >
              <span>2° Cuatrimestre</span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  editingAbsenceTerm === '2c'
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-200 dark:bg-slate-700 text-neutral-700 dark:text-slate-300'
                }`}
              >
                Actual: {getStudentMetrics(editingAbsenceStudent.id, '2c').totalAbsences}
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
              Cantidad Total de Inasistencias:
            </label>
            <span className="text-[11px] text-neutral-500 dark:text-slate-400">Número de clases ausente</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const currentVal = parseInt(editingAbsenceCount, 10) || 0;
                setEditingAbsenceCount(String(Math.max(0, currentVal - 1)));
              }}
              className="w-10 h-10 rounded-xl border border-neutral-300 dark:border-slate-700 flex items-center justify-center font-bold text-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
              title="Restar 1 falta"
            >
              -
            </button>

            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                step="1"
                value={editingAbsenceCount}
                onChange={(e) => setEditingAbsenceCount(e.target.value)}
                placeholder="0"
                className={`w-full px-4 py-2.5 rounded-xl border text-lg font-bold text-center outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white focus:border-red-500'
                    : 'bg-white border-neutral-300 text-neutral-900 focus:border-red-500 shadow-inner'
                }`}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 dark:text-slate-500">
                {parseInt(editingAbsenceCount, 10) === 1 ? 'falta' : 'faltas'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                const currentVal = parseInt(editingAbsenceCount, 10) || 0;
                setEditingAbsenceCount(String(currentVal + 1));
              }}
              className="w-10 h-10 rounded-xl border border-neutral-300 dark:border-slate-700 flex items-center justify-center font-bold text-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
              title="Sumar 1 falta"
            >
              +
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[10px] text-neutral-500 dark:text-slate-400 mr-1 font-medium">Accesos rápidos:</span>
            {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setEditingAbsenceCount(String(num))}
                className={`h-6 min-w-6 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                  editingAbsenceCount === String(num)
                    ? 'bg-red-600 text-white border-red-600 scale-105'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 p-3 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50/70 dark:bg-slate-850">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-800 dark:text-slate-200 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-red-500" />
              <span>Día en que el alumno faltó:</span>
            </label>
            <span className="text-[10px] text-neutral-500 dark:text-slate-400">Podés elegir una fecha anterior</span>
          </div>
          <input
            type="date"
            value={editingAbsenceDate}
            onChange={(e) => {
              const val = e.target.value;
              setEditingAbsenceDate(val);
              if (val && editingAbsenceStudent && activeCourse) {
                const parts = val.split('-');
                if (parts.length === 3) {
                  const dmy = `${parts[2]}/${parts[1]}/${parts[0]}`;
                  const defaultAbsenceTpl =
                    savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
                    notifSettings.templateClassroom ||
                    defaultAbsencePresets[0]?.text ||
                    '';
                  const updatedMsg = formatTemplateForStudent(
                    defaultAbsenceTpl,
                    editingAbsenceStudent,
                    activeCourse.name,
                    getStudentMetrics(editingAbsenceStudent.id, editingAbsenceTerm).totalDisposition,
                    dmy
                  );
                  setEditingAbsenceMessageText(updatedMsg);
                }
              }
            }}
            className={`w-full px-3 py-2 rounded-xl border text-xs font-medium outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
            }`}
          />
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                const pad = (n: number) => n.toString().padStart(2, '0');
                setEditingAbsenceDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const pad = (n: number) => n.toString().padStart(2, '0');
                setEditingAbsenceDate(`${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`);
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
            >
              Ayer
            </button>
            <button
              type="button"
              onClick={() => {
                const lastWeek = new Date();
                lastWeek.setDate(lastWeek.getDate() - 7);
                const pad = (n: number) => n.toString().padStart(2, '0');
                setEditingAbsenceDate(`${lastWeek.getFullYear()}-${pad(lastWeek.getMonth() + 1)}-${pad(lastWeek.getDate())}`);
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-slate-700 text-neutral-600 dark:text-slate-400 hover:bg-neutral-200 dark:hover:bg-slate-750 cursor-pointer"
            >
              Hace 7 días
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
            Aclaración / Motivo (opcional):
          </label>
          <input
            type="text"
            value={editingAbsenceReason}
            onChange={(e) => setEditingAbsenceReason(e.target.value)}
            placeholder="Ej: Pasado de planilla en papel, clase recuperatoria, etc."
            className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-red-500 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
            }`}
          />
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {['Pasado de planilla en papel', 'Inasistencia justificada', 'Falta sin avisar', 'Ajuste de error'].map(
              (tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setEditingAbsenceReason(tag)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                    editingAbsenceReason === tag
                      ? 'bg-red-600 text-white border-red-600'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                      : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                  }`}
                >
                  + {tag}
                </button>
              )
            )}
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border transition-all space-y-3 ${
            editingAbsenceSendNotif
              ? isDarkMode
                ? 'bg-blue-950/30 border-blue-800/80'
                : 'bg-blue-50/70 border-blue-200'
              : isDarkMode
              ? 'bg-slate-800/40 border-slate-700'
              : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={editingAbsenceSendNotif}
              onChange={(e) => setEditingAbsenceSendNotif(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <div>
              <span className="text-xs font-bold text-neutral-900 dark:text-slate-100 block">
                Enviar mensaje/aviso al alumno sobre esta falta (Opcional)
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-slate-400 block">
                Desactivado por defecto. Solo marcalo si deseás notificar al estudiante por Classroom o Gmail.
              </span>
            </div>
          </label>

          {editingAbsenceSendNotif && (
            <div className="space-y-3 pt-2 border-t border-blue-200/60 dark:border-blue-900/40 animate-in fade-in duration-150">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditingAbsenceChannel('classroom')}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                    editingAbsenceChannel === 'classroom'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-white text-neutral-700 border-neutral-200'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Tablón Classroom</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditingAbsenceChannel('gmail')}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                    editingAbsenceChannel === 'gmail'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-white text-neutral-700 border-neutral-200'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Correo Gmail</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">Mensaje a enviar:</label>
                  <span className="text-[10px] text-neutral-400">Podés editar este texto antes de enviar</span>
                </div>
                <textarea
                  rows={3}
                  value={editingAbsenceMessageText}
                  onChange={(e) => setEditingAbsenceMessageText(e.target.value)}
                  placeholder="Escribe el mensaje..."
                  className={`w-full p-2.5 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                    isDarkMode
                      ? 'bg-slate-850 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
            </div>
          )}
        </div>

        {(() => {
          const currentIndex = filteredStudents.findIndex((s) => s.id === editingAbsenceStudent.id);
          const hasPrev = currentIndex > 0;
          const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

          return (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-neutral-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                <button
                  type="button"
                  disabled={!hasPrev || isSavingAbsenceEdit}
                  onClick={() => handleNavigateEditAbsenceStudent(-1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ir al alumno anterior"
                >
                  ← Anterior
                </button>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium">
                  {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!hasNext || isSavingAbsenceEdit}
                  onClick={() => handleNavigateEditAbsenceStudent(1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ir al alumno siguiente"
                >
                  Siguiente →
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  disabled={isSavingAbsenceEdit}
                  onClick={() => setEditingAbsenceStudent(null)}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                {hasNext && (
                  <button
                    type="button"
                    disabled={isSavingAbsenceEdit}
                    onClick={() => handleSaveStudentAbsences(true)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                    title="Guardar las faltas de este alumno y pasar al siguiente en la lista"
                  >
                    <span>Guardar y siguiente</span>
                    <span>→</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isSavingAbsenceEdit}
                  onClick={() => handleSaveStudentAbsences(false)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all"
                >
                  {isSavingAbsenceEdit ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{isSavingAbsenceEdit ? 'Guardando...' : 'Guardar faltas'}</span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});
