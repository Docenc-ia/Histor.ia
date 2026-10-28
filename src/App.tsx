/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { WorkspaceAuthProvider, useWorkspaceAuth } from './context/WorkspaceAuthContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { LandingPage } from './components/landing/LandingPage';
import { TeacherCoursesPanel } from './components/dashboard/TeacherCoursesPanel';
import { Course, Student } from './types';
import { api } from './services/api';
import { CheckCircle2 } from 'lucide-react';
import { GoogleSessionExpiryBanner } from './components/modules/classes/GoogleSessionExpiryBanner';
import { CourseWorkspaceView } from './components/modules/CourseWorkspaceView';
import { subscribeAppEvents } from './utils/appEventBus';
import { computeQuickStudentAttendanceRate } from './utils/attendanceCalculations';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { findCourseMatch } from './utils/courseFormatting';
import { useNavigationService } from './services/navigationService';
import {
  areCoursesEqual,
  areCourseListsEqual,
  reconcileCourseList,
  areStudentsEqual,
  areStudentListsEqual,
  reconcileStudentList,
} from './utils/entityEquality';

// Safe lazy loading with retry for secondary modals and views
const lazyWithRetry = (componentImport: () => Promise<any>) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      console.warn('Retrying dynamic module load...', error);
      // Wait 300ms and retry once
      await new Promise((resolve) => setTimeout(resolve, 300));
      return await componentImport();
    }
  });

const CalendarModule = lazyWithRetry(() =>
  import('./components/modules/CalendarModule').then((m) => ({ default: m.CalendarModule }))
);
const ImportClassroomModal = lazyWithRetry(() =>
  import('./components/dashboard/ImportClassroomModal').then((m) => ({ default: m.ImportClassroomModal }))
);
const CreateModal = lazyWithRetry(() =>
  import('./components/common/CreateModal').then((m) => ({ default: m.CreateModal }))
);
const AttendanceSettingsModal = lazyWithRetry(() =>
  import('./components/modules/classes/AttendanceSettingsModal').then((m) => ({ default: m.AttendanceSettingsModal }))
);

const DEFAULT_FALLBACK_COURSE: Course = {
  id: 'course-1',
  name: 'Materia Seleccionada',
  subject: 'Materia',
  grade: 'Secundaria',
  room: 'Aula Principal',
  schedule: 'Horario Escolar',
  studentsCount: 28,
  color: '#1a73e8',
  schoolYear: '2026',
};

function AppContent() {
  const { user, isDarkMode } = useWorkspaceAuth();

  // Unified transactional navigation service (single source of truth for currentView, selectedCourseId, subTab, and browser URL)
  const {
    currentView,
    selectedCourseId,
    subTab: initialCourseSubTab,
    navigateTransaction,
    selectCourse,
    preloadOptimisticCourseState,
    reconcileWithCourses,
    syncUrlWithCurrentState,
    getLastActiveCourseId,
    getLastActiveCourseSnapshot,
    clearLastActiveCourse,
  } = useNavigationService();

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Creation modal & Classroom Import modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createModalType, setCreateModalType] = useState<'course' | 'plan' | 'task' | 'file'>('course');
  const [isImportClassroomOpen, setIsImportClassroomOpen] = useState<boolean>(false);
  const [isGlobalScheduleModalOpen, setIsGlobalScheduleModalOpen] = useState<boolean>(false);

  // Notification toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Core data states - initialize with local cache + last active course snapshot for instant 0ms first paint
  const [courses, setCourses] = useState<Course[]>(() => {
    const localList = api.deduplicateCourses(api.getLocalCourses());
    const snap = getLastActiveCourseSnapshot();
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
  const [students, setStudents] = useState<Student[]>(() =>
    api.deduplicateStudents(api.getLocalStudents())
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const hasLocalCourses = api.getLocalCourses().length > 0;
    const hasOptimisticLastCourse = Boolean(
      getLastActiveCourseSnapshot() || getLastActiveCourseId()
    );
    return !hasLocalCourses && !hasOptimisticLastCourse;
  });

  // Keep latest refs to courses and students so callbacks remain 100% referentially stable across refreshes
  const coursesRef = useRef<Course[]>(courses);
  coursesRef.current = courses;

  const studentsRef = useRef<Student[]>(students);
  studentsRef.current = students;

  // Keep previous selectedCourse ref to preserve referential identity when course data has not changed
  const prevSelectedCourseRef = useRef<Course | null>(null);

  // Load courses and students data with 2-phase Optimistic UI (Phase 1: 0ms localStorage pre-load, Phase 2: Firebase sync)
  const loadData = useCallback(async () => {
    // Phase 1: Immediate optimistic UI pre-load from localStorage before Firebase finishes
    try {
      const localC = api.deduplicateCourses(api.getLocalCourses());
      const localS = api.deduplicateStudents(api.getLocalStudents());
      const optimistic = preloadOptimisticCourseState(localC);

      if (optimistic.optimisticCoursesList.length > 0) {
        setCourses((prev) => reconcileCourseList(prev, optimistic.optimisticCoursesList));
      }
      if (localS.length > 0) {
        setStudents((prev) => reconcileStudentList(prev, localS));
      }
      // Unblock UI immediately if we have local courses or a persisted last active course ID/snapshot
      if (
        optimistic.optimisticCoursesList.length > 0 ||
        Boolean(optimistic.targetCourseId)
      ) {
        setIsLoading((prev) => (prev ? false : prev));
      }
    } catch (_) {}

    // Phase 2: Asynchronous Firebase resolution & seamless state reconciliation
    try {
      const [c, s] = await Promise.all([
        api.getCourses(),
        api.getStudents(),
      ]);
      const cleanCourses = api.deduplicateCourses(c);
      const cleanStudents = api.deduplicateStudents(s);
      setCourses((prev) => reconcileCourseList(prev, cleanCourses));
      setStudents((prev) => reconcileStudentList(prev, cleanStudents));
      if (cleanCourses.length > 0) {
        reconcileWithCourses(cleanCourses);
      }
    } catch (err) {
      console.error('Error fetching workspace courses and students:', err);
    } finally {
      setIsLoading((prev) => (prev ? false : prev));
    }
  }, [preloadOptimisticCourseState, reconcileWithCourses]);

  useEffect(() => {
    if (!user) {
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    loadData();
    syncUrlWithCurrentState();
  }, [user?.id, user?.email, loadData, syncUrlWithCurrentState]);

  // Listen to open attendance settings triggered globally
  useEffect(() => {
    return subscribeAppEvents(
      ['docencia_open_attendance_settings'],
      () => setIsGlobalScheduleModalOpen(true),
      0
    );
  }, []);

  // Cascaded synchronization of students status across modules and dashboard view (in-memory, zero network re-fetch)
  useEffect(() => {
    const handleStudentStatusSync = () => {
      try {
        const localStudents = api.deduplicateStudents(api.getLocalStudents());
        const localCourses = coursesRef.current.length > 0 ? coursesRef.current : api.getLocalCourses();
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
          const candidateGlobal = localDisp[`${st.courseId}::${st.id}`] || localDisp[st.id];
          const d =
            courseDisp?.[st.id] ||
            (candidateGlobal && (!candidateGlobal.courseId || candidateGlobal.courseId === st.courseId)
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
        reconcileWithCourses(latestCourses);
      } catch (_) {}
    };

    return subscribeAppEvents(['docencia_courses_updated'], handleCoursesUpdated, 40);
  }, [reconcileWithCourses]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleOpenCreateModal = useCallback((type: 'course' | 'plan' | 'task' | 'file' = 'course') => {
    setCreateModalType(type);
    setIsCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleOpenNewCourseModal = useCallback(() => {
    handleOpenCreateModal('course');
  }, [handleOpenCreateModal]);

  const handleOpenImportClassroom = useCallback(() => {
    setIsImportClassroomOpen(true);
  }, []);

  const handleCloseImportClassroom = useCallback(() => {
    setIsImportClassroomOpen(false);
  }, []);

  const handleCloseGlobalScheduleModal = useCallback(() => {
    setIsGlobalScheduleModalOpen(false);
  }, []);

  const handleCreateCourse = useCallback(
    async (courseData: Partial<Course>) => {
      try {
        setIsLoading(true);
        const newCourse = await api.createCourse(courseData);
        await loadData();
        navigateTransaction({
          courseId: newCourse.id,
          historyMode: 'replace',
          scrollToTop: false,
        });
        showToast(`Materia "${newCourse.name || courseData.name}" creada con éxito.`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Error al crear la materia', 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [loadData, navigateTransaction, showToast]
  );

  const handleDeleteCourse = useCallback(
    async (courseId: string) => {
      try {
        const courseToDelete = coursesRef.current.find(
          (c) => c.id === courseId || c.classroomCourseId === courseId
        );
        const courseName = courseToDelete ? courseToDelete.name : 'Materia';

        const res = await api.deleteCourse(courseId);

        // Immediately update local state and reconcile navigation transactionally
        setCourses((prev) => {
          const updated = prev.filter((c) => c.id !== courseId && c.classroomCourseId !== courseId);
          reconcileWithCourses(updated, { deletedCourseId: courseToDelete?.id || courseId });
          return reconcileCourseList(prev, updated);
        });

        // Background reload
        await loadData();

        showToast(res.message || `Materia "${courseName}" eliminada correctamente.`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Error al eliminar la materia', 'error');
      }
    },
    [loadData, reconcileWithCourses, showToast]
  );

  const handleClearCourses = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.clearAllCourses();
      clearLastActiveCourse();
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      navigateTransaction({
        view: 'courses',
        courseId: '',
        historyMode: 'replace',
        scrollToTop: false,
      });
      showToast(
        res.message || 'Materias de prueba eliminadas. Tu espacio está limpio para tus clases reales.',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Error al limpiar materias', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [clearLastActiveCourse, navigateTransaction, showToast]);

  const handleRestoreDemoCourses = useCallback(async () => {
    try {
      setIsLoading(true);
      await api.restoreDemoCourses();
      await loadData();
      showToast('Materias de ejemplo restauradas.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Error al restaurar materias', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [loadData, showToast]);

  const handleCreated = useCallback(
    (_type: string, message: string) => {
      loadData();
      showToast(message, 'success');
    },
    [loadData, showToast]
  );

  const handleImportSuccess = useCallback(
    (msg: string) => {
      loadData();
      showToast(msg, 'success');
    },
    [loadData, showToast]
  );

  const handleImportClassroomSuccess = useCallback(
    (msg: string) => {
      loadData();
      setIsImportClassroomOpen(false);
      showToast(msg, 'success');
    },
    [loadData, showToast]
  );

  const handleSelectCourse = useCallback(
    (courseId: string, subTab?: 'roster' | 'libro_temas' | 'grades' | 'history') => {
      if (!courseId) return;
      selectCourse(courseId, subTab, coursesRef.current);
    },
    [selectCourse]
  );

  const handleSelectCourseAndTab = useCallback(
    (courseId: string, tab: string) => {
      handleSelectCourse(courseId, tab === 'libro_temas' ? 'libro_temas' : 'roster');
    },
    [handleSelectCourse]
  );

  const handleNavigate = useCallback(
    (tab: string, filterCourseId?: string) => {
      if (filterCourseId) {
        selectCourse(filterCourseId, undefined, coursesRef.current);
        return;
      }

      if (tab === 'courses' || tab === 'dashboard') {
        navigateTransaction({
          view: 'courses',
          coursesPool: coursesRef.current,
          historyMode: 'push',
          scrollToTop: true,
        });
      } else if (tab === 'classroom_sync' || tab === 'classroom') {
        setIsImportClassroomOpen(true);
      } else if (tab === 'calendar') {
        navigateTransaction({
          view: 'calendar',
          coursesPool: coursesRef.current,
          historyMode: 'push',
          scrollToTop: true,
        });
      } else if (tab === 'calendar_schedule' || tab === 'settings') {
        setIsGlobalScheduleModalOpen(true);
      } else {
        navigateTransaction({
          view: 'course_detail',
          coursesPool: coursesRef.current,
          historyMode: 'push',
          scrollToTop: true,
        });
      }
    },
    [navigateTransaction, selectCourse]
  );

  const handleBackToCourses = useCallback(() => {
    handleNavigate('courses');
  }, [handleNavigate]);

  const handleSidebarSelectTab = useCallback(
    (tab: string, courseId?: string) => {
      if (tab === 'classroom_sync') {
        setIsImportClassroomOpen(true);
      } else if (tab === 'calendar') {
        handleNavigate('calendar');
      } else if (tab === 'calendar_schedule') {
        setIsGlobalScheduleModalOpen(true);
      } else if (courseId) {
        handleSelectCourse(courseId);
      } else {
        handleNavigate(tab);
      }
    },
    [handleNavigate, handleSelectCourse]
  );

  // Selected course instance strictly validated against selectedCourseId (with fallback to URL param and localStorage last active course)
  // Placed BEFORE conditional `if (!user)` return to strictly respect React Rules of Hooks
  const selectedCourse = useMemo<Course>(() => {
    const resolveCourse = (): Course => {
      // 1. Identify target course ID: prioritize active state -> URL parameter -> persisted last active course ID in localStorage
      let target = selectedCourseId;
      if (!target && typeof window !== 'undefined') {
        try {
          const urlParam = (new URLSearchParams(window.location.search).get('course') || '').trim();
          if (urlParam) target = urlParam;
        } catch (_) {}
      }
      if (!target) {
        target = getLastActiveCourseId();
      }

      if (target) {
        // Find in current courses state (in-memory, O(N))
        const match = findCourseMatch(target, courses);
        if (match) return match;

        // Only parse localStorage courses cache if in-memory courses list is empty
        if (courses.length === 0) {
          const localMatch = findCourseMatch(target, api.getLocalCourses());
          if (localMatch) return localMatch;
        }

        // Find in persisted last active course snapshot in localStorage (instant optimistic UI before Firebase finishes)
        const snapshotMatch = getLastActiveCourseSnapshot(target);
        if (snapshotMatch) return snapshotMatch;

        // If a specific target was requested, NEVER fallback to courses[0]
        return {
          id: target,
          name: 'Cargando materia...',
          subject: 'Cargando...',
          grade: 'Secundaria',
          room: '',
          schedule: '',
          color: '#1a73e8',
          studentsCount: 0,
          schoolYear: '2026',
        };
      }

      // Only if NO specific course was requested anywhere, default to courses[0]
      return courses[0] || DEFAULT_FALLBACK_COURSE;
    };

    const nextCourse = resolveCourse();
    if (prevSelectedCourseRef.current && areCoursesEqual(prevSelectedCourseRef.current, nextCourse)) {
      return prevSelectedCourseRef.current;
    }
    prevSelectedCourseRef.current = nextCourse;
    return nextCourse;
  }, [courses, selectedCourseId, getLastActiveCourseId, getLastActiveCourseSnapshot]);

  // If user is not authenticated, render the Landing Page of Docenc.IA with Gmail login
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <LandingPage onLoginSuccess={loadData} />
      </div>
    );
  }

  const currentActiveSidebarTab =
    currentView === 'courses' ? 'courses' : currentView === 'calendar' ? 'calendar' : 'course_detail';

  return (
    <div
      className={`min-h-screen flex flex-col font-['Roboto',sans-serif] transition-colors ${
        isDarkMode ? 'bg-[#0B0F19] text-slate-100 dark' : 'bg-[#f8fafd] text-neutral-900'
      }`}
    >
      {/* Header with Docenc.ia branding and quick navigation */}
      <Header
        onToggleSidebar={handleToggleSidebar}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNavigate={handleNavigate}
      />

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Google Workspace Sidebar */}
        <Sidebar
          currentTab={currentActiveSidebarTab}
          onSelectTab={handleSidebarSelectTab}
          isOpen={sidebarOpen}
          onNewAction={handleOpenNewCourseModal}
          courses={courses}
          selectedCourseId={selectedCourseId}
          onSelectCourse={handleSelectCourse}
        />

        {/* Dynamic Content View */}
        <main className="flex-1 overflow-y-auto min-h-[calc(100vh-4rem)]">
          <div className="max-w-7xl mx-auto px-4 pt-3">
            <GoogleSessionExpiryBanner />
          </div>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-96 space-y-3">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-neutral-500 font-medium">
                Conectando con Docenc.ia y cargando materias del profesor...
              </p>
            </div>
          ) : (
            <>
              {/* 1. Panel Principal de Materias del Profesor */}
              {currentView === 'courses' && (
                <TeacherCoursesPanel
                  courses={courses}
                  students={students}
                  externalSearchQuery={searchQuery}
                  onExternalSearchChange={setSearchQuery}
                  onSelectCourseAndTab={handleSelectCourseAndTab}
                  onCreateCourse={handleCreateCourse}
                  onDeleteCourse={handleDeleteCourse}
                  onClearCourses={handleClearCourses}
                  onRestoreDemoCourses={handleRestoreDemoCourses}
                  onRefreshData={loadData}
                  onImportSuccess={handleImportSuccess}
                  onOpenImportClassroom={handleOpenImportClassroom}
                />
              )}

              {/* 2. Módulo de Estudiantes: Asistencia, Disposición y Classroom */}
              {currentView === 'course_detail' && (
                <ErrorBoundary
                  key={`eb-course-${selectedCourse?.id || 'none'}`}
                  fallbackTitle="Se produjo un inconveniente al mostrar la materia"
                  onReset={loadData}
                >
                  <Suspense
                    fallback={
                      <div className="p-8 text-center text-xs text-neutral-500 animate-pulse">
                        Cargando espacio de materia...
                      </div>
                    }
                  >
                    <CourseWorkspaceView
                      course={selectedCourse}
                      courses={courses}
                      students={students}
                      initialSubTab={initialCourseSubTab}
                      externalSearchQuery={searchQuery}
                      onExternalSearchChange={setSearchQuery}
                      onBackToCourses={handleBackToCourses}
                      onSelectCourse={handleSelectCourse}
                      onDeleteCourse={handleDeleteCourse}
                      onRefreshData={loadData}
                      onNavigate={handleNavigate}
                      onOpenNewModal={handleOpenCreateModal}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}

              {/* 3. Módulo de Google Calendar Oficial y Horarios */}
              {currentView === 'calendar' && (
                <ErrorBoundary
                  fallbackTitle="Se produjo un inconveniente al cargar el calendario"
                  onReset={loadData}
                >
                  <Suspense
                    fallback={
                      <div className="p-8 text-center text-xs text-neutral-500 animate-pulse">
                        Cargando agenda y horarios...
                      </div>
                    }
                  >
                    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
                      <CalendarModule
                        courses={courses}
                        selectedCourseId={selectedCourseId}
                        onSelectCourse={handleSelectCourse}
                        onNavigateToCourseDetail={handleSelectCourse}
                      />
                    </div>
                  </Suspense>
                </ErrorBoundary>
              )}
            </>
          )}
        </main>
      </div>

      {/* Global Creation Modal (for creating courses) */}
      {isCreateModalOpen && (
        <Suspense fallback={null}>
          <CreateModal
            isOpen={isCreateModalOpen}
            type={createModalType}
            courses={courses}
            onClose={handleCloseCreateModal}
            onCreated={handleCreated}
            onOpenImportClassroom={handleOpenImportClassroom}
          />
        </Suspense>
      )}

      {/* Google Classroom Import / Sync Modal */}
      {isImportClassroomOpen && (
        <Suspense fallback={null}>
          <ImportClassroomModal
            isOpen={isImportClassroomOpen}
            existingCourses={courses}
            onClose={handleCloseImportClassroom}
            onSuccess={handleImportClassroomSuccess}
          />
        </Suspense>
      )}

      {/* Global Horarios y Semanas de Clase Modal (fuente común para todas las materias) */}
      {isGlobalScheduleModalOpen && (
        <Suspense fallback={null}>
          <AttendanceSettingsModal
            isOpen={isGlobalScheduleModalOpen}
            onClose={handleCloseGlobalScheduleModal}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      {/* Global Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-neutral-900 text-white text-xs font-medium rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Ocurrió un inconveniente inesperado en la aplicación">
      <WorkspaceAuthProvider>
        <AppContent />
      </WorkspaceAuthProvider>
    </ErrorBoundary>
  );
}
