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
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Course } from '../../../types';
import { getEffectiveScheduleStringForCourse } from '../../../utils/courseFormatting';
import { api } from '../../../services/api';
import {
  useTerminologySettings,
  DISPOSITION_LABEL_PRESETS,
  ATTENDANCE_LABEL_PRESETS,
  PERIOD_NAME_PRESETS,
  INITIAL_DISPOSITION_SCORE_PRESETS,
} from '../../../utils/terminologySettings';
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
  userEmail,
  isSettingUpDriveFolder,
  onOpenCalendarSyncModal,
  onOpenEditCourseDetailsModal,
  onOpenCourseDriveFolder,
  onOpenCourseReport,
  onSyncRoster,
  isSyncingRoster = false,
}) => {
  const effectiveSchedule = getEffectiveScheduleStringForCourse(activeCourse);
  const [isTerminologyPanelOpen, setIsTerminologyPanelOpen] = useState(false);

  const {
    attendanceLabel,
    dispositionLabel,
    periodNameSingular,
    initialDispositionScore,
    updateTerminology,
    resetTerminology,
  } = useTerminologySettings();

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

  const isCustomized =
    attendanceLabel !== 'Asistencia' ||
    dispositionLabel !== 'Disposición' ||
    periodNameSingular !== 'Cuatrimestre' ||
    initialDispositionScore !== 10;

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

        {/* Horario con sincronización desde Google Calendar, Edición, y debajo Carpeta de Drive, Nombres/Escala y Hacer Informe */}
        <div className="flex flex-col md:items-end gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Horario:
              </span>
              {effectiveSchedule ? (
                <span
                  className={`font-semibold px-2 py-0.5 rounded-md ${
                    isDarkMode
                      ? 'bg-slate-800 text-blue-300 border border-slate-700'
                      : 'bg-blue-50 text-blue-800 border border-blue-200'
                  }`}
                >
                  {effectiveSchedule}
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
              onClick={() =>
                onOpenCalendarSyncModal(
                  effectiveSchedule && effectiveSchedule !== activeCourse.schedule
                    ? { ...activeCourse, schedule: effectiveSchedule }
                    : activeCourse
                )
              }
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

            {/* Botón para personalizar Nombres (Asistencia / Disposición / Concepto), Escala inicial y Período */}
            <button
              type="button"
              onClick={() => setIsTerminologyPanelOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                isTerminologyPanelOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : isCustomized
                  ? isDarkMode
                    ? 'bg-indigo-950/60 hover:bg-indigo-900/70 text-indigo-300 border-indigo-800/70'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200'
                  : isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
              title="Personalizar nombres de Asistencia y Disposición (ej. Concepto, Participación), puntaje inicial y nombre del período (Cuatrimestre, Etapa, Trimestre)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>
                Nombres y Escala ({attendanceLabel} / {dispositionLabel})
              </span>
            </button>

            {/* Botón para editar datos específicos del curso */}
            <button
              type="button"
              onClick={() =>
                onOpenEditCourseDetailsModal(
                  effectiveSchedule && effectiveSchedule !== activeCourse.schedule
                    ? { ...activeCourse, schedule: effectiveSchedule }
                    : activeCourse
                )
              }
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

          {/* Debajo de Horario y Sincronizar con Calendar: Sincronizar Alumnos, Carpeta de Drive y Hacer Informe */}
          <div className="flex flex-wrap items-center gap-2">
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
                title={`Sincronización Selectiva de Estudiantes: elegir qué alumnos de Google Classroom importar exclusivamente a "${activeCourse.name}"`}
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-500 ${isSyncingRoster ? 'animate-spin' : ''}`} />
                <span>{isSyncingRoster ? 'Cargando alumnos...' : 'Sincronización Selectiva de Alumnos'}</span>
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
                <span>{isSettingUpDriveFolder ? 'Preparando Drive...' : 'Carpeta de Drive'}</span>
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

      {/* Panel desplegable de Nombres, Escala Inicial y Período directamente debajo del encabezado de la materia */}
      {isTerminologyPanelOpen && (
        <div
          className={`pt-4 border-t animate-in fade-in duration-150 ${
            isDarkMode ? 'border-slate-800' : 'border-neutral-200'
          }`}
        >
          <div
            className={`p-4 rounded-xl border space-y-3.5 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-indigo-50/40 border-indigo-200/80'
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  Configuración de Nombres, Escala Inicial y Períodos Lectivos
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  (Se guarda automáticamente en la nube para tu cuenta docente)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isCustomized && (
                  <button
                    type="button"
                    onClick={resetTerminology}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Restaurar originales
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsTerminologyPanelOpen(false)}
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${
                    isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60'
                  }`}
                  title="Cerrar panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. Nombre de Disposición / Concepto */}
              <div
                className={`p-3 rounded-xl border space-y-2 ${
                  isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200'
                }`}
              >
                <label className="text-[11px] font-bold text-neutral-700 dark:text-slate-200 block">
                  1. Nombre de la nota de Disposición / Concepto:
                </label>
                <input
                  type="text"
                  value={dispositionLabel}
                  onChange={(e) => updateTerminology({ dispositionLabel: e.target.value })}
                  placeholder="Ej: Disposición, Concepto, Participación en clase..."
                  className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-neutral-500 dark:text-slate-400 mr-0.5">Opciones rápidas:</span>
                  {DISPOSITION_LABEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateTerminology({ dispositionLabel: preset })}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                        dispositionLabel === preset
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Nombre de Asistencia */}
              <div
                className={`p-3 rounded-xl border space-y-2 ${
                  isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200'
                }`}
              >
                <label className="text-[11px] font-bold text-neutral-700 dark:text-slate-200 block">
                  2. Nombre de la columna de Asistencia:
                </label>
                <input
                  type="text"
                  value={attendanceLabel}
                  onChange={(e) => updateTerminology({ attendanceLabel: e.target.value })}
                  placeholder="Ej: Asistencia, Presentismo..."
                  className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-neutral-500 dark:text-slate-400 mr-0.5">Opciones rápidas:</span>
                  {ATTENDANCE_LABEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateTerminology({ attendanceLabel: preset })}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                        attendanceLabel === preset
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Nota inicial por defecto */}
              <div
                className={`p-3 rounded-xl border space-y-2 ${
                  isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200'
                }`}
              >
                <label className="text-[11px] font-bold text-neutral-700 dark:text-slate-200 block">
                  3. Puntaje inicial de {dispositionLabel} al empezar el período:
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {INITIAL_DISPOSITION_SCORE_PRESETS.map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => updateTerminology({ initialDispositionScore: score })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        initialDispositionScore === score
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {score} / 10
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                  {initialDispositionScore === 10
                    ? 'Los alumnos arrancan en 10 puntos y van restando ante faltas.'
                    : `Los alumnos arrancan en ${initialDispositionScore} puntos y pueden sumar puntos positivos hasta llegar a 10.`}
                </p>
              </div>

              {/* 4. División de períodos */}
              <div
                className={`p-3 rounded-xl border space-y-2 ${
                  isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200'
                }`}
              >
                <label className="text-[11px] font-bold text-neutral-700 dark:text-slate-200 block">
                  4. Nombre de cada período lectivo en tu colegio:
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PERIOD_NAME_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateTerminology({ periodNameSingular: preset })}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                        periodNameSingular === preset
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      1° y 2° {preset}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                  Se aplica en botones de período, informes PDF/Docs y planillas Excel/Sheets.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

