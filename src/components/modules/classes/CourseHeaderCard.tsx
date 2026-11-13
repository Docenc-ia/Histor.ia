import React, { useEffect, useState } from 'react';
import {
  Clock,
  Calendar,
  Pencil,
  Loader2,
  FolderClosed,
  FileText,
  ExternalLink,
  CloudCheck,
  RefreshCw,
} from 'lucide-react';
import { Course } from '../../../types';
import { getEffectiveScheduleStringForCourse } from '../../../utils/courseFormatting';
import { api } from '../../../services/api';
import {
  formatCourseDriveFolderName,
  getDirectDriveFolderUrl,
  isRealDriveFolderId,
} from '../../../services/workspace/driveService';

export interface CourseHeaderCardProps {
  activeCourse: Course;
  isDarkMode: boolean;
  userEmail?: string;
  isSettingUpDriveFolder: boolean;
  onOpenCalendarSyncModal: (course: Course) => void;
  onOpenEditCourseDetailsModal: (course: Course) => void;
  onOpenCourseDriveFolder: () => void;
  onOpenCourseReport: () => void;
  onSyncRoster?: () => void;
  isSyncingRoster?: boolean;
}

export const CourseHeaderCard: React.FC<CourseHeaderCardProps> = React.memo(({
  activeCourse,
  isDarkMode,
  isSettingUpDriveFolder,
  onOpenCalendarSyncModal,
  onOpenEditCourseDetailsModal,
  onOpenCourseDriveFolder,
  onOpenCourseReport,
  onSyncRoster,
  isSyncingRoster = false,
}) => {
  const effectiveSchedule = getEffectiveScheduleStringForCourse(activeCourse);

  useEffect(() => {
    if (effectiveSchedule && effectiveSchedule !== (activeCourse.schedule || '').trim()) {
      api.updateCourse(activeCourse.id, { schedule: effectiveSchedule }).catch(() => {});
    }
  }, [activeCourse.id, activeCourse.schedule, effectiveSchedule]);

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

  const courseWithSchedule =
    effectiveSchedule && effectiveSchedule !== activeCourse.schedule
      ? { ...activeCourse, schedule: effectiveSchedule }
      : activeCourse;

  return (
    <div
      className={`rounded-xl border p-5 shadow-xs flex flex-col gap-4 transition-colors ${
        isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Izquierda: Nombre de la materia (clickeable para editar datos) y Horario debajo */}
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onOpenEditCourseDetailsModal(courseWithSchedule)}
              className={`group inline-flex items-center gap-2 text-left text-xl sm:text-2xl font-bold tracking-tight transition-colors cursor-pointer ${
                isDarkMode
                  ? 'text-white hover:text-blue-400'
                  : 'text-neutral-900 hover:text-blue-600'
              }`}
              title="Hacé clic sobre el nombre de la materia para editar sus datos"
            >
              <span>{activeCourse.name}</span>
              <Pencil className="w-4 h-4 opacity-0 group-hover:opacity-70 transition-opacity shrink-0 text-blue-500" />
            </button>

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

          {/* Horario abajo de la materia; Sincronizar con Calendar solo si no está puesto el horario */}
          <div className="flex flex-wrap items-center gap-2">
            {effectiveSchedule ? (
              <button
                type="button"
                onClick={() => onOpenCalendarSyncModal(courseWithSchedule)}
                className="inline-flex items-center gap-1.5 text-xs group cursor-pointer"
                title="Hacé clic si querés modificar o volver a sincronizar el horario con Google Calendar"
              >
                <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Horario:
                </span>
                <span
                  className={`font-semibold px-2 py-0.5 rounded-md transition-colors ${
                    isDarkMode
                      ? 'bg-slate-800 text-blue-300 border border-slate-700 group-hover:border-blue-600'
                      : 'bg-blue-50 text-blue-800 border border-blue-200 group-hover:border-blue-400'
                  }`}
                >
                  {effectiveSchedule}
                </span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className={`font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Sin horario asignado
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenCalendarSyncModal(courseWithSchedule)}
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
              </div>
            )}
          </div>
        </div>

        {/* Derecha: Sincronizar alumnos, Carpeta de la Materia y Hacer Informe */}
        <div className="flex flex-wrap items-center md:justify-end gap-2">
          {onSyncRoster && (
            <button
              type="button"
              onClick={onSyncRoster}
              disabled={isSyncingRoster}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 shadow-2xs'
              }`}
              title={`Sincronizar alumnos o elegir selectivamente qué estudiantes importar a "${activeCourse.name}"`}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-500 ${isSyncingRoster ? 'animate-spin' : ''}`} />
              <span>{isSyncingRoster ? 'Cargando alumnos...' : 'Sincronizar alumnos'}</span>
            </button>
          )}

          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenCourseDriveFolder}
              disabled={isSettingUpDriveFolder}
              className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border-amber-800/60'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200 shadow-2xs'
              }`}
              title={`Abrir o crear la carpeta "${formatCourseDriveFolderName(activeCourse.name)}" en tu Google Drive con las 6 subcarpetas (Calificaciones, Asistencia, Disposición, Libro de Temas, Informes e Historial de Incidencias)`}
            >
              {isSettingUpDriveFolder ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : (
                <FolderClosed className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span>{isSettingUpDriveFolder ? 'Preparando carpeta...' : 'Carpeta de la Materia'}</span>
            </button>
            {isRealDriveFolderId(activeCourse.driveFolderId) && (
              <a
                href={getDirectDriveFolderUrl(activeCourse.driveFolderId, activeCourse.driveFolderUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                  isDarkMode
                    ? 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border-amber-800/60'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200 shadow-2xs'
                }`}
                title={`Ir directamente a la carpeta "${formatCourseDriveFolderName(activeCourse.name)}" en Google Drive`}
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
              </a>
            )}
          </div>

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
        </div>
      </div>
    </div>
  );
});

