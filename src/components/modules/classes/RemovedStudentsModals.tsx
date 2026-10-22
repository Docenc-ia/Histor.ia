import React from 'react';
import { Trash2, Users, X, RotateCcw } from 'lucide-react';
import { Course, Student } from '../../../types';
import { api, getRemovedStudentIds, getRemovedStudentsList } from '../../../services/api';

interface RemovedStudentsModalsProps {
  activeCourse: Course | undefined;
  isDarkMode: boolean;
  studentToRemove: Student | null;
  setStudentToRemove: (student: Student | null) => void;
  isRemovedStudentsModalOpen: boolean;
  setIsRemovedStudentsModalOpen: (open: boolean) => void;
  removedStudentsList: Student[];
  setRemovedStudentIds: (ids: Set<string>) => void;
  setRemovedStudentsList: (list: Student[]) => void;
  setToastMessage: (msg: string | null) => void;
  onRefreshData?: () => void;
}

export const RemovedStudentsModals: React.FC<RemovedStudentsModalsProps> = ({
  activeCourse,
  isDarkMode,
  studentToRemove,
  setStudentToRemove,
  isRemovedStudentsModalOpen,
  setIsRemovedStudentsModalOpen,
  removedStudentsList,
  setRemovedStudentIds,
  setRemovedStudentsList,
  setToastMessage,
  onRefreshData,
}) => {
  if (!activeCourse) return null;

  return (
    <>
      {/* ------------------------------------------------------------- */}
      {/* MODAL: CONFIRMACIÓN PARA QUITAR ALUMNO/A DE LA MATERIA (APP) */}
      {/* ------------------------------------------------------------- */}
      {studentToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold">¿Quitar alumno/a de la materia en la app?</h3>
                <p className="text-xs text-neutral-500 dark:text-slate-400 mt-1">
                  Materia: <span className="font-semibold text-neutral-800 dark:text-slate-200">{activeCourse.name}</span>
                </p>
              </div>
            </div>

            <div className={`p-3 rounded-xl border flex items-center gap-3 ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-neutral-50 border-neutral-200'}`}>
              <img
                src={studentToRemove.avatar}
                alt={studentToRemove.firstName}
                className="w-10 h-10 rounded-full object-cover border"
              />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm text-neutral-900 dark:text-white truncate">
                  {studentToRemove.lastName}, {studentToRemove.firstName}
                </p>
                <p className="text-xs text-neutral-500 dark:text-slate-400 truncate">
                  {studentToRemove.email || 'Sin correo registrado'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-1">
                <span>📌 Pareja pedagógica / Filtro de visor</span>
              </p>
              <p>
                El alumno ya no figurará en tus listas de <strong>Asistencia</strong> ni <strong>Calificaciones</strong> en esta aplicación.
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 italic">
                ✓ No se eliminará de Google Classroom ni afectará a otros docentes.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setStudentToRemove(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={async () => {
                  const st = studentToRemove;
                  setStudentToRemove(null);
                  try {
                    await api.removeStudentFromCourse(st, activeCourse.id);
                    setRemovedStudentIds(getRemovedStudentIds(activeCourse.id));
                    setRemovedStudentsList(getRemovedStudentsList(activeCourse.id));
                    setToastMessage(`El alumno ${st.lastName}, ${st.firstName} fue quitado de la lista en esta app.`);
                    setTimeout(() => setToastMessage(null), 3500);
                    if (onRefreshData) onRefreshData();
                  } catch (err) {
                    console.error('Error removing student:', err);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Quitar de la app</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: RESTAURAR ALUMNOS QUITADOS EN ESTA MATERIA             */}
      {/* ------------------------------------------------------------- */}
      {isRemovedStudentsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-neutral-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <Users className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="text-sm font-bold">Alumnos quitados del visor</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    {activeCourse.name} ({removedStudentsList.length})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRemovedStudentsModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {removedStudentsList.length === 0 ? (
                <p className="text-xs text-center py-6 text-neutral-500 dark:text-slate-400">
                  No hay alumnos ocultos en esta materia.
                </p>
              ) : (
                removedStudentsList.map((st) => (
                  <div
                    key={st.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate">
                        {st.lastName}, {st.firstName}
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-slate-400 truncate">
                        {st.email || 'Sin correo'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.restoreStudentInCourse(st, activeCourse.id);
                        const nextList = getRemovedStudentsList(activeCourse.id);
                        setRemovedStudentIds(getRemovedStudentIds(activeCourse.id));
                        setRemovedStudentsList(nextList);
                        setToastMessage(`${st.lastName}, ${st.firstName} fue reincorporado a ${activeCourse.name}.`);
                        setTimeout(() => setToastMessage(null), 3500);
                        if (onRefreshData) onRefreshData();
                        if (nextList.length === 0) setIsRemovedStudentsModalOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restaurar</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-neutral-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsRemovedStudentsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
