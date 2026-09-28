import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Sparkles,
  Youtube,
  FileUp,
  Globe,
  FolderClosed,
  Plus,
  Lightbulb,
  HelpCircle,
  Bookmark,
  CheckCircle2,
  RefreshCw,
  Info,
  Trash2,
  Eraser,
  HardDrive,
  FileText,
  Search,
  X,
  Check,
  ExternalLink,
  Upload,
  Table,
  Presentation,
  File,
  Copy,
  Eye,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Cpu,
  Wand2,
  Clock,
  Edit3,
  MessageSquare,
  Sliders,
  Layers,
} from 'lucide-react';
import { InteractiveManual, ManualChapter, ManualSourceInput, Course, DriveResource, CustomGem } from '../../types';
import { api } from '../../services/api';
import { driveService } from '../../services/workspace/driveService';
import { NotebookLmToolbar } from '../common/NotebookLmToolbar';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface InteractiveManualModuleProps {
  courseId?: string;
  courses?: Course[];
  onNavigateToActivities?: (manualId: string) => void;
}

// Parser for Google NotebookLM generated outputs
function parseNotebookLmResponse(
  rawText: string,
  topicFallback: string,
  orientation: string,
  level: string
): {
  topicTitle: string;
  intro: string;
  contentBody: string;
  keyConcepts: string[];
  callouts: Array<{ type: 'clave' | 'curiosidad' | 'ejemplo' | 'reflexion'; text: string }>;
  suggestedIllustrations: string[];
  comprehensionActivities: string[];
} {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  let topicTitle = topicFallback || 'Material Didáctico';
  let intro = '';
  const bodyParagraphs: string[] = [];
  const keyConcepts: string[] = [];
  const callouts: Array<{ type: 'clave' | 'curiosidad' | 'ejemplo' | 'reflexion'; text: string }> = [];
  const suggestedIllustrations: string[] = [];
  const comprehensionActivities: string[] = [];

  let currentSection: 'header' | 'intro' | 'body' | 'concepts' | 'callouts' | 'activities' = 'header';

  for (const line of lines) {
    const cleanLine = line.replace(/^\*{1,3}|\*{1,3}$/g, '').trim();
    const lower = cleanLine.toLowerCase();

    // Check title if starts with # or Titulo
    if ((line.startsWith('# ') || lower.startsWith('título:') || lower.startsWith('titulo:') || lower.startsWith('tema:')) && topicTitle === topicFallback) {
      const extractedTitle = line.replace(/^#\s*|^(título|titulo|tema):\s*/i, '').replace(/\*/g, '').trim();
      if (extractedTitle) {
        topicTitle = extractedTitle;
        continue;
      }
    }

    // Section transitions
    if (lower.startsWith('1.') || lower.includes('introducción') || lower.includes('introduccion')) {
      currentSection = 'intro';
      const inlineIntro = cleanLine.replace(/^(1\.\s*)?(introducción|introduccion):?\s*/i, '').trim();
      if (inlineIntro) intro += (intro ? ' ' : '') + inlineIntro;
      continue;
    }
    if (lower.startsWith('2.') || lower.includes('desarrollo conceptual') || lower.includes('desarrollo:') || lower.includes('contenido:')) {
      currentSection = 'body';
      const inlineBody = cleanLine.replace(/^(2\.\s*)?(desarrollo conceptual|desarrollo|contenido):?\s*/i, '').trim();
      if (inlineBody) bodyParagraphs.push(inlineBody);
      continue;
    }
    if (lower.startsWith('3.') || lower.includes('conceptos clave') || lower.includes('conceptos fundamentales')) {
      currentSection = 'concepts';
      continue;
    }
    if (lower.startsWith('4.') || lower.includes('cuadros de llamada') || lower.includes('llamadas didácticas') || lower.includes('llamada:')) {
      currentSection = 'callouts';
      continue;
    }
    if (lower.startsWith('5.') || lower.includes('actividades de comprensión') || lower.includes('actividades:') || lower.includes('preguntas:')) {
      currentSection = 'activities';
      continue;
    }

    // Content collecting
    if (currentSection === 'intro') {
      intro += (intro ? ' ' : '') + cleanLine;
    } else if (currentSection === 'concepts') {
      const item = cleanLine.replace(/^[-*•\d.]+\s*/, '').trim();
      if (item && item.length > 2 && item.length < 100) {
        keyConcepts.push(item);
      }
    } else if (currentSection === 'callouts') {
      const item = cleanLine.replace(/^[-*•\d.]+\s*/, '').trim();
      if (item) {
        let type: 'clave' | 'curiosidad' | 'ejemplo' | 'reflexion' = 'clave';
        const itemLower = item.toLowerCase();
        if (itemLower.includes('curiosidad') || itemLower.includes('sabías') || itemLower.includes('sabias') || itemLower.includes('dato')) {
          type = 'curiosidad';
        } else if (itemLower.includes('ejemplo') || itemLower.includes('aplicación') || itemLower.includes('caso')) {
          type = 'ejemplo';
        } else if (itemLower.includes('reflexión') || itemLower.includes('reflexion') || itemLower.includes('pregunta')) {
          type = 'reflexion';
        }
        callouts.push({
          type,
          text: item.replace(/^\[(clave|curiosidad|ejemplo|reflexion)\]\s*/i, '').replace(/^(clave|curiosidad|ejemplo|reflexión):\s*/i, ''),
        });
      }
    } else if (currentSection === 'activities') {
      const item = cleanLine.replace(/^[-*•\d.]+\s*/, '').trim();
      if (item && item.length > 5) {
        comprehensionActivities.push(item);
      }
    } else {
      bodyParagraphs.push(cleanLine);
    }
  }

  // Fallbacks
  if (!intro && bodyParagraphs.length > 0) {
    intro = bodyParagraphs.shift() || '';
  }
  const contentBody = bodyParagraphs.join('\n\n') || rawText.slice(0, 1500);

  if (keyConcepts.length === 0) {
    keyConcepts.push(topicTitle, orientation, level, 'Comprensión Lectora');
  }
  if (callouts.length === 0) {
    callouts.push(
      { type: 'clave', text: `Concepto Clave: Analizar ${topicTitle} desde los lineamientos de ${orientation}.` },
      { type: 'curiosidad', text: `Nota para recordar: La comprensión profunda de este tema permite articular debates e investigaciones contemporáneas.` }
    );
  }
  if (comprehensionActivities.length === 0) {
    comprehensionActivities.push(
      `Elabora un mapa de ideas sintetizando los aspectos centrales de ${topicTitle}.`,
      `Formula una pregunta reflexiva orientada a la vida cotidiana sobre los temas vistos.`
    );
  }
  if (suggestedIllustrations.length === 0) {
    suggestedIllustrations.push(
      `Diagrama conceptual de ${topicTitle}`,
      `Línea de tiempo / esquema comparativo para ${level}`
    );
  }

  return {
    topicTitle,
    intro,
    contentBody,
    keyConcepts: keyConcepts.slice(0, 6),
    callouts: callouts.slice(0, 4),
    suggestedIllustrations,
    comprehensionActivities: comprehensionActivities.slice(0, 4),
  };
}

export const InteractiveManualModule: React.FC<InteractiveManualModuleProps> = ({
  courseId: _courseId,
  courses: _courses,
  onNavigateToActivities,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const [manuals, setManuals] = useState<InteractiveManual[]>([]);
  const [activeManual, setActiveManual] = useState<InteractiveManual | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [jobProgress, setJobProgress] = useState<{ progress: number; step: string } | null>(null);

  // Generation inputs
  const [incrementalTopic, setIncrementalTopic] = useState<string>('');
  const [studentAge, setStudentAge] = useState<string>('1º (13-12 años)');
  const [targetLevel, setTargetLevel] = useState<string>('Secundario (Middle)');
  const [orientation, setOrientation] = useState<'Ciencias Sociales' | 'Ciencias Naturales'>('Ciencias Sociales');
  const [aiEngine, setAiEngine] = useState<string>('gem-docente');
  const [customGems, setCustomGems] = useState<CustomGem[]>([]);
  const [isCreateGemModalOpen, setIsCreateGemModalOpen] = useState<boolean>(false);
  const [newGemName, setNewGemName] = useState<string>('');
  const [newGemDescription, setNewGemDescription] = useState<string>('');
  const [newGemDirectives, setNewGemDirectives] = useState<string>('');
  const [newGemIdea, setNewGemIdea] = useState<string>('');
  const [isGeneratingDirectives, setIsGeneratingDirectives] = useState<boolean>(false);
  const [isSavingGem, setIsSavingGem] = useState<boolean>(false);
  const [customDirectives, setCustomDirectives] = useState<string>('');
  const [showCustomDirectives, setShowCustomDirectives] = useState<boolean>(false);
  const [showExternalNotebookLmHelper, setShowExternalNotebookLmHelper] = useState<boolean>(false);
  const [showExplanationBanner, setShowExplanationBanner] = useState<boolean>(true);
  const [sources, setSources] = useState<ManualSourceInput[]>([]);
  const [generalSourceInstructions, setGeneralSourceInstructions] = useState<string>('');

  // Inline editing state for sources
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingInstructions, setEditingInstructions] = useState<string>('');
  const [editingTimeRange, setEditingTimeRange] = useState<string>('');
  const [editingPageRange, setEditingPageRange] = useState<string>('');

  // Auto-switch level when school year changes
  const handleYearChange = (year: string) => {
    setStudentAge(year);
    if (year.startsWith('1º') || year.startsWith('2º') || year.startsWith('3º')) {
      setTargetLevel('Secundario (Middle)');
    } else if (year.startsWith('4º') || year.startsWith('5º') || year.startsWith('6º')) {
      setTargetLevel('Secundario (Senior)');
    }
  };

  // YouTube transcript extraction helper
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [youtubeTimeRange, setYoutubeTimeRange] = useState<string>('');
  const [youtubeInstruction, setYoutubeInstruction] = useState<string>('');
  const [showYoutubeAdvanced, setShowYoutubeAdvanced] = useState<boolean>(false);
  const [isExtractingYoutube, setIsExtractingYoutube] = useState<boolean>(false);

  // Native file input ref for PDF/Doc upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Google Drive file picker modal state
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveResource[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [driveSearch, setDriveSearch] = useState('');
  const [driveFilter, setDriveFilter] = useState<'all' | 'doc' | 'pdf' | 'sheet' | 'slide'>('all');
  const [driveDirectLink, setDriveDirectLink] = useState('');
  const [drivePageRange, setDrivePageRange] = useState('');
  const [driveInstruction, setDriveInstruction] = useState('');

  // Web Source modal state
  const [isWebModalOpen, setIsWebModalOpen] = useState(false);
  const [webTitle, setWebTitle] = useState('');
  const [webUrlOrContent, setWebUrlOrContent] = useState('');
  const [webInstruction, setWebInstruction] = useState('');

  // NotebookLM Assisted Flow States
  const [notebookLmPastedText, setNotebookLmPastedText] = useState<string>('');
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [showPromptPreview, setShowPromptPreview] = useState<boolean>(false);
  const [isImportingNotebookLm, setIsImportingNotebookLm] = useState<boolean>(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showDirectAiFallback, setShowDirectAiFallback] = useState<boolean>(false);

  // Build the complete pedagogical prompt with sources for NotebookLM
  const buildNotebookLmDossier = () => {
    const sourcesSummary =
      sources.length > 0
        ? sources
            .map(
              (s, idx) =>
                `--- FUENTE ${idx + 1}: ${s.title} (${s.type.toUpperCase()}) ---\n${s.urlOrContent}`
            )
            .join('\n\n')
        : '(Utiliza los documentos o notas cargados en este cuaderno de NotebookLM)';

    return `Actúa como especialista pedagógico en educación secundaria para el año escolar "${studentAge}", nivel "${targetLevel}", con orientación específica en "${orientation}".

TEMA A DESARROLLAR:
"${incrementalTopic.trim() || 'Conceptos Fundamentales de la Asignatura'}"

FUENTES Y DOCUMENTOS DE CONSULTA:
${sourcesSummary}

INSTRUCCIONES DE GENERACIÓN DIDÁCTICA:
Genera un capítulo completo de material didáctico interactivo adaptado al vocabulario y profundidad de ${studentAge} (${targetLevel}) y alineado al perfil pedagógico de la orientación en ${orientation}.

Por favor estructura tu respuesta con los siguientes títulos claros:
1. INTRODUCCIÓN: Un párrafo introductorio claro, motivador y conectado con la vida cotidiana.
2. DESARROLLO CONCEPTUAL: La explicación teórica principal con vocabulario adaptado al año escolar y a la orientación ${orientation}.
3. CONCEPTOS CLAVE: Una lista de 3 a 5 términos o conceptos fundamentales en viñetas.
4. CUADROS DE LLAMADA DIDÁCTICOS:
   - [CLAVE] Un concepto o regla fundamental para no olvidar.
   - [CURIOSIDAD] Un dato histórico, científico o curioso relevante.
   - [EJEMPLO] Una aplicación práctica o caso de la vida real.
5. ACTIVIDADES DE COMPRENSIÓN: 2 o 3 preguntas o actividades prácticas para verificar el aprendizaje.`;
  };

  const handleCopyNotebookLmPrompt = () => {
    const dossier = buildNotebookLmDossier();
    navigator.clipboard.writeText(dossier);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  const handleImportNotebookLmResponse = async () => {
    if (!notebookLmPastedText.trim()) return;
    try {
      setIsImportingNotebookLm(true);
      const parsed = parseNotebookLmResponse(
        notebookLmPastedText,
        incrementalTopic || 'Material Didáctico',
        orientation,
        targetLevel
      );

      const res = await api.importNotebookLmManual({
        manualId: activeManual?.id,
        title: activeManual?.title || `Material Didáctico: ${parsed.topicTitle}`,
        subject: activeManual?.subject || orientation,
        targetLevel,
        studentAge,
        orientation,
        chapter: parsed,
      });

      if (res.manual) {
        await loadManuals();
        setActiveManual(res.manual);
        setActiveChapterIndex(res.manual.chapters.length - 1);
        setNotebookLmPastedText('');
        setImportSuccessMessage('¡Material didáctico generado con tu NotebookLM e incorporado a tu Google Drive con éxito!');
        setTimeout(() => setImportSuccessMessage(null), 6000);
      }
    } catch (err) {
      console.error('Error al importar material de NotebookLM:', err);
    } finally {
      setIsImportingNotebookLm(false);
    }
  };

  const loadManuals = async (selectedManualId?: string) => {
    try {
      setIsLoading(true);
      const data = await api.getManuals();
      setManuals(data);
      if (data.length > 0) {
        const found = selectedManualId
          ? data.find((m) => m.id === selectedManualId) || data[0]
          : activeManual
          ? data.find((m) => m.id === activeManual.id) || data[0]
          : data[0];
        setActiveManual(found);
        setActiveChapterIndex(found.chapters ? Math.max(0, found.chapters.length - 1) : 0);
      } else {
        setActiveManual(null);
      }
    } catch (err) {
      console.error('Error al cargar material didáctico:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCustomGems = async () => {
    try {
      const list = await api.getCustomGems();
      setCustomGems(list);
    } catch (e) {
      console.warn('Error al cargar custom gems:', e);
    }
  };

  useEffect(() => {
    loadManuals();
    loadCustomGems();
  }, []);

  const handleGenerateGemWithAi = async () => {
    if (!newGemIdea.trim()) return;
    try {
      setIsGeneratingDirectives(true);
      const generated = await api.generateGemDirectives({
        idea: newGemIdea.trim(),
        subject: activeManual?.subject || orientation,
        orientation,
        studentAge,
      });
      setNewGemDirectives(generated);
      if (!newGemName.trim()) {
        const shortName = newGemIdea.length > 28 ? `${newGemIdea.slice(0, 25).trim()}...` : newGemIdea.trim();
        setNewGemName(`Gem ${shortName}`);
      }
    } catch (err: any) {
      console.error('Error al generar directivas con IA:', err);
      alert('Error al generar directivas con IA: ' + (err.message || 'Error'));
    } finally {
      setIsGeneratingDirectives(false);
    }
  };

  const handleSaveCustomGem = async () => {
    if (!newGemName.trim() || !newGemDirectives.trim()) {
      alert('Por favor, ingresá un nombre y las directivas para tu Gem.');
      return;
    }
    try {
      setIsSavingGem(true);
      const created = await api.saveCustomGem({
        name: newGemName.trim(),
        description: newGemDescription.trim(),
        directives: newGemDirectives.trim(),
      });
      setCustomGems((prev) => [created, ...prev]);
      setAiEngine(created.id);
      setIsCreateGemModalOpen(false);
      setNewGemName('');
      setNewGemDescription('');
      setNewGemDirectives('');
      setNewGemIdea('');
    } catch (err: any) {
      console.error('Error al guardar Gem personalizado:', err);
      alert('Error al guardar Gem: ' + (err.message || 'Error'));
    } finally {
      setIsSavingGem(false);
    }
  };

  const handleDeleteCustomGem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('¿Seguro que deseas eliminar este Gem personalizado?')) return;
    try {
      await api.deleteCustomGem(id);
      setCustomGems((prev) => prev.filter((g) => g.id !== id));
      if (aiEngine === id) {
        setAiEngine('gem-docente');
      }
    } catch (err: any) {
      console.error('Error al eliminar Gem:', err);
    }
  };

  const handleDeleteManual = async (manualId: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar este material didáctico?')) return;
    try {
      await api.deleteManual(manualId);
      const remaining = manuals.filter((m) => m.id !== manualId);
      setManuals(remaining);
      setActiveManual(remaining.length > 0 ? remaining[0] : null);
      setActiveChapterIndex(0);
    } catch (err) {
      console.error('Error al eliminar material:', err);
    }
  };

  const handleClearAllManuals = async () => {
    if (!window.confirm('¿Deseas eliminar todos los materiales para dejar el espacio limpio?')) return;
    try {
      await api.clearManuals();
      setManuals([]);
      setActiveManual(null);
      setSources([]);
    } catch (err) {
      console.error('Error al limpiar materiales:', err);
    }
  };

  // YouTube transcript extraction
  const handleExtractYoutube = async () => {
    if (!youtubeUrl.trim()) return;
    try {
      setIsExtractingYoutube(true);
      const data = await api.extractYoutubeTranscription(youtubeUrl);
      const newSource: ManualSourceInput = {
        id: `yt-${Date.now()}`,
        type: 'youtube',
        title: data.videoTitle || 'Video de YouTube',
        urlOrContent: data.transcriptText,
        timeRange: youtubeTimeRange.trim() || undefined,
        instructions: youtubeInstruction.trim() || undefined,
      };
      setSources((prev) => [...prev, newSource]);
      if (!incrementalTopic.trim() && data.videoTitle) {
        setIncrementalTopic(data.videoTitle);
      }
      setYoutubeUrl('');
      setYoutubeTimeRange('');
      setYoutubeInstruction('');
      setShowYoutubeAdvanced(false);
    } catch (err) {
      console.error('Error al extraer transcripción de YouTube:', err);
    } finally {
      setIsExtractingYoutube(false);
    }
  };

  // Native file upload handler (PDF / DOC / TXT)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      setSources((prev) => [
        ...prev,
        {
          id: `pdf-${Date.now()}`,
          type: 'pdf',
          title: file.name,
          urlOrContent:
            content.slice(0, 10000) ||
            `Documento cargado: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`,
        },
      ]);
      if (!incrementalTopic.trim()) {
        setIncrementalTopic(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Google Drive picker open and fetch
  const handleOpenDrivePicker = async () => {
    setIsDrivePickerOpen(true);
    setIsLoadingDrive(true);
    try {
      const files = await driveService.listFiles();
      setDriveFiles(files || []);
    } catch (err) {
      console.warn('Error loading Drive files:', err);
    } finally {
      setIsLoadingDrive(false);
    }
  };

  // Select a specific file from Google Drive
  const handleSelectDriveFile = (file: DriveResource) => {
    setSources((prev) => [
      ...prev,
      {
        id: `drive-${file.id}`,
        type: 'pdf',
        title: `Google Drive: ${file.name}`,
        urlOrContent: file.googleDriveUrl,
        pageRange: drivePageRange.trim() || undefined,
        instructions: driveInstruction.trim() || undefined,
      },
    ]);
    if (!incrementalTopic.trim()) {
      setIncrementalTopic(file.name.replace(/\.[^/.]+$/, ''));
    }
    setDrivePageRange('');
    setDriveInstruction('');
    setIsDrivePickerOpen(false);
  };

  // Add a direct link from Google Drive
  const handleAddDirectDriveLink = () => {
    if (!driveDirectLink.trim()) return;
    setSources((prev) => [
      ...prev,
      {
        id: `drive-link-${Date.now()}`,
        type: 'pdf',
        title: 'Documento Google Drive Vinculado',
        urlOrContent: driveDirectLink.trim(),
        pageRange: drivePageRange.trim() || undefined,
        instructions: driveInstruction.trim() || undefined,
      },
    ]);
    setDriveDirectLink('');
    setDrivePageRange('');
    setDriveInstruction('');
    setIsDrivePickerOpen(false);
  };

  // Add Web source handler
  const handleSaveWebSource = () => {
    if (!webUrlOrContent.trim()) return;
    setSources((prev) => [
      ...prev,
      {
        id: `web-${Date.now()}`,
        type: 'web',
        title: webTitle.trim() || 'Artículo Web / Enlace Didáctico',
        urlOrContent: webUrlOrContent.trim(),
        instructions: webInstruction.trim() || undefined,
      },
    ]);
    setWebTitle('');
    setWebUrlOrContent('');
    setWebInstruction('');
    setIsWebModalOpen(false);
  };

  // Handle saving inline edits on source
  const handleSaveInlineSourceEdit = (id: string) => {
    setSources((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return {
          ...s,
          instructions: editingInstructions.trim() || undefined,
          timeRange: s.type === 'youtube' ? editingTimeRange.trim() || undefined : s.timeRange,
          pageRange: s.type !== 'youtube' ? editingPageRange.trim() || undefined : s.pageRange,
        };
      })
    );
    setEditingSourceId(null);
  };

  const getEngineDisplayName = (engine: string) => {
    if (engine === 'notebooklm-rag') return 'Motor NotebookLM RAG';
    if (engine === 'gem-docente' || engine === 'gem-pedagogico' || engine === 'gem-disciplinar') {
      return 'Gem Docente Integral';
    }
    const found = customGems.find((g) => g.id === engine);
    return found ? found.name : 'Gem Personalizado';
  };

  // Generate material didáctico handler
  const handleGenerateChapter = async () => {
    try {
      setGenerationError(null);
      setIsGenerating(true);
      setJobProgress({ progress: 15, step: 'Iniciando motor de IA y procesando fuentes...' });

      const res = await api.generateManualChapter({
        manualId: activeManual?.id,
        title: activeManual?.title,
        subject: activeManual?.subject || orientation,
        targetLevel,
        studentAge,
        orientation,
        aiEngine,
        customDirectives: customDirectives.trim() || undefined,
        generalSourceInstructions: generalSourceInstructions.trim() || undefined,
        incrementalTopic,
        sources,
        priorPlanId: activeManual?.associatedPlanId,
      });

      if (!res || !res.jobId) {
        throw new Error('No se recibió confirmación de inicio de la tarea del servidor.');
      }

      const interval = setInterval(async () => {
        try {
          const job = await api.getAsyncJob(res.jobId);
          if (job) {
            setJobProgress({ progress: job.progress, step: job.currentStep });
            if (job.status === 'finalizado') {
              clearInterval(interval);
              setIsGenerating(false);
              setJobProgress(null);
              await loadManuals(job.result?.manualId || activeManual?.id);
            } else if (job.status === 'fallido') {
              clearInterval(interval);
              setIsGenerating(false);
              setJobProgress(null);
              setGenerationError(job.logs?.slice(-1)[0] || 'La generación falló al procesar los contenidos.');
            }
          }
        } catch (pollErr: any) {
          console.warn('Error al consultar estado de la tarea:', pollErr);
        }
      }, 700);
    } catch (err: any) {
      console.error('Error al generar material didáctico:', err);
      setIsGenerating(false);
      setJobProgress(null);
      setGenerationError(err.message || 'Error al conectar con el servidor.');
    }
  };

  // Separate document sources vs video sources for clear preview
  const documentSources = sources.filter((s) => s.type !== 'youtube');
  const videoSources = sources.filter((s) => s.type === 'youtube');

  // Filtered Drive files in modal
  const filteredDriveFiles = driveFiles.filter((f) => {
    const matchesSearch = f.name.toLowerCase().includes(driveSearch.toLowerCase());
    const matchesFilter = driveFilter === 'all' || f.type === driveFilter;
    return matchesSearch && matchesFilter;
  });

  const getDriveFileIcon = (type: string) => {
    switch (type) {
      case 'doc':
        return <FileText className="w-4 h-4 text-blue-500" />;
      case 'sheet':
        return <Table className="w-4 h-4 text-emerald-500" />;
      case 'slide':
        return <Presentation className="w-4 h-4 text-amber-500" />;
      default:
        return <File className="w-4 h-4 text-rose-500" />;
    }
  };

  const currentChapter: ManualChapter | undefined =
    activeManual?.chapters[activeChapterIndex] || activeManual?.chapters[0];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Hidden file input for native PDF / Doc upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Header & Purpose Banner */}
      <div
        className={`flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5 transition-colors ${
          isDarkMode ? 'border-slate-800' : 'border-neutral-200'
        }`}
      >
        <div>
          <h1 className={`text-2xl font-extrabold tracking-tight ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
            Material didáctico
          </h1>
          <p className={`text-sm mt-1 max-w-3xl ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
            Combiná diferentes fuentes para crear tu propio material didáctico.
          </p>
        </div>

        {activeManual && (
          <div className="flex items-center gap-2">
            <a
              href={activeManual.driveFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl shadow-xs transition-all border ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                  : 'bg-neutral-900 hover:bg-neutral-800 text-white border-neutral-900'
              }`}
            >
              <FolderClosed className="w-3.5 h-3.5 text-amber-400" />
              Ver en Google Drive
            </a>
            {onNavigateToActivities && (
              <button
                onClick={() => onNavigateToActivities(activeManual.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Crear Actividades / Formulario
              </button>
            )}
          </div>
        )}
      </div>

      {/* NotebookLM Multimodal Toolbar & Token Optimizer */}
      <NotebookLmToolbar
        moduleName="Material Didáctico"
        courseName={activeManual?.subject || 'Ciencias y Humanidades'}
        documentTitle={
          currentChapter
            ? `Capítulo ${currentChapter.order}: ${currentChapter.topicTitle}`
            : activeManual?.title || incrementalTopic
        }
        documentContent={
          currentChapter
            ? `# ${currentChapter.topicTitle}\n\n${currentChapter.intro}\n\n${currentChapter.contentBody}\n\n### Actividades de Comprensión:\n${currentChapter.comprehensionActivities.map((a) => `• ${a}`).join('\n')}`
            : sources.map((s) => `### Fuente: ${s.title}\n${s.urlOrContent}`).join('\n\n')
        }
        onImportContent={(importedText, sourceTitle) => {
          setSources((prev) => [
            ...prev,
            {
              id: `src-${Date.now()}`,
              type: 'pdf',
              title: sourceTitle || 'Fuente Importada',
              urlOrContent: importedText,
            },
          ]);
        }}
        onInsertVideoPedagogy={(pedagogy) => {
          setSources((prev) => [
            ...prev,
            {
              id: `src-vid-${Date.now()}`,
              type: 'youtube',
              title: `Video Analizado: ${pedagogy.summary.slice(0, 40)}...`,
              urlOrContent: `Síntesis: ${pedagogy.summary}\nConceptos Clave: ${pedagogy.keyConcepts.join(', ')}\nPreguntas: ${pedagogy.suggestedQuestions.join('; ')}`,
            },
          ]);
          setIncrementalTopic((prev) => prev || pedagogy.keyConcepts[0] || 'Concepto Didáctico');
        }}
        onApplyOptimizedContent={(optimized) => {
          setSources((prev) => [
            ...prev,
            {
              id: `src-opt-${Date.now()}`,
              type: 'web',
              title: 'Caché Semántico Optimizado (NotebookLM)',
              urlOrContent: optimized,
            },
          ]);
        }}
      />

      {/* Explicación didáctica de las dos secciones / opciones al mismo nivel */}
      {showExplanationBanner ? (
        <div
          className={`rounded-2xl p-4 border transition-all animate-in fade-in ${
            isDarkMode
              ? 'bg-slate-900/90 border-indigo-900/50 text-slate-200'
              : 'bg-gradient-to-r from-blue-50/80 via-indigo-50/60 to-purple-50/80 border-indigo-200/80 text-neutral-800'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                <Lightbulb className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-indigo-950 dark:text-indigo-200">
                    ¿Cuál es la diferencia entre estas dos opciones al mismo nivel?
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-200/70 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-300">
                    Guía Rápida
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-800/80 border border-blue-200/60 dark:border-slate-700/60">
                    <span className="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5 mb-1">
                      <BookOpen className="w-3.5 h-3.5" />
                      1. "Generá tu material didáctico" (Panel Izquierdo - Entrada):
                    </span>
                    <p className="text-[11.5px] leading-relaxed text-neutral-600 dark:text-slate-300">
                      Es donde cargás la <strong>materia prima pedagógica</strong>: definís el tema curricular, el año escolar (para adaptar el lenguaje al grupo), el nivel, la orientación y las <strong>fuentes reales de consulta</strong> (Drive, PDFs o videos de YouTube).
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-800/80 border border-purple-200/60 dark:border-slate-700/60">
                    <span className="font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 mb-1">
                      <Cpu className="w-3.5 h-3.5" />
                      2. "Motor de IA Integrado" (Panel Derecho - Procesamiento):
                    </span>
                    <p className="text-[11.5px] leading-relaxed text-neutral-600 dark:text-slate-300">
                      Es el <strong>cerebro de IA que corre por detrás</strong> en 1 solo clic. Elegís el motor (NotebookLM RAG para anclaje estricto en fuentes, Gem Docente Integral que combina didáctica y enfoque disciplinar, o tus propios Gems creados) y la IA genera el contenido completo, guardándolo automáticamente en tu Google Drive y mostrándolo <strong>abajo</strong> en el visor interactivo.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowExplanationBanner(false)}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1 cursor-pointer shrink-0"
              title="Ocultar explicación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowExplanationBanner(true)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>¿Cuál es la diferencia entre estas dos opciones?</span>
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. SECCIÓN SUPERIOR A LO LARGO DE TODA LA PÁGINA:             */}
      {/*    GENERÁ TU MATERIAL DIDÁCTICO (HASTA ORIENTACIÓN)           */}
      {/* ------------------------------------------------------------- */}
      <div
        className={`w-full rounded-2xl border p-5 sm:p-6 shadow-xs space-y-4 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
        }`}
      >
        {/* Header del generador a todo lo ancho */}
        <div className="flex items-start justify-between gap-3 border-b pb-3.5 border-neutral-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                Paso 1 • Configuración Curricular
              </span>
              <span className="text-[10px] font-medium text-neutral-500 dark:text-slate-400">
                A lo largo de toda la página
              </span>
            </div>
            <h2 className={`text-base sm:text-xl font-bold flex items-center gap-2 mt-1.5 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
              <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              Generá tu material didáctico
            </h2>
            <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Definí el tema pedagógico, el año escolar, el nivel y la orientación para calibrar el lenguaje y los contenidos antes de sumar las fuentes.
            </p>
          </div>
        </div>

        {/* Inputs de configuración organizados en fila horizontal responsiva */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Tema / Contenido: col-span-12 md:col-span-5 */}
          <div className="col-span-12 md:col-span-5 space-y-1.5">
            <label className={`block text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              Tema / Contenido del material didáctico <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={incrementalTopic}
              onChange={(e) => setIncrementalTopic(e.target.value)}
              placeholder="Ej: Meiosis y Reproducción Sexual, Revolución de Mayo..."
              className={`w-full text-xs rounded-xl px-3 py-2.5 transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 border border-slate-700 text-white focus:border-purple-500'
                  : 'bg-neutral-50 border border-neutral-300 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-purple-500/20'
              }`}
            />
          </div>

          {/* Año de la escuela: col-span-6 md:col-span-2 */}
          <div className="col-span-6 md:col-span-2 space-y-1.5">
            <label className={`block text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              Año de la escuela
            </label>
            <select
              value={studentAge}
              onChange={(e) => handleYearChange(e.target.value)}
              className={`w-full text-xs rounded-xl px-2.5 py-2.5 transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 border border-slate-700 text-white focus:border-purple-500'
                  : 'bg-neutral-50 border border-neutral-300 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-purple-500/20'
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

          {/* Nivel pedagógico: col-span-6 md:col-span-2 */}
          <div className="col-span-6 md:col-span-2 space-y-1.5">
            <label className={`block text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              Nivel pedagógico
            </label>
            <select
              value={targetLevel}
              onChange={(e) => setTargetLevel(e.target.value)}
              className={`w-full text-xs rounded-xl px-2.5 py-2.5 transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 border border-slate-700 text-white focus:border-purple-500'
                  : 'bg-neutral-50 border border-neutral-300 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-purple-500/20'
              }`}
            >
              <option value="Secundario (Middle)">Secundario (Middle)</option>
              <option value="Secundario (Senior)">Secundario (Senior)</option>
            </select>
          </div>

          {/* Solapas de Orientación: col-span-12 md:col-span-3 */}
          <div className="col-span-12 md:col-span-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className={`block text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Orientación
              </label>
              <span className={`text-[10px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                {orientation === 'Ciencias Sociales' ? 'Humanidades' : 'Científico'}
              </span>
            </div>
            <div
              className={`grid grid-cols-2 p-1 rounded-xl border ${
                isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-100 border-neutral-200'
              }`}
              role="tablist"
              aria-label="Orientación de la escuela"
            >
              <button
                type="button"
                role="tab"
                aria-selected={orientation === 'Ciencias Sociales'}
                onClick={() => setOrientation('Ciencias Sociales')}
                className={`py-2 px-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  orientation === 'Ciencias Sociales'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-750'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                }`}
              >
                <span>📚</span>
                <span>Sociales</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orientation === 'Ciencias Naturales'}
                onClick={() => setOrientation('Ciencias Naturales')}
                className={`py-2 px-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  orientation === 'Ciencias Naturales'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-750'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                }`}
              >
                <span>🌿</span>
                <span>Naturales</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. SEPARADO Y ABAJO: DOS CUADROS AL MISMO NIVEL               */}
      {/*    [SUBIR DOCUMENTOS Y FUENTES] y [MOTOR DE IA INTEGRADO]    */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Cuadro Izquierdo: Subir documentos y material de consulta */}
        <div
          className={`rounded-2xl border p-5 sm:p-6 shadow-xs flex flex-col justify-between space-y-5 transition-colors ${
            isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-neutral-200'
          }`}
        >
          {/* Header del cuadro de fuentes */}
          <div className="flex items-start justify-between gap-3 border-b pb-3.5 border-neutral-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Paso 2 • Materiales de Apoyo
                </span>
                <span className="text-[10px] font-medium text-neutral-500 dark:text-slate-400">
                  Fuentes & Recortes
                </span>
              </div>
              <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 mt-1.5 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                <FileUp className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                Subir documentos y material de consulta
              </h2>
              <p className={`text-[11.5px] mt-1 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Cargá tus documentos de Drive, apuntes en PDF o videos de YouTube y definí los minutos y páginas a considerar.
              </p>
            </div>
            {sources.length > 0 && (
              <span className="text-[11px] px-2.5 py-1 rounded-xl font-bold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                {sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'}
              </span>
            )}
          </div>

          <div className="space-y-4">
            {/* 1. PRIMERO: AGREGAR PDF O WEB O SELECCIONAR DESDE DRIVE       */}
            <div
              className={`rounded-2xl p-4 space-y-3 border transition-colors ${
                isDarkMode
                  ? 'bg-slate-850/80 border-slate-700/80'
                  : 'bg-gradient-to-br from-blue-50/40 via-purple-50/20 to-neutral-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold flex items-center gap-1.5 text-neutral-900 dark:text-white">
                    <FileText className="w-4 h-4 text-blue-500" />
                    Documentos y Fuentes de Consulta
                  </span>
                  <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Cargá documentos, artículos web o elegí directamente desde Google Drive:
                  </p>
                </div>

                {documentSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSources((prev) => prev.filter((s) => s.type === 'youtube'))}
                    className="text-[11px] text-neutral-400 hover:text-rose-500 font-medium flex items-center gap-1 cursor-pointer"
                    title="Limpiar documentos"
                  >
                    <Eraser className="w-3 h-3" /> Limpiar
                  </button>
                )}
              </div>

              {/* Botones de acción principales: Drive, PDF, Web */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {/* 1. Seleccionar desde Drive */}
                <button
                  type="button"
                  id="btn-select-from-drive"
                  onClick={handleOpenDrivePicker}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-blue-400 border-slate-700 hover:border-blue-500'
                      : 'bg-white hover:bg-blue-50/60 text-blue-700 border-blue-200 hover:border-blue-300'
                  }`}
                  title="Abrir explorador de Google Drive para seleccionar tus archivos"
                >
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <span className="text-center text-[11px]">Seleccionar desde Drive</span>
                </button>

                {/* 2. Subir PDF o Documento */}
                <button
                  type="button"
                  id="btn-upload-pdf"
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-purple-300 border-slate-700 hover:border-purple-500'
                      : 'bg-white hover:bg-purple-50/60 text-purple-700 border-purple-200 hover:border-purple-300'
                  }`}
                  title="Subir archivo PDF, Word o texto desde tu dispositivo"
                >
                  <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Upload className="w-4 h-4" />
                  </div>
                  <span className="text-center text-[11px]">Subir PDF o Archivo</span>
                </button>

                {/* 3. Agregar Web / Enlace */}
                <button
                  type="button"
                  id="btn-add-web-source"
                  onClick={() => setIsWebModalOpen(true)}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-emerald-300 border-slate-700 hover:border-emerald-500'
                      : 'bg-white hover:bg-emerald-50/60 text-emerald-700 border-emerald-200 hover:border-emerald-300'
                  }`}
                  title="Agregar enlace o texto de artículo web"
                >
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Globe className="w-4 h-4" />
                  </div>
                  <span className="text-center text-[11px]">Agregar Web / Link</span>
                </button>
              </div>

              {/* Lista de documentos / webs agregados */}
              {documentSources.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {documentSources.map((s) => (
                    <div
                      key={s.id}
                      className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border transition-colors ${
                        isDarkMode
                          ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                          : 'bg-white border-neutral-200 text-neutral-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1">
                        {s.title.includes('Drive') ? (
                          <HardDrive className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        ) : s.type === 'pdf' ? (
                          <FileUp className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        )}
                        <span className="font-semibold truncate">{s.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md ${
                            s.title.includes('Drive')
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : s.type === 'pdf'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {s.title.includes('Drive') ? 'Google Drive' : s.type}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSources((prev) => prev.filter((item) => item.id !== s.id))}
                          className="text-neutral-400 hover:text-rose-500 transition-colors p-1 cursor-pointer"
                          title="Eliminar esta fuente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 2. ABAJO: PONER VIDEO DE YOUTUBE COMO MATERIAL                */}
            {/* ------------------------------------------------------------- */}
            <div
              className={`rounded-2xl p-4 space-y-3 border transition-colors ${
                isDarkMode
                  ? 'bg-red-950/20 border-red-900/40 text-red-200'
                  : 'bg-gradient-to-br from-red-50/60 via-orange-50/20 to-neutral-50 border-red-200 text-neutral-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold flex items-center gap-1.5 text-red-700 dark:text-red-400">
                    <Youtube className="w-4 h-4 text-red-600 dark:text-red-400" />
                    Video de YouTube como material
                  </span>
                  <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Pega el enlace de un video didáctico para incorporar automáticamente su explicación:
                  </p>
                </div>

                {videoSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSources((prev) => prev.filter((s) => s.type !== 'youtube'))}
                    className="text-[11px] text-neutral-400 hover:text-rose-500 font-medium flex items-center gap-1 cursor-pointer"
                    title="Quitar videos"
                  >
                    <Eraser className="w-3 h-3" /> Quitar
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExtractYoutube()}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className={`flex-1 text-xs rounded-xl px-3 py-2 border transition-colors ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-red-500'
                        : 'bg-white border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-red-500/20 focus:border-red-500'
                    }`}
                  />
                  <button
                    type="button"
                    id="btn-extract-youtube"
                    onClick={handleExtractYoutube}
                    disabled={isExtractingYoutube || !youtubeUrl.trim()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shrink-0 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    {isExtractingYoutube ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Extrayendo...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar Video</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Recorte de minutos e indicación directa para el video */}
                <div className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-red-800 dark:text-red-300">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Indicaciones de minutos y recorte para este video:
                    </span>
                    <span className="text-[10px] text-neutral-400 font-normal">Opcional</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <input
                        type="text"
                        value={youtubeTimeRange}
                        onChange={(e) => setYoutubeTimeRange(e.target.value)}
                        placeholder="Minutos (ej: 'Del 02:15 al 06:40')"
                        className={`w-full text-xs rounded-lg px-2.5 py-1.5 border ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                            : 'bg-white border-red-200 text-neutral-900'
                        }`}
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={youtubeInstruction}
                        onChange={(e) => setYoutubeInstruction(e.target.value)}
                        placeholder="Indicación (ej: 'Solamente tener en cuenta del minuto tanto al tanto')"
                        className={`w-full text-xs rounded-lg px-2.5 py-1.5 border ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                            : 'bg-white border-red-200 text-neutral-900'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 3. SECCIÓN VISIBLE: FUENTES AGREGADAS PARA LA GENERACIÓN      */}
            {/* ------------------------------------------------------------- */}
            <div
              className={`rounded-2xl p-4 space-y-3 border transition-colors ${
                isDarkMode
                  ? 'bg-slate-850 border-purple-900/40 text-slate-200'
                  : 'bg-gradient-to-br from-purple-50/70 via-indigo-50/40 to-blue-50/30 border-purple-200 text-neutral-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold flex items-center gap-1.5">
                      Fuentes agregadas para la generación
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        {sources.length}
                      </span>
                    </h3>
                    <p className={`text-[10.5px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      {sources.length === 0
                        ? 'No hay fuentes seleccionadas todavía. Usá los botones de arriba para sumar Drive, PDFs o videos.'
                        : 'Estas fuentes e indicaciones serán enviadas al Motor de IA para armar el material didáctico.'}
                    </p>
                  </div>
                </div>

                {sources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSources([])}
                    className="text-[11px] text-neutral-400 hover:text-rose-500 font-medium flex items-center gap-1 cursor-pointer"
                    title="Vaciar todas las fuentes"
                  >
                    <Eraser className="w-3 h-3" /> Vaciar todo
                  </button>
                )}
              </div>

              {/* Lista visual de fuentes con indicaciones y recortes */}
              {sources.length > 0 ? (
                <div className="space-y-2">
                  {sources.map((s) => {
                    const isEditing = editingSourceId === s.id;
                    const isYt = s.type === 'youtube';

                    return (
                      <div
                        key={s.id}
                        className={`p-3 rounded-xl border space-y-2 transition-all ${
                          isDarkMode
                            ? 'bg-slate-800/90 border-slate-700/80'
                            : 'bg-white border-neutral-200 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div className="p-1.5 rounded-lg mt-0.5 shrink-0 bg-neutral-100 dark:bg-slate-700">
                              {isYt ? (
                                <Youtube className="w-4 h-4 text-red-600 shrink-0" />
                              ) : s.title.includes('Drive') ? (
                                <HardDrive className="w-4 h-4 text-blue-600 shrink-0" />
                              ) : s.type === 'pdf' ? (
                                <FileUp className="w-4 h-4 text-purple-600 shrink-0" />
                              ) : (
                                <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs truncate max-w-[280px]">
                                  {s.title}
                                </span>
                                <span
                                  className={`text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded-md ${
                                    isYt
                                      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                      : s.title.includes('Drive')
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                      : s.type === 'pdf'
                                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  }`}
                                >
                                  {isYt ? 'Video' : s.title.includes('Drive') ? 'Google Drive' : s.type}
                                </span>

                                {/* Badges de recorte */}
                                {s.timeRange && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Minutos: {s.timeRange}
                                  </span>
                                )}
                                {s.pageRange && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200 border border-blue-300 dark:border-blue-800 flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    Páginas: {s.pageRange}
                                  </span>
                                )}
                              </div>

                              {/* Indicación específica del docente si existe */}
                              {s.instructions ? (
                                <div className="mt-1.5 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-900 dark:text-purple-200 flex items-start gap-1.5">
                                  <MessageSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                                  <div>
                                    <span className="font-semibold">Indicación: </span>
                                    <span>"{s.instructions}"</span>
                                  </div>
                                </div>
                              ) : (
                                !isEditing && (
                                  <p className="text-[10px] text-neutral-400 mt-1 italic">
                                    Sin indicaciones de recorte (se procesa completa).
                                  </p>
                                )
                              )}
                            </div>
                          </div>

                          {/* Acciones */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditing) {
                                  setEditingSourceId(null);
                                } else {
                                  setEditingSourceId(s.id);
                                  setEditingInstructions(s.instructions || '');
                                  setEditingTimeRange(s.timeRange || '');
                                  setEditingPageRange(s.pageRange || '');
                                }
                              }}
                              className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 cursor-pointer transition-colors ${
                                isEditing
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : 'text-neutral-500 hover:text-purple-600 border-neutral-200 dark:border-slate-700'
                              }`}
                              title="Editar indicación o recorte de páginas/minutos"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-semibold hidden sm:inline">
                                {isEditing ? 'Cerrar' : 'Indicación'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSources((prev) => prev.filter((item) => item.id !== s.id))}
                              className="text-neutral-400 hover:text-rose-500 p-1.5 transition-colors cursor-pointer"
                              title="Quitar fuente"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Editor inline de recorte / indicación */}
                        {isEditing && (
                          <div className="pt-2 border-t border-neutral-200 dark:border-slate-700 space-y-2 animate-in fade-in">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {isYt ? (
                                <div>
                                  <label className="block text-[10px] font-bold text-neutral-600 dark:text-slate-400 mb-0.5">
                                    ⏱️ Minutos a considerar:
                                  </label>
                                  <input
                                    type="text"
                                    value={editingTimeRange}
                                    onChange={(e) => setEditingTimeRange(e.target.value)}
                                    placeholder="Ej: Del minuto 02:15 al 06:40"
                                    className="w-full text-xs rounded-lg px-2.5 py-1.5 border bg-white dark:bg-slate-800 text-neutral-900 dark:text-white border-neutral-300 dark:border-slate-700"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <label className="block text-[10px] font-bold text-neutral-600 dark:text-slate-400 mb-0.5">
                                    📄 Páginas a considerar:
                                  </label>
                                  <input
                                    type="text"
                                    value={editingPageRange}
                                    onChange={(e) => setEditingPageRange(e.target.value)}
                                    placeholder="Ej: Páginas 14 a 22 o Cap. 2"
                                    className="w-full text-xs rounded-lg px-2.5 py-1.5 border bg-white dark:bg-slate-800 text-neutral-900 dark:text-white border-neutral-300 dark:border-slate-700"
                                  />
                                </div>
                              )}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-600 dark:text-slate-400 mb-0.5">
                                  📌 Indicación para la IA sobre esta fuente:
                                </label>
                                <input
                                  type="text"
                                  value={editingInstructions}
                                  onChange={(e) => setEditingInstructions(e.target.value)}
                                  placeholder={isYt ? "Ej: 'Solamente tener en cuenta del minuto tanto al tanto'" : "Ej: 'Considera de la página tanto a la página tanto'"}
                                  className="w-full text-xs rounded-lg px-2.5 py-1.5 border bg-white dark:bg-slate-800 text-neutral-900 dark:text-white border-neutral-300 dark:border-slate-700"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditingSourceId(null)}
                                className="px-3 py-1 text-[11px] rounded-lg border border-neutral-300 dark:border-slate-700 cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveInlineSourceEdit(s.id)}
                                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold rounded-lg cursor-pointer"
                              >
                                Aplicar indicación
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Campo opcional de indicación general */}
                  <div className="pt-2">
                    <label className="block text-[11px] font-bold text-neutral-700 dark:text-slate-300 mb-1">
                      📝 Indicaciones generales para el conjunto de fuentes (Opcional):
                    </label>
                    <textarea
                      rows={2}
                      value={generalSourceInstructions}
                      onChange={(e) => setGeneralSourceInstructions(e.target.value)}
                      placeholder="Ej: Cruzar los conceptos explicados en el video con las definiciones del PDF, priorizando el vocabulario de la página 15..."
                      className="w-full text-xs rounded-xl p-2.5 border bg-white dark:bg-slate-800 text-neutral-900 dark:text-white border-purple-200 dark:border-purple-800 focus:ring-2 focus:ring-purple-500/20"
                    />
                  </div>
                </div>
              ) : (
                <div className={`p-4 rounded-xl border border-dashed text-center space-y-1 ${isDarkMode ? 'border-slate-700 text-slate-400' : 'border-neutral-300 text-neutral-500'}`}>
                  <p className="text-xs font-semibold">Ninguna fuente agregada todavía</p>
                  <p className="text-[11px]">
                    Subí archivos, seleccioná desde Drive o pegá videos arriba. Podrás indicar minutos y páginas para cada uno.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Columna 2: Motor de IA Integrado (Al mismo nivel) */}
        <div
          className={`rounded-2xl p-5 sm:p-6 border flex flex-col justify-between space-y-5 transition-all shadow-xs ${
            isDarkMode
              ? 'bg-linear-to-br from-purple-950/40 via-indigo-950/20 to-slate-900 border-purple-800/50'
              : 'bg-linear-to-br from-purple-50/70 via-indigo-50/40 to-white border-purple-200'
          }`}
        >
          {/* Header del Frontend Integrador */}
          <div className="flex items-start justify-between gap-3 border-b pb-3.5 border-purple-200/60 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  Panel 2 • Orquestación IA
                </span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  Frontend Unificado
                </span>
              </div>
              <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 mt-1.5 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                <Cpu className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
                Motor de IA Integrado
              </h2>
              <p className={`text-[11.5px] mt-1 leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                Elegí el Gem o motor RAG y ejecutá la generación completa con anclaje curricular en 1 solo clic.
              </p>
            </div>
          </div>

              {/* Mensaje de éxito */}
              {importSuccessMessage && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="font-semibold">{importSuccessMessage}</span>
                </div>
              )}

              {/* Mensaje de error */}
              {generationError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-rose-500 shrink-0" />
                    <span className="font-semibold">{generationError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGenerationError(null)}
                    className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* SELECTOR DE GEM / MOTOR DE IA */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className={`block text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Motores de IA Preconfigurados:
                  </label>
                  <span className="text-[10px] text-neutral-400 font-medium">
                    2 motores integrados
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Motor 1: NotebookLM RAG */}
                  <button
                    type="button"
                    onClick={() => setAiEngine('notebooklm-rag')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      aiEngine === 'notebooklm-rag'
                        ? 'bg-purple-600/10 border-purple-500 ring-2 ring-purple-500/30 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200'
                        : isDarkMode
                        ? 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-purple-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span>⚡</span>
                          <span>NotebookLM RAG</span>
                        </div>
                        {aiEngine === 'notebooklm-rag' && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
                      </div>
                      <p className="text-[10.5px] mt-1 leading-tight opacity-80">
                        Anclaje estricto en fuentes de Drive y videos de YouTube.
                      </p>
                    </div>
                    <span className="text-[9px] mt-2 font-mono text-purple-600 dark:text-purple-400 font-semibold">
                      Grounding Multimodal
                    </span>
                  </button>

                  {/* Motor 2: Gem Docente Integral (Unificado: Pedagógico + Disciplinar) */}
                  <button
                    type="button"
                    onClick={() => setAiEngine('gem-docente')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      aiEngine === 'gem-docente' || aiEngine === 'gem-pedagogico' || aiEngine === 'gem-disciplinar'
                        ? 'bg-indigo-600/10 border-indigo-500 ring-2 ring-indigo-500/30 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200'
                        : isDarkMode
                        ? 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-indigo-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span>🎓</span>
                          <span>Gem Docente Integral</span>
                        </div>
                        {(aiEngine === 'gem-docente' || aiEngine === 'gem-pedagogico' || aiEngine === 'gem-disciplinar') && (
                          <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </div>
                      <p className="text-[10.5px] mt-1 leading-tight opacity-80">
                        Transposición a {studentAge} + marco disciplinar en {orientation}.
                      </p>
                    </div>
                    <span className="text-[9px] mt-2 font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                      Pedagógico + {orientation.replace('Ciencias ', '')}
                    </span>
                  </button>
                </div>

                {/* SECCIÓN: MIS GEMS PERSONALIZADOS */}
                <div className="space-y-2 pt-2 border-t border-purple-200/50 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className={`block text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Mis Gems Personalizados:
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCreateGemModalOpen(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 hover:underline cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Crear mi propio Gem con IA
                    </button>
                  </div>

                  {customGems.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {customGems.map((g) => {
                        const isSelected = aiEngine === g.id;
                        return (
                          <div
                            key={g.id}
                            onClick={() => setAiEngine(g.id)}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between group ${
                              isSelected
                                ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 dark:bg-amber-950/40'
                                : isDarkMode
                                ? 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:border-slate-600'
                                : 'bg-white border-neutral-200 text-neutral-600 hover:border-amber-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="truncate flex-1">
                                <div className="flex items-center gap-1 font-bold text-xs truncate">
                                  <span>✨</span>
                                  <span className="truncate">{g.name}</span>
                                </div>
                                <p className="text-[10px] mt-0.5 line-clamp-1 opacity-80">
                                  {g.description}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isSelected && <Check className="w-3.5 h-3.5 text-amber-500" />}
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteCustomGem(g.id, e)}
                                  className="text-neutral-400 hover:text-rose-500 p-1 transition-colors opacity-70 group-hover:opacity-100 cursor-pointer"
                                  title="Eliminar este Gem"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <span className="text-[9px] mt-1.5 font-mono text-amber-600 dark:text-amber-400 font-semibold truncate">
                              Gem Propio
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`p-3 rounded-xl border text-center space-y-1.5 ${isDarkMode ? 'bg-slate-800/40 border-slate-800 text-slate-400' : 'bg-neutral-50/70 border-neutral-200 text-neutral-500'}`}>
                      <p className="text-xs">No tenés Gems personalizados creados todavía.</p>
                      <button
                        type="button"
                        onClick={() => setIsCreateGemModalOpen(true)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-purple-600 text-white text-[11px] font-bold rounded-lg shadow-xs hover:bg-purple-700 cursor-pointer"
                      >
                        <Wand2 className="w-3 h-3" />
                        Crear mi primer Gem con IA
                      </button>
                    </div>
                  )}
                </div>

                {/* Opción para ver/personalizar directivas del Gem docente al vuelo */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCustomDirectives((prev) => !prev)}
                    className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>⚙️ ¿Tenés directivas temporales o de tu Gem en gemini.google.com?</span>
                    {showCustomDirectives ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {showCustomDirectives && (
                    <div className="mt-2 p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-800/50 space-y-2 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-purple-900 dark:text-purple-200">
                          Instrucciones adicionales para esta generación:
                        </label>
                        {customDirectives && (
                          <button
                            type="button"
                            onClick={() => setCustomDirectives('')}
                            className="text-[10px] text-neutral-400 hover:text-rose-500 cursor-pointer"
                          >
                            Restablecer
                          </button>
                        )}
                      </div>
                      <textarea
                        rows={2}
                        value={customDirectives}
                        onChange={(e) => setCustomDirectives(e.target.value)}
                        placeholder="Pegá aquí instrucciones adicionales para aplicar en esta generación..."
                        className="w-full text-xs rounded-xl p-2.5 border bg-white dark:bg-slate-800 border-purple-200 dark:border-purple-800 text-neutral-900 dark:text-white placeholder-neutral-400 focus:ring-2 focus:ring-purple-500/20"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Resumen de fuentes y configuración */}
              <div
                className={`p-3 rounded-xl text-xs space-y-1.5 border ${
                  isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-300'
                    : 'bg-white/80 border-purple-100 text-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="text-neutral-500 dark:text-slate-400">Contexto listo para la IA:</span>
                  <span className="text-purple-600 dark:text-purple-400 font-mono">
                    {sources.length} fuente(s) ancladas
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 font-medium">
                    {studentAge}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 font-medium">
                    {targetLevel}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-medium">
                    {orientation}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 font-medium">
                    {getEngineDisplayName(aiEngine)}
                  </span>
                  {incrementalTopic && (
                    <span className="px-2 py-0.5 rounded-md bg-neutral-200/80 dark:bg-slate-700 text-neutral-800 dark:text-slate-200 font-medium truncate max-w-[200px]">
                      {incrementalTopic}
                    </span>
                  )}
                </div>
              </div>

              {/* BOTÓN PRINCIPAL DE GENERACIÓN AUTOMÁTICA EN 1 CLIC */}
              {isGenerating ? (
                <div
                  className={`p-4 rounded-2xl border space-y-2.5 ${
                    isDarkMode
                      ? 'bg-purple-950/40 border-purple-800/70 text-purple-200'
                      : 'bg-purple-50/80 border-purple-200 text-purple-900'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                      {jobProgress?.step || 'Generando material con el motor de IA...'}
                    </span>
                    <span className="font-mono">{jobProgress?.progress || 20}%</span>
                  </div>
                  <div className={`w-full rounded-full h-2 overflow-hidden ${isDarkMode ? 'bg-purple-950' : 'bg-purple-200'}`}>
                    <div
                      className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-2 transition-all duration-300 rounded-full"
                      style={{ width: `${jobProgress?.progress || 20}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-purple-400">
                    <span>Motor: {getEngineDisplayName(aiEngine)}</span>
                    <span>Guardado automático en Google Drive</span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  id="btn-generate-unified-ai"
                  onClick={handleGenerateChapter}
                  className="w-full py-4 px-5 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white text-xs sm:text-sm font-bold rounded-2xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generar Material con {getEngineDisplayName(aiEngine)}</span>
                </button>
              )}

              {/* SECCIÓN AUXILIAR COLAPSABLE: IMPORTAR DESDE NOTEBOOKLM EXTERNO */}
              <div className="pt-2 border-t border-purple-200/40 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowExternalNotebookLmHelper((prev) => !prev)}
                  className="w-full text-center text-[11px] text-neutral-400 hover:text-purple-600 dark:hover:text-purple-300 transition-colors font-medium flex items-center justify-center gap-1 cursor-pointer py-1"
                >
                  <span>¿Deseas usar la web externa de notebooklm.google.com o copiar el paquete?</span>
                  {showExternalNotebookLmHelper ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showExternalNotebookLmHelper && (
                  <div className="mt-3 space-y-3 p-3 rounded-xl bg-neutral-50 dark:bg-slate-800/60 border border-neutral-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleCopyNotebookLmPrompt}
                        className="py-2 px-3 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 bg-white dark:bg-slate-750 text-neutral-700 dark:text-slate-200 border-neutral-300 dark:border-slate-600 hover:bg-neutral-50 cursor-pointer"
                      >
                        {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedPrompt ? '¡Copiado!' : 'Copiar Prompt y Fuentes'}</span>
                      </button>

                      <a
                        href="https://notebooklm.google.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-2 px-3 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 bg-white dark:bg-slate-750 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir NotebookLM ↗</span>
                      </a>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                        O pegá la respuesta externa de NotebookLM:
                      </label>
                      <textarea
                        rows={3}
                        value={notebookLmPastedText}
                        onChange={(e) => setNotebookLmPastedText(e.target.value)}
                        placeholder="Pegá texto externo aquí si deseas renderizarlo con las plantillas interactivas..."
                        className="w-full text-xs rounded-lg p-2.5 border bg-white dark:bg-slate-800 border-neutral-300 dark:border-slate-600 text-neutral-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleImportNotebookLmResponse}
                        disabled={isImportingNotebookLm || !notebookLmPastedText.trim()}
                        className="w-full py-2 px-3 rounded-lg bg-neutral-800 dark:bg-slate-700 hover:bg-neutral-900 dark:hover:bg-slate-600 text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer"
                      >
                        {isImportingNotebookLm ? 'Importando...' : 'Renderizar texto pegado'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* FILA INFERIOR: RESULTADO GENERADO (ANCHO COMPLETO)           */}
      {/* ------------------------------------------------------------- */}
      <div className="space-y-6 pt-6 border-t-2 border-neutral-200 dark:border-slate-800">
        {/* Header de la sección Resultado Generado */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 border-neutral-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Panel 3 • Visualización & Uso
                </span>
                {currentChapter && (
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                    Capítulo {currentChapter.order} de {activeManual?.chapters.length || 1}
                  </span>
                )}
              </div>
              <h2 className={`text-lg sm:text-xl font-extrabold flex items-center gap-2 mt-1 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Resultado Generado
              </h2>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Visualizá, estudiá y compartí el material didáctico interactivo completo a pantalla completa.
              </p>
            </div>
          </div>

          {activeManual && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <a
                href={activeManual.driveFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border-neutral-200'
                }`}
              >
                <FolderClosed className="w-3.5 h-3.5 text-amber-500" />
                <span>Drive Docente</span>
              </a>
              {onNavigateToActivities && (
                <button
                  onClick={() => onNavigateToActivities(activeManual.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Crear Actividades / Form</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Barra horizontal de navegación de capítulos (si existen capítulos) */}
        {activeManual && activeManual.chapters.length > 0 && (
          <div
            className={`rounded-2xl border p-4 shadow-xs transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-purple-400' : 'text-purple-700'}`}>
                Capítulos del Material ({activeManual.chapters.length}):
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 w-full">
              {activeManual.chapters.map((ch, idx) => {
                const isSelected = activeChapterIndex === idx;
                return (
                  <button
                    key={ch.id}
                    onClick={() => setActiveChapterIndex(idx)}
                    className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                      isSelected
                        ? isDarkMode
                          ? 'border-purple-500 bg-purple-950/70 text-purple-200 font-bold shadow-xs'
                          : 'border-purple-600 bg-purple-600 text-white font-bold shadow-xs'
                        : isDarkMode
                        ? 'border-slate-800 bg-slate-800/80 text-slate-300 hover:border-slate-700'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    Cap. {ch.order}: {ch.topicTitle}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Visor Interactivo a Ancho Completo */}
        <div>
          {currentChapter ? (
            <div
              className={`rounded-2xl border shadow-xs overflow-hidden transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
              }`}
            >
              {/* Header Banner */}
              <div
                className={`p-6 border-b ${
                  isDarkMode
                    ? 'bg-linear-to-r from-purple-950/40 via-slate-900 to-slate-900 border-slate-800'
                    : 'bg-linear-to-r from-purple-50/70 via-white to-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDarkMode ? 'text-purple-400' : 'text-purple-700'
                    }`}
                  >
                    {activeManual?.title} • Capítulo {currentChapter.order}
                  </span>
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                      isDarkMode
                        ? 'bg-slate-800 text-slate-400 border border-slate-700'
                        : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {activeManual?.studentAge}
                  </span>
                </div>
                <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                  {currentChapter.topicTitle}
                </h2>
                <p className={`text-xs mt-2 italic leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  "{currentChapter.intro}"
                </p>
              </div>

              <div className="p-6 space-y-6 font-sans">
                {/* 1. Conceptos Clave (Pills) */}
                <div>
                  <h4
                    className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 mb-2 ${
                      isDarkMode ? 'text-slate-200' : 'text-neutral-900'
                    }`}
                  >
                    <Bookmark className="w-3.5 h-3.5 text-purple-500" />
                    Conceptos Clave del Capítulo
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {currentChapter.keyConcepts.map((kc, i) => (
                      <span
                        key={i}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                          isDarkMode
                            ? 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                            : 'bg-purple-50 text-purple-900 border-purple-200'
                        }`}
                      >
                        {kc}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 2. Cuerpo Teórico Didáctico */}
                <div>
                  <h4
                    className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                      isDarkMode ? 'text-slate-200' : 'text-neutral-900'
                    }`}
                  >
                    Desarrollo Conceptual Adaptado
                  </h4>
                  <p
                    className={`text-xs leading-relaxed p-4 rounded-xl border whitespace-pre-line ${
                      isDarkMode
                        ? 'bg-slate-800/60 border-slate-700/80 text-slate-200'
                        : 'bg-neutral-50/60 border-neutral-200 text-neutral-700'
                    }`}
                  >
                    {currentChapter.contentBody}
                  </p>
                </div>

                {/* 3. Cuadros de Llamada (Callouts: Clave, Ejemplo, Curiosidad, Reflexión) */}
                <div className="space-y-3">
                  <h4
                    className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
                      isDarkMode ? 'text-slate-200' : 'text-neutral-900'
                    }`}
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    Cuadros de Llamada y Notas Pedagógicas
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {currentChapter.callouts.map((co, ci) => {
                      const isClave = co.type === 'clave';
                      const isCuriosidad = co.type === 'curiosidad';
                      const isEjemplo = co.type === 'ejemplo';

                      return (
                        <div
                          key={ci}
                          className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                            isClave
                              ? isDarkMode
                                ? 'bg-blue-950/40 border-blue-800/60 text-blue-200'
                                : 'bg-blue-50/70 border-blue-200 text-blue-950'
                              : isCuriosidad
                              ? isDarkMode
                                ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                                : 'bg-amber-50/70 border-amber-200 text-amber-950'
                              : isEjemplo
                              ? isDarkMode
                                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                              : isDarkMode
                              ? 'bg-purple-950/40 border-purple-800/60 text-purple-200'
                              : 'bg-purple-50/70 border-purple-200 text-purple-950'
                          }`}
                        >
                          <div className="font-bold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                            <Info className="w-3 h-3" />
                            {co.type === 'clave' && 'Concepto Clave'}
                            {co.type === 'curiosidad' && '¿Sabías Qué?'}
                            {co.type === 'ejemplo' && 'Ejemplo'}
                            {co.type === 'reflexion' && 'Reflexión'}
                          </div>
                          <p className="text-[11.5px] leading-relaxed">{co.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Ilustraciones Sugeridas */}
                {currentChapter.suggestedIllustrations.length > 0 && (
                  <div>
                    <h4
                      className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                        isDarkMode ? 'text-slate-200' : 'text-neutral-900'
                      }`}
                    >
                      Ilustraciones y Recursos Visuales Sugeridos
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentChapter.suggestedIllustrations.map((ill, ii) => (
                        <div
                          key={ii}
                          className={`text-xs p-2.5 rounded-lg border flex items-center gap-2 ${
                            isDarkMode
                              ? 'bg-slate-800/60 border-slate-700/80 text-slate-300'
                              : 'text-neutral-600 bg-neutral-100/70 border-neutral-200'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                          <span>{ill}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. Actividades de Comprensión Sugeridas */}
                <div>
                  <h4
                    className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 mb-2 ${
                      isDarkMode ? 'text-slate-200' : 'text-neutral-900'
                    }`}
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
                    Actividades de Comprensión Sugeridas
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {currentChapter.comprehensionActivities.map((act, ai) => (
                      <div
                        key={ai}
                        className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                          isDarkMode
                            ? 'bg-slate-800/60 border-slate-700/80 text-slate-200'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{act}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-2xl border p-12 text-center space-y-3 ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
              }`}
            >
              <BookOpen className={`w-12 h-12 mx-auto ${isDarkMode ? 'text-slate-600' : 'text-neutral-300'}`} />
              <p className={`text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-800'}`}>
                Aún no has generado capítulos para este material didáctico
              </p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                Elegí tus fuentes arriba (Google Drive, PDFs o videos de YouTube) y hacé clic en "Generar Material con Motor de IA".
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* MODAL 1: SELECCIONAR DESDE GOOGLE DRIVE                           */}
      {/* ----------------------------------------------------------------- */}
      {isDrivePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-2xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div
              className={`px-5 py-4 border-b flex items-center justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Seleccionar archivo desde Google Drive</h3>
                  <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Elegí un documento, PDF o planilla guardada en tu Google Drive docente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrivePickerOpen(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-neutral-200 dark:border-slate-800 space-y-3 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Buscar en Google Drive..."
                  value={driveSearch}
                  onChange={(e) => setDriveSearch(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                  autoFocus
                />
              </div>

              {/* Type filter chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                {(
                  [
                    { id: 'all', label: 'Todos los archivos' },
                    { id: 'doc', label: 'Documentos' },
                    { id: 'pdf', label: 'PDFs' },
                    { id: 'sheet', label: 'Planillas' },
                    { id: 'slide', label: 'Presentaciones' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDriveFilter(tab.id)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      driveFilter === tab.id
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recorte opcional e indicaciones para el archivo de Drive */}
            <div className={`px-4 py-3 border-b space-y-2 text-xs shrink-0 ${isDarkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-blue-50/50 border-blue-100'}`}>
              <div className="flex items-center justify-between font-bold text-blue-900 dark:text-blue-200">
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-blue-500" />
                  Indicaciones de recorte para el documento seleccionado:
                </span>
                <span className="text-[10px] text-neutral-400 font-normal">Opcional</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <input
                    type="text"
                    value={drivePageRange}
                    onChange={(e) => setDrivePageRange(e.target.value)}
                    placeholder="Páginas (ej: 'Págs 14 a 22' o 'Capítulo 3')"
                    className={`w-full text-xs rounded-xl px-2.5 py-1.5 border ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-blue-200 text-neutral-900'
                    }`}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={driveInstruction}
                    onChange={(e) => setDriveInstruction(e.target.value)}
                    placeholder="Indicación (ej: 'Considera de la página tanto a la tanto')"
                    className={`w-full text-xs rounded-xl px-2.5 py-1.5 border ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-blue-200 text-neutral-900'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Files List */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {isLoadingDrive ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-neutral-500">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-xs">Cargando tus archivos de Google Drive...</span>
                </div>
              ) : filteredDriveFiles.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <HardDrive className="w-10 h-10 mx-auto text-neutral-400 opacity-60" />
                  <p className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    No se encontraron archivos en Google Drive
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    Podés pegar el enlace directo abajo o subir un archivo PDF directamente.
                  </p>
                </div>
              ) : (
                filteredDriveFiles.map((f) => (
                  <div
                    key={f.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                      isDarkMode
                        ? 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/80'
                        : 'bg-white hover:bg-blue-50/40 border-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-neutral-100 dark:bg-slate-700 shrink-0">
                        {getDriveFileIcon(f.type)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate text-neutral-900 dark:text-white">
                          {f.name}
                        </p>
                        <p className="text-[10px] text-neutral-400 dark:text-slate-500 truncate mt-0.5">
                          {f.folder} • {f.size}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectDriveFile(f)}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shrink-0 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Seleccionar</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Direct Drive Link Fallback */}
            <div
              className={`p-4 border-t shrink-0 space-y-2 ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="text-[11px] font-semibold text-neutral-700 dark:text-slate-300 block">
                O ingresá un enlace directo de Google Drive / Google Docs:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://docs.google.com/document/d/... o https://drive.google.com/..."
                  value={driveDirectLink}
                  onChange={(e) => setDriveDirectLink(e.target.value)}
                  className={`flex-1 text-xs rounded-xl px-3 py-2 border ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleAddDirectDriveLink}
                  disabled={!driveDirectLink.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shrink-0 cursor-pointer"
                >
                  Agregar por Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* MODAL 2: AGREGAR WEB / ENLACE DIDÁCTICO                           */}
      {/* ----------------------------------------------------------------- */}
      {isWebModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-3xl border shadow-2xl p-5 space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Globe className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold">Agregar Artículo Web o Enlace</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsWebModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Título de la Fuente (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Wikipedia - Mitosis y Meiosis, Educ.ar..."
                  value={webTitle}
                  onChange={(e) => setWebTitle(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  URL del sitio web o contenido del texto
                </label>
                <textarea
                  rows={4}
                  placeholder="https://es.wikipedia.org/... o pega el texto didáctico del artículo aquí"
                  value={webUrlOrContent}
                  onChange={(e) => setWebUrlOrContent(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                  }`}
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Indicación específica para este texto (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Tomar únicamente la sección de conclusiones y causas..."
                  value={webInstruction}
                  onChange={(e) => setWebInstruction(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsWebModalOpen(false)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border ${
                  isDarkMode ? 'border-slate-700 text-slate-300' : 'border-neutral-200 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!webUrlOrContent.trim()}
                onClick={handleSaveWebSource}
                className="px-4 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white cursor-pointer"
              >
                Agregar Fuente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* MODAL 3: CREAR TU PROPIO GEM DOCENTE CON IA                       */}
      {/* ----------------------------------------------------------------- */}
      {isCreateGemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            {/* Header */}
            <div
              className={`px-5 py-4 border-b flex items-center justify-between ${
                isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-gradient-to-r from-purple-50 via-indigo-50 to-white border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-600/10 text-purple-600 dark:text-purple-400">
                  <Wand2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Crear tu propio Gem Docente</h3>
                  <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Diseñá un perfil de IA personalizado que quedará guardado para usar siempre en 1 clic
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateGemModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Asistente de IA: Redactar a partir de una idea */}
              <div className={`p-3.5 rounded-2xl border space-y-2.5 ${isDarkMode ? 'bg-purple-950/30 border-purple-800/50' : 'bg-purple-50/70 border-purple-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    Asistente de IA: ¿Cómo querés que sea tu Gem?
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-200/80 text-purple-800 dark:bg-purple-900 dark:text-purple-200 font-bold">
                    Opcional
                  </span>
                </div>
                <p className="text-[11px] text-neutral-600 dark:text-slate-300">
                  Escribí una idea básica y la IA redactará las directivas completas de comportamiento:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGemIdea}
                    onChange={(e) => setNewGemIdea(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerateGemWithAi()}
                    placeholder="Ej: Enfoque socrático, debates éticos y ejemplos de Argentina..."
                    className={`flex-1 px-3 py-2 text-xs rounded-xl border ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-purple-200 text-neutral-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateGemWithAi}
                    disabled={isGeneratingDirectives || !newGemIdea.trim()}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
                  >
                    {isGeneratingDirectives ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Redactando...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Redactar con IA</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Nombre del Gem */}
              <div>
                <label className="block text-xs font-bold mb-1">
                  Nombre del Gem <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej: Gem de Historia - Profe Jorge, Gem Preguntas Críticas..."
                  value={newGemName}
                  onChange={(e) => setNewGemName(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              {/* Descripción breve */}
              <div>
                <label className="block text-xs font-bold mb-1">
                  Breve descripción o propósito
                </label>
                <input
                  type="text"
                  placeholder="Ej: Foco en pensamiento crítico y dilemas contemporáneos"
                  value={newGemDescription}
                  onChange={(e) => setNewGemDescription(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              {/* Directivas / System Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold">
                    Directivas del Sistema (System Prompt del Gem) <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-neutral-400">
                    Instrucciones para el modelo
                  </span>
                </div>
                <textarea
                  rows={5}
                  placeholder="Instrucciones detalladas de cómo debe responder la IA, tono didáctico, tipo de ejemplos y preguntas..."
                  value={newGemDirectives}
                  onChange={(e) => setNewGemDirectives(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>
            </div>

            {/* Footer */}
            <div className={`px-5 py-3 border-t flex items-center justify-end gap-2.5 ${isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
              <button
                type="button"
                onClick={() => setIsCreateGemModalOpen(false)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingGem || !newGemName.trim() || !newGemDirectives.trim()}
                onClick={handleSaveCustomGem}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                {isSavingGem ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Guardar Gem</span>
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
