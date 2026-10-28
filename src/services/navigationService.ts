/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore, useCallback } from 'react';
import { Course } from '../types';
import { findCourseMatch } from '../utils/courseFormatting';
import { api } from './api';
import {
  getCourseSnapshotFromLru,
  putCourseSnapshotInLru,
  refreshCachedSnapshotsFromPool,
  evictCourseFromAllLruCaches,
  removeCourseSnapshotFromLru,
  touchCourseDataLru,
  getAllCachedCourseSnapshots,
} from '../utils/lruCourseCache';
import { safeSetLocalStorageItem } from '../utils/storageGuard';

export type AppViewType = 'courses' | 'course_detail' | 'calendar';
export type CourseSubTabType = 'roster' | 'libro_temas' | 'grades' | 'history';

export interface NavigationState {
  currentView: AppViewType;
  selectedCourseId: string;
  subTab: CourseSubTabType;
  revision: number;
}

export interface NavigationTransactionInput {
  view?: AppViewType;
  courseId?: string;
  subTab?: CourseSubTabType;
  coursesPool?: Course[];
  historyMode?: 'push' | 'replace' | 'none';
  scrollToTop?: boolean;
}

type NavigationListener = () => void;

const VALID_VIEWS = new Set<AppViewType>(['courses', 'course_detail', 'calendar']);
const VALID_SUB_TABS = new Set<CourseSubTabType>(['roster', 'libro_temas', 'grades', 'history']);

export const LAST_ACTIVE_COURSE_ID_KEY = 'docencia_last_active_course_id';
export const LAST_ACTIVE_COURSE_SNAPSHOT_KEY = 'docencia_last_active_course_snapshot';
export const LAST_ACTIVE_VIEW_KEY = 'docencia_last_active_view';
export const LAST_ACTIVE_SUBTAB_KEY = 'docencia_last_active_subtab';

class UnifiedNavigationService {
  private state: NavigationState;
  private listeners = new Set<NavigationListener>();
  private explicitUserCourseSelection = false;

  constructor() {
    this.state = this.readInitialStateFromUrl();

    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.handlePopState);
    }
  }

  private getCoursesPool(providedPool?: Course[]): Course[] {
    if (Array.isArray(providedPool) && providedPool.length > 0) {
      return providedPool;
    }
    try {
      const localCourses = api.getLocalCourses();
      if (Array.isArray(localCourses) && localCourses.length > 0) {
        return localCourses;
      }
      return getAllCachedCourseSnapshots();
    } catch (_) {
      return getAllCachedCourseSnapshots();
    }
  }

  public getLastActiveCourseId = (): string => {
    if (typeof window === 'undefined') return '';
    try {
      const scoped = (api.getUserScopedItem?.(LAST_ACTIVE_COURSE_ID_KEY) || '').trim();
      if (scoped) return scoped;
      return (window.localStorage.getItem(LAST_ACTIVE_COURSE_ID_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  };

  public getLastActiveView = (): AppViewType | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = (
        api.getUserScopedItem?.(LAST_ACTIVE_VIEW_KEY) ||
        window.localStorage.getItem(LAST_ACTIVE_VIEW_KEY) ||
        ''
      ).trim() as AppViewType;
      return VALID_VIEWS.has(raw) ? raw : null;
    } catch (_) {
      return null;
    }
  };

  public getLastActiveSubTab = (): CourseSubTabType | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = (
        api.getUserScopedItem?.(LAST_ACTIVE_SUBTAB_KEY) ||
        window.localStorage.getItem(LAST_ACTIVE_SUBTAB_KEY) ||
        ''
      ).trim() as CourseSubTabType;
      return VALID_SUB_TABS.has(raw) ? raw : null;
    } catch (_) {
      return null;
    }
  };

  public getLastActiveCourseSnapshot = (targetCourseId?: string): Course | null => {
    if (typeof window === 'undefined') return null;
    try {
      // 1. Check the bounded LRU course snapshot cache first (promotes hit to MRU)
      const lruHit = getCourseSnapshotFromLru(targetCourseId, true);
      if (lruHit) {
        return lruHit;
      }

      // 2. Fallback to legacy single snapshot key if present
      const raw =
        api.getUserScopedItem?.(LAST_ACTIVE_COURSE_SNAPSHOT_KEY) ||
        window.localStorage.getItem(LAST_ACTIVE_COURSE_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Course;
      if (!parsed || typeof parsed !== 'object' || !parsed.id) return null;
      if (!targetCourseId) {
        putCourseSnapshotInLru(parsed);
        return parsed;
      }
      const cleanTarget = targetCourseId.trim();
      if (
        parsed.id === cleanTarget ||
        parsed.classroomCourseId === cleanTarget ||
        Boolean(findCourseMatch(cleanTarget, [parsed]))
      ) {
        putCourseSnapshotInLru(parsed);
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  };

  public persistLastActiveCourse = (
    courseId: string,
    coursesPool?: Course[],
    view?: AppViewType,
    subTab?: CourseSubTabType
  ): void => {
    if (typeof window === 'undefined') return;
    try {
      const cleanId = (courseId || '').trim();
      if (cleanId) {
        api.setUserScopedItem?.(LAST_ACTIVE_COURSE_ID_KEY, cleanId);
        safeSetLocalStorageItem(LAST_ACTIVE_COURSE_ID_KEY, cleanId);
        touchCourseDataLru(cleanId);

        const pool = this.getCoursesPool(coursesPool);
        const matched =
          findCourseMatch(cleanId, pool) || getCourseSnapshotFromLru(cleanId, false);
        if (matched && matched.id && matched.name && matched.name !== 'Cargando materia...') {
          putCourseSnapshotInLru(matched);
          touchCourseDataLru(matched.id);
        }
      }
      if (view && VALID_VIEWS.has(view)) {
        api.setUserScopedItem?.(LAST_ACTIVE_VIEW_KEY, view);
        safeSetLocalStorageItem(LAST_ACTIVE_VIEW_KEY, view);
      }
      if (subTab && VALID_SUB_TABS.has(subTab)) {
        api.setUserScopedItem?.(LAST_ACTIVE_SUBTAB_KEY, subTab);
        safeSetLocalStorageItem(LAST_ACTIVE_SUBTAB_KEY, subTab);
      }
    } catch (_) {}
  };

  public clearLastActiveCourse = (deletedCourseId?: string): void => {
    if (typeof window === 'undefined') return;
    try {
      if (deletedCourseId) {
        const cleanDeleted = deletedCourseId.trim();
        const storedId = this.getLastActiveCourseId();
        const storedSnap = getCourseSnapshotFromLru(undefined, false);

        // Evict the deleted course from both the snapshot LRU and data hooks LRU caches
        evictCourseFromAllLruCaches(cleanDeleted);

        const matchesDeleted =
          storedId === cleanDeleted ||
          storedSnap?.id === cleanDeleted ||
          storedSnap?.classroomCourseId === cleanDeleted;
        if (!matchesDeleted) return;

        // Promote the next MRU snapshot if available, otherwise clear active ID
        const nextMru = getCourseSnapshotFromLru(undefined, false);
        if (nextMru?.id) {
          api.setUserScopedItem?.(LAST_ACTIVE_COURSE_ID_KEY, nextMru.id);
          safeSetLocalStorageItem(LAST_ACTIVE_COURSE_ID_KEY, nextMru.id);
          return;
        }
      } else {
        removeCourseSnapshotFromLru();
      }
      api.setUserScopedItem?.(LAST_ACTIVE_COURSE_ID_KEY, '');
      window.localStorage.removeItem(LAST_ACTIVE_COURSE_ID_KEY);
      api.setUserScopedItem?.(LAST_ACTIVE_COURSE_SNAPSHOT_KEY, '');
      window.localStorage.removeItem(LAST_ACTIVE_COURSE_SNAPSHOT_KEY);
    } catch (_) {}
  };

  private readInitialStateFromUrl(): NavigationState {
    if (typeof window === 'undefined') {
      return {
        currentView: 'courses',
        selectedCourseId: '',
        subTab: 'roster',
        revision: 0,
      };
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const rawCourse = (params.get('course') || '').trim();
      const rawView = (params.get('view') || '').trim() as AppViewType;
      const rawSubTab = (params.get('tab') || '').trim() as CourseSubTabType;

      const localPool = this.getCoursesPool();
      const persistedCourseId = this.getLastActiveCourseId();
      const persistedView = this.getLastActiveView();
      const persistedSubTab = this.getLastActiveSubTab();

      let resolvedCourseId = '';

      if (rawCourse) {
        this.explicitUserCourseSelection = true;
        const matched = findCourseMatch(rawCourse, localPool);
        resolvedCourseId = matched ? matched.id : rawCourse;
      } else if (persistedCourseId) {
        this.explicitUserCourseSelection = true;
        const matched = findCourseMatch(persistedCourseId, localPool);
        resolvedCourseId = matched ? matched.id : persistedCourseId;
      } else if (localPool.length > 0) {
        resolvedCourseId = localPool[0].id;
      }

      const resolvedView: AppViewType = VALID_VIEWS.has(rawView)
        ? rawView
        : rawCourse
        ? 'course_detail'
        : persistedCourseId && (!persistedView || persistedView === 'course_detail')
        ? 'course_detail'
        : persistedView || 'courses';

      const resolvedSubTab: CourseSubTabType = VALID_SUB_TABS.has(rawSubTab)
        ? rawSubTab
        : persistedSubTab || 'roster';

      if (resolvedCourseId) {
        this.persistLastActiveCourse(resolvedCourseId, localPool, resolvedView, resolvedSubTab);
      }

      return {
        currentView: resolvedView,
        selectedCourseId: resolvedCourseId,
        subTab: resolvedSubTab,
        revision: 0,
      };
    } catch (_) {
      return {
        currentView: 'courses',
        selectedCourseId: '',
        subTab: 'roster',
        revision: 0,
      };
    }
  }

  private handlePopState = () => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const rawCourse = (params.get('course') || '').trim();
      const rawView = (params.get('view') || '').trim() as AppViewType;
      const rawSubTab = (params.get('tab') || '').trim() as CourseSubTabType;

      const pool = this.getCoursesPool();
      let nextCourseId = this.state.selectedCourseId;
      let nextView: AppViewType = 'courses';

      if (rawCourse) {
        this.explicitUserCourseSelection = true;
        const matched = findCourseMatch(rawCourse, pool);
        nextCourseId = matched ? matched.id : rawCourse;
        nextView = VALID_VIEWS.has(rawView) ? rawView : 'course_detail';
      } else if (VALID_VIEWS.has(rawView)) {
        nextView = rawView;
      } else {
        nextView = 'courses';
      }

      const nextSubTab: CourseSubTabType = VALID_SUB_TABS.has(rawSubTab)
        ? rawSubTab
        : this.state.subTab;

      this.commitTransaction({
        currentView: nextView,
        selectedCourseId: nextCourseId,
        subTab: nextSubTab,
        historyMode: 'none',
        scrollToTop: false,
      });
    } catch (_) {}
  };

  private syncBrowserUrl(
    view: AppViewType,
    courseId: string,
    subTab: CourseSubTabType,
    mode: 'push' | 'replace' | 'none'
  ): void {
    if (typeof window === 'undefined' || mode === 'none') return;
    try {
      const url = new URL(window.location.href);
      const currentViewParam = url.searchParams.get('view') || '';
      const currentCourseParam = (url.searchParams.get('course') || '').trim();
      const currentTabParam = (url.searchParams.get('tab') || '').trim();

      if (view === 'course_detail' && courseId) {
        url.searchParams.set('course', courseId);
        url.searchParams.set('view', 'course_detail');
        if (subTab && subTab !== 'roster') {
          url.searchParams.set('tab', subTab);
        } else {
          url.searchParams.delete('tab');
        }
      } else if (view === 'calendar') {
        url.searchParams.set('view', 'calendar');
        url.searchParams.delete('course');
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('view', 'courses');
        url.searchParams.delete('course');
        url.searchParams.delete('tab');
      }

      const nextViewParam = url.searchParams.get('view') || '';
      const nextCourseParam = (url.searchParams.get('course') || '').trim();
      const nextTabParam = (url.searchParams.get('tab') || '').trim();

      const hasUrlChanged =
        currentViewParam !== nextViewParam ||
        currentCourseParam !== nextCourseParam ||
        currentTabParam !== nextTabParam;

      if (!hasUrlChanged) return;

      const historyState = {
        currentView: view,
        selectedCourseId: courseId,
        subTab,
      };

      if (mode === 'push') {
        window.history.pushState(historyState, '', url.toString());
      } else {
        window.history.replaceState(historyState, '', url.toString());
      }
    } catch (_) {}
  }

  private commitTransaction(params: {
    currentView: AppViewType;
    selectedCourseId: string;
    subTab: CourseSubTabType;
    historyMode: 'push' | 'replace' | 'none';
    scrollToTop?: boolean;
    coursesPool?: Course[];
  }): NavigationState {
    const { currentView, selectedCourseId, subTab, historyMode, scrollToTop, coursesPool } = params;

    // 1. Persist last active course & view in localStorage for instant optimistic UI on next load
    this.persistLastActiveCourse(selectedCourseId, coursesPool, currentView, subTab);

    // 2. Update browser URL synchronously first so window.location.search is immediately consistent
    this.syncBrowserUrl(currentView, selectedCourseId, subTab, historyMode);

    // 3. Check if state actually changed
    const stateChanged =
      this.state.currentView !== currentView ||
      this.state.selectedCourseId !== selectedCourseId ||
      this.state.subTab !== subTab;

    if (stateChanged) {
      this.state = {
        currentView,
        selectedCourseId,
        subTab,
        revision: this.state.revision + 1,
      };
      this.emitChange();
    }

    if (scrollToTop && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    return this.state;
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error in navigation listener:', err);
      }
    });
  }

  public getState = (): NavigationState => {
    return this.state;
  };

  public subscribe = (listener: NavigationListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Executes an atomic navigation transaction updating React state (`currentView`, `selectedCourseId`, `subTab`),
   * `localStorage` persistence, and browser URL history simultaneously.
   */
  public navigateTransaction = (input: NavigationTransactionInput): NavigationState => {
    const pool = this.getCoursesPool(input.coursesPool);
    const nextView: AppViewType = input.view || this.state.currentView;
    const nextSubTab: CourseSubTabType = input.subTab || this.state.subTab;

    let nextCourseId = this.state.selectedCourseId;
    if (input.courseId !== undefined) {
      const cleanId = input.courseId.trim();
      if (!cleanId) {
        nextCourseId = '';
      } else {
        this.explicitUserCourseSelection = true;
        const matched = findCourseMatch(cleanId, pool);
        nextCourseId = matched ? matched.id : cleanId;
      }
    } else if (nextView === 'course_detail' && !nextCourseId) {
      const persistedId = this.getLastActiveCourseId();
      if (persistedId) {
        this.explicitUserCourseSelection = true;
        const matched = findCourseMatch(persistedId, pool);
        nextCourseId = matched ? matched.id : persistedId;
      } else if (pool.length > 0) {
        nextCourseId = pool[0].id;
      }
    }

    const historyMode = input.historyMode || 'push';

    return this.commitTransaction({
      currentView: nextView,
      selectedCourseId: nextCourseId,
      subTab: nextSubTab,
      historyMode,
      scrollToTop: input.scrollToTop ?? (historyMode === 'push'),
      coursesPool: pool,
    });
  };

  /**
   * Selects a course and navigates to `course_detail` in a single atomic transaction.
   */
  public selectCourse = (
    courseId: string,
    subTab?: CourseSubTabType,
    coursesPool?: Course[]
  ): NavigationState => {
    if (!courseId || !courseId.trim()) return this.state;
    return this.navigateTransaction({
      view: 'course_detail',
      courseId,
      subTab: subTab || this.state.subTab,
      coursesPool,
      historyMode: 'push',
      scrollToTop: true,
    });
  };

  /**
   * Updates only the active sub-tab within `course_detail` transactionally.
   */
  public setSubTab = (subTab: CourseSubTabType): NavigationState => {
    if (!VALID_SUB_TABS.has(subTab)) return this.state;
    return this.commitTransaction({
      currentView: this.state.currentView,
      selectedCourseId: this.state.selectedCourseId,
      subTab,
      historyMode: 'replace',
      scrollToTop: false,
    });
  };

  /**
   * Pre-loads the last visited course detail view from `localStorage` BEFORE Firebase completes loading.
   * Ensures 0ms optimistic UI for the active course and returns the resolved course ID and cached snapshot.
   */
  public preloadOptimisticCourseState = (
    localCoursesPool?: Course[]
  ): {
    targetCourseId: string;
    optimisticCourse: Course | null;
    optimisticCoursesList: Course[];
  } => {
    const pool = this.getCoursesPool(localCoursesPool);
    let urlCourseParam = '';
    let urlViewParam = '' as AppViewType;

    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        urlCourseParam = (params.get('course') || '').trim();
        urlViewParam = (params.get('view') || '').trim() as AppViewType;
      } catch (_) {}
    }

    const persistedCourseId = this.getLastActiveCourseId();
    const persistedView = this.getLastActiveView();

    // Determine target course ID: URL param -> current explicit state -> persisted last active course ID in localStorage -> first local course
    const candidateCourseId =
      urlCourseParam ||
      (this.explicitUserCourseSelection && this.state.selectedCourseId ? this.state.selectedCourseId : '') ||
      persistedCourseId ||
      this.state.selectedCourseId ||
      (pool[0]?.id || '');

    let matchedCourse: Course | null = null;
    if (candidateCourseId) {
      matchedCourse =
        findCourseMatch(candidateCourseId, pool) ||
        this.getLastActiveCourseSnapshot(candidateCourseId);
    }

    const resolvedCourseId = matchedCourse ? matchedCourse.id : candidateCourseId;

    // Build an optimistic courses list that includes the cached snapshot if not yet in pool
    const optimisticCoursesList = [...pool];
    if (
      matchedCourse &&
      !optimisticCoursesList.some(
        (c) =>
          c.id === matchedCourse!.id ||
          (c.classroomCourseId && c.classroomCourseId === matchedCourse!.classroomCourseId)
      )
    ) {
      optimisticCoursesList.unshift(matchedCourse);
    }

    if (resolvedCourseId) {
      if (urlCourseParam || persistedCourseId) {
        this.explicitUserCourseSelection = true;
      }

      // Pre-load course_detail view if URL requests it, or if user was in course_detail / had a persisted last active course without an explicit 'courses'/'calendar' URL override
      const shouldPreloadDetail =
        urlViewParam === 'course_detail' ||
        Boolean(urlCourseParam) ||
        this.state.currentView === 'course_detail' ||
        (!VALID_VIEWS.has(urlViewParam) &&
          Boolean(persistedCourseId) &&
          (!persistedView || persistedView === 'course_detail'));

      const targetView: AppViewType = shouldPreloadDetail
        ? 'course_detail'
        : VALID_VIEWS.has(urlViewParam)
        ? urlViewParam
        : this.state.currentView;

      if (
        this.state.selectedCourseId !== resolvedCourseId ||
        this.state.currentView !== targetView
      ) {
        this.commitTransaction({
          currentView: targetView,
          selectedCourseId: resolvedCourseId,
          subTab: this.state.subTab,
          historyMode: 'replace',
          scrollToTop: false,
          coursesPool: optimisticCoursesList,
        });
      } else {
        this.persistLastActiveCourse(
          resolvedCourseId,
          optimisticCoursesList,
          targetView,
          this.state.subTab
        );
      }
    }

    return {
      targetCourseId: resolvedCourseId,
      optimisticCourse: matchedCourse,
      optimisticCoursesList,
    };
  };

  /**
   * Reconciles the current navigation state against a newly loaded or updated list of courses
   * WITHOUT overwriting explicit user course selections, URL deep links, or persisted last active course ID.
   */
  public reconcileWithCourses = (
    coursesList: Course[],
    options?: { deletedCourseId?: string }
  ): NavigationState => {
    if (!Array.isArray(coursesList)) return this.state;

    if (coursesList.length === 0) {
      if (!this.explicitUserCourseSelection && this.state.selectedCourseId) {
        return this.commitTransaction({
          currentView: this.state.currentView === 'course_detail' ? 'courses' : this.state.currentView,
          selectedCourseId: '',
          subTab: this.state.subTab,
          historyMode: 'replace',
          scrollToTop: false,
        });
      }
      return this.state;
    }

    // Keep existing LRU course snapshots up to date with fresh metadata without exceeding LRU capacity
    refreshCachedSnapshotsFromPool(coursesList);

    // If a course was explicitly deleted, clear it from last active storage and move to fallback if it was selected
    if (options?.deletedCourseId) {
      this.clearLastActiveCourse(options.deletedCourseId);
      if (
        this.state.selectedCourseId === options.deletedCourseId ||
        !coursesList.some((c) => c.id === this.state.selectedCourseId)
      ) {
        const fallbackId = coursesList[0]?.id || '';
        return this.commitTransaction({
          currentView: fallbackId ? this.state.currentView : 'courses',
          selectedCourseId: fallbackId,
          subTab: this.state.subTab,
          historyMode: 'replace',
          scrollToTop: false,
          coursesPool: coursesList,
        });
      }
    }

    const currentId = this.state.selectedCourseId || this.getLastActiveCourseId();

    if (currentId) {
      const matched = findCourseMatch(currentId, coursesList);
      if (matched) {
        this.persistLastActiveCourse(matched.id, coursesList, this.state.currentView, this.state.subTab);
        if (matched.id !== this.state.selectedCourseId) {
          return this.commitTransaction({
            currentView: this.state.currentView,
            selectedCourseId: matched.id,
            subTab: this.state.subTab,
            historyMode: 'replace',
            scrollToTop: false,
            coursesPool: coursesList,
          });
        }
        return this.state;
      }

      // If the user explicitly opened a deep link (?course=...), selected a course, or had a persisted last active course,
      // preserve that ID instead of replacing it with coursesList[0] (e.g. S3 Soc 2).
      if (this.explicitUserCourseSelection) {
        return this.state;
      }
    }

    // Only default to coursesList[0] when no course was selected or persisted in localStorage
    return this.commitTransaction({
      currentView: this.state.currentView,
      selectedCourseId: coursesList[0].id,
      subTab: this.state.subTab,
      historyMode: 'replace',
      scrollToTop: false,
      coursesPool: coursesList,
    });
  };

  /**
   * Ensures the browser URL reflects the current state after login without altering user selection.
   */
  public syncUrlWithCurrentState = (): void => {
    this.syncBrowserUrl(
      this.state.currentView,
      this.state.selectedCourseId,
      this.state.subTab,
      'replace'
    );
  };
}

export const navigationService = new UnifiedNavigationService();

export function useNavigationService() {
  const navState = useSyncExternalStore(
    navigationService.subscribe,
    navigationService.getState,
    navigationService.getState
  );

  const navigateTransaction = useCallback(
    (input: NavigationTransactionInput) => navigationService.navigateTransaction(input),
    []
  );

  const selectCourse = useCallback(
    (courseId: string, subTab?: CourseSubTabType, coursesPool?: Course[]) =>
      navigationService.selectCourse(courseId, subTab, coursesPool),
    []
  );

  const setSubTab = useCallback(
    (subTab: CourseSubTabType) => navigationService.setSubTab(subTab),
    []
  );

  const preloadOptimisticCourseState = useCallback(
    (localCoursesPool?: Course[]) =>
      navigationService.preloadOptimisticCourseState(localCoursesPool),
    []
  );

  const reconcileWithCourses = useCallback(
    (coursesList: Course[], options?: { deletedCourseId?: string }) =>
      navigationService.reconcileWithCourses(coursesList, options),
    []
  );

  return {
    currentView: navState.currentView,
    selectedCourseId: navState.selectedCourseId,
    subTab: navState.subTab,
    revision: navState.revision,
    navigateTransaction,
    selectCourse,
    setSubTab,
    preloadOptimisticCourseState,
    reconcileWithCourses,
    syncUrlWithCurrentState: navigationService.syncUrlWithCurrentState,
    getLastActiveCourseId: navigationService.getLastActiveCourseId,
    getLastActiveCourseSnapshot: navigationService.getLastActiveCourseSnapshot,
    clearLastActiveCourse: navigationService.clearLastActiveCourse,
  };
}

