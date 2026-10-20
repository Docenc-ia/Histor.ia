import React from 'react';
import {
  Pencil,
  Mail,
  ExternalLink,
  X,
  Settings,
  Loader2,
  Save,
  FileText,
  AlertCircle,
  Check,
  CheckCircle2,
  Award,
  Link,
  Plus,
  Trash2,
} from 'lucide-react';
import { Course, Student, StudentDispositionData, StudentObservation } from '../../../types';
import { GradeCategory } from '../../../types/grades';
import { DEFAULT_CATEGORIES } from '../GradebookMatrix';
import {
  AttendanceSettings,
  computeStudentAttendanceTrafficLight,
} from '../../../utils/attendanceCalculations';

interface StudentProfileObservationsModalProps {
  selectedStudentForProfile: Student | null;
  setSelectedStudentForProfile: (s: Student | null) => void;
  activeCourse: Course;
  user: any;
  isDarkMode: boolean;
  isEditingStudentEmail: boolean;
  setIsEditingStudentEmail: (v: boolean) => void;
  editedStudentEmail: string;
  setEditedStudentEmail: (v: string) => void;
  handleSaveEditedStudentEmail: () => void;
  handleOpenDirectMessageModal: (student: Student) => void;
  getStudentMetrics: (studentId: string, term?: '1c' | '2c' | 'annual') => StudentDispositionData;
  attendanceTerm: '1c' | '2c' | 'annual';
  attendanceSettings: AttendanceSettings;
  handleOpenEditAbsences: (student: Student) => void;
  setIsAttendanceSettingsModalOpen: (v: boolean) => void;
  handleOpenExportProfileDocConfirm: (student: Student) => void;
  isExportingProfileDoc: boolean;
  showProfileDocConfirm: boolean;
  setShowProfileDocConfirm: (v: boolean) => void;
  profileDocTitle: string;
  setProfileDocTitle: (v: string) => void;
  profileDocLinkToObs: boolean;
  setProfileDocLinkToObs: (v: boolean) => void;
  profileDocError: string | null;
  handleConfirmExportProfileToGoogleDoc: (
    student: Student,
    activeTl: any,
    currentDisp: number,
    metrics1c: StudentDispositionData,
    metrics2c: StudentDispositionData
  ) => void;
  exportedProfileDoc: { studentId: string; fileId?: string; name: string; webViewLink: string } | null;
  setExportedProfileDoc: (v: any) => void;
  newObservationText: string;
  setNewObservationText: (v: string) => void;
  newObservationUrl: string;
  setNewObservationUrl: (v: string) => void;
  handleSaveObservation: (student: Student) => void;
  studentObservations: Record<string, StudentObservation[]>;
  handleDeleteObservation: (studentId: string, obsId: string) => void;
  filteredStudents: Student[];
  handleNavigateProfileStudent: (direction: -1 | 1) => void;
  setCourseReportModalStudentId: (id: string | undefined) => void;
  setCourseReportModalTab: (tab: 'course' | 'individual') => void;
  setCourseReportModalOpen: (open: boolean) => void;
}

export const StudentProfileObservationsModal: React.FC<StudentProfileObservationsModalProps> = ({
  selectedStudentForProfile,
  setSelectedStudentForProfile,
  activeCourse,
  user,
  isDarkMode,
  isEditingStudentEmail,
  setIsEditingStudentEmail,
  editedStudentEmail,
  setEditedStudentEmail,
  handleSaveEditedStudentEmail,
  handleOpenDirectMessageModal,
  getStudentMetrics,
  attendanceTerm,
  attendanceSettings,
  handleOpenEditAbsences,
  setIsAttendanceSettingsModalOpen,
  handleOpenExportProfileDocConfirm,
  isExportingProfileDoc,
  showProfileDocConfirm,
  setShowProfileDocConfirm,
  profileDocTitle,
  setProfileDocTitle,
  profileDocLinkToObs,
  setProfileDocLinkToObs,
  profileDocError,
  handleConfirmExportProfileToGoogleDoc,
  exportedProfileDoc,
  setExportedProfileDoc,
  newObservationText,
  setNewObservationText,
  newObservationUrl,
  setNewObservationUrl,
  handleSaveObservation,
  studentObservations,
  handleDeleteObservation,
  filteredStudents,
  handleNavigateProfileStudent,
  setCourseReportModalStudentId,
  setCourseReportModalTab,
  setCourseReportModalOpen,
}) => {
  if (!selectedStudentForProfile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header: Datos del alumno */}
        <div
          className={`p-5 border-b flex items-start justify-between gap-4 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/80' : 'border-neutral-200 bg-neutral-50/70'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <img
              src={selectedStudentForProfile.avatar}
              alt={selectedStudentForProfile.firstName}
              className={`w-14 h-14 rounded-2xl object-cover border-2 shadow-xs shrink-0 ${
                isDarkMode ? 'border-indigo-500/40' : 'border-indigo-200'
              }`}
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold">
                  {selectedStudentForProfile.lastName}, {selectedStudentForProfile.firstName}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Ficha del Alumno
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {!isEditingStudentEmail ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-neutral-500 dark:text-slate-400 font-mono">
                      {selectedStudentForProfile.email || 'Sin correo registrado'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditedStudentEmail(selectedStudentForProfile.email || '');
                        setIsEditingStudentEmail(true);
                      }}
                      className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                      title="Modificar correo electrónico"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>Editar correo</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="email"
                      value={editedStudentEmail}
                      onChange={(e) => setEditedStudentEmail(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      className="px-2 py-0.5 text-xs rounded border border-blue-400 bg-white dark:bg-slate-800 text-neutral-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleSaveEditedStudentEmail}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white cursor-pointer"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingStudentEmail(false)}
                      className="px-1.5 py-0.5 rounded text-[10px] text-neutral-400 hover:text-neutral-600 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenDirectMessageModal(selectedStudentForProfile)}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:hover:bg-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer shadow-2xs"
                >
                  <Mail className="w-3 h-3 text-blue-500" />
                  <span>Enviar mensaje</span>
                </button>
              </div>
              {activeCourse && (
                <p className="text-xs text-neutral-600 dark:text-slate-300 mt-1 font-medium">
                  Materia: <span className="font-semibold">{activeCourse.name}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`?course=${activeCourse.id}&view=course_detail&studentId=${selectedStudentForProfile.id}${
                user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''
              }`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-700/60'
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
              }`}
              title="Abrir la ficha y observaciones de este estudiante en una pestaña o ventana aparte"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Abrir en otra pestaña</span>
            </a>
            <button
              type="button"
              onClick={() => setSelectedStudentForProfile(null)}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Cerrar ficha"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Resumen completo de asistencia, semáforo y conducta */}
        {(() => {
          const metrics1c = getStudentMetrics(selectedStudentForProfile.id, '1c');
          const metrics2c = getStudentMetrics(selectedStudentForProfile.id, '2c');
          const currentMetrics = getStudentMetrics(selectedStudentForProfile.id, attendanceTerm);
          const currentDisp = currentMetrics.totalDisposition;

          const totalAbsAnnual = metrics1c.totalAbsences + metrics2c.totalAbsences;
          const totalLatesAnnual = (metrics1c.totalLates || 0) + (metrics2c.totalLates || 0);

          const tlCurrent = computeStudentAttendanceTrafficLight(
            selectedStudentForProfile.id,
            currentMetrics.totalAbsences,
            currentMetrics.totalLates || 0,
            attendanceTerm,
            attendanceSettings
          );

          const tlAnnual = computeStudentAttendanceTrafficLight(
            selectedStudentForProfile.id,
            totalAbsAnnual,
            totalLatesAnnual,
            'annual',
            attendanceSettings
          );

          const activeTl = attendanceTerm === 'annual' ? tlAnnual : tlCurrent;

          const statusColor =
            activeTl.status === 'alert'
              ? {
                  bg: isDarkMode ? 'bg-red-950/40' : 'bg-red-50',
                  border: isDarkMode ? 'border-red-900/60' : 'border-red-200',
                  text: isDarkMode ? 'text-red-300' : 'text-red-700',
                  dot: 'bg-red-500 animate-pulse',
                  badge: isDarkMode
                    ? 'bg-red-900/60 text-red-200 border-red-800'
                    : 'bg-red-100 text-red-800 border-red-300',
                }
              : activeTl.status === 'warning'
              ? {
                  bg: isDarkMode ? 'bg-amber-950/40' : 'bg-amber-50',
                  border: isDarkMode ? 'border-amber-900/60' : 'border-amber-200',
                  text: isDarkMode ? 'text-amber-300' : 'text-amber-700',
                  dot: 'bg-amber-500',
                  badge: isDarkMode
                    ? 'bg-amber-900/60 text-amber-200 border-amber-800'
                    : 'bg-amber-100 text-amber-800 border-amber-300',
                }
              : {
                  bg: isDarkMode ? 'bg-emerald-950/40' : 'bg-emerald-50',
                  border: isDarkMode ? 'border-emerald-900/60' : 'border-emerald-200',
                  text: isDarkMode ? 'text-emerald-300' : 'text-emerald-700',
                  dot: 'bg-emerald-500',
                  badge: isDarkMode
                    ? 'bg-emerald-900/60 text-emerald-200 border-emerald-800'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300',
                };

          return (
            <div
              className={`px-5 py-4 border-b space-y-3 ${
                isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-white'
              }`}
            >
              {/* Semáforo y Total Asistencia Card */}
              <div className={`p-3.5 rounded-2xl border transition-all ${statusColor.bg} ${statusColor.border}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-black/5 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${statusColor.dot}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${statusColor.text}`}>
                          Asistencia: {activeTl.percentage}%
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusColor.badge}`}>
                          {activeTl.statusLabel}
                        </span>
                      </div>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                        Período:{' '}
                        {attendanceTerm === 'annual'
                          ? 'Ciclo Lectivo Completo'
                          : attendanceTerm === '1c'
                          ? '1° Cuatrimestre'
                          : '2° Cuatrimestre'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenEditAbsences(selectedStudentForProfile)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-neutral-100 dark:hover:bg-slate-700 border border-neutral-300 dark:border-slate-700 text-neutral-700 dark:text-slate-200 shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5"
                      title="Editar ausencias o llegadas tarde de este alumno"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Editar Faltas</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsAttendanceSettingsModalOpen(true)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-neutral-100 dark:hover:bg-slate-700 border border-neutral-300 dark:border-slate-700 text-neutral-700 dark:text-slate-200 shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5"
                      title="Ajustar semanas del calendario y parámetros"
                    >
                      <Settings className="w-3 h-3 text-blue-500" />
                      <span>Semanas</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenExportProfileDocConfirm(selectedStudentForProfile)}
                      disabled={isExportingProfileDoc}
                      className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5"
                      title="Guardar esta ficha de seguimiento directamente en Google Drive como un documento nativo y editable (.gdoc)"
                    >
                      {isExportingProfileDoc ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Guardar en Drive (.gdoc)</span>
                    </button>
                  </div>
                </div>

                {/* Breakdown de totales */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 text-center">
                  <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-black/5 dark:border-white/5">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">
                      Clases Totales
                    </span>
                    <span className="text-base font-bold text-neutral-900 dark:text-slate-100">
                      {activeTl.totalClasses}
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      {activeTl.attendedClasses} asistidas
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-black/5 dark:border-white/5">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">
                      Inasistencias Totales
                    </span>
                    <span
                      className={`text-base font-bold ${
                        activeTl.status === 'alert'
                          ? 'text-red-600 dark:text-red-400'
                          : activeTl.status === 'warning'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {totalAbsAnnual}
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      1°C: {metrics1c.totalAbsences} • 2°C: {metrics2c.totalAbsences}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-black/5 dark:border-white/5">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">
                      Límite Permitido
                    </span>
                    <span className="text-base font-bold text-neutral-800 dark:text-slate-200">
                      {activeTl.maxAllowedAbsences}
                    </span>
                    <span
                      className={`text-[10px] font-semibold block ${
                        activeTl.remainingAbsences >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {activeTl.remainingAbsences >= 0
                        ? `Quedan ${activeTl.remainingAbsences} faltas`
                        : `Excedido por ${Math.abs(activeTl.remainingAbsences)}`}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-black/5 dark:border-white/5">
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400 block font-medium">
                      Disposición
                    </span>
                    <span
                      className={`text-base font-bold ${
                        currentDisp >= 8
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : currentDisp >= 6
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {currentDisp} / 10
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      1°C: {metrics1c.totalDisposition} • 2°C: {metrics2c.totalDisposition}
                    </span>
                  </div>
                </div>

                {/* Panel de confirmación para exportar la Ficha de Seguimiento como Google Doc (.gdoc) */}
                {showProfileDocConfirm && (
                  <div
                    className={`mt-3 p-3.5 rounded-xl border space-y-2.5 animate-in fade-in duration-150 ${
                      isDarkMode
                        ? 'bg-slate-900 border-emerald-700/70 text-slate-100'
                        : 'bg-white border-emerald-300 text-neutral-900 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-bold">
                          Crear Documento Google Doc (.gdoc) editable en Google Drive
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowProfileDocConfirm(false)}
                        className="text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-[11px] text-neutral-600 dark:text-slate-300 leading-relaxed">
                      Se generará un documento nativo de <strong>Google Docs (.gdoc)</strong> en la carpeta de Drive de{' '}
                      <strong>{activeCourse?.name || 'la materia'}</strong> con asistencia, calificaciones de exámenes/TPs,
                      observaciones, historial y espacio editable para acuerdos docentes.
                    </p>

                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                        Nombre del archivo en Google Drive:
                      </label>
                      <input
                        type="text"
                        value={profileDocTitle}
                        onChange={(e) => setProfileDocTitle(e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs outline-hidden focus:ring-2 focus:ring-emerald-500 ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-white'
                            : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                        }`}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-[11px] text-neutral-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={profileDocLinkToObs}
                        onChange={(e) => setProfileDocLinkToObs(e.target.checked)}
                        className="rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Dejar vinculado el enlace del Google Doc en las Observaciones de esta ficha</span>
                    </label>

                    {profileDocError && (
                      <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-[11px] text-red-700 dark:text-red-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{profileDocError}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowProfileDocConfirm(false)}
                        disabled={isExportingProfileDoc}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={isExportingProfileDoc}
                        onClick={() =>
                          handleConfirmExportProfileToGoogleDoc(
                            selectedStudentForProfile,
                            activeTl,
                            currentDisp,
                            metrics1c,
                            metrics2c
                          )
                        }
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {isExportingProfileDoc ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Creando Google Doc en Drive...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Confirmar y crear Google Doc</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Banner de éxito con acceso directo para editar el .gdoc recién creado */}
                {exportedProfileDoc && exportedProfileDoc.studentId === selectedStudentForProfile.id && (
                  <div
                    className={`mt-3 p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in fade-in duration-150 ${
                      isDarkMode
                        ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          Documento Google Doc (.gdoc) creado en tu Google Drive
                        </p>
                        <p className="text-[10px] opacity-80 truncate">{exportedProfileDoc.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={exportedProfileDoc.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs inline-flex items-center gap-1.5 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir y editar en Google Docs</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => setExportedProfileDoc(null)}
                        className="p-1 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200/50 dark:hover:bg-emerald-900/50 cursor-pointer"
                        title="Cerrar aviso"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Scrollable Content: Calificaciones, Observaciones e Informes */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Resumen de Notas de Exámenes y TPs de la pestaña Calificaciones */}
          {activeCourse &&
            (() => {
              const loadTermExams = (term: '1c' | '2c') => {
                try {
                  const catRaw =
                    localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}_${term}`) ||
                    (term === '1c' ? localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}`) : null) ||
                    localStorage.getItem(`fds_grade_categories_v1_${activeCourse.id}_${term}`) ||
                    (term === '1c' ? localStorage.getItem(`fds_grade_categories_v1_${activeCourse.id}`) : null);
                  const cats: GradeCategory[] = catRaw ? JSON.parse(catRaw) : DEFAULT_CATEGORIES;

                  const gradesRaw =
                    localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}_${term}`) ||
                    (term === '1c' ? localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}`) : null) ||
                    localStorage.getItem(`fds_student_grades_v1_${activeCourse.id}_${term}`) ||
                    (term === '1c' ? localStorage.getItem(`fds_student_grades_v1_${activeCourse.id}`) : null);
                  const gMap: Record<string, Record<string, string | number>> = gradesRaw ? JSON.parse(gradesRaw) : {};
                  const stGrades = gMap[selectedStudentForProfile.id] || {};

                  const items: { id: string; name: string; weight: number; score: number | null }[] = [];
                  for (const cat of cats) {
                    if (cat.id === 'cat-conceptual' || /disposici[oó]n|conducta/i.test(cat.name)) continue;
                    for (const sub of cat.subcategories || []) {
                      const rawVal = stGrades[sub.id];
                      const parsedNum =
                        rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                          ? Number(String(rawVal).replace(',', '.'))
                          : NaN;
                      items.push({
                        id: sub.id,
                        name: sub.name,
                        weight: (sub as any).weight ?? cat.weight ?? 0,
                        score: !isNaN(parsedNum) ? parsedNum : null,
                      });
                    }
                  }
                  return items;
                } catch {
                  return [];
                }
              };

              const exams1c = loadTermExams('1c');
              const exams2c = loadTermExams('2c');
              const hasAnyExamScore =
                exams1c.some((e) => e.score !== null) || exams2c.some((e) => e.score !== null);

              return (
                <div
                  className={`p-3.5 rounded-2xl border space-y-2.5 ${
                    isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-emerald-50/40 border-emerald-200/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-bold text-neutral-900 dark:text-slate-100">
                        Notas de Exámenes y Trabajos Prácticos (Calificaciones)
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Incluidas en Ficha PDF / Google Doc
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div
                      className={`p-2.5 rounded-xl border ${
                        isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200/80'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5 border-b border-neutral-100 dark:border-slate-800 pb-1">
                        1° Cuatrimestre
                      </div>
                      <div className="space-y-1">
                        {exams1c.map((item) => (
                          <div key={`prof-1c-${item.id}`} className="flex items-center justify-between text-[11px]">
                            <span className="text-neutral-600 dark:text-slate-300 truncate pr-2">
                              {item.name} <span className="text-[10px] text-neutral-400">({item.weight}%)</span>
                            </span>
                            <span
                              className={`font-bold px-1.5 py-0.5 rounded ${
                                item.score === null
                                  ? 'text-neutral-400 dark:text-slate-500'
                                  : item.score >= 7
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                  : item.score >= 4
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                  : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                              }`}
                            >
                              {item.score !== null ? item.score : 'S/C'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${
                        isDarkMode ? 'bg-slate-900/70 border-slate-700/80' : 'bg-white border-neutral-200/80'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5 border-b border-neutral-100 dark:border-slate-800 pb-1">
                        2° Cuatrimestre
                      </div>
                      <div className="space-y-1">
                        {exams2c.map((item) => (
                          <div key={`prof-2c-${item.id}`} className="flex items-center justify-between text-[11px]">
                            <span className="text-neutral-600 dark:text-slate-300 truncate pr-2">
                              {item.name} <span className="text-[10px] text-neutral-400">({item.weight}%)</span>
                            </span>
                            <span
                              className={`font-bold px-1.5 py-0.5 rounded ${
                                item.score === null
                                  ? 'text-neutral-400 dark:text-slate-500'
                                  : item.score >= 7
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                  : item.score >= 4
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                  : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                              }`}
                            >
                              {item.score !== null ? item.score : 'S/C'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {!hasAnyExamScore && (
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400 italic">
                      Aún no se cargaron notas de exámenes o TPs en la pestaña Calificaciones para este estudiante.
                    </p>
                  )}
                </div>
              );
            })()}

          {/* Formulario Agregar Observación */}
          <div
            className={`p-3.5 rounded-2xl border space-y-2.5 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-indigo-50/40 border-indigo-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="font-bold text-neutral-900 dark:text-slate-100">
                Agregar Observación o Informe
              </span>
            </div>

            <div className="space-y-2">
              <textarea
                rows={2}
                value={newObservationText}
                onChange={(e) => setNewObservationText(e.target.value)}
                placeholder="Escribí una observación (ej: Presentó informe psicopedagógico con adecuaciones, observación de conducta, acuerdo con la familia)..."
                className={`w-full px-3 py-2 rounded-xl border text-xs outline-hidden resize-none transition-all focus:ring-2 focus:ring-indigo-500 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                }`}
              />

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Link className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={newObservationUrl}
                    onChange={(e) => setNewObservationUrl(e.target.value)}
                    placeholder="Pegar enlace al informe (ej: Google Drive, Docs, PDF) - opcional"
                    className={`w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  disabled={!newObservationText.trim() && !newObservationUrl.trim()}
                  onClick={() => handleSaveObservation(selectedStudentForProfile)}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center gap-1 active:scale-95 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Observaciones Guardadas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-neutral-800 dark:text-slate-200 flex items-center gap-1.5">
                <span>Observaciones registradas</span>
                <span className="text-[11px] font-normal text-neutral-400">
                  ({studentObservations[selectedStudentForProfile.id]?.length || 0})
                </span>
              </h4>
            </div>

            {!studentObservations[selectedStudentForProfile.id] ||
            studentObservations[selectedStudentForProfile.id].length === 0 ? (
              <div className="py-6 text-center text-neutral-400 dark:text-slate-500 border border-dashed rounded-xl p-4">
                <p className="text-xs">No hay observaciones registradas para este estudiante.</p>
                <p className="text-[11px] opacity-75 mt-0.5">
                  Podés escribir anotaciones de conducta o pegar el enlace a su informe psicopedagógico arriba.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {studentObservations[selectedStudentForProfile.id].map((obs) => (
                  <div
                    key={obs.id}
                    className={`p-3 rounded-xl border transition-all ${
                      isDarkMode
                        ? 'bg-slate-800/40 border-slate-700/80 hover:bg-slate-800/60'
                        : 'bg-white border-neutral-200 hover:border-neutral-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] text-neutral-400 dark:text-slate-500 font-medium">
                        📅 {obs.date}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteObservation(selectedStudentForProfile.id, obs.id)}
                        className="text-neutral-400 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar observación"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {obs.text && (
                      <p className="text-xs text-neutral-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {obs.text}
                      </p>
                    )}

                    {obs.reportUrl && (
                      <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-slate-700/60 flex items-center justify-between gap-2">
                        <a
                          href={obs.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 transition-colors shadow-2xs"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Abrir informe / documento</span>
                        </a>
                        <span className="text-[10px] text-neutral-400 truncate max-w-[200px]" title={obs.reportUrl}>
                          {obs.reportUrl}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer con Navegación entre alumnos */}
        {(() => {
          const currentIndex = filteredStudents.findIndex((s) => s.id === selectedStudentForProfile.id);
          const hasPrev = currentIndex > 0;
          const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

          return (
            <div
              className={`p-4 border-t flex items-center justify-between gap-2 ${
                isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50/60'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => handleNavigateProfileStudent(-1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ver ficha del alumno anterior"
                >
                  ← Anterior
                </button>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400 font-medium px-1">
                  {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => handleNavigateProfileStudent(1)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Ver ficha del alumno siguiente"
                >
                  Siguiente →
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleOpenExportProfileDocConfirm(selectedStudentForProfile)}
                  disabled={isExportingProfileDoc}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                  title="Guardar directamente esta ficha de seguimiento en Google Drive como un documento editable (.gdoc)"
                >
                  {isExportingProfileDoc ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  ) : (
                    <Save className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>Guardar en Drive (.gdoc)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCourseReportModalStudentId(selectedStudentForProfile.id);
                    setCourseReportModalTab('individual');
                    setCourseReportModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 transition-colors cursor-pointer"
                  title="Personalizar secciones del informe o citación a la familia"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Personalizar Informe</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedStudentForProfile(null)}
                  className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold shadow-xs cursor-pointer transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
