import React, { useState, useEffect } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import { GradeCategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../types/grades';
import {
  exportCourseClassHistoryToExcel,
  exportCourseDispositionToExcel,
  exportGradebookMatrixToExcel,
  GradeHistoryEntry,
} from '../utils/excelExport';
import {
  api,
  getUserStorageKey,
  setUserScopedItem,
  saveAllDispositionStorage,
} from '../services/api';
import { getCachedAccessToken, setCachedAccessToken, isValidGoogleAccessToken } from '../services/workspace/googleAuth';
import { sheetsService } from '../services/workspace/sheetsService';
import { driveService } from '../services/workspace/driveService';
import { formatLocalDateDMY, formatLocalTimeHMS } from '../utils/dateUtils';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { isRealGoogleSpreadsheetId, copyTableToClipboard, extractSpreadsheetIdFromInput } from '../utils/sheetsUtils';

interface UseGoogleSheetsAndDriveSyncParams {
  activeCourse?: Course;
  students: Student[];
  courseStudents: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  setDispositionMap: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  setDispositionMap2c: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  historyList: StudentHistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<StudentHistoryItem[]>>;
  courseHistory: StudentHistoryItem[];
  activeConcreteTerm: '1c' | '2c';
  token: string | null;
  requestAccessToken: () => Promise<string | null>;
  getStudentMetrics: (studentId: string, targetTerm?: '1c' | '2c' | 'annual' | 'all') => StudentDispositionData;
  deduplicateHistory: (list: StudentHistoryItem[]) => StudentHistoryItem[];
  onRefreshData: () => void;
  setActiveTab: (tab: 'roster' | 'libro_temas' | 'grades' | 'history') => void;
  setToastMessage: (msg: string | null) => void;
}

export function useGoogleSheetsAndDriveSync({
  activeCourse,
  students,
  courseStudents,
  dispositionMap,
  setDispositionMap,
  dispositionMap2c,
  setDispositionMap2c,
  historyList,
  setHistoryList,
  courseHistory,
  activeConcreteTerm,
  token,
  requestAccessToken,
  getStudentMetrics,
  deduplicateHistory,
  onRefreshData,
  setActiveTab,
  setToastMessage,
}: UseGoogleSheetsAndDriveSyncParams) {
  const [sheetConfig, setSheetConfig] = useState<{
    spreadsheetId: string;
    url: string;
    isLiveGoogle: boolean;
    lastSyncedAt?: string;
  } | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isOpeningSheet] = useState(false);
  const [showSheetsConnectModal, setShowSheetsConnectModal] = useState(false);
  const [sheetsModalFeedback, setSheetsModalFeedback] = useState<string | null>(null);
  const [customSheetInput, setCustomSheetInput] = useState('');
  const [isLinkingCustomSheet, setIsLinkingCustomSheet] = useState(false);
  const [customFolderInput, setCustomFolderInput] = useState('');
  const [isLinkingCustomFolder, setIsLinkingCustomFolder] = useState(false);

  // Doble Entrada (Two-Way Sync): lectura de cambios desde Google Sheets a la App
  const [isPullingFromSheet, setIsPullingFromSheet] = useState(false);
  const [dobleEntradaDiffs, setDobleEntradaDiffs] = useState<any[] | null>(null);
  const [isDobleEntradaModalOpen, setIsDobleEntradaModalOpen] = useState(false);

  // Modal / Selector de Exportar Excel en la cabecera
  const [isHeaderExportExcelModalOpen, setIsHeaderExportExcelModalOpen] = useState(false);

  // Modal de Importar desde Excel / Sheets en Asistencia y Disposición
  const [isHeaderImportModalOpen, setIsHeaderImportModalOpen] = useState(false);
  const [headerImportSourceType, setHeaderImportSourceType] = useState<'file' | 'sheets' | 'paste'>('file');
  const [headerImportContext, setHeaderImportContext] = useState<'grades' | 'attendance'>('attendance');

  // Google Drive course folder structure state
  const [isSettingUpDriveFolder, setIsSettingUpDriveFolder] = useState<boolean>(false);
  const [driveFolderModalOpen, setDriveFolderModalOpen] = useState<boolean>(false);
  const [courseDriveStructure, setCourseDriveStructure] = useState<{
    mainFolder: { id: string; name: string; url: string };
    reportsFolder?: { id: string; name: string; url: string };
    attendanceFolder: { id: string; name: string; url: string };
    gradesFolder: { id: string; name: string; url: string };
    attendanceSheetUrl?: string;
    gradesSheetUrl?: string;
    libroDeTemasSheetUrl?: string;
  } | null>(null);

  // Load saved Google Sheet configuration when activeCourse changes
  useEffect(() => {
    let isMounted = true;
    if (activeCourse?.id) {
      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      api
        .getCourseDispositionSheet(activeCourse.id)
        .then((data) => {
          if (!isMounted) return;
          if (
            data?.spreadsheetId &&
            isRealGoogleSpreadsheetId(data.spreadsheetId) &&
            (isS2NatCourse || data.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
          ) {
            setSheetConfig({
              spreadsheetId: data.spreadsheetId,
              url: data.url || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
              isLiveGoogle: true,
              lastSyncedAt: data.lastSyncedAt,
            });
          } else {
            if (data?.spreadsheetId === POISONED_S2_NAT_SHEET_ID && !isS2NatCourse) {
              api.unlinkCourseDispositionSheet(activeCourse.id).catch(() => {});
            }
            const fallbackId = `sheet-disp-${activeCourse.id}`;
            setSheetConfig({
              spreadsheetId: fallbackId,
              url: '',
              isLiveGoogle: false,
              lastSyncedAt: undefined,
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [activeCourse?.id]);

  // Real-time synchronization with Google Sheets (automatic background updates when marking)
  const triggerSheetsSync = async (
    customMap?: Record<string, StudentDispositionData>,
    customHistory?: StudentHistoryItem[],
    customMap2c?: Record<string, StudentDispositionData>
  ) => {
    if (!activeCourse) return;
    const activeToken = token || getCachedAccessToken();
    const isAuthenticToken = activeToken && isValidGoogleAccessToken(activeToken);

    if (!isAuthenticToken) {
      return;
    }

    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    setIsSyncingSheet(true);
    try {
      const map1cToUse = customMap || dispositionMap;
      const map2cToUse = customMap2c || dispositionMap2c;

      const studentMap = new Map<string, Student>();
      for (const s of courseStudents) {
        studentMap.set(s.id, s);
      }
      for (const s of students) {
        if (s.courseId === activeCourse.id && !studentMap.has(s.id)) {
          studentMap.set(s.id, s);
        }
      }
      const allKnownIds = new Set([...Object.keys(map1cToUse || {}), ...Object.keys(map2cToUse || {})]);
      for (const stId of allKnownIds) {
        if (!studentMap.has(stId)) {
          const histItem = (customHistory || historyList).find((h) => h.studentId === stId);
          studentMap.set(stId, {
            id: stId,
            courseId: activeCourse.id,
            firstName: histItem?.studentName?.split(' ')[0] || 'Estudiante',
            lastName: histItem?.studentName?.split(' ').slice(1).join(' ') || stId,
            email: '',
            avatar: '',
            attendanceRate: 100,
            averageGrade: 10,
            notes: '',
          });
        }
      }
      const currentStudents = Array.from(studentMap.values()).sort((a, b) => {
        const lastA = (a.lastName || '').trim();
        const lastB = (b.lastName || '').trim();
        const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
      });

      const fullMap1c: Record<string, StudentDispositionData> = {};
      const fullMap2c: Record<string, StudentDispositionData> = {};
      for (const s of currentStudents) {
        fullMap1c[s.id] = (map1cToUse && map1cToUse[s.id]) || getStudentMetrics(s.id, '1c');
        fullMap2c[s.id] = (map2cToUse && map2cToUse[s.id]) || getStudentMetrics(s.id, '2c');
      }

      const courseStudentIds = new Set(currentStudents.map((s) => s.id));
      const historyToUse = (customHistory || historyList).filter(
        (h) => h.courseId === activeCourse.id || (!h.courseId && courseStudentIds.has(h.studentId))
      );
      const realExistingId =
        (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
        (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

      let targetFolderId = activeCourse.attendanceFolderId || activeCourse.driveFolderId;
      if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            activeCourse.name,
            undefined,
            activeToken
          );
          targetFolderId = folderStruct.attendanceFolder.id || folderStruct.mainFolder.id;
          activeCourse.attendanceFolderId = folderStruct.attendanceFolder.id;
          activeCourse.attendanceFolderUrl = folderStruct.attendanceFolder.url;
          activeCourse.gradesFolderId = folderStruct.gradesFolder.id;
          activeCourse.gradesFolderUrl = folderStruct.gradesFolder.url;
          activeCourse.driveFolderId = folderStruct.mainFolder.id;
          activeCourse.driveFolderUrl = folderStruct.mainFolder.url;
          api.updateCourse(activeCourse.id, {
            attendanceFolderId: folderStruct.attendanceFolder.id,
            attendanceFolderUrl: folderStruct.attendanceFolder.url,
            gradesFolderId: folderStruct.gradesFolder.id,
            gradesFolderUrl: folderStruct.gradesFolder.url,
            driveFolderId: folderStruct.mainFolder.id,
            driveFolderUrl: folderStruct.mainFolder.url,
          }).catch(() => {});
        } catch (_) {}
      }

      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        fullMap1c,
        historyToUse,
        realExistingId,
        targetFolderId,
        activeToken,
        fullMap2c
      );

      const isLive = res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId);

      setSheetConfig({
        spreadsheetId: res.spreadsheetId,
        url: isLive ? res.url : (sheetConfig?.url || ''),
        isLiveGoogle: isLive,
        lastSyncedAt: res.updatedAt,
      });

      if (isLive) {
        activeCourse.dispositionSheetId = res.spreadsheetId;
        activeCourse.dispositionSheetUrl = res.url;
        api
          .saveCourseDispositionSheet(activeCourse.id, {
            spreadsheetId: res.spreadsheetId,
            url: res.url,
            lastSyncedAt: res.updatedAt,
          })
          .catch(() => {});
        api
          .updateCourse(activeCourse.id, {
            dispositionSheetId: res.spreadsheetId,
            dispositionSheetUrl: res.url,
          })
          .catch(() => {});
      } else if (res.errorCode === 'UNAUTHORIZED') {
        setCachedAccessToken(null);
      }
    } catch (err) {
      console.warn('Background sync to Google Sheets error:', err);
    } finally {
      setIsSyncingSheet(false);
    }
  };

  // Explicit manual sync triggered by clicking "Sincronizar Sheets" / "Sincronizar Ahora"
  const handleManualSheetsSync = async () => {
    if (!activeCourse) return;
    setIsSyncingSheet(true);
    setToastMessage('Verificando conexión con Google Sheets...');
    try {
      let activeToken = token || getCachedAccessToken();
      let isAuthentic = activeToken && isValidGoogleAccessToken(activeToken);

      if (!isAuthentic) {
        setToastMessage('Solicitando autorización de tu cuenta de Google...');
        try {
          const freshToken = await requestAccessToken();
          if (freshToken && isValidGoogleAccessToken(freshToken)) {
            activeToken = freshToken;
            isAuthentic = true;
          }
        } catch (authErr: any) {
          console.warn('Google Sheets OAuth authorization error:', authErr);
          setToastMessage('Se requiere autorización de Google para editar la planilla.');
          setShowSheetsConnectModal(true);
          return;
        }
      }

      if (!activeToken || !isAuthentic) {
        setToastMessage('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
        setShowSheetsConnectModal(true);
        return;
      }

      setToastMessage(`Sincronizando con Google Sheets para "${activeCourse.name}"...`);
      const studentMap = new Map<string, Student>();
      for (const s of courseStudents) {
        studentMap.set(s.id, s);
      }
      for (const s of students) {
        if (s.courseId === activeCourse.id && !studentMap.has(s.id)) {
          studentMap.set(s.id, s);
        }
      }
      const allKnownIds = new Set([...Object.keys(dispositionMap || {}), ...Object.keys(dispositionMap2c || {})]);
      for (const stId of allKnownIds) {
        if (!studentMap.has(stId)) {
          const histItem = historyList.find((h) => h.studentId === stId);
          studentMap.set(stId, {
            id: stId,
            courseId: activeCourse.id,
            firstName: histItem?.studentName?.split(' ')[0] || 'Estudiante',
            lastName: histItem?.studentName?.split(' ').slice(1).join(' ') || stId,
            email: '',
            avatar: '',
            attendanceRate: 100,
            averageGrade: 10,
            notes: '',
          });
        }
      }
      const currentStudents = Array.from(studentMap.values()).sort((a, b) => {
        const lastA = (a.lastName || '').trim();
        const lastB = (b.lastName || '').trim();
        const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
      });

      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      const realExistingId =
        (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
        (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

      let map1cToSync = dispositionMap;
      let map2cToSync = dispositionMap2c;
      let pulledChangesCount = 0;

      if (realExistingId) {
        try {
          const pullRes = await sheetsService.pullDispositionSheetFromGoogle(
            activeCourse,
            currentStudents,
            dispositionMap,
            dispositionMap2c,
            realExistingId,
            activeToken
          );
          if (pullRes.success && pullRes.changesCount > 0) {
            pulledChangesCount = pullRes.changesCount;
            map1cToSync = pullRes.updatedMap1c;
            map2cToSync = pullRes.updatedMap2c;
            setDispositionMap(pullRes.updatedMap1c);
            setDispositionMap2c(pullRes.updatedMap2c);

            if (typeof window !== 'undefined' && activeCourse?.id) {
              localStorage.setItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(pullRes.updatedMap1c));
              localStorage.setItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(pullRes.updatedMap2c));
            }

            const now = new Date();
            const dateStr = formatLocalDateDMY(now);
            const timeStr = formatLocalTimeHMS(now);
            const newHistoryItems: StudentHistoryItem[] = pullRes.changes.map((change, idx) => ({
              id: `sheet-pull-${Date.now()}-${idx}`,
              studentId: change.studentId,
              studentName: change.studentName,
              courseId: activeCourse.id,
              term: change.term,
              category: 'Sistema',
              action: `Sincronización Sheets (${change.termLabel}): ${change.fieldLabel} modificado en Google Sheet de ${change.oldValue} a ${change.newValue}`,
              date: dateStr,
              time: timeStr,
              timestamp: Date.now() + idx,
              messageSent: false,
              messageText: '',
              notificationMethod: 'omitted',
              omitNotification: true,
              notifiedAt: 'No enviar',
            }));

            const updatedHistory = deduplicateHistory([...newHistoryItems, ...historyList]);
            setHistoryList(updatedHistory);
            saveAllDispositionStorage(pullRes.updatedMap1c, updatedHistory);
            window.dispatchEvent(new Event('docencia_student_status_updated'));

            setDobleEntradaDiffs(pullRes.changes);
            setIsDobleEntradaModalOpen(true);
          }
        } catch (pullErr) {
          console.warn('Advertencia al leer modificaciones previas en Google Sheets:', pullErr);
        }
      }

      let targetFolderId = activeCourse.attendanceFolderId || activeCourse.driveFolderId;
      if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            activeCourse.name,
            undefined,
            activeToken
          );
          targetFolderId = folderStruct.attendanceFolder.id || folderStruct.mainFolder.id;
          activeCourse.attendanceFolderId = folderStruct.attendanceFolder.id;
          activeCourse.attendanceFolderUrl = folderStruct.attendanceFolder.url;
          activeCourse.gradesFolderId = folderStruct.gradesFolder.id;
          activeCourse.gradesFolderUrl = folderStruct.gradesFolder.url;
          activeCourse.driveFolderId = folderStruct.mainFolder.id;
          activeCourse.driveFolderUrl = folderStruct.mainFolder.url;
          api.updateCourse(activeCourse.id, {
            attendanceFolderId: folderStruct.attendanceFolder.id,
            attendanceFolderUrl: folderStruct.attendanceFolder.url,
            gradesFolderId: folderStruct.gradesFolder.id,
            gradesFolderUrl: folderStruct.gradesFolder.url,
            driveFolderId: folderStruct.mainFolder.id,
            driveFolderUrl: folderStruct.mainFolder.url,
          }).catch(() => {});
        } catch (_) {}
      }

      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        map1cToSync,
        historyList.filter((h) => h.courseId === activeCourse.id),
        realExistingId,
        targetFolderId,
        activeToken,
        map2cToSync
      );

      if (res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId)) {
        activeCourse.dispositionSheetId = res.spreadsheetId;
        activeCourse.dispositionSheetUrl = res.url;

        setSheetConfig({
          spreadsheetId: res.spreadsheetId,
          url: res.url,
          isLiveGoogle: true,
          lastSyncedAt: res.updatedAt,
        });

        await api.saveCourseDispositionSheet(activeCourse.id, {
          spreadsheetId: res.spreadsheetId,
          url: res.url,
          lastSyncedAt: res.updatedAt,
        });

        await api
          .updateCourse(activeCourse.id, {
            dispositionSheetId: res.spreadsheetId,
            dispositionSheetUrl: res.url,
          })
          .catch(() => {});

        if (pulledChangesCount > 0) {
          setToastMessage(`✓ ¡Sincronizado con Sheets! Se incorporaron ${pulledChangesCount} cambio(s) desde Google Sheets y se actualizó la planilla.`);
        } else {
          setToastMessage(`✓ ¡Sincronizado con Sheets! Planilla de "${activeCourse.name}" actualizada con éxito (${res.summaryRowsCount} alumnos).`);
        }
        setSheetsModalFeedback(null);
        setShowSheetsConnectModal(false);
      } else if (res.errorCode === 'UNAUTHORIZED') {
        setToastMessage('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
        setCachedAccessToken(null);
        setShowSheetsConnectModal(true);
      } else if (res.error) {
        setToastMessage(`Error al sincronizar con Sheets: ${res.error}`);
      } else {
        setToastMessage('No se pudo verificar la actualización en Google Sheets.');
      }
    } catch (err: any) {
      console.warn('Manual Google Sheets sync error:', err);
      setToastMessage(`Error de sincronización: ${err?.message || 'Error de conexión'}`);
    } finally {
      setIsSyncingSheet(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleLinkCustomSpreadsheet = async () => {
    if (!activeCourse || !customSheetInput.trim()) return;
    const extractedId = extractSpreadsheetIdFromInput(customSheetInput);
    if (!extractedId) {
      setSheetsModalFeedback('Por favor ingresa un link válido de Google Sheets (ej: https://docs.google.com/spreadsheets/d/...) o un ID válido.');
      return;
    }

    setIsLinkingCustomSheet(true);
    try {
      const url = `https://docs.google.com/spreadsheets/d/${extractedId}/edit`;
      const updatedAt = new Date().toLocaleTimeString();

      setSheetConfig({
        spreadsheetId: extractedId,
        url,
        isLiveGoogle: true,
        lastSyncedAt: updatedAt,
      });

      await api.saveCourseDispositionSheet(activeCourse.id, {
        spreadsheetId: extractedId,
        url,
        lastSyncedAt: updatedAt,
      });

      setToastMessage('✓ Hoja de Google Sheets vinculada correctamente al curso');
      setSheetsModalFeedback('✓ Hoja vinculada con éxito. Sincronizando datos...');

      const activeToken = token || getCachedAccessToken();
      const isAuthentic = activeToken && isValidGoogleAccessToken(activeToken);

      if (isAuthentic && activeToken) {
        const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
        const res = await sheetsService.syncDispositionSheet(
          activeCourse,
          currentStudents,
          dispositionMap,
          historyList.filter((h) => h.courseId === activeCourse.id),
          extractedId,
          activeCourse.attendanceFolderId,
          activeToken
        );
        if (res.isLiveGoogle) {
          setToastMessage(`✓ Planilla vinculada y sincronizada (${res.summaryRowsCount} alumnos)`);
        }
      }

      setCustomSheetInput('');
      setShowSheetsConnectModal(false);
    } catch (err: any) {
      setSheetsModalFeedback('Error al vincular la hoja: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsLinkingCustomSheet(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleSaveCustomDriveFolder = async () => {
    if (!activeCourse || !customFolderInput.trim()) return;
    setIsLinkingCustomFolder(true);
    setSheetsModalFeedback(null);
    try {
      const input = customFolderInput.trim();
      let targetFolderId = '';
      let targetFolderName = input;
      let targetFolderUrl = '';

      if (input.includes('/folders/')) {
        const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          targetFolderId = match[1];
        }
      } else if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) {
        targetFolderId = input;
      }

      const activeToken = token || getCachedAccessToken();

      if (targetFolderId) {
        if (activeToken) {
          try {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name,webViewLink,trashed`,
              {
                headers: { Authorization: `Bearer ${activeToken}` },
              }
            );
            if (res.ok) {
              const data = await res.json();
              targetFolderName = data.name || 'Carpeta Personalizada';
              targetFolderUrl = data.webViewLink || `https://drive.google.com/drive/folders/${targetFolderId}`;
            }
          } catch (_) {}
        }
        if (!targetFolderUrl) {
          targetFolderUrl = `https://drive.google.com/drive/folders/${targetFolderId}`;
        }
      } else {
        const created = await driveService.findOrCreateFolder(targetFolderName);
        targetFolderId = created.id;
        targetFolderUrl = created.url;
      }

      if (sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId)) {
        await driveService.moveFileToFolder(sheetConfig.spreadsheetId, targetFolderId);
      }

      const updatedData: Partial<Course> = {
        driveFolderId: targetFolderId,
        driveFolderUrl: targetFolderUrl,
        attendanceFolderId: targetFolderId,
        attendanceFolderUrl: targetFolderUrl,
      };

      await api.updateCourse(activeCourse.id, updatedData);
      Object.assign(activeCourse, updatedData);

      setSheetsModalFeedback(`✓ Carpeta de Drive configurada: "${targetFolderName}". Las planillas se guardarán en esta ubicación.`);
      setToastMessage(`✓ Carpeta de Drive actualizada: "${targetFolderName}"`);
      setCustomFolderInput('');
    } catch (err: any) {
      setSheetsModalFeedback('Error al configurar la carpeta de Drive: ' + (err?.message || 'Error'));
    } finally {
      setIsLinkingCustomFolder(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleOpenGoogleSheet = async () => {
    if (!activeCourse) return;

    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    if (
      sheetConfig?.spreadsheetId &&
      isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) &&
      (isS2NatCourse || sheetConfig.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
    ) {
      const openUrl = sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`;
      window.open(openUrl, '_blank');
      return;
    }

    await handleManualSheetsSync();
  };

  const handleConnectGoogleForSheets = async () => {
    await handleManualSheetsSync();
    if (sheetConfig?.url) {
      window.open(sheetConfig.url, '_blank');
    }
  };

  const handlePullFromGoogleSheet = async (showFeedback = true) => {
    if (!activeCourse) return;
    const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
    const isS2NatCourse =
      (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
      (activeCourse.grade || '').toLowerCase().includes('s2 nat');

    const sheetId =
      (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) && (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig?.spreadsheetId : undefined) ||
      (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

    if (!sheetId) {
      setToastMessage('Aviso: Primero vincula una hoja de Google Sheets a la materia para usar Doble Entrada.');
      setTimeout(() => setToastMessage(null), 4000);
      setShowSheetsConnectModal(true);
      return;
    }

    const activeToken = token || getCachedAccessToken();
    if (!activeToken || !isValidGoogleAccessToken(activeToken)) {
      setToastMessage('Para leer datos de Google Sheets en tiempo real, autoriza tu cuenta de Google.');
      setShowSheetsConnectModal(true);
      return;
    }

    setIsPullingFromSheet(true);
    try {
      const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
      const res = await sheetsService.pullDispositionSheetFromGoogle(
        activeCourse,
        currentStudents,
        dispositionMap,
        dispositionMap2c,
        sheetId,
        activeToken
      );

      if (!res.success) {
        setToastMessage(res.message);
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      if (res.changesCount > 0) {
        setDispositionMap(res.updatedMap1c);
        setDispositionMap2c(res.updatedMap2c);
        if (typeof window !== 'undefined' && activeCourse?.id) {
          localStorage.setItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(res.updatedMap1c));
          localStorage.setItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(res.updatedMap2c));
        }

        const now = new Date();
        const dateStr = formatLocalDateDMY(now);
        const timeStr = formatLocalTimeHMS(now);
        const newHistoryItems: StudentHistoryItem[] = res.changes.map((change, idx) => ({
          id: `sheet-pull-${Date.now()}-${idx}`,
          studentId: change.studentId,
          studentName: change.studentName,
          courseId: activeCourse.id,
          term: change.term,
          category: change.field === 'totalAbsences' ? 'Ausencia' : change.field === 'totalLates' ? 'Llegada tarde' : 'Disposición',
          action: `Doble Entrada Sheets (${change.termLabel}): ${change.fieldLabel} modificado en Google Sheet de ${change.oldValue} a ${change.newValue}`,
          date: dateStr,
          time: timeStr,
          timestamp: Date.now() + idx,
        }));

        const updatedHistory = deduplicateHistory([...newHistoryItems, ...historyList]);
        setHistoryList(updatedHistory);
        saveAllDispositionStorage(res.updatedMap1c, updatedHistory);

        window.dispatchEvent(new Event('docencia_student_status_updated'));

        setDobleEntradaDiffs(res.changes);
        setIsDobleEntradaModalOpen(true);
        setToastMessage(`✓ ¡Doble Entrada! Se sincronizaron ${res.changesCount} cambio(s) desde Google Sheets.`);
        setTimeout(() => setToastMessage(null), 5000);
      } else {
        if (showFeedback) {
          setToastMessage('✓ Google Sheet y App sincronizados: No hay diferencias pendientes.');
          setTimeout(() => setToastMessage(null), 3500);
        }
      }
    } catch (err: any) {
      console.error('Error in handlePullFromGoogleSheet:', err);
      setToastMessage('No se pudo leer la hoja de cálculo. Verifica permisos o conexión.');
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsPullingFromSheet(false);
    }
  };

  const handleExportAllCourseExcel = (type: 'all' | 'disposition' | 'grades' | 'history') => {
    if (!activeCourse) return;
    if (type === 'disposition') {
      exportCourseDispositionToExcel(activeCourse.name, courseStudents, dispositionMap, dispositionMap2c);
    } else if (type === 'history') {
      exportCourseClassHistoryToExcel(activeCourse.name, courseHistory);
    } else if (type === 'grades') {
      const termToExport = activeConcreteTerm;
      const termLabel = termToExport === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre';
      const catsRaw =
        localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${termToExport}`)) ||
        localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${termToExport}`) ||
        (termToExport === '1c' ? localStorage.getItem(`fds_grades_categories_${activeCourse.id}`) : null);
      const parsedCats = catsRaw ? JSON.parse(catsRaw) : DEFAULT_CATEGORIES;
      const gradesData =
        localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${termToExport}`)) ||
        localStorage.getItem(`fds_grades_data_${activeCourse.id}_${termToExport}`) ||
        (termToExport === '1c' ? localStorage.getItem(`fds_grades_data_${activeCourse.id}`) : null);
      const parsedGrades = gradesData ? JSON.parse(gradesData) : {};
      exportGradebookMatrixToExcel(activeCourse.name, termLabel, courseStudents, parsedCats, parsedGrades);
    } else {
      exportCourseDispositionToExcel(activeCourse.name, courseStudents, dispositionMap, dispositionMap2c);
      setTimeout(() => {
        exportCourseClassHistoryToExcel(activeCourse.name, courseHistory);
      }, 500);
    }
    setIsHeaderExportExcelModalOpen(false);
    setToastMessage(`✓ Archivo Excel descargado para "${activeCourse.name}"`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const getCategoriesForImport = (term: '1c' | '2c'): GradeCategory[] => {
    if (!activeCourse) return DEFAULT_CATEGORIES;
    try {
      const key = `fds_grades_categories_${activeCourse.id}_${term}`;
      const saved = localStorage.getItem(key) || (term === '1c' ? localStorage.getItem(`fds_grades_categories_${activeCourse.id}`) : null);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_CATEGORIES;
  };

  const getGradesMapForImport = (term: '1c' | '2c'): StudentGradesMap => {
    if (!activeCourse) return {};
    try {
      const key = `fds_grades_data_${activeCourse.id}_${term}`;
      const saved = localStorage.getItem(key) || (term === '1c' ? localStorage.getItem(`fds_grades_data_${activeCourse.id}`) : null);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {};
  };

  const handleApplyImportFromClassesModule = (data: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>;
    historyEntry: GradeHistoryEntry;
  }) => {
    if (!activeCourse) return;
    const isTarget2c = data.term === '2c';
    let targetCats = getCategoriesForImport(data.term);

    if (data.newSubcategoryName) {
      targetCats = targetCats.map((cat) => {
        if (cat.id === data.categoryId) {
          return {
            ...cat,
            subcategories: [
              ...cat.subcategories,
              {
                id: data.subcategoryId,
                name: data.newSubcategoryName!,
                maxScore: 10,
              },
            ],
          };
        }
        return cat;
      });
      localStorage.setItem(`fds_grades_categories_${activeCourse.id}_${data.term}`, JSON.stringify(targetCats));
      if (!isTarget2c) {
        localStorage.setItem(`fds_grades_categories_${activeCourse.id}`, JSON.stringify(targetCats));
      }
    }

    const currentTargetGrades = getGradesMapForImport(data.term);
    Object.entries(data.updates).forEach(([stId, score]) => {
      if (!currentTargetGrades[stId]) {
        currentTargetGrades[stId] = {};
      }
      currentTargetGrades[stId] = {
        ...currentTargetGrades[stId],
        [data.subcategoryId]: score,
      };
    });

    localStorage.setItem(`fds_grades_data_${activeCourse.id}_${data.term}`, JSON.stringify(currentTargetGrades));
    if (!isTarget2c) {
      localStorage.setItem(`fds_grades_data_${activeCourse.id}`, JSON.stringify(currentTargetGrades));
    }

    try {
      const hKey = `fds_grade_history_${activeCourse.id}`;
      const savedHist = localStorage.getItem(hKey);
      const parsedHist = savedHist ? JSON.parse(savedHist) : [];
      localStorage.setItem(hKey, JSON.stringify([data.historyEntry, ...parsedHist]));
    } catch (_) {}

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveTermSnapshot(userId, activeCourse.id, data.term, {
          courseId: activeCourse.id,
          term: data.term,
          termLabel: data.term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
          categories: targetCats,
          gradesMap: currentTargetGrades,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }

    window.dispatchEvent(
      new CustomEvent('fds-grades-updated', {
        detail: { term: data.term, courseId: activeCourse.id },
      })
    );

    setActiveTab('grades');
    setIsHeaderImportModalOpen(false);
    setToastMessage(`✓ ¡Se importaron y registraron ${Object.keys(data.updates).length} nota(s) con éxito!`);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const handleApplyMultiImportFromClassesModule = async (payload: {
    term: '1c' | '2c';
    updatedCategories: GradeCategory[];
    updatedGradesMap: StudentGradesMap;
    historyEntries: any[];
    attendanceUpdates: Record<
      string,
      {
        absences?: number;
        lates?: number;
        disposition?: number;
      }
    >;
    newStudentsToCreate: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    }>;
    sourceLabel: string;
    fromGradebookEvent?: boolean;
  }) => {
    if (!activeCourse) return;
    try {
      if (!payload.fromGradebookEvent) {
        const catKey = getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${payload.term}`);
        const gradesKey = getUserStorageKey(`fds_grades_data_${activeCourse.id}_${payload.term}`);
        localStorage.setItem(catKey, JSON.stringify(payload.updatedCategories));
        localStorage.setItem(gradesKey, JSON.stringify(payload.updatedGradesMap));

        if (Array.isArray(payload.historyEntries) && payload.historyEntries.length > 0) {
          const hKey = getUserStorageKey(`fds_grade_history_${activeCourse.id}`);
          const savedHist = localStorage.getItem(hKey);
          const prevHist = savedHist ? JSON.parse(savedHist) : [];
          const updatedHist = [...payload.historyEntries, ...prevHist];
          localStorage.setItem(hKey, JSON.stringify(updatedHist));
        }

        const userId = getActiveUserId();
        if (userId) {
          firestoreSync
            .saveTermSnapshot(userId, activeCourse.id, payload.term, {
              courseId: activeCourse.id,
              term: payload.term,
              termLabel: payload.term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
              categories: payload.updatedCategories,
              gradesMap: payload.updatedGradesMap,
              updatedAt: new Date().toISOString(),
            })
            .catch(() => {});
        }

        window.dispatchEvent(
          new CustomEvent('fds-grades-updated', {
            detail: { term: payload.term, courseId: activeCourse.id },
          })
        );
      }

      if (Array.isArray(payload.newStudentsToCreate) && payload.newStudentsToCreate.length > 0) {
        for (const st of payload.newStudentsToCreate) {
          const newStudentObj: Student = {
            id: st.id,
            firstName: st.firstName,
            lastName: st.lastName,
            email:
              st.email ||
              `${st.firstName.toLowerCase()}.${st.lastName.toLowerCase()}@alumno.edu.ar`.replace(
                /\s+/g,
                ''
              ),
            courseId: activeCourse.id,
            attendanceRate: 100,
            averageGrade: 0,
            notes: (st as any).notes || 'Importado desde archivo',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(st.firstName + ' ' + st.lastName)}&background=1a73e8&color=ffffff&bold=true`,
          };
          await api.createStudent(newStudentObj).catch(() => {});
        }
        onRefreshData();
      }

      const attEntries = Object.entries(payload.attendanceUpdates || {});
      if (attEntries.length > 0) {
        const userId = getActiveUserId();
        const is2c = payload.term === '2c';
        let updatedMapForEvent: Record<string, StudentDispositionData>;

        if (is2c) {
          const updatedMap2c: Record<string, StudentDispositionData> = { ...dispositionMap2c };
          attEntries.forEach(([stId, upd]) => {
            const current = updatedMap2c[stId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
            updatedMap2c[stId] = {
              ...current,
              totalAbsences: upd.absences !== undefined ? upd.absences : current.totalAbsences,
              totalLates: upd.lates !== undefined ? upd.lates : current.totalLates || 0,
              totalDisposition:
                upd.disposition !== undefined ? upd.disposition : current.totalDisposition,
            };
          });

          setDispositionMap2c(updatedMap2c);
          updatedMapForEvent = updatedMap2c;
          if (typeof window !== 'undefined') {
            setUserScopedItem('fds_disposition_data_2c', JSON.stringify(updatedMap2c));
            if (activeCourse?.id) {
              setUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(updatedMap2c));
            }
          }
          saveAllDispositionStorage(dispositionMap, historyList);
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
          triggerSheetsSync(dispositionMap, historyList, updatedMap2c);
        } else {
          const updatedMap1c: Record<string, StudentDispositionData> = { ...dispositionMap };
          attEntries.forEach(([stId, upd]) => {
            const current = updatedMap1c[stId] || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
            updatedMap1c[stId] = {
              ...current,
              totalAbsences: upd.absences !== undefined ? upd.absences : current.totalAbsences,
              totalLates: upd.lates !== undefined ? upd.lates : current.totalLates || 0,
              totalDisposition:
                upd.disposition !== undefined ? upd.disposition : current.totalDisposition,
            };
          });

          setDispositionMap(updatedMap1c);
          updatedMapForEvent = updatedMap1c;
          if (typeof window !== 'undefined' && activeCourse?.id) {
            setUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`, JSON.stringify(updatedMap1c));
          }
          saveAllDispositionStorage(updatedMap1c, historyList);
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
          triggerSheetsSync(updatedMap1c, historyList, dispositionMap2c);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('docencia_disposition_storage_change', {
              detail: {
                disposition: updatedMapForEvent,
                history: historyList,
              },
            })
          );
        }
      }

      const summaryParts: string[] = [];
      if (payload.historyEntries?.length > 0) {
        summaryParts.push(`${payload.historyEntries.length} columna(s) de notas`);
      }
      if (attEntries.length > 0) {
        summaryParts.push(`asistencia/disposición de ${attEntries.length} alumno(s)`);
      }
      if (payload.newStudentsToCreate?.length > 0) {
        summaryParts.push(`${payload.newStudentsToCreate.length} alumno(s) nuevo(s)`);
      }

      setIsHeaderImportModalOpen(false);
      setToastMessage(
        `✓ ¡Importación completada (${summaryParts.join(', ') || 'datos actualizados'}) en ${
          payload.term === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre'
        }!`
      );
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err) {
      console.error('Error aplicando importación múltiple:', err);
    }
  };

  useEffect(() => {
    const onMultiImportEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !activeCourse || detail.courseId !== activeCourse.id) return;
      handleApplyMultiImportFromClassesModule({
        ...detail,
        fromGradebookEvent: true,
      });
    };
    window.addEventListener('fds-multi-import-applied', onMultiImportEvent);
    return () => window.removeEventListener('fds-multi-import-applied', onMultiImportEvent);
  }, [activeCourse?.id, courseStudents]);

  const handleOpenInSheetsNew = async () => {
    if (!activeCourse) return;
    const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
    const headers = ['Estudiante', 'Email', 'Disposición', 'Faltas', 'Tardanzas', 'Estado'];
    const rows = currentStudents.map((st) => {
      const disp = dispositionMap[st.id];
      const fullName = `${st.lastName || ''} ${st.firstName || ''}`.trim() || st.email;
      const score = disp?.totalDisposition ?? 10;
      return [
        fullName,
        st.email,
        score,
        disp?.totalAbsences ?? 0,
        disp?.totalLates ?? 0,
        score >= 7 ? 'Regular' : 'En observación',
      ];
    });
    await copyTableToClipboard(headers, rows);
    window.open('https://sheets.new', '_blank');
    setSheetsModalFeedback('¡Datos copiados al portapapeles! Se abrió Google Sheets en una nueva pestaña. Presiona Ctrl+V para pegar.');
  };

  const handleDownloadCourseCsv = () => {
    if (!activeCourse) return;
    const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
    const currentHistory = historyList.filter((h) => h.courseId === activeCourse.id);
    sheetsService.exportDispositionCsv(activeCourse.name, currentStudents, dispositionMap, currentHistory);
    setSheetsModalFeedback('Archivo CSV descargado con éxito.');
  };

  const handleOpenCourseDriveFolder = async () => {
    if (!activeCourse || isSettingUpDriveFolder) return;
    setIsSettingUpDriveFolder(true);
    try {
      const structure = await driveService.setupCourseFolderStructure(
        activeCourse.name,
        activeCourse.driveFolderId
      );

      let dispSheetUrl: string | undefined = activeCourse.dispositionSheetUrl;
      let dispSheetId: string | undefined = activeCourse.dispositionSheetId;
      let libroSheetUrl: string | undefined = activeCourse.libroDeTemasSheetUrl;
      let libroSheetId: string | undefined = activeCourse.libroDeTemasSheetId;
      let gradesSheetUrl: string | undefined = activeCourse.gradesSheetUrl;
      let gradesSheetId: string | undefined = activeCourse.gradesSheetId;

      try {
        const dispRes = await sheetsService.syncDispositionSheet(
          activeCourse,
          courseStudents,
          dispositionMap,
          historyList,
          activeCourse.dispositionSheetId,
          structure.mainFolder.id
        );
        if (dispRes.url) dispSheetUrl = dispRes.url;
        if (dispRes.spreadsheetId && isRealGoogleSpreadsheetId(dispRes.spreadsheetId)) {
          dispSheetId = dispRes.spreadsheetId;
        }
      } catch (err) {
        console.warn('Could not auto-sync disposition sheet to Drive folder:', err);
      }

      try {
        const libroRes = await sheetsService.syncLibroDeTemasToSheet(
          {
            id: activeCourse.id,
            name: activeCourse.name,
            subject: activeCourse.subject,
            schedule: activeCourse.schedule,
          },
          undefined,
          structure.mainFolder.id,
          activeCourse.libroDeTemasSheetId
        );
        if (libroRes.url) libroSheetUrl = libroRes.url;
        if (libroRes.spreadsheetId && isRealGoogleSpreadsheetId(libroRes.spreadsheetId)) {
          libroSheetId = libroRes.spreadsheetId;
        }
      } catch (err) {
        console.warn('Could not auto-sync Libro de Temas sheet to Drive folder:', err);
      }

      try {
        const loadStoredTermGrades = (term: '1c' | '2c') => {
          const catRaw =
            localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${term}`)) ||
            localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${term}`) ||
            (term === '1c'
              ? localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}`)) ||
                localStorage.getItem(`fds_grades_categories_${activeCourse.id}`)
              : null);
          const gradesRaw =
            localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${term}`)) ||
            localStorage.getItem(`fds_grades_data_${activeCourse.id}_${term}`) ||
            (term === '1c'
              ? localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}`)) ||
                localStorage.getItem(`fds_grades_data_${activeCourse.id}`)
              : null);
          const cats: GradeCategory[] = catRaw ? JSON.parse(catRaw) : DEFAULT_CATEGORIES;
          const gMap: Record<string, Record<string, string>> = gradesRaw ? JSON.parse(gradesRaw) : {};
          return { cats, gMap, hasSavedData: Boolean(catRaw || gradesRaw) };
        };

        const term1Data = loadStoredTermGrades('1c');
        const gradesRes1c = await sheetsService.syncGradebookMatrixToSheet(
          activeCourse,
          '1c',
          courseStudents,
          term1Data.cats,
          term1Data.gMap,
          activeCourse.gradesSheetId,
          structure.mainFolder.id
        );
        if (gradesRes1c.url) gradesSheetUrl = gradesRes1c.url;
        if (gradesRes1c.spreadsheetId && isRealGoogleSpreadsheetId(gradesRes1c.spreadsheetId)) {
          gradesSheetId = gradesRes1c.spreadsheetId;
          activeCourse.gradesSheetId = gradesRes1c.spreadsheetId;
          activeCourse.gradesSheetUrl = gradesRes1c.url;
        }

        const term2Data = loadStoredTermGrades('2c');
        if (term2Data.hasSavedData && gradesSheetId) {
          await sheetsService.syncGradebookMatrixToSheet(
            activeCourse,
            '2c',
            courseStudents,
            term2Data.cats,
            term2Data.gMap,
            gradesSheetId,
            structure.mainFolder.id
          );
        }
      } catch (err) {
        console.warn('Could not auto-sync gradebook sheet to Drive folder:', err);
      }

      const updatedCourseData: Partial<Course> = {
        driveFolderId: structure.mainFolder.id,
        driveFolderUrl: structure.mainFolder.url,
        reportsFolderId: structure.reportsFolder.id,
        reportsFolderUrl: structure.reportsFolder.url,
        dispositionSheetId: dispSheetId,
        dispositionSheetUrl: dispSheetUrl,
        libroDeTemasSheetId: libroSheetId,
        libroDeTemasSheetUrl: libroSheetUrl,
        gradesSheetId: gradesSheetId,
        gradesSheetUrl: gradesSheetUrl,
      };

      api.updateCourse(activeCourse.id, updatedCourseData).catch(() => {});
      Object.assign(activeCourse, updatedCourseData);

      setCourseDriveStructure({
        ...structure,
        attendanceSheetUrl: dispSheetUrl,
        libroDeTemasSheetUrl: libroSheetUrl,
        gradesSheetUrl: gradesSheetUrl,
      });

      setDriveFolderModalOpen(true);
      setToastMessage(
        `Carpeta de Drive "${activeCourse.name}" preparada con los 3 documentos (Asistencia y Disposición, Libro de Temas, Calificaciones) y la subcarpeta Informes.`
      );
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err: any) {
      console.error('Error creating Google Drive folders:', err);
      setToastMessage('Aviso: Se intentó abrir Drive. Si no estás conectado, inicia sesión con Google.');
    } finally {
      setIsSettingUpDriveFolder(false);
    }
  };

  return {
    sheetConfig,
    setSheetConfig,
    isSyncingSheet,
    isOpeningSheet,
    showSheetsConnectModal,
    setShowSheetsConnectModal,
    sheetsModalFeedback,
    setSheetsModalFeedback,
    customSheetInput,
    setCustomSheetInput,
    isLinkingCustomSheet,
    customFolderInput,
    setCustomFolderInput,
    isLinkingCustomFolder,
    isPullingFromSheet,
    dobleEntradaDiffs,
    isDobleEntradaModalOpen,
    setIsDobleEntradaModalOpen,
    isHeaderExportExcelModalOpen,
    setIsHeaderExportExcelModalOpen,
    isHeaderImportModalOpen,
    setIsHeaderImportModalOpen,
    headerImportSourceType,
    setHeaderImportSourceType,
    headerImportContext,
    setHeaderImportContext,
    isSettingUpDriveFolder,
    driveFolderModalOpen,
    setDriveFolderModalOpen,
    courseDriveStructure,
    setCourseDriveStructure,
    triggerSheetsSync,
    handleManualSheetsSync,
    handleLinkCustomSpreadsheet,
    handleSaveCustomDriveFolder,
    handleOpenGoogleSheet,
    handleConnectGoogleForSheets,
    handlePullFromGoogleSheet,
    handleExportAllCourseExcel,
    getCategoriesForImport,
    getGradesMapForImport,
    handleApplyImportFromClassesModule,
    handleApplyMultiImportFromClassesModule,
    handleOpenInSheetsNew,
    handleDownloadCourseCsv,
    handleOpenCourseDriveFolder,
  };
}
