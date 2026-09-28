import React, { useState } from 'react';
import { X, BookOpen, FileText, GraduationCap, FolderClosed, Check } from 'lucide-react';
import { Course } from '../../types';
import { api } from '../../services/api';

interface CreateModalProps {
  isOpen: boolean;
  type: 'course' | 'plan' | 'task' | 'file';
  courses: Course[];
  onClose: () => void;
  onCreated: (type: string, message: string) => void;
  onOpenImportClassroom?: () => void;
}

export const CreateModal: React.FC<CreateModalProps> = ({
  isOpen,
  type: initialType,
  courses,
  onClose,
  onCreated,
  onOpenImportClassroom,
}) => {
  const [activeTab, setActiveTab] = useState<'course' | 'plan' | 'task' | 'file'>(initialType);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Course Form state
  const [courseName, setCourseName] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseGrade, setCourseGrade] = useState('');
  const [courseRoom, setCourseRoom] = useState('');
  const [courseSchedule, setCourseSchedule] = useState('');
  const [courseColor, setCourseColor] = useState('#1a73e8');

  // Lesson Plan Form state
  const [planCourseId, setPlanCourseId] = useState(courses[0]?.id || '');
  const [planTitle, setPlanTitle] = useState('');
  const [planUnit, setPlanUnit] = useState('');
  const [planDate, setPlanDate] = useState(new Date().toISOString().split('T')[0]);
  const [planDuration, setPlanDuration] = useState('80 min');
  const [planObjective, setPlanObjective] = useState('');
  const [planInicio, setPlanInicio] = useState('');
  const [planDesarrollo, setPlanDesarrollo] = useState('');
  const [planCierre, setPlanCierre] = useState('');

  // Classroom Task Form state
  const [taskCourseId, setTaskCourseId] = useState(courses[0]?.id || '');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPoints, setTaskPoints] = useState(100);
  const [taskDueDate, setTaskDueDate] = useState(
    new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  );
  const [taskAttachment, setTaskAttachment] = useState('');

  // Drive File Form state
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState<'doc' | 'sheet' | 'slide' | 'pdf'>('doc');
  const [fileFolder, setFileFolder] = useState('Guías y Actividades');
  const [fileCourseId, setFileCourseId] = useState(courses[0]?.id || '');

  if (!isOpen) return null;

  const handleSubmitCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim() || !courseSubject.trim()) return;
    setIsSubmitting(true);
    try {
      await api.createCourse({
        name: courseName,
        subject: courseSubject,
        grade: courseGrade || 'Secundaria',
        room: courseRoom || 'Aula Principal',
        schedule: courseSchedule || 'A convenir',
        color: courseColor,
      });
      onCreated('course', `Curso "${courseName}" creado con éxito.`);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al crear curso');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planTitle.trim() || !planCourseId) return;
    setIsSubmitting(true);
    try {
      await api.createLessonPlan({
        courseId: planCourseId,
        title: planTitle,
        unit: planUnit || 'Unidad Curricular',
        date: planDate,
        duration: planDuration,
        objective: planObjective || 'Comprender los contenidos centrales.',
        inicio: planInicio || 'Pregunta disparadora y motivación.',
        desarrollo: planDesarrollo || 'Trabajo práctico colaborativo.',
        cierre: planCierre || 'Ticket de salida en Classroom.',
        competencies: ['Pensamiento Crítico', 'Resolución de Problemas'],
        materials: ['Google Docs Guía', 'Pizarrón'],
      });
      onCreated('plan', `Planificación "${planTitle}" lista para Google Docs.`);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar planificación');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskCourseId) return;
    setIsSubmitting(true);
    try {
      await api.createTask({
        courseId: taskCourseId,
        title: taskTitle,
        description: taskDescription,
        category: 'Tarea',
        dueDate: taskDueDate ? `${taskDueDate}T23:59:00Z` : new Date(Date.now() + 7 * 86400000).toISOString(),
        maxPoints: Number(taskPoints) || 100,
        driveAttachments: taskAttachment
          ? [
              {
                id: `att-${Date.now()}`,
                name: taskAttachment,
                type: 'doc',
                url: 'https://drive.google.com',
              },
            ]
          : [],
      });
      onCreated('task', `Tarea "${taskTitle}" creada y asignada a los estudiantes.`);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al publicar tarea');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;
    setIsSubmitting(true);
    try {
      await api.uploadDriveFile({
        name: fileName.includes('.') ? fileName : `${fileName}.${fileType === 'sheet' ? 'xlsx' : fileType === 'doc' ? 'docx' : fileType === 'slide' ? 'pptx' : 'pdf'}`,
        type: fileType,
        folder: fileFolder,
        courseId: fileCourseId,
      });
      onCreated('file', `Recurso "${fileName}" guardado en Google Drive.`);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al subir archivo a Drive');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-neutral-200 overflow-hidden my-8 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-neutral-200">
          <div>
            <h3 className="text-base font-bold text-neutral-800">Crear en Espacio Docente</h3>
            <p className="text-xs text-neutral-500">Selecciona el módulo que deseas incorporar o actualizar</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-neutral-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-neutral-200 bg-neutral-50/70 p-1.5 gap-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('course')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              activeTab === 'course'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Curso</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('plan')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              activeTab === 'plan'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Plan (Docs)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('task')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              activeTab === 'task'
                ? 'bg-white text-green-700 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Classroom</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              activeTab === 'file'
                ? 'bg-white text-amber-600 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <FolderClosed className="w-3.5 h-3.5" />
            <span>Drive</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6">
          {/* COURSE FORM */}
          {activeTab === 'course' && (
            <div className="space-y-4">
              {onOpenImportClassroom && (
                <div
                  onClick={() => {
                    onClose();
                    onOpenImportClassroom();
                  }}
                  className="p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-xs text-emerald-900"
                >
                  <div className="flex items-center gap-2.5">
                    <GraduationCap className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold">¿Tienes las materias en Google Classroom?</p>
                      <p className="text-[11px] text-emerald-700">Impórtalas automáticamente o pegando tu lista escolar</p>
                    </div>
                  </div>
                  <span className="font-bold text-emerald-700 text-xs flex items-center gap-1">
                    Cargar &rarr;
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmitCourse} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Nombre de la Clase</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 4to Año A - Ciencias Naturales"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Asignatura / Materia</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Biología Celular"
                    value={courseSubject}
                    onChange={(e) => setCourseSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Nivel / Grado</label>
                  <input
                    type="text"
                    placeholder="Ej: Secundaria - 4° A"
                    value={courseGrade}
                    onChange={(e) => setCourseGrade(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Aula / Espacio</label>
                  <input
                    type="text"
                    placeholder="Ej: Laboratorio 2 / Aula 14"
                    value={courseRoom}
                    onChange={(e) => setCourseRoom(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Horario Semanal</label>
                  <input
                    type="text"
                    placeholder="Ej: Lun y Mié 08:00 - 09:30"
                    value={courseSchedule}
                    onChange={(e) => setCourseSchedule(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-neutral-600 hover:bg-neutral-100 font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs disabled:opacity-60"
                >
                  {isSubmitting ? 'Guardando...' : 'Crear Curso'}
                </button>
              </div>
            </form>
            </div>
          )}

          {/* LESSON PLAN FORM */}
          {activeTab === 'plan' && (
            <form onSubmit={handleSubmitPlan} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Curso / Asignatura</label>
                <select
                  value={planCourseId}
                  onChange={(e) => setPlanCourseId(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.grade})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Título de la Planificación</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Estructura del ADN y Genética"
                    value={planTitle}
                    onChange={(e) => setPlanTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Unidad Curricular</label>
                  <input
                    type="text"
                    placeholder="Ej: Unidad 2: Herencia"
                    value={planUnit}
                    onChange={(e) => setPlanUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Objetivo de Aprendizaje</label>
                <textarea
                  rows={2}
                  placeholder="Qué sabrán o podrán hacer los estudiantes al concluir la clase..."
                  value={planObjective}
                  onChange={(e) => setPlanObjective(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div className="space-y-2">
                <span className="font-bold text-neutral-700 block">Secuencia Didáctica (3 Momentos)</span>
                <input
                  type="text"
                  placeholder="Inicio (15 min): Motivación y saberes previos..."
                  value={planInicio}
                  onChange={(e) => setPlanInicio(e.target.value)}
                  className="w-full px-3 py-1.5 border border-neutral-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-xs"
                />
                <input
                  type="text"
                  placeholder="Desarrollo (50 min): Actividad central y trabajo grupal..."
                  value={planDesarrollo}
                  onChange={(e) => setPlanDesarrollo(e.target.value)}
                  className="w-full px-3 py-1.5 border border-neutral-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-xs"
                />
                <input
                  type="text"
                  placeholder="Cierre (15 min): Síntesis y ticket de salida formativo..."
                  value={planCierre}
                  onChange={(e) => setPlanCierre(e.target.value)}
                  className="w-full px-3 py-1.5 border border-neutral-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-neutral-600 hover:bg-neutral-100 font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs disabled:opacity-60"
                >
                  {isSubmitting ? 'Guardando...' : 'Crear Plan (Google Docs Ready)'}
                </button>
              </div>
            </form>
          )}

          {/* CLASSROOM TASK FORM */}
          {activeTab === 'task' && (
            <form onSubmit={handleSubmitTask} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Curso Destino en Classroom</label>
                <select
                  value={taskCourseId}
                  onChange={(e) => setTaskCourseId(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none bg-white"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Título de la Tarea</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Informe de Laboratorio N°3"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Consigna e Instrucciones</label>
                <textarea
                  rows={3}
                  placeholder="Detalles sobre lo que los estudiantes deben investigar o entregar..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Puntos Máximos</label>
                  <input
                    type="number"
                    value={taskPoints}
                    onChange={(e) => setTaskPoints(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Fecha Límite</label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Adjunto de Google Drive (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: Plantilla_Informe_Laboratorio.docx"
                  value={taskAttachment}
                  onChange={(e) => setTaskAttachment(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-neutral-600 hover:bg-neutral-100 font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-semibold rounded-lg shadow-xs disabled:opacity-60"
                >
                  {isSubmitting ? 'Publicando...' : 'Publicar en Classroom'}
                </button>
              </div>
            </form>
          )}

          {/* DRIVE FILE FORM */}
          {activeTab === 'file' && (
            <form onSubmit={handleSubmitFile} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Nombre del Archivo / Documento</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Guía Práctica N°5 - Fotosíntesis"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Tipo de Documento</label>
                  <select
                    value={fileType}
                    onChange={(e: any) => setFileType(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                  >
                    <option value="doc">Google Docs (Texto / Guía)</option>
                    <option value="sheet">Google Sheets (Planilla)</option>
                    <option value="slide">Google Slides (Presentación)</option>
                    <option value="pdf">Documento PDF</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Carpeta en Drive</label>
                  <select
                    value={fileFolder}
                    onChange={(e) => setFileFolder(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                  >
                    <option value="Guías y Actividades">Guías y Actividades</option>
                    <option value="Administración y Calificaciones">Administración y Calificaciones</option>
                    <option value="Clases Magistrales">Clases Magistrales</option>
                    <option value="Rúbricas e Instrumentos">Rúbricas e Instrumentos</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Asignar a Curso</label>
                <select
                  value={fileCourseId}
                  onChange={(e) => setFileCourseId(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-neutral-600 hover:bg-neutral-100 font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#4285F4] hover:bg-[#3367d6] text-white font-semibold rounded-lg shadow-xs disabled:opacity-60"
                >
                  {isSubmitting ? 'Subiendo...' : 'Guardar en Google Drive'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
