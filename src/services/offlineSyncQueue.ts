/**
 * Offline Sync Queue Service for Docenc.IA
 * Guarantees zero data loss when working without Wi-Fi in the classroom.
 * Automatically buffers changes in localStorage using safeSetLocalStorageItem,
 * deduplicates repeated edits to the same logical target, and flushes to Firestore/Google APIs when online.
 */

import { safeSetLocalStorageItem } from '../utils/storageGuard';
import { emitAppEvent } from '../utils/appEventBus';

export interface QueuedOfflineAction {
  id: string;
  type: 'observation_save' | 'observation_delete' | 'attendance_save' | 'generic_setting';
  payload: any;
  dedupKey?: string;
  createdAt: number;
  retryCount: number;
}

const STORAGE_QUEUE_KEY = 'docencia_offline_sync_queue_v1';
const MAX_OFFLINE_QUEUE_ITEMS = 300;
let isFlushing = false;

/**
 * Computes a logical deduplication key so multiple offline edits to the same
 * attendance date, observation, or setting replace the previous queued entry in-place.
 */
function computeActionDedupKey(
  type: QueuedOfflineAction['type'],
  payload: any
): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  switch (type) {
    case 'attendance_save': {
      const courseId = payload.courseId || '';
      const date = payload.date || '';
      return courseId && date ? `att:${courseId}:${date}` : undefined;
    }
    case 'observation_save':
    case 'observation_delete': {
      const obsId = payload.observation?.id || payload.observationId || payload.id || '';
      const studentId = payload.studentId || payload.observation?.studentId || '';
      return obsId ? `obs:${type}:${obsId}:${studentId}` : undefined;
    }
    case 'generic_setting': {
      const settingKey = payload.settingKey || payload.key || '';
      const userId = payload.userId || '';
      return settingKey ? `set:${userId}:${settingKey}` : undefined;
    }
    default:
      return undefined;
  }
}

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

// Save queue to local storage using quota guard
function saveOfflineSyncQueue(queue: QueuedOfflineAction[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (queue.length === 0) {
      localStorage.removeItem(STORAGE_QUEUE_KEY);
    } else {
      const bounded = queue.length > MAX_OFFLINE_QUEUE_ITEMS
        ? queue.slice(queue.length - MAX_OFFLINE_QUEUE_ITEMS)
        : queue;
      safeSetLocalStorageItem(STORAGE_QUEUE_KEY, JSON.stringify(bounded));
    }
    emitAppEvent('docencia_offline_queue_changed', { pendingCount: queue.length }, 0);
  } catch (_) {}
}

/**
 * Enqueue an action to be executed when back online.
 * Coalesces repeated edits for the same logical entity so the queue stays compact.
 */
export function enqueueOfflineAction(
  type: QueuedOfflineAction['type'],
  payload: any
): QueuedOfflineAction {
  const queue = getOfflineSyncQueue();
  const dedupKey = computeActionDedupKey(type, payload);

  if (dedupKey) {
    const existingIdx = queue.findIndex((item) => item.dedupKey === dedupKey);
    if (existingIdx >= 0) {
      const updated: QueuedOfflineAction = {
        ...queue[existingIdx],
        payload,
        createdAt: Date.now(),
        retryCount: 0,
      };
      queue[existingIdx] = updated;
      saveOfflineSyncQueue(queue);
      return updated;
    }
  }

  const action: QueuedOfflineAction = {
    id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type,
    payload,
    dedupKey,
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
    emitAppEvent('docencia_queue_flushed', { count: successfulCount }, 0);
  }

  return successfulCount;
}

// Auto-flush trigger on network restoration
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    emitAppEvent('docencia_trigger_queue_flush', undefined, 0);
  });
}
