/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student } from '../types';
import { GradeCategory, StudentGradesMap } from '../types/grades';

export const CATEGORY_COLORS = [
  { name: 'Azul', border: 'border-blue-500', headerBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', badge: 'bg-blue-500' },
  { name: 'Esmeralda', border: 'border-emerald-500', headerBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40', badge: 'bg-emerald-500' },
  { name: 'Púrpura', border: 'border-purple-500', headerBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40', badge: 'bg-purple-500' },
  { name: 'Ámbar', border: 'border-amber-500', headerBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40', badge: 'bg-amber-500' },
  { name: 'Índigo', border: 'border-indigo-500', headerBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40', badge: 'bg-indigo-500' },
  { name: 'Rosa', border: 'border-rose-500', headerBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:bg-rose-950/40', badge: 'bg-rose-500' },
];

export function calculateCategoryAverageForStudent(
  termCats: GradeCategory[],
  termGrades: StudentGradesMap,
  studentId: string
): { scoreStr: string; num: number | null } {
  const stGrades = termGrades[studentId] || {};
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

  // En modo 'average_of_categories' (Promedio), si el docente modificó manualmente la nota final de este alumno, se respeta esa modificación
  const avgOverride =
    stGrades['__final_avg_override__'] !== undefined
      ? String(stGrades['__final_avg_override__']).trim()
      : '';
  if (avgOverride !== '') {
    const num = !isNaN(Number(avgOverride)) ? Number(avgOverride) : null;
    return { scoreStr: avgOverride, num };
  }

  return calculateCategoryAverageForStudent(termCats, termGrades, studentId);
}

export function findDispositionColumnKey(
  categories: GradeCategory[],
  customDispositionLabel?: string
): string | null {
  const dispLabelNorm = (customDispositionLabel || 'Disposición').trim().toLowerCase();
  const isDispositionName = (name: string) => {
    const n = (name || '').trim().toLowerCase();
    return (
      n === dispLabelNorm ||
      n.includes('disposición') ||
      n.includes('disposicion') ||
      n.includes('conducta') ||
      n.includes('concepto') ||
      (dispLabelNorm.length >= 3 && n.includes(dispLabelNorm))
    );
  };

  // 1ra prioridad: cualquier subcolumna cuyo nombre coincida con Disposición
  for (const cat of categories) {
    const foundSub = cat.subcategories.find((s) => isDispositionName(s.name));
    if (foundSub) {
      return foundSub.id;
    }
  }

  // 2da prioridad: cualquier Categoría Mayor cuyo nombre coincida con Disposición
  const dispCat = categories.find((c) => isDispositionName(c.name));
  if (dispCat) {
    if (dispCat.subcategories.length === 0) {
      return dispCat.id;
    }
    if (dispCat.subcategories.length === 1) {
      return dispCat.subcategories[0].id;
    }
  }

  return null;
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
