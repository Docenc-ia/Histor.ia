/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  DEFAULT_TEACHER,
  getTeacherAvatar,
  deriveSchoolFromEmail,
  getCachedAccessToken,
  setCachedAccessToken,
  googleSignIn,
  signInWithGoogleIdToken,
  requestGoogleAccessToken,
  logoutUser,
  initAuth,
  WORKSPACE_SCOPES,
  isValidGoogleAccessToken,
  getSavedTokenForEmail,
  saveRememberedProfile,
  LAST_USER_PROFILE_KEY,
  LAST_TEACHER_EMAIL_KEY,
  auth,
} from '../services/workspace/googleAuth';
import { TeacherProfile } from '../types';
import { api } from '../services/api';
import { firestoreSync } from '../services/firestoreSync';
import { syncCoordinator } from '../services/syncCoordinator';

export interface ServiceStatus {
  id: string;
  name: string;
  scope: string;
  active: boolean;
  color: string;
  iconName: string;
  description: string;
}

interface WorkspaceAuthContextType {
  user: TeacherProfile | null;
  mode: 'connected' | 'disconnected';
  token: string | null;
  services: ServiceStatus[];
  scopes: string[];
  permissions: string[];
  isLoggingIn: boolean;
  loginError: string | null;
  isDarkMode: boolean;
  isTokenExpired: boolean;
  dismissTokenExpiryBanner: () => void;
  renewGoogleSession: () => Promise<boolean>;
  toggleDarkMode: () => void;
  loginWithGoogle: (email?: string) => Promise<string | null>;
  requestAccessToken: () => Promise<string>;
  loginWithGoogleIdToken: (idToken: string) => Promise<TeacherProfile>;
  loginWithEmail: (email: string, password?: string, name?: string) => Promise<void>;
  updateUserProfile: (profile: Partial<TeacherProfile>) => Promise<void>;
  logout: () => Promise<void>;
  setMode: (mode: 'connected' | 'disconnected') => void;
  testConnection: () => Promise<boolean>;
}

const WorkspaceAuthContext = createContext<WorkspaceAuthContextType | undefined>(undefined);

export const WorkspaceAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('docencia_landing_theme');
      if (saved) return saved === 'dark';
    }
    return true; // default dark mode consistent with landing
  });

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('docencia_landing_theme', next ? 'dark' : 'light');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode]);

  const [user, setUser] = useState<TeacherProfile | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        // Remove any legacy persistent session flags so closing the tab/browser always requires logging in again
        localStorage.removeItem('docencia_session_active');
        localStorage.removeItem('docencia_user_profile');
        localStorage.removeItem('docencia_teacher_email');

        const isExplicitLogout = localStorage.getItem('docencia_explicit_logout') === 'true';
        if (isExplicitLogout) {
          return null;
        }

        const isSessionActive =
          sessionStorage.getItem('docencia_session_active') === 'true';

        if (isSessionActive) {
          const saved = sessionStorage.getItem('docencia_user_profile');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.email) return parsed;
          }
        }
      } catch (_) {}
    }
    return null;
  });
  const [mode, setMode] = useState<'connected' | 'disconnected'>(() => {
    if (typeof window !== 'undefined') {
      const isExplicitLogout = localStorage.getItem('docencia_explicit_logout') === 'true';
      if (isExplicitLogout) return 'disconnected';
      const isLogged =
        sessionStorage.getItem('docencia_session_active') === 'true';
      const hasProfile = Boolean(sessionStorage.getItem('docencia_user_profile'));
      return isLogged && hasProfile ? 'connected' : 'disconnected';
    }
    return 'disconnected';
  });
  const [token, setToken] = useState<string | null>(getCachedAccessToken());
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isTokenExpired, setIsTokenExpired] = useState<boolean>(false);

  // Google OAuth session monitoring: only show the banner when a Google API request actually reports 401
  useEffect(() => {
    let isCancelled = false;

    const handleExpiredEvent = () => {
      if (mode !== 'connected' || isCancelled) return;
      setIsTokenExpired(true);
    };

    const handleRenewedEvent = (e: any) => {
      const freshToken = e.detail?.token;
      if (freshToken && isValidGoogleAccessToken(freshToken)) {
        setToken(freshToken);
        setIsTokenExpired(false);
      }
    };

    const handleClearedEvent = () => {
      setToken(null);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('google_session_expired', handleExpiredEvent);
      window.addEventListener('google_session_renewed', handleRenewedEvent);
      window.addEventListener('google_session_cleared', handleClearedEvent);
    }

    return () => {
      isCancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('google_session_expired', handleExpiredEvent);
        window.removeEventListener('google_session_renewed', handleRenewedEvent);
        window.removeEventListener('google_session_cleared', handleClearedEvent);
      }
    };
  }, [mode]);

  const dismissTokenExpiryBanner = useCallback(() => {
    setIsTokenExpired(false);
  }, []);

  const renewGoogleSession = useCallback(async (): Promise<boolean> => {
    try {
      const emailHint = user?.email || undefined;
      const res = await googleSignIn(emailHint, { forcePopup: true });
      if (res?.accessToken && isValidGoogleAccessToken(res.accessToken)) {
        setToken(res.accessToken);
        setIsTokenExpired(false);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Renew Google session error:', err);
      return false;
    }
  }, [user?.email]);

  const services: ServiceStatus[] = useMemo(
    () => [
      {
        id: 'sheets',
        name: 'Google Sheets',
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        active: mode !== 'disconnected',
        color: '#0f9d58',
        iconName: 'FileSpreadsheet',
        description: 'Sincronización en vivo de nómina de alumnos, inasistencias y notas de conducta.',
      },
      {
        id: 'drive',
        name: 'Google Drive',
        scope: 'https://www.googleapis.com/auth/drive.file',
        active: mode !== 'disconnected',
        color: '#4285f4',
        iconName: 'FolderClosed',
        description: 'Creación y adjuntos de archivos en carpetas de curso.',
      },
      {
        id: 'classroom_courses',
        name: 'Classroom Cursos',
        scope: 'https://www.googleapis.com/auth/classroom.courses.readonly',
        active: mode !== 'disconnected',
        color: '#0f9d58',
        iconName: 'GraduationCap',
        description: 'Lectura e importación de clases y nóminas de estudiantes.',
      },
      {
        id: 'classroom_tasks',
        name: 'Classroom Tareas',
        scope: 'https://www.googleapis.com/auth/classroom.coursework.students',
        active: mode !== 'disconnected',
        color: '#0f9d58',
        iconName: 'CheckSquare',
        description: 'Creación, asignación y seguimiento de entregas estudiantiles.',
      },
      {
        id: 'classroom_announcements',
        name: 'Classroom Avisos & Notificaciones',
        scope: 'https://www.googleapis.com/auth/classroom.announcements',
        active: mode !== 'disconnected',
        color: '#0f9d58',
        iconName: 'Bell',
        description: 'Publicación de avisos dirigidos al alumno por inasistencias o novedades.',
      },
      {
        id: 'calendar',
        name: 'Google Calendar',
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        active: mode !== 'disconnected',
        color: '#4285f4',
        iconName: 'Calendar',
        description: 'Horarios de materias, seguimiento de clases y eventos de calendario escolar.',
      },
      {
        id: 'gmail',
        name: 'Gmail Institucional',
        scope: 'https://www.googleapis.com/auth/gmail.send',
        active: mode !== 'disconnected',
        color: '#ea4335',
        iconName: 'Mail',
        description: 'Envío de notificaciones por correo electrónico institucional.',
      },
      {
        id: 'forms',
        name: 'Google Forms',
        scope: 'https://www.googleapis.com/auth/forms.responses.readonly',
        active: mode !== 'disconnected',
        color: '#673ab7',
        iconName: 'FileCheck',
        description: 'Lectura directa de evaluaciones de Google Forms y extracción de notas finales.',
      },
      {
        id: 'user_profile',
        name: 'Google Identity',
        scope: 'https://www.googleapis.com/auth/userinfo.profile',
        active: mode !== 'disconnected',
        color: '#ea4335',
        iconName: 'UserCheck',
        description: 'Autenticación institucional de cuenta de profesor.',
      },
    ],
    [mode]
  );

  // Check auth on startup (strictly scoped to current browser tab session)
  useEffect(() => {
    const isExplicitLogout =
      typeof window !== 'undefined' &&
      localStorage.getItem('docencia_explicit_logout') === 'true';
    const isLocalActive =
      typeof window !== 'undefined' &&
      !isExplicitLogout &&
      sessionStorage.getItem('docencia_session_active') === 'true';
    const savedEmail =
      typeof window !== 'undefined'
        ? (sessionStorage.getItem('docencia_teacher_email') || '').trim()
        : '';

    if (isLocalActive && savedEmail) {
      api.getAuthUser(savedEmail)
        .then((data) => {
          if (data.authenticated && data.user && data.user.email) {
            setUser(data.user);
            setMode('connected');
            if ((data as any).token && isValidGoogleAccessToken((data as any).token) && !getCachedAccessToken()) {
              setCachedAccessToken((data as any).token, data.user.email);
              setToken((data as any).token);
            }
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('docencia_session_active', 'true');
              sessionStorage.setItem('docencia_user_profile', JSON.stringify(data.user));
              sessionStorage.setItem('docencia_teacher_email', data.user.email);
            }
          }
        })
        .catch((err) => console.log('Session check:', err));
    }

    const unsubscribe = initAuth(
      (authUser, accessToken) => {
        const isSessionActive =
          typeof window !== 'undefined' &&
          localStorage.getItem('docencia_explicit_logout') !== 'true' &&
          sessionStorage.getItem('docencia_session_active') === 'true';
        if (isSessionActive) {
          const activeStoredEmail = (
            sessionStorage.getItem('docencia_teacher_email') || ''
          ).trim().toLowerCase();
          const teacherEmail = (authUser.email || '').trim().toLowerCase();
          // Do not overwrite an active session belonging to a different teacher email
          if (activeStoredEmail && teacherEmail && activeStoredEmail !== teacherEmail) {
            return;
          }
          setToken(accessToken);
          setMode('connected');
          const rawName = authUser.displayName || (teacherEmail ? teacherEmail.split('@')[0] : 'Docente');
          const teacherName = rawName.startsWith('Prof.') ? rawName : `Prof. ${rawName}`;
          const derivedSchool = deriveSchoolFromEmail(teacherEmail);

          const newProfile: TeacherProfile = {
            id: authUser.uid,
            name: teacherName,
            email: teacherEmail,
            avatar: authUser.photoURL || getTeacherAvatar(teacherName, teacherEmail),
            role: 'Docente Titular',
            school: derivedSchool,
            permissions: DEFAULT_TEACHER.permissions,
            scopes: WORKSPACE_SCOPES,
          };
          setUser(newProfile);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('docencia_user_profile', JSON.stringify(newProfile));
            sessionStorage.setItem('docencia_teacher_email', teacherEmail);
            saveRememberedProfile(newProfile);
          }
          firestoreSync.clearCaches();
        }
      },
      () => {
        // Not authenticated
      }
    );

    return () => unsubscribe();
  }, []);

  const loginWithGoogleIdToken = useCallback(async (idToken: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await signInWithGoogleIdToken(idToken);
      setToken(result.accessToken);
      setUser(result.profile);
      setMode('connected');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('docencia_explicit_logout');
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        sessionStorage.setItem('docencia_teacher_email', result.profile.email);
        saveRememberedProfile(result.profile);
      }
      return result.profile;
    } catch (err: any) {
      console.error('Login with Google ID token error:', err);
      setLoginError(err?.message || 'Error al autenticar cuenta de Google');
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const requestAccessToken = useCallback(async (): Promise<string> => {
    const liveToken = await requestGoogleAccessToken();
    if (liveToken) {
      setToken(liveToken);
      setMode('connected');
    }
    return liveToken;
  }, []);

  const loginWithGoogle = useCallback(async (preferredEmail?: string): Promise<string | null> => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await googleSignIn(preferredEmail);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('docencia_explicit_logout');
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        sessionStorage.setItem('docencia_teacher_email', result.profile.email);
        saveRememberedProfile(result.profile);
      }
      firestoreSync.clearCaches();
      setToken(result.accessToken || getSavedTokenForEmail(result.profile.email));
      setUser(result.profile);
      setMode('connected');

      api.syncAuthSession({
        uid: result.profile.id || 'user-google',
        email: result.profile.email,
        name: result.profile.name,
        avatar: result.profile.avatar,
        token: result.accessToken || undefined,
        scopes: result.profile.scopes || WORKSPACE_SCOPES,
        school: result.profile.school,
      }).catch(() => {});

      return result.accessToken;
    } catch (err: any) {
      console.warn('Aviso de inicio de sesión:', err);
      if (err?.code === 'auth/popup-closed-by-user' || err?.type === 'popup_closed') {
        setLoginError('Ventana de inicio de sesión de Google cerrada.');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        setLoginError('Proceso de autenticación cancelado.');
      } else if (err?.code === 'auth/popup-blocked') {
        setLoginError('La ventana emergente de Google fue bloqueada por el navegador.');
      } else {
        setLoginError(err?.message || 'Error al conectar con Google.');
      }
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const loginWithEmail = useCallback(async (email: string, password?: string, name?: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanPassword = (password || '').trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        throw new Error('Por favor ingresá un correo electrónico docente válido.');
      }

      let rememberedName = name;
      let rememberedAvatar: string | undefined;
      let consistentId = 'teacher_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');

      if (typeof window !== 'undefined') {
        try {
          const prevRaw = localStorage.getItem(LAST_USER_PROFILE_KEY);
          if (prevRaw) {
            const prev = JSON.parse(prevRaw);
            if (prev?.email && prev.email.trim().toLowerCase() === cleanEmail) {
              if (prev.id && !String(prev.id).startsWith('user-')) {
                consistentId = prev.id;
              }
              if (!rememberedName && prev.name) {
                rememberedName = prev.name;
              }
              if (prev.avatar) {
                rememberedAvatar = prev.avatar;
              }
            }
          }
        } catch (_) {}
      }

      const savedToken = getSavedTokenForEmail(cleanEmail);

      // Verify password against server / stored credentials
      const authResult = await api.loginWithEmailCredentials({
        email: cleanEmail,
        password: cleanPassword,
        name: rememberedName,
        token: savedToken || undefined,
      });

      const teacherName =
        rememberedName ||
        authResult.user?.name ||
        cleanEmail
          .split('@')[0]
          .split(/[._-]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ') ||
        'Docente';

      const derivedSchool = authResult.user?.school || deriveSchoolFromEmail(cleanEmail);

      const teacherProfile: TeacherProfile = {
        id: authResult.user?.id || consistentId,
        name: teacherName.startsWith('Prof.') ? teacherName : `Prof. ${teacherName}`,
        email: cleanEmail,
        avatar: rememberedAvatar || authResult.user?.avatar || getTeacherAvatar(teacherName, cleanEmail),
        role: 'Docente Titular',
        school: derivedSchool,
        permissions: DEFAULT_TEACHER.permissions,
        scopes: WORKSPACE_SCOPES,
      };

      const resolvedToken =
        savedToken ||
        (authResult.token && isValidGoogleAccessToken(authResult.token) ? authResult.token : null);

      if (typeof window !== 'undefined') {
        localStorage.removeItem('docencia_explicit_logout');
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(teacherProfile));
        sessionStorage.setItem('docencia_teacher_email', cleanEmail);
        saveRememberedProfile(teacherProfile);
      }

      if (resolvedToken) {
        setCachedAccessToken(resolvedToken, cleanEmail);
        setToken(resolvedToken);
      } else {
        setCachedAccessToken(null);
        setToken(null);
      }

      firestoreSync.clearCaches();
      setUser(teacherProfile);
      setMode('connected');
    } catch (err: any) {
      console.error('Login with email error:', err);
      setLoginError(err?.message || 'Error al conectar con la cuenta');
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const updateUserProfile = useCallback(async (updated: Partial<TeacherProfile>) => {
    if (!user) return;
    const cleanName = updated.name || user.name;
    const cleanEmail = (updated.email || user.email).trim().toLowerCase();
    const newAvatar = updated.avatar || getTeacherAvatar(cleanName, cleanEmail);
    const newProfile: TeacherProfile = {
      ...user,
      ...updated,
      name: cleanName,
      email: cleanEmail,
      avatar: newAvatar,
    };
    setUser(newProfile);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('docencia_user_profile', JSON.stringify(newProfile));
      sessionStorage.setItem('docencia_teacher_email', cleanEmail);
      saveRememberedProfile(newProfile);
    }
    api.syncAuthSession({
      uid: newProfile.id || 'user-docente',
      email: newProfile.email,
      name: newProfile.name,
      avatar: newProfile.avatar,
      token: token || undefined,
      scopes: WORKSPACE_SCOPES,
    }).catch(() => {});
  }, [user, token]);

  const logout = useCallback(async () => {
    const currentEmail = user?.email;
    if (user) {
      saveRememberedProfile(user);
    }
    try {
      syncCoordinator.flushAll();
    } catch (_) {}
    firestoreSync.clearCaches();
    if (typeof window !== 'undefined') {
      localStorage.setItem('docencia_explicit_logout', 'true');
      if (currentEmail) {
        localStorage.setItem(LAST_TEACHER_EMAIL_KEY, currentEmail.trim().toLowerCase());
      }
      sessionStorage.removeItem('docencia_session_active');
      sessionStorage.removeItem('docencia_user_profile');
      sessionStorage.removeItem('docencia_teacher_email');
      sessionStorage.removeItem('docencia_session_secret');
      localStorage.removeItem('docencia_user_profile');
      localStorage.removeItem('docencia_session_active');
      localStorage.removeItem('docencia_teacher_email');
      localStorage.removeItem('docencia_session_secret');
    }
    setToken(null);
    setUser(null);
    setMode('disconnected');
    try {
      await Promise.allSettled([
        api.logoutAuthSession(currentEmail),
        logoutUser(),
      ]);
    } catch (e) {
      console.warn('Logout error:', e);
    }
  }, [user]);

  const testConnection = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/workspace/config');
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const permissions = useMemo(
    () => user?.permissions || DEFAULT_TEACHER.permissions || [],
    [user?.permissions]
  );

  const contextValue = useMemo<WorkspaceAuthContextType>(
    () => ({
      user,
      mode,
      token,
      services,
      scopes: WORKSPACE_SCOPES,
      permissions,
      isLoggingIn,
      loginError,
      isDarkMode,
      isTokenExpired,
      dismissTokenExpiryBanner,
      renewGoogleSession,
      toggleDarkMode,
      loginWithGoogle,
      requestAccessToken,
      loginWithGoogleIdToken,
      loginWithEmail,
      updateUserProfile,
      logout,
      setMode,
      testConnection,
    }),
    [
      user,
      mode,
      token,
      services,
      permissions,
      isLoggingIn,
      loginError,
      isDarkMode,
      isTokenExpired,
      dismissTokenExpiryBanner,
      renewGoogleSession,
      toggleDarkMode,
      loginWithGoogle,
      requestAccessToken,
      loginWithGoogleIdToken,
      loginWithEmail,
      updateUserProfile,
      logout,
      testConnection,
    ]
  );

  return (
    <WorkspaceAuthContext.Provider value={contextValue}>
      {children}
    </WorkspaceAuthContext.Provider>
  );
};

export const useWorkspaceAuth = () => {
  const context = useContext(WorkspaceAuthContext);
  if (!context) {
    throw new Error('useWorkspaceAuth must be used within a WorkspaceAuthProvider');
  }
  return context;
};
