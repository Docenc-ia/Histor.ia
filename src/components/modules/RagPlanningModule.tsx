import React, { useState, useEffect } from 'react';
import {
  FileText,
  Sparkles,
  Upload,
  BookOpen,
  ExternalLink,
  CheckCircle2,
  Clock,
  Layers,
  ChevronRight,
  RefreshCw,
  FolderPlus,
  FileCheck,
  Award,
  AlertCircle,
  Trash2,
  Eraser,
  RotateCcw,
  PlusCircle
} from 'lucide-react';
import { Course, RagPlanResult } from '../../types';
import { api } from '../../services/api';
import { NotebookLmToolbar } from '../common/NotebookLmToolbar';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { RagPlanningSourceCard, PlanningSourceItem } from './RagPlanningSourceCard';

interface RagPlanningModuleProps {
  courses: Course[];
  selectedCourseId?: string;
  courseId?: string;
  onSelectCourse?: (id: string) => void;
  onNavigateToManuals?: (planId: string) => void;
}

export const RagPlanningModule: React.FC<RagPlanningModuleProps> = ({
  courses,
  selectedCourseId: propSelectedCourseId,
  courseId,
  onSelectCourse,
  onNavigateToManuals,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const selectedCourseId = propSelectedCourseId || courseId || (courses[0]?.id ?? '');
  const currentCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];

  const [plans, setPlans] = useState<RagPlanResult[]>([]);
  const [activePlan, setActivePlan] = useState<RagPlanResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [jobProgress, setJobProgress] = useState<{ progress: number; step: string } | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'info' | 'success' | 'warning'; text: string } | null>(null);

  // Form state initialized clean so teacher can input their own materials
  const [subject, setSubject] = useState<string>(() => currentCourse?.subject || currentCourse?.name || '');
  const [gradeLevel, setGradeLevel] = useState<string>(() => currentCourse?.grade || 'Secundaria');
  const [studentAge, setStudentAge] = useState<string>('15-16 años');
  const [templateName, setTemplateName] = useState<string>('');
  const [templateContent, setTemplateContent] = useState<string>('');
  const [curriculumNorms, setCurriculumNorms] = useState<string>('');
  const [bibliography, setBibliography] = useState<string>('');

  // Loaded multi-source items (files and/or links)
  const [templateSources, setTemplateSources] = useState<PlanningSourceItem[]>([]);
  const [normativeSources, setNormativeSources] = useState<PlanningSourceItem[]>([]);
  const [biblioSources, setBiblioSources] = useState<PlanningSourceItem[]>([]);

  // Sync course metadata when currentCourse changes
  useEffect(() => {
    if (currentCourse) {
      setSubject(currentCourse.subject || currentCourse.name || '');
      setGradeLevel(currentCourse.grade || 'Secundaria');
    }
  }, [currentCourse?.id]);

  const loadPlans = async () => {
    try {
      setIsLoading(true);
      const data = await api.getRagPlans(selectedCourseId);
      // Strictly filter plans by current course
      const filtered = selectedCourseId
        ? data.filter((p) => p.courseId === selectedCourseId)
        : data;
      setPlans(filtered);
      if (filtered.length > 0) {
        setActivePlan(filtered[0]);
      } else {
        setActivePlan(null);
      }
    } catch (err) {
      console.error('Error al cargar planes RAG:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, [selectedCourseId]);

  // Action: Clear form fields completely so teacher can write from scratch
  const handleClearForm = () => {
    setTemplateName('');
    setTemplateContent('');
    setCurriculumNorms('');
    setBibliography('');
    setTemplateSources([]);
    setNormativeSources([]);
    setBiblioSources([]);
    setFeedbackMessage({
      type: 'info',
      text: 'Formulario vaciado. Todos los campos, documentos y enlaces están limpios para que ingreses tus propios contenidos.',
    });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // Action: Reset suggested guide template for this course
  const handleResetSampleTemplate = () => {
    setTemplateName(`Plantilla Institucional - ${currentCourse?.name || 'Materia'}.docx`);
    setTemplateContent(
      'Requerimientos institucionales: Fundamentación pedagógica obligatoria, expectativas de logro, 3 unidades trimestrales con cronograma, estrategias activas de enseñanza, rúbricas de evaluación analítica y bibliografía de referencia.'
    );
    setCurriculumNorms(
      `Diseño Curricular Oficial (${currentCourse?.grade || 'Secundaria'}): Contenidos prioritarios y competencias fundamentales para ${currentCourse?.subject || currentCourse?.name || 'la materia'}.`
    );
    setBibliography(
      `Bibliografía docente recomendada para ${currentCourse?.name || 'la materia'}.`
    );
    setFeedbackMessage({
      type: 'info',
      text: 'Se cargó una plantilla de guía adaptada a tu materia.',
    });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // Action: Delete a specific plan
  const handleDeletePlan = async (planId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const confirmed = window.confirm('¿Seguro que deseas eliminar esta planificación para dejar el espacio limpio?');
    if (!confirmed) return;

    try {
      await api.deleteRagPlan(planId);
      const remaining = plans.filter((p) => p.id !== planId);
      setPlans(remaining);
      if (activePlan?.id === planId) {
        setActivePlan(remaining.length > 0 ? remaining[0] : null);
      }
      setFeedbackMessage({
        type: 'info',
        text: 'Planificación eliminada exitosamente.',
      });
      setTimeout(() => setFeedbackMessage(null), 3500);
    } catch (err: any) {
      console.error('Error al eliminar planificación:', err);
    }
  };

  // Action: Clear all plans and empty the workspace
  const handleClearAllPlans = async () => {
    const confirmed = window.confirm(
      '¿Deseas borrar TODAS las planificaciones precargadas para comenzar desde cero con tus propios documentos?'
    );
    if (!confirmed) return;

    try {
      await api.clearRagPlans(selectedCourseId);
      setPlans([]);
      setActivePlan(null);
      // Also clear textareas so user has 100% clean slate
      setTemplateName('');
      setTemplateContent('');
      setCurriculumNorms('');
      setBibliography('');
      setTemplateSources([]);
      setNormativeSources([]);
      setBiblioSources([]);
      setFeedbackMessage({
        type: 'success',
        text: '¡Espacio completamente limpio! Se eliminaron las planificaciones y se vaciaron los campos para que cargues tus cosas.',
      });
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      console.error('Error al limpiar planificaciones:', err);
    }
  };

  const handleStartRagPipeline = async () => {
    try {
      setIsProcessing(true);
      setJobProgress({ progress: 15, step: 'Iniciando sistema RAG y extrayendo documentos...' });

      const res = await api.generateRagLessonPlan({
        courseId: selectedCourseId,
        subject,
        gradeLevel,
        studentAge,
        institutionalTemplateText: templateContent,
        curriculumNormsText: curriculumNorms,
        bibliographyText: bibliography,
      });

      // Poll job progress
      const interval = setInterval(async () => {
        try {
          const job = await api.getAsyncJob(res.jobId);
          if (job) {
            setJobProgress({ progress: job.progress, step: job.currentStep });
            if (job.status === 'finalizado') {
              clearInterval(interval);
              setIsProcessing(false);
              setJobProgress(null);
              await loadPlans();
            } else if (job.status === 'fallido') {
              clearInterval(interval);
              setIsProcessing(false);
              setJobProgress(null);
            }
          }
        } catch {
          clearInterval(interval);
          setIsProcessing(false);
        }
      }, 1000);
    } catch (err) {
      console.error('Error al ejecutar RAG:', err);
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Feedback Toast Notification */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs shadow-xs transition-all ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-200'
              : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            <span className="font-medium">{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Header & Course Selector */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5 ${
        isDarkMode ? 'border-slate-800' : 'border-neutral-200'
      }`}>
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-md border ${
              isDarkMode
                ? 'bg-blue-950/70 text-blue-300 border-blue-800/80'
                : 'bg-blue-100 text-blue-800 border-blue-200'
            }`}>
              Módulo 1: RAG
            </span>
            <h1 className={`text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
              Planificación Anual y Curricular
            </h1>
          </div>
          <p className={`text-sm mt-1 max-w-3xl ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
            Carga o combina tu programa oficial, diseño curricular y bibliografía para generar tu documento editable en Google Docs.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {courses.length > 0 && (
            <select
              value={selectedCourseId}
              onChange={(e) => onSelectCourse && onSelectCourse(e.target.value)}
              className={`text-xs rounded-lg px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors ${
                isDarkMode
                  ? 'bg-slate-900 border border-slate-700 text-slate-200'
                  : 'bg-white border border-neutral-300 text-neutral-700'
              }`}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.grade})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* NotebookLM Multimodal Toolbar & Token Optimizer */}
      <NotebookLmToolbar
        moduleName="Planificación"
        courseName={courses.find((c) => c.id === selectedCourseId)?.name || subject}
        documentTitle={activePlan?.title || `Planificación Didáctica - ${subject}`}
        documentContent={
          activePlan?.generatedDocContent ||
          `# Planificación Didáctica: ${subject} (${gradeLevel})\n\n### 1. Plantilla Institucional:\n${templateContent}\n\n### 2. Normas Curriculares NAP:\n${curriculumNorms}\n\n### 3. Bibliografía Docente:\n${bibliography}`
        }
        onImportContent={(text, title) => {
          setCurriculumNorms((prev) => `${prev}\n\n[Fuente Importada: ${title}]:\n${text}`);
        }}
        onInsertVideoPedagogy={(pedagogy) => {
          setBibliography((prev) => `${prev}\n\n[Recurso Audiovisual Didáctico]:\n• Síntesis: ${pedagogy.summary}\n• Conceptos: ${pedagogy.keyConcepts.join(', ')}\n• Actividad sugerida: ${pedagogy.suggestedClassActivity}`);
        }}
        onApplyOptimizedContent={(optimized) => {
          setCurriculumNorms(optimized);
        }}
      />

      {/* Grid: Inputs Configuration on Left, Output Preview on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Data Ingestion (3 Reference Sources) */}
        <div className="lg:col-span-5 space-y-6">
          <div className={`rounded-2xl border p-5 shadow-xs space-y-5 transition-colors ${
            isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-neutral-100 dark:border-slate-800">
              <h2 className={`text-base font-semibold flex items-center gap-2 ${
                isDarkMode ? 'text-white' : 'text-neutral-900'
              }`}>
                <Upload className="w-4 h-4 text-blue-500" />
                1. Entrada de Fuentes de Referencia
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleClearForm}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors flex items-center gap-1 border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-750 hover:bg-slate-800 text-slate-300'
                      : 'border-neutral-200 hover:bg-neutral-100 text-neutral-600'
                  }`}
                  title="Vaciar todos los campos de texto"
                >
                  <Eraser className="w-3.5 h-3.5 text-amber-500" />
                  <span>Vaciar campos</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetSampleTemplate}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors flex items-center gap-1 border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-750 hover:bg-slate-800 text-slate-300'
                      : 'border-neutral-200 hover:bg-neutral-100 text-neutral-600'
                  }`}
                  title="Cargar estructura de plantilla guía sugerida para esta materia"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
                  <span>Plantilla sugerida</span>
                </button>
              </div>
            </div>

            {/* Basic Course Metadata */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-xs font-medium mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-neutral-700'
                }`}>Materia / Cátedra</label>
                <input
                  type="text"
                  value={subject}
                  placeholder="Ej: Biología Celular, Historia, etc."
                  onChange={(e) => setSubject(e.target.value)}
                  className={`w-full text-xs border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 transition-colors ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-750'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white'
                  }`}
                />
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-neutral-700'
                }`}>Edad de los Estudiantes</label>
                <select
                  value={studentAge}
                  onChange={(e) => setStudentAge(e.target.value)}
                  className={`w-full text-xs border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 transition-colors ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-750'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white'
                  }`}
                >
                  <option value="12-13 años">12-13 años (1° Año Secundaria)</option>
                  <option value="14-15 años">14-15 años (3° Año Secundaria)</option>
                  <option value="15-16 años">15-16 años (4° Año Secundaria)</option>
                  <option value="17-18 años">17-18 años (Ciclo Orientado/Bachiller)</option>
                  <option value="Superior / Terciario">Nivel Superior / Universitario</option>
                </select>
              </div>
            </div>

            {/* Source 1: Institutional Template */}
            <RagPlanningSourceCard
              id="template"
              title="A. Plantilla Institucional"
              badge="Formato Oficial"
              badgeColorClass={
                isDarkMode ? 'text-blue-300 bg-blue-950/80' : 'text-blue-700 bg-blue-100'
              }
              icon={<FileCheck className="w-4 h-4 text-blue-500" />}
              description="Estructura y secciones requeridas por la dirección de tu escuela o colegio."
              placeholder="Pega o escribe aquí la estructura de tu colegio: Fundamentación, Expectativas de logro, Unidades trimestrales, Criterios de evaluación..."
              value={templateContent}
              onChange={setTemplateContent}
              sources={templateSources}
              onSourcesChange={setTemplateSources}
              acceptedFileTypes=".docx,.doc,.pdf,.txt,.rtf,.md"
              fileTypeDescription="Formatos aceptados: Documentos Word (.docx), PDF (.pdf), Docs o texto plano"
              docType="template"
              isDarkMode={isDarkMode}
              onFeedback={(msg) => {
                setFeedbackMessage(msg);
                setTimeout(() => setFeedbackMessage(null), 5000);
              }}
            />

            {/* Source 2: Curriculum Norms */}
            <RagPlanningSourceCard
              id="normative"
              title="B. Normativa Oficial / Diseño Curricular"
              badge="NAP / Jurisdicción"
              badgeColorClass={
                isDarkMode ? 'text-emerald-300 bg-emerald-950/80' : 'text-emerald-700 bg-emerald-100'
              }
              icon={<BookOpen className="w-4 h-4 text-emerald-500" />}
              description="Contenidos mínimos obligatorios, diseño curricular provincial/nacional y competencias del Ministerio."
              placeholder="Pega o escribe aquí los contenidos prioritarios, diseño curricular oficial o temas a desarrollar..."
              value={curriculumNorms}
              onChange={setCurriculumNorms}
              sources={normativeSources}
              onSourcesChange={setNormativeSources}
              acceptedFileTypes=".pdf,.docx,.doc,.txt,.rtf,.md"
              fileTypeDescription="Formatos aceptados: Resoluciones curriculares en PDF (.pdf), Word (.docx) o enlace ministerial"
              docType="normative"
              isDarkMode={isDarkMode}
              onFeedback={(msg) => {
                setFeedbackMessage(msg);
                setTimeout(() => setFeedbackMessage(null), 5000);
              }}
            />

            {/* Source 3: Teacher Bibliography */}
            <RagPlanningSourceCard
              id="bibliography"
              title="C. Bibliografía Propia del Docente"
              badge="Cátedra / Textos"
              badgeColorClass={
                isDarkMode ? 'text-purple-300 bg-purple-950/80' : 'text-purple-700 bg-purple-100'
              }
              icon={<Layers className="w-4 h-4 text-purple-500" />}
              description="Textos canónicos, manuales, capítulos de libros de cabecera y apuntes de cátedra."
              placeholder="Escribe o pega aquí la bibliografía obligatoria, autores, manuales, libros de texto o capítulos que usarás..."
              value={bibliography}
              onChange={setBibliography}
              sources={biblioSources}
              onSourcesChange={setBiblioSources}
              acceptedFileTypes=".pdf,.docx,.doc,.txt,.rtf,.md"
              fileTypeDescription="Formatos aceptados: Bibliografía en Docs (.docx) o en PDF (.pdf) con extracción de autores y capítulos"
              docType="bibliography"
              isDarkMode={isDarkMode}
              onFeedback={(msg) => {
                setFeedbackMessage(msg);
                setTimeout(() => setFeedbackMessage(null), 5000);
              }}
            />

            {/* Processing Button & Async Progress */}
            {isProcessing ? (
              <div className={`p-4 rounded-xl border space-y-2 ${
                isDarkMode ? 'bg-blue-950/40 border-blue-800/60 text-blue-200' : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    Procesando RAG en segundo plano...
                  </span>
                  <span>{jobProgress?.progress || 35}%</span>
                </div>
                <div className={`w-full rounded-full h-2 overflow-hidden ${
                  isDarkMode ? 'bg-blue-900/60' : 'bg-blue-200'
                }`}>
                  <div
                    className="bg-blue-600 h-2 transition-all duration-300 rounded-full"
                    style={{ width: `${jobProgress?.progress || 35}%` }}
                  />
                </div>
                <p className={`text-[11px] font-mono truncate ${
                  isDarkMode ? 'text-blue-300' : 'text-blue-700'
                }`}>
                  {jobProgress?.step || 'Cruzando información sin pérdida de contexto...'}
                </p>
              </div>
            ) : (
              <button
                onClick={handleStartRagPipeline}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Ejecutar RAG y Generar en Google Docs
              </button>
            )}
          </div>

          {/* Quick List of Generated Plans */}
          <div className={`rounded-2xl border p-4 space-y-3 shadow-xs transition-colors ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-slate-300' : 'text-neutral-800'
              }`}>
                Planificaciones Guardadas ({plans.length})
              </h3>
              {plans.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllPlans}
                  className="text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Eliminar todas las planificaciones guardadas"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Borrar todas</span>
                </button>
              )}
            </div>

            {plans.length === 0 ? (
              <p className={`text-xs py-4 text-center ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>
                No hay planificaciones guardadas. Completa las fuentes arriba para generar una.
              </p>
            ) : (
              <div className="space-y-2">
                {plans.map((p) => {
                  const isCurrent = activePlan?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setActivePlan(p)}
                      className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex items-center justify-between cursor-pointer group ${
                        isDarkMode
                          ? isCurrent
                            ? 'border-blue-500 bg-blue-950/40 text-blue-200 font-medium'
                            : 'border-slate-800 hover:bg-slate-800/60 text-slate-300'
                          : isCurrent
                            ? 'border-blue-500 bg-blue-50/60 text-blue-950 font-medium'
                            : 'border-neutral-200 hover:bg-neutral-50 text-neutral-700'
                      }`}
                    >
                      <div className="truncate pr-2 flex-1">
                        <p className={`font-semibold truncate ${isDarkMode ? (isCurrent ? 'text-white' : 'text-slate-200') : ''}`}>{p.title}</p>
                        <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          {p.gradeLevel} • {p.studentAge}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleDeletePlan(p.id, e)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                          title="Eliminar esta planificación"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Google Docs Editable Output & Structured Preview */}
        <div className="lg:col-span-7 space-y-6">
          {activePlan ? (
            <div className={`rounded-2xl border shadow-xs overflow-hidden transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}>
              {/* Document Banner */}
              <div className={`p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isDarkMode
                  ? 'bg-slate-800/80 border-slate-700/80'
                  : 'border-neutral-200 bg-linear-to-r from-blue-50/60 via-white to-neutral-50'
              }`}>
                <div>
                  <div className={`flex items-center gap-2 text-xs font-semibold mb-1 ${
                    isDarkMode ? 'text-blue-400' : 'text-blue-700'
                  }`}>
                    <FileText className="w-4 h-4" />
                    Documento de Salida Oficial (Google Docs)
                  </div>
                  <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{activePlan.title}</h3>
                  <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Plantilla base: {activePlan.institutionalTemplateName} • Edad adaptada: {activePlan.studentAge}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={activePlan.googleDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir en Google Docs
                  </a>
                  {onNavigateToManuals && (
                    <button
                      onClick={() => onNavigateToManuals(activePlan.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800'
                      }`}
                      title="Generar manual interactivo para esta planificación"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-purple-400" />
                      Crear Material Didáctico
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeletePlan(activePlan.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                      isDarkMode
                        ? 'border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300'
                        : 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700'
                    }`}
                    title="Eliminar esta planificación guardada"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>Eliminar</span>
                  </button>
                </div>
              </div>

              {/* Document Body Formatted Exactly as Institutional Template */}
              <div className={`p-6 space-y-6 font-sans ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>
                {/* 1. Fundamentación */}
                <section className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-blue-950 text-blue-300' : 'bg-blue-100 text-blue-700'
                    }`}>
                      1
                    </span>
                    Fundamentación Pedagógica
                  </h4>
                  <p className={`text-xs leading-relaxed p-3.5 rounded-xl border ${
                    isDarkMode ? 'bg-slate-800/60 text-slate-200 border-slate-700/60' : 'text-neutral-700 bg-neutral-50/60 border-neutral-100'
                  }`}>
                    {activePlan.sections.fundamentacion}
                  </p>
                </section>

                {/* 2. Expectativas de Logro */}
                <section className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-emerald-950 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      2
                    </span>
                    Expectativas de Logro y Competencias
                  </h4>
                  <ul className={`space-y-1.5 text-xs ${isDarkMode ? 'text-slate-200' : 'text-neutral-700'}`}>
                    {activePlan.sections.expectativasLogro.map((exp, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{exp}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* 3. Unidades y Contenidos con Cronograma */}
                <section className="space-y-3">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-purple-950 text-purple-300' : 'bg-purple-100 text-purple-700'
                    }`}>
                      3
                    </span>
                    Contenidos Curriculares por Unidad y Cronograma
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {activePlan.sections.contenidosPorUnidad.map((u, i) => (
                      <div key={i} className={`p-3 rounded-xl border space-y-2 ${
                        isDarkMode ? 'bg-slate-800/60 border-slate-700/80' : 'bg-neutral-50 border-neutral-200/80'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-bold uppercase ${
                            isDarkMode ? 'text-blue-400' : 'text-blue-700'
                          }`}>{u.unidad}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            isDarkMode ? 'bg-slate-900 text-slate-300 border-slate-700' : 'text-neutral-500 bg-white border-neutral-200'
                          }`}>
                            {u.cronograma}
                          </span>
                        </div>
                        <p className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{u.nombre}</p>
                        <div className="space-y-1 pt-1">
                          {u.temas.map((t, ti) => (
                            <div key={ti} className={`text-[11px] flex items-center gap-1.5 ${
                              isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                            }`}>
                              <span className="w-1 h-1 rounded-full bg-neutral-400" />
                              <span className="truncate">{t}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 4. Estrategias de Enseñanza */}
                <section className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-amber-950 text-amber-300' : 'bg-amber-100 text-amber-700'
                    }`}>
                      4
                    </span>
                    Estrategias de Enseñanza y Metodología
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {activePlan.sections.estrategiasEnsenanza.map((est, ei) => (
                      <span
                        key={ei}
                        className={`px-3 py-1.5 rounded-lg text-xs border ${
                          isDarkMode
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                            : 'bg-amber-50/70 border-amber-200 text-amber-900'
                        }`}
                      >
                        {est}
                      </span>
                    ))}
                  </div>
                </section>

                {/* 5. Criterios de Evaluación */}
                <section className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-indigo-950 text-indigo-300' : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      5
                    </span>
                    Criterios e Instrumentos de Evaluación
                  </h4>
                  <div className="space-y-1.5">
                    {activePlan.sections.criteriosEvaluacion.map((crit, ci) => (
                      <div
                        key={ci}
                        className={`text-xs p-2.5 rounded-lg border flex items-center gap-2 ${
                          isDarkMode
                            ? 'bg-indigo-950/40 border-indigo-800/60 text-indigo-300'
                            : 'text-neutral-700 bg-indigo-50/40 border-indigo-100'
                        }`}
                      >
                        <Award className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{crit}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 6. Bibliografía Obligatoria */}
                <section className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b pb-1.5 ${
                    isDarkMode ? 'text-white border-slate-800' : 'text-neutral-900 border-neutral-100'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-neutral-200 text-neutral-700'
                    }`}>
                      6
                    </span>
                    Bibliografía Obligatoria y Fuentes Canónicas
                  </h4>
                  <div className={`space-y-1 text-xs italic ${
                    isDarkMode ? 'text-slate-400' : 'text-neutral-600'
                  }`}>
                    {activePlan.sections.bibliografiaObligatoria.map((bib, bi) => (
                      <p key={bi}>• {bib}</p>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className={`rounded-2xl border p-10 text-center space-y-4 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-neutral-200 text-neutral-800'
            }`}>
              <div className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center ${
                isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-blue-50 text-blue-600'
              }`}>
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                  Espacio limpio para {currentCourse?.name || 'tu materia'}
                </h3>
                <p className={`text-xs max-w-md mx-auto leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  No hay planificaciones activas. Completa tus contenidos, normativas y bibliografía en el panel izquierdo y pulsa <strong>"Ejecutar RAG"</strong> para generar tu documento oficial en Google Docs.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleResetSampleTemplate}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-200'
                      : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
                  <span>Cargar estructura sugerida</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearForm}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                      : 'border-neutral-200 hover:bg-neutral-100 text-neutral-600'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5 text-amber-500" />
                  <span>Vaciar campos</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
