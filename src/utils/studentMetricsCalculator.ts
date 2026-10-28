import { Student, StudentDispositionData, StudentHistoryItem } from '../types';
import { getDeletedHistoryIds } from '../services/api';

// Helper function to deduplicate history entries (only filters identical IDs or deleted tombstones)
export function deduplicateHistory(list: StudentHistoryItem[]): StudentHistoryItem[] {
  const result: StudentHistoryItem[] = [];
  const seenIds = new Set<string>();
  const deleted = getDeletedHistoryIds();

  for (const item of list) {
    if (!item?.id || seenIds.has(item.id) || deleted.has(item.id)) continue;
    seenIds.add(item.id);
    result.push(item);
  }
  return result;
}

export interface PrecomputedStudentHistoryIndex {
  activeCourseId?: string;
  sharedStudentIds: Set<string>;
  byStudent1c: Map<string, StudentHistoryItem[]>;
  byStudent2c: Map<string, StudentHistoryItem[]>;
}

/**
 * Pre-indexes history items and shared student status in a single O(H + S) pass
 * so per-student metrics calculations run in O(1) lookup time per student.
 */
export function buildStudentHistoryIndex(
  historyList: StudentHistoryItem[],
  students: Student[],
  activeCourseId?: string
): PrecomputedStudentHistoryIndex {
  const sharedStudentIds = new Set<string>();
  const byStudent1c = new Map<string, StudentHistoryItem[]>();
  const byStudent2c = new Map<string, StudentHistoryItem[]>();

  if (activeCourseId) {
    for (const s of students) {
      if (s?.id && s.courseId && s.courseId !== activeCourseId) {
        sharedStudentIds.add(s.id);
      }
    }
    for (const h of historyList) {
      if (h?.studentId && h.courseId && h.courseId !== activeCourseId) {
        sharedStudentIds.add(h.studentId);
      }
    }
  }

  for (const h of historyList) {
    if (!h?.studentId) continue;
    const isShared = sharedStudentIds.has(h.studentId);
    const belongsToCourse =
      !activeCourseId ||
      h.courseId === activeCourseId ||
      (!h.courseId && !isShared);

    if (!belongsToCourse) continue;

    if (h.term === '2c') {
      let arr = byStudent2c.get(h.studentId);
      if (!arr) {
        arr = [];
        byStudent2c.set(h.studentId, arr);
      }
      arr.push(h);
    } else if (h.term === '1c' || !h.term) {
      let arr = byStudent1c.get(h.studentId);
      if (!arr) {
        arr = [];
        byStudent1c.set(h.studentId, arr);
      }
      arr.push(h);
    }
  }

  return {
    activeCourseId,
    sharedStudentIds,
    byStudent1c,
    byStudent2c,
  };
}

export function calculateStudentMetrics(params: {
  studentId: string;
  targetTerm: '1c' | '2c' | 'annual' | 'all';
  activeCourseId?: string;
  students: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  historyList: StudentHistoryItem[];
  historyIndex?: PrecomputedStudentHistoryIndex;
}): StudentDispositionData {
  const {
    studentId,
    targetTerm,
    activeCourseId,
    students,
    dispositionMap,
    dispositionMap2c,
    historyList,
    historyIndex,
  } = params;

  if (targetTerm === 'annual' || targetTerm === 'all') {
    const m1 = calculateStudentMetrics({
      ...params,
      targetTerm: '1c',
    });
    const m2 = calculateStudentMetrics({
      ...params,
      targetTerm: '2c',
    });
    const totalAbsences = m1.totalAbsences + m2.totalAbsences;
    const totalLates = (m1.totalLates || 0) + (m2.totalLates || 0);
    const totalDisposition = Number(((m1.totalDisposition + m2.totalDisposition) / 2).toFixed(1));
    return {
      totalAbsences,
      totalLates,
      totalDisposition,
    };
  }

  const is2c = targetTerm === '2c';
  const rawFromMap = is2c ? dispositionMap2c[studentId] : dispositionMap[studentId];

  const useIndex = historyIndex && historyIndex.activeCourseId === activeCourseId;

  // Check if this student is shared with another course or has history in another course
  const isSharedStudent = useIndex
    ? historyIndex.sharedStudentIds.has(studentId)
    : activeCourseId
    ? students.some((s) => s.id === studentId && s.courseId && s.courseId !== activeCourseId) ||
      historyList.some((h) => h.studentId === studentId && h.courseId && h.courseId !== activeCourseId)
    : false;

  // Only trust fromMap if it is explicitly stamped with activeCourseId, or if the student is not shared across courses
  const isMapScopedToThisCourse =
    rawFromMap &&
    (!activeCourseId ||
      (rawFromMap as any).courseId === activeCourseId ||
      (!((rawFromMap as any).courseId) && !isSharedStudent));

  const fromMap = isMapScopedToThisCourse ? rawFromMap : undefined;

  const studentHistory = useIndex
    ? (is2c ? historyIndex.byStudent2c.get(studentId) : historyIndex.byStudent1c.get(studentId)) || []
    : historyList.filter(
        (h) =>
          h.studentId === studentId &&
          (!activeCourseId ||
            h.courseId === activeCourseId ||
            (!h.courseId && !isSharedStudent)) &&
          (is2c ? h.term === '2c' : (h.term === '1c' || !h.term))
      );

  let historyAbsences = 0;
  let historyLates = 0;
  let latestManualAbsEdit: StudentHistoryItem | undefined;

  for (const h of studentHistory) {
    const actLower = (h.action || '').toLowerCase();
    if (
      h.category === 'Sistema' &&
      (h.action?.includes('Inasistencias actualizadas') || h.action?.includes('Verificación de inasistencias'))
    ) {
      if (!latestManualAbsEdit || (h.timestamp || 0) > (latestManualAbsEdit.timestamp || 0)) {
        latestManualAbsEdit = h;
      }
      continue;
    }

    if (h.category === 'Sistema') continue;

    if (
      (h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        actLower.includes('ausencia') ||
        actLower.includes('falta')) &&
      !actLower.includes('actualizada') &&
      !actLower.includes('verificación') &&
      !actLower.includes('ajuste')
    ) {
      historyAbsences++;
    } else if (
      h.category === 'Llegada tarde' ||
      h.action === 'Llegada tarde' ||
      actLower.includes('llegada tarde') ||
      actLower.includes('tarde') ||
      actLower.includes('tardanza')
    ) {
      historyLates++;
    }
  }

  // Respect manual absence edits recorded as 'Sistema' for this course ("Inasistencias actualizadas...: X → Y faltas")
  if (latestManualAbsEdit && fromMap?.totalAbsences === undefined) {
    const matchArrow = latestManualAbsEdit.action.match(/→\s*(\d+)\s*falta/i);
    const matchColon = latestManualAbsEdit.action.match(/:\s*(\d+)\s*falta/i);
    const baseAbs = matchArrow ? parseInt(matchArrow[1], 10) : matchColon ? parseInt(matchColon[1], 10) : NaN;
    if (!isNaN(baseAbs)) {
      const editTs = latestManualAbsEdit.timestamp || 0;
      let absencesAfterEdit = 0;
      for (const h of studentHistory) {
        if ((h.timestamp || 0) <= editTs || h.category === 'Sistema') continue;
        const actLower = (h.action || '').toLowerCase();
        if (
          h.category === 'Ausencia' ||
          h.action === 'Ausencia' ||
          actLower.includes('ausencia') ||
          actLower.includes('falta')
        ) {
          absencesAfterEdit++;
        }
      }
      historyAbsences = baseAbs + absencesAfterEdit;
    }
  }

  let calculatedDisp = 10;
  if (studentHistory.length > 0) {
    const sortedStudentEvents =
      studentHistory.length > 1
        ? [...studentHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        : studentHistory;
    for (const ev of sortedStudentEvents) {
      const actLower = (ev.action || '').toLowerCase();
      const isReset =
        ev.category === 'Sistema' ||
        actLower.includes('restablecid') ||
        actLower.includes('reinicio');
      if (isReset) {
        calculatedDisp = 10;
        continue;
      }
      if (ev.pointsChange !== undefined) {
        calculatedDisp = Math.min(10, Math.max(0, calculatedDisp + ev.pointsChange));
      } else if (ev.category === 'Disposición') {
        calculatedDisp = Math.max(0, calculatedDisp - 1);
      }
    }
  }

  const totalAbsences =
    fromMap?.totalAbsences !== undefined && fromMap?.totalAbsences !== null
      ? Math.max(0, Number(fromMap.totalAbsences) || 0)
      : historyAbsences;

  const totalLates =
    fromMap?.totalLates !== undefined && fromMap?.totalLates !== null
      ? Math.max(0, Number(fromMap.totalLates) || 0)
      : historyLates;

  const totalDisposition =
    fromMap?.totalDisposition !== undefined && fromMap?.totalDisposition !== null
      ? Number(fromMap.totalDisposition)
      : calculatedDisp;

  return {
    totalAbsences,
    totalLates,
    totalDisposition,
  };
}
