import React from 'react';
import {
  Users,
  UserPlus,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Copy,
  ExternalLink,
  Settings,
  Award,
  Send,
  CheckSquare,
  Square,
  CheckCheck,
  Pencil,
} from 'lucide-react';
import {
  Course,
  Student,
  StudentDispositionData,
  StudentHistoryItem,
  StudentObservation,
} from '../../../types';
import {
  AttendanceSettings,
  CourseAttendanceSummary,
  computeStudentAttendanceTrafficLight,
} from '../../../utils/attendanceCalculations';
import { copyTableToClipboard } from '../../../utils/sheetsUtils';
import { useTerminologySettings } from '../../../utils/terminologySettings';
import { StudentAttendanceRow } from './StudentAttendanceRow';
import { PendingNotificationsInbox } from './PendingNotificationsInbox';

interface CourseRosterTabViewProps {
  activeCourse: Course;
  courseStudents: Student[];
  filteredStudents: Student[];
  attendanceTerm: '1c' | '2c' | 'annual';
  activeConcreteTerm: '1c' | '2c';
  attendanceSettings: AttendanceSettings;
  currentAttendanceSummary?: CourseAttendanceSummary;
  userEmail?: string;
  isDarkMode: boolean;
  isSyncingSheet: boolean;
  isSyncingClassroomRoster: boolean;
  selectedStudentIds: string[];
  setSelectedStudentIds: React.Dispatch<React.SetStateAction<string[]>>;
  toggleSelectStudent: (studentId: string) => void;
  toggleSelectAllStudents: () => void;
  removedStudentsList: Student[];
  setIsRemovedStudentsModalOpen: (open: boolean) => void;
  setIsSendDispositionModalOpen: (open: boolean) => void;
  setIsManageConductModalOpen: (open: boolean) => void;
  setIsAttendanceSettingsModalOpen: (open: boolean) => void;
  teacherConductOptions: string[];
  pulsingStudentId: string | null;
  studentObservations: Record<string, StudentObservation[]>;
  historyList: StudentHistoryItem[];
  courseHistory: StudentHistoryItem[];
  pendingAllItems: StudentHistoryItem[];
  pendingAbsenceItems: StudentHistoryItem[];
  pendingConductItems: StudentHistoryItem[];
  filteredPendingMessages: StudentHistoryItem[];
  isPermHistoryCollapsed: boolean;
  setIsPermHistoryCollapsed: (val: boolean) => void;
  permHistoryCategory: 'all' | 'Ausencia' | 'Llegada tarde' | 'Disposición' | 'Calificación' | 'Sistema';
  setPermHistoryCategory: (val: 'all' | 'Ausencia' | 'Llegada tarde' | 'Disposición' | 'Calificación' | 'Sistema') => void;
  permHistorySearch: string;
  setPermHistorySearch: (val: string) => void;
  selectedPendingHistoryIds: string[];
  setSelectedPendingHistoryIds: React.Dispatch<React.SetStateAction<string[]>>;
  getStudentMetrics: (studentId: string, targetTerm?: '1c' | '2c' | 'annual' | 'all') => StudentDispositionData;
  handleManualSheetsSync: () => void;
  handleOpenStudentProfile: (student: Student) => void;
  handleOpenEditAbsences: (student: Student, termOverride?: '1c' | '2c') => void;
  handleOpenEditDisposition: (student: Student, termOverride?: '1c' | '2c') => void;
  handleOpenAddStudentModal: () => void;
  handleSyncRoster: () => void;
  handleAddAbsence: (student: Student) => void;
  handleRecordLateArrival: (student: Student) => void;
  handleDeleteLatestAbsence: (student: Student) => void;
  handleDeleteLatestLate: (student: Student) => void;
  handleRecordDispositionAction: (
    student: Student,
    actionName: string,
    detailText?: string,
    explicitPointsDelta?: number
  ) => void;
  onOpenConductModal: (student: Student, mode: 'subtract' | 'add') => void;
  setSelectedStudentForHistory: (student: Student | null) => void;
  setStudentToRemove: (student: Student | null) => void;
  handleOpenBatchFromSelectedStudents: () => void;
  handleBatchMarkOmitNotification: () => void;
  handleOpenBatchFromSelectedHistory: () => void;
  toggleSelectAllPendingHistory: () => void;
  toggleSelectPendingHistory: (id: string) => void;
  handleOpenNotifyModal: (item: StudentHistoryItem, student: Student | null) => void;
  handleMarkOmitNotification: (item: StudentHistoryItem) => void;
  handleDeleteHistoryEntry: (item: StudentHistoryItem) => void;
  handleMarkAllPendingAsOmitted: () => void;
  handleOpenBatchFromPending: (filterType?: 'all' | 'absences' | 'conduct') => void;
  setActiveTab: (tab: 'roster' | 'libro_temas' | 'grades' | 'history') => void;
  setToastMessage: (msg: string | null) => void;
}

export const CourseRosterTabView: React.FC<CourseRosterTabViewProps> = ({
  activeCourse,
  courseStudents,
  filteredStudents,
  attendanceTerm,
  activeConcreteTerm,
  attendanceSettings,
  currentAttendanceSummary,
  userEmail,
  isDarkMode,
  isSyncingSheet,
  isSyncingClassroomRoster,
  selectedStudentIds,
  setSelectedStudentIds,
  toggleSelectStudent,
  toggleSelectAllStudents,
  removedStudentsList,
  setIsRemovedStudentsModalOpen,
  setIsSendDispositionModalOpen,
  setIsManageConductModalOpen,
  setIsAttendanceSettingsModalOpen,
  teacherConductOptions,
  pulsingStudentId,
  studentObservations,
  historyList,
  courseHistory,
  pendingAllItems,
  pendingAbsenceItems,
  pendingConductItems,
  filteredPendingMessages,
  isPermHistoryCollapsed,
  setIsPermHistoryCollapsed,
  permHistoryCategory,
  setPermHistoryCategory,
  permHistorySearch,
  setPermHistorySearch,
  selectedPendingHistoryIds,
  setSelectedPendingHistoryIds,
  getStudentMetrics,
  handleManualSheetsSync,
  handleOpenStudentProfile,
  handleOpenEditAbsences,
  handleOpenEditDisposition,
  handleOpenAddStudentModal,
  handleSyncRoster,
  handleAddAbsence,
  handleRecordLateArrival,
  handleDeleteLatestAbsence,
  handleDeleteLatestLate,
  handleRecordDispositionAction,
  onOpenConductModal,
  setSelectedStudentForHistory,
  setStudentToRemove,
  handleOpenBatchFromSelectedStudents,
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
  const { attendanceLabel, dispositionLabel, combinedTabLabel } = useTerminologySettings();

  return (
    <div className="space-y-4">
      {attendanceTerm === 'annual' ? (
        <div className="space-y-4">
          {/* Overview stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(() => {
              let totalAbs = 0;
              let totalLats = 0;
              let sumDisp = 0;
              courseStudents.forEach((s) => {
                const m1 = getStudentMetrics(s.id, '1c');
                const m2 = getStudentMetrics(s.id, '2c');
                totalAbs += m1.totalAbsences + m2.totalAbsences;
                totalLats += (m1.totalLates || 0) + (m2.totalLates || 0);
                sumDisp += (m1.totalDisposition + m2.totalDisposition) / 2;
              });
              const count = Math.max(1, courseStudents.length);
              const avgDispGlobal = Number((sumDisp / count).toFixed(1));

              return (
                <>
                  <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                      <span>Promedio {dispositionLabel} Anual</span>
                      <Award className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="text-2xl font-black mt-1 text-purple-600 dark:text-purple-400">
                      {avgDispGlobal} <span className="text-xs font-normal text-neutral-400">/10</span>
                    </div>
                    <span className="text-[11px] text-neutral-400">Promedio de ambos cuatrimestres</span>
                  </div>

                  <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                      <span>Total Faltas Anuales</span>
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="text-2xl font-black mt-1 text-red-600 dark:text-red-400">
                      {totalAbs}
                    </div>
                    <span className="text-[11px] text-neutral-400">Acumulado 1°C + 2°C</span>
                  </div>

                  <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                      <span>Total Llegadas Tarde</span>
                      <Clock className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-2xl font-black mt-1 text-amber-600 dark:text-amber-400">
                      {totalLats}
                    </div>
                    <span className="text-[11px] text-neutral-400">Acumulado 1°C + 2°C</span>
                  </div>

                  <div className={`p-3.5 rounded-xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'}`}>
                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400 font-medium">
                      <span>Alumnos Sin Riesgo</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black mt-1 text-emerald-600 dark:text-emerald-400">
                      {currentAttendanceSummary?.regularCount ?? courseStudents.length}
                      <span className="text-xs font-normal text-neutral-400"> /{count}</span>
                    </div>
                    <span className="text-[11px] text-neutral-400">
                      {currentAttendanceSummary?.warningCount ? `${currentAttendanceSummary.warningCount} al límite • ` : ''}
                      {currentAttendanceSummary?.alertCount ? `${currentAttendanceSummary.alertCount} en riesgo` : 'Regularidad óptima'}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Consolidated Annual Table */}
          <div
            className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="font-bold text-xs">Planilla Anual de {combinedTabLabel} ({courseStudents.length} estudiantes)</span>
                <button
                  type="button"
                  onClick={() => setIsManageConductModalOpen(true)}
                  className="p-1 rounded-md text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                  title="Cambiar el nombre de Asistencia o Disposición (ej: Concepto, Participación en clase)"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const headers = [
                      'Estudiante',
                      'Email',
                      'Ausencias 1C',
                      'Tardanzas 1C',
                      `${dispositionLabel} 1C`,
                      'Ausencias 2C',
                      'Tardanzas 2C',
                      `${dispositionLabel} 2C`,
                      'Total Ausencias',
                      'Total Tardanzas',
                      `Promedio ${dispositionLabel}`,
                      `% ${attendanceLabel}`,
                      'Condición',
                    ];
                    const rows = filteredStudents.map((s) => {
                      const m1 = getStudentMetrics(s.id, '1c');
                      const m2 = getStudentMetrics(s.id, '2c');
                      const tAbs = m1.totalAbsences + m2.totalAbsences;
                      const tLat = (m1.totalLates || 0) + (m2.totalLates || 0);
                      const aDisp = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
                      const tl = computeStudentAttendanceTrafficLight(s.id, tAbs, tLat, 'annual', attendanceSettings);
                      const est = tl.percentage;
                      const cond = tl.status === 'alert' || aDisp < 6 ? 'Alerta' : aDisp >= 8 && tl.percentage >= 85 ? 'Excelente' : 'Regular';
                      return [
                        `${s.lastName}, ${s.firstName}`,
                        s.email,
                        m1.totalAbsences,
                        m1.totalLates || 0,
                        m1.totalDisposition,
                        m2.totalAbsences,
                        m2.totalLates || 0,
                        m2.totalDisposition,
                        tAbs,
                        tLat,
                        aDisp,
                        `${est}%`,
                        cond,
                      ];
                    });
                    copyTableToClipboard(headers, rows);
                    setToastMessage('¡Planilla anual copiada al portapapeles para Google Sheets!');
                    setTimeout(() => setToastMessage(null), 3500);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Resumen Anual</span>
                </button>

                <button
                  type="button"
                  onClick={handleManualSheetsSync}
                  disabled={isSyncingSheet}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                  <span>Sincronizar Sheets</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className={`border-b font-semibold uppercase tracking-wider ${
                    isDarkMode ? 'bg-slate-850 border-slate-800 text-slate-300' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                  }`}
                >
                  <tr>
                    <th className="py-3 px-4">Estudiante</th>
                    <th className="py-3 px-3 text-center bg-blue-500/5 text-blue-700 dark:text-blue-300">
                      <div className="flex flex-col items-center">
                        <span>1° Cuatrimestre</span>
                        <span className="text-[10px] font-normal lowercase opacity-70">faltas / tard. / disp.</span>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
                      <div className="flex flex-col items-center">
                        <span>2° Cuatrimestre</span>
                        <span className="text-[10px] font-normal lowercase opacity-70">faltas / tard. / disp.</span>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center bg-purple-500/5 text-purple-700 dark:text-purple-300">
                      <div className="flex flex-col items-center">
                        <span>Totales Anuales</span>
                        <span className="text-[10px] font-normal lowercase opacity-70">faltas / tardanzas</span>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center">
                        <span>Promedio {dispositionLabel}</span>
                        <span className="text-[10px] font-normal lowercase opacity-70">escala 10</span>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center">Semáforo</th>
                    <th className="py-3 px-3 text-center">Condición</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-slate-800 font-medium">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-neutral-400">
                        No se encontraron estudiantes en este curso.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => {
                      const m1 = getStudentMetrics(student.id, '1c');
                      const m2 = getStudentMetrics(student.id, '2c');
                      const totalAbs = m1.totalAbsences + m2.totalAbsences;
                      const totalLat = (m1.totalLates || 0) + (m2.totalLates || 0);
                      const avgDisp = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
                      const tlAnnual = computeStudentAttendanceTrafficLight(
                        student.id,
                        totalAbs,
                        totalLat,
                        'annual',
                        attendanceSettings
                      );
                      const estAtt = tlAnnual.percentage;
                      const isAlert = tlAnnual.status === 'alert' || avgDisp < 6;

                      return (
                        <tr
                          key={student.id}
                          className={`group transition-colors ${
                            isDarkMode ? 'hover:bg-slate-850/50' : 'hover:bg-neutral-50'
                          }`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-600 font-bold flex items-center justify-center text-xs">
                                {student.firstName[0]}
                                {student.lastName[0]}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenStudentProfile(student)}
                                  className="font-bold text-neutral-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer text-left block"
                                  title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
                                >
                                  {student.lastName}, {student.firstName}
                                </button>
                                <a
                                  href={`?course=${activeCourse.id}&view=course_detail&studentId=${student.id}${userEmail ? `&authEmail=${encodeURIComponent(userEmail)}` : ''}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-all opacity-0 group-hover:opacity-100"
                                  title={`Abrir ficha y observaciones de ${student.lastName}, ${student.firstName} en otra pestaña`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            </div>
                          </td>

                          {/* 1C */}
                          <td className="py-3 px-3 text-center bg-blue-500/5">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEditAbsences(student, '1c')}
                                className="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                title="Faltas 1° Cuatrimestre (clic para editar)"
                              >
                                {m1.totalAbsences}F
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditAbsences(student, '1c')}
                                className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                title="Tardanzas 1° Cuatrimestre (clic para editar)"
                              >
                                {m1.totalLates || 0}T
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditDisposition(student, '1c')}
                                className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all hover:scale-105 shadow-2xs ${
                                  m1.totalDisposition >= 8
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                    : m1.totalDisposition >= 6
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                }`}
                                title="Disposición 1° Cuatrimestre (clic para editar)"
                              >
                                {m1.totalDisposition}
                              </button>
                            </div>
                          </td>

                          {/* 2C */}
                          <td className="py-3 px-3 text-center bg-emerald-500/5">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEditAbsences(student, '2c')}
                                className="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                title="Faltas 2° Cuatrimestre (clic para editar)"
                              >
                                {m2.totalAbsences}F
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditAbsences(student, '2c')}
                                className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer transition-all hover:scale-105"
                                title="Tardanzas 2° Cuatrimestre (clic para editar)"
                              >
                                {m2.totalLates || 0}T
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditDisposition(student, '2c')}
                                className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all hover:scale-105 shadow-2xs ${
                                  m2.totalDisposition >= 8
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                    : m2.totalDisposition >= 6
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                }`}
                                title="Disposición 2° Cuatrimestre (clic para editar)"
                              >
                                {m2.totalDisposition}
                              </button>
                            </div>
                          </td>

                          {/* Totales Anuales con Semáforo */}
                          <td className="py-3 px-3 text-center bg-purple-500/5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditAbsences(student)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 ${
                                tlAnnual.status === 'alert'
                                  ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800'
                                  : tlAnnual.status === 'warning'
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                              }`}
                              title={`Inasistencias anuales: ${totalAbs}. Semáforo: ${tlAnnual.statusLabel}. Hacé clic para editar faltas o clic en el nombre para ver el total detallado.`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  tlAnnual.status === 'alert'
                                    ? 'bg-red-500 animate-pulse'
                                    : tlAnnual.status === 'warning'
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                }`}
                              />
                              <span>{totalAbs} {totalAbs === 1 ? 'falta' : 'faltas'}</span>
                            </button>
                            {totalLat > 0 && (
                              <span className="font-semibold text-amber-600 dark:text-amber-400 text-xs ml-1.5">
                                • {totalLat} tard.
                              </span>
                            )}
                          </td>

                          {/* Promedio Disposición */}
                          <td className="py-3 px-3 text-center font-bold">
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs ${
                                avgDisp >= 8
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                                  : avgDisp >= 6
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                  : 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 border border-red-300 dark:border-red-700'
                              }`}
                            >
                              {avgDisp} / 10
                            </span>
                          </td>

                          {/* % Asistencia con Semáforo */}
                          <td className="py-3 px-3 text-center font-bold">
                            <button
                              type="button"
                              onClick={() => setIsAttendanceSettingsModalOpen(true)}
                              className="inline-flex items-center justify-center gap-1.5 hover:underline cursor-pointer group"
                              title={`Semáforo Anual: ${tlAnnual.statusLabel} • Asistió a ${tlAnnual.attendedClasses} de ${tlAnnual.totalClasses} clases anuales (${attendanceSettings.weeks1c + attendanceSettings.weeks2c} semanas • ${attendanceSettings.classesPerWeek} clases/sem.). Faltas computadas: ${tlAnnual.computedAbsences}. Máximo permitido: ${tlAnnual.maxAllowedAbsences} faltas. Hacé clic para configurar semanas o parámetros.`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  tlAnnual.status === 'regular'
                                    ? 'bg-emerald-500'
                                    : tlAnnual.status === 'warning'
                                    ? 'bg-amber-500'
                                    : 'bg-red-500 animate-pulse'
                                }`}
                              />
                              <span className={`text-xs ${tlAnnual.status === 'alert' ? 'text-red-600 dark:text-red-400' : tlAnnual.status === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {tlAnnual.status === 'alert' ? 'Riesgo' : tlAnnual.status === 'warning' ? 'Al límite' : 'Sin riesgo'}
                              </span>
                            </button>
                          </td>

                          {/* Condición */}
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                isAlert
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                                  : avgDisp >= 8 && estAtt >= 85
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  : 'bg-neutral-100 text-neutral-700 dark:bg-slate-800 dark:text-slate-300 border border-neutral-200 dark:border-slate-700'
                              }`}
                            >
                              {isAlert ? 'Alerta' : avgDisp >= 8 && estAtt >= 85 ? 'Excelente' : 'Regular'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Regular Roster Tab (1° Cuatrimestre or 2° Cuatrimestre) */
        <div>
          {/* Batch actions bar when students are selected */}
          {selectedStudentIds.length > 0 && (
            <div
              className={`mb-3 p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 ${
                isDarkMode
                  ? 'bg-indigo-950/40 border-indigo-800 text-indigo-200'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="font-semibold text-xs">
                  {selectedStudentIds.length} estudiante{selectedStudentIds.length > 1 ? 's' : ''} seleccionado{selectedStudentIds.length > 1 ? 's' : ''}
                </span>
                <span className="text-[11px] opacity-75">
                  (Puedes seleccionar varios para mandarles los mensajes juntos al final)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedStudentIds([])}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg hover:underline opacity-80 cursor-pointer"
                >
                  Deseleccionar
                </button>
                <button
                  type="button"
                  onClick={handleOpenBatchFromSelectedStudents}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar aviso a seleccionados ({selectedStudentIds.length})</span>
                </button>
              </div>
            </div>
          )}

          {/* Removed / Hidden Students Notice (Pareja Pedagógica) */}
          {removedStudentsList.length > 0 && (
            <div
              className={`mb-3 px-3.5 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                isDarkMode
                  ? 'bg-slate-900/80 border-slate-800 text-slate-300'
                  : 'bg-neutral-50 border-neutral-200 text-neutral-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-500 shrink-0" />
                <span>
                  <strong>Pareja pedagógica:</strong> {removedStudentsList.length} alumno{removedStudentsList.length > 1 ? 's' : ''} quitado{removedStudentsList.length > 1 ? 's' : ''} de la vista de esta materia.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsRemovedStudentsModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                    : 'bg-white hover:bg-amber-50 text-amber-700 border-amber-200 shadow-2xs'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ver / Restaurar alumnos ({removedStudentsList.length})</span>
              </button>
            </div>
          )}

          <div
            className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className={`border-b font-semibold uppercase tracking-wider ${
                    isDarkMode
                      ? 'bg-slate-850 border-slate-800 text-slate-300'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                  }`}
                >
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <button
                        type="button"
                        onClick={toggleSelectAllStudents}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        title={
                          selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0
                            ? 'Deseleccionar todos'
                            : 'Seleccionar todos los estudiantes'
                        }
                      >
                        {selectedStudentIds.length > 0 && selectedStudentIds.length === filteredStudents.length ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        ) : selectedStudentIds.length > 0 ? (
                          <div className="w-4 h-4 rounded border-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-600 font-bold leading-none">
                            -
                          </div>
                        ) : (
                          <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4">Estudiante</th>
                    <th className="py-3 px-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <span>{attendanceLabel}</span>
                        <button
                          type="button"
                          onClick={() => setIsManageConductModalOpen(true)}
                          className="p-0.5 rounded text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                          title="Cambiar el nombre de esta columna (ej: Presentismo, Asistencia)"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    </th>
                    <th className="py-3 px-4 text-center">
                      <span>Registrar {attendanceLabel.toLowerCase()}</span>
                    </th>
                    <th className="py-3 px-4 text-center">
                      <div className="inline-flex flex-col items-center gap-1">
                        <div className="inline-flex items-center gap-1">
                          <span>{dispositionLabel}</span>
                          <button
                            type="button"
                            onClick={() => setIsManageConductModalOpen(true)}
                            className="p-0.5 rounded text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                            title="Cambiar el nombre (ej: Concepto, Participación en clase, Disposición)"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsSendDispositionModalOpen(true)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950/80 dark:hover:bg-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 transition-all cursor-pointer shadow-2xs"
                          title={`Mandar notas de ${dispositionLabel.toLowerCase()} a Calificaciones (${activeConcreteTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`}
                        >
                          <Award className="w-3 h-3 text-amber-500" />
                          <span>Mandar a Calificaciones</span>
                        </button>
                      </div>
                    </th>
                    <th className="py-3 px-4">
                      <div className="flex items-center justify-between gap-2">
                        <span>Registrar {dispositionLabel.toLowerCase()}</span>
                        <button
                          type="button"
                          onClick={() => setIsManageConductModalOpen(true)}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:bg-slate-700'
                              : 'bg-white border-neutral-300 text-neutral-700 hover:text-blue-700 hover:border-blue-400 hover:bg-blue-50/50 shadow-2xs'
                          }`}
                          title="Personalizar el nombre (Concepto, Participación, etc.) y tus motivos rápidos"
                        >
                          <Settings className="w-3.5 h-3.5 text-blue-500" />
                          <span>Nombre y opciones ({teacherConductOptions.length})</span>
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 px-4 text-center">
                        <div className="max-w-md mx-auto flex flex-col items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                              isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-blue-50 text-blue-600'
                            }`}
                          >
                            <Users className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
                              No hay estudiantes cargados para esta materia
                            </h4>
                            <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                              ¿No usás Classroom? Podés agregar a tus alumnos manualmente con su correo para pasar asistencia de papel, registrar conducta y mandarles mensajes.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
                            <button
                              type="button"
                              onClick={handleOpenAddStudentModal}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                            >
                              <UserPlus className="w-4 h-4" />
                              <span>+ Agregar Alumnos Manualmente</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleSyncRoster}
                              disabled={isSyncingClassroomRoster}
                              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                                  : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200 shadow-2xs'
                              }`}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingClassroomRoster ? 'animate-spin' : ''}`} />
                              <span>{isSyncingClassroomRoster ? 'Sincronizando...' : 'Sincronizar desde Classroom'}</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => {
                      const metrics = getStudentMetrics(student.id);
                      const trafficLight = computeStudentAttendanceTrafficLight(
                        student.id,
                        metrics.totalAbsences,
                        metrics.totalLates || 0,
                        attendanceTerm,
                        attendanceSettings
                      );
                      const studentHistory = historyList.filter(
                        (h) => h.studentId === student.id && (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id)
                      );
                      const hasPendingAbsence = historyList.some(
                        (h) =>
                          h.courseId === activeCourse.id &&
                          h.studentId === student.id &&
                          h.category === 'Ausencia' &&
                          !h.messageSent &&
                          !h.omitNotification &&
                          h.notificationMethod !== 'omitted' &&
                          h.notificationMethod !== 'none'
                      );
                      const isSelected = selectedStudentIds.includes(student.id);

                      return (
                        <StudentAttendanceRow
                          key={student.id}
                          student={student}
                          isSelected={isSelected}
                          onToggleSelect={toggleSelectStudent}
                          metrics={metrics}
                          trafficLight={trafficLight}
                          observationsCount={studentObservations[student.id]?.length || 0}
                          hasPendingAbsence={hasPendingAbsence}
                          studentHistory={studentHistory}
                          teacherConductOptions={teacherConductOptions}
                          pulsingStudentId={pulsingStudentId}
                          onOpenProfile={handleOpenStudentProfile}
                          onOpenEditAbsences={handleOpenEditAbsences}
                          onOpenEditDisposition={handleOpenEditDisposition}
                          onOpenTrafficLightSettings={() => setIsAttendanceSettingsModalOpen(true)}
                          onAddAbsence={handleAddAbsence}
                          onRecordLateArrival={handleRecordLateArrival}
                          onDeleteLatestAbsence={handleDeleteLatestAbsence}
                          onDeleteLatestLate={handleDeleteLatestLate}
                          onRecordDispositionAction={handleRecordDispositionAction}
                          onOpenConductModal={onOpenConductModal}
                          onOpenStudentHistory={setSelectedStudentForHistory}
                          onDeleteStudent={setStudentToRemove}
                          isDarkMode={isDarkMode}
                        />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <PendingNotificationsInbox
            isDarkMode={isDarkMode}
            pendingAllItems={pendingAllItems}
            pendingAbsenceItems={pendingAbsenceItems}
            pendingConductItems={pendingConductItems}
            filteredPendingMessages={filteredPendingMessages}
            courseHistory={courseHistory}
            courseStudents={courseStudents}
            isPermHistoryCollapsed={isPermHistoryCollapsed}
            setIsPermHistoryCollapsed={setIsPermHistoryCollapsed}
            permHistoryCategory={(permHistoryCategory === 'Ausencia' || permHistoryCategory === 'Disposición') ? permHistoryCategory : 'all'}
            setPermHistoryCategory={setPermHistoryCategory as any}
            permHistorySearch={permHistorySearch}
            setPermHistorySearch={setPermHistorySearch}
            selectedPendingHistoryIds={selectedPendingHistoryIds}
            setSelectedPendingHistoryIds={setSelectedPendingHistoryIds}
            handleBatchMarkOmitNotification={handleBatchMarkOmitNotification}
            handleOpenBatchFromSelectedHistory={handleOpenBatchFromSelectedHistory}
            toggleSelectAllPendingHistory={toggleSelectAllPendingHistory}
            toggleSelectPendingHistory={toggleSelectPendingHistory}
            handleOpenNotifyModal={handleOpenNotifyModal}
            handleMarkOmitNotification={handleMarkOmitNotification}
            handleDeleteHistoryEntry={handleDeleteHistoryEntry}
            handleMarkAllPendingAsOmitted={handleMarkAllPendingAsOmitted}
            handleOpenBatchFromPending={(filter) =>
              handleOpenBatchFromPending(filter === 'Ausencia' ? 'absences' : filter === 'Disposición' ? 'conduct' : 'all')
            }
            setActiveTab={(tab) => setActiveTab(tab === 'attendance' ? 'roster' : tab)}
            setToastMessage={setToastMessage}
          />
        </div>
      )}
    </div>
  );
};
