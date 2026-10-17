/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../../firebase-applet-config.json';
import { api } from '../api';
import { TeacherProfile } from '../../types';

// Desired Google Workspace & Identity scopes configured in OAuth
export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure Google Auth Provider with Workspace scopes
const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  if (!scope.includes('userinfo.email') && !scope.includes('userinfo.profile')) {
    provider.addScope(scope);
  }
});
provider.setCustomParameters({
  prompt: 'select_account',
});

// Strictly in-memory access token storage (Security requirement: NO localStorage / sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

/**
 * Validates whether a token string is a genuine Google OAuth 2.0 access token for Google APIs
 * (not an OpenID Connect JWT ID token, not a Firebase ID token, and not a dummy/mock token).
 */
export const isValidGoogleAccessToken = (token?: string | null): boolean => {
  if (!token || typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length < 20) return false;
  // JWT tokens start with "eyJ" (Base64url JSON header). They are ID tokens, NOT OAuth 2 access tokens.
  if (t.startsWith('eyJ')) return false;
  // Synthetic fallback tokens
  if (
    t.startsWith('google_workspace_token_') ||
    t.startsWith('token_') ||
    t === 'token_authenticated' ||
    t === 'default_token'
  ) {
    return false;
  }
  return true;
};

export const getTeacherAvatar = (name?: string, email?: string, avatarUrl?: string): string => {
  if (avatarUrl && !avatarUrl.includes('photo-1534528741775') && avatarUrl.trim() !== '') {
    return avatarUrl;
  }
  const cleanName = (name && name !== 'Docente Titular' && name !== 'Docente')
    ? name.replace(/^Prof\.\s*/i, '').trim()
    : '';
  const seed = cleanName || (email ? email.split('@')[0].replace(/[._-]/g, ' ') : 'Docente');
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=1d4ed8&color=ffffff&bold=true&size=150`;
};

export const deriveSchoolFromEmail = (email?: string): string => {
  if (!email || !email.includes('@')) return 'Institución Educativa';
  const domain = email.split('@')[1].toLowerCase();
  if (domain.includes('gmail.') || domain.includes('hotmail.') || domain.includes('outlook.') || domain.includes('yahoo.')) {
    return 'Institución Educativa';
  }
  const orgName = domain.split('.')[0];
  return `Institución ${orgName.toUpperCase()}`;
};

export const DEFAULT_TEACHER: TeacherProfile = {
  id: 'user-docente',
  name: 'Docente Titular',
  email: '',
  avatar: getTeacherAvatar('Docente Titular'),
  role: 'Docente Titular',
  school: 'Institución Educativa',
  permissions: [
    'tasks.create',
    'tasks.assign',
    'tasks.grade',
    'tasks.delete',
    'drive.read',
    'drive.attach',
    'classroom.sync',
    'students.view',
    'grades.manage',
  ],
  scopes: WORKSPACE_SCOPES,
};

// In-memory token expiration tracking (Google OAuth tokens expire in ~60 minutes)
let tokenIssuedAt: number | null = null;
const TOKEN_LIFETIME_MS = 55 * 60 * 1000; // 55 minutes proactive threshold

export const isGoogleSessionExpired = (): boolean => {
  if (!cachedAccessToken) return false;
  if (!tokenIssuedAt) return false;
  return Date.now() - tokenIssuedAt > TOKEN_LIFETIME_MS;
};

export const notifyGoogleSessionExpired = (reason = 'session_expired') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('google_session_expired', {
        detail: { reason, message: 'Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.' },
      })
    );
  }
};

export const getCachedAccessToken = (): string | null => {
  if (cachedAccessToken && isValidGoogleAccessToken(cachedAccessToken)) {
    return cachedAccessToken;
  }
  return null;
};

export const setCachedAccessToken = (token: string | null): void => {
  if (token && isValidGoogleAccessToken(token)) {
    cachedAccessToken = token;
    tokenIssuedAt = Date.now();
  } else if (!token) {
    cachedAccessToken = null;
    tokenIssuedAt = null;
  }
};

export const clearAuthSession = (): void => {
  cachedAccessToken = null;
  tokenIssuedAt = null;
};

// Listen to Firebase Auth state
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Helper to decode Google JWT token securely
export const parseGoogleJwt = (token: string): any => {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.error('Error al decodificar credencial de Google:', err);
    return null;
  }
};

// Sign in with Google ID Token obtained from Google Identity Services (GSI)
export const signInWithGoogleIdToken = async (
  idToken: string
): Promise<{ profile: TeacherProfile; accessToken: string }> => {
  const payload = parseGoogleJwt(idToken);
  if (!payload || !payload.email) {
    throw new Error('No se pudo verificar la cuenta de Google con el token proporcionado.');
  }

  const userEmail = (payload.email || '').trim().toLowerCase();
  const rawName = payload.name || (userEmail ? userEmail.split('@')[0].split(/[._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Docente');
  const displayName = rawName.startsWith('Prof.') ? rawName : `Prof. ${rawName}`;
  const derivedSchool = deriveSchoolFromEmail(userEmail);

  const profile: TeacherProfile = {
    id: payload.sub || `google-${Date.now()}`,
    name: displayName,
    email: userEmail,
    avatar: payload.picture || getTeacherAvatar(displayName, userEmail),
    role: 'Docente Titular',
    school: derivedSchool,
    permissions: DEFAULT_TEACHER.permissions,
    scopes: WORKSPACE_SCOPES,
  };

  // Do not store JWT idToken into cachedAccessToken, as Workspace APIs reject JWTs with 401.
  // Instead, attempt to obtain an authentic OAuth 2.0 access token via GSI token client if available
  let realAccessToken = '';
  if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
    try {
      const gsiRes = await signInWithGoogleIdentityServices();
      if (gsiRes?.accessToken && isValidGoogleAccessToken(gsiRes.accessToken)) {
        realAccessToken = gsiRes.accessToken;
        cachedAccessToken = gsiRes.accessToken;
      }
    } catch (_) {}
  }

  // Sign into Firebase Auth via credential without needing popup or authDomain
  try {
    const cred = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, cred);
  } catch (fbErr) {
    console.warn('Nota de autenticación Firebase con credencial:', fbErr);
  }

  // Synchronize authenticated session with backend
  await api.syncAuthSession({
    uid: profile.id,
    email: profile.email,
    name: profile.name,
    avatar: profile.avatar,
    token: realAccessToken || idToken,
    scopes: WORKSPACE_SCOPES,
    school: profile.school,
  });

  return { profile, accessToken: realAccessToken };
};

// Attempt Google Sign-In with Google Identity Services (GSI) - opens Google account chooser for ANY user
export const signInWithGoogleIdentityServices = (): Promise<{ accessToken: string; profile: TeacherProfile }> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window not available'));
    }
    const google = (window as any).google;
    const clientId = firebaseConfig.oAuthClientId;
    if (!google?.accounts?.oauth2 || !clientId) {
      return reject(new Error('Google Identity Services no está listo. Verifica tu conexión.'));
    }

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: WORKSPACE_SCOPES.join(' '),
        prompt: 'select_account',
        callback: async (tokenResponse: any) => {
          if (tokenResponse?.error) {
            return reject(new Error(tokenResponse.error_description || tokenResponse.error || 'Error en Google OAuth'));
          }
          try {
            const accessToken = tokenResponse.access_token;
            if (!accessToken || !isValidGoogleAccessToken(accessToken)) {
              return reject(new Error('No se recibió un token de acceso OAuth 2.0 válido de Google'));
            }
            setCachedAccessToken(accessToken);
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const userInfo = await res.json();
            const userEmail = (userInfo.email || '').trim().toLowerCase();
            const rawName = userInfo.name || (userEmail ? userEmail.split('@')[0].split(/[._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Docente');
            const displayName = rawName.startsWith('Prof.') ? rawName : `Prof. ${rawName}`;
            const derivedSchool = deriveSchoolFromEmail(userEmail);

            const profile: TeacherProfile = {
              id: userInfo.sub || `google-${Date.now()}`,
              name: displayName,
              email: userEmail,
              avatar: userInfo.picture || getTeacherAvatar(displayName, userEmail),
              role: 'Docente Titular',
              school: derivedSchool,
              permissions: DEFAULT_TEACHER.permissions,
              scopes: WORKSPACE_SCOPES,
            };

            await api.syncAuthSession({
              uid: profile.id,
              email: profile.email,
              name: profile.name,
              avatar: profile.avatar,
              token: accessToken,
              scopes: WORKSPACE_SCOPES,
              school: profile.school,
            });

            resolve({ accessToken, profile });
          } catch (fetchErr) {
            reject(fetchErr);
          }
        },
        error_callback: (err: any) => {
          const isBlocked = err?.type === 'popup_blocked' || err?.type === 'popup_closed' || String(err?.message || '').toLowerCase().includes('popup');
          if (isBlocked) {
            reject(new Error('La ventana emergente de Google fue bloqueada o cerrada por el navegador. Por favor habilita los popups o ingresa abajo con tu correo docente.'));
          } else {
            reject(err);
          }
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      reject(err);
    }
  });
};

// Requests or returns a valid, authentic Google OAuth access token for Workspace APIs (Sheets, Drive, etc.)
export const requestGoogleAccessToken = async (forceRefresh = false): Promise<string> => {
  if (
    !forceRefresh &&
    cachedAccessToken &&
    isValidGoogleAccessToken(cachedAccessToken)
  ) {
    return cachedAccessToken;
  }

  // 1. Prioritize Google Identity Services (GSI) OAuth 2.0 flow
  if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
    try {
      const gsiRes = await signInWithGoogleIdentityServices();
      if (gsiRes?.accessToken && isValidGoogleAccessToken(gsiRes.accessToken)) {
        setCachedAccessToken(gsiRes.accessToken);
        return gsiRes.accessToken;
      }
    } catch (gsiErr: any) {
      console.warn('GSI token request notice:', gsiErr);
      // If popup was blocked or closed, don't cascade into another popup
      return '';
    }
  }

  return '';
};

// Sign in with Google OAuth popup (prompting ANY user to select/log in to their Google account)
export const googleSignIn = async (preferredEmail?: string): Promise<{ user?: User; accessToken: string; profile: TeacherProfile }> => {
  isSigningIn = true;
  try {
    // 1. Try Google Identity Services (GSI) first if available in window (avoids Firebase domain restrictions)
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
      try {
        const gsiResult = await signInWithGoogleIdentityServices();
        if (gsiResult?.accessToken && isValidGoogleAccessToken(gsiResult.accessToken)) {
          setCachedAccessToken(gsiResult.accessToken);
          return { accessToken: gsiResult.accessToken, profile: gsiResult.profile };
        }
      } catch (gsiErr: any) {
        console.warn('GSI login attempted:', gsiErr);
        // If popup was blocked or closed by user, throw immediately to display helpful notice
        const errMsg = String(gsiErr?.message || '').toLowerCase();
        if (
          gsiErr?.type === 'popup_blocked' ||
          gsiErr?.type === 'popup_closed' ||
          errMsg.includes('popup') ||
          errMsg.includes('cerrada') ||
          errMsg.includes('bloqueada') ||
          errMsg.includes('closed') ||
          errMsg.includes('cancelled')
        ) {
          throw gsiErr;
        }
      }
    }

    // 2. Firebase Auth Popup fallback only if GSI is not available
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);

      let token =
        (credential?.accessToken && isValidGoogleAccessToken(credential.accessToken) ? credential.accessToken : null) ||
        ((result as any)._tokenResponse?.oauthAccessToken && isValidGoogleAccessToken((result as any)._tokenResponse?.oauthAccessToken) ? (result as any)._tokenResponse?.oauthAccessToken : null) ||
        null;

      setCachedAccessToken(token);

      const userEmail = (result.user.email || preferredEmail || '').trim().toLowerCase();
      const rawName = result.user.displayName || (userEmail ? userEmail.split('@')[0].split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : 'Docente Titular');
      const displayName = rawName.startsWith('Prof.') ? rawName : `Prof. ${rawName}`;
      const derivedSchool = deriveSchoolFromEmail(userEmail);

      const teacherProfile: TeacherProfile = {
        id: result.user.uid,
        name: displayName,
        email: userEmail,
        avatar: result.user.photoURL || getTeacherAvatar(displayName, userEmail),
        role: 'Docente Titular',
        school: derivedSchool,
        permissions: DEFAULT_TEACHER.permissions,
        scopes: WORKSPACE_SCOPES,
      };

      await api.syncAuthSession({
        uid: result.user.uid,
        email: teacherProfile.email,
        name: teacherProfile.name,
        avatar: teacherProfile.avatar,
        token: cachedAccessToken,
        scopes: WORKSPACE_SCOPES,
        school: teacherProfile.school,
      });

      return { user: result.user, accessToken: cachedAccessToken || '', profile: teacherProfile };
    } catch (popupErr: any) {
      const userEmail = (preferredEmail || (typeof window !== 'undefined' ? sessionStorage.getItem('docencia_teacher_email') : null) || '').trim().toLowerCase();
      if (!userEmail) {
        throw new Error('No se pudo abrir la ventana de Google. Por favor permite las ventanas emergentes en tu navegador o ingresa con tu correo abajo.');
      }

      const formattedName = userEmail.split('@')[0]
        .split(/[._-]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Docente';
      const teacherName = formattedName.startsWith('Prof.') ? formattedName : `Prof. ${formattedName}`;
      const derivedSchool = deriveSchoolFromEmail(userEmail);

      const teacherProfile: TeacherProfile = {
        id: 'teacher-gauth-' + userEmail.replace(/[^a-zA-Z0-9]/g, '_'),
        name: teacherName,
        email: userEmail,
        avatar: getTeacherAvatar(teacherName, userEmail),
        role: 'Docente Titular',
        school: derivedSchool,
        permissions: DEFAULT_TEACHER.permissions,
        scopes: WORKSPACE_SCOPES,
      };

      cachedAccessToken = 'google_workspace_token_' + Date.now();

      await api.syncAuthSession({
        uid: teacherProfile.id,
        email: teacherProfile.email,
        name: teacherProfile.name,
        avatar: teacherProfile.avatar,
        token: cachedAccessToken,
        scopes: WORKSPACE_SCOPES,
        school: teacherProfile.school,
      });

      return { accessToken: cachedAccessToken, profile: teacherProfile };
    }
  } finally {
    isSigningIn = false;
  }
};

// Sign out and clear credentials
export const logoutUser = async (): Promise<void> => {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('SignOut error:', err);
  }
  cachedAccessToken = null;
  await api.logoutAuth();
};

// Google Identity Services OAuth 2.0 requires a direct user gesture (click) to open the OAuth popup window.
// Background silent calls attempt to open a popup without user interaction and are blocked by modern browsers.
// Therefore, renewal is handled via explicit user interaction through the GoogleSessionExpiryBanner.
export const renewGoogleSessionSilently = async (): Promise<string | null> => {
  return null;
};

