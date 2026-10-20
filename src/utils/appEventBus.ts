/**
 * Centralized Typed Event Bus with Micro-Task Coalescing.
 * Preserves 100% backward compatibility with native `window.addEventListener` / `window.dispatchEvent`
 * while deduplicating rapid identical events fired within the same execution window.
 */

export type AppEventName =
  | 'docencia_student_status_updated'
  | 'docencia_disposition_storage_change'
  | 'docencia_open_attendance_settings'
  | 'docencia_global_attendance_settings_updated'
  | 'docencia_cloud_sync_status'
  | 'docencia_course_settings_updated';

const pendingEventTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Emits a global application event.
 * Coalesces rapid bursts of the same event (e.g., batch updates) within `coalesceMs`
 * so listeners do not re-fetch or re-render multiple times in the same frame.
 */
export function emitAppEvent<T = unknown>(
  eventName: AppEventName | string,
  detail?: T,
  coalesceMs = 50
): void {
  if (typeof window === 'undefined') return;

  // Immediate synchronous events that open UI modals or update status indicators
  if (
    eventName === 'docencia_open_attendance_settings' ||
    eventName === 'docencia_cloud_sync_status' ||
    coalesceMs <= 0
  ) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (_) {}
    return;
  }

  const existing = pendingEventTimers.get(eventName);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    pendingEventTimers.delete(eventName);
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (_) {}
  }, coalesceMs);

  pendingEventTimers.set(eventName, timer);
}

/**
 * Subscribes to one or more application events and coalesces notifications
 * so that if multiple related events fire together, the callback runs once.
 */
export function subscribeAppEvents(
  eventNames: (AppEventName | string)[],
  callback: (event: Event) => void,
  debounceMs = 60
): () => void {
  if (typeof window === 'undefined') return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;

  const handler = (event: Event) => {
    if (debounceMs <= 0) {
      callback(event);
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback(event);
    }, debounceMs);
  };

  for (const name of eventNames) {
    window.addEventListener(name, handler);
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const name of eventNames) {
      window.removeEventListener(name, handler);
    }
  };
}
