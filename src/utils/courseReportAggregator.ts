/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Aggregation Engine for Course & Individual Trajectory Reports.
 * Extracted from CourseReportModal.tsx to keep UI components focused on presentation
 * and make grade/attendance/disposition calculations independently testable.
 */

import { Student, StudentDispositionData, StudentObservation } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import {
  AttendanceSettings,
  computeStudentAttendanceTrafficLight,
} from './attendanceCalculations';
import type { ExamGradeDetailItem } from '../components/modules/CourseReportModal';
import { getTerminologySettings } from './terminologySettings';
import {
  INTENSIFICATION_EXEMPT_LABEL,
  findDispositionColumnKey,
  getEffectiveIntensificationCell,
  getIntensificationDisplayLabel,
} from './gradeCalculations';
import {
  buildStudentHistoryIndex,
  calculateStudentMetrics,
} from './studentMetricsCalculator';

export interface DispositionReasonDetailItem {
  id: string;
  date: string;
  time?: string;
  term: '1c' | '2c';
  reason: string;
  pointsChange: number;
}

export interface ConsolidatedReportStudent {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  examDetails1c: ExamGradeDetailItem[];
  examDetails2c: ExamGradeDetailItem[];
  dispositionReasons: DispositionReasonDetailItem[];
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

export type ReportGradesPeriod = 'both' | '1c' | '2c';

export interface CourseReportStats {
  total: number;
  approvedCount: number;
  approvedPercent: number;
  compCount: number;
  avgScore: string;
  avgAttendance: number;
  totalCourseAbsences: number;
}

export function getConditionForScore(num: number | null): string {
  if (num === null) return 'Pendiente';
  if (num >= 7) return 'Aprobado';
  if (num >= 6) return 'Aprobado (Regular)';
  return 'Compensación Diciembre / Feb';
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

  if (
    calcMode === 'average_of_categories' &&
    stGrades['__final_avg_override__'] !== undefined &&
    String(stGrades['__final_avg_override__']).trim() !== ''
  ) {
    const val = String(stGrades['__final_avg_override__']).trim();
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
        // Las notas de intensificación/recuperación quedan fuera de los promedios automáticos.
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
  const { dispositionLabel } = getTerminologySettings();
  const dispColKey = findDispositionColumnKey(cats, dispositionLabel);
  const isDispName = (name: string) => {
    const norm = (name || '').trim().toLowerCase();
    const target = (dispositionLabel || 'disposición').trim().toLowerCase();
    return (
      norm === target ||
      norm.includes('disposición') ||
      norm.includes('disposicion')
    );
  };

  const items: ExamGradeDetailItem[] = [];
  cats.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      if (cat.id === dispColKey || isDispName(cat.name)) return;
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
        if (sub.id === dispColKey || isDispName(sub.name)) return;
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

        const instList = sub.intensifications || [];
        instList.forEach((inst, instIdx) => {
          const effective = getEffectiveIntensificationCell(sub, instIdx, stGrades);
          const trimmedVal = String(effective.value || '').trim();
          items.push({
            id: inst.id,
            categoryName: cat.name,
            itemName: getIntensificationDisplayLabel(sub, inst),
            score: effective.isExempt
              ? INTENSIFICATION_EXEMPT_LABEL
              : trimmedVal !== ''
              ? trimmedVal
              : '—',
          });
        });
      });
    }
  });
  return items;
}

/**
 * Filtra de forma pura un diccionario crudo de disposición áulica para asegurar que únicamente
 * se conserven entradas pertenecientes al `courseId` indicado (o sin etiqueta de curso heredada).
 *
 * @param parsedDispositionData Objeto parseado desde almacenamiento o nube.
 * @param courseId Identificador del curso activo.
 * @returns Mapa de disposición filtrado por curso.
 */
export function filterCourseDispositionMap(
  parsedDispositionData: unknown,
  courseId: string
): Record<string, any> {
  if (!parsedDispositionData || typeof parsedDispositionData !== 'object') {
    return {};
  }
  const filtered: Record<string, any> = {};
  for (const [studentKey, entryValue] of Object.entries(
    parsedDispositionData as Record<string, any>
  )) {
    if (!entryValue?.courseId || entryValue.courseId === courseId) {
      filtered[studentKey] = entryValue;
    }
  }
  return filtered;
}

/**
 * Resuelve de forma pura el mapa efectivo de calificaciones finales de un cuatrimestre:
 * utiliza el mapa precalculado si contiene datos, o lo calcula al vuelo para cada estudiante.
 *
 * @param providedScoreMap Mapa de notas recibido por props desde la matriz (puede estar vacío si se abre desde el tablero).
 * @param students Lista de estudiantes del curso.
 * @param categories Categorías de evaluación del cuatrimestre.
 * @param gradesMap Mapa crudo de notas del cuatrimestre.
 * @param calcMode Modo de cálculo final configurado para el cuatrimestre.
 * @returns Mapa efectivo de calificaciones finales indexado por `studentId`.
 */
export function resolveEffectiveTermScoresMap(
  providedScoreMap: Record<string, { scoreStr: string; num: number | null }> | undefined,
  students: Student[],
  categories: GradeCategory[],
  gradesMap: StudentGradesMap,
  calcMode: 'average_of_categories' | 'manual_final'
): Record<string, { scoreStr: string; num: number | null }> {
  if (providedScoreMap && Object.keys(providedScoreMap).length > 0) {
    return providedScoreMap;
  }
  const computedMap: Record<string, { scoreStr: string; num: number | null }> = {};
  students.forEach((student) => {
    const calculatedScore = computeTermScoreForStudent(
      student.id,
      categories,
      gradesMap,
      calcMode
    );
    if (calculatedScore.scoreStr !== '') {
      computedMap[student.id] = calculatedScore;
    }
  });
  return computedMap;
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
  dispositionHistory?: any[];
  getStudentMetrics?: (
    studentId: string,
    targetTerm?: '1c' | '2c' | 'annual' | 'all'
  ) => StudentDispositionData;
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
    dispositionHistory = [],
    getStudentMetrics,
    courseAttendanceSettings,
    reportObservations,
    profileObservationsMap,
  } = params;

  const baseScore = getTerminologySettings().initialDispositionScore ?? 10;
  const historyIndex = buildStudentHistoryIndex(dispositionHistory, students, courseId);

  const has1cHistory = (dispositionHistory || []).some(
    (h) =>
      (!h?.courseId || h.courseId === courseId) &&
      (h?.term === '1c' || !h?.term) &&
      h?.category !== 'Sistema'
  );
  const has1cMapActivity = Object.values(disp1cMap || {}).some(
    (d: any) =>
      d &&
      ((d.totalAbsences ?? 0) > 0 ||
        (d.totalLates ?? 0) > 0 ||
        (d.totalDisposition !== undefined && d.totalDisposition !== baseScore))
  );
  const hasCourse1cActivity = has1cHistory || has1cMapActivity;

  const has2cHistory = (dispositionHistory || []).some(
    (h) =>
      (!h?.courseId || h.courseId === courseId) &&
      h?.term === '2c' &&
      h?.category !== 'Sistema'
  );
  const has2cMapActivity = Object.values(disp2cMap || {}).some(
    (d: any) =>
      d &&
      ((d.totalAbsences ?? 0) > 0 ||
        (d.totalLates ?? 0) > 0 ||
        (d.totalDisposition !== undefined && d.totalDisposition !== baseScore))
  );
  const hasCourse2cActivity = has2cHistory || has2cMapActivity;

  return students.map((st) => {
    const s1 = effectiveScore1cMap[st.id] || { scoreStr: '', num: null };
    const s2 = effectiveScore2cMap[st.id] || { scoreStr: '', num: null };
    const override = effectiveOverrides[st.id];

    const examDetails1c = extractStudentExamDetails(st.id, categories1c, gradesData1c);
    const examDetails2c = extractStudentExamDetails(st.id, categories2c, gradesData2c);

    const dispositionReasons: DispositionReasonDetailItem[] = (dispositionHistory || [])
      .filter((h) => {
        if (!h || h.studentId !== st.id) return false;
        if (h.courseId && h.courseId !== courseId) return false;
        const isDispCategory = h.category === 'Disposición';
        const isNegativePoints = h.pointsChange !== undefined ? h.pointsChange < 0 : isDispCategory;
        if (!isDispCategory || !isNegativePoints) return false;
        if (/^(puntaje de .* restablecido|.* borrada y restablecida)/i.test(String(h.action || ''))) {
          return false;
        }
        return true;
      })
      .map((h) => {
        const rawAction = String(h.action || h.detail || 'Motivo registrado').trim();
        const motivoMatch = rawAction.match(/-\s*Motivo:\s*(.+)$/i);
        const cleanReason = motivoMatch ? motivoMatch[1].trim() : rawAction;
        return {
          id: String(h.id),
          date: h.date || '—',
          time: h.time,
          term: (h.term === '2c' ? '2c' : '1c') as '1c' | '2c',
          reason: cleanReason,
          pointsChange: typeof h.pointsChange === 'number' ? h.pointsChange : -1,
        };
      });

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

    // Obtener métricas exclusivamente desde Asistencia y Disposición (nunca desde Calificaciones)
    const m1 = getStudentMetrics
      ? getStudentMetrics(st.id, '1c')
      : calculateStudentMetrics({
          studentId: st.id,
          targetTerm: '1c',
          activeCourseId: courseId,
          students,
          dispositionMap: disp1cMap,
          dispositionMap2c: disp2cMap,
          historyList: dispositionHistory,
          historyIndex,
        });

    const m2 = getStudentMetrics
      ? getStudentMetrics(st.id, '2c')
      : calculateStudentMetrics({
          studentId: st.id,
          targetTerm: '2c',
          activeCourseId: courseId,
          students,
          dispositionMap: disp1cMap,
          dispositionMap2c: disp2cMap,
          historyList: dispositionHistory,
          historyIndex,
        });

    const abs1 = m1.totalAbsences ?? 0;
    const abs2 = m2.totalAbsences ?? 0;
    const totalAbs = abs1 + abs2;

    const lat1 = m1.totalLates ?? 0;
    const lat2 = m2.totalLates ?? 0;
    const totalLat = lat1 + lat2;

    const disp1 = m1.totalDisposition ?? baseScore;
    const disp2 = m2.totalDisposition ?? baseScore;

    // Si el informe se emite durante el 1°C (sin registros aún en el 2°C), tomar directamente la nota del 1°C
    let avgDisp: number;
    if (hasCourse1cActivity && !hasCourse2cActivity) {
      avgDisp = Number(disp1.toFixed(1));
    } else if (!hasCourse1cActivity && hasCourse2cActivity) {
      avgDisp = Number(disp2.toFixed(1));
    } else {
      avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));
    }

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
      dispositionReasons,
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
  consolidatedStudents: ConsolidatedReportStudent[],
  gradesPeriod: ReportGradesPeriod = 'both'
): CourseReportStats {
  const total = consolidatedStudents.length;
  const getTargetNum = (s: ConsolidatedReportStudent): number | null => {
    if (gradesPeriod === '1c') return s.score1cNum;
    if (gradesPeriod === '2c') return s.score2cNum;
    return s.finalNum;
  };
  const withFinal = consolidatedStudents.filter((s) => getTargetNum(s) !== null);
  const approved = consolidatedStudents.filter((s) => {
    const num = getTargetNum(s);
    return num !== null && num >= 6;
  });
  const inComp = consolidatedStudents.filter((s) => {
    const num = getTargetNum(s);
    return num !== null && num < 6;
  });

  const avgScore =
    withFinal.length > 0
      ? (
          withFinal.reduce((acc, s) => acc + (getTargetNum(s) || 0), 0) / withFinal.length
        ).toFixed(1)
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
