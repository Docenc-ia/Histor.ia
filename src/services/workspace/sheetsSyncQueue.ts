/**
 * Unified Debounced Google Sheets Synchronization Queue
 * Coalesces rapid teacher edits (grades, attendance/disposition, libro de temas)
 * into a single batch update after 3.5s of inactivity per (courseId, docType),
 * preventing HTTP 429 Too Many Requests on the Google Sheets API.
 */

export type SheetsDocType = 'attendance' | 'grades' | 'libro_de_temas';

interface PendingSyncItem {
  key: string;
  courseId: string;
  docType: SheetsDocType;
  timer: ReturnType<typeof setTimeout>;
  task: () => Promise<void>;
  enqueuedAt: number;
}

class SheetsSyncQueueManager {
  private pending = new Map<string, PendingSyncItem>();
  private deferred = new Map<string, { courseId: string; docType: SheetsDocType; task: () => Promise<void> }>();
  private inFlight = new Set<string>();
  private lastSyncedAt = new Map<string, string>();

  constructor() {
    if (typeof window !== 'undefined') {
      // Flush pending debounced syncs immediately if the teacher switches tabs, minimizes, or closes/reloads
      window.addEventListener('pagehide', () => {
        this.flushAllPending();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushAllPending();
        }
      });
      // Automatically retry deferred tasks when internet connection returns or Google token is renewed
      window.addEventListener('online', () => {
        this.retryDeferred();
      });
      window.addEventListener('google_session_renewed', () => {
        this.retryDeferred();
      });
    }
  }

  private getKey(courseId: string, docType: SheetsDocType): string {
    return `${courseId}::${docType}`;
  }

  private emitStatus(courseId: string, docType: SheetsDocType, status: 'pending' | 'syncing' | 'synced' | 'error', errorMsg?: string) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('fds-sheets-queue-status', {
          detail: {
            courseId,
            docType,
            status,
            lastSyncedAt: this.lastSyncedAt.get(this.getKey(courseId, docType)),
            error: errorMsg,
          },
        })
      );
    }
  }

  /**
   * Enqueue a Google Sheets sync task with automatic debounce.
   * If another update for the same (courseId, docType) arrives within `delayMs`,
   * the previous timer is cancelled and replaced with the latest snapshot task.
   */
  enqueue(
    courseId: string,
    docType: SheetsDocType,
    task: () => Promise<void>,
    delayMs = 3500
  ): void {
    if (!courseId) return;
    const key = this.getKey(courseId, docType);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.deferred.set(key, { courseId, docType, task });
      this.emitStatus(courseId, docType, 'pending');
      return;
    }

    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    this.emitStatus(courseId, docType, 'pending');

    const timer = setTimeout(async () => {
      this.pending.delete(key);
      await this.executeTask(courseId, docType, task);
    }, delayMs);

    this.pending.set(key, {
      key,
      courseId,
      docType,
      timer,
      task,
      enqueuedAt: Date.now(),
    });
  }

  /**
   * Immediately execute a queued task (or run a new task right away, cancelling any pending debounce).
   */
  async flushNow(courseId: string, docType: SheetsDocType, immediateTask?: () => Promise<void>): Promise<void> {
    const key = this.getKey(courseId, docType);
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
    }
    const taskToRun = immediateTask || existing?.task;
    if (taskToRun) {
      await this.executeTask(courseId, docType, taskToRun);
    }
  }

  /**
   * Flushes all currently pending debounced tasks immediately (used on tab hide, page unload, or logout).
   */
  flushAllPending(): void {
    const items = Array.from(this.pending.values());
    this.pending.clear();
    for (const item of items) {
      clearTimeout(item.timer);
      this.executeTask(item.courseId, item.docType, item.task).catch(() => {});
    }
  }

  /**
   * Re-runs any tasks that failed or were queued while offline or while token was expired.
   */
  retryDeferred(): void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const items = Array.from(this.deferred.values());
    this.deferred.clear();
    for (const item of items) {
      this.enqueue(item.courseId, item.docType, item.task, 800);
    }
  }

  private async executeTask(courseId: string, docType: SheetsDocType, task: () => Promise<void>): Promise<void> {
    const key = this.getKey(courseId, docType);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.deferred.set(key, { courseId, docType, task });
      this.emitStatus(courseId, docType, 'pending');
      return;
    }

    if (this.inFlight.has(key)) {
      // Re-enqueue after short backoff if a request for the same document is currently in flight
      this.enqueue(courseId, docType, task, 2000);
      return;
    }

    this.inFlight.add(key);
    this.emitStatus(courseId, docType, 'syncing');

    try {
      await task();
      this.deferred.delete(key);
      const nowTime = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      this.lastSyncedAt.set(key, nowTime);
      this.emitStatus(courseId, docType, 'synced');
    } catch (err: any) {
      console.warn(`[SheetsSyncQueue] Error syncing ${docType} for course ${courseId}:`, err);
      this.deferred.set(key, { courseId, docType, task });
      this.emitStatus(courseId, docType, 'error', err?.message || 'Error de sincronización');
    } finally {
      this.inFlight.delete(key);
    }
  }

  isPendingOrSyncing(courseId: string, docType?: SheetsDocType): boolean {
    if (docType) {
      const key = this.getKey(courseId, docType);
      return this.pending.has(key) || this.inFlight.has(key);
    }
    const types: SheetsDocType[] = ['attendance', 'grades', 'libro_de_temas'];
    return types.some((t) => {
      const k = this.getKey(courseId, t);
      return this.pending.has(k) || this.inFlight.has(k);
    });
  }
}

export const sheetsSyncQueue = new SheetsSyncQueueManager();

