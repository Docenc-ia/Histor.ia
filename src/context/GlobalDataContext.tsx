/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { Course, Student } from '../types';
import { api } from '../services/api';
import { useWorkspaceAuth } from './WorkspaceAuthContext';
import { navigationService } from '../services/navigationService';
import { subscribeAppEvents } from '../utils/appEventBus';
import { computeQuickStudentAttendanceRate } from '../utils/attendanceCalculations';
import {
  reconcileCourseList,
  reconcileStudentList,
} from '../utils/entityEquality';
import { hydrateTerminologySettingsFromCloud } from '../utils/terminologySettings';
import { getActiveUserId } from '../services/firestoreSync';

export interface GlobalDataContextValue {
  courses: Course[];
  students: Student[];
  isLoading: boolean;
  coursesRef: React.MutableRefObject<Course[]>;
  studentsRef: React.MutableRefObject<Student[]>;
  loadData: () => Promise<void>;
  refreshData: () => Promise<void>;
  setCourses: React.Dispatch<React.SetStateAction<Course[]>>;
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>;
  createCourse: (courseData: Partial<Course>) => Promise<Course>;
  deleteCourse: (courseId: string) => Promise<{ message?: string; courseName: string }>;
  clearAllCourses: () => Promise<{ message?: string }>;
  restoreDemoCourses: () => Promise<void>;
}

const GlobalDataContext = createContext<GlobalDataContextValue | undefined>(undefined);

export const GlobalDataContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useWorkspaceAuth();

  // Initialize courses with local cache + last active course LRU snapshot only when authenticated
  const [courses, setCourses] = useState<Course[]>(() => {
    if (!user) return [];
    const localList = api.deduplicateCourses(api.getLocalCourses());
    const snap = navigationService.getLastActiveCourseSnapshot();
    if (
      snap &&
      !localList.some(
        (c) =>
          c.id === snap.id ||
          (c.classroomCourseId && c.classroomCourseId === snap.classroomCourseId)
      )
    ) {
      return [snap, ...localList];
    }
    return localList;
  });

  // Initialize students from local cache with deduplication only when authenticated
  const [students, setStudents] = useState<Student[]>(() =>
    user ? api.deduplicateStudents(api.getLocalStudents()) : []
  );

  // Only show loading spinner if there is no cached or optimistic course data available
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!user) return false;
    const hasLocalCourses = api.getLocalCourses().length > 0;
    const hasOptimisticLastCourse = Boolean(
      navigationService.getLastActiveCourseSnapshot() ||
        navigationService.getLastActiveCourseId()
    );
    return !hasLocalCourses && !hasOptimisticLastCourse;
  });

  // Keep latest refs to courses and students so callbacks remain 100% referentially stable across refreshes
  const coursesRef = useRef<Course[]>(courses);
  coursesRef.current = courses;

  const studentsRef = useRef<Student[]>(students);
  studentsRef.current = students;

  // 2-Phase Optimistic UI loader (Phase 1: 0ms localStorage pre-load, Phase 2: Firebase sync & deep reconciliation)
  const loadData = useCallback(async () => {
    // Phase 1: Immediate optimistic UI pre-load from localStorage before Firebase finishes
    try {
      const localC = api.deduplicateCourses(api.getLocalCourses());
      const localS = api.deduplicateStudents(api.getLocalStudents());
      const optimistic = navigationService.preloadOptimisticCourseState(localC);

      if (optimistic.optimisticCoursesList.length > 0) {
        setCourses((prev) => reconcileCourseList(prev, optimistic.optimisticCoursesList));
      }
      if (localS.length > 0) {
        setStudents((prev) => reconcileStudentList(prev, localS));
      }
      if (
        optimistic.optimisticCoursesList.length > 0 ||
        Boolean(optimistic.targetCourseId)
      ) {
        setIsLoading((prev) => (prev ? false : prev));
      }
    } catch (_) {}

    // Phase 2: Asynchronous Firebase resolution & seamless state reconciliation
    try {
      const [c, s] = await Promise.all([api.getCourses(), api.getStudents()]);
      const cleanCourses = api.deduplicateCourses(c);
      const cleanStudents = api.deduplicateStudents(s);
      setCourses((prev) => reconcileCourseList(prev, cleanCourses));
      setStudents((prev) => reconcileStudentList(prev, cleanStudents));
      if (cleanCourses.length > 0) {
        navigationService.reconcileWithCourses(cleanCourses);
      }
    } catch (err) {
      console.error('Error fetching workspace courses and students:', err);
    } finally {
      setIsLoading((prev) => (prev ? false : prev));
    }
  }, []);

  // Sync courses & students when the authenticated user changes
  useEffect(() => {
    if (!user) {
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    loadData();
    const activeUid = getActiveUserId();
    if (activeUid) {
      hydrateTerminologySettingsFromCloud(activeUid).catch(() => {});
    }
    navigationService.syncUrlWithCurrentState();
  }, [user?.id, user?.email, loadData]);

  // Cascaded synchronization of student attendance/disposition status across modules (in-memory, zero network re-fetch)
  useEffect(() => {
    const handleStudentStatusSync = () => {
      try {
        const localStudents = api.deduplicateStudents(api.getLocalStudents());
        const localCourses =
          coursesRef.current.length > 0 ? coursesRef.current : api.getLocalCourses();
        const scheduleByCourseId = new Map<string, string>();
        const perCourseDispMap = new Map<string, Record<string, any>>();

        localCourses.forEach((c) => {
          if (c.id && c.schedule) scheduleByCourseId.set(c.id, c.schedule);
          if (c.id) {
            try {
              const rawCourseDisp = api.getUserScopedItem(`fds_disposition_data_${c.id}_1c`);
              if (rawCourseDisp) {
                const parsed = JSON.parse(rawCourseDisp);
                if (parsed && typeof parsed === 'object') {
                  perCourseDispMap.set(c.id, parsed);
                }
              }
            } catch (_) {}
          }
        });

        const localDisp = api.getAllDispositionStorage().disposition || {};
        const enriched = localStudents.map((st) => {
          const courseDisp = st.courseId ? perCourseDispMap.get(st.courseId) : undefined;
          const candidateGlobal =
            localDisp[`${st.courseId}::${st.id}`] || localDisp[st.id];
          const d =
            courseDisp?.[st.id] ||
            (candidateGlobal &&
            (!candidateGlobal.courseId || candidateGlobal.courseId === st.courseId)
              ? candidateGlobal
              : undefined);
          if (d && typeof d.totalAbsences === 'number') {
            const rate = computeQuickStudentAttendanceRate(
              st.id,
              st.courseId,
              d.totalAbsences,
              d.totalLates || 0,
              st.courseId ? scheduleByCourseId.get(st.courseId) : undefined
            );
            if (rate !== st.attendanceRate) {
              return { ...st, attendanceRate: rate };
            }
          }
          return st;
        });

        setStudents((prev) => reconcileStudentList(prev, enriched));
      } catch (_) {}
    };

    return subscribeAppEvents(
      ['docencia_disposition_storage_change', 'docencia_student_status_updated'],
      handleStudentStatusSync,
      60
    );
  }, []);

  // Immediately reflect course schedule/details updates across Sidebar, Mis Materias, and Workspace
  useEffect(() => {
    const handleCoursesUpdated = () => {
      try {
        const latestCourses = api.deduplicateCourses(api.getLocalCourses());
        setCourses((prev) => reconcileCourseList(prev, latestCourses));
        navigationService.reconcileWithCourses(latestCourses);
      } catch (_) {}
    };

    return subscribeAppEvents(['docencia_courses_updated'], handleCoursesUpdated, 40);
  }, []);

  const createCourse = useCallback(
    async (courseData: Partial<Course>): Promise<Course> => {
      setIsLoading(true);
      try {
        const newCourse = await api.createCourse(courseData);
        await loadData();
        navigationService.navigateTransaction({
          courseId: newCourse.id,
          historyMode: 'replace',
          scrollToTop: false,
        });
        return newCourse;
      } finally {
        setIsLoading(false);
      }
    },
    [loadData]
  );

  const deleteCourse = useCallback(
    async (courseId: string): Promise<{ message?: string; courseName: string }> => {
      const courseToDelete = coursesRef.current.find(
        (c) => c.id === courseId || c.classroomCourseId === courseId
      );
      const courseName = courseToDelete ? courseToDelete.name : 'Materia';

      const res = await api.deleteCourse(courseId);

      // Immediately update local state and reconcile navigation transactionally
      setCourses((prev) => {
        const updated = prev.filter(
          (c) => c.id !== courseId && c.classroomCourseId !== courseId
        );
        navigationService.reconcileWithCourses(updated, {
          deletedCourseId: courseToDelete?.id || courseId,
        });
        return reconcileCourseList(prev, updated);
      });

      await loadData();
      return { message: res.message, courseName };
    },
    [loadData]
  );

  const clearAllCourses = useCallback(async (): Promise<{ message?: string }> => {
    setIsLoading(true);
    try {
      const res = await api.clearAllCourses();
      navigationService.clearLastActiveCourse();
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      navigationService.navigateTransaction({
        view: 'courses',
        courseId: '',
        historyMode: 'replace',
        scrollToTop: false,
      });
      return { message: res.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restoreDemoCourses = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await api.restoreDemoCourses();
      await loadData();
    } finally {
      setIsLoading(false);
    }
  }, [loadData]);

  const contextValue = useMemo<GlobalDataContextValue>(
    () => ({
      courses,
      students,
      isLoading,
      coursesRef,
      studentsRef,
      loadData,
      refreshData: loadData,
      setCourses,
      setStudents,
      createCourse,
      deleteCourse,
      clearAllCourses,
      restoreDemoCourses,
    }),
    [
      courses,
      students,
      isLoading,
      loadData,
      createCourse,
      deleteCourse,
      clearAllCourses,
      restoreDemoCourses,
    ]
  );

  return (
    <GlobalDataContext.Provider value={contextValue}>
      {children}
    </GlobalDataContext.Provider>
  );
};

export const GlobalDataProvider = GlobalDataContextProvider;

export function useGlobalData(): GlobalDataContextValue {
  const context = useContext(GlobalDataContext);
  if (!context) {
    throw new Error('useGlobalData must be used within a GlobalDataContextProvider');
  }
  return context;
}
