import React, { useState } from 'react';
import {
  Sparkles,
  Send,
  Copy,
  Check,
  FileText,
  Table,
  HelpCircle,
  MessageSquare,
  BookOpen,
  ArrowRight,
  Download,
} from 'lucide-react';
import { Course } from '../../types';
import { api } from '../../services/api';

interface AiAssistantModuleProps {
  courses: Course[];
  initialPrompt?: string;
  onInsertPlan?: (generatedContent: string) => void;
}

export const AiAssistantModule: React.FC<AiAssistantModuleProps> = ({
  courses,
  initialPrompt = '',
  onInsertPlan,
}) => {
  const [assistantType, setAssistantType] = useState<'lesson_plan' | 'rubric' | 'feedback' | 'questions'>('lesson_plan');
  const [selectedCourseId, setSelectedCourseId] = useState<string>(courses[0]?.id || '');
  const [topic, setTopic] = useState('');
  const [customPrompt, setCustomPrompt] = useState(initialPrompt);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<string | null>(null);
  const [sourceEngine, setSourceEngine] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];

  const presets = [
    {
      id: 'lesson_plan',
      title: 'Planificación de Clase (Docs Ready)',
      desc: 'Objetivo, competencias, secuencia didáctica (Inicio, Desarrollo, Cierre) y evaluación formativa.',
      icon: FileText,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      id: 'rubric',
      title: 'Rúbrica Analítica de Evaluación',
      desc: 'Matriz con niveles (Sobresaliente, Notable, Aprobado, En Proceso) y descriptores claros.',
      icon: Table,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      id: 'questions',
      title: 'Banco de Preguntas Evaluativas',
      desc: 'Preguntas diagnósticas, opción múltiple y casos prácticos para Classroom y Google Forms.',
      icon: HelpCircle,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      id: 'feedback',
      title: 'Comentarios de Devolución',
      desc: 'Redacción de sugerencias constructivas y formativas para observaciones de boletín o Classroom.',
      icon: MessageSquare,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  const handleGenerate = async () => {
    if (!topic.trim() && !customPrompt.trim()) {
      alert('Por favor ingresa un tema o instrucción didáctica.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.askAiAssistant({
        type: assistantType,
        subject: activeCourse?.subject || 'Materia General',
        grade: activeCourse?.grade || 'Secundaria',
        topic: topic.trim() || 'Tema propuesto',
        prompt: customPrompt.trim() || `Generar contenido pedagógico para ${topic}`,
      });
      setGeneratedResult(res.result);
      setSourceEngine(res.source);
    } catch (err: any) {
      alert('Error en el asistente: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedResult) return;
    navigator.clipboard.writeText(generatedResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-600" />
          Asistente Pedagógico con Inteligencia Artificial
        </h2>
        <p className="text-xs text-neutral-500">
          Diseñado para optimizar los tiempos de planificación docente, generación de rúbricas y consignas de Google Classroom
        </p>
      </div>

      {/* Tool Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {presets.map((preset) => {
          const Icon = preset.icon;
          const isSelected = assistantType === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => setAssistantType(preset.id as any)}
              className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between ${
                isSelected
                  ? 'bg-purple-50/70 border-purple-400 shadow-xs ring-2 ring-purple-400/20'
                  : 'bg-white border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <div>
                <div className={`p-2 w-fit rounded-lg ${preset.bg} ${preset.color} mb-3`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-bold text-neutral-800">{preset.title}</h3>
                <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{preset.desc}</p>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-purple-700">
                <span>{isSelected ? 'Seleccionado' : 'Elegir'}</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Generator Form & Result Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form */}
        <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-neutral-200 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-neutral-800 uppercase tracking-wide">
            Parámetros del Aula
          </h3>

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Curso / Asignatura Destino
            </label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.grade})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Tema o Eje Curricular
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej: Genética y Leyes de Mendel, Ecuaciones Cuadráticas, IA en la Escuela..."
              className="w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Instrucción Específica o Contexto (Opcional)
            </label>
            <textarea
              rows={3}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Ej: Incluir una actividad experimental con material casero y un ticket de salida rápido para Classroom..."
              className="w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none resize-none"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Sparkles className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Generando propuesta didáctica...' : 'Generar Asistencia Pedagógica'}
          </button>
        </div>

        {/* Right Result Display */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-neutral-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-700 uppercase tracking-wide">
                  Propuesta Didáctica Generada
                </span>
                {sourceEngine && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                    Motor: {sourceEngine}
                  </span>
                )}
              </div>

              {generatedResult && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
                  </button>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-neutral-500 font-medium">
                  Elaborando secuencia didáctica estructurada...
                </p>
              </div>
            ) : generatedResult ? (
              <div className="prose prose-sm max-w-none text-xs text-neutral-800 leading-relaxed font-sans whitespace-pre-wrap max-h-[460px] overflow-y-auto p-4 bg-[#fbfbfd] rounded-lg border border-neutral-100">
                {generatedResult}
              </div>
            ) : (
              <div className="py-20 text-center text-neutral-400 space-y-2">
                <Sparkles className="w-10 h-10 mx-auto opacity-30 text-purple-600" />
                <p className="text-xs font-medium">
                  Selecciona una herramienta pedagógica e ingresa el tema para comenzar.
                </p>
                <p className="text-[11px] text-neutral-400 max-w-sm mx-auto">
                  La respuesta se formateará con la estructura oficial para ser importada directamente en Google Docs o Classroom.
                </p>
              </div>
            )}
          </div>

          {generatedResult && (
            <div className="mt-4 pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-neutral-400">
                Formato compatible con Google Docs y hojas de cálculo Sheets.
              </span>
              <button
                onClick={() => {
                  const blob = new Blob([generatedResult], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `Propuesta_Pedagogica_${topic || 'Tema'}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar Documento
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
