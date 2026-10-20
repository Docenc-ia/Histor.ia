import React from 'react';
import {
  Send,
  History,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  X,
  CheckCheck,
  BellOff,
  CheckSquare,
  Square,
  CheckCircle2,
  Clock,
  Trash2,
  Check,
} from 'lucide-react';
import { Student, StudentHistoryItem } from '../../../types';

export interface PendingNotificationsInboxProps {
  isDarkMode: boolean;
  pendingAllItems: StudentHistoryItem[];
  pendingAbsenceItems: StudentHistoryItem[];
  pendingConductItems: StudentHistoryItem[];
  filteredPendingMessages: StudentHistoryItem[];
  courseHistory: StudentHistoryItem[];
  courseStudents: Student[];
  isPermHistoryCollapsed: boolean;
  setIsPermHistoryCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  permHistoryCategory: 'all' | 'Ausencia' | 'Disposición';
  setPermHistoryCategory: React.Dispatch<React.SetStateAction<'all' | 'Ausencia' | 'Disposición'>>;
  permHistorySearch: string;
  setPermHistorySearch: React.Dispatch<React.SetStateAction<string>>;
  selectedPendingHistoryIds: string[];
  setSelectedPendingHistoryIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleBatchMarkOmitNotification: () => void;
  handleOpenBatchFromSelectedHistory: () => void;
  toggleSelectAllPendingHistory: () => void;
  toggleSelectPendingHistory: (id: string) => void;
  handleOpenNotifyModal: (item: StudentHistoryItem, student: Student) => void;
  handleMarkOmitNotification: (item: StudentHistoryItem) => void;
  handleDeleteHistoryEntry: (item: StudentHistoryItem) => void;
  handleMarkAllPendingAsOmitted: () => void;
  handleOpenBatchFromPending: (filter: 'all' | 'Ausencia' | 'Disposición') => void;
  setActiveTab: (tab: 'attendance' | 'libro_temas' | 'grades' | 'history') => void;
  setToastMessage: (msg: string | null) => void;
}

export const PendingNotificationsInbox: React.FC<PendingNotificationsInboxProps> = React.memo(({
  isDarkMode,
  pendingAllItems,
  pendingAbsenceItems,
  pendingConductItems,
  filteredPendingMessages,
  courseHistory,
  courseStudents,
  isPermHistoryCollapsed,
  setIsPermHistoryCollapsed,
  permHistoryCategory,
  setPermHistoryCategory,
  permHistorySearch,
  setPermHistorySearch,
  selectedPendingHistoryIds,
  setSelectedPendingHistoryIds,
  handleBatchMarkOmitNotification,
  handleOpenBatchFromSelectedHistory,
  toggleSelectAllPendingHistory,
  toggleSelectPendingHistory,
  handleOpenNotifyModal,
  handleMarkOmitNotification,
  handleDeleteHistoryEntry,
  handleMarkAllPendingAsOmitted,
  handleOpenBatchFromPending,
  setActiveTab,
  setToastMessage,
}) => {
  return (
    <div
      className={`mt-8 rounded-xl border shadow-xs overflow-hidden transition-all ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 ${
          isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg border ${
              pendingAllItems.length > 0
                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
            }`}
          >
            <Send className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className={`text-sm sm:text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
                Avisos de la Clase (Mandar / No Mandar)
              </h4>
              {pendingAllItems.length > 0 ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60">
                  {pendingAllItems.length} pendiente{pendingAllItems.length === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60">
                  Al día (0 pendientes)
                </span>
              )}
            </div>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Inasistencias y conductas para definir envío. Al elegir &ldquo;Mandar&rdquo; o &ldquo;No mandar&rdquo;, el mensaje se procesa y desaparece de aquí (queda guardado en la pestaña Historial de arriba).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300 shadow-2xs'
            }`}
            title="Ver registro cronológico completo, hojas de Google Sheets y auditoría en la pestaña Historial de arriba"
          >
            <History className="w-3.5 h-3.5 text-blue-500" />
            <span>Ver Historial General ({courseHistory.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPermHistoryCollapsed(!isPermHistoryCollapsed)}
            className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                : 'bg-white border-neutral-300 text-neutral-600 hover:text-neutral-900 shadow-2xs'
            }`}
            title={isPermHistoryCollapsed ? 'Expandir bandeja de avisos' : 'Minimizar bandeja de avisos'}
          >
            {isPermHistoryCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!isPermHistoryCollapsed && (
        <div>
          {pendingAllItems.length > 0 && (
            <div
              className={`p-3 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
                isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`font-semibold mr-1 flex items-center gap-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  <Filter className="w-3.5 h-3.5" />
                  Filtrar pendientes:
                </span>
                <button
                  type="button"
                  onClick={() => setPermHistoryCategory('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    permHistoryCategory === 'all'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Todos ({pendingAllItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPermHistoryCategory('Ausencia')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    permHistoryCategory === 'Ausencia'
                      ? 'bg-red-600 text-white shadow-2xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-red-300 hover:bg-slate-700'
                      : 'bg-white border border-neutral-200 text-red-700 hover:bg-red-50'
                  }`}
                >
                  Faltas ({pendingAbsenceItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPermHistoryCategory('Disposición')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    permHistoryCategory === 'Disposición'
                      ? 'bg-purple-600 text-white shadow-2xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-purple-300 hover:bg-slate-700'
                      : 'bg-white border border-neutral-200 text-purple-700 hover:bg-purple-50'
                  }`}
                >
                  Conducta ({pendingConductItems.length})
                </button>
              </div>

              <div className="relative">
                <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
                <input
                  type="text"
                  placeholder="Buscar alumno o motivo..."
                  value={permHistorySearch}
                  onChange={(e) => setPermHistorySearch(e.target.value)}
                  className={`pl-8 pr-3 py-1 rounded-lg border text-xs transition-colors w-48 sm:w-56 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                      : 'bg-white border-neutral-300 text-neutral-800 placeholder-neutral-400 focus:border-blue-500 shadow-2xs'
                  }`}
                />
                {permHistorySearch && (
                  <button
                    type="button"
                    onClick={() => setPermHistorySearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedPendingHistoryIds.length > 0 && (
            <div
              className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 ${
                isDarkMode ? 'bg-indigo-950/40 border-slate-800 text-indigo-200' : 'bg-indigo-50 border-neutral-200 text-indigo-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="font-semibold text-xs">
                  {selectedPendingHistoryIds.length} aviso{selectedPendingHistoryIds.length > 1 ? 's' : ''} pendiente{selectedPendingHistoryIds.length > 1 ? 's' : ''} seleccionado{selectedPendingHistoryIds.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedPendingHistoryIds([])}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg hover:underline opacity-80 cursor-pointer"
                >
                  Deseleccionar
                </button>
                <button
                  type="button"
                  onClick={handleBatchMarkOmitNotification}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-neutral-800 dark:text-slate-100 text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                  title="Quitar los avisos seleccionados sin mandar notificación. Quedan registrados en el Historial."
                >
                  <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
                  <span>No mandar ({selectedPendingHistoryIds.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenBatchFromSelectedHistory}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Mandar ({selectedPendingHistoryIds.length})</span>
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead
                className={`sticky top-0 z-10 border-b font-semibold uppercase tracking-wider ${
                  isDarkMode
                    ? 'bg-slate-800/95 border-slate-700 text-slate-300'
                    : 'bg-neutral-100/95 border-neutral-200 text-neutral-600'
                }`}
              >
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    {filteredPendingMessages.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllPendingHistory}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        title="Seleccionar todos los avisos pendientes"
                      >
                        {selectedPendingHistoryIds.length > 0 && selectedPendingHistoryIds.length === pendingAllItems.length ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        ) : selectedPendingHistoryIds.length > 0 ? (
                          <div className="w-4 h-4 rounded border-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-600 font-bold leading-none">
                            -
                          </div>
                        ) : (
                          <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                        )}
                      </button>
                    )}
                  </th>
                  <th className="py-2.5 px-3">Fecha y Hora</th>
                  <th className="py-2.5 px-4">Estudiante</th>
                  <th className="py-2.5 px-3">Tipo / Incidencia</th>
                  <th className="py-2.5 px-4">Detalle / Motivo</th>
                  <th className="py-2.5 px-3 text-center">Impacto</th>
                  <th className="py-2.5 px-3 text-center">Decisión (Mandar / No Mandar)</th>
                  <th className="py-2.5 px-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                {filteredPendingMessages.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 px-4 text-center">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2.5">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <p className={`font-bold text-sm ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>
                        {pendingAllItems.length === 0
                          ? 'No hay avisos pendientes'
                          : 'No hay avisos pendientes que coincidan con el filtro.'}
                      </p>
                      <p className={`text-xs mt-1 max-w-md mx-auto ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                        {pendingAllItems.length === 0
                          ? 'Todos los mensajes de inasistencias y conductas de la clase ya han sido enviados o marcados como "No mandar". Podés consultar el historial completo de la clase en la pestaña Historial de arriba.'
                          : 'Probá cambiando el filtro o la búsqueda.'}
                      </p>
                      {pendingAllItems.length === 0 && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => setActiveTab('history')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>Ir al Historial Completo</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredPendingMessages.map((item) => {
                    const isAbsence =
                      item.category === 'Ausencia' ||
                      item.action === 'Ausencia' ||
                      item.action?.toLowerCase().includes('ausencia') ||
                      item.action?.toLowerCase().includes('falta');
                    const isLate =
                      item.category === 'Llegada tarde' ||
                      item.action === 'Llegada tarde' ||
                      item.action?.toLowerCase().includes('llegada tarde') ||
                      item.action?.toLowerCase().includes('tarde') ||
                      item.action?.toLowerCase().includes('tardanza');
                    const isSelectedPending = selectedPendingHistoryIds.includes(item.id);

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          isSelectedPending
                            ? isDarkMode
                              ? 'bg-indigo-950/30'
                              : 'bg-indigo-50/50'
                            : isDarkMode
                            ? 'hover:bg-slate-800/50'
                            : 'hover:bg-neutral-50/70'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center w-10">
                          <button
                            type="button"
                            onClick={() => toggleSelectPendingHistory(item.id)}
                            className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            title={isSelectedPending ? 'Deseleccionar aviso' : 'Seleccionar aviso para mandar o no mandar'}
                          >
                            {isSelectedPending ? (
                              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            ) : (
                              <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                            )}
                          </button>
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-semibold text-neutral-900 dark:text-white">{item.date}</span>
                            <span className={`text-[10px] font-mono ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>{item.time}</span>
                          </div>
                        </td>

                        <td className="py-2.5 px-4 font-semibold text-neutral-900 dark:text-white">
                          {item.studentName}
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {isAbsence ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              Ausencia
                            </span>
                          ) : isLate ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                              <Clock className="w-3 h-3 text-amber-500" />
                              Llegada tarde
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                              Disposición
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-4">
                          <span className="font-medium text-neutral-800 dark:text-slate-200">{item.action}</span>
                        </td>

                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {isAbsence ? (
                            <span className="font-mono font-bold text-red-600 dark:text-red-400">Ausencia</span>
                          ) : isLate ? (
                            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">Tardanza</span>
                          ) : item.previousDisposition !== undefined && item.resultingDisposition !== undefined ? (
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded border ${
                                item.resultingDisposition > item.previousDisposition
                                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60'
                                  : 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800/60'
                              }`}
                            >
                              {item.previousDisposition} → {item.resultingDisposition} pts
                            </span>
                          ) : item.pointsChange !== undefined && item.pointsChange !== 0 ? (
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded border ${
                                item.pointsChange > 0
                                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60'
                                  : 'text-neutral-700 dark:text-slate-300 border-transparent'
                              }`}
                            >
                              {item.pointsChange > 0 ? `+${item.pointsChange}` : item.pointsChange} pto
                            </span>
                          ) : (
                            <span className="text-neutral-400 font-mono text-[11px]">-</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                const st = courseStudents.find((s) => s.id === item.studentId);
                                handleOpenNotifyModal(
                                  item,
                                  st || ({ id: item.studentId, firstName: item.studentName, lastName: '', email: '' } as any)
                                );
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-xs transition-all active:scale-95"
                              title={`Enviar aviso de ${isAbsence ? 'inasistencia' : 'conducta'} al alumno ahora`}
                            >
                              <Send className="w-3 h-3" />
                              <span>Mandar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkOmitNotification(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-200 hover:bg-neutral-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-neutral-800 dark:text-slate-200 cursor-pointer shadow-2xs transition-all active:scale-95"
                              title="No mandar: quita este aviso de la lista y lo deja registrado en el Historial"
                            >
                              <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
                              <span>No mandar</span>
                            </button>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleDeleteHistoryEntry(item)}
                            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                            title="Borrar este registro por error y revertir puntuación en Google Sheets"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div
            className={`px-4 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-50 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {pendingAllItems.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/70">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {pendingAllItems.length} aviso{pendingAllItems.length === 1 ? '' : 's'} pendiente{pendingAllItems.length === 1 ? '' : 's'} de definir
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  <Check className="w-3 h-3 text-emerald-600" />
                  Todos los avisos están procesados
                </span>
              )}
              <span className="text-neutral-400">•</span>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Ver Historial completo ({courseHistory.length} registros)
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
              {selectedPendingHistoryIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={handleBatchMarkOmitNotification}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-neutral-200 hover:bg-neutral-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-neutral-800 dark:text-slate-100 shadow-xs transition-all cursor-pointer"
                    title="Marcar los registros seleccionados como No mandar"
                  >
                    <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
                    <span>No mandar ({selectedPendingHistoryIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenBatchFromSelectedHistory}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer"
                    title="Enviar aviso a los registros seleccionados"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Mandar ({selectedPendingHistoryIds.length})</span>
                  </button>
                </>
              ) : (
                <>
                  {pendingAllItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllPendingAsOmitted}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-neutral-700 dark:text-slate-300 border border-neutral-300 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
                      title="Marcar todos los avisos pendientes como No mandar: salen de aquí y quedan guardados en el Historial"
                    >
                      <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
                      <span>No mandar a todos ({pendingAllItems.length})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    id="btn-enviar-notificaciones-todos-historial"
                    onClick={() => {
                      if (pendingAllItems.length === 0) {
                        setToastMessage('Todos los avisos de la clase ya han sido enviados o marcados como no mandar.');
                        setTimeout(() => setToastMessage(null), 3500);
                        return;
                      }
                      handleOpenBatchFromPending('all');
                    }}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold shadow-md transition-all cursor-pointer ${
                      pendingAllItems.length > 0
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:shadow-lg hover:scale-102 ring-2 ring-blue-500/30'
                        : 'bg-neutral-200 dark:bg-slate-700 text-neutral-600 dark:text-slate-300 hover:bg-neutral-300 dark:hover:bg-slate-600'
                    }`}
                    title="Enviar todas las notificaciones pendientes de la clase"
                  >
                    <Send className="w-4 h-4" />
                    <span>Mandar a todos</span>
                    {pendingAllItems.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white text-blue-700 shadow-xs">
                        {pendingAllItems.length}
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
