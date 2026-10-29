/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed Storage Gateway (Capa de Abstracción de Almacenamiento Local).
 * Centralizes all user-scoped and global localStorage operations with quota protection
 * (`safeSetLocalStorageItem`), primary-owner fallback resolution, and safe JSON parsing.
 */

import { safeSetLocalStorageItem } from '../utils/storageGuard';
import { getUserStorageKey, getUserScopedItem, setUserScopedItem, isPrimaryOwnerAccount } from './storageHelpers';
import { getActiveUserId } from './firestoreSync';
import { indexedDbStore } from './indexedDbStore';

export type AcademicTermPreference = '1c' | '2c' | 'annual';

export const storageGateway = {
  /**
   * Reads a raw string value scoped to the active teacher (hitting in-memory cache first,
   * then localStorage with primary-owner legacy fallback).
   */
  getScopedString(baseKey: string): string | null {
    const scopedKey = getUserStorageKey(baseKey);
    const cached = indexedDbStore.getFromMemory(scopedKey);
    if (cached !== undefined) return cached;

    const val = getUserScopedItem(baseKey);
    if (val !== null) {
      indexedDbStore.setMemoryAndIdb(scopedKey, val);
    }
    return val;
  },

  /**
   * Writes a raw string value scoped to the active teacher using the quota guard
   * + write-through in-memory cache + asynchronous IndexedDB persistence.
   */
  setScopedString(baseKey: string, value: string): void {
    const scopedKey = getUserStorageKey(baseKey);
    indexedDbStore.setMemoryAndIdb(scopedKey, value);
    setUserScopedItem(baseKey, value);
  },

  /**
   * Reads and parses a JSON value scoped to the active teacher.
   */
  getScopedJson<T>(baseKey: string, fallback: T): T {
    try {
      const raw = this.getScopedString(baseKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  },

  /**
   * Serializes and writes a JSON value scoped to the active teacher using the quota guard
   * + write-through in-memory cache + asynchronous IndexedDB persistence.
   */
  setScopedJson<T>(baseKey: string, value: T): void {
    try {
      this.setScopedString(baseKey, JSON.stringify(value));
    } catch (_) {}
  },

  /**
   * Ensures the IndexedDB write-through cache is hydrated.
   */
  hydrateFromIndexedDb(): Promise<void> {
    return indexedDbStore.hydrateMemoryCache();
  },

  /**
   * Reads the teacher's active academic term ('1c' | '2c' | 'annual') for a course.
   */
  getCourseActiveTerm(courseId?: string): AcademicTermPreference | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw =
        (courseId ? localStorage.getItem(`fds_attendance_active_term_${courseId}`) : null) ||
        localStorage.getItem('fds_attendance_active_term');
      if (raw === '1c' || raw === '2c' || raw === 'annual') {
        return raw;
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Persists the teacher's active academic term ('1c' | '2c' | 'annual') for a course and globally.
   */
  setCourseActiveTerm(term: AcademicTermPreference, courseId?: string): void {
    if (typeof window === 'undefined') return;
    try {
      safeSetLocalStorageItem('fds_attendance_active_term', term);
      if (courseId) {
        safeSetLocalStorageItem(`fds_attendance_active_term_${courseId}`, term);
        safeSetLocalStorageItem(`fds_grades_active_term_${courseId}`, term);
      }
    } catch (_) {}
  },

  /**
   * Reads grade history entries for a specific course.
   */
  getCourseGradeHistory<T = any>(courseId: string): T[] {
    if (!courseId || typeof window === 'undefined') return [];
    return this.getScopedJson<T[]>(`fds_grade_history_${courseId}`, []);
  },

  /**
   * Reads the student observations map for the active teacher.
   */
  getStudentObservationsMap<T = Record<string, any>>(): T {
    return this.getScopedJson<T>('fds_student_observations', {} as T);
  },

  /**
   * Reads 2° Cuatrimestre disposition map for the active teacher.
   */
  getDisposition2cMap<T = Record<string, any>>(): T {
    return this.getScopedJson<T>('fds_disposition_data_2c', {} as T);
  },

  /**
   * Collects all teacher-scoped `fds_*` and `docencia_*` localStorage keys for full backup export.
   */
  collectTeacherScopedSnapshot(): Record<string, any> {
    if (typeof window === 'undefined') return {};
    const uid = getActiveUserId();
    const isOwner = isPrimaryOwnerAccount();
    const snapshot: Record<string, any> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith('fds_') || key.startsWith('docencia_')) &&
        !key.includes('token')
      ) {
        const belongsToTeacher = uid
          ? key.endsWith(`_${uid}`) || (isOwner && !key.includes('_usr_'))
          : true;
        if (!belongsToTeacher) continue;
        try {
          const raw = localStorage.getItem(key);
          snapshot[key] = raw ? JSON.parse(raw) : raw;
        } catch {
          snapshot[key] = localStorage.getItem(key);
        }
      }
    }
    return snapshot;
  },

  getUserStorageKey,
  isPrimaryOwnerAccount,
};
