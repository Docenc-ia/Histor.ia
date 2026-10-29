/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Aggregation Engine for Course & Individual Trajectory Reports.
 * Extracted from CourseReportModal.tsx to keep UI components focused on presentation
 * and make grade/attendance/disposition calculations independently testable.
 */

import { Student, StudentObservation } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import {
  AttendanceSettings,
  computeStudentAttendanceTrafficLight,
} from './attendanceCalculations';
import type { ExamGradeDetailItem } from '../components/modules/CourseReportModal';

export interface ConsolidatedReportStudent {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  examDetails1c: ExamGradeDetailItem[];
  examDetails2c: ExamGradeDetailItem[];
  calcAvgStr: string;
  calcAvgNum: number | null;
  finalVal: string;
  finalNum: number | null;
  condition: string;
  abs1: number;
  abs2: number;
  totalAbs: number;
  lat1: number;
  lat2: number;
  totalLat: number;
  disp1: number;
  disp2: number;
  avgDisp: number;
  estimatedAttendance: number;
  observation: string;
}

export interface CourseReportStats {
  total: number;
  approvedCount: number;
  approvedPercent: number;
  compCount: number;
  avgScore: string;
  avgAttendance: number;
  totalCourseAbsences: number;
}

export function parseScoreNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim().replace(',', '.');
  if (str === '') return null;
  const num = Number(str);
  return !isNaN(num) ? num : null;
}

export function computeTermScoreForStudent(
  stId: string,
  cats: GradeCategory[],
  gradesMap: StudentGradesMap,
  calcMode: 'average_of_categories' | 'manual_final'
): { scoreStr: string; num: number | null } {
  const stGrades = gradesMap[stId] || {};
  if (
    calcMode === 'manual_final' &&
    stGrades['__final__'] !== undefined &&
    stGrades['__final__'] !== ''
  ) {
    const val = String(stGrades['__final__']).trim();
    const num = parseScoreNumber(val);
    return { scoreStr: val, num };
  }

  const numericScores: number[] = [];
  cats.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      const num = parseScoreNumber(stGrades[cat.id]);
      if (num !== null) {
        numericScores.push(num);
      }
    } else {
      cat.subcategories.forEach((sub) => {
        const num = parseScoreNumber(stGrades[sub.id]);
        if (num !== null) {
          numericScores.push(num);
        }
      });
    }
  });

  if (numericScores.length > 0) {
    const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
    const str = avg.toFixed(1).replace('.0', '');
    return { scoreStr: str, num: avg };
  }

  if (stGrades['__final__'] !== undefined && stGrades['__final__'] !== '') {
    const val = String(stGrades['__final__']).trim();
    const num = parseScoreNumber(val);
    return { scoreStr: val, num };
  }

  return { scoreStr: '', num: null };
}

export function extractStudentExamDetails(
  stId: string,
  cats: GradeCategory[],
  gradesMap: StudentGradesMap
): ExamGradeDetailItem[] {
  const stGrades = gradesMap[stId] || {};
  const items: ExamGradeDetailItem[] = [];
  cats.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      const rawScore = stGrades[cat.id];
      items.push({
        id: cat.id,
        categoryName: cat.name,
        itemName: cat.name,
        score:
          rawScore !== undefined && String(rawScore).trim() !== ''
            ? String(rawScore).trim()
            : '—',
      });
    } else {
      cat.subcategories.forEach((sub) => {
        const rawScore = stGrades[sub.id];
        items.push({
          id: sub.id,
          categoryName: cat.name,
          itemName: sub.name,
          score:
            rawScore !== undefined && String(rawScore).trim() !== ''
              ? String(rawScore).trim()
              : '—',
        });
      });
    }
  });
  return items;
}

export function buildConsolidatedReportStudents(params: {
  courseId: string;
  students: Student[];
  effectiveScore1cMap: Record<string, { scoreStr: string; num: number | null }>;
  effectiveScore2cMap: Record<string, { scoreStr: string; num: number | null }>;
  effectiveOverrides: Record<string, string>;
  categories1c: GradeCategory[];
  categories2c: GradeCategory[];
  gradesData1c: StudentGradesMap;
  gradesData2c: StudentGradesMap;
  disp1cMap: Record<string, any>;
  disp2cMap: Record<string, any>;
  courseAttendanceSettings: AttendanceSettings;
  reportObservations: Record<string, string>;
  profileObservationsMap: Record<string, StudentObservation[]>;
}): ConsolidatedReportStudent[] {
  const {
    courseId,
    students,
    effectiveScore1cMap,
    effectiveScore2cMap,
    effectiveOverrides,
    categories1c,
    categories2c,
    gradesData1c,
    gradesData2c,
    disp1cMap,
    disp2cMap,
    courseAttendanceSettings,
    reportObservations,
    profileObservationsMap,
  } = params;

  return students.map((st) => {
    const s1 = effectiveScore1cMap[st.id] || { scoreStr: '', num: null };
    const s2 = effectiveScore2cMap[st.id] || { scoreStr: '', num: null };
    const override = effectiveOverrides[st.id];

    const examDetails1c = extractStudentExamDetails(st.id, categories1c, gradesData1c);
    const examDetails2c = extractStudentExamDetails(st.id, categories2c, gradesData2c);

    let calcAvgStr = '';
    let calcAvgNum: number | null = null;

    if (s1.num !== null && s2.num !== null) {
      calcAvgNum = (s1.num + s2.num) / 2;
      calcAvgStr = calcAvgNum.toFixed(1).replace('.0', '');
    } else if (s1.num !== null) {
      calcAvgNum = s1.num;
      calcAvgStr = s1.scoreStr;
    } else if (s2.num !== null) {
      calcAvgNum = s2.num;
      calcAvgStr = s2.scoreStr;
    }

    const finalVal = override !== undefined && override !== '' ? override : calcAvgStr;
    const finalNum = parseScoreNumber(finalVal);

    let condition = 'Pendiente';
    if (finalNum !== null) {
      if (finalNum >= 7) condition = 'Aprobado';
      else if (finalNum >= 6) condition = 'Aprobado (Regular)';
      else condition = 'Compensación Diciembre / Feb';
    }

    const abs1 = disp1cMap[st.id]?.totalAbsences ?? 0;
    const abs2 = disp2cMap[st.id]?.totalAbsences ?? 0;
    const totalAbs = abs1 + abs2;

    const lat1 = disp1cMap[st.id]?.totalLates ?? 0;
    const lat2 = disp2cMap[st.id]?.totalLates ?? 0;
    const totalLat = lat1 + lat2;

    const disp1 = disp1cMap[st.id]?.totalDisposition ?? 10;
    const disp2 = disp2cMap[st.id]?.totalDisposition ?? 10;
    const avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));

    const trafficLight = computeStudentAttendanceTrafficLight(
      st.id,
      totalAbs,
      totalLat,
      'annual',
      courseAttendanceSettings
    );
    const estimatedAttendance = trafficLight.percentage;

    const customReportObs = reportObservations[st.id];
    const profileObsList = (profileObservationsMap[st.id] || []).filter(
      (o) => !o?.courseId || o.courseId === courseId
    );
    const fallbackProfileObsText =
      profileObsList.length > 0
        ? profileObsList
            .map((o) => `• [${o.date}] ${o.text || ''}${o.reportUrl ? ` (${o.reportUrl})` : ''}`)
            .join('\n')
        : '';
    const observation = customReportObs !== undefined ? customReportObs : fallbackProfileObsText;

    return {
      student: st,
      score1c: s1.scoreStr,
      score1cNum: s1.num,
      score2c: s2.scoreStr,
      score2cNum: s2.num,
      examDetails1c,
      examDetails2c,
      calcAvgStr,
      calcAvgNum,
      finalVal,
      finalNum,
      condition,
      abs1,
      abs2,
      totalAbs,
      lat1,
      lat2,
      totalLat,
      disp1,
      disp2,
      avgDisp,
      estimatedAttendance,
      observation,
    };
  });
}

export function computeCourseReportStats(
  consolidatedStudents: ConsolidatedReportStudent[]
): CourseReportStats {
  const total = consolidatedStudents.length;
  const withFinal = consolidatedStudents.filter((s) => s.finalNum !== null);
  const approved = consolidatedStudents.filter((s) => s.finalNum !== null && s.finalNum >= 6);
  const inComp = consolidatedStudents.filter((s) => s.finalNum !== null && s.finalNum < 6);

  const avgScore =
    withFinal.length > 0
      ? (withFinal.reduce((acc, s) => acc + (s.finalNum || 0), 0) / withFinal.length).toFixed(1)
      : '—';

  const avgAttendance =
    total > 0
      ? Math.round(
          consolidatedStudents.reduce((acc, s) => acc + s.estimatedAttendance, 0) / total
        )
      : 100;

  const totalCourseAbsences = consolidatedStudents.reduce((acc, s) => acc + s.totalAbs, 0);

  return {
    total,
    approvedCount: approved.length,
    approvedPercent: total > 0 ? Math.round((approved.length / total) * 100) : 0,
    compCount: inComp.length,
    avgScore,
    avgAttendance,
    totalCourseAbsences,
  };
}
