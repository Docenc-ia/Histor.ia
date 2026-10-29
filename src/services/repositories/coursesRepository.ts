/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Courses Domain Repository.
 */

import { Course } from '../../types';
import {
  api,
  getLocalCourses,
  saveLocalCourses,
  deduplicateCourses,
} from '../api';

export const coursesRepository = {
  getLocal: getLocalCourses,
  saveLocal: saveLocalCourses,
  deduplicate: deduplicateCourses,
  fetchAll: (): Promise<Course[]> => api.getCourses(),
  create: (courseData: Partial<Course>): Promise<Course> => api.createCourse(courseData),
  update: (courseId: string, updates: Partial<Course>): Promise<Course> =>
    api.updateCourse(courseId, updates),
  delete: (courseId: string) => api.deleteCourse(courseId),
  clearAll: () => api.clearAllCourses(),
  restoreDemo: () => api.restoreDemoCourses(),
};
