import React from 'react';
import { CheckSquare, Square } from 'lucide-react';
import type { ReportGradesPeriod } from '../../../utils/courseReportAggregator';

export interface ReportElementsToolbarProps {
  isDarkMode: boolean;
  activeTab: 'course' | 'individual';
  attendanceLabel: string;
  dispositionLabel: string;
  term1ShortLabel: string;
  term2ShortLabel: string;
  includeGrades: boolean;
  onToggleGrades: () => void;
  gradesPeriod: ReportGradesPeriod;
  onChangeGradesPeriod: (period: ReportGradesPeriod) => void;
  includeExamDetails: boolean;
  onToggleExamDetails: () => void;
  includeAttendance: boolean;
  onToggleAttendance: () => void;
  includeDisposition: boolean;
  onToggleDisposition: () => void;
  includeDispositionReasons: boolean;
  onToggleDispositionReasons: () => void;
  includeObservations: boolean;
  onToggleObservations: () => void;
  includeFamilySignature: boolean;
  onToggleFamilySignature: () => void;
}

export const ReportElementsToolbar: React.FC<ReportElementsToolbarProps> = ({
  isDarkMode,
  activeTab,
  attendanceLabel,
  dispositionLabel,
  term1ShortLabel,
  term2ShortLabel,
  includeGrades,
  onToggleGrades,
  gradesPeriod,
  onChangeGradesPeriod,
  includeExamDetails,
  onToggleExamDetails,
  includeAttendance,
  onToggleAttendance,
  includeDisposition,
  onToggleDisposition,
  includeDispositionReasons,
  onToggleDispositionReasons,
  includeObservations,
  onToggleObservations,
  includeFamilySignature,
  onToggleFamilySignature,
}) => {
  const gradesPeriodHint =
    gradesPeriod === '1c'
      ? term1ShortLabel
      : gradesPeriod === '2c'
      ? term2ShortLabel
      : `${term1ShortLabel}, ${term2ShortLabel}, Final`;

  return (
    <div
      className={`px-5 py-3 border-b text-xs transition-colors shrink-0 space-y-2.5 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
      }`}
    >
      {/* Botones / Checkboxes interactivos con clic directo */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Calificaciones */}
        <button
          type="button"
          onClick={onToggleGrades}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            includeGrades
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700 shadow-2xs font-bold'
              : isDarkMode
              ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
              : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
          }`}
        >
          {includeGrades ? (
            <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          ) : (
            <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>Calificaciones</span>
          <span className="text-[10px] opacity-75 font-normal">({gradesPeriodHint})</span>
        </button>

        {/* 1a. Selector de período de notas (1°C, 2°C o Ambos) */}
        {includeGrades && (
          <div
            className={`inline-flex items-center p-0.5 rounded-lg border ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
            }`}
            role="group"
            aria-label="Período de notas en el informe"
          >
            {(
              [
                { id: '1c', label: term1ShortLabel, activeClass: 'bg-blue-600 text-white' },
                { id: '2c', label: term2ShortLabel, activeClass: 'bg-emerald-600 text-white' },
                { id: 'both', label: 'Ambos', activeClass: 'bg-violet-600 text-white' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeGradesPeriod(opt.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  gradesPeriod === opt.id
                    ? `${opt.activeClass} shadow-2xs`
                    : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title={`Incluir solo notas de: ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* 1b. Notas de Exámenes y TPs (solo en ficha individual cuando Calificaciones está activo) */}
        {includeGrades && activeTab === 'individual' && (
          <button
            type="button"
            onClick={onToggleExamDetails}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              includeExamDetails
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 shadow-2xs font-bold'
                : isDarkMode
                ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
            }`}
            title="Extraer e incluir el desglose de todas las notas de Exámenes y Trabajos Prácticos de la pestaña Calificaciones"
          >
            {includeExamDetails ? (
              <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            ) : (
              <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            )}
            <span>Notas de Exámenes y TPs</span>
            <span className="text-[10px] opacity-75 font-normal">(Desglose)</span>
          </button>
        )}

        {/* 2. Asistencia */}
        <button
          type="button"
          onClick={onToggleAttendance}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            includeAttendance
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs font-bold'
              : isDarkMode
              ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
              : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
          }`}
        >
          {includeAttendance ? (
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>{attendanceLabel}</span>
          <span className="text-[10px] opacity-75 font-normal">(Faltas y %)</span>
        </button>

        {/* 3. Disposición */}
        <button
          type="button"
          onClick={onToggleDisposition}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            includeDisposition
              ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700 shadow-2xs font-bold'
              : isDarkMode
              ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
              : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
          }`}
        >
          {includeDisposition ? (
            <CheckSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
          ) : (
            <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>{dispositionLabel}</span>
          <span className="text-[10px] opacity-75 font-normal">(Puntaje y actitud)</span>
        </button>

        {/* 3b. Motivos de Disposición (solo en ficha individual cuando Disposición está activo) */}
        {includeDisposition && activeTab === 'individual' && (
          <button
            type="button"
            onClick={onToggleDispositionReasons}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              includeDispositionReasons
                ? 'bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-800 dark:text-fuchsia-300 border-fuchsia-300 dark:border-fuchsia-700 shadow-2xs font-bold'
                : isDarkMode
                ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
            }`}
            title={`Incluir y permitir marcar cada una de las razones (fecha y motivo) por las cuales se bajó ${dispositionLabel}`}
          >
            {includeDispositionReasons ? (
              <CheckSquare className="w-3.5 h-3.5 text-fuchsia-600 dark:text-fuchsia-400 shrink-0" />
            ) : (
              <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            )}
            <span>Motivos de {dispositionLabel}</span>
            <span className="text-[10px] opacity-75 font-normal">(Fecha y motivo)</span>
          </button>
        )}

        {/* 4. Observaciones */}
        <button
          type="button"
          onClick={onToggleObservations}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            includeObservations
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 shadow-2xs font-bold'
              : isDarkMode
              ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
              : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
          }`}
        >
          {includeObservations ? (
            <CheckSquare className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>Observaciones</span>
        </button>

        {/* 5. Talón de firma de familias */}
        <button
          type="button"
          onClick={onToggleFamilySignature}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            includeFamilySignature
              ? 'bg-neutral-800 text-white dark:bg-slate-700 dark:text-white border-neutral-800 dark:border-slate-600 shadow-2xs font-bold'
              : isDarkMode
              ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
              : 'bg-neutral-100 text-neutral-500 border-neutral-200 opacity-75'
          }`}
          title="Incluye talón con línea para firma del docente y notificación/firma del padre, madre o tutor"
        >
          {includeFamilySignature ? (
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>Talón de Firma Familias</span>
        </button>
      </div>
    </div>
  );
};
