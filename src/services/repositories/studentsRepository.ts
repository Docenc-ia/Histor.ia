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
  create: (studentData: Partial<Student>): Promise<Student> =>
    api.createStudent(studentData),
  update: (studentId: string, updates: Partial<Student>, courseId?: string) =>
    api.updateStudent(studentId, updates, courseId),
  delete: (studentId: string, courseId?: string) =>
    api.deleteStudent(studentId, courseId),
  getRemovedIds: getRemovedStudentIds,
  getRemovedList: getRemovedStudentsList,
  markRemoved: markStudentRemoved,
  unmarkRemoved: unmarkStudentRemoved,
};
