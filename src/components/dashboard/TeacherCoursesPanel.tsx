import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  FileText,
  CheckSquare,
  Table,
  Plus,
  Search,
  Users,
  GraduationCap,
  ExternalLink,
  ArrowRight,
  FolderClosed,
  CheckCircle2,
  Clock,
  Sparkles,
  Calendar,
  Layers,
  Trash2,
  RefreshCw,
  AlertCircle,
  LayoutGrid,
  List,
  Mail,
} from 'lucide-react';
import { Course } from '../../types';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { formatCourseSidebarLabel } from '../../utils/courseFormatting';
import { classroomService } from '../../services/workspace/classroomService';
import { api } from '../../services/api';
import { getCachedAccessToken } from '../../services/workspace/googleAuth';
import { ImportClassroomModal } from './ImportClassroomModal';

interface TeacherCoursesPanelProps {
  courses: Course[];
  onSelectCourseAndTab: (courseId: string, tab: 'planificacion' | 'planificacion_anual' | 'material' | 'actividades' | 'evaluaciones' | 'alumnos') => void;
  onCreateCourse: (courseData: Partial<Course>) => void;
  onDeleteCourse: (courseId: string) => Promise<void> | void;
  onClearCourses?: () => Promise<void> | void;
  onRestoreDemoCourses?: () => Promise<void> | void;
  onOpenImportClassroom?: () => void;
  onRefreshData?: () => void;
  onImportSuccess?: (message: string) => void;
}

export const TeacherCoursesPanel: React.FC<TeacherCoursesPanelProps> = ({
  courses,
  onSelectCourseAndTab,
  onCreateCourse,
  onDeleteCourse,
  onClearCourses,
  onRestoreDemoCourses,
  onOpenImportClassroom,
  onRefreshData,
  onImportSuccess,
}) => {
  const { user, isDarkMode, token, loginWithGoogle } = useWorkspaceAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseGrade, setNewCourseGrade] = useState('Secundaria - 4° Año');
  const [newCourseStudents, setNewCourseStudents] = useState<number>(0);
  const [newCourseSubject, setNewCourseSubject] = useState('');
  const [isSyncingRoster, setIsSyncingRoster] = useState(false);
  const [rosterSyncMsg, setRosterSyncMsg] = useState<string | null>(null);
  const [needsRosterPermission, setNeedsRosterPermission] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [syncingCourseId, setSyncingCourseId] = useState<string | null>(null);

  // Sync real students from Google Classroom (MANUALLY triggered by user)
  const handleSyncRealClassroomStudents = async (showNotice = true) => {
    const activeToken = token || getCachedAccessToken();
    if (!activeToken) {
      setRosterSyncMsg('Por favor, conecta tu cuenta de Google para sincronizar.');
      setTimeout(() => setRosterSyncMsg(null), 4000);
      return;
    }

    try {
      setIsSyncingRoster(true);
      // Fetch active courses from Classroom to check roster and enrollment numbers
      const res = await classroomService.listClassroomCourses(activeToken);
      if (res.rosterPermissionRequired) {
        setNeedsRosterPermission(true);
      } else {
        setNeedsRosterPermission(false);
      }
      const classroomMap = new Map<string, number>();

      if (res.success && Array.isArray(res.courses) && res.courses.length > 0) {
        res.courses.forEach((gc: any) => {
          if (gc.id && typeof gc.studentsCount === 'number') {
            classroomMap.set(gc.id, gc.studentsCount);
            if (gc.name) {
              classroomMap.set(gc.name.trim().toLowerCase(), gc.studentsCount);
            }
          }
        });
      }

      // STRICTLY UPDATE EXISTING COURSES ONLY - DO NOT AUTO-IMPORT ANY MISSING/DELETED COURSES
      const updates: Array<{ id: string; studentsCount: number }> = [];

      for (const course of courses) {
        let realCount: number | null = null;
        let realStudents: any[] = [];
        let matchedId = course.classroomCourseId;

        try {
          const rosterRes = await classroomService.resolveAndFetchCourseStudents(course, activeToken);
          if (rosterRes.rosterPermissionRequired) {
            setNeedsRosterPermission(true);
          }
          if (rosterRes.success) {
            realStudents = rosterRes.students || [];
            realCount = realStudents.length;
            matchedId = rosterRes.realClassroomId || matchedId;
          }
        } catch (_) {}

        if (realCount === null) {
          if (course.classroomCourseId && classroomMap.has(course.classroomCourseId)) {
            realCount = classroomMap.get(course.classroomCourseId)!;
          } else {
            const cleanName = course.name.toLowerCase().trim();
            const cleanSubject = course.subject.toLowerCase().trim();
            if (classroomMap.has(cleanName)) {
              realCount = classroomMap.get(cleanName)!;
            } else if (classroomMap.has(cleanSubject)) {
              realCount = classroomMap.get(cleanSubject)!;
            }
          }
        }

        if (realStudents.length > 0) {
          try {
            await api.syncCourseStudentsRoster(course.id, realStudents);
          } catch (e) {
            console.warn('Error saving students in batch sync:', e);
          }
        }

        if (realCount !== null && (realCount !== course.studentsCount || matchedId !== course.classroomCourseId)) {
          updates.push({ id: course.id, studentsCount: realCount });
          if (matchedId && matchedId !== course.classroomCourseId) {
            await api.updateCourse(course.id, { classroomCourseId: matchedId, classroomSynced: true });
          }
        }
      }

      if (updates.length > 0) {
        await api.syncCourseStudents(updates);
        if (onRefreshData) onRefreshData();
      }

      if (showNotice) {
        if (updates.length > 0) {
          setRosterSyncMsg(`Se sincronizó la nómina real desde Classroom (${updates.length} materias actualizadas).`);
        } else {
          setRosterSyncMsg('Las materias actuales ya reflejan los inscriptos de Classroom.');
        }
        setTimeout(() => setRosterSyncMsg(null), 5000);
      }
    } catch (err: any) {
      console.warn('Sync students error:', err);
      setRosterSyncMsg('Error al conectar con Classroom para sincronizar.');
      setTimeout(() => setRosterSyncMsg(null), 4000);
    } finally {
      setIsSyncingRoster(false);
    }
  };

  // Sync real students for a single course (MANUALLY triggered by user)
  const handleSyncSingleCourse = async (course: Course) => {
    const activeToken = token || getCachedAccessToken();
    if (!activeToken) {
      setRosterSyncMsg('Por favor, conectá tu cuenta de Google para sincronizar.');
      setTimeout(() => setRosterSyncMsg(null), 4000);
      return;
    }

    try {
      setSyncingCourseId(course.id);
      const res = await classroomService.resolveAndFetchCourseStudents(course, activeToken);

      if (res.rosterPermissionRequired) {
        setNeedsRosterPermission(true);
      }

      if (res.success && Array.isArray(res.students)) {
        await api.syncCourseStudentsRoster(course.id, res.students);
        await api.syncCourseStudents([{ id: course.id, studentsCount: res.students.length }]);
        if (res.realClassroomId && res.realClassroomId !== course.classroomCourseId) {
          await api.updateCourse(course.id, { classroomCourseId: res.realClassroomId, classroomSynced: true });
        }
        if (onRefreshData) onRefreshData();
        setRosterSyncMsg(`Materia "${course.name}" sincronizada: ${res.students.length} estudiantes reales desde Google Classroom.`);
        setTimeout(() => setRosterSyncMsg(null), 4000);
      } else {
        setRosterSyncMsg(res.message || `No se encontraron estudiantes para "${course.name}" en Classroom.`);
        setTimeout(() => setRosterSyncMsg(null), 4000);
      }
    } catch (err) {
      console.warn('Error syncing single course:', err);
      setRosterSyncMsg(`Error al sincronizar "${course.name}".`);
      setTimeout(() => setRosterSyncMsg(null), 4000);
    } finally {
      setSyncingCourseId(null);
    }
  };

  // NOTE: Automatic background synchronization is intentionally disabled per user instructions.
  // Synchronization of students and courses is strictly manual and explicit.

  const filteredCourses = courses.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.grade.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseName.trim()) return;
    onCreateCourse({
      name: newCourseName,
      grade: newCourseGrade,
      subject: newCourseSubject || newCourseName,
      studentsCount: Number(newCourseStudents) || 25,
      section: 'A',
      schoolYear: '2026',
    });
    setNewCourseName('');
    setNewCourseSubject('');
    setIsCreateModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div
        className={`rounded-3xl p-6 sm:p-8 shadow-lg relative overflow-hidden transition-all duration-300 border ${
          isDarkMode
            ? 'bg-gradient-to-br from-[#162D5A] via-[#1E3B75] to-[#172E5E] border-blue-500/40 text-white shadow-blue-950/30'
            : 'bg-gradient-to-br from-[#2563EB] via-[#1D4ED8] to-[#1E40AF] border-blue-400/50 text-white shadow-blue-500/20'
        }`}
      >
        <div
          className={`absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20 ${
            isDarkMode ? 'bg-blue-400/20' : 'bg-white/15'
          }`}
        />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-xs border transition-colors ${
                isDarkMode
                  ? 'bg-blue-950/70 text-blue-200 border-blue-600/50'
                  : 'bg-white/20 text-blue-50 border-white/30 shadow-2xs'
              }`}
            >
              <GraduationCap className="w-4 h-4 text-white" />
              <span>{user?.school || 'Colegio Secundario FDS'} • Ciclo Lectivo 2026</span>
            </div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            >
              Mis materias
            </h1>
            <p
              className={`text-sm max-w-2xl font-normal leading-relaxed ${
                isDarkMode ? 'text-blue-100/90' : 'text-blue-100'
              }`}
            >
              Seleccioná una materia para continuar.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className={`px-3.5 py-2.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 border cursor-pointer ${
                isDarkMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/50'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 shadow-xs'
              }`}
            >
              <GraduationCap className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-emerald-700'}`} />
              <span>Cargar desde Google Classroom</span>
            </button>

            <button
              type="button"
              onClick={() => handleSyncRealClassroomStudents(true)}
              disabled={isSyncingRoster}
              className={`px-3.5 py-2.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 border cursor-pointer ${
                isDarkMode
                  ? 'bg-blue-600/90 hover:bg-blue-600 text-white border-blue-400/60 shadow-md shadow-blue-950/40'
                  : 'bg-white/20 hover:bg-white/30 text-white border-white/40 shadow-xs'
              }`}
              title="Sincronizar materias y estudiantes con Google Classroom"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingRoster ? 'animate-spin' : ''}`} />
              <span>{isSyncingRoster ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className={`px-3.5 py-2.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 border cursor-pointer ${
                isDarkMode
                  ? 'bg-blue-500 hover:bg-blue-400 text-white border-blue-400 shadow-md shadow-blue-950/50'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border-white/80 shadow-md'
              }`}
            >
              <Plus className="w-4 h-4 text-blue-700" />
              <span>Agregar Nueva Materia</span>
            </button>
          </div>
        </div>

        {/* Quick Teacher Metrics */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t ${
            isDarkMode ? 'border-blue-700/50' : 'border-white/20'
          }`}
        >
          <div
            className={`rounded-2xl p-3 border transition-colors ${
              isDarkMode
                ? 'bg-blue-950/60 border-blue-700/50'
                : 'bg-white/15 border-white/20 backdrop-blur-xs text-white shadow-2xs'
            }`}
          >
            <p className={`text-[11px] font-semibold ${isDarkMode ? 'text-blue-200/80' : 'text-blue-100'}`}>
              Materias a cargo
            </p>
            <p className="text-xl font-bold mt-0.5 text-white">
              {courses.length}
            </p>
          </div>
          <div
            className={`rounded-2xl p-3 border transition-colors ${
              isDarkMode
                ? 'bg-blue-950/60 border-blue-700/50'
                : 'bg-white/15 border-white/20 backdrop-blur-xs text-white shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className={`text-[11px] font-semibold ${isDarkMode ? 'text-blue-200/80' : 'text-blue-100'}`}>
                Total de Estudiantes
              </p>
              {(token || getCachedAccessToken()) && (
                <button
                  type="button"
                  onClick={() => handleSyncRealClassroomStudents(true)}
                  disabled={isSyncingRoster}
                  className="text-[10px] text-blue-200 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                  title="Sincronizar cantidad real de inscriptos desde Google Classroom"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncingRoster ? 'animate-spin' : ''}`} />
                  <span>Sincronizar</span>
                </button>
              )}
            </div>
            <p className="text-xl font-bold mt-0.5 text-white">
              {courses.reduce((acc, curr) => acc + curr.studentsCount, 0)}
            </p>
          </div>
          <div
            className={`rounded-2xl p-3 border transition-colors ${
              isDarkMode
                ? 'bg-blue-950/60 border-blue-700/50'
                : 'bg-white/15 border-white/20 backdrop-blur-xs text-white shadow-2xs'
            }`}
          >
            <p className={`text-[11px] font-semibold flex items-center gap-1.5 ${isDarkMode ? 'text-blue-200/80' : 'text-blue-100'}`}>
              <GraduationCap className="w-3.5 h-3.5 text-white" />
              Google Classroom
            </p>
            <p className="text-xl font-bold mt-0.5 flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4" /> Conectado
            </p>
          </div>
          <div
            className={`rounded-2xl p-3 border transition-colors ${
              isDarkMode
                ? 'bg-blue-950/60 border-blue-700/50'
                : 'bg-white/15 border-white/20 backdrop-blur-xs text-white shadow-2xs'
            }`}
          >
            <p className={`text-[11px] font-semibold ${isDarkMode ? 'text-blue-200/80' : 'text-blue-100'}`}>
              Google Drive
            </p>
            <p className={`text-xl font-bold mt-0.5 flex items-center gap-1.5 ${isDarkMode ? 'text-blue-300' : 'text-blue-200'}`}>
              <FolderClosed className="w-4 h-4" /> Sincronizado
            </p>
          </div>
        </div>
      </div>

      {needsRosterPermission && (
        <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs animate-in fade-in duration-200 ${
          isDarkMode ? 'bg-amber-950/40 border-amber-800/60 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-900 shadow-xs'
        }`}>
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="font-bold">Permiso de estudiantes pendiente en Google Classroom</p>
              <p className="opacity-90">
                Tu sesión actual aún no tiene concedido el permiso para leer la nómina de estudiantes. Hacé clic en autorizar para conectar el permiso y mostrar la cantidad real.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                setIsSyncingRoster(true);
                await loginWithGoogle(user?.email);
                setNeedsRosterPermission(false);
                await handleSyncRealClassroomStudents(true);
              } catch (e) {
                console.warn('Re-auth error:', e);
              } finally {
                setIsSyncingRoster(false);
              }
            }}
            disabled={isSyncingRoster}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRoster ? 'animate-spin' : ''}`} />
            <span>Autorizar y sincronizar</span>
          </button>
        </div>
      )}

      {rosterSyncMsg && (
        <div className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs animate-in fade-in duration-200 ${
          isDarkMode ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{rosterSyncMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setRosterSyncMsg(null)}
            className="text-xs hover:opacity-75 font-semibold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por materia, año o curso..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-xs transition-all shadow-2xs focus:outline-none ${
              isDarkMode
                ? 'bg-slate-900 border border-slate-700 text-white placeholder-slate-400 focus:border-blue-500'
                : 'bg-white border border-neutral-200 text-neutral-800 placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
            }`}
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Mostrando <strong>{filteredCourses.length}</strong> de {courses.length} materias
          </p>

          {/* View Mode Toggle: Cuadrícula vs Lista */}
          <div
            className={`inline-flex items-center p-1 rounded-xl border ${
              isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? isDarkMode
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'bg-white text-neutral-900 shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
              title="Vista en cuadrícula"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cuadrícula</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'list'
                  ? isDarkMode
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'bg-white text-neutral-900 shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
              title="Vista en lista (ancho completo)"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>
        </div>
      </div>

      {/* Courses Cards Grid or Empty State */}
      {courses.length === 0 ? (
        <div
          className={`rounded-3xl border-2 border-dashed p-8 sm:p-14 text-center space-y-6 max-w-2xl mx-auto transition-colors ${
            isDarkMode
              ? 'bg-slate-900/60 border-slate-800 text-slate-200'
              : 'bg-white border-neutral-200 text-neutral-800'
          }`}
        >
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ring-8 ${
            isDarkMode ? 'bg-blue-500/20 text-white ring-blue-500/10' : 'bg-blue-500/10 text-blue-500 ring-blue-500/5'
          }`}>
            <GraduationCap className={`w-8 h-8 ${isDarkMode ? 'text-white' : 'text-blue-600'}`} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-bold">Tu espacio está listo para tus materias</h3>
            <p className={`text-sm max-w-md mx-auto leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              No tienes ninguna materia de prueba cargada. Crea tus propias asignaturas o conéctate con Google Classroom para importar tus cursos y estudiantes reales:
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear mi primera materia</span>
            </button>

            {onOpenImportClassroom && (
              <button
                type="button"
                onClick={onOpenImportClassroom}
                className={`px-5 py-3 text-xs sm:text-sm font-semibold rounded-xl border flex items-center gap-2 transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-white border-emerald-800/80'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}
              >
                <GraduationCap className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-emerald-600'}`} />
                <span>Sincronizar Google Classroom</span>
              </button>
            )}

            {onRestoreDemoCourses && (
              <button
                type="button"
                onClick={onRestoreDemoCourses}
                className={`px-4 py-3 text-xs font-medium rounded-xl border flex items-center gap-1.5 transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-neutral-400" />
                <span>Restaurar materias demo</span>
              </button>
            )}
          </div>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div
          className={`p-10 text-center rounded-2xl border ${
            isDarkMode ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-white border-neutral-200 text-neutral-500'
          }`}
        >
          <p className="text-sm font-medium">No se encontraron materias con el término "{searchQuery}".</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-3 text-xs text-blue-500 hover:underline font-semibold"
          >
            Ver todas las materias
          </button>
        </div>
      ) : (
        <div className={viewMode === 'list' ? 'flex flex-col space-y-4 w-full' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
          {filteredCourses.map((course) => (
          <div
            key={course.id}
            className={`border rounded-2xl p-5 sm:p-6 transition-all flex flex-col justify-between group ${
              viewMode === 'list' ? 'w-full shadow-xs hover:shadow-md' : 'shadow-xs hover:shadow-md'
            } ${
              isDarkMode
                ? 'bg-slate-900/90 border-slate-700/80 hover:border-blue-500/60 hover:bg-slate-900'
                : 'bg-white border-neutral-200 hover:border-blue-300'
            }`}
          >
            <div className="space-y-4">
              {/* Header of the Course Card with Top Actions: Eliminar y Entrar a la materia */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                        isDarkMode
                          ? 'bg-blue-950/60 text-blue-400 border-blue-800/60'
                          : 'bg-blue-50 text-blue-700 border-blue-100'
                      }`}
                    >
                      {course.grade}
                    </span>
                    <span className={`text-xs font-medium flex items-center gap-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      <Users className="w-3.5 h-3.5 text-neutral-400" />
                      {course.studentsCount} {course.studentsCount === 1 ? 'estudiante' : 'estudiantes'}
                    </span>
                  </div>
                  <h3
                    className={`text-lg font-bold transition-colors ${
                      isDarkMode
                        ? 'text-white group-hover:text-blue-400'
                        : 'text-neutral-900 group-hover:text-blue-600'
                    }`}
                  >
                    {formatCourseSidebarLabel(course)}
                  </h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Ciclo {course.schoolYear || '2026'}
                  </p>
                </div>

                {/* Top Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCourseToDelete(course);
                    }}
                    className={`p-2 rounded-xl transition-all cursor-pointer ${
                      isDarkMode
                        ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/40'
                        : 'text-neutral-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                    title={`Eliminar ${formatCourseSidebarLabel(course)}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCourseAndTab(course.id, 'alumnos')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                      isDarkMode
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950/40'
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                    }`}
                    title="Entrar a la materia"
                  >
                    <span>Entrar a la materia</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Acciones de la Materia: Asistencia, Disposición y Notificaciones */}
              <div
                className={`border rounded-xl p-3.5 space-y-3 transition-colors ${
                  isDarkMode
                    ? 'bg-slate-950/60 border-slate-800'
                    : 'bg-neutral-50/80 border-neutral-200/80'
                }`}
              >
                <div className="space-y-1.5">
                  <p
                    className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                      isDarkMode ? 'text-blue-400' : 'text-blue-700'
                    }`}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    Gestión de Estudiantes:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    {/* Asistencia */}
                    <button
                      onClick={() => onSelectCourseAndTab(course.id, 'alumnos')}
                      className={`p-2 border rounded-lg text-left transition-all flex items-start gap-2 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700/80 hover:border-blue-500 hover:bg-slate-850'
                          : 'bg-white border-neutral-200/90 hover:border-blue-400 hover:bg-blue-50/40'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className={`font-semibold text-[11px] truncate ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>
                          Asistencia
                        </p>
                        <p className={`text-[10px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          Presentes y ausencias
                        </p>
                      </div>
                    </button>

                    {/* Disposición */}
                    <button
                      onClick={() => onSelectCourseAndTab(course.id, 'alumnos')}
                      className={`p-2 border rounded-lg text-left transition-all flex items-start gap-2 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700/80 hover:border-blue-500 hover:bg-slate-850'
                          : 'bg-white border-neutral-200/90 hover:border-blue-400 hover:bg-blue-50/40'
                      }`}
                    >
                      <Users className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className={`font-semibold text-[11px] truncate ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>
                          Disposición
                        </p>
                        <p className={`text-[10px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          Puntos & llamados
                        </p>
                      </div>
                    </button>

                    {/* Classroom & Avisos */}
                    <button
                      onClick={() => onSelectCourseAndTab(course.id, 'alumnos')}
                      className={`p-2 border rounded-lg text-left transition-all flex items-start gap-2 cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700/80 hover:border-blue-500 hover:bg-slate-850'
                          : 'bg-white border-neutral-200/90 hover:border-blue-400 hover:bg-blue-50/40'
                      }`}
                    >
                      <Mail className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className={`font-semibold text-[11px] truncate ${isDarkMode ? 'text-slate-200' : 'text-neutral-800'}`}>
                          Classroom & Mail
                        </p>
                        <p className={`text-[10px] truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          Tablón y avisos Gmail
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Action - Google Classroom Vinculado y botón Sincronizar por materia */}
            <div className={`pt-3.5 mt-3 border-t flex items-center justify-between gap-2 ${
              isDarkMode ? 'border-slate-800' : 'border-neutral-100'
            }`}>
              <span className={`text-[11px] font-medium flex items-center gap-1.5 ${
                isDarkMode ? 'text-slate-300' : 'text-neutral-500'
              }`}>
                <GraduationCap className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white' : 'text-emerald-600'}`} />
                Google Classroom Vinculado
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSyncSingleCourse(course);
                }}
                disabled={syncingCourseId === course.id}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                    : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 border-neutral-200'
                }`}
                title={`Sincronizar ${course.name} con Google Classroom`}
              >
                <RefreshCw className={`w-3 h-3 ${syncingCourseId === course.id ? 'animate-spin text-blue-500' : ''}`} />
                <span>{syncingCourseId === course.id ? 'Sincronizando...' : 'Sincronizar'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Modal: Create New Course */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-8 max-w-md w-full border shadow-2xl space-y-6 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Agregar Nueva Materia</h2>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Registra una nueva cátedra para habilitar su planificación, material, actividades y evaluaciones.
              </p>
            </div>

            {onOpenImportClassroom && (
              <div
                onClick={() => {
                  setIsCreateModalOpen(false);
                  onOpenImportClassroom();
                }}
                className={`p-3 rounded-2xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                  isDarkMode
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300 hover:bg-emerald-950/70'
                    : 'bg-emerald-50/90 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold">¿Tienes las materias en Google Classroom?</p>
                    <p className="text-[11px] opacity-85">Impórtalas automáticamente o pegando tu lista</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className={`text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Nombre de la Materia
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Historia Universal y Contemporánea"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs transition-all focus:outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                      : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Nivel / Año
                  </label>
                  <select
                    value={newCourseGrade}
                    onChange={(e) => setNewCourseGrade(e.target.value)}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs transition-all focus:outline-none ${
                      isDarkMode
                        ? 'bg-slate-800 border border-slate-700 text-white focus:border-blue-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  >
                    <option value="Secundaria - 1° Año">Secundaria - 1° Año</option>
                    <option value="Secundaria - 2° Año">Secundaria - 2° Año</option>
                    <option value="Secundaria - 3° Año">Secundaria - 3° Año</option>
                    <option value="Secundaria - 4° Año">Secundaria - 4° Año</option>
                    <option value="Secundaria - 5° Año">Secundaria - 5° Año</option>
                    <option value="Secundaria - 6° Año">Secundaria - 6° Año</option>
                    <option value="Nivel Superior / Terciario">Nivel Superior / Terciario</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                    Cantidad Estudiantes
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newCourseStudents}
                    onChange={(e) => setNewCourseStudents(Number(e.target.value))}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs transition-all focus:outline-none ${
                      isDarkMode
                        ? 'bg-slate-800 border border-slate-700 text-white focus:border-blue-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={`text-xs font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Área de Conocimiento
                </label>
                <input
                  type="text"
                  placeholder="Ej: Ciencias Sociales / Biología / Exactas"
                  value={newCourseSubject}
                  onChange={(e) => setNewCourseSubject(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs transition-all focus:outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                      : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                  }`}
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className={`px-4 py-2 text-xs font-medium rounded-xl transition-all ${
                    isDarkMode
                      ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all"
                >
                  Crear Materia
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Course */}
      {courseToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-8 max-w-md w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                isDarkMode
                  ? 'bg-red-950/60 text-red-400 border-red-900/60'
                  : 'bg-red-50 text-red-600 border-red-100'
              }`}
            >
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold">¿Eliminar esta materia?</h3>
              <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                Estás a punto de eliminar la cátedra{' '}
                <strong className={isDarkMode ? 'text-white' : 'text-neutral-900'}>{formatCourseSidebarLabel(courseToDelete)}</strong>. Esta acción la desvinculará de tu panel docente activo.
              </p>
            </div>

            <div
              className={`rounded-xl p-3 border text-xs space-y-1 ${
                isDarkMode
                  ? 'bg-slate-800/80 border-slate-700 text-slate-300'
                  : 'bg-neutral-50 border-neutral-200/80 text-neutral-600'
              }`}
            >
              <p>• Asignatura: <strong>{courseToDelete.subject}</strong></p>
              <p>• Ciclo: <strong>{courseToDelete.schoolYear || '2026'}</strong></p>
              <p>• Estudiantes inscritos: <strong>{courseToDelete.studentsCount}</strong></p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setCourseToDelete(null)}
                className={`px-4 py-2 text-xs font-medium rounded-xl transition-all ${
                  isDarkMode
                    ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (!courseToDelete) return;
                  setIsDeleting(true);
                  try {
                    await onDeleteCourse(courseToDelete.id);
                    setCourseToDelete(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Eliminando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Sí, eliminar materia</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Import Real Subjects (Google Classroom & Quick Bulk) */}
      <ImportClassroomModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingCourses={courses}
        onSuccess={(message) => {
          if (onImportSuccess) {
            onImportSuccess(message);
          } else if (onRefreshData) {
            onRefreshData();
          }
        }}
      />
    </div>
  );
};
