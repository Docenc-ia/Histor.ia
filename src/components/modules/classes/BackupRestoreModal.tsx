import React, { useState, useRef } from 'react';
import {
  X,
  Download,
  Upload,
  Database,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  ShieldCheck,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Course, Student, StudentHistoryItem } from '../../../types';
import { AttendanceSettings, getCourseAttendanceSettings, saveCourseAttendanceSettings } from '../../../utils/attendanceCalculations';
import { firestoreSync, getActiveUserId } from '../../../services/firestoreSync';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  students: Student[];
  courseHistory: StudentHistoryItem[];
  studentObservations: Record<string, any[]>;
  onRestoreObservations?: (merged: Record<string, any[]>) => void;
  onRestoreSuccess: (message: string) => void;
  isDarkMode: boolean;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  course,
  students,
  courseHistory,
  studentObservations,
  onRestoreObservations,
  onRestoreSuccess,
  isDarkMode,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'restore'>('backup');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [parsedBackup, setParsedBackup] = useState<any | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreMergeMode, setRestoreMergeMode] = useState<'replace' | 'merge'>('merge');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // Total count of observations for this course's students
  const studentIds = new Set(students.map((s) => s.id));
  let courseObservationsCount = 0;
  Object.entries(studentObservations).forEach(([sId, obsList]) => {
    if (studentIds.has(sId) && Array.isArray(obsList)) {
      courseObservationsCount += obsList.length;
    }
  });

  // 1. Export Backup JSON
  const handleDownloadBackup = () => {
    setIsExporting(true);
    try {
      const attendanceSettings = getCourseAttendanceSettings(course.id, course.schedule);

      // Collect specific observations for students in this course
      const filteredObservations: Record<string, any[]> = {};
      students.forEach((s) => {
        if (studentObservations[s.id] && studentObservations[s.id].length > 0) {
          filteredObservations[s.id] = studentObservations[s.id];
        }
      });

      const parseJsonKey = (key: string) => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };

      // Gradebook categories, grades, calc modes, annual overrides & preliminary valuations (1°C & 2°C)
      const gradebook = {
        categories1c:
          parseJsonKey(`fds_grades_categories_${course.id}_1c`) ||
          parseJsonKey(`fds_grades_categories_${course.id}`) ||
          parseJsonKey(`fds_gradebook_categories_${course.id}`),
        categories2c: parseJsonKey(`fds_grades_categories_${course.id}_2c`),
        gradesData1c:
          parseJsonKey(`fds_grades_data_${course.id}_1c`) ||
          parseJsonKey(`fds_grades_data_${course.id}`),
        gradesData2c: parseJsonKey(`fds_grades_data_${course.id}_2c`),
        finalCalc1c:
          localStorage.getItem(`fds_grades_final_calc_${course.id}_1c`) ||
          localStorage.getItem(`fds_grades_final_calc_${course.id}`) ||
          null,
        finalCalc2c: localStorage.getItem(`fds_grades_final_calc_${course.id}_2c`) || null,
        annualOverrides: parseJsonKey(`fds_grades_annual_override_${course.id}`),
        preliminaryValuation1c: parseJsonKey(`fds_preliminary_valuation_${course.id}_1c`),
        preliminaryValuation2c: parseJsonKey(`fds_preliminary_valuation_${course.id}_2c`),
      };

      // Libro de Temas if present
      let libroDeTemas = null;
      try {
        const storageRaw = localStorage.getItem(`fds_libro_temas_${course.id}`);
        if (storageRaw) {
          libroDeTemas = JSON.parse(storageRaw);
        }
      } catch (_) {}

      // Backup payload
      const backupData = {
        app: 'Docenc.ia',
        version: '2.1',
        exportDate: new Date().toISOString(),
        formattedDate: new Date().toLocaleString('es-AR'),
        course: {
          id: course.id,
          name: course.name,
          code: course.code,
          room: course.room,
          schedule: course.schedule,
          studentCount: students.length,
        },
        students: students.map((s) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          email: s.email,
        })),
        attendanceSettings,
        studentObservations: filteredObservations,
        courseHistory,
        gradebook,
        gradebookCategories: gradebook.categories1c,
        libroDeTemas,
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const safeCourseName = (course.name || 'Materia')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .slice(0, 30);
      const dateStr = new Date().toISOString().split('T')[0];

      link.href = url;
      link.download = `Respaldo_DocencIA_${safeCourseName}_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onRestoreSuccess(`Copia de seguridad de "${course.name}" descargada correctamente.`);
    } catch (err: any) {
      console.error('Error generating backup:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Select file to restore
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRestoreError(null);
    setParsedBackup(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const data = JSON.parse(content);

        if (!data || typeof data !== 'object') {
          throw new Error('El archivo no contiene un JSON válido.');
        }

        if (
          !data.course &&
          !data.students &&
          !data.studentObservations &&
          !data.libroDeTemas &&
          !data.gradebook
        ) {
          throw new Error('El archivo seleccionado no tiene la estructura de un respaldo de Docenc.ia.');
        }

        setParsedBackup(data);
      } catch (err: any) {
        setRestoreError(err.message || 'Error al leer el archivo de respaldo.');
      }
    };
    reader.readAsText(file);
  };

  // 3. Confirm and apply restore
  const handleApplyRestore = () => {
    if (!parsedBackup) return;
    setIsRestoring(true);
    try {
      const uid = getActiveUserId();

      // 1. Restore attendance settings if present
      if (parsedBackup.attendanceSettings) {
        saveCourseAttendanceSettings(course.id, parsedBackup.attendanceSettings);
      }

      // 2. Restore student observations
      if (parsedBackup.studentObservations && typeof parsedBackup.studentObservations === 'object') {
        const storedGlobal =
          localStorage.getItem('student_observations') ||
          localStorage.getItem('fds_student_observations');
        let currentGlobal: Record<string, any[]> = { ...studentObservations };
        if (storedGlobal) {
          try {
            currentGlobal = { ...JSON.parse(storedGlobal), ...currentGlobal };
          } catch (_) {}
        }

        const mergedObservations = { ...currentGlobal };
        Object.entries(parsedBackup.studentObservations).forEach(([sId, obsList]: [string, any]) => {
          if (Array.isArray(obsList)) {
            if (restoreMergeMode === 'replace' || !mergedObservations[sId]) {
              mergedObservations[sId] = obsList;
            } else {
              // Merge preserving unique by id or timestamp
              const existingIds = new Set(mergedObservations[sId].map((o) => o.id));
              const toAdd = obsList.filter((o) => !existingIds.has(o.id));
              mergedObservations[sId] = [...mergedObservations[sId], ...toAdd];
            }
          }
        });

        localStorage.setItem('student_observations', JSON.stringify(mergedObservations));
        localStorage.setItem('fds_student_observations', JSON.stringify(mergedObservations));
        localStorage.setItem(`fds_student_observations_${course.id}`, JSON.stringify(mergedObservations));
        if (onRestoreObservations) {
          onRestoreObservations(mergedObservations);
        }
        if (uid) {
          firestoreSync.saveStudentObservationsMap(uid, mergedObservations).catch(() => {});
        }
      }

      // 3. Restore gradebook categories & grades if present
      const gb = parsedBackup.gradebook || {};
      const cats1c = gb.categories1c || parsedBackup.gradebookCategories;
      if (cats1c) {
        try {
          localStorage.setItem(`fds_grades_categories_${course.id}_1c`, JSON.stringify(cats1c));
          localStorage.setItem(`fds_grades_categories_${course.id}`, JSON.stringify(cats1c));
        } catch (_) {}
      }
      if (gb.categories2c) {
        try {
          localStorage.setItem(`fds_grades_categories_${course.id}_2c`, JSON.stringify(gb.categories2c));
        } catch (_) {}
      }
      if (gb.gradesData1c) {
        try {
          localStorage.setItem(`fds_grades_data_${course.id}_1c`, JSON.stringify(gb.gradesData1c));
          localStorage.setItem(`fds_grades_data_${course.id}`, JSON.stringify(gb.gradesData1c));
        } catch (_) {}
      }
      if (gb.gradesData2c) {
        try {
          localStorage.setItem(`fds_grades_data_${course.id}_2c`, JSON.stringify(gb.gradesData2c));
        } catch (_) {}
      }
      if (gb.finalCalc1c) {
        try {
          localStorage.setItem(`fds_grades_final_calc_${course.id}_1c`, gb.finalCalc1c);
          localStorage.setItem(`fds_grades_final_calc_${course.id}`, gb.finalCalc1c);
        } catch (_) {}
      }
      if (gb.finalCalc2c) {
        try {
          localStorage.setItem(`fds_grades_final_calc_${course.id}_2c`, gb.finalCalc2c);
        } catch (_) {}
      }
      if (gb.annualOverrides) {
        try {
          localStorage.setItem(
            `fds_grades_annual_override_${course.id}`,
            JSON.stringify(gb.annualOverrides)
          );
        } catch (_) {}
      }
      if (gb.preliminaryValuation1c) {
        try {
          localStorage.setItem(
            `fds_preliminary_valuation_${course.id}_1c`,
            JSON.stringify(gb.preliminaryValuation1c)
          );
        } catch (_) {}
      }
      if (gb.preliminaryValuation2c) {
        try {
          localStorage.setItem(
            `fds_preliminary_valuation_${course.id}_2c`,
            JSON.stringify(gb.preliminaryValuation2c)
          );
        } catch (_) {}
      }
      if (uid && (cats1c || gb.gradesData1c)) {
        firestoreSync
          .saveTermSnapshot(uid, course.id, '1c', {
            courseId: course.id,
            term: '1c',
            termLabel: '1° Cuatrimestre',
            categories: cats1c || [],
            gradesMap: gb.gradesData1c || {},
            annualOverrides: gb.annualOverrides,
            preliminaryValuation: gb.preliminaryValuation1c,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }
      if (uid && (gb.categories2c || gb.gradesData2c)) {
        firestoreSync
          .saveTermSnapshot(uid, course.id, '2c', {
            courseId: course.id,
            term: '2c',
            termLabel: '2° Cuatrimestre',
            categories: gb.categories2c || [],
            gradesMap: gb.gradesData2c || {},
            preliminaryValuation: gb.preliminaryValuation2c,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }

      // 4. Restore Libro de Temas if present
      if (parsedBackup.libroDeTemas && typeof parsedBackup.libroDeTemas === 'object') {
        try {
          const ldt = parsedBackup.libroDeTemas;
          if (restoreMergeMode === 'replace') {
            localStorage.setItem(`fds_libro_temas_${course.id}`, JSON.stringify(ldt));
          } else {
            const existingRaw = localStorage.getItem(`fds_libro_temas_${course.id}`);
            const existing = existingRaw ? JSON.parse(existingRaw) : {};
            const merged = {
              ...existing,
              ...ldt,
              entries: { ...(existing.entries || {}), ...(ldt.entries || {}) },
            };
            localStorage.setItem(`fds_libro_temas_${course.id}`, JSON.stringify(merged));
          }
        } catch (_) {}
      }

      // Trigger custom events so all components update in-place
      window.dispatchEvent(new CustomEvent('docencia_observations_updated'));
      window.dispatchEvent(new CustomEvent('docencia_disposition_storage_change'));
      window.dispatchEvent(new CustomEvent('fds-grades-updated', { detail: { courseId: course.id } }));
      window.dispatchEvent(new CustomEvent('docencia_libro_temas_restored', { detail: { courseId: course.id } }));

      onRestoreSuccess(`¡Respaldo restaurado con éxito para "${course.name}"!`);
      onClose();
    } catch (err: any) {
      setRestoreError(err.message || 'Error al aplicar el respaldo.');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-all ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-neutral-900 dark:text-white">
                Copia de Seguridad y Respaldo
              </h3>
              <p className="text-xs text-neutral-500 dark:text-slate-400">
                Materia: <strong className="text-neutral-800 dark:text-slate-200">{course.name}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-neutral-200 dark:border-slate-800 px-5 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'backup'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Crear Respaldo (Descargar JSON)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('restore')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'restore'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Restaurar Copia Previa</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border space-y-2.5 ${
                  isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-slate-100">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Resguardo completo de tus registros en 1 clic</span>
                </div>
                <p className="text-neutral-600 dark:text-slate-300 leading-relaxed">
                  Descargá a tu computadora un archivo seguro en formato JSON con todas tus anotaciones pedagógicas,
                  cálculos de semáforo de asistencia, inasistencias y configuración del curso.
                </p>

                {/* Resumen del contenido a respaldar */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-neutral-200 dark:border-slate-700/60">
                    <span className="text-[10px] text-neutral-400 block font-medium">Estudiantes</span>
                    <span className="text-sm font-bold text-neutral-900 dark:text-white">
                      {students.length} alumnos
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-neutral-200 dark:border-slate-700/60">
                    <span className="text-[10px] text-neutral-400 block font-medium">Observaciones</span>
                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                      {courseObservationsCount} notas
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-neutral-200 dark:border-slate-700/60">
                    <span className="text-[10px] text-neutral-400 block font-medium">Historial</span>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {courseHistory.length} registros
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={isExporting}
                  className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
                >
                  <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
                  <span>{isExporting ? 'Generando archivo...' : 'Descargar Archivo de Respaldo (.json)'}</span>
                </button>
                <p className="text-[11px] text-center text-neutral-400 dark:text-slate-500 mt-2">
                  No requiere conexión a internet para guardarse. Podés conservarlo o llevarlo a otra computadora.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'restore' && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border border-dashed text-center space-y-3 cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-850/50 hover:bg-slate-850'
                    : 'border-neutral-300 bg-neutral-50/80 hover:bg-neutral-100'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json,application/json"
                  className="hidden"
                />
                <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-sm text-neutral-900 dark:text-white">
                    Hacé clic acá para seleccionar tu archivo de respaldo
                  </p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Archivos .json generados previamente por Docenc.ia
                  </p>
                </div>
              </div>

              {restoreError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{restoreError}</span>
                </div>
              )}

              {parsedBackup && (
                <div
                  className={`p-4 rounded-xl border space-y-3 animate-in fade-in ${
                    isDarkMode ? 'bg-slate-850 border-slate-700' : 'bg-emerald-50/50 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Archivo de respaldo válido detectado</span>
                  </div>

                  <div className="space-y-1.5 text-[11px] text-neutral-600 dark:text-slate-300">
                    <p>
                      Materia en el archivo:{' '}
                      <strong className="text-neutral-900 dark:text-white">
                        {parsedBackup.course?.name || 'Materia'}
                      </strong>
                    </p>
                    <p>
                      Fecha de creación:{' '}
                      <strong className="text-neutral-900 dark:text-white">
                        {parsedBackup.formattedDate || parsedBackup.exportDate || 'No especificada'}
                      </strong>
                    </p>
                    <p>
                      Alumnos incluidos:{' '}
                      <strong className="text-neutral-900 dark:text-white">
                        {parsedBackup.students?.length || 0} alumnos
                      </strong>
                    </p>
                  </div>

                  {/* Merge Mode Choice */}
                  <div className="pt-2 border-t border-neutral-200 dark:border-slate-700 space-y-1.5">
                    <label className="font-bold text-[11px] block">Modo de restauración:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRestoreMergeMode('merge')}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                          restoreMergeMode === 'merge'
                            ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold'
                            : 'border-neutral-200 dark:border-slate-700 opacity-70'
                        }`}
                      >
                        <span className="block font-semibold">Combinar (Recomendado)</span>
                        <span className="text-[10px] opacity-75 font-normal">Suma las notas sin borrar las actuales</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRestoreMergeMode('replace')}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                          restoreMergeMode === 'replace'
                            ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold'
                            : 'border-neutral-200 dark:border-slate-700 opacity-70'
                        }`}
                      >
                        <span className="block font-semibold">Reemplazar Todo</span>
                        <span className="text-[10px] opacity-75 font-normal">Sobrescribe con los datos del archivo</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyRestore}
                    disabled={isRestoring}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 mt-3"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                    <span>{isRestoring ? 'Restaurando datos...' : 'Confirmar y Restaurar Ahora'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-neutral-200 dark:border-slate-800 bg-neutral-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 dark:text-slate-300 hover:bg-neutral-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
