/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  DEFAULT_TEACHER,
  getTeacherAvatar,
  deriveSchoolFromEmail,
  getCachedAccessToken,
  setCachedAccessToken,
  clearAuthSession,
  googleSignIn,
  signInWithGoogleIdToken,
  signInWithGoogleIdentityServices,
  requestGoogleAccessToken,
  logoutUser,
  initAuth,
  WORKSPACE_SCOPES,
  isGoogleSessionExpired,
  isValidGoogleAccessToken,
  renewGoogleSessionSilently,
} from '../services/workspace/googleAuth';
import { TeacherProfile } from '../types';
import { api } from '../services/api';
import { firestoreSync } from '../services/firestoreSync';
import { sheetsSyncQueue } from '../services/workspace/sheetsSyncQueue';

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

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('docencia_landing_theme', next ? 'dark' : 'light');
      }
      return next;
    });
  };

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
        const urlParams = new URLSearchParams(window.location.search);
        const urlAuthEmail = urlParams.get('authEmail');

        const isSessionActive =
          sessionStorage.getItem('docencia_session_active') === 'true' ||
          localStorage.getItem('docencia_session_active') === 'true' ||
          Boolean(urlAuthEmail);

        if (isSessionActive) {
          const saved =
            sessionStorage.getItem('docencia_user_profile') ||
            localStorage.getItem('docencia_user_profile');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && (parsed.email || parsed.id)) return parsed;
          }

          if (urlAuthEmail) {
            const cleanEmail = urlAuthEmail.trim().toLowerCase();
            const teacherName = cleanEmail.split('@')[0]
              .split(/[._-]/)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ') || 'Docente';
            const fallbackProfile: TeacherProfile = {
              id: `user-${cleanEmail}`,
              name: `Prof. ${teacherName}`,
              email: cleanEmail,
              avatar: getTeacherAvatar(teacherName, cleanEmail),
              role: 'Docente Titular',
              school: deriveSchoolFromEmail(cleanEmail),
              permissions: DEFAULT_TEACHER.permissions,
              scopes: WORKSPACE_SCOPES,
            };
            sessionStorage.setItem('docencia_session_active', 'true');
            sessionStorage.setItem('docencia_user_profile', JSON.stringify(fallbackProfile));
            localStorage.setItem('docencia_session_active', 'true');
            localStorage.setItem('docencia_user_profile', JSON.stringify(fallbackProfile));
            return fallbackProfile;
          }
        }
      } catch (_) {}
    }
    return null;
  });
  const [mode, setMode] = useState<'connected' | 'disconnected'>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const isLogged =
        sessionStorage.getItem('docencia_session_active') === 'true' ||
        localStorage.getItem('docencia_session_active') === 'true' ||
        Boolean(urlParams.get('authEmail'));
      return isLogged ? 'connected' : 'disconnected';
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

  const dismissTokenExpiryBanner = () => {
    setIsTokenExpired(false);
  };

  const renewGoogleSession = async (): Promise<boolean> => {
    try {
      const emailHint = user?.email || undefined;
      const gsiRes = await signInWithGoogleIdentityServices(emailHint, {
        prompt: emailHint ? '' : 'select_account',
      });
      if (gsiRes?.accessToken && isValidGoogleAccessToken(gsiRes.accessToken)) {
        setToken(gsiRes.accessToken);
        setIsTokenExpired(false);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Renew Google session error:', err);
      return false;
    }
  };

  const services: ServiceStatus[] = [
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
      id: 'user_profile',
      name: 'Google Identity',
      scope: 'https://www.googleapis.com/auth/userinfo.profile',
      active: mode !== 'disconnected',
      color: '#ea4335',
      iconName: 'UserCheck',
      description: 'Autenticación institucional de cuenta de profesor.',
    },
  ];

  // Check auth on startup (scoped to this browser's active teacher email)
  useEffect(() => {
    const isLocalActive =
      typeof window !== 'undefined' &&
      (sessionStorage.getItem('docencia_session_active') === 'true' ||
        localStorage.getItem('docencia_session_active') === 'true');
    const savedEmail =
      typeof window !== 'undefined'
        ? (
            sessionStorage.getItem('docencia_teacher_email') ||
            localStorage.getItem('docencia_teacher_email') ||
            ''
          ).trim()
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
              localStorage.setItem('docencia_session_active', 'true');
              localStorage.setItem('docencia_user_profile', JSON.stringify(data.user));
              localStorage.setItem('docencia_teacher_email', data.user.email);
            }
          }
        })
        .catch((err) => console.log('Session check:', err));
    }

    const unsubscribe = initAuth(
      (authUser, accessToken) => {
        const isSessionActive =
          typeof window !== 'undefined' &&
          (sessionStorage.getItem('docencia_session_active') === 'true' ||
            localStorage.getItem('docencia_session_active') === 'true');
        if (isSessionActive) {
          setToken(accessToken);
          setMode('connected');
          const teacherEmail = (authUser.email || '').trim().toLowerCase();
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
            localStorage.setItem('docencia_user_profile', JSON.stringify(newProfile));
          }
        }
      },
      () => {
        // Not authenticated
      }
    );

    return () => unsubscribe();
  }, []);

  const loginWithGoogleIdToken = async (idToken: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await signInWithGoogleIdToken(idToken);
      setToken(result.accessToken);
      setUser(result.profile);
      setMode('connected');
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        sessionStorage.setItem('docencia_teacher_email', result.profile.email);
        localStorage.setItem('docencia_session_active', 'true');
        localStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        localStorage.setItem('docencia_teacher_email', result.profile.email);
      }
      return result.profile;
    } catch (err: any) {
      console.error('Login with Google ID token error:', err);
      setLoginError(err?.message || 'Error al autenticar cuenta de Google');
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const requestAccessToken = async (): Promise<string> => {
    const liveToken = await requestGoogleAccessToken();
    if (liveToken) {
      setToken(liveToken);
      setMode('connected');
    }
    return liveToken;
  };

  const loginWithGoogle = async (preferredEmail?: string): Promise<string | null> => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await googleSignIn(preferredEmail);
      setToken(result.accessToken);
      setUser(result.profile);
      setMode('connected');
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        sessionStorage.setItem('docencia_teacher_email', result.profile.email);
        localStorage.setItem('docencia_session_active', 'true');
        localStorage.setItem('docencia_user_profile', JSON.stringify(result.profile));
        localStorage.setItem('docencia_teacher_email', result.profile.email);
      }

      try {
        await api.syncAuthSession({
          uid: result.profile.id || 'user-google',
          email: result.profile.email,
          name: result.profile.name,
          avatar: result.profile.avatar,
          token: result.accessToken,
          scopes: result.profile.scopes || WORKSPACE_SCOPES,
          school: result.profile.school,
        });
      } catch (_) {}

      return result.accessToken;
    } catch (err: any) {
      if (err?.code === 'auth/unauthorized-domain-needs-email' || err?.message?.includes('UNAUTHORIZED_DOMAIN_NEEDS_EMAIL')) {
        throw err;
      }
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized-domain')) {
        // Handled via fallback profile
        return null;
      }
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
  };

  const loginWithEmail = async (email: string, _password?: string, name?: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const teacherName = name || cleanEmail.split('@')[0]
        .split(/[._-]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Docente';

      const derivedSchool = deriveSchoolFromEmail(cleanEmail);

      let consistentId = 'teacher_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
      if (typeof window !== 'undefined') {
        try {
          const prevRaw = localStorage.getItem('docencia_user_profile');
          if (prevRaw) {
            const prev = JSON.parse(prevRaw);
            if (prev?.email === cleanEmail && prev?.id && !String(prev.id).startsWith('user-')) {
              consistentId = prev.id;
            }
          }
        } catch (_) {}
      }

      const teacherProfile: TeacherProfile = {
        id: consistentId,
        name: teacherName.startsWith('Prof.') ? teacherName : `Prof. ${teacherName}`,
        email: cleanEmail,
        avatar: getTeacherAvatar(teacherName, cleanEmail),
        role: 'Docente Titular',
        school: derivedSchool,
        permissions: DEFAULT_TEACHER.permissions,
        scopes: WORKSPACE_SCOPES,
      };

      setCachedAccessToken(null);
      setToken(null);
      setUser(teacherProfile);
      setMode('connected');

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('docencia_session_active', 'true');
        sessionStorage.setItem('docencia_user_profile', JSON.stringify(teacherProfile));
        sessionStorage.setItem('docencia_teacher_email', cleanEmail);
        localStorage.setItem('docencia_session_active', 'true');
        localStorage.setItem('docencia_user_profile', JSON.stringify(teacherProfile));
        localStorage.setItem('docencia_teacher_email', cleanEmail);
      }

      await api.syncAuthSession({
        uid: teacherProfile.id || 'user-inst',
        email: teacherProfile.email,
        name: teacherProfile.name,
        avatar: teacherProfile.avatar,
        token: null,
        scopes: WORKSPACE_SCOPES,
        school: teacherProfile.school,
      });
    } catch (err: any) {
      console.error('Login with email error:', err);
      setLoginError(err?.message || 'Error al conectar con la cuenta');
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const updateUserProfile = async (updated: Partial<TeacherProfile>) => {
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
      localStorage.setItem('docencia_user_profile', JSON.stringify(newProfile));
      localStorage.setItem('docencia_teacher_email', cleanEmail);
    }
    await api.syncAuthSession({
      uid: newProfile.id || 'user-docente',
      email: newProfile.email,
      name: newProfile.name,
      avatar: newProfile.avatar,
      token: token || 'token_updated',
      scopes: WORKSPACE_SCOPES,
    });
  };



  const logout = async () => {
    const currentEmail = user?.email;
    try {
      sheetsSyncQueue.flushAllPending();
    } catch (_) {}
    firestoreSync.clearCaches();
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('docencia_session_active');
      sessionStorage.removeItem('docencia_user_profile');
      sessionStorage.removeItem('docencia_teacher_email');
      localStorage.removeItem('docencia_user_profile');
      localStorage.removeItem('docencia_session_active');
      localStorage.removeItem('docencia_teacher_email');
    }
    try {
      await api.logoutAuthSession(currentEmail);
      await logoutUser();
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setToken(null);
    setUser(null);
    setMode('disconnected');
  };

  const testConnection = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/workspace/config');
      return res.ok;
    } catch {
      return false;
    }
  };

  return (
    <WorkspaceAuthContext.Provider
      value={{
        user,
        mode,
        token,
        services,
        scopes: WORKSPACE_SCOPES,
        permissions: user?.permissions || DEFAULT_TEACHER.permissions || [],
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
      }}
    >
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
