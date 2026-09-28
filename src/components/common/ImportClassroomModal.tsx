import React, { useState, useEffect } from 'react';
import {
  X,
  GraduationCap,
  RefreshCw,
  CheckCircle2,
  ListPlus,
  FileSpreadsheet,
  AlertCircle,
  ExternalLink,
  Users,
  Sparkles,
  Layers,
  ArrowRight,
  Check,
  BookOpen
} from 'lucide-react';
import { Course } from '../../types';
import { classroomService } from '../../services/workspace/classroomService';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface ImportClassroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCoursesImported: (courses: Course[], count: number) => void;
  existingCourses?: Course[];
}

interface DetectedClassroomCourse {
  id: string;
  name: string;
  section?: string;
  room?: string;
  descriptionHeading?: string;
  enrollmentCode?: string;
  alternateLink?: string;
  studentsCount?: number;
  selected: boolean;
  color?: string;
}

const CLASSROOM_COLORS = [
  '#137333', // Green
  '#1a73e8', // Blue
  '#d93025', // Red
  '#8430ce', // Purple
  '#e37400', // Orange
  '#007b83', // Teal
];

export const ImportClassroomModal: React.FC<ImportClassroomModalProps> = ({
  isOpen,
  onClose,
  onCoursesImported,
  existingCourses = [],
}) => {
  const { isDarkMode, user } = useWorkspaceAuth();
  const [activeTab, setActiveTab] = useState<'sync' | 'paste' | 'single'>('sync');

  // Sync state
  const [isSearchingClassroom, setIsSearchingClassroom] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [detectedCourses, setDetectedCourses] = useState<DetectedClassroomCourse[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Paste / Bulk list state
  const [pasteText, setPasteText] = useState(
    'Biología Celular - 3° 1° (Turno Mañana)\nQuímica General - 4° Año División B\nFísica Clásica - 5° 2° (Orientación Ciencias)'
  );
  const [parsedPasteCourses, setParsedPasteCourses] = useState<DetectedClassroomCourse[]>([]);

  // Single course state
  const [singleName, setSingleName] = useState('');
  const [singleSubject, setSingleSubject] = useState('');
  const [singleGrade, setSingleGrade] = useState('Secundaria - 3° Año');
  const [singleSection, setSingleSection] = useState('1° A');
  const [singleCode, setSingleCode] = useState('');
  const [singleStudents, setSingleStudents] = useState<number>(28);
  const [singleColor, setSingleColor] = useState('#137333');

  // Submit state
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Parse pasteText whenever it changes
  useEffect(() => {
    if (!pasteText.trim()) {
      setParsedPasteCourses([]);
      return;
    }
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: DetectedClassroomCourse[] = lines.map((line, idx) => {
      // Try to split by "-" or ":" or "("
      let name = line;
      let section = '1°';
      let grade = 'Secundaria';

      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        name = parts[0].trim();
        section = parts[1].trim();
      } else if (line.includes(':')) {
        const parts = line.split(':');
        name = parts[0].trim();
        section = parts[1].trim();
      }

      return {
        id: `paste-${idx}-${Date.now().toString().slice(-4)}`,
        name,
        section,
        descriptionHeading: `Cátedra de ${name}`,
        studentsCount: 26 + (idx % 6),
        selected: true,
        color: CLASSROOM_COLORS[idx % CLASSROOM_COLORS.length],
      };
    });

    setParsedPasteCourses(parsed);
  }, [pasteText]);

  // Attempt live Classroom search on open if tab is sync
  const fetchLiveCourses = async () => {
    setIsSearchingClassroom(true);
    setSyncNotice(null);
    setImportError(null);
    setHasSearched(true);
    try {
      const res = await classroomService.listClassroomCourses();
      if (res.success && res.courses && res.courses.length > 0) {
        const mapped: DetectedClassroomCourse[] = res.courses.map((c: any, idx: number) => ({
          id: c.id || `gc-${idx}`,
          name: c.name || 'Materia sin título',
          section: c.section || 'A',
          room: c.room || 'Aula Virtual',
          descriptionHeading: c.descriptionHeading || c.description,
          enrollmentCode: c.enrollmentCode,
          alternateLink: c.alternateLink,
          studentsCount: typeof c.studentsCount === 'number' ? c.studentsCount : 0,
          selected: false,
          color: CLASSROOM_COLORS[idx % CLASSROOM_COLORS.length],
        }));
        setDetectedCourses(mapped);
        setSyncNotice(res.message || `Se detectaron ${mapped.length} materias en tu Classroom.`);
      } else {
        setDetectedCourses([]);
        setSyncNotice(
          res.message ||
            'No se encontraron materias activas directamente con esta sesión de Google, o la cuenta institucional requiere acceso Workspace for Education. Puedes cargarlas al instante con la pestaña "Pegar Materias del Colegio".'
        );
      }
    } catch (err: any) {
      console.warn('Error fetching classroom courses:', err);
      setSyncNotice('No se pudieron recuperar las clases vía API. Puedes cargarlas al instante con la pestaña "Pegar Materias del Colegio".');
    } finally {
      setIsSearchingClassroom(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'sync' && !hasSearched) {
      fetchLiveCourses();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // Helper to check if course already exists by identity number
  const isCourseAlreadyLoaded = (c: { id?: string; name?: string; section?: string }) => {
    if (!existingCourses || existingCourses.length === 0) return false;
    const cid = c.id ? String(c.id).trim() : '';

    if (cid) {
      return existingCourses.some((ec) => {
        const ecClassroomId = ec.classroomCourseId ? String(ec.classroomCourseId).trim() : '';
        const ecId = String(ec.id).trim();
        return ecClassroomId === cid || ecId === cid;
      });
    }

    const cname = (c.name || '').trim().toLowerCase();
    const csec = (c.section || '').trim().toLowerCase();
    if (!cname) return false;

    return existingCourses.some((ec) => {
      const ecName = ec.name.trim().toLowerCase();
      const ecSec = (ec.section || '').trim().toLowerCase();
      return ecName === cname && (csec === '' || ecSec === csec);
    });
  };

  // Toggle selection
  const toggleCourseSelection = (id: string, isFromSync: boolean) => {
    if (isFromSync) {
      const course = detectedCourses.find((c) => c.id === id);
      if (course && isCourseAlreadyLoaded(course)) return;
      setDetectedCourses((prev) =>
        prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
      );
    } else {
      setParsedPasteCourses((prev) =>
        prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
      );
    }
  };

  // Preset subject chips
  const applyPresetSubject = (preset: { name: string; subject: string; grade: string; color: string }) => {
    setSingleName(preset.name);
    setSingleSubject(preset.subject);
    setSingleGrade(preset.grade);
    setSingleColor(preset.color);
  };

  // Handle final import
  const handleExecuteImport = async () => {
    setIsImporting(true);
    setImportError(null);

    let coursesToCreate: Partial<Course>[] = [];

    if (activeTab === 'sync') {
      const selected = detectedCourses.filter((c) => c.selected && !isCourseAlreadyLoaded(c));
      if (selected.length === 0) {
        setImportError(
          detectedCourses.some((c) => c.selected && isCourseAlreadyLoaded(c))
            ? 'Las materias seleccionadas ya están cargadas en tu panel (mismo número de identidad).'
            : 'Selecciona al menos una materia para importar.'
        );
        setIsImporting(false);
        return;
      }
      coursesToCreate = selected.map((c) => ({
        name: c.name,
        subject: c.name,
        grade: c.section ? `Curso ${c.section}` : 'Secundaria',
        section: c.section || 'A',
        room: c.room || 'Aula Classroom',
        color: c.color || '#137333',
        studentsCount: typeof c.studentsCount === 'number' ? c.studentsCount : 0,
        classroomCourseId: c.id,
        classroomSynced: true,
        code: c.enrollmentCode || Math.random().toString(36).substring(2, 8),
      }));
    } else if (activeTab === 'paste') {
      const selected = parsedPasteCourses.filter((c) => c.selected);
      if (selected.length === 0) {
        setImportError('Ingresa y selecciona al menos una materia para importar.');
        setIsImporting(false);
        return;
      }
      coursesToCreate = selected.map((c) => ({
        name: c.name,
        subject: c.name,
        grade: c.section ? `${c.section}` : 'Nivel Secundario',
        section: c.section || '1°',
        room: 'Aula Colegio',
        color: c.color || '#137333',
        studentsCount: c.studentsCount || 28,
        classroomSynced: true,
        classroomCourseId: `gc-${Math.random().toString(36).substring(2, 7)}`,
        code: Math.random().toString(36).substring(2, 8),
      }));
    } else {
      if (!singleName.trim()) {
        setImportError('Por favor ingresa el nombre de la materia.');
        setIsImporting(false);
        return;
      }
      coursesToCreate = [
        {
          name: singleName,
          subject: singleSubject || singleName,
          grade: singleGrade,
          section: singleSection || '1°',
          room: 'Aula Colegio',
          color: singleColor,
          studentsCount: Number(singleStudents) || 28,
          code: singleCode || Math.random().toString(36).substring(2, 8),
          classroomSynced: true,
          classroomCourseId: `gc-${Math.random().toString(36).substring(2, 7)}`,
        },
      ];
    }

    try {
      const result = await api.bulkImportCourses(coursesToCreate);
      onCoursesImported(result.courses, result.courses.length);
      onClose();
    } catch (err: any) {
      console.error('Error importing courses:', err);
      setImportError(err.message || 'Error al importar materias.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div
        className={`w-full max-w-3xl rounded-3xl shadow-2xl border overflow-hidden flex flex-col my-8 transition-colors ${
          isDarkMode
            ? 'bg-[#0f172a] border-slate-750 text-slate-100'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`px-6 py-5 border-b flex items-start justify-between relative ${
            isDarkMode
              ? 'bg-slate-900/90 border-slate-800'
              : 'bg-gradient-to-r from-emerald-50/80 via-white to-blue-50/50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/30">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                  Cargar Materias de Google Classroom
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                  Google Workspace
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Importa tus clases activas del colegio para planificar clases, crear evaluaciones y recibir entregas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-xl transition-colors ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className={`flex border-b px-6 pt-3 gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-900/50' : 'border-neutral-200 bg-neutral-50/60'}`}>
          <button
            onClick={() => setActiveTab('sync')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'sync'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSearchingClassroom ? 'animate-spin' : ''}`} />
            <span>Sincronizar Cuenta Google</span>
          </button>

          <button
            onClick={() => setActiveTab('paste')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'paste'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>Pegar Lista de Materias (Rápido)</span>
          </button>

          <button
            onClick={() => setActiveTab('single')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'single'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Cargar por Código / Asignatura</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[60vh]">
          {/* Tab 1: Live Sync */}
          {activeTab === 'sync' && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-2xl border text-xs flex items-start gap-3 ${
                  isDarkMode
                    ? 'bg-slate-900/60 border-slate-800 text-slate-300'
                    : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                }`}
              >
                <GraduationCap className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold">
                    Conectado con cuenta Google docente: {user?.email || 'Docente'}
                  </p>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    Buscamos las cátedras donde figures como docente titular o adjunto en Google Classroom.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchLiveCourses}
                  disabled={isSearchingClassroom}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs shrink-0 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSearchingClassroom ? 'animate-spin' : ''}`} />
                  <span>Reintentar</span>
                </button>
              </div>

              {syncNotice && (
                <p className={`text-xs px-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  {syncNotice}
                </p>
              )}

              {/* Detected Courses List */}
              {detectedCourses.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold px-1">
                    <span>Clases detectadas ({detectedCourses.length})</span>
                    <button
                      onClick={() => {
                        const allSelected = detectedCourses.every((c) => c.selected);
                        setDetectedCourses((prev) => prev.map((c) => ({ ...c, selected: !allSelected })));
                      }}
                      className="text-emerald-600 hover:underline cursor-pointer"
                    >
                      {detectedCourses.every((c) => c.selected) ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detectedCourses.map((c) => {
                      const alreadyLoaded = isCourseAlreadyLoaded(c);
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (!alreadyLoaded) {
                              toggleCourseSelection(c.id, true);
                            }
                          }}
                          className={`p-3.5 rounded-2xl border transition-all flex items-start gap-3 select-none ${
                            alreadyLoaded
                              ? isDarkMode
                                ? 'bg-slate-900/80 border-slate-800 text-slate-400 opacity-70 cursor-not-allowed'
                                : 'bg-neutral-100/90 border-neutral-200 text-neutral-500 opacity-80 cursor-not-allowed'
                              : c.selected
                              ? isDarkMode
                                ? 'bg-emerald-950/30 border-emerald-500/60 shadow-xs cursor-pointer'
                                : 'bg-emerald-50/70 border-emerald-400 shadow-xs cursor-pointer'
                              : isDarkMode
                              ? 'bg-slate-900/40 border-slate-800 opacity-60 hover:opacity-100 cursor-pointer'
                              : 'bg-neutral-50/80 border-neutral-200 opacity-60 hover:opacity-100 cursor-pointer'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center border mt-0.5 shrink-0 transition-colors ${
                              alreadyLoaded
                                ? 'border-emerald-600 bg-emerald-600/20 text-emerald-500'
                                : c.selected
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : isDarkMode
                                ? 'border-slate-700 bg-slate-800'
                                : 'border-neutral-300 bg-white'
                            }`}
                          >
                            {(c.selected || alreadyLoaded) && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className={`text-xs font-bold truncate ${alreadyLoaded ? 'line-through opacity-70' : ''}`}>
                                {c.name}
                              </h4>
                              {alreadyLoaded && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                                  ✓ Ya cargada
                                </span>
                              )}
                            </div>
                            <p className={`text-[11px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                              {c.section || 'División A'} {c.room ? `• ${c.room}` : ''}
                            </p>
                            <div className="flex items-center gap-2 mt-2 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                <span>{c.studentsCount || 25} estudiantes</span>
                              </span>
                              <span className="font-mono bg-neutral-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-slate-700 text-[9px]">
                                ID: {c.id}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                !isSearchingClassroom && (
                  <div
                    className={`p-6 rounded-2xl border border-dashed text-center space-y-3 ${
                      isDarkMode ? 'border-slate-800 bg-slate-900/30' : 'border-neutral-300 bg-neutral-50'
                    }`}
                  >
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold">¿No aparecen tus materias automáticamente?</h4>
                      <p className={`text-xs max-w-md mx-auto mt-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                        Muchos colegios usan cuentas institucionales con restricciones de seguridad de Google. Puedes importar todas tus materias en 1 segundo pegando tu lista.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('paste')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs inline-flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <ListPlus className="w-4 h-4" />
                      <span>Ir a Pegar Lista de Materias</span>
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* Tab 2: Paste List */}
          {activeTab === 'paste' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Pega o escribe las materias que tienes en tu Google Classroom del colegio:
                </label>
                <p className={`text-[11px] mb-2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Coloca una materia por línea. Puedes incluir año o división (ej: <em>Historia Argentina - 4° 2°</em>).
                </p>
                <textarea
                  rows={4}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Biología - 3° 1° (Turno Mañana)&#10;Química - 4° B&#10;Física - 5° 2°"
                  className={`w-full p-3 text-xs rounded-xl border font-mono transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                    isDarkMode
                      ? 'bg-slate-900 text-white border-slate-750'
                      : 'bg-neutral-50 text-neutral-900 border-neutral-300'
                  }`}
                />
              </div>

              {/* Sample loader button */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-neutral-500 dark:text-slate-400">
                  Vista previa de materias detectadas ({parsedPasteCourses.length}):
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPasteText(
                      'Biología Celular y Genética - 3° 1° (Mañana)\nFísica y Termodinámica - 4° B (Tarde)\nQuímica General y Orgánica - 5° 2°\nLengua y Literatura - 2° A\nHistoria Social y Política - 4° 1°'
                    )
                  }
                  className="text-[11px] text-emerald-600 hover:underline font-medium cursor-pointer"
                >
                  Cargar ejemplo de materias secundarias
                </button>
              </div>

              {/* Preview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {parsedPasteCourses.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => toggleCourseSelection(c.id, false)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between select-none ${
                      c.selected
                        ? isDarkMode
                          ? 'bg-emerald-950/40 border-emerald-500/60'
                          : 'bg-emerald-50/80 border-emerald-400'
                        : isDarkMode
                        ? 'bg-slate-900/40 border-slate-800 opacity-50'
                        : 'bg-neutral-50 border-neutral-200 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      <div className="truncate">
                        <p className="text-xs font-bold truncate">{c.name}</p>
                        <p className={`text-[10px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          {c.section || 'Secundaria'} • ~{c.studentsCount} estudiantes
                        </p>
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                        c.selected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-neutral-300'
                      }`}
                    >
                      {c.selected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Single Course / Code */}
          {activeTab === 'single' && (
            <div className="space-y-4">
              {/* Presets */}
              <div>
                <label className="block text-xs font-bold mb-2 text-neutral-700 dark:text-slate-300">
                  Plantillas de materias del colegio con 1 clic:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { name: 'Biología Celular y Genética', subject: 'Biología', grade: 'Secundaria - 3° Año', color: '#137333' },
                    { name: 'Matemáticas y Álgebra', subject: 'Matemáticas', grade: 'Secundaria - 4° Año', color: '#1a73e8' },
                    { name: 'Historia y Ciencias Sociales', subject: 'Historia', grade: 'Secundaria - 2° Año', color: '#d93025' },
                    { name: 'Lengua y Literatura', subject: 'Lengua', grade: 'Secundaria - 3° Año', color: '#8430ce' },
                    { name: 'Física Clásica y Óptica', subject: 'Física', grade: 'Secundaria - 5° Año', color: '#007b83' },
                    { name: 'Química General e Inorgánica', subject: 'Química', grade: 'Secundaria - 4° Año', color: '#e37400' },
                    { name: 'Inglés Comunicativo', subject: 'Inglés', grade: 'Secundaria - 1° Año', color: '#1a73e8' },
                    { name: 'Geografía Mundial y Regional', subject: 'Geografía', grade: 'Secundaria - 3° Año', color: '#137333' },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPresetSubject(preset)}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border font-medium transition-all ${
                        singleName === preset.name
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : isDarkMode
                          ? 'bg-slate-900 hover:bg-slate-800 border-slate-750 text-slate-300'
                          : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
                      }`}
                    >
                      {preset.subject}
                    </button>
                  ))}
                </div>
              </div>

              {/* Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold mb-1">Nombre de la Materia en Classroom *</label>
                  <input
                    type="text"
                    value={singleName}
                    onChange={(e) => {
                      setSingleName(e.target.value);
                      if (!singleSubject) setSingleSubject(e.target.value);
                    }}
                    placeholder="Ej. Biología 3° 1ra"
                    className={`w-full px-3 py-2 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Curso / Nivel</label>
                  <input
                    type="text"
                    value={singleGrade}
                    onChange={(e) => setSingleGrade(e.target.value)}
                    placeholder="Ej. Secundaria - 3° Año"
                    className={`w-full px-3 py-2 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">División / Turno</label>
                  <input
                    type="text"
                    value={singleSection}
                    onChange={(e) => setSingleSection(e.target.value)}
                    placeholder="Ej. 1° A - Turno Mañana"
                    className={`w-full px-3 py-2 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Código de Classroom (Opcional)</label>
                  <input
                    type="text"
                    value={singleCode}
                    onChange={(e) => setSingleCode(e.target.value)}
                    placeholder="Ej. k7m9px"
                    className={`w-full px-3 py-2 text-xs rounded-xl border font-mono transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Estudiantes Estimados</label>
                  <input
                    type="number"
                    value={singleStudents}
                    onChange={(e) => setSingleStudents(Number(e.target.value))}
                    min={1}
                    max={60}
                    className={`w-full px-3 py-2 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isDarkMode ? 'bg-slate-900 border-slate-750 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          <div className="text-xs font-medium text-neutral-500 dark:text-slate-400">
            {activeTab === 'sync' && (
              <span>
                {detectedCourses.filter((c) => c.selected).length} de {detectedCourses.length} materias seleccionadas
              </span>
            )}
            {activeTab === 'paste' && (
              <span>
                {parsedPasteCourses.filter((c) => c.selected).length} materias listas para importar
              </span>
            )}
            {activeTab === 'single' && (
              <span>1 nueva materia de Classroom</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                isDarkMode
                  ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                  : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
              }`}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={isImporting}
              className="flex-1 sm:flex-initial px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Importando a Docenc.IA...</span>
                </>
              ) : (
                <>
                  <GraduationCap className="w-4 h-4" />
                  <span>Cargar Materias a Docenc.IA</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
