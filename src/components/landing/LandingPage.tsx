import React, { useState, useEffect } from 'react';
import {
  FileText,
  BookOpen,
  CheckSquare,
  Table,
  ShieldCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
  AlertCircle,
  Sun,
  Moon,
  User,
  Mail,
  ArrowRight,
  X,
  Eye,
  EyeOff,
  LogIn
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { OwlLogoIcon } from '../common/OwlLogoIcon';
import firebaseConfig from '../../../firebase-applet-config.json';

interface LandingPageProps {
  onLoginSuccess: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLoginSuccess }) => {
  const {
    loginWithGoogle,
    loginWithEmail,
    isLoggingIn,
    isDarkMode,
    toggleDarkMode,
  } = useWorkspaceAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>('');
  const [isSubmittingAccount, setIsSubmittingAccount] = useState<boolean>(false);

  // Candidate video sources to try in order
  const CANDIDATE_VIDEOS = [
    '/logo-animado.mp4',
    '/logo.mp4',
    '/logo-dinamico.mp4',
    '/logo-animado.webm',
    '/logo.webm',
  ];

  const [candidateIndex, setCandidateIndex] = useState(0);
  const [logoVideoSrc, setLogoVideoSrc] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('docencia_logo_video_data');
      if (saved) return saved;
    }
    return '/logo-animado.mp4';
  });
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [clickPulse, setClickPulse] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // Check if the backend already has an uploaded logo video and start playback
  useEffect(() => {
    fetch('/api/logo-status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.hasVideo && Array.isArray(data?.found) && data.found.length > 0) {
          const videoFile = data.found.find((f: string) => f.endsWith('.mp4') || f.endsWith('.webm'));
          if (videoFile) {
            setLogoVideoSrc(videoFile);
          }
        }
      })
      .catch(() => {});

    if (videoRef.current) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    }
  }, []);

  const handleVideoError = () => {
    // Try next candidate video
    if (candidateIndex + 1 < CANDIDATE_VIDEOS.length) {
      const next = candidateIndex + 1;
      setCandidateIndex(next);
      setLogoVideoSrc(CANDIDATE_VIDEOS[next]);
    } else {
      // All video sources exhausted; display dynamic animated logo by default
      setIsVideoPlaying(false);
    }
  };

  const handleVideoLoaded = () => {
    setIsVideoPlaying(true);
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleReplayVideo = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    } else {
      setClickPulse(true);
      setTimeout(() => setClickPulse(false), 800);
    }
  };

  const handleGoogleLogin = async (customEmail?: string) => {
    try {
      setIsSubmittingAccount(true);
      setAuthError(null);
      const emailToUse = (typeof customEmail === 'string' && customEmail.trim())
        ? customEmail.trim()
        : (emailInput.trim() || undefined);
      await loginWithGoogle(emailToUse);
      onLoginSuccess();
    } catch (err: any) {
      console.warn('Aviso al iniciar sesión con Google:', err);
      if (err?.code === 'auth/popup-closed-by-user' || err?.type === 'popup_closed' || err?.message?.includes('cerrada')) {
        setAuthError('La ventana de Google se cerró antes de completar el inicio de sesión.');
      } else if (err?.code === 'auth/popup-blocked') {
        setAuthError('La ventana emergente de Google fue bloqueada. Habilita las ventanas emergentes en tu navegador.');
      } else if (err?.message?.includes('origin_mismatch') || err?.message?.includes('400') || err?.message?.includes('autorizados')) {
        setAuthError('Google OAuth Error (origin_mismatch): La URL de este entorno de vista previa debe registrarse en Google Cloud Console > Credenciales > Orígenes autorizados de JavaScript. Mientras tanto, puedes ingresar abajo con cualquier correo institucional o personal.');
      } else {
        setAuthError(err?.message || 'No se pudo completar el inicio de sesión con Google. Puedes ingresar con tu correo abajo.');
      }
    } finally {
      setIsSubmittingAccount(false);
    }
  };

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim();
    if (!cleanEmail) {
      setAuthError('Por favor ingresa tu correo electrónico para ingresar');
      return;
    }
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setAuthError('Por favor ingresa un correo electrónico válido (ej: docente@colegio.edu.ar o tu.cuenta@gmail.com)');
      return;
    }
    const cleanPassword = passwordInput.trim() || 'docencia2026';
    try {
      setIsSubmittingAccount(true);
      setAuthError(null);
      await loginWithEmail(cleanEmail, cleanPassword, nameInput.trim() || undefined);
      onLoginSuccess();
    } catch (err: any) {
      console.error('Error al iniciar sesión:', err);
      setAuthError(err?.message || 'Error al conectar con la cuenta ingresada');
    } finally {
      setIsSubmittingAccount(false);
    }
  };

  const handleScrollToLogin = () => {
    const el = document.getElementById('main-google-login-btn') || document.getElementById('teacher-email-input');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div
      className={`min-h-screen transition-colors duration-300 flex flex-col selection:bg-blue-500 selection:text-white ${
        isDarkMode
          ? 'bg-[#0A0E17] text-slate-100'
          : 'bg-[#F9F8F6] text-neutral-900'
      }`}
    >
      {/* Top Header Bar */}
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-300 ${
          isDarkMode
            ? 'bg-[#0A0E17]/85 border-slate-800/80 text-white'
            : 'bg-white/90 border-neutral-200/80 text-neutral-900'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {/* Logo con cabeza de lechuza y ojos brillantes */}
          <div className="flex items-center gap-3">
            <OwlLogoIcon
              size={44}
              usePhoto={false}
              useVideo={true}
              className="w-11 h-11 rounded-xl shadow-md ring-2 ring-blue-500/40"
            />
            <div className="flex flex-col justify-center">
              <div className="flex items-center">
                {/* Pastel badge holding Docenc. in Dancing Script Bold and ia in Space Grotesk Bold */}
                <div
                  className={`px-3 py-0.5 rounded-xl border shadow-xs flex items-baseline transition-colors ${
                    isDarkMode
                      ? 'bg-blue-950/40 border-blue-400/30 shadow-blue-950/40'
                      : 'bg-[#EFF6FF] border-[#BFDBFE] shadow-blue-100/50'
                  }`}
                >
                  <span className="font-dancing text-2xl font-bold tracking-normal text-[#2563EB] leading-none inline-block">
                    Docenc.
                  </span>
                  <span
                    className={`font-space text-lg font-bold tracking-tight lowercase leading-none -ml-0.5 ${
                      isDarkMode ? 'text-slate-100' : 'text-slate-900'
                    }`}
                  >
                    ia
                  </span>
                </div>
              </div>
              <span
                className={`text-[10px] tracking-wide font-medium mt-0.5 leading-none ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Gestor de Clase
              </span>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleDarkMode}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-700 text-amber-300 border-slate-700'
                  : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
              }`}
              title={isDarkMode ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Modo Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700" />
                  <span className="hidden sm:inline">Modo Oscuro</span>
                </>
              )}
            </button>

            <div
              className={`hidden md:flex items-center gap-2 text-xs border rounded-xl px-3 py-1.5 ${
                isDarkMode
                  ? 'text-slate-300 border-slate-800 bg-slate-900/60'
                  : 'text-neutral-600 border-neutral-200 bg-neutral-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Google Workspace</span>
            </div>

            <button
              onClick={() => {
                const el = document.getElementById('teacher-login-section');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                handleGoogleLogin();
              }}
              disabled={isLoggingIn || isSubmittingAccount}
              className="text-xs font-semibold px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
              title="Iniciar sesión con Google / Gmail"
            >
              {isLoggingIn || isSubmittingAccount ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Conectando...</span>
                </>
              ) : (
                <>
                  <div className="w-4 h-4 bg-white rounded-full flex items-center justify-center p-0.5 shrink-0 shadow-xs">
                    <svg className="w-3 h-3" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                  </div>
                  <span>Iniciar con Gmail</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero Container */}
      <main className="flex-1 max-w-6xl mx-auto px-6 py-12 sm:py-16 space-y-20">
        {/* Brand & Hook Header */}
        <div className="text-center max-w-3xl mx-auto flex flex-col items-center">
          {/* 1. Arriba de Docenc.ia: "✨ Tu asistente IA pedagógico ✨" */}
          <div className="mb-4">
            <span
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs sm:text-sm font-caslon font-medium tracking-wide border shadow-2xs ${
                isDarkMode
                  ? 'bg-blue-950/70 border-blue-800/80 text-blue-300'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              ✨ Tu asistente IA pedagógico ✨
            </span>
          </div>

          {/* 2. Nombre de la app: Docenc. e ia en recuadro con paleta pastel */}
          <div className="my-2 flex flex-col items-center">
            <div
              className={`inline-block px-8 sm:px-11 py-3 sm:py-4 rounded-2xl sm:rounded-3xl border shadow-xl transition-all ${
                isDarkMode
                  ? 'bg-gradient-to-b from-[#172554]/50 to-[#0f172a]/80 border-blue-400/30 shadow-blue-950/40'
                  : 'bg-gradient-to-b from-[#EFF6FF] to-[#E0F2FE] border-[#BFDBFE] shadow-blue-200/40'
              }`}
            >
              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight flex items-baseline justify-center">
                <span className="font-dancing text-[#2563EB] text-5xl sm:text-7xl lg:text-8xl leading-none inline-block">
                  Docenc.
                </span>
                <span
                  className={`font-space text-3xl sm:text-5xl lg:text-6xl lowercase tracking-tighter leading-none -ml-1 sm:-ml-2 ${
                    isDarkMode ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  ia
                </span>
              </h1>
            </div>

            {/* Debajo de Docenc.ia: Gestor de Clase */}
            <div className="mt-3">
              <span
                className={`inline-flex items-center gap-1.5 px-4 py-1 rounded-full text-xs sm:text-sm font-semibold tracking-wider uppercase border shadow-xs ${
                  isDarkMode
                    ? 'bg-slate-800/90 text-blue-300 border-blue-500/30'
                    : 'bg-white text-blue-700 border-blue-200'
                }`}
              >
                Gestor de Clase
              </span>
            </div>
          </div>

          {/* Logo dinámico del búho: activo por defecto con ventana redonda que encaja justo con el círculo del video */}
          <div className="my-5 flex flex-col items-center justify-center w-full max-w-md mx-auto px-2">
            <div
              id="docencia-animated-logo-frame"
              onClick={handleReplayVideo}
              className={`relative group w-56 h-56 sm:w-64 sm:h-64 md:w-72 md:h-72 aspect-square rounded-full overflow-hidden bg-black flex items-center justify-center cursor-pointer transition-all duration-500 shadow-2xl border-2 ${
                isDarkMode
                  ? 'border-cyan-400/60 shadow-cyan-950/80 ring-4 ring-cyan-500/25 hover:border-cyan-300 hover:ring-cyan-400/40 hover:scale-102'
                  : 'border-blue-500/50 shadow-blue-300/40 ring-4 ring-blue-500/20 hover:border-blue-600 hover:ring-blue-400/30 hover:scale-102'
              }`}
              title="Haz clic para volver a reproducir la animación"
            >
              {/* Capa de Video (redonda, encaja justo con el círculo del video, reproduce una sola vez al cargar) */}
              <video
                ref={videoRef}
                id="docencia-logo-video"
                src={logoVideoSrc}
                autoPlay
                loop={false}
                muted
                playsInline
                preload="auto"
                controls={false}
                onError={handleVideoError}
                onLoadedData={handleVideoLoaded}
                onCanPlay={handleVideoLoaded}
                onPlay={() => setIsVideoPlaying(true)}
                className={`w-full h-full object-cover rounded-full pointer-events-none transform transition-opacity duration-500 ${
                  isVideoPlaying ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'
                }`}
              >
                <source src={logoVideoSrc} type="video/mp4" />
                <source src="/logo-animado.mp4" type="video/mp4" />
                <source src="/logo-animado-original.mp4" type="video/mp4" />
                <source src="/logo-animado.webm" type="video/webm" />
                <source src="/logo.mp4" type="video/mp4" />
              </video>

              {/* Logo Lechuza original de respaldo (en caso de carga de video) */}
              {!isVideoPlaying && (
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full bg-slate-950">
                  <OwlLogoIcon
                    size={280}
                    useVideo={false}
                    usePhoto={false}
                    className="w-full h-full rounded-full border-none shadow-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 3. Abajo de Docenc.ia: Una herramienta pensada por docentes, para docentes (sin cursiva ni comillas) */}
          <p
            className={`mt-4 text-base sm:text-xl font-caslon max-w-xl mx-auto leading-relaxed ${
              isDarkMode ? 'text-slate-300' : 'text-neutral-700'
            }`}
          >
            Una herramienta pensada por docentes, para docentes
          </p>

          {/* 4. "Ingreso de Profesores" y opciones de login CENTRADO con paleta pastel */}
          <div
            id="teacher-login-section"
            className={`mt-10 w-full max-w-md mx-auto rounded-3xl p-6 sm:p-8 border shadow-xl flex flex-col items-center justify-center text-center transition-colors ${
              isDarkMode
                ? 'bg-slate-900/80 border-slate-700/80 shadow-blue-950/30'
                : 'bg-[#F0FDF4]/90 border-[#BBF7D0] shadow-emerald-100/60'
            }`}
          >
            {/* Título y subtítulo centrados */}
            <div className="space-y-2 flex flex-col items-center text-center w-full">
              <h2
                className={`text-xl sm:text-2xl font-bold font-caslon tracking-tight ${
                  isDarkMode ? 'text-white' : 'text-slate-900'
                }`}
              >
                Ingreso de Profesores
              </h2>
              <p
                className={`text-xs max-w-xs leading-relaxed ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                Inicia sesión con tu cuenta de Google Workspace o con tu correo y contraseña para acceder a tus planificaciones.
              </p>
            </div>

            {/* Error Message Centered */}
            {authError && (
              <div className="w-full mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2 text-left">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="leading-tight">{authError}</span>
              </div>
            )}

            {/* 1. Botón principal: Iniciar sesión con Google */}
            <div className="w-full mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                id="main-google-login-btn"
                onClick={() => handleGoogleLogin()}
                disabled={isLoggingIn || isSubmittingAccount}
                className={`w-full py-3.5 px-5 rounded-2xl border shadow-md hover:shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-3 font-semibold text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-white border-slate-600'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300 shadow-xs'
                }`}
              >
                {isLoggingIn || isSubmittingAccount ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    <span>Conectando con Google...</span>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center p-0.5 shrink-0 shadow-xs">
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                    </div>
                    <span className={isDarkMode ? 'text-white' : 'text-slate-800'}>
                      Iniciar sesión con Google Workspace
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Separador */}
            <div className="w-full flex items-center my-5 gap-3">
              <div className={`flex-1 h-px ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`} />
              <span className={`text-[11px] uppercase tracking-wider font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                o ingresa con tu correo
              </span>
              <div className={`flex-1 h-px ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`} />
            </div>

            {/* 2. Formulario con correo y contraseña */}
            <form onSubmit={handleTeacherLogin} className="w-full space-y-3.5 text-left">
              <div>
                <label
                  htmlFor="teacher-email-input"
                  className={`text-xs font-semibold flex items-center gap-1.5 mb-1 ${
                    isDarkMode ? 'text-slate-200' : 'text-slate-700'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>Correo electrónico docente</span>
                </label>
                <input
                  id="teacher-email-input"
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="ej: tu.correo@colegio.edu.ar o cuenta@gmail.com"
                  className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border outline-none transition-all font-normal ${
                    isDarkMode
                      ? 'bg-slate-800/90 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                      : 'bg-white border-neutral-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-2xs'
                  }`}
                />
              </div>

              <div>
                <label
                  htmlFor="teacher-password-input"
                  className={`text-xs font-semibold flex items-center justify-between mb-1 ${
                    isDarkMode ? 'text-slate-200' : 'text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>Contraseña (opcional para acceso)</span>
                  </span>
                </label>
                <div className="relative flex items-center">
                  <input
                    id="teacher-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Contraseña o dejar en blanco"
                    className={`w-full px-3.5 py-2.5 pr-10 text-xs sm:text-sm rounded-xl border outline-none transition-all font-normal ${
                      isDarkMode
                        ? 'bg-slate-800/90 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                        : 'bg-white border-neutral-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-2xs'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
                    title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="teacher-name-input"
                  className={`text-xs font-semibold flex items-center gap-1.5 mb-1 ${
                    isDarkMode ? 'text-slate-200' : 'text-slate-700'
                  }`}
                >
                  <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>Nombre del docente (opcional)</span>
                </label>
                <input
                  id="teacher-name-input"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="ej: Prof. Laura Martínez"
                  className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border outline-none transition-all font-normal ${
                    isDarkMode
                      ? 'bg-slate-800/90 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                      : 'bg-white border-neutral-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-2xs'
                  }`}
                />
              </div>

              <button
                type="submit"
                id="credentials-login-btn"
                disabled={isLoggingIn || isSubmittingAccount}
                className="w-full mt-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoggingIn || isSubmittingAccount ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Iniciar sesión</span>
                  </>
                )}
              </button>
            </form>

            {/* Footer text centered */}
            <div
              className={`w-full pt-4 mt-5 border-t text-[11px] flex items-center justify-center gap-3 ${
                isDarkMode
                  ? 'border-slate-800 text-slate-400'
                  : 'border-neutral-100 text-neutral-500'
              }`}
            >
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-emerald-400" />
                <span>Conexión segura SSL</span>
              </span>
              <span>•</span>
              <span>Docenc.IA 2026</span>
            </div>
          </div>
        </div>

        {/* 5. "Organizá tus clases con estos recursos" y la descripción */}
        <div className="space-y-8 pt-8">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <h2
              className={`text-2xl sm:text-3xl font-bold font-caslon tracking-tight ${
                isDarkMode ? 'text-white' : 'text-neutral-950'
              }`}
            >
              Control integral de asistencia y disposición escolar
            </h2>
            <p
              className={`text-sm sm:text-base leading-relaxed ${
                isDarkMode ? 'text-slate-300' : 'text-neutral-600'
              }`}
            >
              Gestioná la asistencia, la conducta áulica y la comunicación con tus estudiantes en sincronía total con Google Workspace:
            </p>
          </div>

          {/* Grid of the 4 possibilities with Caslon font and pastel aesthetic cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* 1. Asistencia - Pastel Sky/Blue */}
            <div
              className={`rounded-3xl border p-6 transition-all space-y-4 shadow-sm ${
                isDarkMode
                  ? 'bg-[#0f172a]/90 border-blue-500/30 hover:border-blue-400/60 shadow-blue-950/40'
                  : 'bg-[#F0F9FF] border-[#BAE6FD] hover:border-blue-300 hover:shadow-md'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-600">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  Módulo 1
                </span>
                <h3
                  className={`text-base font-bold font-caslon ${
                    isDarkMode ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  Asistencia en Tiempo Real
                </h3>
                <p
                  className={`text-xs leading-relaxed ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  Registro ágil de presentes, ausencias, tardanzas y justificaciones con cómputo automático por estudiante.
                </p>
              </div>
              <ul
                className={`text-[11px] space-y-1 pt-2 border-t ${
                  isDarkMode
                    ? 'border-blue-900/40 text-slate-400'
                    : 'border-blue-200/70 text-slate-600'
                }`}
              >
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Registro diario por clase
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Exporta directo a Sheets
                </li>
              </ul>
            </div>

            {/* 2. Disposición - Pastel Lavender/Purple */}
            <div
              className={`rounded-3xl border p-6 transition-all space-y-4 shadow-sm ${
                isDarkMode
                  ? 'bg-[#1a1528]/90 border-purple-500/30 hover:border-purple-400/60 shadow-purple-950/40'
                  : 'bg-[#FAF5FF] border-[#E9D5FF] hover:border-purple-300 hover:shadow-md'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-600">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                  Módulo 2
                </span>
                <h3
                  className={`text-base font-bold font-caslon ${
                    isDarkMode ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  Disposición & Conducta
                </h3>
                <p
                  className={`text-xs leading-relaxed ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  Puntaje base de 10 puntos, llamados de atención con motivos personalizados y seguimiento por cuatrimestre.
                </p>
              </div>
              <ul
                className={`text-[11px] space-y-1 pt-2 border-t ${
                  isDarkMode
                    ? 'border-purple-900/40 text-slate-400'
                    : 'border-purple-200/70 text-slate-600'
                }`}
              >
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-500" /> Motivos personalizables
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-500" /> Historial y bitácora
                </li>
              </ul>
            </div>

            {/* 3. Google Classroom - Pastel Mint/Emerald */}
            <div
              className={`rounded-3xl border p-6 transition-all space-y-4 shadow-sm ${
                isDarkMode
                  ? 'bg-[#0e211b]/90 border-emerald-500/30 hover:border-emerald-400/60 shadow-emerald-950/40'
                  : 'bg-[#ECFDF5] border-[#A7F3D0] hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600">
                <CheckSquare className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Módulo 3
                </span>
                <h3
                  className={`text-base font-bold font-caslon ${
                    isDarkMode ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  Google Classroom
                </h3>
                <p
                  className={`text-xs leading-relaxed ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  Sincronización directa de cursos y nóminas reales de estudiantes de tu Classroom sin carga manual.
                </p>
              </div>
              <ul
                className={`text-[11px] space-y-1 pt-2 border-t ${
                  isDarkMode
                    ? 'border-emerald-900/40 text-slate-400'
                    : 'border-emerald-200/70 text-slate-600'
                }`}
              >
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Nóminas reales oficiales
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> 1-clic de sincronización
                </li>
              </ul>
            </div>

            {/* 4. Tablón y Gmail - Pastel Peach/Warm Amber */}
            <div
              className={`rounded-3xl border p-6 transition-all space-y-4 shadow-sm ${
                isDarkMode
                  ? 'bg-[#22180d]/90 border-amber-500/30 hover:border-amber-400/60 shadow-amber-950/40'
                  : 'bg-[#FFFBEB] border-[#FDE68A] hover:border-amber-300 hover:shadow-md'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600">
                <Table className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Módulo 4
                </span>
                <h3
                  className={`text-base font-bold font-caslon ${
                    isDarkMode ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  Tablón & Avisos Gmail
                </h3>
                <p
                  className={`text-xs leading-relaxed ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  Publicación de avisos en el tablón de Classroom y envío de notificaciones individuales por Gmail con plantillas dinámicas.
                </p>
              </div>
              <ul
                className={`text-[11px] space-y-1 pt-2 border-t ${
                  isDarkMode
                    ? 'border-amber-900/40 text-slate-400'
                    : 'border-amber-200/70 text-slate-600'
                }`}
              >
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" /> Mensajes en el tablón
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" /> Notificaciones Gmail
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Integration Badges */}
        <div
          className={`border rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 ${
            isDarkMode
              ? 'bg-[#111827]/60 border-slate-700/60 text-slate-300'
              : 'bg-[#F8FAFC] border-[#E2E8F0] text-neutral-700'
          }`}
        >
          <div className="space-y-1 text-center md:text-left">
            <h3
              className={`text-base font-bold font-caslon ${
                isDarkMode ? 'text-white' : 'text-slate-900'
              }`}
            >
              Conectado a tus herramientas Google de confianza
            </h3>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Tus documentos, carpetas y estudiantes se gestionan en tus servicios educativos oficiales.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {[
              { name: 'Google Docs', pastelBg: 'bg-[#EFF6FF]', pastelBorder: 'border-[#BFDBFE]', dot: 'bg-blue-500' },
              { name: 'Google Drive', pastelBg: 'bg-[#FEFCE8]', pastelBorder: 'border-[#FEF08A]', dot: 'bg-amber-500' },
              { name: 'Google Sheets', pastelBg: 'bg-[#F0FDF4]', pastelBorder: 'border-[#BBF7D0]', dot: 'bg-emerald-500' },
              { name: 'Google Classroom', pastelBg: 'bg-[#FDF4FF]', pastelBorder: 'border-[#F5D0FE]', dot: 'bg-fuchsia-500' },
              { name: 'Google Forms', pastelBg: 'bg-[#FAF5FF]', pastelBorder: 'border-[#E9D5FF]', dot: 'bg-purple-500' },
            ].map(({ name, pastelBg, pastelBorder, dot }) => (
              <span
                key={name}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-2 transition-colors ${
                  isDarkMode
                    ? 'bg-slate-900/90 border-slate-700 text-slate-200 shadow-2xs'
                    : `${pastelBg} ${pastelBorder} text-slate-800 shadow-2xs`
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                {name}
              </span>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className={`border-t py-8 text-center text-xs transition-colors ${
          isDarkMode
            ? 'border-slate-800/80 bg-[#0A0E17] text-slate-400'
            : 'border-neutral-200 bg-white text-neutral-500'
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm font-semibold flex items-baseline">
            <span className="font-dancing text-xl font-bold text-[#2563EB] leading-none inline-block">
              Docenc.
            </span>
            <span className={`font-space text-xs font-bold lowercase tracking-tight leading-none -ml-0.5 ${isDarkMode ? 'text-white' : 'text-black'}`}>
              ia
            </span>
            <span className="ml-2 opacity-80 font-normal">© 2026 • Asistente Pedagógico</span>
          </p>
          <div className="flex items-center gap-3 text-[11px]">
            <span>Seguridad y Privacidad Docente</span>
            <span>•</span>
            <span>Google Workspace for Education</span>
          </div>
        </div>
      </footer>

    </div>
  );
};
