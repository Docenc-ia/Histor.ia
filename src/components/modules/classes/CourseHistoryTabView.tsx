import React from 'react';
import {
  History,
  Users,
  CheckCheck,
  BellOff,
  Send,
  CheckSquare,
  Square,
  Check,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import { Course, Student, StudentHistoryItem, StudentDispositionData } from '../../../types';
import { GoogleSyncManager } from './GoogleSyncManager';

interface CourseHistoryTabViewProps {
  activeCourse: Course;
  courseStudents: Student[];
  courseHistory: StudentHistoryItem[];
  pendingAllItems: StudentHistoryItem[];
  selectedPendingHistoryIds: string[];
  setSelectedPendingHistoryIds: (ids: string[]) => void;
  historySubTab: 'incidents' | 'summary';
  setHistorySubTab: (tab: 'incidents' | 'summary') => void;
  isSyncingSheet: boolean;
  sheetConfig: any;
  isOpeningSheet: boolean;
  isTokenExpired: boolean;
  handleOpenGoogleSheet: () => void;
  handleManualSheetsSync: () => void;
  setSheetsModalFeedback: (msg: string | null) => void;
  setShowSheetsConnectModal: (open: boolean) => void;
  renewGoogleSession: () => Promise<boolean>;
  isDarkMode: boolean;
  handleBatchMarkOmitNotification: () => void;
  handleOpenBatchFromSelectedHistory: () => void;
  toggleSelectAllPendingHistory: () => void;
  toggleSelectPendingHistory: (id: string) => void;
  handleOpenNotifyModal: (item: StudentHistoryItem, student: Student | null) => void;
  handleMarkOmitNotification: (item: StudentHistoryItem) => void;
  handleDeleteHistoryEntry: (item: StudentHistoryItem) => void;
  handleMarkAllPendingAsOmitted: () => void;
  handleOpenBatchFromPending: (filterType?: 'all' | 'absences' | 'conduct') => void;
  setToastMessage: (msg: string | null) => void;
  getStudentMetrics: (studentId: string, term?: '1c' | '2c' | 'annual') => StudentDispositionData;
}

export const CourseHistoryTabView: React.FC<CourseHistoryTabViewProps> = ({
  activeCourse,
  courseStudents,
  courseHistory,
  pendingAllItems,
  selectedPendingHistoryIds,
  setSelectedPendingHistoryIds,
  historySubTab,
  setHistorySubTab,
  isSyncingSheet,
  sheetConfig,
  isOpeningSheet,
  isTokenExpired,
  handleOpenGoogleSheet,
  handleManualSheetsSync,
  setSheetsModalFeedback,
  setShowSheetsConnectModal,
  renewGoogleSession,
  isDarkMode,
  handleBatchMarkOmitNotification,
  handleOpenBatchFromSelectedHistory,
  toggleSelectAllPendingHistory,
  toggleSelectPendingHistory,
  handleOpenNotifyModal,
  handleMarkOmitNotification,
  handleDeleteHistoryEntry,
  handleMarkAllPendingAsOmitted,
  handleOpenBatchFromPending,
  setToastMessage,
  getStudentMetrics,
}) => {
  return (
    <div className="space-y-4">
      {/* Google Sheets Live Status Banner (GoogleSyncManager) */}
      <GoogleSyncManager
        courseName={activeCourse.name}
        isSyncingSheet={isSyncingSheet}
        isLiveGoogle={sheetConfig?.isLiveGoogle || false}
        lastSyncedAt={sheetConfig?.lastSyncedAt}
        isOpeningSheet={isOpeningSheet}
        isTokenExpired={isTokenExpired}
        onOpenGoogleSheet={handleOpenGoogleSheet}
        onManualSheetsSync={handleManualSheetsSync}
        onOpenConnectModal={() => {
          setSheetsModalFeedback(null);
          setShowSheetsConnectModal(true);
        }}
        onRenewToken={renewGoogleSession}
        isDarkMode={isDarkMode}
      />

      {/* Sub-tabs: Incidencias vs Resumen Alumnos y Disposición */}
      <div
        className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        {/* Sub-tab Navigation Bar */}
        <div
          className={`p-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div
            className={`inline-flex p-1 rounded-xl border text-xs font-semibold ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setHistorySubTab('incidents')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                historySubTab === 'incidents'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial de Incidencias ({courseHistory.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setHistorySubTab('summary')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                historySubTab === 'summary'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Estudiantes y Disposición ({courseStudents.length})</span>
            </button>
          </div>

          <span className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            {historySubTab === 'incidents'
              ? 'Hoja 2 en Google Sheets (motivos y auditoría)'
              : 'Hoja 1 en Google Sheets (ausencias y nota /10)'}
          </span>
        </div>

        {/* SUBTAB 1: INCIDENCIAS DETALLADAS */}
        {historySubTab === 'incidents' && (
          <div>
            {/* Batch send bar in history tab */}
            {selectedPendingHistoryIds.length > 0 && (
              <div
                className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 ${
                  isDarkMode
                    ? 'bg-indigo-950/40 border-slate-800 text-indigo-200'
                    : 'bg-indigo-50 border-neutral-200 text-indigo-900'
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
                    title="Quitar de los pendientes sin mandar notificación. Quedan intactos en el historial."
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
                    <span>Enviar aviso a seleccionados ({selectedPendingHistoryIds.length})</span>
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className={`border-b font-semibold uppercase tracking-wider ${
                    isDarkMode
                      ? 'bg-slate-800/80 border-slate-800 text-slate-300'
                      : 'bg-neutral-100/70 border-neutral-200 text-neutral-600'
                  }`}
                >
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      {pendingAllItems.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleSelectAllPendingHistory}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                          title="Seleccionar todos los avisos pendientes de notificación (ausencias y conductas)"
                        >
                          {selectedPendingHistoryIds.length > 0 &&
                          selectedPendingHistoryIds.length === pendingAllItems.length ? (
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
                    <th className="py-3 px-4">Estudiante</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Hora</th>
                    <th className="py-3 px-4">Acción / Motivo</th>
                    <th className="py-3 px-4 text-center">Tipo</th>
                    <th className="py-3 px-4 text-center">Mensaje Enviado</th>
                    <th className="py-3 px-4">Mensaje</th>
                    <th className="py-3 px-4 text-right">Borrar y Revertir</th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y ${
                    isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'
                  }`}
                >
                  {courseHistory.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 px-4 text-center text-neutral-400">
                        <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="font-semibold text-sm">No hay incidencias registradas aún en este curso.</p>
                        <p className="text-xs mt-1 max-w-md mx-auto">
                          Al anotar una ausencia o marcar una falta en la lista de Estudiantes, se registra automáticamente aquí y en la hoja Google Sheets.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    courseHistory.map((item) => {
                      const student = courseStudents.find((s) => s.id === item.studentId);
                      const isPendingNotif =
                        (item.category === 'Ausencia' || item.category === 'Disposición') &&
                        !item.messageSent &&
                        !item.omitNotification &&
                        item.notificationMethod !== 'omitted';
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
                          <td className="py-3 px-3 text-center">
                            {isPendingNotif ? (
                              <button
                                type="button"
                                onClick={() => toggleSelectPendingHistory(item.id)}
                                className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                title={isSelectedPending ? 'Deseleccionar' : 'Seleccionar para aviso en lote'}
                              >
                                {isSelectedPending ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                ) : (
                                  <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                                )}
                              </button>
                            ) : (
                              <span className="text-neutral-300 dark:text-slate-600 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-neutral-900 dark:text-white">
                            {item.studentName}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-600 dark:text-slate-300">
                            {item.date}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-600 dark:text-slate-300">
                            {item.time}
                          </td>
                          <td className="py-3 px-4">
                            {(() => {
                              const isItemAbsence =
                                item.category === 'Ausencia' ||
                                item.action === 'Ausencia' ||
                                item.action?.toLowerCase().includes('ausencia') ||
                                item.action?.toLowerCase().includes('falta');
                              const isItemLate =
                                item.category === 'Llegada tarde' ||
                                item.action === 'Llegada tarde' ||
                                item.action?.toLowerCase().includes('llegada tarde') ||
                                item.action?.toLowerCase().includes('tarde') ||
                                item.action?.toLowerCase().includes('tardanza');

                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                    isItemAbsence
                                      ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                                      : isItemLate
                                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                      : 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                  }`}
                                >
                                  {item.action}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-[11px] font-semibold opacity-80">
                              {(() => {
                                const isItemAbsence =
                                  item.category === 'Ausencia' ||
                                  item.action === 'Ausencia' ||
                                  item.action?.toLowerCase().includes('ausencia') ||
                                  item.action?.toLowerCase().includes('falta');
                                const isItemLate =
                                  item.category === 'Llegada tarde' ||
                                  item.action === 'Llegada tarde' ||
                                  item.action?.toLowerCase().includes('llegada tarde') ||
                                  item.action?.toLowerCase().includes('tarde') ||
                                  item.action?.toLowerCase().includes('tardanza');

                                if (isItemAbsence) return 'Ausencia';
                                if (isItemLate) return 'Tardanza';
                                if (item.pointsChange !== undefined && item.pointsChange !== 0) {
                                  return `${item.pointsChange > 0 ? '+' : ''}${item.pointsChange} pto`;
                                }
                                return '-';
                              })()}
                            </span>
                          </td>

                          {/* Columna Mensaje Enviado (con tick, opción No mandar o botón para mandar) */}
                          <td className="py-3 px-4 text-center">
                            {item.category === 'Ausencia' || item.category === 'Disposición' ? (
                              item.messageSent ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                  title={`Enviado por ${item.notificationMethod === 'gmail' ? 'Gmail' : 'Classroom'} (${item.notifiedAt || 'OK'})`}
                                >
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                  <span>Enviado</span>
                                </span>
                              ) : item.omitNotification || item.notificationMethod === 'omitted' ? (
                                <div className="inline-flex items-center gap-1.5 justify-center">
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-slate-800 text-neutral-600 dark:text-slate-400 border border-neutral-200 dark:border-slate-700"
                                    title="Aviso omitido por el docente. Queda guardado en tu historial sin mandar notificación."
                                  >
                                    <BellOff className="w-2.5 h-2.5 text-neutral-400" />
                                    <span>No mandar</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenNotifyModal(item, student || null)}
                                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                    title="Cambiar y enviar aviso ahora"
                                  >
                                    Mandar
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1 justify-center flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenNotifyModal(item, student || null)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer shadow-2xs"
                                    title={`Enviar aviso de ${item.category === 'Ausencia' ? 'inasistencia' : 'conducta'} al alumno ahora`}
                                  >
                                    <Send className="w-3 h-3" />
                                    <span>Mandar</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkOmitNotification(item)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-neutral-600 dark:text-slate-300 border border-neutral-200 dark:border-slate-700 cursor-pointer shadow-2xs"
                                    title="No mandar: sale de los pendientes y permanece en tu historial docente"
                                  >
                                    <BellOff className="w-2.5 h-2.5 text-neutral-400" />
                                    <span>No mandar</span>
                                  </button>
                                </div>
                              )
                            ) : (
                              <span className="text-[11px] text-neutral-400 dark:text-slate-500">—</span>
                            )}
                          </td>

                          {/* Columna Mensaje */}
                          <td className="py-3 px-4 max-w-xs">
                            {item.messageText ? (
                              <p
                                className="text-[11px] text-neutral-700 dark:text-slate-300 line-clamp-2"
                                title={item.messageText}
                              >
                                {item.messageText}
                              </p>
                            ) : (
                              <span className="text-[11px] text-neutral-400 dark:text-slate-500 italic">
                                {item.omitNotification || item.notificationMethod === 'omitted'
                                  ? 'Sin aviso (guardado en historial)'
                                  : item.category === 'Ausencia' || item.category === 'Disposición'
                                  ? 'Pendiente de envío'
                                  : 'N/A'}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteHistoryEntry(item)}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                              title="Eliminar del historial, revertir puntuación y actualizar Google Sheets"
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

            {/* Barra inferior al final del historial: botón 'Enviar a todos' para notificaciones acumuladas a lo largo de la clase */}
            <div
              className={`px-4 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
                isDarkMode ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Total en historial: <strong>{courseHistory.length}</strong> registro{courseHistory.length === 1 ? '' : 's'}
                </span>
                <span className="text-neutral-400">•</span>
                {pendingAllItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/70">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    {pendingAllItems.length} notificación{pendingAllItems.length === 1 ? '' : 'es'} pendiente{pendingAllItems.length === 1 ? '' : 's'} de la clase
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                    <Check className="w-3 h-3 text-emerald-600" />
                    Todos los avisos de la clase están enviados
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                {selectedPendingHistoryIds.length > 0 && (
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
                      <span>Enviar a seleccionados ({selectedPendingHistoryIds.length})</span>
                    </button>
                  </>
                )}

                {pendingAllItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllPendingAsOmitted}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-neutral-700 dark:text-slate-300 border border-neutral-300 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
                    title="Quitar todos los avisos pendientes a la vez: quedan guardados en tu historial docente sin mandar notificaciones"
                  >
                    <BellOff className="w-3.5 h-3.5 text-neutral-500 dark:text-slate-400" />
                    <span>No mandar ({pendingAllItems.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  id="btn-enviar-notificaciones-todos-tab3"
                  onClick={() => {
                    if (pendingAllItems.length === 0) {
                      setToastMessage('Todos los avisos de la clase ya han sido enviados (o no hay incidencias pendientes).');
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
                  title="Enviar todas las notificaciones de ausencias y conductas acumuladas a lo largo de la clase a todos los alumnos correspondientes"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar a todos</span>
                  {pendingAllItems.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white text-blue-700 shadow-xs">
                      {pendingAllItems.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: RESUMEN DE ALUMNOS Y DISPOSICIÓN */}
        {historySubTab === 'summary' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead
                className={`border-b font-semibold uppercase tracking-wider ${
                  isDarkMode
                    ? 'bg-slate-800/80 border-slate-800 text-slate-300'
                    : 'bg-neutral-100/70 border-neutral-200 text-neutral-600'
                }`}
              >
                <tr>
                  <th className="py-3 px-4">Estudiante</th>
                  <th className="py-3 px-4 text-center">Total Ausencias</th>
                  <th className="py-3 px-4 text-center">Puntaje Disposición</th>
                  <th className="py-3 px-4">Último motivo de descuento</th>
                  <th className="py-3 px-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y ${
                  isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'
                }`}
              >
                {courseStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 px-4 text-center text-neutral-400">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="font-semibold">No hay estudiantes asignados a este curso.</p>
                    </td>
                  </tr>
                ) : (
                  courseStudents.map((st) => {
                    const metrics = getStudentMetrics(st.id);
                    const studentIncidents = courseHistory.filter(
                      (h) => h.studentId === st.id && h.category === 'Disposición'
                    );
                    const lastIncident = studentIncidents[0]?.action || 'Sin conductas registradas';

                    return (
                      <tr
                        key={st.id}
                        className={`transition-colors ${
                          isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50/70'
                        }`}
                      >
                        <td className="py-3 px-4 font-semibold text-neutral-900 dark:text-white">
                          {st.lastName}, {st.firstName}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${
                              metrics.totalAbsences > 0
                                ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                : 'bg-neutral-100 dark:bg-slate-800 text-neutral-600 dark:text-slate-400'
                            }`}
                          >
                            {metrics.totalAbsences}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${
                              metrics.totalDisposition >= 8
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : metrics.totalDisposition >= 6
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                : 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                            }`}
                          >
                            {metrics.totalDisposition} / 10
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-600 dark:text-slate-300">
                          {lastIncident}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {metrics.totalDisposition >= 8 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Óptimo
                            </span>
                          ) : metrics.totalDisposition >= 6 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              <AlertCircle className="w-3.5 h-3.5" /> Atención
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                              <ShieldAlert className="w-3.5 h-3.5" /> Crítico
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
