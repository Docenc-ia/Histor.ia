import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Award,
  BookOpen,
  Layers,
  Filter,
} from 'lucide-react';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import {
  calculateCategoryAverageForStudent,
  getEffectiveIntensificationCell,
  getIntensificationDisplayLabel,
  getScoreColorClass,
} from '../../utils/gradeCalculations';
import { parseScoreNumber, getConditionForScore } from '../../utils/courseReportAggregator';

export type BreakdownPeriod = '1c' | '2c' | 'both';

export interface StudentGradeBreakdownModalProps {
  student: Student | null;
  students: Student[];
  onSelectStudent: (student: Student | null) => void;
  courseName: string;
  isDarkMode: boolean;
  initialPeriod: BreakdownPeriod;
  categories1c: GradeCategory[];
  categories2c: GradeCategory[];
  gradesMap1c: StudentGradesMap;
  gradesMap2c: StudentGradesMap;
  score1cMap: Record<string, { scoreStr: string; num: number | null }>;
  score2cMap: Record<string, { scoreStr: string; num: number | null }>;
  annualOverrides: Record<string, string>;
}

interface BreakdownRow {
  id: string;
  term: '1c' | '2c';
  categoryName: string;
  itemName: string;
  score: string;
  hasScore: boolean;
  isIntensification?: boolean;
  isNI?: boolean;
}

function buildRowsForTerm(
  studentId: string,
  term: '1c' | '2c',
  categories: GradeCategory[],
  gradesMap: StudentGradesMap
): BreakdownRow[] {
  const studentGrades = gradesMap[studentId] || {};
  const rows: BreakdownRow[] = [];

  categories.forEach((cat) => {
    if (cat.subcategories.length === 0) {
      const raw = studentGrades[cat.id];
      const score = raw !== undefined && String(raw).trim() !== '' ? String(raw).trim() : '';
      rows.push({
        id: `${term}-${cat.id}`,
        term,
        categoryName: cat.name,
        itemName: 'Nota General',
        score: score || '—',
        hasScore: score !== '',
      });
    } else {
      cat.subcategories.forEach((sub) => {
        const raw = studentGrades[sub.id];
        const score = raw !== undefined && String(raw).trim() !== '' ? String(raw).trim() : '';
        rows.push({
          id: `${term}-${cat.id}-${sub.id}`,
          term,
          categoryName: cat.name,
          itemName: sub.name,
          score: score || '—',
          hasScore: score !== '',
        });

        const instList = sub.intensifications || [];
        instList.forEach((inst, instIdx) => {
          const effective = getEffectiveIntensificationCell(sub, instIdx, studentGrades);
          const cleanVal = String(effective.value || '').trim();
          rows.push({
            id: `${term}-${cat.id}-${sub.id}-${inst.id}`,
            term,
            categoryName: cat.name,
            itemName: getIntensificationDisplayLabel(sub, inst),
            score: effective.isNI ? 'NI' : cleanVal || '—',
            hasScore: !effective.isNI && cleanVal !== '',
            isIntensification: true,
            isNI: effective.isNI,
          });
        });
      });
    }
  });

  return rows;
}

export const StudentGradeBreakdownModal: React.FC<StudentGradeBreakdownModalProps> = ({
  student,
  students,
  onSelectStudent,
  courseName,
  isDarkMode,
  initialPeriod,
  categories1c,
  categories2c,
  gradesMap1c,
  gradesMap2c,
  score1cMap,
  score2cMap,
  annualOverrides,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<BreakdownPeriod>(initialPeriod);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (student) {
      setSelectedPeriod(initialPeriod);
      setCopied(false);
    }
  }, [student?.id, initialPeriod]);

  // Keyboard navigation (Escape to close, Left/Right arrows with Alt or directly when not focused on button)
  useEffect(() => {
    if (!student) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectStudent(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [student, onSelectStudent]);

  const currentIdx = useMemo(
    () => (student ? students.findIndex((s) => s.id === student.id) : -1),
    [student, students]
  );

  const rows1c = useMemo(
    () => (student ? buildRowsForTerm(student.id, '1c', categories1c, gradesMap1c) : []),
    [student, categories1c, gradesMap1c]
  );

  const rows2c = useMemo(
    () => (student ? buildRowsForTerm(student.id, '2c', categories2c, gradesMap2c) : []),
    [student, categories2c, gradesMap2c]
  );

  if (!student) return null;

  const visibleRows1c = hideEmpty ? rows1c.filter((r) => r.hasScore) : rows1c;
  const visibleRows2c = hideEmpty ? rows2c.filter((r) => r.hasScore) : rows2c;

  const s1 = score1cMap[student.id] || { scoreStr: '', num: null };
  const s2 = score2cMap[student.id] || { scoreStr: '', num: null };

  const auto1c = calculateCategoryAverageForStudent(categories1c, gradesMap1c, student.id);
  const auto2c = calculateCategoryAverageForStudent(categories2c, gradesMap2c, student.id);

  const effective1cStr = s1.scoreStr || auto1c.scoreStr;
  const effective1cNum = s1.num !== null ? s1.num : auto1c.num;
  const effective2cStr = s2.scoreStr || auto2c.scoreStr;
  const effective2cNum = s2.num !== null ? s2.num : auto2c.num;

  let annualCalcAvgNum: number | null = null;
  let annualCalcAvgStr = '';
  if (effective1cNum !== null && effective2cNum !== null) {
    annualCalcAvgNum = (effective1cNum + effective2cNum) / 2;
    annualCalcAvgStr = annualCalcAvgNum.toFixed(1).replace('.0', '');
  } else if (effective1cNum !== null) {
    annualCalcAvgNum = effective1cNum;
    annualCalcAvgStr = effective1cStr;
  } else if (effective2cNum !== null) {
    annualCalcAvgNum = effective2cNum;
    annualCalcAvgStr = effective2cStr;
  }

  const override = annualOverrides[student.id];
  const annualFinalStr = override !== undefined && override !== '' ? override : annualCalcAvgStr;
  const annualFinalNum = parseScoreNumber(annualFinalStr);

  const activeNumForCondition =
    selectedPeriod === '1c'
      ? effective1cNum
      : selectedPeriod === '2c'
      ? effective2cNum
      : annualFinalNum;
  const activeCondition = getConditionForScore(activeNumForCondition);

  const conditionBadgeClass = activeCondition.includes('Aprobado')
    ? isDarkMode
      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : activeCondition === 'Pendiente'
    ? isDarkMode
      ? 'bg-slate-800 text-slate-300 border-slate-700'
      : 'bg-neutral-100 text-neutral-600 border-neutral-200'
    : isDarkMode
    ? 'bg-rose-950/60 text-rose-300 border-rose-800'
    : 'bg-rose-50 text-rose-800 border-rose-200';

  const gradedCount1c = rows1c.filter((r) => r.hasScore).length;
  const totalEvaluable1c = rows1c.filter((r) => !r.isNI).length;
  const gradedCount2c = rows2c.filter((r) => r.hasScore).length;
  const totalEvaluable2c = rows2c.filter((r) => !r.isNI).length;

  const handleNavigate = (dir: -1 | 1) => {
    const nextIdx = currentIdx + dir;
    if (nextIdx >= 0 && nextIdx < students.length) {
      onSelectStudent(students[nextIdx]);
    }
  };

  const handleCopyTable = async () => {
    const periodLabel =
      selectedPeriod === '1c'
        ? '1° Cuatrimestre'
        : selectedPeriod === '2c'
        ? '2° Cuatrimestre'
        : '1° y 2° Cuatrimestre (Anual)';

    const lines: string[] = [
      `${student.lastName}, ${student.firstName} — ${courseName} (${periodLabel})`,
      '',
    ];

    if (selectedPeriod === 'both') {
      lines.push('Cuatrimestre\tCategoría\tEvaluación / Trabajo\tNota');
      visibleRows1c.forEach((r) =>
        lines.push(`1° C\t${r.categoryName}\t${r.itemName}\t${r.score}`)
      );
      visibleRows2c.forEach((r) =>
        lines.push(`2° C\t${r.categoryName}\t${r.itemName}\t${r.score}`)
      );
      lines.push('');
      lines.push(`Nota 1° C: ${effective1cStr || '—'}`);
      lines.push(`Nota 2° C: ${effective2cStr || '—'}`);
      lines.push(`Nota Definitiva Anual: ${annualFinalStr || '—'} (${activeCondition})`);
    } else {
      const targetRows = selectedPeriod === '1c' ? visibleRows1c : visibleRows2c;
      const finalScore = selectedPeriod === '1c' ? effective1cStr : effective2cStr;
      lines.push('Categoría\tEvaluación / Trabajo\tNota');
      targetRows.forEach((r) =>
        lines.push(`${r.categoryName}\t${r.itemName}\t${r.score}`)
      );
      lines.push('');
      lines.push(`Nota Final ${periodLabel}: ${finalScore || '—'} (${activeCondition})`);
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard restrictions
      const ta = document.createElement('textarea');
      ta.value = lines.join('\n');
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayedRows =
    selectedPeriod === '1c'
      ? visibleRows1c
      : selectedPeriod === '2c'
      ? visibleRows2c
      : [...visibleRows1c, ...visibleRows2c];

  const renderBreakdownRow = (row: BreakdownRow, showTermBadge: boolean) => (
    <tr
      key={row.id}
      className={isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-neutral-50/80'}
    >
      {showTermBadge && (
        <td className="py-2 px-3 text-center border-r border-neutral-200 dark:border-slate-800">
          <span
            className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${
              row.term === '1c'
                ? isDarkMode
                  ? 'bg-blue-950/60 text-blue-300 border-blue-800/70'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
                : isDarkMode
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {row.term === '1c' ? '1° C' : '2° C'}
          </span>
        </td>
      )}
      <td
        className={`py-2 px-3 border-r border-neutral-200 dark:border-slate-800 ${
          isDarkMode ? 'text-slate-300' : 'text-neutral-600'
        }`}
      >
        {row.categoryName}
      </td>
      <td className="py-2 px-3 border-r border-neutral-200 dark:border-slate-800 font-medium">
        {row.isIntensification ? (
          <span className="inline-flex items-center gap-1.5 pl-2">
            <span
              className={`text-[10px] font-bold ${
                isDarkMode ? 'text-amber-400' : 'text-amber-700'
              }`}
            >
              ↳
            </span>
            <span>{row.itemName}</span>
          </span>
        ) : (
          row.itemName
        )}
      </td>
      <td
        className={`py-2 px-3 text-center font-bold tabular-nums ${
          row.isNI
            ? ''
            : row.hasScore
            ? getScoreColorClass(row.score, isDarkMode)
            : isDarkMode
            ? 'text-slate-500 font-normal'
            : 'text-neutral-400 font-normal'
        }`}
      >
        {row.isNI ? (
          <span
            title="No intensifica (aprobó con ≥ 7 por defecto; fuera del promedio)"
            className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold border ${
              isDarkMode
                ? 'bg-slate-800 text-slate-300 border-slate-700'
                : 'bg-neutral-100 text-neutral-600 border-neutral-300'
            }`}
          >
            NI
          </span>
        ) : (
          row.score
        )}
      </td>
    </tr>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => onSelectStudent(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50/90 border-neutral-200'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-bold tracking-tight truncate">
                {student.lastName}, {student.firstName}
              </h3>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                  isDarkMode
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/70'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                <Award className="w-3 h-3" />
                <span>Desglose de Calificaciones</span>
              </span>
            </div>
            <p className={`text-xs mt-0.5 flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{courseName}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => onSelectStudent(null)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              isDarkMode
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/70'
            }`}
            aria-label="Cerrar desglose"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Term Selector & Filter Controls */}
        <div
          className={`px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Mostrar notas de:
            </span>
            <div
              className={`inline-flex items-center p-1 rounded-lg border ${
                isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
              }`}
              role="tablist"
              aria-label="Período de notas del estudiante"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedPeriod === '1c'}
                onClick={() => setSelectedPeriod('1c')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  selectedPeriod === '1c'
                    ? isDarkMode
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-blue-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-300 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                1° Cuatrimestre
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedPeriod === '2c'}
                onClick={() => setSelectedPeriod('2c')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  selectedPeriod === '2c'
                    ? isDarkMode
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-700 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-300 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                2° Cuatrimestre
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedPeriod === 'both'}
                onClick={() => setSelectedPeriod('both')}
                className={`px-3 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap ${
                  selectedPeriod === 'both'
                    ? 'bg-violet-600 text-white shadow-xs'
                    : isDarkMode
                    ? 'text-slate-300 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Layers className="w-3 h-3 shrink-0" />
                <span>Ambos</span>
              </button>
            </div>
          </div>

          <label
            className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none ${
              isDarkMode ? 'text-slate-300' : 'text-neutral-600'
            }`}
          >
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <Filter className="w-3 h-3 opacity-70" />
            <span>Solo cargadas</span>
          </label>
        </div>

        {/* Summary KPI Strip */}
        <div
          className={`px-5 py-3 border-b grid gap-2.5 shrink-0 ${
            selectedPeriod === 'both' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
          } ${isDarkMode ? 'bg-slate-950/40 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'}`}
        >
          {selectedPeriod === 'both' ? (
            <>
              <div
                className={`p-2.5 rounded-lg border text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block">
                  1° Cuatrimestre
                </span>
                <span className={`text-base font-bold tabular-nums ${getScoreColorClass(effective1cStr, isDarkMode)}`}>
                  {effective1cStr || '—'}
                </span>
              </div>
              <div
                className={`p-2.5 rounded-lg border text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block">
                  2° Cuatrimestre
                </span>
                <span className={`text-base font-bold tabular-nums ${getScoreColorClass(effective2cStr, isDarkMode)}`}>
                  {effective2cStr || '—'}
                </span>
              </div>
              <div
                className={`p-2.5 rounded-lg border text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block">
                  Nota Definitiva
                </span>
                <span className={`text-base font-extrabold tabular-nums ${getScoreColorClass(annualFinalStr, isDarkMode)}`}>
                  {annualFinalStr || '—'}
                </span>
              </div>
              <div
                className={`p-2.5 rounded-lg border flex flex-col items-center justify-center text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block mb-0.5">
                  Condición
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${conditionBadgeClass}`}>
                  {activeCondition}
                </span>
              </div>
            </>
          ) : (
            <>
              <div
                className={`p-2.5 rounded-lg border text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block">
                  Nota {selectedPeriod === '1c' ? '1° C' : '2° C'}
                </span>
                <span
                  className={`text-base font-extrabold tabular-nums ${getScoreColorClass(
                    selectedPeriod === '1c' ? effective1cStr : effective2cStr,
                    isDarkMode
                  )}`}
                >
                  {(selectedPeriod === '1c' ? effective1cStr : effective2cStr) || '—'}
                </span>
              </div>
              <div
                className={`p-2.5 rounded-lg border text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block">
                  Notas Cargadas
                </span>
                <span className="text-base font-bold tabular-nums">
                  {selectedPeriod === '1c'
                    ? `${gradedCount1c} / ${totalEvaluable1c}`
                    : `${gradedCount2c} / ${totalEvaluable2c}`}
                </span>
              </div>
              <div
                className={`p-2.5 rounded-lg border flex flex-col items-center justify-center text-center ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
                }`}
              >
                <span className="text-[10px] uppercase font-semibold text-neutral-500 dark:text-slate-400 block mb-0.5">
                  Condición
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${conditionBadgeClass}`}>
                  {activeCondition}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Scrollable Breakdown Table */}
        <div className="flex-1 overflow-y-auto p-5">
          {displayedRows.length === 0 ? (
            <div
              className={`py-10 px-4 text-center rounded-xl border border-dashed text-xs ${
                isDarkMode
                  ? 'border-slate-800 text-slate-400 bg-slate-950/30'
                  : 'border-neutral-300 text-neutral-500 bg-neutral-50/70'
              }`}
            >
              {hideEmpty
                ? 'No hay notas cargadas en el período seleccionado.'
                : 'No hay evaluaciones ni categorías configuradas para este período.'}
            </div>
          ) : (
            <div
              className={`rounded-xl border overflow-hidden ${
                isDarkMode ? 'border-slate-800' : 'border-neutral-200'
              }`}
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead
                  className={`border-b font-semibold uppercase tracking-wider text-[11px] ${
                    isDarkMode
                      ? 'bg-slate-950/80 border-slate-800 text-slate-300'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  <tr>
                    {selectedPeriod === 'both' && (
                      <th className="py-2.5 px-3 border-r border-neutral-200 dark:border-slate-800 w-24 text-center">
                        Período
                      </th>
                    )}
                    <th className="py-2.5 px-3 border-r border-neutral-200 dark:border-slate-800">
                      Categoría
                    </th>
                    <th className="py-2.5 px-3 border-r border-neutral-200 dark:border-slate-800">
                      Evaluación / Trabajo
                    </th>
                    <th className="py-2.5 px-3 text-center w-28">Calificación</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800' : 'divide-neutral-200'}`}>
                  {selectedPeriod === 'both' ? (
                    <>
                      {visibleRows1c.map((row) => renderBreakdownRow(row, true))}
                      {visibleRows1c.length > 0 && (
                        <tr className={isDarkMode ? 'bg-blue-950/25 font-bold' : 'bg-blue-50/60 font-bold'}>
                          <td
                            colSpan={3}
                            className="py-2 px-3 text-right border-r border-neutral-200 dark:border-slate-800 text-blue-800 dark:text-blue-300"
                          >
                            Calificación Final 1° Cuatrimestre
                          </td>
                          <td className={`py-2 px-3 text-center tabular-nums text-sm ${getScoreColorClass(effective1cStr, isDarkMode)}`}>
                            {effective1cStr || '—'}
                          </td>
                        </tr>
                      )}

                      {visibleRows2c.map((row) => renderBreakdownRow(row, true))}
                      {visibleRows2c.length > 0 && (
                        <tr className={isDarkMode ? 'bg-emerald-950/25 font-bold' : 'bg-emerald-50/60 font-bold'}>
                          <td
                            colSpan={3}
                            className="py-2 px-3 text-right border-r border-neutral-200 dark:border-slate-800 text-emerald-800 dark:text-emerald-300"
                          >
                            Calificación Final 2° Cuatrimestre
                          </td>
                          <td className={`py-2 px-3 text-center tabular-nums text-sm ${getScoreColorClass(effective2cStr, isDarkMode)}`}>
                            {effective2cStr || '—'}
                          </td>
                        </tr>
                      )}
                    </>
                  ) : (
                    displayedRows.map((row) => renderBreakdownRow(row, false))
                  )}
                </tbody>
                <tfoot>
                  <tr
                    className={`border-t-2 font-extrabold ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-700 text-white'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-900'
                    }`}
                  >
                    <td
                      colSpan={selectedPeriod === 'both' ? 3 : 2}
                      className="py-2.5 px-3 text-right border-r border-neutral-200 dark:border-slate-800"
                    >
                      {selectedPeriod === '1c'
                        ? 'Calificación Final 1° Cuatrimestre'
                        : selectedPeriod === '2c'
                        ? 'Calificación Final 2° Cuatrimestre'
                        : 'Calificación Definitiva Anual'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-center text-sm tabular-nums ${getScoreColorClass(
                        selectedPeriod === '1c'
                          ? effective1cStr
                          : selectedPeriod === '2c'
                          ? effective2cStr
                          : annualFinalStr,
                        isDarkMode
                      )}`}
                    >
                      {(selectedPeriod === '1c'
                        ? effective1cStr
                        : selectedPeriod === '2c'
                        ? effective2cStr
                        : annualFinalStr) || '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Footer with Previous/Next student navigation & Copy */}
        <div
          className={`px-5 py-3.5 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => handleNavigate(-1)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Ver estudiante anterior"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <span className={`text-xs font-semibold px-2 tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              {currentIdx >= 0 ? `${currentIdx + 1} de ${students.length}` : ''}
            </span>
            <button
              type="button"
              disabled={currentIdx < 0 || currentIdx >= students.length - 1}
              onClick={() => handleNavigate(1)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Ver estudiante siguiente"
            >
              <span>Siguiente</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyTable}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300'
              }`}
              title="Copiar desglose en formato tabla para pegar en Excel, Docs o mensajes"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar tabla'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectStudent(null)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-700 hover:bg-slate-600 text-white'
                  : 'bg-neutral-800 hover:bg-neutral-900 text-white'
              }`}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
