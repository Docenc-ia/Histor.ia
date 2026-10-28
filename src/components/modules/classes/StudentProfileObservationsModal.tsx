import React, { useState } from 'react';
import {
  Pencil,
  Mail,
  ExternalLink,
  X,
  FileText,
  Link,
  Plus,
  Trash2,
  GraduationCap,
  Sparkles,
  BookOpen,
  Calendar,
  Layers,
  Cloud,
} from 'lucide-react';
import { Course, Student, StudentDispositionData, StudentObservation } from '../../../types';
import { AttendanceSettings } from '../../../utils/attendanceCalculations';

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
  getStudentMetrics?: (studentId: string, term?: '1c' | '2c' | 'annual') => StudentDispositionData;
  attendanceTerm?: '1c' | '2c' | 'annual';
  attendanceSettings?: AttendanceSettings;
  handleOpenEditAbsences?: (student: Student) => void;
  setIsAttendanceSettingsModalOpen?: (v: boolean) => void;
  handleOpenExportProfileDocConfirm?: (student: Student) => void;
  isExportingProfileDoc?: boolean;
  showProfileDocConfirm?: boolean;
  setShowProfileDocConfirm?: (v: boolean) => void;
  profileDocTitle?: string;
  setProfileDocTitle?: (v: string) => void;
  profileDocLinkToObs?: boolean;
  setProfileDocLinkToObs?: (v: boolean) => void;
  profileDocError?: string | null;
  handleConfirmExportProfileToGoogleDoc?: (
    student: Student,
    activeTl: any,
    currentDisp: number,
    metrics1c: StudentDispositionData,
    metrics2c: StudentDispositionData
  ) => void;
  exportedProfileDoc?: { studentId: string; fileId?: string; name: string; webViewLink: string } | null;
  setExportedProfileDoc?: (v: any) => void;
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
  onDeleteStudent?: (student: Student) => void;
}

const QUICK_TAGS = [
  'Informe Psicopedagógico / Adaptación',
  'Observación Pedagógica',
  'Seguimiento Académico',
  'Acuerdo con la Familia',
  'Conducta y Convivencia',
];

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
  onDeleteStudent,
}) => {
  const [selectedTag, setSelectedTag] = useState<string>('');

  if (!selectedStudentForProfile) return null;

  const targetCourseId = activeCourse?.id || selectedStudentForProfile.courseId;
  const currentObservations = (studentObservations[selectedStudentForProfile.id] || []).filter(
    (obs) => !obs.courseId || !targetCourseId || obs.courseId === targetCourseId
  );

  const handleApplyTag = (tag: string) => {
    setSelectedTag(tag);
    if (!newObservationText.startsWith(`[${tag}]`)) {
      setNewObservationText(`[${tag}] ${newObservationText}`.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header: Datos del alumno */}
        <div
          className={`px-6 py-5 border-b flex items-start justify-between gap-4 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              <img
                src={selectedStudentForProfile.avatar}
                alt={selectedStudentForProfile.firstName}
                className={`w-16 h-16 rounded-2xl object-cover border-2 shadow-sm ${
                  isDarkMode ? 'border-indigo-500/40 bg-slate-800' : 'border-indigo-200 bg-neutral-100'
                }`}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="w-16 h-16 rounded-2xl border-2 flex items-center justify-center font-bold text-lg text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:border-indigo-800/80 -z-10 absolute inset-0">
                {selectedStudentForProfile.lastName?.[0] || ''}
                {selectedStudentForProfile.firstName?.[0] || ''}
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-xl font-bold tracking-tight truncate">
                  {selectedStudentForProfile.lastName}, {selectedStudentForProfile.firstName}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/90 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>Ficha del Alumno</span>
                </span>
                {activeCourse && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-200/70 dark:bg-slate-800 text-neutral-700 dark:text-slate-300 border border-neutral-300/60 dark:border-slate-700 flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{activeCourse.name}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-2 flex-wrap">
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
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer font-medium"
                      title="Modificar correo electrónico del alumno"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Editar correo</span>
                    </button>

                    {onDeleteStudent && (
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteStudent(selectedStudentForProfile);
                          setSelectedStudentForProfile(null);
                        }}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1 cursor-pointer font-medium ml-2"
                        title="Quitar a este alumno de la lista de la materia en esta app"
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                        <span>Quitar de la materia</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="email"
                      value={editedStudentEmail}
                      onChange={(e) => setEditedStudentEmail(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      className="px-2.5 py-1 text-xs rounded-lg border border-blue-400 bg-white dark:bg-slate-800 text-neutral-900 dark:text-white outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveEditedStudentEmail}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors shadow-2xs"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingStudentEmail(false)}
                      className="px-2 py-1 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenDirectMessageModal(selectedStudentForProfile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:hover:bg-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer shadow-2xs"
                >
                  <Mail className="w-3.5 h-3.5 text-blue-500" />
                  <span>Enviar mensaje</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`?course=${activeCourse?.id || ''}&view=course_detail&studentId=${selectedStudentForProfile.id}${
                user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''
              }`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-700/60'
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
              }`}
              title="Abrir la ficha y observaciones de este estudiante en una pestaña aparte"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Abrir en otra pestaña</span>
            </a>
            <button
              type="button"
              onClick={() => setSelectedStudentForProfile(null)}
              className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Cerrar ficha"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banner orientador: sólo observaciones e informe pedagógico */}
        <div
          className={`px-6 py-2.5 border-b text-xs flex items-center justify-between gap-3 ${
            isDarkMode ? 'bg-indigo-950/30 border-slate-800 text-indigo-200' : 'bg-indigo-50/70 border-indigo-100 text-indigo-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
            <p className="truncate">
              <strong>Seguimiento e Informes Pedagógicos:</strong> Registrá aquí acuerdos, adaptaciones curriculares, o vinculá el enlace a su informe psicopedagógico.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCourseReportModalStudentId(selectedStudentForProfile.id);
              setCourseReportModalTab('individual');
              setCourseReportModalOpen(true);
            }}
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 inline-flex items-center gap-1"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Ver Asistencias y Notas en Generar Informe →</span>
          </button>
        </div>

        {/* Scrollable Content: Observaciones e Informes Pedagógicos */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Formulario Agregar Observación / Informe */}
          <div
            className={`p-5 rounded-2xl border space-y-3.5 shadow-sm transition-all ${
              isDarkMode ? 'bg-slate-800/50 border-slate-700/80' : 'bg-neutral-50/70 border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="font-bold text-neutral-900 dark:text-slate-100 text-sm">
                  Registrar Observación o Informe Pedagógico
                </span>
              </div>
              <span className="text-xs text-neutral-500 dark:text-slate-400">
                Se guardan con fecha y quedan disponibles para los informes
              </span>
            </div>

            {/* Tags rápidos para clasificar la observación */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium mr-1">Etiqueta rápida:</span>
              {QUICK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleApplyTag(tag)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    selectedTag === tag
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <textarea
                rows={4}
                value={newObservationText}
                onChange={(e) => setNewObservationText(e.target.value)}
                placeholder="Escribí aquí las observaciones del estudiante (ej: Presentó informe psicopedagógico con adecuaciones, seguimiento de aprendizaje, acuerdos familiares o de convivencia)..."
                className={`w-full p-3.5 rounded-xl border text-sm outline-hidden resize-none transition-all focus:ring-2 focus:ring-indigo-500 leading-relaxed ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                }`}
              />

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <Link className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={newObservationUrl}
                    onChange={(e) => setNewObservationUrl(e.target.value)}
                    placeholder="Enlace al informe pedagógico o archivo (Google Drive, Docs, PDF) - opcional"
                    className={`w-full pl-9 pr-3.5 py-2 rounded-xl border text-xs outline-hidden transition-all focus:ring-2 focus:ring-indigo-500 ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                        : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 shadow-2xs'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  disabled={!newObservationText.trim() && !newObservationUrl.trim()}
                  onClick={() => {
                    handleSaveObservation(selectedStudentForProfile);
                    setSelectedTag('');
                  }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 active:scale-95 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Guardar Observación</span>
                </button>
              </div>
            </div>
          </div>

          {/* Historial de Observaciones Guardadas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-bold text-neutral-800 dark:text-slate-200 text-base flex items-center gap-2">
                <span>Historial de Observaciones e Informes</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-neutral-200 dark:bg-slate-800 text-neutral-600 dark:text-slate-300">
                  {currentObservations.length}
                </span>
              </h4>
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                title="Las observaciones se sincronizan automáticamente con Firebase Firestore en la nube"
              >
                <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Sincronizado con Firestore</span>
              </div>
            </div>

            {currentObservations.length === 0 ? (
              <div className="py-12 px-6 text-center text-neutral-400 dark:text-slate-500 border border-dashed rounded-2xl p-6 bg-neutral-50/40 dark:bg-slate-900/40 space-y-2">
                <FileText className="w-10 h-10 mx-auto text-neutral-300 dark:text-slate-600 mb-1" />
                <p className="text-sm font-semibold text-neutral-700 dark:text-slate-300">
                  No hay observaciones registradas para {selectedStudentForProfile.firstName}
                </p>
                <p className="text-xs text-neutral-500 dark:text-slate-400 max-w-md mx-auto">
                  Utilizá el formulario superior para anotar observaciones de seguimiento pedagógico, adaptaciones o pegar el enlace a informes psicopedagógicos.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {currentObservations.map((obs) => (
                  <div
                    key={obs.id}
                    className={`p-4 rounded-2xl border transition-all shadow-2xs ${
                      isDarkMode
                        ? 'bg-slate-800/40 border-slate-700/80 hover:bg-slate-800/60'
                        : 'bg-white border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium inline-flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                          <span>{obs.date}</span>
                        </span>
                        {obs.text?.startsWith('[') && obs.text.includes(']') && (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {obs.text.substring(1, obs.text.indexOf(']'))}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteObservation(selectedStudentForProfile.id, obs.id)}
                        className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/40"
                        title="Eliminar observación"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {obs.text && (
                      <p className="text-sm text-neutral-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {obs.text.startsWith('[') && obs.text.includes(']')
                          ? obs.text.substring(obs.text.indexOf(']') + 1).trim()
                          : obs.text}
                      </p>
                    )}

                    {obs.reportUrl && (
                      <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-slate-700/60 flex items-center justify-between gap-3 flex-wrap">
                        <a
                          href={obs.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 transition-colors shadow-2xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Abrir informe / documento adjunto</span>
                        </a>
                        <span className="text-xs text-neutral-400 truncate max-w-xs font-mono" title={obs.reportUrl}>
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

        {/* Footer con Navegación entre alumnos y acciones */}
        {(() => {
          const currentIndex = filteredStudents.findIndex((s) => s.id === selectedStudentForProfile.id);
          const hasPrev = currentIndex > 0;
          const hasNext = currentIndex !== -1 && currentIndex < filteredStudents.length - 1;

          return (
            <div
              className={`px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
                isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-neutral-200 bg-neutral-50/70'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => handleNavigateProfileStudent(-1)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                  title="Ver ficha del alumno anterior"
                >
                  ← Anterior
                </button>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-semibold px-2">
                  {currentIndex !== -1 ? `${currentIndex + 1} de ${filteredStudents.length}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => handleNavigateProfileStudent(1)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                  title="Ver ficha del alumno siguiente"
                >
                  Siguiente →
                </button>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setCourseReportModalStudentId(selectedStudentForProfile.id);
                    setCourseReportModalTab('individual');
                    setCourseReportModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer shadow-2xs"
                  title="Generar informe completo individual (con asistencia, notas y observaciones consolidadas)"
                >
                  <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Generar Informe Completo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedStudentForProfile(null)}
                  className="px-5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold shadow-xs cursor-pointer transition-colors"
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
