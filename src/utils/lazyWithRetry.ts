/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy } from 'react';

const RELOAD_GUARD_KEY = 'docencia_dynamic_import_reload_ts';
const RELOAD_COOLDOWN_MS = 15_000;

/**
 * Detecta si un error corresponde a una falla al descargar un módulo dinámico / chunk
 * (por ejemplo, cuando el servidor de desarrollo se reinicia o se despliega una versión nueva
 * mientras una pestaña del navegador ya estaba abierta).
 */
export function isDynamicImportFetchError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error || '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading chunk [\d]+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Outdated Optimize Dep/i.test(message)
  );
}

/**
 * Ejecuta una recarga controlada única (con ventana de enfriamiento de 15 s)
 * para recuperar módulos dinámicos obsoletos sin caer nunca en bucles de recarga.
 */
export function trySafeReloadForStaleModule(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const lastReloadRaw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    const lastReloadTs = lastReloadRaw ? Number(lastReloadRaw) : 0;
    const now = Date.now();
    if (!Number.isFinite(lastReloadTs) || now - lastReloadTs > RELOAD_COOLDOWN_MS) {
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // Si sessionStorage no está disponible, no forzamos recarga automática
  }
  return false;
}

/**
 * Envuelve `React.lazy` con reintentos automáticos y recuperación controlada ante
 * fallos de importación dinámica (ej. reinicio del dev server o actualización en curso).
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const retryDelaysMs = [350, 900];
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        return await componentImport();
      } catch (error) {
        lastError = error;
        if (attempt < retryDelaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
        }
      }
    }

    if (isDynamicImportFetchError(lastError) && trySafeReloadForStaleModule()) {
      // Mantenemos la promesa pendiente brevemente mientras el navegador recarga
      return new Promise<{ default: T }>(() => {});
    }

    throw lastError;
  });
}
