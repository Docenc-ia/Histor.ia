/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';
import type { PreliminaryValuationRecord } from '../components/modules/PreliminaryValuationModal';

export const CATEGORY_COLORS = [
  { name: 'Azul', border: 'border-blue-500', headerBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', badge: 'bg-blue-500' },
  { name: 'Esmeralda', border: 'border-emerald-500', headerBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40', badge: 'bg-emerald-500' },
  { name: 'Púrpura', border: 'border-purple-500', headerBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40', badge: 'bg-purple-500' },
  { name: 'Ámbar', border: 'border-amber-500', headerBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40', badge: 'bg-amber-500' },
  { name: 'Índigo', border: 'border-indigo-500', headerBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40', badge: 'bg-indigo-500' },
  { name: 'Rosa', border: 'border-rose-500', headerBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:bg-rose-950/40', badge: 'bg-rose-500' },
];

export function calculateFinalScoreForStudent(
  termCats: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalc: 'average_of_categories' | 'manual_final',
  studentId: string
): { scoreStr: string; num: number | null } {
  const stGrades = termGrades[studentId] || {};
  if (termCalc === 'manual_final') {
    const val = stGrades['__final__'] || '';
    const num = val !== '' && !isNaN(Number(val)) ? Number(val) : null;
    return { scoreStr: val, num };
  }

  const numericScores: number[] = [];
  termCats.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      const val = stGrades[cat.id];
      if (val !== undefined && val !== '' && !isNaN(Number(val))) {
        numericScores.push(Number(val));
      }
    } else {
      cat.subcategories.forEach((sub) => {
        const val = stGrades[sub.id];
        if (val !== undefined && val !== '' && !isNaN(Number(val))) {
          numericScores.push(Number(val));
        }
      });
    }
  });

  if (numericScores.length === 0) return { scoreStr: '', num: null };
  const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
  return {
    scoreStr: avg.toFixed(1).replace('.0', ''),
    num: avg,
  };
}

export function computeTermScoresMap(
  students: Student[],
  termCats: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalc: 'average_of_categories' | 'manual_final'
): Record<string, { scoreStr: string; num: number | null }> {
  const map: Record<string, { scoreStr: string; num: number | null }> = {};
  students.forEach((st) => {
    map[st.id] = calculateFinalScoreForStudent(termCats, termGrades, termCalc, st.id);
  });
  return map;
}

export function getScoreColorClass(valStr: string, isDarkMode: boolean): string {
  if (!valStr || isNaN(Number(valStr))) return isDarkMode ? 'text-slate-200' : 'text-neutral-800';
  const num = Number(valStr);
  if (num >= 7) return 'text-emerald-600 dark:text-emerald-400 font-bold';
  if (num >= 6) return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-red-600 dark:text-red-400 font-bold';
}

export function buildGradesCsvContent(
  students: Student[],
  categories: GradeCategory[],
  gradesMap: StudentGradesMap,
  overallCalc: 'average_of_categories' | 'manual_final',
  preliminaryValuation?: PreliminaryValuationRecord | null
): string {
  let csvContent = 'data:text/csv;charset=utf-8,';

  const headerParts = ['Apellido y Nombre'];
  categories.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      headerParts.push(`"${cat.name}"`);
    } else {
      cat.subcategories.forEach((sub) => {
        headerParts.push(`"${cat.name} - ${sub.name}"`);
      });
    }
  });
  if (preliminaryValuation && preliminaryValuation.showInMatrix) {
    headerParts.push('"Valoración Preliminar (TEA/TEP)"');
  }
  headerParts.push('"Calificación Final"');
  csvContent += headerParts.join(',') + '\r\n';

  students.forEach((st) => {
    const row = [`"${st.lastName}, ${st.firstName}"`];
    const stGrades = gradesMap[st.id] || {};
    categories.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        const val = stGrades[cat.id] || '';
        row.push(`"${val}"`);
      } else {
        cat.subcategories.forEach((sub) => {
          const val = stGrades[sub.id] || '';
          row.push(`"${val}"`);
        });
      }
    });
    if (preliminaryValuation && preliminaryValuation.showInMatrix) {
      const traj = preliminaryValuation.valuations[st.id]?.trajectory || '';
      row.push(`"${traj}"`);
    }
    const finalScore = calculateFinalScoreForStudent(categories, gradesMap, overallCalc, st.id).scoreStr;
    row.push(`"${finalScore}"`);
    csvContent += row.join(',') + '\r\n';
  });

  return csvContent;
}
