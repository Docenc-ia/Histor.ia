import { useState, useEffect, useCallback } from 'react';
import { getUserStorageKey } from '../services/api';
import { storageGateway } from '../services/storageGateway';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';

export interface TerminologySettings {
  attendanceLabel: string;
  dispositionLabel: string;
  periodNameSingular: string;
  initialDispositionScore: number;
}

export const DEFAULT_TERMINOLOGY_SETTINGS: TerminologySettings = {
  attendanceLabel: 'Asistencia',
  dispositionLabel: 'Disposición',
  periodNameSingular: 'Cuatrimestre',
  initialDispositionScore: 10,
};

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

export const INITIAL_DISPOSITION_SCORE_PRESETS: number[] = [10, 9, 8, 7, 6, 5];

const STORAGE_BASE_KEY = 'docencia_terminology_settings';
const TERMINOLOGY_UPDATED_EVENT = 'docencia_terminology_updated';

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 42) : fallback;
}

function sanitizeInitialScore(value: unknown, fallback = 10): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  if (rounded < 1 || rounded > 10) return fallback;
  return rounded;
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
      return {
        attendanceLabel: sanitizeLabel(saved.attendanceLabel, DEFAULT_TERMINOLOGY_SETTINGS.attendanceLabel),
        dispositionLabel: sanitizeLabel(saved.dispositionLabel, DEFAULT_TERMINOLOGY_SETTINGS.dispositionLabel),
        periodNameSingular: sanitizeLabel(saved.periodNameSingular, DEFAULT_TERMINOLOGY_SETTINGS.periodNameSingular),
        initialDispositionScore: sanitizeInitialScore(
          saved.initialDispositionScore,
          DEFAULT_TERMINOLOGY_SETTINGS.initialDispositionScore
        ),
      };
    }
  } catch (_) {}
  return { ...DEFAULT_TERMINOLOGY_SETTINGS };
}

export function saveTerminologySettings(next: Partial<TerminologySettings>): TerminologySettings {
  const current = getTerminologySettings();
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
    combinedTabLabel: `${settings.attendanceLabel} y ${settings.dispositionLabel}`,
    updateTerminology,
    resetTerminology,
  };
}
