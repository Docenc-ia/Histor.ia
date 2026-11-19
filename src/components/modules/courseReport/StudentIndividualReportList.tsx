import React from 'react';
import { AlertTriangle, Award, CheckSquare, FileText } from 'lucide-react';
import type { ConsolidatedReportStudent } from '../../../utils/courseReportAggregator';

export interface StudentIndividualReportListProps {
  schoolName: string;
  effectiveReason: string;
  currentSchoolYear: string;
  courseName: string;
  teacherName: string;
  currentDate: string;
  minAttendancePercent: number;
  attendanceLabel: string;
  dispositionLabel: string;
  term1FullLabel: string;
  term2FullLabel: string;
  term1ShortLabel: string;
  term2ShortLabel: string;
  selectedElementsCount: number;
  includeGrades: boolean;
  includeExamDetails: boolean;
  includeAttendance: boolean;
  includeDisposition: boolean;
  includeDispositionReasons: boolean;
  excludedDispositionReasonIds: Set<string>;
  includeObservations: boolean;
  includeFamilySignature: boolean;
  displayedStudents: ConsolidatedReportStudent[];
  onToggleDispositionReason: (reasonId: string) => void;
  onSelectAllStudentDispositionReasons: (reasonIds: string[], selectAll: boolean) => void;
  onUpdateStudentReportObservation: (studentId: string, text: string) => void;
}

export const StudentIndividualReportList: React.FC<StudentIndividualReportListProps> = ({
  schoolName,
  effectiveReason,
  currentSchoolYear,
  courseName,
  teacherName,
  currentDate,
  minAttendancePercent,
  attendanceLabel,
  dispositionLabel,
  term1FullLabel,
  term2FullLabel,
  term1ShortLabel,
  term2ShortLabel,
  selectedElementsCount,
  includeGrades,
  includeExamDetails,
  includeAttendance,
  includeDisposition,
  includeDispositionReasons,
  excludedDispositionReasonIds,
  includeObservations,
  includeFamilySignature,
  displayedStudents,
  onToggleDispositionReason,
  onSelectAllStudentDispositionReasons,
  onUpdateStudentReportObservation,
}) => {
  return (
    <div>
      {selectedElementsCount === 0 && (
        <div className="p-4 mb-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Has desmarcado todos los bloques. Activá al menos <strong>Calificaciones</strong>, <strong>{attendanceLabel}</strong> o <strong>{dispositionLabel}</strong> en la barra superior para ver la ficha del alumno.
          </span>
        </div>
      )}

      {displayedStudents.map((row) => (
        <div
          key={row.student.id}
          className="print-page-break bg-white text-neutral-900 p-6 sm:p-8 rounded-xl border border-neutral-300 shadow-sm print:border-none print:shadow-none print:p-0 mb-8"
        >
          {/* Header */}
          <div className="border-b-2 border-blue-600 pb-3 mb-4 flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-blue-900 tracking-tight">
                {schoolName}
              </h2>
              <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mt-0.5">
                {effectiveReason} — Ciclo {currentSchoolYear}
              </p>
            </div>
            <div className="text-xs text-neutral-600 text-right space-y-0.5">
              <div>
                <strong>Materia:</strong> {courseName}
              </div>
              <div>
                <strong>Docente:</strong> {teacherName}
              </div>
              <div>
                <strong>Fecha:</strong> {currentDate}
              </div>
            </div>
          </div>

          {/* Student Info Card */}
          <div className="bg-slate-100 p-3.5 rounded-lg border-l-4 border-blue-600 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-neutral-900">
                  {row.student.lastName}, {row.student.firstName}
                </h3>
                <p className="text-xs text-neutral-500 font-mono">
                  {row.student.email || 'Estudiante Regular'}
                </p>
              </div>
              {includeGrades && (
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">
                    Condición
                  </span>
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      row.condition.includes('Aprobado')
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : row.condition === 'Pendiente'
                        ? 'bg-neutral-100 text-neutral-600 border-neutral-300'
                        : 'bg-rose-100 text-rose-800 border-rose-300'
                    }`}
                  >
                    {row.condition}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 1. Academics Block (Conditional) */}
          {includeGrades && (
            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                1. Rendimiento Académico y Calificaciones
              </h4>
              <table className="w-full text-xs border border-neutral-300 mb-3">
                <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      {term1FullLabel}
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      {term2FullLabel}
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      Promedio Ponderado
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300 bg-blue-100 font-bold text-blue-900">
                      Calificación Final Definitiva
                    </th>
                    <th className="py-2 px-3 text-center">Condición de Acreditación</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                      {row.score1c || '—'}
                    </td>
                    <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                      {row.score2c || '—'}
                    </td>
                    <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                      {row.calcAvgStr || '—'}
                    </td>
                    <td className="py-3 px-3 text-center border-r border-neutral-200 bg-blue-50 font-bold text-xl text-blue-700">
                      {row.finalVal || '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-xs">
                      {row.condition}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Detailed Breakdown of Exam & TP Grades from Pestaña Calificaciones */}
              {includeExamDetails && (row.examDetails1c.length > 0 || row.examDetails2c.length > 0) && (
                <div className="mt-2.5">
                  <div className="text-[11px] font-bold text-indigo-900 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Desglose de Evaluaciones, Exámenes y Trabajos Prácticos (Calificaciones)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* 1° Cuatrimestre */}
                    <div className="border border-neutral-300 rounded-lg overflow-hidden">
                      <div className="bg-blue-50/80 border-b border-neutral-300 px-3 py-1.5 font-bold text-[11px] text-blue-900 flex items-center justify-between">
                        <span>{term1FullLabel}</span>
                        <span>Nota {term1ShortLabel}: {row.score1c || '—'}</span>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
                          <tr>
                            <th className="py-1.5 px-2.5 text-left font-semibold">Examen / TP</th>
                            <th className="py-1.5 px-2 text-left font-semibold">Categoría</th>
                            <th className="py-1.5 px-2.5 text-center font-semibold w-16">Nota</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                          {row.examDetails1c.map((item) => (
                            <tr key={`1c-${item.id}`}>
                              <td className="py-1.5 px-2.5 font-medium text-neutral-800">{item.itemName}</td>
                              <td className="py-1.5 px-2 text-neutral-500 text-[10px]">{item.categoryName}</td>
                              <td className="py-1.5 px-2.5 text-center font-bold text-blue-800 bg-blue-50/30">
                                {item.score}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 2° Cuatrimestre */}
                    <div className="border border-neutral-300 rounded-lg overflow-hidden">
                      <div className="bg-indigo-50/80 border-b border-neutral-300 px-3 py-1.5 font-bold text-[11px] text-indigo-900 flex items-center justify-between">
                        <span>{term2FullLabel}</span>
                        <span>Nota {term2ShortLabel}: {row.score2c || '—'}</span>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
                          <tr>
                            <th className="py-1.5 px-2.5 text-left font-semibold">Examen / TP</th>
                            <th className="py-1.5 px-2 text-left font-semibold">Categoría</th>
                            <th className="py-1.5 px-2.5 text-center font-semibold w-16">Nota</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                          {row.examDetails2c.map((item) => (
                            <tr key={`2c-${item.id}`}>
                              <td className="py-1.5 px-2.5 font-medium text-neutral-800">{item.itemName}</td>
                              <td className="py-1.5 px-2 text-neutral-500 text-[10px]">{item.categoryName}</td>
                              <td className="py-1.5 px-2.5 text-center font-bold text-indigo-800 bg-indigo-50/30">
                                {item.score}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Attendance & Disposition Blocks (Conditional) */}
          {includeAttendance && includeDisposition ? (
            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                {includeGrades ? '2' : '1'}. {attendanceLabel}, Puntualidad y {dispositionLabel}
              </h4>
              <table className="w-full text-xs border border-neutral-300">
                <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                  <tr>
                    <th className="py-2 px-2 text-center border-r border-neutral-300">
                      Faltas {term1ShortLabel}
                    </th>
                    <th className="py-2 px-2 text-center border-r border-neutral-300">
                      Faltas {term2ShortLabel}
                    </th>
                    <th className="py-2 px-2 text-center border-r border-neutral-300 font-bold">
                      Total Inasistencias
                    </th>
                    <th className="py-2 px-2 text-center border-r border-neutral-300">
                      Tardanzas
                    </th>
                    <th className="py-2 px-2 text-center border-r border-neutral-300 font-bold">
                      % {attendanceLabel} Estimada
                    </th>
                    <th className="py-2 px-2 text-center font-bold text-purple-700">
                      {dispositionLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                      {row.abs1}
                    </td>
                    <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                      {row.abs2}
                    </td>
                    <td className="py-2.5 px-2 text-center border-r border-neutral-200 font-bold text-neutral-900">
                      {row.totalAbs}
                    </td>
                    <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                      {row.totalLat}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-center border-r border-neutral-200 font-bold ${
                        row.estimatedAttendance < minAttendancePercent ? 'text-rose-600' : 'text-emerald-600'
                      }`}
                    >
                      {row.estimatedAttendance}%
                    </td>
                    <td className="py-2.5 px-2 text-center font-bold text-purple-700">
                      {row.avgDisp} / 10
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : includeAttendance && !includeDisposition ? (
            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                {includeGrades ? '2' : '1'}. Registro de {attendanceLabel} y Puntualidad Escolar
              </h4>
              <table className="w-full text-xs border border-neutral-300">
                <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      Faltas {term1FullLabel}
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      Faltas {term2FullLabel}
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300 bg-rose-50 font-bold text-rose-900">
                      Total Inasistencias Acumuladas
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      Tardanzas Registradas
                    </th>
                    <th className="py-2 px-3 text-center font-bold">
                      % {attendanceLabel} Presencial
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                      {row.abs1}
                    </td>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                      {row.abs2}
                    </td>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 font-bold text-base text-rose-700 bg-rose-50/50">
                      {row.totalAbs} faltas
                    </td>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                      {row.totalLat}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-center font-bold text-sm ${
                        row.estimatedAttendance < minAttendancePercent ? 'text-rose-600' : 'text-emerald-600'
                      }`}
                    >
                      {row.estimatedAttendance}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : !includeAttendance && includeDisposition ? (
            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                {includeGrades ? '2' : '1'}. {dispositionLabel}
              </h4>
              <table className="w-full text-xs border border-neutral-300">
                <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                  <tr>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      {dispositionLabel} {term1ShortLabel}
                    </th>
                    <th className="py-2 px-3 text-center border-r border-neutral-300">
                      {dispositionLabel} {term2ShortLabel}
                    </th>
                    <th className="py-2 px-3 text-center bg-purple-50 font-bold text-purple-900">
                      Puntaje Promedio de {dispositionLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                      {row.disp1} / 10
                    </td>
                    <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                      {row.disp2} / 10
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-base text-purple-700 bg-purple-50/50">
                      {row.avgDisp} / 10
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {/* 2b. Detalle seleccionable de fechas y motivos por los cuales se bajó la Disposición */}
          {includeDisposition && row.dispositionReasons.length > 0 && (() => {
            const checkedReasons = includeDispositionReasons
              ? row.dispositionReasons.filter((r) => !excludedDispositionReasonIds.has(r.id))
              : [];
            const allStudentReasonIds = row.dispositionReasons.map((r) => r.id);
            const areAllSelected =
              includeDispositionReasons &&
              checkedReasons.length === row.dispositionReasons.length;

            return (
              <div className="mb-4">
                {/* Vista interactiva en pantalla: permite marcar/desmarcar cada fecha y motivo */}
                <div className="print:hidden border border-purple-200 rounded-lg overflow-hidden bg-purple-50/30">
                  <div className="bg-purple-100/80 border-b border-purple-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-purple-900">
                      <CheckSquare className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                      <span>
                        Motivos por los cuales se bajó {dispositionLabel} (marcá cuáles incluir en el informe):
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-200 text-purple-900 font-bold">
                        {checkedReasons.length} de {row.dispositionReasons.length} seleccionados
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectAllStudentDispositionReasons(allStudentReasonIds, true)
                        }
                        disabled={areAllSelected}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white text-purple-800 border border-purple-300 hover:bg-purple-50 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectAllStudentDispositionReasons(allStudentReasonIds, false)
                        }
                        disabled={checkedReasons.length === 0}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        Desmarcar todos
                      </button>
                    </div>
                  </div>

                  <table className="w-full text-[11px]">
                    <thead className="bg-neutral-50 border-b border-purple-200 text-neutral-600">
                      <tr>
                        <th className="py-1.5 px-2.5 text-center font-semibold w-14">Incluir</th>
                        <th className="py-1.5 px-2.5 text-center font-semibold w-24">Fecha</th>
                        <th className="py-1.5 px-2 text-center font-semibold w-20">Período</th>
                        <th className="py-1.5 px-3 text-left font-semibold">
                          Motivo por el cual se bajó {dispositionLabel}
                        </th>
                        <th className="py-1.5 px-2.5 text-center font-semibold w-20">Puntaje</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-purple-100 bg-white">
                      {row.dispositionReasons.map((item) => {
                        const isChecked =
                          includeDispositionReasons &&
                          !excludedDispositionReasonIds.has(item.id);
                        return (
                          <tr
                            key={item.id}
                            onClick={() => onToggleDispositionReason(item.id)}
                            className={`cursor-pointer transition-colors ${
                              isChecked
                                ? 'hover:bg-purple-50/60 text-neutral-900'
                                : 'bg-neutral-50/80 text-neutral-400 hover:bg-neutral-100/70'
                            }`}
                          >
                            <td className="py-2 px-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => onToggleDispositionReason(item.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-3.5 h-3.5 rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                              />
                            </td>
                            <td className="py-2 px-2.5 text-center font-mono font-semibold">
                              {item.date}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {item.term === '2c' ? term2ShortLabel : term1ShortLabel}
                            </td>
                            <td className="py-2 px-3 font-medium">
                              <span>{item.reason}</span>
                              {!isChecked && (
                                <span className="ml-2 text-[10px] italic text-neutral-400">
                                  (Omitido del informe)
                                </span>
                              )}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-center font-bold ${
                                isChecked ? 'text-rose-700' : 'text-neutral-400'
                              }`}
                            >
                              {item.pointsChange > 0
                                ? `+${item.pointsChange}`
                                : item.pointsChange}{' '}
                              pto
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Vista limpia de impresión: muestra solo las fechas y motivos marcados */}
                {checkedReasons.length > 0 && (
                  <div className="hidden print:block mt-2">
                    <div className="text-[11px] font-bold text-purple-900 uppercase tracking-wide mb-1.5">
                      Detalle de motivos por los cuales se bajó {dispositionLabel} (Fecha y Motivo):
                    </div>
                    <table className="w-full text-[11px] border border-neutral-300">
                      <thead className="bg-neutral-100 border-b border-neutral-300 text-neutral-700 font-semibold">
                        <tr>
                          <th className="py-1.5 px-2.5 text-center border-r border-neutral-300 w-24">
                            Fecha
                          </th>
                          <th className="py-1.5 px-2 text-center border-r border-neutral-300 w-20">
                            Período
                          </th>
                          <th className="py-1.5 px-3 text-left border-r border-neutral-300">
                            Motivo por el cual se bajó {dispositionLabel}
                          </th>
                          <th className="py-1.5 px-2.5 text-center w-20">Puntaje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {checkedReasons.map((item) => (
                          <tr key={`print-${item.id}`}>
                            <td className="py-1.5 px-2.5 text-center border-r border-neutral-200 font-semibold">
                              {item.date}
                            </td>
                            <td className="py-1.5 px-2 text-center border-r border-neutral-200">
                              {item.term === '2c' ? term2ShortLabel : term1ShortLabel}
                            </td>
                            <td className="py-1.5 px-3 border-r border-neutral-200 text-neutral-800">
                              {item.reason}
                            </td>
                            <td className="py-1.5 px-2.5 text-center font-bold text-rose-700">
                              {item.pointsChange > 0
                                ? `+${item.pointsChange}`
                                : item.pointsChange}{' '}
                              pto
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 3. Pedagogical Observations for Report (Conditional) */}
          {includeObservations && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-5">
              <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-700" />
                  {includeGrades && (includeAttendance || includeDisposition)
                    ? '3'
                    : includeGrades || includeAttendance || includeDisposition
                    ? '2'
                    : '1'}
                  . Observaciones Pedagógicas y Síntesis:
                </h4>
              </div>

              {/* Screen View: Editable Textarea */}
              <div className="print:hidden">
                <textarea
                  value={row.observation}
                  onChange={(e) =>
                    onUpdateStudentReportObservation(row.student.id, e.target.value)
                  }
                  rows={4}
                  className="w-full text-xs bg-white border border-amber-300 rounded-md p-2.5 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed transition shadow-sm resize-y"
                  placeholder="Escribí acá las observaciones pedagógicas y síntesis para este estudiante..."
                />
              </div>

              {/* Print View: Clean printed text without input controls */}
              <div className="hidden print:block">
                <p className="text-xs text-neutral-800 leading-relaxed font-sans whitespace-pre-wrap">
                  {row.observation || '—'}
                </p>
              </div>
            </div>
          )}

          {/* 4. Family Signature Slip / Notificación Institucional (Conditional) */}
          {includeFamilySignature && (
            <div className="mt-6 pt-3 border-t border-dashed border-neutral-400 bg-neutral-50/50 p-3 rounded-lg">
              <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wide mb-2">
                Acta de Notificación Institucional a la Familia
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-4">
                <div className="border border-neutral-300 rounded-lg p-3 bg-white">
                  <div className="font-semibold text-neutral-700 mb-6">
                    Constancia del Docente
                  </div>
                  <div className="border-t border-neutral-400 pt-1 text-[11px] text-neutral-600">
                    Firma del Docente: <strong>{teacherName}</strong>
                  </div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">{schoolName}</div>
                </div>
                <div className="border border-neutral-300 rounded-lg p-3 bg-white">
                  <div className="font-semibold text-neutral-700 mb-6">
                    Notificación del Adulto Responsable / Tutor
                  </div>
                  <div className="border-t border-neutral-400 pt-1 text-[11px] text-neutral-600">
                    Firma: _________________________________________
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                    <span>Aclaración: ___________________________</span>
                    <span>DNI: _______________</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Official Document Footer */}
          <div className="pt-5 mt-4 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-neutral-500 gap-2">
            <div>
              <strong className="text-neutral-700">Constancia Oficial de Trayectoria</strong> — {courseName}
            </div>
            <div>
              Docente: <strong className="text-neutral-700">{teacherName}</strong> — Ciclo Lectivo {currentSchoolYear}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
