import React, { useState, useMemo } from 'react';
import {
  Course,
  Student,
  StudentHistoryItem,
  StudentDispositionData,
  AbsenceNotificationSettings,
  AbsencePresetTemplate,
  StudentObservation,
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
  setUserScopedItem,
  saveAllDispositionStorage,
  markHistoryIdDeleted,
} from '../services/api';
import { classroomService } from '../services/workspace/classroomService';
import { gmailService } from '../services/workspace/gmailService';
import { getCachedAccessToken } from '../services/workspace/googleAuth';
import { sheetsService } from '../services/workspace/sheetsService';
import { driveService, CourseFolderStructure } from '../services/workspace/driveService';
import { isSameCalendarDay, formatLocalDateDMY, formatLocalTimeHMS } from '../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { enqueueOfflineAction } from '../services/offlineSyncQueue';
import { exportCourseClassHistoryToExcel } from '../utils/excelExport';
import {
  DEFAULT_ABSENCE_PRESETS,
  DEFAULT_CONDUCT_PRESETS,
} from './useCourseNotifications';
import { buildStudentTrackingDocHtml as buildModularStudentTrackingDocHtml } from '../utils/studentTrackingDocHtml';

interface UseCourseAttendanceAndDispositionActionsProps {
  activeCourse: Course;
  students: Student[];
  courseStudents: Student[];
  filteredStudents: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  setDispositionMap: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  setDispositionMap2c: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  historyList: StudentHistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<StudentHistoryItem[]>>;
  courseHistory: StudentHistoryItem[];
  attendanceTerm: '1c' | '2c' | 'annual';
  activeConcreteTerm: '1c' | '2c';
  notifSettings: AbsenceNotificationSettings;
  savedPresets: AbsencePresetTemplate[];
  batchAbsenceModal: any;
  setBatchAbsenceModal: React.Dispatch<React.SetStateAction<any>>;
  setAbsenceNotifModal: React.Dispatch<React.SetStateAction<any>>;
  formatTemplateForStudent: (
    template: string,
    student: { firstName: string; lastName: string; id: string },
    courseName: string,
    dispositionScore: number,
    dateStr?: string,
    reason?: string,
    pointsDelta?: number
  ) => string;
  getTemplateForReason: (reason: string, fallbackType?: 'positive' | 'negative') => string;
  handleAddConductOption: (optToAdd?: string) => void;
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
  courseDriveStructure: CourseFolderStructure | null;
  setCourseDriveStructure: React.Dispatch<React.SetStateAction<CourseFolderStructure | null>>;
  token: string | null;
  onRefreshData?: () => void;
  setActiveTab: React.Dispatch<
    React.SetStateAction<'roster' | 'libro_temas' | 'grades' | 'history'>
  >;
  setToastMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setCourseReportModalStudentId: React.Dispatch<React.SetStateAction<string>>;
  setCourseReportModalTab: React.Dispatch<React.SetStateAction<'course' | 'individual'>>;
  setCourseReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  studentObservationsProps: {
    selectedStudentForProfile: Student | null;
    setSelectedStudentForProfile: React.Dispatch<React.SetStateAction<Student | null>>;
    editedStudentEmail: string;
    setIsEditingStudentEmail: React.Dispatch<React.SetStateAction<boolean>>;
    newObservationText: string;
    setNewObservationText: React.Dispatch<React.SetStateAction<string>>;
    newObservationUrl: string;
    setNewObservationUrl: React.Dispatch<React.SetStateAction<string>>;
    studentObservations: Record<string, StudentObservation[]>;
    setStudentObservations: React.Dispatch<
      React.SetStateAction<Record<string, StudentObservation[]>>
    >;
    profileDocTitle: string;
    setProfileDocTitle: React.Dispatch<React.SetStateAction<string>>;
    profileDocLinkToObs: boolean;
    setShowProfileDocConfirm: React.Dispatch<React.SetStateAction<boolean>>;
    setIsExportingProfileDoc: React.Dispatch<React.SetStateAction<boolean>>;
    setExportedProfileDoc: React.Dispatch<React.SetStateAction<any>>;
    setProfileDocError: React.Dispatch<React.SetStateAction<string | null>>;
  };
}

export function useCourseAttendanceAndDispositionActions({
  activeCourse,
  students,
  courseStudents,
  filteredStudents,
  dispositionMap,
  setDispositionMap,
  dispositionMap2c,
  historyList,
  setHistoryList,
  courseHistory,
  attendanceTerm,
  activeConcreteTerm,
  notifSettings,
  savedPresets,
  batchAbsenceModal,
  setBatchAbsenceModal,
  setAbsenceNotifModal,
  formatTemplateForStudent,
  getTemplateForReason,
  handleAddConductOption,
  getStudentMetrics,
  saveTermDisposition,
  deduplicateHistory,
  triggerSheetsSync,
  sheetConfig,
  courseDriveStructure,
  setCourseDriveStructure,
  token,
  onRefreshData,
  setActiveTab,
  setToastMessage,
  setCourseReportModalStudentId,
  setCourseReportModalTab,
  setCourseReportModalOpen,
  studentObservationsProps,
}: UseCourseAttendanceAndDispositionActionsProps) {
  const {
    selectedStudentForProfile,
    setSelectedStudentForProfile,
    editedStudentEmail,
    setIsEditingStudentEmail,
    newObservationText,
    setNewObservationText,
    newObservationUrl,
    setNewObservationUrl,
    studentObservations,
    setStudentObservations,
    profileDocTitle,
    setProfileDocTitle,
    profileDocLinkToObs,
    setShowProfileDocConfirm,
    setIsExportingProfileDoc,
    setExportedProfileDoc,
    setProfileDocError,
  } = studentObservationsProps;

  // Batch selection of students for notification at the end of class
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedPendingHistoryIds, setSelectedPendingHistoryIds] = useState<string[]>([]);

  // Pending absence items for current course (without sent notification)
  const pendingAbsenceItems = useMemo(() => {
    if (!activeCourse) return [];
    return historyList.filter(
      (h) =>
        h.courseId === activeCourse.id &&
        (h.category === 'Ausencia' || h.action === 'Ausencia') &&
        h.category !== 'Sistema' &&
        !h.action?.toLowerCase().includes('actualizada') &&
        !h.action?.toLowerCase().includes('verificación') &&
        !h.action?.toLowerCase().includes('ajuste') &&
        !h.messageSent &&
        !h.omitNotification &&
        h.notificationMethod !== 'omitted' &&
        h.notificationMethod !== 'none' &&
        h.notifiedAt !== 'No enviar' &&
        h.notifiedAt !== 'Omitido'
    );
  }, [historyList, activeCourse?.id]);

  // Pending conduct items for current course (without sent notification)
  const pendingConductItems = useMemo(() => {
    if (!activeCourse) return [];
    return historyList.filter(
      (h) =>
        h.courseId === activeCourse.id &&
        h.category === 'Disposición' &&
        !h.action?.toLowerCase().includes('actualizada') &&
        !h.action?.toLowerCase().includes('verificación') &&
        !h.action?.toLowerCase().includes('ajuste') &&
        !h.messageSent &&
        !h.omitNotification &&
        h.notificationMethod !== 'omitted' &&
        h.notificationMethod !== 'none' &&
        h.notifiedAt !== 'No enviar' &&
        h.notifiedAt !== 'Omitido'
    );
  }, [historyList, activeCourse?.id]);

  // All pending notification items for current course (both absences and conduct records)
  const pendingAllItems = useMemo(() => {
    return [...pendingAbsenceItems, ...pendingConductItems];
  }, [pendingAbsenceItems, pendingConductItems]);

  // Modal to record conduct for a specific student (sumar o restar puntos)
  const [conductRecordModal, setConductRecordModal] = useState<{
    isOpen: boolean;
    student: Student | null;
    mode: 'subtract' | 'add';
    points: number;
    customReason: string;
    saveToOptions: boolean;
  }>({
    isOpen: false,
    student: null,
    mode: 'subtract',
    points: 1,
    customReason: '',
    saveToOptions: false,
  });

  // Modal para ver el historial individual de un alumno
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<Student | null>(null);

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

  // Animation tracking for instant button feedback (like unchecking in the script)
  const [pulsingStudentId, setPulsingStudentId] = useState<string | null>(null);

  // -------------------------------------------------------------
  // LÓGICA DE REGISTRO IDÉNTICA AL SCRIPT DE GOOGLE SHEETS
  // -------------------------------------------------------------

  // Helper to send notification (Classroom announcement or Gmail) and update sheet / history
  const sendNotificationForItem = async (
    historyItem: StudentHistoryItem,
    student: Student,
    channel: 'classroom' | 'gmail',
    messageText: string
  ) => {
    let success = false;
    let notifMessage = '';

    if (channel === 'classroom') {
      const classroomCourseId = activeCourse.classroomCourseId || activeCourse.id;
      const res = await classroomService.createIndividualAnnouncement(
        classroomCourseId,
        student.id,
        messageText
      );
      success = res.success;
      notifMessage =
        res.message ||
        (res.success ? 'Aviso publicado en el tablón del estudiante' : 'Error en Classroom');
    } else {
      const subject =
        historyItem.category === 'Disposición'
          ? `Aviso de Conducta / Disposición - ${activeCourse.name}`
          : `Notificación de Inasistencia - ${activeCourse.name}`;
      const res = await gmailService.sendEmail(student.email || '', subject, messageText);
      success = res.success;
      notifMessage = res.message || (res.success ? 'Correo enviado' : 'Error en Gmail');
    }

    const now = new Date();
    const notifiedAt = now.toLocaleTimeString();

    const updatedHistory = historyList.map((item) => {
      if (item.id === historyItem.id) {
        return {
          ...item,
          messageSent: true,
          messageText,
          notificationMethod: channel,
          notifiedAt,
        };
      }
      return item;
    });

    setHistoryList(updatedHistory);
    triggerSheetsSync(dispositionMap, updatedHistory);

    api
      .updateDispositionHistoryNotification(historyItem.id, {
        messageSent: true,
        messageText,
        notificationMethod: channel,
        notifiedAt,
      })
      .catch(() => {});

    setToastMessage(
      success
        ? `Notificación enviada a ${student.firstName} (${channel === 'classroom' ? 'Tablón Classroom' : 'Correo Gmail'})`
        : `Aviso registrado en la planilla: ${notifMessage}`
    );
    setTimeout(() => setToastMessage(null), 4000);
  };

  // 1. LÓGICA PARA AUSENCIAS (Columna B / número 2 del script + si tenía llegada tarde hoy, la reemplaza atómicamente)
  const handleAddAbsence = async (student: Student) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const id = `rec-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;

    setPulsingStudentId(`abs-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const current = getStudentMetrics(student.id, targetTerm);

    const isTodayLate = (h: StudentHistoryItem) => {
      if (h.studentId !== student.id) return false;
      if (activeCourse?.id && h.courseId && h.courseId !== activeCourse.id) return false;
      const isLate =
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza');
      if (!isLate) return false;
      return isSameCalendarDay(h.date, h.timestamp, now) || !h.date;
    };

    const todayLatesToRemove: StudentHistoryItem[] = [];
    const cleanHistory = historyList.filter((h) => {
      if (isTodayLate(h)) {
        todayLatesToRemove.push(h);
        return false;
      }
      return true;
    });

    if (todayLatesToRemove.length > 0) {
      todayLatesToRemove.forEach((l) => markHistoryIdDeleted(l.id));
    }

    const alreadyAbsentToday = cleanHistory.some(
      (h) =>
        h.studentId === student.id &&
        (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id) &&
        (targetTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
        (h.category === 'Ausencia' ||
          h.action === 'Ausencia' ||
          h.action?.toLowerCase().includes('ausencia') ||
          h.action?.toLowerCase().includes('falta')) &&
        h.category !== 'Sistema' &&
        isSameCalendarDay(h.date, h.timestamp, now)
    );

    if (alreadyAbsentToday) {
      setToastMessage(
        `${student.lastName}, ${student.firstName} ya figura ausente el día de hoy (${date}) en ${activeCourse.name}.`
      );
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const newAbsences = current.totalAbsences + 1;
    const newLates =
      todayLatesToRemove.length > 0
        ? Math.max(0, (current.totalLates || 0) - todayLatesToRemove.length)
        : current.totalLates || 0;
    const newDisposition = current.totalDisposition;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalAbsences: newAbsences,
        totalLates: newLates,
        totalDisposition: newDisposition,
      },
    };

    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: 'Ausencia',
      category: 'Ausencia',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: notifSettings.channel || 'classroom',
      omitNotification: false,
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...cleanHistory]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    setToastMessage(
      `Ausencia registrada para ${student.firstName} ${student.lastName} (+1 Falta en ${targetTerm === '2c' ? '2°C' : '1°C'})`
    );
    setTimeout(() => setToastMessage(null), 3500);

    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    if (todayLatesToRemove.length > 0) {
      for (const item of todayLatesToRemove) {
        api.deleteDispositionHistory(item.id).catch(() => {});
      }
      const userId = getActiveUserId();
      if (userId) {
        firestoreSync.deleteTodayLatesForStudent(userId, student.id, now).catch(() => {});
      }
    }

    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: 'Ausencia',
        category: 'Ausencia',
        term: targetTerm,
        date,
        time,
        timestamp,
        messageSent: false,
        messageText: '',
        notificationMethod: notifSettings.channel || 'classroom',
        omitNotification: false,
        expectedSummary: {
          totalAbsences: newAbsences,
          totalLates: newLates,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});

    if (notifSettings.autoNotify) {
      const activePreset =
        savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];
      const channelToUse =
        activePreset.channel !== 'any'
          ? activePreset.channel
          : notifSettings.channel || 'classroom';
      const personalizedMessage = formatTemplateForStudent(
        activePreset.text,
        student,
        activeCourse.name,
        newDisposition,
        date
      );
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
    }
  };

  // Helper to obtain the personalized message for an item in batch mode
  const getBatchMessageForItem = (
    item: { historyItem: StudentHistoryItem; student: Student },
    modalState: typeof batchAbsenceModal
  ): string => {
    if (
      modalState.customPerItemMessages &&
      modalState.customPerItemMessages[item.historyItem.id]
    ) {
      return modalState.customPerItemMessages[item.historyItem.id];
    }

    const curDisp = dispositionMap[item.student.id]?.totalDisposition ?? 10;
    const isConduct = item.historyItem.category === 'Disposición';

    if (modalState.useSmartTemplates) {
      if (isConduct) {
        const specificTpl = getTemplateForReason(item.historyItem.action);
        return formatTemplateForStudent(
          specificTpl,
          item.student,
          activeCourse?.name || '',
          curDisp,
          item.historyItem.date || '',
          item.historyItem.action
        );
      } else {
        const defaultAbsenceTpl =
          savedPresets.find((p) => p.category === 'Ausencia' && p.isDefault)?.text ||
          notifSettings.templateClassroom ||
          DEFAULT_ABSENCE_PRESETS[0].text;
        return formatTemplateForStudent(
          defaultAbsenceTpl,
          item.student,
          activeCourse?.name || '',
          curDisp,
          item.historyItem.date || ''
        );
      }
    }

    return formatTemplateForStudent(
      modalState.rawTemplateText,
      item.student,
      activeCourse?.name || '',
      curDisp,
      item.historyItem.date || '',
      item.historyItem.action
    );
  };

  // Batch actions for deferred notifications (Absences and Conduct)
  const handleOpenBatchFromPending = (filterType: 'all' | 'absences' | 'conduct' = 'all') => {
    if (!activeCourse) return;
    let targetItems: StudentHistoryItem[] = [];
    if (filterType === 'absences') {
      targetItems = pendingAbsenceItems;
    } else if (filterType === 'conduct') {
      targetItems = pendingConductItems;
    } else {
      targetItems = pendingAllItems;
    }

    const items = targetItems
      .map((h) => {
        const student =
          students.find((s) => s.id === h.studentId) ||
          courseStudents.find((s) => s.id === h.studentId) ||
          ({
            id: h.studentId,
            firstName: h.studentName?.split(' ')[0] || h.studentName,
            lastName: h.studentName?.split(' ').slice(1).join(' ') || '',
            email: '',
            courseId: activeCourse.id,
          } as Student);
        return { historyItem: h, student };
      })
      .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];

    if (items.length === 0) {
      setToastMessage('No hay avisos pendientes de notificación para este curso.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const defaultPreset =
      savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleOpenBatchFromSelectedStudents = () => {
    if (!activeCourse || selectedStudentIds.length === 0) return;

    const items: { historyItem: StudentHistoryItem; student: Student }[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const updatedMap = { ...dispositionMap };
    const newHistoryEntries: StudentHistoryItem[] = [];

    selectedStudentIds.forEach((studentId) => {
      const student = students.find((s) => s.id === studentId);
      if (!student) return;

      const existingPending = historyList.find(
        (h) =>
          h.courseId === activeCourse.id &&
          h.studentId === student.id &&
          h.category === 'Ausencia' &&
          !h.messageSent
      );

      if (existingPending) {
        items.push({ historyItem: existingPending, student });
      } else {
        const current = updatedMap[student.id] || { totalAbsences: 0, totalDisposition: 10 };
        const newDisposition = current.totalDisposition;
        updatedMap[student.id] = {
          ...current,
          totalAbsences: current.totalAbsences + 1,
          totalDisposition: newDisposition,
        };

        const id = `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const newHistory: StudentHistoryItem = {
          id,
          studentId: student.id,
          studentName: `${student.lastName}, ${student.firstName}`,
          courseId: activeCourse.id,
          date,
          time,
          action: 'Ausencia',
          category: 'Ausencia',
          pointsChange: 0,
          timestamp: Date.now(),
          messageSent: false,
          messageText: '',
          notificationMethod: 'none',
        };
        newHistoryEntries.push(newHistory);
        items.push({ historyItem: newHistory, student });

        api.recordDisposition(newHistory).catch(() => {});
      }
    });

    if (newHistoryEntries.length > 0) {
      const mergedHistory = deduplicateHistory([...newHistoryEntries, ...historyList]);
      setHistoryList(mergedHistory);
      setDispositionMap(updatedMap);
      triggerSheetsSync(updatedMap, mergedHistory);
    }

    const defaultPreset =
      savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleOpenBatchFromSelectedHistory = () => {
    if (!activeCourse || selectedPendingHistoryIds.length === 0) return;
    const items = selectedPendingHistoryIds
      .map((id) => {
        const h = historyList.find((item) => item.id === id);
        if (!h) return null;
        const student =
          students.find((s) => s.id === h.studentId) ||
          courseStudents.find((s) => s.id === h.studentId) ||
          ({
            id: h.studentId,
            firstName: h.studentName?.split(' ')[0] || h.studentName,
            lastName: h.studentName?.split(' ').slice(1).join(' ') || '',
            email: '',
            courseId: activeCourse.id,
          } as Student);
        return { historyItem: h, student };
      })
      .filter(Boolean) as { historyItem: StudentHistoryItem; student: Student }[];

    if (items.length === 0) return;

    const defaultPreset =
      savedPresets.find((p) => p.isDefault) || savedPresets[0] || DEFAULT_ABSENCE_PRESETS[0];

    setBatchAbsenceModal({
      isOpen: true,
      selectedItems: items,
      channel: notifSettings.channel,
      selectedPresetId: defaultPreset.id,
      rawTemplateText: defaultPreset.text,
      previewStudentIndex: 0,
      previewStudentId: items[0]?.historyItem.id,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: items.length,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });
  };

  const handleSendBatchNotifications = async () => {
    if (batchAbsenceModal.selectedItems.length === 0) return;
    setBatchAbsenceModal((prev: any) => ({ ...prev, isSending: true }));

    const channel = batchAbsenceModal.channel;
    const total = batchAbsenceModal.selectedItems.length;
    let sentCount = 0;

    const updatedHistoryItems: StudentHistoryItem[] = [...historyList];

    for (let i = 0; i < total; i++) {
      const item = batchAbsenceModal.selectedItems[i];
      const student = item.student;
      const historyItem = item.historyItem;

      setBatchAbsenceModal((prev: any) => ({
        ...prev,
        isSending: true,
        currentSendingStudentName: `${student.firstName} ${student.lastName}`,
        progress: i + 1,
        total,
        sendProgress: {
          current: i + 1,
          total,
          currentStudentName: `${student.firstName} ${student.lastName}`,
        },
      }));

      const personalizedMessage = getBatchMessageForItem(item, batchAbsenceModal);
      const isConduct = historyItem.category === 'Disposición';
      const emailSubject = isConduct
        ? `Notificación de Conducta / Disposición - ${activeCourse.name}`
        : `Notificación de Inasistencia - ${activeCourse.name}`;

      if (channel === 'classroom') {
        const classroomCourseId = activeCourse.classroomCourseId || activeCourse.id;
        await classroomService.createIndividualAnnouncement(
          classroomCourseId,
          student.id,
          personalizedMessage
        );
      } else {
        await gmailService.sendEmail(student.email || '', emailSubject, personalizedMessage);
      }

      const now = new Date();
      const notifiedAt = now.toLocaleTimeString();

      const idx = updatedHistoryItems.findIndex((h) => h.id === historyItem.id);
      if (idx !== -1) {
        updatedHistoryItems[idx] = {
          ...updatedHistoryItems[idx],
          messageSent: true,
          messageText: personalizedMessage,
          notificationMethod: channel,
          notifiedAt,
        };
      }

      api
        .updateDispositionHistoryNotification(historyItem.id, {
          messageSent: true,
          messageText: personalizedMessage,
          notificationMethod: channel,
          notifiedAt,
        })
        .catch(() => {});

      sentCount++;
    }

    setHistoryList(updatedHistoryItems);
    triggerSheetsSync(dispositionMap, updatedHistoryItems);

    setBatchAbsenceModal({
      isOpen: false,
      selectedItems: [],
      channel: 'classroom',
      selectedPresetId: 'preset-standard',
      rawTemplateText: '',
      previewStudentIndex: 0,
      previewStudentId: '',
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
      currentSendingStudentName: '',
      progress: 0,
      total: 0,
      sendProgress: null,
      useSmartTemplates: true,
      customPerItemMessages: {},
    });

    setSelectedStudentIds([]);
    setSelectedPendingHistoryIds([]);

    setToastMessage(
      `¡Listo! Se enviaron ${sentCount} avisos por ${channel === 'classroom' ? 'Classroom' : 'Gmail'} y se registraron en Google Sheets.`
    );
    setTimeout(() => setToastMessage(null), 5000);
  };

  const toggleSelectStudent = (studentId: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleSelectAllStudents = () => {
    if (selectedStudentIds.length === filteredStudents.length && filteredStudents.length > 0) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(filteredStudents.map((s) => s.id));
    }
  };

  const toggleSelectPendingHistory = (historyId: string) => {
    setSelectedPendingHistoryIds((prev) =>
      prev.includes(historyId) ? prev.filter((id) => id !== historyId) : [...prev, historyId]
    );
  };

  const toggleSelectAllPendingHistory = () => {
    const pendingIds = courseHistory
      .filter(
        (item) =>
          (item.category === 'Ausencia' || item.category === 'Disposición') &&
          !item.messageSent &&
          !item.omitNotification &&
          item.notificationMethod !== 'omitted'
      )
      .map((item) => item.id);
    if (selectedPendingHistoryIds.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedPendingHistoryIds([]);
    } else {
      setSelectedPendingHistoryIds(pendingIds);
    }
  };

  // Marcar aviso como "No mandar" (sale de los pendientes pero queda en el historial docente)
  const handleMarkOmitNotification = (item: StudentHistoryItem) => {
    const updatedHistory = historyList.map((h) => {
      if (h.id === item.id) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    setSelectedPendingHistoryIds((prev) => prev.filter((id) => id !== item.id));

    triggerSheetsSync(dispositionMap, updatedHistory, dispositionMap2c);

    api
      .recordDisposition({
        id: item.id,
        studentId: item.studentId,
        studentName: item.studentName,
        courseId: activeCourse.id,
        action: item.action,
        category: item.category,
        date: item.date,
        time: item.time,
        timestamp: item.timestamp,
        messageSent: false,
        notificationMethod: 'omitted',
        omitNotification: true,
        notifiedAt: 'No enviar',
      })
      .catch(() => {});

    setToastMessage(
      `Aviso marcado como "No mandar" para ${item.studentName}. Permanece registrado en tu historial docente.`
    );
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Marcar selección como "No mandar" en lote
  const handleBatchMarkOmitNotification = () => {
    if (selectedPendingHistoryIds.length === 0) return;
    const idsSet = new Set(selectedPendingHistoryIds);
    const updatedHistory = historyList.map((h) => {
      if (idsSet.has(h.id)) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    const count = selectedPendingHistoryIds.length;
    setSelectedPendingHistoryIds([]);

    setToastMessage(
      `${count} aviso${count > 1 ? 's' : ''} marcado${count > 1 ? 's' : ''} como "No mandar". Permanecen intactos en tu historial docente.`
    );
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Descartar todos los pendientes a la vez (salen de pendientes pero quedan en historial)
  const handleMarkAllPendingAsOmitted = () => {
    if (pendingAllItems.length === 0) return;
    const pendingIdsSet = new Set(pendingAllItems.map((p) => p.id));
    const updatedHistory = historyList.map((h) => {
      if (pendingIdsSet.has(h.id)) {
        return {
          ...h,
          omitNotification: true,
          notificationMethod: 'omitted' as const,
          messageSent: false,
          notifiedAt: 'Omitido',
        };
      }
      return h;
    });

    setHistoryList(updatedHistory);
    saveAllDispositionStorage(dispositionMap, updatedHistory);
    setSelectedPendingHistoryIds([]);
    const count = pendingAllItems.length;

    setToastMessage(
      `${count} aviso${count > 1 ? 's' : ''} marcado${count > 1 ? 's' : ''} como "No mandar". Todos quedan registrados en tu historial docente.`
    );
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 2. LÓGICA PARA DISPOSICIÓN (Resta o suma puntos del total y registra en historial)
  const handleRecordDispositionAction = async (
    student: Student,
    actionName: string,
    detailText?: string,
    explicitPointsDelta?: number
  ) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const timestamp = Date.now();
    const id = `rec-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;

    const isActionPositive =
      actionName.startsWith('+') ||
      actionName.startsWith('[+]') ||
      actionName.includes('(+') ||
      /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
        actionName
      );

    const delta =
      explicitPointsDelta !== undefined ? explicitPointsDelta : isActionPositive ? 1 : -1;

    const cleanAction = actionName.replace(/^(\+|\[\+\])\s*/, '');

    let finalAction = cleanAction;
    if (detailText && detailText.trim()) {
      finalAction = detailText.trim();
    } else if (actionName === 'Otros' && detailText) {
      finalAction =
        detailText.trim() || (delta > 0 ? 'Reconocimiento destacado' : 'Conducta no especificada');
    }

    setPulsingStudentId(`disp-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const targetTerm: '1c' | '2c' = activeConcreteTerm;
    const current = getStudentMetrics(student.id, targetTerm);
    const currentDisp = current.totalDisposition !== undefined ? current.totalDisposition : 10;
    const newDisposition = Math.min(10, Math.max(0, currentDisp + delta));
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalDisposition: newDisposition,
      },
    };

    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: finalAction,
      category: 'Disposición',
      pointsChange: delta,
      previousDisposition: currentDisp,
      resultingDisposition: newDisposition,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'none',
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...historyList]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const typeStr = delta > 0 ? 'Reconocimiento registrado' : 'Conducta registrada';
    setToastMessage(
      `${typeStr} para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}: ${finalAction} (${deltaStr} pto | ${currentDisp} → ${newDisposition} pts)`
    );
    setTimeout(() => setToastMessage(null), 3500);

    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: finalAction,
        category: 'Disposición',
        detail: detailText,
        date,
        time,
        timestamp,
        expectedSummary: {
          totalAbsences: current.totalAbsences,
          totalLates: current.totalLates || 0,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});

    const specificReasonTemplate = getTemplateForReason(
      finalAction,
      delta > 0 ? 'positive' : 'negative'
    );
    const activeConductPreset =
      savedPresets.find((p) => p.category === 'Disposición' && p.isDefault) ||
      savedPresets.find((p) => p.category === 'Disposición') ||
      DEFAULT_CONDUCT_PRESETS[0];

    const channelToUse =
      activeConductPreset.channel !== 'any' ? activeConductPreset.channel : notifSettings.channel;
    const personalizedMessage = formatTemplateForStudent(
      specificReasonTemplate,
      student,
      activeCourse.name,
      newDisposition,
      date,
      finalAction,
      delta
    );

    if (notifSettings.autoNotify) {
      sendNotificationForItem(newHistoryEntry, student, channelToUse, personalizedMessage);
    }
  };

  // 3. Confirmación desde modal de registrar conducta (suma o resta de puntos)
  const handleConfirmConductRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!conductRecordModal.student) return;

    const reason = conductRecordModal.customReason.trim();
    if (!reason) return;

    const isAdd = conductRecordModal.mode === 'add';
    const pts = Math.abs(conductRecordModal.points || 1);
    const delta = isAdd ? pts : -pts;

    if (conductRecordModal.saveToOptions) {
      const optionToSave = isAdd ? `+ ${reason}` : reason;
      handleAddConductOption(optionToSave);
    }

    handleRecordDispositionAction(conductRecordModal.student, reason, undefined, delta);
    setConductRecordModal({
      isOpen: false,
      student: null,
      mode: 'subtract',
      points: 1,
      customReason: '',
      saveToOptions: false,
    });
  };

  // 4. Eliminar entrada errónea del historial (revierte el punto sacado, o quita la ausencia o tardanza)
  const handleDeleteHistoryEntry = async (item: StudentHistoryItem) => {
    markHistoryIdDeleted(item.id);

    const isAbsence =
      item.category === 'Ausencia' ||
      item.action === 'Ausencia' ||
      item.action?.toLowerCase().includes('ausencia') ||
      item.action?.toLowerCase().includes('falta');

    const isLate =
      item.category === 'Llegada tarde' ||
      item.action === 'Llegada tarde' ||
      item.action?.toLowerCase().includes('llegada tarde') ||
      item.action?.toLowerCase().includes('tardanza') ||
      item.action?.toLowerCase().includes('tarde');

    let pointsToReturn = 0;
    if (item.pointsChange !== undefined) {
      pointsToReturn = -item.pointsChange;
    } else if (
      item.previousDisposition !== undefined &&
      item.resultingDisposition !== undefined
    ) {
      pointsToReturn = item.previousDisposition - item.resultingDisposition;
    } else if (
      item.category === 'Disposición' ||
      (!isAbsence && !isLate && item.category !== 'Sistema' && item.category !== 'Calificación')
    ) {
      pointsToReturn = 1;
    }

    const updatedHistory = historyList.filter((h) => h.id !== item.id);
    setHistoryList(updatedHistory);

    const itemTerm: '1c' | '2c' = item.term === '2c' ? '2c' : '1c';
    const is2cItem = itemTerm === '2c';

    const targetCourseId = item.courseId || activeCourse?.id;
    const studentRemainingHistory = updatedHistory.filter(
      (h) =>
        h.studentId === item.studentId &&
        (!targetCourseId || !h.courseId || h.courseId === targetCourseId) &&
        (is2cItem ? h.term === '2c' : h.term === '1c' || !h.term)
    );
    const newAbsences = studentRemainingHistory.filter(
      (h) =>
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta')
    ).length;

    const newLates = studentRemainingHistory.filter(
      (h) =>
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza')
    ).length;

    let calculatedDisp = 10;
    const sortedStudentEvents = [...studentRemainingHistory].sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    );
    for (const ev of sortedStudentEvents) {
      const isReset =
        ev.category === 'Sistema' ||
        ev.action?.toLowerCase().includes('restablecid') ||
        ev.action?.toLowerCase().includes('reinicio');
      if (isReset) {
        calculatedDisp = 10;
        continue;
      }
      if (ev.pointsChange !== undefined) {
        calculatedDisp = Math.min(10, Math.max(0, calculatedDisp + ev.pointsChange));
      } else if (ev.category === 'Disposición') {
        calculatedDisp = Math.max(0, calculatedDisp - 1);
      }
    }

    const baseMap = itemTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = getStudentMetrics(item.studentId, itemTerm);

    const finalAbsences = isAbsence
      ? Math.max(0, (current.totalAbsences !== undefined ? current.totalAbsences : 1) - 1)
      : current.totalAbsences !== undefined
        ? current.totalAbsences
        : newAbsences;

    const finalLates = isLate
      ? Math.max(0, (current.totalLates !== undefined ? current.totalLates : 1) - 1)
      : current.totalLates !== undefined
        ? current.totalLates
        : newLates;

    const finalDisposition =
      isAbsence || isLate
        ? (current.totalDisposition ?? 10)
        : studentRemainingHistory.length > 0
          ? calculatedDisp
          : Math.min(10, Math.max(0, (current.totalDisposition ?? 10) + pointsToReturn));

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [item.studentId]: {
        ...current,
        totalAbsences: finalAbsences,
        totalLates: finalLates,
        totalDisposition: finalDisposition,
      },
    };

    saveTermDisposition(itemTerm, updatedMap, updatedHistory);

    const actionsTaken: string[] = [];
    if (isAbsence) actionsTaken.push('se restó la ausencia');
    if (isLate) actionsTaken.push('se quitó la tardanza');
    if (pointsToReturn > 0)
      actionsTaken.push(`se devolvió el punto (+${pointsToReturn} pto: ahora ${finalDisposition}/10)`);
    if (pointsToReturn < 0)
      actionsTaken.push(`se ajustó la nota (${pointsToReturn} pto: ahora ${finalDisposition}/10)`);

    const actionSummary =
      actionsTaken.length > 0 ? actionsTaken.join(' y ') : 'Registro eliminado';
    setToastMessage(
      `Historial actualizado para ${item.studentName || 'el alumno'}: ${actionSummary} (${itemTerm === '2c' ? '2°C' : '1°C'}).`
    );
    setTimeout(() => setToastMessage(null), 3500);

    triggerSheetsSync(
      itemTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      itemTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    api
      .deleteDispositionHistory(item.id, {
        studentId: item.studentId,
        isAbsence,
        isLate,
        pointsToReturn,
        newAbsences: finalAbsences,
        newLates: finalLates,
        newDisposition: finalDisposition,
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});
  };

  // 4b. Borrar última falta del estudiante
  const handleDeleteLatestAbsence = async (student: Student) => {
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
    const studentAbsences = historyList
      .filter(
        (h) =>
          h.studentId === student.id &&
          (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id) &&
          (targetTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
          (h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta'))
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const latestAbsence = studentAbsences[0];

    if (latestAbsence) {
      await handleDeleteHistoryEntry(latestAbsence);
      return;
    }

    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = getStudentMetrics(student.id, targetTerm);
    if (current && current.totalAbsences > 0) {
      const finalAbsences = Math.max(0, current.totalAbsences - 1);
      const updatedMap = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalAbsences: finalAbsences,
        },
      };
      saveTermDisposition(targetTerm, updatedMap, historyList);
      triggerSheetsSync(
        targetTerm === '1c' ? updatedMap : dispositionMap,
        historyList,
        targetTerm === '2c' ? updatedMap : dispositionMap2c
      );
      setToastMessage(
        `Falta eliminada para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`
      );
      setTimeout(() => setToastMessage(null), 3000);
      if (onRefreshData) onRefreshData();
    } else {
      setToastMessage(
        `${student.firstName} ${student.lastName} no registra faltas en ${targetTerm === '2c' ? '2°C' : '1°C'} para borrar.`
      );
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // 4b2. Borrar última llegada tarde del estudiante
  const handleDeleteLatestLate = async (student: Student) => {
    const targetTerm: '1c' | '2c' = activeConcreteTerm;
    const studentLates = historyList
      .filter(
        (h) =>
          h.studentId === student.id &&
          (!activeCourse?.id || !h.courseId || h.courseId === activeCourse.id) &&
          (targetTerm === '2c' ? h.term === '2c' : h.term === '1c' || !h.term) &&
          (h.category === 'Llegada tarde' ||
            h.action === 'Llegada tarde' ||
            h.action?.toLowerCase().includes('llegada tarde') ||
            h.action?.toLowerCase().includes('tarde') ||
            h.action?.toLowerCase().includes('tardanza'))
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const latestLate = studentLates[0];

    if (latestLate) {
      await handleDeleteHistoryEntry(latestLate);
      return;
    }

    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;
    const current = getStudentMetrics(student.id, targetTerm);
    if (current && (current.totalLates || 0) > 0) {
      const finalLates = Math.max(0, (current.totalLates || 0) - 1);
      const updatedMap = {
        ...baseMap,
        [student.id]: {
          ...current,
          totalLates: finalLates,
        },
      };
      saveTermDisposition(targetTerm, updatedMap, historyList);
      triggerSheetsSync(
        targetTerm === '1c' ? updatedMap : dispositionMap,
        historyList,
        targetTerm === '2c' ? updatedMap : dispositionMap2c
      );
      setToastMessage(
        `Llegada tarde eliminada para ${student.lastName}, ${student.firstName} (${targetTerm === '2c' ? '2°C' : '1°C'}).`
      );
      setTimeout(() => setToastMessage(null), 3000);
      if (onRefreshData) onRefreshData();
    } else {
      setToastMessage(
        `${student.firstName} ${student.lastName} no registra tardanzas en ${targetTerm === '2c' ? '2°C' : '1°C'} para borrar.`
      );
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // 4c. LÓGICA PARA LLEGADA TARDE
  const handleRecordLateArrival = async (student: Student) => {
    const studentFullName = `${student.lastName}, ${student.firstName}`;
    const now = new Date();
    const date = formatLocalDateDMY(now);
    const time = formatLocalTimeHMS(now);
    const timestamp = Date.now();
    const id = `rec-late-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;
    const targetTerm: '1c' | '2c' = activeConcreteTerm;

    setPulsingStudentId(`late-${student.id}`);
    setTimeout(() => setPulsingStudentId(null), 600);

    const current = getStudentMetrics(student.id, targetTerm);

    const isTodayAbsence = (h: StudentHistoryItem) => {
      if (h.studentId !== student.id) return false;
      if (activeCourse?.id && h.courseId && h.courseId !== activeCourse.id) return false;
      const isAbs =
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta');
      if (!isAbs) return false;
      return isSameCalendarDay(h.date, h.timestamp, now) || !h.date;
    };

    const todayAbsencesToRemove: StudentHistoryItem[] = [];
    const cleanHistory = historyList.filter((h) => {
      if (isTodayAbsence(h)) {
        todayAbsencesToRemove.push(h);
        return false;
      }
      return true;
    });

    const hadAbsenceToCancel = todayAbsencesToRemove.length > 0;
    if (todayAbsencesToRemove.length > 0) {
      todayAbsencesToRemove.forEach((a) => markHistoryIdDeleted(a.id));
    }

    const remainingStudentAbsences = hadAbsenceToCancel
      ? Math.max(0, (current.totalAbsences || 0) - todayAbsencesToRemove.length)
      : current.totalAbsences || 0;

    const remainingStudentLates = (current.totalLates || 0) + 1;

    const newDisposition = current.totalDisposition ?? 10;
    const baseMap = targetTerm === '2c' ? dispositionMap2c : dispositionMap;

    const updatedMap: Record<string, StudentDispositionData> = {
      ...baseMap,
      [student.id]: {
        ...current,
        totalAbsences: remainingStudentAbsences,
        totalLates: remainingStudentLates,
        totalDisposition: newDisposition,
      },
    };

    const newHistoryEntry: StudentHistoryItem = {
      id,
      studentId: student.id,
      studentName: studentFullName,
      courseId: activeCourse.id,
      date,
      time,
      term: targetTerm,
      action: 'Llegada tarde a clase',
      category: 'Llegada tarde',
      pointsChange: 0,
      timestamp,
      messageSent: false,
      messageText: '',
      notificationMethod: 'omitted',
      omitNotification: true,
      notifiedAt: 'No enviar',
    };

    const updatedHistory = deduplicateHistory([newHistoryEntry, ...cleanHistory]);
    setHistoryList(updatedHistory);
    saveTermDisposition(targetTerm, updatedMap, updatedHistory);

    if (hadAbsenceToCancel) {
      setToastMessage(
        `Llegada tarde registrada para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}. Se eliminó automáticamente la falta de hoy.`
      );
    } else {
      setToastMessage(
        `Llegada tarde registrada para ${student.lastName}, ${student.firstName} en ${targetTerm === '2c' ? '2°C' : '1°C'}.`
      );
    }
    setTimeout(() => setToastMessage(null), 4000);

    triggerSheetsSync(
      targetTerm === '1c' ? updatedMap : dispositionMap,
      updatedHistory,
      targetTerm === '2c' ? updatedMap : dispositionMap2c
    );

    if (onRefreshData) {
      onRefreshData();
    }

    if (todayAbsencesToRemove.length > 0) {
      for (const item of todayAbsencesToRemove) {
        api.deleteDispositionHistory(item.id).catch(() => {});
      }
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync.deleteTodayAbsencesForStudent(userId, student.id, now).catch(() => {});
    }

    api
      .recordDisposition({
        id,
        studentId: student.id,
        studentName: studentFullName,
        courseId: activeCourse.id,
        action: 'Llegada tarde a clase',
        category: 'Llegada tarde',
        term: targetTerm,
        date,
        time,
        timestamp,
        messageSent: false,
        messageText: '',
        notificationMethod: 'omitted',
        omitNotification: true,
        notifiedAt: 'No enviar',
        expectedSummary: {
          totalAbsences: remainingStudentAbsences,
          totalLates: remainingStudentLates,
          totalDisposition: newDisposition,
        },
      })
      .then(() => {
        if (onRefreshData) onRefreshData();
      })
      .catch(() => {});
  };

  // Helper to open notification modal from history tables
  const handleOpenNotifyModal = (item: StudentHistoryItem, student: Student | null) => {
    const isDisposition = item.category === 'Disposición';
    let text = '';
    let selectedPresetId = '';
    const curDisp = dispositionMap[item.studentId]?.totalDisposition ?? 10;
    const studentObj = student || {
      firstName: item.studentName,
      lastName: '',
      id: item.studentId,
    };

    if (isDisposition) {
      const specificReasonTemplate = getTemplateForReason(item.action);
      selectedPresetId = `reason-${item.action}`;
      text = formatTemplateForStudent(
        specificReasonTemplate,
        studentObj,
        activeCourse.name,
        curDisp,
        item.date,
        item.action
      );
    } else {
      const activePreset =
        savedPresets.find((p) => (p.category === 'Ausencia' || !p.category) && p.isDefault) ||
        savedPresets.find((p) => p.category === 'Ausencia' || !p.category) ||
        DEFAULT_ABSENCE_PRESETS[0];
      selectedPresetId = activePreset.id;
      text = formatTemplateForStudent(
        activePreset.text,
        studentObj,
        activeCourse.name,
        curDisp,
        item.date
      );
    }

    setAbsenceNotifModal({
      isOpen: true,
      historyItem: item,
      student: student || null,
      channel: notifSettings.channel,
      messageText: text,
      selectedPresetId,
      showSavePresetInput: false,
      newPresetName: '',
      isSending: false,
    });
  };

  // 5. Copiar al portapapeles en formato Google Sheets
  const handleCopyForGoogleSheets = () => {
    const cHistory = historyList.filter((h) => h.courseId === activeCourse?.id);
    if (cHistory.length === 0) {
      setToastMessage('Aún no hay registros en el historial de este curso para copiar.');
      setTimeout(() => setToastMessage(null), 3500);
      return;
    }

    const sorted = [...cHistory].sort((a, b) => {
      const nameComp = a.studentName.localeCompare(b.studentName);
      if (nameComp !== 0) return nameComp;
      return b.timestamp - a.timestamp;
    });

    const lines = [
      ['Alumno', 'Fecha', 'Hora', 'Acción'].join('\t'),
      ...sorted.map((item) => [item.studentName, item.date, item.time, item.action].join('\t')),
    ];

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setToastMessage('¡Copiado al portapapeles! Ahora ve a tu Google Sheet y presiona Ctrl + V.');
      setTimeout(() => setToastMessage(null), 4500);
    });
  };

  // 6. Exportar CSV compatible con Excel y Google Sheets
  const handleExportHistoryCsv = () => {
    const cHistory = historyList.filter((h) => h.courseId === activeCourse?.id);
    const sorted = [...cHistory].sort((a, b) => b.timestamp - a.timestamp);

    const headers = ['Alumno', 'Fecha', 'Hora', 'Acción', 'Categoría'];
    const rows = sorted.map((h) => [
      `"${h.studentName}"`,
      `"${h.date}"`,
      `"${h.time}"`,
      `"${h.action.replace(/"/g, '""')}"`,
      `"${h.category}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Historial_Asistencia_Disposicion_${activeCourse.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 6b. Exportar Historial a Excel (.xlsx) nativo
  const handleExportHistoryExcel = () => {
    if (!activeCourse) return;
    const cHistory = historyList.filter((h) => h.courseId === activeCourse.id);
    exportCourseClassHistoryToExcel(activeCourse.name, cHistory);
  };

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

  const handleSaveEditedStudentEmail = async () => {
    if (!selectedStudentForProfile || !editedStudentEmail.trim()) return;
    try {
      const emailTrimmed = editedStudentEmail.trim();
      await api.updateStudent(selectedStudentForProfile.id, activeCourse.id, {
        email: emailTrimmed,
      });
      setSelectedStudentForProfile({
        ...selectedStudentForProfile,
        email: emailTrimmed,
      });
      setIsEditingStudentEmail(false);
      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();
      setToastMessage(
        `Correo actualizado para ${selectedStudentForProfile.firstName}: ${emailTrimmed}`
      );
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      setToastMessage(`Error al actualizar correo: ${err?.message || 'intente de nuevo'}`);
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  // -------------------------------------------------------------
  // OBSERVACIONES Y FICHA DEL ESTUDIANTE (NOTAS / INFORMES)
  // -------------------------------------------------------------
  const handleOpenStudentProfile = (student: Student) => {
    setSelectedStudentForProfile(student);
    setNewObservationText('');
    setNewObservationUrl('');
  };

  const handleNavigateProfileStudent = (direction: -1 | 1) => {
    if (!selectedStudentForProfile) return;
    const currentIndex = filteredStudents.findIndex((s) => s.id === selectedStudentForProfile.id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < filteredStudents.length) {
      setSelectedStudentForProfile(filteredStudents[targetIndex]);
      setNewObservationText('');
      setNewObservationUrl('');
    }
  };

  const handleSaveObservation = (student: Student) => {
    if (!newObservationText.trim() && !newObservationUrl.trim()) {
      setToastMessage('Escribí una observación o pegá un enlace al informe.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    let formattedUrl = newObservationUrl.trim();
    if (
      formattedUrl &&
      !formattedUrl.startsWith('http://') &&
      !formattedUrl.startsWith('https://')
    ) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const newObs: StudentObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      studentId: student.id,
      courseId: activeCourse?.id || '',
      text: newObservationText.trim(),
      reportUrl: formattedUrl || undefined,
      date,
      timestamp: Date.now(),
    };

    const currentList = studentObservations[student.id] || [];
    const updatedList = [newObs, ...currentList];
    const updatedMap = {
      ...studentObservations,
      [student.id]: updatedList,
    };

    setStudentObservations(updatedMap);
    if (typeof window !== 'undefined') {
      try {
        setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          setUserScopedItem(
            `fds_student_observations_${activeCourse.id}`,
            JSON.stringify(updatedMap)
          );
        }
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveStudentObservation(uid, newObs, updatedMap).catch(() => {
            enqueueOfflineAction('observation_save', { obs: newObs, map: updatedMap });
          });
        } else {
          enqueueOfflineAction('observation_save', { obs: newObs, map: updatedMap });
        }
      } catch (_) {}
    }

    setNewObservationText('');
    setNewObservationUrl('');
    setToastMessage(`Observación guardada para ${student.lastName}, ${student.firstName}`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDeleteObservation = (studentId: string, obsId: string) => {
    const currentList = studentObservations[studentId] || [];
    const updatedList = currentList.filter((o) => o.id !== obsId);
    const updatedMap = {
      ...studentObservations,
      [studentId]: updatedList,
    };

    setStudentObservations(updatedMap);
    if (typeof window !== 'undefined') {
      try {
        setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
        if (activeCourse?.id) {
          setUserScopedItem(
            `fds_student_observations_${activeCourse.id}`,
            JSON.stringify(updatedMap)
          );
        }
        const uid = getActiveUserId();
        if (uid) {
          firestoreSync.saveStudentObservationsMap(uid, updatedMap).catch(() => {
            enqueueOfflineAction('observation_delete', { map: updatedMap });
          });
        } else {
          enqueueOfflineAction('observation_delete', { map: updatedMap });
        }
      } catch (_) {}
    }

    setToastMessage('Observación eliminada.');
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Generar el HTML formateado para Google Docs (.gdoc) de la Ficha de Seguimiento del Alumno
  const buildStudentTrackingDocHtml = (
    student: Student,
    tl: any,
    disp: number,
    m1: StudentDispositionData,
    m2: StudentDispositionData
  ) =>
    buildModularStudentTrackingDocHtml(student, tl, disp, m1, m2, {
      activeCourse,
      attendanceTerm,
      studentObservations,
      historyList,
    });

  const handleOpenExportProfileDocConfirm = (student: Student) => {
    const defaultTitle = `📄 Ficha de Seguimiento - ${student.lastName}, ${student.firstName} (${activeCourse?.name || 'Materia'})`;
    setProfileDocTitle(defaultTitle);
    setProfileDocError(null);
    setShowProfileDocConfirm(true);
  };

  const handleConfirmExportProfileToGoogleDoc = async (
    student: Student,
    tl: any,
    disp: number,
    m1: StudentDispositionData,
    m2: StudentDispositionData
  ) => {
    if (!student || !activeCourse) return;
    setIsExportingProfileDoc(true);
    setProfileDocError(null);

    try {
      const htmlContent = buildStudentTrackingDocHtml(student, tl, disp, m1, m2);
      const finalDocTitle =
        profileDocTitle.trim() ||
        `📄 Ficha de Seguimiento - ${student.lastName}, ${student.firstName} (${activeCourse.name})`;

      let parentFolderId = courseDriveStructure?.mainFolder?.id;
      if (!parentFolderId) {
        try {
          const folderStruct = await driveService.ensureCourseFolderStructure(
            activeCourse.name,
            activeCourse.id
          );
          parentFolderId = folderStruct.mainFolder.id;
          setCourseDriveStructure(folderStruct);
        } catch {
          // Si no se pudo crear carpeta, se guarda en Mi Unidad de Drive
        }
      }

      const uploadedDoc = await driveService.uploadReportFile(
        finalDocTitle,
        htmlContent,
        parentFolderId,
        true
      );

      const docLink = uploadedDoc.webViewLink || uploadedDoc.url;

      setExportedProfileDoc({
        id: uploadedDoc.id,
        name: uploadedDoc.name,
        webViewLink: docLink,
        studentId: student.id,
      });
      setShowProfileDocConfirm(false);

      if (profileDocLinkToObs) {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const newObs: StudentObservation = {
          id: `obs-gdoc-${Date.now()}`,
          studentId: student.id,
          courseId: activeCourse.id,
          date: dateStr,
          text: `Ficha de Seguimiento exportada a Google Docs (.gdoc editable): "${uploadedDoc.name}"`,
          reportUrl: docLink,
          timestamp: Date.now(),
        };
        const currentList = studentObservations[student.id] || [];
        const updatedMap = {
          ...studentObservations,
          [student.id]: [newObs, ...currentList],
        };
        setStudentObservations(updatedMap);
        try {
          setUserScopedItem('fds_student_observations', JSON.stringify(updatedMap));
          if (activeCourse.id) {
            setUserScopedItem(
              `fds_student_observations_${activeCourse.id}`,
              JSON.stringify(updatedMap)
            );
          }
          const uid = getActiveUserId();
          if (uid) {
            firestoreSync.saveStudentObservation(uid, newObs, updatedMap).catch(() => {});
          }
        } catch (_) {}
      }

      setToastMessage(`Ficha de seguimiento creada en Google Drive (.gdoc editable).`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setProfileDocError(
        err?.message ||
          'No se pudo exportar la ficha a Google Drive. Verificá tu conexión con Google Workspace.'
      );
    } finally {
      setIsExportingProfileDoc(false);
    }
  };

  // Imprimir o descargar en PDF la ficha pedagógica individual del alumno
  const handlePrintStudentProfile = (
    student: Student,
    _tl: any,
    _disp: number,
    _m1: StudentDispositionData,
    _m2: StudentDispositionData
  ) => {
    if (!student) return;
    setCourseReportModalStudentId(student.id);
    setCourseReportModalTab('individual');
    setCourseReportModalOpen(true);
  };

  // 7b. Reiniciar / Borrar disposición por alumno individual
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

  // 7b. Reiniciar puntajes (Inicio de nuevo trimestre o para toda la clase)
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
    selectedStudentIds,
    setSelectedStudentIds,
    selectedPendingHistoryIds,
    setSelectedPendingHistoryIds,
    pendingAbsenceItems,
    pendingConductItems,
    pendingAllItems,
    conductRecordModal,
    setConductRecordModal,
    selectedStudentForHistory,
    setSelectedStudentForHistory,
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
    pulsingStudentId,
    handleAddAbsence,
    sendNotificationForItem,
    getBatchMessageForItem,
    handleOpenBatchFromPending,
    handleOpenBatchFromSelectedStudents,
    handleOpenBatchFromSelectedHistory,
    handleSendBatchNotifications,
    toggleSelectStudent,
    toggleSelectAllStudents,
    toggleSelectPendingHistory,
    toggleSelectAllPendingHistory,
    handleMarkOmitNotification,
    handleBatchMarkOmitNotification,
    handleMarkAllPendingAsOmitted,
    handleRecordDispositionAction,
    handleConfirmConductRecord,
    handleDeleteHistoryEntry,
    handleDeleteLatestAbsence,
    handleDeleteLatestLate,
    handleRecordLateArrival,
    handleOpenNotifyModal,
    handleCopyForGoogleSheets,
    handleExportHistoryCsv,
    handleExportHistoryExcel,
    handleOpenEditDisposition,
    handleChangeEditingTerm,
    handleNavigateEditStudent,
    handleSaveStudentDisposition,
    handleOpenEditAbsences,
    handleChangeEditingAbsenceTerm,
    handleNavigateEditAbsenceStudent,
    handleSaveStudentAbsences,
    handleSaveEditedStudentEmail,
    handleOpenStudentProfile,
    handleNavigateProfileStudent,
    handleSaveObservation,
    handleDeleteObservation,
    buildStudentTrackingDocHtml,
    handleOpenExportProfileDocConfirm,
    handleConfirmExportProfileToGoogleDoc,
    handlePrintStudentProfile,
    handleResetSingleStudentDisposition,
    handleResetCourseDisposition,
    handleSendDispositionToGrades,
  };
}
