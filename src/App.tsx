/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { WorkspaceAuthProvider, useWorkspaceAuth } from './context/WorkspaceAuthContext';
import { GlobalDataContextProvider, useGlobalData } from './context/GlobalDataContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { LandingPage } from './components/landing/LandingPage';
import { TeacherCoursesPanel } from './components/dashboard/TeacherCoursesPanel';
import { Course } from './types';
import { api } from './services/api';
import { CheckCircle2 } from 'lucide-react';
import { GoogleSessionExpiryBanner } from './components/modules/classes/GoogleSessionExpiryBanner';
import { CourseWorkspaceView } from './components/modules/CourseWorkspaceView';
import { subscribeAppEvents } from './utils/appEventBus';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { findCourseMatch } from './utils/courseFormatting';
import { useNavigationService } from './services/navigationService';
import { areCoursesEqual } from './utils/entityEquality';

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
  const {
    courses,
    isLoading,
    coursesRef,
    loadData,
    createCourse,
    deleteCourse,
    clearAllCourses,
    restoreDemoCourses,
  } = useGlobalData();

  // Unified transactional navigation service (single source of truth for currentView, selectedCourseId, subTab, and browser URL)
  const {
    currentView,
    selectedCourseId,
    subTab: initialCourseSubTab,
    navigateTransaction,
    selectCourse,
    getLastActiveCourseId,
    getLastActiveCourseSnapshot,
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

  // Keep previous selectedCourse ref to preserve referential identity when course data has not changed
  const prevSelectedCourseRef = useRef<Course | null>(null);

  // Listen to open attendance settings triggered globally
  useEffect(() => {
    return subscribeAppEvents(
      ['docencia_open_attendance_settings'],
      () => setIsGlobalScheduleModalOpen(true),
      0
    );
  }, []);

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
        const newCourse = await createCourse(courseData);
        showToast(`Materia "${newCourse.name || courseData.name}" creada con éxito.`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Error al crear la materia', 'error');
      }
    },
    [createCourse, showToast]
  );

  const handleDeleteCourse = useCallback(
    async (courseId: string) => {
      try {
        const { message, courseName } = await deleteCourse(courseId);
        showToast(message || `Materia "${courseName}" eliminada correctamente.`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Error al eliminar la materia', 'error');
      }
    },
    [deleteCourse, showToast]
  );

  const handleClearCourses = useCallback(async () => {
    try {
      const res = await clearAllCourses();
      showToast(
        res.message || 'Materias de prueba eliminadas. Tu espacio está limpio para tus clases reales.',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Error al limpiar materias', 'error');
    }
  }, [clearAllCourses, showToast]);

  const handleRestoreDemoCourses = useCallback(async () => {
    try {
      await restoreDemoCourses();
      showToast('Materias de ejemplo restauradas.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Error al restaurar materias', 'error');
    }
  }, [restoreDemoCourses, showToast]);

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
    [selectCourse, coursesRef]
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
    [navigateTransaction, selectCourse, coursesRef]
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
        {/* Google Workspace Sidebar (courses read from GlobalDataContextProvider) */}
        <Sidebar
          currentTab={currentActiveSidebarTab}
          onSelectTab={handleSidebarSelectTab}
          isOpen={sidebarOpen}
          onNewAction={handleOpenNewCourseModal}
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
                  externalSearchQuery={searchQuery}
                  onExternalSearchChange={setSearchQuery}
                  onSelectCourseAndTab={handleSelectCourseAndTab}
                  onCreateCourse={handleCreateCourse}
                  onDeleteCourse={handleDeleteCourse}
                  onClearCourses={handleClearCourses}
                  onRestoreDemoCourses={handleRestoreDemoCourses}
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
                      initialSubTab={initialCourseSubTab}
                      externalSearchQuery={searchQuery}
                      onExternalSearchChange={setSearchQuery}
                      onBackToCourses={handleBackToCourses}
                      onSelectCourse={handleSelectCourse}
                      onDeleteCourse={handleDeleteCourse}
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
        <GlobalDataContextProvider>
          <AppContent />
        </GlobalDataContextProvider>
      </WorkspaceAuthProvider>
    </ErrorBoundary>
  );
}
