import React from 'react';
import {
  Course,
  Student,
  StudentHistoryItem,
  StudentDispositionData,
  StudentObservation,
} from '../types';
import { api, setUserScopedItem } from '../services/api';
import { driveService, CourseFolderStructure } from '../services/workspace/driveService';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { enqueueOfflineAction } from '../services/offlineSyncQueue';
import { buildStudentTrackingDocHtml as buildModularStudentTrackingDocHtml } from '../utils/studentTrackingDocHtml';

export interface UseStudentProfileAndObservationsActionsProps {
  activeCourse: Course;
  filteredStudents: Student[];
  historyList: StudentHistoryItem[];
  attendanceTerm: '1c' | '2c' | 'annual';
  courseDriveStructure: CourseFolderStructure | null;
  setCourseDriveStructure: React.Dispatch<React.SetStateAction<CourseFolderStructure | null>>;
  onRefreshData?: () => void;
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

export function useStudentProfileAndObservationsActions({
  activeCourse,
  filteredStudents,
  historyList,
  attendanceTerm,
  courseDriveStructure,
  setCourseDriveStructure,
  onRefreshData,
  setToastMessage,
  setCourseReportModalStudentId,
  setCourseReportModalTab,
  setCourseReportModalOpen,
  studentObservationsProps,
}: UseStudentProfileAndObservationsActionsProps) {
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
    const updatedList = currentList.filter(
      (o) => !(o.id === obsId && (!o.courseId || !activeCourse?.id || o.courseId === activeCourse.id))
    );
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

  return {
    handleSaveEditedStudentEmail,
    handleOpenStudentProfile,
    handleNavigateProfileStudent,
    handleSaveObservation,
    handleDeleteObservation,
    buildStudentTrackingDocHtml,
    handleOpenExportProfileDocConfirm,
    handleConfirmExportProfileToGoogleDoc,
    handlePrintStudentProfile,
  };
}
