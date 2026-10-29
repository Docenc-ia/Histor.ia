/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CourseWorkspaceContext: Provides active course workspace state (activeCourse,
 * activeTab, attendanceTerm, activeConcreteTerm, courseStudents, attendanceSettings,
 * and currentAttendanceSummary) to sub-modules and modals without prop drilling.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { Course, Student, StudentHistoryItem, StudentDispositionData } from '../types';
import {
  AttendanceSettings,
  CourseAttendanceSummary,
} from '../utils/attendanceCalculations';
import { CourseSubTabType } from '../services/navigationService';

export interface CourseWorkspaceContextValue {
  activeCourse: Course | undefined;
  activeTab: CourseSubTabType;
  setActiveTab: (tab: CourseSubTabType) => void;
  attendanceTerm: '1c' | '2c' | 'annual';
  activeConcreteTerm: '1c' | '2c';
  setAttendanceTerm: (term: '1c' | '2c' | 'annual') => void;
  attendanceSettings: AttendanceSettings;
  setAttendanceSettings: React.Dispatch<React.SetStateAction<AttendanceSettings>>;
  currentAttendanceSummary: CourseAttendanceSummary | undefined;
  courseStudents: Student[];
  filteredStudents: Student[];
  courseHistory: StudentHistoryItem[];
  getStudentMetrics: (
    studentId: string,
    overrideTerm?: '1c' | '2c' | 'annual'
  ) => StudentDispositionData;
}

const CourseWorkspaceContext = createContext<CourseWorkspaceContextValue | undefined>(
  undefined
);

export const CourseWorkspaceProvider: React.FC<
  CourseWorkspaceContextValue & { children: React.ReactNode }
> = ({
  activeCourse,
  activeTab,
  setActiveTab,
  attendanceTerm,
  activeConcreteTerm,
  setAttendanceTerm,
  attendanceSettings,
  setAttendanceSettings,
  currentAttendanceSummary,
  courseStudents,
  filteredStudents,
  courseHistory,
  getStudentMetrics,
  children,
}) => {
  const value = useMemo<CourseWorkspaceContextValue>(
    () => ({
      activeCourse,
      activeTab,
      setActiveTab,
      attendanceTerm,
      activeConcreteTerm,
      setAttendanceTerm,
      attendanceSettings,
      setAttendanceSettings,
      currentAttendanceSummary,
      courseStudents,
      filteredStudents,
      courseHistory,
      getStudentMetrics,
    }),
    [
      activeCourse,
      activeTab,
      setActiveTab,
      attendanceTerm,
      activeConcreteTerm,
      setAttendanceTerm,
      attendanceSettings,
      setAttendanceSettings,
      currentAttendanceSummary,
      courseStudents,
      filteredStudents,
      courseHistory,
      getStudentMetrics,
    ]
  );

  return (
    <CourseWorkspaceContext.Provider value={value}>
      {children}
    </CourseWorkspaceContext.Provider>
  );
};

export function useCourseWorkspace(): CourseWorkspaceContextValue {
  const ctx = useContext(CourseWorkspaceContext);
  if (!ctx) {
    throw new Error('useCourseWorkspace must be used within a CourseWorkspaceProvider');
  }
  return ctx;
}
