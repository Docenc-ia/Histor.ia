/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified frontend API facade composing domain modules (auth, courses, students,
 * disposition, and secondary endpoints) while preserving all existing exports.
 */

import { apiSecondaryEndpoints } from './apiSecondaryEndpoints';
import { authApi } from './apiModules/authApi';
import { coursesApi } from './apiModules/coursesApi';
import { studentsApi } from './apiModules/studentsApi';
import { dispositionApi } from './apiModules/dispositionApi';
import {
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  normalizeCourseCanonicalKey,
  areCoursesSame,
  deduplicateCourses,
  deduplicateStudents,
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  PRIMARY_DISPOSITION_KEY,
  PRIMARY_HISTORY_KEY,
  DELETED_HISTORY_IDS_KEY,
  getDeletedHistoryIds,
  markHistoryIdDeleted,
  deduplicateHistoryItems,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getLocalDisposition2c,
  saveLocalDisposition2c,
  getRemovedStudentsIndex,
  getRemovedStudentIds,
  getRemovedStudentsList,
  markStudentRemoved,
  unmarkStudentRemoved,
  syncAllRemovedStudentsIndexFromCloud,
  syncRemovedStudentsFromCloud,
  getCourseDivisionGroupKey,
  getDivisionCandidateStudentsForCourse,
  healSiblingCourseRosters,
} from './storageHelpers';

export {
  getUserStorageKey,
  getUserScopedItem,
  setUserScopedItem,
  normalizeCourseCanonicalKey,
  areCoursesSame,
  deduplicateCourses,
  deduplicateStudents,
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  PRIMARY_DISPOSITION_KEY,
  PRIMARY_HISTORY_KEY,
  DELETED_HISTORY_IDS_KEY,
  getDeletedHistoryIds,
  markHistoryIdDeleted,
  deduplicateHistoryItems,
  saveAllDispositionStorage,
  getAllDispositionStorage,
  getLocalDisposition2c,
  saveLocalDisposition2c,
  getRemovedStudentsIndex,
  getRemovedStudentIds,
  getRemovedStudentsList,
  markStudentRemoved,
  unmarkStudentRemoved,
  syncAllRemovedStudentsIndexFromCloud,
  syncRemovedStudentsFromCloud,
  getCourseDivisionGroupKey,
  getDivisionCandidateStudentsForCourse,
  healSiblingCourseRosters,
};

export const api = {
  ...authApi,
  ...apiSecondaryEndpoints,
  getUserScopedItem,
  setUserScopedItem,
  ...coursesApi,
  ...studentsApi,
  ...dispositionApi,

  // Storage & deduplication helpers for instant local cache access
  getLocalCourses,
  saveLocalCourses,
  getLocalStudents,
  saveLocalStudents,
  deduplicateCourses,
  deduplicateStudents,
  getAllDispositionStorage,
  saveAllDispositionStorage,
};
