/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified Express backend transport with circuit-breaker cooldown,
 * static-host HTML fallback detection, auth header injection, and request timeout.
 */

import { isPrimaryOwnerAccount } from '../firestoreSync';
import { getExpressAuthHeaders } from '../expressAuthHeaders';

// Detect if we are running on a static/serverless host (e.g. Vercel) where local Express disk persistence is unavailable
let expressBackendAvailable: boolean =
  typeof window !== 'undefined' ? !window.location.hostname.endsWith('.vercel.app') : true;
let expressBackendCooldownUntil = 0;
const EXPRESS_NETWORK_COOLDOWN_MS = 30000;
const EXPRESS_REQUEST_TIMEOUT_MS = 12000;

export function canUseExpressBackend(requireOwner = true): boolean {
  if (!expressBackendAvailable) return false;
  if (Date.now() < expressBackendCooldownUntil) return false;
  return requireOwner ? isPrimaryOwnerAccount() : true;
}

export async function computeClientPasswordDigest(email: string, password: string): Promise<string> {
  const payload = `docencia_v1:${email.trim().toLowerCase()}:${password.trim()}`;
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoded = new TextEncoder().encode(payload);
      const buf = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (_) {}
  }
  return btoa(encodeURIComponent(payload));
}

export async function fetchExpressJson<T = any>(
  url: string,
  init?: RequestInit,
  timeoutMs = EXPRESS_REQUEST_TIMEOUT_MS
): Promise<T | null> {
  if (!expressBackendAvailable || Date.now() < expressBackendCooldownUntil) return null;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const externalSignal = init?.signal;

  const onExternalAbort = () => controller?.abort();
  if (controller) {
    if (externalSignal?.aborted) {
      return null;
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    timerId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const mergedHeaders = getExpressAuthHeaders(init?.headers);
    const res = await fetch(url, {
      ...init,
      headers: mergedHeaders,
      signal: controller ? controller.signal : init?.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Static host SPA fallback (returned HTML for /api/*) -> disable Express backend
      expressBackendAvailable = false;
      return null;
    }
    if (!res.ok) return null;
    expressBackendCooldownUntil = 0;
    return (await res.json()) as T;
  } catch {
    // Transient network hiccup or timeout: back off briefly instead of permanently disabling Express
    expressBackendCooldownUntil = Date.now() + EXPRESS_NETWORK_COOLDOWN_MS;
    return null;
  } finally {
    if (timerId !== null) clearTimeout(timerId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
