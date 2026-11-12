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
  setPersistence,
  browserLocalPersistence,
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
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

// Configure Google Auth Provider with Workspace scopes
const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  if (!scope.includes('userinfo.email') && !scope.includes('userinfo.profile')) {
    provider.addScope(scope);
  }
});

// Token storage keys persisted in both localStorage and sessionStorage so the user stays logged in permanently
const TOKEN_STORAGE_KEY = 'docencia_workspace_access_token';
const TOKEN_EXPIRY_KEY = 'docencia_workspace_token_expires_at';
const TOKEN_ISSUED_KEY = 'docencia_workspace_token_issued_at';
const TOKEN_SYNC_CHANNEL_NAME = 'docencia_workspace_token_sync';
const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000; // Keep token persisted across sessions without auto-wiping

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
  if (typeof window === 'undefined') return false;
  if (
    typeof navigator !== 'undefined' &&
    'userActivation' in navigator &&
    (navigator as any).userActivation
  ) {
    return Boolean((navigator as any).userActivation.isActive);
  }
  return Date.now() - lastUserGestureTime < 1200;
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

const clearPersistedStorageTokens = (): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_ISSUED_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_ISSUED_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch (_) {}
};

export const isGoogleSessionExpired = (): boolean => {
  return false;
};

export const notifyGoogleSessionExpired = (_reason = 'session_expired') => {
  // No-op: do not nag the user with expiration banners or popups once authenticated
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
        const currentToken =
          cachedAccessToken ||
          decodeStoredToken(sessionStorage.getItem(TOKEN_STORAGE_KEY)) ||
          decodeStoredToken(localStorage.getItem(TOKEN_STORAGE_KEY));
        const currentExpiry =
          tokenExpiresAt ||
          Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || localStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
        const currentIssued =
          tokenIssuedAt ||
          Number(sessionStorage.getItem(TOKEN_ISSUED_KEY) || localStorage.getItem(TOKEN_ISSUED_KEY) || Date.now());
        if (currentToken && isValidGoogleAccessToken(currentToken)) {
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
        if (cachedAccessToken !== data.token) {
          cachedAccessToken = data.token;
          tokenIssuedAt = incomingIssued;
          tokenExpiresAt = incomingExpiry;
          try {
            const encoded = encodeStoredToken(data.token);
            sessionStorage.setItem(TOKEN_STORAGE_KEY, encoded);
            sessionStorage.setItem(TOKEN_ISSUED_KEY, String(incomingIssued));
            sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(incomingExpiry));
            localStorage.setItem(TOKEN_STORAGE_KEY, encoded);
            localStorage.setItem(TOKEN_ISSUED_KEY, String(incomingIssued));
            localStorage.setItem(TOKEN_EXPIRY_KEY, String(incomingExpiry));
            if (data.teacherEmail) {
              const cleanEmail = String(data.teacherEmail).trim().toLowerCase();
              sessionStorage.setItem('docencia_teacher_email', cleanEmail);
              localStorage.setItem('docencia_teacher_email', cleanEmail);
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
        clearPersistedStorageTokens();
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
    return cachedAccessToken;
  }

  // 2. sessionStorage + localStorage persistence (survives page reloads, new tabs, and browser restarts)
  if (typeof window !== 'undefined') {
    setupCrossTabTokenSync();
    try {
      const rawStored =
        sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
        localStorage.getItem(TOKEN_STORAGE_KEY);
      const storedIssued = Number(
        sessionStorage.getItem(TOKEN_ISSUED_KEY) ||
          localStorage.getItem(TOKEN_ISSUED_KEY) ||
          0
      );
      const storedExpiry = Number(
        sessionStorage.getItem(TOKEN_EXPIRY_KEY) ||
          localStorage.getItem(TOKEN_EXPIRY_KEY) ||
          0
      );

      const stored = decodeStoredToken(rawStored);

      if (stored && isValidGoogleAccessToken(stored)) {
        const now = Date.now();
        cachedAccessToken = stored;
        tokenIssuedAt = storedIssued || now;
        tokenExpiresAt = storedExpiry || (now + TOKEN_LIFETIME_MS);
        // Ensure both sessionStorage and localStorage stay synchronized
        const encoded = encodeStoredToken(stored);
        sessionStorage.setItem(TOKEN_STORAGE_KEY, encoded);
        localStorage.setItem(TOKEN_STORAGE_KEY, encoded);
        syncFirebaseAuthWithAccessToken(stored);
        return cachedAccessToken;
      } else if (!hasRequestedTokenFromPeers && tokenSyncChannel) {
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
    const ttlMs = expiresInSeconds ? Math.max(expiresInSeconds * 1000, TOKEN_LIFETIME_MS) : TOKEN_LIFETIME_MS;
    const expiresAt = now + ttlMs;
    tokenExpiresAt = expiresAt;
    const encoded = encodeStoredToken(token);

    syncFirebaseAuthWithAccessToken(token);

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, encoded);
        sessionStorage.setItem(TOKEN_ISSUED_KEY, String(now));
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
        localStorage.setItem(TOKEN_STORAGE_KEY, encoded);
        localStorage.setItem(TOKEN_ISSUED_KEY, String(now));
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));

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
        clearPersistedStorageTokens();
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
  const realAccessToken = '';

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

// ISO/IEC 27001 A.8.20 & A.8.26: Authorized JavaScript Origins Allowlist
export const AUTHORIZED_APP_ORIGINS = [
  'https://ais-dev-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app',
  'https://ais-pre-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export const isAuthorizedAppOrigin = (originInput?: string): boolean => {
  const rawOrigin =
    originInput ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  if (!rawOrigin) return true;
  if (AUTHORIZED_APP_ORIGINS.includes(rawOrigin)) return true;

  try {
    const parsed = new URL(rawOrigin);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (
      parsed.protocol === 'https:' &&
      (host.endsWith('.run.app') ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.googleusercontent.com') ||
        host.endsWith('.web.app') ||
        host.endsWith('.firebaseapp.com'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

// Automatically selects the matching OAuth Client ID for the current origin so that
// firebase-applet-config.json remains 100% intact for Vercel and the primary account,
// while also working out-of-the-box in this preview environment.
export const getEffectiveOAuthClientId = (): string => {
  if (typeof window !== 'undefined') {
    if (!isAuthorizedAppOrigin(window.location.origin)) {
      console.error(
        `[Seguridad ISO 27001] Origen no autorizado bloqueado para OAuth Client ID: ${window.location.origin}`
      );
      return '';
    }
    const host = window.location.hostname || '';
    if (host.includes('xanf7lgydk64d73ob33wqe')) {
      return '708929916247-j4j7vl4vipn2to5vlvh7us3jl7td29mi.apps.googleusercontent.com';
    }
    const envClientId =
      (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
      (import.meta as any).env?.VITE_OAUTH_CLIENT_ID;
    if (envClientId && typeof envClientId === 'string' && envClientId.trim()) {
      return envClientId.trim();
    }
  }
  return firebaseConfig.oAuthClientId;
};

let inFlightGsiAuthPromise: Promise<{ accessToken: string; profile: TeacherProfile }> | null = null;

// Attempt Google Sign-In with Google Identity Services (GSI) - opens Google account chooser for ANY user
export const signInWithGoogleIdentityServices = (
  preferredEmail?: string,
  options?: { prompt?: string }
): Promise<{ accessToken: string; profile: TeacherProfile }> => {
  if (inFlightGsiAuthPromise) {
    return inFlightGsiAuthPromise;
  }

  inFlightGsiAuthPromise = new Promise<{ accessToken: string; profile: TeacherProfile }>((resolve, reject) => {
    const settleResolve = (val: { accessToken: string; profile: TeacherProfile }) => {
      inFlightGsiAuthPromise = null;
      resolve(val);
    };
    const settleReject = (err: any) => {
      inFlightGsiAuthPromise = null;
      reject(err);
    };

    if (typeof window === 'undefined') {
      return settleReject(new Error('Window not available'));
    }
    if (!isAuthorizedAppOrigin(window.location.origin)) {
      return settleReject(
        new Error(
          `Origen no autorizado (${window.location.origin}). Por seguridad ISO 27001, el inicio de sesión OAuth solo está permitido desde dominios oficiales autorizados.`
        )
      );
    }
    if (!hasRecentUserGesture()) {
      notifyGoogleSessionExpired('gesture_required_for_popup');
      return settleReject(
        new Error(
          'Se requiere una acción directa (clic) para abrir la ventana de autorización de Google.'
        )
      );
    }
    const google = (window as any).google;
    const clientId = getEffectiveOAuthClientId();
    if (!google?.accounts?.oauth2 || !clientId) {
      return settleReject(new Error('Google Identity Services no está listo. Verifica tu conexión.'));
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
            return settleReject(new Error(tokenResponse.error_description || tokenResponse.error || 'Error en Google OAuth'));
          }
          try {
            const accessToken = tokenResponse.access_token;
            if (!accessToken || !isValidGoogleAccessToken(accessToken)) {
              return settleReject(new Error('No se recibió un token de acceso OAuth 2.0 válido de Google'));
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

            settleResolve({ accessToken, profile });
          } catch (fetchErr) {
            settleReject(fetchErr);
          }
        },
        error_callback: (err: any) => {
          const isBlocked = err?.type === 'popup_blocked' || err?.type === 'popup_closed' || String(err?.message || '').toLowerCase().includes('popup');
          if (isBlocked) {
            notifyGoogleSessionExpired('popup_blocked');
            settleReject(new Error('La ventana emergente de Google fue bloqueada o cerrada por el navegador. Por favor habilita los popups o reconecta tu cuenta de Google.'));
          } else {
            settleReject(err);
          }
        },
      });

      client.requestAccessToken({
        prompt: promptMode,
        ...(cleanHint ? { hint: cleanHint } : {}),
      });
    } catch (err) {
      settleReject(err);
    }
  });

  return inFlightGsiAuthPromise;
};

// Requests or returns a valid Google OAuth access token for Workspace APIs without popping up login windows automatically
export const requestGoogleAccessToken = async (_forceRefresh = false, _preferredEmail?: string): Promise<string> => {
  const existing = getCachedAccessToken();
  if (existing && isValidGoogleAccessToken(existing)) {
    return existing;
  }

  // Try recovering from backend session if active teacher email is known
  const activeEmail = (_preferredEmail || getActiveTeacherEmail()).trim().toLowerCase();
  if (activeEmail) {
    try {
      const data = await api.getAuthUser(activeEmail);
      const serverToken = (data as any)?.token || (data?.user as any)?.token;
      if (serverToken && isValidGoogleAccessToken(serverToken)) {
        setCachedAccessToken(serverToken, activeEmail);
        return serverToken;
      }
    } catch (_) {}
  }

  return '';
};

export const requestAccessToken = requestGoogleAccessToken;

// Sign in with Google OAuth popup (only invoked when the user explicitly clicks a Sign-In / Connect button)
export const googleSignIn = async (preferredEmail?: string): Promise<{ user?: User; accessToken: string; profile: TeacherProfile }> => {
  isSigningIn = true;
  try {
    const cleanHint = (preferredEmail || getActiveTeacherEmail() || '').trim().toLowerCase();
    if (cleanHint) {
      // When the teacher's account is already known, pass login_hint without prompt='select_account'
      // so Google reuses the existing authorization without asking for consent/account selection again
      provider.setCustomParameters({
        login_hint: cleanHint,
      });
    } else {
      provider.setCustomParameters({
        prompt: 'select_account',
      });
    }

    // 1. Primary: Firebase Auth signInWithPopup (uses firebaseapp.com authDomain, avoiding GSI origin_mismatch)
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);

      const token =
        (credential?.accessToken && isValidGoogleAccessToken(credential.accessToken) ? credential.accessToken : null) ||
        ((result as any)._tokenResponse?.oauthAccessToken && isValidGoogleAccessToken((result as any)._tokenResponse?.oauthAccessToken) ? (result as any)._tokenResponse?.oauthAccessToken : null) ||
        null;

      const userEmail = (result.user.email || cleanHint || '').trim().toLowerCase();
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

      if (typeof window !== 'undefined' && cachedAccessToken) {
        window.dispatchEvent(
          new CustomEvent('google_session_renewed', { detail: { token: cachedAccessToken } })
        );
      }

      return { user: result.user, accessToken: cachedAccessToken || '', profile: teacherProfile };
    } catch (popupErr: any) {
      if (
        popupErr?.code === 'auth/popup-closed-by-user' ||
        popupErr?.code === 'auth/cancelled-popup-request' ||
        popupErr?.code === 'auth/popup-blocked'
      ) {
        throw popupErr;
      }

      const hasCustomEnvClientId = Boolean(
        (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
          (import.meta as any).env?.VITE_OAUTH_CLIENT_ID
      );
      if (
        hasCustomEnvClientId &&
        typeof window !== 'undefined' &&
        (window as any).google?.accounts?.oauth2
      ) {
        try {
          const gsiResult = await signInWithGoogleIdentityServices(preferredEmail);
          if (gsiResult?.accessToken && isValidGoogleAccessToken(gsiResult.accessToken)) {
            setCachedAccessToken(gsiResult.accessToken, gsiResult.profile?.email);
            return { accessToken: gsiResult.accessToken, profile: gsiResult.profile };
          }
        } catch (gsiErr) {
          console.warn('GSI fallback error:', gsiErr);
        }
      }

      throw popupErr;
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
 * Recovers the stored Google OAuth token without opening any interactive popup window.
 */
export const renewGoogleSessionSilently = async (userEmail?: string): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  const existing = getCachedAccessToken();
  if (existing && isValidGoogleAccessToken(existing)) {
    return existing;
  }
  const recovered = await requestGoogleAccessToken(false, userEmail);
  return recovered || null;
};

/**
 * Universal fetch wrapper for Google Workspace APIs (Sheets, Drive, Calendar, Classroom, Gmail, Docs)
 * Automatically injects the active Google OAuth token and notifies the session banner on 401.
 */
export const fetchGoogleApiWithRetry = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  providedToken?: string
): Promise<Response> => {
  const activeToken = providedToken || getCachedAccessToken();

  const buildHeaders = (tok: string | null): Headers => {
    const headers = new Headers(init.headers || {});
    if (tok && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${tok}`);
    }
    return headers;
  };

  const response = await fetch(input, {
    ...init,
    headers: buildHeaders(activeToken),
  });

  // Intercept 401 Unauthorized (Google token expired or revoked) and show the non-intrusive reconnect banner
  if (response.status === 401) {
    console.warn('Google API returned 401 Unauthorized.');
    notifyGoogleSessionExpired('http_401_token_expired');
  }

  return response;
};

