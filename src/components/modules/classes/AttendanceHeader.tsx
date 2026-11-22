import React from 'react';
import {
  Search,
  UserPlus,
  Send,
  Bell,
  Bookmark,
  Calendar,
  Smartphone,
  Upload,
} from 'lucide-react';

import { CourseAttendanceSummary } from '../../../utils/attendanceCalculations';
import { useTerminologySettings } from '../../../utils/terminologySettings';

interface AttendanceHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedStudentCount: number;
  onOpenBatchSelected: () => void;
  pendingCount: number;
  onOpenBatchPending: () => void;
  onOpenAddStudentModal: () => void;
  onOpenNotifConfigModal: () => void;
  onOpenImportExcel?: () => void;
  onOpenImportSheets?: () => void;
  onOpenImportCsv?: () => void;
  onOpenImportPaste?: () => void;
  attendanceTerm: '1c' | '2c' | 'annual';
  onSelectTerm: (term: '1c' | '2c' | 'annual') => void;
  attendanceSummary?: CourseAttendanceSummary;
  onOpenAttendanceSettings?: () => void;
  onOpenQuickRollCall?: () => void;
  saveToDriveControl?: React.ReactNode;
  isDarkMode: boolean;
}

export const AttendanceHeader: React.FC<AttendanceHeaderProps> = React.memo(({
  searchQuery,
  onSearchChange,
  selectedStudentCount,
  onOpenBatchSelected,
  pendingCount,
  onOpenBatchPending,
  onOpenAddStudentModal,
  onOpenNotifConfigModal,
  onOpenImportExcel,
  onOpenImportSheets,
  attendanceTerm,
  onSelectTerm,
  onOpenQuickRollCall,
  saveToDriveControl,
  isDarkMode,
}) => {
  const { combinedTabLabel, dispositionLabel, term1FullLabel, term2FullLabel } = useTerminologySettings();

  return (
    <div className="space-y-3">
      {/* Search & Secondary Actions Bar */}
      <div
        className={`p-3 rounded-xl border transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
                    ? 'bg-slate-800/90 text-white placeholder-slate-500 border-slate-700 focus:border-blue-500'
                    : 'bg-neutral-50 text-neutral-900 placeholder-neutral-400 border-neutral-200 focus:bg-white focus:border-blue-500'
                }`}
              />
            </div>

            <button
              type="button"
              onClick={onOpenAddStudentModal}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-emerald-950/35 hover:bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                  : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200/80 text-emerald-800'
              }`}
              title="Agregar un nuevo alumno manualmente con su correo para pasar faltas y mandarle mensajes"
            >
              <UserPlus className={`w-3.5 h-3.5 shrink-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
              <span className="truncate">Agregar Alumno</span>
            </button>
          </div>

          {/* COLUMNA 2: Mensajes Preestablecidos arriba de Avisos Pendientes / Seleccionados */}
          <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 sm:border-l border-neutral-200/80 dark:border-slate-800 pt-2 sm:pt-0 sm:pl-2.5">
            <button
              type="button"
              onClick={onOpenNotifConfigModal}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-indigo-950/35 hover:bg-indigo-950/60 border-indigo-800/60 text-indigo-300'
                  : 'bg-indigo-50/70 hover:bg-indigo-100/80 border-indigo-200/80 text-indigo-800'
              }`}
              title="Configurar mensajes preestablecidos y opciones de Classroom / Gmail"
            >
              <Bookmark className={`w-3.5 h-3.5 shrink-0 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
              <span className="truncate">Mensajes Preestablecidos</span>
            </button>

            {selectedStudentCount > 0 ? (
              <button
                type="button"
                onClick={onOpenBatchSelected}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer animate-in fade-in ${
                  isDarkMode
                    ? 'bg-indigo-950/70 hover:bg-indigo-900/70 border-indigo-700/80 text-indigo-200'
                    : 'bg-indigo-100/80 hover:bg-indigo-200/70 border-indigo-300 text-indigo-800'
                }`}
                title="Enviar aviso de inasistencia a todos los estudiantes seleccionados"
              >
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Avisar a seleccionados ({selectedStudentCount})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenBatchPending}
                disabled={pendingCount === 0}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  pendingCount > 0
                    ? isDarkMode
                      ? 'bg-indigo-950/60 hover:bg-indigo-900/70 border-indigo-700/80 text-indigo-200 cursor-pointer'
                      : 'bg-indigo-100/80 hover:bg-indigo-200/70 border-indigo-300 text-indigo-800 cursor-pointer'
                    : isDarkMode
                    ? 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed'
                    : 'bg-neutral-50 text-neutral-400 border-neutral-200 cursor-not-allowed'
                }`}
                title="Enviar avisos pendientes a todos los estudiantes (ausencias y conductas)"
              >
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Avisos pendientes ({pendingCount})</span>
              </button>
            )}
          </div>

          {/* COLUMNA 3: Guardar en Drive arriba de Importar */}
          <div className="flex flex-col gap-2 justify-center border-t lg:border-t-0 lg:border-l border-neutral-200/80 dark:border-slate-800 pt-2 lg:pt-0 lg:pl-2.5 sm:col-span-2 lg:col-span-1">
            {saveToDriveControl && (
              <div className="w-full [&>div]:w-full [&>div>button]:w-full [&>div>button]:justify-center">
                {saveToDriveControl}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (onOpenImportSheets) {
                  onOpenImportSheets();
                } else {
                  onOpenImportExcel?.();
                }
              }}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-emerald-950/35 hover:bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                  : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200/80 text-emerald-800'
              }`}
              title={`Importar notas de ${dispositionLabel.toLowerCase()} o asistencia desde un link, Google Sheets, Google Docs, Word, Excel, CSV o texto pegado, eligiendo los nombres para verificar que esté todo bien`}
            >
              <Upload className={`w-3.5 h-3.5 shrink-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
              <span className="truncate">Importar datos</span>
            </button>
          </div>
        </div>
      </div>

      {/* Unified Segmented Term Switcher + Single Primary CTA */}
      <div
        className={`px-3.5 py-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-slate-400">
            <Calendar
              className={`w-4 h-4 shrink-0 ${
                attendanceTerm === '1c'
                  ? 'text-blue-600 dark:text-blue-400'
                  : attendanceTerm === '2c'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-violet-600 dark:text-violet-400'
              }`}
            />
            <span className="hidden md:inline">{combinedTabLabel}</span>
          </div>

          <div
            className={`inline-flex items-center p-1 rounded-lg border ${
              isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-neutral-100 border-neutral-200/80'
            }`}
            role="tablist"
            aria-label="Período lectivo"
          >
            <button
              type="button"
              role="tab"
              aria-selected={attendanceTerm === '1c'}
              onClick={() => onSelectTerm('1c')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                attendanceTerm === '1c'
                  ? isDarkMode
                    ? 'bg-blue-950/80 text-blue-300 ring-1 ring-blue-700/70 shadow-xs'
                    : 'bg-white text-blue-700 ring-1 ring-blue-200 shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {term1FullLabel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={attendanceTerm === '2c'}
              onClick={() => onSelectTerm('2c')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                attendanceTerm === '2c'
                  ? isDarkMode
                    ? 'bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-700/70 shadow-xs'
                    : 'bg-white text-emerald-700 ring-1 ring-emerald-200 shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {term2FullLabel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={attendanceTerm === 'annual'}
              onClick={() => onSelectTerm('annual')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                attendanceTerm === 'annual'
                  ? isDarkMode
                    ? 'bg-violet-950/80 text-violet-300 ring-1 ring-violet-700/70 shadow-xs'
                    : 'bg-white text-violet-700 ring-1 ring-violet-200 shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Resumen Anual
            </button>
          </div>
        </div>

        {/* Single Primary Action */}
        {onOpenQuickRollCall && (
          <button
            type="button"
            onClick={onOpenQuickRollCall}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            title="Abrir Modo Toma Rápida (P / A / T uno por uno o en lista vertical compacta para celular y PC)"
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Pasar Lista Rápido</span>
          </button>
        )}
      </div>
    </div>
  );
});

