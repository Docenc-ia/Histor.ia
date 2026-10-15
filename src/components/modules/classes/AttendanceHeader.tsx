import React from 'react';
import {
  Search,
  UserPlus,
  Send,
  Bell,
  Award,
  Bookmark,
  RefreshCw,
  FileSpreadsheet,
  Calendar,
  Loader2,
  Sliders,
  Clock,
  Database,
} from 'lucide-react';

import { CourseAttendanceSummary } from '../../../utils/attendanceCalculations';

interface AttendanceHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedStudentCount: number;
  onOpenBatchSelected: () => void;
  pendingCount: number;
  onOpenBatchPending: () => void;
  onOpenAddStudentModal: () => void;
  onOpenSendDispositionModal: () => void;
  onOpenNotifConfigModal: () => void;
  isSyncingSheet: boolean;
  isPullingFromSheet?: boolean;
  lastSyncedAt?: string;
  onManualSheetsSync: () => void;
  isOpeningSheet: boolean;
  onOpenGoogleSheet: () => void;
  attendanceTerm: '1c' | '2c' | 'annual';
  onSelectTerm: (term: '1c' | '2c' | 'annual') => void;
  attendanceSummary?: CourseAttendanceSummary;
  onOpenAttendanceSettings?: () => void;
  onOpenBackupModal?: () => void;
  isDarkMode: boolean;
}

export const AttendanceHeader: React.FC<AttendanceHeaderProps> = ({
  searchQuery,
  onSearchChange,
  selectedStudentCount,
  onOpenBatchSelected,
  pendingCount,
  onOpenBatchPending,
  onOpenAddStudentModal,
  onOpenSendDispositionModal,
  onOpenNotifConfigModal,
  isSyncingSheet,
  isPullingFromSheet = false,
  lastSyncedAt,
  onManualSheetsSync,
  isOpeningSheet,
  onOpenGoogleSheet,
  attendanceTerm,
  onSelectTerm,
  attendanceSummary,
  onOpenAttendanceSettings,
  onOpenBackupModal,
  isDarkMode,
}) => {
  const isSyncActive = isSyncingSheet || isPullingFromSheet;

  return (
    <div className="space-y-3">
      {/* Search & Actions Bar */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        {/* Search box */}
        <div className="relative flex items-center">
          <Search className={`absolute left-3 w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
          <input
            type="text"
            placeholder="Buscar estudiante..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={`pl-8 pr-3 py-1.5 text-xs rounded-lg focus:outline-none w-44 sm:w-56 transition-colors border ${
              isDarkMode
                ? 'bg-slate-800 text-white placeholder-slate-500 border-slate-700 focus:border-blue-500'
                : 'bg-white text-neutral-900 placeholder-neutral-400 border-neutral-200 focus:ring-1 focus:ring-blue-500'
            }`}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Student manually */}
          <button
            type="button"
            onClick={onOpenAddStudentModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
            title="Agregar un nuevo alumno manualmente con su correo para pasar faltas y mandarle mensajes"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Agregar Alumno</span>
          </button>

          {/* Batch send for selected students */}
          {selectedStudentCount > 0 && (
            <button
              type="button"
              onClick={onOpenBatchSelected}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
              title="Enviar aviso de inasistencia a todos los estudiantes seleccionados"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Avisar a seleccionados ({selectedStudentCount})</span>
            </button>
          )}

          {/* Batch send for pending notifications */}
          {selectedStudentCount === 0 && pendingCount > 0 && (
            <button
              type="button"
              onClick={onOpenBatchPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
              title="Enviar avisos pendientes a todos los estudiantes (ausencias y conductas)"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Avisos pendientes ({pendingCount})</span>
            </button>
          )}

          {/* Send Disposition to Grades */}
          <button
            type="button"
            onClick={onOpenSendDispositionModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl shadow-xs border border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white transition-all cursor-pointer"
            title={`Mandar notas de disposición a Calificaciones (${attendanceTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
          >
            <Award className="w-3.5 h-3.5 text-amber-300" />
            <span>Mandar a Calificaciones</span>
          </button>

          {/* Preset Messages */}
          <button
            type="button"
            onClick={onOpenNotifConfigModal}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 text-blue-400 hover:text-blue-300 hover:bg-slate-800'
                : 'border-blue-200 text-blue-700 hover:text-blue-800 hover:bg-blue-50'
            }`}
            title="Configurar mensajes preestablecidos y opciones de Classroom / Gmail"
          >
            <Bookmark className="w-3.5 h-3.5 text-blue-500" />
            <span>Mensajes Preestablecidos</span>
          </button>

          {/* Bidirectional Sheets Sync */}
          <button
            type="button"
            onClick={onManualSheetsSync}
            disabled={isSyncActive}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
              isDarkMode
                ? 'bg-blue-950/60 hover:bg-blue-900/70 text-blue-300 border-blue-800'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
            }`}
            title="Sincronizar con Sheets: Doble entrada bidireccional. Si modificaste ausencias, tardanzas o notas en el Google Sheet, las trae a la app y actualiza la planilla en Google Drive"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isSyncActive ? 'animate-spin' : ''}`} />
            <span>{isSyncActive ? 'Sincronizando...' : 'Sincronizar con Sheets'}</span>
            {lastSyncedAt && !isSyncActive && (
              <span className="hidden xl:inline text-[10px] opacity-75">({lastSyncedAt})</span>
            )}
          </button>

          {/* Open Google Sheet button */}
          <button
            type="button"
            onClick={onOpenGoogleSheet}
            disabled={isOpeningSheet}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
            }`}
            title="Abrir la planilla vinculada en Google Sheets"
          >
            {isOpeningSheet ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span>Abrir en Sheets</span>
          </button>

          {/* Backup & Restore button */}
          {onOpenBackupModal && (
            <button
              type="button"
              onClick={onOpenBackupModal}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-900/60 hover:border-indigo-700'
                  : 'bg-white hover:bg-indigo-50/60 text-indigo-700 border-indigo-200'
              }`}
              title="Copia de seguridad local: Descargar respaldo JSON o restaurar observaciones y ajustes del curso"
            >
              <Database className="w-3.5 h-3.5 text-indigo-500" />
              <span>Copia de Seguridad</span>
            </button>
          )}
        </div>
      </div>

      {/* Academic Term Switcher */}
      <div
        className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-lg ${
              attendanceTerm === '1c'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : attendanceTerm === '2c'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
            }`}
          >
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold text-xs ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Período de Asistencia y Disposición:
              </span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  attendanceTerm === '1c'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                    : attendanceTerm === '2c'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                }`}
              >
                {attendanceTerm === '1c'
                  ? '📘 1° Cuatrimestre Activo'
                  : attendanceTerm === '2c'
                  ? '📗 2° Cuatrimestre Activo'
                  : '🎓 Resumen Anual Consolidado'}
              </span>
            </div>
          </div>
        </div>

        {/* Segmented term selector buttons */}
        <div
          className={`p-1 rounded-xl border flex items-center gap-1 shadow-2xs ${
            isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-100 border-neutral-200'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectTerm('1c')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              attendanceTerm === '1c'
                ? 'bg-blue-600 text-white shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${attendanceTerm === '1c' ? 'bg-white' : 'bg-blue-400'}`} />
            <span>1° Cuatrimestre</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTerm('2c')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              attendanceTerm === '2c'
                ? 'bg-emerald-600 text-white shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${attendanceTerm === '2c' ? 'bg-white' : 'bg-emerald-400'}`} />
            <span>2° Cuatrimestre</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTerm('annual')}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              attendanceTerm === 'annual'
                ? 'bg-purple-600 text-white shadow-xs'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${attendanceTerm === 'annual' ? 'bg-white' : 'bg-purple-400'}`} />
            <span>Resumen Anual</span>
          </button>
        </div>
      </div>

      {/* Semáforo and Calendar Weeks Summary Bar */}
      {attendanceSummary && (
        <div
          className={`px-3.5 py-2.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs transition-colors ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-neutral-50/90 border-neutral-200'
          }`}
        >
          {/* Calendar weeks and total classes details */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-slate-300">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span>
                <strong>{attendanceSummary.weeksCount} semanas</strong> ({attendanceSummary.classesPerWeek} clases/sem.
                {attendanceSummary.holidaysCount > 0 ? ` • -${attendanceSummary.holidaysCount} feriados` : ''} •{' '}
                <strong>{attendanceSummary.totalClasses} clases reales</strong>)
              </span>
            </div>
            <span className="text-neutral-400">•</span>
            <span className="text-neutral-500 dark:text-slate-400 text-[11px]">
              Límite regularidad: <strong>{attendanceSummary.maxAllowedAbsences} faltas máx.</strong>
            </span>
          </div>

          {/* Traffic light counts and configuration button */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                title={`${attendanceSummary.regularCount} alumnos con asistencia regular (>= 85%)`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>{attendanceSummary.regularCount} Regulares</span>
              </span>

              {attendanceSummary.warningCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  title={`${attendanceSummary.warningCount} alumnos en precaución (75%-84% o a <=2 faltas del límite)`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>{attendanceSummary.warningCount} Precaución</span>
                </span>
              )}

              {attendanceSummary.alertCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 animate-pulse"
                  title={`${attendanceSummary.alertCount} alumnos en riesgo de perder regularidad (< 75% o superaron límite)`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span>{attendanceSummary.alertCount} Riesgo</span>
                </span>
              )}
            </div>

            {onOpenAttendanceSettings && (
              <button
                type="button"
                onClick={onOpenAttendanceSettings}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                }`}
                title="Configurar semanas del cuatrimestre, horario del calendario y parámetros del semáforo"
              >
                <Sliders className="w-3 h-3 text-blue-500" />
                <span>Configurar Semáforo</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
