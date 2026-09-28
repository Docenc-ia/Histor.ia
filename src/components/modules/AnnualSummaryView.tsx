import React, { useState, useMemo } from 'react';
import {
  Award,
  Download,
  Users,
  TrendingUp,
  Search,
  X,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import { Student } from '../../types';

export interface AnnualSummaryViewProps {
  courseId: string;
  courseName: string;
  students: Student[];
  isDarkMode: boolean;
  score1cMap: Record<string, { scoreStr: string; num: number | null }>;
  score2cMap: Record<string, { scoreStr: string; num: number | null }>;
  annualOverrides: Record<string, string>;
  onSaveOverride: (studentId: string, val: string) => void;
  onSwitchTerm: (term: '1c' | '2c') => void;
}

export const AnnualSummaryView: React.FC<AnnualSummaryViewProps> = ({
  courseName,
  students,
  isDarkMode,
  score1cMap,
  score2cMap,
  annualOverrides,
  onSaveOverride,
  onSwitchTerm,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate annual details for each student
  const studentAnnualData = useMemo(() => {
    return students.map((st) => {
      const s1 = score1cMap[st.id] || { scoreStr: '', num: null };
      const s2 = score2cMap[st.id] || { scoreStr: '', num: null };
      const override = annualOverrides[st.id];

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
      const finalNum = finalVal !== '' && !isNaN(Number(finalVal)) ? Number(finalVal) : null;

      let condition = 'Pendiente';
      let conditionBadgeClass = isDarkMode
        ? 'bg-slate-800 text-slate-400 border-slate-700'
        : 'bg-neutral-100 text-neutral-500 border-neutral-200';

      if (finalNum !== null) {
        if (finalNum >= 7) {
          condition = 'Aprobado';
          conditionBadgeClass = isDarkMode
            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200';
        } else if (finalNum >= 6) {
          condition = 'Aprobado (Regular)';
          conditionBadgeClass = isDarkMode
            ? 'bg-amber-950/60 text-amber-300 border-amber-800/80'
            : 'bg-amber-50 text-amber-700 border-amber-200';
        } else {
          condition = 'Compensación Diciembre / Feb';
          conditionBadgeClass = isDarkMode
            ? 'bg-rose-950/60 text-rose-300 border-rose-800/80'
            : 'bg-rose-50 text-rose-700 border-rose-200';
        }
      }

      return {
        student: st,
        score1c: s1.scoreStr,
        score1cNum: s1.num,
        score2c: s2.scoreStr,
        score2cNum: s2.num,
        calcAvgStr,
        calcAvgNum,
        finalVal,
        finalNum,
        hasOverride: override !== undefined && override !== '',
        condition,
        conditionBadgeClass,
      };
    });
  }, [students, score1cMap, score2cMap, annualOverrides, isDarkMode]);

  // Overall KPIs
  const kpis = useMemo(() => {
    const total = students.length;
    const with1c = studentAnnualData.filter((d) => d.score1cNum !== null);
    const with2c = studentAnnualData.filter((d) => d.score2cNum !== null);
    const withFinal = studentAnnualData.filter((d) => d.finalNum !== null);
    const approved = studentAnnualData.filter((d) => d.finalNum !== null && d.finalNum >= 7);

    const avg1c = with1c.length > 0
      ? (with1c.reduce((sum, d) => sum + (d.score1cNum || 0), 0) / with1c.length).toFixed(1)
      : '—';

    const avg2c = with2c.length > 0
      ? (with2c.reduce((sum, d) => sum + (d.score2cNum || 0), 0) / with2c.length).toFixed(1)
      : '—';

    const avgFinal = withFinal.length > 0
      ? (withFinal.reduce((sum, d) => sum + (d.finalNum || 0), 0) / withFinal.length).toFixed(1)
      : '—';

    return {
      total,
      with1cCount: with1c.length,
      with2cCount: with2c.length,
      avg1c,
      avg2c,
      avgFinal,
      approvedCount: approved.length,
      approvedPercent: total > 0 ? Math.round((approved.length / total) * 100) : 0,
    };
  }, [students, studentAnnualData]);

  // Filtered rows
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return studentAnnualData;
    const q = searchQuery.toLowerCase();
    return studentAnnualData.filter(
      (d) =>
        d.student.lastName.toLowerCase().includes(q) ||
        d.student.firstName.toLowerCase().includes(q) ||
        (d.student.email && d.student.email.toLowerCase().includes(q))
    );
  }, [studentAnnualData, searchQuery]);

  // Export CSV
  const handleExportAnnualCSV = () => {
    let csv = 'data:text/csv;charset=utf-8,';
    csv += 'Apellido y Nombre,1° Cuatrimestre,2° Cuatrimestre,Promedio Anual Sugerido,Calificación Final Definitiva,Condición\r\n';

    studentAnnualData.forEach((d) => {
      const name = `"${d.student.lastName}, ${d.student.firstName}"`;
      const s1 = `"${d.score1c || ''}"`;
      const s2 = `"${d.score2c || ''}"`;
      const avg = `"${d.calcAvgStr || ''}"`;
      const fin = `"${d.finalVal || ''}"`;
      const cond = `"${d.condition}"`;
      csv += [name, s1, s2, avg, fin, cond].join(',') + '\r\n';
    });

    const encodedUri = encodeURI(csv);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Cierre_Calificaciones_Anual_${courseName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Badge color for individual scores
  const getScoreBadge = (scoreStr: string) => {
    if (!scoreStr || isNaN(Number(scoreStr))) {
      return (
        <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>
          —
        </span>
      );
    }
    const num = Number(scoreStr);
    let colorClass = isDarkMode
      ? 'bg-red-950/60 text-red-300 border-red-800'
      : 'bg-red-50 text-red-700 border-red-200';
    if (num >= 7) {
      colorClass = isDarkMode
        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (num >= 6) {
      colorClass = isDarkMode
        ? 'bg-amber-950/60 text-amber-300 border-amber-800'
        : 'bg-amber-50 text-amber-700 border-amber-200';
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${colorClass}`}>
        {scoreStr}
      </span>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-base ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Cierre y Calificación Anual — {courseName}
              </h3>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${
                  isDarkMode
                    ? 'bg-purple-950/60 text-purple-400 border-purple-800/60'
                    : 'bg-purple-50 text-purple-700 border-purple-200'
                }`}
              >
                1° y 2° Cuatrimestre
              </span>
            </div>
            <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Consolida automáticamente las notas finales de ambos cuatrimestres, calcula el promedio anual y te permite ajustar la calificación final definitiva a tu criterio pedagógico.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportAnnualCSV}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
            }`}
            title="Descargar planilla completa de cierre anual en CSV para Excel o Google Sheets"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>Exportar Cierre CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3 ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-neutral-200 shadow-2xs'
          }`}
        >
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Total Estudiantes
            </p>
            <p className="text-base font-bold text-neutral-900 dark:text-white">
              {kpis.total}
            </p>
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer hover:border-blue-400 transition-colors ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-neutral-200 shadow-2xs'
          }`}
          onClick={() => onSwitchTerm('1c')}
          title="Ver planilla del 1° Cuatrimestre"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Promedio 1° Cuatrimestre
              </p>
              <p className="text-base font-bold text-blue-600 dark:text-blue-400">
                {kpis.avg1c}
              </p>
            </div>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
        </div>

        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer hover:border-emerald-400 transition-colors ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-neutral-200 shadow-2xs'
          }`}
          onClick={() => onSwitchTerm('2c')}
          title="Ver planilla del 2° Cuatrimestre"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Promedio 2° Cuatrimestre
              </p>
              <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                {kpis.avg2c}
              </p>
            </div>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
        </div>

        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3 ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-neutral-200 shadow-2xs'
          }`}
        >
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <p className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Promedio Anual Curso
            </p>
            <p className="text-base font-bold text-purple-600 dark:text-purple-400">
              {kpis.avgFinal} <span className="text-xs font-normal text-neutral-400">({kpis.approvedPercent}% aprob.)</span>
            </p>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div
        className={`rounded-2xl border overflow-hidden shadow-xs ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        {/* Search and filter bar */}
        <div
          className={`p-3 border-b flex flex-col sm:flex-row items-center justify-between gap-3 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
          }`}
        >
          <div className="relative w-full sm:w-72">
            <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
            <input
              type="text"
              placeholder="Buscar estudiante..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-purple-500 transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-slate-400">
            <span>
              Mostrando <strong>{filteredData.length}</strong> de <strong>{students.length}</strong> alumnos
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead
              className={`border-b font-semibold uppercase tracking-wider ${
                isDarkMode ? 'bg-slate-800/90 border-slate-700 text-slate-300' : 'bg-neutral-100/90 border-neutral-200 text-neutral-600'
              }`}
            >
              <tr>
                <th className="py-3 px-3 text-center w-12">#</th>
                <th className="py-3 px-4">Estudiante</th>
                <th className="py-3 px-4 text-center">1° Cuatrimestre</th>
                <th className="py-3 px-4 text-center">2° Cuatrimestre</th>
                <th className="py-3 px-4 text-center">Promedio Anual</th>
                <th className="py-3 px-4 text-center">Calificación Definitiva</th>
                <th className="py-3 px-4 text-center">Condición Final</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'}`}>
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30 text-purple-500" />
                    <p className={`font-semibold ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                      {students.length === 0
                        ? 'No hay estudiantes en este curso.'
                        : 'No se encontraron estudiantes con ese nombre.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredData.map((row, idx) => (
                  <tr
                    key={row.student.id}
                    className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50/70'}`}
                  >
                    <td className="py-3 px-3 text-center font-mono text-[11px] text-neutral-400">
                      {idx + 1}
                    </td>

                    <td className="py-3 px-4 font-semibold text-neutral-900 dark:text-white">
                      <div>
                        <span>{row.student.lastName}, {row.student.firstName}</span>
                        {row.student.email && (
                          <span className={`block text-[10px] font-normal font-mono ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>
                            {row.student.email}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        {getScoreBadge(row.score1c)}
                        <button
                          type="button"
                          onClick={() => onSwitchTerm('1c')}
                          className="p-1 rounded text-neutral-400 hover:text-blue-500 transition-colors"
                          title="Ir a calificar en 1° Cuatrimestre"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        {getScoreBadge(row.score2c)}
                        <button
                          type="button"
                          onClick={() => onSwitchTerm('2c')}
                          className="p-1 rounded text-neutral-400 hover:text-emerald-500 transition-colors"
                          title="Ir a calificar en 2° Cuatrimestre"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-bold text-xs">
                      {row.calcAvgStr ? (
                        <span className="text-neutral-800 dark:text-slate-200">
                          {row.calcAvgStr}
                        </span>
                      ) : (
                        <span className="text-neutral-400 dark:text-slate-500 font-normal">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-center">
                      <div className="inline-flex items-center justify-center gap-1">
                        <input
                          type="text"
                          value={row.finalVal}
                          placeholder={row.calcAvgStr || 'Nota'}
                          onChange={(e) => onSaveOverride(row.student.id, e.target.value)}
                          className={`w-16 px-2 py-1 text-center font-mono font-bold text-xs rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                            row.hasOverride
                              ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-400/40'
                              : isDarkMode
                              ? 'bg-slate-800 border-slate-700 text-white'
                              : 'bg-white border-neutral-300 text-neutral-900'
                          }`}
                          title={row.hasOverride ? 'Nota personalizada a criterio del docente' : 'Nota final (puedes editarla para aplicar tu criterio pedagógico)'}
                        />
                        {row.hasOverride && (
                          <button
                            type="button"
                            onClick={() => onSaveOverride(row.student.id, '')}
                            className="p-1 rounded text-neutral-400 hover:text-red-500 transition-colors"
                            title="Restablecer al promedio automático"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${row.conditionBadgeClass}`}>
                        {row.condition}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
