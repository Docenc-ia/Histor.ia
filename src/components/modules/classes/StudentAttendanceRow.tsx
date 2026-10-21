import React from 'react';
import {
  Square,
  CheckSquare,
  Pencil,
  Clock,
  RotateCcw,
  Plus,
  Minus,
  History,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { Student, StudentDispositionData, StudentHistoryItem } from '../../../types';
import {
  StudentAttendanceTrafficLight,
  getTrafficLightBadgeStyle,
} from '../../../utils/attendanceCalculations';
import { isSameCalendarDay } from '../../../utils/dateUtils';
import { useWorkspaceAuth } from '../../../context/WorkspaceAuthContext';

interface StudentAttendanceRowProps {
  student: Student;
  isSelected: boolean;
  onToggleSelect: (studentId: string) => void;
  metrics: StudentDispositionData;
  trafficLight?: StudentAttendanceTrafficLight;
  observationsCount: number;
  hasPendingAbsence: boolean;
  studentHistory: StudentHistoryItem[];
  teacherConductOptions: string[];
  pulsingStudentId: string | null;
  onOpenProfile: (student: Student) => void;
  onOpenEditAbsences: (student: Student) => void;
  onOpenEditDisposition: (student: Student) => void;
  onAddAbsence: (student: Student) => void;
  onRecordLateArrival: (student: Student) => void;
  onDeleteLatestAbsence?: (student: Student) => void;
  onDeleteLatestLate: (student: Student) => void;
  onRecordDispositionAction: (student: Student, cleanReason: string, date?: string, delta?: number) => void;
  onOpenConductModal: (student: Student, mode: 'add' | 'subtract') => void;
  onOpenStudentHistory: (student: Student) => void;
  onOpenTrafficLightSettings?: () => void;
  isDarkMode: boolean;
}

export const StudentAttendanceRow: React.FC<StudentAttendanceRowProps> = React.memo(({
  student,
  isSelected,
  onToggleSelect,
  metrics,
  trafficLight,
  observationsCount,
  hasPendingAbsence,
  studentHistory,
  teacherConductOptions,
  pulsingStudentId,
  onOpenProfile,
  onOpenEditAbsences,
  onOpenEditDisposition,
  onAddAbsence,
  onRecordLateArrival,
  onDeleteLatestAbsence,
  onDeleteLatestLate,
  onRecordDispositionAction,
  onOpenConductModal,
  onOpenStudentHistory,
  onOpenTrafficLightSettings,
  isDarkMode,
}) => {
  const { user } = useWorkspaceAuth();
  const score = metrics.totalDisposition;
  const scoreBadgeClass =
    score >= 8
      ? isDarkMode
        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : score >= 6
      ? isDarkMode
        ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
        : 'bg-amber-50 text-amber-700 border-amber-200'
      : isDarkMode
      ? 'bg-red-950/60 text-red-300 border-red-800/60'
      : 'bg-red-50 text-red-700 border-red-200';

  const isTodayAbsent = React.useMemo(() => {
    const now = new Date();
    return studentHistory.some(
      (h) =>
        (h.category === 'Ausencia' ||
          h.action === 'Ausencia' ||
          h.action?.toLowerCase().includes('ausencia') ||
          h.action?.toLowerCase().includes('falta')) &&
        h.category !== 'Sistema' &&
        !h.action?.toLowerCase().includes('actualizada') &&
        isSameCalendarDay(h.date, h.timestamp, now)
    );
  }, [studentHistory]);

  const isTodayLate = React.useMemo(() => {
    const now = new Date();
    return studentHistory.some(
      (h) =>
        (h.category === 'Llegada tarde' ||
          h.action === 'Llegada tarde' ||
          h.action?.toLowerCase().includes('llegada tarde') ||
          h.action?.toLowerCase().includes('tarde') ||
          h.action?.toLowerCase().includes('tardanza')) &&
        h.category !== 'Sistema' &&
        isSameCalendarDay(h.date, h.timestamp, now)
    );
  }, [studentHistory]);

  return (
    <tr
      className={`group/row transition-colors ${
        isSelected
          ? isDarkMode
            ? 'bg-indigo-950/30'
            : 'bg-indigo-50/50'
          : isDarkMode
          ? 'hover:bg-slate-800/50'
          : 'hover:bg-neutral-50/70'
      }`}
    >
      {/* Selection checkbox */}
      <td className="py-2 px-2.5 text-center">
        <button
          type="button"
          onClick={() => onToggleSelect(student.id)}
          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          title={isSelected ? 'Deseleccionar estudiante' : 'Seleccionar estudiante para aviso en lote'}
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <Square className="w-4 h-4 text-neutral-400 dark:text-slate-500" />
          )}
        </button>
      </td>

      {/* Student info */}
      <td className="py-2 px-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenProfile(student)}
            className="relative shrink-0 cursor-pointer group/avatar"
            title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
          >
            <img
              src={student.avatar}
              alt={student.firstName}
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover border shrink-0 transition-transform group-hover/avatar:scale-105 group-hover/avatar:ring-2 group-hover/avatar:ring-indigo-400 ${
                isDarkMode ? 'border-slate-700' : 'border-neutral-200'
              }`}
            />
            {observationsCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[8px] font-bold border-2 border-white dark:border-slate-900 shadow-xs"
                title={`${observationsCount} observación(es) registrada(s)`}
              >
                {observationsCount}
              </span>
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => onOpenProfile(student)}
                className={`font-semibold text-left transition-colors cursor-pointer group flex items-center gap-1 hover:underline text-xs sm:text-sm ${
                  isDarkMode
                    ? 'text-slate-100 hover:text-indigo-400'
                    : 'text-neutral-800 hover:text-indigo-600'
                }`}
                title={`Ver ficha y observaciones de ${student.lastName}, ${student.firstName}`}
              >
                <span>{student.lastName}, {student.firstName}</span>
              </button>

              <a
                href={`?course=${student.courseId}&view=course_detail&studentId=${student.id}${user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`p-1 rounded-md transition-opacity opacity-0 group-hover/row:opacity-100 ${
                  isDarkMode
                    ? 'text-slate-400 hover:text-indigo-400 hover:bg-slate-800'
                    : 'text-neutral-400 hover:text-indigo-600 hover:bg-neutral-200/80'
                }`}
                title={`Abrir observaciones de ${student.lastName}, ${student.firstName} en otra pestaña`}
              >
                <ExternalLink className="w-3 h-3" />
              </a>

              {observationsCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenProfile(student)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer shadow-2xs"
                  title={`${observationsCount} observación(es) registrada(s). Clic para abrir ficha.`}
                >
                  <FileText className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{observationsCount}</span>
                </button>
              )}

              {hasPendingAbsence && (
                <span
                  className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                  title="Tiene una ausencia registrada pendiente de enviar notificación"
                >
                  Aviso pendiente
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Attendance Metrics Column with Semáforo Traffic Light (Sin mostrar porcentaje) */}
      <td
        className="py-2 px-3 text-center whitespace-nowrap cursor-pointer hover:bg-neutral-50 dark:hover:bg-slate-800/40 transition-colors"
        onClick={() => onOpenEditAbsences(student)}
      >
        <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
          {(() => {
            const status = trafficLight?.status || (metrics.totalAbsences === 0 ? 'regular' : 'regular');
            
            const badgeClasses =
              status === 'alert'
                ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800/80 hover:bg-red-100 dark:hover:bg-red-900/60 shadow-xs'
                : status === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-900/60 shadow-xs'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 shadow-xs';

            const dotClasses =
              status === 'alert'
                ? 'bg-red-500 animate-pulse'
                : status === 'warning'
                ? 'bg-amber-500'
                : 'bg-emerald-500';

            const tooltipText = trafficLight
              ? `Inasistencias: ${metrics.totalAbsences}. Semáforo: ${trafficLight.statusLabel}. Hacé clic para editar faltas o clic en el nombre del alumno para ver el total detallado.`
              : `Total inasistencias: ${metrics.totalAbsences}. Hacé clic para editar las faltas.`;

            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenEditAbsences(student);
                }}
                className={`inline-flex items-center gap-1.5 justify-center min-w-[36px] px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 group ${badgeClasses}`}
                title={tooltipText}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClasses}`} />
                <span>{metrics.totalAbsences} {metrics.totalAbsences === 1 ? 'falta' : 'faltas'}</span>
                <Pencil className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity ml-0.5" />
              </button>
            );
          })()}

          {(metrics.totalLates || 0) > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenEditAbsences(student);
              }}
              className="inline-flex items-center gap-1 justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 hover:scale-105 transition-all cursor-pointer"
              title={`Llegadas tarde acumuladas: ${metrics.totalLates}. Hacé clic para editar.`}
            >
              <Clock className="w-2.5 h-2.5 text-amber-500" />
              <span>{metrics.totalLates} {metrics.totalLates === 1 ? 'tarde' : 'tardes'}</span>
            </button>
          )}
        </div>
      </td>

      {/* Register Attendance Buttons */}
      <td className="py-2 px-3 text-center">
        <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (isTodayAbsent && onDeleteLatestAbsence) {
                onDeleteLatestAbsence(student);
              } else {
                onAddAbsence(student);
              }
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center justify-center active:scale-90 ${
              isTodayAbsent
                ? 'bg-red-600 text-white border-red-600 shadow-xs'
                : pulsingStudentId === `abs-${student.id}`
                ? 'bg-red-600 text-white border-red-600 scale-105'
                : isDarkMode
                ? 'border-slate-700 text-slate-300 hover:text-red-300 hover:border-red-800 hover:bg-red-950/40'
                : 'border-neutral-200 text-neutral-700 hover:text-red-700 hover:border-red-200 hover:bg-red-50 shadow-2xs'
            }`}
            title={
              isTodayAbsent
                ? 'Ausente hoy. Clic para desmarcar / quitar falta de hoy.'
                : 'Marcar falta (suma 1 ausencia sin descontar puntos de disposición)'
            }
          >
            <span>{isTodayAbsent ? 'Ausente hoy' : 'Falta'}</span>
          </button>

          {(metrics.totalAbsences || 0) > 0 && onDeleteLatestAbsence && (
            <button
              type="button"
              onClick={() => onDeleteLatestAbsence(student)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 text-xs font-medium text-neutral-600 dark:text-slate-300 hover:text-red-600 hover:border-red-200 dark:hover:border-red-800/60 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all cursor-pointer active:scale-90 shadow-2xs"
              title="Borrar falta: elimina la última inasistencia registrada y actualiza el contador"
            >
              <RotateCcw className="w-3 h-3 text-red-500" />
              <span className="text-[11px]">Borrar falta</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (isTodayLate && onDeleteLatestLate) {
                onDeleteLatestLate(student);
              } else {
                onRecordLateArrival(student);
              }
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center justify-center active:scale-90 ${
              isTodayLate
                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                : pulsingStudentId === `late-${student.id}`
                ? 'bg-amber-600 text-white border-amber-600 scale-105'
                : isDarkMode
                ? 'border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-800 hover:bg-amber-950/40'
                : 'border-neutral-200 text-neutral-700 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50 shadow-2xs'
            }`}
            title={
              isTodayLate
                ? 'Llegó tarde hoy. Clic para desmarcar / quitar tardanza de hoy.'
                : 'Registrar llegada tarde. Si el alumno tenía una falta registrada hoy, se borra automáticamente.'
            }
          >
            <span>{isTodayLate ? 'Tarde hoy' : 'Tarde'}</span>
          </button>

          {(metrics.totalLates || 0) > 0 && (
            <button
              type="button"
              onClick={() => onDeleteLatestLate(student)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-slate-700 text-xs font-medium text-neutral-600 dark:text-slate-300 hover:text-amber-600 hover:border-amber-200 dark:hover:border-amber-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all cursor-pointer active:scale-90 shadow-2xs"
              title="Borrar tardanza: elimina la última llegada tarde registrada y actualiza el contador"
            >
              <RotateCcw className="w-3 h-3 text-amber-500" />
              <span className="text-[11px]">Borrar tarde</span>
            </button>
          )}
        </div>
      </td>

      {/* Disposition Score Column */}
      <td
        className="py-2 px-3 text-center cursor-pointer hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors"
        onClick={() => onOpenEditDisposition(student)}
      >
        <div className="inline-flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditDisposition(student);
            }}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-2xs group ${scoreBadgeClass}`}
            title={`Hacé clic sobre la nota para editar la calificación de disposición de ${student.lastName}, ${student.firstName} (pasar de papel o ajustar)`}
          >
            <span>{metrics.totalDisposition}</span>
            <span className="text-[10px] font-normal opacity-70">/ 10</span>
            <Pencil className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 transition-opacity ml-0.5" />
          </button>
        </div>
      </td>

      {/* Conduct Column */}
      <td className="py-2 px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {teacherConductOptions.map((opt) => {
            const isPositive =
              opt.startsWith('+') ||
              opt.startsWith('[+]') ||
              opt.includes('(+') ||
              /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(opt);
            const cleanOpt = opt.replace(/^(\+|\[\+\])\s*/, '');
            const delta = isPositive ? 1 : -1;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onRecordDispositionAction(student, cleanOpt, undefined, delta)}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 active:scale-95 ${
                  pulsingStudentId === `disp-${student.id}`
                    ? isPositive
                      ? 'bg-emerald-600 text-white border-emerald-600 scale-105'
                      : 'bg-rose-600 text-white border-rose-600 scale-105'
                    : isPositive
                    ? isDarkMode
                      ? 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/60 hover:border-emerald-700'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 hover:border-emerald-300 shadow-2xs'
                    : isDarkMode
                    ? 'bg-slate-800/90 hover:bg-slate-750 text-slate-200 border-slate-700 hover:border-slate-600'
                    : 'bg-white hover:bg-rose-50 text-neutral-800 border-neutral-200 hover:border-rose-300 shadow-2xs'
                }`}
                title={isPositive ? `Sumar 1 punto por: ${cleanOpt}` : `Restar 1 punto por: ${cleanOpt}`}
              >
                <span>{cleanOpt}</span>
                <span className={`text-[10px] font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                  {isPositive ? '+1' : '-1'}
                </span>
              </button>
            );
          })}

          {/* Quick Add Points */}
          <button
            type="button"
            onClick={() => onOpenConductModal(student, 'add')}
            className="px-2 py-1 rounded-lg border border-dashed border-emerald-500/80 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95"
            title={`Sumar puntos a ${student.lastName}, ${student.firstName} (participación, reconocimiento, tarea...)`}
          >
            <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>+ Sumar</span>
          </button>

          {/* Quick Subtract Points */}
          <button
            type="button"
            onClick={() => onOpenConductModal(student, 'subtract')}
            className="px-2 py-1 rounded-lg border border-dashed border-rose-400/80 bg-rose-50/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95"
            title={`Restar puntos a ${student.lastName}, ${student.firstName} (falta de tarea, libro, conducta...)`}
          >
            <Minus className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            <span>- Restar</span>
          </button>
        </div>
      </td>
    </tr>
  );
});

