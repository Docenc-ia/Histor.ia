/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Course,
  Student,
  AbsenceNotificationSettings,
} from '../types';
import { api } from '../services/api';
import { useWorkspaceAuth } from './WorkspaceAuthContext';
import { navigationService } from '../services/navigationService';
import { subscribeAppEvents } from '../utils/appEventBus';
import { safeSetLocalStorageItem } from '../utils/storageGuard';
import {
  computeQuickStudentAttendanceRate,
  getCourseAttendanceSettings,
  getCurrentCalendarTerm,
} from '../utils/attendanceCalculations';
import {
  reconcileCourseList,
  reconcileStudentList,
} from '../utils/entityEquality';
import { hydrateTerminologySettingsFromCloud } from '../utils/terminologySettings';
import {
  firestoreSync,
  getActiveUserId,
  isPrimaryOwnerAccount,
} from '../services/firestoreSync';
import { isHistoryNotificationOmitted } from '../utils/historyMerge';

export const DEFAULT_NOTIFICATION_SETTINGS: AbsenceNotificationSettings = {
  autoNotify: false,
  channel: 'classroom',
  templateClassroom:
    'Estimado/a {ESTUDIANTE}, te notificamos que se ha registrado una inasistencia en la materia {MATERIA} el día {FECHA}. Recuerda revisar el material de la clase y ponerte al día con las actividades solicitadas.',
  templateGmail:
    'Estimado/a {ESTUDIANTE},\n\nTe informamos que en la fecha {FECHA} se ha registrado una inasistencia en la clase de {MATERIA}.\n\nPor favor consulta con tus compañeros o en el aula virtual las tareas correspondientes para mantenerte al día.\n\nSaludos cordiales,\nProfesor/a',
  templateConductClassroom:
    'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "{MOTIVO}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.',
  templateConductGmail:
    'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} durante la clase de {MATERIA} se ha registrado un llamado de atención por el motivo: "{MOTIVO}".\nComo consecuencia, tu registro de disposición de la materia queda en {DISPOSICION}/10 puntos.\nTe pedimos reflexionar y mejorar en este aspecto para no comprometer tu evaluación de cursada.\n\nAtentamente,\nProfesor/a',
  dontShowPopupOnAbsence: true,
  dontShowPopupOnDisposition: true,
};

function readLocalOmittedState(uid: string): {
  omitted: Set<string>;
  reactivated: Set<string>;
} {
  const omitted = new Set<string>();
  const reactivated = new Set<string>();
  if (typeof window === 'undefined' || !uid) {
    return { omitted, reactivated };
  }
  try {
    const reactivatedRaw = localStorage.getItem(`docencia_reactivated_notification_ids_${uid}`);
    if (reactivatedRaw) {
      const parsed = JSON.parse(reactivatedRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id.trim()) reactivated.add(id);
        });
      }
    }

    const scopedRaw = localStorage.getItem(`docencia_omitted_notification_ids_${uid}`);
    if (scopedRaw) {
      const parsed = JSON.parse(scopedRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id.trim() && !reactivated.has(id)) {
            omitted.add(id);
          }
        });
      }
    }

    // Seed any already-omitted records from local disposition history so prior "No enviar" items stay omitted
    const localHistory = api.getAllDispositionStorage().history || [];
    for (const h of localHistory) {
      if (
        h?.id &&
        !reactivated.has(h.id) &&
        !h.messageSent &&
        isHistoryNotificationOmitted(h)
      ) {
        omitted.add(h.id);
      }
    }
  } catch (_) {}
  return { omitted, reactivated };
}

function persistLocalOmittedState(
  uid: string,
  omitted: Set<string>,
  reactivated: Set<string>
): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    safeSetLocalStorageItem(
      `docencia_omitted_notification_ids_${uid}`,
      JSON.stringify(Array.from(omitted).slice(-4000))
    );
    safeSetLocalStorageItem(
      `docencia_reactivated_notification_ids_${uid}`,
      JSON.stringify(Array.from(reactivated).slice(-1000))
    );
  } catch (_) {}
}

function readLocalNotificationSettings(
  uid: string,
  email?: string
): AbsenceNotificationSettings {
  if (typeof window === 'undefined' || !uid) {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
  try {
    const scopedRaw = localStorage.getItem(`docencia_notification_settings_${uid}`);
    if (scopedRaw) {
      const parsed = JSON.parse(scopedRaw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
      }
    }
    const candidateEmail = email || 'profesor';
    const legacyKeys = [
      `fds_absence_notif_settings_v1_${candidateEmail}`,
      ...(isPrimaryOwnerAccount(candidateEmail)
        ? ['fds_absence_notif_settings_v1_profesor']
        : []),
    ];
    for (const k of legacyKeys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
        }
      }
    }
  } catch (_) {}
  return DEFAULT_NOTIFICATION_SETTINGS;
}

function persistLocalNotificationSettings(
  uid: string,
  settings: AbsenceNotificationSettings,
  email?: string
): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    const serialized = JSON.stringify(settings);
    safeSetLocalStorageItem(`docencia_notification_settings_${uid}`, serialized);
    if (email) {
      safeSetLocalStorageItem(`fds_absence_notif_settings_v1_${email}`, serialized);
    }
  } catch (_) {}
}

export interface GlobalDataContextValue {
  courses: Course[];
  students: Student[];
  isLoading: boolean;
  coursesRef: React.MutableRefObject<Course[]>;
  studentsRef: React.MutableRefObject<Student[]>;
  loadData: () => Promise<void>;
  refreshData: () => Promise<void>;
  setCourses: React.Dispatch<React.SetStateAction<Course[]>>;
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>;
  createCourse: (courseData: Partial<Course>) => Promise<Course>;
  deleteCourse: (courseId: string) => Promise<{ message?: string; courseName: string }>;
  clearAllCourses: () => Promise<{ message?: string }>;
  restoreDemoCourses: () => Promise<void>;
  omittedNotificationIds: Set<string>;
  omittedNotificationIdsRef: React.MutableRefObject<Set<string>>;
  markNotificationsAsNoSend: (ids: string[]) => void;
  clearNotificationsNoSend: (ids: string[]) => void;
  notificationSettings: AbsenceNotificationSettings;
  updateNotificationSettings: (
    updater: React.SetStateAction<AbsenceNotificationSettings>,
    options?: { syncCloud?: boolean; immediate?: boolean }
  ) => void;
}

const GlobalDataContext = createContext<GlobalDataContextValue | undefined>(undefined);

export const GlobalDataContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useWorkspaceAuth();

  // Initialize courses with local cache + last active course LRU snapshot only when authenticated
  const [courses, setCourses] = useState<Course[]>(() => {
    if (!user) return [];
    const localList = api.deduplicateCourses(api.getLocalCourses());
    const snap = navigationService.getLastActiveCourseSnapshot();
    if (
      snap &&
      !localList.some(
        (c) =>
          c.id === snap.id ||
          (c.classroomCourseId && c.classroomCourseId === snap.classroomCourseId)
      )
    ) {
      return [snap, ...localList];
    }
    return localList;
  });

  // Initialize students from local cache with deduplication only when authenticated
  const [students, setStudents] = useState<Student[]>(() =>
    user ? api.deduplicateStudents(api.getLocalStudents()) : []
  );

  // Global permanent "No enviar" notification IDs & messaging preferences
  const [omittedNotificationIds, setOmittedNotificationIds] = useState<Set<string>>(() => {
    if (!user) return new Set();
    const uid = getActiveUserId();
    return uid ? readLocalOmittedState(uid).omitted : new Set();
  });

  const omittedNotificationIdsRef = useRef<Set<string>>(omittedNotificationIds);
  omittedNotificationIdsRef.current = omittedNotificationIds;

  const reactivatedNotificationIdsRef = useRef<Set<string>>(
    (() => {
      if (!user) return new Set<string>();
      const uid = getActiveUserId();
      return uid ? readLocalOmittedState(uid).reactivated : new Set<string>();
    })()
  );

  const [notificationSettings, setNotificationSettings] = useState<AbsenceNotificationSettings>(
    () => {
      if (!user) return DEFAULT_NOTIFICATION_SETTINGS;
      const uid = getActiveUserId();
      return uid
        ? readLocalNotificationSettings(uid, user.email)
        : DEFAULT_NOTIFICATION_SETTINGS;
    }
  );
  const notificationSettingsRef = useRef<AbsenceNotificationSettings>(notificationSettings);
  notificationSettingsRef.current = notificationSettings;

  // Only show loading spinner if there is no cached or optimistic course data available
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!user) return false;
    const hasLocalCourses = api.getLocalCourses().length > 0;
    const hasOptimisticLastCourse = Boolean(
      navigationService.getLastActiveCourseSnapshot() ||
        navigationService.getLastActiveCourseId()
    );
    return !hasLocalCourses && !hasOptimisticLastCourse;
  });

  // Keep latest refs to courses and students so callbacks remain 100% referentially stable across refreshes
  const coursesRef = useRef<Course[]>(courses);
  coursesRef.current = courses;

  const studentsRef = useRef<Student[]>(students);
  studentsRef.current = students;

  // Hydrate global "no enviar" IDs and notification settings from Firestore + merge safely with local state
  const hydrateNotificationStateFromCloud = useCallback(
    async (uid: string, email?: string) => {
      if (!uid) return;
      try {
        const [cloudOmittedData, cloudSettings] = await Promise.all([
          firestoreSync.loadOmittedNotificationIds(uid).catch(() => null),
          firestoreSync
            .loadUserSetting<AbsenceNotificationSettings>(uid, 'notification_settings')
            .catch(() => null),
        ]);

        if (cloudOmittedData) {
          const localSeed = readLocalOmittedState(uid);
          const mergedOmitted = new Set<string>(omittedNotificationIdsRef.current);
          localSeed.omitted.forEach((id) => mergedOmitted.add(id));

          const mergedReactivated = new Set<string>(reactivatedNotificationIdsRef.current);
          localSeed.reactivated.forEach((id) => mergedReactivated.add(id));

          const cloudOmittedSet = new Set<string>(cloudOmittedData.omittedIds || []);
          const cloudReactivatedSet = new Set<string>(cloudOmittedData.reactivatedIds || []);

          // Anything omitted in cloud stays omitted unless explicitly reactivated by sending
          cloudOmittedSet.forEach((id) => {
            if (!mergedReactivated.has(id)) {
              mergedOmitted.add(id);
            }
          });
          cloudReactivatedSet.forEach((id) => {
            if (!cloudOmittedSet.has(id) && !omittedNotificationIdsRef.current.has(id)) {
              mergedOmitted.delete(id);
              mergedReactivated.add(id);
            }
          });

          reactivatedNotificationIdsRef.current = mergedReactivated;
          persistLocalOmittedState(uid, mergedOmitted, mergedReactivated);

          setOmittedNotificationIds((prev) => {
            if (
              prev.size === mergedOmitted.size &&
              Array.from(mergedOmitted).every((id) => prev.has(id))
            ) {
              return prev;
            }
            return mergedOmitted;
          });

          // Backfill cloud if local already had omitted records that weren't yet in the cloud omitted doc
          const hasMissingInCloud = Array.from(mergedOmitted).some(
            (id) => !cloudOmittedSet.has(id)
          );
          if (hasMissingInCloud && mergedOmitted.size > 0) {
            firestoreSync
              .saveOmittedNotificationIds(uid, {
                omittedIds: Array.from(mergedOmitted),
                reactivatedIds: Array.from(mergedReactivated),
              })
              .catch(() => {});
          }
        }

        if (cloudSettings && typeof cloudSettings === 'object') {
          setNotificationSettings((prev) => {
            const merged: AbsenceNotificationSettings = {
              ...DEFAULT_NOTIFICATION_SETTINGS,
              ...prev,
              ...cloudSettings,
            };
            persistLocalNotificationSettings(uid, merged, email);
            return merged;
          });
        }
      } catch (_) {}
    },
    []
  );

  // Permanently mark message IDs as "No enviar" / "No mandar" in global state, localStorage, and Firestore
  const markNotificationsAsNoSend = useCallback((ids: string[]) => {
    const cleanIds = (ids || []).filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
    if (cleanIds.length === 0) return;

    const uid = getActiveUserId();
    const nextOmitted = new Set<string>(omittedNotificationIdsRef.current);
    const nextReactivated = new Set<string>(reactivatedNotificationIdsRef.current);
    let changed = false;

    for (const id of cleanIds) {
      if (!nextOmitted.has(id)) {
        nextOmitted.add(id);
        changed = true;
      }
      if (nextReactivated.delete(id)) {
        changed = true;
      }
    }

    omittedNotificationIdsRef.current = nextOmitted;
    reactivatedNotificationIdsRef.current = nextReactivated;

    if (changed) {
      setOmittedNotificationIds(nextOmitted);
    }
    if (uid) {
      persistLocalOmittedState(uid, nextOmitted, nextReactivated);
      firestoreSync
        .saveOmittedNotificationIds(uid, {
          omittedIds: Array.from(nextOmitted),
          reactivatedIds: Array.from(nextReactivated),
        })
        .catch(() => {});
    }
  }, []);

  // Remove message IDs from "No enviar" only when user later explicitly sends the notification
  const clearNotificationsNoSend = useCallback((ids: string[]) => {
    const cleanIds = (ids || []).filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
    if (cleanIds.length === 0) return;

    const uid = getActiveUserId();
    const nextOmitted = new Set<string>(omittedNotificationIdsRef.current);
    const nextReactivated = new Set<string>(reactivatedNotificationIdsRef.current);
    let changed = false;

    for (const id of cleanIds) {
      if (nextOmitted.delete(id)) {
        changed = true;
      }
      if (!nextReactivated.has(id)) {
        nextReactivated.add(id);
        changed = true;
      }
    }

    if (!changed) return;
    omittedNotificationIdsRef.current = nextOmitted;
    reactivatedNotificationIdsRef.current = nextReactivated;
    setOmittedNotificationIds(nextOmitted);

    if (uid) {
      persistLocalOmittedState(uid, nextOmitted, nextReactivated);
      firestoreSync
        .saveOmittedNotificationIds(uid, {
          omittedIds: Array.from(nextOmitted),
          reactivatedIds: Array.from(nextReactivated),
        })
        .catch(() => {});
    }
  }, []);

  const updateNotificationSettings = useCallback(
    (
      updater: React.SetStateAction<AbsenceNotificationSettings>,
      options: { syncCloud?: boolean; immediate?: boolean } = {}
    ) => {
      const { syncCloud = true, immediate = true } = options;
      const uid = getActiveUserId();
      const email = user?.email;

      setNotificationSettings((prev) => {
        const next =
          typeof updater === 'function' ? updater(prev) : updater;
        const normalized: AbsenceNotificationSettings = {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          ...next,
        };
        notificationSettingsRef.current = normalized;
        if (uid) {
          persistLocalNotificationSettings(uid, normalized, email);
          if (syncCloud) {
            firestoreSync
              .saveUserSetting(uid, 'notification_settings', normalized, immediate)
              .catch(() => {});
          }
        }
        return normalized;
      });
    },
    [user?.email]
  );

  // 2-Phase Optimistic UI loader (Phase 1: 0ms localStorage pre-load, Phase 2: Firebase sync & deep reconciliation)
  const loadData = useCallback(async () => {
    // Phase 1: Immediate optimistic UI pre-load from localStorage before Firebase finishes
    try {
      const localC = api.deduplicateCourses(api.getLocalCourses());
      const localS = api.deduplicateStudents(api.getLocalStudents());
      const optimistic = navigationService.preloadOptimisticCourseState(localC);

      if (optimistic.optimisticCoursesList.length > 0) {
        setCourses((prev) => reconcileCourseList(prev, optimistic.optimisticCoursesList));
      }
      if (localS.length > 0) {
        setStudents((prev) => reconcileStudentList(prev, localS));
      }
      if (
        optimistic.optimisticCoursesList.length > 0 ||
        Boolean(optimistic.targetCourseId)
      ) {
        setIsLoading((prev) => (prev ? false : prev));
      }
    } catch (_) {}

    // Phase 2: Asynchronous Firebase resolution & seamless state reconciliation
    try {
      const [c, s] = await Promise.all([api.getCourses(), api.getStudents()]);
      const cleanCourses = api.deduplicateCourses(c);
      const cleanStudents = api.deduplicateStudents(s);
      setCourses((prev) => reconcileCourseList(prev, cleanCourses));
      setStudents((prev) => reconcileStudentList(prev, cleanStudents));
      if (cleanCourses.length > 0) {
        navigationService.reconcileWithCourses(cleanCourses);
      }
    } catch (err) {
      console.error('Error fetching workspace courses and students:', err);
    } finally {
      setIsLoading((prev) => (prev ? false : prev));
    }
  }, []);

  // Sync courses & students when the authenticated user changes and keep live cross-device listener active
  useEffect(() => {
    if (!user) {
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      setOmittedNotificationIds(new Set());
      reactivatedNotificationIdsRef.current = new Set();
      setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
      return;
    }

    const activeUid = getActiveUserId();
    if (activeUid) {
      const localSeed = readLocalOmittedState(activeUid);
      reactivatedNotificationIdsRef.current = localSeed.reactivated;
      setOmittedNotificationIds(localSeed.omitted);
      setNotificationSettings(readLocalNotificationSettings(activeUid, user.email));
      hydrateTerminologySettingsFromCloud(activeUid).catch(() => {});
      hydrateNotificationStateFromCloud(activeUid, user.email).catch(() => {});
    }

    loadData();
    navigationService.syncUrlWithCurrentState();

    const stopLiveSync = firestoreSync.startLiveCloudWorkspaceSync(({ scope }) => {
      if (scope === 'settings' || scope === 'focus') {
        loadData();
        const uid = getActiveUserId();
        if (uid) {
          hydrateTerminologySettingsFromCloud(uid).catch(() => {});
          hydrateNotificationStateFromCloud(uid, user.email).catch(() => {});
        }
      }
    });

    return () => {
      stopLiveSync();
    };
  }, [user?.id, user?.email, loadData, hydrateNotificationStateFromCloud]);

  // Cascaded synchronization of student attendance/disposition status across modules (in-memory, zero network re-fetch)
  useEffect(() => {
    const handleStudentStatusSync = () => {
      try {
        const localStudents = api.deduplicateStudents(api.getLocalStudents());
        const localCourses =
          coursesRef.current.length > 0 ? coursesRef.current : api.getLocalCourses();
        const scheduleByCourseId = new Map<string, string>();
        const perCourseDispMap = new Map<string, Record<string, any>>();

        localCourses.forEach((c) => {
          if (c.id && c.schedule) scheduleByCourseId.set(c.id, c.schedule);
          if (c.id) {
            try {
              const courseSettings = getCourseAttendanceSettings(c.id, c.schedule);
              const activeTerm = getCurrentCalendarTerm(courseSettings);
              const rawCourseDisp =
                api.getUserScopedItem(`fds_disposition_data_${c.id}_${activeTerm}`) ||
                (activeTerm === '2c'
                  ? api.getUserScopedItem(`fds_disposition_data_${c.id}_1c`)
                  : null);
              if (rawCourseDisp) {
                const parsed = JSON.parse(rawCourseDisp);
                if (parsed && typeof parsed === 'object') {
                  perCourseDispMap.set(c.id, parsed);
                }
              }
            } catch (_) {}
          }
        });

        const localDisp = api.getAllDispositionStorage().disposition || {};
        const enriched = localStudents.map((st) => {
          const courseDisp = st.courseId ? perCourseDispMap.get(st.courseId) : undefined;
          const candidateGlobal =
            localDisp[`${st.courseId}::${st.id}`] || localDisp[st.id];
          const d =
            courseDisp?.[st.id] ||
            (candidateGlobal &&
            (!candidateGlobal.courseId || candidateGlobal.courseId === st.courseId)
              ? candidateGlobal
              : undefined);
          if (d && typeof d.totalAbsences === 'number') {
            const rate = computeQuickStudentAttendanceRate(
              st.id,
              st.courseId,
              d.totalAbsences,
              d.totalLates || 0,
              st.courseId ? scheduleByCourseId.get(st.courseId) : undefined
            );
            if (rate !== st.attendanceRate) {
              return { ...st, attendanceRate: rate };
            }
          }
          return st;
        });

        setStudents((prev) => reconcileStudentList(prev, enriched));
      } catch (_) {}
    };

    return subscribeAppEvents(
      ['docencia_disposition_storage_change', 'docencia_student_status_updated'],
      handleStudentStatusSync,
      60
    );
  }, []);

  // Immediately reflect course schedule/details updates across Sidebar, Mis Materias, and Workspace
  useEffect(() => {
    const handleCoursesUpdated = () => {
      try {
        const latestCourses = api.deduplicateCourses(api.getLocalCourses());
        setCourses((prev) => reconcileCourseList(prev, latestCourses));
        navigationService.reconcileWithCourses(latestCourses);
      } catch (_) {}
    };

    return subscribeAppEvents(['docencia_courses_updated'], handleCoursesUpdated, 40);
  }, []);

  const createCourse = useCallback(
    async (courseData: Partial<Course>): Promise<Course> => {
      setIsLoading(true);
      try {
        const newCourse = await api.createCourse(courseData);
        await loadData();
        navigationService.navigateTransaction({
          courseId: newCourse.id,
          historyMode: 'replace',
          scrollToTop: false,
        });
        return newCourse;
      } finally {
        setIsLoading(false);
      }
    },
    [loadData]
  );

  const deleteCourse = useCallback(
    async (courseId: string): Promise<{ message?: string; courseName: string }> => {
      const courseToDelete = coursesRef.current.find(
        (c) => c.id === courseId || c.classroomCourseId === courseId
      );
      const courseName = courseToDelete ? courseToDelete.name : 'Materia';

      const res = await api.deleteCourse(courseId);

      // Immediately update local state and reconcile navigation transactionally
      setCourses((prev) => {
        const updated = prev.filter(
          (c) => c.id !== courseId && c.classroomCourseId !== courseId
        );
        navigationService.reconcileWithCourses(updated, {
          deletedCourseId: courseToDelete?.id || courseId,
        });
        return reconcileCourseList(prev, updated);
      });

      await loadData();
      return { message: res.message, courseName };
    },
    [loadData]
  );

  const clearAllCourses = useCallback(async (): Promise<{ message?: string }> => {
    setIsLoading(true);
    try {
      const res = await api.clearAllCourses();
      navigationService.clearLastActiveCourse();
      setCourses((prev) => (prev.length === 0 ? prev : []));
      setStudents((prev) => (prev.length === 0 ? prev : []));
      navigationService.navigateTransaction({
        view: 'courses',
        courseId: '',
        historyMode: 'replace',
        scrollToTop: false,
      });
      return { message: res.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restoreDemoCourses = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await api.restoreDemoCourses();
      await loadData();
    } finally {
      setIsLoading(false);
    }
  }, [loadData]);

  const contextValue = useMemo<GlobalDataContextValue>(
    () => ({
      courses,
      students,
      isLoading,
      coursesRef,
      studentsRef,
      loadData,
      refreshData: loadData,
      setCourses,
      setStudents,
      createCourse,
      deleteCourse,
      clearAllCourses,
      restoreDemoCourses,
      omittedNotificationIds,
      omittedNotificationIdsRef,
      markNotificationsAsNoSend,
      clearNotificationsNoSend,
      notificationSettings,
      updateNotificationSettings,
    }),
    [
      courses,
      students,
      isLoading,
      loadData,
      createCourse,
      deleteCourse,
      clearAllCourses,
      restoreDemoCourses,
      omittedNotificationIds,
      markNotificationsAsNoSend,
      clearNotificationsNoSend,
      notificationSettings,
      updateNotificationSettings,
    ]
  );

  return (
    <GlobalDataContext.Provider value={contextValue}>
      {children}
    </GlobalDataContext.Provider>
  );
};

export const GlobalDataProvider = GlobalDataContextProvider;

export function useGlobalData(): GlobalDataContextValue {
  const context = useContext(GlobalDataContext);
  if (!context) {
    throw new Error('useGlobalData must be used within a GlobalDataContextProvider');
  }
  return context;
}
