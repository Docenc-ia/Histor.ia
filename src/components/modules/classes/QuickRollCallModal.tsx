import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  RotateCcw,
  Users,
  Sparkles,
  Check,
  ListFilter,
  LayoutList,
  CreditCard,
  Plus,
  Minus,
} from 'lucide-react';
import { Student, StudentDispositionData, StudentHistoryItem } from '../../../types';
import {
  AttendanceSettings,
  computeStudentAttendanceTrafficLight,
} from '../../../utils/attendanceCalculations';
import { isSameCalendarDay, formatLocalDateDMY } from '../../../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../../../services/firestoreSync';

export type RollCallStatus = 'present' | 'absent' | 'late' | 'unmarked';

interface QuickRollCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId?: string;
  courseName: string;
  students: Student[];
  attendanceTerm: '1c' | '2c' | 'annual';
  attendanceSettings: AttendanceSettings;
  historyList: StudentHistoryItem[];
  getStudentMetrics: (studentId: string, term?: '1c' | '2c' | 'annual') => StudentDispositionData;
  teacherConductOptions: string[];
  onAddAbsence: (student: Student) => Promise<void> | void;
  onRecordLateArrival: (student: Student) => Promise<void> | void;
  onDeleteLatestAbsence: (student: Student) => Promise<void> | void;
  onDeleteLatestLate: (student: Student) => Promise<void> | void;
  onRecordDispositionAction: (
    student: Student,
    actionName: string,
    detailText?: string,
    explicitPointsDelta?: number
  ) => Promise<void> | void;
  isDarkMode: boolean;
}

export const QuickRollCallModal: React.FC<QuickRollCallModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  students,
  attendanceTerm,
  attendanceSettings,
  historyList,
  getStudentMetrics,
  teacherConductOptions,
  onAddAbsence,
  onRecordLateArrival,
  onDeleteLatestAbsence,
  onDeleteLatestLate,
  onRecordDispositionAction,
  isDarkMode,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewStyle, setViewStyle] = useState<'card' | 'compact' | 'summary'>('card');
  const [autoAdvance, setAutoAdvance] = useState(true);
  // Session map of studentId -> status marked during today's roll call or detected from today's history
  const [sessionMarks, setSessionMarks] = useState<Record<string, RollCallStatus>>({});
  const [animatingStatus, setAnimatingStatus] = useState<RollCallStatus | null>(null);

  const activeTerm: '1c' | '2c' = attendanceTerm === '2c' ? '2c' : '1c';
  const todayDateStr = useMemo(() => formatLocalDateDMY(new Date()), []);
  const storageKey = useMemo(() => {
    const safeCourseKey = (courseId || courseName || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDateKey = todayDateStr.replace(/\//g, '-');
    return `fds_rollcall_marks_${safeCourseKey}_${safeDateKey}`;
  }, [courseId, courseName, todayDateStr]);

  const persistDailyMarks = useCallback(
    (marks: Record<string, RollCallStatus>) => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey, JSON.stringify(marks));
        } catch (_) {}
      }
      const uid = getActiveUserId();
      if (uid) {
        firestoreSync.saveUserSetting(uid, storageKey, marks).catch(() => {});
      }
    },
    [storageKey]
  );

  // Detect if a student already has an absence or late recorded TODAY in historyList
  const getTodayRecordedStatus = useCallback(
    (studentId: string): RollCallStatus => {
      const now = new Date();
      const todayEvents = historyList
        .filter(
          (h) =>
            h.studentId === studentId &&
            (activeTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
            isSameCalendarDay(h.date, h.timestamp, now)
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      for (const ev of todayEvents) {
        if (
          ev.category === 'Ausencia' ||
          ev.action === 'Ausencia' ||
          ev.action?.toLowerCase().includes('ausencia') ||
          ev.action?.toLowerCase().includes('falta')
        ) {
          return 'absent';
        }
        if (
          ev.category === 'Llegada tarde' ||
          ev.action === 'Llegada tarde' ||
          ev.action?.toLowerCase().includes('llegada tarde') ||
          ev.action?.toLowerCase().includes('tarde')
        ) {
          return 'late';
        }
      }
      return 'unmarked';
    },
    [historyList, activeTerm]
  );

  // Initialize session marks when modal opens (merging stored daily marks with today's history)
  useEffect(() => {
    if (isOpen) {
      let storedMarks: Record<string, RollCallStatus> = {};
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) storedMarks = JSON.parse(raw);
        } catch (_) {}
      }

      const initial: Record<string, RollCallStatus> = {};
      students.forEach((s) => {
        const todaySt = getTodayRecordedStatus(s.id);
        if (todaySt !== 'unmarked') {
          initial[s.id] = todaySt;
        } else if (storedMarks[s.id] === 'present') {
          initial[s.id] = 'present';
        }
      });
      setSessionMarks(initial);
      setCurrentIndex(0);
      setViewStyle('card');

      // Also check cloud for today's marks across devices (PC <-> mobile)
      const uid = getActiveUserId();
      if (uid) {
        firestoreSync
          .loadUserSetting<Record<string, RollCallStatus>>(uid, storageKey)
          .then((cloudMarks) => {
            if (cloudMarks && typeof cloudMarks === 'object') {
              setSessionMarks((prev) => {
                const merged: Record<string, RollCallStatus> = { ...prev };
                students.forEach((s) => {
                  const todaySt = getTodayRecordedStatus(s.id);
                  if (todaySt !== 'unmarked') {
                    merged[s.id] = todaySt;
                  } else if (!merged[s.id] && cloudMarks[s.id] === 'present') {
                    merged[s.id] = 'present';
                  }
                });
                if (typeof window !== 'undefined') {
                  try {
                    localStorage.setItem(storageKey, JSON.stringify(merged));
                  } catch (_) {}
                }
                return merged;
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, students.length, storageKey]);

  const currentStudent = students[currentIndex] || null;

  const getEffectiveStatus = useCallback(
    (studentId: string): RollCallStatus => {
      if (sessionMarks[studentId]) return sessionMarks[studentId];
      return getTodayRecordedStatus(studentId);
    },
    [sessionMarks, getTodayRecordedStatus]
  );

  // Mark student as Present, Absent, or Late with smart reconciliation so tapping multiple times never duplicates absences/lates
  const handleMarkStudent = useCallback(
    async (student: Student, targetStatus: 'present' | 'absent' | 'late', advanceAfter = autoAdvance) => {
      const prevTodayStatus = getTodayRecordedStatus(student.id);
      const prevEffective = getEffectiveStatus(student.id);

      setAnimatingStatus(targetStatus);
      setTimeout(() => setAnimatingStatus(null), 260);

      if (targetStatus === 'present') {
        // If student had an absence or late recorded today, remove it so they are cleanly Present
        if (prevTodayStatus === 'absent' || prevEffective === 'absent') {
          await onDeleteLatestAbsence(student);
        } else if (prevTodayStatus === 'late' || prevEffective === 'late') {
          await onDeleteLatestLate(student);
        }
        setSessionMarks((prev) => {
          const next = { ...prev, [student.id]: 'present' as RollCallStatus };
          persistDailyMarks(next);
          return next;
        });
      } else if (targetStatus === 'absent') {
        if (prevTodayStatus !== 'absent' && prevEffective !== 'absent') {
          // onAddAbsence automatically cancels today's late arrival if present in one atomic update
          await onAddAbsence(student);
        }
        setSessionMarks((prev) => {
          const next = { ...prev, [student.id]: 'absent' as RollCallStatus };
          persistDailyMarks(next);
          return next;
        });
      } else if (targetStatus === 'late') {
        if (prevTodayStatus !== 'late' && prevEffective !== 'late') {
          // onRecordLateArrival automatically cancels today's absence if present in one atomic update
          await onRecordLateArrival(student);
        }
        setSessionMarks((prev) => {
          const next = { ...prev, [student.id]: 'late' as RollCallStatus };
          persistDailyMarks(next);
          return next;
        });
      }

      if (advanceAfter && viewStyle === 'card') {
        setTimeout(() => {
          if (currentIndex + 1 < students.length) {
            setCurrentIndex((idx) => Math.min(students.length - 1, idx + 1));
          } else {
            setViewStyle('summary');
          }
        }, 180);
      }
    },
    [
      autoAdvance,
      currentIndex,
      getEffectiveStatus,
      getTodayRecordedStatus,
      onAddAbsence,
      onDeleteLatestAbsence,
      onDeleteLatestLate,
      onRecordLateArrival,
      persistDailyMarks,
      students.length,
      viewStyle,
    ]
  );

  // Mark all remaining unmarked students as Present in 1 click
  const handleMarkRemainingAsPresent = () => {
    const nextMarks = { ...sessionMarks };
    students.forEach((s) => {
      const st = getEffectiveStatus(s.id);
      if (st === 'unmarked') {
        nextMarks[s.id] = 'present';
      }
    });
    setSessionMarks(nextMarks);
    persistDailyMarks(nextMarks);
    setViewStyle('summary');
  };

  // Keyboard shortcuts for desktop testing and fast use
  useEffect(() => {
    if (!isOpen || viewStyle !== 'card' || !currentStudent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'p' || e.key === 'P' || e.key === '1') {
        e.preventDefault();
        handleMarkStudent(currentStudent, 'present', true);
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'f' || e.key === 'F' || e.key === '2') {
        e.preventDefault();
        handleMarkStudent(currentStudent, 'absent', true);
      } else if (e.key === 't' || e.key === 'T' || e.key === '3') {
        e.preventDefault();
        handleMarkStudent(currentStudent, 'late', true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentIndex((idx) => Math.min(students.length - 1, idx + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentIndex((idx) => Math.max(0, idx - 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, viewStyle, currentStudent, handleMarkStudent, students.length, onClose]);

  const stats = useMemo(() => {
    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let unmarkedCount = 0;

    students.forEach((s) => {
      const st = getEffectiveStatus(s.id);
      if (st === 'present') presentCount++;
      else if (st === 'absent') absentCount++;
      else if (st === 'late') lateCount++;
      else unmarkedCount++;
    });

    const markedTotal = presentCount + absentCount + lateCount;
    const progressPct = students.length > 0 ? Math.round((markedTotal / students.length) * 100) : 0;

    return {
      presentCount,
      absentCount,
      lateCount,
      unmarkedCount,
      markedTotal,
      progressPct,
    };
  }, [students, getEffectiveStatus]);

  if (!isOpen) return null;

  const todayFormatted = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[94vh] transition-colors animate-in fade-in zoom-in-95 duration-150 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Top Modal Header */}
        <div
          className={`px-4 py-3.5 sm:px-6 sm:py-4 border-b flex items-center justify-between gap-2 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold truncate">
                  Pasar Lista Rápido
                </h2>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    activeTerm === '2c'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                      : 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30'
                  }`}
                >
                  {activeTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'}
                </span>
              </div>
              <p className={`text-[11px] truncate capitalize ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                {courseName} • {todayFormatted}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-full transition-colors cursor-pointer shrink-0 ${
              isDarkMode
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70'
            }`}
            title="Cerrar toma rápida"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher + Live Counters Bar */}
        <div
          className={`px-4 py-2.5 sm:px-6 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-neutral-100'
          }`}
        >
          {/* Mode Tabs */}
          <div
            className={`inline-flex p-1 rounded-xl border ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setViewStyle('card')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewStyle === 'card'
                  ? isDarkMode
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-white text-blue-700 shadow-2xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>1 por 1</span>
            </button>
            <button
              type="button"
              onClick={() => setViewStyle('compact')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewStyle === 'compact'
                  ? isDarkMode
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-white text-blue-700 shadow-2xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span>Lista Móvil</span>
            </button>
            <button
              type="button"
              onClick={() => setViewStyle('summary')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewStyle === 'summary'
                  ? isDarkMode
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-white text-blue-700 shadow-2xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Resumen</span>
            </button>
          </div>

          {/* Live Pills: P / A / T */}
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
              P: {stats.presentCount}
            </span>
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-red-500/15 text-red-600 dark:text-red-300 border border-red-500/30">
              A: {stats.absentCount}
            </span>
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
              T: {stats.lateCount}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className={`w-full h-1.5 ${isDarkMode ? 'bg-slate-800' : 'bg-neutral-100'}`}>
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${stats.progressPct}%` }}
          />
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {students.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Users className="w-10 h-10 text-neutral-400 mx-auto" />
              <p className="text-sm font-bold">No hay estudiantes en este curso</p>
              <p className="text-xs text-neutral-500">
                Agregá o sincronizá estudiantes desde Google Classroom para pasar lista.
              </p>
            </div>
          ) : viewStyle === 'card' && currentStudent ? (
            /* ========================================================= */
            /* VIEW 1: ONE-BY-ONE THUMB CARD                             */
            /* ========================================================= */
            <div className="space-y-4">
              {/* Student Position & Auto-advance toggle */}
              <div className="flex items-center justify-between text-xs">
                <span className={`font-bold ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                  Estudiante {currentIndex + 1} de {students.length}
                </span>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Avanzar solo al tocar
                  </span>
                </label>
              </div>

              {/* Main Student Card */}
              {(() => {
                const metrics = getStudentMetrics(currentStudent.id, activeTerm);
                const tl = computeStudentAttendanceTrafficLight(
                  currentStudent.id,
                  metrics.totalAbsences,
                  metrics.totalLates || 0,
                  activeTerm,
                  attendanceSettings
                );
                const currentSt = getEffectiveStatus(currentStudent.id);

                return (
                  <div
                    className={`rounded-3xl border p-5 sm:p-6 text-center space-y-4 transition-all shadow-sm ${
                      currentSt === 'present'
                        ? isDarkMode
                          ? 'bg-emerald-950/25 border-emerald-700/70'
                          : 'bg-emerald-50/50 border-emerald-300'
                        : currentSt === 'absent'
                        ? isDarkMode
                          ? 'bg-red-950/30 border-red-700/70'
                          : 'bg-red-50/50 border-red-300'
                        : currentSt === 'late'
                        ? isDarkMode
                          ? 'bg-amber-950/30 border-amber-700/70'
                          : 'bg-amber-50/50 border-amber-300'
                        : isDarkMode
                        ? 'bg-slate-800/60 border-slate-700'
                        : 'bg-neutral-50/70 border-neutral-200'
                    }`}
                  >
                    {/* Avatar + Today Badge */}
                    <div className="relative inline-block mx-auto">
                      <img
                        src={currentStudent.avatar}
                        alt={currentStudent.firstName}
                        className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-4 mx-auto shadow-md ${
                          currentSt === 'present'
                            ? 'border-emerald-500'
                            : currentSt === 'absent'
                            ? 'border-red-500'
                            : currentSt === 'late'
                            ? 'border-amber-500'
                            : isDarkMode
                            ? 'border-slate-700'
                            : 'border-white'
                        }`}
                      />
                      {currentSt !== 'unmarked' && (
                        <span
                          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider shadow-xs whitespace-nowrap ${
                            currentSt === 'present'
                              ? 'bg-emerald-600 text-white'
                              : currentSt === 'absent'
                              ? 'bg-red-600 text-white'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          {currentSt === 'present'
                            ? '✓ Presente Hoy'
                            : currentSt === 'absent'
                            ? '✕ Ausente Hoy'
                            : '⏰ Tarde Hoy'}
                        </span>
                      )}
                    </div>

                    {/* Student Name */}
                    <div className="space-y-1 pt-1">
                      <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">
                        {currentStudent.lastName}, {currentStudent.firstName}
                      </h3>
                      {currentStudent.email && (
                        <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          {currentStudent.email}
                        </p>
                      )}
                    </div>

                    {/* Student Quick Context Badges (Faltas, Tardanzas, Semáforo, Disposición) */}
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                          tl.status === 'alert'
                            ? 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30'
                            : tl.status === 'warning'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tl.status === 'alert'
                              ? 'bg-red-500 animate-pulse'
                              : tl.status === 'warning'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                        />
                        <span>
                          {metrics.totalAbsences} {metrics.totalAbsences === 1 ? 'falta' : 'faltas'}
                        </span>
                      </span>

                      {(metrics.totalLates || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
                          <Clock className="w-3 h-3" />
                          <span>
                            {metrics.totalLates} {metrics.totalLates === 1 ? 'tarde' : 'tardes'}
                          </span>
                        </span>
                      )}

                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-blue-300'
                            : 'bg-white border-neutral-200 text-blue-700'
                        }`}
                      >
                        <span>Disposición: {metrics.totalDisposition}/10</span>
                      </span>
                    </div>

                    {/* Giant Thumb-Friendly P / A / T Buttons */}
                    <div className="grid grid-cols-3 gap-2.5 sm:gap-3 pt-2">
                      {/* PRESENTE */}
                      <button
                        type="button"
                        onClick={() => handleMarkStudent(currentStudent, 'present')}
                        className={`py-4 px-3 rounded-2xl border-2 font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm ${
                          currentSt === 'present' || animatingStatus === 'present'
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-600/25 scale-[1.02]'
                            : isDarkMode
                            ? 'bg-emerald-950/50 hover:bg-emerald-900/70 text-emerald-300 border-emerald-800/80'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                      >
                        <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8" />
                        <span className="text-sm sm:text-base tracking-wide">Presente</span>
                        <span className="text-[10px] font-medium opacity-75 hidden sm:inline">
                          Tecla P o 1
                        </span>
                      </button>

                      {/* AUSENTE / FALTA */}
                      <button
                        type="button"
                        onClick={() => handleMarkStudent(currentStudent, 'absent')}
                        className={`py-4 px-3 rounded-2xl border-2 font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm ${
                          currentSt === 'absent' || animatingStatus === 'absent'
                            ? 'bg-red-600 text-white border-red-500 shadow-red-600/25 scale-[1.02]'
                            : isDarkMode
                            ? 'bg-red-950/50 hover:bg-red-900/70 text-red-300 border-red-800/80'
                            : 'bg-red-50 hover:bg-red-100 text-red-800 border-red-300'
                        }`}
                      >
                        <XCircle className="w-7 h-7 sm:w-8 sm:h-8" />
                        <span className="text-sm sm:text-base tracking-wide">Ausente</span>
                        <span className="text-[10px] font-medium opacity-75 hidden sm:inline">
                          Tecla A o 2
                        </span>
                      </button>

                      {/* TARDE */}
                      <button
                        type="button"
                        onClick={() => handleMarkStudent(currentStudent, 'late')}
                        className={`py-4 px-3 rounded-2xl border-2 font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm ${
                          currentSt === 'late' || animatingStatus === 'late'
                            ? 'bg-amber-500 text-white border-amber-400 shadow-amber-500/25 scale-[1.02]'
                            : isDarkMode
                            ? 'bg-amber-950/50 hover:bg-amber-900/70 text-amber-300 border-amber-800/80'
                            : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                        }`}
                      >
                        <Clock className="w-7 h-7 sm:w-8 sm:h-8" />
                        <span className="text-sm sm:text-base tracking-wide">Tarde</span>
                        <span className="text-[10px] font-medium opacity-75 hidden sm:inline">
                          Tecla T o 3
                        </span>
                      </button>
                    </div>

                    {/* Optional Quick Disposition / Conduct Action for Current Student */}
                    <div
                      className={`pt-3 border-t text-left space-y-2 ${
                        isDarkMode ? 'border-slate-700/70' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                          Ajuste rápido de Disposición (opcional):
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onRecordDispositionAction(
                                currentStudent,
                                'Participación en clase',
                                undefined,
                                1
                              )
                            }
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1 cursor-pointer active:scale-95"
                          >
                            <Plus className="w-3 h-3" />
                            <span>+1 Pto</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onRecordDispositionAction(
                                currentStudent,
                                'Llamado de atención',
                                undefined,
                                -1
                              )
                            }
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 border border-rose-500/30 flex items-center gap-1 cursor-pointer active:scale-95"
                          >
                            <Minus className="w-3 h-3" />
                            <span>-1 Pto</span>
                          </button>
                        </div>
                      </div>

                      {teacherConductOptions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {teacherConductOptions.slice(0, 6).map((opt) => {
                            const isPositive =
                              opt.startsWith('+') ||
                              opt.startsWith('[+]') ||
                              opt.includes('(+') ||
                              /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
                                opt
                              );
                            const cleanOpt = opt.replace(/^(\+|\[\+\])\s*/, '');
                            const delta = isPositive ? 1 : -1;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() =>
                                  onRecordDispositionAction(currentStudent, cleanOpt, undefined, delta)
                                }
                                className={`px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer active:scale-95 ${
                                  isPositive
                                    ? isDarkMode
                                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : isDarkMode
                                    ? 'bg-slate-800 text-slate-200 border-slate-700'
                                    : 'bg-white text-neutral-700 border-neutral-200'
                                }`}
                              >
                                {cleanOpt} ({isPositive ? '+1' : '-1'})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Prev / Next Navigation + Student Quick Dots */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                  className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                      : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-200 text-neutral-800'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Anterior</span>
                </button>

                <button
                  type="button"
                  onClick={handleMarkRemainingAsPresent}
                  className={`px-3 py-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/70'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                  }`}
                  title="Marcar como Presentes a todos los alumnos restantes sin marcar"
                >
                  Resto Presentes ({stats.unmarkedCount})
                </button>

                {currentIndex + 1 < students.length ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((idx) => Math.min(students.length - 1, idx + 1))}
                    className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setViewStyle('summary')}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  >
                    <span>Ver Resumen</span>
                    <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ) : viewStyle === 'compact' ? (
            /* ========================================================= */
            /* VIEW 2: COMPACT VERTICAL MOBILE LIST (ZERO OVERFLOW)      */
            /* ========================================================= */
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Tocá <strong>P</strong>, <strong>A</strong> o <strong>T</strong> en cada fila sin desplazarte de costado:
                </p>
                {stats.unmarkedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkRemainingAsPresent}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shrink-0"
                  >
                    Marcar resto P ({stats.unmarkedCount})
                  </button>
                )}
              </div>

              <div className="divide-y divide-neutral-200 dark:divide-slate-800 rounded-2xl border border-neutral-200 dark:border-slate-800 overflow-hidden">
                {students.map((st, idx) => {
                  const status = getEffectiveStatus(st.id);
                  const m = getStudentMetrics(st.id, activeTerm);
                  return (
                    <div
                      key={st.id}
                      className={`p-2.5 sm:p-3 flex items-center justify-between gap-2 transition-colors ${
                        status === 'absent'
                          ? isDarkMode
                            ? 'bg-red-950/25'
                            : 'bg-red-50/60'
                          : status === 'late'
                          ? isDarkMode
                            ? 'bg-amber-950/25'
                            : 'bg-amber-50/60'
                          : status === 'present'
                          ? isDarkMode
                            ? 'bg-emerald-950/15'
                            : 'bg-emerald-50/40'
                          : isDarkMode
                          ? 'bg-slate-900'
                          : 'bg-white'
                      }`}
                    >
                      <div
                        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                        onClick={() => {
                          setCurrentIndex(idx);
                          setViewStyle('card');
                        }}
                      >
                        <span className="text-[11px] font-bold text-neutral-400 w-5 text-right shrink-0">
                          {idx + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-bold truncate">
                            {st.lastName}, {st.firstName}
                          </p>
                          <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                            {m.totalAbsences} {m.totalAbsences === 1 ? 'falta' : 'faltas'}
                            {(m.totalLates || 0) > 0 ? ` • ${m.totalLates} tard.` : ''} • Disp: {m.totalDisposition}/10
                          </p>
                        </div>
                      </div>

                      {/* P / A / T Compact Thumb Buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMarkStudent(st, 'present', false)}
                          className={`w-9 h-9 rounded-xl font-extrabold text-xs border transition-all cursor-pointer active:scale-90 ${
                            status === 'present'
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                              : isDarkMode
                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:border-emerald-600'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-emerald-400'
                          }`}
                          title="Presente"
                        >
                          P
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarkStudent(st, 'absent', false)}
                          className={`w-9 h-9 rounded-xl font-extrabold text-xs border transition-all cursor-pointer active:scale-90 ${
                            status === 'absent'
                              ? 'bg-red-600 text-white border-red-500 shadow-xs'
                              : isDarkMode
                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:border-red-600'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-red-400'
                          }`}
                          title="Ausente"
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarkStudent(st, 'late', false)}
                          className={`w-9 h-9 rounded-xl font-extrabold text-xs border transition-all cursor-pointer active:scale-90 ${
                            status === 'late'
                              ? 'bg-amber-500 text-white border-amber-400 shadow-xs'
                              : isDarkMode
                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:border-amber-500'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-amber-400'
                          }`}
                          title="Tarde"
                        >
                          T
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* VIEW 3: SUMMARY OF TODAY'S ROLL CALL                      */
            /* ========================================================= */
            <div className="space-y-5">
              <div className="text-center space-y-1.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-extrabold">Resumen de Asistencia de Hoy</h3>
                <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Los cambios ya impactaron en la planilla del curso y en el historial.
                </p>
              </div>

              {/* 3 Summary Stat Cards */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}
                >
                  <div className="text-2xl font-black">{stats.presentCount}</div>
                  <div className="text-[11px] font-bold">Presentes</div>
                </div>
                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'bg-red-950/30 border-red-800/60 text-red-300'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  <div className="text-2xl font-black">{stats.absentCount}</div>
                  <div className="text-[11px] font-bold">Ausentes</div>
                </div>
                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'bg-amber-950/30 border-amber-800/60 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <div className="text-2xl font-black">{stats.lateCount}</div>
                  <div className="text-[11px] font-bold">Tardes</div>
                </div>
              </div>

              {/* List of today's Absent or Late students with quick correction */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                  Ausentes y Tardanzas de Hoy ({stats.absentCount + stats.lateCount})
                </h4>

                {stats.absentCount + stats.lateCount === 0 ? (
                  <div
                    className={`p-4 rounded-2xl border text-center text-xs font-medium ${
                      isDarkMode
                        ? 'bg-slate-800/50 border-slate-700 text-slate-300'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                    }`}
                  >
                    ¡Asistencia perfecta! No se registraron ausencias ni tardanzas hoy.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-200 dark:divide-slate-800 rounded-2xl border border-neutral-200 dark:border-slate-800 overflow-hidden">
                    {students
                      .filter((s) => {
                        const st = getEffectiveStatus(s.id);
                        return st === 'absent' || st === 'late';
                      })
                      .map((s) => {
                        const st = getEffectiveStatus(s.id);
                        return (
                          <div
                            key={s.id}
                            className={`p-3 flex items-center justify-between gap-2 text-xs ${
                              isDarkMode ? 'bg-slate-900' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase shrink-0 ${
                                  st === 'absent'
                                    ? 'bg-red-500/15 text-red-600 dark:text-red-300 border border-red-500/30'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                {st === 'absent' ? 'Ausente' : 'Tarde'}
                              </span>
                              <span className="font-bold truncate">
                                {s.lastName}, {s.firstName}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {st === 'absent' && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkStudent(s, 'late', false)}
                                  className="px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-[11px] font-semibold cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/50"
                                  title="Pasar a Llegada Tarde (borra la falta de hoy)"
                                >
                                  Pasar a Tarde
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleMarkStudent(s, 'present', false)}
                                className="px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                                title="Corregir a Presente"
                              >
                                Pasar a Presente
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentIndex(0);
                    setViewStyle('card');
                  }}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-200 text-neutral-700'
                  }`}
                >
                  Volver a revisar
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm cursor-pointer"
                >
                  Finalizar y volver al curso
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
