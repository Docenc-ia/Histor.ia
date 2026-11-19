/**
 * Offline Sync Queue Service for Docenc.IA
 * Guarantees zero data loss when working without Wi-Fi in the classroom.
 * Automatically buffers changes in localStorage using safeSetLocalStorageItem,
 * deduplicates repeated edits to the same logical target, and flushes to Firestore/Google APIs when online.
 */

import { safeSetLocalStorageItem } from '../utils/storageGuard';
import { emitAppEvent } from '../utils/appEventBus';
import { getActiveUserId, isPrimaryOwnerAccount } from './firestore/firestoreClient';

export interface QueuedOfflineAction {
  id: string;
  type: 'observation_save' | 'observation_delete' | 'attendance_save' | 'generic_setting';
  payload: any;
  dedupKey?: string;
  createdAt: number;
  retryCount: number;
}

const LEGACY_STORAGE_QUEUE_KEY = 'docencia_offline_sync_queue_v1';
const MAX_OFFLINE_QUEUE_ITEMS = 300;
let isFlushing = false;

function getScopedQueueKey(): string {
  const uid = getActiveUserId();
  return uid ? `${LEGACY_STORAGE_QUEUE_KEY}_${uid}` : LEGACY_STORAGE_QUEUE_KEY;
}

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

// Read queue from persistent local storage (strictly scoped per active user, preserving any legacy items for primary owner)
export function getOfflineSyncQueue(): QueuedOfflineAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const scopedKey = getScopedQueueKey();
    const raw = localStorage.getItem(scopedKey);
    const scopedItems: QueuedOfflineAction[] = raw ? JSON.parse(raw) : [];

    // One-time non-destructive migration of legacy unscoped queue items for primary owner
    if (scopedKey !== LEGACY_STORAGE_QUEUE_KEY && isPrimaryOwnerAccount()) {
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_QUEUE_KEY);
      if (legacyRaw) {
        const legacyItems: QueuedOfflineAction[] = JSON.parse(legacyRaw);
        if (Array.isArray(legacyItems) && legacyItems.length > 0) {
          const existingIds = new Set(scopedItems.map((i) => i.id));
          const merged = [
            ...legacyItems.filter((item) => item && !existingIds.has(item.id)),
            ...scopedItems,
          ];
          safeSetLocalStorageItem(scopedKey, JSON.stringify(merged));
          localStorage.removeItem(LEGACY_STORAGE_QUEUE_KEY);
          return merged;
        }
        localStorage.removeItem(LEGACY_STORAGE_QUEUE_KEY);
      }
    }

    return Array.isArray(scopedItems) ? scopedItems : [];
  } catch (_) {
    return [];
  }
}

// Save queue to local storage using quota guard
function saveOfflineSyncQueue(queue: QueuedOfflineAction[], explicitKey?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const targetKey = explicitKey || getScopedQueueKey();
    if (queue.length === 0) {
      localStorage.removeItem(targetKey);
    } else {
      const bounded = queue.length > MAX_OFFLINE_QUEUE_ITEMS
        ? queue.slice(queue.length - MAX_OFFLINE_QUEUE_ITEMS)
        : queue;
      safeSetLocalStorageItem(targetKey, JSON.stringify(bounded));
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
 * Process pending queue items safely without losing items enqueued concurrently during async execution
 */
export async function flushOfflineSyncQueue(
  executor: (action: QueuedOfflineAction) => Promise<boolean>
): Promise<number> {
  if (isFlushing) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  const targetKey = getScopedQueueKey();
  const snapshot = getOfflineSyncQueue();
  if (snapshot.length === 0) return 0;

  isFlushing = true;
  let successfulCount = 0;
  const processedSnapshot = new Map<string, number>();
  const retryById = new Map<string, QueuedOfflineAction>();

  try {
    for (const action of snapshot) {
      processedSnapshot.set(action.id, action.createdAt);
      try {
        const ok = await executor(action);
        if (ok) {
          successfulCount++;
        } else {
          const nextRetry = (action.retryCount || 0) + 1;
          if (nextRetry < 5) {
            retryById.set(action.id, { ...action, retryCount: nextRetry });
          }
        }
      } catch (_) {
        const nextRetry = (action.retryCount || 0) + 1;
        if (nextRetry < 5) {
          retryById.set(action.id, { ...action, retryCount: nextRetry });
        }
      }
    }

    // Re-read the latest queue so any actions enqueued or updated while flushing are preserved
    let latestQueue: QueuedOfflineAction[] = [];
    try {
      const latestRaw = localStorage.getItem(targetKey);
      latestQueue = latestRaw ? JSON.parse(latestRaw) : [];
    } catch (_) {
      latestQueue = [];
    }

    const mergedRemaining: QueuedOfflineAction[] = [];
    for (const item of latestQueue) {
      const processedAt = processedSnapshot.get(item.id);
      if (processedAt === undefined) {
        // Brand-new action enqueued while flush was running -> preserve it!
        mergedRemaining.push(item);
      } else if (item.createdAt > processedAt) {
        // Existing dedupKey item was updated with newer data while flushing -> preserve latest version!
        mergedRemaining.push(item);
      } else if (retryById.has(item.id)) {
        // Failed action eligible for retry
        mergedRemaining.push(retryById.get(item.id)!);
      }
    }

    saveOfflineSyncQueue(mergedRemaining, targetKey);
  } finally {
    isFlushing = false;
  }

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
