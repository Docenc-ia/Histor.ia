import React, { useState, useEffect } from 'react';
import {
  X,
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Sparkles,
  Layers,
  ArrowRight,
  Users,
} from 'lucide-react';
import { Course } from '../../types';
import { classroomService } from '../../services/workspace/classroomService';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { getCachedAccessToken } from '../../services/workspace/googleAuth';

interface ImportClassroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  existingCourses?: Course[];
}

export const ImportClassroomModal: React.FC<ImportClassroomModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingCourses = [],
}) => {
  const { user, isDarkMode, token, loginWithGoogle } = useWorkspaceAuth();
  const [activeTab, setActiveTab] = useState<'classroom' | 'quick'>('classroom');

  // Classroom scan state
  const [isScanning, setIsScanning] = useState(false);
  const [classroomCourses, setClassroomCourses] = useState<any[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [isGoogleAuthorized, setIsGoogleAuthorized] = useState<boolean>(() => {
    return !!(token || getCachedAccessToken());
  });

  // Quick manual subjects state
  const [manualRows, setManualRows] = useState<Array<{ name: string; grade: string; students: number }>>([
    { name: '', grade: 'Secundaria - 4° Año', students: 25 },
    { name: '', grade: 'Secundaria - 5° Año', students: 25 },
  ]);
  const [bulkText, setBulkText] = useState('');
  const [bulkTextMode, setBulkTextMode] = useState(false);

  // Common options
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync authorization state
  useEffect(() => {
    const hasToken = !!(token || getCachedAccessToken());
    setIsGoogleAuthorized(hasToken);
  }, [token, isOpen]);

  // Auto scan on modal open ONLY if an active token already exists
  useEffect(() => {
    if (isOpen && activeTab === 'classroom' && !hasScanned) {
      const activeToken = token || getCachedAccessToken();
      if (activeToken) {
        handleScanClassroom(false);
      }
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleScanClassroom = async (forceAuthPopup = false) => {
    setIsScanning(true);
    setErrorMessage(null);
    setScanMessage(null);

    try {
      let activeToken = token || getCachedAccessToken();

      // If user is not authorized or explicitly requested reconnection, trigger Google OAuth
      if (!activeToken || forceAuthPopup) {
        setScanMessage('Abriendo ventana de Google para autorizar acceso a Google Classroom...');
        try {
          await loginWithGoogle(user?.email || undefined);
          activeToken = getCachedAccessToken();
          setIsGoogleAuthorized(true);
        } catch (authErr: any) {
          if (
            authErr?.message?.includes('cerrada') ||
            authErr?.error === 'popup_closed_by_user' ||
            authErr?.type === 'popup_closed'
          ) {
            setScanMessage('Se cerró la ventana de Google sin autorizar.');
            setIsScanning(false);
            return;
          }
          throw authErr;
        }
      }

      setScanMessage('Consultando tus clases en Google Classroom...');
      const result = await classroomService.listClassroomCourses(activeToken || undefined, {
        fetchStudentCounts: false,
        forceFresh: true,
      });
      setHasScanned(true);

      if (result.success && result.courses.length > 0) {
        setClassroomCourses(result.courses);
        setSelectedCourseIds(new Set()); // Start with 0 selected so the user explicitly chooses what to import
        setScanMessage(`¡Conexión exitosa! Se encontraron ${result.courses.length} clases en Google Classroom. Selecciona las que deseas agregar a tu panel.`);
      } else if (result.success && result.courses.length === 0) {
        setClassroomCourses([]);
        setScanMessage(
          `Google Classroom respondió correctamente para ${user?.email || 'tu cuenta'}, pero actualmente no tienes materias activas creadas en Classroom. Puedes crearlas en Classroom o agregarlas en 30 segundos con la pestaña "Carga Rápida".`
        );
      } else {
        setClassroomCourses([]);
        setScanMessage(result.message || 'No se pudieron obtener las materias de Classroom.');
        if (result.errorDetail) {
          setErrorMessage(result.errorDetail);
        }
      }
    } catch (err: any) {
      setHasScanned(true);
      setErrorMessage(err?.message || 'Error al conectar con Google Classroom.');
    } finally {
      setIsScanning(false);
    }
  };

  // Helper to check if a classroom course is already loaded in the user's workspace by identity number
  const isCourseAlreadyLoaded = (c: any) => {
    if (!existingCourses || existingCourses.length === 0) return false;
    const cid = c.id ? String(c.id).trim() : '';

    // If course has a Google Classroom ID, match STRICTLY by identity number!
    // Never match by subject or loose name, so teachers with multiple classes of the same subject don't have courses falsely blocked.
    if (cid) {
      return existingCourses.some((ec) => {
        const ecClassroomId = ec.classroomCourseId ? String(ec.classroomCourseId).trim() : '';
        const ecId = String(ec.id).trim();
        return ecClassroomId === cid || ecId === cid;
      });
    }

    // Only for items without an ID (e.g. manual paste), match both exact name AND exact section
    const cname = (c.name || '').trim().toLowerCase();
    const csec = (c.section || '').trim().toLowerCase();
    if (!cname) return false;

    return existingCourses.some((ec) => {
      const ecName = ec.name.trim().toLowerCase();
      const ecSec = (ec.section || '').trim().toLowerCase();
      return ecName === cname && (csec === '' || ecSec === csec);
    });
  };

  const toggleCourseSelection = (id: string) => {
    const course = classroomCourses.find((c) => c.id === id);
    if (course && isCourseAlreadyLoaded(course)) {
      return; // Do not allow selecting already loaded courses
    }
    const next = new Set(selectedCourseIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedCourseIds(next);
  };

  const selectAllCourses = () => {
    const selectableCourses = classroomCourses.filter((c) => !isCourseAlreadyLoaded(c));
    if (selectableCourses.length === 0) return;
    if (selectedCourseIds.size === selectableCourses.length) {
      setSelectedCourseIds(new Set());
    } else {
      setSelectedCourseIds(new Set(selectableCourses.map((c) => c.id)));
    }
  };

  // Add a manual row
  const addManualRow = () => {
    setManualRows([...manualRows, { name: '', grade: 'Secundaria', students: 25 }]);
  };

  const removeManualRow = (index: number) => {
    setManualRows(manualRows.filter((_, i) => i !== index));
  };

  const updateManualRow = (index: number, field: 'name' | 'grade' | 'students', value: any) => {
    const updated = [...manualRows];
    updated[index] = { ...updated[index], [field]: value };
    setManualRows(updated);
  };

  // Parse bulk text if using text area
  const parseBulkText = () => {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const parsed = lines.map((line) => {
      // Check if line contains a dash or separator like "Matemática - 4to A"
      const parts = line.split(/[-–—|]/).map((p) => p.trim());
      const name = parts[0] || line;
      const grade = parts[1] || 'Secundaria';
      return { name, grade, students: 25 };
    });
    return parsed;
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let coursesToImport: Partial<Course>[] = [];

      if (activeTab === 'classroom') {
        const selected = classroomCourses.filter((c) => selectedCourseIds.has(c.id));
        if (selected.length === 0) {
          throw new Error('Selecciona al menos una materia de Google Classroom para importar.');
        }

        // Filter out any courses that are already loaded in existingCourses to avoid duplicating
        const filteredToImport = selected.filter((c) => !isCourseAlreadyLoaded(c));

        if (filteredToImport.length === 0 && selected.length > 0) {
          throw new Error(
            'Las materias seleccionadas ya se encuentran cargadas en tu panel de trabajo (mismo número de identidad). No se duplicarán.'
          );
        }

        coursesToImport = filteredToImport.map((c) => {
          const rawName = (c.name || '').trim();
          const rawSection = (c.section || '').trim();
          const hasParen = rawName.includes('(') && rawName.includes(')');
          const formattedName = !hasParen && rawSection ? `${rawName} (${rawSection})` : rawName;

          return {
            name: formattedName,
            subject: rawName,
            grade: rawSection || 'Secundaria',
            section: rawSection || undefined,
            room: c.room || 'Aula Classroom',
            studentsCount: typeof c.studentsCount === 'number' ? c.studentsCount : 0,
            classroomSynced: true,
            classroomCourseId: c.id,
            code: c.enrollmentCode || undefined,
            schoolYear: '2026',
          };
        });
      } else {
        // Quick Manual Tab
        const items = bulkTextMode ? parseBulkText() : manualRows;
        const validItems = items.filter((item) => item.name.trim().length > 0);

        if (validItems.length === 0) {
          throw new Error('Por favor escribe el nombre de al menos una materia real.');
        }

        coursesToImport = validItems.map((item, idx) => {
          const rawName = item.name.trim();
          const rawGrade = item.grade.trim();
          const hasParen = rawName.includes('(') && rawName.includes(')');
          const formattedName =
            !hasParen && rawGrade && rawGrade !== 'Secundaria'
              ? `${rawName} (${rawGrade})`
              : rawName;
          const cleanSubject = rawName.replace(/\s*\([^)]*\)/, '').trim();

          return {
            name: formattedName,
            subject: cleanSubject || rawName,
            grade: rawGrade || 'Secundaria',
            section: rawGrade || undefined,
            room: `Aula ${idx + 1}`,
            studentsCount: Number(item.students) || 25,
            classroomSynced: false,
            schoolYear: '2026',
          };
        });
      }

      // Bulk import the real courses
      const result = await api.bulkImportCourses(coursesToImport);

      onSuccess(
        `${result.courses.length} materias reales agregadas correctamente a tu espacio de trabajo.`
      );
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al importar las materias.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`rounded-3xl max-w-2xl w-full border shadow-2xl flex flex-col my-8 animate-in fade-in zoom-in-95 duration-200 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white shadow-blue-950/40'
            : 'bg-white border-neutral-200 text-neutral-900 shadow-xl'
        }`}
      >
        {/* Header */}
        <div className={`p-6 border-b flex items-start justify-between gap-4 ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-xs ${
              isDarkMode ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold">Cargar Mis Materias Reales</h2>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Reemplaza las materias de ficción por tus cátedras y cursos reales
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-xl transition-colors cursor-pointer ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className={`flex border-b px-6 gap-4 text-xs font-semibold ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
          <button
            type="button"
            onClick={() => setActiveTab('classroom')}
            className={`py-3.5 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'classroom'
                ? isDarkMode
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-emerald-600 text-emerald-700'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            <span>Desde Google Classroom</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`py-3.5 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'quick'
                ? isDarkMode
                  ? 'border-blue-500 text-blue-400'
                  : 'border-blue-600 text-blue-700'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Carga Rápida (Escribir o Pegar Lista)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto max-h-[60vh]">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* TAB 1: GOOGLE CLASSROOM */}
          {activeTab === 'classroom' && (
            <div className="space-y-4">
              {/* Authorization banner & scan triggers */}
              {!isGoogleAuthorized ? (
                <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isDarkMode ? 'bg-amber-950/30 border-amber-800/50' : 'bg-amber-50/80 border-amber-200'
                }`}>
                  <div className="text-xs space-y-1">
                    <p className={`font-bold flex items-center gap-1.5 ${isDarkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span>Conectar con tu cuenta de Google del Colegio</span>
                    </p>
                    <p className={isDarkMode ? 'text-slate-300' : 'text-neutral-600'}>
                      Para leer tus clases reales de Classroom, autoriza el acceso a Google con <strong className="underline">{user?.email || 'tu cuenta'}</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleScanClassroom(true)}
                    disabled={isScanning}
                    className="px-4 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center gap-2 transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <GraduationCap className="w-4 h-4" />
                    <span>{isScanning ? 'Conectando...' : 'Autorizar y Escanear Classroom'}</span>
                  </button>
                </div>
              ) : (
                <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-emerald-50/50 border-emerald-200/60'
                }`}>
                  <div className="text-xs space-y-0.5">
                    <p className="font-semibold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Google Conectado:</span>{' '}
                      <span className="text-emerald-500 font-bold">{user?.email || 'Docente'}</span>
                    </p>
                    <p className={isDarkMode ? 'text-slate-400' : 'text-neutral-600'}>
                      Consulta las aulas activas donde eres profesor titular o colaborador.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleScanClassroom(false)}
                      disabled={isScanning}
                      className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                      <span>{isScanning ? 'Buscando clases...' : 'Buscar Clases'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScanClassroom(true)}
                      title="Cambiar cuenta o renovar permisos de Google"
                      className={`p-2 text-xs rounded-xl border transition-all cursor-pointer ${
                        isDarkMode
                          ? 'border-slate-700 hover:bg-slate-700 text-slate-300'
                          : 'border-neutral-300 hover:bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      Cambiar cuenta
                    </button>
                  </div>
                </div>
              )}

              {scanMessage && (
                <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed ${
                  classroomCourses.length > 0
                    ? isDarkMode
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : isDarkMode
                    ? 'bg-blue-950/40 border-blue-800/60 text-blue-300'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}>
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                  <div className="space-y-1">
                    <p>{scanMessage}</p>
                    {classroomCourses.length === 0 && hasScanned && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('quick')}
                        className="inline-flex items-center gap-1 text-xs font-bold underline hover:opacity-80 cursor-pointer pt-0.5"
                      >
                        <span>Escribir mis materias manualmente en Carga Rápida &rarr;</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Classroom courses list */}
              {classroomCourses.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold">
                      Selecciona las materias a importar:{' '}
                      <span className={selectedCourseIds.size > 0 ? 'text-blue-500 font-bold' : 'text-neutral-400 font-normal'}>
                        ({selectedCourseIds.size} seleccionadas para importar)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={selectAllCourses}
                      className="text-xs text-blue-500 hover:underline cursor-pointer"
                    >
                      {selectedCourseIds.size > 0 ? 'Deseleccionar todas' : 'Seleccionar disponibles'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {classroomCourses.map((c) => {
                      const alreadyLoaded = isCourseAlreadyLoaded(c);
                      const isSelected = selectedCourseIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (!alreadyLoaded) {
                              toggleCourseSelection(c.id);
                            }
                          }}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                            alreadyLoaded
                              ? isDarkMode
                                ? 'bg-slate-900/90 border-slate-800 text-slate-400 opacity-80 cursor-not-allowed'
                                : 'bg-neutral-100/90 border-neutral-200 text-neutral-500 opacity-85 cursor-not-allowed'
                              : isSelected
                              ? isDarkMode
                                ? 'bg-emerald-950/40 border-emerald-600/70 text-white cursor-pointer'
                                : 'bg-emerald-50/70 border-emerald-400 text-emerald-900 shadow-2xs cursor-pointer'
                              : isDarkMode
                              ? 'bg-slate-800/50 border-slate-700/80 text-slate-300 hover:border-slate-600 cursor-pointer'
                              : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected || alreadyLoaded}
                              disabled={alreadyLoaded}
                              onChange={() => {
                                if (!alreadyLoaded) {
                                  toggleCourseSelection(c.id);
                                }
                              }}
                              className={`w-4 h-4 rounded-md accent-emerald-600 ${
                                alreadyLoaded ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-xs font-bold truncate ${alreadyLoaded ? 'line-through opacity-70' : ''}`}>
                                  {c.name}
                                </p>
                                {alreadyLoaded && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                                    ✓ Ya cargada en tu panel
                                  </span>
                                )}
                              </div>
                              <p className={`text-[11px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                                {c.section ? `Sección: ${c.section}` : c.descriptionHeading || 'Google Classroom'}
                                {c.room ? ` • ${c.room}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 ${
                              isDarkMode ? 'bg-blue-950/60 text-blue-300' : 'bg-blue-50 text-blue-700'
                            }`}>
                              <Users className="w-3 h-3" />
                              {typeof c.studentsCount === 'number' ? `${c.studentsCount} estudiantes` : '0 estudiantes'}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                                isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                              }`}
                              title={`Número de identidad de Google Classroom: ${c.id}`}
                            >
                              ID: {c.id}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : !isScanning && hasScanned ? (
                <div className={`p-5 rounded-2xl border text-center space-y-3 ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                }`}>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Si tu cuenta de Google aún no tiene aulas creadas en Google Classroom, puedes agregarlas en 30 segundos con la pestaña <strong>Carga Rápida</strong>.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('quick')}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <span>Ir a Carga Rápida</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 2: QUICK MANUAL / PASTE */}
          {activeTab === 'quick' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {bulkTextMode ? 'Pega tus materias (una por línea):' : 'Ingresa tus materias y divisiones:'}
                </span>
                <button
                  type="button"
                  onClick={() => setBulkTextMode(!bulkTextMode)}
                  className="text-xs text-blue-500 hover:underline cursor-pointer"
                >
                  {bulkTextMode ? 'Cambiar a filas individuales' : 'Cambiar a pegar texto libre'}
                </button>
              </div>

              {bulkTextMode ? (
                <div className="space-y-2">
                  <textarea
                    rows={6}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder="Ejemplo:&#10;Física Aplicada - 4° Año A&#10;Química Biológica - 5° Año B&#10;Introducción a la Ciencia - 3° Año C"
                    className={`w-full p-3.5 text-xs sm:text-sm rounded-2xl border outline-none font-mono ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                        : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:bg-white focus:border-blue-500'
                    }`}
                  />
                  <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Puedes separar el nombre de la materia y el año con un guion (ej: <em>Matemática - 4to A</em>).
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {manualRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="flex-1">
                        <input
                          type="text"
                          required
                          value={row.name}
                          onChange={(e) => updateManualRow(idx, 'name', e.target.value)}
                          placeholder="Nombre de la materia (ej: Física I)"
                          className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                              : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'
                          }`}
                        />
                      </div>
                      <div className="w-36">
                        <input
                          type="text"
                          value={row.grade}
                          onChange={(e) => updateManualRow(idx, 'grade', e.target.value)}
                          placeholder="Año/Div (ej: 4° A)"
                          className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                              : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeManualRow(idx)}
                        disabled={manualRows.length <= 1}
                        className={`p-2 rounded-xl text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-30 cursor-pointer ${
                          isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-neutral-100'
                        }`}
                        title="Eliminar fila"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addManualRow}
                    className={`w-full py-2 border-2 border-dashed rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50'
                        : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar otra materia</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-6 border-t flex items-center justify-end gap-3 ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-600'
            }`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isSubmitting || (activeTab === 'classroom' && selectedCourseIds.size === 0)}
            className="px-5 py-2.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Cargando tus materias...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {activeTab === 'classroom'
                    ? selectedCourseIds.size === 0
                      ? 'Selecciona materias para importar'
                      : `Importar ${selectedCourseIds.size} ${selectedCourseIds.size === 1 ? 'materia seleccionada' : 'materias seleccionadas'}`
                    : 'Guardar Mis Materias'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
