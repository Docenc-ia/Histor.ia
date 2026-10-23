import React, { useState, useEffect, useMemo } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import {
  api,
  getRemovedStudentIds,
  getRemovedStudentsList,
  syncRemovedStudentsFromCloud,
} from '../services/api';
import { classroomService } from '../services/workspace/classroomService';
import { calendarService } from '../services/workspace/calendarService';
import { gmailService } from '../services/workspace/gmailService';
import { getCachedAccessToken } from '../services/workspace/googleAuth';
import { extractWeekdaysFromSchedule } from '../utils/schoolHolidays';
import { formatLocalDateDMY } from '../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { AttendanceSettings, saveCourseAttendanceSettings } from '../utils/attendanceCalculations';

interface UseCourseRosterAndScheduleParams {
  courses: Course[];
  students: Student[];
  activeCourse?: Course;
  token: string | null;
  attendanceSettings: AttendanceSettings;
  setAttendanceSettings: React.Dispatch<React.SetStateAction<AttendanceSettings>>;
  activeConcreteTerm: '1c' | '2c';
  dispositionMap: Record<string, StudentDispositionData>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  historyList: StudentHistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<StudentHistoryItem[]>>;
  deduplicateHistory: (list: StudentHistoryItem[]) => StudentHistoryItem[];
  saveTermDisposition: (
    term: '1c' | '2c',
    updatedMap: Record<string, StudentDispositionData>,
    updatedHistory: StudentHistoryItem[]
  ) => void;
  onRefreshData: () => void;
  setToastMessage: (msg: string | null) => void;
}

export function useCourseRosterAndSchedule({
  courses,
  students,
  activeCourse,
  token,
  attendanceSettings,
  setAttendanceSettings,
  activeConcreteTerm,
  dispositionMap,
  dispositionMap2c,
  historyList,
  setHistoryList,
  deduplicateHistory,
  saveTermDisposition,
  onRefreshData,
  setToastMessage,
}: UseCourseRosterAndScheduleParams) {
  const [removedStudentIds, setRemovedStudentIds] = useState<Set<string>>(() =>
    getRemovedStudentIds(activeCourse?.id || '')
  );
  const [removedStudentsList, setRemovedStudentsList] = useState<Student[]>(() =>
    getRemovedStudentsList(activeCourse?.id || '')
  );
  const [isRemovedStudentsModalOpen, setIsRemovedStudentsModalOpen] = useState(false);

  useEffect(() => {
    if (!activeCourse?.id) {
      setRemovedStudentIds(new Set());
      setRemovedStudentsList([]);
      return;
    }
    const refreshRemoved = () => {
      setRemovedStudentIds(getRemovedStudentIds(activeCourse.id));
      setRemovedStudentsList(getRemovedStudentsList(activeCourse.id));
    };
    refreshRemoved();
    let mounted = true;
    syncRemovedStudentsFromCloud(activeCourse.id)
      .then(({ ids, list }) => {
        if (mounted) {
          setRemovedStudentIds(ids);
          setRemovedStudentsList(list);
        }
      })
      .catch(() => {});
    window.addEventListener('docencia_student_status_updated', refreshRemoved);
    return () => {
      mounted = false;
      window.removeEventListener('docencia_student_status_updated', refreshRemoved);
    };
  }, [activeCourse?.id]);

  // Students sorted strictly alphabetically by last name (apellido), then first name
  const courseStudents = useMemo(() => {
    return students
      .filter((s) => s.courseId === activeCourse?.id && !removedStudentIds.has(s.id))
      .sort((a, b) => {
        const lastA = (a.lastName || '').trim();
        const lastB = (b.lastName || '').trim();
        const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        const firstA = (a.firstName || '').trim();
        const firstB = (b.firstName || '').trim();
        return firstA.localeCompare(firstB, 'es', { sensitivity: 'base' });
      });
  }, [students, activeCourse?.id, removedStudentIds]);

  const [isSyncingClassroomRoster, setIsSyncingClassroomRoster] = useState(false);
  const [needsRosterPermission, setNeedsRosterPermission] = useState(false);
  const [studentToRemove, setStudentToRemove] = useState<Student | null>(null);

  // Modal 1: Sincronizar / Seleccionar Horarios con Google Calendar
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [calendarModalCourse, setCalendarModalCourse] = useState<Course | null>(null);
  const [calendarScheduleSelection, setCalendarScheduleSelection] = useState('');
  const [syncToGoogleFromModal, setSyncToGoogleFromModal] = useState(true);
  const [isSavingCalendarSelection, setIsSavingCalendarSelection] = useState(false);

  const [selectedCalendarForSlots, setSelectedCalendarForSlots] = useState<string>('primary');
  const [availableCalendarsForSlots, setAvailableCalendarsForSlots] = useState<
    { id: string; summary: string; primary?: boolean }[]
  >([
    { id: 'primary', summary: 'Calendario Principal (Cuenta Classroom)', primary: true },
  ]);
  const [calendarSlots, setCalendarSlots] = useState<
    {
      id: string;
      title: string;
      dayOfWeek: number;
      dayName: string;
      startTime: string;
      endTime: string;
      displayText: string;
    }[]
  >([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Modal 2: Editar Detalles Específicos del Curso
  const [isEditCourseModalOpen, setIsEditCourseModalOpen] = useState(false);
  const [editCourseData, setEditCourseData] = useState<{
    id: string;
    name: string;
    subject: string;
    grade: string;
    room: string;
    division: string;
    schedule: string;
  } | null>(null);
  const [isSavingCourseDetails, setIsSavingCourseDetails] = useState(false);

  // Modal para agregar alumno manualmente
  const [isAddStudentModalOpen, setIsAddStudentModalOpen] = useState(false);
  const [addStudentFirstName, setAddStudentFirstName] = useState('');
  const [addStudentLastName, setAddStudentLastName] = useState('');
  const [addStudentEmail, setAddStudentEmail] = useState('');
  const [addStudentPhone, setAddStudentPhone] = useState('');
  const [addStudentNotes, setAddStudentNotes] = useState('');
  const [isSavingManualStudent, setIsSavingManualStudent] = useState(false);
  const [addStudentTab, setAddStudentTab] = useState<'single' | 'batch'>('single');
  const [batchStudentsText, setBatchStudentsText] = useState('');

  // Modal para enviar mensaje directo a un estudiante
  const [directMessageModal, setDirectMessageModal] = useState<{
    isOpen: boolean;
    student: Student | null;
    subject: string;
    messageText: string;
    channel: 'gmail' | 'classroom' | 'whatsapp';
    isSending: boolean;
  }>({
    isOpen: false,
    student: null,
    subject: '',
    messageText: '',
    channel: 'gmail',
    isSending: false,
  });

  useEffect(() => {
    api.cleanMockStudents().catch(() => {});
  }, []);

  const handleSyncRoster = async () => {
    if (!activeCourse) return;
    const activeToken = token || getCachedAccessToken();
    if (!activeToken) {
      setToastMessage('Por favor conectá tu cuenta de Google para sincronizar los estudiantes de Classroom.');
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    try {
      setIsSyncingClassroomRoster(true);
      const res = await classroomService.resolveAndFetchCourseStudents(activeCourse, activeToken);

      if (res.rosterPermissionRequired) {
        setNeedsRosterPermission(true);
        setToastMessage('Se requiere permiso para leer la nómina de estudiantes de Google Classroom.');
        setTimeout(() => setToastMessage(null), 5000);
        return;
      }

      if (res.success && Array.isArray(res.students)) {
        setNeedsRosterPermission(false);
        await api.syncCourseStudentsRoster(activeCourse.id, res.students);

        if (res.realClassroomId && res.realClassroomId !== activeCourse.classroomCourseId) {
          await api.updateCourse(activeCourse.id, {
            classroomCourseId: res.realClassroomId,
            classroomSynced: true,
            studentsCount: res.students.length,
          });
        }

        onRefreshData();
        setToastMessage(`¡Listo! Se sincronizaron ${res.students.length} estudiantes reales desde Google Classroom.`);
        setTimeout(() => setToastMessage(null), 4500);
      } else {
        setToastMessage(res.message || 'No se encontraron estudiantes inscriptos en este curso de Google Classroom.');
        setTimeout(() => setToastMessage(null), 4500);
      }
    } catch (err: any) {
      console.warn('Error al sincronizar alumnos:', err);
      setToastMessage(err?.message || 'Error al conectar con Google Classroom.');
      setTimeout(() => setToastMessage(null), 4500);
    } finally {
      setIsSyncingClassroomRoster(false);
    }
  };

  const handleOpenCalendarSyncModal = async (course: Course, overrideCalId?: string) => {
    setCalendarModalCourse(course);
    const defaultCalId = course.preferredCalendarId || 'primary';
    if (!overrideCalId) {
      setSelectedCalendarForSlots(defaultCalId);
      setCalendarScheduleSelection(
        course.schedule &&
          course.schedule !== 'Lunes y Miércoles' &&
          !course.schedule.toLowerCase().includes('coordinar')
          ? course.schedule
          : ''
      );
      setIsCalendarModalOpen(true);
    }

    const calIdToFetch = overrideCalId || defaultCalId;

    try {
      setIsLoadingSlots(true);
      const [calListRes, res] = await Promise.all([
        calendarService.listCalendars(),
        calendarService.getWeeklyCalendarSlots(calIdToFetch, courses),
      ]);
      if (calListRes.success && calListRes.calendars.length > 0) {
        setAvailableCalendarsForSlots(calListRes.calendars);
      }
      if (res.success) {
        setCalendarSlots(res.slots);
      } else {
        setToastMessage(res.message);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (err) {
      console.warn('Error loading calendar slots:', err);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleSaveCalendarSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarModalCourse) return;
    const cleanSchedule = calendarScheduleSelection.trim();
    if (!cleanSchedule) return;

    try {
      setIsSavingCalendarSelection(true);
      const extractedWeekdays = extractWeekdaysFromSchedule(cleanSchedule);

      await api.updateCourse(calendarModalCourse.id, {
        schedule: cleanSchedule,
        preferredCalendarId: selectedCalendarForSlots || 'primary',
      });

      if (extractedWeekdays.length > 0) {
        const nextSettings: AttendanceSettings = {
          ...attendanceSettings,
          courseWeekdays: extractedWeekdays,
          classesPerWeek: extractedWeekdays.length,
        };
        saveCourseAttendanceSettings(calendarModalCourse.id, nextSettings);
        setAttendanceSettings(nextSettings);

        try {
          const libroKey = `fds_libro_temas_${calendarModalCourse.id}`;
          const currentLibroRaw = localStorage.getItem(libroKey);
          if (currentLibroRaw) {
            const parsed = JSON.parse(currentLibroRaw);
            const updatedLibro = {
              ...parsed,
              metadata: {
                ...(parsed.metadata || {}),
                horario: cleanSchedule,
                configuredWeekdays: extractedWeekdays,
              },
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(libroKey, JSON.stringify(updatedLibro));
            const uid = getActiveUserId();
            if (uid) {
              firestoreSync.saveUserSetting(uid, `libro_temas_${calendarModalCourse.id}`, updatedLibro).catch(() => {});
            }
          }
        } catch (_) {}
      }

      await fetch('/api/calendar/sync-course-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCourseId: calendarModalCourse.id }),
      }).catch((err) => console.warn('Sync internal schedule error:', err));

      let googleMsg = '';
      if (syncToGoogleFromModal) {
        const activeToken = token || getCachedAccessToken();
        if (activeToken) {
          try {
            const gRes = await calendarService.syncCourseScheduleToGoogle(
              calendarModalCourse,
              cleanSchedule,
              selectedCalendarForSlots || 'primary'
            );
            if (gRes.success) {
              googleMsg = ' y actualizado en tu Google Calendar con repetición semanal';
            }
          } catch (gErr) {
            console.warn('Error syncing to Google Calendar:', gErr);
          }
        }
      }

      setToastMessage(`¡Horario confirmado para ${calendarModalCourse.name}${googleMsg}!`);
      setTimeout(() => setToastMessage(null), 5000);
      setIsCalendarModalOpen(false);
      setCalendarModalCourse(null);
      onRefreshData();
    } catch (err) {
      console.error('Error guardando horario:', err);
      setToastMessage('No se pudo guardar el horario seleccionado.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingCalendarSelection(false);
    }
  };

  const handleOpenEditCourseDetailsModal = (course: Course) => {
    setEditCourseData({
      id: course.id,
      name: course.name,
      subject: course.subject || '',
      grade: course.grade || '',
      room: course.room || '',
      division: course.division || '',
      schedule: course.schedule || '',
    });
    setIsEditCourseModalOpen(true);
  };

  const handleSaveCourseDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCourseData) return;

    try {
      setIsSavingCourseDetails(true);
      const cleanSchedule = editCourseData.schedule.trim();
      const extractedWeekdays = extractWeekdaysFromSchedule(cleanSchedule);

      await api.updateCourse(editCourseData.id, {
        name: editCourseData.name.trim(),
        subject: editCourseData.subject.trim(),
        grade: editCourseData.grade.trim(),
        room: editCourseData.room.trim(),
        division: editCourseData.division.trim(),
        schedule: cleanSchedule,
      });

      if (extractedWeekdays.length > 0) {
        const nextSettings: AttendanceSettings = {
          ...attendanceSettings,
          courseWeekdays: extractedWeekdays,
          classesPerWeek: extractedWeekdays.length,
        };
        saveCourseAttendanceSettings(editCourseData.id, nextSettings);
        setAttendanceSettings(nextSettings);

        try {
          const libroKey = `fds_libro_temas_${editCourseData.id}`;
          const currentLibroRaw = localStorage.getItem(libroKey);
          if (currentLibroRaw) {
            const parsed = JSON.parse(currentLibroRaw);
            const updatedLibro = {
              ...parsed,
              metadata: {
                ...(parsed.metadata || {}),
                asignatura: `${editCourseData.name.trim()} (${editCourseData.division.trim() || editCourseData.grade.trim() || 'Curso'})`,
                horario: cleanSchedule,
                configuredWeekdays: extractedWeekdays,
              },
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(libroKey, JSON.stringify(updatedLibro));
            const uid = getActiveUserId();
            if (uid) {
              firestoreSync.saveUserSetting(uid, `libro_temas_${editCourseData.id}`, updatedLibro).catch(() => {});
            }
          }
        } catch (_) {}
      }

      setToastMessage(`¡Información actualizada para ${editCourseData.name}!`);
      setTimeout(() => setToastMessage(null), 4500);
      setIsEditCourseModalOpen(false);
      setEditCourseData(null);
      onRefreshData();
    } catch (err) {
      console.error('Error guardando detalles del curso:', err);
      setToastMessage('Error al actualizar los datos del curso.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingCourseDetails(false);
    }
  };

  const handleOpenAddStudentModal = () => {
    setAddStudentFirstName('');
    setAddStudentLastName('');
    setAddStudentEmail('');
    setAddStudentPhone('');
    setAddStudentNotes('');
    setAddStudentTab('single');
    setBatchStudentsText('');
    setIsAddStudentModalOpen(true);
  };

  const handleSaveSingleStudent = async (addAnother: boolean = false) => {
    if (!activeCourse) return;
    const firstName = addStudentFirstName.trim();
    const lastName = addStudentLastName.trim();
    const email = addStudentEmail.trim();

    if (!firstName || !lastName) {
      setToastMessage('Por favor, ingresá el nombre y apellido del estudiante.');
      setTimeout(() => setToastMessage(null), 3500);
      return;
    }

    setIsSavingManualStudent(true);
    try {
      await api.createStudent({
        courseId: activeCourse.id,
        firstName,
        lastName,
        email: email || undefined,
      });

      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();

      setToastMessage(`Alumno/a "${lastName}, ${firstName}" agregado con éxito.`);
      setTimeout(() => setToastMessage(null), 4000);

      if (addAnother) {
        setAddStudentFirstName('');
        setAddStudentLastName('');
        setAddStudentEmail('');
        setAddStudentPhone('');
        setAddStudentNotes('');
      } else {
        setIsAddStudentModalOpen(false);
      }
    } catch (err: any) {
      setToastMessage(`Error al guardar estudiante: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingManualStudent(false);
    }
  };

  const handleSaveBatchStudents = async () => {
    if (!activeCourse || !batchStudentsText.trim()) return;
    setIsSavingManualStudent(true);
    try {
      const lines = batchStudentsText.split('\n').map((l) => l.trim()).filter(Boolean);
      const parsed: Array<{ firstName: string; lastName: string; email?: string }> = [];

      for (const line of lines) {
        if (line.includes(',')) {
          const parts = line.split(',').map((p) => p.trim());
          if (parts.length >= 2) {
            const lastName = parts[0];
            const firstName = parts[1];
            const email = parts[2] || '';
            parsed.push({ firstName, lastName, email: email || undefined });
            continue;
          }
        }

        const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const email = emailMatch ? emailMatch[1] : '';
        const namePart = line.replace(email, '').trim().replace(/[,;\t]/g, ' ').replace(/\s+/g, ' ');
        const words = namePart.split(' ').filter(Boolean);
        if (words.length >= 2) {
          parsed.push({
            lastName: words[0],
            firstName: words.slice(1).join(' '),
            email: email || undefined,
          });
        } else if (words.length === 1) {
          parsed.push({
            lastName: words[0],
            firstName: 'Alumno',
            email: email || undefined,
          });
        }
      }

      if (parsed.length === 0) {
        setToastMessage('No se detectaron alumnos. Formato sugerido: Apellido, Nombre, correo@ejemplo.com');
        setTimeout(() => setToastMessage(null), 4000);
        setIsSavingManualStudent(false);
        return;
      }

      for (const item of parsed) {
        await api.createStudent({
          courseId: activeCourse.id,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
        });
      }

      window.dispatchEvent(new Event('docencia_student_status_updated'));
      if (onRefreshData) onRefreshData();

      setToastMessage(`¡Éxito! Se agregaron ${parsed.length} alumnos a ${activeCourse.name}.`);
      setTimeout(() => setToastMessage(null), 4500);
      setIsAddStudentModalOpen(false);
      setBatchStudentsText('');
    } catch (err: any) {
      setToastMessage(`Error al guardar lote: ${err?.message || 'intente nuevamente'}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingManualStudent(false);
    }
  };

  const handleOpenDirectMessageModal = (student: Student) => {
    if (!activeCourse) return;
    const defaultSubject = `Comunicado de ${activeCourse.name}`;
    const defaultMsg = `Estimado/a ${student.firstName},\n\nNos comunicamos desde la materia ${activeCourse.name}.\n\nSaludos cordiales.`;
    setDirectMessageModal({
      isOpen: true,
      student,
      subject: defaultSubject,
      messageText: defaultMsg,
      channel: student.email ? 'gmail' : 'classroom',
      isSending: false,
    });
  };

  const handleSendDirectMessage = async () => {
    if (!activeCourse || !directMessageModal.student || !directMessageModal.messageText.trim()) return;
    const { student, subject, messageText, channel } = directMessageModal;

    setDirectMessageModal((prev) => ({ ...prev, isSending: true }));
    try {
      if (channel === 'gmail') {
        if (!student.email) {
          throw new Error('El estudiante no tiene correo electrónico cargado.');
        }
        const res = await gmailService.sendEmail(student.email, subject, messageText);
        if (!res.success) {
          window.open(
            `mailto:${encodeURIComponent(student.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageText)}`
          );
        }
      } else if (channel === 'classroom') {
        const cid = activeCourse.classroomCourseId || activeCourse.id;
        await classroomService.createIndividualAnnouncement(cid, student.id, messageText);
      } else if (channel === 'whatsapp') {
        const phone = (student as any).phone ? (student as any).phone.replace(/[^0-9]/g, '') : '';
        const waUrl = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`
          : `https://wa.me/?text=${encodeURIComponent(messageText)}`;
        window.open(waUrl, '_blank');
      }

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const newHistoryItem: StudentHistoryItem = {
        id: `msg-${student.id}-${Date.now()}`,
        studentId: student.id,
        studentName: `${student.lastName}, ${student.firstName}`,
        courseId: activeCourse.id,
        date: formatLocalDateDMY(),
        time: timeStr,
        term: activeConcreteTerm,
        action: `Mensaje directo enviado: "${subject}"`,
        category: 'Disposición',
        pointsChange: 0,
        timestamp: Date.now(),
        messageSent: true,
        messageText,
        notificationMethod: channel,
        notifiedAt: timeStr,
      };

      const updated = deduplicateHistory([newHistoryItem, ...historyList]);
      setHistoryList(updated);
      saveTermDisposition(
        activeConcreteTerm,
        activeConcreteTerm === '2c' ? dispositionMap2c : dispositionMap,
        updated
      );
      api
        .recordDisposition({
          id: newHistoryItem.id,
          studentId: student.id,
          studentName: newHistoryItem.studentName,
          courseId: activeCourse.id,
          action: newHistoryItem.action,
          category: 'Disposición',
          term: newHistoryItem.term,
          date: newHistoryItem.date,
          time: newHistoryItem.time,
          timestamp: newHistoryItem.timestamp,
          messageSent: true,
          messageText,
          notificationMethod: channel,
          notifiedAt: newHistoryItem.notifiedAt,
        })
        .catch(() => {});

      setToastMessage(`Mensaje enviado a ${student.firstName} ${student.lastName} correctamente.`);
      setTimeout(() => setToastMessage(null), 4000);
      setDirectMessageModal((prev) => ({ ...prev, isOpen: false, isSending: false }));
    } catch (err: any) {
      setToastMessage(`Error al enviar mensaje: ${err?.message || 'intente de nuevo'}`);
      setTimeout(() => setToastMessage(null), 4000);
      setDirectMessageModal((prev) => ({ ...prev, isSending: false }));
    }
  };

  return {
    removedStudentIds,
    setRemovedStudentIds,
    removedStudentsList,
    setRemovedStudentsList,
    isRemovedStudentsModalOpen,
    setIsRemovedStudentsModalOpen,
    courseStudents,
    isSyncingClassroomRoster,
    setIsSyncingClassroomRoster,
    needsRosterPermission,
    setNeedsRosterPermission,
    studentToRemove,
    setStudentToRemove,
    isCalendarModalOpen,
    setIsCalendarModalOpen,
    calendarModalCourse,
    setCalendarModalCourse,
    calendarScheduleSelection,
    setCalendarScheduleSelection,
    syncToGoogleFromModal,
    setSyncToGoogleFromModal,
    isSavingCalendarSelection,
    selectedCalendarForSlots,
    setSelectedCalendarForSlots,
    availableCalendarsForSlots,
    calendarSlots,
    isLoadingSlots,
    isEditCourseModalOpen,
    setIsEditCourseModalOpen,
    editCourseData,
    setEditCourseData,
    isSavingCourseDetails,
    isAddStudentModalOpen,
    setIsAddStudentModalOpen,
    addStudentFirstName,
    setAddStudentFirstName,
    addStudentLastName,
    setAddStudentLastName,
    addStudentEmail,
    setAddStudentEmail,
    addStudentPhone,
    setAddStudentPhone,
    addStudentNotes,
    setAddStudentNotes,
    isSavingManualStudent,
    addStudentTab,
    setAddStudentTab,
    batchStudentsText,
    setBatchStudentsText,
    directMessageModal,
    setDirectMessageModal,
    handleSyncRoster,
    handleOpenCalendarSyncModal,
    handleSaveCalendarSelection,
    handleOpenEditCourseDetailsModal,
    handleSaveCourseDetails,
    handleOpenAddStudentModal,
    handleSaveSingleStudent,
    handleSaveBatchStudents,
    handleOpenDirectMessageModal,
    handleSendDirectMessage,
  };
}
