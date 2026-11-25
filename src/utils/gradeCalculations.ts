/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student } from '../types';
import {
  GradeCategory,
  GradeSubcategory,
  GradeEvaluationInstance,
  GradeIntensification,
  GradeScaleSettings,
  SubcategoryScaleMode,
  StudentGradesMap,
} from '../types/grades';
import { sanitizeSpreadsheetFormulaCell } from './htmlEscape';
import { getGeneralGradeScale } from './terminologySettings';

const MANUAL_FINAL_GRADE_KEY = '__final__';
const FINAL_AVERAGE_OVERRIDE_KEY = '__final_avg_override__';
const DEFAULT_DISPOSITION_LABEL = 'Disposición';
const MIN_CUSTOM_LABEL_MATCH_LENGTH = 3;
const ONE_DECIMAL_PRECISION = 1;
const PASSING_EXCELLENT_SCORE_THRESHOLD = 7;
export const INTENSIFICATION_EXEMPT_THRESHOLD = PASSING_EXCELLENT_SCORE_THRESHOLD;
export const INTENSIFICATION_EXEMPT_LABEL = '—';

export interface ResolvedSubcategoryScale {
  mode: SubcategoryScaleMode;
  minScore: number;
  maxScore: number;
  passingScore: number;
  regularScore: number | null;
  convertToGeneralOnAverage: boolean;
  isCustom: boolean;
  badgeText: string | null;
}

/**
 * Resuelve la escala efectiva de una evaluación/TP combinando su configuración propia
 * con la escala general configurada por el docente.
 */
export function resolveSubcategoryScale(
  subcategory?: GradeSubcategory | null,
  generalScaleOverride?: GradeScaleSettings
): ResolvedSubcategoryScale {
  const general = generalScaleOverride || getGeneralGradeScale();
  const mode: SubcategoryScaleMode = subcategory?.scaleMode || 'general';

  if (!subcategory || mode === 'general') {
    // Compatibilidad con subcategorías heredadas que tenían maxScore distinto a 10 sin scaleMode explícito
    const legacyCustomMax =
      subcategory &&
      typeof subcategory.maxScore === 'number' &&
      Number.isFinite(subcategory.maxScore) &&
      subcategory.maxScore > 0 &&
      subcategory.maxScore !== 10 &&
      subcategory.maxScore !== general.maxScore;

    if (!legacyCustomMax) {
      return {
        mode: 'general',
        minScore: general.minScore,
        maxScore: general.maxScore,
        passingScore: general.passingScore,
        regularScore: general.regularScore,
        convertToGeneralOnAverage: false,
        isCustom: false,
        badgeText: null,
      };
    }
  }

  if (mode === 'convert_100') {
    return {
      mode: 'convert_100',
      minScore: 0,
      maxScore: 100,
      passingScore: general.passingScore,
      regularScore: general.regularScore,
      convertToGeneralOnAverage: true,
      isCustom: true,
      badgeText: `/100→${general.maxScore}`,
    };
  }

  const rawMin =
    typeof subcategory?.minScore === 'number' && Number.isFinite(subcategory.minScore)
      ? subcategory.minScore
      : general.minScore;
  const rawMax =
    typeof subcategory?.maxScore === 'number' &&
    Number.isFinite(subcategory.maxScore) &&
    subcategory.maxScore > rawMin
      ? subcategory.maxScore
      : mode === 'sum_group'
      ? 5
      : general.maxScore;
  const proportionalDefaultPass =
    general.maxScore > 0
      ? Math.round(((rawMax * general.passingScore) / general.maxScore) * 10) / 10
      : general.passingScore;
  const rawPassing =
    typeof subcategory?.passingScore === 'number' &&
    Number.isFinite(subcategory.passingScore) &&
    subcategory.passingScore > 0 &&
    subcategory.passingScore <= rawMax
      ? subcategory.passingScore
      : proportionalDefaultPass;

  if (mode === 'sum_group') {
    return {
      mode: 'sum_group',
      minScore: rawMin,
      maxScore: rawMax,
      passingScore: rawPassing,
      regularScore: null,
      convertToGeneralOnAverage: false,
      isCustom: true,
      badgeText: `∑/${rawMax}`,
    };
  }

  // mode === 'custom' (o legacy custom max)
  const convertToGeneralOnAverage =
    subcategory?.convertToGeneralOnAverage !== undefined
      ? subcategory.convertToGeneralOnAverage
      : rawMax !== general.maxScore;

  const badgeText =
    rawMax !== general.maxScore
      ? `/${rawMax}`
      : rawPassing !== general.passingScore
      ? `≥${rawPassing}`
      : null;

  return {
    mode: 'custom',
    minScore: rawMin,
    maxScore: rawMax,
    passingScore: rawPassing,
    regularScore:
      rawMax === general.maxScore && rawPassing === general.passingScore
        ? general.regularScore
        : null,
    convertToGeneralOnAverage,
    isCustom: true,
    badgeText,
  };
}

/**
 * Resuelve la escala efectiva de una instancia adicional de una evaluación.
 * Si la instancia no define escala propia (o usa 'general'), hereda la escala de la evaluación padre.
 */
export function resolveInstanceScale(
  subcategory: GradeSubcategory,
  instance?: GradeEvaluationInstance | null,
  generalScaleOverride?: GradeScaleSettings
): ResolvedSubcategoryScale {
  if (!instance || !instance.scaleMode || instance.scaleMode === 'general') {
    return resolveSubcategoryScale(subcategory, generalScaleOverride);
  }
  return resolveSubcategoryScale(
    {
      id: instance.id,
      name: instance.name,
      minScore: instance.minScore,
      maxScore: instance.maxScore,
      passingScore: instance.passingScore,
      scaleMode: instance.scaleMode,
      convertToGeneralOnAverage: instance.convertToGeneralOnAverage,
    },
    generalScaleOverride
  );
}

/**
 * Convierte un valor ingresado en una columna de escala 0–100 a la escala general (por defecto sobre 10).
 * Convierte automáticamente valores > maxGeneral (ej. 85 -> 8.5, 100 -> 10) o formatos con "%" / "/100".
 * Si el valor ya está en la escala general (ej. 8.5) o no es numérico, devuelve `null` (sin modificar).
 */
export function convertScoreFrom100ToGeneral(
  rawValue: string,
  generalScaleOverride?: GradeScaleSettings
): string | null {
  const general = generalScaleOverride || getGeneralGradeScale();
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return null;

  const fracMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(?:\/|de|sobre)\s*100$/i);
  if (fracMatch) {
    const num = Number(fracMatch[1].replace(',', '.'));
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      const converted = (num / 100) * general.maxScore;
      return converted.toFixed(ONE_DECIMAL_PRECISION).replace(/\.0$/, '');
    }
  }

  const pctMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (pctMatch) {
    const num = Number(pctMatch[1].replace(',', '.'));
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      const converted = (num / 100) * general.maxScore;
      return converted.toFixed(ONE_DECIMAL_PRECISION).replace(/\.0$/, '');
    }
  }

  const parsed = parseGradeNumber(trimmed);
  if (parsed !== null && parsed > general.maxScore && parsed <= 100) {
    const converted = (parsed / 100) * general.maxScore;
    return converted.toFixed(ONE_DECIMAL_PRECISION).replace(/\.0$/, '');
  }

  return null;
}

/**
 * Divide un valor numérico de calificación por 10 (ej. 35 -> "3.5", 31.25 -> "3.13", 17.5 -> "1.75").
 * Si la celda está vacía o no contiene un número válido (ej. "—", "Aus"), devuelve `null`.
 */
export function divideScoreBy10(rawValue: string): string | null {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return null;
  const parsed = parseGradeNumber(trimmed);
  if (parsed === null) return null;
  const divided = Math.round((parsed / 10) * 100) / 100;
  return String(divided);
}

/**
 * Devuelve todas las subcategorías (con su categoría padre) que comparten un mismo `sumGroupId`.
 */
export function getSumGroupPeers(
  categories: GradeCategory[],
  sumGroupId?: string
): Array<{ category: GradeCategory; subcategory: GradeSubcategory }> {
  if (!sumGroupId || !Array.isArray(categories)) return [];
  const peers: Array<{ category: GradeCategory; subcategory: GradeSubcategory }> = [];
  for (const category of categories) {
    for (const subcategory of category.subcategories || []) {
      if (subcategory.scaleMode === 'sum_group' && subcategory.sumGroupId === sumGroupId) {
        peers.push({ category, subcategory });
      }
    }
  }
  return peers;
}

export function getIntensificationPassingThreshold(
  intensification?: GradeIntensification,
  subcategory?: GradeSubcategory
): number {
  const raw = intensification?.passingScore;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1000) {
    return raw;
  }
  if (subcategory) {
    if (hasCombinedSummaryColumn(subcategory)) {
      const combinedMeta = computeEvaluationInstancesCombinedScore(subcategory, undefined);
      if (combinedMeta && Number.isFinite(combinedMeta.passingScore) && combinedMeta.passingScore > 0) {
        return combinedMeta.passingScore;
      }
    }
    const resolved = resolveSubcategoryScale(subcategory);
    return resolved.passingScore;
  }
  return getGeneralGradeScale().passingScore;
}

export function isExemptMarkerValue(rawValue: unknown): boolean {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return false;
  return (
    trimmed === INTENSIFICATION_EXEMPT_LABEL ||
    trimmed === '-' ||
    trimmed.toUpperCase() === 'NI'
  );
}

/**
 * Normaliza una calificación textual o numérica (aceptando tanto coma como punto decimal)
 * a un número finito, o `null` si está vacía o no es numérica.
 */
export function parseGradeNumber(rawValue: unknown): number | null {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  const normalized = String(rawValue).trim().replace(',', '.');
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Devuelve la etiqueta corta de la primera subcolumna de una evaluación
 * (por ejemplo "Escrita", "1° Inst." si tiene instancias, o "Nota" si solo tiene intensificaciones).
 */
export function getPrimaryInstanceLabel(subcategory: GradeSubcategory): string {
  const custom = (subcategory.primaryInstanceName || '').trim();
  if (custom) return custom;
  if (Array.isArray(subcategory.instances) && subcategory.instances.length > 0) {
    return '1° Inst.';
  }
  return 'Nota';
}

/**
 * Genera el título legible de la instancia principal (para informes, desglose e importaciones).
 */
export function getPrimaryInstanceDisplayLabel(subcategory: GradeSubcategory): string {
  if (Array.isArray(subcategory.instances) && subcategory.instances.length > 0) {
    return `${subcategory.name} — ${getPrimaryInstanceLabel(subcategory)}`;
  }
  return subcategory.name;
}

/**
 * Genera el título legible de una instancia adicional (ej. "Parcial 1 — Oral").
 */
export function getEvaluationInstanceDisplayLabel(
  subcategory: GradeSubcategory,
  instance: GradeEvaluationInstance
): string {
  const custom = (instance.customTitle || '').trim();
  const instName = (instance.name || '').trim() || 'Instancia';
  if (custom) {
    if (custom.toLowerCase().includes(instName.toLowerCase())) {
      return custom;
    }
    return `${custom} — ${instName}`;
  }
  return `${subcategory.name} — ${instName}`;
}

/**
 * Genera el título legible de una instancia de intensificación/recuperación combinando el título
 * de la evaluación padre (o la especificación editada por el docente) y el nombre de la instancia.
 */
export function getIntensificationDisplayLabel(
  subcategory: GradeSubcategory,
  intensification: GradeIntensification
): string {
  const custom = (intensification.customTitle || '').trim();
  const instName = (intensification.name || '').trim() || 'Intensificación';
  if (custom) {
    if (custom.toLowerCase().includes(instName.toLowerCase())) {
      return custom;
    }
    return `${custom} — ${instName}`;
  }
  return `${subcategory.name} — ${instName}`;
}

/**
 * Indica si una evaluación con múltiples instancias debe mostrar una columna resumen
 * con el total sumado o el promedio de todas sus instancias.
 */
export function hasCombinedSummaryColumn(subcategory: GradeSubcategory): boolean {
  const evalInstances = Array.isArray(subcategory.instances) ? subcategory.instances : [];
  if (evalInstances.length === 0) return false;
  const combineMode = subcategory.instancesCombineMode || 'average';
  return combineMode === 'average' || combineMode === 'sum';
}

export interface CombinedInstancesSummary {
  mode: 'average' | 'sum';
  displayValue: string;
  numericValue: number | null;
  averageContribution: number | null;
  maxScore: number;
  passingScore: number;
  regularScore: number | null;
  filledCount: number;
  totalCount: number;
  breakdownText: string;
}

function formatCompactScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(ONE_DECIMAL_PRECISION).replace(/\.0$/, '');
}

function formatRawPartScore(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Calcula la nota resumida (sumada o promediada) de una evaluación con múltiples instancias
 * para mostrarla en su columna resumen y utilizarla en promedios/exenciones.
 */
export function computeEvaluationInstancesCombinedScore(
  subcategory: GradeSubcategory,
  studentGradeRecord: Record<string, string> | undefined,
  generalScaleOverride?: GradeScaleSettings
): CombinedInstancesSummary | null {
  if (!hasCombinedSummaryColumn(subcategory)) return null;

  const general = generalScaleOverride || getGeneralGradeScale();
  const grades = studentGradeRecord || {};
  const evalInstances = Array.isArray(subcategory.instances) ? subcategory.instances : [];
  const mode: 'average' | 'sum' =
    subcategory.instancesCombineMode === 'sum' ? 'sum' : 'average';
  const divideResultBy10 = Boolean(subcategory.combinedResultDivideBy10);

  const primaryScale = resolveSubcategoryScale(subcategory, general);
  const allInstancesMeta = [
    {
      id: subcategory.id,
      label: getPrimaryInstanceLabel(subcategory),
      scale: primaryScale,
      raw: parseGradeNumber(grades[subcategory.id]),
    },
    ...evalInstances.map((inst) => ({
      id: inst.id,
      label: (inst.name || '').trim() || 'Instancia',
      scale: resolveInstanceScale(subcategory, inst, general),
      raw: parseGradeNumber(grades[inst.id]),
    })),
  ];

  const filled = allInstancesMeta.filter(
    (item): item is typeof item & { raw: number } => item.raw !== null
  );
  const totalCount = allInstancesMeta.length;

  // Cuando el docente elige dividir el resultado final por 10 sin escalar cada instancia,
  // la escala destino del resultado es la escala general (o una escala propia <= general si la configuró).
  const useParentCustomTargetScale =
    primaryScale.mode === 'custom' &&
    primaryScale.maxScore > 0 &&
    primaryScale.maxScore <= general.maxScore;
  const targetMaxForDivide10 = useParentCustomTargetScale
    ? primaryScale.maxScore
    : general.maxScore;
  const targetPassingForDivide10 = useParentCustomTargetScale
    ? primaryScale.passingScore
    : general.passingScore;
  const targetRegularForDivide10 = useParentCustomTargetScale
    ? primaryScale.regularScore
    : general.regularScore;

  const anyCustomScale = allInstancesMeta.some(
    (item) => item.scale.mode === 'custom' || item.scale.mode === 'sum_group'
  );

  if (mode === 'sum') {
    if (divideResultBy10) {
      if (filled.length === 0) {
        return {
          mode: 'sum',
          displayValue: '',
          numericValue: null,
          averageContribution: null,
          maxScore: targetMaxForDivide10,
          passingScore: targetPassingForDivide10,
          regularScore: targetRegularForDivide10,
          filledCount: 0,
          totalCount,
          breakdownText: `Suma directa ÷ 10 de ${totalCount} instancias (${subcategory.name}) — Sin notas cargadas`,
        };
      }

      const rawSum = filled.reduce((acc, item) => acc + item.raw, 0);
      const dividedSum = rawSum / 10;
      const averageContribution =
        useParentCustomTargetScale &&
        primaryScale.convertToGeneralOnAverage &&
        targetMaxForDivide10 > 0 &&
        targetMaxForDivide10 !== general.maxScore
          ? (dividedSum / targetMaxForDivide10) * general.maxScore
          : dividedSum;
      const parts = filled
        .map((item) => `${item.label}: ${formatRawPartScore(item.raw)}`)
        .join(' + ');
      const displayValue = formatCompactScore(dividedSum);
      const equivNote =
        useParentCustomTargetScale &&
        primaryScale.convertToGeneralOnAverage &&
        targetMaxForDivide10 !== general.maxScore
          ? ` (equiv. ${formatCompactScore(averageContribution)} / ${general.maxScore} en promedio)`
          : '';

      return {
        mode: 'sum',
        displayValue,
        numericValue: dividedSum,
        averageContribution,
        maxScore: targetMaxForDivide10,
        passingScore: targetPassingForDivide10,
        regularScore: targetRegularForDivide10,
        filledCount: filled.length,
        totalCount,
        breakdownText: `${parts} = ${formatRawPartScore(rawSum)} ÷ 10 → ${displayValue} / ${targetMaxForDivide10}${equivNote}`,
      };
    }

    const totalCombinedMax = anyCustomScale
      ? allInstancesMeta.reduce(
          (acc, item) =>
            acc + (item.scale.mode === 'convert_100' ? general.maxScore : item.scale.maxScore),
          0
        )
      : general.maxScore;
    const combinedPassing =
      totalCombinedMax !== general.maxScore && general.maxScore > 0
        ? Math.round(((totalCombinedMax * general.passingScore) / general.maxScore) * 10) / 10
        : general.passingScore;
    const combinedRegular =
      general.regularScore !== null
        ? totalCombinedMax !== general.maxScore && general.maxScore > 0
          ? Math.round(((totalCombinedMax * general.regularScore) / general.maxScore) * 10) / 10
          : general.regularScore
        : null;

    if (filled.length === 0) {
      return {
        mode: 'sum',
        displayValue: '',
        numericValue: null,
        averageContribution: null,
        maxScore: totalCombinedMax,
        passingScore: combinedPassing,
        regularScore: combinedRegular,
        filledCount: 0,
        totalCount,
        breakdownText: `Suma de ${totalCount} instancias (${subcategory.name}) — Sin notas cargadas`,
      };
    }

    const rawSum = filled.reduce((acc, item) => acc + item.raw, 0);
    const averageContribution =
      anyCustomScale && totalCombinedMax > 0 && totalCombinedMax !== general.maxScore
        ? (rawSum / totalCombinedMax) * general.maxScore
        : rawSum;
    const parts = filled
      .map((item) => `${item.label}: ${formatRawPartScore(item.raw)}`)
      .join(' + ');
    const displayValue = formatCompactScore(rawSum);
    const equivNote =
      anyCustomScale && totalCombinedMax !== general.maxScore
        ? ` (equiv. ${formatCompactScore(averageContribution)} / ${general.maxScore} en promedio)`
        : '';

    return {
      mode: 'sum',
      displayValue,
      numericValue: rawSum,
      averageContribution,
      maxScore: totalCombinedMax,
      passingScore: combinedPassing,
      regularScore: combinedRegular,
      filledCount: filled.length,
      totalCount,
      breakdownText: `${parts} = ${displayValue}${equivNote}`,
    };
  }

  // mode === 'average'
  if (divideResultBy10) {
    if (filled.length === 0) {
      return {
        mode: 'average',
        displayValue: '',
        numericValue: null,
        averageContribution: null,
        maxScore: targetMaxForDivide10,
        passingScore: targetPassingForDivide10,
        regularScore: targetRegularForDivide10,
        filledCount: 0,
        totalCount,
        breakdownText: `Promedio ÷ 10 de ${totalCount} instancias (${subcategory.name}) — Sin notas cargadas`,
      };
    }

    const rawAvg = filled.reduce((acc, item) => acc + item.raw, 0) / filled.length;
    const dividedAvg = rawAvg / 10;
    const averageContribution =
      useParentCustomTargetScale &&
      primaryScale.convertToGeneralOnAverage &&
      targetMaxForDivide10 > 0 &&
      targetMaxForDivide10 !== general.maxScore
        ? (dividedAvg / targetMaxForDivide10) * general.maxScore
        : dividedAvg;
    const displayValue = formatCompactScore(dividedAvg);
    const parts = filled
      .map((item) => `${item.label}: ${formatRawPartScore(item.raw)}`)
      .join(', ');

    return {
      mode: 'average',
      displayValue,
      numericValue: dividedAvg,
      averageContribution,
      maxScore: targetMaxForDivide10,
      passingScore: targetPassingForDivide10,
      regularScore: targetRegularForDivide10,
      filledCount: filled.length,
      totalCount,
      breakdownText: `${parts} → Promedio: ${formatRawPartScore(rawAvg)} ÷ 10 = ${displayValue} / ${targetMaxForDivide10}`,
    };
  }

  const firstMax = primaryScale.maxScore;
  const allShareSameCustomScale =
    primaryScale.mode === 'custom' &&
    allInstancesMeta.every(
      (item) => item.scale.mode === 'custom' && item.scale.maxScore === firstMax
    );

  const displayMax = allShareSameCustomScale ? firstMax : general.maxScore;
  const displayPassing = allShareSameCustomScale
    ? primaryScale.passingScore
    : general.passingScore;
  const displayRegular = allShareSameCustomScale
    ? primaryScale.regularScore
    : general.regularScore;

  if (filled.length === 0) {
    return {
      mode: 'average',
      displayValue: '',
      numericValue: null,
      averageContribution: null,
      maxScore: displayMax,
      passingScore: displayPassing,
      regularScore: displayRegular,
      filledCount: 0,
      totalCount,
      breakdownText: `Promedio de ${totalCount} instancias (${subcategory.name}) — Sin notas cargadas`,
    };
  }

  const normalizedScores = filled.map((item) =>
    normalizeScoreWithResolvedScale(item.raw, item.scale, general)
  );
  const averageContribution =
    normalizedScores.reduce((acc, v) => acc + v, 0) / normalizedScores.length;
  const displayNumeric = allShareSameCustomScale
    ? filled.reduce((acc, item) => acc + item.raw, 0) / filled.length
    : averageContribution;
  const displayValue = formatCompactScore(displayNumeric);
  const parts = filled
    .map((item) => `${item.label}: ${formatRawPartScore(item.raw)}`)
    .join(', ');
  const equivNote =
    allShareSameCustomScale &&
    primaryScale.convertToGeneralOnAverage &&
    firstMax !== general.maxScore
      ? ` (equiv. ${formatCompactScore(averageContribution)} / ${general.maxScore} en promedio)`
      : '';

  return {
    mode: 'average',
    displayValue,
    numericValue: displayNumeric,
    averageContribution,
    maxScore: displayMax,
    passingScore: displayPassing,
    regularScore: displayRegular,
    filledCount: filled.length,
    totalCount,
    breakdownText: `${parts} → Promedio: ${displayValue}${equivNote}`,
  };
}

/**
 * Indica si `subcategory` es la última evaluación de un grupo de suma (`sum_group`) con al menos 2 evaluaciones vinculadas,
 * posición en la que se renderiza la columna resumen automática `Σ Suma`.
 */
export function isLastPeerOfSumGroup(
  categories: GradeCategory[],
  subcategory: GradeSubcategory
): boolean {
  if (subcategory.scaleMode !== 'sum_group' || !subcategory.sumGroupId) return false;
  const peers = getSumGroupPeers(categories, subcategory.sumGroupId);
  if (peers.length < 2) return false;
  return peers[peers.length - 1].subcategory.id === subcategory.id;
}

/**
 * Calcula la nota sumada de un grupo de evaluaciones vinculadas por `sumGroupId`
 * para mostrarla en su columna resumen automática.
 */
export function computeSumGroupCombinedScore(
  categories: GradeCategory[],
  sumGroupId: string,
  studentGradeRecord: Record<string, string> | undefined,
  generalScaleOverride?: GradeScaleSettings
): CombinedInstancesSummary | null {
  const peers = getSumGroupPeers(categories, sumGroupId);
  if (peers.length < 2) return null;

  const general = generalScaleOverride || getGeneralGradeScale();
  const grades = studentGradeRecord || {};

  const items: Array<{ label: string; maxScore: number; raw: number | null }> = [];
  peers.forEach(({ subcategory: peerSub }) => {
    const peerScale = resolveSubcategoryScale(peerSub, general);
    items.push({
      label: getPrimaryInstanceDisplayLabel(peerSub),
      maxScore: peerScale.maxScore,
      raw: parseGradeNumber(grades[peerSub.id]),
    });
    (peerSub.instances || []).forEach((peerInst) => {
      const instScale = resolveInstanceScale(peerSub, peerInst, general);
      items.push({
        label: getEvaluationInstanceDisplayLabel(peerSub, peerInst),
        maxScore: instScale.maxScore,
        raw: parseGradeNumber(grades[peerInst.id]),
      });
    });
  });

  const divideResultBy10 = peers.some(({ subcategory: peerSub }) =>
    Boolean(peerSub.combinedResultDivideBy10)
  );

  const totalGroupMax = items.reduce((acc, item) => acc + item.maxScore, 0);
  const passingScore = divideResultBy10
    ? general.passingScore
    : totalGroupMax !== general.maxScore && general.maxScore > 0
    ? Math.round(((totalGroupMax * general.passingScore) / general.maxScore) * 10) / 10
    : general.passingScore;
  const regularScore = divideResultBy10
    ? general.regularScore
    : general.regularScore !== null
    ? totalGroupMax !== general.maxScore && general.maxScore > 0
      ? Math.round(((totalGroupMax * general.regularScore) / general.maxScore) * 10) / 10
      : general.regularScore
    : null;

  const filled = items.filter((item): item is typeof item & { raw: number } => item.raw !== null);
  const peerLabels = peers.map((p) => p.subcategory.name).join(' + ');

  if (filled.length === 0) {
    return {
      mode: 'sum',
      displayValue: '',
      numericValue: null,
      averageContribution: null,
      maxScore: divideResultBy10 ? general.maxScore : totalGroupMax,
      passingScore,
      regularScore,
      filledCount: 0,
      totalCount: items.length,
      breakdownText: divideResultBy10
        ? `Suma directa ÷ 10 de ${peerLabels} — Sin notas cargadas`
        : `Suma de ${peerLabels} (sobre ${totalGroupMax}) — Sin notas cargadas`,
    };
  }

  const rawSum = filled.reduce((acc, item) => acc + item.raw, 0);
  const parts = filled
    .map((item) => `${item.label}: ${formatRawPartScore(item.raw)}`)
    .join(' + ');

  if (divideResultBy10) {
    const dividedSum = rawSum / 10;
    const displayValue = formatCompactScore(dividedSum);
    return {
      mode: 'sum',
      displayValue,
      numericValue: dividedSum,
      averageContribution: dividedSum,
      maxScore: general.maxScore,
      passingScore,
      regularScore,
      filledCount: filled.length,
      totalCount: items.length,
      breakdownText: `${parts} = ${formatRawPartScore(rawSum)} ÷ 10 → ${displayValue} / ${general.maxScore}`,
    };
  }

  const averageContribution =
    totalGroupMax > 0 && totalGroupMax !== general.maxScore
      ? (rawSum / totalGroupMax) * general.maxScore
      : rawSum;
  const displayValue = formatCompactScore(rawSum);
  const equivNote =
    totalGroupMax !== general.maxScore
      ? ` (equiv. ${formatCompactScore(averageContribution)} / ${general.maxScore} en promedio)`
      : '';

  return {
    mode: 'sum',
    displayValue,
    numericValue: rawSum,
    averageContribution,
    maxScore: totalGroupMax,
    passingScore,
    regularScore,
    filledCount: filled.length,
    totalCount: items.length,
    breakdownText: `${parts} = ${displayValue} / ${totalGroupMax}${equivNote}`,
  };
}

/**
 * Calcula la nota efectiva de una evaluación considerando sus instancias (si las tiene)
 * para evaluar si un estudiante ya alcanzó el umbral de exención en una intensificación.
 */
function getEvaluationScoreForIntensificationCheck(
  subcategory: GradeSubcategory,
  grades: Record<string, string>
): number | null {
  const evalInstances = Array.isArray(subcategory.instances) ? subcategory.instances : [];
  if (evalInstances.length === 0) {
    const rawScore = parseGradeNumber(grades[subcategory.id]);
    if (rawScore === null) return null;
    if (subcategory.scaleMode === 'convert_100') {
      return normalizeSubcategoryScoreForAverage(rawScore, subcategory);
    }
    return rawScore;
  }

  const combined = computeEvaluationInstancesCombinedScore(subcategory, grades);
  if (combined) {
    return combined.numericValue;
  }

  // 'separate': promedio de las instancias cargadas como referencia
  const values: number[] = [];
  const primary = parseGradeNumber(grades[subcategory.id]);
  if (primary !== null) values.push(primary);
  for (const inst of evalInstances) {
    const val = parseGradeNumber(grades[inst.id]);
    if (val !== null) values.push(val);
  }
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Determina si un estudiante ya alcanzó la nota mínima configurada para la instancia de
 * intensificación `instIndex` (en la evaluación original o en una instancia previa).
 * En ese caso corresponde mostrar una línea (`—`) por defecto, editable si el docente decide evaluarlo igual.
 */
export function isStudentExemptFromIntensification(
  subcategory: GradeSubcategory,
  instIndex: number,
  studentGrades: Record<string, string> | undefined
): { exempt: boolean; passingScore: number | null; threshold: number } {
  const grades = studentGrades || {};
  const instList = Array.isArray(subcategory.intensifications)
    ? subcategory.intensifications
    : [];
  const targetInst = instList[instIndex];
  const threshold = getIntensificationPassingThreshold(targetInst, subcategory);

  const originalScore = getEvaluationScoreForIntensificationCheck(subcategory, grades);
  if (originalScore !== null && originalScore >= threshold) {
    return {
      exempt: true,
      passingScore: Math.round(originalScore * 10) / 10,
      threshold,
    };
  }

  for (let i = 0; i < instIndex && i < instList.length; i++) {
    const prevScore = parseGradeNumber(grades[instList[i].id]);
    if (prevScore !== null && prevScore >= threshold) {
      return { exempt: true, passingScore: prevScore, threshold };
    }
  }

  return { exempt: false, passingScore: null, threshold };
}

/**
 * Devuelve el valor visible efectivo de una celda de intensificación para un estudiante:
 * si el docente cargó explícitamente una calificación, esa nota prevalece sobre la línea por defecto;
 * si la celda está vacía y el estudiante ya aprobó con >= nota mínima, muestra `'—'` por defecto.
 */
export function getEffectiveIntensificationCell(
  subcategory: GradeSubcategory,
  instIndex: number,
  studentGrades: Record<string, string> | undefined
): {
  value: string;
  isExempt: boolean;
  isDefaultExempt: boolean;
  passingScore: number | null;
  threshold: number;
} {
  const inst = subcategory.intensifications?.[instIndex];
  const raw = inst ? studentGrades?.[inst.id] ?? '' : '';
  const trimmed = String(raw).trim();
  const check = isStudentExemptFromIntensification(subcategory, instIndex, studentGrades);

  if (trimmed !== '') {
    if (isExemptMarkerValue(trimmed)) {
      return {
        value: INTENSIFICATION_EXEMPT_LABEL,
        isExempt: true,
        isDefaultExempt: check.exempt,
        passingScore: check.passingScore,
        threshold: check.threshold,
      };
    }
    return {
      value: raw,
      isExempt: false,
      isDefaultExempt: false,
      passingScore: check.passingScore,
      threshold: check.threshold,
    };
  }

  if (check.exempt) {
    return {
      value: INTENSIFICATION_EXEMPT_LABEL,
      isExempt: true,
      isDefaultExempt: true,
      passingScore: check.passingScore,
      threshold: check.threshold,
    };
  }

  return {
    value: '',
    isExempt: false,
    isDefaultExempt: false,
    passingScore: null,
    threshold: check.threshold,
  };
}

/**
 * Busca una columna calificable por ID dentro de todas las categorías, subcategorías,
 * sus instancias evaluativas y sus instancias de intensificación/recuperación.
 */
export function findGradeColumnById(
  categories: GradeCategory[],
  columnId: string
): {
  category: GradeCategory;
  subcategory?: GradeSubcategory;
  evaluationInstance?: GradeEvaluationInstance;
  evaluationInstanceIndex?: number;
  intensification?: GradeIntensification;
  intensificationIndex?: number;
  displayLabel: string;
} | null {
  if (!columnId || !Array.isArray(categories)) return null;
  for (const category of categories) {
    if (category.id === columnId && category.subcategories.length === 0) {
      return { category, displayLabel: category.name };
    }
    for (const subcategory of category.subcategories || []) {
      if (subcategory.id === columnId) {
        return {
          category,
          subcategory,
          displayLabel: getPrimaryInstanceDisplayLabel(subcategory),
        };
      }
      const evalInstances = subcategory.instances || [];
      for (let i = 0; i < evalInstances.length; i++) {
        if (evalInstances[i].id === columnId) {
          return {
            category,
            subcategory,
            evaluationInstance: evalInstances[i],
            evaluationInstanceIndex: i,
            displayLabel: getEvaluationInstanceDisplayLabel(subcategory, evalInstances[i]),
          };
        }
      }
      const instList = subcategory.intensifications || [];
      for (let i = 0; i < instList.length; i++) {
        if (instList[i].id === columnId) {
          return {
            category,
            subcategory,
            intensification: instList[i],
            intensificationIndex: i,
            displayLabel: getIntensificationDisplayLabel(subcategory, instList[i]),
          };
        }
      }
    }
  }
  return null;
}

export type AnnualConditionTone = 'approved' | 'regular' | 'compensation' | 'pending';

export interface StudentAnnualSummaryRow {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  calcAvgStr: string;
  calcAvgNum: number | null;
  finalVal: string;
  finalNum: number | null;
  hasOverride: boolean;
  condition: string;
  conditionTone: AnnualConditionTone;
}

export interface AnnualCourseKpis {
  total: number;
  with1cCount: number;
  with2cCount: number;
  avg1c: string;
  avg2c: string;
  avgFinal: string;
  approvedCount: number;
  approvedPercent: number;
}

export const CATEGORY_COLORS = [
  {
    name: 'Azul',
    border: 'border-blue-500',
    headerBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
    badge: 'bg-blue-500',
  },
  {
    name: 'Esmeralda',
    border: 'border-emerald-500',
    headerBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40',
    badge: 'bg-emerald-500',
  },
  {
    name: 'Púrpura',
    border: 'border-purple-500',
    headerBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
    badge: 'bg-purple-500',
  },
  {
    name: 'Ámbar',
    border: 'border-amber-500',
    headerBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40',
    badge: 'bg-amber-500',
  },
  {
    name: 'Índigo',
    border: 'border-indigo-500',
    headerBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40',
    badge: 'bg-indigo-500',
  },
  {
    name: 'Rosa',
    border: 'border-rose-500',
    headerBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:bg-rose-950/40',
    badge: 'bg-rose-500',
  },
];

/**
 * Normaliza un valor numérico según una escala resuelta hacia la escala general.
 */
export function normalizeScoreWithResolvedScale(
  rawScore: number,
  resolved: ResolvedSubcategoryScale,
  generalScaleOverride?: GradeScaleSettings
): number {
  const general = generalScaleOverride || getGeneralGradeScale();
  if (resolved.mode === 'convert_100') {
    if (rawScore > general.maxScore) {
      return (rawScore / 100) * general.maxScore;
    }
    return rawScore;
  }

  if (
    resolved.mode === 'custom' &&
    resolved.convertToGeneralOnAverage &&
    resolved.maxScore > 0 &&
    resolved.maxScore !== general.maxScore
  ) {
    return (rawScore / resolved.maxScore) * general.maxScore;
  }

  return rawScore;
}

/**
 * Normaliza el puntaje de una subcategoría hacia la escala general del curso
 * para incorporarlo en promedios, teniendo en cuenta escalas personalizadas y sobre 100.
 */
export function normalizeSubcategoryScoreForAverage(
  rawScore: number,
  subcategory: GradeSubcategory,
  generalScaleOverride?: GradeScaleSettings
): number {
  const general = generalScaleOverride || getGeneralGradeScale();
  const resolved = resolveSubcategoryScale(subcategory, general);
  return normalizeScoreWithResolvedScale(rawScore, resolved, general);
}

/**
 * Calcula los valores numéricos (en escala general) aportados por una subcategoría al promedio,
 * combinando sus instancias evaluativas según `instancesCombineMode` ('average' | 'sum' | 'separate').
 */
export function computeSubcategoryAverageContributions(
  subcategory: GradeSubcategory,
  studentGradeRecord: Record<string, string>,
  generalScaleOverride?: GradeScaleSettings
): number[] {
  const general = generalScaleOverride || getGeneralGradeScale();
  const evalInstances = Array.isArray(subcategory.instances) ? subcategory.instances : [];

  if (evalInstances.length === 0) {
    const parsedSub = parseGradeNumber(studentGradeRecord[subcategory.id]);
    if (parsedSub === null) return [];
    return [normalizeSubcategoryScoreForAverage(parsedSub, subcategory, general)];
  }

  const combineMode = subcategory.instancesCombineMode || 'average';
  if (combineMode === 'sum' || combineMode === 'average') {
    const combined = computeEvaluationInstancesCombinedScore(
      subcategory,
      studentGradeRecord,
      general
    );
    if (!combined || combined.averageContribution === null) return [];
    return [combined.averageContribution];
  }

  const primaryScale = resolveSubcategoryScale(subcategory, general);
  const entries: Array<{ raw: number; scale: ResolvedSubcategoryScale }> = [];

  const parsedPrimary = parseGradeNumber(studentGradeRecord[subcategory.id]);
  if (parsedPrimary !== null) {
    entries.push({ raw: parsedPrimary, scale: primaryScale });
  }

  evalInstances.forEach((inst) => {
    const parsedInst = parseGradeNumber(studentGradeRecord[inst.id]);
    if (parsedInst !== null) {
      entries.push({
        raw: parsedInst,
        scale: resolveInstanceScale(subcategory, inst, general),
      });
    }
  });

  if (entries.length === 0) return [];

  // 'separate': cada instancia aporta su propia nota normalizada al promedio
  return entries.map((e) => normalizeScoreWithResolvedScale(e.raw, e.scale, general));
}

/**
 * Obtiene la lista de valores numéricos (en escala general) que componen el promedio de un estudiante,
 * consolidando grupos de suma (`sum_group`) e instancias evaluativas en notas combinadas y respetando escalas propias.
 */
export function computeStudentTermAverageItems(
  termCategories: GradeCategory[],
  studentGradeRecord: Record<string, string>,
  generalScaleOverride?: GradeScaleSettings
): number[] {
  const general = generalScaleOverride || getGeneralGradeScale();
  const numericScores: number[] = [];
  const processedSumGroups = new Set<string>();

  termCategories.forEach((category) => {
    if (category.subcategories.length === 0) {
      const parsedDirect = parseGradeNumber(studentGradeRecord[category.id]);
      if (parsedDirect !== null) {
        numericScores.push(parsedDirect);
      }
      return;
    }

    category.subcategories.forEach((subcategory) => {
      if (subcategory.scaleMode === 'sum_group' && subcategory.sumGroupId) {
        const peers = getSumGroupPeers(termCategories, subcategory.sumGroupId);
        if (peers.length >= 2) {
          if (processedSumGroups.has(subcategory.sumGroupId)) return;
          processedSumGroups.add(subcategory.sumGroupId);

          const groupSummary = computeSumGroupCombinedScore(
            termCategories,
            subcategory.sumGroupId,
            studentGradeRecord,
            general
          );
          if (groupSummary && groupSummary.averageContribution !== null) {
            numericScores.push(groupSummary.averageContribution);
          }
          return;
        }
      }

      const contributions = computeSubcategoryAverageContributions(
        subcategory,
        studentGradeRecord,
        general
      );
      numericScores.push(...contributions);
      // Las notas de intensificación/recuperación quedan fuera de los promedios automáticos.
    });
  });

  return numericScores;
}

/**
 * Calcula el promedio aritmético de todas las calificaciones registradas para un estudiante en el cuatrimestre.
 * Respeta escalas personalizadas, conversiones sobre 100 y evaluaciones vinculadas por suma.
 *
 * @param termCategories Categorías y subcategorías configuradas en el cuatrimestre.
 * @param termGrades Mapa de notas de los estudiantes en el cuatrimestre.
 * @param studentId Identificador del estudiante a evaluar.
 * @returns El promedio formateado (`scoreStr`) y su valor numérico exacto (`num`), o `{ scoreStr: '', num: null }` si no registra notas.
 */
export function calculateCategoryAverageForStudent(
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  studentId: string
): { scoreStr: string; num: number | null } {
  const studentGradeRecord = termGrades[studentId] || {};
  const numericScores = computeStudentTermAverageItems(termCategories, studentGradeRecord);

  if (numericScores.length === 0) return { scoreStr: '', num: null };
  const averageValue =
    numericScores.reduce((accumulator, currentScore) => accumulator + currentScore, 0) /
    numericScores.length;
  return {
    scoreStr: averageValue.toFixed(ONE_DECIMAL_PRECISION).replace('.0', ''),
    num: averageValue,
  };
}

/**
 * Determina la calificación final del cuatrimestre para un estudiante según el modo de cierre configurado
 * (`'average_of_categories'` o `'manual_final'`), respetando las sobrescrituras manuales puntuales del docente.
 *
 * @param termCategories Categorías de evaluación del cuatrimestre.
 * @param termGrades Mapa de calificaciones del cuatrimestre.
 * @param termCalculationMode Criterio de cálculo de nota final para el cuatrimestre.
 * @param studentId Identificador del estudiante.
 * @returns La calificación final en formato texto (`scoreStr`) y número (`num`).
 */
export function calculateFinalScoreForStudent(
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalculationMode: 'average_of_categories' | 'manual_final',
  studentId: string
): { scoreStr: string; num: number | null } {
  const studentGradeRecord = termGrades[studentId] || {};
  if (termCalculationMode === 'manual_final') {
    const manualFinalString = studentGradeRecord[MANUAL_FINAL_GRADE_KEY] || '';
    const manualFinalNumber = parseGradeNumber(manualFinalString);
    return { scoreStr: manualFinalString, num: manualFinalNumber };
  }

  // En modo promedio automático, se prioriza `__final_avg_override__` si el docente redondeó o ajustó manualmente la nota conceptual de ese alumno en particular.
  const averageOverrideString =
    studentGradeRecord[FINAL_AVERAGE_OVERRIDE_KEY] !== undefined
      ? String(studentGradeRecord[FINAL_AVERAGE_OVERRIDE_KEY]).trim()
      : '';
  if (averageOverrideString !== '') {
    const overrideNumber = parseGradeNumber(averageOverrideString);
    return { scoreStr: averageOverrideString, num: overrideNumber };
  }

  return calculateCategoryAverageForStudent(termCategories, termGrades, studentId);
}

/**
 * Localiza el identificador de la columna (subcategoría o categoría directa) que representa la nota de Disposición/Concepto,
 * permitiendo sincronizar automáticamente los descuentos por incidencias o faltas con la planilla de calificaciones.
 *
 * @param categories Categorías activas del cuatrimestre.
 * @param customDispositionLabel Etiqueta personalizada opcional configurada por el docente para la columna de disposición.
 * @returns El ID de la subcategoría o categoría encontrada, o `null` si el curso no posee una columna de disposición.
 */
export function findDispositionColumnKey(
  categories: GradeCategory[],
  customDispositionLabel?: string
): string | null {
  const normalizedTargetLabel = (customDispositionLabel || DEFAULT_DISPOSITION_LABEL)
    .trim()
    .toLowerCase();
  const matchesDispositionKeyword = (candidateName: string) => {
    const normalizedCandidate = (candidateName || '').trim().toLowerCase();
    return (
      normalizedCandidate === normalizedTargetLabel ||
      normalizedCandidate.includes('disposición') ||
      normalizedCandidate.includes('disposicion') ||
      normalizedCandidate.includes('conducta') ||
      normalizedCandidate.includes('concepto') ||
      (normalizedTargetLabel.length >= MIN_CUSTOM_LABEL_MATCH_LENGTH &&
        normalizedCandidate.includes(normalizedTargetLabel))
    );
  };

  for (const category of categories) {
    const matchingSubcategory = category.subcategories.find((subcategory) =>
      matchesDispositionKeyword(subcategory.name)
    );
    if (matchingSubcategory) {
      return matchingSubcategory.id;
    }
  }

  const matchingCategory = categories.find((category) => matchesDispositionKeyword(category.name));
  if (matchingCategory) {
    if (matchingCategory.subcategories.length === 0) {
      return matchingCategory.id;
    }
    if (matchingCategory.subcategories.length === 1) {
      return matchingCategory.subcategories[0].id;
    }
  }

  return null;
}

/**
 * Calcula en lote el mapa de calificaciones finales de todos los estudiantes de un curso para un cuatrimestre.
 *
 * @param students Lista de estudiantes del curso.
 * @param termCategories Categorías del cuatrimestre.
 * @param termGrades Mapa de calificaciones del cuatrimestre.
 * @param termCalculationMode Modo de cálculo final (`'average_of_categories'` o `'manual_final'`).
 * @returns Diccionario indexado por `studentId` con la nota final formateada y numérica.
 */
export function computeTermScoresMap(
  students: Student[],
  termCategories: GradeCategory[],
  termGrades: StudentGradesMap,
  termCalculationMode: 'average_of_categories' | 'manual_final'
): Record<string, { scoreStr: string; num: number | null }> {
  const finalScoresByStudentId: Record<string, { scoreStr: string; num: number | null }> = {};
  students.forEach((student) => {
    finalScoresByStudentId[student.id] = calculateFinalScoreForStudent(
      termCategories,
      termGrades,
      termCalculationMode,
      student.id
    );
  });
  return finalScoresByStudentId;
}

/**
 * Devuelve las clases utilitarias de color de Tailwind CSS según el tramo pedagógico de la nota
 * utilizando la escala general configurada o una escala particular por columna (`scaleOverride`).
 */
export function getScoreColorClass(
  scoreValueString: string,
  isDarkMode: boolean,
  scaleOverride?: Pick<ResolvedSubcategoryScale, 'mode' | 'maxScore' | 'passingScore' | 'regularScore'>
): string {
  if (isExemptMarkerValue(scoreValueString)) {
    return isDarkMode ? 'text-slate-400 font-bold' : 'text-slate-500 font-bold';
  }
  const numericScore = parseGradeNumber(scoreValueString);
  if (numericScore === null) {
    return isDarkMode ? 'text-slate-200' : 'text-neutral-800';
  }

  const general = getGeneralGradeScale();
  const passing = scaleOverride ? scaleOverride.passingScore : general.passingScore;
  const regular = scaleOverride ? scaleOverride.regularScore : general.regularScore;

  let comparableScore = numericScore;
  if (scaleOverride?.mode === 'convert_100' && numericScore > general.maxScore && numericScore <= 100) {
    comparableScore = (numericScore / 100) * general.maxScore;
  }

  if (comparableScore >= passing) {
    return 'text-emerald-600 dark:text-emerald-400 font-bold';
  }
  if (regular !== null && regular < passing && comparableScore >= regular) {
    return 'text-amber-600 dark:text-amber-400 font-semibold';
  }
  return 'text-red-600 dark:text-red-400 font-bold';
}

/**
 * Calcula de forma pura la consolidación anual de calificaciones por estudiante (1°C, 2°C, promedio sugerido,
 * calificación definitiva con prioridad de sobrescritura manual y condición pedagógica resultante),
 * completamente desacoplada del tema visual (`isDarkMode`) y del DOM.
 *
 * @param students Lista de estudiantes del curso.
 * @param score1cMap Mapa de calificaciones finales del 1° cuatrimestre.
 * @param score2cMap Mapa de calificaciones finales del 2° cuatrimestre.
 * @param annualOverrides Mapa de notas definitivas ajustadas manualmente por el docente.
 * @returns Arreglo de filas anuales consolidadas por estudiante.
 */
export function computeStudentAnnualSummaryRows(
  students: Student[],
  score1cMap: Record<string, { scoreStr: string; num: number | null }>,
  score2cMap: Record<string, { scoreStr: string; num: number | null }>,
  annualOverrides: Record<string, string>
): StudentAnnualSummaryRow[] {
  return students.map((student) => {
    const term1Score = score1cMap[student.id] || { scoreStr: '', num: null };
    const term2Score = score2cMap[student.id] || { scoreStr: '', num: null };
    const manualOverride = annualOverrides[student.id];

    let calcAvgStr = '';
    let calcAvgNum: number | null = null;

    if (term1Score.num !== null && term2Score.num !== null) {
      calcAvgNum = (term1Score.num + term2Score.num) / 2;
      calcAvgStr = calcAvgNum.toFixed(ONE_DECIMAL_PRECISION).replace('.0', '');
    } else if (term1Score.num !== null) {
      calcAvgNum = term1Score.num;
      calcAvgStr = term1Score.scoreStr;
    } else if (term2Score.num !== null) {
      calcAvgNum = term2Score.num;
      calcAvgStr = term2Score.scoreStr;
    }

    const hasOverride = manualOverride !== undefined && manualOverride !== '';
    const finalVal = hasOverride ? manualOverride : calcAvgStr;
    const finalNum = parseGradeNumber(finalVal);

    const generalScale = getGeneralGradeScale();
    let condition = 'Pendiente';
    let conditionTone: AnnualConditionTone = 'pending';

    if (finalNum !== null) {
      if (finalNum >= generalScale.passingScore) {
        condition = 'Aprobado';
        conditionTone = 'approved';
      } else if (
        generalScale.regularScore !== null &&
        generalScale.regularScore < generalScale.passingScore &&
        finalNum >= generalScale.regularScore
      ) {
        condition = 'Aprobado (Regular)';
        conditionTone = 'regular';
      } else {
        condition = 'Compensación Diciembre / Feb';
        conditionTone = 'compensation';
      }
    }

    return {
      student,
      score1c: term1Score.scoreStr,
      score1cNum: term1Score.num,
      score2c: term2Score.scoreStr,
      score2cNum: term2Score.num,
      calcAvgStr,
      calcAvgNum,
      finalVal,
      finalNum,
      hasOverride,
      condition,
      conditionTone,
    };
  });
}

/**
 * Traduce el tono semántico de condición anual (`AnnualConditionTone`) a sus clases de insignia en Tailwind CSS.
 *
 * @param conditionTone Tono pedagógico calculado para el estudiante.
 * @param isDarkMode Indicador de modo oscuro activo.
 * @returns Clases CSS para la insignia de condición anual.
 */
export function getAnnualConditionBadgeClass(
  conditionTone: AnnualConditionTone,
  isDarkMode: boolean
): string {
  if (conditionTone === 'approved') {
    return isDarkMode
      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (conditionTone === 'regular') {
    return isDarkMode
      ? 'bg-amber-950/60 text-amber-300 border-amber-800/80'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (conditionTone === 'compensation') {
    return isDarkMode
      ? 'bg-rose-950/60 text-rose-300 border-rose-800/80'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  }
  return isDarkMode
    ? 'bg-slate-800 text-slate-400 border-slate-700'
    : 'bg-neutral-100 text-neutral-500 border-neutral-200';
}

/**
 * Calcula los indicadores clave de rendimiento (KPIs) anuales del curso a partir de las filas consolidadas.
 *
 * @param totalStudents Cantidad total de estudiantes en el curso.
 * @param studentAnnualRows Filas anuales calculadas por `computeStudentAnnualSummaryRows`.
 * @returns Objeto con promedios por cuatrimestre, promedio final y tasa de aprobación.
 */
export function computeAnnualCourseKpis(
  totalStudents: number,
  studentAnnualRows: StudentAnnualSummaryRow[]
): AnnualCourseKpis {
  const with1c = studentAnnualRows.filter((row) => row.score1cNum !== null);
  const with2c = studentAnnualRows.filter((row) => row.score2cNum !== null);
  const withFinal = studentAnnualRows.filter((row) => row.finalNum !== null);
  const generalScale = getGeneralGradeScale();
  const minApprovedForKpi =
    generalScale.regularScore !== null && generalScale.regularScore < generalScale.passingScore
      ? generalScale.regularScore
      : generalScale.passingScore;
  const approved = studentAnnualRows.filter(
    (row) => row.finalNum !== null && row.finalNum >= minApprovedForKpi
  );

  const avg1c =
    with1c.length > 0
      ? (
          with1c.reduce((sum, row) => sum + (row.score1cNum || 0), 0) / with1c.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  const avg2c =
    with2c.length > 0
      ? (
          with2c.reduce((sum, row) => sum + (row.score2cNum || 0), 0) / with2c.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  const avgFinal =
    withFinal.length > 0
      ? (
          withFinal.reduce((sum, row) => sum + (row.finalNum || 0), 0) / withFinal.length
        ).toFixed(ONE_DECIMAL_PRECISION)
      : '—';

  return {
    total: totalStudents,
    with1cCount: with1c.length,
    with2cCount: with2c.length,
    avg1c,
    avg2c,
    avgFinal,
    approvedCount: approved.length,
    approvedPercent:
      totalStudents > 0 ? Math.round((approved.length / totalStudents) * 100) : 0,
  };
}

/**
 * Filtra de manera pura las filas del resumen anual según texto de búsqueda (apellido, nombre o correo).
 *
 * @param studentAnnualRows Filas anuales calculadas.
 * @param searchQuery Consulta de búsqueda ingresada por el docente.
 * @returns Filas que coinciden con el filtro.
 */
export function filterAnnualSummaryRows(
  studentAnnualRows: StudentAnnualSummaryRow[],
  searchQuery: string
): StudentAnnualSummaryRow[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return studentAnnualRows;

  return studentAnnualRows.filter(
    (row) =>
      row.student.lastName.toLowerCase().includes(normalizedQuery) ||
      row.student.firstName.toLowerCase().includes(normalizedQuery) ||
      (row.student.email && row.student.email.toLowerCase().includes(normalizedQuery))
  );
}

/**
 * Genera de forma pura el contenido CSV del cierre anual de calificaciones, aplicando sanitización
 * preventiva contra inyección de fórmulas en hojas de cálculo.
 *
 * @param studentAnnualRows Filas anuales consolidadas del curso.
 * @returns Cadena CSV sin prefijo `data:` lista para codificar o almacenar en Google Drive.
 */
export function buildAnnualSummaryCsvContent(
  studentAnnualRows: StudentAnnualSummaryRow[]
): string {
  let csv =
    'Apellido y Nombre,1° Cuatrimestre,2° Cuatrimestre,Promedio Anual Sugerido,Calificación Final Definitiva,Condición\r\n';

  studentAnnualRows.forEach((row) => {
    const safeFullName = sanitizeSpreadsheetFormulaCell(
      `${row.student.lastName}, ${row.student.firstName}`
    ).replace(/"/g, '""');
    const name = `"${safeFullName}"`;
    const s1 = `"${sanitizeSpreadsheetFormulaCell(row.score1c || '').replace(/"/g, '""')}"`;
    const s2 = `"${sanitizeSpreadsheetFormulaCell(row.score2c || '').replace(/"/g, '""')}"`;
    const avg = `"${sanitizeSpreadsheetFormulaCell(row.calcAvgStr || '').replace(/"/g, '""')}"`;
    const fin = `"${sanitizeSpreadsheetFormulaCell(row.finalVal || '').replace(/"/g, '""')}"`;
    const cond = `"${sanitizeSpreadsheetFormulaCell(row.condition).replace(/"/g, '""')}"`;
    csv += [name, s1, s2, avg, fin, cond].join(',') + '\r\n';
  });

  return csv;
}

/**
 * Reordena de forma pura e inmutable la lista de Categorías Mayores (y sus respectivas subcolumnas)
 * moviendo la categoría desde `fromIndex` hacia `toIndex`.
 */
export function reorderCategoriesList(
  categories: GradeCategory[],
  fromIndex: number,
  toIndex: number
): GradeCategory[] {
  if (
    !Array.isArray(categories) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= categories.length ||
    toIndex >= categories.length ||
    fromIndex === toIndex
  ) {
    return categories;
  }
  const nextCategories = [...categories];
  const [movedCategory] = nextCategories.splice(fromIndex, 1);
  nextCategories.splice(toIndex, 0, movedCategory);
  return nextCategories;
}

/**
 * Reordena de forma pura e inmutable las subcolumnas (evaluaciones) dentro de una Categoría Mayor
 * moviendo la subcolumna desde `fromIndex` hacia `toIndex`.
 */
export function reorderSubcategoriesInCategory(
  categories: GradeCategory[],
  categoryId: string,
  fromIndex: number,
  toIndex: number
): GradeCategory[] {
  if (!Array.isArray(categories) || !categoryId) return categories;
  return categories.map((category) => {
    if (category.id !== categoryId) return category;
    const subList = Array.isArray(category.subcategories) ? [...category.subcategories] : [];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= subList.length ||
      toIndex >= subList.length ||
      fromIndex === toIndex
    ) {
      return category;
    }
    const [movedSub] = subList.splice(fromIndex, 1);
    subList.splice(toIndex, 0, movedSub);
    return {
      ...category,
      subcategories: subList,
    };
  });
}

/**
 * Mueve de forma pura e inmutable una subcolumna (evaluación) de una categoría a otra
 * (o a una posición específica dentro de la categoría destino) conservando intacto su `id`
 * para que todas las notas cargadas de los alumnos se mantengan vinculadas automáticamente.
 */
export function moveSubcategoryAcrossCategories(
  categories: GradeCategory[],
  sourceCategoryId: string,
  subcategoryId: string,
  targetCategoryId: string,
  targetIndex?: number
): GradeCategory[] {
  if (!Array.isArray(categories) || !sourceCategoryId || !subcategoryId || !targetCategoryId) {
    return categories;
  }

  const sourceCategory = categories.find((cat) => cat.id === sourceCategoryId);
  if (!sourceCategory) return categories;
  const sourceIndex = sourceCategory.subcategories.findIndex((sub) => sub.id === subcategoryId);
  if (sourceIndex === -1) return categories;

  if (sourceCategoryId === targetCategoryId) {
    if (targetIndex === undefined || targetIndex === sourceIndex) return categories;
    return reorderSubcategoriesInCategory(categories, sourceCategoryId, sourceIndex, targetIndex);
  }

  const movedSubcategory = sourceCategory.subcategories[sourceIndex];
  return categories.map((cat) => {
    if (cat.id === sourceCategoryId) {
      return {
        ...cat,
        subcategories: cat.subcategories.filter((sub) => sub.id !== subcategoryId),
      };
    }
    if (cat.id === targetCategoryId) {
      const nextSubs = [...cat.subcategories];
      const insertAt =
        targetIndex !== undefined && targetIndex >= 0 && targetIndex <= nextSubs.length
          ? targetIndex
          : nextSubs.length;
      nextSubs.splice(insertAt, 0, movedSubcategory);
      return {
        ...cat,
        subcategories: nextSubs,
      };
    }
    return cat;
  });
}

