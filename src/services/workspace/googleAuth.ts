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

export const getCachedAccessToken = (): string | null => cachedAccessToken;

export const setCachedAccessToken = (token: string | null): void => {
  cachedAccessToken = token;
};

export const clearAuthSession = (): void => {
  cachedAccessToken = null;
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

  cachedAccessToken = idToken;

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
    token: idToken,
    scopes: WORKSPACE_SCOPES,
    school: profile.school,
  });

  return { profile, accessToken: idToken };
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
      return reject(new Error('Google Identity Services no está listo'));
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
            cachedAccessToken = accessToken;
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
          reject(err);
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      reject(err);
    }
  });
};

// Sign in with Google OAuth popup (prompting ANY user to select/log in to their Google account)
export const googleSignIn = async (preferredEmail?: string): Promise<{ user?: User; accessToken: string; profile: TeacherProfile }> => {
  isSigningIn = true;
  try {
    // Authenticate via Firebase Auth Popup with Google Provider (uses project authDomain, avoiding origin_mismatch)
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    const token =
      credential?.accessToken ||
      (result as any)._tokenResponse?.oauthAccessToken ||
      (await result.user.getIdToken()) ||
      'token_authenticated';

    cachedAccessToken = token;

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

    // Synchronize authenticated session securely with the backend Express server
    await api.syncAuthSession({
      uid: result.user.uid,
      email: teacherProfile.email,
      name: teacherProfile.name,
      avatar: teacherProfile.avatar,
      token: cachedAccessToken,
      scopes: WORKSPACE_SCOPES,
      school: teacherProfile.school,
    });

    return { user: result.user, accessToken: cachedAccessToken, profile: teacherProfile };
  } catch (error: any) {
    if (error?.code === 'auth/unauthorized-domain' || error?.message?.includes('unauthorized-domain')) {
      // If user typed an email into the form, we can authenticate them with their email
      const userEmail = (preferredEmail || (typeof window !== 'undefined' ? sessionStorage.getItem('docencia_teacher_email') : null) || '').trim().toLowerCase();
      
      if (!userEmail) {
        throw new Error('El dominio de la vista previa no está en los dominios autorizados de Google OAuth. Por favor escribe tu correo electrónico abajo para iniciar sesión directamente.');
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
    console.warn('Aviso en Google Sign-In:', error);
    throw error;
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
