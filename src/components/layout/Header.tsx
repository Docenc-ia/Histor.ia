import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { OwlLogoIcon } from '../common/OwlLogoIcon';

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
  const [editName, setEditName] = useState(user?.name || '');
  const [editSchool, setEditSchool] = useState(user?.school || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

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

      {/* Right: Workspace Status, Dark Mode Toggle & Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
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
          title="Cerrar sesión y volver a la página de bienvenida Docenc.IA"
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
                    if (mode === 'connected') logout();
                    else loginWithGoogle();
                    setShowProfileMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-2 text-left rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-slate-200 hover:bg-slate-800'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span>{mode === 'connected' ? 'Desconectar cuenta Google' : 'Forzar Sincronización Google'}</span>
                  <RefreshCw className="w-3.5 h-3.5 text-neutral-400" />
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
    </header>
  );
};
