/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Plus,
  Calendar,
  Clock,
  FolderClosed,
  FileText,
  Table,
  Presentation,
  FileCheck,
  Search,
  Filter,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock3,
  ChevronRight,
  ExternalLink,
  Edit3,
  Trash2,
  Send,
  Sparkles,
  Paperclip,
  Check,
  X,
  Award,
  BookOpen,
} from 'lucide-react';
import { TeacherTask, StudentSubmission, TaskAttachment, Course, DriveResource } from '../../types';
import { api } from '../../services/api';

interface TaskManagementModuleProps {
  courses: Course[];
  selectedCourseId: string;
  onSelectCourse: (courseId: string) => void;
  onNavigateToDrive?: () => void;
  onNavigateToAi?: (prompt?: string) => void;
}

export const TaskManagementModule: React.FC<TaskManagementModuleProps> = ({
  courses,
  selectedCourseId,
  onSelectCourse,
  onNavigateToDrive,
  onNavigateToAi,
}) => {
  const [tasks, setTasks] = useState<TeacherTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<TeacherTask | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterCourse, setFilterCourse] = useState<string>(selectedCourseId || 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Publicada' | 'Borrador' | 'Cerrada'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [studentStatusFilter, setStudentStatusFilter] = useState<'all' | 'Entregado' | 'Calificado' | 'Pendiente'>('all');

  // Grading state for the selected student
  const [gradingStudentId, setGradingStudentId] = useState<string | null>(null);
  const [gradeInput, setGradeInput] = useState<number | string>('');
  const [feedbackInput, setFeedbackInput] = useState<string>('');
  const [isSavingGrade, setIsSavingGrade] = useState<boolean>(false);

  // New Task Modal state
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState<boolean>(false);
  const [driveResources, setDriveResources] = useState<DriveResource[]>([]);
  const [newTaskCourseId, setNewTaskCourseId] = useState<string>(selectedCourseId || (courses[0]?.id ?? 'c-101'));
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskDescription, setNewTaskDescription] = useState<string>('');
  const [newTaskCategory, setNewTaskCategory] = useState<'Tarea' | 'Trabajo Práctico' | 'Proyecto' | 'Evaluación'>('Trabajo Práctico');
  const [newTaskDueDate, setNewTaskDueDate] = useState<string>(
    new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
  );
  const [newTaskDueTime, setNewTaskDueTime] = useState<string>('23:59');
  const [newTaskMaxPoints, setNewTaskMaxPoints] = useState<number>(100);
  const [selectedDriveAttachments, setSelectedDriveAttachments] = useState<TaskAttachment[]>([]);
  const [isCreatingTask, setIsCreatingTask] = useState<boolean>(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Load tasks and Drive resources
  const loadTasks = async () => {
    setIsLoading(true);
    try {
      const [fetchedTasks, fetchedFiles] = await Promise.all([
        api.getTasks(),
        api.getDriveFiles(),
      ]);
      setTasks(fetchedTasks);
      setDriveResources(fetchedFiles);
      if (fetchedTasks.length > 0) {
        // Keep currently selected or select first
        setSelectedTask((prev) => (prev ? fetchedTasks.find((t) => t.id === prev.id) || fetchedTasks[0] : fetchedTasks[0]));
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  // Update filter when selectedCourseId prop changes
  useEffect(() => {
    if (selectedCourseId) {
      setFilterCourse(selectedCourseId);
      setNewTaskCourseId(selectedCourseId);
    }
  }, [selectedCourseId]);

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    const matchesCourse = filterCourse === 'all' || t.courseId === filterCourse;
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesSearch =
      searchQuery === '' ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.courseName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCourse && matchesStatus && matchesSearch;
  });

  // Calculate global metrics
  const totalTasks = tasks.length;
  const totalAssigned = tasks.reduce((acc, t) => acc + t.assignedCount, 0);
  const totalSubmitted = tasks.reduce((acc, t) => acc + t.submittedCount, 0);
  const totalGraded = tasks.reduce((acc, t) => acc + t.gradedCount, 0);
  const globalSubmissionRate = totalAssigned > 0 ? Math.round((totalSubmitted / totalAssigned) * 100) : 0;

  // Handle grading submission
  const handleStartGrading = (sub: StudentSubmission) => {
    setGradingStudentId(sub.studentId);
    setGradeInput(sub.grade !== undefined ? sub.grade : '');
    setFeedbackInput(sub.feedback || '');
  };

  const handleSaveGrade = async (taskId: string, studentId: string) => {
    if (gradeInput === '' || isNaN(Number(gradeInput))) {
      alert('Por favor ingresa una nota numérica válida.');
      return;
    }
    setIsSavingGrade(true);
    try {
      const res = await api.gradeSubmission(taskId, studentId, Number(gradeInput), feedbackInput);
      // Update locally
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? res.task : t))
      );
      setSelectedTask(res.task);
      setGradingStudentId(null);
      showToast('¡Calificación guardada y sincronizada con el Libro de Notas de Google Sheets!');
    } catch (err: any) {
      alert(err.message || 'Error al guardar calificación');
    } finally {
      setIsSavingGrade(false);
    }
  };

  // Handle task status change
  const handleStatusChange = async (taskId: string, newStatus: 'Publicada' | 'Borrador' | 'Cerrada') => {
    try {
      const updated = await api.updateTaskStatus(taskId, newStatus);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (selectedTask?.id === taskId) {
        setSelectedTask(updated);
      }
      showToast(`Estado de la tarea actualizado a: ${newStatus}`);
    } catch (err: any) {
      alert(err.message || 'Error al cambiar estado');
    }
  };

  // Handle create task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) {
      alert('Por favor ingresa el título de la tarea.');
      return;
    }
    setIsCreatingTask(true);
    try {
      const fullDueDate = `${newTaskDueDate}T${newTaskDueTime}:00Z`;
      const newTask = await api.createTask({
        courseId: newTaskCourseId,
        title: newTaskTitle,
        description: newTaskDescription,
        category: newTaskCategory,
        dueDate: fullDueDate,
        maxPoints: Number(newTaskMaxPoints),
        driveAttachments: selectedDriveAttachments,
      });

      setTasks((prev) => [newTask, ...prev]);
      setSelectedTask(newTask);
      setIsNewTaskModalOpen(false);

      // Reset form
      setNewTaskTitle('');
      setNewTaskDescription('');
      setSelectedDriveAttachments([]);
      showToast('¡Tarea creada y asignada a la nómina de estudiantes con éxito!');
    } catch (err: any) {
      alert(err.message || 'Error al crear la tarea');
    } finally {
      setIsCreatingTask(false);
    }
  };

  // Toggle attachment in creation form
  const toggleDriveAttachment = (file: DriveResource) => {
    const alreadySelected = selectedDriveAttachments.some((a) => a.id === file.id);
    if (alreadySelected) {
      setSelectedDriveAttachments((prev) => prev.filter((a) => a.id !== file.id));
    } else {
      setSelectedDriveAttachments((prev) => [
        ...prev,
        {
          id: file.id,
          name: file.name,
          type: file.type === 'sheet' ? 'sheet' : file.type === 'slide' ? 'slide' : file.type === 'pdf' ? 'pdf' : 'doc',
          url: file.googleDriveUrl,
          size: file.size,
        },
      ]);
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'doc':
        return <FileText className="w-4 h-4 text-blue-600 shrink-0" />;
      case 'sheet':
        return <Table className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'slide':
        return <Presentation className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'pdf':
        return <FileCheck className="w-4 h-4 text-red-600 shrink-0" />;
      default:
        return <FolderClosed className="w-4 h-4 text-neutral-500 shrink-0" />;
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'Trabajo Práctico':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Proyecto':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Evaluación':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-neutral-100 text-neutral-700 border-neutral-200';
    }
  };

  const getUrgencyBadge = (dueDateString: string) => {
    const now = new Date().getTime();
    const due = new Date(dueDateString).getTime();
    const diffHours = (due - now) / (1000 * 60 * 60);

    if (diffHours < 0) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
          <AlertCircle className="w-3 h-3" /> Vencida
        </span>
      );
    } else if (diffHours <= 24) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
          <Clock3 className="w-3 h-3" /> Vence en menos de 24h
        </span>
      );
    } else {
      const days = Math.ceil(diffHours / 24);
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          <Calendar className="w-3 h-3" /> Vence en {days} días
        </span>
      );
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
              Módulo 1 • Google Workspace Suite
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 flex items-center gap-2.5">
            <CheckSquare className="w-7 h-7 text-blue-600" />
            Gestión y Seguimiento de Tareas
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Crea consignas, adjunta material desde Google Drive, asigna a la nómina y monitorea el estado individual por alumno.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsNewTaskModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow-sm transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Nueva Tarea
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm">
          <span className="text-xs font-medium text-neutral-500">Total Tareas Creadas</span>
          <div className="text-2xl font-bold text-neutral-800 mt-1">{totalTasks}</div>
          <span className="text-[11px] text-blue-600 font-medium">Asignadas a cursos</span>
        </div>
        <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm">
          <span className="text-xs font-medium text-neutral-500">Tasa de Entrega Global</span>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{globalSubmissionRate}%</div>
          <span className="text-[11px] text-neutral-500">{totalSubmitted} de {totalAssigned} entregadas</span>
        </div>
        <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm">
          <span className="text-xs font-medium text-neutral-500">Entregas Calificadas</span>
          <div className="text-2xl font-bold text-purple-700 mt-1">{totalGraded}</div>
          <span className="text-[11px] text-neutral-500">Con devolución pedagógica</span>
        </div>
        <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm">
          <span className="text-xs font-medium text-neutral-500">Integración Google Drive</span>
          <div className="text-2xl font-bold text-amber-700 mt-1">{driveResources.length}</div>
          <span className="text-[11px] text-amber-600 font-medium">Recursos disponibles</span>
        </div>
      </div>

      {/* Filter and Course Selector Bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 p-3 bg-white rounded-xl border border-neutral-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Course filter select */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-500 whitespace-nowrap">Curso:</span>
            <select
              value={filterCourse}
              onChange={(e) => {
                setFilterCourse(e.target.value);
                if (e.target.value !== 'all') {
                  onSelectCourse(e.target.value);
                }
              }}
              className="text-xs font-medium text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Todos los Cursos</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center bg-neutral-100 p-0.5 rounded-lg text-xs">
            {(['all', 'Publicada', 'Borrador', 'Cerrada'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  statusFilter === status
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {status === 'all' ? 'Todas' : status}
              </button>
            ))}
          </div>
        </div>

        {/* Search inside tasks */}
        <div className="relative w-full lg:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar tarea o consigna..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Main Two-Column View: Task List on Left, Student Tracking on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Task Cards (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
              Tareas ({filteredTasks.length})
            </span>
            <span className="text-xs text-neutral-400">Selecciona para ver estudiantes</span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center bg-white rounded-xl border border-neutral-200">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-neutral-500 font-medium">Cargando tareas y estados...</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-xl border border-neutral-200 space-y-3">
              <BookOpen className="w-10 h-10 text-neutral-300 mx-auto" />
              <p className="text-xs text-neutral-500">No se encontraron tareas con los filtros seleccionados.</p>
              <button
                onClick={() => setIsNewTaskModalOpen(true)}
                className="text-xs text-blue-600 font-medium hover:underline"
              >
                + Crear una nueva tarea ahora
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[calc(100vh-20rem)] overflow-y-auto pr-1">
              {filteredTasks.map((task) => {
                const isSelected = selectedTask?.id === task.id;
                const submissionPercent =
                  task.assignedCount > 0
                    ? Math.round((task.submittedCount / task.assignedCount) * 100)
                    : 0;

                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-100 shadow-sm'
                        : 'bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-xs'
                    }`}
                  >
                    {/* Top line: Course & Category */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-medium text-neutral-500 truncate">
                        {task.courseName}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getCategoryBadgeClass(task.category)}`}>
                          {task.category}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          task.status === 'Publicada'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : task.status === 'Borrador'
                            ? 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                            : 'bg-neutral-200 text-neutral-700'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                    </div>

                    {/* Task Title & Description */}
                    <h3 className="text-sm font-semibold text-neutral-900 line-clamp-1 mb-1">
                      {task.title}
                    </h3>
                    <p className="text-xs text-neutral-500 line-clamp-2 mb-3">
                      {task.description}
                    </p>

                    {/* Google Drive Attachments preview */}
                    {task.driveAttachments && task.driveAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {task.driveAttachments.map((att) => (
                          <span
                            key={att.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 text-[11px] text-neutral-700 border border-neutral-200 truncate max-w-[200px]"
                            title={att.name}
                          >
                            {getFileIcon(att.type)}
                            <span className="truncate">{att.name}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Submission Progress bar */}
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center justify-between text-[11px] text-neutral-500">
                        <span>Entregas: {task.submittedCount} de {task.assignedCount}</span>
                        <span className="font-semibold text-neutral-700">{submissionPercent}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all duration-300"
                          style={{ width: `${submissionPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Bottom: Due date & Action link */}
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-[11px]">
                      {getUrgencyBadge(task.dueDate)}
                      <span className="font-semibold text-neutral-600 flex items-center gap-1">
                        Ver {task.submissions.length} estudiantes
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Tracking by Student (7 cols) */}
        <div className="lg:col-span-7">
          {selectedTask ? (
            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
              {/* Selected Task Details Header */}
              <div className="p-5 border-b border-neutral-200 bg-neutral-50/50 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
                      {selectedTask.courseName}
                    </span>
                    <h3 className="text-lg font-bold text-neutral-900 mt-0.5">
                      {selectedTask.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTask.status}
                      onChange={(e) => handleStatusChange(selectedTask.id, e.target.value as any)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-700 focus:outline-none"
                    >
                      <option value="Publicada">Publicada</option>
                      <option value="Borrador">Borrador</option>
                      <option value="Cerrada">Cerrada</option>
                    </select>

                    <button
                      onClick={async () => {
                        if (confirm('¿Eliminar esta tarea y sus registros asociados?')) {
                          await api.deleteTask(selectedTask.id);
                          setTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
                          setSelectedTask(tasks.find((t) => t.id !== selectedTask.id) || null);
                          showToast('Tarea eliminada correctamente.');
                        }
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Eliminar Tarea"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-neutral-600">
                  {selectedTask.description}
                </p>

                {/* Deadlines, Max Points and Drive attachments */}
                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-neutral-600">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    Entrega: <strong>{new Date(selectedTask.dueDate).toLocaleDateString()} a las {new Date(selectedTask.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-neutral-400" />
                    Puntaje Máximo: <strong>{selectedTask.maxPoints} pts</strong>
                  </span>
                </div>

                {/* Attached Google Drive files */}
                {selectedTask.driveAttachments && selectedTask.driveAttachments.length > 0 && (
                  <div className="pt-2">
                    <span className="text-[11px] font-semibold text-neutral-500 block mb-1.5">
                      Archivos adjuntos en Google Drive:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {selectedTask.driveAttachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-xs font-medium text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 transition-colors shadow-2xs"
                        >
                          {getFileIcon(att.type)}
                          <span>{att.name}</span>
                          <ExternalLink className="w-3 h-3 text-neutral-400" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Student Roster Status Bar */}
              <div className="px-5 py-3 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3 bg-white">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                    Estado por Alumno ({selectedTask.submissions.length})
                  </span>
                </div>

                {/* Filter student status */}
                <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg text-xs">
                  {(['all', 'Entregado', 'Calificado', 'Pendiente'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setStudentStatusFilter(filter)}
                      className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                        studentStatusFilter === filter
                          ? 'bg-white text-neutral-900 shadow-xs'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      {filter === 'all' ? 'Todos' : filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submissions List */}
              <div className="divide-y divide-neutral-100 max-h-[500px] overflow-y-auto">
                {selectedTask.submissions
                  .filter((sub) => studentStatusFilter === 'all' || sub.status === studentStatusFilter)
                  .map((sub) => {
                    const isGrading = gradingStudentId === sub.studentId;

                    return (
                      <div key={sub.studentId} className="p-4 hover:bg-neutral-50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          {/* Student Info */}
                          <div className="flex items-center gap-3">
                            <img
                              src={sub.studentAvatar}
                              alt={sub.studentName}
                              className="w-9 h-9 rounded-full object-cover border border-neutral-200 shrink-0"
                            />
                            <div>
                              <h4 className="text-xs font-semibold text-neutral-900">
                                {sub.studentName}
                              </h4>
                              <p className="text-[11px] text-neutral-400">{sub.studentEmail}</p>
                            </div>
                          </div>

                          {/* Status and Grade Tag */}
                          <div className="flex items-center gap-2">
                            {sub.status === 'Calificado' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200">
                                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                                {sub.grade} / {selectedTask.maxPoints} pts
                              </span>
                            ) : sub.status === 'Entregado' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                                Entregado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200">
                                <Clock3 className="w-3.5 h-3.5 text-amber-600" />
                                Pendiente
                              </span>
                            )}

                            <button
                              onClick={() => handleStartGrading(sub)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                            >
                              {sub.status === 'Calificado' ? 'Modificar Nota' : 'Calificar'}
                            </button>
                          </div>
                        </div>

                        {/* Submitted File Link */}
                        {sub.submittedFileName && (
                          <div className="mt-2.5 ml-12 flex items-center gap-2">
                            <span className="text-[11px] text-neutral-500">Archivo entregado:</span>
                            <a
                              href={sub.submittedFileUrl || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium bg-neutral-100 hover:bg-neutral-200/80 px-2 py-0.5 rounded border border-neutral-200/80"
                            >
                              <FileText className="w-3 h-3 text-blue-500" />
                              {sub.submittedFileName}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                            {sub.submittedAt && (
                              <span className="text-[10px] text-neutral-400">
                                ({new Date(sub.submittedAt).toLocaleDateString()} {new Date(sub.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Existing Feedback display */}
                        {sub.feedback && !isGrading && (
                          <div className="mt-2 ml-12 p-2 bg-neutral-50 rounded-lg border border-neutral-200 text-xs text-neutral-700">
                            <span className="font-semibold text-neutral-500 text-[10px] uppercase block mb-0.5">
                              Devolución docente:
                            </span>
                            "{sub.feedback}"
                          </div>
                        )}

                        {/* Inline Grading Form */}
                        {isGrading && (
                          <div className="mt-3 ml-12 p-3 bg-blue-50/60 rounded-xl border border-blue-200 space-y-2.5 animate-in fade-in">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-blue-900">
                                Calificar entrega de {sub.studentName}
                              </span>
                              <button
                                onClick={() => setGradingStudentId(null)}
                                className="text-neutral-400 hover:text-neutral-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs text-neutral-600">Calificación:</span>
                              <input
                                type="number"
                                min="0"
                                max={selectedTask.maxPoints}
                                value={gradeInput}
                                onChange={(e) => setGradeInput(e.target.value)}
                                placeholder="Nota"
                                className="w-20 px-2 py-1 text-xs font-bold text-neutral-900 bg-white border border-neutral-300 rounded focus:border-blue-500 focus:outline-none"
                              />
                              <span className="text-xs text-neutral-500">/ {selectedTask.maxPoints} puntos</span>
                            </div>

                            <div>
                              <label className="text-[11px] font-medium text-neutral-600 block mb-1">
                                Comentario / Devolución formativa:
                              </label>
                              <textarea
                                value={feedbackInput}
                                onChange={(e) => setFeedbackInput(e.target.value)}
                                placeholder="Escribe observaciones, fortalezas o sugerencias de mejora..."
                                rows={2}
                                className="w-full text-xs p-2 bg-white border border-neutral-300 rounded-lg focus:border-blue-500 focus:outline-none"
                              />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => setGradingStudentId(null)}
                                className="px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-200/50 rounded"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => handleSaveGrade(selectedTask.id, sub.studentId)}
                                disabled={isSavingGrade}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {isSavingGrade ? (
                                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                                Guardar y Sincronizar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-neutral-200 text-neutral-400">
              <CheckSquare className="w-12 h-12 text-neutral-300 mx-auto mb-2" />
              <p className="text-xs font-medium">Selecciona una tarea del panel izquierdo para ver el seguimiento individual de los estudiantes.</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE NEW TASK MODAL */}
      {isNewTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-neutral-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <CheckSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">Crear y Asignar Nueva Tarea</h3>
                  <p className="text-xs text-neutral-500">Se asignará automáticamente a toda la nómina del curso</p>
                </div>
              </div>
              <button
                onClick={() => setIsNewTaskModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-neutral-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="mt-4 space-y-4 text-xs">
              {/* Course Selection */}
              <div>
                <label className="block text-neutral-700 font-semibold mb-1">
                  Curso Asignado *
                </label>
                <select
                  value={newTaskCourseId}
                  onChange={(e) => setNewTaskCourseId(e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium text-neutral-800"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.studentsCount} estudiantes)
                    </option>
                  ))}
                </select>
              </div>

              {/* Task Title */}
              <div>
                <label className="block text-neutral-700 font-semibold mb-1">
                  Título de la Tarea / Consigna *
                </label>
                <input
                  type="text"
                  required
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Ej: Informe de Práctica de Laboratorio N°3"
                  className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Category & Points */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 font-semibold mb-1">
                    Tipo de Actividad
                  </label>
                  <select
                    value={newTaskCategory}
                    onChange={(e) => setNewTaskCategory(e.target.value as any)}
                    className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                  >
                    <option value="Tarea">Tarea General</option>
                    <option value="Trabajo Práctico">Trabajo Práctico</option>
                    <option value="Proyecto">Proyecto Integrador</option>
                    <option value="Evaluación">Evaluación Formativa</option>
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-700 font-semibold mb-1">
                    Puntaje Máximo
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newTaskMaxPoints}
                    onChange={(e) => setNewTaskMaxPoints(Number(e.target.value))}
                    className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Due Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 font-semibold mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    Fecha Límite de Entrega *
                  </label>
                  <input
                    type="date"
                    required
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 font-semibold mb-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    Hora Límite
                  </label>
                  <input
                    type="time"
                    value={newTaskDueTime}
                    onChange={(e) => setNewTaskDueTime(e.target.value)}
                    className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Detailed Instructions */}
              <div>
                <label className="block text-neutral-700 font-semibold mb-1">
                  Instrucciones y Pautas Pedagógicas
                </label>
                <textarea
                  rows={3}
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  placeholder="Detalla los requisitos de entrega, rúbrica de evaluación o preguntas orientadoras..."
                  className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* GOOGLE DRIVE INTEGRATION: Attach files */}
              <div>
                <label className="block text-neutral-700 font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FolderClosed className="w-3.5 h-3.5 text-amber-500" />
                    Adjuntar Archivos desde Google Drive
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {selectedDriveAttachments.length} seleccionados
                  </span>
                </label>

                {/* Selected attachments chips */}
                {selectedDriveAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-blue-50/50 rounded-lg border border-blue-200/60">
                    {selectedDriveAttachments.map((att) => (
                      <span
                        key={att.id}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-white text-neutral-800 border border-neutral-200 shadow-2xs"
                      >
                        {getFileIcon(att.type)}
                        <span className="truncate max-w-[160px]">{att.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedDriveAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                          className="text-neutral-400 hover:text-red-500 ml-1"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Drive file picker list */}
                <div className="p-2 border border-neutral-200 rounded-xl bg-neutral-50 max-h-36 overflow-y-auto divide-y divide-neutral-100">
                  {driveResources.length === 0 ? (
                    <p className="text-[11px] text-neutral-400 text-center py-2">No hay archivos en Drive todavía.</p>
                  ) : (
                    driveResources.map((file) => {
                      const isChecked = selectedDriveAttachments.some((a) => a.id === file.id);
                      return (
                        <div
                          key={file.id}
                          onClick={() => toggleDriveAttachment(file)}
                          className="flex items-center justify-between p-2 hover:bg-white rounded-lg cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded text-blue-600 focus:ring-0"
                            />
                            {getFileIcon(file.type)}
                            <div className="truncate text-left">
                              <p className="text-xs font-medium text-neutral-800 truncate">{file.name}</p>
                              <span className="text-[10px] text-neutral-400">{file.folder} • {file.size}</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-blue-600 shrink-0 font-medium">
                            {isChecked ? 'Adjuntado' : '+ Adjuntar'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsNewTaskModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTask}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50"
                >
                  {isCreatingTask ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Crear y Asignar Tarea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-neutral-900 text-white text-xs font-medium rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
