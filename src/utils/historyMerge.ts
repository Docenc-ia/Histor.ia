import { StudentHistoryItem } from '../types';

function parseUpdatedAtMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function isHistoryNotificationOmitted(item: Partial<StudentHistoryItem> | any): boolean {
  if (!item) return false;
  return Boolean(
    item.omitNotification ||
      item.notificationMethod === 'omitted' ||
      item.notificationMethod === 'none' ||
      item.notifiedAt === 'No enviar' ||
      item.notifiedAt === 'Omitido'
  );
}

export function isHistoryNotificationResolved(item: Partial<StudentHistoryItem> | any): boolean {
  if (!item) return false;
  return Boolean(
    item.messageSent ||
      isHistoryNotificationOmitted(item) ||
      (typeof item.notifiedAt === 'string' && item.notifiedAt.trim().length > 0)
  );
}

/**
 * Explicit resolution (user clicked "No mandar", "No enviar mensaje", or actually sent the message),
 * distinguished from legacy initial `notificationMethod: 'none'` entries.
 */
function isExplicitlyResolvedNotification(item: Partial<StudentHistoryItem> | any): boolean {
  if (!item) return false;
  return Boolean(
    item.messageSent === true ||
      item.omitNotification === true ||
      item.notificationMethod === 'omitted' ||
      item.notifiedAt === 'No enviar' ||
      item.notifiedAt === 'Omitido' ||
      (typeof item.notifiedAt === 'string' && item.notifiedAt.trim().length > 0)
  );
}

export function isPendingNotificationItem(
  item: Partial<StudentHistoryItem> | any,
  courseId?: string
): boolean {
  if (!item) return false;
  if (courseId && item.courseId !== courseId) return false;
  const isEligibleCategory =
    item.category === 'Ausencia' ||
    item.action === 'Ausencia' ||
    item.category === 'Disposición';
  if (!isEligibleCategory || item.category === 'Sistema') return false;
  const actionLower = String(item.action || '').toLowerCase();
  if (
    actionLower.includes('actualizada') ||
    actionLower.includes('verificación') ||
    actionLower.includes('ajuste')
  ) {
    return false;
  }
  return !isHistoryNotificationResolved(item);
}

export function mergeHistoryRecord<T extends Record<string, any>>(existing: T, incoming: T): T {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingUpdated = parseUpdatedAtMs(existing.updatedAt);
  const incomingUpdated = parseUpdatedAtMs(incoming.updatedAt);

  const existingExplicit = isExplicitlyResolvedNotification(existing);
  const incomingExplicit = isExplicitlyResolvedNotification(incoming);
  const existingResolved = isHistoryNotificationResolved(existing);
  const incomingResolved = isHistoryNotificationResolved(incoming);

  let notifSource: T = existing;
  if (incomingUpdated > existingUpdated) {
    // Only allow incoming newer timestamp to overwrite if it didn't regress from explicit resolved to empty stripped cloud copy
    if (existingExplicit && !incomingResolved && !incoming.updatedAt) {
      notifSource = existing;
    } else {
      notifSource = incoming;
    }
  } else if (existingUpdated > incomingUpdated) {
    notifSource = existing;
  } else {
    // Equal or missing updatedAt: never let a stripped/pending copy undo a resolved notification state
    if (incomingExplicit && !existingExplicit) {
      notifSource = incoming;
    } else if (existingExplicit && !incomingExplicit) {
      notifSource = existing;
    } else if (incomingResolved && !existingResolved) {
      notifSource = incoming;
    } else {
      notifSource = existing;
    }
  }

  const merged: Record<string, any> = {
    ...existing,
    ...incoming,
    // Keep richer optional fields if missing in one copy
    studentName: incoming.studentName || existing.studentName,
    courseName: incoming.courseName || existing.courseName,
    detail: incoming.detail || existing.detail,
    time: incoming.time || existing.time,
    notes: incoming.notes || existing.notes,
    // Apply winning notification status
    omitNotification: notifSource.omitNotification,
    notificationMethod:
      notifSource.notificationMethod ?? existing.notificationMethod ?? incoming.notificationMethod,
    messageSent:
      typeof notifSource.messageSent === 'boolean'
        ? notifSource.messageSent
        : Boolean(existing.messageSent || incoming.messageSent),
    notifiedAt: notifSource.notifiedAt,
    messageText: notifSource.messageText || existing.messageText || incoming.messageText,
  };

  const maxUpdated = Math.max(existingUpdated, incomingUpdated);
  if (maxUpdated > 0) {
    merged.updatedAt =
      incomingUpdated >= existingUpdated
        ? incoming.updatedAt || existing.updatedAt
        : existing.updatedAt || incoming.updatedAt;
  }

  return merged as T;
}

export function mergeHistoryLists<T extends Record<string, any>>(
  primaryList: T[],
  secondaryList: T[] = [],
  deletedIds?: Set<string>
): T[] {
  const map = new Map<string, T>();

  const processList = (list: T[]) => {
    for (const item of list || []) {
      const id = item?.id;
      if (!id || (deletedIds && deletedIds.has(id))) continue;
      const existing = map.get(id);
      map.set(id, existing ? mergeHistoryRecord(existing, item) : item);
    }
  };

  processList(primaryList);
  processList(secondaryList);

  const result = Array.from(map.values());
  result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return result;
}

export function hasHistoryNotificationDrift(
  cloudList: any[],
  mergedList: any[]
): boolean {
  const cloudById = new Map<string, any>();
  for (const item of cloudList || []) {
    if (item?.id) cloudById.set(item.id, item);
  }
  for (const item of mergedList || []) {
    if (!item?.id) continue;
    const cloudItem = cloudById.get(item.id);
    if (!cloudItem) {
      return true;
    }
    if (
      Boolean(cloudItem.omitNotification) !== Boolean(item.omitNotification) ||
      Boolean(cloudItem.messageSent) !== Boolean(item.messageSent) ||
      (cloudItem.notificationMethod || '') !== (item.notificationMethod || '') ||
      (cloudItem.notifiedAt || '') !== (item.notifiedAt || '')
    ) {
      return true;
    }
  }
  return false;
}
