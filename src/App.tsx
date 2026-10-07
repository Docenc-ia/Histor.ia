/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WorkspaceAuthProvider, useWorkspaceAuth } from './context/WorkspaceAuthContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { LandingPage } from './components/landing/LandingPage';
import { TeacherCoursesPanel } from './components/dashboard/TeacherCoursesPanel';
import { CourseWorkspaceView } from './components/modules/CourseWorkspaceView';
import { ImportClassroomModal } from './components/dashboard/ImportClassroomModal';
import { CreateModal } from './components/common/CreateModal';
import { Course, Student } from './types';
import { api } from './services/api';
import { CheckCircle2 } from 'lucide-react';

function AppContent() {
  const { user, isDarkMode } = useWorkspaceAuth();

  // Navigation: 'courses' (TeacherCoursesPanel) | 'course_detail' (CourseWorkspaceView -> ClassesModule)
  const [currentView, setCurrentView] = useState<'courses' | 'course_detail'>('courses');

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('course-1');

  // Creation modal & Classroom Import modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createModalType, setCreateModalType] = useState<'course' | 'plan' | 'task' | 'file'>('course');
  const [isImportClassroomOpen, setIsImportClassroomOpen] = useState<boolean>(false);

  // Notification toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Core data states
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load courses and students data
  const loadData = async () => {
    try {
      const [c, s] = await Promise.all([
        api.getCourses(),
        api.getStudents(),
      ]);
      setCourses(c);
      setStudents(s);
      if (c.length > 0 && !selectedCourseId) {
        setSelectedCourseId(c[0].id);
      }
    } catch (err) {
      console.error('Error fetching workspace courses and students:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.id, user?.email]);

  // Cascaded synchronization of students status across modules and dashboard view
  useEffect(() => {
    const handleStudentStatusSync = () => {
      api
        .getStudents()
        .then((updatedStudents) => {
          if (Array.isArray(updatedStudents) && updatedStudents.length > 0) {
            setStudents(updatedStudents);
          }
        })
        .catch(() => {});
    };

    window.addEventListener('docencia_disposition_storage_change', handleStudentStatusSync);
    window.addEventListener('docencia_student_status_updated', handleStudentStatusSync);
    return () => {
      window.removeEventListener('docencia_disposition_storage_change', handleStudentStatusSync);
      window.removeEventListener('docencia_student_status_updated', handleStudentStatusSync);
    };
  }, []);

  const handleOpenCreateModal = (type: 'course' | 'plan' | 'task' | 'file' = 'course') => {
    setCreateModalType(type);
    setIsCreateModalOpen(true);
  };

  const handleCreateCourse = async (courseData: Partial<Course>) => {
    try {
      setIsLoading(true);
      const newCourse = await api.createCourse(courseData);
      await loadData();
      setSelectedCourseId(newCourse.id);
      setToast({ message: `Materia "${newCourse.name || courseData.name}" creada con éxito.`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setToast({ message: err.message || 'Error al crear la materia', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    try {
      const courseToDelete = courses.find((c) => c.id === courseId);
      const courseName = courseToDelete ? courseToDelete.name : 'Materia';

      const res = await api.deleteCourse(courseId);

      // Immediately update local state
      setCourses((prev) => {
        const updated = prev.filter((c) => c.id !== courseId);
        if (selectedCourseId === courseId && updated.length > 0) {
          setSelectedCourseId(updated[0].id);
        }
        return updated;
      });

      // Background reload
      loadData();

      setToast({ message: res.message || `Materia "${courseName}" eliminada correctamente.`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setToast({ message: err.message || 'Error al eliminar la materia', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleClearCourses = async () => {
    try {
      setIsLoading(true);
      const res = await api.clearAllCourses();
      setCourses([]);
      setStudents([]);
      setSelectedCourseId('');
      setToast({ message: res.message || 'Materias de prueba eliminadas. Tu espacio está limpio para tus clases reales.', type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setToast({ message: err?.message || 'Error al limpiar materias', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreDemoCourses = async () => {
    try {
      setIsLoading(true);
      await api.restoreDemoCourses();
      await loadData();
      setToast({ message: 'Materias de ejemplo restauradas.', type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setToast({ message: err?.message || 'Error al restaurar materias', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreated = (_type: string, message: string) => {
    loadData();
    setToast({ message, type: 'success' });
    setTimeout(() => setToast(null), 4000);
  };

  const handleNavigate = (tab: string, filterCourseId?: string) => {
    if (filterCourseId) {
      setSelectedCourseId(filterCourseId);
    }

    if (tab === 'courses' || tab === 'dashboard') {
      setCurrentView('courses');
    } else if (tab === 'classroom_sync' || tab === 'classroom') {
      setIsImportClassroomOpen(true);
    } else {
      // Any other tab (classes, alumnos, students, etc.) navigates to course_detail
      setCurrentView('course_detail');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // If user is not authenticated, render the Landing Page of Docenc.IA with Gmail login
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <LandingPage onLoginSuccess={loadData} />
      </div>
    );
  }

  // Selected course object
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) || courses[0] || {
    id: 'course-1',
    name: 'Materia Seleccionada',
    code: 'DOC-101',
    room: 'Aula Principal',
    schedule: 'Horario Escolar',
    gradeLevel: 'Secundaria',
    studentCount: 28,
    color: 'bg-blue-600',
    description: 'Curso en Docenc.IA',
  };

  const currentActiveSidebarTab =
    currentView === 'courses' ? 'courses' : 'classes';

  return (
    <div
      className={`min-h-screen flex flex-col font-['Roboto',sans-serif] transition-colors ${
        isDarkMode ? 'bg-[#0B0F19] text-slate-100 dark' : 'bg-[#f8fafd] text-neutral-900'
      }`}
    >
      {/* Header with Docenc.IA branding and quick navigation */}
      <Header
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNavigate={handleNavigate}
      />

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Google Workspace Sidebar */}
        <Sidebar
          currentTab={currentActiveSidebarTab}
          onSelectTab={(tab, courseId) => {
            if (tab === 'classroom_sync') {
              setIsImportClassroomOpen(true);
            } else if (courseId) {
              setSelectedCourseId(courseId);
              setCurrentView('course_detail');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              handleNavigate(tab);
            }
          }}
          isOpen={sidebarOpen}
          onNewAction={() => handleOpenCreateModal('course')}
          courses={courses}
          selectedCourseId={selectedCourseId}
          onSelectCourse={(courseId) => {
            setSelectedCourseId(courseId);
            setCurrentView('course_detail');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />

        {/* Dynamic Content View */}
        <main className="flex-1 overflow-y-auto min-h-[calc(100vh-4rem)]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-96 space-y-3">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-neutral-500 font-medium">
                Conectando con Docenc.IA y cargando materias del profesor...
              </p>
            </div>
          ) : (
            <>
              {/* 1. Panel Principal de Materias del Profesor */}
              {currentView === 'courses' && (
                <TeacherCoursesPanel
                  courses={courses}
                  onSelectCourseAndTab={(courseId) => {
                    setSelectedCourseId(courseId);
                    setCurrentView('course_detail');
                  }}
                  onCreateCourse={handleCreateCourse}
                  onDeleteCourse={handleDeleteCourse}
                  onClearCourses={handleClearCourses}
                  onRestoreDemoCourses={handleRestoreDemoCourses}
                  onRefreshData={loadData}
                  onImportSuccess={(msg) => {
                    loadData();
                    setToast({ message: msg, type: 'success' });
                    setTimeout(() => setToast(null), 4000);
                  }}
                  onOpenImportClassroom={() => setIsImportClassroomOpen(true)}
                />
              )}

              {/* 2. Módulo de Estudiantes: Asistencia, Disposición y Classroom */}
              {currentView === 'course_detail' && (
                <CourseWorkspaceView
                  course={selectedCourse}
                  courses={courses}
                  students={students}
                  onBackToCourses={() => setCurrentView('courses')}
                  onSelectCourse={(id) => setSelectedCourseId(id)}
                  onDeleteCourse={handleDeleteCourse}
                  onRefreshData={loadData}
                  onNavigate={handleNavigate}
                  onOpenNewModal={handleOpenCreateModal}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Global Creation Modal (for creating courses) */}
      <CreateModal
        isOpen={isCreateModalOpen}
        type={createModalType}
        courses={courses}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={handleCreated}
        onOpenImportClassroom={() => setIsImportClassroomOpen(true)}
      />

      {/* Google Classroom Import / Sync Modal */}
      <ImportClassroomModal
        isOpen={isImportClassroomOpen}
        existingCourses={courses}
        onClose={() => setIsImportClassroomOpen(false)}
        onSuccess={(msg) => {
          loadData();
          setIsImportClassroomOpen(false);
          setToast({ message: msg, type: 'success' });
          setTimeout(() => setToast(null), 4000);
        }}
      />

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
    <WorkspaceAuthProvider>
      <AppContent />
    </WorkspaceAuthProvider>
  );
}
