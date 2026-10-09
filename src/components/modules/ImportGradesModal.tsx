import React, { useState, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  X,
  Search,
  Filter,
  ArrowRight,
  Eye,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Download,
  FileCheck,
  Info,
  Check,
  Edit3,
  Calendar,
  History,
  Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Student } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import {
  GradeHistoryEntry,
  exportGradeHistoryToExcel,
  exportGradebookMatrixToExcel,
} from '../../utils/excelExport';

export interface ParsedStudentRow {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  matchedFromRaw: string;
  matchScore: number; // 0 to 1
  currentScore?: string;
  importedScore: string;
  editedScore: string;
  isValid: boolean;
  isIncluded: boolean;
  status: 'new' | 'update' | 'same' | 'missing_in_file' | 'invalid';
  note?: string;
}

export interface ImportGradesModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  students: Student[];
  categories1c: GradeCategory[];
  categories2c: GradeCategory[];
  gradesMap1c: StudentGradesMap;
  gradesMap2c: StudentGradesMap;
  currentTerm: '1c' | '2c';
  isDarkMode: boolean;
  onApplyGrades: (data: {
    term: '1c' | '2c';
    categoryId: string;
    subcategoryId: string;
    newSubcategoryName?: string;
    updates: Record<string, string>; // studentId -> score
    historyEntry: GradeHistoryEntry;
  }) => void;
  historyEntries?: GradeHistoryEntry[];
}

export const ImportGradesModal: React.FC<ImportGradesModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  students,
  categories1c,
  categories2c,
  gradesMap1c,
  gradesMap2c,
  currentTerm: initialTerm,
  isDarkMode,
  onApplyGrades,
  historyEntries = [],
}) => {
  // Modal Navigation: Step 1 (Upload/Paste) -> Step 2 (Verification: Planilla junta & Alumno x Alumno) -> Step 3 (History view)
  const [activeStep, setActiveStep] = useState<'upload' | 'verify' | 'history'>('upload');
  const [sourceType, setSourceType] = useState<'file' | 'paste'>('file');

  // Term and Target column configuration
  const [selectedTerm, setSelectedTerm] = useState<'1c' | '2c'>(initialTerm);
  const activeCategories = selectedTerm === '1c' ? categories1c : categories2c;
  const activeGradesMap = selectedTerm === '1c' ? gradesMap1c : gradesMap2c;

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(() => {
    return activeCategories[0]?.id || '';
  });

  const activeCategory = activeCategories.find((c) => c.id === selectedCategoryId) || activeCategories[0];

  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>(() => {
    return activeCategory?.subcategories[0]?.id || 'NEW_COLUMN';
  });

  const [newSubcategoryTitle, setNewSubcategoryTitle] = useState('');
  const [isCreatingNewColumn, setIsCreatingNewColumn] = useState(false);

  // File parsing states
  const [fileName, setFileName] = useState<string>('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [rawWorkbook, setRawWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedNameColumn, setSelectedNameColumn] = useState<string>('');
  const [selectedScoreColumn, setSelectedScoreColumn] = useState<string>('');
  const [rawTableRows, setRawTableRows] = useState<Array<Record<string, any>>>([]);

  // Textarea paste state
  const [pasteText, setPasteText] = useState<string>('');

  // Verified rows state
  const [verifiedRows, setVerifiedRows] = useState<ParsedStudentRow[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'changes' | 'new' | 'update' | 'missing'>('all');
  const [searchFilter, setSearchFilter] = useState('');

  // Student-by-student inspector state
  const [inspectionMode, setInspectionMode] = useState<'table' | 'individual'>('table');
  const [selectedStudentIndex, setSelectedStudentIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ensure category and subcategory are synced if term changes
  React.useEffect(() => {
    if (activeCategories.length > 0) {
      if (!activeCategories.some((c) => c.id === selectedCategoryId)) {
        setSelectedCategoryId(activeCategories[0].id);
        const firstSub = activeCategories[0].subcategories[0]?.id || 'NEW_COLUMN';
        setSelectedSubcategoryId(firstSub);
      }
    }
  }, [selectedTerm, activeCategories, selectedCategoryId]);

  // Clean name string for fuzzy matching
  const normalizeText = (text: string): string => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
  };

  /**
   * Emparejamiento fuzzy entre el texto del Excel y el alumno del curso
   */
  const findBestStudentMatch = (rawName: string): { student: Student | null; score: number } => {
    const rawClean = normalizeText(rawName);
    if (!rawClean) return { student: null, score: 0 };

    let bestMatch: Student | null = null;
    let highestScore = 0;

    for (const student of students) {
      const lastClean = normalizeText(student.lastName);
      const firstClean = normalizeText(student.firstName);
      const fullLastFirst = `${lastClean} ${firstClean}`;
      const fullFirstLast = `${firstClean} ${lastClean}`;
      const emailClean = student.email ? normalizeText(student.email) : '';

      // 1. Coincidencia exacta de email
      if (emailClean && (rawClean === emailClean || rawClean.includes(emailClean))) {
        return { student, score: 1.0 };
      }

      // 2. Coincidencia exacta de Apellido y Nombre
      if (rawClean === fullLastFirst || rawClean === fullFirstLast) {
        return { student, score: 0.99 };
      }

      // 3. Contiene apellido y contiene nombre
      if (rawClean.includes(lastClean) && rawClean.includes(firstClean)) {
        return { student, score: 0.9 };
      }

      // 4. Token overlap
      const rawTokens = rawClean.split(/\s+/).filter(Boolean);
      const studentTokens = `${lastClean} ${firstClean}`.split(/\s+/).filter(Boolean);
      let matchedTokens = 0;
      for (const t of rawTokens) {
        if (studentTokens.includes(t)) {
          matchedTokens++;
        }
      }
      const tokenScore = matchedTokens / Math.max(rawTokens.length, studentTokens.length);
      if (tokenScore > highestScore) {
        highestScore = tokenScore;
        bestMatch = student;
      }
    }

    if (highestScore >= 0.5) {
      return { student: bestMatch, score: highestScore };
    }

    return { student: null, score: 0 };
  };

  /**
   * Procesa la tabla cruda (del Excel o del texto pegado) y construye la planilla de verificación
   */
  const buildVerificationRows = (
    rawRows: Array<Record<string, any>>,
    nameCol: string,
    scoreCol: string
  ) => {
    const currentSubId = isCreatingNewColumn ? 'NEW_COLUMN' : selectedSubcategoryId;
    const subIdToLookup = currentSubId === 'NEW_COLUMN' ? '' : currentSubId;

    // Mapa de notas crudas asociadas a alumnos por id
    const matchedByStudentId: Record<
      string,
      { rawName: string; rawScore: string; matchScore: number }
    > = {};

    rawRows.forEach((row) => {
      const rawNameVal = String(row[nameCol] || '').trim();
      const rawScoreVal = String(row[scoreCol] !== undefined ? row[scoreCol] : '').trim();

      if (!rawNameVal) return;

      const { student, score } = findBestStudentMatch(rawNameVal);
      if (student && score >= 0.5) {
        matchedByStudentId[student.id] = {
          rawName: rawNameVal,
          rawScore: rawScoreVal,
          matchScore: score,
        };
      }
    });

    // Construir la lista completa de TODOS los alumnos del curso
    const results: ParsedStudentRow[] = students.map((st) => {
      const currentScore = subIdToLookup ? activeGradesMap[st.id]?.[subIdToLookup] || '' : '';
      const matched = matchedByStudentId[st.id];

      if (!matched) {
        return {
          studentId: st.id,
          studentName: `${st.lastName}, ${st.firstName}`,
          studentEmail: st.email,
          matchedFromRaw: '',
          matchScore: 0,
          currentScore: currentScore || undefined,
          importedScore: '',
          editedScore: '',
          isValid: true,
          isIncluded: false, // No estaba en el archivo
          status: 'missing_in_file',
          note: 'No se encontró en el archivo importado',
        };
      }

      // Limpiar nota: convertir comas a puntos si es decimal
      let cleanScore = matched.rawScore.replace(',', '.').trim();
      const numVal = parseFloat(cleanScore);
      const isValidNumber = !isNaN(numVal) && numVal >= 0 && numVal <= 10;
      const isValid = cleanScore === '' || isValidNumber;

      let status: ParsedStudentRow['status'] = 'new';
      if (!isValid) {
        status = 'invalid';
      } else if (cleanScore === '') {
        status = 'missing_in_file';
      } else if (!currentScore) {
        status = 'new';
      } else if (currentScore === cleanScore) {
        status = 'same';
      } else {
        status = 'update';
      }

      return {
        studentId: st.id,
        studentName: `${st.lastName}, ${st.firstName}`,
        studentEmail: st.email,
        matchedFromRaw: matched.rawName,
        matchScore: matched.matchScore,
        currentScore: currentScore || undefined,
        importedScore: cleanScore,
        editedScore: cleanScore,
        isValid,
        isIncluded: isValid && cleanScore !== '' && status !== 'same',
        status,
        note: status === 'update' ? `Cambia de ${currentScore} a ${cleanScore}` : undefined,
      };
    });

    setVerifiedRows(results);
    setActiveStep('verify');
    setInspectionMode('table');
  };

  /**
   * Manejador de carga de archivo Excel (.xlsx, .xls, .csv)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        setRawWorkbook(wb);
        setSheetNames(wb.SheetNames);
        const firstSheet = wb.SheetNames[0];
        setSelectedSheetName(firstSheet);
        parseSheet(wb, firstSheet);
      } catch (err) {
        console.error('Error al procesar archivo Excel:', err);
        alert('Hubo un error al leer el archivo. Asegúrate de que sea un Excel válido (.xlsx, .xls o .csv)');
      }
    };

    reader.readAsBinaryString(file);
  };

  /**
   * Extrae filas y columnas de una hoja seleccionada
   */
  const parseSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;

    const jsonData: Array<Record<string, any>> = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (jsonData.length === 0) {
      alert('La hoja seleccionada no tiene filas de datos.');
      return;
    }

    setRawTableRows(jsonData);
    const cols = Object.keys(jsonData[0] || {});
    setAvailableColumns(cols);

    // Detección automática de columnas
    const nameCol = cols.find((c) =>
      /alumno|nombre|estudiante|apellido|nom|ape|persona/i.test(c)
    ) || cols[0];

    const scoreCol = cols.find((c) =>
      /nota|calif|puntaje|eval|puntos|score|parcial|tp/i.test(c)
    ) || (cols.length > 1 ? cols[1] : cols[0]);

    setSelectedNameColumn(nameCol);
    setSelectedScoreColumn(scoreCol);
  };

  /**
   * Parsear texto pegado desde Excel o Google Sheets (separado por tabulaciones o comas)
   */
  const handleParsePaste = () => {
    if (!pasteText.trim()) {
      alert('Por favor pega datos de tu planilla (Ctrl+V) antes de continuar.');
      return;
    }

    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    // Detectar si la primera fila son encabezados o ya son alumnos
    const firstTokens = lines[0].split(/\t|,|;/).map((s) => s.trim());
    const hasHeader = firstTokens.some((t) =>
      /alumno|nombre|apellido|nota|calificacion|tp|eval/i.test(t)
    );

    const startIndex = hasHeader ? 1 : 0;
    const nameCol = hasHeader ? firstTokens[0] : 'Columna 1';
    const scoreCol = hasHeader ? (firstTokens[1] || 'Columna 2') : 'Columna 2';

    const parsedData: Array<Record<string, any>> = [];

    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(/\t|,|;/).map((s) => s.trim());
      if (parts.length >= 2) {
        parsedData.push({
          [nameCol]: parts[0],
          [scoreCol]: parts[1],
        });
      } else if (parts.length === 1) {
        parsedData.push({
          [nameCol]: parts[0],
          [scoreCol]: '',
        });
      }
    }

    if (parsedData.length === 0) {
      alert('No se detectaron columnas válidas. Asegúrate de copiar filas con Apellido/Nombre y Nota.');
      return;
    }

    setRawTableRows(parsedData);
    setAvailableColumns([nameCol, scoreCol]);
    setSelectedNameColumn(nameCol);
    setSelectedScoreColumn(scoreCol);
    setFileName('Datos Pegados desde Portapapeles');

    buildVerificationRows(parsedData, nameCol, scoreCol);
  };

  /**
   * Ejecutar la verificación inicial una vez elegidas las columnas
   */
  const handleProceedToVerification = () => {
    if (!selectedNameColumn || !selectedScoreColumn) {
      alert('Por favor selecciona la columna de Alumnos y la columna de Notas.');
      return;
    }
    buildVerificationRows(rawTableRows, selectedNameColumn, selectedScoreColumn);
  };

  // Métricas del escaneo
  const metrics = useMemo(() => {
    const total = verifiedRows.length;
    const included = verifiedRows.filter((r) => r.isIncluded);
    const newGrades = verifiedRows.filter((r) => r.status === 'new' && r.isIncluded).length;
    const updates = verifiedRows.filter((r) => r.status === 'update' && r.isIncluded).length;
    const same = verifiedRows.filter((r) => r.status === 'same').length;
    const missing = verifiedRows.filter((r) => r.status === 'missing_in_file').length;
    const invalid = verifiedRows.filter((r) => !r.isValid).length;

    return { total, includedCount: included.length, newGrades, updates, same, missing, invalid };
  }, [verifiedRows]);

  // Filtrado de filas en la tabla
  const displayedRows = useMemo(() => {
    return verifiedRows.filter((r) => {
      // Filtro por estado
      if (filterMode === 'changes' && !r.isIncluded) return false;
      if (filterMode === 'new' && r.status !== 'new') return false;
      if (filterMode === 'update' && r.status !== 'update') return false;
      if (filterMode === 'missing' && r.status !== 'missing_in_file') return false;

      // Filtro por texto de búsqueda
      if (searchFilter.trim()) {
        const query = normalizeText(searchFilter);
        const nameMatch = normalizeText(r.studentName).includes(query);
        const rawMatch = normalizeText(r.matchedFromRaw).includes(query);
        const emailMatch = r.studentEmail ? normalizeText(r.studentEmail).includes(query) : false;
        if (!nameMatch && !rawMatch && !emailMatch) return false;
      }

      return true;
    });
  }, [verifiedRows, filterMode, searchFilter]);

  // Modificación in-situ de una nota
  const handleScoreEdit = (studentId: string, newScore: string) => {
    setVerifiedRows((prev) =>
      prev.map((row) => {
        if (row.studentId !== studentId) return row;

        const cleanVal = newScore.replace(',', '.').trim();
        const numVal = parseFloat(cleanVal);
        const isValid = cleanVal === '' || (!isNaN(numVal) && numVal >= 0 && numVal <= 10);

        let newStatus = row.status;
        if (!isValid) {
          newStatus = 'invalid';
        } else if (cleanVal === '') {
          newStatus = 'missing_in_file';
        } else if (!row.currentScore) {
          newStatus = 'new';
        } else if (row.currentScore === cleanVal) {
          newStatus = 'same';
        } else {
          newStatus = 'update';
        }

        return {
          ...row,
          editedScore: cleanVal,
          isValid,
          isIncluded: isValid && cleanVal !== '' && newStatus !== 'same',
          status: newStatus,
          note: newStatus === 'update' ? `Editado por docente: de ${row.currentScore} a ${cleanVal}` : undefined,
        };
      })
    );
  };

  // Alternar checkbox de inclusión
  const handleToggleInclude = (studentId: string) => {
    setVerifiedRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, isIncluded: !r.isIncluded } : r))
    );
  };

  // Incluir / Desmarcar todos
  const handleToggleAll = (included: boolean) => {
    setVerifiedRows((prev) =>
      prev.map((r) => ({
        ...r,
        isIncluded: r.isValid && r.editedScore !== '' ? included : false,
      }))
    );
  };

  // Reasignar emparejamiento manual de un alumno
  const handleReassignStudent = (currentRowStudentId: string, newTargetStudentId: string) => {
    if (currentRowStudentId === newTargetStudentId) return;
    const targetStudent = students.find((s) => s.id === newTargetStudentId);
    if (!targetStudent) return;

    setVerifiedRows((prev) => {
      return prev.map((r) => {
        if (r.studentId === currentRowStudentId) {
          return {
            ...r,
            studentId: targetStudent.id,
            studentName: `${targetStudent.lastName}, ${targetStudent.firstName}`,
            studentEmail: targetStudent.email,
            matchScore: 1.0,
            note: 'Emparejado manualmente por el docente',
          };
        }
        return r;
      });
    });
  };

  // Confirmar y registrar en la planilla
  const handleConfirmAndRegister = () => {
    const includedRows = verifiedRows.filter((r) => r.isIncluded && r.isValid && r.editedScore !== '');

    if (includedRows.length === 0) {
      alert('No hay ninguna nota marcada para registrar. Marca los alumnos que deseas actualizar.');
      return;
    }

    // Determinar subcategoría destino
    let targetSubId = selectedSubcategoryId;
    let newSubName: string | undefined = undefined;

    if (isCreatingNewColumn || selectedSubcategoryId === 'NEW_COLUMN') {
      targetSubId = `sub-${Date.now()}`;
      newSubName = newSubcategoryTitle.trim() || `Evaluación (${new Date().toLocaleDateString('es-AR')})`;
    }

    const updates: Record<string, string> = {};
    let totalScoreSum = 0;

    includedRows.forEach((r) => {
      updates[r.studentId] = r.editedScore;
      const num = parseFloat(r.editedScore);
      if (!isNaN(num)) totalScoreSum += num;
    });

    const averageScore = includedRows.length > 0 ? totalScoreSum / includedRows.length : undefined;

    const subNameLabel =
      newSubName ||
      activeCategory?.subcategories.find((s) => s.id === targetSubId)?.name ||
      'Evaluación';

    // Construir entrada para el historial de auditoría
    const historyEntry: GradeHistoryEntry = {
      id: `gh-${Date.now()}`,
      courseId,
      timestamp: Date.now(),
      date: new Date().toLocaleDateString('es-AR'),
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      term: selectedTerm,
      termLabel: selectedTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre',
      subcategoryId: targetSubId,
      evaluationName: subNameLabel,
      categoryName: activeCategory?.name || 'Evaluaciones',
      action: sourceType === 'file' ? 'import_excel' : 'import_sheets',
      description: `Se registraron/actualizaron ${includedRows.length} calificaciones para "${subNameLabel}"`,
      updatedStudentsCount: includedRows.length,
      averageScore,
      sourceFile: fileName || undefined,
      changesSummary: includedRows.map((r) => ({
        studentId: r.studentId,
        studentName: r.studentName,
        studentEmail: r.studentEmail,
        previousScore: r.currentScore,
        newScore: r.editedScore,
        status: r.status === 'new' ? 'new' : r.status === 'update' ? 'updated' : 'unchanged',
      })),
    };

    onApplyGrades({
      term: selectedTerm,
      categoryId: activeCategory?.id || '',
      subcategoryId: targetSubId,
      newSubcategoryName: newSubName,
      updates,
      historyEntry,
    });

    onClose();
  };

  // Alumno seleccionado actualmente para inspección individual
  const currentInspectedStudent = displayedRows[selectedStudentIndex] || displayedRows[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all ${
          isDarkMode
            ? 'bg-slate-900 border-slate-750 text-slate-100'
            : 'bg-white border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Encabezado Principal */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base leading-tight">
                  Importar y Registrar Notas desde Excel o Sheets
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {courseName}
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                {activeStep === 'upload' && 'Paso 1: Sube tu archivo o pega tus datos y elige la columna de notas'}
                {activeStep === 'verify' && 'Paso 2: Verificación previa completa antes de registrar en la planilla'}
                {activeStep === 'history' && 'Historial de importaciones y registros realizados'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {historyEntries.length > 0 && activeStep !== 'history' && (
              <button
                type="button"
                onClick={() => setActiveStep('history')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300'
                }`}
                title="Ver historial de importaciones anteriores"
              >
                <History className="w-3.5 h-3.5 text-blue-500" />
                <span className="hidden sm:inline">Historial</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                  {historyEntries.length}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PASO 1: CARGA DE ARCHIVO / PEGADO DE DATOS                                 */}
        {/* ========================================================================= */}
        {activeStep === 'upload' && (
          <div className="p-6 overflow-y-auto space-y-6">
            {/* Configuración de Destino en la Planilla */}
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-blue-50/50 border-blue-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  ¿Dónde se registrarán estas notas en la planilla?
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Cuatrimestre */}
                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                    Cuatrimestre
                  </label>
                  <select
                    value={selectedTerm}
                    onChange={(e) => setSelectedTerm(e.target.value as '1c' | '2c')}
                    className={`w-full px-3 py-2 text-xs rounded-xl border font-medium outline-hidden ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  >
                    <option value="1c">1° Cuatrimestre</option>
                    <option value="2c">2° Cuatrimestre</option>
                  </select>
                </div>

                {/* Categoría Mayor */}
                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                    Categoría Mayor
                  </label>
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => {
                      setSelectedCategoryId(e.target.value);
                      const cat = activeCategories.find((c) => c.id === e.target.value);
                      if (cat && cat.subcategories.length > 0) {
                        setSelectedSubcategoryId(cat.subcategories[0].id);
                        setIsCreatingNewColumn(false);
                      } else {
                        setSelectedSubcategoryId('NEW_COLUMN');
                        setIsCreatingNewColumn(true);
                      }
                    }}
                    className={`w-full px-3 py-2 text-xs rounded-xl border font-medium outline-hidden ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  >
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Columna de Evaluación */}
                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                    Columna de Evaluación
                  </label>
                  <select
                    value={isCreatingNewColumn ? 'NEW_COLUMN' : selectedSubcategoryId}
                    onChange={(e) => {
                      if (e.target.value === 'NEW_COLUMN') {
                        setIsCreatingNewColumn(true);
                        setSelectedSubcategoryId('NEW_COLUMN');
                      } else {
                        setIsCreatingNewColumn(false);
                        setSelectedSubcategoryId(e.target.value);
                      }
                    }}
                    className={`w-full px-3 py-2 text-xs rounded-xl border font-medium outline-hidden ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  >
                    {(activeCategory?.subcategories || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="NEW_COLUMN">➕ + Crear nueva columna de evaluación...</option>
                  </select>
                </div>
              </div>

              {/* Input si crea nueva columna */}
              {isCreatingNewColumn && (
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Nombre de la nueva columna:
                  </span>
                  <input
                    type="text"
                    value={newSubcategoryTitle}
                    onChange={(e) => setNewSubcategoryTitle(e.target.value)}
                    placeholder="Ej. Parcial Unidad 2 / TP Recuperatorio"
                    className={`flex-1 max-w-sm px-3 py-1.5 text-xs rounded-lg border outline-hidden ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                    }`}
                  />
                </div>
              )}
            </div>

            {/* Selector de Origen de Datos: Subir Archivo vs Pegar */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b pb-2">
                <button
                  type="button"
                  onClick={() => setSourceType('file')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sourceType === 'file'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'text-slate-400 hover:text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Subir Archivo Excel o CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSourceType('paste')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sourceType === 'paste'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : isDarkMode
                      ? 'text-slate-400 hover:text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span>Pegar desde Excel / Sheets</span>
                </button>
              </div>

              {/* Opción 1: Subir Archivo */}
              {sourceType === 'file' && (
                <div className="space-y-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                      isDarkMode
                        ? 'border-slate-700 hover:border-emerald-500 bg-slate-850/40 hover:bg-slate-800/60'
                        : 'border-neutral-300 hover:border-emerald-500 bg-neutral-50/50 hover:bg-emerald-50/30'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-bold">
                      {fileName ? `Archivo cargado: ${fileName}` : 'Haz clic o arrastra tu archivo Excel aquí'}
                    </p>
                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Formatos compatibles: .xlsx, .xls, .csv. La app buscará los nombres y notas automáticamente.
                    </p>
                    {fileName && (
                      <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <Check className="w-3.5 h-3.5" /> Archivo leído correctamente
                      </span>
                    )}
                  </div>

                  {/* Selector de Hoja si el Excel tiene más de una */}
                  {sheetNames.length > 1 && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold">Seleccionar Hoja del Libro:</span>
                      <select
                        value={selectedSheetName}
                        onChange={(e) => {
                          setSelectedSheetName(e.target.value);
                          if (rawWorkbook) parseSheet(rawWorkbook, e.target.value);
                        }}
                        className={`px-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                          isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                        }`}
                      >
                        {sheetNames.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Mapeo de Columnas detectadas */}
                  {availableColumns.length > 0 && (
                    <div
                      className={`p-4 rounded-xl border space-y-3 ${
                        isDarkMode ? 'bg-slate-800/40 border-slate-750' : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      <h5 className="text-xs font-bold text-neutral-700 dark:text-slate-300">
                        Confirmar columnas del archivo:
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-400">
                            Columna con los Nombres de Alumnos:
                          </label>
                          <select
                            value={selectedNameColumn}
                            onChange={(e) => setSelectedNameColumn(e.target.value)}
                            className={`w-full px-3 py-2 text-xs rounded-xl border outline-hidden ${
                              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                            }`}
                          >
                            {availableColumns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-400">
                            Columna con las Notas:
                          </label>
                          <select
                            value={selectedScoreColumn}
                            onChange={(e) => setSelectedScoreColumn(e.target.value)}
                            className={`w-full px-3 py-2 text-xs rounded-xl border outline-hidden ${
                              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                            }`}
                          >
                            {availableColumns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleProceedToVerification}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                        >
                          <span>Continuar a Verificación Previa</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Opción 2: Pegar Datos Directos */}
              {sourceType === 'paste' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                      Copia las celdas desde tu Google Sheets o Excel (Ctrl + C) y pégalas aquí (Ctrl + V):
                    </label>
                    <textarea
                      rows={8}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={`Ejemplo:\nGarcía Juan\t8.5\nPérez María\t9\nGonzález Lucas\t7\nRodríguez Sofía\t10`}
                      className={`w-full p-3 font-mono text-xs rounded-xl border outline-hidden ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-750 text-slate-200'
                          : 'bg-white border-neutral-300 text-neutral-800'
                      }`}
                    />
                    <p className={`text-[11px] mt-1 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Se admiten filas con dos columnas: Nombre del alumno y Nota (separados por tabulador o coma).
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleParsePaste}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                    >
                      <span>Procesar y Ver Planilla</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 2: PANTALLA DE VERIFICACIÓN (PLANILLA JUNTA + ALUMNO X ALUMNO)        */}
        {/* ========================================================================= */}
        {activeStep === 'verify' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Barra Superior con Métricas y Filtros */}
            <div
              className={`p-4 border-b space-y-3 shrink-0 ${
                isDarkMode ? 'bg-slate-850/80 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
              }`}
            >
              {/* Tarjetas de Resumen Rápido */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div
                  onClick={() => setFilterMode('all')}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                    filterMode === 'all'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300'
                      : isDarkMode
                      ? 'border-slate-750 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold opacity-75">Total Nómina</div>
                  <div className="text-base font-extrabold">{metrics.total} alumnos</div>
                </div>

                <div
                  onClick={() => setFilterMode('changes')}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                    filterMode === 'changes'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                      : isDarkMode
                      ? 'border-slate-750 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                    A Registrar / Marcados
                  </div>
                  <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                    {metrics.includedCount} notas
                  </div>
                </div>

                <div
                  onClick={() => setFilterMode('update')}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                    filterMode === 'update'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                      : isDarkMode
                      ? 'border-slate-750 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">
                    Sobrescribe Nota
                  </div>
                  <div className="text-base font-extrabold text-amber-600 dark:text-amber-400">
                    {metrics.updates} alumnos
                  </div>
                </div>

                <div
                  onClick={() => setFilterMode('new')}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                    filterMode === 'new'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300'
                      : isDarkMode
                      ? 'border-slate-750 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                    Notas Nuevas
                  </div>
                  <div className="text-base font-extrabold text-blue-600 dark:text-blue-400">
                    {metrics.newGrades} alumnos
                  </div>
                </div>

                <div
                  onClick={() => setFilterMode('missing')}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                    filterMode === 'missing'
                      ? 'border-neutral-500 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                      : isDarkMode
                      ? 'border-slate-750 bg-slate-800/60 text-slate-400'
                      : 'border-neutral-200 bg-white text-neutral-500'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold opacity-75">Sin Nota en Archivo</div>
                  <div className="text-base font-extrabold">{metrics.missing}</div>
                </div>
              </div>

              {/* Barra de Controles: Alternar Modo de Vista (Planilla Completa vs Alumno x Alumno) */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  {/* Selector de Vista: Planilla Completa vs Alumno x Alumno */}
                  <div
                    className={`p-1 rounded-xl border flex items-center gap-1 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-100 border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setInspectionMode('table')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        inspectionMode === 'table'
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : isDarkMode
                          ? 'text-slate-400 hover:text-white'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Vista Planilla Completa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectionMode('individual')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        inspectionMode === 'individual'
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : isDarkMode
                          ? 'text-slate-400 hover:text-white'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Ver Alumno por Alumno</span>
                    </button>
                  </div>

                  <div className="hidden lg:flex items-center gap-1 text-[11px] text-neutral-500 dark:text-slate-400 pl-2">
                    <Info className="w-3.5 h-3.5 text-blue-500" />
                    <span>Puedes corregir cualquier nota directamente antes de registrarla.</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Búsqueda rápida */}
                  <div className="relative flex-1 sm:w-56">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Buscar alumno..."
                      className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                          : 'bg-white border-neutral-300 text-neutral-800 placeholder:text-neutral-400'
                      }`}
                    />
                  </div>

                  {/* Acciones de selección masiva */}
                  <button
                    type="button"
                    onClick={() => handleToggleAll(true)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleAll(false)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    Desmarcar
                  </button>
                </div>
              </div>
            </div>

            {/* CONTENIDO PRINCIPAL: MODO TABLA COMPLETA vs MODO ALUMNO POR ALUMNO */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* ============================================================== */}
              {/* SUB-MODO A: VISTA DE PLANILLA COMPLETA (TODOS LOS ALUMNOS JUNTOS) */}
              {/* ============================================================== */}
              {inspectionMode === 'table' && (
                <div
                  className={`border rounded-xl overflow-hidden shadow-xs ${
                    isDarkMode ? 'border-slate-750 bg-slate-900' : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr
                          className={`border-b ${
                            isDarkMode
                              ? 'bg-slate-800/90 border-slate-750 text-slate-300'
                              : 'bg-neutral-100/80 border-neutral-200 text-neutral-700'
                          }`}
                        >
                          <th className="py-2.5 px-3 w-10 text-center font-bold">Inc.</th>
                          <th className="py-2.5 px-3 w-12 text-center font-bold">N°</th>
                          <th className="py-2.5 px-4 font-bold">Alumno del Curso</th>
                          <th className="py-2.5 px-3 font-bold">Coincidencia en Archivo</th>
                          <th className="py-2.5 px-3 text-center font-bold">Nota Actual</th>
                          <th className="py-2.5 px-3 text-center font-bold">Nota Excel</th>
                          <th className="py-2.5 px-3 text-center font-bold w-32">Nota a Aplicar</th>
                          <th className="py-2.5 px-3 font-bold">Estado / Observación</th>
                          <th className="py-2.5 px-3 text-center font-bold w-20">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-slate-800">
                        {displayedRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-8 text-center text-neutral-400">
                              No se encontraron alumnos con los filtros seleccionados.
                            </td>
                          </tr>
                        ) : (
                          displayedRows.map((row, idx) => (
                            <tr
                              key={row.studentId}
                              className={`transition-colors ${
                                !row.isIncluded
                                  ? 'opacity-60 bg-neutral-50/30 dark:bg-slate-900/40'
                                  : row.status === 'update'
                                  ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                  : row.status === 'new'
                                  ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                  : isDarkMode
                                  ? 'hover:bg-slate-800/40'
                                  : 'hover:bg-neutral-50'
                              }`}
                            >
                              {/* Checkbox de Inclusión */}
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={row.isIncluded}
                                  onChange={() => handleToggleInclude(row.studentId)}
                                  disabled={!row.isValid || row.editedScore === ''}
                                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                              </td>

                              {/* Índice */}
                              <td className="py-2.5 px-3 text-center font-mono text-[11px] text-neutral-400">
                                {idx + 1}
                              </td>

                              {/* Nombre del Alumno */}
                              <td className="py-2.5 px-4 font-semibold">
                                <div className="leading-tight">{row.studentName}</div>
                                {row.studentEmail && (
                                  <div className="text-[10px] text-neutral-400 font-normal">
                                    {row.studentEmail}
                                  </div>
                                )}
                              </td>

                              {/* Coincidencia detectada en Excel */}
                              <td className="py-2.5 px-3">
                                {row.matchedFromRaw ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[11px] text-neutral-600 dark:text-slate-300">
                                      {row.matchedFromRaw}
                                    </span>
                                    {row.matchScore >= 0.9 ? (
                                      <span
                                        className="text-[10px] px-1 py-0.2 rounded font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                                        title="Coincidencia exacta"
                                      >
                                        ✓ Exacto
                                      </span>
                                    ) : (
                                      <span
                                        className="text-[10px] px-1 py-0.2 rounded font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400"
                                        title="Coincidencia aproximada"
                                      >
                                        ~ Similar
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-neutral-400 text-[11px] italic">
                                    (No encontrado en archivo)
                                  </span>
                                )}
                              </td>

                              {/* Nota Actual */}
                              <td className="py-2.5 px-3 text-center font-mono font-bold">
                                {row.currentScore !== undefined ? (
                                  <span className="text-neutral-600 dark:text-slate-300">
                                    {row.currentScore}
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">-</span>
                                )}
                              </td>

                              {/* Nota Detectada en el Archivo */}
                              <td className="py-2.5 px-3 text-center font-mono font-semibold">
                                {row.importedScore !== '' ? (
                                  <span className="text-blue-600 dark:text-blue-400">
                                    {row.importedScore}
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">-</span>
                                )}
                              </td>

                              {/* Input Editable de Nota a Aplicar */}
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center">
                                  <input
                                    type="text"
                                    value={row.editedScore}
                                    onChange={(e) => handleScoreEdit(row.studentId, e.target.value)}
                                    placeholder="-"
                                    className={`w-16 py-1 px-2 text-center font-mono font-bold text-xs rounded-lg border outline-hidden transition-all ${
                                      !row.isValid
                                        ? 'border-red-500 bg-red-50 dark:bg-red-950/50 text-red-600'
                                        : row.status === 'update'
                                        ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 focus:border-amber-500'
                                        : row.status === 'new'
                                        ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 focus:border-emerald-500'
                                        : isDarkMode
                                        ? 'bg-slate-800 border-slate-700 text-slate-100'
                                        : 'bg-white border-neutral-300 text-neutral-800'
                                    }`}
                                  />
                                </div>
                              </td>

                              {/* Estado Visual */}
                              <td className="py-2.5 px-3">
                                {row.status === 'new' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                    <Check className="w-3 h-3" /> Nueva Nota
                                  </span>
                                )}
                                {row.status === 'update' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                    <Edit3 className="w-3 h-3" /> Reemplaza: {row.currentScore} → {row.editedScore}
                                  </span>
                                )}
                                {row.status === 'same' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                                    Sin cambios ({row.editedScore})
                                  </span>
                                )}
                                {row.status === 'missing_in_file' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                                    No presente
                                  </span>
                                )}
                                {row.status === 'invalid' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800">
                                    <AlertTriangle className="w-3 h-3" /> Nota inválida (0-10)
                                  </span>
                                )}
                              </td>

                              {/* Botón Ver Detalle Individual */}
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedStudentIndex(idx);
                                    setInspectionMode('individual');
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40 text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                  title="Inspeccionar este alumno en detalle"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ============================================================== */}
              {/* SUB-MODO B: INSPECTOR ALUMNO POR ALUMNO                       */}
              {/* ============================================================== */}
              {inspectionMode === 'individual' && currentInspectedStudent && (
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Navegación Alumno Anterior / Siguiente */}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={selectedStudentIndex <= 0}
                      onClick={() => setSelectedStudentIndex((prev) => Math.max(0, prev - 1))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Alumno Anterior</span>
                    </button>

                    <div className="text-xs font-bold">
                      Alumno {selectedStudentIndex + 1} de {displayedRows.length}
                    </div>

                    <button
                      type="button"
                      disabled={selectedStudentIndex >= displayedRows.length - 1}
                      onClick={() =>
                        setSelectedStudentIndex((prev) =>
                          Math.min(displayedRows.length - 1, prev + 1)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <span>Siguiente Alumno</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Tarjeta Detallada del Alumno */}
                  <div
                    className={`p-6 rounded-2xl border shadow-lg space-y-5 ${
                      isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-lg font-bold leading-tight">
                          {currentInspectedStudent.studentName}
                        </h4>
                        {currentInspectedStudent.studentEmail && (
                          <p className="text-xs text-neutral-400 mt-0.5">
                            {currentInspectedStudent.studentEmail}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-neutral-500">Texto en Excel:</span>
                          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-neutral-100 dark:bg-slate-800">
                            {currentInspectedStudent.matchedFromRaw || '(No encontrado)'}
                          </span>
                        </div>
                      </div>

                      {/* Checkbox de Inclusión en la tarjeta */}
                      <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={currentInspectedStudent.isIncluded}
                          onChange={() => handleToggleInclude(currentInspectedStudent.studentId)}
                          disabled={
                            !currentInspectedStudent.isValid ||
                            currentInspectedStudent.editedScore === ''
                          }
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span>Incluir en registro</span>
                      </label>
                    </div>

                    {/* Comparativa Lado a Lado */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div
                        className={`p-3 rounded-xl border text-center ${
                          isDarkMode ? 'bg-slate-800/60 border-slate-750' : 'bg-neutral-50 border-neutral-200'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-bold text-neutral-500">
                          Nota en Planilla Actual
                        </div>
                        <div className="text-xl font-bold font-mono mt-1">
                          {currentInspectedStudent.currentScore || '-'}
                        </div>
                      </div>

                      <div
                        className={`p-3 rounded-xl border text-center ${
                          isDarkMode ? 'bg-slate-800/60 border-slate-750' : 'bg-blue-50/50 border-blue-200'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                          Nota Detectada en Excel
                        </div>
                        <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                          {currentInspectedStudent.importedScore || '-'}
                        </div>
                      </div>

                      <div
                        className={`p-3 rounded-xl border text-center ${
                          currentInspectedStudent.status === 'update'
                            ? 'bg-amber-500/10 border-amber-500/30'
                            : currentInspectedStudent.status === 'new'
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : isDarkMode
                            ? 'bg-slate-800/60 border-slate-750'
                            : 'bg-neutral-50 border-neutral-200'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                          Nota Final a Asignar
                        </div>
                        <div className="mt-1 flex items-center justify-center">
                          <input
                            type="text"
                            value={currentInspectedStudent.editedScore}
                            onChange={(e) =>
                              handleScoreEdit(currentInspectedStudent.studentId, e.target.value)
                            }
                            className="w-20 py-1 text-center font-mono font-bold text-xl rounded-lg border outline-hidden"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Observación y Reasignación si fuera necesaria */}
                    <div className="pt-2 border-t text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-neutral-600 dark:text-slate-400">
                          Estado:
                        </span>
                        <span>
                          {currentInspectedStudent.status === 'new' && '✨ Nueva calificación para este alumno'}
                          {currentInspectedStudent.status === 'update' && '⚠️ Modificará la nota existente'}
                          {currentInspectedStudent.status === 'same' && 'ℹ️ La nota es idéntica a la actual'}
                          {currentInspectedStudent.status === 'missing_in_file' && '⚪ No figura en el archivo'}
                        </span>
                      </div>

                      {/* Reasignar a otro alumno si hubo error en coincidencia */}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-neutral-500">¿No corresponde a este alumno?</span>
                        <select
                          value={currentInspectedStudent.studentId}
                          onChange={(e) =>
                            handleReassignStudent(currentInspectedStudent.studentId, e.target.value)
                          }
                          className={`text-xs px-2 py-1 rounded-lg border ${
                            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'
                          }`}
                        >
                          <option value={currentInspectedStudent.studentId}>
                            Emparejado con: {currentInspectedStudent.studentName}
                          </option>
                          {students.map((s) => (
                            <option key={s.id} value={s.id}>
                              Cambiar a: {s.lastName}, {s.firstName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                      <button
                        type="button"
                        onClick={() => setInspectionMode('table')}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        ← Volver a la vista de planilla completa
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (selectedStudentIndex < displayedRows.length - 1) {
                            setSelectedStudentIndex((prev) => prev + 1);
                          } else {
                            setInspectionMode('table');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
                      >
                        <span>Verificar y siguiente</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PASO 3: HISTORIAL DE REGISTROS / AUDITORÍA                                 */}
        {/* ========================================================================= */}
        {activeStep === 'history' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-500" />
                  Historial de Calificaciones e Importaciones
                </h4>
                <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                  Registro cronológico de todas las cargas de notas y auditoría de cambios
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportGradeHistoryToExcel(courseName, historyEntries)}
                  disabled={historyEntries.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar Historial (.xlsx)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveStep(verifiedRows.length > 0 ? 'verify' : 'upload')}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                      : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-300'
                  }`}
                >
                  Volver al Registro
                </button>
              </div>
            </div>

            {historyEntries.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 border rounded-2xl">
                Aún no hay importaciones registradas en el historial de este curso.
              </div>
            ) : (
              <div className="space-y-3">
                {historyEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-4 rounded-xl border space-y-2 ${
                      isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-white border-neutral-200 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs">{entry.evaluationName}</span>
                        <span className="text-neutral-400">•</span>
                        <span className="text-xs text-neutral-500">{entry.termLabel}</span>
                        <span className="text-neutral-400">•</span>
                        <span className="text-xs text-neutral-500">{entry.categoryName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-neutral-400">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          {entry.date} a las {entry.time}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-neutral-600 dark:text-slate-300">
                      {entry.description}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-neutral-500 pt-1 border-t dark:border-slate-800">
                      <span>
                        Alumnos registrados: <strong>{entry.updatedStudentsCount}</strong>
                      </span>
                      {entry.averageScore !== undefined && (
                        <>
                          <span>•</span>
                          <span>
                            Promedio: <strong>{entry.averageScore.toFixed(2)}</strong>
                          </span>
                        </>
                      )}
                      {entry.sourceFile && (
                        <>
                          <span>•</span>
                          <span>
                            Archivo: <strong>{entry.sourceFile}</strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PIE DE PÁGINA CON BOTONES DE ACCIÓN FINAL                                 */}
        {/* ========================================================================= */}
        <div
          className={`px-5 py-3.5 border-t flex items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          {activeStep === 'upload' ? (
            <div className="w-full flex justify-between items-center">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                Cancelar
              </button>
            </div>
          ) : activeStep === 'verify' ? (
            <div className="w-full flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setActiveStep('upload')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Volver a cargar archivo</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {metrics.includedCount} alumnos marcados
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    Se impactarán en {selectedTerm === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleConfirmAndRegister}
                  disabled={metrics.includedCount === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
                >
                  <FileCheck className="w-4 h-4" />
                  <span>Confirmar y Registrar en Planilla ({metrics.includedCount})</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
