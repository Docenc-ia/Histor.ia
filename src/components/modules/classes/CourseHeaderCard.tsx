import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Calendar,
  Pencil,
  Loader2,
  FolderClosed,
  FileText,
  ExternalLink,
  CloudCheck,
} from 'lucide-react';
import { Course } from '../../../types';

export interface CourseHeaderCardProps {
  activeCourse: Course;
  isDarkMode: boolean;
  userEmail?: string;
  isSettingUpDriveFolder: boolean;
  onOpenCalendarSyncModal: (course: Course) => void;
  onOpenEditCourseDetailsModal: (course: Course) => void;
  onOpenCourseDriveFolder: () => void;
  onOpenCourseReport: () => void;
}

export const CourseHeaderCard: React.FC<CourseHeaderCardProps> = React.memo(({
  activeCourse,
  isDarkMode,
  userEmail,
  isSettingUpDriveFolder,
  onOpenCalendarSyncModal,
  onOpenEditCourseDetailsModal,
  onOpenCourseDriveFolder,
  onOpenCourseReport,
}) => {
  const [queueSyncState, setQueueSyncState] = useState<{
    status: 'idle' | 'pending' | 'syncing' | 'synced' | 'error';
    lastSyncedAt?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    const handleQueueStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.courseId !== activeCourse.id) return;
      setQueueSyncState({
        status: detail.status,
        lastSyncedAt: detail.lastSyncedAt,
      });
    };
    window.addEventListener('fds-sheets-queue-status', handleQueueStatus);
    return () => window.removeEventListener('fds-sheets-queue-status', handleQueueStatus);
  }, [activeCourse.id]);

  return (
    <div
      className={`rounded-xl border p-5 shadow-xs flex flex-col gap-4 transition-colors ${
        isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
      }`}
    >
      {/* Información del aula (nombre de la materia, división, horario, etc.) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold uppercase tracking-wider ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              {activeCourse.grade} • {activeCourse.room}
            </span>
            {activeCourse.classroomSynced && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  isDarkMode
                    ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                }`}
              >
                <Check className="w-3 h-3" /> Conectado con Classroom
              </span>
            )}
            {(queueSyncState.status === 'pending' || queueSyncState.status === 'syncing') && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  isDarkMode
                    ? 'text-blue-300 bg-blue-950/60 border-blue-800/60'
                    : 'text-blue-700 bg-blue-50 border-blue-200'
                }`}
              >
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Guardando en Sheets...
              </span>
            )}
            {queueSyncState.status === 'synced' && queueSyncState.lastSyncedAt && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  isDarkMode
                    ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800/50'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                }`}
              >
                <CloudCheck className="w-3 h-3" /> Sheets al día ({queueSyncState.lastSyncedAt})
              </span>
            )}
          </div>

          {/* Nombre de la materia */}
          <div>
            <h3
              className={`text-xl sm:text-2xl font-bold tracking-tight ${
                isDarkMode ? 'text-white' : 'text-neutral-900'
              }`}
            >
              {activeCourse.name}
            </h3>
            <p className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
              {activeCourse.subject}
            </p>
          </div>
        </div>

        {/* Horario con sincronización desde Google Calendar, Edición, y debajo Carpeta de Drive y Hacer Informe */}
        <div className="flex flex-col md:items-end gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Horario:
              </span>
              {activeCourse.schedule &&
              activeCourse.schedule !== 'Lunes y Miércoles' &&
              !activeCourse.schedule.toLowerCase().includes('coordinar') ? (
                <span
                  className={`font-semibold px-2 py-0.5 rounded-md ${
                    isDarkMode
                      ? 'bg-slate-800 text-blue-300 border border-slate-700'
                      : 'bg-blue-50 text-blue-800 border border-blue-200'
                  }`}
                >
                  {activeCourse.schedule}
                </span>
              ) : (
                <span
                  className={`font-medium italic px-2 py-0.5 rounded-md ${
                    isDarkMode
                      ? 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                  title="Horario pendiente de sincronizar con Google Calendar"
                >
                  Pendiente de sincronizar con Calendar
                </span>
              )}
            </div>

            {/* Botón para sincronizar desde Google Calendar */}
            <button
              type="button"
              onClick={() => onOpenCalendarSyncModal(activeCourse)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border-blue-800/70'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
              }`}
              title="Ver eventos y seleccionar módulos de tu Google Calendar"
            >
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span>Sincronizar con Calendar</span>
            </button>

            {/* Botón para editar datos específicos del curso */}
            <button
              type="button"
              onClick={() => onOpenEditCourseDetailsModal(activeCourse)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
              title="Editar aula, división, nombre y detalles específicos de la materia"
            >
              <Pencil className="w-3 h-3" />
              <span>Editar datos</span>
            </button>
          </div>

          {/* Debajo de Horario y Sincronizar con Calendar: Carpeta de Drive y Hacer Informe */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenCourseDriveFolder}
              disabled={isSettingUpDriveFolder}
              className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border-amber-800/60'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200 shadow-2xs'
              }`}
              title={`Crear y abrir carpeta en Google Drive ("${activeCourse.name}") con los documentos de Asistencia y Disposición, Libro de Temas, Calificaciones y la subcarpeta Informes`}
            >
              {isSettingUpDriveFolder ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : (
                <FolderClosed className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span>{isSettingUpDriveFolder ? 'Preparando Drive...' : 'Carpeta de Drive'}</span>
            </button>

            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenCourseReport}
                className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-purple-950/40 hover:bg-purple-950/60 text-purple-300 border-purple-800/60'
                    : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200 shadow-2xs'
                }`}
                title={`Generar informe oficial del curso "${activeCourse.name}" o constancias individuales de 1 página por alumno para guardar en la subcarpeta Informes de Drive o imprimir`}
              >
                <FileText className="w-3.5 h-3.5 text-purple-500" />
                <span>Hacer Informe</span>
              </button>
              <a
                href={`?course=${activeCourse.id}&view=course_detail&openReport=true${
                  userEmail ? `&authEmail=${encodeURIComponent(userEmail)}` : ''
                }`}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                  isDarkMode
                    ? 'bg-purple-950/40 hover:bg-purple-950/60 text-purple-300 border-purple-800/60'
                    : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200 shadow-2xs'
                }`}
                title="Abrir Hacer Informe en otra pestaña o ventana"
              >
                <ExternalLink className="w-3.5 h-3.5 text-purple-500" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
