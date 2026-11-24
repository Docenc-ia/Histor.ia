import { useState, useEffect, useCallback } from 'react';
import { getUserStorageKey } from '../services/api';
import { storageGateway } from '../services/storageGateway';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';

import { GradeScaleSettings } from '../types/grades';

export interface TerminologySettings {
  attendanceLabel: string;
  dispositionLabel: string;
  periodNameSingular: string;
  initialDispositionScore: number;
  intensificationLabel: string;
  intensificationPassingScore: number;
  gradeScaleMin: number;
  gradeScaleMax: number;
  gradePassingScore: number;
  gradeRegularScore: number | null;
}

export const DEFAULT_TERMINOLOGY_SETTINGS: TerminologySettings = {
  attendanceLabel: 'Asistencia',
  dispositionLabel: 'Disposición',
  periodNameSingular: 'Cuatrimestre',
  initialDispositionScore: 10,
  intensificationLabel: 'Intensificación',
  intensificationPassingScore: 7,
  gradeScaleMin: 1,
  gradeScaleMax: 10,
  gradePassingScore: 7,
  gradeRegularScore: 6,
};

export interface GradeScalePreset {
  id: string;
  label: string;
  description: string;
  minScore: number;
  maxScore: number;
  passingScore: number;
  regularScore: number | null;
}

export const GRADE_SCALE_PRESETS: GradeScalePreset[] = [
  {
    id: '1-10-7',
    label: '1 al 10 · Aprueba con 7',
    description: 'Estándar (7+ aprobado, 6 regular)',
    minScore: 1,
    maxScore: 10,
    passingScore: 7,
    regularScore: 6,
  },
  {
    id: '1-10-6',
    label: '1 al 10 · Aprueba con 6',
    description: 'Aprobación directa desde 6',
    minScore: 1,
    maxScore: 10,
    passingScore: 6,
    regularScore: null,
  },
  {
    id: '1-10-4',
    label: '1 al 10 · Aprueba con 4',
    description: 'Escala terciaria / universitaria',
    minScore: 1,
    maxScore: 10,
    passingScore: 4,
    regularScore: null,
  },
  {
    id: '1-100-70',
    label: '1 al 100 · Aprueba con 70',
    description: 'Escala porcentual directa',
    minScore: 1,
    maxScore: 100,
    passingScore: 70,
    regularScore: 60,
  },
];

export const INTENSIFICATION_PASSING_SCORE_PRESETS: number[] = [6, 7, 8];

export const INTENSIFICATION_LABEL_PRESETS: string[] = [
  'Intensificación',
  'Recuperación',
  'Recuperatorio',
  'Instancia de Revisión',
  'Compensación',
];

export const DISPOSITION_LABEL_PRESETS: string[] = [
  'Disposición',
  'Concepto',
  'Participación en clase',
  'Desempeño áulico',
  'Conducta',
];

export const ATTENDANCE_LABEL_PRESETS: string[] = [
  'Asistencia',
  'Presentismo',
  'Asistencia a clase',
];

export const PERIOD_NAME_PRESETS: string[] = [
  'Cuatrimestre',
  'Etapa',
  'Trimestre',
  'Bimestre',
  'Período',
];

const STORAGE_BASE_KEY = 'docencia_terminology_settings';
const TERMINOLOGY_UPDATED_EVENT = 'docencia_terminology_updated';

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 42) : fallback;
}

function sanitizeInitialScore(value: unknown, fallback = 10): number {
  if (value === 0 || value === '0') return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  if (rounded < 0 || rounded > 10) return fallback;
  return rounded;
}

function sanitizePassingScore(value: unknown, fallback = 7, maxBound = 1000): number {
  const num = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0 || num > maxBound) return fallback;
  return Math.round(num * 10) / 10;
}

function sanitizeScaleMin(value: unknown, fallback = 1): number {
  if (value === 0 || value === '0') return 0;
  const num = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > 100) return fallback;
  return Math.round(num * 10) / 10;
}

function sanitizeScaleMax(value: unknown, minScore: number, fallback = 10): number {
  const num = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= minScore || num > 1000) return fallback;
  return Math.round(num * 10) / 10;
}

function sanitizeRegularScore(
  value: unknown,
  minScore: number,
  passingScore: number,
  fallback: number | null = 6
): number | null {
  if (value === null || value === '' || value === false) return null;
  if (value === undefined) {
    return fallback !== null && fallback < passingScore && fallback >= minScore ? fallback : null;
  }
  const num = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(num) || num < minScore || num >= passingScore) return null;
  return Math.round(num * 10) / 10;
}

function resolveNormalizedGradeScale(raw: Partial<TerminologySettings>): GradeScaleSettings {
  const minScore = sanitizeScaleMin(raw.gradeScaleMin, DEFAULT_TERMINOLOGY_SETTINGS.gradeScaleMin);
  const maxScore = sanitizeScaleMax(
    raw.gradeScaleMax,
    minScore,
    Math.max(DEFAULT_TERMINOLOGY_SETTINGS.gradeScaleMax, minScore + 1)
  );
  const defaultPass = Math.min(maxScore, DEFAULT_TERMINOLOGY_SETTINGS.gradePassingScore);
  const passingScore = sanitizePassingScore(raw.gradePassingScore, defaultPass, maxScore);
  const regularScore = sanitizeRegularScore(
    raw.gradeRegularScore,
    minScore,
    passingScore,
    DEFAULT_TERMINOLOGY_SETTINGS.gradeRegularScore
  );
  return { minScore, maxScore, passingScore, regularScore };
}

export function getDerivedPeriodLabels(periodNameSingular: string) {
  const clean = sanitizeLabel(periodNameSingular, DEFAULT_TERMINOLOGY_SETTINGS.periodNameSingular);
  const firstChar = clean.charAt(0).toUpperCase() || 'C';
  return {
    periodNameSingular: clean,
    term1FullLabel: `1° ${clean}`,
    term2FullLabel: `2° ${clean}`,
    term1ShortLabel: `1°${firstChar}`,
    term2ShortLabel: `2°${firstChar}`,
  };
}

export function getTerminologySettings(): TerminologySettings {
  try {
    const key = getUserStorageKey(STORAGE_BASE_KEY);
    const saved = storageGateway.getJson<Partial<TerminologySettings> | null>(key, null);
    if (saved && typeof saved === 'object') {
      const scale = resolveNormalizedGradeScale(saved);
      return {
        attendanceLabel: sanitizeLabel(saved.attendanceLabel, DEFAULT_TERMINOLOGY_SETTINGS.attendanceLabel),
        dispositionLabel: sanitizeLabel(saved.dispositionLabel, DEFAULT_TERMINOLOGY_SETTINGS.dispositionLabel),
        periodNameSingular: sanitizeLabel(saved.periodNameSingular, DEFAULT_TERMINOLOGY_SETTINGS.periodNameSingular),
        initialDispositionScore: sanitizeInitialScore(
          saved.initialDispositionScore,
          DEFAULT_TERMINOLOGY_SETTINGS.initialDispositionScore
        ),
        intensificationLabel: sanitizeLabel(
          saved.intensificationLabel,
          DEFAULT_TERMINOLOGY_SETTINGS.intensificationLabel
        ),
        intensificationPassingScore: sanitizePassingScore(
          saved.intensificationPassingScore,
          scale.passingScore,
          scale.maxScore
        ),
        gradeScaleMin: scale.minScore,
        gradeScaleMax: scale.maxScore,
        gradePassingScore: scale.passingScore,
        gradeRegularScore: scale.regularScore,
      };
    }
  } catch (_) {}
  return { ...DEFAULT_TERMINOLOGY_SETTINGS };
}

export function getGeneralGradeScale(): GradeScaleSettings {
  const settings = getTerminologySettings();
  return {
    minScore: settings.gradeScaleMin,
    maxScore: settings.gradeScaleMax,
    passingScore: settings.gradePassingScore,
    regularScore: settings.gradeRegularScore,
  };
}

export function saveTerminologySettings(next: Partial<TerminologySettings>): TerminologySettings {
  const current = getTerminologySettings();
  const nextScaleInput: Partial<TerminologySettings> = {
    gradeScaleMin: next.gradeScaleMin !== undefined ? next.gradeScaleMin : current.gradeScaleMin,
    gradeScaleMax: next.gradeScaleMax !== undefined ? next.gradeScaleMax : current.gradeScaleMax,
    gradePassingScore:
      next.gradePassingScore !== undefined ? next.gradePassingScore : current.gradePassingScore,
    gradeRegularScore:
      next.gradeRegularScore !== undefined ? next.gradeRegularScore : current.gradeRegularScore,
  };
  const scale = resolveNormalizedGradeScale(nextScaleInput);

  const merged: TerminologySettings = {
    attendanceLabel:
      next.attendanceLabel !== undefined
        ? sanitizeLabel(next.attendanceLabel, DEFAULT_TERMINOLOGY_SETTINGS.attendanceLabel)
        : current.attendanceLabel,
    dispositionLabel:
      next.dispositionLabel !== undefined
        ? sanitizeLabel(next.dispositionLabel, DEFAULT_TERMINOLOGY_SETTINGS.dispositionLabel)
        : current.dispositionLabel,
    periodNameSingular:
      next.periodNameSingular !== undefined
        ? sanitizeLabel(next.periodNameSingular, DEFAULT_TERMINOLOGY_SETTINGS.periodNameSingular)
        : current.periodNameSingular,
    initialDispositionScore:
      next.initialDispositionScore !== undefined
        ? sanitizeInitialScore(next.initialDispositionScore, DEFAULT_TERMINOLOGY_SETTINGS.initialDispositionScore)
        : current.initialDispositionScore,
    intensificationLabel:
      next.intensificationLabel !== undefined
        ? sanitizeLabel(next.intensificationLabel, DEFAULT_TERMINOLOGY_SETTINGS.intensificationLabel)
        : current.intensificationLabel,
    intensificationPassingScore:
      next.intensificationPassingScore !== undefined
        ? sanitizePassingScore(next.intensificationPassingScore, scale.passingScore, scale.maxScore)
        : current.intensificationPassingScore,
    gradeScaleMin: scale.minScore,
    gradeScaleMax: scale.maxScore,
    gradePassingScore: scale.passingScore,
    gradeRegularScore: scale.regularScore,
  };

  try {
    const key = getUserStorageKey(STORAGE_BASE_KEY);
    storageGateway.setJson(key, merged);
  } catch (_) {}

  const uid = getActiveUserId();
  if (uid) {
    firestoreSync.saveUserSetting(uid, 'terminology_settings', merged).catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TERMINOLOGY_UPDATED_EVENT, { detail: merged }));
  }

  return merged;
}

const hydrationInFlightByUid = new Map<string, Promise<TerminologySettings>>();

export async function hydrateTerminologySettingsFromCloud(uid: string): Promise<TerminologySettings> {
  if (!uid) return getTerminologySettings();
  const existingPromise = hydrationInFlightByUid.get(uid);
  if (existingPromise) return existingPromise;

  const task = (async () => {
    try {
      const cloudVal = await firestoreSync.loadUserSetting(uid, 'terminology_settings');
      if (cloudVal && typeof cloudVal === 'object') {
        const scale = resolveNormalizedGradeScale(cloudVal as Partial<TerminologySettings>);
        const merged: TerminologySettings = {
          attendanceLabel: sanitizeLabel(
            (cloudVal as any).attendanceLabel,
            DEFAULT_TERMINOLOGY_SETTINGS.attendanceLabel
          ),
          dispositionLabel: sanitizeLabel(
            (cloudVal as any).dispositionLabel,
            DEFAULT_TERMINOLOGY_SETTINGS.dispositionLabel
          ),
          periodNameSingular: sanitizeLabel(
            (cloudVal as any).periodNameSingular,
            DEFAULT_TERMINOLOGY_SETTINGS.periodNameSingular
          ),
          initialDispositionScore: sanitizeInitialScore(
            (cloudVal as any).initialDispositionScore,
            DEFAULT_TERMINOLOGY_SETTINGS.initialDispositionScore
          ),
          intensificationLabel: sanitizeLabel(
            (cloudVal as any).intensificationLabel,
            DEFAULT_TERMINOLOGY_SETTINGS.intensificationLabel
          ),
          intensificationPassingScore: sanitizePassingScore(
            (cloudVal as any).intensificationPassingScore,
            scale.passingScore,
            scale.maxScore
          ),
          gradeScaleMin: scale.minScore,
          gradeScaleMax: scale.maxScore,
          gradePassingScore: scale.passingScore,
          gradeRegularScore: scale.regularScore,
        };
        const key = getUserStorageKey(STORAGE_BASE_KEY);
        storageGateway.setJson(key, merged);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(TERMINOLOGY_UPDATED_EVENT, { detail: merged }));
        }
        return merged;
      }
    } catch (_) {
    } finally {
      hydrationInFlightByUid.delete(uid);
    }
    return getTerminologySettings();
  })();

  hydrationInFlightByUid.set(uid, task);
  return task;
}

export function useTerminologySettings() {
  const [settings, setSettings] = useState<TerminologySettings>(() => getTerminologySettings());

  useEffect(() => {
    const refresh = () => {
      setSettings(getTerminologySettings());
    };

    const handleCustomUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<TerminologySettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      } else {
        refresh();
      }
    };

    window.addEventListener(TERMINOLOGY_UPDATED_EVENT, handleCustomUpdate);
    window.addEventListener('storage', refresh);

    const uid = getActiveUserId();
    if (uid) {
      hydrateTerminologySettingsFromCloud(uid).catch(() => {});
    }

    return () => {
      window.removeEventListener(TERMINOLOGY_UPDATED_EVENT, handleCustomUpdate);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const updateTerminology = useCallback((partial: Partial<TerminologySettings>) => {
    const updated = saveTerminologySettings(partial);
    setSettings(updated);
    return updated;
  }, []);

  const resetTerminology = useCallback(() => {
    const updated = saveTerminologySettings(DEFAULT_TERMINOLOGY_SETTINGS);
    setSettings(updated);
    return updated;
  }, []);

  const periodLabels = getDerivedPeriodLabels(settings.periodNameSingular);

  return {
    attendanceLabel: settings.attendanceLabel,
    dispositionLabel: settings.dispositionLabel,
    periodNameSingular: periodLabels.periodNameSingular,
    term1FullLabel: periodLabels.term1FullLabel,
    term2FullLabel: periodLabels.term2FullLabel,
    term1ShortLabel: periodLabels.term1ShortLabel,
    term2ShortLabel: periodLabels.term2ShortLabel,
    initialDispositionScore: settings.initialDispositionScore,
    intensificationLabel: settings.intensificationLabel,
    intensificationPassingScore: settings.intensificationPassingScore,
    gradeScaleMin: settings.gradeScaleMin,
    gradeScaleMax: settings.gradeScaleMax,
    gradePassingScore: settings.gradePassingScore,
    gradeRegularScore: settings.gradeRegularScore,
    generalGradeScale: {
      minScore: settings.gradeScaleMin,
      maxScore: settings.gradeScaleMax,
      passingScore: settings.gradePassingScore,
      regularScore: settings.gradeRegularScore,
    } as GradeScaleSettings,
    combinedTabLabel: `${settings.attendanceLabel} y ${settings.dispositionLabel}`,
    updateTerminology,
    resetTerminology,
  };
}
