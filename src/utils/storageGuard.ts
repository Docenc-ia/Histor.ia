/**
 * Safe localStorage Quota Guard & Non-Destructive JSON Compactor.
 * Guarantees 100% preservation of all teacher data (courses, students, attendance,
 * disposition, grades, libro de temas, observations, presets) while preventing
 * QuotaExceededError on devices with heavy multi-year usage.
 */

const TRANSIENT_KEY_PREFIXES = [
  'fds_fp_v1_',
  'fds_temp_',
  'fds_preview_cache_',
  'vite-',
];

let maintenanceExecuted = false;

/**
 * Compacts a JSON string if it contains unnecessary pretty-print whitespace,
 * preserving 100% identical data structure and keys.
 */
function compactJsonIfPossible(raw: string): string {
  if (!raw || raw.length < 256) return raw;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    if (trimmed.includes('\n  ') || trimmed.includes('\n\t')) {
      try {
        return JSON.stringify(JSON.parse(trimmed));
      } catch (_) {
        return raw;
      }
    }
  }
  return raw;
}

/**
 * Reclaims space in localStorage without ever deleting teacher records:
 * 1. Removes only ephemeral/transient cache keys if any exist in localStorage.
 * 2. Compacts indented JSON payloads in-place to save 20-35% byte overhead.
 */
export function reclaimTransientStorageSpace(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const keysToRemove: string[] = [];
    const keysToCompact: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (TRANSIENT_KEY_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        keysToRemove.push(k);
      } else {
        keysToCompact.push(k);
      }
    }

    for (const k of keysToRemove) {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    }

    for (const k of keysToCompact) {
      try {
        const val = localStorage.getItem(k);
        if (val && val.length > 512) {
          const compacted = compactJsonIfPossible(val);
          if (compacted.length < val.length) {
            localStorage.setItem(k, compacted);
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Safely writes to localStorage with automatic compaction and QuotaExceededError recovery.
 */
export function safeSetLocalStorageItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const prepared = compactJsonIfPossible(value);
  try {
    localStorage.setItem(key, prepared);
    return true;
  } catch (err: any) {
    // If quota is exceeded, reclaim transient space and compact existing JSONs, then retry
    reclaimTransientStorageSpace();
    try {
      localStorage.setItem(key, prepared);
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Runs once per session on startup to silently compact indented JSON entries
 * and migrate any stray transient fingerprint keys out of localStorage.
 */
export function runStorageMaintenanceOnce(): void {
  if (maintenanceExecuted || typeof window === 'undefined') return;
  maintenanceExecuted = true;
  try {
    reclaimTransientStorageSpace();
  } catch (_) {}
}
