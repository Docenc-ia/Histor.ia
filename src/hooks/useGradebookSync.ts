/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { Student } from '../types';
import { GradeCategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../types/grades';
import type { PreliminaryValuationRecord } from '../components/modules/PreliminaryValuationModal';
import { GradeHistoryEntry } from '../utils/excelExport';
import { sheetsService } from '../services/workspace/sheetsService';
import { sheetsSyncQueue } from '../services/workspace/sheetsSyncQueue';
import {
  firestoreSync,
  getActiveUserId,
  subscribeToCloudSyncStatus,
  CloudSyncStatusInfo,
  registerCloudFlushHandler,
  notifyDebouncedSyncPending,
} from '../services/firestoreSync';
import { useWorkspaceAuth } from '../context/WorkspaceAuthContext';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';
import { getUserStorageKey } from '../services/api';
import {
  getCourseCachedItem,
  setCourseCachedItem,
  touchCourseDataLru,
  capCourseHistoryEntries,
} from '../utils/lruCourseCache';

export type GradebookTerm = '1c' | '2c' | 'annual';

export interface UseGradebookSyncParams {
  courseId: string;
  courseName: string;
  students: Student[];
  currentTerm: GradebookTerm;
  driveFolderId?: string;
  onExternalTermSwitch?: (term: '1c' | '2c') => void;
}

export function useGradebookSync({
  courseId,
  courseName,
  students,
  currentTerm,
  driveFolderId,
  onExternalTermSwitch,
}: UseGradebookSyncParams) {
  const is2c = currentTerm === '2c';
  const { token } = useWorkspaceAuth();

  const getCatKey = (t: '1c' | '2c') => getUserStorageKey(`fds_grades_categories_${courseId}_${t}`);
  const getGradesKey = (t: '1c' | '2c') => getUserStorageKey(`fds_grades_data_${courseId}_${t}`);
  const getCalcKey = (t: '1c' | '2c') => getUserStorageKey(`fds_grades_final_calc_${courseId}_${t}`);
  const getPreliminaryValuationKey = (t: '1c' | '2c') =>
    getUserStorageKey(`fds_preliminary_valuation_${courseId}_${t}`);
  const getTermUpdatedAtKey = (t: '1c' | '2c') =>
    getUserStorageKey(`fds_grades_updated_at_${courseId}_${t}`);
  const STORAGE_KEY_ANNUAL_OVERRIDES = getUserStorageKey(`fds_grades_annual_override_${courseId}`);

  // 1° Cuatrimestre Categories
  const [categories1c, setCategories1c] = useState<GradeCategory[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          getCourseCachedItem(courseId, getCatKey('1c')) ||
          getCourseCachedItem(courseId, `fds_grades_categories_${courseId}`);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return DEFAULT_CATEGORIES;
  });

  // 1° Cuatrimestre Grades Map
  const [gradesMap1c, setGradesMap1c] = useState<StudentGradesMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          getCourseCachedItem(courseId, getGradesKey('1c')) ||
          getCourseCachedItem(courseId, `fds_grades_data_${courseId}`);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // 1° Cuatrimestre Final Calc Mode
  const [overallCalc1c, setOverallCalc1c] = useState<'average_of_categories' | 'manual_final'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          getCourseCachedItem(courseId, getCalcKey('1c')) ||
          getCourseCachedItem(courseId, `fds_grades_final_calc_${courseId}`);
        if (saved === 'manual_final' || saved === 'average_of_categories') return saved;
      } catch (_) {}
    }
    return 'manual_final';
  });

  // 2° Cuatrimestre Categories
  const [categories2c, setCategories2c] = useState<GradeCategory[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getCatKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return DEFAULT_CATEGORIES.map((cat) => ({
      ...cat,
      id: `c2-${cat.id}`,
      subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
    }));
  });

  // 2° Cuatrimestre Grades Map
  const [gradesMap2c, setGradesMap2c] = useState<StudentGradesMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getGradesKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // 2° Cuatrimestre Final Calc Mode
  const [overallCalc2c, setOverallCalc2c] = useState<'average_of_categories' | 'manual_final'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getCalcKey('2c'));
        if (saved === 'manual_final' || saved === 'average_of_categories') return saved;
      } catch (_) {}
    }
    return 'manual_final';
  });

  // Annual overrides
  const [annualOverrides, setAnnualOverrides] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, STORAGE_KEY_ANNUAL_OVERRIDES);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // Preliminary Valuations (TEA / TEP / TED)
  const [preliminaryValuation1c, setPreliminaryValuation1c] = useState<PreliminaryValuationRecord | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getPreliminaryValuationKey('1c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return null;
  });

  const [preliminaryValuation2c, setPreliminaryValuation2c] = useState<PreliminaryValuationRecord | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getPreliminaryValuationKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return null;
  });

  const [gradeHistory, setGradeHistory] = useState<GradeHistoryEntry[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = getCourseCachedItem(courseId, getUserStorageKey(`fds_grade_history_${courseId}`));
        if (saved) return capCourseHistoryEntries(JSON.parse(saved));
      } catch (_) {}
    }
    return [];
  });

  // Re-hydrate local gradebook state immediately when switching courseId so previous course grades never leak
  const prevCourseIdRef = useRef(courseId);
  useEffect(() => {
    if (courseId) {
      touchCourseDataLru(courseId);
    }
    if (prevCourseIdRef.current === courseId) return;
    prevCourseIdRef.current = courseId;
    if (typeof window === 'undefined') return;

    try {
      const savedCat1 =
        getCourseCachedItem(courseId, getCatKey('1c')) ||
        getCourseCachedItem(courseId, `fds_grades_categories_${courseId}`);
      setCategories1c(savedCat1 ? JSON.parse(savedCat1) : DEFAULT_CATEGORIES);
    } catch (_) {
      setCategories1c(DEFAULT_CATEGORIES);
    }

    try {
      const savedGrades1 =
        getCourseCachedItem(courseId, getGradesKey('1c')) ||
        getCourseCachedItem(courseId, `fds_grades_data_${courseId}`);
      setGradesMap1c(savedGrades1 ? JSON.parse(savedGrades1) : {});
    } catch (_) {
      setGradesMap1c({});
    }

    try {
      const savedCalc1 =
        getCourseCachedItem(courseId, getCalcKey('1c')) ||
        getCourseCachedItem(courseId, `fds_grades_final_calc_${courseId}`);
      setOverallCalc1c(
        savedCalc1 === 'average_of_categories' || savedCalc1 === 'manual_final'
          ? savedCalc1
          : 'manual_final'
      );
    } catch (_) {
      setOverallCalc1c('manual_final');
    }

    const default2cCats = DEFAULT_CATEGORIES.map((cat) => ({
      ...cat,
      id: `c2-${cat.id}`,
      subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
    }));
    try {
      const savedCat2 = getCourseCachedItem(courseId, getCatKey('2c'));
      setCategories2c(savedCat2 ? JSON.parse(savedCat2) : default2cCats);
    } catch (_) {
      setCategories2c(default2cCats);
    }

    try {
      const savedGrades2 = getCourseCachedItem(courseId, getGradesKey('2c'));
      setGradesMap2c(savedGrades2 ? JSON.parse(savedGrades2) : {});
    } catch (_) {
      setGradesMap2c({});
    }

    try {
      const savedCalc2 = getCourseCachedItem(courseId, getCalcKey('2c'));
      setOverallCalc2c(
        savedCalc2 === 'average_of_categories' || savedCalc2 === 'manual_final'
          ? savedCalc2
          : 'manual_final'
      );
    } catch (_) {
      setOverallCalc2c('manual_final');
    }

    try {
      const savedOverrides = getCourseCachedItem(courseId, STORAGE_KEY_ANNUAL_OVERRIDES);
      setAnnualOverrides(savedOverrides ? JSON.parse(savedOverrides) : {});
    } catch (_) {
      setAnnualOverrides({});
    }

    try {
      const savedPv1 = getCourseCachedItem(courseId, getPreliminaryValuationKey('1c'));
      setPreliminaryValuation1c(savedPv1 ? JSON.parse(savedPv1) : null);
    } catch (_) {
      setPreliminaryValuation1c(null);
    }

    try {
      const savedPv2 = getCourseCachedItem(courseId, getPreliminaryValuationKey('2c'));
      setPreliminaryValuation2c(savedPv2 ? JSON.parse(savedPv2) : null);
    } catch (_) {
      setPreliminaryValuation2c(null);
    }

    try {
      const savedHist = getCourseCachedItem(courseId, getUserStorageKey(`fds_grade_history_${courseId}`));
      setGradeHistory(savedHist ? capCourseHistoryEntries(JSON.parse(savedHist)) : []);
    } catch (_) {
      setGradeHistory([]);
    }
  }, [courseId]);

  const [isSavingSheets, setIsSavingSheets] = useState(false);
  const [sheetsSavedInfo, setSheetsSavedInfo] = useState<{
    url?: string;
    tabName: string;
    isLiveGoogle: boolean;
    pulledCount?: number;
  } | null>(null);

  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatusInfo>({
    state: 'synced',
    lastSyncedAt: null,
    pendingCount: 0,
  });

  useEffect(() => {
    return subscribeToCloudSyncStatus((st) => setCloudStatus(st));
  }, []);

  const cloudSyncTimerRef = useRef<Record<string, any>>({});
  const pendingCloudPayloadsRef = useRef<
    Record<string, { userId: string; courseId: string; term: string; payload: any }>
  >({});

  const persistTermSnapshotToCloud = (
    term: '1c' | '2c',
    cats: GradeCategory[],
    gMap: StudentGradesMap,
    extra?: Record<string, any>
  ) => {
    const userId = getActiveUserId();
    if (!userId || !courseId) return;
    const nowIso = new Date().toISOString();
    if (typeof window !== 'undefined') {
      setCourseCachedItem(courseId, getTermUpdatedAtKey(term), nowIso);
    }
    const timerKey = `grades_${courseId}_${term}`;
    if (cloudSyncTimerRef.current[timerKey]) {
      clearTimeout(cloudSyncTimerRef.current[timerKey]);
    }
    const payload = {
      courseId,
      term,
      termLabel: term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
      categories: cats,
      gradesMap: gMap,
      overallCalc: term === '2c' ? overallCalc2c : overallCalc1c,
      ...(extra || {}),
      updatedAt: nowIso,
    };
    pendingCloudPayloadsRef.current[timerKey] = { userId, courseId, term, payload };
    notifyDebouncedSyncPending(timerKey, true);
    cloudSyncTimerRef.current[timerKey] = setTimeout(() => {
      delete pendingCloudPayloadsRef.current[timerKey];
      delete cloudSyncTimerRef.current[timerKey];
      notifyDebouncedSyncPending(timerKey, false);
      firestoreSync.saveTermSnapshot(userId, courseId, term, payload).catch(() => {});
    }, 400);
  };

  useEffect(() => {
    const flushAllGradebook = () => {
      Object.entries(pendingCloudPayloadsRef.current).forEach(([key, item]) => {
        if (cloudSyncTimerRef.current[key]) {
          clearTimeout(cloudSyncTimerRef.current[key]);
          delete cloudSyncTimerRef.current[key];
        }
        delete pendingCloudPayloadsRef.current[key];
        notifyDebouncedSyncPending(key, false);
        firestoreSync.saveTermSnapshot(item.userId, item.courseId, item.term, item.payload).catch(() => {});
      });
    };

    const unregFlush = registerCloudFlushHandler(`gradebook_${courseId}`, flushAllGradebook);
    return () => {
      unregFlush();
      flushAllGradebook();
    };
  }, [courseId]);

  const enqueueBackgroundSheetsSync = (
    targetTerm: '1c' | '2c',
    targetCats: GradeCategory[],
    targetGrades: StudentGradesMap
  ) => {
    if (!token) return;
    sheetsSyncQueue.enqueue(
      courseId,
      'grades',
      async () => {
        try {
          const realId = await sheetsService.resolveGradesSpreadsheetId(
            courseId,
            courseName,
            undefined,
            driveFolderId,
            token || undefined
          );
          if (!realId || !isRealGoogleSpreadsheetId(realId)) return;
          const res = await sheetsService.syncGradebookMatrixToSheet(
            { id: courseId, name: courseName },
            targetTerm,
            students,
            targetCats,
            targetGrades,
            realId,
            driveFolderId,
            token
          );
          if (res.isLiveGoogle && res.updatedAt) {
            setSheetsSavedInfo({
              url: res.url,
              tabName: targetTerm === '2c' ? '2° Cuatrimestre' : '1° Cuatrimestre',
              isLiveGoogle: true,
            });
          }
        } catch (_) {}
      },
      3500
    );
  };

  const handleSyncCuatrimestreWithSheets = async () => {
    if (currentTerm === 'annual') return;
    setIsSavingSheets(true);
    setSheetsSavedInfo(null);
    const termToSync = currentTerm as '1c' | '2c';
    const catsToSync = is2c ? categories2c : categories1c;
    let gradesToSync = is2c ? { ...gradesMap2c } : { ...gradesMap1c };

    try {
      const realExistingId = await sheetsService.resolveGradesSpreadsheetId(
        courseId,
        courseName,
        undefined,
        driveFolderId,
        token || undefined
      );

      let pulledCount = 0;

      if (realExistingId) {
        try {
          const pullRes = await sheetsService.pullGradebookMatrixFromGoogle(
            { id: courseId, name: courseName },
            termToSync,
            students,
            catsToSync,
            gradesToSync,
            realExistingId,
            token || undefined
          );

          if (pullRes.success && pullRes.changesCount > 0) {
            pulledCount = pullRes.changesCount;
            gradesToSync = pullRes.updatedGradesMap;
            if (is2c) {
              setGradesMap2c(gradesToSync);
              setCourseCachedItem(courseId, getGradesKey('2c'), JSON.stringify(gradesToSync));
            } else {
              setGradesMap1c(gradesToSync);
              setCourseCachedItem(courseId, getGradesKey('1c'), JSON.stringify(gradesToSync));
            }
          }
        } catch (pullErr) {
          console.warn('Error al consultar cambios de notas en Sheets:', pullErr);
        }
      }

      const res = await sheetsService.syncGradebookMatrixToSheet(
        { id: courseId, name: courseName },
        termToSync,
        students,
        catsToSync,
        gradesToSync,
        realExistingId,
        driveFolderId,
        token || undefined
      );

      if (res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId) && typeof window !== 'undefined') {
        setCourseCachedItem(
          courseId,
          `fds_grades_sheet_${courseId}`,
          JSON.stringify({
            spreadsheetId: res.spreadsheetId,
            url: res.url,
            lastSyncedAt: res.updatedAt,
          })
        );
      }

      const userId = getActiveUserId();
      if (userId) {
        firestoreSync
          .saveTermSnapshot(userId, courseId, termToSync, {
            courseId,
            term: termToSync,
            termLabel: termToSync === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
            categories: catsToSync,
            gradesMap: gradesToSync,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }

      setSheetsSavedInfo({
        url: res.url,
        tabName: res.tabName,
        isLiveGoogle: res.isLiveGoogle,
        pulledCount,
      });
    } catch (err) {
      console.warn('Error sincronizando notas con sheets:', err);
    } finally {
      setIsSavingSheets(false);
    }
  };

  const saveCategories = (newCategories: GradeCategory[]) => {
    if (is2c) {
      setCategories2c(newCategories);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getCatKey('2c'), JSON.stringify(newCategories));
      }
      persistTermSnapshotToCloud('2c', newCategories, gradesMap2c);
      enqueueBackgroundSheetsSync('2c', newCategories, gradesMap2c);
    } else {
      setCategories1c(newCategories);
      if (typeof window !== 'undefined') {
        const serialized = JSON.stringify(newCategories);
        setCourseCachedItem(courseId, getCatKey('1c'), serialized);
        setCourseCachedItem(courseId, `fds_grades_categories_${courseId}`, serialized);
      }
      persistTermSnapshotToCloud('1c', newCategories, gradesMap1c);
      enqueueBackgroundSheetsSync('1c', newCategories, gradesMap1c);
    }
  };

  const saveGrades = (newGrades: StudentGradesMap) => {
    if (is2c) {
      setGradesMap2c(newGrades);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getGradesKey('2c'), JSON.stringify(newGrades));
      }
      persistTermSnapshotToCloud('2c', categories2c, newGrades);
      enqueueBackgroundSheetsSync('2c', categories2c, newGrades);
    } else {
      setGradesMap1c(newGrades);
      if (typeof window !== 'undefined') {
        const serialized = JSON.stringify(newGrades);
        setCourseCachedItem(courseId, getGradesKey('1c'), serialized);
        setCourseCachedItem(courseId, `fds_grades_data_${courseId}`, serialized);
      }
      persistTermSnapshotToCloud('1c', categories1c, newGrades);
      enqueueBackgroundSheetsSync('1c', categories1c, newGrades);
    }
  };

  const saveOverallCalc = (type: 'average_of_categories' | 'manual_final') => {
    if (is2c) {
      setOverallCalc2c(type);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getCalcKey('2c'), type);
      }
      persistTermSnapshotToCloud('2c', categories2c, gradesMap2c, { overallCalc: type });
    } else {
      setOverallCalc1c(type);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getCalcKey('1c'), type);
        setCourseCachedItem(courseId, `fds_grades_final_calc_${courseId}`, type);
      }
      persistTermSnapshotToCloud('1c', categories1c, gradesMap1c, { overallCalc: type });
    }
  };

  const saveAnnualOverride = (studentId: string, val: string) => {
    const updated = { ...annualOverrides };
    if (!val || val.trim() === '') {
      delete updated[studentId];
    } else {
      updated[studentId] = val.trim();
    }
    setAnnualOverrides(updated);
    if (typeof window !== 'undefined') {
      setCourseCachedItem(courseId, STORAGE_KEY_ANNUAL_OVERRIDES, JSON.stringify(updated));
    }
    persistTermSnapshotToCloud('1c', categories1c, gradesMap1c, { annualOverrides: updated });
  };

  const handleCopyCategoriesFrom1c = () => {
    const cloned = categories1c.map((cat, catIdx) => ({
      ...cat,
      id: `c2-${Date.now()}-${catIdx}-${cat.id}`,
      subcategories: cat.subcategories.map((sub, subIdx) => ({
        ...sub,
        id: `c2-${Date.now()}-${subIdx}-${sub.id}`,
      })),
    }));
    saveCategories(cloned);
  };

  const handleSavePreliminaryValuation = (record: PreliminaryValuationRecord) => {
    if (is2c) {
      setPreliminaryValuation2c(record);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getPreliminaryValuationKey('2c'), JSON.stringify(record));
      }
      persistTermSnapshotToCloud('2c', categories2c, gradesMap2c, { preliminaryValuation: record });
    } else {
      setPreliminaryValuation1c(record);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getPreliminaryValuationKey('1c'), JSON.stringify(record));
      }
      persistTermSnapshotToCloud('1c', categories1c, gradesMap1c, { preliminaryValuation: record });
    }
  };

  const handleApplyImportedGrades = (data: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>;
    historyEntry: GradeHistoryEntry;
  }) => {
    const isTarget2c = data.term === '2c';
    let targetCats = isTarget2c ? [...categories2c] : [...categories1c];

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
      saveCategories(targetCats);
    }

    const currentTargetGrades = isTarget2c ? { ...gradesMap2c } : { ...gradesMap1c };
    Object.entries(data.updates).forEach(([stId, score]) => {
      if (!currentTargetGrades[stId]) {
        currentTargetGrades[stId] = {};
      }
      currentTargetGrades[stId] = {
        ...currentTargetGrades[stId],
        [data.subcategoryId]: score,
      };
    });

    saveGrades(currentTargetGrades);

    const updatedHistory = capCourseHistoryEntries([data.historyEntry, ...gradeHistory]);
    setGradeHistory(updatedHistory);
    if (typeof window !== 'undefined') {
      setCourseCachedItem(
        courseId,
        getUserStorageKey(`fds_grade_history_${courseId}`),
        JSON.stringify(updatedHistory)
      );
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveTermSnapshot(userId, courseId, data.term, {
          courseId,
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
        detail: { term: data.term, courseId },
      })
    );
  };

  const handleApplyMultiImport = (payload: any) => {
    const isTarget2c = payload.term === '2c';
    if (isTarget2c) {
      setCategories2c(payload.updatedCategories);
      setGradesMap2c(payload.updatedGradesMap);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getCatKey('2c'), JSON.stringify(payload.updatedCategories));
        setCourseCachedItem(courseId, getGradesKey('2c'), JSON.stringify(payload.updatedGradesMap));
      }
    } else {
      setCategories1c(payload.updatedCategories);
      setGradesMap1c(payload.updatedGradesMap);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(courseId, getCatKey('1c'), JSON.stringify(payload.updatedCategories));
        setCourseCachedItem(courseId, getGradesKey('1c'), JSON.stringify(payload.updatedGradesMap));
      }
    }

    if (Array.isArray(payload.historyEntries) && payload.historyEntries.length > 0) {
      const updatedHistory = capCourseHistoryEntries([...payload.historyEntries, ...gradeHistory]);
      setGradeHistory(updatedHistory);
      if (typeof window !== 'undefined') {
        setCourseCachedItem(
          courseId,
          getUserStorageKey(`fds_grade_history_${courseId}`),
          JSON.stringify(updatedHistory)
        );
      }
    }

    const userId = getActiveUserId();
    if (userId) {
      firestoreSync
        .saveTermSnapshot(userId, courseId, payload.term, {
          courseId,
          term: payload.term,
          termLabel: payload.term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
          categories: payload.updatedCategories,
          gradesMap: payload.updatedGradesMap,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }

    enqueueBackgroundSheetsSync(payload.term, payload.updatedCategories, payload.updatedGradesMap);

    window.dispatchEvent(
      new CustomEvent('fds-grades-updated', {
        detail: { term: payload.term, courseId },
      })
    );

    window.dispatchEvent(
      new CustomEvent('fds-multi-import-applied', {
        detail: {
          courseId,
          ...payload,
        },
      })
    );
  };

  // Auto-load & recover saved gradebook snapshots from Firestore on mount or course switch
  useEffect(() => {
    let isMounted = true;
    const userId = getActiveUserId();
    if (!userId || !courseId) return;

    firestoreSync
      .loadTermSnapshots(userId, courseId)
      .then((snapshots) => {
        if (!isMounted || !snapshots) return;

        const snap1c = snapshots['1c'];
        if (snap1c) {
          const local1cUpdated =
            typeof window !== 'undefined'
              ? getCourseCachedItem(courseId, getTermUpdatedAtKey('1c')) || ''
              : '';
          const isCloud1cNewer = !local1cUpdated || !snap1c.updatedAt || snap1c.updatedAt >= local1cUpdated;

          if (Array.isArray(snap1c.categories) && snap1c.categories.length > 0) {
            setCategories1c((prev) => {
              const hasLocal =
                typeof window !== 'undefined' && !!getCourseCachedItem(courseId, getCatKey('1c'));
              if (!hasLocal || prev === DEFAULT_CATEGORIES || isCloud1cNewer) {
                if (typeof window !== 'undefined') {
                  setCourseCachedItem(courseId, getCatKey('1c'), JSON.stringify(snap1c.categories));
                }
                return snap1c.categories;
              }
              return prev;
            });
          }
          if (snap1c.gradesMap && typeof snap1c.gradesMap === 'object' && Object.keys(snap1c.gradesMap).length > 0) {
            setGradesMap1c((prev) => {
              const merged = isCloud1cNewer ? { ...prev, ...snap1c.gradesMap } : { ...snap1c.gradesMap, ...prev };
              if (typeof window !== 'undefined') {
                setCourseCachedItem(courseId, getGradesKey('1c'), JSON.stringify(merged));
              }
              return merged;
            });
          }
          if (snap1c.preliminaryValuation) {
            setPreliminaryValuation1c((prev) => {
              const val = isCloud1cNewer ? snap1c.preliminaryValuation : prev || snap1c.preliminaryValuation;
              if (typeof window !== 'undefined' && val) {
                setCourseCachedItem(courseId, getPreliminaryValuationKey('1c'), JSON.stringify(val));
              }
              return val;
            });
          }
          if (snap1c.annualOverrides && typeof snap1c.annualOverrides === 'object') {
            setAnnualOverrides((prev) => {
              const merged = isCloud1cNewer
                ? { ...prev, ...snap1c.annualOverrides }
                : { ...snap1c.annualOverrides, ...prev };
              if (typeof window !== 'undefined') {
                setCourseCachedItem(courseId, STORAGE_KEY_ANNUAL_OVERRIDES, JSON.stringify(merged));
              }
              return merged;
            });
          }
          if (snap1c.updatedAt && isCloud1cNewer && typeof window !== 'undefined') {
            setCourseCachedItem(courseId, getTermUpdatedAtKey('1c'), snap1c.updatedAt);
          }
        }

        const snap2c = snapshots['2c'];
        if (snap2c) {
          const local2cUpdated =
            typeof window !== 'undefined'
              ? getCourseCachedItem(courseId, getTermUpdatedAtKey('2c')) || ''
              : '';
          const isCloud2cNewer = !local2cUpdated || !snap2c.updatedAt || snap2c.updatedAt >= local2cUpdated;

          if (Array.isArray(snap2c.categories) && snap2c.categories.length > 0) {
            setCategories2c((prev) => {
              const hasLocal =
                typeof window !== 'undefined' && !!getCourseCachedItem(courseId, getCatKey('2c'));
              if (!hasLocal || isCloud2cNewer) {
                if (typeof window !== 'undefined') {
                  setCourseCachedItem(courseId, getCatKey('2c'), JSON.stringify(snap2c.categories));
                }
                return snap2c.categories;
              }
              return prev;
            });
          }
          if (snap2c.gradesMap && typeof snap2c.gradesMap === 'object' && Object.keys(snap2c.gradesMap).length > 0) {
            setGradesMap2c((prev) => {
              const merged = isCloud2cNewer ? { ...prev, ...snap2c.gradesMap } : { ...snap2c.gradesMap, ...prev };
              if (typeof window !== 'undefined') {
                setCourseCachedItem(courseId, getGradesKey('2c'), JSON.stringify(merged));
              }
              return merged;
            });
          }
          if (snap2c.preliminaryValuation) {
            setPreliminaryValuation2c((prev) => {
              const val = isCloud2cNewer ? snap2c.preliminaryValuation : prev || snap2c.preliminaryValuation;
              if (typeof window !== 'undefined' && val) {
                setCourseCachedItem(courseId, getPreliminaryValuationKey('2c'), JSON.stringify(val));
              }
              return val;
            });
          }
          if (snap2c.updatedAt && isCloud2cNewer && typeof window !== 'undefined') {
            setCourseCachedItem(courseId, getTermUpdatedAtKey('2c'), snap2c.updatedAt);
          }
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  // Listen for external grades or category updates
  useEffect(() => {
    const handleGradesUpdated = (e: any) => {
      try {
        const savedCats1c =
          localStorage.getItem(getCatKey('1c')) ||
          localStorage.getItem(`fds_grades_categories_${courseId}`);
        if (savedCats1c) setCategories1c(JSON.parse(savedCats1c));

        const savedGrades1c =
          localStorage.getItem(getGradesKey('1c')) ||
          localStorage.getItem(`fds_grades_data_${courseId}`);
        if (savedGrades1c) setGradesMap1c(JSON.parse(savedGrades1c));

        const savedCats2c = localStorage.getItem(getCatKey('2c'));
        if (savedCats2c) setCategories2c(JSON.parse(savedCats2c));

        const savedGrades2c = localStorage.getItem(getGradesKey('2c'));
        if (savedGrades2c) setGradesMap2c(JSON.parse(savedGrades2c));

        if (e?.detail?.term && (e.detail.term === '1c' || e.detail.term === '2c') && onExternalTermSwitch) {
          onExternalTermSwitch(e.detail.term);
        }
      } catch (_) {}
    };

    window.addEventListener('fds-grades-updated', handleGradesUpdated);

    const handleCrossTabGradesStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.includes(`fds_grades_`) && e.key.includes(courseId)) {
        handleGradesUpdated({});
      }
    };
    window.addEventListener('storage', handleCrossTabGradesStorage);

    return () => {
      window.removeEventListener('fds-grades-updated', handleGradesUpdated);
      window.removeEventListener('storage', handleCrossTabGradesStorage);
    };
  }, [courseId]);

  const categories = is2c ? categories2c : categories1c;
  const gradesMap = is2c ? gradesMap2c : gradesMap1c;
  const overallCalculation = is2c ? overallCalc2c : overallCalc1c;
  const activePreliminaryValuation = is2c ? preliminaryValuation2c : preliminaryValuation1c;

  return {
    categories1c,
    categories2c,
    gradesMap1c,
    gradesMap2c,
    overallCalc1c,
    overallCalc2c,
    annualOverrides,
    preliminaryValuation1c,
    preliminaryValuation2c,
    activePreliminaryValuation,
    gradeHistory,
    categories,
    gradesMap,
    overallCalculation,
    isSavingSheets,
    sheetsSavedInfo,
    cloudStatus,
    saveCategories,
    saveGrades,
    saveOverallCalc,
    saveAnnualOverride,
    handleCopyCategoriesFrom1c,
    handleSavePreliminaryValuation,
    handleApplyImportedGrades,
    handleApplyMultiImport,
    handleSyncCuatrimestreWithSheets,
  };
}
