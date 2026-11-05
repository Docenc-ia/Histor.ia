import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  UserPlus,
  Send,
  Bell,
  Award,
  Bookmark,
  FileSpreadsheet,
  Calendar,
  Smartphone,
  Upload,
  ChevronDown,
  FileDown,
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
  onOpenSendDispositionModal: () => void;
  onOpenNotifConfigModal: () => void;
  onOpenImportExcel?: () => void;
  onOpenImportSheets?: () => void;
  onOpenImportCsv?: () => void;
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
  onOpenSendDispositionModal,
  onOpenNotifConfigModal,
  onOpenImportExcel,
  onOpenImportSheets,
  onOpenImportCsv,
  attendanceTerm,
  onSelectTerm,
  onOpenQuickRollCall,
  saveToDriveControl,
  isDarkMode,
}) => {
  const { combinedTabLabel, dispositionLabel, term1FullLabel, term2FullLabel } = useTerminologySettings();
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isImportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setIsImportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImportMenuOpen]);

  return (
    <div className="space-y-3">
      {/* Search & Actions Bar Organizado en 3 Columnas */}
      <div
        className={`p-3.5 rounded-xl border transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* COLUMNA 1: Buscar estudiante, Agregar Alumno y Mensajes Preestablecidos */}
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
              <span className="truncate">Mensajes Preestablecidos</span>
            </button>
          </div>

          {/* COLUMNA 2: Avisos Pendientes / Seleccionados y Mandar a Calificaciones */}
          <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 sm:border-l border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0 sm:pl-3">
            {selectedStudentCount > 0 ? (
              <button
                type="button"
                onClick={onOpenBatchSelected}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer animate-in fade-in"
                title="Enviar aviso de inasistencia a todos los estudiantes seleccionados"
              >
                <Send className="w-3.5 h-3.5" />
                <span className="truncate">Avisar a seleccionados ({selectedStudentCount})</span>
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
                <span className="truncate">Avisos pendientes ({pendingCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSendDispositionModal}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg shadow-xs border border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white transition-all cursor-pointer"
              title={`Mandar notas de ${dispositionLabel.toLowerCase()} a Calificaciones (${attendanceTerm === '2c' ? term2FullLabel : term1FullLabel})`}
            >
              <Award className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="truncate">Mandar a Calificaciones</span>
            </button>
          </div>

          {/* COLUMNA 3: Guardar en Drive arriba de Importar (desplegable con Excel, Sheets y CSV) */}
          <div className="flex flex-col gap-2 justify-center border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-slate-800 pt-2 lg:pt-0 lg:pl-3 sm:col-span-2 lg:col-span-1">
            {saveToDriveControl && (
              <div className="w-full [&>div]:w-full [&>div>button]:w-full [&>div>button]:justify-center">
                {saveToDriveControl}
              </div>
            )}

            <div className="relative w-full" ref={importMenuRef}>
              <button
                type="button"
                onClick={() => setIsImportMenuOpen((prev) => !prev)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                title="Elegir desde qué formato importar datos (Excel, Google Sheets o CSV) detectando alumnos, notas, asistencia y disposición"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Importar</span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${isImportMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isImportMenuOpen && (
                <div
                  className={`absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl border shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-slate-100'
                      : 'bg-white border-neutral-200 text-neutral-900'
                  }`}
                >
                  <div
                    className={`px-3.5 py-2.5 border-b text-[11px] font-bold flex items-center justify-between ${
                      isDarkMode
                        ? 'bg-slate-800/80 border-slate-700 text-slate-300'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Elegí desde dónde importar</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]">
                      Detecta Alumnos y Notas
                    </span>
                  </div>

                  <div className="p-2 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsImportMenuOpen(false);
                        onOpenImportExcel?.();
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-start gap-2.5 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/80 hover:border-emerald-500/50'
                          : 'bg-white hover:bg-emerald-50/40 border-neutral-200 hover:border-emerald-300'
                      }`}
                    >
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 mt-0.5">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold">Microsoft Excel</span>
                          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            .xlsx / .xls
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-500 dark:text-slate-400 leading-snug mt-0.5">
                          Subir archivo Excel y detectar alumnos, notas, faltas y disposición.
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsImportMenuOpen(false);
                        if (onOpenImportSheets) {
                          onOpenImportSheets();
                        } else {
                          onOpenImportExcel?.();
                        }
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-start gap-2.5 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/80 hover:border-blue-500/50'
                          : 'bg-white hover:bg-blue-50/40 border-neutral-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0 mt-0.5">
                        <FileSpreadsheet className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold">Google Sheets</span>
                          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
                            .gsheet
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-500 dark:text-slate-400 leading-snug mt-0.5">
                          Conectar o elegir una hoja de tu Google Drive y detectar alumnos y notas.
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsImportMenuOpen(false);
                        onOpenImportCsv?.();
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-start gap-2.5 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/80 hover:border-teal-500/50'
                          : 'bg-white hover:bg-teal-50/40 border-neutral-200 hover:border-teal-300'
                      }`}
                    >
                      <div className="p-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 shrink-0 mt-0.5">
                        <FileDown className="w-4 h-4 text-teal-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold">Archivo CSV</span>
                          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">
                            .csv
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-500 dark:text-slate-400 leading-snug mt-0.5">
                          Subir archivo CSV separado por comas o punto y coma y detectar alumnos y notas.
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
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
                Período de {combinedTabLabel}:
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
                  ? `📘 ${term1FullLabel} Activo`
                  : attendanceTerm === '2c'
                  ? `📗 ${term2FullLabel} Activo`
                  : '💜 Resumen Anual Activo'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Roll-Call + Term switch buttons */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {onOpenQuickRollCall && (
            <button
              type="button"
              onClick={onOpenQuickRollCall}
              className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 mr-1"
              title="Abrir Modo Toma Rápida (P / A / T uno por uno o en lista vertical compacta para celular y PC)"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Pasar Lista Rápido</span>
            </button>
          )}
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
            {term1FullLabel}
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
            {term2FullLabel}
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
});

