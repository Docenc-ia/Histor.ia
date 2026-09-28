import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Sparkles,
  GraduationCap,
  Send,
  ExternalLink,
  Users,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Clock,
  ArrowRight,
  Plus,
  HelpCircle,
  FileCheck2,
  Share2
} from 'lucide-react';
import { Course, FormActivity } from '../../types';
import { api } from '../../services/api';
import { NotebookLmToolbar } from '../common/NotebookLmToolbar';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface ActivitiesModuleProps {
  courseId: string;
  courses: Course[];
}

export const ActivitiesModule: React.FC<ActivitiesModuleProps> = ({
  courseId,
  courses,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const currentCourse = courses.find((c) => c.id === courseId) || courses[0];
  const [activities, setActivities] = useState<FormActivity[]>([]);
  const [activeActivity, setActiveActivity] = useState<FormActivity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGeneratingForm, setIsGeneratingForm] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);

  // Form Generator State
  const [topic, setTopic] = useState<string>(() => currentCourse?.subject || '');
  const [ageGroup, setAgeGroup] = useState<string>('15-16 años');
  const [activityType, setActivityType] = useState<'Formativa' | 'Diagnóstica' | 'Sumativa' | 'Trabajo Práctico'>('Formativa');
  const [questionCount, setQuestionCount] = useState<number>(3);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (currentCourse) {
      setTopic(currentCourse.subject || '');
    }
  }, [courseId]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const acts = await api.getActivities();
      const filtered = acts.filter((a) => !a.courseId || a.courseId === courseId || courseId === 'c1');
      setActivities(filtered.length > 0 ? filtered : acts);
      if (acts.length > 0) {
        setActiveActivity(acts[0]);
      }
    } catch (err) {
      console.error('Error al cargar actividades:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [courseId]);

  const handleGenerateGoogleForm = async () => {
    try {
      setIsGeneratingForm(true);
      const res = await api.generateFormActivity({
        topic,
        ageGroup,
        activityType,
        courseId,
        questionCount,
      });
      await loadData();
      setActiveActivity(res.activity);
      setStatusMessage('Cuestionario interactivo generado exitosamente en Google Forms.');
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error('Error al generar formulario:', err);
    } finally {
      setIsGeneratingForm(false);
    }
  };

  const handlePublishToClassroom = async (activityId: string) => {
    try {
      setIsPublishing(activityId);
      const res = await api.publishActivityToClassroom(activityId);
      await loadData();
      setStatusMessage(res.message);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error('Error al publicar en Classroom:', err);
    } finally {
      setIsPublishing(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
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
                  ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
                  : 'text-emerald-700 bg-emerald-50 border-emerald-200'
              }`}
            >
              Posibilidad 3
            </span>
            <h2 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
              Actividades y Google Classroom
            </h2>
          </div>
          <p className={`text-xs mt-1 max-w-2xl ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
            Genera cuestionarios pedagógicos en <strong>Google Forms</strong> según nivel etario y publícalos como tarea con <strong>1 solo clic en Google Classroom</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className={`text-xs font-semibold ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>{currentCourse?.name}</p>
            <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>{currentCourse?.grade} • {currentCourse?.studentsCount} estudiantes</p>
          </div>
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
        moduleName="Actividades"
        courseName={currentCourse?.name || 'Materia'}
        documentTitle={activeActivity ? activeActivity.title : `Actividad Didáctica: ${topic}`}
        documentContent={
          activeActivity
            ? `# ${activeActivity.title}\n**Tipo:** ${activeActivity.activityType} | **Nivel:** ${activeActivity.ageGroup}\n**Formulario:** ${activeActivity.googleFormUrl}\n\n### Banco de Preguntas Didácticas:\n${activeActivity.questions.map((q, i) => `${i + 1}. [${q.type}] ${q.prompt}\n${q.options ? q.options.map((o) => `   - ${o}`).join('\n') : ''}\n(Respuesta esperada: ${q.correctAnswer || 'Evaluación cualitativa'})`).join('\n\n')}`
            : `# Actividad Pedagógica: ${topic}\nTipo: ${activityType}\nNivel: ${ageGroup}`
        }
        onImportContent={(importedText, sourceTitle) => {
          setTopic(`Basado en ${sourceTitle}: ${importedText.slice(0, 100)}...`);
        }}
        onInsertVideoPedagogy={(pedagogy) => {
          setTopic(`Análisis de video: ${pedagogy.summary.slice(0, 80)}`);
          setStatusMessage(`¡Conceptos del video insertados! Preguntas sugeridas: ${pedagogy.suggestedQuestions.join(', ')}`);
        }}
        onApplyOptimizedContent={(optimized) => {
          setTopic(optimized.slice(0, 120));
        }}
      />

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form Generator */}
        <div className="lg:col-span-5 space-y-6">
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-4 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
            }`}
          >
            <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? 'border-slate-800' : 'border-neutral-100'}`}>
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                <Sparkles className="w-4 h-4 text-emerald-500" />
                Generar Actividad en Google Forms
              </h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isDarkMode
                    ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-100'
                }`}
              >
                IA Pedagógica
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Tema o Contenido de la Actividad
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Ej: Leyes de Mendel y Cuadros de Punnett"
                  className={`w-full text-xs rounded-xl px-3 py-2.5 transition-all ${
                    isDarkMode
                      ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:bg-slate-750 focus:border-emerald-500'
                      : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Año de la escuela
                  </label>
                  <select
                    value={ageGroup}
                    onChange={(e) => setAgeGroup(e.target.value)}
                    className={`w-full text-xs rounded-xl px-3 py-2.5 transition-all ${
                      isDarkMode
                        ? 'bg-slate-800 border border-slate-700 text-white focus:bg-slate-750 focus:border-emerald-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'
                    }`}
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
                  <label className={`block text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Tipo de Actividad
                  </label>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value as any)}
                    className={`w-full text-xs rounded-xl px-3 py-2.5 transition-all ${
                      isDarkMode
                        ? 'bg-slate-800 border border-slate-700 text-white focus:bg-slate-750 focus:border-emerald-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'
                    }`}
                  >
                    <option value="Formativa">Formativa (Proceso)</option>
                    <option value="Diagnóstica">Diagnóstica (Inicial)</option>
                    <option value="Sumativa">Sumativa (Calificación)</option>
                    <option value="Trabajo Práctico">Trabajo Práctico (TP)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Cantidad de Preguntas
                </label>
                <div className="flex items-center gap-2">
                  {[2, 3, 4, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuestionCount(num)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        questionCount === num
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerateGoogleForm}
                disabled={isGeneratingForm || !topic.trim()}
                className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGeneratingForm ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Creando formulario en Google Forms...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Crear Formulario en Google Forms</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* List of Existing Activities */}
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-3 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-700'}`}>
              Actividades del Curso ({activities.length})
            </h3>

            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {activities.map((act) => {
                const isSelected = activeActivity?.id === act.id;
                return (
                  <div
                    key={act.id}
                    onClick={() => setActiveActivity(act)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      isSelected
                        ? isDarkMode
                          ? 'border-emerald-500 bg-emerald-950/40 shadow-xs'
                          : 'border-emerald-500 bg-emerald-50/50 shadow-xs'
                        : isDarkMode
                        ? 'border-slate-800 hover:border-slate-700 bg-slate-800/40'
                        : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold line-clamp-1 ${isDarkMode ? 'text-slate-100' : 'text-neutral-900'}`}>{act.title}</p>
                      {act.publishedToClassroom ? (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 border ${
                            isDarkMode
                              ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                              : 'text-emerald-700 bg-emerald-100/80 border-emerald-200'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" /> En Classroom
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 border ${
                            isDarkMode
                              ? 'text-amber-300 bg-amber-950/60 border-amber-800/60'
                              : 'text-amber-700 bg-amber-100/80 border-amber-200'
                          }`}
                        >
                          Borrador
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center justify-between text-[11px] mt-1.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      <span>{act.activityType} • {act.questions.length} preguntas</span>
                      <span>{act.submissionsCount || 0} entregas</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Active Activity Details & Classroom Action */}
        <div className="lg:col-span-7 space-y-6">
          {activeActivity ? (
            <div
              className={`rounded-2xl border p-6 shadow-xs space-y-6 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
              }`}
            >
              {/* Header of Active Activity */}
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 ${isDarkMode ? 'border-slate-800' : 'border-neutral-100'}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        isDarkMode
                          ? 'text-slate-300 bg-slate-800 border-slate-700'
                          : 'text-neutral-600 bg-neutral-100 border-neutral-200'
                      }`}
                    >
                      {activeActivity.activityType}
                    </span>
                    <span className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Dirigido a: {activeActivity.ageGroup}
                    </span>
                  </div>
                  <h3 className={`text-base font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                    {activeActivity.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={activeActivity.googleFormsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-3 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors border ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                        : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border-neutral-200'
                    }`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ver Form</span>
                  </a>

                  {!activeActivity.publishedToClassroom ? (
                    <button
                      onClick={() => handlePublishToClassroom(activeActivity.id)}
                      disabled={isPublishing === activeActivity.id}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isPublishing === activeActivity.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <GraduationCap className="w-4 h-4" />
                      )}
                      Publicar en Classroom
                    </button>
                  ) : (
                    <div
                      className={`px-3 py-2 border text-xs font-semibold rounded-xl flex items-center gap-1.5 ${
                        isDarkMode
                          ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Publicado en Classroom</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Questions Breakdown */}
              <div className="space-y-4">
                <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-700'}`}>
                  Preguntas del Cuestionario ({activeActivity.questions.length})
                </h4>

                <div className="space-y-3">
                  {activeActivity.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className={`p-4 rounded-xl border space-y-2 ${
                        isDarkMode
                          ? 'border-slate-800 bg-slate-850/60'
                          : 'border-neutral-200/90 bg-neutral-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                            isDarkMode
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <p className={`text-xs font-semibold flex-1 ${isDarkMode ? 'text-slate-100' : 'text-neutral-900'}`}>
                          {q.prompt}
                        </p>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-slate-300'
                              : 'bg-white border-neutral-200 text-neutral-500'
                          }`}
                        >
                          {q.points} pts
                        </span>
                      </div>

                      {q.type === 'multiple_choice' && q.options && (
                        <div className="pl-8 space-y-1.5 pt-1">
                          {q.options.map((opt, optIdx) => (
                            <div
                              key={optIdx}
                              className={`text-xs p-2 rounded-lg border text-left ${
                                opt === q.correctAnswer
                                  ? isDarkMode
                                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200 font-medium'
                                    : 'bg-emerald-50 border-emerald-300 text-emerald-900 font-medium'
                                  : isDarkMode
                                  ? 'bg-slate-800/80 border-slate-700 text-slate-300'
                                  : 'bg-white border-neutral-200 text-neutral-700'
                              }`}
                            >
                              <span className="font-bold mr-1.5">
                                {String.fromCharCode(65 + optIdx)})
                              </span>
                              {opt}
                              {opt === q.correctAnswer && (
                                <span className={`text-[10px] ml-2 font-bold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                                  (Correcta)
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {q.type === 'open' && (
                        <div
                          className={`pl-8 text-xs rounded-lg p-2.5 border ${
                            isDarkMode
                              ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                              : 'bg-white border-neutral-200 text-neutral-500'
                          }`}
                        >
                          <p className={`font-semibold ${isDarkMode ? 'text-slate-200' : 'text-neutral-700'}`}>Rúbrica analítica esperada:</p>
                          <p className="italic text-[11px] mt-0.5">{q.expectedCriteria}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-2xl border p-12 text-center space-y-3 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
              }`}
            >
              <CheckSquare className={`w-10 h-10 mx-auto ${isDarkMode ? 'text-slate-600' : 'text-neutral-300'}`} />
              <p className={`text-sm font-semibold ${isDarkMode ? 'text-slate-200' : 'text-neutral-700'}`}>No hay actividad seleccionada</p>
              <p className={`text-xs max-w-sm mx-auto ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Selecciona una actividad de la lista de la izquierda o genera un nuevo cuestionario con Google Forms.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
