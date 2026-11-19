/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getActiveUserEmail, getActiveUserId } from './firestoreSync';

const SESSION_SECRET_KEY = 'docencia_session_secret';

let googleTokenProvider: (() => string | null) | null = null;

/**
 * Registra un proveedor de token OAuth de Google sin introducir dependencias circulares
 * entre `googleAuth.ts` y los clientes HTTP del backend Express.
 */
export function registerExpressAuthTokenProvider(provider: () => string | null): void {
  googleTokenProvider = provider;
}

export function getStoredSessionSecret(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      sessionStorage.getItem(SESSION_SECRET_KEY) ||
      localStorage.getItem(SESSION_SECRET_KEY) ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export function saveStoredSessionSecret(secret?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (secret && secret.trim()) {
      sessionStorage.setItem(SESSION_SECRET_KEY, secret.trim());
      localStorage.setItem(SESSION_SECRET_KEY, secret.trim());
    } else {
      sessionStorage.removeItem(SESSION_SECRET_KEY);
      localStorage.removeItem(SESSION_SECRET_KEY);
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

/**
 * Construye los encabezados de autenticación requeridos por el backend Express (`/api/*`),
 * adjuntando identidad activa, `X-Session-Secret` y (si existe sesión Google) el Bearer token
 * para validación criptográfica en el servidor.
 */
export function getExpressAuthHeaders(
  extraHeaders?: HeadersInit
): Record<string, string> {
  const mergedHeaders: Record<string, string> = {};
  if (extraHeaders) {
    if (extraHeaders instanceof Headers) {
      extraHeaders.forEach((value, key) => {
        mergedHeaders[key] = value;
      });
    } else if (Array.isArray(extraHeaders)) {
      extraHeaders.forEach(([key, value]) => {
        mergedHeaders[key] = value;
      });
    } else {
      Object.assign(mergedHeaders, extraHeaders);
    }
  }

  const activeUserId = getActiveUserId() || '';
  const activeEmail = getActiveUserEmail() || '';
  const sessionSecret = getStoredSessionSecret();
  const googleToken = googleTokenProvider ? googleTokenProvider() : null;

  if (activeUserId && !mergedHeaders['X-User-Id'] && !mergedHeaders['x-user-id']) {
    mergedHeaders['X-User-Id'] = activeUserId;
  }
  if (activeEmail && !mergedHeaders['X-User-Email'] && !mergedHeaders['x-user-email']) {
    mergedHeaders['X-User-Email'] = activeEmail;
  }
  if (
    sessionSecret &&
    !mergedHeaders['X-Session-Secret'] &&
    !mergedHeaders['x-session-secret']
  ) {
    mergedHeaders['X-Session-Secret'] = sessionSecret;
  }
  if (
    googleToken &&
    googleToken.length > 20 &&
    !googleToken.startsWith('token_') &&
    !mergedHeaders['Authorization'] &&
    !mergedHeaders['authorization']
  ) {
    mergedHeaders['Authorization'] = `Bearer ${googleToken}`;
  }

  return mergedHeaders;
}

/**
 * Wrapper de `fetch` para rutas internas `/api/*` que adjunta automáticamente
 * las credenciales de sesión docente sin afectar llamadas externas.
 */
export function expressAuthFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: getExpressAuthHeaders(init?.headers),
  });
}
