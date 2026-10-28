import { Course, Student } from '../types';

export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
  const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);

  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!isDeepEqual(objA[key], objB[key])) return false;
  }

  return true;
}

export function areCoursesEqual(
  a: Course | null | undefined,
  b: Course | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.subject !== b.subject ||
    a.grade !== b.grade ||
    a.orientation !== b.orientation ||
    a.division !== b.division ||
    a.room !== b.room ||
    a.schedule !== b.schedule ||
    a.color !== b.color ||
    a.studentsCount !== b.studentsCount ||
    a.studentCount !== b.studentCount ||
    a.schoolYear !== b.schoolYear ||
    a.classroomCourseId !== b.classroomCourseId ||
    a.classroomSynced !== b.classroomSynced
  ) {
    return false;
  }
  return isDeepEqual(a, b);
}

export function areCourseListsEqual(
  prev: Course[] | null | undefined,
  next: Course[] | null | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (!areCoursesEqual(prev[i], next[i])) return false;
  }
  return true;
}

/**
 * Reconciles a new course list against the previous state:
 * - Returns the exact `prev` array reference if all courses are deeply equal.
 * - Preserves individual `Course` object references for unchanged items when only a subset changed.
 */
export function reconcileCourseList(prev: Course[], next: Course[]): Course[] {
  if (areCourseListsEqual(prev, next)) return prev;
  if (prev.length === 0) return next;
  const prevById = new Map<string, Course>();
  for (let i = 0; i < prev.length; i++) {
    prevById.set(prev[i].id, prev[i]);
  }
  let reusedAny = false;
  const reconciled = next.map((item) => {
    const existing = prevById.get(item.id);
    if (existing && areCoursesEqual(existing, item)) {
      reusedAny = true;
      return existing;
    }
    return item;
  });
  return reusedAny ? reconciled : next;
}

export function areStudentsEqual(
  a: Student | null | undefined,
  b: Student | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.id !== b.id ||
    a.courseId !== b.courseId ||
    a.classroomUserId !== b.classroomUserId ||
    a.firstName !== b.firstName ||
    a.lastName !== b.lastName ||
    a.email !== b.email ||
    a.phone !== b.phone ||
    a.avatar !== b.avatar ||
    a.attendanceRate !== b.attendanceRate ||
    a.averageGrade !== b.averageGrade ||
    a.notes !== b.notes
  ) {
    return false;
  }
  return isDeepEqual(a, b);
}

export function areStudentListsEqual(
  prev: Student[] | null | undefined,
  next: Student[] | null | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (!areStudentsEqual(prev[i], next[i])) return false;
  }
  return true;
}

/**
 * Reconciles a new student list against the previous state:
 * - Returns the exact `prev` array reference if all students are deeply equal.
 * - Preserves individual `Student` object references for unchanged items when only a subset changed.
 */
export function reconcileStudentList(prev: Student[], next: Student[]): Student[] {
  if (areStudentListsEqual(prev, next)) return prev;
  if (prev.length === 0) return next;
  const prevByKey = new Map<string, Student>();
  for (let i = 0; i < prev.length; i++) {
    const s = prev[i];
    prevByKey.set(`${s.courseId || ''}::${s.id}`, s);
  }
  let reusedAny = false;
  const reconciled = next.map((item) => {
    const existing = prevByKey.get(`${item.courseId || ''}::${item.id}`);
    if (existing && areStudentsEqual(existing, item)) {
      reusedAny = true;
      return existing;
    }
    return item;
  });
  return reusedAny ? reconciled : next;
}
