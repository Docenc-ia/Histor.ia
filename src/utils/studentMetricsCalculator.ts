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

export function calculateStudentMetrics(params: {
  studentId: string;
  targetTerm: '1c' | '2c' | 'annual' | 'all';
  activeCourseId?: string;
  students: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  historyList: StudentHistoryItem[];
}): StudentDispositionData {
  const {
    studentId,
    targetTerm,
    activeCourseId,
    students,
    dispositionMap,
    dispositionMap2c,
    historyList,
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

  // Check if this student is shared with another course or has history in another course
  const isSharedStudent = activeCourseId
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

  const studentHistory = historyList.filter(
    (h) =>
      h.studentId === studentId &&
      (!activeCourseId ||
        h.courseId === activeCourseId ||
        (!h.courseId && !isSharedStudent)) &&
      (is2c ? h.term === '2c' : (h.term === '1c' || !h.term))
  );

  let historyAbsences = studentHistory.filter(
    (h) =>
      (h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta')) &&
      h.category !== 'Sistema' &&
      !h.action?.toLowerCase().includes('actualizada') &&
      !h.action?.toLowerCase().includes('verificación') &&
      !h.action?.toLowerCase().includes('ajuste')
  ).length;

  // Also respect manual absence edits recorded as 'Sistema' for this course ("Inasistencias actualizadas...: X → Y faltas")
  const latestManualAbsEdit = [...studentHistory]
    .filter(
      (h) =>
        h.category === 'Sistema' &&
        (h.action?.includes('Inasistencias actualizadas') || h.action?.includes('Verificación de inasistencias'))
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
  if (latestManualAbsEdit && fromMap?.totalAbsences === undefined) {
    const matchArrow = latestManualAbsEdit.action.match(/→\s*(\d+)\s*falta/i);
    const matchColon = latestManualAbsEdit.action.match(/:\s*(\d+)\s*falta/i);
    const baseAbs = matchArrow ? parseInt(matchArrow[1], 10) : matchColon ? parseInt(matchColon[1], 10) : NaN;
    if (!isNaN(baseAbs)) {
      const absencesAfterEdit = studentHistory.filter(
        (h) =>
          (h.timestamp || 0) > (latestManualAbsEdit.timestamp || 0) &&
          (h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta')) &&
          h.category !== 'Sistema'
      ).length;
      historyAbsences = baseAbs + absencesAfterEdit;
    }
  }

  const historyLates = studentHistory.filter(
    (h) =>
      (h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza')) &&
      h.category !== 'Sistema'
  ).length;

  let calculatedDisp = 10;
  const sortedStudentEvents = [...studentHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const ev of sortedStudentEvents) {
    const isReset =
      ev.category === 'Sistema' ||
      ev.action?.toLowerCase().includes('restablecid') ||
      ev.action?.toLowerCase().includes('reinicio');
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

  let totalAbsences = 0;
  if (fromMap?.totalAbsences !== undefined && fromMap?.totalAbsences !== null) {
    totalAbsences = Math.max(0, Number(fromMap.totalAbsences) || 0);
  } else {
    totalAbsences = historyAbsences;
  }

  let totalLates = 0;
  if (fromMap?.totalLates !== undefined && fromMap?.totalLates !== null) {
    totalLates = Math.max(0, Number(fromMap.totalLates) || 0);
  } else {
    totalLates = historyLates;
  }

  let totalDisposition = 10;
  if (fromMap?.totalDisposition !== undefined && fromMap?.totalDisposition !== null) {
    totalDisposition = Number(fromMap.totalDisposition);
  } else {
    totalDisposition = calculatedDisp;
  }

  return {
    totalAbsences,
    totalLates,
    totalDisposition,
  };
}
