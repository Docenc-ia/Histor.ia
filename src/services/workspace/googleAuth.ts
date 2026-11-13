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
import {
  WORKSPACE_SCOPES,
  BASIC_IDENTITY_SCOPES,
  LAST_TEACHER_EMAIL_KEY,
  LAST_USER_PROFILE_KEY,
  SESSION_ACTIVE_STORAGE_KEY,
  USER_PROFILE_STORAGE_KEY,
  TEACHER_EMAIL_STORAGE_KEY,
  EXPLICIT_LOGOUT_STORAGE_KEY,
  DEFAULT_TEACHER_NAME,
  GENERIC_TEACHER_LABEL,
  PROFESSOR_TITLE_PREFIX,
  getActiveTeacherEmail,
  getLastRememberedEmail,
  getTeacherAvatar,
  deriveSchoolFromEmail,
  DEFAULT_TEACHER,
  saveRememberedProfile,
  buildTeacherProfileFromEmail,
  getRememberedProfile,
} from './teacherProfileMapper';

export {
  WORKSPACE_SCOPES,
  BASIC_IDENTITY_SCOPES,
  LAST_TEACHER_EMAIL_KEY,
  LAST_USER_PROFILE_KEY,
  getActiveTeacherEmail,
  getLastRememberedEmail,
  getTeacherAvatar,
  deriveSchoolFromEmail,
  DEFAULT_TEACHER,
  saveRememberedProfile,
  buildTeacherProfileFromEmail,
  getRememberedProfile,
};

const TOKEN_STORAGE_KEY = 'docencia_workspace_access_token';
const TOKEN_EXPIRY_KEY = 'docencia_workspace_token_expires_at';
const TOKEN_ISSUED_KEY = 'docencia_workspace_token_issued_at';
const SAVED_TOKENS_BY_EMAIL_KEY = 'docencia_saved_oauth_tokens_by_email';
const TOKEN_SYNC_CHANNEL_NAME = 'docencia_workspace_token_sync';
const ENCODED_TOKEN_PREFIX = 'enc1:';

const DAYS_IN_YEAR = 365;
const HOURS_IN_DAY = 24;
const MINUTES_IN_HOUR = 60;
const SECONDS_IN_MINUTE = 60;
const MILLISECONDS_IN_SECOND = 1000;
const TOKEN_LIFETIME_MS =
  DAYS_IN_YEAR * HOURS_IN_DAY * MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;
const USER_GESTURE_VALIDITY_WINDOW_MS = 10000;
const POPUP_DEBOUNCE_COOLDOWN_MS = 4000;
const DEFAULT_OAUTH_EXPIRES_IN_SECONDS = 3540;
const MIN_VALID_ACCESS_TOKEN_LENGTH = 20;
const JWT_HEADER_PREFIX = 'eyJ';

const INVALID_SYNTHETIC_TOKEN_PREFIXES = [
  'google_workspace_token_',
  'ya29.inst_',
  'ya29.mock_',
  'token_',
];
const INVALID_SYNTHETIC_TOKEN_VALUES = ['token_authenticated', 'default_token'];

const EVENT_GOOGLE_SESSION_RENEWED = 'google_session_renewed';
const EVENT_GOOGLE_SESSION_CLEARED = 'google_session_cleared';
const SYNC_MESSAGE_REQUEST_TOKEN = 'REQUEST_TOKEN';
const SYNC_MESSAGE_SHARE_TOKEN = 'SHARE_TOKEN';
const SYNC_MESSAGE_CLEAR_TOKEN = 'CLEAR_TOKEN';

const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const AI_STUDIO_PREVIEW_HOST_FRAGMENT = 'xanf7lgydk64d73ob33wqe';
const AI_STUDIO_PREVIEW_OAUTH_CLIENT_ID =
  '708929916247-j4j7vl4vipn2to5vlvh7us3jl7td29mi.apps.googleusercontent.com';
const OAUTH_PROMPT_SELECT_ACCOUNT = 'select_account';
const OAUTH_PROMPT_CONSENT = 'consent';
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  try {
    // Se limpian las banderas de sesión activa de `localStorage` para que la vigencia dependa exclusivamente de `sessionStorage` (obligando a re-autenticar al cerrar el navegador).
    localStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
    localStorage.removeItem(USER_PROFILE_STORAGE_KEY);
    localStorage.removeItem(TEACHER_EMAIL_STORAGE_KEY);
  } catch (_) {}
}

let cachedAccessToken: string | null = null;
let tokenIssuedAt: number | null = null;
let tokenExpiresAt: number | null = null;
let isSigningIn = false;
let hasRequestedTokenFromPeers = false;
let tokenSyncChannel: BroadcastChannel | null = null;
let lastLinkedFirebaseToken: string | null = null;
let isRefreshingToken = false;
let lastPopupRequestTime = 0;

let lastUserGestureTimestampMs = 0;
if (typeof window !== 'undefined') {
  const recordUserGesture = () => {
    lastUserGestureTimestampMs = Date.now();
  };
  window.addEventListener('pointerdown', recordUserGesture, { capture: true, passive: true });
  window.addEventListener('click', recordUserGesture, { capture: true, passive: true });
  window.addEventListener('keydown', recordUserGesture, { capture: true, passive: true });
}

/**
 * Determina si ocurrió una interacción física reciente del usuario (clic o teclado) en la ventana actual.
 * Necesario porque los navegadores modernos bloquean `requestAccessToken` de Google Identity Services si se invoca fuera de un gesto de usuario.
 *
 * @returns `true` si el navegador registra activación de usuario vigente.
 */
export const hasRecentUserGesture = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (
    typeof navigator !== 'undefined' &&
    'userActivation' in navigator &&
    (navigator as any).userActivation?.isActive
  ) {
    return true;
  }
  return Date.now() - lastUserGestureTimestampMs < USER_GESTURE_VALIDITY_WINDOW_MS;
};

/**
 * Verifica que una cadena sea un token de acceso OAuth 2.0 real para las APIs de Google Workspace,
 * descartando tokens JWT OpenID (`eyJ...`), tokens internos de Firebase o cadenas sintéticas de prueba.
 *
 * @param candidateToken Cadena de token a validar.
 * @returns `true` si el formato corresponde a un `access_token` de Google OAuth 2.0 válido.
 */
export const isValidGoogleAccessToken = (candidateToken?: string | null): boolean => {
  if (!candidateToken || typeof candidateToken !== 'string') return false;
  const trimmedToken = candidateToken.trim();
  if (trimmedToken.length < MIN_VALID_ACCESS_TOKEN_LENGTH) return false;
  if (trimmedToken.startsWith(JWT_HEADER_PREFIX)) return false;

  const hasSyntheticPrefix = INVALID_SYNTHETIC_TOKEN_PREFIXES.some((prefix) =>
    trimmedToken.startsWith(prefix)
  );
  if (hasSyntheticPrefix || INVALID_SYNTHETIC_TOKEN_VALUES.includes(trimmedToken)) {
    return false;
  }
  return true;
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
  // Intencionalmente vacío para no interrumpir la clase del docente con carteles de expiración cuando trabaja en modo local.
};

const encodeStoredToken = (rawToken: string): string => {
  try {
    return ENCODED_TOKEN_PREFIX + btoa(encodeURIComponent(rawToken));
  } catch {
    return rawToken;
  }
};

const decodeStoredToken = (storedValue: string | null): string | null => {
  if (!storedValue) return null;
  if (storedValue.startsWith(ENCODED_TOKEN_PREFIX)) {
    try {
      return decodeURIComponent(atob(storedValue.slice(ENCODED_TOKEN_PREFIX.length)));
    } catch {
      return null;
    }
  }
  return storedValue;
};

const syncFirebaseAuthWithAccessToken = (accessToken: string): void => {
  if (!accessToken || !isValidGoogleAccessToken(accessToken)) return;
  if (isSigningIn || auth.currentUser) return;
  if (lastLinkedFirebaseToken === accessToken) return;
  lastLinkedFirebaseToken = accessToken;
  try {
    const firebaseCredential = GoogleAuthProvider.credential(null, accessToken);
    signInWithCredential(auth, firebaseCredential).catch(() => {});
  } catch (_) {}
};

/**
 * Guarda de forma codificada un token OAuth 2.0 asociado al correo del docente en `localStorage`.
 *
 * @param emailAddress Correo electrónico del docente propietario del token.
 * @param accessToken Token de acceso OAuth 2.0 emitido por Google.
 */
export const saveTokenForEmail = (emailAddress: string, accessToken: string): void => {
  if (typeof window === 'undefined' || !emailAddress || !isValidGoogleAccessToken(accessToken)) {
    return;
  }
  try {
    const normalizedEmail = emailAddress.trim().toLowerCase();
    const serializedTokenMap = localStorage.getItem(SAVED_TOKENS_BY_EMAIL_KEY);
    const tokensByEmailMap: Record<string, string> = serializedTokenMap
      ? JSON.parse(serializedTokenMap)
      : {};
    tokensByEmailMap[normalizedEmail] = encodeStoredToken(accessToken);
    localStorage.setItem(SAVED_TOKENS_BY_EMAIL_KEY, JSON.stringify(tokensByEmailMap));
  } catch (_) {}
};

/**
 * Recupera el token OAuth 2.0 previamente guardado para un correo electrónico específico.
 *
 * @param emailAddress Correo del docente a consultar (o el del docente activo por defecto).
 * @returns El token decodificado y validado, o `null` si no existe.
 */
export const getSavedTokenForEmail = (emailAddress?: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const serializedTokenMap = localStorage.getItem(SAVED_TOKENS_BY_EMAIL_KEY);
    if (!serializedTokenMap) return null;
    const tokensByEmailMap: Record<string, string> = JSON.parse(serializedTokenMap);
    const normalizedEmail = (emailAddress || getActiveTeacherEmail() || '').trim().toLowerCase();
    if (normalizedEmail && tokensByEmailMap[normalizedEmail]) {
      const decodedToken = decodeStoredToken(tokensByEmailMap[normalizedEmail]);
      if (decodedToken && isValidGoogleAccessToken(decodedToken)) return decodedToken;
    }
  } catch (_) {}
  return null;
};

const setupCrossTabTokenSync = (): void => {
  if (typeof window === 'undefined' || tokenSyncChannel) return;
  if (!('BroadcastChannel' in window)) return;

  try {
    tokenSyncChannel = new BroadcastChannel(TOKEN_SYNC_CHANNEL_NAME);
    tokenSyncChannel.onmessage = (messageEvent: MessageEvent) => {
      const messagePayload = messageEvent.data;
      if (!messagePayload || typeof messagePayload !== 'object') return;

      if (messagePayload.type === SYNC_MESSAGE_REQUEST_TOKEN) {
        const currentToken =
          cachedAccessToken ||
          decodeStoredToken(sessionStorage.getItem(TOKEN_STORAGE_KEY)) ||
          decodeStoredToken(localStorage.getItem(TOKEN_STORAGE_KEY));
        const currentExpiry =
          tokenExpiresAt ||
          Number(
            sessionStorage.getItem(TOKEN_EXPIRY_KEY) ||
              localStorage.getItem(TOKEN_EXPIRY_KEY) ||
              0
          );
        const currentIssued =
          tokenIssuedAt ||
          Number(
            sessionStorage.getItem(TOKEN_ISSUED_KEY) ||
              localStorage.getItem(TOKEN_ISSUED_KEY) ||
              Date.now()
          );
        if (currentToken && isValidGoogleAccessToken(currentToken)) {
          try {
            tokenSyncChannel?.postMessage({
              type: SYNC_MESSAGE_SHARE_TOKEN,
              token: currentToken,
              issuedAt: currentIssued,
              expiresAt: currentExpiry || Date.now() + TOKEN_LIFETIME_MS,
              teacherEmail: getActiveTeacherEmail(),
            });
          } catch (_) {}
        }
      } else if (
        messagePayload.type === SYNC_MESSAGE_SHARE_TOKEN &&
        messagePayload.token &&
        isValidGoogleAccessToken(messagePayload.token)
      ) {
        const currentTimeMs = Date.now();
        const incomingExpiry =
          Number(messagePayload.expiresAt) || currentTimeMs + TOKEN_LIFETIME_MS;
        const incomingIssued = Number(messagePayload.issuedAt) || currentTimeMs;
        if (cachedAccessToken !== messagePayload.token) {
          cachedAccessToken = messagePayload.token;
          tokenIssuedAt = incomingIssued;
          tokenExpiresAt = incomingExpiry;
          try {
            const encodedToken = encodeStoredToken(messagePayload.token);
            sessionStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
            sessionStorage.setItem(TOKEN_ISSUED_KEY, String(incomingIssued));
            sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(incomingExpiry));
            localStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
            localStorage.setItem(TOKEN_ISSUED_KEY, String(incomingIssued));
            localStorage.setItem(TOKEN_EXPIRY_KEY, String(incomingExpiry));
            if (messagePayload.teacherEmail) {
              const normalizedEmail = String(messagePayload.teacherEmail).trim().toLowerCase();
              if (sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === 'true') {
                sessionStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, normalizedEmail);
              }
              localStorage.setItem(LAST_TEACHER_EMAIL_KEY, normalizedEmail);
              saveTokenForEmail(normalizedEmail, messagePayload.token);
            }
          } catch (_) {}
          syncFirebaseAuthWithAccessToken(messagePayload.token);
          window.dispatchEvent(
            new CustomEvent(EVENT_GOOGLE_SESSION_RENEWED, {
              detail: { token: messagePayload.token },
            })
          );
        }
      } else if (messagePayload.type === SYNC_MESSAGE_CLEAR_TOKEN) {
        cachedAccessToken = null;
        tokenIssuedAt = null;
        tokenExpiresAt = null;
        lastLinkedFirebaseToken = null;
        clearPersistedStorageTokens();
        window.dispatchEvent(new CustomEvent(EVENT_GOOGLE_SESSION_CLEARED));
      }
    };
  } catch (_) {}
};

if (typeof window !== 'undefined') {
  setupCrossTabTokenSync();
}

/**
 * Obtiene el token de acceso OAuth 2.0 activo desde la caché en memoria o el almacenamiento local de la sesión.
 *
 * @returns El token OAuth activo si la sesión está iniciada y no fue cerrada explícitamente, o `null`.
 */
export const getCachedAccessToken = (): string | null => {
  if (typeof window !== 'undefined') {
    try {
      const isExplicitLogout = localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY) === 'true';
      const isSessionActive =
        !isExplicitLogout && sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === 'true';
      if (!isSessionActive) {
        return null;
      }
    } catch (_) {}
  }

  if (cachedAccessToken && isValidGoogleAccessToken(cachedAccessToken)) {
    return cachedAccessToken;
  }

  if (typeof window !== 'undefined') {
    setupCrossTabTokenSync();
    try {
      const activeEmail = getActiveTeacherEmail();
      const rawStoredToken =
        sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
      const storedIssuedAt = Number(
        sessionStorage.getItem(TOKEN_ISSUED_KEY) || localStorage.getItem(TOKEN_ISSUED_KEY) || 0
      );
      const storedExpiresAt = Number(
        sessionStorage.getItem(TOKEN_EXPIRY_KEY) || localStorage.getItem(TOKEN_EXPIRY_KEY) || 0
      );

      const resolvedToken =
        (activeEmail ? getSavedTokenForEmail(activeEmail) : null) ||
        decodeStoredToken(rawStoredToken);

      if (resolvedToken && isValidGoogleAccessToken(resolvedToken)) {
        const currentTimeMs = Date.now();
        cachedAccessToken = resolvedToken;
        tokenIssuedAt = storedIssuedAt || currentTimeMs;
        tokenExpiresAt = storedExpiresAt || currentTimeMs + TOKEN_LIFETIME_MS;
        const encodedToken = encodeStoredToken(resolvedToken);
        sessionStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
        localStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
        syncFirebaseAuthWithAccessToken(resolvedToken);
        return cachedAccessToken;
      } else if (!hasRequestedTokenFromPeers && tokenSyncChannel) {
        hasRequestedTokenFromPeers = true;
        try {
          tokenSyncChannel.postMessage({ type: SYNC_MESSAGE_REQUEST_TOKEN });
        } catch (_) {}
      }
    } catch (_) {}
  }

  return null;
};

/**
 * Actualiza el token OAuth 2.0 activo en memoria, almacenamiento persistente y pestañas hermanas vía `BroadcastChannel`.
 * Si se recibe `null`, limpia la sesión de acceso en todas las capas.
 *
 * @param accessToken Nuevo token OAuth 2.0 o `null` para limpiar.
 * @param teacherEmail Correo del docente asociado al token.
 * @param expiresInSeconds Tiempo de vida reportado por Google OAuth en segundos.
 */
export const setCachedAccessToken = (
  accessToken: string | null,
  teacherEmail?: string,
  expiresInSeconds?: number
): void => {
  const currentTimeMs = Date.now();
  setupCrossTabTokenSync();
  if (accessToken && isValidGoogleAccessToken(accessToken)) {
    cachedAccessToken = accessToken;
    tokenIssuedAt = currentTimeMs;
    const lifetimeDurationMs = expiresInSeconds
      ? Math.max(expiresInSeconds * MILLISECONDS_IN_SECOND, TOKEN_LIFETIME_MS)
      : TOKEN_LIFETIME_MS;
    const computedExpiresAt = currentTimeMs + lifetimeDurationMs;
    tokenExpiresAt = computedExpiresAt;
    const encodedToken = encodeStoredToken(accessToken);

    syncFirebaseAuthWithAccessToken(accessToken);

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
        sessionStorage.setItem(TOKEN_ISSUED_KEY, String(currentTimeMs));
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(computedExpiresAt));
        localStorage.setItem(TOKEN_STORAGE_KEY, encodedToken);
        localStorage.setItem(TOKEN_ISSUED_KEY, String(currentTimeMs));
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(computedExpiresAt));

        const normalizedEmail = (
          teacherEmail ||
          getActiveTeacherEmail() ||
          getLastRememberedEmail() ||
          ''
        )
          .trim()
          .toLowerCase();
        if (normalizedEmail) {
          sessionStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, normalizedEmail);
          localStorage.setItem(LAST_TEACHER_EMAIL_KEY, normalizedEmail);
          saveTokenForEmail(normalizedEmail, accessToken);
        }

        tokenSyncChannel?.postMessage({
          type: SYNC_MESSAGE_SHARE_TOKEN,
          token: accessToken,
          issuedAt: currentTimeMs,
          expiresAt: computedExpiresAt,
          teacherEmail: normalizedEmail,
        });
      } catch (_) {}
    }
  } else if (!accessToken) {
    cachedAccessToken = null;
    tokenIssuedAt = null;
    tokenExpiresAt = null;
    lastLinkedFirebaseToken = null;
    if (typeof window !== 'undefined') {
      try {
        clearPersistedStorageTokens();
        tokenSyncChannel?.postMessage({ type: SYNC_MESSAGE_CLEAR_TOKEN });
      } catch (_) {}
    }
  }
};

export const clearAuthSession = (): void => {
  setCachedAccessToken(null);
};

/**
 * Inicializa el observador de estado de autenticación de Firebase sincronizado con la sesión activa de la pestaña.
 *
 * @param onAuthSuccess Callback invocado cuando existe un usuario y un token válidos.
 * @param onAuthFailure Callback invocado cuando no hay sesión activa o falla la validación.
 * @returns Función de desuscripción de `onAuthStateChanged`.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  const isSessionActive =
    typeof window !== 'undefined' &&
    localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY) !== 'true' &&
    sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === 'true';

  const initialToken = isSessionActive ? getCachedAccessToken() : null;
  if (initialToken && !auth.currentUser) {
    syncFirebaseAuthWithAccessToken(initialToken);
  }
  return onAuthStateChanged(auth, async (firebaseUser: User | null) => {
    const isCurrentlyActive =
      typeof window !== 'undefined' &&
      localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY) !== 'true' &&
      sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === 'true';
    if (!isCurrentlyActive) {
      if (!isSigningIn && onAuthFailure) onAuthFailure();
      return;
    }
    const activeToken = getCachedAccessToken();
    if (firebaseUser && activeToken) {
      if (onAuthSuccess) onAuthSuccess(firebaseUser, activeToken);
    } else if (!isSigningIn && !activeToken) {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Decodifica de forma segura el payload JSON de un token JWT de Google (Base64Url -> UTF-8).
 *
 * @param jwtToken Cadena JWT de 3 segmentos separados por punto.
 * @returns El objeto decodificado del payload o `null` si el formato es inválido.
 */
export const parseGoogleJwt = (jwtToken: string): any => {
  try {
    const base64UrlPayload = jwtToken.split('.')[1];
    if (!base64UrlPayload) return null;
    const standardBase64 = base64UrlPayload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(standardBase64)
        .split('')
        .map((char) => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (decodeError) {
    console.error('Error al decodificar credencial de Google:', decodeError);
    return null;
  }
};

/**
 * Autentica al docente a partir de un ID Token emitido por Google Identity Services (One Tap / Botón GSI),
 * vinculando la credencial con Firebase Auth sin requerir ventana emergente adicional.
 *
 * @param idToken Token JWT de identidad emitido por Google.
 * @returns Perfil docente construido y el `accessToken` de Workspace recuperado si existía.
 * @throws {Error} Si el token JWT no puede decodificarse o carece de correo electrónico.
 */
export const signInWithGoogleIdToken = async (
  idToken: string
): Promise<{ profile: TeacherProfile; accessToken: string }> => {
  const decodedPayload = parseGoogleJwt(idToken);
  if (!decodedPayload || !decodedPayload.email) {
    throw new Error('No se pudo verificar la cuenta de Google con el token proporcionado.');
  }

  const userEmail = (decodedPayload.email || '').trim().toLowerCase();
  const fallbackDisplayName = userEmail
    ? userEmail
        .split('@')[0]
        .split(/[._-]/)
        .map((namePart: string) => namePart.charAt(0).toUpperCase() + namePart.slice(1))
        .join(' ')
    : GENERIC_TEACHER_LABEL;
  const rawName = decodedPayload.name || fallbackDisplayName;
  const displayName = rawName.startsWith(PROFESSOR_TITLE_PREFIX)
    ? rawName
    : `${PROFESSOR_TITLE_PREFIX} ${rawName}`;
  const derivedSchool = deriveSchoolFromEmail(userEmail);

  const teacherProfile: TeacherProfile = {
    id: decodedPayload.sub || `google-${Date.now()}`,
    name: displayName,
    email: userEmail,
    avatar: decodedPayload.picture || getTeacherAvatar(displayName, userEmail),
    role: DEFAULT_TEACHER_NAME,
    school: derivedSchool,
    permissions: DEFAULT_TEACHER.permissions,
    scopes: WORKSPACE_SCOPES,
  };

  saveRememberedProfile(teacherProfile);
  const savedAccessToken = getSavedTokenForEmail(userEmail) || '';
  if (savedAccessToken) {
    setCachedAccessToken(savedAccessToken, userEmail);
  }

  try {
    const firebaseCredential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, firebaseCredential);
  } catch (firebaseAuthError) {
    console.warn('Nota de autenticación Firebase con credencial:', firebaseAuthError);
  }

  api
    .syncAuthSession({
      uid: teacherProfile.id,
      email: teacherProfile.email,
      name: teacherProfile.name,
      avatar: teacherProfile.avatar,
      token: savedAccessToken || idToken,
      scopes: WORKSPACE_SCOPES,
      school: teacherProfile.school,
    })
    .catch(() => {});

  return { profile: teacherProfile, accessToken: savedAccessToken };
};

export const AUTHORIZED_APP_ORIGINS = [
  'https://ais-dev-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app',
  'https://ais-pre-xanf7lgydk64d73ob33wqe-252580185511.us-east1.run.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/**
 * Valida que el origen de ejecución actual cumpla con la política de orígenes autorizados (HTTPS o localhost).
 *
 * @param originInput Origen opcional a verificar; por defecto toma `window.location.origin`.
 * @returns `true` si el origen es seguro y está autorizado para iniciar flujos OAuth.
 */
export const isAuthorizedAppOrigin = (originInput?: string): boolean => {
  const rawOrigin = originInput || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!rawOrigin) return true;
  if (AUTHORIZED_APP_ORIGINS.includes(rawOrigin)) return true;

  try {
    const parsedUrl = new URL(rawOrigin);
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (parsedUrl.protocol === 'https:') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

/**
 * Selecciona dinámicamente el OAuth Client ID adecuado según el dominio donde corre la aplicación,
 * priorizando `VITE_GOOGLE_CLIENT_ID` en despliegues propios (ej. Vercel) para permitir cuentas institucionales multi-colegio.
 *
 * @returns El Client ID de OAuth 2.0 a utilizar con Google Identity Services.
 */
export const getEffectiveOAuthClientId = (): string => {
  if (typeof window !== 'undefined') {
    const currentHostname = window.location.hostname || '';
    if (currentHostname.includes(AI_STUDIO_PREVIEW_HOST_FRAGMENT)) {
      return AI_STUDIO_PREVIEW_OAUTH_CLIENT_ID;
    }
    const configuredEnvClientId =
      (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
      (import.meta as any).env?.VITE_OAUTH_CLIENT_ID;
    if (
      configuredEnvClientId &&
      typeof configuredEnvClientId === 'string' &&
      configuredEnvClientId.trim()
    ) {
      return configuredEnvClientId.trim();
    }
  }
  return firebaseConfig.oAuthClientId;
};

let inFlightGsiAuthPromise: Promise<{ accessToken: string; profile: TeacherProfile }> | null = null;

/**
 * Inicia el flujo OAuth 2.0 mediante Google Identity Services (`initTokenClient`) solicitando
 * todos los alcances de Google Workspace (Classroom, Drive, Sheets, Forms, Calendar y Gmail).
 * Reutiliza una promesa en vuelo (`inFlightGsiAuthPromise`) para evitar abrir múltiples ventanas si el usuario hace doble clic.
 *
 * @param preferredEmail Correo sugerido opcional para preseleccionar cuenta cuando no se fuerza `select_account`.
 * @param options Opciones de visualización del prompt de consentimiento/selección de cuenta.
 * @returns Promesa con el `accessToken` emitido y el `TeacherProfile` autenticado.
 */
export const signInWithGoogleIdentityServices = (
  preferredEmail?: string,
  options?: { prompt?: string }
): Promise<{ accessToken: string; profile: TeacherProfile }> => {
  if (inFlightGsiAuthPromise) {
    return inFlightGsiAuthPromise;
  }

  inFlightGsiAuthPromise = new Promise<{ accessToken: string; profile: TeacherProfile }>(
    (resolve, reject) => {
      const settleResolve = (authResult: { accessToken: string; profile: TeacherProfile }) => {
        inFlightGsiAuthPromise = null;
        resolve(authResult);
      };
      const settleReject = (authError: any) => {
        inFlightGsiAuthPromise = null;
        reject(authError);
      };

      if (typeof window === 'undefined') {
        return settleReject(new Error('Window not available'));
      }
      const googleGlobal = (window as any).google;
      const oauthClientId = getEffectiveOAuthClientId();
      if (!googleGlobal?.accounts?.oauth2 || !oauthClientId) {
        return settleReject(
          new Error(
            'El servicio de inicio de sesión de Google se está cargando. Intentá nuevamente en un segundo.'
          )
        );
      }

      const normalizedHint =
        (preferredEmail || getActiveTeacherEmail() || '').trim().toLowerCase() || undefined;
      const promptMode =
        options?.prompt !== undefined ? options.prompt : OAUTH_PROMPT_SELECT_ACCOUNT;
      // Si se solicita `select_account`, no se envía `hint` para que Google muestre todas las cuentas del navegador y permita cambiar a otra institución.
      const loginHintToUse =
        promptMode !== OAUTH_PROMPT_SELECT_ACCOUNT && normalizedHint ? normalizedHint : undefined;

      try {
        const tokenClient = googleGlobal.accounts.oauth2.initTokenClient({
          client_id: oauthClientId,
          scope: WORKSPACE_SCOPES.join(' '),
          prompt: promptMode,
          ...(loginHintToUse ? { hint: loginHintToUse } : {}),
          callback: async (tokenResponse: any) => {
            if (tokenResponse?.error) {
              return settleReject(
                new Error(
                  tokenResponse.error_description || tokenResponse.error || 'Error en Google OAuth'
                )
              );
            }
            try {
              const accessToken = tokenResponse.access_token;
              if (!accessToken || !isValidGoogleAccessToken(accessToken)) {
                return settleReject(
                  new Error('No se recibió un token de acceso OAuth 2.0 válido de Google')
                );
              }
              const expiresInSeconds =
                Number(tokenResponse.expires_in) || DEFAULT_OAUTH_EXPIRES_IN_SECONDS;

              const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const userInfo = await userInfoResponse.json().catch(() => ({}));
              const userEmail = (userInfo.email || normalizedHint || '').trim().toLowerCase();
              if (!userEmail) {
                return settleReject(
                  new Error(
                    'No se pudo identificar el correo de la cuenta de Google seleccionada.'
                  )
                );
              }
              const fallbackDisplayName = userEmail
                ? userEmail
                    .split('@')[0]
                    .split(/[._-]/)
                    .map(
                      (namePart: string) => namePart.charAt(0).toUpperCase() + namePart.slice(1)
                    )
                    .join(' ')
                : GENERIC_TEACHER_LABEL;
              const rawName = userInfo.name || fallbackDisplayName;
              const displayName = rawName.startsWith(PROFESSOR_TITLE_PREFIX)
                ? rawName
                : `${PROFESSOR_TITLE_PREFIX} ${rawName}`;
              const derivedSchool = deriveSchoolFromEmail(userEmail);

              if (typeof window !== 'undefined') {
                try {
                  localStorage.removeItem(EXPLICIT_LOGOUT_STORAGE_KEY);
                  sessionStorage.setItem(SESSION_ACTIVE_STORAGE_KEY, 'true');
                  sessionStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, userEmail);
                } catch (_) {}
              }

              setCachedAccessToken(accessToken, userEmail, expiresInSeconds);

              const rememberedProfile = getRememberedProfile(userEmail);
              const teacherProfile: TeacherProfile = {
                id:
                  userInfo.sub ||
                  (rememberedProfile?.id && !String(rememberedProfile.id).startsWith('user-')
                    ? rememberedProfile.id
                    : `teacher_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}`),
                name: displayName,
                email: userEmail,
                avatar:
                  userInfo.picture ||
                  rememberedProfile?.avatar ||
                  getTeacherAvatar(displayName, userEmail),
                role: DEFAULT_TEACHER_NAME,
                school: derivedSchool,
                permissions: DEFAULT_TEACHER.permissions,
                scopes: WORKSPACE_SCOPES,
              };

              saveRememberedProfile(teacherProfile);

              api
                .syncAuthSession({
                  uid: teacherProfile.id,
                  email: teacherProfile.email,
                  name: teacherProfile.name,
                  avatar: teacherProfile.avatar,
                  token: accessToken,
                  scopes: WORKSPACE_SCOPES,
                  school: teacherProfile.school,
                })
                .catch(() => {});

              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent(EVENT_GOOGLE_SESSION_RENEWED, { detail: { token: accessToken } })
                );
              }

              settleResolve({ accessToken, profile: teacherProfile });
            } catch (userInfoFetchError) {
              settleReject(userInfoFetchError);
            }
          },
          error_callback: (gsiError: any) => {
            const errorType = String(gsiError?.type || '').toLowerCase();
            if (errorType === 'popup_closed') {
              settleReject(
                new Error(
                  'Seleccioná tu cuenta de Google y aceptá los permisos en la ventana emergente para completar el ingreso.'
                )
              );
            } else if (errorType === 'popup_blocked') {
              notifyGoogleSessionExpired('popup_blocked');
              settleReject(
                new Error(
                  'El navegador bloqueó la ventana de Google. Permití las ventanas emergentes e intentá nuevamente.'
                )
              );
            } else {
              settleReject(
                new Error(
                  gsiError?.message || 'Cancelaste o cerraste el inicio de sesión de Google.'
                )
              );
            }
          },
        });

        tokenClient.requestAccessToken({
          prompt: promptMode,
          ...(loginHintToUse ? { hint: loginHintToUse } : {}),
        });
      } catch (initializationError) {
        settleReject(initializationError);
      }
    }
  );

  return inFlightGsiAuthPromise;
};

/**
 * Invalida un token OAuth 2.0 vencido o revocado tanto en memoria como en el mapa por correo de `localStorage`.
 *
 * @param expiredToken Token específico que falló con 401/403; si se omite, invalida el token activo en caché.
 */
export const invalidateExpiredAccessToken = (expiredToken?: string | null): void => {
  const tokenToClear = expiredToken || cachedAccessToken;
  cachedAccessToken = null;
  tokenIssuedAt = null;
  tokenExpiresAt = null;
  lastLinkedFirebaseToken = null;
  clearPersistedStorageTokens();
  if (typeof window !== 'undefined') {
    try {
      const serializedTokenMap = localStorage.getItem(SAVED_TOKENS_BY_EMAIL_KEY);
      if (serializedTokenMap) {
        const tokensByEmailMap: Record<string, string> = JSON.parse(serializedTokenMap);
        const activeEmail = getActiveTeacherEmail().trim().toLowerCase();
        if (activeEmail && tokensByEmailMap[activeEmail]) {
          const decodedToken = decodeStoredToken(tokensByEmailMap[activeEmail]);
          if (!tokenToClear || decodedToken === tokenToClear) {
            delete tokensByEmailMap[activeEmail];
          }
        }
        if (tokenToClear) {
          for (const emailKey of Object.keys(tokensByEmailMap)) {
            if (decodeStoredToken(tokensByEmailMap[emailKey]) === tokenToClear) {
              delete tokensByEmailMap[emailKey];
            }
          }
        }
        localStorage.setItem(SAVED_TOKENS_BY_EMAIL_KEY, JSON.stringify(tokensByEmailMap));
      }
    } catch (_) {}
  }
};

/**
 * Obtiene un token OAuth 2.0 válido para consumir las APIs de Google Workspace (Classroom, Drive, Sheets, Forms, Calendar, Gmail).
 * Intenta primero memoria, luego `localStorage` por email, luego sesión del backend y, solo si hubo un gesto reciente del usuario, abre GSI.
 *
 * @param forceRefresh Si es `true`, descarta el token actual y solicita uno nuevo a Google.
 * @param preferredEmail Correo electrónico opcional del docente.
 * @returns Promesa con el token OAuth 2.0 o `''` si no pudo obtenerse sin bloquear el navegador.
 */
export const requestGoogleAccessToken = async (
  forceRefresh = false,
  preferredEmail?: string
): Promise<string> => {
  const activeEmail = (preferredEmail || getActiveTeacherEmail()).trim().toLowerCase();

  if (forceRefresh) {
    invalidateExpiredAccessToken(cachedAccessToken);
  } else {
    const existingCachedToken = getCachedAccessToken();
    if (existingCachedToken && isValidGoogleAccessToken(existingCachedToken)) {
      return existingCachedToken;
    }

    if (activeEmail) {
      const savedLocalToken = getSavedTokenForEmail(activeEmail);
      if (savedLocalToken && isValidGoogleAccessToken(savedLocalToken)) {
        setCachedAccessToken(savedLocalToken, activeEmail);
        return savedLocalToken;
      }
    }
  }

  if (!forceRefresh && activeEmail) {
    try {
      const backendAuthData = await api.getAuthUser(activeEmail);
      const backendServerToken =
        (backendAuthData as any)?.token || (backendAuthData?.user as any)?.token;
      if (backendServerToken && isValidGoogleAccessToken(backendServerToken)) {
        setCachedAccessToken(backendServerToken, activeEmail);
        return backendServerToken;
      }
    } catch (_) {}
  }

  // Se aplica una ventana de enfriamiento (`POPUP_DEBOUNCE_COOLDOWN_MS`) para que operaciones en lote (como crear las 6 subcarpetas de un curso en Drive) nunca disparen múltiples popups seguidos.
  const currentTimeMs = Date.now();
  if (currentTimeMs - lastPopupRequestTime < POPUP_DEBOUNCE_COOLDOWN_MS) {
    return '';
  }

  if (
    (forceRefresh || hasRecentUserGesture()) &&
    typeof window !== 'undefined' &&
    (window as any).google?.accounts?.oauth2 &&
    getEffectiveOAuthClientId()
  ) {
    lastPopupRequestTime = currentTimeMs;
    try {
      const gsiResult = await signInWithGoogleIdentityServices(activeEmail || undefined, {
        prompt: forceRefresh
          ? OAUTH_PROMPT_CONSENT
          : activeEmail
          ? ''
          : OAUTH_PROMPT_SELECT_ACCOUNT,
      });
      if (gsiResult?.accessToken && isValidGoogleAccessToken(gsiResult.accessToken)) {
        setCachedAccessToken(gsiResult.accessToken, gsiResult.profile?.email || activeEmail);
        return gsiResult.accessToken;
      }
    } catch (gsiAcquisitionError) {
      console.warn('GSI on-demand token acquisition notice:', gsiAcquisitionError);
    }
  }

  return '';
};

export const requestAccessToken = requestGoogleAccessToken;

/**
 * Punto de entrada principal para el inicio de sesión con Google.
 * Cuando se solicitan permisos de Workspace (`requestFullWorkspace`), prioriza Google Identity Services
 * porque utiliza `getEffectiveOAuthClientId()` (`VITE_GOOGLE_CLIENT_ID`), evitando bloqueos `org_internal` en cuentas de distintos colegios.
 *
 * @param preferredEmail Correo electrónico sugerido opcional.
 * @param options Configuración para forzar selector de cuenta (`forcePopup`) o solicitar alcances completos de Workspace (`requestFullWorkspace`).
 * @returns Promesa con el usuario de Firebase (si aplica), el `accessToken` de Workspace y el `TeacherProfile`.
 */
export const googleSignIn = async (
  preferredEmail?: string,
  options?: { forcePopup?: boolean; requestFullWorkspace?: boolean }
): Promise<{ user?: User; accessToken: string; profile: TeacherProfile }> => {
  isSigningIn = true;
  try {
    const isExplicitLogout =
      typeof window !== 'undefined' &&
      localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY) === 'true';
    const isSessionCurrentlyActive =
      typeof window !== 'undefined' &&
      !isExplicitLogout &&
      sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === 'true';

    const activeEmail = getActiveTeacherEmail();
    const normalizedEmail = (preferredEmail || (isSessionCurrentlyActive ? activeEmail : '') || '')
      .trim()
      .toLowerCase();

    if (
      options?.requestFullWorkspace &&
      typeof window !== 'undefined' &&
      (window as any).google?.accounts?.oauth2 &&
      getEffectiveOAuthClientId()
    ) {
      const promptType = options?.forcePopup
        ? OAUTH_PROMPT_SELECT_ACCOUNT
        : normalizedEmail
        ? ''
        : OAUTH_PROMPT_SELECT_ACCOUNT;
      const gsiResult = await signInWithGoogleIdentityServices(normalizedEmail || undefined, {
        prompt: promptType,
      });
      if (gsiResult?.profile) {
        return {
          user: auth.currentUser || undefined,
          accessToken: gsiResult.accessToken || '',
          profile: gsiResult.profile,
        };
      }
    }

    if (typeof window !== 'undefined') {
      try {
        const googleAuthProvider = new GoogleAuthProvider();
        googleAuthProvider.setCustomParameters({ prompt: OAUTH_PROMPT_SELECT_ACCOUNT });
        if (options?.requestFullWorkspace) {
          WORKSPACE_SCOPES.forEach((workspaceScope) => {
            if (!workspaceScope.includes('userinfo.')) {
              googleAuthProvider.addScope(workspaceScope);
            }
          });
        }
        const popupCredentialResult = await signInWithPopup(auth, googleAuthProvider);
        const oauthCredential = GoogleAuthProvider.credentialFromResult(popupCredentialResult);
        const firebaseOAuthAccessToken = oauthCredential?.accessToken || '';
        const firebaseUser = popupCredentialResult.user;
        const userEmail = (firebaseUser.email || normalizedEmail || '').trim().toLowerCase();

        if (userEmail) {
          const rawName = firebaseUser.displayName || userEmail.split('@')[0];
          const displayName = rawName.startsWith(PROFESSOR_TITLE_PREFIX)
            ? rawName
            : `${PROFESSOR_TITLE_PREFIX} ${rawName}`;
          const rememberedProfile = getRememberedProfile(userEmail);
          const teacherProfile: TeacherProfile = {
            id: firebaseUser.uid || `teacher_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
            name: displayName,
            email: userEmail,
            avatar:
              firebaseUser.photoURL ||
              rememberedProfile?.avatar ||
              getTeacherAvatar(displayName, userEmail),
            role: DEFAULT_TEACHER_NAME,
            school: deriveSchoolFromEmail(userEmail),
            permissions: DEFAULT_TEACHER.permissions,
            scopes: WORKSPACE_SCOPES,
          };

          const effectiveWorkspaceToken =
            (options?.requestFullWorkspace &&
            firebaseOAuthAccessToken &&
            isValidGoogleAccessToken(firebaseOAuthAccessToken)
              ? firebaseOAuthAccessToken
              : null) ||
            getSavedTokenForEmail(userEmail) ||
            '';

          localStorage.removeItem(EXPLICIT_LOGOUT_STORAGE_KEY);
          sessionStorage.setItem(SESSION_ACTIVE_STORAGE_KEY, 'true');
          sessionStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, userEmail);

          if (effectiveWorkspaceToken && isValidGoogleAccessToken(effectiveWorkspaceToken)) {
            setCachedAccessToken(effectiveWorkspaceToken, userEmail);
          }
          saveRememberedProfile(teacherProfile);

          api
            .syncAuthSession({
              uid: teacherProfile.id,
              email: teacherProfile.email,
              name: teacherProfile.name,
              avatar: teacherProfile.avatar,
              token: effectiveWorkspaceToken || undefined,
              scopes: WORKSPACE_SCOPES,
              school: teacherProfile.school,
            })
            .catch(() => {});

          return {
            user: firebaseUser,
            accessToken: effectiveWorkspaceToken,
            profile: teacherProfile,
          };
        }
      } catch (firebasePopupError: any) {
        if (firebasePopupError?.code === 'auth/popup-closed-by-user') {
          throw new Error('Ventana de inicio de sesión de Google cerrada.');
        }
      }
    }

    if (
      typeof window !== 'undefined' &&
      (window as any).google?.accounts?.oauth2 &&
      getEffectiveOAuthClientId()
    ) {
      const promptType =
        options?.forcePopup || !isSessionCurrentlyActive
          ? OAUTH_PROMPT_SELECT_ACCOUNT
          : normalizedEmail
          ? ''
          : OAUTH_PROMPT_SELECT_ACCOUNT;
      const gsiResult = await signInWithGoogleIdentityServices(normalizedEmail || undefined, {
        prompt: promptType,
      });
      if (gsiResult?.profile) {
        return {
          user: auth.currentUser || undefined,
          accessToken: gsiResult.accessToken || '',
          profile: gsiResult.profile,
        };
      }
    }

    throw new Error('No se pudo abrir el selector de cuentas de Google. Intentá nuevamente.');
  } finally {
    isSigningIn = false;
  }
};

/**
 * Cierra la sesión activa del docente en la pestaña actual y en Firebase Auth,
 * conservando en `localStorage` el token OAuth por correo para no exigir re-consentimiento de permisos en el próximo ingreso.
 */
export const logoutUser = async (): Promise<void> => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(EXPLICIT_LOGOUT_STORAGE_KEY, 'true');
      sessionStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
      sessionStorage.removeItem(USER_PROFILE_STORAGE_KEY);
      sessionStorage.removeItem(TEACHER_EMAIL_STORAGE_KEY);
      localStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
      localStorage.removeItem(USER_PROFILE_STORAGE_KEY);
      localStorage.removeItem(TEACHER_EMAIL_STORAGE_KEY);
    } catch (_) {}
  }
  clearAuthSession();
  try {
    await signOut(auth);
  } catch (signOutError) {
    console.warn('SignOut error:', signOutError);
  }
  api.logoutAuth().catch(() => {});
};

/**
 * Intenta recuperar de forma silenciosa el token OAuth almacenado para el docente sin abrir ventanas emergentes.
 *
 * @param userEmail Correo electrónico opcional del docente.
 * @returns El token recuperado o `null`.
 */
export const renewGoogleSessionSilently = async (userEmail?: string): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  const existingToken = getCachedAccessToken();
  if (existingToken && isValidGoogleAccessToken(existingToken)) {
    return existingToken;
  }
  const recoveredToken = await requestGoogleAccessToken(false, userEmail);
  return recoveredToken || null;
};

/**
 * Wrapper universal de `fetch` para todas las APIs de Google Workspace (Sheets, Drive, Calendar, Classroom, Gmail, Docs, Forms).
 * Inyecta automáticamente la cabecera `Authorization: Bearer` y, ante un `401` o `403 insufficient_scope`,
 * invalida el token vencido e intenta una única recuperación silenciosa sin disparar bucles de popups.
 *
 * @param input URL o `Request` de destino hacia `googleapis.com`.
 * @param init Opciones estándar de la petición HTTP.
 * @param providedToken Token OAuth explícito opcional.
 * @returns La respuesta HTTP (`Response`) de la API de Google.
 */
export const fetchGoogleApiWithRetry = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  providedToken?: string
): Promise<Response> => {
  const activeToken = providedToken || getCachedAccessToken();

  const buildAuthorizedHeaders = (
    bearerToken: string | null,
    forceOverwrite = false
  ): Headers => {
    const requestHeaders = new Headers(init.headers || {});
    if (bearerToken && (forceOverwrite || !requestHeaders.has('Authorization'))) {
      requestHeaders.set('Authorization', `Bearer ${bearerToken}`);
    }
    return requestHeaders;
  };

  const response = await fetch(input, {
    ...init,
    headers: buildAuthorizedHeaders(activeToken),
  });

  const wwwAuthenticateHeader = (response.headers.get('www-authenticate') || '').toLowerCase();
  const isInsufficientOrExpiredScope =
    response.status === HTTP_STATUS_UNAUTHORIZED ||
    (response.status === HTTP_STATUS_FORBIDDEN &&
      wwwAuthenticateHeader.includes('insufficient_scope'));

  if (isInsufficientOrExpiredScope) {
    invalidateExpiredAccessToken(activeToken);

    // Nunca se abre un popup interactivo dentro de este interceptor de red para evitar bucles infinitos de ventanas cuando fallan peticiones en paralelo.
    if (!isRefreshingToken) {
      isRefreshingToken = true;
      try {
        const savedTokenForUser = getSavedTokenForEmail(getActiveTeacherEmail());
        if (
          savedTokenForUser &&
          savedTokenForUser !== activeToken &&
          isValidGoogleAccessToken(savedTokenForUser)
        ) {
          setCachedAccessToken(savedTokenForUser);
          return await fetch(input, {
            ...init,
            headers: buildAuthorizedHeaders(savedTokenForUser, true),
          });
        }
      } catch (_) {
      } finally {
        isRefreshingToken = false;
      }
    }
  }

  return response;
};
