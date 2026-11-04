/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Students Domain Repository.
 */

import { Student } from '../../types';
import {
  api,
  getLocalStudents,
  saveLocalStudents,
  deduplicateStudents,
  getRemovedStudentIds,
  getRemovedStudentsList,
  markStudentRemoved,
  unmarkStudentRemoved,
} from '../api';

export const studentsRepository = {
  getLocal: getLocalStudents,
  saveLocal: saveLocalStudents,
  deduplicate: deduplicateStudents,
  fetchAll: (): Promise<Student[]> => api.getStudents(),
  create: (studentData: Partial<Student> & { courseId: string; firstName: string; lastName: string; email?: string }): Promise<Student> =>
    api.createStudent(studentData),
  update: (studentId: string, courseId: string, updates: Partial<Student>) =>
    api.updateStudent(studentId, courseId, updates),
  delete: (studentOrId: Student | string, courseId: string) =>
    api.removeStudentFromCourse(studentOrId, courseId),
  getRemovedIds: getRemovedStudentIds,
  getRemovedList: getRemovedStudentsList,
  markRemoved: markStudentRemoved,
  unmarkRemoved: unmarkStudentRemoved,
};
