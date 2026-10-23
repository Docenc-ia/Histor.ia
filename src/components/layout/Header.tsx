import React, { useState, useEffect, useRef } from 'react';
import {
  Menu,
  Search,
  Grid,
  Bell,
  ExternalLink,
  LogOut,
  RefreshCw,
  X,
  Moon,
  Sun,
  Sparkles,
  User,
  Check,
  Cloud,
  Download,
  Upload,
  Database,
  FileSpreadsheet,
  ShieldCheck,
  Share2,
  Smartphone,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { OwlLogoIcon } from '../common/OwlLogoIcon';
import { TeacherGuideModal } from '../common/TeacherGuideModal';
import {
  subscribeToCloudSyncStatus,
  CloudSyncStatusInfo,
  firestoreSync,
  getActiveUserId,
  isPrimaryOwnerAccount,
  flushAllPendingCloudSaves,
} from '../../services/firestoreSync';
import {
  api,
  getUserStorageKey,
  saveLocalCourses,
  saveLocalStudents,
  saveAllDispositionStorage,
} from '../../services/api';
import { exportCourseDispositionToExcel } from '../../utils/excelExport';

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
  const { user, mode, setMode, logout, loginWithGoogle, isDarkMode, toggleDarkMode, updateUserProfile } = useWorkspaceAuth();
  const [showAppsMenu, setShowAppsMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isFullBackupOpen, setIsFullBackupOpen] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [isRestoringFullBackup, setIsRestoringFullBackup] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatusInfo>({
    state: 'synced',
    lastSyncedAt: null,
    pendingCount: 0,
  });
  const [isManualSyncingCloud, setIsManualSyncingCloud] = useState(false);

  const [editName, setEditName] = useState(user?.name || '');
  const [editSchool, setEditSchool] = useState(user?.school || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    const unsub = subscribeToCloudSyncStatus((status) => {
      setCloudStatus(status);
    });
    return unsub;
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
      flushAllPendingCloudSaves();
      const uid = getActiveUserId();
      const localCourses = api.getLocalCourses();
      const localStudents = api.getLocalStudents();
      if (uid && localCourses.length > 0) {
        await firestoreSync.saveCourses(uid, localCourses);
      }
      if (uid && localStudents.length > 0) {
        const byCourse = new Map<string, typeof localStudents>();
        localStudents.forEach((s) => {
          if (!s.courseId) return;
          const list = byCourse.get(s.courseId) || [];
          list.push(s);
          byCourse.set(s.courseId, list);
        });
        for (const [cid, list] of byCourse.entries()) {
          await firestoreSync.saveStudents(uid, cid, list);
        }
      }
      // Sync student observations map to Firestore
      if (uid) {
        try {
          const rawObs =
            localStorage.getItem(getUserStorageKey('fds_student_observations')) ||
            (isPrimaryOwnerAccount() ? localStorage.getItem('fds_student_observations') : null);
          if (rawObs) {
            const obsMap = JSON.parse(rawObs);
            if (obsMap && typeof obsMap === 'object') {
              await firestoreSync.saveStudentObservationsMap(uid, obsMap);
            }
          }
        } catch (_) {}
      }
      window.dispatchEvent(new Event('docencia_trigger_queue_flush'));
      await Promise.all([api.getCourses(), api.getStudents()]);
      window.dispatchEvent(new Event('docencia_student_status_updated'));
    } catch (_) {
    } finally {
      setIsManualSyncingCloud(false);
    }
  };

  // Export complete school-year backup in 1 click (JSON) isolated to active teacher
  const handleDownloadFullBackupJson = () => {
    try {
      flushAllPendingCloudSaves();
      const uid = getActiveUserId();
      const isOwner = isPrimaryOwnerAccount();
      const courses = api.getLocalCourses();
      const students = api.getLocalStudents();
      const dispStorage = api.getAllDispositionStorage();
      let disposition2c: Record<string, any> = {};
      try {
        const raw2c =
          localStorage.getItem(getUserStorageKey('fds_disposition_data_2c')) ||
          (isOwner ? localStorage.getItem('fds_disposition_data_2c') : null);
        if (raw2c) disposition2c = JSON.parse(raw2c);
      } catch (_) {}

      const allLocalStorageKeys: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('fds_') || key.startsWith('docencia_')) &&
          !key.includes('token')
        ) {
          // Only include keys belonging to this teacher (or un-suffixed keys if primary owner)
          const belongsToTeacher = uid
            ? key.endsWith(`_${uid}`) || (isOwner && !key.includes('_usr_'))
            : true;
          if (!belongsToTeacher) continue;
          try {
            const raw = localStorage.getItem(key);
            allLocalStorageKeys[key] = raw ? JSON.parse(raw) : raw;
          } catch {
            allLocalStorageKeys[key] = localStorage.getItem(key);
          }
        }
      }

      const payload = {
        app: 'Docenc.ia - Respaldo Integral del Ciclo Lectivo',
        version: '3.1',
        exportedAt: new Date().toISOString(),
        formattedDate: new Date().toLocaleString('es-AR'),
        teacher: {
          uid: uid || '',
          name: user?.name || 'Docente',
          email: user?.email || '',
          school: user?.school || '',
        },
        courses,
        students,
        disposition: dispStorage.disposition,
        disposition2c,
        history: dispStorage.history,
        settingsAndGradesSnapshot: allLocalStorageKeys,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `Respaldo_Completo_DocencIA_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupFeedback('✓ Copia de seguridad completa (.json) descargada con éxito.');
      setTimeout(() => setBackupFeedback(null), 5000);
    } catch (err: any) {
      setBackupFeedback('Error al generar el archivo de respaldo.');
    }
  };

  // Export unified Excel summary across courses in 1 click
  const handleDownloadFullExcelSummary = () => {
    try {
      const isOwner = isPrimaryOwnerAccount();
      const courses = api.getLocalCourses();
      const students = api.getLocalStudents();
      const dispStorage = api.getAllDispositionStorage();
      let disp2c: Record<string, any> = {};
      try {
        const raw2c =
          localStorage.getItem(getUserStorageKey('fds_disposition_data_2c')) ||
          (isOwner ? localStorage.getItem('fds_disposition_data_2c') : null);
        if (raw2c) disp2c = JSON.parse(raw2c);
      } catch (_) {}

      if (courses.length === 0) {
        setBackupFeedback('No hay materias cargadas para exportar a Excel.');
        return;
      }

      exportCourseDispositionToExcel(
        'Todas_Las_Materias_Ciclo_2026',
        students,
        dispStorage.disposition || {},
        disp2c
      );
      setBackupFeedback('✓ Planilla Excel unificada descargada con éxito.');
      setTimeout(() => setBackupFeedback(null), 5000);
    } catch (err) {
      setBackupFeedback('Error al exportar planilla Excel.');
    }
  };

  // Restore full backup from JSON file and sync to Firestore under the active teacher's account
  const handleRestoreFullBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRestoringFullBackup(true);
    setBackupFeedback(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const data = JSON.parse(content);
        if (!data || typeof data !== 'object' || (!data.courses && !data.settingsAndGradesSnapshot)) {
          throw new Error('El archivo seleccionado no es un respaldo válido de Docenc.ia.');
        }

        const uid = getActiveUserId();
        const oldUid = data?.teacher?.uid ? String(data.teacher.uid) : '';

        if (data.settingsAndGradesSnapshot && typeof data.settingsAndGradesSnapshot === 'object') {
          for (const [k, v] of Object.entries(data.settingsAndGradesSnapshot)) {
            if (k.startsWith('fds_') || k.startsWith('docencia_')) {
              let targetKey = k;
              if (uid) {
                if (oldUid && k.endsWith(`_${oldUid}`)) {
                  targetKey = `${k.slice(0, -(`_${oldUid}`.length))}_${uid}`;
                } else if (!k.endsWith(`_${uid}`)) {
                  targetKey = `${k}_${uid}`;
                }
              }
              const serialized = typeof v === 'string' ? v : JSON.stringify(v);
              localStorage.setItem(targetKey, serialized);
              if (isPrimaryOwnerAccount()) {
                localStorage.setItem(k, serialized);
              }
              if (uid && targetKey.startsWith('fds_libro_temas_2026_') && v && typeof v === 'object') {
                const basePart = targetKey.replace(`_${uid}`, '').replace('fds_libro_temas_2026_', '');
                if (basePart) {
                  firestoreSync.saveUserSetting(uid, `libro_temas_${basePart}`, v).catch(() => {});
                }
              }
            }
          }
        }

        if (Array.isArray(data.courses) && data.courses.length > 0) {
          saveLocalCourses(data.courses);
          if (uid) await firestoreSync.saveCourses(uid, data.courses);
        }

        if (Array.isArray(data.students) && data.students.length > 0) {
          saveLocalStudents(data.students);
          if (uid) {
            const byCourse = new Map<string, any[]>();
            data.students.forEach((st: any) => {
              if (!st.courseId) return;
              const arr = byCourse.get(st.courseId) || [];
              arr.push(st);
              byCourse.set(st.courseId, arr);
            });
            for (const [cid, list] of byCourse.entries()) {
              await firestoreSync.saveStudents(uid, cid, list);
            }
          }
        }

        if (data.disposition2c && typeof data.disposition2c === 'object') {
          localStorage.setItem(
            getUserStorageKey('fds_disposition_data_2c'),
            JSON.stringify(data.disposition2c)
          );
          if (uid) {
            await firestoreSync.saveUserSetting(uid, 'disposition_map_2c', data.disposition2c);
          }
        }

        if (data.disposition || data.history) {
          saveAllDispositionStorage(data.disposition || {}, data.history || []);
          if (uid && Array.isArray(data.history) && data.history.length > 0) {
            await firestoreSync.saveDispositionBatch(uid, data.history);
          }
        }

        window.dispatchEvent(new Event('docencia_student_status_updated'));
        window.dispatchEvent(new Event('docencia_disposition_storage_change'));
        setBackupFeedback('✓ ¡Respaldo completo restaurado y sincronizado en la nube con éxito!');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (err: any) {
        setBackupFeedback(err.message || 'Error al restaurar el archivo de respaldo.');
      } finally {
        setIsRestoringFullBackup(false);
        if (restoreInputRef.current) restoreInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (user) {
      setEditName(user.name || '');
      setEditSchool(user.school || '');
      setEditEmail(user.email || '');
    }
  }, [user]);

  const googleApps = [
    { name: 'Google Classroom', icon: '🎓', tab: 'classroom_sync', desc: 'Sincronizar y Alumnos' },
    { name: 'Gmail', icon: '✉️', tab: 'classes', desc: 'Avisos y Notificaciones' },
    { name: 'Google Sheets', icon: '📊', tab: 'classes', desc: 'Planilla de Asistencia' },
    { name: 'Google Calendar', icon: '📅', tab: 'classes', desc: 'Horarios de Clases' },
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
              {/* Pastel badge holding Docenc. in Dancing Script Bold and ia in Space Grotesk Bold */}
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

      {/* Middle: Google Workspace Search Bar */}
      <div className="flex-1 max-w-2xl mx-4 hidden md:flex items-center">
        <div className="relative flex items-center w-full">
          <Search className="absolute left-3.5 w-4 h-4 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar materia, planificación, tema o entrega..."
            className={`w-full h-10 pl-10 pr-10 text-xs rounded-xl border transition-all focus:outline-none ${
              isDarkMode
                ? 'bg-slate-900/90 text-white placeholder-slate-400 border-slate-700 focus:border-blue-500 focus:bg-slate-900'
                : 'bg-[#edf2fc] hover:bg-[#e4ebf8] focus:bg-white text-neutral-800 placeholder-neutral-500 border-transparent focus:border-blue-400 focus:shadow-sm'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 p-1 text-neutral-400 hover:text-neutral-600 rounded-full cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
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
          onClick={() => {
            setBackupFeedback(null);
            setIsFullBackupOpen(true);
          }}
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

        {/* Share & Teacher Guide Quick Button */}
        <button
          type="button"
          onClick={() => setIsGuideOpen(true)}
          className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
            isDarkMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-blue-300'
              : 'bg-blue-50/80 hover:bg-blue-100 border-blue-200 text-blue-700'
          }`}
          title="Guía rápida para docentes y enlace para compartir con colegas"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden xl:inline text-[11px]">Guía / Compartir</span>
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
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          <span className="hidden xl:inline text-[11px]">
            {isDarkMode ? 'Modo Claro' : 'Modo Oscuro'}
          </span>
        </button>

        {/* 9 Dots Google Apps Launcher */}
        <div className="relative">
          <button
            onClick={() => setShowAppsMenu(!showAppsMenu)}
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
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
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
                    loginWithGoogle('jorge.cano@fds-esc.edu.ar');
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
                    setBackupFeedback(null);
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

      {/* Modal: Copia de Seguridad Completa en 1 Clic (JSON / Excel + Restauración) */}
      {isFullBackupOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-7 max-w-lg w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Copia de Seguridad del Ciclo Lectivo</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Respaldo unificado en 1 clic además de tu sincronización en Firestore
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFullBackupOpen(false)}
                className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-slate-800 ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Estado actual en la nube */}
            <div
              className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                isDarkMode
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Cloud className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="text-xs">
                  <div className="font-bold">Respaldo automático en Firebase Firestore activo</div>
                  <div className="opacity-80 text-[11px]">
                    {cloudStatus.lastSyncedAt
                      ? `Última sincronización en la nube: ${cloudStatus.lastSyncedAt}`
                      : 'Tus cursos, alumnos, asistencias, notas y configuraciones están sincronizados.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleManualCloudResync}
                disabled={isManualSyncingCloud}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isManualSyncingCloud ? 'animate-spin' : ''}`} />
                <span>Sincronizar</span>
              </button>
            </div>

            {backupFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold ${
                  backupFeedback.startsWith('✓')
                    ? isDarkMode
                      ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                      : 'bg-blue-50 border-blue-200 text-blue-800'
                    : isDarkMode
                    ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                {backupFeedback}
              </div>
            )}

            {/* Botones de Descarga en 1 Clic */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleDownloadFullBackupJson}
                className="w-full p-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-left flex items-center justify-between gap-3 shadow-xs transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="text-xs sm:text-sm font-bold">
                      1. Descargar Copia de Seguridad Integral (.JSON)
                    </div>
                    <div className="text-[11px] text-indigo-100">
                      Incluye todas las materias, alumnos, asistencias, notas, semáforo y calendarios
                    </div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleDownloadFullExcelSummary}
                className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-emerald-300'
                    : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs sm:text-sm font-bold">
                      2. Descargar Planilla Excel Unificada (.XLSX)
                    </div>
                    <div className="text-[11px] opacity-80">
                      Exporta en un solo archivo Excel el resumen general de todos tus alumnos
                    </div>
                  </div>
                </div>
              </button>

              {/* Restaurar desde archivo JSON */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                  isDarkMode
                    ? 'bg-slate-800/50 border-slate-700 text-slate-200'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">Restaurar desde archivo de respaldo (.JSON)</div>
                    <div className="text-[11px] opacity-75">
                      Carga un archivo descargado previamente y lo sube a tu nube de Firestore
                    </div>
                  </div>
                </div>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFullBackupFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isRestoringFullBackup}
                  onClick={() => restoreInputRef.current?.click()}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-white'
                      : 'bg-white hover:bg-neutral-100 border-neutral-300 text-neutral-800'
                  }`}
                >
                  {isRestoringFullBackup ? 'Restaurando...' : 'Elegir archivo'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setIsFullBackupOpen(false)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Perfil del Docente */}
      {isEditProfileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-8 max-w-md w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/10 text-blue-600 flex items-center justify-center">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Datos del Docente</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Personaliza tu nombre, correo e institución
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditProfileOpen(false)}
                className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-slate-800 ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setIsSavingProfile(true);
                try {
                  await updateUserProfile({
                    name: editName.trim() || user?.name,
                    school: editSchool.trim() || user?.school,
                    email: editEmail.trim() || user?.email,
                  });
                  setIsEditProfileOpen(false);
                } finally {
                  setIsSavingProfile(false);
                }
              }}
              className="space-y-4 text-left"
            >
              <div>
                <label className={`text-xs font-semibold block mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  Nombre y Apellido del Docente
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="ej: Prof. Jorge Cano"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label className={`text-xs font-semibold block mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ej: docente@colegio.edu.ar"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label className={`text-xs font-semibold block mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  Institución / Escuela
                </label>
                <input
                  type="text"
                  value={editSchool}
                  onChange={(e) => setEditSchool(e.target.value)}
                  placeholder="ej: Colegio San Martín"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsEditProfileOpen(false)}
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
                  disabled={isSavingProfile}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingProfile ? (
                    <span>Guardando...</span>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar Perfil</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Teacher Guide & Share Modal */}
      <TeacherGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onOpenCalendarSettings={() => onNavigate('calendar_schedule')}
        onOpenClassroomSync={() => onNavigate('classroom_sync')}
      />
    </header>
  );
};
