import React, { useState } from 'react';
import {
  Course,
  Student,
  StudentHistoryItem,
  StudentDispositionData,
  AbsenceNotificationSettings,
  AbsencePresetTemplate,
} from '../types';
import {
  GradeCategory,
  GradeSubcategory,
  StudentGradesMap,
  DEFAULT_CATEGORIES,
} from '../types/grades';
import {
  api,
  getUserStorageKey,
  markHistoryIdDeleted,
} from '../services/api';
import { getCachedAccessToken } from '../services/workspace/googleAuth';
import { sheetsService } from '../services/workspace/sheetsService';
import { formatLocalDateDMY } from '../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { DEFAULT_ABSENCE_PRESETS } from './useCourseNotifications';

export interface UseManualDispositionAndAbsenceEditorProps {
  activeCourse: Course;
  courseStudents: Student[];
  filteredStudents: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  historyList: StudentHistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<StudentHistoryItem[]>>;
  activeConcreteTerm: '1c' | '2c';
  notifSettings: AbsenceNotificationSettings;
  savedPresets: AbsencePresetTemplate[];
  formatTemplateForStudent: (
    template: string,
    student: { firstName: string; lastName: string; id: string },
    courseName: string,
    dispositionScore: number,
    dateStr?: string,
    reason?: string,
    pointsDelta?: number
  ) => string;
  getStudentMetrics: (
    studentId: string,
    targetTerm?: '1c' | '2c' | 'annual' | 'all'
  ) => StudentDispositionData;
  saveTermDisposition: (
    term: '1c' | '2c',
    newMap: Record<string, StudentDispositionData>,
    newHistory: StudentHistoryItem[]
  ) => void;
  deduplicateHistory: (items: StudentHistoryItem[]) => StudentHistoryItem[];
  triggerSheetsSync: (
    updatedMap?: Record<string, StudentDispositionData>,
    updatedHistory?: StudentHistoryItem[],
    updatedMap2c?: Record<string, StudentDispositionData>
  ) => void;
  sheetConfig: {
    spreadsheetId: string;
    url: string;
    isLiveGoogle?: boolean;
    lastSyncedAt?: string;
  } | null;
  token: string | null;
  setActiveTab: React.Dispatch<
    React.SetStateAction<'roster' | 'libro_temas' | 'grades' | 'history'>
  >;
  setToastMessage: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useManualDispositionAndAbsenceEditor({
  activeCourse,
  courseStudents,
  filteredStudents,
  dispositionMap,
  dispositionMap2c,
  historyList,
  setHistoryList,
  activeConcreteTerm,
  notifSettings,
  savedPresets,
  formatTemplateForStudent,
  getStudentMetrics,
  saveTermDisposition,
  deduplicateHistory,
  triggerSheetsSync,
  sheetConfig,
  token,
  setActiveTab,
  setToastMessage,
}: UseManualDispositionAndAbsenceEditorProps) {
  // Modal para editar la nota de disposición de un estudiante (ingreso manual / notas en papel)
  const [editingDispositionStudent, setEditingDispositionStudent] = useState<Student | null>(null);
  const [editingDispositionScore, setEditingDispositionScore] = useState<string>('10');
  const [editingDispositionTerm, setEditingDispositionTerm] = useState<'1c' | '2c'>('1c');
  const [editingDispositionReason, setEditingDispositionReason] = useState<string>('');

  // Modal para editar cantidad de faltas (pasaje de papel, fecha retroactiva y aviso al alumno)
  const [editingAbsenceStudent, setEditingAbsenceStudent] = useState<Student | null>(null);
  const [editingAbsenceCount, setEditingAbsenceCount] = useState<string>('0');
  const [editingAbsenceTerm, setEditingAbsenceTerm] = useState<'1c' | '2c'>('1c');
  const [editingAbsenceDate, setEditingAbsenceDate] = useState<string>(() => {
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  });
  const [editingAbsenceReason, setEditingAbsenceReason] = useState<string>(
    'Pasado de planilla en papel'
  );
  const [editingAbsenceSendNotif, setEditingAbsenceSendNotif] = useState<boolean>(false);
  const [editingAbsenceChannel, setEditingAbsenceChannel] = useState<'classroom' | 'gmail'>(
    'classroom'
  );
  const [editingAbsenceMessageText, setEditingAbsenceMessageText] = useState<string>('');
  const [isSavingAbsenceEdit, setIsSavingAbsenceEdit] = useState<boolean>(false);

  // Modal para mandar nota de disposición a Calificaciones
  const [isSendDispositionModalOpen, setIsSendDispositionModalOpen] = useState(false);

  // 7a. Abrir modal para editar manualmente la nota de disposición
  const handleOpenEditDisposition = (student: Student, termOverride?: '1c' | '2c') => {
    const termToUse: '1c' | '2c' = termOverride || activeConcreteTerm;
    const currentMetrics = getStudentMetrics(student.id, termToUse);
    setEditingDispositionStudent(student);
    setEditingDispositionTerm(termToUse);
    setEditingDispositionScore(String(currentMetrics.totalDisposition));
    setEditingDispositionReason('');
  };

  const handleChangeEditingTerm = (newTerm: '1c' | '2c') => {
    setEditingDispositionTerm(newTerm);
    if (editingDispositionStudent) {
      const metrics = getStudentMetrics(editingDispositionStudent.id, newTerm);
      setEditingDispositionScore(String(metrics.totalDisposition));
    }
  };

  const handleNavigateEditStudent = (direction: -1 | 1) => {
    if (!editingDispositionStudent) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === editingDispositionStudent.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      const targetStudent = filteredStudents[targetIndex];
      const metrics = getStudentMetrics(targetStudent.id, editingDispositionTerm);
      setEditingDispositionStudent(targetStudent);
      setEditingDispositionScore(String(metrics.totalDisposition));
      setEditingDispositionReason('');
    }
  };

  const handleSaveStudentDisposition = async (moveToNext: boolean = false) => {
    if (!activeCourse || !editingDispositionStudent) return;

    const student = editingDispositionStudent;
    const term = editingDispositionTerm;
    const parsed = parseFloat(editingDispositionScore);
    if (isNaN(parsed) || parsed < 0 || parsed > 10) {
      setToastMessage('Ingresá una nota numérica válida entre 0 y 10.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const clampedScore = Math.min(10, Math.max(0, Math.round(parsed * 10) / 10));

    const baseMap = term === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || {
      totalAbsences: 0,
      totalLates: 0,
      totalDisposition: 10,
    };
    const oldScore = current.totalDisposition ?? 10;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: clampedScore,
      },
    };

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const studentFullName = `${student.lastName}, ${student.firstName}`;

    const termLabel = term === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
    const reasonTrimmed = editingDispositionReason.trim();
    const actionText = reasonTrimmed
      ? `Nota de disposición ajustada a ${clampedScore}/10 (${termLabel}) - Motivo: ${reasonTrimmed}`
      : `Nota de disposición ajustada a ${clampedScore}/10 (${termLabel})`;

    const editEntry: StudentHistoryItem = {
      id: `rec-disp-edit-${student.id}-${timestamp}`,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term,
      action: actionText,
      category: 'Disposición',
      pointsChange: Number((clampedScore - oldScore).toFixed(1)),
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([editEntry, ...historyList]);
    setHistoryList(updatedHistory);
    saveTermDisposition(term, updatedMap, updatedHistory);

    triggerSheetsSync(
      term === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      term === '2c' ? updatedMap : dispositionMap2c
    );

    api
      .recordDisposition({
        id: editEntry.id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: actionText,
        category: 'Disposición',
        term,
        date,
        time,
        timestamp,
        expectedSummary: {
          totalAbsences: current.totalAbsences ?? 0,
          totalLates: current.totalLates ?? 0,
          totalDisposition: clampedScore,
        },
      })
      .catch(() => {});

    setToastMessage(
      `Nota de disposición guardada: ${clampedScore}/10 para ${student.lastName}, ${student.firstName} (${term === '2c' ? '2°C' : '1°C'})`
    );
    setTimeout(() => setToastMessage(null), 3500);

    if (moveToNext) {
      const currentIndex = filteredStudents.findIndex((s) => s.id === student.id);
      if (currentIndex !== -1 && currentIndex < filteredStudents.length - 1) {
        const nextStudent = filteredStudents[currentIndex + 1];
        const nextMetrics = getStudentMetrics(nextStudent.id, term);
        setEditingDispositionStudent(nextStudent);
        setEditingDispositionScore(String(nextMetrics.totalDisposition));
        setEditingDispositionReason('');
        return;
      }
    }

    setEditingDispositionStudent(null);
  };

  // 7b. Abrir modal para editar la cantidad de faltas
  const handleOpenEditAbsences = (student: Student, termOverride?: '1c' | '2c') => {
    const termToUse: '1c' | '2c' = termOverride || activeConcreteTerm;
    const currentMetrics = getStudentMetrics(student.id, termToUse);
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const formattedDateDMY = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;

    setEditingAbsenceStudent(student);
    setEditingAbsenceTerm(termToUse);
    setEditingAbsenceCount(String(currentMetrics.totalAbsences));
    setEditingAbsenceDate(todayStr);
    setEditingAbsenceReason('Pasado de planilla en papel');
    setEditingAbsenceSendNotif(false);
    setEditingAbsenceChannel(notifSettings.channel || 'classroom');

    const curDisp = currentMetrics.totalDisposition ?? 10;
    const defaultAbsenceTpl =
      savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
      notifSettings.templateClassroom ||
      DEFAULT_ABSENCE_PRESETS[0].text;

    const defaultMsg = formatTemplateForStudent(
      defaultAbsenceTpl,
      student,
      activeCourse.name,
      curDisp,
      formattedDateDMY
    );
    setEditingAbsenceMessageText(defaultMsg);
  };

  const handleChangeEditingAbsenceTerm = (newTerm: '1c' | '2c') => {
    setEditingAbsenceTerm(newTerm);
    if (editingAbsenceStudent) {
      const metrics = getStudentMetrics(editingAbsenceStudent.id, newTerm);
      setEditingAbsenceCount(String(metrics.totalAbsences));
    }
  };

  const handleNavigateEditAbsenceStudent = (direction: -1 | 1) => {
    if (!editingAbsenceStudent) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === editingAbsenceStudent.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      const targetStudent = filteredStudents[targetIndex];
      const metrics = getStudentMetrics(targetStudent.id, editingAbsenceTerm);
      setEditingAbsenceStudent(targetStudent);
      setEditingAbsenceCount(String(metrics.totalAbsences));

      let dmy = '';
      if (editingAbsenceDate) {
        const parts = editingAbsenceDate.split('-');
        if (parts.length === 3) {
          dmy = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
      }
      const defaultAbsenceTpl =
        savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
        notifSettings.templateClassroom ||
        DEFAULT_ABSENCE_PRESETS[0].text;
      const defaultMsg = formatTemplateForStudent(
        defaultAbsenceTpl,
        targetStudent,
        activeCourse.name,
        metrics.totalDisposition ?? 10,
        dmy || formatLocalDateDMY()
      );
      setEditingAbsenceMessageText(defaultMsg);
    }
  };

  const handleSaveStudentAbsences = async (moveToNext: boolean = false) => {
    if (!activeCourse || !editingAbsenceStudent) return;

    const student = editingAbsenceStudent;
    const term = editingAbsenceTerm;
    const parsed = parseInt(editingAbsenceCount, 10);
    if (isNaN(parsed) || parsed < 0) {
      setToastMessage(
        'Ingresá una cantidad de faltas válida (número entero mayor o igual a 0).'
      );
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const finalAbsences = Math.max(0, Math.floor(parsed));

    const baseMap = term === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || getStudentMetrics(student.id, term);
    const oldAbsences = current.totalAbsences ?? 0;
    const difference = finalAbsences - oldAbsences;

    let selectedDateDMY = formatLocalDateDMY();
    let recordTimestamp = Date.now();
    if (editingAbsenceDate) {
      const parts = editingAbsenceDate.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const pad = (n: number) => n.toString().padStart(2, '0');
        selectedDateDMY = `${pad(d)}/${pad(m)}/${y}`;
        const targetDateObj = new Date(y, m - 1, d, 12, 0, 0);
        if (!isNaN(targetDateObj.getTime())) {
          recordTimestamp = targetDateObj.getTime();
        }
      }
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const reasonTrimmed = editingAbsenceReason.trim();

    setIsSavingAbsenceEdit(true);

    try {
      const updatedMap: Record<string, StudentDispositionData> = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalAbsences: finalAbsences,
        },
      };

      let updatedHistory = [...historyList];
      if (difference < 0) {
        let removed = 0;
        const toRemove = Math.abs(difference);
        updatedHistory = updatedHistory.filter((h) => {
          if (
            removed < toRemove &&
            h.studentId === student.id &&
            (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id) &&
            (term === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
            (h.category === 'Ausencia' ||
              h.action?.toLowerCase().includes('ausencia') ||
              h.action?.toLowerCase().includes('falta'))
          ) {
            markHistoryIdDeleted(h.id);
            api.deleteDispositionHistory(h.id).catch(() => {});
            removed++;
            return false;
          }
          return true;
        });
      }

      const auditAction =
        difference !== 0
          ? `Inasistencias actualizadas en fecha ${selectedDateDMY}: ${oldAbsences} → ${finalAbsences} faltas${reasonTrimmed ? ` (${reasonTrimmed})` : ''}`
          : `Verificación de inasistencias en fecha ${selectedDateDMY}: ${finalAbsences} faltas${reasonTrimmed ? ` (${reasonTrimmed})` : ''}`;

      const auditEntry: StudentHistoryItem = {
        id: `rec-abs-edit-${student.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        date: selectedDateDMY,
        time,
        term,
        action: auditAction,
        category: 'Sistema',
        pointsChange: 0,
        timestamp: recordTimestamp,
        messageSent: false,
        messageText: '',
        notificationMethod: 'omitted',
        omitNotification: true,
        notifiedAt: 'No enviar',
      };

      updatedHistory = deduplicateHistory([auditEntry, ...updatedHistory]);
      setHistoryList(updatedHistory);
      saveTermDisposition(term, updatedMap, updatedHistory);

      triggerSheetsSync(
        term === '1c' ? updatedMap : dispositionMap,
        updatedHistory,
        term === '2c' ? updatedMap : dispositionMap2c
      );

      api
        .recordDisposition({
          id: auditEntry.id,
          studentId: student.id,
          studentName: studentFullName,
          courseId: activeCourse.id,
          action: auditAction,
          category: 'Sistema',
          term,
          date: selectedDateDMY,
          time,
          timestamp: recordTimestamp,
          messageSent: false,
          messageText: '',
          notificationMethod: 'omitted',
          omitNotification: true,
          notifiedAt: 'No enviar',
          expectedSummary: {
            totalAbsences: finalAbsences,
            totalLates: current.totalLates ?? 0,
            totalDisposition: current.totalDisposition ?? 10,
          },
        })
        .catch(() => {});

      setToastMessage(
        `Faltas actualizadas: ${finalAbsences} para ${student.lastName}, ${student.firstName} (${term === '2c' ? '2°C' : '1°C'}).`
      );
      setTimeout(() => setToastMessage(null), 3500);

      if (moveToNext) {
        const currentIndex = filteredStudents.findIndex((s) => s.id === student.id);
        if (currentIndex !== -1 && currentIndex < filteredStudents.length - 1) {
          const nextStudent = filteredStudents[currentIndex + 1];
          const nextMetrics = getStudentMetrics(nextStudent.id, term);
          setEditingAbsenceStudent(nextStudent);
          setEditingAbsenceCount(String(nextMetrics.totalAbsences));
          return;
        }
      }

      setEditingAbsenceStudent(null);
    } catch (err: any) {
      setToastMessage(`Error al guardar: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setIsSavingAbsenceEdit(false);
    }
  };

  // Reiniciar / Borrar disposición por alumno individual
  const handleResetSingleStudentDisposition = async (
    student: Student,
    clearHistory: boolean = false
  ) => {
    if (!activeCourse || !student) return;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = baseMap[student.id] || {
      totalAbsences: 0,
      totalLates: 0,
      totalDisposition: 10,
    };
    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: 10,
      },
    };

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const studentFullName = `${student.lastName}, ${student.firstName}`;

    let updatedHistory = [...historyList];
    if (clearHistory) {
      const removedIds: string[] = [];
      updatedHistory = updatedHistory.filter((h) => {
        const isTarget =
          h.studentId === student.id &&
          (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id) &&
          (targetTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
          (h.category === 'Disposición' || (h.pointsChange !== undefined && h.pointsChange < 0));
        if (isTarget) {
          removedIds.push(h.id);
          return false;
        }
        return true;
      });
      removedIds.forEach((id) => markHistoryIdDeleted(id));
    }

    const resetEntry: StudentHistoryItem = {
      id: `rec-reset-${student.id}-${timestamp}`,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: clearHistory
        ? `Disposición borrada y restablecida a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`
        : `Puntaje de disposición restablecido a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`,
      category: 'Sistema',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    updatedHistory = deduplicateHistory([resetEntry, ...updatedHistory]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    api
      .resetDisposition({
        studentId: student.id,
        courseId: activeCourse.id,
        resetWhat: 'disposition',
        clearHistory,
      })
      .catch(() => {});

    setToastMessage(
      clearHistory
        ? `Disposición restablecida a 10 para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}). Anotaciones de conducta limpiadas.`
        : `Disposición restablecida a 10 para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`
    );
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Reiniciar puntajes (Inicio de nuevo trimestre o para toda la clase)
  const handleResetCourseDisposition = (clearHistory: boolean = false) => {
    if (!activeCourse) return;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const updated: Record<string, StudentDispositionData> = { ...baseMap };
    courseStudents.forEach((st) => {
      const current = updated[st.id] || {
        totalAbsences: 0,
        totalLates: 0,
        totalDisposition: 10,
      };
      updated[st.id] = {
        ...current,
        totalDisposition: 10,
      };
    });

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();

    let updatedHistory = [...historyList];
    if (clearHistory) {
      const removedIds: string[] = [];
      updatedHistory = updatedHistory.filter((h) => {
        const isTarget =
          h.courseId === activeCourse.id &&
          (targetTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
          (h.category === 'Disposición' || (h.pointsChange !== undefined && h.pointsChange < 0));
        if (isTarget) {
          removedIds.push(h.id);
          return false;
        }
        return true;
      });
      removedIds.forEach((id) => markHistoryIdDeleted(id));
    }

    const resetEntry: StudentHistoryItem = {
      id: `rec-reset-${timestamp}`,
      studentId: 'all',
      studentName: 'Toda la clase',
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: clearHistory
        ? `Reinicio general de disposición a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`
        : `Reinicio general de puntaje de disposición a 10 puntos (${targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'})`,
      category: 'Sistema',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };
    const updatedHistoryDedup = deduplicateHistory([resetEntry, ...updatedHistory]);
    setHistoryList(updatedHistoryDedup);
    saveTermDisposition(targetTerm, updated, updatedHistoryDedup);

    setToastMessage(
      clearHistory
        ? `Disposición restablecida a 10 para todos los estudiantes en ${targetTerm === '2c' ? '2°C' : '1°C'}.`
        : `Puntaje de disposición reiniciado a 10 en ${targetTerm === '2c' ? '2°C' : '1°C'}.`
    );
    setTimeout(() => setToastMessage(null), 3500);

    triggerSheetsSync(
      targetTerm === '1c' ? updated : dispositionMap,
      updatedHistoryDedup,
      targetTerm === '2c' ? updated : dispositionMap2c
    );
    api
      .resetDisposition({ courseId: activeCourse.id, resetWhat: 'disposition', clearHistory })
      .catch(() => {});
  };

  // Mandar la nota de disposición calculada (1 a 10) de todos los alumnos a Calificaciones
  const handleSendDispositionToGrades = (
    targetTermOverride?: '1c' | '2c',
    shouldNavigateToGrades = false
  ) => {
    if (!activeCourse) return;
    const term: '1c' | '2c' = targetTermOverride || activeConcreteTerm;
    const courseId = activeCourse.id;

    const catKey = getUserStorageKey(`fds_grades_categories_${courseId}_${term}`);
    const gradesKey = getUserStorageKey(`fds_grades_data_${courseId}_${term}`);

    let categories: GradeCategory[] = [];
    try {
      const saved =
        localStorage.getItem(catKey) ||
        (term === '1c' ? localStorage.getItem(`fds_grades_categories_${courseId}`) : null);
      if (saved) {
        categories = JSON.parse(saved);
      }
    } catch (_) {}

    if (!Array.isArray(categories) || categories.length === 0) {
      categories =
        term === '2c'
          ? DEFAULT_CATEGORIES.map((cat) => ({
              ...cat,
              id: `c2-${cat.id}`,
              subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
            }))
          : DEFAULT_CATEGORIES.map((cat) => ({
              ...cat,
              subcategories: cat.subcategories.map((sub) => ({ ...sub })),
            }));
    }

    let targetSubId: string | null = null;

    for (const cat of categories) {
      const foundSub = cat.subcategories?.find((s) => {
        const lower = s.name.toLowerCase();
        return (
          lower.includes('disposición') ||
          lower.includes('disposicion') ||
          lower.includes('conducta')
        );
      });
      if (foundSub) {
        targetSubId = foundSub.id;
        break;
      }
    }

    if (!targetSubId) {
      let parentCat = categories.find((c) => {
        const lower = c.name.toLowerCase();
        return (
          lower.includes('desempeño') ||
          lower.includes('desempeno') ||
          lower.includes('participación') ||
          lower.includes('participacion') ||
          lower.includes('tareas')
        );
      });

      if (!parentCat && categories.length > 0) {
        parentCat = categories[categories.length - 1];
      }

      const newSubId = `sub-disp-${term}-${Date.now()}`;
      const newSub: GradeSubcategory = {
        id: newSubId,
        name: 'Nota de Disposición',
        maxScore: 10,
        date: new Date().toLocaleDateString('es-AR'),
      };

      if (parentCat) {
        if (!parentCat.subcategories) parentCat.subcategories = [];
        parentCat.subcategories.push(newSub);
      } else {
        const newCat: GradeCategory = {
          id: `cat-disp-${term}-${Date.now()}`,
          name: 'Desempeño y Conducta',
          color: 'bg-purple-500',
          subcategories: [newSub],
        };
        categories.push(newCat);
      }
      targetSubId = newSubId;

      if (typeof window !== 'undefined') {
        localStorage.setItem(catKey, JSON.stringify(categories));
        if (term === '1c') {
          localStorage.setItem(`fds_grades_categories_${courseId}`, JSON.stringify(categories));
        }
      }
    }

    let gradesMap: StudentGradesMap = {};
    try {
      const savedGrades =
        localStorage.getItem(gradesKey) ||
        (term === '1c' ? localStorage.getItem(`fds_grades_data_${courseId}`) : null);
      if (savedGrades) {
        gradesMap = JSON.parse(savedGrades);
      }
    } catch (_) {}

    let transferredCount = 0;
    courseStudents.forEach((st) => {
      const metrics = getStudentMetrics(st.id, term);
      const score = String(metrics.totalDisposition);
      if (!gradesMap[st.id]) {
        gradesMap[st.id] = {};
      }
      gradesMap[st.id][targetSubId!] = score;
      transferredCount++;
    });

    if (typeof window !== 'undefined') {
      localStorage.setItem(gradesKey, JSON.stringify(gradesMap));
      if (term === '1c') {
        localStorage.setItem(`fds_grades_data_${courseId}`, JSON.stringify(gradesMap));
      }
      localStorage.setItem(`fds_grades_active_term_${courseId}`, term);
      window.dispatchEvent(
        new CustomEvent('fds-grades-updated', {
          detail: { term, courseId },
        })
      );
    }

    const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const gradesEntry: StudentHistoryItem = {
      id: `rec-grades-${timestamp}`,
      studentId: 'all',
      studentName: 'Toda la clase',
      courseId: activeCourse.id,
      term,
      date,
      time,
      action: `Notas de disposición enviadas a Calificaciones (${termLabel})`,
      category: 'Calificación',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };
    const updatedHistory = deduplicateHistory([gradesEntry, ...historyList]);
    setHistoryList(updatedHistory);

    triggerSheetsSync(
      term === '1c' ? dispositionMap : undefined,
      updatedHistory,
      term === '2c' ? dispositionMap2c : undefined
    );

    sheetsService
      .syncGradebookMatrixToSheet(
        activeCourse,
        term,
        courseStudents,
        categories,
        gradesMap,
        sheetConfig?.spreadsheetId || activeCourse.gradesSheetId,
        activeCourse.gradesFolderId,
        token || getCachedAccessToken() || undefined
      )
      .catch((err) => {
        console.warn('Could not auto-sync gradebook matrix to Google Sheets:', err);
      });

    const currentUserId = getActiveUserId();
    if (currentUserId) {
      firestoreSync
        .saveTermSnapshot(currentUserId, courseId, term, {
          courseId,
          term,
          termLabel,
          categories,
          gradesMap,
          dispositionMap: term === '2c' ? dispositionMap2c : dispositionMap,
          transferredCount,
          date,
          time,
        })
        .catch(() => {});
    }

    api
      .recordDisposition({
        id: gradesEntry.id,
        studentId: 'all',
        studentName: 'Toda la clase',
        courseId: activeCourse.id,
        term,
        action: gradesEntry.action,
        category: 'Calificación',
        date,
        time,
        timestamp,
      })
      .catch(() => {});

    setToastMessage(
      `✓ ¡Notas de disposición vinculadas en Calificaciones (${termLabel}) y sincronizadas con Google Sheets!`
    );
    setTimeout(() => setToastMessage(null), 5000);

    setIsSendDispositionModalOpen(false);

    if (shouldNavigateToGrades) {
      setActiveTab('grades');
    }
  };

  return {
    editingDispositionStudent,
    setEditingDispositionStudent,
    editingDispositionScore,
    setEditingDispositionScore,
    editingDispositionTerm,
    setEditingDispositionTerm,
    editingDispositionReason,
    setEditingDispositionReason,
    editingAbsenceStudent,
    setEditingAbsenceStudent,
    editingAbsenceCount,
    setEditingAbsenceCount,
    editingAbsenceTerm,
    setEditingAbsenceTerm,
    editingAbsenceDate,
    setEditingAbsenceDate,
    editingAbsenceReason,
    setEditingAbsenceReason,
    editingAbsenceSendNotif,
    setEditingAbsenceSendNotif,
    editingAbsenceChannel,
    setEditingAbsenceChannel,
    editingAbsenceMessageText,
    setEditingAbsenceMessageText,
    isSavingAbsenceEdit,
    isSendDispositionModalOpen,
    setIsSendDispositionModalOpen,
    handleOpenEditDisposition,
    handleChangeEditingTerm,
    handleNavigateEditStudent,
    handleSaveStudentDisposition,
    handleOpenEditAbsences,
    handleChangeEditingAbsenceTerm,
    handleNavigateEditAbsenceStudent,
    handleSaveStudentAbsences,
    handleResetSingleStudentDisposition,
    handleResetCourseDisposition,
    handleSendDispositionToGrades,
  };
}
