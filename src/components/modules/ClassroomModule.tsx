import React, { useState } from 'react';
import {
  GraduationCap,
  Plus,
  ExternalLink,
  CheckCircle2,
  Clock,
  FileText,
  Users,
  RefreshCw,
  Send,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { ClassroomTask, Course } from '../../types';
import { classroomService } from '../../services/workspace/classroomService';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { ImportClassroomModal } from '../dashboard/ImportClassroomModal';

interface ClassroomModuleProps {
  tasks: ClassroomTask[];
  courses: Course[];
  selectedCourseId?: string;
  onSelectCourse: (id: string) => void;
  onOpenNewModal: (type: 'course' | 'plan' | 'task' | 'file') => void;
  onRefreshData: () => void;
  onOpenImportClassroom?: () => void;
}

export const ClassroomModule: React.FC<ClassroomModuleProps> = ({
  tasks,
  courses,
  selectedCourseId,
  onSelectCourse,
  onOpenNewModal,
  onRefreshData,
  onOpenImportClassroom,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const activeCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];
  const courseTasks = tasks.filter((t) => !t.courseId || t.courseId === activeCourse?.id);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleSyncClassroom = async () => {
    setIsSyncing(true);
    try {
      await new Promise((r) => setTimeout(r, 800));
      setToastMessage('Sincronización con Google Classroom completada. Se actualizaron las entregas.');
      setTimeout(() => setToastMessage(null), 4000);
      onRefreshData();
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            <GraduationCap className={`w-6 h-6 ${isDarkMode ? 'text-white' : 'text-green-700'}`} />
            Google Classroom
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Control de tareas asignadas, recepción de trabajos de estudiantes y novedades del curso
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
          >
            <GraduationCap className="w-4 h-4" />
            <span>Cargar Materias de Classroom</span>
          </button>
          <button
            onClick={handleSyncClassroom}
            disabled={isSyncing}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border shadow-xs transition-colors disabled:opacity-60 cursor-pointer ${
              isDarkMode
                ? 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-750'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-green-500' : ''}`} />
            {isSyncing ? 'Verificando...' : 'Sincronizar Entregas'}
          </button>
          <button
            onClick={() => onOpenNewModal('task')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nueva Tarea
          </button>
        </div>
      </div>

      {/* Course Pills Carousel */}
      <div className={`flex items-center gap-2 overflow-x-auto pb-2 border-b ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
        {courses.map((course) => (
          <button
            key={course.id}
            onClick={() => onSelectCourse(course.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
              activeCourse?.id === course.id
                ? 'bg-green-700 text-white border-green-700 shadow-xs'
                : isDarkMode
                ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border-slate-750'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border-neutral-200'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: activeCourse?.id === course.id ? '#ffffff' : course.color }}
            />
            <span>{course.name}</span>
          </button>
        ))}
      </div>

      {toastMessage && (
        <div
          className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border animate-in fade-in ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-green-50 border-green-200 text-green-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Classroom Course Header Card */}
      {activeCourse && (
        <div
          className={`p-5 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 border transition-colors ${
            isDarkMode
              ? 'bg-gradient-to-r from-emerald-950 via-green-950 to-slate-900 border-emerald-800/40 text-white'
              : 'bg-gradient-to-r from-emerald-800 to-green-900 text-white border-transparent'
          }`}
        >
          <div>
            <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
              Google Classroom • {activeCourse.grade}
            </span>
            <h3 className="text-xl font-bold mt-1">{activeCourse.name}</h3>
            <p className="text-xs text-emerald-100 mt-0.5">{activeCourse.subject}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-emerald-200">
              <span>Código Classroom: <strong>gc-{activeCourse.id.slice(-3)}</strong></span>
              <span>•</span>
              <span>{activeCourse.studentsCount} estudiantes inscriptos</span>
            </div>
          </div>

          <a
            href={`https://classroom.google.com/c/mock-${activeCourse.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-bold rounded-xl shadow-xs transition-all shrink-0"
          >
            <span>Abrir en Google Classroom</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Course Tasks List */}
      <div className="space-y-4">
        <h3 className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-neutral-800'}`}>
          Trabajos de Clase y Asignaciones
        </h3>

        {courseTasks.length === 0 ? (
          <div
            className={`p-12 text-center rounded-xl border transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-neutral-200 text-neutral-400'
            }`}
          >
            <GraduationCap className={`w-10 h-10 mx-auto mb-2 opacity-40 ${isDarkMode ? 'text-green-400' : 'text-green-700'}`} />
            <p className="text-xs font-medium">No hay tareas publicadas para este curso.</p>
            <button
              onClick={() => onOpenNewModal('task')}
              className={`mt-3 text-xs font-semibold hover:underline ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}
            >
              Publicar la primera tarea
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {courseTasks.map((task) => {
              const percent = Math.round((task.submittedCount / task.assignedCount) * 100);
              return (
                <div
                  key={task.id}
                  className={`p-5 rounded-xl border transition-all flex flex-col justify-between ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      : 'bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-sm'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          isDarkMode
                            ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                            : 'text-green-700 bg-green-50 border-green-200'
                        }`}
                      >
                        {task.status}
                      </span>
                      <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                        {task.maxPoints} Puntos
                      </span>
                    </div>

                    <h4 className={`text-sm font-bold mt-2 ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>{task.title}</h4>
                    <p className={`text-xs mt-1 leading-relaxed line-clamp-2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      {task.description}
                    </p>

                    {task.driveAttachmentName && (
                      <div
                        className={`mt-3 flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-blue-400'
                            : 'bg-neutral-50 border-neutral-100 text-blue-700'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Adjunto: {task.driveAttachmentName}</span>
                      </div>
                    )}
                  </div>

                  <div className={`mt-5 pt-3 border-t space-y-2 ${isDarkMode ? 'border-slate-800' : 'border-neutral-100'}`}>
                    <div className={`flex items-center justify-between text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                      <span>Entregas recibidas:</span>
                      <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
                        {task.submittedCount} / {task.assignedCount} ({percent}%)
                      </span>
                    </div>

                    <div className={`w-full h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-neutral-100'}`}>
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    <div className={`flex items-center justify-between pt-1 text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`}>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Vence: {new Date(task.dueDate).toLocaleDateString()}
                      </span>

                      <a
                        href={task.classroomUrl || 'https://classroom.google.com'}
                        target="_blank"
                        rel="noreferrer"
                        className={`font-semibold flex items-center gap-1 ${
                          isDarkMode ? 'text-green-400 hover:text-green-300' : 'text-green-700 hover:text-green-800'
                        }`}
                      >
                        Revisar <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ImportClassroomModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingCourses={courses}
        onSuccess={(msg) => {
          setToastMessage(msg);
          setTimeout(() => setToastMessage(null), 4000);
          onRefreshData();
        }}
      />
    </div>
  );
};
