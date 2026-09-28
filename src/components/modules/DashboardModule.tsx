import React from 'react';
import {
  Users,
  GraduationCap,
  FileText,
  Table,
  FolderClosed,
  Clock,
  CheckCircle2,
  Calendar,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  BookOpen,
  CheckSquare,
} from 'lucide-react';
import { Course, LessonPlan, ClassroomTask, DriveResource } from '../../types';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface DashboardModuleProps {
  courses: Course[];
  lessonPlans: LessonPlan[];
  classroomTasks: ClassroomTask[];
  driveFiles: DriveResource[];
  onNavigate: (tab: string, filterCourseId?: string) => void;
  onOpenNewModal: (type: 'course' | 'plan' | 'task' | 'file') => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  courses,
  lessonPlans,
  classroomTasks,
  driveFiles,
  onNavigate,
  onOpenNewModal,
}) => {
  const { user, mode } = useWorkspaceAuth();

  const totalStudents = courses.reduce((acc, c) => acc + c.studentsCount, 0);
  const pendingTasks = classroomTasks.filter((t) => t.status === 'Publicada');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#1a73e8] to-[#174ea6] text-white p-6 shadow-sm">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-xs text-xs font-medium text-blue-100 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Ciclo Lectivo 2026 • Estado Activo
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            ¡Hola, {user?.name || 'Profesor'}!
          </h2>
          <p className="mt-1 text-sm text-blue-100 leading-relaxed">
            Tu centro de comando pedagógico está listo. Todas las conexiones con Google Drive, Docs, Sheets y Classroom se encuentran preparadas para coordinar tus cursos.
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={() => onNavigate('tasks')}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-white text-[#1a73e8] hover:bg-blue-50 text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              <CheckSquare className="w-4 h-4 text-blue-600" />
              Gestión de Tareas (Módulo 1)
            </button>
            <button
              onClick={() => onOpenNewModal('plan')}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg backdrop-blur-xs border border-white/20 transition-all"
            >
              <FileText className="w-4 h-4 text-blue-100" />
              Nueva Planificación (Docs)
            </button>
            <button
              onClick={() => onNavigate('classroom')}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg backdrop-blur-xs border border-white/20 transition-all"
            >
              <GraduationCap className="w-4 h-4" />
              Classroom Sync
            </button>
            <button
              onClick={() => onNavigate('ai_assistant')}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-neutral-900 text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              <Sparkles className="w-4 h-4 text-neutral-900" />
              Asistente Pedagógico IA
            </button>
          </div>
        </div>

        {/* Decorative background circles */}
        <div className="absolute right-0 top-0 -mt-10 -mr-10 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('classes')}
          className="p-4 bg-white rounded-xl border border-neutral-200/80 shadow-xs hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Cursos Asignados</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <BookOpen className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-800">{courses.length}</span>
            <span className="text-xs text-neutral-500">clases activas</span>
          </div>
          <div className="mt-2 text-xs text-blue-600 font-medium flex items-center gap-1">
            Ver nómina y asistencias <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>

        <div
          onClick={() => onNavigate('classes')}
          className="p-4 bg-white rounded-xl border border-neutral-200/80 shadow-xs hover:border-emerald-300 hover:shadow-sm cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Total Estudiantes</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-800">{totalStudents}</span>
            <span className="text-xs text-emerald-600 font-medium">94% asistencia global</span>
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            Sincronizado con nóminas oficiales
          </div>
        </div>

        <div
          onClick={() => onNavigate('plans')}
          className="p-4 bg-white rounded-xl border border-neutral-200/80 shadow-xs hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Planificaciones Docs</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-800">{lessonPlans.length}</span>
            <span className="text-xs text-neutral-500">unidades temáticas</span>
          </div>
          <div className="mt-2 text-xs text-blue-600 font-medium flex items-center gap-1">
            Estructuras pedagógicas <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>

        <div
          onClick={() => onNavigate('classroom')}
          className="p-4 bg-white rounded-xl border border-neutral-200/80 shadow-xs hover:border-green-300 hover:shadow-sm cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Tareas en Classroom</span>
            <div className="p-2 rounded-lg bg-green-50 text-green-700">
              <GraduationCap className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-800">{pendingTasks.length}</span>
            <span className="text-xs text-green-700 font-medium">publicadas</span>
          </div>
          <div className="mt-2 text-xs text-green-700 font-medium flex items-center gap-1">
            Revisar entregas <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Main Grid: Schedule & Courses + Classroom & Drive Recents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Today's Courses and Action Center */}
        <div className="lg:col-span-2 space-y-6">
          {/* Courses Cards */}
          <div className="bg-white rounded-xl border border-neutral-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-neutral-800">Cursos & Aulas Asignadas</h3>
                <p className="text-xs text-neutral-500">Accesos directos a planillas Sheets, carpetas Drive y Classroom</p>
              </div>
              <button
                onClick={() => onNavigate('classes')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                Ver todos ({courses.length}) <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {courses.map((course) => (
                <div
                  key={course.id}
                  className="p-4 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all flex flex-col justify-between"
                  style={{ borderLeftColor: course.color, borderLeftWidth: '4px' }}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                        {course.grade}
                      </span>
                      {course.classroomSynced && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Classroom
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-neutral-800 mt-1">{course.name}</h4>
                    <p className="text-xs text-neutral-600 mt-0.5 font-medium">{course.subject}</p>

                    <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {course.schedule.split(' ')[0]}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {course.studentsCount} estudiantes
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
                    <button
                      onClick={() => onNavigate('grades', course.id)}
                      className="font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                    >
                      <Table className="w-3.5 h-3.5" /> Planilla Notas
                    </button>
                    <button
                      onClick={() => onNavigate('plans', course.id)}
                      className="font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" /> Planificar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Classroom Coursework Submissions */}
          <div className="bg-white rounded-xl border border-neutral-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-green-700" />
                <div>
                  <h3 className="text-base font-semibold text-neutral-800">Tareas en Google Classroom</h3>
                  <p className="text-xs text-neutral-500">Seguimiento de entregas y plazos de entrega</p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('classroom')}
                className="text-xs font-semibold text-green-700 hover:text-green-800 flex items-center gap-1"
              >
                Administrar tareas <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {classroomTasks.slice(0, 3).map((task) => {
                const percent = Math.round((task.submittedCount / task.assignedCount) * 100);
                return (
                  <div
                    key={task.id}
                    className="p-3.5 rounded-lg border border-neutral-200/80 hover:bg-neutral-50/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-neutral-800">{task.title}</h4>
                        <p className="text-xs text-neutral-500 line-clamp-1 mt-0.5">{task.description}</p>
                      </div>
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">
                        {task.maxPoints} pts
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                      <div className="flex items-center gap-2">
                        <span>Entregas: <strong>{task.submittedCount}</strong> de {task.assignedCount}</span>
                        <div className="w-24 h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="font-semibold text-neutral-700">{percent}%</span>
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        Vence: {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Col: Google Drive Recent Files & Pedagogy Tools */}
        <div className="space-y-6">
          {/* Google Drive Materials */}
          <div className="bg-white rounded-xl border border-neutral-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FolderClosed className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-semibold text-neutral-800">Recursos en Google Drive</h3>
              </div>
              <button
                onClick={() => onNavigate('drive')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Abrir Drive
              </button>
            </div>

            <div className="space-y-2.5">
              {driveFiles.slice(0, 4).map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg shrink-0">
                      {file.type === 'doc' ? '📄' : file.type === 'sheet' ? '📊' : file.type === 'slide' ? '📑' : '📕'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-neutral-800 truncate">{file.name}</p>
                      <p className="text-[10px] text-neutral-400 truncate">{file.folder} • {file.size}</p>
                    </div>
                  </div>
                  <a
                    href={file.googleDriveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-neutral-400 hover:text-blue-600 transition-colors"
                    title="Abrir en Google Workspace"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>

            <button
              onClick={() => onOpenNewModal('file')}
              className="mt-4 w-full py-2 bg-neutral-50 hover:bg-neutral-100 text-neutral-700 text-xs font-semibold rounded-lg border border-neutral-200 transition-colors flex items-center justify-center gap-1.5"
            >
              <FolderClosed className="w-3.5 h-3.5 text-amber-500" />
              Subir nuevo recurso a Drive
            </button>
          </div>

          {/* Quick AI Pedagogical Box */}
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50/50 rounded-xl border border-purple-200/70 p-5 shadow-xs">
            <div className="flex items-center gap-2 text-purple-700 mb-2">
              <Sparkles className="w-4 h-4" />
              <h3 className="text-sm font-bold">Asistente IA para Docentes</h3>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed mb-4">
              Genera secuencias didácticas, matrices de rúbricas analíticas o sugerencias formativas adaptadas a tus clases.
            </p>
            <button
              onClick={() => onNavigate('ai_assistant')}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Abrir Generador Pedagógico
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
