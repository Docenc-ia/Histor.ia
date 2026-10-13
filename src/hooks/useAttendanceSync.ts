import { useState, useEffect, useCallback } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import { sheetsService } from '../services/workspace/sheetsService';
import { driveService } from '../services/workspace/driveService';
import { api } from '../services/api';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';
import {
  getCachedAccessToken,
  setCachedAccessToken,
  isValidGoogleAccessToken,
  notifyGoogleSessionExpired,
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

  // Real-time synchronization with Google Sheets (automatic background updates when marking)
  const triggerSheetsSync = useCallback(
    async (
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
        const historyToUse = customHistory
          ? customHistory.filter((h) => h.courseId === activeCourse.id)
          : historyList.filter((h) => h.courseId === activeCourse.id);
        const currentStudents = students.filter((s) => s.courseId === activeCourse.id);
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

        const res = await sheetsService.syncDispositionSheet(
          activeCourse,
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
          notifyGoogleSessionExpired('attendance_sync_unauthorized');
        }
      } catch (err) {
        console.warn('Background sync to Google Sheets error:', err);
      } finally {
        setIsSyncingSheet(false);
      }
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

      if (!activeToken || !isAuthentic) {
        if (onToast) onToast('Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.');
        notifyGoogleSessionExpired('manual_sync_no_token');
        setShowSheetsConnectModal(true);
        return;
      }

      if (onToast) onToast(`Sincronizando con Google Sheets para "${activeCourse.name}"...`);
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

      let map1cToSync = dispositionMap;
      let map2cToSync = dispositionMap2c;
      let pulledChangesCount = 0;

      // Double entry (Pull): Check if teacher edited in Google Sheets directly
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
              date: dateStr,
              time: timeStr,
              timestamp: now.getTime(),
              category: change.field === 'totalAbsences' ? 'Ausencia' : change.field === 'totalLates' ? 'Llegada tarde' : 'Disposición',
              action: `Actualizado desde Google Sheets (${change.termLabel}): ${change.fieldLabel} cambió de ${change.oldValue} a ${change.newValue}`,
              messageSent: true,
              notificationMethod: 'none',
              omitNotification: true,
            }));

            setHistoryList((prev) => [...newHistoryItems, ...prev]);

            if (onShowPullDiffsModal) {
              onShowPullDiffsModal({
                count: pullRes.changesCount,
                changes: pullRes.changes,
              });
            }
          }
        } catch (pullErr) {
          console.warn('Advertencia al leer modificaciones previas en Google Sheets:', pullErr);
        }
      }

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

      const historyForCourse = historyList.filter((h) => h.courseId === activeCourse.id);
      const res = await sheetsService.syncDispositionSheet(
        activeCourse,
        currentStudents,
        map1cToSync,
        historyForCourse,
        realExistingId,
        targetFolderId,
        activeToken,
        map2cToSync
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

        const msgSuccess =
          pulledChangesCount > 0
            ? `¡Sincronizado! Se incorporaron ${pulledChangesCount} cambio(s) desde Sheets y se actualizó la planilla.`
            : `¡Planilla de Google Sheets sincronizada con éxito! (${res.updatedAt})`;
        if (onToast) onToast(msgSuccess);
      } else {
        if (res.errorCode === 'UNAUTHORIZED') {
          setCachedAccessToken(null);
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
