import React, { useState } from 'react';
import {
  FileText,
  Plus,
  ExternalLink,
  Download,
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  BookOpen,
  Filter,
  Check,
} from 'lucide-react';
import { LessonPlan, Course } from '../../types';
import { docsService } from '../../services/workspace/docsService';

interface LessonPlansModuleProps {
  lessonPlans: LessonPlan[];
  courses: Course[];
  selectedCourseId?: string;
  onSelectCourse: (id: string) => void;
  onOpenNewModal: (type: 'course' | 'plan' | 'task' | 'file') => void;
  onNavigateToAi: (promptSuggestion?: string) => void;
}

export const LessonPlansModule: React.FC<LessonPlansModuleProps> = ({
  lessonPlans,
  courses,
  selectedCourseId,
  onSelectCourse,
  onOpenNewModal,
  onNavigateToAi,
}) => {
  const [filterCourse, setFilterCourse] = useState<string>(selectedCourseId || 'all');
  const [activePlan, setActivePlan] = useState<LessonPlan | null>(lessonPlans[0] || null);
  const [isExportingDoc, setIsExportingDoc] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const filteredPlans = lessonPlans.filter((p) => {
    if (filterCourse === 'all') return true;
    return p.courseId === filterCourse;
  });

  const activeCourseName = courses.find((c) => c.id === activePlan?.courseId)?.name || 'Materia General';

  const handleExportGoogleDocs = async (plan: LessonPlan) => {
    setIsExportingDoc(true);
    try {
      const result = await docsService.exportLessonPlanToDoc(plan, activeCourseName);
      setToastMessage(`Planificación exportada a Google Docs: "${result.title}"`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      alert('Error al exportar a Google Docs: ' + err.message);
    } finally {
      setIsExportingDoc(false);
    }
  };

  const handleDownloadOffline = (plan: LessonPlan) => {
    docsService.downloadLocalPlanDoc(plan, activeCourseName);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Planificaciones Pedagógicas (Google Docs)
          </h2>
          <p className="text-xs text-neutral-500">
            Diseño curricular, momentos didácticos estructurados y exportación automática a plantillas de Google Docs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateToAi('Quiero una planificación sobre ')}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold rounded-lg border border-purple-200 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generar con IA
          </button>
          <button
            onClick={() => onOpenNewModal('plan')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
          >
            <Plus className="w-4 h-4" />
            Nueva Planificación
          </button>
        </div>
      </div>

      {/* Course Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-neutral-200">
        <button
          onClick={() => setFilterCourse('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
            filterCourse === 'all'
              ? 'bg-neutral-800 text-white shadow-xs'
              : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
          }`}
        >
          Todas las Asignaturas ({lessonPlans.length})
        </button>
        {courses.map((course) => (
          <button
            key={course.id}
            onClick={() => setFilterCourse(course.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
              filterCourse === course.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border-neutral-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: course.color }} />
            <span>{course.name}</span>
          </button>
        ))}
      </div>

      {toastMessage && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Split View: Left List of Plans, Right Plan Details & Docs Exporter */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left List */}
        <div className="lg:col-span-4 space-y-3">
          {filteredPlans.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-xl border border-neutral-200 text-neutral-400">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs">No hay planificaciones para este filtro.</p>
              <button
                onClick={() => onOpenNewModal('plan')}
                className="mt-3 text-xs text-blue-600 font-semibold hover:underline"
              >
                Crear la primera planificación
              </button>
            </div>
          ) : (
            filteredPlans.map((plan) => {
              const isSelected = activePlan?.id === plan.id;
              const course = courses.find((c) => c.id === plan.courseId);
              return (
                <div
                  key={plan.id}
                  onClick={() => setActivePlan(plan)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/50 border-blue-400 shadow-xs ring-1 ring-blue-400/20'
                      : 'bg-white border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider truncate">
                      {course?.name || 'Asignatura'}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        plan.status === 'Aprobada'
                          ? 'bg-emerald-50 text-emerald-700'
                          : plan.status === 'Completada'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {plan.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-neutral-800 mt-1 line-clamp-1">{plan.title}</h3>
                  <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{plan.unit}</p>

                  <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> {plan.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {plan.duration}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Active Plan Detailed View */}
        <div className="lg:col-span-8">
          {activePlan ? (
            <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs space-y-6">
              {/* Header Action Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-neutral-200 gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">
                      {activeCourseName}
                    </span>
                    <span className="text-neutral-300">•</span>
                    <span className="text-xs text-neutral-500">{activePlan.unit}</span>
                  </div>
                  <h3 className="text-lg font-bold text-neutral-900 mt-0.5">{activePlan.title}</h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExportGoogleDocs(activePlan)}
                    disabled={isExportingDoc}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#4285F4] hover:bg-[#3367d6] text-white text-xs font-semibold rounded-lg shadow-xs transition-all disabled:opacity-60"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {isExportingDoc ? 'Exportando...' : 'Exportar a Google Docs'}
                  </button>
                  <button
                    onClick={() => handleDownloadOffline(activePlan)}
                    className="p-2 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg border border-neutral-200 transition-colors"
                    title="Descargar copia local (.txt)"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Pedagogical Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/70 text-xs">
                <div>
                  <span className="text-neutral-400 block text-[10px] uppercase font-bold">Fecha de Clase</span>
                  <span className="font-semibold text-neutral-800">{activePlan.date}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block text-[10px] uppercase font-bold">Duración</span>
                  <span className="font-semibold text-neutral-800">{activePlan.duration}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block text-[10px] uppercase font-bold">Google Doc ID</span>
                  <span className="font-mono text-[11px] text-blue-700 truncate block">
                    {activePlan.googleDocId || 'Pendiente sync'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block text-[10px] uppercase font-bold">Estado</span>
                  <span className="font-semibold text-emerald-700">{activePlan.status}</span>
                </div>
              </div>

              {/* 1. Objetivo de Aprendizaje */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-neutral-700 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                  1. Objetivo de Aprendizaje
                </h4>
                <p className="text-sm text-neutral-800 leading-relaxed bg-blue-50/30 p-3.5 rounded-lg border border-blue-100 font-medium">
                  {activePlan.objective}
                </p>
              </div>

              {/* 2. Competencias Clave */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                  2. Competencias Clave Desarrolladas
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activePlan.competencies.map((comp, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-neutral-100 text-neutral-700 rounded-md text-xs font-medium border border-neutral-200"
                    >
                      {comp}
                    </span>
                  ))}
                </div>
              </div>

              {/* 3. Secuencia Didáctica (3 Momentos Clave) */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                  3. Secuencia Didáctica Pedagógica
                </h4>
                <div className="space-y-2.5">
                  <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-200/70">
                    <span className="text-xs font-bold text-amber-800 uppercase block mb-1">
                      • Inicio (15%) - Motivación & Saberes Previos:
                    </span>
                    <p className="text-xs text-neutral-700 leading-relaxed">{activePlan.inicio}</p>
                  </div>
                  <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-200/70">
                    <span className="text-xs font-bold text-emerald-800 uppercase block mb-1">
                      • Desarrollo (60%) - Actividad Central & Colaboración:
                    </span>
                    <p className="text-xs text-neutral-700 leading-relaxed">{activePlan.desarrollo}</p>
                  </div>
                  <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-200/70">
                    <span className="text-xs font-bold text-blue-800 uppercase block mb-1">
                      • Cierre (25%) - Síntesis & Evaluación Formativa:
                    </span>
                    <p className="text-xs text-neutral-700 leading-relaxed">{activePlan.cierre}</p>
                  </div>
                </div>
              </div>

              {/* 4. Evaluación & Recursos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                  <span className="text-xs font-bold text-neutral-700 uppercase block mb-1">
                    Evaluación e Instrumentos
                  </span>
                  <p className="text-xs text-neutral-600 leading-relaxed">{activePlan.assessment}</p>
                </div>
                <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                  <span className="text-xs font-bold text-neutral-700 uppercase block mb-1">
                    Materiales Didácticos
                  </span>
                  <ul className="text-xs text-neutral-600 space-y-1">
                    {activePlan.materials.map((m, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-neutral-200 text-neutral-400">
              Selecciona una planificación para visualizar su estructura pedagógica.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
