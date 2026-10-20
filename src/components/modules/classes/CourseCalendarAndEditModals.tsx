import React from 'react';
import { Calendar, XCircle, RefreshCw, Pencil } from 'lucide-react';
import { Course } from '../../../types';

interface CalendarSyncModalProps {
  isOpen: boolean;
  calendarModalCourse: Course | null;
  onClose: () => void;
  isDarkMode: boolean;
  handleSaveCalendarSelection: (e: React.FormEvent) => void;
  selectedCalendarForSlots: string;
  setSelectedCalendarForSlots: (val: string) => void;
  handleOpenCalendarSyncModal: (course: Course, calendarId?: string) => void;
  availableCalendarsForSlots: { id: string; summary: string; primary?: boolean }[];
  isLoadingSlots: boolean;
  calendarSlots: {
    id: string;
    title: string;
    dayOfWeek: number;
    dayName: string;
    startTime: string;
    endTime: string;
    displayText: string;
  }[];
  calendarScheduleSelection: string;
  setCalendarScheduleSelection: React.Dispatch<React.SetStateAction<string>>;
  syncToGoogleFromModal: boolean;
  setSyncToGoogleFromModal: (val: boolean) => void;
  isSavingCalendarSelection: boolean;
}

export const CalendarSyncModal: React.FC<CalendarSyncModalProps> = ({
  isOpen,
  calendarModalCourse,
  onClose,
  isDarkMode,
  handleSaveCalendarSelection,
  selectedCalendarForSlots,
  setSelectedCalendarForSlots,
  handleOpenCalendarSyncModal,
  availableCalendarsForSlots,
  isLoadingSlots,
  calendarSlots,
  calendarScheduleSelection,
  setCalendarScheduleSelection,
  syncToGoogleFromModal,
  setSyncToGoogleFromModal,
  isSavingCalendarSelection,
}) => {
  if (!isOpen || !calendarModalCourse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-5 border-b flex items-center justify-between ${
            isDarkMode ? 'border-slate-800' : 'border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Sincronizar con Google Calendar</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                {calendarModalCourse.name} • {calendarModalCourse.grade}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 rounded-lg"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSaveCalendarSelection} className="p-5 space-y-4">
          {/* Selector de Calendario */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1.5">
              Calendario de origen (por defecto el principal de tu cuenta de Classroom):
            </label>
            <div className="flex items-center gap-2">
              <select
                value={selectedCalendarForSlots}
                onChange={(e) => {
                  const nextCalId = e.target.value;
                  setSelectedCalendarForSlots(nextCalId);
                  handleOpenCalendarSyncModal(calendarModalCourse, nextCalId);
                }}
                className={`flex-1 px-3 py-2 text-xs rounded-xl border font-medium focus:outline-hidden ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-800'
                }`}
              >
                {availableCalendarsForSlots.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleOpenCalendarSyncModal(calendarModalCourse, selectedCalendarForSlots)}
                disabled={isLoadingSlots}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                }`}
                title="Actualizar módulos de este calendario"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSlots ? 'animate-spin' : ''}`} />
                <span>Recargar</span>
              </button>
            </div>
          </div>

          {/* Eventos detectados en Google Calendar */}
          <div
            className={`p-3.5 rounded-xl border ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-blue-50/50 border-blue-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-bold text-blue-900 dark:text-blue-300">
                  Módulos del calendario seleccionado
                </span>
              </div>
              {isLoadingSlots && (
                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Consultando eventos...
                </span>
              )}
            </div>

            {calendarSlots.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <p className="text-[11px] text-neutral-500 dark:text-slate-400 mb-1">
                  Hacé clic para tildar o destildar los módulos de esta materia:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {calendarSlots.map((slot) => {
                    const isSelected = calendarScheduleSelection.includes(slot.displayText);
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            const updated = calendarScheduleSelection
                              .split(',')
                              .map((s) => s.trim())
                              .filter((s) => s !== slot.displayText)
                              .join(', ');
                            setCalendarScheduleSelection(updated);
                          } else {
                            setCalendarScheduleSelection((prev) =>
                              prev ? `${prev}, ${slot.displayText}` : slot.displayText
                            );
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border text-left transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : isDarkMode
                            ? 'bg-slate-700/80 hover:bg-slate-700 text-slate-200 border-slate-600'
                            : 'bg-white hover:bg-neutral-100 text-neutral-800 border-neutral-200'
                        }`}
                      >
                        <span>{isSelected ? '✓' : '+'}</span>
                        <span className="font-bold">{slot.displayText}</span>
                        <span className="opacity-70 text-[10px] truncate max-w-[100px]">({slot.title})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {isLoadingSlots
                  ? 'Buscando eventos en tu calendario...'
                  : 'No se detectaron eventos con horario en esta semana. Podés elegir un atajo de abajo o escribirlo directamente.'}
              </p>
            )}
          </div>

          {/* Atajos de Módulos Escolares */}
          <div>
            <span className="block text-[11px] font-semibold text-neutral-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              O seleccionar atajo de módulo escolar
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                'Lunes 07:45 - 09:15',
                'Martes 08:00 - 09:30',
                'Miércoles 10:00 - 11:30',
                'Jueves 09:30 - 11:00',
                'Viernes 08:00 - 11:00',
                'Martes y Jueves 08:00 - 09:30',
                'Lunes y Miércoles 10:15 - 11:45',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    if (!calendarScheduleSelection) {
                      setCalendarScheduleSelection(preset);
                    } else if (!calendarScheduleSelection.includes(preset)) {
                      setCalendarScheduleSelection(`${calendarScheduleSelection}, ${preset}`);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-800 bg-slate-800/60 hover:bg-slate-700 text-slate-300'
                      : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                  }`}
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Campo con el horario seleccionado */}
          <div>
            <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
              Horario Seleccionado para la Materia
            </label>
            <input
              type="text"
              value={calendarScheduleSelection}
              onChange={(e) => setCalendarScheduleSelection(e.target.value)}
              placeholder="Ej: Martes 08:00 - 09:30, Jueves 10:00 - 11:30"
              className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
              }`}
            />
          </div>

          {/* Checkbox de sincronización bidireccional */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              isDarkMode
                ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="syncBidirectionalCheckbox"
                checked={syncToGoogleFromModal}
                onChange={(e) => setSyncToGoogleFromModal(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-emerald-300 cursor-pointer"
              />
              <label htmlFor="syncBidirectionalCheckbox" className="text-xs font-medium cursor-pointer">
                <span className="font-bold">Sincronización bidireccional:</span> Actualizar o crear automáticamente las clases semanales en Google Calendar.
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!calendarScheduleSelection.trim() || isSavingCalendarSelection}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
            >
              {isSavingCalendarSelection && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              <span>{isSavingCalendarSelection ? 'Guardando...' : 'Confirmar Horario'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export interface EditCourseFormData {
  id: string;
  name: string;
  subject: string;
  grade: string;
  room: string;
  division: string;
  schedule: string;
}

interface EditCourseDetailsModalProps {
  isOpen: boolean;
  editCourseData: EditCourseFormData | null;
  setEditCourseData: (data: EditCourseFormData | null) => void;
  onClose: () => void;
  isDarkMode: boolean;
  handleSaveCourseDetails: (e: React.FormEvent) => void;
  isSavingCourseDetails: boolean;
}

export const EditCourseDetailsModal: React.FC<EditCourseDetailsModalProps> = ({
  isOpen,
  editCourseData,
  setEditCourseData,
  onClose,
  isDarkMode,
  handleSaveCourseDetails,
  isSavingCourseDetails,
}) => {
  if (!isOpen || !editCourseData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-5 border-b flex items-center justify-between ${
            isDarkMode ? 'border-slate-800' : 'border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Editar Datos de la Materia</h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Modificá aula, división, asignatura y nombre
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 rounded-lg"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSaveCourseDetails} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                Nombre del Curso / Materia
              </label>
              <input
                type="text"
                value={editCourseData.name}
                onChange={(e) => setEditCourseData({ ...editCourseData, name: e.target.value })}
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                Asignatura / Especialidad
              </label>
              <input
                type="text"
                value={editCourseData.subject}
                onChange={(e) => setEditCourseData({ ...editCourseData, subject: e.target.value })}
                placeholder="Ej: Historia, Física..."
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                Curso / Año
              </label>
              <input
                type="text"
                value={editCourseData.grade}
                onChange={(e) => setEditCourseData({ ...editCourseData, grade: e.target.value })}
                placeholder="Ej: 3° Año, 5to Año..."
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                División / Comisión
              </label>
              <input
                type="text"
                value={editCourseData.division}
                onChange={(e) => setEditCourseData({ ...editCourseData, division: e.target.value })}
                placeholder="Ej: S2, B, Turno Mañana..."
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                Aula / Salón
              </label>
              <input
                type="text"
                value={editCourseData.room}
                onChange={(e) => setEditCourseData({ ...editCourseData, room: e.target.value })}
                placeholder="Ej: Aula 12, Lab 1..."
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                Horario de Cursada
              </label>
              <input
                type="text"
                value={editCourseData.schedule}
                onChange={(e) => setEditCourseData({ ...editCourseData, schedule: e.target.value })}
                placeholder="Ej: Martes 08:00 - 09:30"
                className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!editCourseData.name.trim() || isSavingCourseDetails}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
            >
              {isSavingCourseDetails && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              <span>{isSavingCourseDetails ? 'Guardando...' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
