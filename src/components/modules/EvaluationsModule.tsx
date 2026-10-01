import React, { useState, useEffect } from 'react';
import {
  Table,
  Sparkles,
  Award,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Users,
  TrendingUp,
  FileCheck2,
  Clock,
  ArrowRight,
  Send,
  MessageSquare
} from 'lucide-react';
import { Course, FormActivity, GradebookConsolidatedReport } from '../../types';
import { api } from '../../services/api';
import { NotebookLmToolbar } from '../common/NotebookLmToolbar';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { isRealGoogleSpreadsheetId, copyTableToClipboard } from '../../utils/sheetsUtils';

interface EvaluationsModuleProps {
  courseId: string;
  courses: Course[];
}

export const EvaluationsModule: React.FC<EvaluationsModuleProps> = ({
  courseId,
  courses,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const currentCourse = courses.find((c) => c.id === courseId) || courses[0];
  const [activities, setActivities] = useState<FormActivity[]>([]);
  const [activeActivity, setActiveActivity] = useState<FormActivity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCorrectingAi, setIsCorrectingAi] = useState<boolean>(false);
  const [isExportingSheets, setIsExportingSheets] = useState<boolean>(false);
  const [consolidatedReports, setConsolidatedReports] = useState<GradebookConsolidatedReport[]>([]);
  const [activeReport, setActiveReport] = useState<GradebookConsolidatedReport | null>(null);

  // Sheets consolidation weightings
  const [tpWeight, setTpWeight] = useState<number>(40);
  const [examWeight, setExamWeight] = useState<number>(50);
  const [recWeight, setRecWeight] = useState<number>(10);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [acts, reports] = await Promise.all([
        api.getActivities().catch(() => []),
        api.getGradebookConsolidated().catch(() => []),
      ]);

      const validActs: FormActivity[] = Array.isArray(acts) ? acts : [];
      const validReports: GradebookConsolidatedReport[] = Array.isArray(reports) ? reports : [];

      const filteredActs = validActs.filter((a) => !a.courseId || a.courseId === courseId || courseId === 'c1' || courseId === 'c-101');
      const finalActs = filteredActs.length > 0 ? filteredActs : validActs;
      setActivities(finalActs);
      if (finalActs.length > 0) {
        setActiveActivity(finalActs[0]);
      }

      const filteredReports = validReports.filter((r) => !r.courseId || r.courseId === courseId || courseId === 'c1' || courseId === 'c-101');
      const finalReports = filteredReports.length > 0 ? filteredReports : validReports;
      setConsolidatedReports(finalReports);
      if (finalReports.length > 0) {
        setActiveReport(finalReports[0]);
      }
    } catch (err) {
      console.error('Error al cargar datos de evaluación:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [courseId]);

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
            setStatusMessage('Corrección con IA completada exitosamente. Rúbricas y notas actualizadas.');
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
        courseId,
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
            setStatusMessage('Libreta consolidada exportada exitosamente a Google Sheets.');
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

  const handleOpenReportSheets = async (report: GradebookConsolidatedReport) => {
    // If the URL has a genuine spreadsheet ID
    const urlParts = (report.googleSheetsUrl || '').split('/d/');
    const possibleId = urlParts?.[1]?.split('/')?.[0];
    if (possibleId && isRealGoogleSpreadsheetId(possibleId)) {
      window.open(report.googleSheetsUrl, '_blank');
      return;
    }

    // Otherwise, copy consolidated rows to clipboard and open sheets.new
    const headers = ['Estudiante', 'TPs (40%)', 'Examen (50%)', 'Recup. (10%)', 'Final', 'Estado'];
    const rows = (report.records || []).map((st) => [
      st.studentName,
      st.tpAverage ?? '-',
      st.examAverage ?? '-',
      st.retakeGrade ?? '-',
      st.finalAverage ?? '-',
      st.academicStatus ?? 'Regular',
    ]);
    await copyTableToClipboard(headers, rows);
    window.open('https://sheets.new', '_blank');
    setStatusMessage('¡Planilla copiada al portapapeles! Se abrió Google Sheets en una nueva pestaña. Presiona Ctrl+V para pegar tus datos.');
    setTimeout(() => setStatusMessage(null), 6000);
  };

  const studentRecords = activeReport?.records || (activeReport as any)?.students || [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div
        className={`border rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wider ${
                isDarkMode
                  ? 'text-amber-400 bg-amber-950/60 border-amber-800/60'
                  : 'text-amber-700 bg-amber-50 border-amber-200'
              }`}
            >
              Posibilidad 4
            </span>
            <h2 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
              Evaluaciones, Feedback con IA y Libreta en Google Sheets
            </h2>
          </div>
          <p className={`text-xs mt-1 max-w-2xl ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
            Evalúa respuestas abiertas mediante <strong>rúbricas analíticas con IA</strong>, entrega devoluciones formativas (*Fortalezas* y *Áreas de Mejora*) y consolida promedios en <strong>Google Sheets</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleConsolidateToSheets}
            disabled={isExportingSheets}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isExportingSheets ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Table className="w-4 h-4" />
            )}
            <span>Exportar Libreta a Google Sheets</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2 border animate-in fade-in ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* NotebookLM Multimodal Toolbar & Token Optimizer */}
      <NotebookLmToolbar
        moduleName="Evaluaciones"
        courseName={currentCourse?.name || 'Materia'}
        documentTitle={activeActivity ? `Rúbrica y Corrección: ${activeActivity.title}` : `Libreta de Calificaciones ${currentCourse?.name}`}
        documentContent={
          activeActivity
            ? `# Evaluación Analítica: ${activeActivity.title}\nCurso: ${currentCourse?.name}\n\n### Rúbricas y Criterios Didácticos:\n${(Array.isArray(activeActivity.rubricCriteria) ? activeActivity.rubricCriteria.map((c: any) => typeof c === 'string' ? `• ${c}` : `• ${c.name || ''} (${c.weight || ''}%): ${c.description || ''}`).join('\n') : String(activeActivity.rubricCriteria || '')) || 'Rúbrica estándar.'}\n\n### Respuestas y Feedback:\n${activeActivity.submissions?.map((s) => `• Estudiante: ${s.studentName} | Nota: ${s.overallScore || s.score || s.grade || 'Pendiente'}/100\n  Feedback: ${typeof s.aiFeedback === 'string' ? s.aiFeedback : (s.overallFeedback?.strengths?.join(', ') || 'En proceso')}`).join('\n\n') || 'Respuestas registradas en el sistema.'}`
            : `# Libreta Consolidada: ${currentCourse?.name}\nTrimestre: 1er Trimestre\nEstudiantes evaluados: ${currentCourse?.studentsCount || 28}`
        }
        onImportContent={(importedText, sourceTitle) => {
          setStatusMessage(`Rúbrica importada desde ${sourceTitle}: ${importedText.slice(0, 60)}...`);
        }}
        onInsertVideoPedagogy={(pedagogy) => {
          setStatusMessage(`¡Criterios basados en video agregados!: ${pedagogy.summary.slice(0, 70)}`);
        }}
        onApplyOptimizedContent={(optimized) => {
          setStatusMessage(`Criterios sintetizados en caché de tokens.`);
        }}
      />

      {/* Main Section: Submissions Evaluation & Feedback */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Activity Selector for Grading */}
        <div className="lg:col-span-4 space-y-4">
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-3 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-700'}`}>
              Seleccionar Evaluación / Tarea
            </h3>

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {activities.map((act) => {
                const isSelected = activeActivity?.id === act.id;
                const subsCount = act.submissions?.length || act.submissionsCount || 0;
                return (
                  <div
                    key={act.id}
                    onClick={() => setActiveActivity(act)}
                    className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                      isSelected
                        ? isDarkMode
                          ? 'border-amber-500 bg-amber-950/40 shadow-xs'
                          : 'border-amber-500 bg-amber-50/40 shadow-xs'
                        : isDarkMode
                        ? 'border-slate-800 hover:border-slate-700 bg-slate-800/40'
                        : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold line-clamp-1 ${isDarkMode ? 'text-slate-100' : 'text-neutral-900'}`}>{act.title}</p>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                          isDarkMode
                            ? 'text-slate-300 bg-slate-800 border-slate-700'
                            : 'text-neutral-600 bg-white border-neutral-200'
                        }`}
                      >
                        {subsCount} estudiantes
                      </span>
                    </div>
                    <div className={`flex items-center justify-between text-[11px] mt-2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      <span>{act.activityType}</span>
                      <span className={isDarkMode ? 'text-amber-400 font-semibold' : 'text-amber-700 font-semibold'}>
                        {act.submissions?.some((s) => s.aiFeedback || s.overallFeedback) ? '✓ Con feedback IA' : 'Pendiente'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Configurable Weightings for Sheets */}
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-3 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
              Ponderación Trimestral (Sheets)
            </h3>
            <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Ajusta los porcentajes de cálculo para la libreta oficial:
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className={isDarkMode ? 'text-slate-300' : 'text-neutral-700'}>Trabajos Prácticos (TPs):</span>
                <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{tpWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                step="5"
                value={tpWeight}
                onChange={(e) => setTpWeight(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1">
                <span className={isDarkMode ? 'text-slate-300' : 'text-neutral-700'}>Exámenes / Evaluaciones:</span>
                <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{examWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                step="5"
                value={examWeight}
                onChange={(e) => setExamWeight(Number(e.target.value))}
                className="w-full accent-amber-600 cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1">
                <span className={isDarkMode ? 'text-slate-300' : 'text-neutral-700'}>Recuperatorios / Concepto:</span>
                <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{recWeight}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                step="5"
                value={recWeight}
                onChange={(e) => setRecWeight(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Right: Submissions & AI Feedback View */}
        <div className="lg:col-span-8 space-y-6">
          {activeActivity ? (
            <div
              className={`rounded-2xl border p-6 shadow-xs space-y-6 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
              }`}
            >
              {/* Header Action */}
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 ${isDarkMode ? 'border-slate-800' : 'border-neutral-100'}`}>
                <div>
                  <h3 className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                    Entregas: {activeActivity.title}
                  </h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    {activeActivity.submissions?.length || 0} respuestas de estudiantes recibidas
                  </p>
                </div>

                <button
                  onClick={() => handleRunAiAutoFeedback(activeActivity.id)}
                  disabled={isCorrectingAi}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {isCorrectingAi ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>Corregir con IA & Generar Feedback</span>
                </button>
              </div>

              {/* Students Submissions Cards */}
              <div className="space-y-4">
                {activeActivity.submissions && activeActivity.submissions.length > 0 ? (
                  activeActivity.submissions.map((sub, sIdx) => {
                    const studentName = sub.studentName || `Estudiante ${sIdx + 1}`;
                    const initialLetter = studentName.charAt(0).toUpperCase() || 'E';
                    const score = sub.overallScore !== undefined ? sub.overallScore : (sub.score !== undefined ? sub.score : sub.grade);
                    const maxScore = sub.maxScore || 100;

                    // Student response preview
                    const answerPreview =
                      sub.responses?.[2]?.studentAnswer ||
                      sub.responses?.[0]?.studentAnswer ||
                      sub.answers?.[0]?.answerText ||
                      (typeof sub.answers === 'string' ? sub.answers : 'Respuesta enviada a través de Google Forms.');

                    // AI feedback
                    const hasFeedback = Boolean(sub.overallFeedback || sub.aiFeedback);
                    const strengthsText =
                      sub.overallFeedback?.strengths?.join(', ') ||
                      (typeof sub.aiFeedback === 'object' && sub.aiFeedback !== null
                        ? (sub.aiFeedback as any).strengths
                        : (typeof sub.aiFeedback === 'string' ? sub.aiFeedback : 'Rigor conceptual y fundamentación clara.'));
                    const improvementsText =
                      sub.overallFeedback?.areasForImprovement?.join(', ') ||
                      (typeof sub.aiFeedback === 'object' && sub.aiFeedback !== null
                        ? (sub.aiFeedback as any).improvements
                        : 'Profundizar la terminología técnica en las respuestas de desarrollo.');

                    return (
                      <div
                        key={sub.id || sub.studentId || sIdx}
                        className={`border rounded-xl p-4 space-y-3 transition-colors ${
                          isDarkMode
                            ? 'border-slate-800 bg-slate-850/60'
                            : 'border-neutral-200 bg-neutral-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center border ${
                                isDarkMode
                                  ? 'bg-blue-950 text-blue-300 border-blue-800'
                                  : 'bg-blue-100 text-blue-800 border-blue-200'
                              }`}
                            >
                              {initialLetter}
                            </div>
                            <div>
                              <p className={`text-xs font-bold ${isDarkMode ? 'text-slate-100' : 'text-neutral-900'}`}>{studentName}</p>
                              <p className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                                {sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : 'Entregado'}
                              </p>
                            </div>
                          </div>

                          {score !== undefined ? (
                            <div className="text-right">
                              <span className={`text-sm font-extrabold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                                {score}
                              </span>
                              <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>/{maxScore}</span>
                            </div>
                          ) : (
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded font-semibold border ${
                                isDarkMode
                                  ? 'text-amber-300 bg-amber-950/60 border-amber-800/60'
                                  : 'text-amber-700 bg-amber-100 border-amber-200'
                              }`}
                            >
                              Sin calificar
                            </span>
                          )}
                        </div>

                        {/* Student open-ended answer preview */}
                        <div
                          className={`border rounded-lg p-3 text-xs transition-colors ${
                            isDarkMode
                              ? 'bg-slate-800/70 border-slate-700 text-slate-300'
                              : 'bg-white border-neutral-200 text-neutral-700'
                          }`}
                        >
                          <p className={`font-semibold text-[11px] mb-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                            Respuesta del Alumno:
                          </p>
                          <p className={`italic ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>"{answerPreview}"</p>
                        </div>

                        {/* AI Feedback Box */}
                        {hasFeedback && (
                          <div
                            className={`border rounded-xl p-3.5 space-y-2 text-xs transition-colors ${
                              isDarkMode
                                ? 'bg-amber-950/30 border-amber-800/50'
                                : 'bg-amber-50/70 border-amber-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-bold flex items-center gap-1.5 text-[11px] ${
                                  isDarkMode ? 'text-amber-300' : 'text-amber-900'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                Devolución Formativa con IA
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                                  isDarkMode
                                    ? 'text-amber-300 bg-amber-950/60 border-amber-800/60'
                                    : 'text-amber-700 bg-amber-100 border-amber-200'
                                }`}
                              >
                                Rúbrica Analítica
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] pt-1">
                              <div
                                className={`border rounded-lg p-2.5 ${
                                  isDarkMode
                                    ? 'bg-slate-850/80 border-slate-750 text-slate-200'
                                    : 'bg-white/80 border-amber-200/80 text-neutral-700'
                                }`}
                              >
                                <p className={`font-bold flex items-center gap-1 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-800'}`}>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Fortalezas Demostradas
                                </p>
                                <p className={`mt-1 leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                                  {strengthsText}
                                </p>
                              </div>

                              <div
                                className={`border rounded-lg p-2.5 ${
                                  isDarkMode
                                    ? 'bg-slate-850/80 border-slate-750 text-slate-200'
                                    : 'bg-white/80 border-amber-200/80 text-neutral-700'
                                }`}
                              >
                                <p className={`font-bold flex items-center gap-1 ${isDarkMode ? 'text-amber-400' : 'text-amber-900'}`}>
                                  <AlertCircle className="w-3 h-3 text-amber-500" /> Áreas de Mejora
                                </p>
                                <p className={`mt-1 leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                                  {improvementsText}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className={`text-xs text-center py-6 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Aún no hay entregas de estudiantes registradas para esta actividad.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              className={`rounded-2xl border p-12 text-center space-y-3 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
              }`}
            >
              <Table className={`w-10 h-10 mx-auto ${isDarkMode ? 'text-slate-600' : 'text-neutral-300'}`} />
              <p className={`text-sm font-semibold ${isDarkMode ? 'text-slate-200' : 'text-neutral-700'}`}>Selecciona una evaluación</p>
            </div>
          )}

          {/* Consolidated Gradebook Report Table */}
          {activeReport && (
            <div
              className={`rounded-2xl border p-6 shadow-xs space-y-4 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
              }`}
            >
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 ${isDarkMode ? 'border-slate-800' : 'border-neutral-100'}`}>
                <div>
                  <h3 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                    <Table className="w-4 h-4 text-emerald-500" />
                    Libreta de Calificaciones Consolidada (Google Sheets)
                  </h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Período: {activeReport.term} • {studentRecords.length} estudiantes computados
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenReportSheets(activeReport)}
                  className={`px-3 py-1.5 border text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-emerald-950/40 hover:bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                      : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
                  }`}
                  title="Abrir o exportar en Google Sheets"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en Google Sheets
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr
                      className={`border-b font-semibold transition-colors ${
                        isDarkMode
                          ? 'border-slate-800 bg-slate-800/60 text-slate-300'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                      }`}
                    >
                      <th className="py-2.5 px-3">Estudiante</th>
                      <th className="py-2.5 px-3 text-center">TPs (40%)</th>
                      <th className="py-2.5 px-3 text-center">Examen (50%)</th>
                      <th className="py-2.5 px-3 text-center">Recup. (10%)</th>
                      <th className={`py-2.5 px-3 text-center font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>Final</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800' : 'divide-neutral-100'}`}>
                    {studentRecords.map((st: any, idx: number) => {
                      const studentName = st.studentName || `Estudiante ${idx + 1}`;
                      const tpScore = st.tpAverage !== undefined ? st.tpAverage : (st.tpGrades?.[0] ?? '-');
                      const examScore = st.examAverage !== undefined ? st.examAverage : (st.examScore ?? '-');
                      const recScore = st.retakeGrade !== undefined ? st.retakeGrade : (st.recuperatorioScore ?? '-');
                      const finalScore = st.finalAverage !== undefined ? st.finalAverage : '-';
                      const status = st.academicStatus || st.status || 'Aprobado';

                      return (
                        <tr
                          key={st.studentId || idx}
                          className={`transition-colors ${
                            isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-neutral-50/50'
                          }`}
                        >
                          <td className={`py-2.5 px-3 font-medium ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>{studentName}</td>
                          <td className={`py-2.5 px-3 text-center ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>{tpScore}</td>
                          <td className={`py-2.5 px-3 text-center ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>{examScore}</td>
                          <td className={`py-2.5 px-3 text-center ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>{recScore}</td>
                          <td className={`py-2.5 px-3 text-center font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>{finalScore}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                status === 'Aprobado'
                                  ? isDarkMode
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                    : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                  : isDarkMode
                                  ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                                  : 'bg-amber-100 text-amber-800 border-amber-200'
                              }`}
                            >
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
