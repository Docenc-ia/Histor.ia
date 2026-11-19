import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  ConsolidatedReportStudent,
  CourseReportStats,
} from '../../../utils/courseReportAggregator';

export interface CourseConsolidatedReportViewProps {
  schoolName: string;
  effectiveReason: string;
  currentSchoolYear: string;
  courseName: string;
  teacherName: string;
  currentDate: string;
  attendanceLabel: string;
  dispositionLabel: string;
  term1ShortLabel: string;
  term2ShortLabel: string;
  selectedElementsCount: number;
  includeGrades: boolean;
  includeAttendance: boolean;
  includeDisposition: boolean;
  includeObservations: boolean;
  stats: CourseReportStats;
  consolidatedStudents: ConsolidatedReportStudent[];
  courseObservation: string;
  onUpdateCourseObservation: (text: string) => void;
}

export const CourseConsolidatedReportView: React.FC<CourseConsolidatedReportViewProps> = ({
  schoolName,
  effectiveReason,
  currentSchoolYear,
  courseName,
  teacherName,
  currentDate,
  attendanceLabel,
  dispositionLabel,
  term1ShortLabel,
  term2ShortLabel,
  selectedElementsCount,
  includeGrades,
  includeAttendance,
  includeDisposition,
  includeObservations,
  stats,
  consolidatedStudents,
  courseObservation,
  onUpdateCourseObservation,
}) => {
  return (
    <div className="bg-white text-neutral-900 p-6 sm:p-8 rounded-xl border border-neutral-300 shadow-sm print:border-none print:shadow-none print:p-0">
      {/* Header */}
      <div className="border-b-2 border-blue-600 pb-4 mb-5 flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-xl font-bold text-blue-900 tracking-tight">
            {schoolName}
          </h1>
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mt-1">
            {effectiveReason} — Ciclo Lectivo {currentSchoolYear}
          </p>
        </div>
        <div className="text-xs text-neutral-600 sm:text-right space-y-0.5">
          <div>
            <strong>Materia:</strong> {courseName}
          </div>
          <div>
            <strong>Docente:</strong> {teacherName}
          </div>
          <div>
            <strong>Fecha de emisión:</strong> {currentDate}
          </div>
          <div>
            <strong>Matrícula:</strong> {stats.total} estudiantes
          </div>
        </div>
      </div>

      {/* Warning if no elements are selected */}
      {selectedElementsCount === 0 && (
        <div className="p-4 mb-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Has desmarcado todos los elementos. Marcá al menos <strong>Calificaciones</strong>, <strong>{attendanceLabel}</strong> o <strong>{dispositionLabel}</strong> en la barra superior para generar el reporte.
          </span>
        </div>
      )}

      {/* KPI Strip (Conditional) */}
      {(includeGrades || includeAttendance || includeDisposition) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {includeGrades && (
            <>
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                  Aprobados
                </span>
                <span className="text-lg font-bold text-emerald-600">
                  {stats.approvedCount}{' '}
                  <span className="text-xs font-medium text-neutral-500">
                    ({stats.approvedPercent}%)
                  </span>
                </span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                  En Compensación
                </span>
                <span className="text-lg font-bold text-rose-600">
                  {stats.compCount}
                </span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                  Promedio Anual Curso
                </span>
                <span className="text-lg font-bold text-purple-600">
                  {stats.avgScore}
                </span>
              </div>
            </>
          )}
          {includeAttendance && (
            <>
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                  {attendanceLabel} Promedio
                </span>
                <span className="text-lg font-bold text-blue-600">
                  {stats.avgAttendance}%
                </span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                  Total Inasistencias
                </span>
                <span className="text-lg font-bold text-rose-600">
                  {stats.totalCourseAbsences}
                </span>
              </div>
            </>
          )}
          {includeDisposition && (
            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                {dispositionLabel} Promedio
              </span>
              <span className="text-lg font-bold text-purple-600">
                {(
                  consolidatedStudents.reduce((acc, s) => acc + s.avgDisp, 0) /
                  (consolidatedStudents.length || 1)
                ).toFixed(1)}{' '}
                / 10
              </span>
            </div>
          )}
        </div>
      )}

      {/* Table with conditional columns */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-left text-xs border border-neutral-300">
          <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
            <tr>
              <th className="py-2.5 px-2 text-center border-r border-neutral-300 w-8">#</th>
              <th className="py-2.5 px-3 border-r border-neutral-300">Estudiante</th>
              {includeGrades && (
                <>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">{term1ShortLabel}</th>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">{term2ShortLabel}</th>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">Promedio</th>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300 bg-blue-50/60 font-bold">
                    Nota Definitiva
                  </th>
                </>
              )}
              {includeAttendance && (
                <>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas {term1ShortLabel}</th>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas {term2ShortLabel}</th>
                  <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas Totales</th>
                </>
              )}
              {includeDisposition && (
                <th className="py-2.5 px-2 text-center border-r border-neutral-300">{dispositionLabel}</th>
              )}
              {includeGrades && (
                <th className="py-2.5 px-3 text-center">Condición Final</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {consolidatedStudents.map((row, idx) => (
              <tr key={row.student.id} className="hover:bg-neutral-50/60">
                <td className="py-2 px-2 text-center text-neutral-500 border-r border-neutral-200 font-mono text-[11px]">
                  {idx + 1}
                </td>
                <td className="py-2 px-3 border-r border-neutral-200 font-medium text-neutral-900">
                  {row.student.lastName}, {row.student.firstName}
                </td>
                {includeGrades && (
                  <>
                    <td className="py-2 px-2 text-center border-r border-neutral-200">
                      {row.score1c || '—'}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-neutral-200">
                      {row.score2c || '—'}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-neutral-200 font-bold text-neutral-800">
                      {row.calcAvgStr || '—'}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-neutral-200 bg-blue-50/30 font-bold text-blue-900 text-sm">
                      {row.finalVal || '—'}
                    </td>
                  </>
                )}
                {includeAttendance && (
                  <>
                    <td className="py-2 px-2 text-center border-r border-neutral-200">
                      {row.abs1}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-neutral-200">
                      {row.abs2}
                    </td>
                    <td className="py-2 px-2 text-center border-r border-neutral-200 font-semibold text-neutral-900">
                      {row.totalAbs}
                    </td>
                  </>
                )}
                {includeDisposition && (
                  <td className="py-2 px-2 text-center border-r border-neutral-200 font-semibold text-purple-700">
                    {row.avgDisp}/10
                  </td>
                )}
                {includeGrades && (
                  <td className="py-2 px-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        row.condition.includes('Aprobado')
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : row.condition === 'Pendiente'
                          ? 'bg-neutral-100 text-neutral-600 border-neutral-300'
                          : 'bg-rose-100 text-rose-800 border-rose-300'
                      }`}
                    >
                      {row.condition}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Course Pedagogical Observations (Conditional) */}
      {includeObservations && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-8">
          <h4 className="text-xs font-bold text-amber-900 mb-2">
            Observaciones Pedagógicas y Síntesis:
          </h4>
          <div className="print:hidden">
            <textarea
              value={courseObservation}
              onChange={(e) => onUpdateCourseObservation(e.target.value)}
              rows={4}
              className="w-full text-xs bg-white border border-amber-300 rounded-md p-2.5 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed transition shadow-sm resize-y"
              placeholder="Escribí acá las observaciones pedagógicas y síntesis del curso..."
            />
          </div>
          <div className="hidden print:block">
            <p className="text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap">
              {courseObservation || '—'}
            </p>
          </div>
        </div>
      )}

      {/* Official Institutional Verification Footer */}
      <div className="pt-6 mt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 gap-2">
        <p>
          <strong className="text-neutral-700">Informe Institucional del Curso</strong> — {courseName}
        </p>
        <p>
          Docente responsable: <strong className="text-neutral-700">{teacherName}</strong> — {schoolName}
        </p>
      </div>
    </div>
  );
};
