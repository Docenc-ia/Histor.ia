import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Calculator,
  FileSpreadsheet,
  Download,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Award,
  Copy,
  ClipboardCheck,
  ExternalLink,
} from 'lucide-react';
import { Student } from '../../types';
import { GradeCategory, GradeSubcategory, StudentGradesMap } from '../../types/grades';
import { AnnualSummaryView } from './AnnualSummaryView';
import {
  PreliminaryValuationModal,
  PreliminaryValuationRecord,
} from './PreliminaryValuationModal';
import { sheetsService } from '../../services/workspace/sheetsService';
import { firestoreSync, getActiveUserId } from '../../services/firestoreSync';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { copyTableToClipboard, isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import { api } from '../../services/api';

export type GradebookTerm = '1c' | '2c' | 'annual';

export interface GradebookMatrixProps {
  courseId: string;
  courseName: string;
  students: Student[];
  isDarkMode: boolean;
  activeTerm?: GradebookTerm;
  onTermChange?: (term: GradebookTerm) => void;
  driveFolderId?: string;
  driveFolderUrl?: string;
}

export const DEFAULT_CATEGORIES: GradeCategory[] = [
  {
    id: 'cat-eval',
    name: 'Evaluaciones',
    color: 'bg-blue-500',
    subcategories: [
      { id: 'sub-escrita', name: 'Evaluación Escrita', maxScore: 10 },
      { id: 'sub-oral', name: 'Evaluación Oral', maxScore: 10 },
    ],
  },
  {
    id: 'cat-tp',
    name: 'Trabajos Prácticos',
    color: 'bg-emerald-500',
    subcategories: [
      { id: 'sub-tp1', name: 'TP N° 1 Individual', maxScore: 10 },
      { id: 'sub-tp2', name: 'TP N° 2 Grupal', maxScore: 10 },
    ],
  },
  {
    id: 'cat-part',
    name: 'Desempeño y Tareas',
    color: 'bg-purple-500',
    subcategories: [
      { id: 'sub-cuaderno', name: 'Carpeta / Guías', maxScore: 10 },
    ],
  },
];

const CATEGORY_COLORS = [
  { name: 'Azul', border: 'border-blue-500', headerBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', badge: 'bg-blue-500' },
  { name: 'Esmeralda', border: 'border-emerald-500', headerBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40', badge: 'bg-emerald-500' },
  { name: 'Púrpura', border: 'border-purple-500', headerBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40', badge: 'bg-purple-500' },
  { name: 'Ámbar', border: 'border-amber-500', headerBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40', badge: 'bg-amber-500' },
  { name: 'Índigo', border: 'border-indigo-500', headerBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40', badge: 'bg-indigo-500' },
  { name: 'Rosa', border: 'border-rose-500', headerBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:bg-rose-950/40', badge: 'bg-rose-500' },
];

export const GradebookMatrix: React.FC<GradebookMatrixProps> = ({
  courseId,
  courseName,
  students,
  isDarkMode,
  activeTerm,
  onTermChange,
  driveFolderId,
  driveFolderUrl,
}) => {
  const [internalTerm, setInternalTerm] = useState<GradebookTerm>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`fds_grades_active_term_${courseId}`);
        if (saved === '1c' || saved === '2c' || saved === 'annual') return saved as GradebookTerm;
      } catch (_) {}
    }
    return '1c';
  });
  const currentTerm = activeTerm || internalTerm;
  const setTerm = (t: GradebookTerm) => {
    setInternalTerm(t);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`fds_grades_active_term_${courseId}`, t);
    }
    if (onTermChange) {
      onTermChange(t);
    }
  };

  const getCatKey = (t: '1c' | '2c') => `fds_grades_categories_${courseId}_${t}`;
  const getGradesKey = (t: '1c' | '2c') => `fds_grades_data_${courseId}_${t}`;
  const getCalcKey = (t: '1c' | '2c') => `fds_grades_final_calc_${courseId}_${t}`;
  const STORAGE_KEY_ANNUAL_OVERRIDES = `fds_grades_annual_override_${courseId}`;

  // 1° Cuatrimestre Categories
  const [categories1c, setCategories1c] = useState<GradeCategory[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          localStorage.getItem(getCatKey('1c')) ||
          localStorage.getItem(`fds_grades_categories_${courseId}`);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return DEFAULT_CATEGORIES;
  });

  // 1° Cuatrimestre Grades Map
  const [gradesMap1c, setGradesMap1c] = useState<StudentGradesMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          localStorage.getItem(getGradesKey('1c')) ||
          localStorage.getItem(`fds_grades_data_${courseId}`);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // 1° Cuatrimestre Final Calc Mode
  const [overallCalc1c, setOverallCalc1c] = useState<'average_of_categories' | 'manual_final'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved =
          localStorage.getItem(getCalcKey('1c')) ||
          localStorage.getItem(`fds_grades_final_calc_${courseId}`);
        if (saved === 'manual_final' || saved === 'average_of_categories') return saved;
      } catch (_) {}
    }
    return 'manual_final';
  });

  // 2° Cuatrimestre Categories
  const [categories2c, setCategories2c] = useState<GradeCategory[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getCatKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    // Default for 2c: clone 1c structure or defaults
    return DEFAULT_CATEGORIES.map((cat) => ({
      ...cat,
      id: `c2-${cat.id}`,
      subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
    }));
  });

  // 2° Cuatrimestre Grades Map
  const [gradesMap2c, setGradesMap2c] = useState<StudentGradesMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getGradesKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // 2° Cuatrimestre Final Calc Mode
  const [overallCalc2c, setOverallCalc2c] = useState<'average_of_categories' | 'manual_final'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getCalcKey('2c'));
        if (saved === 'manual_final' || saved === 'average_of_categories') return saved;
      } catch (_) {}
    }
    return 'manual_final';
  });

  // Annual overrides
  const [annualOverrides, setAnnualOverrides] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_ANNUAL_OVERRIDES);
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  // Active term variables
  const is2c = currentTerm === '2c';
  const categories = is2c ? categories2c : categories1c;
  const gradesMap = is2c ? gradesMap2c : gradesMap1c;
  const overallCalculation = is2c ? overallCalc2c : overallCalc1c;

  const { token } = useWorkspaceAuth();
  const [isSavingSheets, setIsSavingSheets] = useState(false);
  const [sheetsSavedInfo, setSheetsSavedInfo] = useState<{
    url?: string;
    tabName: string;
    isLiveGoogle: boolean;
  } | null>(null);

  const handleSaveCuatrimestreToSheets = async () => {
    if (currentTerm === 'annual') return;
    setIsSavingSheets(true);
    setSheetsSavedInfo(null);
    const termToSave = currentTerm as '1c' | '2c';
    const catsToSave = is2c ? categories2c : categories1c;
    const gradesToSave = is2c ? gradesMap2c : gradesMap1c;

    try {
      const courseSheet: any = await api.getCourseDispositionSheet(courseId).catch(() => ({}));
      const realExistingId = isRealGoogleSpreadsheetId(courseSheet?.spreadsheetId)
        ? (courseSheet.spreadsheetId as string)
        : undefined;

      const res = await sheetsService.syncGradebookMatrixToSheet(
        { id: courseId, name: courseName },
        termToSave,
        students,
        catsToSave,
        gradesToSave,
        realExistingId,
        undefined,
        token || undefined
      );

      if (res.isLiveGoogle && isRealGoogleSpreadsheetId(res.spreadsheetId)) {
        await api
          .saveCourseDispositionSheet(courseId, {
            spreadsheetId: res.spreadsheetId,
            url: res.url,
            lastSyncedAt: res.updatedAt,
          })
          .catch(() => {});
      }

      // Save term snapshot to Firestore for durable storage across sessions
      const userId = getActiveUserId();
      if (userId) {
        firestoreSync
          .saveTermSnapshot(userId, courseId, termToSave, {
            courseId,
            term: termToSave,
            termLabel: termToSave === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
            categories: catsToSave,
            gradesMap: gradesToSave,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }

      setSheetsSavedInfo({
        url: res.url,
        tabName: res.tabName,
        isLiveGoogle: res.isLiveGoogle,
      });
    } catch (err) {
      console.warn('Error saving grades to sheets:', err);
    } finally {
      setIsSavingSheets(false);
    }
  };

  // Save changes to localStorage for active term
  const saveCategories = (newCategories: GradeCategory[]) => {
    if (is2c) {
      setCategories2c(newCategories);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getCatKey('2c'), JSON.stringify(newCategories));
      }
    } else {
      setCategories1c(newCategories);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getCatKey('1c'), JSON.stringify(newCategories));
        localStorage.setItem(`fds_grades_categories_${courseId}`, JSON.stringify(newCategories));
      }
    }
  };

  const saveGrades = (newGrades: StudentGradesMap) => {
    if (is2c) {
      setGradesMap2c(newGrades);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getGradesKey('2c'), JSON.stringify(newGrades));
      }
    } else {
      setGradesMap1c(newGrades);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getGradesKey('1c'), JSON.stringify(newGrades));
        localStorage.setItem(`fds_grades_data_${courseId}`, JSON.stringify(newGrades));
      }
    }
  };

  const saveOverallCalc = (type: 'average_of_categories' | 'manual_final') => {
    if (is2c) {
      setOverallCalc2c(type);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getCalcKey('2c'), type);
      }
    } else {
      setOverallCalc1c(type);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getCalcKey('1c'), type);
        localStorage.setItem(`fds_grades_final_calc_${courseId}`, type);
      }
    }
  };

  const saveAnnualOverride = (studentId: string, val: string) => {
    const updated = { ...annualOverrides };
    if (!val || val.trim() === '') {
      delete updated[studentId];
    } else {
      updated[studentId] = val.trim();
    }
    setAnnualOverrides(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_ANNUAL_OVERRIDES, JSON.stringify(updated));
    }
  };

  const handleCopyCategoriesFrom1c = () => {
    const cloned = categories1c.map((cat, catIdx) => ({
      ...cat,
      id: `c2-${Date.now()}-${catIdx}-${cat.id}`,
      subcategories: cat.subcategories.map((sub, subIdx) => ({
        ...sub,
        id: `c2-${Date.now()}-${subIdx}-${sub.id}`,
      })),
    }));
    saveCategories(cloned);
  };

  // Listen for external grades or category updates (e.g. disposition notes sent from ClassesModule)
  useEffect(() => {
    const handleGradesUpdated = (e: any) => {
      try {
        const savedCats1c =
          localStorage.getItem(getCatKey('1c')) ||
          localStorage.getItem(`fds_grades_categories_${courseId}`);
        if (savedCats1c) setCategories1c(JSON.parse(savedCats1c));

        const savedGrades1c =
          localStorage.getItem(getGradesKey('1c')) ||
          localStorage.getItem(`fds_grades_data_${courseId}`);
        if (savedGrades1c) setGradesMap1c(JSON.parse(savedGrades1c));

        const savedCats2c = localStorage.getItem(getCatKey('2c'));
        if (savedCats2c) setCategories2c(JSON.parse(savedCats2c));

        const savedGrades2c = localStorage.getItem(getGradesKey('2c'));
        if (savedGrades2c) setGradesMap2c(JSON.parse(savedGrades2c));

        if (e?.detail?.term && (e.detail.term === '1c' || e.detail.term === '2c')) {
          setInternalTerm(e.detail.term);
        }
      } catch (_) {}
    };

    window.addEventListener('fds-grades-updated', handleGradesUpdated);
    return () => window.removeEventListener('fds-grades-updated', handleGradesUpdated);
  }, [courseId]);

  // Preliminary Valuation State (Valoración Preliminar: TEA / TEP)
  const getPreliminaryValuationKey = (t: '1c' | '2c') => `fds_preliminary_valuation_${courseId}_${t}`;

  const [preliminaryValuation1c, setPreliminaryValuation1c] = useState<PreliminaryValuationRecord | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getPreliminaryValuationKey('1c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return null;
  });

  const [preliminaryValuation2c, setPreliminaryValuation2c] = useState<PreliminaryValuationRecord | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getPreliminaryValuationKey('2c'));
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return null;
  });

  const [isPreliminaryModalOpen, setIsPreliminaryModalOpen] = useState(false);

  const activePreliminaryValuation = is2c ? preliminaryValuation2c : preliminaryValuation1c;

  const handleSavePreliminaryValuation = (record: PreliminaryValuationRecord) => {
    if (is2c) {
      setPreliminaryValuation2c(record);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getPreliminaryValuationKey('2c'), JSON.stringify(record));
      }
    } else {
      setPreliminaryValuation1c(record);
      if (typeof window !== 'undefined') {
        localStorage.setItem(getPreliminaryValuationKey('1c'), JSON.stringify(record));
      }
    }
  };

  // Double Scrollbar Synchronization: Top scrollbar & Bottom Table scrollbar
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [tableWidth, setTableWidth] = useState<number>(0);

  // Sync scroll positions without infinite loops
  const isSyncingTopScroll = useRef(false);
  const isSyncingBottomScroll = useRef(false);

  const handleTopScroll = () => {
    if (isSyncingTopScroll.current) {
      isSyncingTopScroll.current = false;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      isSyncingBottomScroll.current = true;
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleBottomScroll = () => {
    if (isSyncingBottomScroll.current) {
      isSyncingBottomScroll.current = false;
      return;
    }
    if (topScrollRef.current && bottomScrollRef.current) {
      isSyncingTopScroll.current = true;
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
  };

  // Measure and keep tableWidth updated for the top scrollbar dummy spacer
  useEffect(() => {
    let rafId: number | null = null;
    const updateWidth = () => {
      if (tableRef.current) {
        const sw = tableRef.current.scrollWidth;
        if (sw > 0) {
          setTableWidth((prev) => (Math.abs(prev - sw) > 2 ? sw : prev));
        }
      }
    };
    updateWidth();

    // Use ResizeObserver for responsive table width changes (e.g. columns added/removed)
    if (tableRef.current && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateWidth);
      });
      ro.observe(tableRef.current);
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }
  }, [categories, students]);

  // Quick arrow scroll buttons
  const scrollTableBy = (delta: number) => {
    if (bottomScrollRef.current) {
      bottomScrollRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  // Cell edit handling
  const handleScoreChange = (studentId: string, colKey: string, val: string) => {
    // Clean input: allow numbers, comma, dot, or short text
    const cleanVal = val.replace(',', '.');
    const updated = {
      ...gradesMap,
      [studentId]: {
        ...(gradesMap[studentId] || {}),
        [colKey]: cleanVal,
      },
    };
    saveGrades(updated);
  };

  // Modals / State for adding & editing categories/subcategories
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<GradeCategory | null>(null);

  // Category Edit state & Manage Categories Modal
  const [categoryToEdit, setCategoryToEdit] = useState<GradeCategory | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);

  // Subcategory Edit state
  const [subcatToEdit, setSubcatToEdit] = useState<{ catId: string; subId: string; name: string } | null>(null);
  const [editSubcatName, setEditSubcatName] = useState('');

  const [addingSubcatForCatId, setAddingSubcatForCatId] = useState<string | null>(null);
  const [newSubcatName, setNewSubcatName] = useState('');

  // Add Category Handler
  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const newCat: GradeCategory = {
      id: `cat-${Date.now()}`,
      name: newCatName.trim(),
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length].badge,
      subcategories: [],
    };
    saveCategories([...categories, newCat]);
    setNewCatName('');
    setIsAddCategoryOpen(false);
  };

  // Save Edited Category Name & Color
  const handleSaveEditCategory = () => {
    if (!categoryToEdit || !editCatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== categoryToEdit.id) return cat;
      return {
        ...cat,
        name: editCatName.trim(),
        color: editCatColor || cat.color,
      };
    });
    saveCategories(updated);
    setCategoryToEdit(null);
  };

  // Save Edited Subcategory Name
  const handleSaveEditSubcategory = () => {
    if (!subcatToEdit || !editSubcatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== subcatToEdit.catId) return cat;
      return {
        ...cat,
        subcategories: cat.subcategories.map((sub) =>
          sub.id === subcatToEdit.subId ? { ...sub, name: editSubcatName.trim() } : sub
        ),
      };
    });
    saveCategories(updated);
    setSubcatToEdit(null);
  };

  // Add Subcategory Handler
  const handleAddSubcategory = (catId: string) => {
    if (!newSubcatName.trim()) return;
    const updated = categories.map((cat) => {
      if (cat.id !== catId) return cat;
      const newSub: GradeSubcategory = {
        id: `sub-${Date.now()}`,
        name: newSubcatName.trim(),
        maxScore: 10,
      };
      return {
        ...cat,
        subcategories: [...cat.subcategories, newSub],
      };
    });
    saveCategories(updated);
    setNewSubcatName('');
    setAddingSubcatForCatId(null);
  };

  // Delete Category with in-app confirmation modal (safe inside iframes)
  const confirmDeleteCategory = () => {
    if (!categoryToDelete) return;
    saveCategories(categories.filter((c) => c.id !== categoryToDelete.id));
    setCategoryToDelete(null);
  };

  // Delete Subcategory
  const handleDeleteSubcategory = (catId: string, subId: string) => {
    const updated = categories.map((cat) => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        subcategories: cat.subcategories.filter((s) => s.id !== subId),
      };
    });
    saveCategories(updated);
  };

  // Calculate term final score for any term
  const calculateFinalForTerm = (
    term: '1c' | '2c',
    studentId: string
  ): { scoreStr: string; num: number | null } => {
    const termCats = term === '1c' ? categories1c : categories2c;
    const termGrades = term === '1c' ? gradesMap1c : gradesMap2c;
    const termCalc = term === '1c' ? overallCalc1c : overallCalc2c;

    const stGrades = termGrades[studentId] || {};
    if (termCalc === 'manual_final') {
      const val = stGrades['__final__'] || '';
      const num = val !== '' && !isNaN(Number(val)) ? Number(val) : null;
      return { scoreStr: val, num };
    }

    const numericScores: number[] = [];
    termCats.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        const val = stGrades[cat.id];
        if (val !== undefined && val !== '' && !isNaN(Number(val))) {
          numericScores.push(Number(val));
        }
      } else {
        cat.subcategories.forEach((sub) => {
          const val = stGrades[sub.id];
          if (val !== undefined && val !== '' && !isNaN(Number(val))) {
            numericScores.push(Number(val));
          }
        });
      }
    });

    if (numericScores.length === 0) return { scoreStr: '', num: null };
    const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
    return {
      scoreStr: avg.toFixed(1).replace('.0', ''),
      num: avg,
    };
  };

  // Calculate active term final score
  const getFinalScore = (studentId: string): string => {
    return calculateFinalForTerm(is2c ? '2c' : '1c', studentId).scoreStr;
  };

  const score1cMap = useMemo(() => {
    const map: Record<string, { scoreStr: string; num: number | null }> = {};
    students.forEach((st) => {
      map[st.id] = calculateFinalForTerm('1c', st.id);
    });
    return map;
  }, [students, categories1c, gradesMap1c, overallCalc1c]);

  const score2cMap = useMemo(() => {
    const map: Record<string, { scoreStr: string; num: number | null }> = {};
    students.forEach((st) => {
      map[st.id] = calculateFinalForTerm('2c', st.id);
    });
    return map;
  }, [students, categories2c, gradesMap2c, overallCalc2c]);

  // Export CSV for Sheets
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    
    // Header Row 1: Alumno, then each category and subcategory
    const headerParts = ['Apellido y Nombre'];
    categories.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        headerParts.push(`"${cat.name}"`);
      } else {
        cat.subcategories.forEach((sub) => {
          headerParts.push(`"${cat.name} - ${sub.name}"`);
        });
      }
    });
    if (activePreliminaryValuation && activePreliminaryValuation.showInMatrix) {
      headerParts.push('"Valoración Preliminar (TEA/TEP)"');
    }
    headerParts.push('"Calificación Final"');
    csvContent += headerParts.join(',') + '\r\n';

    // Student rows
    students.forEach((st) => {
      const row = [`"${st.lastName}, ${st.firstName}"`];
      const stGrades = gradesMap[st.id] || {};
      categories.forEach((cat) => {
        if (cat.subcategories.length === 0) {
          const val = stGrades[cat.id] || '';
          row.push(`"${val}"`);
        } else {
          cat.subcategories.forEach((sub) => {
            const val = stGrades[sub.id] || '';
            row.push(`"${val}"`);
          });
        }
      });
      if (activePreliminaryValuation && activePreliminaryValuation.showInMatrix) {
        const traj = activePreliminaryValuation.valuations[st.id]?.trajectory || '';
        row.push(`"${traj}"`);
      }
      row.push(`"${getFinalScore(st.id)}"`);
      csvContent += row.join(',') + '\r\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `Calificaciones_${currentTerm === '1c' ? '1er_Cuatrimestre' : '2do_Cuatrimestre'}_${courseName.replace(/\s+/g, '_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Grade color helper
  const getScoreColorClass = (valStr: string) => {
    if (!valStr || isNaN(Number(valStr))) return isDarkMode ? 'text-slate-200' : 'text-neutral-800';
    const num = Number(valStr);
    if (num >= 7) return 'text-emerald-600 dark:text-emerald-400 font-bold';
    if (num >= 6) return 'text-amber-600 dark:text-amber-400 font-semibold';
    return 'text-red-600 dark:text-red-400 font-bold';
  };

  return (
    <div className="space-y-4">
      {/* Interruptor de Cuatrimestres */}
      <div
        className={`p-3 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-xl ${
              currentTerm === '1c'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : currentTerm === '2c'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                Período Académico:
              </span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  currentTerm === '1c'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                    : currentTerm === '2c'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                }`}
              >
                {currentTerm === '1c'
                  ? '📘 1° Cuatrimestre Activo'
                  : currentTerm === '2c'
                  ? '📗 2° Cuatrimestre Activo'
                  : '🎓 Cierre y Calificación Anual'}
              </span>
            </div>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              {currentTerm === '1c'
                ? 'Carga de notas, trabajos prácticos y evaluaciones correspondientes al 1° Cuatrimestre.'
                : currentTerm === '2c'
                ? 'Carga de notas, trabajos prácticos y evaluaciones correspondientes al 2° Cuatrimestre.'
                : 'Consolidado general para promediar ambos cuatrimestres y emitir la nota definitiva anual.'}
            </p>
          </div>
        </div>

        {/* Interruptor segmentado */}
        <div
          className={`p-1 rounded-xl border flex items-center gap-1 shadow-2xs ${
            isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-neutral-100 border-neutral-200'
          }`}
        >
          <button
            type="button"
            id="switch-term-1c"
            onClick={() => setTerm('1c')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === '1c'
                ? 'bg-blue-600 text-white shadow-sm scale-102 ring-2 ring-blue-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${currentTerm === '1c' ? 'bg-white' : 'bg-blue-400'}`} />
            <span>1° Cuatrimestre</span>
          </button>

          <button
            type="button"
            id="switch-term-2c"
            onClick={() => setTerm('2c')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === '2c'
                ? 'bg-emerald-600 text-white shadow-sm scale-102 ring-2 ring-emerald-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${currentTerm === '2c' ? 'bg-white' : 'bg-emerald-400'}`} />
            <span>2° Cuatrimestre</span>
          </button>

          <button
            type="button"
            id="switch-term-annual"
            onClick={() => setTerm('annual')}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              currentTerm === 'annual'
                ? 'bg-purple-600 text-white shadow-sm scale-102 ring-2 ring-purple-400/30'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Cierre Anual</span>
          </button>
        </div>
      </div>

      {currentTerm === 'annual' ? (
        <AnnualSummaryView
          courseId={courseId}
          courseName={courseName}
          students={students}
          isDarkMode={isDarkMode}
          score1cMap={score1cMap}
          score2cMap={score2cMap}
          annualOverrides={annualOverrides}
          onSaveOverride={saveAnnualOverride}
          onSwitchTerm={(t) => setTerm(t)}
          driveFolderId={driveFolderId}
          driveFolderUrl={driveFolderUrl}
        />
      ) : (
        <>
          {/* Top Controls & Configuration Bar */}
          <div
            className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`font-bold text-base ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                  Planilla de Calificaciones — {currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'}
                </h3>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${
                    isDarkMode
                      ? 'bg-blue-950/60 text-blue-400 border-blue-800/60'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}
                >
                  {categories.length} {categories.length === 1 ? 'Categoría' : 'Categorías'}
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Organizada por categorías mayores y subcategorías de {currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'}. El criterio de promediar o calificar manualmente es 100% decisión tuya.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Copiar categorías de 1c si está en 2c */}
              {is2c && (
                <button
                  type="button"
                  onClick={handleCopyCategoriesFrom1c}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                      : 'bg-white hover:bg-emerald-50 text-emerald-700 border-neutral-200'
                  }`}
                  title="Copiar las categorías creadas en el 1° Cuatrimestre para utilizarlas en este 2° Cuatrimestre"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar categorías de 1° C</span>
                </button>
              )}

              {/* Botón Generar Valoración Preliminar */}
              <button
                type="button"
                id="btn-generar-valoracion-preliminar"
                onClick={() => setIsPreliminaryModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md transition-all cursor-pointer ring-2 ring-amber-500/20"
                title={`Generar Valoración Preliminar para ${currentTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'} con selección de notas y escala TEA / TEP`}
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>Generar Valoración Preliminar</span>
                {activePreliminaryValuation && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-white text-amber-800 font-extrabold shadow-2xs">
                    TEA/TEP ✓
                  </span>
                )}
              </button>

              {/* Criterio de Calificación Final Toggle */}
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs ${
                  isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <span className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                  Nota Final:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    saveOverallCalc(
                      overallCalculation === 'manual_final'
                        ? 'average_of_categories'
                        : 'manual_final'
                    )
                  }
                  className={`px-2 py-0.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    overallCalculation === 'manual_final'
                      ? 'bg-purple-600 text-white shadow-2xs'
                      : 'bg-blue-600 text-white shadow-2xs'
                  }`}
                  title="Cambiar criterio para la calificación final"
                >
                  {overallCalculation === 'manual_final'
                    ? '✍️ A criterio del docente (Manual)'
                    : '📊 Promedio automático de notas'}
                </button>
              </div>

              {/* Add Category Button */}
              <button
                type="button"
                onClick={() => setIsAddCategoryOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Categoría Mayor</span>
              </button>

              {/* Opciones de Categorías Button */}
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                }`}
                title="Opciones de categorías: editar nombres, agregar o eliminar"
              >
                <Settings className="w-3.5 h-3.5 text-blue-500" />
                <span>Opciones de Categorías</span>
              </button>

              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportCSV}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
                }`}
                title="Descargar planilla en formato CSV para abrir en Excel o Google Sheets"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <span>Descargar CSV</span>
              </button>

              {/* Guardar Notas del Cuatrimestre en Google Sheets */}
              <button
                type="button"
                onClick={handleSaveCuatrimestreToSheets}
                disabled={isSavingSheets}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                title="Guardar y registrar permanentemente las notas de este cuatrimestre en Google Sheets"
              >
                {isSavingSheets ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                )}
                <span>
                  {isSavingSheets
                    ? 'Guardando...'
                    : `Guardar Notas en Sheets (${currentTerm === '2c' ? '2° C' : '1° C'})`}
                </span>
              </button>

              {sheetsSavedInfo && (
                sheetsSavedInfo.isLiveGoogle && sheetsSavedInfo.url ? (
                  <a
                    href={sheetsSavedInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:underline"
                    title="Abrir la pestaña con las notas guardadas en Google Sheets"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Ver {sheetsSavedInfo.tabName}</span>
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                    title="Notas guardadas en la base de datos y preparadas para Sheets"
                  >
                    <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span>Guardado ({sheetsSavedInfo.tabName})</span>
                  </span>
                )
              )}
            </div>
          </div>

      {/* Modal / Inline form to add Category */}
      {isAddCategoryOpen && (
        <div
          className={`p-4 rounded-xl border animate-in fade-in space-y-3 ${
            isDarkMode ? 'bg-slate-850 border-blue-500/40' : 'bg-blue-50/50 border-blue-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-blue-300' : 'text-blue-900'}`}>
              Nueva Categoría Mayor (ej: Evaluaciones, Trabajos Prácticos, Tareas Diarias...)
            </h4>
            <button
              type="button"
              onClick={() => setIsAddCategoryOpen(false)}
              className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 items-end">
            <div className="flex-1 w-full space-y-1">
              <label className={`text-[11px] font-semibold ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Nombre de la Categoría Mayor
              </label>
              <input
                type="text"
                placeholder="Ej: Evaluaciones Cuatrimestrales, Trabajos Prácticos..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                }`}
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={handleAddCategory}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 h-[38px]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Crear Categoría</span>
            </button>
          </div>
        </div>
      )}

      {/* Adding Subcategory Form Drawer / Modal */}
      {addingSubcatForCatId && (
        <div
          className={`p-4 rounded-xl border animate-in fade-in space-y-3 ${
            isDarkMode ? 'bg-slate-850 border-emerald-500/40' : 'bg-emerald-50/50 border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-emerald-300' : 'text-emerald-900'}`}>
              Agregar Subcategoría / Columna a: "
              {categories.find((c) => c.id === addingSubcatForCatId)?.name}"
            </h4>
            <button
              type="button"
              onClick={() => setAddingSubcatForCatId(null)}
              className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ej: Evaluación Escrita Unidad 1, Exposición Oral, TP Integrador..."
              value={newSubcatName}
              onChange={(e) => setNewSubcatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubcategory(addingSubcatForCatId)}
              className={`flex-1 px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
              }`}
              autoFocus
            />
            <button
              type="button"
              onClick={() => handleAddSubcategory(addingSubcatForCatId)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar Columna</span>
            </button>
          </div>
        </div>
      )}

      {/* TOP HORIZONTAL SCROLLBAR & CONTROLS */}
      <div
        className={`px-4 py-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Desplazamiento horizontal:
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollTableBy(-250)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la izquierda"
              aria-label="Desplazar a la izquierda"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollTableBy(250)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isDarkMode
                  ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
              title="Desplazar a la derecha"
              aria-label="Desplazar a la derecha"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Scrollbar Track synchronized with table */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="flex-1 overflow-x-auto overflow-y-hidden h-4 rounded-md scrollbar-thin transition-colors"
          style={{
            scrollbarWidth: 'auto',
          }}
        >
          {/* Invisible placeholder matching the exact width of the table */}
          <div style={{ width: `${Math.max(tableWidth, 900)}px`, height: '1px' }} />
        </div>
      </div>

      {/* Main Gradebook Matrix Table */}
      <div
        className={`border rounded-2xl overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div
          ref={bottomScrollRef}
          onScroll={handleBottomScroll}
          className="overflow-x-auto max-w-full"
        >
          <table ref={tableRef} className="w-full text-left text-xs border-collapse">
            <thead>
              {/* ROW 1: Super Header - Categories */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-neutral-100 border-neutral-200'}`}>
                {/* Student info fixed cols */}
                <th
                  rowSpan={2}
                  className={`p-3 font-bold border-r uppercase tracking-wider text-[11px] min-w-[200px] w-64 ${
                    isDarkMode ? 'border-slate-800 text-slate-300' : 'border-neutral-200 text-neutral-700'
                  }`}
                >
                  Estudiante ({students.length})
                </th>

                {/* Major Categories */}
                {categories.map((cat, catIdx) => {
                  const colSpan = Math.max(1, cat.subcategories.length);
                  const colorTheme = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];

                  return (
                    <th
                      key={cat.id}
                      colSpan={colSpan}
                      className={`p-2.5 text-center font-bold border-r border-b-2 transition-colors ${
                        colorTheme.border
                      } ${colorTheme.headerBg}`}
                    >
                      <div className="flex items-center justify-between px-2 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${colorTheme.badge}`} />
                          <span className="truncate text-xs uppercase tracking-wide font-bold">{cat.name}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Add Subcategory / Column button */}
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-xs flex items-center gap-0.5 cursor-pointer"
                            title={`Agregar columna de evaluación a ${cat.name}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline text-[10px] font-semibold">+ Col</span>
                          </button>

                          {/* Edit Category button */}
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryToEdit(cat);
                              setEditCatName(cat.name);
                              setEditCatColor(cat.color);
                            }}
                            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-xs flex items-center gap-0.5 cursor-pointer transition-colors"
                            title={`Editar nombre u opciones de categoría "${cat.name}"`}
                          >
                            <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                            <span className="hidden sm:inline text-[10px] font-semibold">Editar</span>
                          </button>

                          {/* Delete category */}
                          <button
                            type="button"
                            onClick={() => setCategoryToDelete(cat)}
                            className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors cursor-pointer"
                            title={`Eliminar categoría "${cat.name}"`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </th>
                  );
                })}

                {/* Preliminary Valuation Col (TEA / TEP) if enabled */}
                {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                  <th
                    rowSpan={2}
                    className={`p-2.5 font-extrabold text-center uppercase tracking-wider text-[11px] min-w-[130px] border-l ${
                      isDarkMode
                        ? 'bg-amber-950/40 text-amber-300 border-slate-800'
                        : 'bg-amber-50/80 text-amber-900 border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setIsPreliminaryModalOpen(true)}
                      className="inline-flex flex-col items-center hover:opacity-80 transition-opacity cursor-pointer mx-auto"
                      title="Haz clic para editar la Valoración Preliminar (TEA / TEP)"
                    >
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        <span>Val. Preliminar</span>
                      </div>
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 opacity-90 mt-0.5">
                        (TEA / TEP)
                      </div>
                    </button>
                  </th>
                )}

                {/* Final Grade Col */}
                <th
                  rowSpan={2}
                  className={`p-3 font-extrabold text-center uppercase tracking-wider text-[11px] min-w-[120px] ${
                    isDarkMode
                      ? 'bg-blue-950/40 text-blue-300 border-l border-slate-800'
                      : 'bg-blue-50 text-blue-800 border-l border-neutral-200'
                  }`}
                >
                  <div>Calificación Final</div>
                  <div className="text-[10px] font-normal opacity-80 mt-0.5">
                    {overallCalculation === 'manual_final' ? '(Criterio docente)' : '(Promedio)'}
                  </div>
                </th>
              </tr>

              {/* ROW 2: Subcategories Header */}
              <tr className={`border-b ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'}`}>
                {categories.map((cat) => {
                  if (cat.subcategories.length === 0) {
                    return (
                      <th
                        key={`${cat.id}-empty`}
                        className={`p-2 text-center font-medium border-r text-[11px] min-w-[110px] ${
                          isDarkMode ? 'border-slate-800 text-slate-400' : 'border-neutral-200 text-neutral-500'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Nota General</span>
                          <button
                            type="button"
                            onClick={() => setAddingSubcatForCatId(cat.id)}
                            className="text-blue-500 hover:underline text-[10px]"
                          >
                            (+sub)
                          </button>
                        </div>
                      </th>
                    );
                  }

                  return (
                    <React.Fragment key={`${cat.id}-subs`}>
                      {cat.subcategories.map((sub) => (
                        <th
                          key={sub.id}
                          className={`p-2 text-center font-medium border-r text-[11px] min-w-[120px] max-w-[160px] group ${
                            isDarkMode ? 'border-slate-800 text-slate-300' : 'border-neutral-200 text-neutral-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 px-1">
                            <span className="truncate font-semibold flex items-center gap-1" title={sub.name}>
                              {(sub.name.toLowerCase().includes('disposición') || sub.name.toLowerCase().includes('disposicion')) && (
                                <Award className="w-3 h-3 text-amber-500 shrink-0" />
                              )}
                              <span className="truncate">{sub.name}</span>
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setSubcatToEdit({ catId: cat.id, subId: sub.id, name: sub.name });
                                  setEditSubcatName(sub.name);
                                }}
                                className="p-0.5 text-neutral-400 hover:text-blue-500 cursor-pointer"
                                title={`Editar nombre de "${sub.name}"`}
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSubcategory(cat.id, sub.id)}
                                className="p-0.5 text-neutral-400 hover:text-red-500 cursor-pointer"
                                title={`Eliminar columna ${sub.name}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </th>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tr>
            </thead>

            {/* TABLE BODY: Students Rows */}
            <tbody className="divide-y divide-neutral-200 dark:divide-slate-800">
              {students.length === 0 ? (
                <tr>
                  <td
                    colSpan={20}
                    className="p-8 text-center text-xs text-neutral-500 dark:text-slate-400"
                  >
                    No hay estudiantes cargados en este curso.
                  </td>
                </tr>
              ) : (
                students.map((student, idx) => {
                  const studentGrades = gradesMap[student.id] || {};
                  const finalScore = getFinalScore(student.id);

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors ${
                        isDarkMode
                          ? 'hover:bg-slate-800/40'
                          : 'hover:bg-neutral-50/80'
                      }`}
                    >
                      {/* Student Name */}
                      <td
                        className={`p-3 border-r font-medium flex items-center gap-2.5 ${
                          isDarkMode ? 'border-slate-800 text-slate-200' : 'border-neutral-200 text-neutral-800'
                        }`}
                      >
                        <span className="text-[10px] text-neutral-400 w-4">{idx + 1}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs truncate">
                            {student.lastName}, {student.firstName}
                          </p>
                          <p className="text-[10px] text-neutral-400 dark:text-slate-500 truncate">
                            {student.email || 'Sin correo'}
                          </p>
                        </div>
                      </td>

                      {/* Grade Cells per Category & Subcategory */}
                      {categories.map((cat) => {
                        // Si no tiene subcategorías, celda directa para la categoría
                        if (cat.subcategories.length === 0) {
                          const val = studentGrades[cat.id] || '';
                          return (
                            <td key={cat.id} className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800">
                              <input
                                type="text"
                                value={val}
                                onChange={(e) => handleScoreChange(student.id, cat.id, e.target.value)}
                                placeholder="-"
                                className={`w-14 text-center py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                                  isDarkMode
                                    ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                                    : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                                } ${getScoreColorClass(val)}`}
                              />
                            </td>
                          );
                        }

                        // Celdas de subcategorías
                        return (
                          <React.Fragment key={cat.id}>
                            {cat.subcategories.map((sub) => {
                              const val = studentGrades[sub.id] || '';
                              return (
                                <td
                                  key={sub.id}
                                  className="p-1.5 border-r text-center border-neutral-200 dark:border-slate-800"
                                >
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={(e) => handleScoreChange(student.id, sub.id, e.target.value)}
                                    placeholder="-"
                                    className={`w-14 text-center py-1 rounded-lg text-xs font-semibold focus:outline-none transition-all border ${
                                      isDarkMode
                                        ? 'bg-slate-800/70 border-slate-700 focus:border-blue-500'
                                        : 'bg-neutral-50 border-neutral-200 focus:border-blue-400'
                                    } ${getScoreColorClass(val)}`}
                                  />
                                </td>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}

                      {/* Preliminary Valuation Cell (TEA / TEP) if enabled */}
                      {activePreliminaryValuation && activePreliminaryValuation.showInMatrix && (
                        <td
                          className={`p-2 border-l text-center font-bold text-xs ${
                            isDarkMode
                              ? 'bg-amber-950/20 border-slate-800'
                              : 'bg-amber-50/30 border-neutral-200'
                          }`}
                        >
                          {(() => {
                            const valData = activePreliminaryValuation.valuations[student.id];
                            const traj = valData?.trajectory;
                            if (traj === 'TEA') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TEA: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo en Alcanzado (Haz clic para editar)'}
                                >
                                  TEA
                                </button>
                              );
                            }
                            if (traj === 'TEP') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TEP: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo en Proceso (Haz clic para editar)'}
                                >
                                  TEP
                                </button>
                              );
                            }
                            if (traj === 'TED') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setIsPreliminaryModalOpen(true)}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:scale-105 transition-transform cursor-pointer"
                                  title={valData?.observation ? `TED: ${valData.observation} (Haz clic para editar)` : 'Trayecto Educativo Discontinuo (Haz clic para editar)'}
                                >
                                  TED
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => setIsPreliminaryModalOpen(true)}
                                className="text-[11px] text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 underline cursor-pointer"
                                title="Asignar TEA / TEP en Valoración Preliminar"
                              >
                                Asignar
                              </button>
                            );
                          })()}
                        </td>
                      )}

                      {/* Final Grade Cell: Either editable manual OR calculated automatically */}
                      <td
                        className={`p-2 border-l text-center font-extrabold text-sm ${
                          isDarkMode
                            ? 'bg-blue-950/20 border-slate-800'
                            : 'bg-blue-50/40 border-neutral-200'
                        }`}
                      >
                        {overallCalculation === 'manual_final' ? (
                          <input
                            type="text"
                            value={studentGrades['__final__'] || ''}
                            onChange={(e) => handleScoreChange(student.id, '__final__', e.target.value)}
                            placeholder="-"
                            className={`w-16 text-center py-1 rounded-lg text-xs font-black focus:outline-none transition-all border ${
                              isDarkMode
                                ? 'bg-purple-950/40 border-purple-800/80 text-purple-300 focus:border-purple-500'
                                : 'bg-purple-50 border-purple-200 text-purple-900 focus:border-purple-400'
                            }`}
                            title="Nota final asignada a criterio del docente"
                          />
                        ) : (
                          <span className={getScoreColorClass(finalScore)}>
                            {finalScore || '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Info / Legend */}
      <div
        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
          isDarkMode ? 'bg-slate-900/60 border-slate-800 text-slate-400' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-neutral-700 dark:text-slate-300">Criterio Pedagógico:</span>
          <span>• Puedes ingresar notas numéricas (1 al 10 con decimales) o conceptuales.</span>
          <span>• Si una categoría o la nota final está en modo manual, eres libre de ponderar según tu criterio.</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Aprobado (≥ 7)
          </span>
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Regular (6)
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Desaprobado (&lt; 6)
          </span>
        </div>
      </div>

      {/* Modal de confirmación para eliminar Categoría Mayor (sin window.confirm para funcionar en iframe) */}
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

      {/* Modal: Editar Categoría Mayor (Nombre y color) */}
      {categoryToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 ${
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
                    Modifica el nombre o color distintivo de esta categoría.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
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

              {/* Color selector */}
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

              <div
                className={`p-3 rounded-xl border text-[11px] ${
                  isDarkMode ? 'bg-slate-800/50 border-slate-700 text-slate-300' : 'bg-blue-50/60 border-blue-100 text-blue-900'
                }`}
              >
                <p>
                  Las <strong>{categoryToEdit.subcategories.length} columna(s)</strong> y las notas ya cargadas para tus estudiantes se conservan intactas al cambiar de nombre.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const cat = categoryToEdit;
                  setCategoryToEdit(null);
                  setCategoryToDelete(cat);
                }}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 cursor-pointer"
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

      {/* Modal: Opciones de Categorías Mayores (Listado para gestionar, editar y agregar) */}
      {isManageCategoriesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Opciones de Categorías Mayores</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Administra y edita los nombres de las categorías de evaluación.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of categories */}
            <div className="flex-1 overflow-y-auto space-y-2 py-1">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                    isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${cat.color}`} />
                    <div className="min-w-0">
                      <span className="font-bold block truncate text-sm">{cat.name}</span>
                      <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                        {cat.subcategories.length} columna(s) de evaluación
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryToEdit(cat);
                        setEditCatName(cat.name);
                        setEditCatColor(cat.color);
                      }}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title={`Editar nombre de "${cat.name}"`}
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Editar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsManageCategoriesOpen(false);
                        setCategoryToDelete(cat);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                      title={`Eliminar categoría "${cat.name}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick add category inside options modal */}
            <div className="pt-3 border-t border-neutral-200 dark:border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                placeholder="Nombre de nueva categoría mayor..."
                className={`flex-1 px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                }`}
              />
              <button
                type="button"
                disabled={!newCatName.trim()}
                onClick={handleAddCategory}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shrink-0 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar</span>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(false)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Subcategoría / Columna de Evaluación */}
      {subcatToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-sm rounded-2xl border shadow-2xl p-5 space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold">Editar Columna de Evaluación</h3>
              </div>
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-700 dark:text-slate-300">
                Nombre de la columna
              </label>
              <input
                type="text"
                value={editSubcatName}
                onChange={(e) => setEditSubcatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveEditSubcategory()}
                className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-neutral-300'
                }`}
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSubcatToEdit(null)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  isDarkMode ? 'border-slate-700 text-slate-300' : 'border-neutral-200 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!editSubcatName.trim()}
                onClick={handleSaveEditSubcategory}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Generar Valoración Preliminar (TEA / TEP) */}
      <PreliminaryValuationModal
        isOpen={isPreliminaryModalOpen}
        onClose={() => setIsPreliminaryModalOpen(false)}
        courseId={courseId}
        courseName={courseName}
        term={is2c ? '2c' : '1c'}
        students={students}
        categories={categories}
        gradesMap={gradesMap}
        isDarkMode={isDarkMode}
        savedValuation={activePreliminaryValuation}
        onSaveValuation={handleSavePreliminaryValuation}
      />
        </>
      )}
    </div>
  );
};
export default GradebookMatrix;
