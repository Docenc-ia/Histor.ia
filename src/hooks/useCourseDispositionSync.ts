import { useState, useEffect, useMemo, useCallback } from 'react';
import { Course, Student, StudentDispositionData, StudentHistoryItem } from '../types';
import {
  api,
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getDeletedHistoryIds,
} from '../services/api';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import {
  deduplicateHistory,
  buildStudentHistoryIndex,
  calculateStudentMetrics,
} from '../utils/studentMetricsCalculator';
import { setCourseCachedItem, touchCourseDataLru } from '../utils/lruCourseCache';
import { emitAppEvent, subscribeAppEvents } from '../utils/appEventBus';

interface UseCourseDispositionSyncOptions {
  activeCourse?: Course;
  courses: Course[];
  students: Student[];
  courseStudents?: Student[];
  attendanceTerm: '1c' | '2c' | 'annual';
  teacherEmail: string;
}

export function useCourseDispositionSync({
  activeCourse,
  courses,
  students,
  courseStudents: explicitCourseStudents,
  attendanceTerm,
  teacherEmail,
}: UseCourseDispositionSyncOptions) {
  const courseStudents = useMemo(
    () =>
      explicitCourseStudents ||
      students.filter((s) => s.courseId === activeCourse?.id),
    [explicitCourseStudents, students, activeCourse?.id]
  );
  // 1° Cuatrimestre disposition state map
  const [dispositionMap, setDispositionMap] = useState<Record<string, StudentDispositionData>>(() => {
    if (typeof window !== 'undefined' && activeCourse?.id) {
      try {
        const raw1c = getUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`);
        if (raw1c) return JSON.parse(raw1c);
      } catch (_) {}
    }
    return {};
  });

  // 2° Cuatrimestre disposition state map
  const [dispositionMap2c, setDispositionMap2c] = useState<Record<string, StudentDispositionData>>(() => {
    if (typeof window !== 'undefined' && activeCourse?.id) {
      try {
        const raw2c = getUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`);
        if (raw2c) return JSON.parse(raw2c);
      } catch (_) {}
    }
    return {};
  });

  // History entries list
  const [historyList, setHistoryList] = useState<StudentHistoryItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = getAllDispositionStorage();
        if (Array.isArray(stored.history) && stored.history.length > 0) {
          return deduplicateHistory(stored.history);
        }
      } catch (_) {}
    }
    return [];
  });

  const saveTermDisposition = useCallback(
    (
      term: '1c' | '2c',
      updatedMap: Record<string, StudentDispositionData>,
      updatedHistory: StudentHistoryItem[]
    ) => {
      const uid = getActiveUserId();
      const courseStampedMap: Record<string, StudentDispositionData> = {};
      for (const [k, val] of Object.entries(updatedMap)) {
        courseStampedMap[k] = activeCourse?.id
          ? ({ ...val, courseId: activeCourse.id } as StudentDispositionData)
          : val;
      }

      if (term === '2c') {
        setDispositionMap2c(courseStampedMap);
        if (typeof window !== 'undefined') {
          if (activeCourse?.id) {
            const serialized2c = JSON.stringify(courseStampedMap);
            setUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`, serialized2c);
            setCourseCachedItem(
              activeCourse.id,
              getUserStorageKey(`fds_disposition_data_${activeCourse.id}_2c`),
              serialized2c
            );
          }
          emitAppEvent('docencia_disposition_storage_change', {
            term: '2c',
            courseId: activeCourse?.id,
            disposition: courseStampedMap,
            history: updatedHistory,
          });
        }
        saveAllDispositionStorage(dispositionMap, updatedHistory, { silent: true });
        if (uid) {
          firestoreSync.syncCompactDispositionNow(uid, false);
        }
      } else {
        setDispositionMap(courseStampedMap);
        if (typeof window !== 'undefined') {
          if (activeCourse?.id) {
            const serialized1c = JSON.stringify(courseStampedMap);
            setUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`, serialized1c);
            setCourseCachedItem(
              activeCourse.id,
              getUserStorageKey(`fds_disposition_data_${activeCourse.id}_1c`),
              serialized1c
            );
          }
          emitAppEvent('docencia_disposition_storage_change', {
            term: '1c',
            courseId: activeCourse?.id,
            disposition: courseStampedMap,
            history: updatedHistory,
          });
        }
        saveAllDispositionStorage(courseStampedMap, updatedHistory, {
          silent: true,
          courseId: activeCourse?.id,
        });
        if (uid) {
          firestoreSync.syncCompactDispositionNow(uid, false);
        }
      }
    },
    [activeCourse?.id, dispositionMap]
  );

  // Pre-indexed O(H + S) lookup structure so getStudentMetrics runs in O(1) per student
  const historyIndex = useMemo(
    () => buildStudentHistoryIndex(historyList, students, activeCourse?.id),
    [historyList, students, activeCourse?.id]
  );

  const getStudentMetrics = useCallback(
    (
      studentId: string,
      targetTerm: '1c' | '2c' | 'annual' | 'all' = attendanceTerm
    ): StudentDispositionData =>
      calculateStudentMetrics({
        studentId,
        targetTerm,
        activeCourseId: activeCourse?.id,
        students,
        dispositionMap,
        dispositionMap2c,
        historyList,
        historyIndex,
      }),
    [attendanceTerm, activeCourse?.id, students, dispositionMap, dispositionMap2c, historyList, historyIndex]
  );

  // Reload course-scoped disposition data whenever activeCourse changes
  useEffect(() => {
    if (!activeCourse?.id) return;
    touchCourseDataLru(activeCourse.id, getUserStorageKey(`fds_disposition_data_${activeCourse.id}_1c`));
    touchCourseDataLru(activeCourse.id, getUserStorageKey(`fds_disposition_data_${activeCourse.id}_2c`));
    try {
      const course1cKey = `fds_disposition_data_${activeCourse.id}_1c`;
      const course2cKey = `fds_disposition_data_${activeCourse.id}_2c`;
      const sharedStudentIds = historyIndex.sharedStudentIds;

      const raw1c = getUserScopedItem(course1cKey);
      if (raw1c) {
        const parsed1c = JSON.parse(raw1c);
        const cleaned1c: Record<string, StudentDispositionData> = {};
        for (const [sId, data] of Object.entries(parsed1c)) {
          const entryCourseId = (data as any)?.courseId;
          if (entryCourseId && entryCourseId !== activeCourse.id) continue;
          if (!entryCourseId && sharedStudentIds.has(sId)) continue;
          cleaned1c[sId] = data as StudentDispositionData;
        }
        setDispositionMap(cleaned1c);
      } else {
        const globalDisp = getAllDispositionStorage().disposition || {};
        const courseStudentIds = new Set(courseStudents.map((s) => s.id));
        const filtered: Record<string, StudentDispositionData> = {};
        for (const [sId, data] of Object.entries(globalDisp)) {
          if (!courseStudentIds.has(sId)) continue;
          const entryCourseId = (data as any)?.courseId;
          if (entryCourseId === activeCourse.id || (!entryCourseId && !sharedStudentIds.has(sId))) {
            filtered[sId] = data as StudentDispositionData;
          }
        }
        setDispositionMap(filtered);
      }

      const raw2c = getUserScopedItem(course2cKey);
      if (raw2c) {
        const parsed2c = JSON.parse(raw2c);
        const cleaned2c: Record<string, StudentDispositionData> = {};
        for (const [sId, data] of Object.entries(parsed2c)) {
          const entryCourseId = (data as any)?.courseId;
          if (entryCourseId && entryCourseId !== activeCourse.id) continue;
          if (!entryCourseId && sharedStudentIds.has(sId)) continue;
          cleaned2c[sId] = data as StudentDispositionData;
        }
        setDispositionMap2c(cleaned2c);
      } else {
        const global2cRaw = getUserScopedItem('fds_disposition_data_2c');
        const global2c = global2cRaw ? JSON.parse(global2cRaw) : {};
        const courseStudentIds = new Set(courseStudents.map((s) => s.id));
        const filtered2c: Record<string, StudentDispositionData> = {};
        for (const [sId, data] of Object.entries(global2c)) {
          if (!courseStudentIds.has(sId)) continue;
          const entryCourseId = (data as any)?.courseId;
          if (entryCourseId === activeCourse.id || (!entryCourseId && !sharedStudentIds.has(sId))) {
            filtered2c[sId] = data as StudentDispositionData;
          }
        }
        setDispositionMap2c(filtered2c);
      }
    } catch (err) {
      console.warn('Error loading course-specific disposition data:', err);
    }
  }, [activeCourse?.id, courseStudents, historyIndex.sharedStudentIds]);

  // Calculations for summary pills & course-scoped history
  const courseHistory = useMemo(() => {
    if (!activeCourse) return [];
    const courseStudentIds = new Set(courseStudents.map((s) => s.id));
    const otherCourseStudentIds = historyIndex.sharedStudentIds;
    const isClassroomIdSharedWithOtherCourse = Boolean(
      activeCourse.classroomCourseId &&
        courses.some(
          (c) =>
            c.id !== activeCourse.id &&
            (c.id === activeCourse.classroomCourseId ||
              c.classroomCourseId === activeCourse.classroomCourseId)
        )
    );
    const relevant = historyList.filter(
      (h) =>
        h.courseId === activeCourse.id ||
        (!isClassroomIdSharedWithOtherCourse &&
          activeCourse.classroomCourseId &&
          h.courseId === activeCourse.classroomCourseId) ||
        (!h.courseId &&
          courseStudentIds.has(h.studentId) &&
          !otherCourseStudentIds.has(h.studentId))
    );
    return deduplicateHistory(relevant).sort((a, b) => b.timestamp - a.timestamp);
  }, [historyList, activeCourse, courseStudents, historyIndex.sharedStudentIds, courses]);

  // Sync 2°C disposition map from Firestore scoped to activeCourse
  useEffect(() => {
    let isMounted = true;
    const uid = getActiveUserId();
    if (uid && activeCourse?.id) {
      firestoreSync
        .loadUserSetting<Record<string, StudentDispositionData>>(uid, 'disposition_map_2c')
        .then((cloud2c) => {
          if (!isMounted || !cloud2c || typeof cloud2c !== 'object' || Object.keys(cloud2c).length === 0) return;
          const courseScopedCloud2c: Record<string, StudentDispositionData> = {};
          const prefix = `${activeCourse.id}::`;
          Object.entries(cloud2c).forEach(([k, val]: [string, any]) => {
            if (!val || typeof val !== 'object') return;
            if (k.startsWith(prefix)) {
              const stId = k.slice(prefix.length);
              courseScopedCloud2c[stId] = { ...val, courseId: activeCourse.id };
            } else if (!k.includes('::') && val.courseId === activeCourse.id) {
              courseScopedCloud2c[k] = { ...val };
            }
          });
          if (Object.keys(courseScopedCloud2c).length === 0) return;
          setDispositionMap2c((prev) => {
            const merged = { ...courseScopedCloud2c, ...prev };
            try {
              setUserScopedItem(
                `fds_disposition_data_${activeCourse.id}_2c`,
                JSON.stringify(merged)
              );
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [teacherEmail, activeCourse?.id]);

  // Listen for storage changes across tabs / modules using appEventBus
  useEffect(() => {
    const handleStorageChange = (e: any) => {
      if (e?.detail) {
        const { disposition, history, term, courseId: eventCourseId } = e.detail;
        if (
          disposition &&
          typeof disposition === 'object' &&
          (!eventCourseId || !activeCourse?.id || eventCourseId === activeCourse.id)
        ) {
          const filterForCurrentCourse = (incomingMap: Record<string, any>) => {
            if (!activeCourse?.id) return incomingMap;
            const res: Record<string, any> = {};
            for (const [k, val] of Object.entries(incomingMap)) {
              const entryCourseId = (val as any)?.courseId;
              if (!entryCourseId || entryCourseId === activeCourse.id) {
                res[k] = val;
              }
            }
            return res;
          };

          if (term === '2c') {
            const scopedDisp = filterForCurrentCourse(disposition);
            if (Object.keys(scopedDisp).length > 0) {
              setDispositionMap2c((prev) => ({ ...prev, ...scopedDisp }));
            }
          } else if (eventCourseId && eventCourseId === activeCourse?.id) {
            const scopedDisp = filterForCurrentCourse(disposition);
            if (Object.keys(scopedDisp).length > 0) {
              setDispositionMap((prev) => ({ ...prev, ...scopedDisp }));
            }
          }
        }
        if (Array.isArray(history)) {
          setHistoryList((prev) => {
            const incomingDedup = deduplicateHistory(history);
            if (
              prev.length === incomingDedup.length &&
              prev.every((p, i) => p.id === incomingDedup[i]?.id)
            ) {
              return prev;
            }
            return incomingDedup;
          });
        }
      }
    };

    const unsubscribeBus = subscribeAppEvents(
      ['docencia_disposition_storage_change'],
      handleStorageChange,
      40
    );

    const handleCrossTabStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key.includes('fds_disposition') ||
        e.key.includes('docencia_disposition') ||
        e.key.includes('fds_grade')
      ) {
        try {
          const stored = getAllDispositionStorage();
          if (Array.isArray(stored.history)) {
            setHistoryList(deduplicateHistory(stored.history));
          }
          if (activeCourse?.id) {
            const raw1c = getUserScopedItem(`fds_disposition_data_${activeCourse.id}_1c`);
            if (raw1c) setDispositionMap(JSON.parse(raw1c));
            const raw2c = getUserScopedItem(`fds_disposition_data_${activeCourse.id}_2c`);
            if (raw2c) setDispositionMap2c(JSON.parse(raw2c));
          }
        } catch (_) {}
      }
    };
    window.addEventListener('storage', handleCrossTabStorage);

    return () => {
      unsubscribeBus();
      window.removeEventListener('storage', handleCrossTabStorage);
    };
  }, [activeCourse?.id]);

  // Load from Compact v2 Cloud Engine / backend API
  useEffect(() => {
    let isMounted = true;
    if (activeCourse?.id) {
      api
        .getDisposition(activeCourse.id)
        .then((res) => {
          if (!isMounted) return;
          if (res.disposition && Object.keys(res.disposition).length > 0) {
            setDispositionMap((prev) => {
              const incoming = res.disposition;
              const next = { ...prev };
              let hasChanged = false;
              for (const [k, val] of Object.entries(incoming)) {
                if ((val as any)?.courseId !== activeCourse.id) continue;
                if (
                  !prev[k] ||
                  prev[k].totalAbsences !== val?.totalAbsences ||
                  prev[k].totalLates !== val?.totalLates ||
                  prev[k].totalDisposition !== val?.totalDisposition
                ) {
                  next[k] = val;
                  hasChanged = true;
                }
              }
              return hasChanged ? next : prev;
            });
          }
          if (res.disposition2c && Object.keys(res.disposition2c).length > 0) {
            setDispositionMap2c((prev) => {
              const incoming2c = res.disposition2c!;
              const next = { ...prev };
              let hasChanged = false;
              for (const [k, val] of Object.entries(incoming2c)) {
                if ((val as any)?.courseId !== activeCourse.id) continue;
                if (
                  !prev[k] ||
                  prev[k].totalAbsences !== val?.totalAbsences ||
                  prev[k].totalLates !== val?.totalLates ||
                  prev[k].totalDisposition !== val?.totalDisposition
                ) {
                  next[k] = val;
                  hasChanged = true;
                }
              }
              return hasChanged ? next : prev;
            });
          }
          if (Array.isArray(res.history)) {
            const deleted = getDeletedHistoryIds();
            const cleanIncoming = res.history.filter((h) => h?.id && !deleted.has(h.id));
            setHistoryList((prev) => {
              const cleanPrev = prev.filter((h) => h?.id && !deleted.has(h.id));
              const prevIds = new Set(cleanPrev.map((p) => p.id));
              const genuinelyNewFromCloud = cleanIncoming.filter((ci) => !prevIds.has(ci.id));
              if (genuinelyNewFromCloud.length > 0) {
                return deduplicateHistory([...cleanPrev, ...genuinelyNewFromCloud]);
              }
              if (cleanPrev.length === 0 && cleanIncoming.length > 0) {
                return deduplicateHistory(cleanIncoming);
              }
              return cleanPrev;
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [activeCourse?.id]);

  return {
    dispositionMap,
    setDispositionMap,
    dispositionMap2c,
    setDispositionMap2c,
    historyList,
    setHistoryList,
    saveTermDisposition,
    getStudentMetrics,
    courseHistory,
  };
}
