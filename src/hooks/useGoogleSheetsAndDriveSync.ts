import React, { useState, useEffect } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import { GradeCategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../types/grades';
import { GradeHistoryEntry } from '../utils/excelExport';
import {
  api,
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  saveAllDispositionStorage,
} from '../services/api';
import { getCachedAccessToken, isValidGoogleAccessToken } from '../services/workspace/googleAuth';
import { sheetsService } from '../services/workspace/sheetsService';
import {
  driveService,
  CourseFolderStructure,
  getDirectDriveFolderUrl,
} from '../services/workspace/driveService';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';

interface UseGoogleSheetsAndDriveSyncParams {
  activeCourse?: Course;
  courseStudents: Student[];
  dispositionMap: Record<string, StudentDispositionData>;
  setDispositionMap: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  dispositionMap2c: Record<string, StudentDispositionData>;
  setDispositionMap2c: React.Dispatch<React.SetStateAction<Record<string, StudentDispositionData>>>;
  historyList: StudentHistoryItem[];
  token: string | null;
  requestAccessToken: () => Promise<string | null>;
  getStudentMetrics: (studentId: string, targetTerm?: '1c' | '2c' | 'annual' | 'all') => StudentDispositionData;
  onRefreshData: () => void;
  setActiveTab: (tab: 'roster' | 'libro_temas' | 'grades' | 'history') => void;
  setToastMessage: (msg: string | null) => void;
}

export function useGoogleSheetsAndDriveSync({
  activeCourse,
  courseStudents,
  dispositionMap,
  setDispositionMap,
  dispositionMap2c,
  setDispositionMap2c,
  historyList,
  token,
  requestAccessToken,
  getStudentMetrics,
  onRefreshData,
  setActiveTab,
  setToastMessage,
}: UseGoogleSheetsAndDriveSyncParams) {
  // Modal de Importar desde Excel / Sheets / CSV en Asistencia y Disposición
  const [isHeaderImportModalOpen, setIsHeaderImportModalOpen] = useState(false);
  const [headerImportSourceType, setHeaderImportSourceType] = useState<'file' | 'csv' | 'sheets' | 'paste'>('file');
  const [headerImportContext, setHeaderImportContext] = useState<'grades' | 'attendance'>('attendance');

  // Google Drive course folder structure state
  const [isSettingUpDriveFolder, setIsSettingUpDriveFolder] = useState<boolean>(false);
  const [driveFolderModalOpen, setDriveFolderModalOpen] = useState<boolean>(false);
  const [courseDriveStructure, setCourseDriveStructure] = useState<CourseFolderStructure | null>(null);

  const getCategoriesForImport = (term: '1c' | '2c'): GradeCategory[] => {
    if (!activeCourse) return DEFAULT_CATEGORIES;
    try {
      const key = `fds_grades_categories_${activeCourse.id}_${term}`;
      const saved =
        getUserScopedItem(key) ||
        (term === '1c' ? getUserScopedItem(`fds_grades_categories_${activeCourse.id}`) : null);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_CATEGORIES;
  };

  const getGradesMapForImport = (term: '1c' | '2c'): StudentGradesMap => {
    if (!activeCourse) return {};
    try {
      const key = `fds_grades_data_${activeCourse.id}_${term}`;
      const saved =
        getUserScopedItem(key) ||
        (term === '1c' ? getUserScopedItem(`fds_grades_data_${activeCourse.id}`) : null);
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
      setUserScopedItem(`fds_grades_categories_${activeCourse.id}_${data.term}`, JSON.stringify(targetCats));
      if (!isTarget2c) {
        setUserScopedItem(`fds_grades_categories_${activeCourse.id}`, JSON.stringify(targetCats));
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

    setUserScopedItem(`fds_grades_data_${activeCourse.id}_${data.term}`, JSON.stringify(currentTargetGrades));
    if (!isTarget2c) {
      setUserScopedItem(`fds_grades_data_${activeCourse.id}`, JSON.stringify(currentTargetGrades));
    }

    try {
      const hKey = `fds_grade_history_${activeCourse.id}`;
      const savedHist = getUserScopedItem(hKey);
      const parsedHist = savedHist ? JSON.parse(savedHist) : [];
      setUserScopedItem(hKey, JSON.stringify([data.historyEntry, ...parsedHist]));
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
            const current = updatedMap2c[stId] || getStudentMetrics(stId, '2c');
            updatedMap2c[stId] = {
              ...current,
              courseId: activeCourse.id,
              totalAbsences: upd.absences !== undefined ? upd.absences : current.totalAbsences,
              totalLates: upd.lates !== undefined ? upd.lates : current.totalLates || 0,
              totalDisposition:
                upd.disposition !== undefined ? upd.disposition : current.totalDisposition,
            };
          });

          setDispositionMap2c(updatedMap2c);
          updatedMapForEvent = updatedMap2c;
          if (typeof window !== 'undefined' && activeCourse?.id) {
            setUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`, JSON.stringify(updatedMap2c));
          }
          saveAllDispositionStorage(dispositionMap, historyList, { courseId: activeCourse.id });
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
        } else {
          const updatedMap1c: Record<string, StudentDispositionData> = { ...dispositionMap };
          attEntries.forEach(([stId, upd]) => {
            const current = updatedMap1c[stId] || getStudentMetrics(stId, '1c');
            updatedMap1c[stId] = {
              ...current,
              courseId: activeCourse.id,
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
          saveAllDispositionStorage(updatedMap1c, historyList, { courseId: activeCourse.id });
          if (userId) {
            firestoreSync.syncCompactDispositionNow(userId, false);
          }
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

  const handleOpenCourseDriveFolder = async () => {
    if (!activeCourse || isSettingUpDriveFolder) return;
    setIsSettingUpDriveFolder(true);
    try {
      let activeToken = token || getCachedAccessToken();
      if (!activeToken || !isValidGoogleAccessToken(activeToken)) {
        try {
          const freshToken = await requestAccessToken();
          if (freshToken && isValidGoogleAccessToken(freshToken)) {
            activeToken = freshToken;
          }
        } catch (_) {}
      }

      const structure = await driveService.setupCourseFolderStructure(
        activeCourse.name,
        activeCourse.driveFolderId,
        activeToken || undefined
      );

      let gradesSheetUrl: string | undefined = activeCourse.gradesSheetUrl;
      let gradesSheetId: string | undefined = activeCourse.gradesSheetId;

      try {
        const loadStoredTermGrades = (term: '1c' | '2c') => {
          const catRaw =
            getUserScopedItem(`fds_grades_categories_${activeCourse.id}_${term}`) ||
            (term === '1c' ? getUserScopedItem(`fds_grades_categories_${activeCourse.id}`) : null);
          const gradesRaw =
            getUserScopedItem(`fds_grades_data_${activeCourse.id}_${term}`) ||
            (term === '1c' ? getUserScopedItem(`fds_grades_data_${activeCourse.id}`) : null);
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
          structure.gradesFolder.id,
          activeToken || undefined
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
            structure.gradesFolder.id,
            activeToken || undefined
          );
        }
      } catch (err) {
        console.warn('Could not auto-sync gradebook sheet to Drive folder:', err);
      }

      const mainFolderDirectUrl = getDirectDriveFolderUrl(
        structure.mainFolder.id,
        structure.mainFolder.url
      );

      const updatedCourseData: Partial<Course> = {
        driveFolderId: structure.mainFolder.id,
        driveFolderUrl: mainFolderDirectUrl,
        gradesFolderId: structure.gradesFolder.id,
        gradesFolderUrl: getDirectDriveFolderUrl(structure.gradesFolder.id, structure.gradesFolder.url),
        attendanceFolderId: structure.attendanceFolder.id,
        attendanceFolderUrl: getDirectDriveFolderUrl(structure.attendanceFolder.id, structure.attendanceFolder.url),
        dispositionFolderId: structure.dispositionFolder.id,
        dispositionFolderUrl: getDirectDriveFolderUrl(structure.dispositionFolder.id, structure.dispositionFolder.url),
        libroDeTemasFolderId: structure.libroDeTemasFolder.id,
        libroDeTemasFolderUrl: getDirectDriveFolderUrl(structure.libroDeTemasFolder.id, structure.libroDeTemasFolder.url),
        reportsFolderId: structure.reportsFolder.id,
        reportsFolderUrl: getDirectDriveFolderUrl(structure.reportsFolder.id, structure.reportsFolder.url),
        incidentsFolderId: structure.incidentsFolder.id,
        incidentsFolderUrl: getDirectDriveFolderUrl(structure.incidentsFolder.id, structure.incidentsFolder.url),
        gradesSheetId: gradesSheetId,
        gradesSheetUrl: gradesSheetUrl,
      };

      api.updateCourse(activeCourse.id, updatedCourseData).catch(() => {});
      Object.assign(activeCourse, updatedCourseData);

      setCourseDriveStructure({
        ...structure,
        mainFolder: {
          ...structure.mainFolder,
          url: mainFolderDirectUrl,
        },
        gradesSheetUrl: gradesSheetUrl,
      });

      setDriveFolderModalOpen(true);
      setToastMessage(
        `Carpeta "${structure.mainFolder.name}" lista en Google Drive con las 6 subcarpetas (Calificaciones, Asistencia, Disposición, Libro de Temas, Informes e Historial de Incidencias).`
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
    getCategoriesForImport,
    getGradesMapForImport,
    handleApplyImportFromClassesModule,
    handleApplyMultiImportFromClassesModule,
    handleOpenCourseDriveFolder,
  };
}
