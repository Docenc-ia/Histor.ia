import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import {
  Menu,
  Search,
  Grid,
  ExternalLink,
  LogOut,
  RefreshCw,
  X,
  Moon,
  Sun,
  User,
  Cloud,
  Download,
  Database,
  Smartphone,
  Eye,
  EyeOff,
  Users,
  GraduationCap,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { useGlobalData } from '../../context/GlobalDataContext';
import { OwlLogoIcon } from '../common/OwlLogoIcon';
import { CloudSyncStatusInfo } from '../../services/firestoreSync';
import { syncCoordinator } from '../../services/syncCoordinator';
import { subscribePiiMaskState, toggleManualPiiMask } from '../common/PiiPrivacyShield';
import { getRemovedStudentIds } from '../../services/api';
import { useNavigationService } from '../../services/navigationService';

const HeaderSystemModals = lazy(() =>
  import('./HeaderSystemModals').then((m) => ({ default: m.HeaderSystemModals }))
);

interface HeaderProps {
  onToggleSidebar: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNavigate: (tab: string, filterCourseId?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  searchQuery,
  onSearchChange,
  onNavigate,
}) => {
  const {
    user,
    mode,
    logout,
    loginWithGoogle,
    isDarkMode,
    toggleDarkMode,
    updateUserProfile,
  } = useWorkspaceAuth();
  const {
    courses: globalCourses,
    students: globalStudents,
    loadData: refreshGlobalData,
  } = useGlobalData();

  const { selectedCourseId } = useNavigationService();
  const [showAppsMenu, setShowAppsMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const appsMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isFullBackupOpen, setIsFullBackupOpen] = useState(false);

  const normalizeSearch = (val: string) =>
    (val || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const cleanSearchQuery = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);

  const globalStudentMatches = useMemo(() => {
    if (cleanSearchQuery.length < 2) return [];
    const tokens = cleanSearchQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const courseById = new Map<string, (typeof globalCourses)[number]>();
    for (const c of globalCourses) {
      if (c?.id) courseById.set(c.id, c);
      if (c?.classroomCourseId) courseById.set(c.classroomCourseId, c);
    }

    const removedCache = new Map<string, Set<string>>();
    const seenKeys = new Set<string>();
    const results: Array<{
      student: (typeof globalStudents)[number];
      course?: (typeof globalCourses)[number];
    }> = [];

    for (const st of globalStudents) {
      if (!st) continue;
      if (st.courseId) {
        let removedSet = removedCache.get(st.courseId);
        if (!removedSet) {
          removedSet = getRemovedStudentIds(st.courseId);
          removedCache.set(st.courseId, removedSet);
        }
        if (removedSet.has(st.id)) continue;
      }

      const fullText = normalizeSearch(
        `${st.firstName || ''} ${st.lastName || ''} ${st.lastName || ''} ${st.firstName || ''} ${st.email || ''}`
      );
      const matchesAll = tokens.every((tk) => fullText.includes(tk));
      if (!matchesAll) continue;

      const matchedCourse = st.courseId ? courseById.get(st.courseId) : undefined;
      const dedupKey = `${matchedCourse?.id || st.courseId || 'none'}::${st.id}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      results.push({ student: st, course: matchedCourse });
    }

    results.sort((a, b) => {
      const nameA = `${a.student.lastName || ''} ${a.student.firstName || ''}`.trim();
      const nameB = `${b.student.lastName || ''} ${b.student.firstName || ''}`.trim();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });

    return results;
  }, [globalStudents, globalCourses, cleanSearchQuery]);

  const globalCourseMatches = useMemo(() => {
    if (cleanSearchQuery.length < 2) return [];
    return globalCourses
      .filter((c) => {
        const hay = normalizeSearch(
          `${c.name || ''} ${c.subject || ''} ${c.grade || ''} ${c.division || ''} ${c.section || ''}`
        );
        return hay.includes(cleanSearchQuery);
      })
      .slice(0, 6);
  }, [globalCourses, cleanSearchQuery]);

  useEffect(() => {
    if (!showAppsMenu && !showProfileMenu && !isSearchDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (showAppsMenu && appsMenuRef.current && target && !appsMenuRef.current.contains(target)) {
        setShowAppsMenu(false);
      }
      if (
        showProfileMenu &&
        profileMenuRef.current &&
        target &&
        !profileMenuRef.current.contains(target)
      ) {
        setShowProfileMenu(false);
      }
      if (
        isSearchDropdownOpen &&
        searchContainerRef.current &&
        target &&
        !searchContainerRef.current.contains(target)
      ) {
        setIsSearchDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAppsMenu(false);
        setShowProfileMenu(false);
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAppsMenu, showProfileMenu, isSearchDropdownOpen]);

  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatusInfo>({
    state: 'synced',
    lastSyncedAt: null,
    pendingCount: 0,
  });
  const [isManualSyncingCloud, setIsManualSyncingCloud] = useState(false);
  const [isPiiMasked, setIsPiiMasked] = useState(false);

  useEffect(() => {
    return subscribePiiMaskState((masked) => {
      setIsPiiMasked(masked);
    });
  }, []);

  useEffect(() => {
    return syncCoordinator.subscribeStatus((status) => {
      setCloudStatus(status);
    });
  }, []);

  // PWA Install Prompt State
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      setIsAppInstalled(isStandalone);

      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        setDeferredInstallPrompt(e);
      };

      const handleAppInstalled = () => {
        setIsAppInstalled(true);
        setDeferredInstallPrompt(null);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstall);
      window.addEventListener('appinstalled', handleAppInstalled);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
        window.removeEventListener('appinstalled', handleAppInstalled);
      };
    }
  }, []);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setIsAppInstalled(true);
        setDeferredInstallPrompt(null);
      }
    } catch (_) {}
  };

  // Listen for custom event to open full backup modal from anywhere
  useEffect(() => {
    const handleOpenFullBackup = () => setIsFullBackupOpen(true);
    window.addEventListener('docencia_open_full_backup', handleOpenFullBackup);
    return () => window.removeEventListener('docencia_open_full_backup', handleOpenFullBackup);
  }, []);

  const handleManualCloudResync = async () => {
    if (isManualSyncingCloud) return;
    setIsManualSyncingCloud(true);
    try {
      await syncCoordinator.resyncAllToCloud({
        courses: globalCourses,
        students: globalStudents,
        onRefreshData: refreshGlobalData,
      });
    } catch (_) {
    } finally {
      setIsManualSyncingCloud(false);
    }
  };

  const googleApps = [
    { name: 'Google Classroom', icon: '🎓', tab: 'classroom_sync', desc: 'Sincronizar y Alumnos' },
    { name: 'Gmail', icon: '✉️', tab: 'classes', desc: 'Avisos y Notificaciones' },
    { name: 'Google Sheets', icon: '📊', tab: 'classes', desc: 'Planilla de Asistencia' },
    { name: 'Google Calendar', icon: '📅', tab: 'calendar', desc: 'Horarios de Clases' },
  ];

  return (
    <header
      className={`sticky top-0 z-40 flex items-center justify-between h-16 px-4 border-b transition-colors ${
        isDarkMode
          ? 'bg-[#10172A]/95 border-slate-800 text-white backdrop-blur-md'
          : 'bg-white border-neutral-200 text-neutral-900'
      }`}
    >
      {/* Left: Brand & Sidebar toggle */}
      <div className="flex items-center gap-3 min-w-[240px]">
        <button
          onClick={onToggleSidebar}
          className={`p-2 rounded-full transition-colors ${
            isDarkMode
              ? 'text-slate-300 hover:bg-slate-800 active:bg-slate-700'
              : 'text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200'
          }`}
          title="Menú lateral"
          aria-label="Alternar barra lateral"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate('courses')}>
          <OwlLogoIcon
            size={40}
            useVideo={true}
            usePhoto={false}
            className="w-10 h-10 rounded-xl shadow-md ring-2 ring-blue-500/40"
          />
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center">
              <div
                className={`px-2.5 py-0.5 rounded-lg border shadow-xs flex items-baseline justify-center transition-colors ${
                  isDarkMode
                    ? 'bg-blue-950/40 border-blue-500/30'
                    : 'bg-[#EFF6FF] border-[#BFDBFE]'
                }`}
              >
                <span className="font-dancing text-xl font-bold tracking-normal text-[#3b82f6] leading-none inline-block">
                  Docenc.
                </span>
                <span
                  className={`font-space text-base font-bold tracking-tight lowercase leading-none -ml-0.5 ${
                    isDarkMode ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  ia
                </span>
              </div>
            </div>
            <span
              className={`text-[10px] tracking-wide font-medium mt-1 leading-none text-center w-full ${
                isDarkMode ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Gestor de Clase
            </span>
          </div>
        </div>
      </div>

      {/* Middle: Global Student & Course Search Bar */}
      <div className="flex-1 max-w-2xl mx-4 hidden md:flex items-center">
        <div className="relative flex items-center w-full" ref={searchContainerRef}>
          <Search className="absolute left-3.5 w-4 h-4 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onFocus={() => {
              if (cleanSearchQuery.length >= 2) {
                setIsSearchDropdownOpen(true);
              }
            }}
            onChange={(e) => {
              const val = e.target.value;
              onSearchChange(val);
              setIsSearchDropdownOpen(normalizeSearch(val).length >= 2);
            }}
            placeholder="Buscar cualquier alumno cargado o materia..."
            className={`w-full h-10 pl-10 pr-10 text-xs rounded-xl border transition-all focus:outline-none ${
              isDarkMode
                ? 'bg-slate-900/90 text-white placeholder-slate-400 border-slate-700 focus:border-blue-500 focus:bg-slate-900'
                : 'bg-[#edf2fc] hover:bg-[#e4ebf8] focus:bg-white text-neutral-800 placeholder-neutral-500 border-transparent focus:border-blue-400 focus:shadow-sm'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                setIsSearchDropdownOpen(false);
              }}
              className="absolute right-3 p-1 text-neutral-400 hover:text-neutral-600 rounded-full cursor-pointer"
              title="Limpiar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Dropdown de resultados globales de alumnos y materias */}
          {isSearchDropdownOpen && cleanSearchQuery.length >= 2 && (
            <div
              className={`absolute left-0 right-0 top-full mt-2 rounded-2xl border shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : 'bg-white border-neutral-200 text-neutral-900'
              }`}
            >
              <div className="max-h-96 overflow-y-auto divide-y divide-neutral-100 dark:divide-slate-800">
                {/* Alumnos en todas las materias */}
                <div className="p-2.5">
                  <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-500" />
                      <span>Alumnos encontrados ({globalStudentMatches.length})</span>
                    </span>
                    <span className="normal-case font-normal text-[10px]">
                      Todas tus materias
                    </span>
                  </div>

                  {globalStudentMatches.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-neutral-500 dark:text-slate-400">
                      No se encontraron alumnos que coincidan con &ldquo;{searchQuery.trim()}&rdquo;.
                    </p>
                  ) : (
                    <div className="mt-1 space-y-1">
                      {globalStudentMatches.slice(0, 25).map(({ student: st, course: matchedCourse }) => {
                        const targetCourseId = matchedCourse?.id || st.courseId || '';
                        const isCurrentCourse = Boolean(selectedCourseId && targetCourseId === selectedCourseId);
                        return (
                          <button
                            key={`${targetCourseId || 'none'}::${st.id}`}
                            type="button"
                            onClick={() => {
                              try {
                                sessionStorage.setItem('docencia_focus_student_id', st.id);
                                sessionStorage.setItem(
                                  'docencia_focus_student_name',
                                  `${st.lastName || ''} ${st.firstName || ''}`.trim()
                                );
                              } catch (_) {}
                              setIsSearchDropdownOpen(false);
                              onSearchChange('');
                              if (targetCourseId) {
                                onNavigate('course_detail', targetCourseId);
                              }
                              setTimeout(() => {
                                window.dispatchEvent(
                                  new CustomEvent('docencia_focus_student', {
                                    detail: { studentId: st.id, courseId: targetCourseId },
                                  })
                                );
                              }, 0);
                            }}
                            className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                              isDarkMode
                                ? 'hover:bg-slate-800 text-slate-100'
                                : 'hover:bg-blue-50/70 text-neutral-900'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                data-pii="student"
                                className="w-7 h-7 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400 font-bold text-[11px] flex items-center justify-center shrink-0"
                              >
                                {(st.lastName?.[0] || st.firstName?.[0] || 'E').toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p data-pii="student" className="text-xs font-bold truncate">
                                  {st.lastName ? `${st.lastName}, ${st.firstName}` : st.firstName}
                                </p>
                                {st.email && (
                                  <p
                                    data-pii="student"
                                    className="text-[10px] text-neutral-500 dark:text-slate-400 truncate"
                                  >
                                    {st.email}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border max-w-[180px] truncate ${
                                  isCurrentCourse
                                    ? isDarkMode
                                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : isDarkMode
                                    ? 'bg-blue-950/60 text-blue-300 border-blue-800/60'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}
                              >
                                <GraduationCap className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  {matchedCourse ? matchedCourse.name : 'Materia asignada'}
                                </span>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      {globalStudentMatches.length > 25 && (
                        <p className="px-2 py-1 text-[10px] text-neutral-400 text-center">
                          Mostrando 25 de {globalStudentMatches.length} alumnos. Escribí apellido y nombre para acotar.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Materias coincidentes */}
                {globalCourseMatches.length > 0 && (
                  <div className="p-2.5">
                    <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Materias ({globalCourseMatches.length})</span>
                    </div>
                    <div className="mt-1 space-y-1">
                      {globalCourseMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setIsSearchDropdownOpen(false);
                            onSearchChange('');
                            onNavigate('course_detail', c.id);
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer text-xs ${
                            isDarkMode
                              ? 'hover:bg-slate-800 text-slate-200'
                              : 'hover:bg-indigo-50/70 text-neutral-800'
                          }`}
                        >
                          <span className="font-semibold truncate">{c.name}</span>
                          {c.schedule && (
                            <span className="text-[10px] text-neutral-400 shrink-0">{c.schedule}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Cloud Sync Indicator, Full Backup, Dark Mode Toggle & Profile */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Cloud Backup Status & Quick Manual Sync */}
        <div
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
            cloudStatus.state === 'syncing' || isManualSyncingCloud
              ? isDarkMode
                ? 'bg-blue-950/50 border-blue-800 text-blue-300'
                : 'bg-blue-50 border-blue-200 text-blue-700'
              : cloudStatus.state === 'error' || cloudStatus.state === 'offline'
              ? isDarkMode
                ? 'bg-amber-950/50 border-amber-800 text-amber-300'
                : 'bg-amber-50 border-amber-200 text-amber-700'
              : isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
          title={
            cloudStatus.state === 'offline'
              ? 'Sin conexión a internet: tus cambios se guardan en el dispositivo y se sincronizarán apenas vuelva la red.'
              : cloudStatus.lastSyncedAt
              ? `Respaldo en Firestore activo (última sincronización: ${cloudStatus.lastSyncedAt}). Hacé clic en el ícono de recarga para forzar sincronización.`
              : 'Sincronizado automáticamente con Firebase Firestore'
          }
        >
          <Cloud className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">
            {cloudStatus.state === 'syncing' || isManualSyncingCloud
              ? 'Sincronizando nube...'
              : cloudStatus.state === 'offline'
              ? 'Guardado local (sin red)'
              : `Guardado en la nube${cloudStatus.lastSyncedAt ? ` (${cloudStatus.lastSyncedAt})` : ''}`}
          </span>
          <button
            type="button"
            onClick={handleManualCloudResync}
            disabled={isManualSyncingCloud}
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="Sincronizar ahora mismo con la nube"
          >
            <RefreshCw
              className={`w-3 h-3 ${
                cloudStatus.state === 'syncing' || isManualSyncingCloud ? 'animate-spin' : ''
              }`}
            />
          </button>
        </div>

        {/* PWA Install Button */}
        {deferredInstallPrompt && !isAppInstalled && (
          <button
            type="button"
            onClick={handleInstallApp}
            className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold shadow-2xs transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-indigo-950/60 hover:bg-indigo-900/70 border-indigo-700/60 text-indigo-200'
                : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
            }`}
            title="Instalar Docenc.ia como aplicación nativa en tu dispositivo (Windows, Mac o móvil)"
          >
            <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
            <span>Instalar App</span>
          </button>
        )}

        {/* 1-Click Full Backup Button */}
        <button
          type="button"
          onClick={() => setIsFullBackupOpen(true)}
          className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
            isDarkMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-indigo-300'
              : 'bg-indigo-50/80 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
          }`}
          title="Copia de seguridad completa de tu cuenta en 1 clic (JSON / Excel)"
        >
          <Database className="w-4 h-4" />
          <span className="hidden xl:inline text-[11px]">Respaldo</span>
        </button>

        {/* ISO/IEC 27001 A.7.7 & A.8.11: Classroom Privacy / Projector Mode Toggle */}
        <button
          type="button"
          data-pii-toggle="true"
          onClick={() => toggleManualPiiMask()}
          className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
            isPiiMasked
              ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-500 text-white shadow-xs'
              : isDarkMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
              : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-200 text-slate-700'
          }`}
          title={
            isPiiMasked
              ? 'Privacidad activa: Datos ocultos. Volvé a hacer clic aquí para desactivarla (Atajo: Alt + P)'
              : 'Activar Privacidad: oculta nombres, correos y calificaciones hasta que vuelvas a hacer clic aquí (Atajo: Alt + P)'
          }
          aria-label="Alternar modo privacidad de estudiantes"
        >
          {isPiiMasked ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          <span className="hidden xl:inline text-[11px]">
            {isPiiMasked ? 'Datos Ocultos' : 'Privacidad'}
          </span>
        </button>

        {/* Dark / Light Mode Toggle Button */}
        <button
          onClick={toggleDarkMode}
          className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-medium ${
            isDarkMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300'
              : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-200 text-slate-700'
          }`}
          title={isDarkMode ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
          aria-label="Alternar modo oscuro"
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
          <span className="hidden xl:inline text-[11px]">
            {isDarkMode ? 'Modo Claro' : 'Modo Oscuro'}
          </span>
        </button>

        {/* 9 Dots Google Apps Launcher */}
        <div className="relative" ref={appsMenuRef}>
          <button
            onClick={() => {
              setShowAppsMenu(!showAppsMenu);
              setShowProfileMenu(false);
            }}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-full transition-colors"
            title="Aplicaciones de Google Workspace"
          >
            <Grid className="w-5 h-5" />
          </button>

          {showAppsMenu && (
            <div
              className={`absolute right-0 top-full mt-4 sm:mt-5 w-72 p-3 rounded-2xl shadow-xl border z-50 animate-in fade-in zoom-in-95 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : 'bg-white border-neutral-200 text-neutral-800'
              }`}
            >
              <div
                className={`flex items-center justify-between pb-2 mb-2 border-b ${
                  isDarkMode ? 'border-slate-800' : 'border-neutral-100'
                }`}
              >
                <span
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                  }`}
                >
                  Herramientas Vinculadas
                </span>
                <span className="text-[11px] text-emerald-500 font-medium">Activas</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {googleApps.map((app) => (
                  <button
                    key={app.name}
                    onClick={() => {
                      onNavigate(app.tab);
                      setShowAppsMenu(false);
                    }}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center ${
                      isDarkMode
                        ? 'hover:bg-slate-800 border-transparent hover:border-slate-700'
                        : 'hover:bg-neutral-50 border-transparent hover:border-neutral-200'
                    }`}
                  >
                    <span className="text-2xl mb-1">{app.icon}</span>
                    <span
                      className={`text-xs font-medium ${
                        isDarkMode ? 'text-slate-100' : 'text-neutral-800'
                      }`}
                    >
                      {app.name}
                    </span>
                    <span
                      className={`text-[10px] truncate max-w-full ${
                        isDarkMode ? 'text-slate-400' : 'text-neutral-400'
                      }`}
                    >
                      {app.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Logout Quick Button */}
        <button
          onClick={logout}
          className={`hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl transition-colors border ${
            isDarkMode
              ? 'text-slate-300 hover:text-red-400 hover:bg-red-950/40 border-slate-700'
              : 'text-neutral-600 hover:text-red-600 hover:bg-red-50 border-neutral-200'
          }`}
          title="Cerrar sesión y volver a la página de bienvenida Docenc.ia"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Salir</span>
        </button>

        {/* Teacher Profile */}
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowAppsMenu(false);
            }}
            className={`flex items-center gap-2 p-1 rounded-full transition-colors ${
              isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-neutral-100'
            }`}
          >
            <img
              src={
                user?.avatar && !user.avatar.includes('photo-1534528741775')
                  ? user.avatar
                  : `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || user?.email || 'Docente')}&background=1d4ed8&color=ffffff&bold=true&size=150`
              }
              alt={user?.name || 'Docente'}
              className={`w-8 h-8 rounded-full object-cover border ${
                isDarkMode ? 'border-slate-600' : 'border-neutral-300'
              }`}
            />
          </button>

          {showProfileMenu && (
            <div
              className={`absolute right-0 top-full mt-4 sm:mt-5 w-80 p-4 rounded-2xl shadow-2xl border z-50 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : 'bg-white border-neutral-200 text-neutral-800'
              }`}
            >
              <div
                className={`flex items-center gap-3 pb-3 border-b ${
                  isDarkMode ? 'border-slate-800' : 'border-neutral-100'
                }`}
              >
                <img
                  src={
                    user?.avatar && !user.avatar.includes('photo-1534528741775')
                      ? user.avatar
                      : `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || user?.email || 'Docente')}&background=1d4ed8&color=ffffff&bold=true&size=150`
                  }
                  alt={user?.name || 'Docente'}
                  className={`w-12 h-12 rounded-full object-cover border ${
                    isDarkMode ? 'border-slate-700' : 'border-neutral-200'
                  }`}
                />
                <div className="overflow-hidden">
                  <h3
                    className={`text-sm font-semibold truncate ${
                      isDarkMode ? 'text-white' : 'text-neutral-800'
                    }`}
                  >
                    {user?.name}
                  </h3>
                  <p
                    className={`text-xs truncate ${
                      isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                    }`}
                  >
                    {user?.email}
                  </p>
                  <span
                    className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded font-medium ${
                      isDarkMode
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {user?.school}
                  </span>
                </div>
              </div>

              <div className="py-2.5 space-y-1 text-xs">
                <div
                  className={`flex items-center justify-between py-1 px-2 rounded-lg ${
                    isDarkMode ? 'bg-slate-800' : 'bg-neutral-50'
                  }`}
                >
                  <span className={isDarkMode ? 'text-slate-400' : 'text-neutral-500'}>
                    Modo de Operación:
                  </span>
                  <span className="font-semibold text-blue-500 capitalize">{mode}</span>
                </div>

                <button
                  onClick={() => {
                    setIsEditProfileOpen(true);
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-slate-200 hover:bg-slate-800'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-blue-500" />
                    <span>Editar datos del docente</span>
                  </span>
                </button>

                <button
                  onClick={() => {
                    loginWithGoogle();
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-blue-300 hover:bg-slate-800'
                      : 'text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  <span className="font-semibold">Conectar / Cambiar cuenta Google</span>
                  <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                </button>

                <button
                  onClick={() => {
                    setIsFullBackupOpen(true);
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-indigo-300 hover:bg-slate-800'
                      : 'text-indigo-700 hover:bg-indigo-50'
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Database className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Copia de Seguridad Completa (1 clic)</span>
                  </span>
                  <Download className="w-3.5 h-3.5 text-indigo-500" />
                </button>

                <button
                  onClick={() => {
                    onNavigate('settings');
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-slate-200 hover:bg-slate-800'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span>Configuración de Scopes & APIs</span>
                  <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
                </button>

                {deferredInstallPrompt && !isAppInstalled && (
                  <button
                    onClick={() => {
                      handleInstallApp();
                      setShowProfileMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors font-medium ${
                      isDarkMode
                        ? 'text-indigo-300 hover:bg-slate-800'
                        : 'text-indigo-700 hover:bg-indigo-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Instalar Docenc.ia como App</span>
                    </span>
                    <Download className="w-3.5 h-3.5 text-indigo-500" />
                  </button>
                )}
              </div>

              <div
                className={`pt-2 border-t ${
                  isDarkMode ? 'border-slate-800' : 'border-neutral-100'
                }`}
              >
                <button
                  onClick={() => {
                    logout();
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-red-400 hover:bg-red-950/40'
                      : 'text-red-600 hover:bg-red-50'
                  }`}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Cerrar Sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lazy-Loaded System Modals (Backup & Profile Editor) */}
      {(isFullBackupOpen || isEditProfileOpen) && (
        <Suspense fallback={null}>
          <HeaderSystemModals
            isDarkMode={isDarkMode}
            user={user}
            courses={globalCourses}
            students={globalStudents}
            cloudStatus={cloudStatus}
            isManualSyncingCloud={isManualSyncingCloud}
            onManualCloudResync={handleManualCloudResync}
            isFullBackupOpen={isFullBackupOpen}
            onCloseFullBackup={() => setIsFullBackupOpen(false)}
            isEditProfileOpen={isEditProfileOpen}
            onCloseEditProfile={() => setIsEditProfileOpen(false)}
            onUpdateUserProfile={updateUserProfile}
          />
        </Suspense>
      )}
    </header>
  );
};
