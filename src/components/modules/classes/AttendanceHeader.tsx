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
      {/* Search & Actions Bar Organizado en 4 Columnas */}
      <div
        className={`p-3.5 rounded-xl border transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* COLUMNA 1: Buscar estudiante y Agregar Alumno */}
          <div className="flex flex-col gap-2 justify-center">
            <div className="relative flex items-center w-full">
              <Search className={`absolute left-3 w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
              <input
                type="text"
                placeholder="Buscar estudiante..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg focus:outline-none transition-colors border ${
                  isDarkMode
                    ? 'bg-slate-800 text-white placeholder-slate-500 border-slate-700 focus:border-blue-500'
                    : 'bg-white text-neutral-900 placeholder-neutral-400 border-neutral-200 focus:ring-1 focus:ring-blue-500'
                }`}
              />
            </div>

            <button
              type="button"
              onClick={onOpenAddStudentModal}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
              title="Agregar un nuevo alumno manualmente con su correo para pasar faltas y mandarle mensajes"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Agregar Alumno</span>
            </button>
          </div>

          {/* COLUMNA 2: Mensajes Preestablecidos y Avisos Pendientes / Seleccionados */}
          <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 sm:border-l border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0 sm:pl-3">
            <button
              type="button"
              onClick={onOpenNotifConfigModal}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-blue-400 hover:text-blue-300 hover:bg-slate-800'
                  : 'border-blue-200 text-blue-700 hover:text-blue-800 hover:bg-blue-50'
              }`}
              title="Configurar mensajes preestablecidos y opciones de Classroom / Gmail"
            >
              <Bookmark className="w-3.5 h-3.5 text-blue-500" />
              <span>Mensajes Preestablecidos</span>
            </button>

            {selectedStudentCount > 0 ? (
              <button
                type="button"
                onClick={onOpenBatchSelected}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
                title="Enviar aviso de inasistencia a todos los estudiantes seleccionados"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Avisar a seleccionados ({selectedStudentCount})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenBatchPending}
                disabled={pendingCount === 0}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  pendingCount > 0
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    : 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
                }`}
                title="Enviar avisos pendientes a todos los estudiantes (ausencias y conductas)"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Avisos pendientes ({pendingCount})</span>
              </button>
            )}
          </div>

          {/* COLUMNA 3: Mandar a Calificaciones y Sincronizar con Sheets */}
          <div className="flex flex-col gap-2 justify-center border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-slate-800 pt-2 lg:pt-0 lg:pl-3">
            <button
              type="button"
              onClick={onOpenSendDispositionModal}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg shadow-xs border border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white transition-all cursor-pointer"
              title={`Mandar notas de disposición a Calificaciones (${attendanceTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
            >
              <Award className="w-3.5 h-3.5 text-amber-300" />
              <span>Mandar a Calificaciones</span>
            </button>

            <button
              type="button"
              onClick={onManualSheetsSync}
              disabled={isSyncActive}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-xs ${
                isDarkMode
                  ? 'bg-blue-950/60 hover:bg-blue-900/70 text-blue-300 border-blue-800'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
              }`}
              title="Sincronizar con Sheets: Doble entrada bidireccional."
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isSyncActive ? 'animate-spin' : ''}`} />
              <span>{isSyncActive ? 'Sincronizando...' : 'Sincronizar con Sheets'}</span>
            </button>
          </div>

          {/* COLUMNA 4: Abrir en Sheets y Copia de Seguridad */}
          <div className="flex flex-col gap-2 justify-center border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-slate-800 pt-2 lg:pt-0 lg:pl-3">
            <button
              type="button"
              onClick={onOpenGoogleSheet}
              disabled={isOpeningSheet}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
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

            {onOpenBackupModal && (
              <button
                type="button"
                onClick={onOpenBackupModal}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-900/60 hover:border-indigo-700'
                    : 'bg-white hover:bg-indigo-50/60 text-indigo-700 border-indigo-200'
                }`}
                title="Copia de seguridad local: Descargar respaldo o restaurar observaciones y ajustes del curso"
              >
                <Database className="w-3.5 h-3.5 text-indigo-500" />
                <span>Copia de Seguridad</span>
              </button>
            )}
          </div>
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
                  : '💜 Resumen Anual Activo'}
              </span>
            </div>
            <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              {attendanceTerm === 'annual'
                ? 'Consolidado acumulado de inasistencias, tardanzas y notas de disposición de ambos cuatrimestres.'
                : 'Registro y control específico para este período lectivo.'}
            </p>
          </div>
        </div>

        {/* Term switch buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTerm('1c')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              attendanceTerm === '1c'
                ? 'bg-blue-600 text-white shadow-xs'
                : isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-300'
                : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
            }`}
          >
            1° Cuatrimestre
          </button>
          <button
            type="button"
            onClick={() => onSelectTerm('2c')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              attendanceTerm === '2c'
                ? 'bg-emerald-600 text-white shadow-xs'
                : isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-300'
                : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
            }`}
          >
            2° Cuatrimestre
          </button>
          <button
            type="button"
            onClick={() => onSelectTerm('annual')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              attendanceTerm === 'annual'
                ? 'bg-purple-600 text-white shadow-xs'
                : isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-300'
                : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${attendanceTerm === 'annual' ? 'bg-white' : 'bg-purple-400'}`} />
            <span>Resumen Anual</span>
          </button>
        </div>
      </div>
    </div>
  );
};
