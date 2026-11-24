/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  Check,
  RotateCcw,
  Sparkles,
  Scale,
} from 'lucide-react';
import { GradeScaleSettings } from '../../types/grades';
import {
  GRADE_SCALE_PRESETS,
  INTENSIFICATION_LABEL_PRESETS,
  DEFAULT_TERMINOLOGY_SETTINGS,
} from '../../utils/terminologySettings';

export interface GradebookScaleSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  generalGradeScale: GradeScaleSettings;
  intensificationLabel: string;
  intensificationPassingScore: number;
  onSave: (updates: {
    gradeScaleMin: number;
    gradeScaleMax: number;
    gradePassingScore: number;
    gradeRegularScore: number | null;
    intensificationLabel: string;
    intensificationPassingScore: number;
  }) => void;
}

export const GradebookScaleSettingsModal: React.FC<GradebookScaleSettingsModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  generalGradeScale,
  intensificationLabel,
  intensificationPassingScore,
  onSave,
}) => {
  const [minScoreStr, setMinScoreStr] = useState(String(generalGradeScale.minScore));
  const [maxScoreStr, setMaxScoreStr] = useState(String(generalGradeScale.maxScore));
  const [passingScoreStr, setPassingScoreStr] = useState(String(generalGradeScale.passingScore));
  const [enableRegularTier, setEnableRegularTier] = useState(
    generalGradeScale.regularScore !== null
  );
  const [regularScoreStr, setRegularScoreStr] = useState(
    generalGradeScale.regularScore !== null
      ? String(generalGradeScale.regularScore)
      : String(Math.max(generalGradeScale.minScore, generalGradeScale.passingScore - 1))
  );
  const [instLabelDraft, setInstLabelDraft] = useState(intensificationLabel);
  const [syncInstPassWithGeneral, setSyncInstPassWithGeneral] = useState(
    intensificationPassingScore === generalGradeScale.passingScore
  );
  const [instPassDraft, setInstPassDraft] = useState(String(intensificationPassingScore));

  useEffect(() => {
    if (!isOpen) return;
    setMinScoreStr(String(generalGradeScale.minScore));
    setMaxScoreStr(String(generalGradeScale.maxScore));
    setPassingScoreStr(String(generalGradeScale.passingScore));
    setEnableRegularTier(generalGradeScale.regularScore !== null);
    setRegularScoreStr(
      generalGradeScale.regularScore !== null
        ? String(generalGradeScale.regularScore)
        : String(Math.max(generalGradeScale.minScore, generalGradeScale.passingScore - 1))
    );
    setInstLabelDraft(intensificationLabel);
    setSyncInstPassWithGeneral(intensificationPassingScore === generalGradeScale.passingScore);
    setInstPassDraft(String(intensificationPassingScore));
  }, [isOpen, generalGradeScale, intensificationLabel, intensificationPassingScore]);

  if (!isOpen) return null;

  const parseNum = (raw: string, fallback: number): number => {
    const n = Number(String(raw ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : fallback;
  };

  const parsedMin = Math.max(0, Math.min(100, parseNum(minScoreStr, 1)));
  const parsedMax = Math.max(parsedMin + 1, Math.min(1000, parseNum(maxScoreStr, 10)));
  const parsedPass = Math.max(
    parsedMin + 0.1,
    Math.min(parsedMax, parseNum(passingScoreStr, Math.min(7, parsedMax)))
  );
  const parsedRegularRaw = parseNum(regularScoreStr, Math.max(parsedMin, parsedPass - 1));
  const parsedRegular: number | null =
    enableRegularTier && parsedRegularRaw >= parsedMin && parsedRegularRaw < parsedPass
      ? parsedRegularRaw
      : null;

  const effectiveInstPass = syncInstPassWithGeneral
    ? parsedPass
    : Math.max(0.1, Math.min(parsedMax, parseNum(instPassDraft, parsedPass)));

  const handleApplyPreset = (preset: (typeof GRADE_SCALE_PRESETS)[number]) => {
    setMinScoreStr(String(preset.minScore));
    setMaxScoreStr(String(preset.maxScore));
    setPassingScoreStr(String(preset.passingScore));
    setEnableRegularTier(preset.regularScore !== null);
    setRegularScoreStr(
      preset.regularScore !== null
        ? String(preset.regularScore)
        : String(Math.max(preset.minScore, preset.passingScore - 1))
    );
    if (syncInstPassWithGeneral) {
      setInstPassDraft(String(preset.passingScore));
    }
  };

  const handleResetDefaults = () => {
    setMinScoreStr(String(DEFAULT_TERMINOLOGY_SETTINGS.gradeScaleMin));
    setMaxScoreStr(String(DEFAULT_TERMINOLOGY_SETTINGS.gradeScaleMax));
    setPassingScoreStr(String(DEFAULT_TERMINOLOGY_SETTINGS.gradePassingScore));
    setEnableRegularTier(DEFAULT_TERMINOLOGY_SETTINGS.gradeRegularScore !== null);
    setRegularScoreStr(String(DEFAULT_TERMINOLOGY_SETTINGS.gradeRegularScore ?? 6));
    setInstLabelDraft(DEFAULT_TERMINOLOGY_SETTINGS.intensificationLabel);
    setSyncInstPassWithGeneral(true);
    setInstPassDraft(String(DEFAULT_TERMINOLOGY_SETTINGS.gradePassingScore));
  };

  const handleConfirmSave = () => {
    onSave({
      gradeScaleMin: parsedMin,
      gradeScaleMax: parsedMax,
      gradePassingScore: parsedPass,
      gradeRegularScore: parsedRegular,
      intensificationLabel: instLabelDraft.trim() || DEFAULT_TERMINOLOGY_SETTINGS.intensificationLabel,
      intensificationPassingScore: effectiveInstPass,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden ${
          isDarkMode
            ? 'bg-slate-900 border-slate-800 text-white'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold">Configuración de Calificaciones</h3>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Definí la escala general (luego podés personalizar cualquier evaluación o TP en particular).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1.5 rounded-lg cursor-pointer"
            aria-label="Cerrar configuración"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {/* 1. Presets rápidos */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-neutral-700 dark:text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <span>Escalas generales frecuentes</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {GRADE_SCALE_PRESETS.map((preset) => {
                const isSelected =
                  parsedMin === preset.minScore &&
                  parsedMax === preset.maxScore &&
                  parsedPass === preset.passingScore &&
                  parsedRegular === preset.regularScore;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? isDarkMode
                          ? 'bg-emerald-950/50 border-emerald-500 text-emerald-100 ring-1 ring-emerald-500/40'
                          : 'bg-emerald-50 border-emerald-500 text-emerald-950 ring-1 ring-emerald-500/30 shadow-2xs'
                        : isDarkMode
                        ? 'bg-slate-800/70 border-slate-700 text-slate-200 hover:bg-slate-800'
                        : 'bg-neutral-50/70 border-neutral-200 text-neutral-800 hover:bg-neutral-100/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs">{preset.label}</span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                    </div>
                    <div
                      className={`text-[11px] mt-0.5 ${
                        isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                      }`}
                    >
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Personalización fina */}
          <div
            className={`p-4 rounded-xl border space-y-3.5 ${
              isDarkMode ? 'bg-slate-800/50 border-slate-700/80' : 'bg-neutral-50/90 border-neutral-200'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold text-neutral-800 dark:text-slate-100">
              <Scale className="w-3.5 h-3.5 text-blue-500" />
              <span>Personalizar valores de la escala general</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300 block">
                  Nota mínima
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={minScoreStr}
                  onChange={(e) => setMinScoreStr(e.target.value)}
                  className={`w-full px-2.5 py-1.5 text-center font-bold rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-slate-300 block">
                  Nota máxima
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={maxScoreStr}
                  onChange={(e) => setMaxScoreStr(e.target.value)}
                  className={`w-full px-2.5 py-1.5 text-center font-bold rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block">
                  Se aprueba con
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={parsedMax}
                  step={0.5}
                  value={passingScoreStr}
                  onChange={(e) => {
                    setPassingScoreStr(e.target.value);
                    if (syncInstPassWithGeneral) {
                      setInstPassDraft(e.target.value);
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 text-center font-bold rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDarkMode
                      ? 'bg-slate-900 border-emerald-700/70 text-emerald-300'
                      : 'bg-white border-emerald-400 text-emerald-800'
                  }`}
                />
              </div>
            </div>

            {/* Franja intermedia Regular opcional */}
            <div className="pt-2 border-t border-neutral-200/80 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableRegularTier}
                  onChange={(e) => setEnableRegularTier(e.target.checked)}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <span className="font-semibold text-neutral-700 dark:text-slate-200">
                  Usar franja intermedia "Regular / En proceso" (ámbar)
                </span>
              </label>

              {enableRegularTier && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400">Desde:</span>
                  <input
                    type="number"
                    min={parsedMin}
                    max={Math.max(parsedMin, parsedPass - 0.5)}
                    step={0.5}
                    value={regularScoreStr}
                    onChange={(e) => setRegularScoreStr(e.target.value)}
                    className={`w-16 px-2 py-1 text-center font-bold rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode
                        ? 'bg-slate-900 border-amber-700/70 text-amber-300'
                        : 'bg-white border-amber-300 text-amber-800'
                    }`}
                  />
                </div>
              )}
            </div>

            {/* Vista previa en vivo */}
            <div
              className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                isDarkMode
                  ? 'bg-slate-900/90 border-slate-700/80'
                  : 'bg-white border-neutral-200'
              }`}
            >
              <span className="font-semibold text-neutral-500 dark:text-slate-400">
                Vista previa ({parsedMin} al {parsedMax}):
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Aprobado (≥ {parsedPass})
                </span>
                {parsedRegular !== null && (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Regular ({parsedRegular}–{Math.round((parsedPass - 0.1) * 10) / 10})
                  </span>
                )}
                <span className="inline-flex items-center gap-1 font-bold text-red-600 dark:text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Desaprobado (&lt; {parsedRegular !== null ? parsedRegular : parsedPass})
                </span>
              </div>
            </div>
          </div>

          {/* 3. Valores por defecto para Intensificación / Recuperatorio */}
          <div
            className={`p-4 rounded-xl border space-y-2.5 ${
              isDarkMode
                ? 'bg-amber-950/20 border-amber-500/35'
                : 'bg-amber-50/60 border-amber-200'
            }`}
          >
            <div className="font-bold text-amber-800 dark:text-amber-300">
              Nombre y nota mínima predeterminada para Recuperatorio / Intensificación
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={instLabelDraft}
                onChange={(e) => setInstLabelDraft(e.target.value)}
                placeholder="Ej: Intensificación, Recuperatorio..."
                className={`flex-1 min-w-[160px] px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white'
                    : 'bg-white border-amber-300 text-neutral-900'
                }`}
              />
              {INTENSIFICATION_LABEL_PRESETS.slice(0, 3).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setInstLabelDraft(preset)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer ${
                    instLabelDraft.toLowerCase() === preset.toLowerCase()
                      ? 'bg-amber-600 text-white border-amber-600'
                      : isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100/70'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={syncInstPassWithGeneral}
                  onChange={(e) => {
                    setSyncInstPassWithGeneral(e.target.checked);
                    if (e.target.checked) setInstPassDraft(String(parsedPass));
                  }}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <span>Usar la misma nota de aprobación general (≥ {parsedPass})</span>
              </label>

              {!syncInstPassWithGeneral && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Mín. intensificación:
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={parsedMax}
                    step={0.5}
                    value={instPassDraft}
                    onChange={(e) => setInstPassDraft(e.target.value)}
                    className={`w-16 px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white'
                        : 'bg-white border-amber-300 text-neutral-900'
                    }`}
                  />
                </div>
              )}
            </div>
          </div>

          <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Tip: además de esta escala general, podés hacer clic en el título de cualquier evaluación o trabajo práctico para asignarle una escala propia (por ejemplo, del 1 al 5), convertir notas sobre 100 automáticamente a 10, o sumarla con otra evaluación.
          </p>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-t shrink-0 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <button
            type="button"
            onClick={handleResetDefaults}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restablecer (1–10 · ≥ 7)</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Guardar Configuración</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
