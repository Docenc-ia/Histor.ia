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

// Token storage keys for session persistence in sessionStorage + memory (never persisted on disk in localStorage)
const TOKEN_STORAGE_KEY = 'docencia_workspace_access_token';
const TOKEN_EXPIRY_KEY = 'docencia_workspace_token_expires_at';
const TOKEN_ISSUED_KEY = 'docencia_workspace_token_issued_at';
const TOKEN_SYNC_CHANNEL_NAME = 'docencia_workspace_token_sync';
const TOKEN_LIFETIME_MS = 59 * 60 * 1000; // 59 minutes threshold (tokens last 60m)

let cachedAccessToken: string | null = null;
let tokenIssuedAt: number | null = null;
let tokenExpiresAt: number | null = null;
let isSigningIn = false;
let hasRequestedTokenFromPeers = false;
let tokenSyncChannel: BroadcastChannel | null = null;

// User gesture tracking to prevent popup-blocked errors when calling GIS requestAccessToken
let lastUserGestureTime = 0;
if (typeof window !== 'undefined') {
  const markGesture = () => {
    lastUserGestureTime = Date.now();
  };
  window.addEventListener('pointerdown', markGesture, { capture: true, passive: true });
  window.addEventListener('click', markGesture, { capture: true, passive: true });
  window.addEventListener('keydown', markGesture, { capture: true, passive: true });
}

export const hasRecentUserGesture = (): boolean => {
  return typeof window !== 'undefined' && Date.now() - lastUserGestureTime < 3500;
};

export const getActiveTeacherEmail = (): string => {
  if (typeof window === 'undefined') return '';
  return (
    sessionStorage.getItem('docencia_teacher_email') ||
    localStorage.getItem('docencia_teacher_email') ||
    ''
  ).trim().toLowerCase();
};

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
    t.startsWith('ya29.inst_') ||
    t.startsWith('ya29.mock_') ||
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
  if (domain.includes('fds-esc.edu.ar')) {
    return 'FDS - Educación Secundaria';
  }
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

const purgeLegacyLocalStorageTokens = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_ISSUED_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch (_) {}
};

export const isGoogleSessionExpired = (): boolean => {
  if (typeof window === 'undefined') return false;
  const isSessionActive =
    sessionStorage.getItem('docencia_session_active') === 'true' ||
    localStorage.getItem('docencia_session_active') === 'true';
  if (!isSessionActive) return false;

  const storedExpiry =
    tokenExpiresAt ||
    Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  // Only report expired if a Google OAuth token was actually issued and its expiry timestamp has passed
  if (!storedExpiry) return false;
  return Date.now() > storedExpiry;
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

const encodeStoredToken = (rawToken: string): string => {
  try {
    return 'enc1:' + btoa(encodeURIComponent(rawToken));
  } catch {
    return rawToken;
  }
};

const decodeStoredToken = (storedVal: string | null): string | null => {
  if (!storedVal) return null;
  if (storedVal.startsWith('enc1:')) {
    try {
      return decodeURIComponent(atob(storedVal.slice(5)));
    } catch {
      return null;
    }
  }
  return storedVal;
};

let lastLinkedFirebaseToken: string | null = null;

const syncFirebaseAuthWithAccessToken = (accessToken: string): void => {
  if (!accessToken || !isValidGoogleAccessToken(accessToken)) return;
  if (lastLinkedFirebaseToken === accessToken && auth.currentUser) return;
  lastLinkedFirebaseToken = accessToken;
  try {
    const cred = GoogleAuthProvider.credential(null, accessToken);
    signInWithCredential(auth, cred).catch(() => {});
  } catch (_) {}
};

const setupCrossTabTokenSync = (): void => {
  if (typeof window === 'undefined' || tokenSyncChannel) return;
  if (!('BroadcastChannel' in window)) return;

  try {
    tokenSyncChannel = new BroadcastChannel(TOKEN_SYNC_CHANNEL_NAME);
    tokenSyncChannel.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'REQUEST_TOKEN') {
        const currentToken = cachedAccessToken || decodeStoredToken(sessionStorage.getItem(TOKEN_STORAGE_KEY));
        const currentExpiry = tokenExpiresAt || Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
        const currentIssued = tokenIssuedAt || Number(sessionStorage.getItem(TOKEN_ISSUED_KEY) || Date.now());
        if (currentToken && isValidGoogleAccessToken(currentToken) && (!currentExpiry || Date.now() < currentExpiry)) {
          try {
            tokenSyncChannel?.postMessage({
              type: 'SHARE_TOKEN',
              token: currentToken,
              issuedAt: currentIssued,
              expiresAt: currentExpiry || (Date.now() + TOKEN_LIFETIME_MS),
              teacherEmail: getActiveTeacherEmail(),
            });
          } catch (_) {}
        }
      } else if (data.type === 'SHARE_TOKEN' && data.token && isValidGoogleAccessToken(data.token)) {
        const now = Date.now();
        const incomingExpiry = Number(data.expiresAt) || (now + TOKEN_LIFETIME_MS);
        const incomingIssued = Number(data.issuedAt) || now;
        if (now < incomingExpiry && cachedAccessToken !== data.token) {
          cachedAccessToken = data.token;
          tokenIssuedAt = incomingIssued;
          tokenExpiresAt = incomingExpiry;
          try {
            sessionStorage.setItem(TOKEN_STORAGE_KEY, encodeStoredToken(data.token));
            sessionStorage.setItem(TOKEN_ISSUED_KEY, String(incomingIssued));
            sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(incomingExpiry));
            if (data.teacherEmail) {
              sessionStorage.setItem('docencia_teacher_email', String(data.teacherEmail).trim().toLowerCase());
            }
          } catch (_) {}
          syncFirebaseAuthWithAccessToken(data.token);
          window.dispatchEvent(
            new CustomEvent('google_session_renewed', { detail: { token: data.token } })
          );
        }
      } else if (data.type === 'CLEAR_TOKEN') {
        cachedAccessToken = null;
        tokenIssuedAt = null;
        tokenExpiresAt = null;
        lastLinkedFirebaseToken = null;
        try {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          sessionStorage.removeItem(TOKEN_ISSUED_KEY);
          sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
          purgeLegacyLocalStorageTokens();
        } catch (_) {}
        window.dispatchEvent(new CustomEvent('google_session_cleared'));
      }
    };
  } catch (_) {}
};

// Initialize BroadcastChannel listener on module load in browser
if (typeof window !== 'undefined') {
  setupCrossTabTokenSync();
}

export const getCachedAccessToken = (): string | null => {
  // 1. In-memory fast path
  if (cachedAccessToken && isValidGoogleAccessToken(cachedAccessToken)) {
    if (tokenIssuedAt && Date.now() - tokenIssuedAt > TOKEN_LIFETIME_MS) {
      const storedExpiry =
        tokenExpiresAt ||
        (typeof window !== 'undefined' ? Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0) : 0);
      if (storedExpiry && Date.now() > storedExpiry) {
        cachedAccessToken = null;
        tokenIssuedAt = null;
        tokenExpiresAt = null;
        try {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          sessionStorage.removeItem(TOKEN_ISSUED_KEY);
          sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
          purgeLegacyLocalStorageTokens();
        } catch (_) {}
        return null;
      }
    }
    return cachedAccessToken;
  }

  // 2. SessionStorage fallback (survives F5 page reload; migrates & purges any legacy localStorage token once)
  if (typeof window !== 'undefined') {
    setupCrossTabTokenSync();
    try {
      let rawStored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      let storedIssued = Number(sessionStorage.getItem(TOKEN_ISSUED_KEY) || 0);
      let storedExpiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);

      // One-time seamless migration from legacy localStorage if present, followed by immediate purge
      const legacyRaw = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (legacyRaw) {
        if (!rawStored) {
          rawStored = legacyRaw;
          storedIssued = Number(localStorage.getItem(TOKEN_ISSUED_KEY) || Date.now());
          storedExpiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || (Date.now() + TOKEN_LIFETIME_MS));
          sessionStorage.setItem(TOKEN_STORAGE_KEY, rawStored);
          sessionStorage.setItem(TOKEN_ISSUED_KEY, String(storedIssued));
          sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(storedExpiry));
        }
        purgeLegacyLocalStorageTokens();
      }

      const stored = decodeStoredToken(rawStored);

      if (stored && isValidGoogleAccessToken(stored)) {
        const now = Date.now();
        if (!storedExpiry || now < storedExpiry) {
          cachedAccessToken = stored;
          tokenIssuedAt = storedIssued || (now - 5 * 60 * 1000);
          tokenExpiresAt = storedExpiry || (now + TOKEN_LIFETIME_MS);
          syncFirebaseAuthWithAccessToken(stored);
          return cachedAccessToken;
        } else {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          sessionStorage.removeItem(TOKEN_ISSUED_KEY);
          sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
          purgeLegacyLocalStorageTokens();
        }
      } else if (!hasRequestedTokenFromPeers && tokenSyncChannel) {
        // Ask other open tabs for the active session token (e.g. when opening a course in a new tab)
        hasRequestedTokenFromPeers = true;
        try {
          tokenSyncChannel.postMessage({ type: 'REQUEST_TOKEN' });
        } catch (_) {}
      }
    } catch (_) {}
  }

  return null;
};

export const setCachedAccessToken = (
  token: string | null,
  teacherEmail?: string,
  expiresInSeconds?: number
): void => {
  const now = Date.now();
  setupCrossTabTokenSync();
  if (token && isValidGoogleAccessToken(token)) {
    cachedAccessToken = token;
    tokenIssuedAt = now;
    const ttlMs = expiresInSeconds ? Math.max((expiresInSeconds - 60) * 1000, 10 * 60 * 1000) : TOKEN_LIFETIME_MS;
    const expiresAt = now + ttlMs;
    tokenExpiresAt = expiresAt;
    const encoded = encodeStoredToken(token);

    syncFirebaseAuthWithAccessToken(token);

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, encoded);
        sessionStorage.setItem(TOKEN_ISSUED_KEY, String(now));
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
        // Always purge legacy localStorage token entries for XSS/disk protection
        purgeLegacyLocalStorageTokens();

        if (teacherEmail) {
          const cleanEmail = teacherEmail.trim().toLowerCase();
          sessionStorage.setItem('docencia_teacher_email', cleanEmail);
          localStorage.setItem('docencia_teacher_email', cleanEmail);
        }

        tokenSyncChannel?.postMessage({
          type: 'SHARE_TOKEN',
          token,
          issuedAt: now,
          expiresAt,
          teacherEmail: teacherEmail ? teacherEmail.trim().toLowerCase() : getActiveTeacherEmail(),
        });
      } catch (_) {}
    }
  } else if (!token) {
    cachedAccessToken = null;
    tokenIssuedAt = null;
    tokenExpiresAt = null;
    lastLinkedFirebaseToken = null;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem(TOKEN_ISSUED_KEY);
        sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
        purgeLegacyLocalStorageTokens();
        tokenSyncChannel?.postMessage({ type: 'CLEAR_TOKEN' });
      } catch (_) {}
    }
  }
};

export const clearAuthSession = (): void => {
  setCachedAccessToken(null);
};

// Listen to Firebase Auth state (never wipe a valid GIS OAuth token stored in localStorage/sessionStorage)
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  const initialToken = getCachedAccessToken();
  if (initialToken && !auth.currentUser) {
    syncFirebaseAuthWithAccessToken(initialToken);
  }
  return onAuthStateChanged(auth, async (user: User | null) => {
    const activeToken = getCachedAccessToken();
    if (user && activeToken) {
      if (onAuthSuccess) onAuthSuccess(user, activeToken);
    } else if (!isSigningIn && !activeToken) {
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

// Automatically selects the matching OAuth Client ID for the current origin so that
// firebase-applet-config.json remains 100% intact for Vercel and the primary account,
// while also working out-of-the-box in this preview environment.
export const getEffectiveOAuthClientId = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (host.includes('xanf7lgydk64d73ob33wqe')) {
      return '708929916247-j4j7vl4vipn2to5vlvh7us3jl7td29mi.apps.googleusercontent.com';
    }
  }
  return firebaseConfig.oAuthClientId;
};

// Attempt Google Sign-In with Google Identity Services (GSI) - opens Google account chooser for ANY user
export const signInWithGoogleIdentityServices = (
  preferredEmail?: string,
  options?: { prompt?: string }
): Promise<{ accessToken: string; profile: TeacherProfile }> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window not available'));
    }
    const google = (window as any).google;
    const clientId = getEffectiveOAuthClientId();
    if (!google?.accounts?.oauth2 || !clientId) {
      return reject(new Error('Google Identity Services no está listo. Verifica tu conexión.'));
    }

    const cleanHint = (preferredEmail || getActiveTeacherEmail() || '').trim().toLowerCase() || undefined;
    const promptMode = options?.prompt !== undefined ? options.prompt : (cleanHint ? '' : 'select_account');

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: WORKSPACE_SCOPES.join(' '),
        prompt: promptMode,
        ...(cleanHint ? { hint: cleanHint } : {}),
        callback: async (tokenResponse: any) => {
          if (tokenResponse?.error) {
            return reject(new Error(tokenResponse.error_description || tokenResponse.error || 'Error en Google OAuth'));
          }
          try {
            const accessToken = tokenResponse.access_token;
            if (!accessToken || !isValidGoogleAccessToken(accessToken)) {
              return reject(new Error('No se recibió un token de acceso OAuth 2.0 válido de Google'));
            }
            const expiresIn = Number(tokenResponse.expires_in) || 3540;

            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const userInfo = await res.json().catch(() => ({}));
            const userEmail = (userInfo.email || cleanHint || '').trim().toLowerCase();
            const rawName = userInfo.name || (userEmail ? userEmail.split('@')[0].split(/[._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Docente');
            const displayName = rawName.startsWith('Prof.') ? rawName : `Prof. ${rawName}`;
            const derivedSchool = deriveSchoolFromEmail(userEmail);

            setCachedAccessToken(accessToken, userEmail, expiresIn);

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

            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('google_session_renewed', { detail: { token: accessToken } })
              );
            }

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

      client.requestAccessToken({
        prompt: promptMode,
        ...(cleanHint ? { hint: cleanHint } : {}),
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Requests or returns a valid, authentic Google OAuth access token for Workspace APIs (Sheets, Drive, etc.)
export const requestGoogleAccessToken = async (forceRefresh = false, preferredEmail?: string): Promise<string> => {
  if (
    !forceRefresh &&
    cachedAccessToken &&
    isValidGoogleAccessToken(cachedAccessToken) &&
    !isGoogleSessionExpired()
  ) {
    return cachedAccessToken;
  }

  // 1. Attempt proactive silent renewal first without opening popup
  const silentToken = await renewGoogleSessionSilently(preferredEmail);
  if (silentToken && isValidGoogleAccessToken(silentToken)) {
    return silentToken;
  }

  // 2. Prioritize Google Identity Services (GSI) OAuth 2.0 flow
  if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
    try {
      const emailHint = preferredEmail || getActiveTeacherEmail();
      const gsiRes = await signInWithGoogleIdentityServices(emailHint, {
        prompt: emailHint ? '' : 'select_account',
      });
      if (gsiRes?.accessToken && isValidGoogleAccessToken(gsiRes.accessToken)) {
        setCachedAccessToken(gsiRes.accessToken, gsiRes.profile?.email);
        return gsiRes.accessToken;
      }
    } catch (gsiErr: any) {
      console.warn('GSI token request notice:', gsiErr);
      return '';
    }
  }

  return '';
};

export const requestAccessToken = requestGoogleAccessToken;

// Sign in with Google OAuth popup (prompting ANY user to select/log in to their Google account)
export const googleSignIn = async (preferredEmail?: string): Promise<{ user?: User; accessToken: string; profile: TeacherProfile }> => {
  isSigningIn = true;
  try {
    // 1. Try Google Identity Services (GSI) first if available in window (avoids Firebase domain restrictions)
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
      try {
        const gsiResult = await signInWithGoogleIdentityServices(preferredEmail);
        if (gsiResult?.accessToken && isValidGoogleAccessToken(gsiResult.accessToken)) {
          setCachedAccessToken(gsiResult.accessToken, gsiResult.profile?.email);
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

      const userEmail = (result.user.email || preferredEmail || '').trim().toLowerCase();
      setCachedAccessToken(token, userEmail);

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
  clearAuthSession();
  await api.logoutAuth();
};

/**
 * Refreshes Google OAuth 2.0 access token using Google Identity Services.
 * Passes prompt: '' and the teacher's email hint.
 * NOTE: Modern browsers strictly require a user gesture (click/tap) to open the OAuth popup.
 * If called without a recent user gesture, it gracefully returns null instead of triggering
 * the browser's popup blocker.
 */
let inFlightSilentRenewalPromise: Promise<string | null> | null = null;

export const renewGoogleSessionSilently = async (userEmail?: string): Promise<string | null> => {
  if (typeof window === 'undefined') return null;

  // Deduplicate concurrent renewal requests
  if (inFlightSilentRenewalPromise) {
    return inFlightSilentRenewalPromise;
  }

  // Modern browsers require a user gesture to open popups.
  // Do not attempt window.open without a user gesture as it will be blocked.
  if (!hasRecentUserGesture()) {
    return null;
  }

  const google = (window as any).google;
  const clientId = getEffectiveOAuthClientId();
  if (!google?.accounts?.oauth2 || !clientId) return null;

  const email = (userEmail || getActiveTeacherEmail()).trim().toLowerCase();

  inFlightSilentRenewalPromise = new Promise<string | null>((resolve) => {
    try {
      let isSettled = false;
      const finish = (val: string | null) => {
        if (isSettled) return;
        isSettled = true;
        inFlightSilentRenewalPromise = null;
        resolve(val);
      };

      const timeoutId = setTimeout(() => {
        finish(null);
      }, 7000);

      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: WORKSPACE_SCOPES.join(' '),
        prompt: '',
        ...(email ? { hint: email } : {}),
        callback: async (tokenResponse: any) => {
          clearTimeout(timeoutId);

          if (tokenResponse?.error || !tokenResponse?.access_token) {
            finish(null);
            return;
          }
          const freshToken = tokenResponse.access_token;
          if (isValidGoogleAccessToken(freshToken)) {
            const expiresIn = Number(tokenResponse.expires_in) || 3540;
            setCachedAccessToken(freshToken, email, expiresIn);
            window.dispatchEvent(
              new CustomEvent('google_session_renewed', { detail: { token: freshToken } })
            );
            finish(freshToken);
          } else {
            finish(null);
          }
        },
        error_callback: () => {
          clearTimeout(timeoutId);
          finish(null);
        },
      });

      client.requestAccessToken({
        prompt: '',
        ...(email ? { hint: email } : {}),
      });
    } catch (_) {
      inFlightSilentRenewalPromise = null;
      resolve(null);
    }
  });

  return inFlightSilentRenewalPromise;
};

/**
 * Universal fetch wrapper for Google Workspace APIs (Sheets, Drive, Calendar, Classroom, Gmail, Docs)
 * Automatically injects the active Google OAuth token.
 * If an active user gesture triggered this request and a 401 is received, it attempts automatic renewal.
 */
export const fetchGoogleApiWithRetry = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  providedToken?: string
): Promise<Response> => {
  let activeToken = providedToken || getCachedAccessToken();

  const buildHeaders = (tok: string | null): Headers => {
    const headers = new Headers(init.headers || {});
    if (tok && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${tok}`);
    }
    return headers;
  };

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: buildHeaders(activeToken),
    });
  } catch (networkErr) {
    throw networkErr;
  }

  // Intercept 401 Unauthorized (Google token expired or revoked)
  if (response.status === 401) {
    console.warn('Google API returned 401 Unauthorized.');
    // Only attempt interactive popup renewal if this request was triggered by a direct user click/gesture
    if (hasRecentUserGesture()) {
      const freshToken = await renewGoogleSessionSilently().catch(() => null);
      if (freshToken && isValidGoogleAccessToken(freshToken)) {
        console.info('Token renewed via user gesture. Retrying request...');
        activeToken = freshToken;
        response = await fetch(input, {
          ...init,
          headers: buildHeaders(freshToken),
        });
        return response;
      }
    }
    notifyGoogleSessionExpired('http_401_token_expired');
  }

  return response;
};

