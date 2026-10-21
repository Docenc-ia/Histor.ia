import { useState, useEffect, useCallback } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import { sheetsService } from '../services/workspace/sheetsService';
import { sheetsSyncQueue } from '../services/workspace/sheetsSyncQueue';
import { driveService } from '../services/workspace/driveService';
import { api } from '../services/api';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';
import {
  getCachedAccessToken,
  setCachedAccessToken,
  isValidGoogleAccessToken,
  notifyGoogleSessionExpired,
  renewGoogleSessionSilently,
} from '../services/workspace/googleAuth';
import { formatLocalDateDMY, formatLocalTimeHMS } from '../utils/dateUtils';

interface SheetConfigState {
  spreadsheetId: string;
  url: string;
  isLiveGoogle: boolean;
  lastSyncedAt?: string;
}

interface UseAttendanceSyncOptions {
  activeCourse?: Course;
  students: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  setDispositionMap: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  setDispositionMap2c: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  historyList: StudentHistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<StudentHistoryItem[]>>;
  token: string | null;
  requestAccessToken: () => Promise<string>;
  onToast?: (message: string) => void;
  onShowPullDiffsModal?: (data: { count: number; changes: any[] }) => void;
}

export function useAttendanceSync({
  activeCourse,
  students,
  dispositionMap,
  setDispositionMap,
  dispositionMap2c,
  setDispositionMap2c,
  historyList,
  setHistoryList,
  token,
  requestAccessToken,
  onToast,
  onShowPullDiffsModal,
}: UseAttendanceSyncOptions) {
  const [sheetConfig, setSheetConfig] = useState<SheetConfigState | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isPullingFromSheet, setIsPullingFromSheet] = useState(false);
  const [isOpeningSheet, setIsOpeningSheet] = useState(false);
  const [showSheetsConnectModal, setShowSheetsConnectModal] = useState(false);
  const [sheetsModalFeedback, setSheetsModalFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Initialize sheet configuration on activeCourse change
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

  // Real-time synchronization with Google Sheets (debounced automatic background updates when marking)
  const triggerSheetsSync = useCallback(
    (
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

      const courseSnapshot = activeCourse;
      const map1cToUse = customMap || dispositionMap;
      const map2cToUse = customMap2c || dispositionMap2c;
      const historyToUse = customHistory
        ? customHistory.filter((h) => h.courseId === courseSnapshot.id)
        : historyList.filter((h) => h.courseId === courseSnapshot.id);
      const currentStudents = students.filter((s) => s.courseId === courseSnapshot.id);

      sheetsSyncQueue.enqueue(
        courseSnapshot.id,
        'attendance',
        async () => {
          const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
          const isS2NatCourse =
            (courseSnapshot.name || '').toLowerCase().includes('s2 nat') ||
            (courseSnapshot.grade || '').toLowerCase().includes('s2 nat');

          setIsSyncingSheet(true);
          try {
            const realExistingId =
              (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) &&
              (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
                ? sheetConfig?.spreadsheetId
                : undefined) ||
              (isRealGoogleSpreadsheetId(courseSnapshot.dispositionSheetId) &&
              (isS2NatCourse || courseSnapshot.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID)
                ? courseSnapshot.dispositionSheetId
                : undefined);

            let targetFolderId = courseSnapshot.attendanceFolderId || courseSnapshot.driveFolderId;
            if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
              try {
                const folderStruct = await driveService.setupCourseFolderStructure(
                  courseSnapshot.name,
                  undefined,
                  activeToken
                );
                targetFolderId = folderStruct.attendanceFolder.id || folderStruct.mainFolder.id;
                courseSnapshot.attendanceFolderId = folderStruct.attendanceFolder.id;
                courseSnapshot.attendanceFolderUrl = folderStruct.attendanceFolder.url;
                courseSnapshot.gradesFolderId = folderStruct.gradesFolder.id;
                courseSnapshot.gradesFolderUrl = folderStruct.gradesFolder.url;
                courseSnapshot.driveFolderId = folderStruct.mainFolder.id;
                courseSnapshot.driveFolderUrl = folderStruct.mainFolder.url;
                api.updateCourse(courseSnapshot.id, {
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
              courseSnapshot,
              currentStudents,
              map1cToUse,
              historyToUse,
              realExistingId,
              targetFolderId,
              activeToken,
              map2cToUse
            );

            const isLive = res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId);

            setSheetConfig({
              spreadsheetId: res.spreadsheetId,
              url: isLive ? res.url : (sheetConfig?.url || ''),
              isLiveGoogle: isLive,
              lastSyncedAt: res.updatedAt,
            });

            if (isLive) {
              courseSnapshot.dispositionSheetId = res.spreadsheetId;
              courseSnapshot.dispositionSheetUrl = res.url;
              api
                .saveCourseDispositionSheet(courseSnapshot.id, {
                  spreadsheetId: res.spreadsheetId,
                  url: res.url,
                  lastSyncedAt: res.updatedAt,
                })
                .catch(() => {});
              api
                .updateCourse(courseSnapshot.id, {
                  dispositionSheetId: res.spreadsheetId,
                  dispositionSheetUrl: res.url,
                })
                .catch(() => {});
            } else if (res.errorCode === 'UNAUTHORIZED') {
              notifyGoogleSessionExpired('attendance_sync_unauthorized');
            }
          } catch (err) {
            console.warn('Background sync to Google Sheets error:', err);
          } finally {
            setIsSyncingSheet(false);
          }
        },
        3000
      );
    },
    [activeCourse, token, dispositionMap, dispositionMap2c, historyList, students, sheetConfig]
  );

  // Explicit manual sync triggered by clicking "Sincronizar Sheets" / "Sincronizar Ahora"
  const handleManualSheetsSync = useCallback(async () => {
    if (!activeCourse) return;
    setIsSyncingSheet(true);
    if (onToast) onToast('Verificando conexión con Google Sheets...');

    try {
      let activeToken = token || getCachedAccessToken();
      let isAuthentic = activeToken && isValidGoogleAccessToken(activeToken);

      if (!isAuthentic) {
        // 1. First attempt silent background renewal without popup
        const silentToken = await renewGoogleSessionSilently().catch(() => null);
        if (silentToken && isValidGoogleAccessToken(silentToken)) {
          activeToken = silentToken;
          isAuthentic = true;
        } else {
          if (onToast) onToast('Solicitando autorización de tu cuenta de Google...');
          try {
            const freshToken = await requestAccessToken();
            if (freshToken && isValidGoogleAccessToken(freshToken)) {
              activeToken = freshToken;
              isAuthentic = true;
            }
          } catch (authErr: any) {
            console.warn('Google Sheets OAuth authorization error:', authErr);
            if (onToast) onToast('Se requiere autorización de Google para editar la planilla.');
            setShowSheetsConnectModal(true);
            return;
          }
        }
      }

      if (!activeToken || !isAuthentic) {
        if (onToast) onToast('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
        notifyGoogleSessionExpired('manual_sync_no_token');
        setShowSheetsConnectModal(true);
        return;
      }

      if (onToast) onToast(`Subiendo información de la app a Google Sheets para "${activeCourse.name}"...`);
      const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      const realExistingId =
        (isRealGoogleSpreadsheetId(sheetConfig?.spreadsheetId) &&
        (isS2NatCourse || sheetConfig?.spreadsheetId !== POISONED_S2_NAT_SHEET_ID)
          ? sheetConfig?.spreadsheetId
          : undefined) ||
        (isRealGoogleSpreadsheetId(activeCourse.dispositionSheetId) &&
        (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID)
          ? activeCourse.dispositionSheetId
          : undefined);

      // Ensure course Drive folder exists
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

      // App is the source of truth: Upload all data to Google Sheets (1°C, 2°C, Resumen Anual e Historial)
      const historyForCourse = historyList.filter((h) => h.courseId === activeCourse.id);
      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        dispositionMap,
        historyForCourse,
        realExistingId,
        targetFolderId,
        activeToken,
        dispositionMap2c
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

        if (onToast) onToast(`✓ Información de la materia subida a Google Sheets con éxito (${res.updatedAt})`);
      } else {
        if (res.errorCode === 'UNAUTHORIZED') {
          // Attempt silent renewal and auto-retry once
          const renewed = await renewGoogleSessionSilently().catch(() => null);
          if (renewed && isValidGoogleAccessToken(renewed)) {
            const retryRes = await sheetsService.syncDispositionSheet(
              activeCourse,
              currentStudents,
              dispositionMap,
              historyForCourse,
              realExistingId,
              targetFolderId,
              renewed,
              dispositionMap2c
            );
            if (retryRes && retryRes.isLiveGoogle) {
              if (onToast) onToast(`✓ Información de la materia subida a Google Sheets con éxito (${retryRes.updatedAt})`);
              return;
            }
          }
          notifyGoogleSessionExpired('manual_sync_unauthorized');
          if (onToast) onToast('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
          setShowSheetsConnectModal(true);
        } else {
          if (onToast) onToast(`Guardado en almacenamiento seguro. (${res.error || 'Modo local'})`);
        }
      }
    } catch (err: any) {
      console.error('Error al sincronizar con Google Sheets:', err);
      if (onToast) onToast(`Error al sincronizar: ${err?.message || 'Revisa tu conexión'}`);
    } finally {
      setIsSyncingSheet(false);
    }
  }, [
    activeCourse,
    token,
    requestAccessToken,
    students,
    sheetConfig,
    dispositionMap,
    dispositionMap2c,
    historyList,
    setDispositionMap,
    setDispositionMap2c,
    setHistoryList,
    onToast,
    onShowPullDiffsModal,
  ]);

  // Open Google Sheet in a new tab
  const handleOpenGoogleSheet = useCallback(async () => {
    if (!activeCourse) return;
    setIsOpeningSheet(true);

    try {
      const POISONED_S2_NAT_SHEET_ID = '12yId5S8Zj5KmS6Y1F-f6E6WbcBL44tKnjsxt32CqZW4';
      const isS2NatCourse =
        (activeCourse.name || '').toLowerCase().includes('s2 nat') ||
        (activeCourse.grade || '').toLowerCase().includes('s2 nat');

      let currentId =
        (sheetConfig?.isLiveGoogle && (isS2NatCourse || sheetConfig.spreadsheetId !== POISONED_S2_NAT_SHEET_ID) ? sheetConfig.spreadsheetId : undefined) ||
        (activeCourse.dispositionSheetId && (isS2NatCourse || activeCourse.dispositionSheetId !== POISONED_S2_NAT_SHEET_ID) ? activeCourse.dispositionSheetId : undefined);

      if (currentId && isRealGoogleSpreadsheetId(currentId)) {
        window.open(`https://docs.google.com/spreadsheets/d/${currentId}/edit`, '_blank', 'noopener,noreferrer');
        return;
      }

      // If not yet created, run manual sync to generate and open it
      await handleManualSheetsSync();
    } catch (err: any) {
      console.warn('Error opening Google Sheet:', err);
      if (onToast) onToast('No se pudo abrir Google Sheets. Verificá tu conexión.');
    } finally {
      setIsOpeningSheet(false);
    }
  }, [activeCourse, sheetConfig, handleManualSheetsSync, onToast]);

  return {
    sheetConfig,
    setSheetConfig,
    isSyncingSheet,
    isPullingFromSheet,
    isOpeningSheet,
    showSheetsConnectModal,
    setShowSheetsConnectModal,
    sheetsModalFeedback,
    setSheetsModalFeedback,
    triggerSheetsSync,
    handleManualSheetsSync,
    handleOpenGoogleSheet,
  };
}
