import React, { useState, useMemo } from 'react';
import {
  X,
  ClipboardCheck,
  CheckSquare,
  Square,
  Sparkles,
  Printer,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Save,
  Search,
  ExternalLink,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { sheetsService } from '../../services/workspace/sheetsService';

export type QualitativeTrajectory = 'TEA' | 'TEP' | 'TED' | '';

export interface PreliminaryValuationRecord {
  courseId: string;
  term: '1c' | '2c';
  title: string;
  updatedAt: string;
  selectedAssessmentIds: string[];
  showInMatrix: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  valuations: Record<string, { trajectory: QualitativeTrajectory; observation: string }>;
}

export interface PreliminaryValuationModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  term: '1c' | '2c';
  students: Student[];
  categories: GradeCategory[];
  gradesMap: StudentGradesMap;
  isDarkMode: boolean;
  savedValuation: PreliminaryValuationRecord | null;
  onSaveValuation: (record: PreliminaryValuationRecord) => void;
}

export const PreliminaryValuationModal: React.FC<PreliminaryValuationModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  term,
  students,
  categories,
  gradesMap,
  isDarkMode,
  savedValuation,
  onSaveValuation,
}) => {
  if (!isOpen) return null;

  const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';

  // Flatten all available evaluative items (categories with no subcategories, or each subcategory)
  const availableAssessments = useMemo(() => {
    const list: Array<{ id: string; name: string; categoryName: string; maxScore: number }> = [];
    categories.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        list.push({
          id: cat.id,
          name: cat.name,
          categoryName: cat.name,
          maxScore: 10,
        });
      } else {
        cat.subcategories.forEach((sub) => {
          list.push({
            id: sub.id,
            name: sub.name,
            categoryName: cat.name,
            maxScore: sub.maxScore || 10,
          });
        });
      }
    });
    return list;
  }, [categories]);

  // Selected assessment IDs state
  const [selectedAssessmentIds, setSelectedAssessmentIds] = useState<string[]>(() => {
    if (savedValuation && savedValuation.selectedAssessmentIds?.length > 0) {
      const validIds = availableAssessments.map((a) => a.id);
      const filtered = savedValuation.selectedAssessmentIds.filter((id) => validIds.includes(id));
      if (filtered.length > 0) return filtered;
    }
    // Default: select all existing assessments
    return availableAssessments.map((a) => a.id);
  });

  // Array of metadata objects for selected assessments in order
  const selectedAssessmentsMeta = useMemo(() => {
    return selectedAssessmentIds.map((id) => {
      const found = availableAssessments.find((a) => a.id === id);
      return (
        found || {
          id,
          name: id,
          categoryName: '',
          maxScore: 10,
        }
      );
    });
  }, [selectedAssessmentIds, availableAssessments]);

  // Valuations map: studentId -> { trajectory, observation }
  const [valuations, setValuations] = useState<
    Record<string, { trajectory: QualitativeTrajectory; observation: string }>
  >(() => {
    return savedValuation?.valuations || {};
  });

  // Show in matrix toggle
  const [showInMatrix, setShowInMatrix] = useState<boolean>(
    savedValuation?.showInMatrix !== undefined ? savedValuation.showInMatrix : true
  );

  // Google Sheets state
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | undefined>(
    savedValuation?.spreadsheetUrl
  );
  const [spreadsheetId, setSpreadsheetId] = useState<string | undefined>(
    savedValuation?.spreadsheetId
  );
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  // Search in modal
  const [searchFilter, setSearchFilter] = useState('');

  // Assessment selector collapsible state
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  // Toggle single assessment selection
  const toggleAssessment = (id: string) => {
    setSelectedAssessmentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Select all assessments
  const selectAllAssessments = () => {
    setSelectedAssessmentIds(availableAssessments.map((a) => a.id));
  };

  // Clear assessment selection
  const clearAssessmentSelection = () => {
    setSelectedAssessmentIds([]);
  };

  // Compute calculated preliminary average and scores for each student
  const studentRows = useMemo(() => {
    return students.map((st) => {
      const stGrades = gradesMap[st.id] || {};
      const numericScores: number[] = [];

      selectedAssessmentIds.forEach((assessId) => {
        const val = stGrades[assessId];
        if (val !== undefined && val !== '' && !isNaN(Number(val))) {
          numericScores.push(Number(val));
        }
      });

      let averageScore: number | null = null;
      let averageScoreStr = '';
      if (numericScores.length > 0) {
        averageScore = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
        averageScoreStr = averageScore.toFixed(1).replace('.0', '');
      }

      const userVal = valuations[st.id] || { trajectory: '', observation: '' };

      return {
        student: st,
        numericScores,
        averageScore,
        averageScoreStr,
        trajectory: userVal.trajectory,
        observation: userVal.observation,
      };
    });
  }, [students, gradesMap, selectedAssessmentIds, valuations]);

  // Set trajectory for a student
  const handleSetTrajectory = (studentId: string, traj: QualitativeTrajectory) => {
    setValuations((prev) => ({
      ...prev,
      [studentId]: {
        trajectory: prev[studentId]?.trajectory === traj ? '' : traj,
        observation: prev[studentId]?.observation || '',
      },
    }));
  };

  // Set observation for a student
  const handleSetObservation = (studentId: string, text: string) => {
    setValuations((prev) => ({
      ...prev,
      [studentId]: {
        trajectory: prev[studentId]?.trajectory || '',
        observation: text,
      },
    }));
  };

  // Smart Auto-suggest TEA / TEP based on preliminary average
  const handleAutoSuggestAll = () => {
    const nextValuations = { ...valuations };
    studentRows.forEach((row) => {
      if (row.averageScore !== null) {
        // TEA if >= 7, TEP if < 7
        const suggested: QualitativeTrajectory = row.averageScore >= 7 ? 'TEA' : 'TEP';
        nextValuations[row.student.id] = {
          trajectory: suggested,
          observation: nextValuations[row.student.id]?.observation || '',
        };
      } else {
        nextValuations[row.student.id] = {
          trajectory: 'TEP',
          observation: nextValuations[row.student.id]?.observation || 'Sin notas registradas aún',
        };
      }
    });
    setValuations(nextValuations);
  };

  // Handle Save
  const handleSave = () => {
    const record: PreliminaryValuationRecord = {
      courseId,
      term,
      title: `Valoración Preliminar — ${termLabel}`,
      updatedAt: new Date().toISOString(),
      selectedAssessmentIds,
      showInMatrix,
      spreadsheetId,
      spreadsheetUrl,
      valuations,
    };
    onSaveValuation(record);
    onClose();
  };

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    if (!searchFilter.trim()) return studentRows;
    const q = searchFilter.toLowerCase();
    return studentRows.filter(
      (r) =>
        r.student.lastName.toLowerCase().includes(q) ||
        r.student.firstName.toLowerCase().includes(q) ||
        r.trajectory.toLowerCase().includes(q)
    );
  }, [studentRows, searchFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = students.length;
    let teaCount = 0;
    let tepCount = 0;
    let tedCount = 0;
    let pendingCount = 0;

    studentRows.forEach((r) => {
      if (r.trajectory === 'TEA') teaCount++;
      else if (r.trajectory === 'TEP') tepCount++;
      else if (r.trajectory === 'TED') tedCount++;
      else pendingCount++;
    });

    return { total, teaCount, tepCount, tedCount, pendingCount };
  }, [students, studentRows]);

  // Sync / Import to Google Sheets
  const handleImportToGoogleSheets = async () => {
    setIsSyncingSheets(true);
    try {
      const res = await sheetsService.syncPreliminaryValuationSheet(
        courseName,
        termLabel,
        students,
        selectedAssessmentsMeta,
        gradesMap,
        valuations,
        spreadsheetId
      );

      setSpreadsheetId(res.spreadsheetId);
      setSpreadsheetUrl(res.url);

      if (res.isLiveGoogle) {
        setToastMessage(`¡Planilla sincronizada con éxito en Google Sheets!`);
        window.open(res.url, '_blank');
      } else {
        // Fallback: Copy TSV to clipboard and open sheets.new so user pastes in one click!
        handleCopyForSheets();
        window.open('https://sheets.new', '_blank');
        setToastMessage(
          'Se abrió una nueva hoja en Google Sheets. ¡Los datos ya están en el portapapeles, solo presiona Ctrl+V para pegarlos!'
        );
      }
    } catch (err: any) {
      console.error('Error importing to Google Sheets:', err);
      setToastMessage('Error al sincronizar con Google Sheets. Intentando copiar datos...');
      handleCopyForSheets();
    } finally {
      setIsSyncingSheets(false);
      setTimeout(() => setToastMessage(null), 6000);
    }
  };

  // Copy table TSV format to clipboard for direct Google Sheets paste
  const handleCopyForSheets = () => {
    const headers = [
      'Apellido y Nombre',
      'Correo Institucional',
      ...selectedAssessmentsMeta.map((a) => (a.categoryName ? `${a.name} (${a.categoryName})` : a.name)),
      'Promedio Preliminar',
      'Valoración Cualitativa',
      'Descripción Trayecto',
      'Observación Pedagógica',
    ];

    const lines = [headers.join('\t')];

    studentRows.forEach((r) => {
      const stGrades = gradesMap[r.student.id] || {};
      const scoreCols = selectedAssessmentsMeta.map((a) => stGrades[a.id] || '');
      const traj = r.trajectory || 'Pendiente';
      let trajDesc = '';
      if (r.trajectory === 'TEA') trajDesc = 'Trayecto Educativo en Alcanzado';
      else if (r.trajectory === 'TEP') trajDesc = 'Trayecto Educativo en Proceso';
      else if (r.trajectory === 'TED') trajDesc = 'Trayecto Educativo Discontinuo';

      const rowCols = [
        `${r.student.lastName}, ${r.student.firstName}`,
        r.student.email || '',
        ...scoreCols,
        r.averageScoreStr || '-',
        traj,
        trajDesc,
        r.observation || '',
      ];

      lines.push(rowCols.join('\t'));
    });

    const tsvContent = lines.join('\n');
    navigator.clipboard.writeText(tsvContent).then(() => {
      setCopiedToClipboard(true);
      setToastMessage('¡Copiado al portapapeles! Puedes pegarlo (Ctrl+V) en cualquier Google Sheet.');
      setTimeout(() => {
        setCopiedToClipboard(false);
        setToastMessage(null);
      }, 4000);
    });
  };

  // Export CSV with all selected notes as individual columns
  const handleExportCSV = () => {
    let csv = '\uFEFF'; // BOM for Excel / UTF-8 compatibility
    const headers = [
      'Apellido y Nombre',
      'Correo Institucional',
      ...selectedAssessmentsMeta.map((a) => `"${(a.categoryName ? `${a.name} - ${a.categoryName}` : a.name).replace(/"/g, '""')}"`),
      '"Promedio Preliminar"',
      '"Valoración Cualitativa"',
      '"Descripción Trayecto"',
      '"Observación Pedagógica"',
    ];

    csv += headers.join(',') + '\r\n';

    studentRows.forEach((r) => {
      const stGrades = gradesMap[r.student.id] || {};
      const scoreCols = selectedAssessmentsMeta.map((a) => `"${(stGrades[a.id] || '').replace(/"/g, '""')}"`);
      const name = `"${r.student.lastName}, ${r.student.firstName}"`;
      const email = `"${r.student.email || ''}"`;
      const avg = `"${r.averageScoreStr || ''}"`;
      const traj = `"${r.trajectory || 'Pendiente'}"`;
      let trajDesc = '';
      if (r.trajectory === 'TEA') trajDesc = 'Trayecto Educativo en Alcanzado';
      else if (r.trajectory === 'TEP') trajDesc = 'Trayecto Educativo en Proceso';
      else if (r.trajectory === 'TED') trajDesc = 'Trayecto Educativo Discontinuo';
      const obs = `"${(r.observation || '').replace(/"/g, '""')}"`;

      const rowParts = [name, email, ...scoreCols, avg, traj, `"${trajDesc}"`, obs];
      csv += rowParts.join(',') + '\r\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Valoracion_Preliminar_${term}_${courseName.replace(/\s+/g, '_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Print view
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-6xl rounded-2xl border shadow-2xl flex flex-col max-h-[94vh] overflow-hidden animate-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-start justify-between gap-4 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50/30 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">
                  Generar Valoración Preliminar
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  {termLabel}
                </span>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  • {courseName}
                </span>

                {/* Google Sheet Live Badge */}
                {spreadsheetUrl && (
                  <a
                    href={spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200 transition-colors"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Hoja Google Sheets</span>
                    <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a>
                )}
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                Visualiza todas las notas seleccionadas, calcula el promedio preliminar y asigna la escala oficial:{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">TEA</strong> (Alcanzado) o{' '}
                <strong className="text-amber-600 dark:text-amber-400">TEP</strong> (En Proceso). Puedes importarlo directo a Google Sheets.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast alert message */}
        {toastMessage && (
          <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between animate-in fade-in shrink-0">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
            {spreadsheetUrl && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="underline font-bold text-white hover:text-emerald-100 flex items-center gap-1"
              >
                <span>Abrir en Google Sheets</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Content body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Section 1: Selector of assessments to include */}
          <div
            className={`rounded-xl border p-3.5 transition-colors ${
              isDarkMode ? 'bg-slate-850/80 border-slate-700/80' : 'bg-neutral-50/80 border-neutral-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-slate-200">
                  Notas incluidas en esta valoración:
                </span>
                <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  {selectedAssessmentIds.length} de {availableAssessments.length}
                </span>
                <span className="text-[11px] text-neutral-500 italic hidden sm:inline">
                  (Cada nota se mostrará en su propia columna)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllAssessments}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Seleccionar todas
                </button>
                <span className="text-neutral-300 dark:text-slate-600">•</span>
                <button
                  type="button"
                  onClick={clearAssessmentSelection}
                  className="text-[11px] font-semibold text-neutral-500 hover:underline cursor-pointer"
                >
                  Ninguna
                </button>
                <button
                  type="button"
                  onClick={() => setIsSelectorOpen(!isSelectorOpen)}
                  className="ml-1 p-1 rounded-md hover:bg-neutral-200 dark:hover:bg-slate-700 text-neutral-600 dark:text-slate-300 text-xs flex items-center gap-1 cursor-pointer"
                >
                  <span>{isSelectorOpen ? 'Ocultar listado' : 'Cambiar selección'}</span>
                  {isSelectorOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Assessment chips / checklist */}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {availableAssessments.length === 0 ? (
                <p className="text-xs text-neutral-500 italic">
                  Aún no hay categorías o notas creadas en este cuatrimestre. Puedes agregar categorías en la planilla de calificaciones.
                </p>
              ) : (
                availableAssessments.map((assess) => {
                  const isSelected = selectedAssessmentIds.includes(assess.id);
                  return (
                    <button
                      key={assess.id}
                      type="button"
                      onClick={() => toggleAssessment(assess.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 shadow-2xs'
                          : 'bg-white text-neutral-500 border-neutral-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 opacity-60 hover:opacity-100'
                      }`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                      <span>{assess.name}</span>
                      <span className="text-[10px] text-neutral-400 dark:text-slate-500">
                        ({assess.categoryName})
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Stats & Action Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* KPI Badges */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-semibold text-neutral-600 dark:text-slate-300">
                Resumen del grupo:
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <CheckCircle2 className="w-3.5 h-3.5" />
                TEA: {stats.teaCount}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                <AlertCircle className="w-3.5 h-3.5" />
                TEP: {stats.tepCount}
              </span>
              {stats.tedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-300 dark:border-red-800">
                  TED: {stats.tedCount}
                </span>
              )}
              {stats.pendingCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-neutral-100 text-neutral-600 dark:bg-slate-800 dark:text-slate-400">
                  Sin asignar: {stats.pendingCount}
                </span>
              )}
            </div>

            {/* Smart Auto-Suggest & Search */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAutoSuggestAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-2xs transition-all cursor-pointer"
                title="Calcula automáticamente: TEA si el promedio de las notas seleccionadas es >= 7, o TEP si es menor o está pendiente"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-sugerir TEA / TEP</span>
              </button>

              <div className="relative w-44">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Buscar alumno..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className={`w-full pl-8 pr-2.5 py-1.5 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                      : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Student valuation table WITH ALL SELECTED NOTES AS INDIVIDUAL COLUMNS */}
          <div
            className={`rounded-xl border overflow-hidden shadow-xs ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="overflow-x-auto max-h-[50vh] scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead
                  className={`border-b font-semibold uppercase tracking-wider sticky top-0 z-20 shadow-2xs ${
                    isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <tr>
                    <th className="py-2.5 px-3 text-center w-10 shrink-0">#</th>
                    <th className="py-2.5 px-4 min-w-[190px] border-r border-neutral-200 dark:border-slate-700">
                      Estudiante
                    </th>

                    {/* COLUMNAS INDIVIDUALES PARA CADA NOTA SELECCIONADA */}
                    {selectedAssessmentsMeta.map((assess) => (
                      <th
                        key={assess.id}
                        className="py-2.5 px-3 text-center min-w-[110px] max-w-[150px] border-r border-neutral-200 dark:border-slate-700"
                        title={`${assess.categoryName} — ${assess.name}`}
                      >
                        <div className="truncate text-xs font-bold text-neutral-900 dark:text-white">
                          {assess.name}
                        </div>
                        {assess.categoryName && (
                          <div className="text-[10px] font-normal text-neutral-500 dark:text-slate-400 truncate mt-0.5">
                            {assess.categoryName}
                          </div>
                        )}
                      </th>
                    ))}

                    {/* Columna Promedio */}
                    <th className="py-2.5 px-3 text-center min-w-[90px] border-r border-neutral-200 dark:border-slate-700 bg-neutral-200/50 dark:bg-slate-750">
                      Promedio
                    </th>

                    {/* Columna Valoración Cualitativa (TEA / TEP) */}
                    <th className="py-2.5 px-4 text-center min-w-[210px] border-r border-neutral-200 dark:border-slate-700">
                      Valoración Cualitativa
                    </th>

                    {/* Columna Observación */}
                    <th className="py-2.5 px-4 min-w-[220px]">
                      Observación Pedagógica
                    </th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y ${
                    isDarkMode ? 'divide-slate-800 text-slate-300' : 'divide-neutral-100 text-neutral-700'
                  }`}
                >
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={selectedAssessmentsMeta.length + 5}
                        className="py-8 text-center text-neutral-500"
                      >
                        No se encontraron estudiantes para mostrar.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, idx) => {
                      const isTea = row.trajectory === 'TEA';
                      const isTep = row.trajectory === 'TEP';
                      const isTed = row.trajectory === 'TED';

                      return (
                        <tr
                          key={row.student.id}
                          className={`transition-colors ${
                            isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50/70'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center font-mono text-[11px] text-neutral-400">
                            {idx + 1}
                          </td>

                          <td className="py-2.5 px-4 border-r border-neutral-200 dark:border-slate-800">
                            <span className="font-semibold text-neutral-900 dark:text-white block">
                              {row.student.lastName}, {row.student.firstName}
                            </span>
                            <span className="text-[10px] text-neutral-400 dark:text-slate-500 truncate block">
                              {row.student.email || 'Sin correo'}
                            </span>
                          </td>

                          {/* CELDAS DE CADA NOTA INDIVIDUAL */}
                          {selectedAssessmentsMeta.map((assess) => {
                            const val = gradesMap[row.student.id]?.[assess.id] || '';
                            const num = !isNaN(Number(val)) && val !== '' ? Number(val) : null;

                            return (
                              <td
                                key={assess.id}
                                className="py-2 px-3 text-center border-r font-mono text-xs border-neutral-200 dark:border-slate-800"
                              >
                                {val ? (
                                  <span
                                    className={`px-2 py-0.5 rounded font-bold ${
                                      num !== null && num >= 7
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : num !== null && num >= 6
                                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                        : num !== null
                                        ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                        : 'text-neutral-700 dark:text-slate-300'
                                    }`}
                                  >
                                    {val}
                                  </span>
                                ) : (
                                  <span className="text-neutral-300 dark:text-slate-600">-</span>
                                )}
                              </td>
                            );
                          })}

                          {/* Promedio Preliminar */}
                          <td className="py-2.5 px-3 text-center border-r border-neutral-200 dark:border-slate-800 bg-neutral-50/50 dark:bg-slate-850/50">
                            {row.averageScoreStr ? (
                              <span
                                className={`font-mono font-extrabold text-xs px-2 py-0.5 rounded ${
                                  (row.averageScore || 0) >= 7
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                }`}
                              >
                                {row.averageScoreStr}
                              </span>
                            ) : (
                              <span className="text-[11px] text-neutral-400 italic">S/N</span>
                            )}
                          </td>

                          {/* Botones de TEA / TEP / TED */}
                          <td className="py-2.5 px-4 text-center border-r border-neutral-200 dark:border-slate-800">
                            <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-neutral-100 dark:bg-slate-800/80 border border-neutral-200 dark:border-slate-700">
                              {/* TEA */}
                              <button
                                type="button"
                                onClick={() => handleSetTrajectory(row.student.id, 'TEA')}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer ${
                                  isTea
                                    ? 'bg-emerald-600 text-white shadow-xs scale-102 ring-1 ring-emerald-400'
                                    : 'text-neutral-600 dark:text-slate-300 hover:text-emerald-600'
                                }`}
                                title="Trayecto Educativo en Alcanzado (Aprendizajes y objetivos alcanzados)"
                              >
                                <span>TEA</span>
                              </button>

                              {/* TEP */}
                              <button
                                type="button"
                                onClick={() => handleSetTrajectory(row.student.id, 'TEP')}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer ${
                                  isTep
                                    ? 'bg-amber-500 text-white shadow-xs scale-102 ring-1 ring-amber-400'
                                    : 'text-neutral-600 dark:text-slate-300 hover:text-amber-600'
                                }`}
                                title="Trayecto Educativo en Proceso (Requiere afianzar contenidos o adeuda actividades)"
                              >
                                <span>TEP</span>
                              </button>

                              {/* TED */}
                              <button
                                type="button"
                                onClick={() => handleSetTrajectory(row.student.id, 'TED')}
                                className={`px-2 py-1 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer ${
                                  isTed
                                    ? 'bg-rose-600 text-white shadow-xs scale-102 ring-1 ring-rose-400'
                                    : 'text-neutral-400 hover:text-rose-600'
                                }`}
                                title="Trayecto Educativo Discontinuo"
                              >
                                <span>TED</span>
                              </button>
                            </div>
                          </td>

                          {/* Observación Pedagógica */}
                          <td className="py-2 px-4">
                            <input
                              type="text"
                              placeholder="Ej: Pendiente TP 1, Buen trabajo..."
                              value={row.observation}
                              onChange={(e) => handleSetObservation(row.student.id, e.target.value)}
                              className={`w-full px-2.5 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                                isDarkMode
                                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                                  : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Export & Sheets Integration Tools */}
          <div
            className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
              isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-gradient-to-r from-emerald-50/50 via-amber-50/40 to-neutral-50 border-emerald-200'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="toggle-matrix-column"
                  checked={showInMatrix}
                  onChange={(e) => setShowInMatrix(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded cursor-pointer"
                />
                <label
                  htmlFor="toggle-matrix-column"
                  className="text-xs font-semibold cursor-pointer text-neutral-800 dark:text-slate-200"
                >
                  Mostrar columna de <strong>Valoración Preliminar (TEA / TEP)</strong> en la planilla de calificaciones
                </label>
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                Se sincronizan todas las {selectedAssessmentsMeta.length} notas seleccionadas con su promedio y calificación cualitativa.
              </p>
            </div>

            {/* Google Sheets Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Sincronizar / Importar a Google Sheets */}
              <button
                type="button"
                id="btn-import-google-sheets"
                onClick={handleImportToGoogleSheets}
                disabled={isSyncingSheets}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                title="Crea o actualiza una hoja en Google Sheets con las notas individuales, promedio y TEA/TEP"
              >
                {isSyncingSheets ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                )}
                <span>
                  {isSyncingSheets ? 'Sincronizando...' : 'Importar a Google Sheets'}
                </span>
                <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
              </button>

              {/* Copiar para Sheets (Ctrl+V) */}
              <button
                type="button"
                onClick={handleCopyForSheets}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  copiedToClipboard
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                    : isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
                title="Copia los datos en formato tabla para pegar directamente con Ctrl+V en cualquier Google Sheet"
              >
                {copiedToClipboard ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 text-blue-500" />}
                <span>{copiedToClipboard ? '¡Copiado!' : 'Copiar para Sheets'}</span>
              </button>

              {/* Export CSV */}
              <button
                type="button"
                onClick={handleExportCSV}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
                title="Descargar archivo CSV con todas las notas seleccionadas y valoraciones"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <span>CSV</span>
              </button>

              {/* Print */}
              <button
                type="button"
                onClick={handlePrint}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
                title="Imprimir informe de valoración preliminar"
              >
                <Printer className="w-3.5 h-3.5 text-blue-500" />
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3.5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-slate-400">
            <span>
              {stats.teaCount + stats.tepCount + stats.tedCount} de {stats.total} alumnos valorados.
            </span>
            <span>•</span>
            <span>{selectedAssessmentsMeta.length} notas incluidas</span>
            {spreadsheetUrl && (
              <>
                <span>•</span>
                <a
                  href={spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 hover:underline font-semibold flex items-center gap-0.5"
                >
                  <span>Ver en Sheets</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300'
              }`}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-md hover:shadow-lg transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Guardar Valoración Preliminar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
