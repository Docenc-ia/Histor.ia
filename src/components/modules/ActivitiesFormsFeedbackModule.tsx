import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Sparkles,
  GraduationCap,
  Table,
  Send,
  ExternalLink,
  Users,
  Award,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Clock,
  ArrowRight,
  TrendingUp,
  FileCheck2,
  ListFilter,
  MessageSquare
} from 'lucide-react';
import { Course, FormActivity, GradebookConsolidatedReport } from '../../types';
import { api } from '../../services/api';

interface ActivitiesFormsFeedbackModuleProps {
  courses: Course[];
  selectedCourseId: string;
  onSelectCourse: (id: string) => void;
}

export const ActivitiesFormsFeedbackModule: React.FC<ActivitiesFormsFeedbackModuleProps> = ({
  courses,
  selectedCourseId,
  onSelectCourse,
}) => {
  const [activities, setActivities] = useState<FormActivity[]>([]);
  const [activeActivity, setActiveActivity] = useState<FormActivity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGeneratingForm, setIsGeneratingForm] = useState<boolean>(false);
  const [isCorrectingAi, setIsCorrectingAi] = useState<boolean>(false);
  const [isExportingSheets, setIsExportingSheets] = useState<boolean>(false);
  const [consolidatedReports, setConsolidatedReports] = useState<GradebookConsolidatedReport[]>([]);
  const [activeReport, setActiveReport] = useState<GradebookConsolidatedReport | null>(null);

  // Form Generator State
  const [topic, setTopic] = useState<string>('Fases de la Mitosis y Regulación Celular');
  const [ageGroup, setAgeGroup] = useState<string>('15-16 años');
  const [activityType, setActivityType] = useState<'Formativa' | 'Diagnóstica' | 'Sumativa' | 'Trabajo Práctico'>('Formativa');
  const [questionCount, setQuestionCount] = useState<number>(3);

  // Sheets consolidation weightings
  const [tpWeight, setTpWeight] = useState<number>(40);
  const [examWeight, setExamWeight] = useState<number>(50);
  const [recWeight, setRecWeight] = useState<number>(10);

  // Status message
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [acts, reports] = await Promise.all([
        api.getActivities(),
        api.getGradebookConsolidated(),
      ]);
      setActivities(acts);
      if (acts.length > 0 && !activeActivity) {
        setActiveActivity(acts[0]);
      }
      setConsolidatedReports(reports);
      if (reports.length > 0 && !activeReport) {
        setActiveReport(reports[0]);
      }
    } catch (err) {
      console.error('Error al cargar actividades y notas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerateGoogleForm = async () => {
    try {
      setIsGeneratingForm(true);
      const res = await api.generateFormActivity({
        topic,
        ageGroup,
        activityType,
        courseId: selectedCourseId,
        questionCount,
      });
      await loadData();
      setActiveActivity(res.activity);
      setStatusMessage('Cuestionario interactivo generado en Google Forms.');
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error('Error al generar formulario:', err);
    } finally {
      setIsGeneratingForm(false);
    }
  };

  const handlePublishToClassroom = async (activityId: string) => {
    try {
      const res = await api.publishActivityToClassroom(activityId);
      await loadData();
      setStatusMessage(res.message);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error('Error al publicar en Classroom:', err);
    }
  };

  const handleRunAiAutoFeedback = async (activityId: string) => {
    try {
      setIsCorrectingAi(true);
      const res = await api.startAutoFeedback(activityId);

      const interval = setInterval(async () => {
        try {
          const job = await api.getAsyncJob(res.jobId);
          if (job && job.status === 'finalizado') {
            clearInterval(interval);
            setIsCorrectingAi(false);
            await loadData();
            setStatusMessage('Corrección con IA completada y notas volcadas a la Libreta.');
            setTimeout(() => setStatusMessage(null), 4000);
          } else if (job && job.status === 'fallido') {
            clearInterval(interval);
            setIsCorrectingAi(false);
          }
        } catch {
          clearInterval(interval);
          setIsCorrectingAi(false);
        }
      }, 1000);
    } catch (err) {
      console.error('Error al iniciar corrección con IA:', err);
      setIsCorrectingAi(false);
    }
  };

  const handleConsolidateToSheets = async () => {
    try {
      setIsExportingSheets(true);
      const res = await api.consolidateGradebookToSheets({
        courseId: selectedCourseId,
        term: '1er Trimestre',
        weights: { tp: tpWeight, exam: examWeight, rec: recWeight },
      });

      const interval = setInterval(async () => {
        try {
          const job = await api.getAsyncJob(res.jobId);
          if (job && job.status === 'finalizado') {
            clearInterval(interval);
            setIsExportingSheets(false);
            await loadData();
            setStatusMessage('Planilla consolidada exportada en Google Sheets.');
            setTimeout(() => setStatusMessage(null), 4000);
          } else if (job && job.status === 'fallido') {
            clearInterval(interval);
            setIsExportingSheets(false);
          }
        } catch {
          clearInterval(interval);
          setIsExportingSheets(false);
        }
      }, 1000);
    } catch (err) {
      console.error('Error al exportar planilla Sheets:', err);
      setIsExportingSheets(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
              Módulos 3 y 4: MVP
            </span>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
              Actividades, Google Classroom, Feedback con IA y Libreta Sheets
            </h1>
          </div>
          <p className="text-sm text-neutral-600 mt-1 max-w-3xl">
            Genera cuestionarios en <strong>Google Forms</strong> adaptados a la edad y publícalos en <strong>Google Classroom con 1 clic</strong>. Corrige respuestas abiertas con IA y rúbricas analíticas, devolviendo fortalezas y áreas de mejora consolidadas en <strong>Google Sheets</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedCourseId}
            onChange={(e) => onSelectCourse(e.target.value)}
            className="text-xs bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-700 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.grade})
              </option>
            ))}
          </select>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Grid: Forms Generator & Classroom Actions on Left, Submissions Feedback on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Module 3 Form Generator & Classroom Publisher */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-600" />
                Módulo 3: Generador de Google Forms
              </h2>
              <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                1-Clic Classroom
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Tema o Contenido de la Actividad
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full text-xs bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Año de la escuela
                  </label>
                  <select
                    value={ageGroup}
                    onChange={(e) => setAgeGroup(e.target.value)}
                    className="w-full text-xs bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="1º (13-12 años)">1º (13-12 años)</option>
                    <option value="2º (14-13 años)">2º (14-13 años)</option>
                    <option value="3º (15-14 años)">3º (15-14 años)</option>
                    <option value="4º (16-15 años)">4º (16-15 años)</option>
                    <option value="5º (17-16 años)">5º (17-16 años)</option>
                    <option value="6º (17-18 años)">6º (17-18 años)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Tipo de Actividad
                  </label>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value as any)}
                    className="w-full text-xs bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Formativa">Formativa (Proceso)</option>
                    <option value="Diagnóstica">Diagnóstica (Saberes previos)</option>
                    <option value="Sumativa">Sumativa (Calificada)</option>
                    <option value="Trabajo Práctico">Trabajo Práctico</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerateGoogleForm}
              disabled={isGeneratingForm}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGeneratingForm ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Estructurando Formulario Interactivo...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generar Cuestionario en Google Forms
                </>
              )}
            </button>
          </div>

          {/* Activities List */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3 shadow-xs">
            <h3 className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
              Cuestionarios Disponibles ({activities.length})
            </h3>
            <div className="space-y-2">
              {activities.map((act) => {
                const isSelected = activeActivity?.id === act.id;
                return (
                  <div
                    key={act.id}
                    onClick={() => setActiveActivity(act)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all space-y-2 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/60 shadow-xs'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-neutral-900">{act.title}</p>
                        <p className="text-[11px] text-neutral-500">
                          {act.activityType} • {act.ageGroup} • {act.submissions.length} entregas
                        </p>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          act.publishedToClassroom
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {act.publishedToClassroom ? 'Publicada en Classroom' : 'Borrador Forms'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={act.googleFormUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] text-neutral-600 hover:text-neutral-900 font-medium"
                      >
                        <ExternalLink className="w-3 h-3 text-neutral-400" />
                        Ver Forms
                      </a>
                      {!act.publishedToClassroom && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePublishToClassroom(act.id);
                          }}
                          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold"
                        >
                          <GraduationCap className="w-3 h-3" />
                          Publicar con 1 clic
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Module 4 Export to Sheets Component */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                <Table className="w-4 h-4 text-emerald-600" />
                Consolidar Libreta en Google Sheets
              </h3>
              <span className="text-[10px] text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded font-mono">
                Ponderada
              </span>
            </div>
            <p className="text-[11px] text-neutral-500">
              Ajusta los pesos para la libreta trimestral antes de exportar a tu Drive institucional:
            </p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 bg-neutral-50 rounded-lg border border-neutral-200">
                <span className="text-[10px] text-neutral-500 block">TPs</span>
                <input
                  type="number"
                  value={tpWeight}
                  onChange={(e) => setTpWeight(Number(e.target.value))}
                  className="w-12 text-center font-bold text-neutral-900 bg-transparent"
                />
                <span className="text-[10px] text-neutral-400">%</span>
              </div>
              <div className="p-2 bg-neutral-50 rounded-lg border border-neutral-200">
                <span className="text-[10px] text-neutral-500 block">Exámenes</span>
                <input
                  type="number"
                  value={examWeight}
                  onChange={(e) => setExamWeight(Number(e.target.value))}
                  className="w-12 text-center font-bold text-neutral-900 bg-transparent"
                />
                <span className="text-[10px] text-neutral-400">%</span>
              </div>
              <div className="p-2 bg-neutral-50 rounded-lg border border-neutral-200">
                <span className="text-[10px] text-neutral-500 block">Recup.</span>
                <input
                  type="number"
                  value={recWeight}
                  onChange={(e) => setRecWeight(Number(e.target.value))}
                  className="w-12 text-center font-bold text-neutral-900 bg-transparent"
                />
                <span className="text-[10px] text-neutral-400">%</span>
              </div>
            </div>

            <button
              onClick={handleConsolidateToSheets}
              disabled={isExportingSheets}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isExportingSheets ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Calculando promedios y exportando Sheets...
                </>
              ) : (
                <>
                  <Table className="w-4 h-4" />
                  Generar y Abrir en Google Sheets
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Module 4 Feedback con IA y Libreta Consolidada */}
        <div className="lg:col-span-7 space-y-6">
          {activeActivity ? (
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
              {/* Header */}
              <div className="p-5 border-b border-neutral-200 bg-linear-to-r from-emerald-50/60 via-white to-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 mb-1">
                    <CheckSquare className="w-4 h-4" />
                    Módulo 4: Evaluación de Respuestas y Feedback
                  </div>
                  <h3 className="text-lg font-bold text-neutral-900">{activeActivity.title}</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {activeActivity.submissions.length} estudiantes han enviado sus respuestas a través de Forms/Classroom.
                  </p>
                </div>

                <button
                  onClick={() => handleRunAiAutoFeedback(activeActivity.id)}
                  disabled={isCorrectingAi}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all shrink-0 disabled:opacity-50"
                >
                  {isCorrectingAi ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Evaluando con Rúbrica IA...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Corrección con IA (Respuestas Abiertas)
                    </>
                  )}
                </button>
              </div>

              {/* Submissions List with IA Feedback Cards */}
              <div className="p-5 space-y-4">
                <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  Entregas de los Estudiantes y Devolución Formativa
                </h4>

                <div className="space-y-3">
                  {activeActivity.submissions.map((sub) => (
                    <div
                      key={sub.studentId}
                      className="p-4 bg-neutral-50/80 rounded-xl border border-neutral-200 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-neutral-900">{sub.studentName}</p>
                          <p className="text-[11px] text-neutral-500">{sub.studentEmail}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                              (sub.overallScore || 0) >= 70
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            Nota: {sub.overallScore !== undefined ? `${sub.overallScore}/100` : 'Pendiente'}
                          </span>
                          <span className="text-[10px] text-neutral-500 bg-white px-2 py-0.5 rounded border">
                            {sub.status}
                          </span>
                        </div>
                      </div>

                      {/* Sample Open Response Analysis */}
                      <div className="p-3 bg-white rounded-lg border border-neutral-200/80 text-xs space-y-2">
                        <span className="text-[10px] text-neutral-500 font-semibold uppercase">
                          Respuesta Abierta del Estudiante:
                        </span>
                        <p className="text-neutral-700 italic">
                          "{sub.responses[sub.responses.length - 1]?.studentAnswer}"
                        </p>
                        {sub.responses[sub.responses.length - 1]?.aiFeedback && (
                          <div className="pt-2 border-t border-neutral-100 flex items-start gap-2 text-purple-900 text-[11px] bg-purple-50/50 p-2 rounded">
                            <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                            <span>
                              <strong>Evaluación Rúbrica:</strong> {sub.responses[sub.responses.length - 1].aiFeedback}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Structured Feedback: Fortalezas y Áreas de Mejora */}
                      {sub.overallFeedback && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg text-emerald-950 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider block text-emerald-800">
                              ✓ Fortalezas Demostradas
                            </span>
                            {sub.overallFeedback.strengths.map((str, si) => (
                              <p key={si} className="text-[11px]">• {str}</p>
                            ))}
                          </div>
                          <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-950 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider block text-amber-800">
                              ▲ Áreas de Mejora y Recomendación
                            </span>
                            {sub.overallFeedback.areasForImprovement.map((imp, ii) => (
                              <p key={ii} className="text-[11px]">• {imp}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center space-y-3">
              <CheckSquare className="w-12 h-12 text-neutral-300 mx-auto" />
              <p className="text-sm font-medium text-neutral-800">Selecciona o crea una actividad</p>
            </div>
          )}

          {/* Consolidated Sheets Table Preview */}
          {activeReport && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">
                    Libreta de Calificaciones Consolidada
                  </span>
                  <h4 className="text-base font-bold text-neutral-900">{activeReport.courseName}</h4>
                </div>
                <a
                  href={activeReport.googleSheetsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en Google Sheets
                </a>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-neutral-50 text-neutral-600 uppercase text-[10px] font-semibold border-b border-neutral-200">
                    <tr>
                      <th className="p-2.5">Estudiante</th>
                      <th className="p-2.5 text-center">Promedio TPs</th>
                      <th className="p-2.5 text-center">Promedio Exámenes</th>
                      <th className="p-2.5 text-center">Nota Final</th>
                      <th className="p-2.5 text-center">Condición</th>
                      <th className="p-2.5">Observación Pedagógica</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {activeReport.records.map((rec) => (
                      <tr key={rec.studentId} className="hover:bg-neutral-50/60">
                        <td className="p-2.5 font-semibold text-neutral-900">{rec.studentName}</td>
                        <td className="p-2.5 text-center text-neutral-700">{rec.tpAverage.toFixed(1)}</td>
                        <td className="p-2.5 text-center text-neutral-700">{rec.examAverage.toFixed(1)}</td>
                        <td className="p-2.5 text-center font-bold text-neutral-900">{rec.finalAverage.toFixed(1)}</td>
                        <td className="p-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              rec.academicStatus === 'Aprobado'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {rec.academicStatus}
                          </span>
                        </td>
                        <td className="p-2.5 text-neutral-600 text-[11px]">{rec.pedagogicalNotes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
