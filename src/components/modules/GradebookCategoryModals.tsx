/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Trash2,
  Edit2,
  X,
  Check,
  Plus,
  ChevronLeft,
  ChevronRight,
  Upload,
  FileCheck,
  Link2,
  ClipboardPaste,
  RotateCcw,
  Bookmark,
  Scale,
  Sigma,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';
import {
  EvaluationInstancesCombineMode,
  GradeCategory,
  GradeScaleSettings,
  SubcategoryScaleMode,
} from '../../types/grades';
import {
  CATEGORY_COLORS,
  getEvaluationInstanceDisplayLabel,
  getIntensificationDisplayLabel,
  getIntensificationPassingThreshold,
  getPrimaryInstanceDisplayLabel,
  getPrimaryInstanceLabel,
  getSumGroupPeers,
  resolveInstanceScale,
  resolveSubcategoryScale,
} from '../../utils/gradeCalculations';
import {
  INTENSIFICATION_LABEL_PRESETS,
  INTENSIFICATION_PASSING_SCORE_PRESETS,
} from '../../utils/terminologySettings';

const EVALUATION_INSTANCE_PRESETS = [
  'Escrita',
  'Oral',
  'Práctica',
  'Teórica',
  'Defensa',
  'Entrega',
  'Parte 1',
  'Parte 2',
];

export interface SubcategoryScaleEditPayload {
  scaleMode: SubcategoryScaleMode;
  minScore?: number;
  maxScore?: number;
  passingScore?: number;
  convertToGeneralOnAverage?: boolean;
  sumPeerSubIds?: string[];
}

export interface GradebookCategoryModalsProps {
  isDarkMode: boolean;
  categories: GradeCategory[];
  generalGradeScale: GradeScaleSettings;
  categoryToDelete: GradeCategory | null;
  setCategoryToDelete: (cat: GradeCategory | null) => void;
  confirmDeleteCategory: () => void;
  categoryToEdit: GradeCategory | null;
  setCategoryToEdit: (cat: GradeCategory | null) => void;
  editCatName: string;
  setEditCatName: (val: string) => void;
  editCatColor: string;
  setEditCatColor: (val: string) => void;
  handleSaveEditCategory: () => void;
  subcatToEdit: { catId: string; subId: string; name: string } | null;
  setSubcatToEdit: (sub: { catId: string; subId: string; name: string } | null) => void;
  editSubcatName: string;
  setEditSubcatName: (val: string) => void;
  handleSaveEditSubcategory: (scalePayload?: SubcategoryScaleEditPayload) => void;
  handleDeleteSubcategory: (catId: string, subId: string) => void;
  convertible100CountInSubcat?: number;
  onConvertSubcat100ToGeneral?: (subId: string) => number;
  onMoveCategory?: (fromIndex: number, toIndex: number) => void;
  onMoveSubcategory?: (categoryId: string, fromIndex: number, toIndex: number) => void;
  onMoveSubcategoryToCategory?: (
    sourceCategoryId: string,
    subcategoryId: string,
    targetCategoryId: string
  ) => void;
  onImportIntoColumn?: (
    target: { categoryId: string; subcategoryId: string; subcategoryName: string },
    source: 'forms' | 'sheets' | 'file' | 'paste'
  ) => void;
  intensificationDefaultLabel?: string;
  onUpdateDefaultIntensificationLabel?: (nextLabel: string) => void;
  intensificationDefaultPassingScore?: number;
  onUpdateDefaultIntensificationPassingScore?: (nextScore: number) => void;
  onAddIntensification?: (
    catId: string,
    subId: string,
    name: string,
    customTitle?: string,
    passingScore?: number
  ) => void;
  intensificationToEdit?: { catId: string; subId: string; instId: string } | null;
  setIntensificationToEdit?: (
    val: { catId: string; subId: string; instId: string } | null
  ) => void;
  onUpdateIntensification?: (
    catId: string,
    subId: string,
    instId: string,
    updates: { name: string; customTitle?: string; passingScore?: number }
  ) => void;
  onDeleteIntensification?: (catId: string, subId: string, instId: string) => void;
  onMoveIntensification?: (
    catId: string,
    subId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  onAddEvaluationInstance?: (
    catId: string,
    subId: string,
    name: string,
    options?: {
      primaryInstanceName?: string;
      customTitle?: string;
      combineMode?: EvaluationInstancesCombineMode;
    }
  ) => void;
  onUpdateEvaluationInstancesMeta?: (
    catId: string,
    subId: string,
    updates: {
      primaryInstanceName?: string;
      instancesCombineMode?: EvaluationInstancesCombineMode;
    }
  ) => void;
  evaluationInstanceToEdit?: { catId: string; subId: string; instanceId: string } | null;
  setEvaluationInstanceToEdit?: (
    val: { catId: string; subId: string; instanceId: string } | null
  ) => void;
  onUpdateEvaluationInstance?: (
    catId: string,
    subId: string,
    instanceId: string,
    updates: {
      name: string;
      customTitle?: string;
      scaleMode?: SubcategoryScaleMode;
      minScore?: number;
      maxScore?: number;
      passingScore?: number;
      convertToGeneralOnAverage?: boolean;
    }
  ) => void;
  onDeleteEvaluationInstance?: (catId: string, subId: string, instanceId: string) => void;
  onMoveEvaluationInstance?: (
    catId: string,
    subId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
}

export const GradebookCategoryModals: React.FC<GradebookCategoryModalsProps> = ({
  isDarkMode,
  categories,
  generalGradeScale,
  categoryToDelete,
  setCategoryToDelete,
  confirmDeleteCategory,
  categoryToEdit,
  setCategoryToEdit,
  editCatName,
  setEditCatName,
  editCatColor,
  setEditCatColor,
  handleSaveEditCategory,
  subcatToEdit,
  setSubcatToEdit,
  editSubcatName,
  setEditSubcatName,
  handleSaveEditSubcategory,
  handleDeleteSubcategory,
  convertible100CountInSubcat = 0,
  onConvertSubcat100ToGeneral,
  onMoveCategory,
  onMoveSubcategory,
  onMoveSubcategoryToCategory,
  onImportIntoColumn,
  intensificationDefaultLabel = 'Intensificación',
  onUpdateDefaultIntensificationLabel,
  intensificationDefaultPassingScore = 7,
  onUpdateDefaultIntensificationPassingScore,
  onAddIntensification,
  intensificationToEdit,
  setIntensificationToEdit,
  onUpdateIntensification,
  onDeleteIntensification,
  onMoveIntensification,
  onAddEvaluationInstance,
  onUpdateEvaluationInstancesMeta,
  evaluationInstanceToEdit,
  setEvaluationInstanceToEdit,
  onUpdateEvaluationInstance,
  onDeleteEvaluationInstance,
  onMoveEvaluationInstance,
}) => {
  const activeEditCatIndex = categoryToEdit
    ? categories.findIndex((c) => c.id === categoryToEdit.id)
    : -1;
  const activeEditCategoryLive =
    activeEditCatIndex >= 0 ? categories[activeEditCatIndex] : categoryToEdit;

  const activeSubcatParentCat = subcatToEdit
    ? categories.find((c) => c.id === subcatToEdit.catId)
    : null;
  const activeSubcatIndex =
    activeSubcatParentCat && subcatToEdit
      ? activeSubcatParentCat.subcategories.findIndex((s) => s.id === subcatToEdit.subId)
      : -1;
  const activeSubcatLive =
    activeSubcatParentCat && activeSubcatIndex >= 0
      ? activeSubcatParentCat.subcategories[activeSubcatIndex]
      : null;

  // Per-subcategory scale draft state
  const [subScaleMode, setSubScaleMode] = useState<SubcategoryScaleMode>('general');
  const [subMinScoreStr, setSubMinScoreStr] = useState<string>(String(generalGradeScale.minScore));
  const [subMaxScoreStr, setSubMaxScoreStr] = useState<string>(String(generalGradeScale.maxScore));
  const [subPassingScoreStr, setSubPassingScoreStr] = useState<string>(
    String(generalGradeScale.passingScore)
  );
  const [subConvertToGeneral, setSubConvertToGeneral] = useState<boolean>(true);
  const [subSumPeerIds, setSubSumPeerIds] = useState<string[]>([]);
  const [convertedNowFeedback, setConvertedNowFeedback] = useState<number | null>(null);

  // Catalog of all other subcategories in the current term (for sum_group linking)
  const otherSubcategoriesInTerm = useMemo(() => {
    const list: Array<{
      catId: string;
      catName: string;
      subId: string;
      subName: string;
      maxScore: number;
    }> = [];
    categories.forEach((cat) => {
      cat.subcategories.forEach((sub) => {
        if (subcatToEdit && sub.id === subcatToEdit.subId) return;
        const resolved = resolveSubcategoryScale(sub, generalGradeScale);
        list.push({
          catId: cat.id,
          catName: cat.name,
          subId: sub.id,
          subName: sub.name,
          maxScore: resolved.maxScore,
        });
      });
    });
    return list;
  }, [categories, subcatToEdit, generalGradeScale]);

  useEffect(() => {
    if (activeSubcatLive) {
      const resolved = resolveSubcategoryScale(activeSubcatLive, generalGradeScale);
      setSubScaleMode(resolved.mode);
      setSubMinScoreStr(
        String(
          activeSubcatLive.minScore !== undefined
            ? activeSubcatLive.minScore
            : resolved.mode === 'sum_group' || resolved.mode === 'custom'
            ? resolved.minScore
            : generalGradeScale.minScore
        )
      );
      setSubMaxScoreStr(
        String(
          activeSubcatLive.maxScore !== undefined && resolved.mode !== 'convert_100'
            ? activeSubcatLive.maxScore
            : resolved.mode === 'sum_group'
            ? 5
            : generalGradeScale.maxScore
        )
      );
      setSubPassingScoreStr(String(resolved.passingScore));
      setSubConvertToGeneral(resolved.convertToGeneralOnAverage);
      if (activeSubcatLive.scaleMode === 'sum_group' && activeSubcatLive.sumGroupId) {
        const peers = getSumGroupPeers(categories, activeSubcatLive.sumGroupId)
          .map((p) => p.subcategory.id)
          .filter((id) => id !== activeSubcatLive.id);
        setSubSumPeerIds(peers);
      } else {
        setSubSumPeerIds([]);
      }
      setConvertedNowFeedback(null);
    }
  }, [activeSubcatLive?.id]);

  // Draft state for adding a new intensification inside the Evaluation Edit modal
  const [newInstName, setNewInstName] = useState('');
  const [newInstCustomTitle, setNewInstCustomTitle] = useState('');
  const [newInstPassingScore, setNewInstPassingScore] = useState<string>(
    String(intensificationDefaultPassingScore)
  );
  const [saveAsDefaultTerm, setSaveAsDefaultTerm] = useState(false);

  const existingInstCount = activeSubcatLive?.intensifications?.length || 0;

  const parseDraftPassingScore = (raw: string, fallback: number, maxBound = 1000): number => {
    const parsed = Number(String(raw ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maxBound) return fallback;
    return Math.round(parsed * 10) / 10;
  };

  const parsedSubMin = (() => {
    const n = Number(String(subMinScoreStr ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : 1;
  })();
  const parsedSubMax = (() => {
    const n = Number(String(subMaxScoreStr ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= parsedSubMin || n > 1000) {
      return subScaleMode === 'sum_group' ? 5 : generalGradeScale.maxScore;
    }
    return Math.round(n * 10) / 10;
  })();
  const parsedSubPassing = parseDraftPassingScore(
    subPassingScoreStr,
    Math.round(((parsedSubMax * generalGradeScale.passingScore) / generalGradeScale.maxScore) * 10) / 10,
    parsedSubMax
  );

  const defaultPassForNewInst =
    subScaleMode === 'custom' || subScaleMode === 'sum_group'
      ? parsedSubPassing
      : intensificationDefaultPassingScore;

  const effectiveNewPassingScore = parseDraftPassingScore(
    newInstPassingScore,
    defaultPassForNewInst,
    subScaleMode === 'custom' || subScaleMode === 'sum_group' ? parsedSubMax : generalGradeScale.maxScore
  );

  useEffect(() => {
    if (subcatToEdit) {
      const nextDefault =
        existingInstCount === 0
          ? intensificationDefaultLabel
          : `${intensificationDefaultLabel} ${existingInstCount + 1}`;
      setNewInstName(nextDefault);
      setNewInstCustomTitle('');
      const resolvedSub = activeSubcatLive
        ? resolveSubcategoryScale(activeSubcatLive, generalGradeScale)
        : null;
      const initialInstPass =
        resolvedSub && (resolvedSub.mode === 'custom' || resolvedSub.mode === 'sum_group')
          ? resolvedSub.passingScore
          : intensificationDefaultPassingScore;
      setNewInstPassingScore(String(initialInstPass));
      setSaveAsDefaultTerm(false);
    }
  }, [
    subcatToEdit?.subId,
    existingInstCount,
    intensificationDefaultLabel,
    intensificationDefaultPassingScore,
  ]);

  // Live resolution for Editing an Intensification modal
  const activeInstParentCat = intensificationToEdit
    ? categories.find((c) => c.id === intensificationToEdit.catId)
    : null;
  const activeInstParentSub =
    activeInstParentCat && intensificationToEdit
      ? activeInstParentCat.subcategories.find((s) => s.id === intensificationToEdit.subId)
      : null;
  const activeInstList = activeInstParentSub?.intensifications || [];
  const activeInstIndex =
    intensificationToEdit
      ? activeInstList.findIndex((inst) => inst.id === intensificationToEdit.instId)
      : -1;
  const activeInstLive = activeInstIndex >= 0 ? activeInstList[activeInstIndex] : null;

  const [editInstName, setEditInstName] = useState('');
  const [editInstCustomTitle, setEditInstCustomTitle] = useState('');
  const [editInstPassingScore, setEditInstPassingScore] = useState<string>(
    String(intensificationDefaultPassingScore)
  );
  const [savedDefaultFeedback, setSavedDefaultFeedback] = useState(false);
  const [savedDefaultScoreFeedback, setSavedDefaultScoreFeedback] = useState(false);

  const effectiveEditPassingScore = parseDraftPassingScore(
    editInstPassingScore,
    activeInstLive
      ? getIntensificationPassingThreshold(activeInstLive, activeInstParentSub || undefined)
      : intensificationDefaultPassingScore
  );

  useEffect(() => {
    if (activeInstLive) {
      setEditInstName(activeInstLive.name);
      setEditInstCustomTitle(activeInstLive.customTitle || '');
      setEditInstPassingScore(
        String(getIntensificationPassingThreshold(activeInstLive, activeInstParentSub || undefined))
      );
      setSavedDefaultFeedback(false);
      setSavedDefaultScoreFeedback(false);
    }
  }, [activeInstLive?.id]);

  // Draft state for adding new Evaluation Instances (para todos los alumnos: Escrita, Oral, etc.)
  const existingEvalInstances = activeSubcatLive?.instances || [];
  const [newEvalPrimaryName, setNewEvalPrimaryName] = useState('Escrita');
  const [newEvalInstanceName, setNewEvalInstanceName] = useState('Oral');
  const [newEvalInstanceCustomTitle, setNewEvalInstanceCustomTitle] = useState('');
  const [newEvalCombineMode, setNewEvalCombineMode] =
    useState<EvaluationInstancesCombineMode>('average');

  useEffect(() => {
    if (activeSubcatLive) {
      const existingCount = activeSubcatLive.instances?.length || 0;
      setNewEvalPrimaryName(
        activeSubcatLive.primaryInstanceName?.trim() ||
          (existingCount > 0 ? getPrimaryInstanceLabel(activeSubcatLive) : 'Escrita')
      );
      setNewEvalInstanceName(existingCount === 0 ? 'Oral' : `Instancia ${existingCount + 2}`);
      setNewEvalInstanceCustomTitle('');
      setNewEvalCombineMode(activeSubcatLive.instancesCombineMode || 'average');
    }
  }, [activeSubcatLive?.id, activeSubcatLive?.instances?.length]);

  const handleConfirmAddEvalInstance = () => {
    if (!subcatToEdit || !onAddEvaluationInstance) return;
    const cleanName = newEvalInstanceName.trim();
    if (!cleanName) return;
    const cleanPrimary =
      newEvalPrimaryName.trim() ||
      (cleanName.toLowerCase() === 'oral' ? 'Escrita' : '1° Inst.');
    onAddEvaluationInstance(subcatToEdit.catId, subcatToEdit.subId, cleanName, {
      primaryInstanceName:
        existingEvalInstances.length === 0 ? cleanPrimary : activeSubcatLive?.primaryInstanceName,
      customTitle: newEvalInstanceCustomTitle.trim() || undefined,
      combineMode: newEvalCombineMode,
    });
    setNewEvalInstanceCustomTitle('');
  };

  // Live resolution for Editing an Evaluation Instance modal (supports '__primary__' or extra instance id)
  const activeEvalInstParentCat = evaluationInstanceToEdit
    ? categories.find((c) => c.id === evaluationInstanceToEdit.catId)
    : null;
  const activeEvalInstParentSub =
    activeEvalInstParentCat && evaluationInstanceToEdit
      ? activeEvalInstParentCat.subcategories.find((s) => s.id === evaluationInstanceToEdit.subId)
      : null;
  const isEditingPrimaryInstance = evaluationInstanceToEdit?.instanceId === '__primary__';
  const activeEvalInstList = activeEvalInstParentSub?.instances || [];
  const activeEvalInstIndex =
    evaluationInstanceToEdit && !isEditingPrimaryInstance
      ? activeEvalInstList.findIndex((inst) => inst.id === evaluationInstanceToEdit.instanceId)
      : -1;
  const activeEvalInstLive =
    !isEditingPrimaryInstance && activeEvalInstIndex >= 0
      ? activeEvalInstList[activeEvalInstIndex]
      : null;

  const [editEvalInstName, setEditEvalInstName] = useState('');
  const [editEvalInstCustomTitle, setEditEvalInstCustomTitle] = useState('');
  const [editEvalInstScaleMode, setEditEvalInstScaleMode] =
    useState<'inherit' | 'custom' | 'convert_100'>('inherit');
  const [editEvalInstMinStr, setEditEvalInstMinStr] = useState(String(generalGradeScale.minScore));
  const [editEvalInstMaxStr, setEditEvalInstMaxStr] = useState(String(generalGradeScale.maxScore));
  const [editEvalInstPassStr, setEditEvalInstPassStr] = useState(
    String(generalGradeScale.passingScore)
  );

  useEffect(() => {
    if (!evaluationInstanceToEdit || !activeEvalInstParentSub) return;
    if (isEditingPrimaryInstance) {
      setEditEvalInstName(getPrimaryInstanceLabel(activeEvalInstParentSub));
      setEditEvalInstCustomTitle('');
      setEditEvalInstScaleMode('inherit');
    } else if (activeEvalInstLive) {
      setEditEvalInstName(activeEvalInstLive.name);
      setEditEvalInstCustomTitle(activeEvalInstLive.customTitle || '');
      if (activeEvalInstLive.scaleMode === 'convert_100') {
        setEditEvalInstScaleMode('convert_100');
      } else if (activeEvalInstLive.scaleMode === 'custom') {
        setEditEvalInstScaleMode('custom');
        const resolved = resolveInstanceScale(
          activeEvalInstParentSub,
          activeEvalInstLive,
          generalGradeScale
        );
        setEditEvalInstMinStr(String(resolved.minScore));
        setEditEvalInstMaxStr(String(resolved.maxScore));
        setEditEvalInstPassStr(String(resolved.passingScore));
      } else {
        setEditEvalInstScaleMode('inherit');
        const parentResolved = resolveSubcategoryScale(activeEvalInstParentSub, generalGradeScale);
        setEditEvalInstMinStr(String(parentResolved.minScore));
        setEditEvalInstMaxStr(String(parentResolved.maxScore));
        setEditEvalInstPassStr(String(parentResolved.passingScore));
      }
    }
  }, [evaluationInstanceToEdit?.instanceId, activeEvalInstParentSub?.id]);

  const handleSaveEditEvalInstance = () => {
    if (!evaluationInstanceToEdit || !activeEvalInstParentSub || !editEvalInstName.trim()) return;
    if (isEditingPrimaryInstance) {
      onUpdateEvaluationInstancesMeta?.(
        evaluationInstanceToEdit.catId,
        evaluationInstanceToEdit.subId,
        { primaryInstanceName: editEvalInstName.trim() }
      );
      setEvaluationInstanceToEdit?.(null);
      return;
    }
    if (!activeEvalInstLive || !onUpdateEvaluationInstance) return;
    if (editEvalInstScaleMode === 'inherit') {
      onUpdateEvaluationInstance(
        evaluationInstanceToEdit.catId,
        evaluationInstanceToEdit.subId,
        activeEvalInstLive.id,
        {
          name: editEvalInstName.trim(),
          customTitle: editEvalInstCustomTitle.trim() || undefined,
          scaleMode: 'general',
          minScore: undefined,
          maxScore: undefined,
          passingScore: undefined,
          convertToGeneralOnAverage: undefined,
        }
      );
    } else if (editEvalInstScaleMode === 'convert_100') {
      onUpdateEvaluationInstance(
        evaluationInstanceToEdit.catId,
        evaluationInstanceToEdit.subId,
        activeEvalInstLive.id,
        {
          name: editEvalInstName.trim(),
          customTitle: editEvalInstCustomTitle.trim() || undefined,
          scaleMode: 'convert_100',
          minScore: 0,
          maxScore: 100,
          passingScore: undefined,
          convertToGeneralOnAverage: true,
        }
      );
    } else {
      const minN = Number(String(editEvalInstMinStr).replace(',', '.'));
      const safeMin = Number.isFinite(minN) && minN >= 0 ? Math.round(minN * 10) / 10 : 1;
      const maxN = Number(String(editEvalInstMaxStr).replace(',', '.'));
      const safeMax =
        Number.isFinite(maxN) && maxN > safeMin ? Math.round(maxN * 10) / 10 : 5;
      const passN = Number(String(editEvalInstPassStr).replace(',', '.'));
      const safePass =
        Number.isFinite(passN) && passN > 0 && passN <= safeMax
          ? Math.round(passN * 10) / 10
          : Math.round(((safeMax * generalGradeScale.passingScore) / generalGradeScale.maxScore) * 10) / 10;
      onUpdateEvaluationInstance(
        evaluationInstanceToEdit.catId,
        evaluationInstanceToEdit.subId,
        activeEvalInstLive.id,
        {
          name: editEvalInstName.trim(),
          customTitle: editEvalInstCustomTitle.trim() || undefined,
          scaleMode: 'custom',
          minScore: safeMin,
          maxScore: safeMax,
          passingScore: safePass,
          convertToGeneralOnAverage: true,
        }
      );
    }
    setEvaluationInstanceToEdit?.(null);
  };

  const buildSubcatScalePayload = (): SubcategoryScaleEditPayload => {
    if (subScaleMode === 'general') {
      return {
        scaleMode: 'general',
        minScore: undefined,
        maxScore: generalGradeScale.maxScore,
        passingScore: undefined,
        convertToGeneralOnAverage: undefined,
        sumPeerSubIds: [],
      };
    }
    if (subScaleMode === 'convert_100') {
      return {
        scaleMode: 'convert_100',
        minScore: 0,
        maxScore: 100,
        passingScore: undefined,
        convertToGeneralOnAverage: true,
        sumPeerSubIds: [],
      };
    }
    if (subScaleMode === 'sum_group') {
      return {
        scaleMode: 'sum_group',
        minScore: parsedSubMin,
        maxScore: parsedSubMax,
        passingScore: parsedSubPassing,
        convertToGeneralOnAverage: false,
        sumPeerSubIds: subSumPeerIds,
      };
    }
    return {
      scaleMode: 'custom',
      minScore: parsedSubMin,
      maxScore: parsedSubMax,
      passingScore: parsedSubPassing,
      convertToGeneralOnAverage: subConvertToGeneral,
      sumPeerSubIds: [],
    };
  };

  const handleConfirmAddIntensification = () => {
    if (!subcatToEdit || !onAddIntensification) return;
    const cleanName = newInstName.trim() || intensificationDefaultLabel;
    const resolvedPassingScore = parseDraftPassingScore(
      newInstPassingScore,
      defaultPassForNewInst
    );
    if (saveAsDefaultTerm) {
      if (onUpdateDefaultIntensificationLabel) {
        const baseTerm = cleanName.replace(/\s+\d+$/, '').trim() || cleanName;
        onUpdateDefaultIntensificationLabel(baseTerm);
      }
      if (onUpdateDefaultIntensificationPassingScore) {
        onUpdateDefaultIntensificationPassingScore(resolvedPassingScore);
      }
    }
    onAddIntensification(
      subcatToEdit.catId,
      subcatToEdit.subId,
      cleanName,
      newInstCustomTitle.trim() || undefined,
      resolvedPassingScore
    );
    setNewInstCustomTitle('');
  };

  const handleSaveEditIntensification = () => {
    if (!intensificationToEdit || !onUpdateIntensification || !editInstName.trim()) return;
    const resolvedPassingScore = parseDraftPassingScore(
      editInstPassingScore,
      intensificationDefaultPassingScore
    );
    onUpdateIntensification(
      intensificationToEdit.catId,
      intensificationToEdit.subId,
      intensificationToEdit.instId,
      {
        name: editInstName.trim(),
        customTitle: editInstCustomTitle.trim() || undefined,
        passingScore: resolvedPassingScore,
      }
    );
    setIntensificationToEdit?.(null);
  };

  return (
    <>
      {/* Modal de confirmación para eliminar Categoría Mayor */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md p-6 rounded-2xl shadow-2xl border space-y-4 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-2.5 rounded-xl bg-red-500/10 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold">¿Eliminar categoría mayor?</h3>
                <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Esta acción eliminará la categoría y sus columnas de evaluación.
                </p>
              </div>
            </div>

            <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
              ¿Estás seguro de que deseas eliminar la categoría{' '}
              <strong className="text-blue-500">"{categoryToDelete.name}"</strong>
              {categoryToDelete.subcategories.length > 0 && (
                <>
                  {' '}y sus{' '}
                  <strong className="text-red-500">{categoryToDelete.subcategories.length}</strong>{' '}
                  columna(s) de evaluación asociadas
                </>
              )}
              ?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCategoryToDelete(null)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteCategory}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sí, eliminar categoría</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Categoría Mayor (Nombre, color, orden y subcolumnas) */}
      {activeEditCategoryLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Categoría Mayor</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Modificá el nombre, color o cambiá de lugar la categoría y sus columnas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-neutral-700 dark:text-slate-300">
                  Nombre de la Categoría Mayor
                </label>
                <input
                  type="text"
                  value={editCatName}
                  onChange={(e) => setEditCatName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditCategory()}
                  placeholder="Ej: Evaluaciones, Trabajos Prácticos..."
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  autoFocus
                />
              </div>

              {/* Importar notas directamente en esta columna / categoría */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/25 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Importar notas directamente en "
                      {activeEditCategoryLive.subcategories.length === 1
                        ? activeEditCategoryLive.subcategories[0].name
                        : editCatName.trim() || activeEditCategoryLive.name}
                      ":
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'forms'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-300'
                          : 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs'
                      }`}
                    >
                      <FileCheck className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Google Forms</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'sheets'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                          : 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs'
                      }`}
                    >
                      <Link2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Sheets / Docs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'file'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-300'
                          : 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Excel / Word / CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetSub = activeEditCategoryLive.subcategories[0];
                        setCategoryToEdit(null);
                        onImportIntoColumn(
                          {
                            categoryId: activeEditCategoryLive.id,
                            subcategoryId: targetSub ? targetSub.id : '__CATEGORY_DIRECT__',
                            subcategoryName: targetSub
                              ? targetSub.name
                              : editCatName.trim() || activeEditCategoryLive.name,
                          },
                          'paste'
                        );
                      }}
                      className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-300'
                          : 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs'
                      }`}
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="font-bold text-[11px] truncate">Pegar Notas</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Posición de la Categoría Mayor */}
              {onMoveCategory && categories.length > 1 && activeEditCatIndex >= 0 && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Posición en la planilla (Columna {activeEditCatIndex + 1} de {categories.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeEditCatIndex <= 0}
                      onClick={() => onMoveCategory(activeEditCatIndex, activeEditCatIndex - 1)}
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Mover a la izquierda</span>
                    </button>
                    <button
                      type="button"
                      disabled={activeEditCatIndex >= categories.length - 1}
                      onClick={() => onMoveCategory(activeEditCatIndex, activeEditCatIndex + 1)}
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <span>Mover a la derecha</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-slate-300">
                  Color distintivo
                </label>
                <div className="flex items-center gap-2">
                  {CATEGORY_COLORS.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => setEditCatColor(col.badge)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${col.badge} ${
                        editCatColor === col.badge ? 'ring-3 ring-offset-2 ring-blue-500 scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                      title={col.name}
                    >
                      {editCatColor === col.badge && <Check className="w-4 h-4 text-white stroke-[3]" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orden de las subcolumnas dentro de esta Categoría Mayor */}
              {onMoveSubcategory && activeEditCategoryLive.subcategories.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Orden de sus subcolumnas ({activeEditCategoryLive.subcategories.length})
                  </label>
                  <div
                    className={`rounded-xl border divide-y max-h-44 overflow-y-auto ${
                      isDarkMode
                        ? 'bg-slate-800/60 border-slate-700 divide-slate-700/70'
                        : 'bg-neutral-50 border-neutral-200 divide-neutral-200/70'
                    }`}
                  >
                    {activeEditCategoryLive.subcategories.map((sub, sIdx) => (
                      <div
                        key={sub.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold truncate">
                          {sIdx + 1}. {sub.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={sIdx === 0}
                            onClick={() =>
                              onMoveSubcategory(activeEditCategoryLive.id, sIdx, sIdx - 1)
                            }
                            className={`p-1 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 hover:bg-slate-700 text-slate-200'
                                : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                            }`}
                            title="Mover subcolumna a la izquierda (antes)"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={sIdx === activeEditCategoryLive.subcategories.length - 1}
                            onClick={() =>
                              onMoveSubcategory(activeEditCategoryLive.id, sIdx, sIdx + 1)
                            }
                            className={`p-1 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 hover:bg-slate-700 text-slate-200'
                                : 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                            }`}
                            title="Mover subcolumna a la derecha (después)"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className={`p-3 rounded-xl border text-[11px] ${
                  isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
                }`}
              >
                <p>
                  Las <strong>{activeEditCategoryLive.subcategories.length} columna(s)</strong> y las notas ya cargadas para tus estudiantes se conservan intactas al cambiar de nombre o posición.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const cat = activeEditCategoryLive;
                  setCategoryToEdit(null);
                  setCategoryToDelete(cat);
                }}
                className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar categoría</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryToEdit(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editCatName.trim()}
                  onClick={handleSaveEditCategory}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer shadow-xs flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Subcategoría / Columna de Evaluación */}
      {subcatToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Editar Columna / Evaluación</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Editá el título, configurá su escala, agregá {intensificationDefaultLabel.toLowerCase()}es o importá notas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Nombre de la columna o evaluación
                </label>
                <input
                  type="text"
                  value={editSubcatName}
                  onChange={(e) => setEditSubcatName(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSaveEditSubcategory(buildSubcatScalePayload())
                  }
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                  }`}
                  autoFocus
                />
              </div>

              {/* Sección: Escala y cálculo de esta evaluación / TP */}
              <div
                className={`p-3.5 rounded-xl border space-y-2.5 ${
                  isDarkMode
                    ? 'bg-indigo-950/25 border-indigo-500/40'
                    : 'bg-indigo-50/60 border-indigo-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-300">
                    <Scale className="w-3.5 h-3.5 shrink-0" />
                    <span>Escala de calificación de esta actividad</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      isDarkMode
                        ? 'bg-indigo-900/60 text-indigo-200'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    {subScaleMode === 'general'
                      ? `General (${generalGradeScale.minScore}–${generalGradeScale.maxScore} · ≥ ${generalGradeScale.passingScore})`
                      : subScaleMode === 'convert_100'
                      ? `Sobre 100 → sobre ${generalGradeScale.maxScore}`
                      : subScaleMode === 'sum_group'
                      ? `Suma (${parsedSubMin}–${parsedSubMax})`
                      : `Propia (${parsedSubMin}–${parsedSubMax} · ≥ ${parsedSubPassing})`}
                  </span>
                </div>

                {/* 4 modos de escala */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      {
                        mode: 'general' as const,
                        label: 'Escala general',
                        sub: `${generalGradeScale.minScore} al ${generalGradeScale.maxScore} (≥ ${generalGradeScale.passingScore})`,
                      },
                      {
                        mode: 'custom' as const,
                        label: 'Escala propia',
                        sub: 'Ej: 1 al 5, aprueba con X',
                      },
                      {
                        mode: 'convert_100' as const,
                        label: `Sobre 100 → /${generalGradeScale.maxScore}`,
                        sub: `Ej: 85 pasa a ${(0.85 * generalGradeScale.maxScore).toFixed(1).replace(/\.0$/, '')}`,
                      },
                      {
                        mode: 'sum_group' as const,
                        label: 'Suma con otra(s)',
                        sub: 'Ej: sobre 5 + sobre 5 = 10',
                      },
                    ] as const
                  ).map((opt) => {
                    const active = subScaleMode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        type="button"
                        onClick={() => {
                          setSubScaleMode(opt.mode);
                          if (opt.mode === 'sum_group') {
                            if (
                              Number(subMaxScoreStr) === generalGradeScale.maxScore ||
                              Number(subMaxScoreStr) === 100
                            ) {
                              const halfMax = Math.round((generalGradeScale.maxScore / 2) * 10) / 10;
                              setSubMinScoreStr('0');
                              setSubMaxScoreStr(String(halfMax));
                              const halfPass =
                                Math.round((generalGradeScale.passingScore / 2) * 10) / 10;
                              setSubPassingScoreStr(String(halfPass));
                            }
                          } else if (opt.mode === 'custom') {
                            if (Number(subMaxScoreStr) === 100) {
                              setSubMinScoreStr('1');
                              setSubMaxScoreStr('5');
                              setSubPassingScoreStr('3.5');
                            }
                          }
                        }}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                          active
                            ? isDarkMode
                              ? 'bg-indigo-600/30 border-indigo-400 text-white'
                              : 'bg-white border-indigo-500 text-indigo-950 shadow-2xs ring-1 ring-indigo-500/25'
                            : isDarkMode
                            ? 'bg-slate-900/70 border-slate-700 text-slate-300 hover:bg-slate-800'
                            : 'bg-white/70 border-indigo-200/80 text-neutral-700 hover:bg-white'
                        }`}
                      >
                        <div className="font-bold text-[11px] leading-tight">{opt.label}</div>
                        <div className="text-[10px] opacity-75 truncate mt-0.5">{opt.sub}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Controles para Escala Propia o Suma con otra(s) */}
                {(subScaleMode === 'custom' || subScaleMode === 'sum_group') && (
                  <div className="space-y-2.5 pt-1">
                    {/* Accesos rápidos de puntaje máximo */}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-0.5">
                        Puntaje máximo rápido:
                      </span>
                      {[5, 10, 20, 100].map((quickMax) => {
                        const isSelected = parsedSubMax === quickMax;
                        return (
                          <button
                            key={quickMax}
                            type="button"
                            onClick={() => {
                              setSubMaxScoreStr(String(quickMax));
                              const suggestedPass =
                                Math.round(
                                  ((quickMax * generalGradeScale.passingScore) /
                                    generalGradeScale.maxScore) *
                                    10
                                ) / 10;
                              setSubPassingScoreStr(String(suggestedPass));
                              if (quickMax !== generalGradeScale.maxScore) {
                                setSubConvertToGeneral(true);
                              }
                            }}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-100/70'
                            }`}
                          >
                            Sobre {quickMax}
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-neutral-600 dark:text-slate-300 block">
                          Mínimo
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={subMinScoreStr}
                          onChange={(e) => setSubMinScoreStr(e.target.value)}
                          className={`w-full px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-white'
                              : 'bg-white border-indigo-200 text-neutral-900'
                          }`}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-neutral-600 dark:text-slate-300 block">
                          Máximo
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          step={0.5}
                          value={subMaxScoreStr}
                          onChange={(e) => setSubMaxScoreStr(e.target.value)}
                          className={`w-full px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-white'
                              : 'bg-white border-indigo-200 text-neutral-900'
                          }`}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 block">
                          Aprueba con
                        </label>
                        <input
                          type="number"
                          min={0.5}
                          max={parsedSubMax}
                          step={0.5}
                          value={subPassingScoreStr}
                          onChange={(e) => setSubPassingScoreStr(e.target.value)}
                          className={`w-full px-2 py-1 text-center font-bold rounded-lg border text-xs ${
                            isDarkMode
                              ? 'bg-slate-900 border-emerald-700/70 text-emerald-300'
                              : 'bg-white border-emerald-400 text-emerald-800'
                          }`}
                        />
                      </div>
                    </div>

                    {subScaleMode === 'custom' && parsedSubMax !== generalGradeScale.maxScore && (
                      <label className="flex items-start gap-2 text-[11px] text-neutral-700 dark:text-slate-300 cursor-pointer select-none pt-0.5">
                        <input
                          type="checkbox"
                          checked={subConvertToGeneral}
                          onChange={(e) => setSubConvertToGeneral(e.target.checked)}
                          className="mt-0.5 rounded border-indigo-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span>
                          Convertir proporcionalmente al calcular el promedio general (ej.{' '}
                          <strong>
                            {parsedSubPassing} / {parsedSubMax}
                          </strong>{' '}
                          entra como{' '}
                          <strong>
                            {((parsedSubPassing / parsedSubMax) * generalGradeScale.maxScore)
                              .toFixed(1)
                              .replace(/\.0$/, '')}{' '}
                            / {generalGradeScale.maxScore}
                          </strong>
                          ).
                        </span>
                      </label>
                    )}

                    {subScaleMode === 'sum_group' && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center gap-1 text-[11px] font-bold text-indigo-800 dark:text-indigo-300">
                          <Sigma className="w-3.5 h-3.5 shrink-0" />
                          <span>Elegí con qué evaluación(es) se suma esta nota:</span>
                        </div>
                        {otherSubcategoriesInTerm.length === 0 ? (
                          <p className="text-[11px] italic text-neutral-500 dark:text-slate-400">
                            Creá al menos otra columna/evaluación para poder sumarlas juntas.
                          </p>
                        ) : (
                          <div
                            className={`max-h-36 overflow-y-auto rounded-lg border divide-y ${
                              isDarkMode
                                ? 'bg-slate-900/80 border-slate-700 divide-slate-800'
                                : 'bg-white border-indigo-200 divide-neutral-100'
                            }`}
                          >
                            {otherSubcategoriesInTerm.map((peer) => {
                              const checked = subSumPeerIds.includes(peer.subId);
                              return (
                                <label
                                  key={peer.subId}
                                  className="px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-slate-800/70"
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSubSumPeerIds((prev) => [...prev, peer.subId]);
                                        } else {
                                          setSubSumPeerIds((prev) =>
                                            prev.filter((id) => id !== peer.subId)
                                          );
                                        }
                                      }}
                                      className="rounded border-indigo-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    />
                                    <span className="truncate font-semibold">{peer.subName}</span>
                                    <span className="text-[10px] opacity-65 truncate">
                                      ({peer.catName})
                                    </span>
                                  </span>
                                  <span className="text-[10px] font-bold opacity-75 shrink-0">
                                    máx. {peer.maxScore}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {subSumPeerIds.length > 0 && (() => {
                          const selectedPeers = otherSubcategoriesInTerm.filter((p) =>
                            subSumPeerIds.includes(p.subId)
                          );
                          const combinedMax =
                            parsedSubMax + selectedPeers.reduce((acc, p) => acc + p.maxScore, 0);
                          return (
                            <p
                              className={`text-[11px] leading-snug p-2 rounded-lg border ${
                                isDarkMode
                                  ? 'bg-slate-900/90 border-indigo-800/70 text-indigo-200'
                                  : 'bg-white border-indigo-200 text-indigo-900'
                              }`}
                            >
                              Suma total del grupo: <strong>{combinedMax} pts</strong> (
                              {editSubcatName.trim() || subcatToEdit.name} +{' '}
                              {selectedPeers.map((p) => p.subName).join(' + ')}). Al promediar se
                              computa como <strong>1 sola nota</strong>
                              {combinedMax !== generalGradeScale.maxScore
                                ? ` escalada a ${generalGradeScale.maxScore}`
                                : ` sobre ${generalGradeScale.maxScore}`}
                              .
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Información y acción rápida para Sobre 100 -> sobre 10 */}
                {subScaleMode === 'convert_100' && (
                  <div className="space-y-2 pt-0.5">
                    <p
                      className={`text-[11px] leading-snug ${
                        isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                      }`}
                    >
                      Cuando cargues un puntaje sobre 100 (por ejemplo <strong>85</strong>,{' '}
                      <strong>70%</strong> o <strong>92/100</strong>) y salgas de la celda, se
                      convertirá automáticamente a escala sobre{' '}
                      <strong>{generalGradeScale.maxScore}</strong> (ej.{' '}
                      <strong>
                        {(0.85 * generalGradeScale.maxScore).toFixed(1).replace(/\.0$/, '')}
                      </strong>
                      ), igual que al importar desde Forms o planillas.
                    </p>
                    {convertible100CountInSubcat > 0 && onConvertSubcat100ToGeneral && (
                      <button
                        type="button"
                        onClick={() => {
                          const count = onConvertSubcat100ToGeneral(subcatToEdit.subId);
                          setConvertedNowFeedback(count);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>
                          Convertir ahora {convertible100CountInSubcat} nota(s) &gt;{' '}
                          {generalGradeScale.maxScore} cargadas
                        </span>
                      </button>
                    )}
                    {convertedNowFeedback !== null && (
                      <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        Se convirtieron {convertedNowFeedback} calificación(es) a escala sobre{' '}
                        {generalGradeScale.maxScore}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Sección: Instancias de la Evaluación (para TODOS los alumnos — ej: Escrita + Oral) */}
              {onAddEvaluationInstance && activeSubcatLive && (
                <div
                  className={`p-3.5 rounded-xl border space-y-2.5 ${
                    isDarkMode
                      ? 'bg-indigo-950/30 border-indigo-500/45'
                      : 'bg-indigo-50/75 border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-300">
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>Instancias de esta evaluación (para todos los alumnos)</span>
                    </div>
                    {existingEvalInstances.length > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isDarkMode
                            ? 'bg-indigo-900/70 text-indigo-200'
                            : 'bg-indigo-200/80 text-indigo-950'
                        }`}
                      >
                        {existingEvalInstances.length + 1} instancias
                      </span>
                    )}
                  </div>

                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Usalo cuando una misma evaluación, TP o desempeño tiene más de una parte para todo el curso (por ejemplo: <strong>Escrita + Oral</strong>, <strong>Teórico + Práctico</strong> o <strong>Parte 1 + Parte 2</strong>). Todas aparecen agrupadas bajo <strong>"{editSubcatName.trim() || subcatToEdit.name}"</strong> con color propio.
                  </p>

                  {/* Lista de instancias ya creadas */}
                  {existingEvalInstances.length > 0 && (
                    <div className="space-y-2">
                      <div
                        className={`rounded-lg border divide-y ${
                          isDarkMode
                            ? 'bg-slate-900/80 border-slate-700 divide-slate-800'
                            : 'bg-white border-indigo-200/90 divide-neutral-100'
                        }`}
                      >
                        {/* 1° instancia (columna principal) */}
                        <div className="px-2.5 py-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="font-bold text-xs truncate">
                              1. {getPrimaryInstanceLabel(activeSubcatLive)}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                                isDarkMode
                                  ? 'bg-slate-800 text-indigo-300'
                                  : 'bg-indigo-100/80 text-indigo-900'
                              }`}
                            >
                              1° columna
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const catId = subcatToEdit.catId;
                              const subId = subcatToEdit.subId;
                              setSubcatToEdit(null);
                              setEvaluationInstanceToEdit?.({
                                catId,
                                subId,
                                instanceId: '__primary__',
                              });
                            }}
                            className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                              isDarkMode
                                ? 'bg-slate-800 hover:bg-slate-700 text-indigo-300'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            Editar / Importar
                          </button>
                        </div>

                        {existingEvalInstances.map((eInst, eIdx) => (
                          <div
                            key={eInst.id}
                            className="px-2.5 py-2 flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const catId = subcatToEdit.catId;
                                const subId = subcatToEdit.subId;
                                setSubcatToEdit(null);
                                setEvaluationInstanceToEdit?.({
                                  catId,
                                  subId,
                                  instanceId: eInst.id,
                                });
                              }}
                              className="text-left min-w-0 flex-1 hover:underline cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-xs truncate">
                                  {eIdx + 2}. {eInst.name}
                                </span>
                                {eInst.scaleMode && eInst.scaleMode !== 'general' && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                                      isDarkMode
                                        ? 'bg-slate-800 text-sky-300'
                                        : 'bg-sky-100 text-sky-900'
                                    }`}
                                  >
                                    {eInst.scaleMode === 'convert_100'
                                      ? `/100→${generalGradeScale.maxScore}`
                                      : `/${eInst.maxScore ?? generalGradeScale.maxScore}`}
                                  </span>
                                )}
                              </div>
                              {eInst.customTitle && (
                                <div className="text-[10px] opacity-75 truncate">
                                  Detalle: {eInst.customTitle}
                                </div>
                              )}
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const catId = subcatToEdit.catId;
                                  const subId = subcatToEdit.subId;
                                  setSubcatToEdit(null);
                                  setEvaluationInstanceToEdit?.({
                                    catId,
                                    subId,
                                    instanceId: eInst.id,
                                  });
                                }}
                                className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                                  isDarkMode
                                    ? 'bg-slate-800 hover:bg-slate-700 text-indigo-300'
                                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800'
                                }`}
                              >
                                Editar / Importar
                              </button>
                              {onDeleteEvaluationInstance && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteEvaluationInstance(
                                      subcatToEdit.catId,
                                      subcatToEdit.subId,
                                      eInst.id
                                    )
                                  }
                                  className="p-1 text-neutral-400 hover:text-red-500 rounded cursor-pointer"
                                  title={`Eliminar instancia "${eInst.name}"`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Modo de combinación en el promedio */}
                      {onUpdateEvaluationInstancesMeta && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                            En el promedio:
                          </span>
                          {(
                            [
                              { id: 'average' as const, label: 'Promediar entre sí (1 nota)' },
                              { id: 'sum' as const, label: 'Sumar puntajes (1 nota)' },
                              { id: 'separate' as const, label: 'Contar por separado' },
                            ] as const
                          ).map((modeOpt) => {
                            const activeMode =
                              activeSubcatLive.instancesCombineMode || 'average';
                            const isSelected = activeMode === modeOpt.id;
                            return (
                              <button
                                key={modeOpt.id}
                                type="button"
                                onClick={() => {
                                  setNewEvalCombineMode(modeOpt.id);
                                  onUpdateEvaluationInstancesMeta(
                                    subcatToEdit.catId,
                                    subcatToEdit.subId,
                                    { instancesCombineMode: modeOpt.id }
                                  );
                                }}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : isDarkMode
                                    ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                    : 'bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-100/70'
                                }`}
                              >
                                {modeOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Agregar nueva instancia */}
                  <div className="space-y-2 pt-1">
                    {existingEvalInstances.length === 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-neutral-600 dark:text-slate-400 block mb-0.5">
                            Nombre de la 1° instancia (notas actuales)
                          </label>
                          <input
                            type="text"
                            value={newEvalPrimaryName}
                            onChange={(e) => setNewEvalPrimaryName(e.target.value)}
                            placeholder="Ej: Escrita, Teórica, Parte 1..."
                            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-white'
                                : 'bg-white border-indigo-200 text-neutral-900'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-neutral-600 dark:text-slate-400 block mb-0.5">
                            Cómo se combinan en el promedio
                          </label>
                          <select
                            value={newEvalCombineMode}
                            onChange={(e) =>
                              setNewEvalCombineMode(
                                e.target.value as EvaluationInstancesCombineMode
                              )
                            }
                            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-white'
                                : 'bg-white border-indigo-200 text-neutral-900'
                            }`}
                          >
                            <option value="average">Promediar instancias (1 nota)</option>
                            <option value="sum">Sumar puntajes (ej. 5 + 5)</option>
                            <option value="separate">Contar cada instancia por separado</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-0.5">
                        Instancia rápida:
                      </span>
                      {EVALUATION_INSTANCE_PRESETS.slice(0, 6).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setNewEvalInstanceName(preset)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                            newEvalInstanceName.toLowerCase() === preset.toLowerCase()
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                              : 'bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-100/70'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newEvalInstanceName}
                        onChange={(e) => setNewEvalInstanceName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleConfirmAddEvalInstance();
                          }
                        }}
                        placeholder="Ej: Oral, Práctica, Defensa, Parte 2..."
                        className={`flex-1 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-indigo-300 text-neutral-900'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleConfirmAddEvalInstance}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Sección: Instancias de Intensificación / Recuperación */}
              {onAddIntensification && activeSubcatLive && (
                <div
                  className={`p-3.5 rounded-xl border space-y-2.5 ${
                    isDarkMode
                      ? 'bg-amber-950/25 border-amber-500/40'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Instancias de {intensificationDefaultLabel} / Recuperación
                      </span>
                    </div>
                    {existingInstCount > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isDarkMode
                            ? 'bg-amber-900/60 text-amber-200'
                            : 'bg-amber-200/70 text-amber-900'
                        }`}
                      >
                        {existingInstCount} activa{existingInstCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Divide la columna bajo el título <strong>"{editSubcatName.trim() || subcatToEdit.name}"</strong>. Quienes tengan nota <strong>≥ {effectiveNewPassingScore}</strong> quedan con una línea (<strong>—</strong>) por defecto (editable si decidís evaluarlos igual). Las intensificaciones quedan fuera del promedio.
                  </p>

                  {/* Lista de intensificaciones ya creadas */}
                  {activeSubcatLive.intensifications && activeSubcatLive.intensifications.length > 0 && (
                    <div
                      className={`rounded-lg border divide-y ${
                        isDarkMode
                          ? 'bg-slate-900/80 border-slate-700 divide-slate-800'
                          : 'bg-white border-amber-200/80 divide-neutral-100'
                      }`}
                    >
                      {activeSubcatLive.intensifications.map((inst, iIdx) => (
                        <div
                          key={inst.id}
                          className="px-2.5 py-2 flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const catId = subcatToEdit.catId;
                              const subId = subcatToEdit.subId;
                              setSubcatToEdit(null);
                              setIntensificationToEdit?.({
                                catId,
                                subId,
                                instId: inst.id,
                              });
                            }}
                            className="text-left min-w-0 flex-1 hover:underline cursor-pointer"
                            title="Hacé clic para editar esta instancia o importar notas directamente"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-bold text-xs truncate">
                                {iIdx + 1}. {inst.name}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                                  isDarkMode
                                    ? 'bg-slate-800 text-amber-300'
                                    : 'bg-amber-100/80 text-amber-900'
                                }`}
                                title="Nota mínima para quedar aprobado con línea (—)"
                              >
                                mín. {getIntensificationPassingThreshold(inst)}
                              </span>
                            </div>
                            {inst.customTitle && (
                              <div className="text-[10px] opacity-75 truncate">
                                Detalle: {inst.customTitle}
                              </div>
                            )}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const catId = subcatToEdit.catId;
                                const subId = subcatToEdit.subId;
                                setSubcatToEdit(null);
                                setIntensificationToEdit?.({
                                  catId,
                                  subId,
                                  instId: inst.id,
                                });
                              }}
                              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-slate-700 text-blue-300'
                                  : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                              }`}
                              title="Editar nombre o importar notas en esta instancia"
                            >
                              Editar / Importar
                            </button>
                            {onDeleteIntensification && (
                              <button
                                type="button"
                                onClick={() =>
                                  onDeleteIntensification(
                                    subcatToEdit.catId,
                                    subcatToEdit.subId,
                                    inst.id
                                  )
                                }
                                className="p-1 text-neutral-400 hover:text-red-500 rounded cursor-pointer"
                                title={`Eliminar "${inst.name}"`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Agregar nueva instancia */}
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-neutral-500 dark:text-slate-400 mr-0.5">
                        Nombre sugerido:
                      </span>
                      {INTENSIFICATION_LABEL_PRESETS.slice(0, 3).map((preset) => {
                        const suggested =
                          existingInstCount === 0
                            ? preset
                            : `${preset} ${existingInstCount + 1}`;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setNewInstName(suggested)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                              newInstName.toLowerCase().startsWith(preset.toLowerCase())
                                ? 'bg-amber-600 text-white border-amber-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100/70'
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newInstName}
                        onChange={(e) => setNewInstName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleConfirmAddIntensification();
                          }
                        }}
                        placeholder={`Ej: ${intensificationDefaultLabel}, Recuperación...`}
                        className={`flex-1 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-amber-300 text-neutral-900'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleConfirmAddIntensification}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar</span>
                      </button>
                    </div>

                    {/* Nota mínima de aprobación para esta instancia */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                        Nota mínima para aprobar (línea —):
                      </span>
                      <div className="flex items-center gap-1">
                        {INTENSIFICATION_PASSING_SCORE_PRESETS.map((presetScore) => {
                          const isSelected = effectiveNewPassingScore === presetScore;
                          return (
                            <button
                              key={presetScore}
                              type="button"
                              onClick={() => setNewInstPassingScore(String(presetScore))}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-amber-600 text-white border-amber-600'
                                  : isDarkMode
                                  ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                  : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100/70'
                              }`}
                            >
                              {presetScore}
                            </button>
                          );
                        })}
                        <input
                          type="number"
                          min={1}
                          max={10}
                          step={0.5}
                          value={newInstPassingScore}
                          onChange={(e) => setNewInstPassingScore(e.target.value)}
                          aria-label="Nota mínima de aprobación personalizada"
                          title="Ingresá cualquier nota mínima entre 1 y 10"
                          className={`w-14 px-2 py-0.5 text-center text-xs font-bold rounded-md border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-white'
                              : 'bg-white border-amber-300 text-neutral-900'
                          }`}
                        />
                      </div>
                    </div>

                    <input
                      type="text"
                      value={newInstCustomTitle}
                      onChange={(e) => setNewInstCustomTitle(e.target.value)}
                      placeholder={`Especificación opcional (por defecto comparte "${editSubcatName.trim() || subcatToEdit.name}")`}
                      className={`w-full px-2.5 py-1.5 text-[11px] rounded-lg border focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                        isDarkMode
                          ? 'bg-slate-900/70 border-slate-700 text-slate-200 placeholder-slate-500'
                          : 'bg-white/90 border-amber-200/90 text-neutral-800 placeholder-neutral-400'
                      }`}
                    />

                    {(onUpdateDefaultIntensificationLabel ||
                      onUpdateDefaultIntensificationPassingScore) && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveAsDefaultTerm}
                          onChange={(e) => setSaveAsDefaultTerm(e.target.checked)}
                          className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <span>Guardar nombre y nota mínima como predeterminados</span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Importar notas directamente con esta columna como destino */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Importar notas directamente en "{editSubcatName.trim() || subcatToEdit.name}":
                      </span>
                    </div>
                  </div>
                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Elegí desde dónde importar las calificaciones con esta columna ya seleccionada como destino:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'forms');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-200'
                          : 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs'
                      }`}
                    >
                      <FileCheck className="w-4 h-4 text-purple-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Google Forms</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Formulario o planilla de respuestas
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'sheets');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                          : 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs'
                      }`}
                    >
                      <Link2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Google Sheets / Docs</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Link o archivo de Google Drive
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'file');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-200'
                          : 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs'
                      }`}
                    >
                      <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Subir Archivo</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Excel (.xlsx), Word (.docx) o CSV
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const target = {
                          categoryId: subcatToEdit.catId,
                          subcategoryId: subcatToEdit.subId,
                          subcategoryName: editSubcatName.trim() || subcatToEdit.name,
                        };
                        setSubcatToEdit(null);
                        onImportIntoColumn(target, 'paste');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                          : 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs'
                      }`}
                    >
                      <ClipboardPaste className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">Pegar Notas (Ctrl+V)</div>
                        <div className="text-[10px] opacity-75 truncate">
                          Copiar y pegar alumnos y notas
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Cambiar de lugar dentro de la categoría */}
              {onMoveSubcategory &&
                activeSubcatParentCat &&
                activeSubcatParentCat.subcategories.length > 1 &&
                activeSubcatIndex >= 0 && (
                  <div className="space-y-1.5">
                    <label className="font-semibold text-neutral-700 dark:text-slate-300">
                      Posición dentro de "{activeSubcatParentCat.name}" ({activeSubcatIndex + 1} de{' '}
                      {activeSubcatParentCat.subcategories.length})
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={activeSubcatIndex <= 0}
                        onClick={() =>
                          onMoveSubcategory(
                            activeSubcatParentCat.id,
                            activeSubcatIndex,
                            activeSubcatIndex - 1
                          )
                        }
                        className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                            : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Mover antes (Izq.)</span>
                      </button>
                      <button
                        type="button"
                        disabled={
                          activeSubcatIndex >= activeSubcatParentCat.subcategories.length - 1
                        }
                        onClick={() =>
                          onMoveSubcategory(
                            activeSubcatParentCat.id,
                            activeSubcatIndex,
                            activeSubcatIndex + 1
                          )
                        }
                        className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                            : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <span>Mover después (Der.)</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              {/* Cambiar a otra Categoría Mayor */}
              {onMoveSubcategoryToCategory && categories.length > 1 && (
                <div className="space-y-1">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Categoría Mayor a la que pertenece:
                  </label>
                  <select
                    value={subcatToEdit.catId}
                    onChange={(e) => {
                      const nextCatId = e.target.value;
                      if (nextCatId && nextCatId !== subcatToEdit.catId) {
                        onMoveSubcategoryToCategory(
                          subcatToEdit.catId,
                          subcatToEdit.subId,
                          nextCatId
                        );
                        setSubcatToEdit({
                          ...subcatToEdit,
                          catId: nextCatId,
                        });
                      }
                    }}
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-hidden cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  handleDeleteSubcategory(subcatToEdit.catId, subcatToEdit.subId);
                  setSubcatToEdit(null);
                }}
                className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar columna</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubcatToEdit(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editSubcatName.trim()}
                  onClick={() => handleSaveEditSubcategory(buildSubcatScalePayload())}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar / Importar en Instancia de Intensificación o Recuperación */}
      {intensificationToEdit && activeInstParentCat && activeInstParentSub && activeInstLive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIntensificationToEdit?.(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold truncate">
                    {activeInstLive.name}
                  </h3>
                  <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Evaluación: <strong>{activeInstParentSub.name}</strong> ({activeInstParentCat.name})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIntensificationToEdit?.(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Nombre de la instancia (por normativa o costumbre) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Nombre de esta instancia (etiqueta de la columna)
                  </label>
                  {onUpdateDefaultIntensificationLabel &&
                    editInstName.trim() &&
                    editInstName.trim().replace(/\s+\d+$/, '').toLowerCase() !==
                      intensificationDefaultLabel.toLowerCase() && (
                      <button
                        type="button"
                        onClick={() => {
                          const base =
                            editInstName.trim().replace(/\s+\d+$/, '').trim() ||
                            editInstName.trim();
                          onUpdateDefaultIntensificationLabel(base);
                          setSavedDefaultFeedback(true);
                          setTimeout(() => setSavedDefaultFeedback(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                        title="Usar este nombre por defecto cada vez que agregues nuevas instancias"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>
                          {savedDefaultFeedback
                            ? 'Guardado por defecto'
                            : 'Usar como predeterminado'}
                        </span>
                      </button>
                    )}
                </div>
                <input
                  type="text"
                  value={editInstName}
                  onChange={(e) => setEditInstName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditIntensification()}
                  placeholder="Ej: Intensificación, Recuperación, Recuperatorio..."
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-1">
                  {INTENSIFICATION_LABEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setEditInstName(
                          activeInstIndex > 0 ? `${preset} ${activeInstIndex + 1}` : preset
                        )
                      }
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                        editInstName.toLowerCase().startsWith(preset.toLowerCase())
                          ? 'bg-amber-600 text-white border-amber-600'
                          : isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Especificación / Título editable */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Título / especificación (opcional — si queda vacío comparte "{activeInstParentSub.name}")
                </label>
                <input
                  type="text"
                  value={editInstCustomTitle}
                  onChange={(e) => setEditInstCustomTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEditIntensification()}
                  placeholder={`Ej: ${activeInstParentSub.name} (Solo punto 2 / Oral / Diciembre)`}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
                <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  En informes y desglose figurará como:{' '}
                  <strong className={isDarkMode ? 'text-slate-200' : 'text-neutral-800'}>
                    {getIntensificationDisplayLabel(activeInstParentSub, {
                      ...activeInstLive,
                      name: editInstName.trim() || activeInstLive.name,
                      customTitle: editInstCustomTitle.trim() || undefined,
                    })}
                  </strong>
                </p>
              </div>

              {/* Nota mínima de aprobación para esta instancia */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Nota mínima para aprobar (quienes la alcanzan quedan con línea —)
                  </label>
                  {onUpdateDefaultIntensificationPassingScore &&
                    effectiveEditPassingScore !== intensificationDefaultPassingScore && (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateDefaultIntensificationPassingScore(effectiveEditPassingScore);
                          setSavedDefaultScoreFeedback(true);
                          setTimeout(() => setSavedDefaultScoreFeedback(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer shrink-0"
                        title="Usar esta nota mínima por defecto en nuevas instancias"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>
                          {savedDefaultScoreFeedback
                            ? 'Guardada por defecto'
                            : 'Usar como predeterminada'}
                        </span>
                      </button>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {INTENSIFICATION_PASSING_SCORE_PRESETS.map((presetScore) => {
                    const isSelected = effectiveEditPassingScore === presetScore;
                    return (
                      <button
                        key={presetScore}
                        type="button"
                        onClick={() => setEditInstPassingScore(String(presetScore))}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-600 text-white border-amber-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        ≥ {presetScore}
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-1.5 ml-1">
                    <span className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Otra:
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={0.5}
                      value={editInstPassingScore}
                      onChange={(e) => setEditInstPassingScore(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEditIntensification()}
                      aria-label="Nota mínima de aprobación"
                      className={`w-16 px-2 py-1 text-center text-xs font-bold rounded-lg border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white'
                          : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* TODAS las opciones de importar notas (idénticas a evaluaciones y trabajos prácticos) */}
              {onImportIntoColumn && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDarkMode
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Importar notas directamente en "{editInstName.trim() || activeInstLive.name}":
                    </span>
                  </div>
                  <p
                    className={`text-[11px] leading-snug ${
                      isDarkMode ? 'text-slate-300' : 'text-neutral-600'
                    }`}
                  >
                    Elegí desde dónde importar las notas para esta instancia (quienes no figuren y tengan ≥ {effectiveEditPassingScore} permanecen con línea <strong>—</strong>; no afecta el promedio):
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                    {(
                      [
                        {
                          source: 'forms' as const,
                          title: 'Google Forms',
                          subtitle: 'Formulario o planilla de respuestas',
                          icon: FileCheck,
                          iconColor: 'text-purple-500',
                          darkCls: 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-200',
                          lightCls: 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs',
                        },
                        {
                          source: 'sheets' as const,
                          title: 'Google Sheets / Docs',
                          subtitle: 'Link o archivo de Google Drive',
                          icon: Link2,
                          iconColor: 'text-emerald-500',
                          darkCls: 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-200',
                          lightCls: 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs',
                        },
                        {
                          source: 'file' as const,
                          title: 'Subir Archivo',
                          subtitle: 'Excel (.xlsx), Word (.docx) o CSV',
                          icon: Upload,
                          iconColor: 'text-blue-500',
                          darkCls: 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-200',
                          lightCls: 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs',
                        },
                        {
                          source: 'paste' as const,
                          title: 'Pegar Notas (Ctrl+V)',
                          subtitle: 'Copiar y pegar alumnos y notas',
                          icon: ClipboardPaste,
                          iconColor: 'text-indigo-500',
                          darkCls: 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-200',
                          lightCls: 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs',
                        },
                      ] as const
                    ).map((item) => {
                      const IconComp = item.icon;
                      return (
                        <button
                          key={item.source}
                          type="button"
                          onClick={() => {
                            const displayLabel = getIntensificationDisplayLabel(
                              activeInstParentSub,
                              {
                                ...activeInstLive,
                                name: editInstName.trim() || activeInstLive.name,
                                customTitle: editInstCustomTitle.trim() || undefined,
                              }
                            );
                            const target = {
                              categoryId: activeInstParentCat.id,
                              subcategoryId: activeInstLive.id,
                              subcategoryName: displayLabel,
                            };
                            setIntensificationToEdit?.(null);
                            onImportIntoColumn(target, item.source);
                          }}
                          className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                            isDarkMode ? item.darkCls : item.lightCls
                          }`}
                        >
                          <IconComp className={`w-4 h-4 ${item.iconColor} shrink-0`} />
                          <div className="min-w-0">
                            <div className="font-bold text-xs truncate">{item.title}</div>
                            <div className="text-[10px] opacity-75 truncate">{item.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Reordenar si hay más de una intensificación */}
              {onMoveIntensification && activeInstList.length > 1 && activeInstIndex >= 0 && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-slate-300">
                    Orden de instancia ({activeInstIndex + 1} de {activeInstList.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeInstIndex <= 0}
                      onClick={() =>
                        onMoveIntensification(
                          activeInstParentCat.id,
                          activeInstParentSub.id,
                          activeInstIndex,
                          activeInstIndex - 1
                        )
                      }
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Mover antes</span>
                    </button>
                    <button
                      type="button"
                      disabled={activeInstIndex >= activeInstList.length - 1}
                      onClick={() =>
                        onMoveIntensification(
                          activeInstParentCat.id,
                          activeInstParentSub.id,
                          activeInstIndex,
                          activeInstIndex + 1
                        )
                      }
                      className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                          : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <span>Mover después</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Atajo para agregar otra instancia a la misma evaluación */}
              {onAddIntensification && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = activeInstList.length + 1;
                      onAddIntensification(
                        activeInstParentCat.id,
                        activeInstParentSub.id,
                        `${intensificationDefaultLabel} ${nextIdx}`,
                        undefined,
                        effectiveEditPassingScore
                      );
                    }}
                    className={`w-full py-2 px-3 rounded-xl border border-dashed text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'border-amber-500/40 text-amber-300 hover:bg-amber-950/30'
                        : 'border-amber-300 text-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      Agregar otra instancia ({intensificationDefaultLabel} {activeInstList.length + 1}) a "{activeInstParentSub.name}"
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              {onDeleteIntensification ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteIntensification(
                      activeInstParentCat.id,
                      activeInstParentSub.id,
                      activeInstLive.id
                    );
                    setIntensificationToEdit?.(null);
                  }}
                  className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar instancia</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIntensificationToEdit?.(null)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!editInstName.trim()}
                  onClick={handleSaveEditIntensification}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar / Importar en Instancia de Evaluación (ej. Escrita, Oral, Práctica) */}
      {evaluationInstanceToEdit &&
        activeEvalInstParentCat &&
        activeEvalInstParentSub &&
        (isEditingPrimaryInstance || activeEvalInstLive) && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => setEvaluationInstanceToEdit?.(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-800 text-white'
                  : 'bg-white border-neutral-200 text-neutral-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold truncate">
                      {isEditingPrimaryInstance
                        ? getPrimaryInstanceLabel(activeEvalInstParentSub)
                        : activeEvalInstLive?.name}
                    </h3>
                    <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Evaluación: <strong>{activeEvalInstParentSub.name}</strong> ({activeEvalInstParentCat.name})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEvaluationInstanceToEdit?.(null)}
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Nombre de la instancia */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                    Nombre de esta instancia (etiqueta de la columna)
                  </label>
                  <input
                    type="text"
                    value={editEvalInstName}
                    onChange={(e) => setEditEvalInstName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEditEvalInstance()}
                    placeholder="Ej: Escrita, Oral, Práctica, Defensa..."
                    className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    {EVALUATION_INSTANCE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEditEvalInstName(preset)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                          editEvalInstName.toLowerCase() === preset.toLowerCase()
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Especificación y escala propia (para instancias adicionales) */}
                {!isEditingPrimaryInstance && activeEvalInstLive && (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                        Detalle / especificación (opcional)
                      </label>
                      <input
                        type="text"
                        value={editEvalInstCustomTitle}
                        onChange={(e) => setEditEvalInstCustomTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEditEvalInstance()}
                        placeholder={`Ej: ${activeEvalInstParentSub.name} (Exposición grupal)`}
                        className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                            : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                        }`}
                      />
                    </div>

                    <div
                      className={`p-3 rounded-xl border space-y-2 ${
                        isDarkMode
                          ? 'bg-slate-800/60 border-slate-700'
                          : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-slate-200">
                        <Scale className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Escala de esta instancia</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            { id: 'inherit' as const, label: 'Heredar de la evaluación' },
                            { id: 'custom' as const, label: 'Escala propia (ej. 1–5)' },
                            {
                              id: 'convert_100' as const,
                              label: `Sobre 100 → /${generalGradeScale.maxScore}`,
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setEditEvalInstScaleMode(opt.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              editEvalInstScaleMode === opt.id
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {editEvalInstScaleMode === 'custom' && (
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <div>
                            <label className="text-[10px] font-semibold opacity-75 block mb-0.5">
                              Mínimo
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={editEvalInstMinStr}
                              onChange={(e) => setEditEvalInstMinStr(e.target.value)}
                              className={`w-full px-2 py-1 text-center text-xs font-bold rounded-lg border ${
                                isDarkMode
                                  ? 'bg-slate-900 border-slate-700 text-white'
                                  : 'bg-white border-neutral-300 text-neutral-900'
                              }`}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold opacity-75 block mb-0.5">
                              Máximo
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              step={0.5}
                              value={editEvalInstMaxStr}
                              onChange={(e) => setEditEvalInstMaxStr(e.target.value)}
                              className={`w-full px-2 py-1 text-center text-xs font-bold rounded-lg border ${
                                isDarkMode
                                  ? 'bg-slate-900 border-slate-700 text-white'
                                  : 'bg-white border-neutral-300 text-neutral-900'
                              }`}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold opacity-75 block mb-0.5">
                              Aprueba con
                            </label>
                            <input
                              type="number"
                              min={0.5}
                              max={1000}
                              step={0.5}
                              value={editEvalInstPassStr}
                              onChange={(e) => setEditEvalInstPassStr(e.target.value)}
                              className={`w-full px-2 py-1 text-center text-xs font-bold rounded-lg border ${
                                isDarkMode
                                  ? 'bg-slate-900 border-slate-700 text-white'
                                  : 'bg-white border-neutral-300 text-neutral-900'
                              }`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Importar notas directamente en esta instancia */}
                {onImportIntoColumn && (
                  <div
                    className={`p-3 rounded-xl border space-y-2 ${
                      isDarkMode
                        ? 'bg-emerald-950/30 border-emerald-500/40'
                        : 'bg-emerald-50/70 border-emerald-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Importar notas directamente en "{editEvalInstName.trim() || 'esta instancia'}":
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                      {(
                        [
                          {
                            source: 'forms' as const,
                            title: 'Google Forms',
                            subtitle: 'Formulario o planilla de respuestas',
                            icon: FileCheck,
                            iconColor: 'text-purple-500',
                            darkCls: 'bg-slate-900/90 hover:bg-purple-950/60 border-purple-500/40 text-purple-200',
                            lightCls: 'bg-white hover:bg-purple-50 border-purple-200 text-purple-900 shadow-2xs',
                          },
                          {
                            source: 'sheets' as const,
                            title: 'Google Sheets / Docs',
                            subtitle: 'Link o archivo de Google Drive',
                            icon: Link2,
                            iconColor: 'text-emerald-500',
                            darkCls: 'bg-slate-900/90 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-200',
                            lightCls: 'bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-900 shadow-2xs',
                          },
                          {
                            source: 'file' as const,
                            title: 'Subir Archivo',
                            subtitle: 'Excel (.xlsx), Word (.docx) o CSV',
                            icon: Upload,
                            iconColor: 'text-blue-500',
                            darkCls: 'bg-slate-900/90 hover:bg-blue-950/60 border-blue-500/40 text-blue-200',
                            lightCls: 'bg-white hover:bg-blue-50 border-blue-200 text-blue-900 shadow-2xs',
                          },
                          {
                            source: 'paste' as const,
                            title: 'Pegar Notas (Ctrl+V)',
                            subtitle: 'Copiar y pegar alumnos y notas',
                            icon: ClipboardPaste,
                            iconColor: 'text-indigo-500',
                            darkCls: 'bg-slate-900/90 hover:bg-indigo-950/60 border-indigo-500/40 text-indigo-200',
                            lightCls: 'bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-900 shadow-2xs',
                          },
                        ] as const
                      ).map((item) => {
                        const IconComp = item.icon;
                        return (
                          <button
                            key={item.source}
                            type="button"
                            onClick={() => {
                              const targetSubId = isEditingPrimaryInstance
                                ? activeEvalInstParentSub.id
                                : activeEvalInstLive!.id;
                              const displayLabel = isEditingPrimaryInstance
                                ? getPrimaryInstanceDisplayLabel({
                                    ...activeEvalInstParentSub,
                                    primaryInstanceName:
                                      editEvalInstName.trim() ||
                                      activeEvalInstParentSub.primaryInstanceName,
                                  })
                                : getEvaluationInstanceDisplayLabel(activeEvalInstParentSub, {
                                    ...activeEvalInstLive!,
                                    name: editEvalInstName.trim() || activeEvalInstLive!.name,
                                    customTitle: editEvalInstCustomTitle.trim() || undefined,
                                  });
                              setEvaluationInstanceToEdit?.(null);
                              onImportIntoColumn(
                                {
                                  categoryId: activeEvalInstParentCat.id,
                                  subcategoryId: targetSubId,
                                  subcategoryName: displayLabel,
                                },
                                item.source
                              );
                            }}
                            className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                              isDarkMode ? item.darkCls : item.lightCls
                            }`}
                          >
                            <IconComp className={`w-4 h-4 ${item.iconColor} shrink-0`} />
                            <div className="min-w-0">
                              <div className="font-bold text-xs truncate">{item.title}</div>
                              <div className="text-[10px] opacity-75 truncate">{item.subtitle}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reordenar si hay más de una instancia adicional */}
                {!isEditingPrimaryInstance &&
                  onMoveEvaluationInstance &&
                  activeEvalInstList.length > 1 &&
                  activeEvalInstIndex >= 0 && (
                    <div className="space-y-1.5">
                      <label className="font-semibold text-neutral-700 dark:text-slate-300">
                        Orden de instancia ({activeEvalInstIndex + 2} de {activeEvalInstList.length + 1})
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={activeEvalInstIndex <= 0}
                          onClick={() =>
                            onMoveEvaluationInstance(
                              activeEvalInstParentCat.id,
                              activeEvalInstParentSub.id,
                              activeEvalInstIndex,
                              activeEvalInstIndex - 1
                            )
                          }
                          className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                              : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Mover antes</span>
                        </button>
                        <button
                          type="button"
                          disabled={activeEvalInstIndex >= activeEvalInstList.length - 1}
                          onClick={() =>
                            onMoveEvaluationInstance(
                              activeEvalInstParentCat.id,
                              activeEvalInstParentSub.id,
                              activeEvalInstIndex,
                              activeEvalInstIndex + 1
                            )
                          }
                          className={`flex-1 py-1.5 px-3 rounded-xl border font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            isDarkMode
                              ? 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-200'
                              : 'bg-neutral-50 border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          <span>Mover después</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                {/* Atajo para agregar otra instancia */}
                {onAddEvaluationInstance && (
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const nextNum = activeEvalInstList.length + 2;
                        onAddEvaluationInstance(
                          activeEvalInstParentCat.id,
                          activeEvalInstParentSub.id,
                          `Instancia ${nextNum}`
                        );
                      }}
                      className={`w-full py-2 px-3 rounded-xl border border-dashed text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'border-indigo-500/45 text-indigo-300 hover:bg-indigo-950/35'
                          : 'border-indigo-300 text-indigo-800 hover:bg-indigo-50'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>
                        Agregar otra instancia (Instancia {activeEvalInstList.length + 2}) a "{activeEvalInstParentSub.name}"
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
                {!isEditingPrimaryInstance && activeEvalInstLive && onDeleteEvaluationInstance ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteEvaluationInstance(
                        activeEvalInstParentCat.id,
                        activeEvalInstParentSub.id,
                        activeEvalInstLive.id
                      );
                      setEvaluationInstanceToEdit?.(null);
                    }}
                    className="text-xs text-red-500 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar instancia</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-neutral-400">
                    Columna principal de la evaluación
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEvaluationInstanceToEdit?.(null)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!editEvalInstName.trim()}
                    onClick={handleSaveEditEvalInstance}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Guardar Cambios</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </>
  );
};

