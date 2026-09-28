import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  ExternalLink,
  Copy,
  Download,
  Share2,
  Video,
  Volume2,
  Play,
  Pause,
  RotateCcw,
  Zap,
  FileText,
  Upload,
  Check,
  ChevronDown,
  ChevronUp,
  FolderSync,
  HelpCircle,
  Headphones,
  Maximize2,
  Minimize2,
  Layers,
  ArrowRight
} from 'lucide-react';
import { api } from '../../services/api';

export interface NotebookLmToolbarProps {
  moduleName: 'Planificación' | 'Material Didáctico' | 'Actividades' | 'Evaluaciones';
  courseName: string;
  documentTitle: string;
  documentContent: string;
  onImportContent?: (importedText: string, sourceTitle: string) => void;
  onInsertVideoPedagogy?: (pedagogy: {
    summary: string;
    keyConcepts: string[];
    suggestedQuestions: string[];
    suggestedClassActivity: string;
  }) => void;
  onApplyOptimizedContent?: (optimizedText: string) => void;
}

export const NotebookLmToolbar: React.FC<NotebookLmToolbarProps> = ({
  moduleName,
  courseName,
  documentTitle,
  documentContent,
  onImportContent,
  onInsertVideoPedagogy,
  onApplyOptimizedContent,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'video' | 'audio' | 'tokens'>('export');
  const [copied, setCopied] = useState<boolean>(false);
  const [driveSaved, setDriveSaved] = useState<boolean>(false);

  // Video analysis state
  const [videoUrl, setVideoUrl] = useState<string>('https://www.youtube.com/watch?v=clase-didactica');
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState<boolean>(false);
  const [videoAnalysisResult, setVideoAnalysisResult] = useState<any>(null);

  // Audio overview state
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [audioScript, setAudioScript] = useState<any>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [currentSpeakerIndex, setCurrentSpeakerIndex] = useState<number>(0);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  // Token optimization state
  const [isOptimizingTokens, setIsOptimizingTokens] = useState<boolean>(false);
  const [tokenStats, setTokenStats] = useState<{
    originalTokens: number;
    optimizedTokens: number;
    savedTokens: number;
    percentageSaved: number;
    compressedContent: string;
    keyPoints: string[];
  } | null>(null);

  // Import local state
  const [importText, setImportText] = useState<string>('');
  const [importSourceTitle, setImportSourceTitle] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Format document for NotebookLM
  const getNotebookLmFormattedText = () => {
    return `# ${documentTitle || `Documento de ${moduleName}`}
**Materia:** ${courseName}
**Módulo:** ${moduleName} - Docenc.IA
**Fecha:** ${new Date().toLocaleDateString('es-AR')}
**Propósito:** Fuente de conocimiento curada para análisis, generación de guías y preguntas pedagógicas.

---

${documentContent || '(No hay contenido cargado en este momento)'}

---
*Generado y curado mediante Docenc.IA - Integración pedagógica para Google Workspace & NotebookLM*`;
  };

  // 1. Copy to clipboard
  const handleCopyForNotebookLm = () => {
    const text = getNotebookLmFormattedText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // 2. Download markdown file
  const handleDownloadMarkdown = () => {
    const text = getNotebookLmFormattedText();
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeTitle = (documentTitle || `docencia-${moduleName}`)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');
    link.download = `${safeTitle}-fuente-notebooklm.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 3. Save to Google Drive
  const handleSaveToDrive = async () => {
    try {
      setDriveSaved(true);
      await api.uploadDriveFile({
        name: `${documentTitle || moduleName} (Fuente NotebookLM).md`,
        type: 'doc',
        folder: courseName || 'General',
      });
      setTimeout(() => setDriveSaved(false), 3000);
    } catch {
      setDriveSaved(false);
    }
  };

  // 4. Video analysis
  const handleAnalyzeVideo = async () => {
    if (!videoUrl) return;
    try {
      setIsAnalyzingVideo(true);
      const res = await api.analyzeVideoPedagogical({
        videoUrl,
        moduleType: moduleName,
        transcript: `Video de apoyo para ${moduleName} sobre ${documentTitle || courseName}.`,
      });
      setVideoAnalysisResult(res.pedagogicalOutput);
    } catch (err) {
      console.error('Error al analizar video:', err);
    } finally {
      setIsAnalyzingVideo(false);
    }
  };

  // 5. Audio Overview (Podcast Generator & Player)
  const handleGenerateAudioOverview = async () => {
    try {
      setIsGeneratingAudio(true);
      const res = await api.generateAudioOverview({
        title: documentTitle || `Clase de ${courseName}`,
        content: documentContent,
        courseName,
        subject: courseName,
      });
      setAudioScript(res);
      setCurrentSpeakerIndex(0);
    } catch (err) {
      console.error('Error generando audio overview:', err);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handlePlayAudio = () => {
    if (!audioScript || !audioScript.script || audioScript.script.length === 0) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (isPlayingAudio) {
      window.speechSynthesis.pause();
      setIsPlayingAudio(false);
      return;
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPlayingAudio(true);
      return;
    }

    // Play from beginning or current index
    window.speechSynthesis.cancel();
    playSpeakerTurn(currentSpeakerIndex);
  };

  const playSpeakerTurn = (index: number) => {
    if (!audioScript || !audioScript.script || index >= audioScript.script.length) {
      setIsPlayingAudio(false);
      setCurrentSpeakerIndex(0);
      return;
    }

    setCurrentSpeakerIndex(index);
    setIsPlayingAudio(true);

    const turn = audioScript.script[index];
    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.lang = 'es-ES';
    utterance.rate = speechRate;

    // Distinguish pitch between female & male speakers
    if (turn.speaker.includes('Sofía')) {
      utterance.pitch = 1.15;
    } else {
      utterance.pitch = 0.9;
    }

    utterance.onend = () => {
      playSpeakerTurn(index + 1);
    };

    utterance.onerror = () => {
      setIsPlayingAudio(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleStopAudio = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingAudio(false);
    setCurrentSpeakerIndex(0);
  };

  // 6. Token Optimizer
  const handleOptimizeTokens = async () => {
    if (!documentContent) return;
    try {
      setIsOptimizingTokens(true);
      const res = await api.optimizeTokens({ text: documentContent });
      setTokenStats(res);
    } catch (err) {
      console.error('Error optimizando tokens:', err);
    } finally {
      setIsOptimizingTokens(false);
    }
  };

  // 7. Local File Import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setImportText(text);
        setImportSourceTitle(file.name);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950 text-white rounded-2xl border border-blue-500/30 shadow-xl overflow-hidden transition-all duration-300">
      {/* Top Banner / Bar Header */}
      <div className="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-300 font-bold shadow-inner">
            <Sparkles className="w-4 h-4 text-blue-300 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm sm:text-base tracking-tight text-white flex items-center gap-1.5">
                Integración NotebookLM & Herramientas Multimodales
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30">
                {moduleName}
              </span>
            </div>
            <p className="text-xs text-blue-200/70 hidden sm:block">
              Exporta fuentes, analiza videos didácticos, genera podcast de audio y ahorra tokens con caché semántico.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Direct link to Google NotebookLM */}
          <a
            href="https://notebooklm.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-medium text-white transition-all shadow-xs"
            title="Abrir Google NotebookLM en una pestaña nueva"
          >
            <span>Ir a NotebookLM</span>
            <ExternalLink className="w-3 h-3 text-blue-300" />
          </a>

          {/* Expand / Collapse Drawer button */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-900/40 transition-all"
          >
            <span>{isOpen ? 'Ocultar Herramientas' : 'Herramientas de Módulo'}</span>
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expandable Workspace Drawer */}
      {isOpen && (
        <div className="p-4 sm:p-6 space-y-5 bg-black/30 backdrop-blur-xs">
          {/* Navigation Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
            <button
              type="button"
              onClick={() => setActiveTab('export')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'export'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-300'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Exportar a NotebookLM</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'import'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-300'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar Fuentes al Módulo</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('video')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'video'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-300'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>Herramientas de Video</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'audio'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-300'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>Podcast Audio Overview</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tokens')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'tokens'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-300'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Ahorro de Tokens (Caché)</span>
            </button>
          </div>

          {/* TAB 1: EXPORT TO NOTEBOOKLM & GOOGLE WORKSPACE */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="bg-white/5 p-4 rounded-xl border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-sm text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-400" />
                    Paquete Curado para NotebookLM ({moduleName})
                  </h4>
                  <p className="text-xs text-neutral-300 mt-0.5">
                    Prepara el contenido actual con metadatos estructurados, citas pedagógicas y formato Markdown listo para añadir como <strong>Fuente</strong> en Google NotebookLM.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={handleCopyForNotebookLm}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                      copied ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                    }`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? '¡Copiado al portapapeles!' : 'Copiar para NotebookLM'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadMarkdown}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition-all"
                    title="Descargar archivo .md para subirlo arrastrando a NotebookLM"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar .md</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveToDrive}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      driveSaved
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                    }`}
                    title="Guardar en la carpeta de Google Drive del curso"
                  >
                    <FolderSync className="w-3.5 h-3.5 text-blue-300" />
                    <span>{driveSaved ? '¡Guardado en Drive!' : 'Guardar en Drive'}</span>
                  </button>
                </div>
              </div>

              {/* Preview Box */}
              <div className="bg-neutral-950/60 rounded-xl p-3 border border-white/10">
                <div className="text-[11px] font-mono text-neutral-400 mb-1 flex items-center justify-between">
                  <span>Vista previa de la fuente formateada:</span>
                  <span>{documentContent ? `${documentContent.length} caracteres` : 'Vacío'}</span>
                </div>
                <div className="max-h-40 overflow-y-auto text-xs font-mono text-neutral-300 bg-neutral-900/80 p-2.5 rounded-lg border border-white/5 whitespace-pre-wrap leading-relaxed">
                  {getNotebookLmFormattedText()}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: IMPORT SOURCES TO THIS MODULE */}
          {activeTab === 'import' && (
            <div className="space-y-4">
              <p className="text-xs text-neutral-300">
                Trae apuntes, programas curriculares, notas tomadas en NotebookLM o PDFs de Google Drive para utilizarlos de inmediato en este módulo de <strong>{moduleName}</strong>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option A: Paste text */}
                <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Pegar texto o notas de NotebookLM</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] text-blue-300 hover:text-blue-200 underline flex items-center gap-1"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Cargar archivo .txt/.md</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.doc,.docx"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>

                  <input
                    type="text"
                    value={importSourceTitle}
                    onChange={(e) => setImportSourceTitle(e.target.value)}
                    placeholder="Título de la fuente (ej. Apunte Unidad 3, Resumen NotebookLM)"
                    className="w-full text-xs px-3 py-2 bg-neutral-900/80 border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-400"
                  />

                  <textarea
                    rows={4}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Pega aquí el contenido, resumen o guía exportada desde NotebookLM o tu procesador de textos..."
                    className="w-full text-xs px-3 py-2 bg-neutral-900/80 border border-white/20 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-400 resize-none font-mono"
                  />

                  <button
                    type="button"
                    disabled={!importText.trim()}
                    onClick={() => {
                      if (onImportContent) {
                        onImportContent(importText, importSourceTitle || 'Fuente importada');
                      }
                    }}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>Aplicar fuente al formulario de {moduleName}</span>
                  </button>
                </div>

                {/* Option B: Quick Templates / Drive Sync */}
                <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-3">
                  <span className="text-xs font-semibold text-white">Fuentes rápidas sugeridas para {courseName}</span>
                  <div className="space-y-2 text-xs">
                    <div
                      onClick={() => {
                        setImportSourceTitle('Diseño Curricular Provincial NAP 2026');
                        setImportText('Núcleos de Aprendizaje Prioritarios: Alfabetización científica, resolución de problemas prácticos, experimentación en laboratorio y aplicación ética de la tecnología.');
                      }}
                      className="p-2.5 bg-neutral-900/60 hover:bg-blue-900/30 rounded-lg border border-white/10 cursor-pointer transition-colors"
                    >
                      <div className="font-semibold text-blue-300">Diseño Curricular Provincial NAP 2026</div>
                      <div className="text-[11px] text-neutral-400">Pautas institucionales y competencias prioritarias.</div>
                    </div>

                    <div
                      onClick={() => {
                        setImportSourceTitle('Notas de clase y Glosario Didáctico');
                        setImportText('Glosario esencial: Conceptos nucleares, relaciones analógicas con la vida cotidiana y 5 preguntas detonantes para iniciar la clase.');
                      }}
                      className="p-2.5 bg-neutral-900/60 hover:bg-blue-900/30 rounded-lg border border-white/10 cursor-pointer transition-colors"
                    >
                      <div className="font-semibold text-blue-300">Notas de clase y Glosario Didáctico</div>
                      <div className="text-[11px] text-neutral-400">Extraído de síntesis previas o carpetas de Drive.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VIDEO PEDAGOGICAL TOOLS */}
          {activeTab === 'video' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Enlace de video de YouTube o clase grabada:
                  </label>
                  <input
                    type="url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full text-xs px-3 py-2 bg-neutral-900/80 border border-white/20 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div className="sm:self-end">
                  <button
                    type="button"
                    disabled={isAnalyzingVideo || !videoUrl}
                    onClick={handleAnalyzeVideo}
                    className="w-full sm:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-1.5"
                  >
                    {isAnalyzingVideo ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Analizando video...</span>
                      </>
                    ) : (
                      <>
                        <Video className="w-3.5 h-3.5" />
                        <span>Extraer Pedagogía del Video</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {videoAnalysisResult && (
                <div className="bg-neutral-950/70 rounded-xl p-4 border border-purple-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Análisis Didáctico Estructurado
                    </span>
                    {onInsertVideoPedagogy && (
                      <button
                        type="button"
                        onClick={() => onInsertVideoPedagogy(videoAnalysisResult)}
                        className="px-2.5 py-1 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/40 rounded-lg text-[11px] font-semibold text-purple-200 transition-colors"
                      >
                        Insertar en este módulo
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-neutral-200 leading-relaxed bg-neutral-900/80 p-2.5 rounded-lg border border-white/5">
                    {videoAnalysisResult.summary}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="bg-neutral-900/60 p-2.5 rounded-lg border border-white/5">
                      <div className="font-semibold text-purple-300 mb-1">Conceptos Clave Explicados:</div>
                      <ul className="list-disc list-inside text-neutral-300 space-y-1 text-[11px]">
                        {videoAnalysisResult.keyConcepts.map((k: string, i: number) => (
                          <li key={i}>{k}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-neutral-900/60 p-2.5 rounded-lg border border-white/5">
                      <div className="font-semibold text-purple-300 mb-1">Preguntas de Reflexión Sugeridas:</div>
                      <ul className="list-disc list-inside text-neutral-300 space-y-1 text-[11px]">
                        {videoAnalysisResult.suggestedQuestions.map((q: string, i: number) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: AUDIO OVERVIEW (PODCAST PEDAGÓGICO) */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="bg-white/5 p-4 rounded-xl border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-emerald-400" />
                    Audio Overview Pedagógico (Estilo NotebookLM)
                  </h4>
                  <p className="text-xs text-neutral-300 mt-0.5">
                    Genera una síntesis conversacional entre la Profa. Sofía y el Prof. Martín para repasar los contenidos en audio.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isGeneratingAudio}
                  onClick={handleGenerateAudioOverview}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
                >
                  {isGeneratingAudio ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Generando guión...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{audioScript ? 'Regenerar Podcast' : 'Generar Audio Overview'}</span>
                    </>
                  )}
                </button>
              </div>

              {audioScript && (
                <div className="bg-neutral-950/70 rounded-xl p-4 border border-emerald-500/30 space-y-4">
                  {/* Audio Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handlePlayAudio}
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-bold transition-all ${
                          isPlayingAudio
                            ? 'bg-amber-500 text-black shadow-amber-500/50'
                            : 'bg-emerald-500 text-white shadow-emerald-500/50'
                        } shadow-lg`}
                        title={isPlayingAudio ? 'Pausar audio' : 'Reproducir audio'}
                      >
                        {isPlayingAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={handleStopAudio}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-neutral-300 flex items-center justify-center transition-colors"
                        title="Detener y reiniciar"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>

                      <div className="text-xs">
                        <div className="font-semibold text-white">{audioScript.title}</div>
                        <div className="text-[11px] text-emerald-300">
                          {isPlayingAudio ? 'Reproduciendo con síntesis de voz...' : 'Listo para reproducir'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-neutral-300">
                      <span>Velocidad:</span>
                      {[0.9, 1.0, 1.25].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => setSpeechRate(rate)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            speechRate === rate
                              ? 'bg-emerald-600 text-white font-bold'
                              : 'bg-white/10 text-neutral-400 hover:text-white'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Conversation Script Flow */}
                  <div className="space-y-2.5 max-h-52 overflow-y-auto pr-2">
                    {audioScript.script.map((turn: any, index: number) => {
                      const isCurrent = isPlayingAudio && currentSpeakerIndex === index;
                      return (
                        <div
                          key={index}
                          className={`p-3 rounded-xl transition-all border ${
                            isCurrent
                              ? 'bg-emerald-950/60 border-emerald-400/60 shadow-md ring-1 ring-emerald-400/30'
                              : 'bg-neutral-900/60 border-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">{turn.avatar}</span>
                            <span className="text-xs font-bold text-white">{turn.speaker}</span>
                            <span className="text-[10px] text-neutral-400">({turn.role})</span>
                          </div>
                          <p className="text-xs text-neutral-200 leading-relaxed pl-6">{turn.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: TOKEN OPTIMIZER & CONTEXT CACHING */}
          {activeTab === 'tokens' && (
            <div className="space-y-4">
              <div className="bg-white/5 p-4 rounded-xl border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Optimizador de Tokens & Caché Semántico
                  </h4>
                  <p className="text-xs text-neutral-300 mt-0.5">
                    Comprime la bibliografía y documentos extensos en índices densos antes de enviarlos a Gemini, reduciendo el consumo de cuota diaria hasta un 80%.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isOptimizingTokens || !documentContent}
                  onClick={handleOptimizeTokens}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
                >
                  {isOptimizingTokens ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Comprimiendo...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Optimizar Documento Activo</span>
                    </>
                  )}
                </button>
              </div>

              {tokenStats && (
                <div className="bg-neutral-950/70 rounded-xl p-4 border border-amber-500/30 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-white/5">
                      <div className="text-[10px] text-neutral-400 uppercase">Tokens Originales</div>
                      <div className="text-lg font-bold text-white mt-0.5">{tokenStats.originalTokens}</div>
                    </div>

                    <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-white/5">
                      <div className="text-[10px] text-neutral-400 uppercase">Tokens Optimizados</div>
                      <div className="text-lg font-bold text-amber-400 mt-0.5">{tokenStats.optimizedTokens}</div>
                    </div>

                    <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-white/5">
                      <div className="text-[10px] text-neutral-400 uppercase">Tokens Ahorrados</div>
                      <div className="text-lg font-bold text-emerald-400 mt-0.5">+{tokenStats.savedTokens}</div>
                    </div>

                    <div className="bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-500/30">
                      <div className="text-[10px] text-emerald-300 uppercase font-semibold">% Ahorro Cuota</div>
                      <div className="text-lg font-bold text-emerald-300 mt-0.5">{tokenStats.percentageSaved}%</div>
                    </div>
                  </div>

                  {onApplyOptimizedContent && (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => onApplyOptimizedContent(tokenStats.compressedContent)}
                        className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-400/40 rounded-lg text-xs font-semibold text-amber-200 transition-colors flex items-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Reemplazar contenido con versión optimizada</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
