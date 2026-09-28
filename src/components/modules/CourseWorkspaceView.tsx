import React, { useState } from 'react';
import {
  ArrowLeft,
  Users,
  Trash2
} from 'lucide-react';
import { Course, Student } from '../../types';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { formatCourseSidebarLabel } from '../../utils/courseFormatting';
import { ClassesModule } from './ClassesModule';

export type CourseTabType = 'alumnos';

interface CourseWorkspaceViewProps {
  course: Course;
  courses: Course[];
  students?: Student[];
  activeTab?: string;
  onTabChange?: (tab: CourseTabType) => void;
  onBackToCourses: () => void;
  onSelectCourse: (courseId: string) => void;
  onDeleteCourse?: (courseId: string) => Promise<void> | void;
  onRefreshData?: () => void;
  onNavigate?: (tab: string, filterCourseId?: string) => void;
  onOpenNewModal?: (type: 'course' | 'plan' | 'task' | 'file') => void;
}

export const CourseWorkspaceView: React.FC<CourseWorkspaceViewProps> = ({
  course,
  courses,
  students = [],
  onBackToCourses,
  onSelectCourse,
  onDeleteCourse,
  onRefreshData = () => {},
  onNavigate = () => {},
  onOpenNewModal,
}) => {
  const { user, isDarkMode } = useWorkspaceAuth();
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const schoolName = user?.school || 'Institución Educativa';
  const schoolCycle = course.schoolYear || '2026';

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumbs & Course Header Banner */}
      <div className="space-y-4">
        {/* Navigation bar with Back button and Course selector */}
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            <button
              onClick={onBackToCourses}
              className={`font-medium transition-colors flex items-center gap-1 ${
                isDarkMode ? 'text-slate-300 hover:text-blue-400' : 'text-neutral-700 hover:text-blue-600'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Mis Materias</span>
            </button>
            <span>/</span>
            <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
              {formatCourseSidebarLabel(course)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className={`text-[11px] font-semibold hidden sm:block ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Cambiar de materia:
            </label>
            <select
              value={course.id}
              onChange={(e) => onSelectCourse(e.target.value)}
              className={`text-xs rounded-xl px-3 py-1.5 font-medium shadow-2xs focus:outline-none ${
                isDarkMode
                  ? 'bg-slate-900 border border-slate-700 text-slate-200 focus:border-blue-500'
                  : 'bg-white border border-neutral-200 text-neutral-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
              }`}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCourseSidebarLabel(c)}
                </option>
              ))}
            </select>

            {onDeleteCourse && (
              <button
                onClick={() => setIsConfirmDeleteOpen(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors border flex items-center gap-1.5 ml-1 ${
                  isDarkMode
                    ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/40 border-slate-700'
                    : 'text-neutral-500 hover:text-red-600 hover:bg-red-50 border-neutral-200'
                }`}
                title="Eliminar esta materia"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Eliminar</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Primary Content: Estudiantes (Asistencia, Disposición y Classroom) */}
      <div className="transition-all duration-150">
        <ClassesModule
          courses={courses}
          students={students}
          selectedCourseId={course.id}
          onSelectCourse={onSelectCourse}
          onRefreshData={onRefreshData}
          onNavigate={onNavigate}
          onOpenNewModal={onOpenNewModal}
        />
      </div>

      {/* Confirmation Modal: Delete Course */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-8 max-w-md w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                isDarkMode
                  ? 'bg-red-950/60 text-red-400 border-red-900/60'
                  : 'bg-red-50 text-red-600 border-red-100'
              }`}
            >
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold">
                ¿Eliminar {course.name}?
              </h3>
              <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                ¿Estás seguro de que deseas eliminar esta materia? Se quitará de tu panel de cursos y de las listas de asistencia.
              </p>
            </div>

            <div
              className={`rounded-xl p-3 border text-xs space-y-1 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300'
                  : 'bg-neutral-50 border-neutral-200/80 text-neutral-600'
              }`}
            >
              <p>• Asignatura: <strong>{course.subject}</strong></p>
              <p>• Nivel / Grado: <strong>{course.grade}</strong></p>
              <p>• Estudiantes inscritos: <strong>{course.studentsCount}</strong></p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsConfirmDeleteOpen(false)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (onDeleteCourse) {
                    setIsDeleting(true);
                    await onDeleteCourse(course.id);
                    setIsDeleting(false);
                    setIsConfirmDeleteOpen(false);
                    onBackToCourses();
                  }
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isDeleting ? (
                  <span>Eliminando...</span>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirmar eliminación</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
