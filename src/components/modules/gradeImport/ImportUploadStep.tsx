import React from 'react';
import {
  FileSpreadsheet,
  Upload,
  ClipboardPaste,
  AlertTriangle,
  Search,
  ArrowRight,
  Eye,
  RefreshCw,
  Download,
  FileCheck,
  Layers,
  Link2,
  FolderOpen,
  Loader2,
  FileText,
  Check,
} from 'lucide-react';
import { Student } from '../../../types';
import { GradeCategory, StudentGradesMap } from '../../../types/grades';
import type { QuickPastePreset } from '../../../types/gradeImport';
import {
  findGradeColumnById,
  getIntensificationDisplayLabel,
} from '../../../utils/gradeCalculations';

export interface PreferredTargetColumn {
  categoryId: string;
  subcategoryId: string;
  subcategoryName: string;
}

export interface DriveSpreadsheetItem {
  id: string;
  name: string;
  modifiedTime?: string;
  url: string;
  mimeType?: string;
  docType?: 'sheet' | 'doc' | 'form';
}

export interface ImportUploadStepProps {
  isDarkMode: boolean;
  importContext: 'grades' | 'attendance';
  courseName: string;
  selectedTerm: '1c' | '2c';
  students: Student[];
  activeCategories: GradeCategory[];
  activeGradesMap: StudentGradesMap;
  currentDispositionMap1c: Record<
    string,
    { totalAbsences: number; totalLates?: number; totalDisposition: number }
  >;
  currentDispositionMap2c: Record<
    string,
    { totalAbsences: number; totalLates?: number; totalDisposition: number }
  >;
  preferredTargetColumn: PreferredTargetColumn | null;
  onChangePreferredTargetColumn: (target: PreferredTargetColumn | null) => void;
  onSwitchToForms?: (targetColumn?: PreferredTargetColumn | null) => void;
  sourceType: 'file' | 'csv' | 'sheets' | 'paste';
  onChangeSourceType: (next: 'file' | 'csv' | 'sheets' | 'paste') => void;
  fileName: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sheetUrlInput: string;
  onChangeSheetUrlInput: (val: string) => void;
  isLoadingRemoteSheet: boolean;
  remoteSheetError: string | null;
  onLoadRemoteGoogleSheet: (
    idOrUrl: string,
    targetTab?: string,
    explicitDocType?: 'sheet' | 'doc' | 'form'
  ) => void;
  driveSpreadsheets: DriveSpreadsheetItem[];
  isLoadingDriveSheets: boolean;
  driveSearchQuery: string;
  onChangeDriveSearchQuery: (val: string) => void;
  onLoadDriveSpreadsheets: (query?: string, interactive?: boolean) => void;
  pasteText: string;
  onChangePasteText: (val: string) => void;
  quickPastePreset: QuickPastePreset;
  onChangeQuickPastePreset: (preset: QuickPastePreset) => void;
  onChangeAttendanceTargetMode: (mode: 'disposition' | 'absences' | 'both') => void;
  pastePreviewStats: { rowCount: number; colCount: number };
  onParsePaste: () => void;
}

export const ImportUploadStep: React.FC<ImportUploadStepProps> = ({
  isDarkMode,
  importContext,
  courseName,
  selectedTerm,
  students,
  activeCategories,
  activeGradesMap,
  currentDispositionMap1c,
  currentDispositionMap2c,
  preferredTargetColumn,
  onChangePreferredTargetColumn,
  onSwitchToForms,
  sourceType,
  onChangeSourceType,
  fileName,
  fileInputRef,
  onFileUpload,
  sheetUrlInput,
  onChangeSheetUrlInput,
  isLoadingRemoteSheet,
  remoteSheetError,
  onLoadRemoteGoogleSheet,
  driveSpreadsheets,
  isLoadingDriveSheets,
  driveSearchQuery,
  onChangeDriveSearchQuery,
  onLoadDriveSpreadsheets,
  pasteText,
  onChangePasteText,
  quickPastePreset,
  onChangeQuickPastePreset,
  onChangeAttendanceTargetMode,
  pastePreviewStats,
  onParsePaste,
}) => {
  return (
    <div className="p-5 overflow-y-auto space-y-5 flex-1">
      {/* Selector de Columna Destino en Calificaciones (permite elegir columna existente con notas como "Dictadura" o crear una nueva) */}
      {importContext === 'grades' && (
        <div
          className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            preferredTargetColumn
              ? isDarkMode
                ? 'bg-emerald-950/35 border-emerald-500/60'
                : 'bg-emerald-50/80 border-emerald-300'
              : isDarkMode
              ? 'bg-slate-850/70 border-slate-750'
              : 'bg-blue-50/40 border-blue-200'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Layers
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                preferredTargetColumn
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-blue-600 dark:text-blue-400'
              }`}
            />
            <div className="min-w-0">
              <div className="text-xs font-bold flex items-center gap-2 flex-wrap">
                <span>Columna de destino para la nota:</span>
                {preferredTargetColumn && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-600 text-white">
                    Destino: {preferredTargetColumn.subcategoryName}
                  </span>
                )}
              </div>
              <p
                className={`text-[11px] mt-0.5 ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-600'
                }`}
              >
                Podés importar las notas dentro de una <strong>columna que ya exista</strong> (incluso si ya tiene notas cargadas) o generar una columna nueva.
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto sm:min-w-[290px] shrink-0">
            <select
              value={
                preferredTargetColumn
                  ? `${preferredTargetColumn.categoryId}:::${preferredTargetColumn.subcategoryId}`
                  : '__NEW__'
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__NEW__') {
                  onChangePreferredTargetColumn(null);
                } else {
                  const [catId, subId] = val.split(':::');
                  const catObj = activeCategories.find((c) => c.id === catId);
                  if (!catObj) return;
                  if (subId === '__CATEGORY_DIRECT__') {
                    onChangePreferredTargetColumn({
                      categoryId: catObj.id,
                      subcategoryId: '__CATEGORY_DIRECT__',
                      subcategoryName: catObj.name,
                    });
                  } else {
                    const matched = findGradeColumnById(activeCategories, subId);
                    if (matched) {
                      onChangePreferredTargetColumn({
                        categoryId: matched.category.id,
                        subcategoryId: subId,
                        subcategoryName: matched.displayLabel,
                      });
                    }
                  }
                }
              }}
              className={`w-full px-3 py-2 rounded-xl border text-xs font-bold outline-hidden cursor-pointer ${
                preferredTargetColumn
                  ? isDarkMode
                    ? 'bg-slate-900 border-emerald-500 text-emerald-300'
                    : 'bg-white border-emerald-500 text-emerald-900 shadow-2xs'
                  : isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-slate-200'
                  : 'bg-white border-neutral-300 text-neutral-800'
              }`}
            >
              <option value="__NEW__">
                + Crear columna nueva (o elegir en el paso 2)
              </option>
              {activeCategories.map((cat) => (
                <optgroup key={cat.id} label={`Categoría: ${cat.name}`}>
                  {cat.subcategories.map((sub) => {
                    const existingCount = students.filter(
                      (st) => String(activeGradesMap[st.id]?.[sub.id] ?? '').trim() !== ''
                    ).length;
                    const instList = sub.intensifications || [];
                    return (
                      <React.Fragment key={sub.id}>
                        <option value={`${cat.id}:::${sub.id}`}>
                          Columna existente: {sub.name}
                          {existingCount > 0 ? ` (${existingCount} notas cargadas)` : ''}
                        </option>
                        {instList.map((inst) => {
                          const instCount = students.filter(
                            (st) => String(activeGradesMap[st.id]?.[inst.id] ?? '').trim() !== ''
                          ).length;
                          const label = getIntensificationDisplayLabel(sub, inst);
                          return (
                            <option key={inst.id} value={`${cat.id}:::${inst.id}`}>
                              ↳ {label}
                              {instCount > 0 ? ` (${instCount} notas)` : ''}
                            </option>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {cat.subcategories.length === 0 && (
                    <option value={`${cat.id}:::__CATEGORY_DIRECT__`}>
                      {cat.name} (Nota General)
                    </option>
                  )}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Tarjetas de origen unificadas */}
      <div
        className={`grid grid-cols-1 ${
          importContext === 'grades' && onSwitchToForms ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
        } gap-2.5`}
      >
        {importContext === 'grades' && onSwitchToForms && (
          <button
            type="button"
            onClick={() => onSwitchToForms(preferredTargetColumn)}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
              isDarkMode
                ? 'bg-purple-950/40 border-purple-500/50 text-purple-200 hover:bg-purple-950/60'
                : 'bg-purple-50/70 border-purple-300 text-purple-900 hover:bg-purple-100/70'
            }`}
          >
            <FileCheck className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold">Evaluación de Google Forms</div>
              <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
                Elegí un cuestionario de Forms o hoja de respuestas con puntaje
              </div>
            </div>
          </button>
        )}

        <button
          type="button"
          onClick={() => onChangeSourceType('sheets')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
            sourceType === 'sheets'
              ? isDarkMode
                ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
              : isDarkMode
              ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <Link2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold">Google Sheets / Docs (Link o Drive)</div>
            <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
              Pegá el link del Sheet o Doc o elegilo de tu cuenta de Google
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChangeSourceType('file')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
            sourceType === 'file' || sourceType === 'csv'
              ? isDarkMode
                ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
              : isDarkMode
              ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <Upload className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold">Subir Archivo (.xlsx, .docx, .csv)</div>
            <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
              Subí un documento Excel, Word, Docs, CSV o TXT desde tu dispositivo
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChangeSourceType('paste')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
            sourceType === 'paste'
              ? isDarkMode
                ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20'
              : isDarkMode
              ? 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <ClipboardPaste className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold">Pegar Nombres y Notas (Ctrl+V)</div>
            <div className="text-[11px] text-neutral-500 dark:text-slate-400 mt-0.5">
              Copiá y pegá las columnas de alumnos y notas directamente
            </div>
          </div>
        </button>
      </div>

      {/* MODO 1: SUBIR DOCUMENTO EXCEL, WORD (.docx, .doc), CSV, HTML O TXT */}
      {(sourceType === 'file' || sourceType === 'csv') && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={async () => {
                try {
                  const XLSX = await import('xlsx');
                  const sorted = [...students].sort((a, b) =>
                    `${a.lastName}, ${a.firstName}`.localeCompare(`${b.lastName}, ${b.firstName}`, 'es')
                  );

                  const gradeCols: string[] = [];
                  activeCategories.forEach((cat) => {
                    if (cat.subcategories.length > 0) {
                      cat.subcategories.forEach((sub) => {
                        gradeCols.push(`${cat.name} - ${sub.name}`);
                      });
                    } else {
                      gradeCols.push(`${cat.name} - Evaluación 1`);
                    }
                  });
                  if (gradeCols.length === 0) {
                    gradeCols.push('Exámenes - Parcial 1', 'Trabajos Prácticos - TP 1');
                  }

                  const activeDispositionMap =
                    selectedTerm === '2c' ? currentDispositionMap2c : currentDispositionMap1c;

                  const templateRows = (sorted.length > 0
                    ? sorted
                    : [
                        { id: '1', lastName: 'García', firstName: 'Ana', email: 'ana.garcia@escuela.edu.ar' } as Student,
                        { id: '2', lastName: 'López', firstName: 'Juan', email: 'juan.lopez@escuela.edu.ar' } as Student,
                      ]
                  ).map((st) => {
                    const row: Record<string, any> = {
                      'Apellido y Nombre': `${st.lastName}, ${st.firstName}`,
                      'Correo Institucional': st.email || '',
                    };
                    if (importContext === 'attendance') {
                      const d = activeDispositionMap?.[st.id];
                      row['Faltas'] = d?.totalAbsences ?? 0;
                      row['Tardanzas'] = d?.totalLates ?? 0;
                      row['Disposición'] = d?.totalDisposition ?? 10;
                    }
                    gradeCols.forEach((colLabel) => {
                      row[colLabel] = '';
                    });
                    return row;
                  });

                  const ws = XLSX.utils.json_to_sheet(templateRows);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(
                    wb,
                    ws,
                    importContext === 'attendance' ? 'Asistencia y Notas' : 'Calificaciones'
                  );
                  const safeCourse = courseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                  XLSX.writeFile(
                    wb,
                    `Plantilla_Modelo_${importContext === 'attendance' ? 'Asistencia' : 'Calificaciones'}_${safeCourse}_${selectedTerm.toUpperCase()}.xlsx`
                  );
                } catch (err) {
                  console.error('Error generating template:', err);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 shadow-2xs'
              }`}
              title="Descargar una planilla Excel pre-cargada con la lista de alumnos y columnas listas para completar y volver a subir"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar plantilla modelo (.xlsx)</span>
            </button>
          </div>
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
              accept={
                sourceType === 'csv'
                  ? '.csv,.tsv,.txt,text/csv,text/plain'
                  : '.xlsx,.xls,.csv,.tsv,.docx,.doc,.txt,.html,.htm'
              }
              onChange={onFileUpload}
              className="hidden"
            />
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-7 h-7" />
            </div>
            <p className="text-sm font-bold">
              {fileName
                ? `Documento cargado: ${fileName}`
                : sourceType === 'csv'
                ? 'Hacé clic aquí para seleccionar tu archivo CSV (.csv) o Texto (.txt)'
                : 'Hacé clic aquí para subir tu documento (Excel .xlsx, Word .docx/.doc, CSV o TXT)'}
            </p>
            <p className={`text-xs mt-1.5 max-w-xl mx-auto ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Podés subir cualquier planilla o documento con nombres y notas de disposición. En el siguiente paso vas a poder <strong>elegir los nombres de los alumnos</strong> y verificar que esté todo bien antes de guardar.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                Excel (.xlsx / .xls)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400">
                Word / Docs (.docx / .doc)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/15 text-teal-600 dark:text-teal-400">
                CSV (.csv)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400">
                Texto / Tabla (.txt / .html)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODO 2: PEGAR UN LINK (GOOGLE SHEETS, GOOGLE DOCS, CSV) O ELEGIR DE GOOGLE DRIVE */}
      {sourceType === 'sheets' && (
        <div className="space-y-5">
          {/* Opción A: Pegar enlace o ID de Google Sheets, Google Docs, Google Forms o Web */}
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-blue-50/40 border-blue-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-blue-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Opción 1: Pegar un Link de Google Sheets, Google Docs, Forms o Documento
              </h4>
            </div>
            <p className={`text-xs ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
              Pegá el link de tu <strong>Google Sheet</strong>, <strong>Google Doc</strong>, <strong>Google Forms</strong> o archivo compartido. En el paso siguiente podrás <strong>elegir los nombres</strong> y ver si está todo bien antes de guardar:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={sheetUrlInput}
                onChange={(e) => onChangeSheetUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && sheetUrlInput.trim()) {
                    onLoadRemoteGoogleSheet(sheetUrlInput);
                  }
                }}
                placeholder="Pegá acá el link (Google Sheets, Google Docs o Google Forms)..."
                className={`flex-1 px-3.5 py-2 text-xs rounded-xl border outline-hidden ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                }`}
              />
              <button
                type="button"
                onClick={() => onLoadRemoteGoogleSheet(sheetUrlInput)}
                disabled={isLoadingRemoteSheet || !sheetUrlInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer shrink-0"
              >
                {isLoadingRemoteSheet ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                <span>{isLoadingRemoteSheet ? 'Leyendo Documento...' : 'Cargar desde Link y Revisar'}</span>
              </button>
            </div>

            {remoteSheetError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{remoteSheetError}</span>
              </div>
            )}
          </div>

          {/* Opción B: Elegir un Google Sheet, Google Doc o Google Form directamente de Google Drive */}
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isDarkMode ? 'bg-slate-850/40 border-slate-750' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-emerald-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Opción 2: Elegir un Google Sheet, Google Doc o Forms de tu Google Drive
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={driveSearchQuery}
                    onChange={(e) => onChangeDriveSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onLoadDriveSpreadsheets(driveSearchQuery, true);
                    }}
                    placeholder="Buscar hoja, doc o form..."
                    className={`pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-hidden ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-neutral-50 border-neutral-300'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onLoadDriveSpreadsheets(driveSearchQuery, true)}
                  disabled={isLoadingDriveSheets}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                      : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-neutral-700'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDriveSheets ? 'animate-spin' : ''}`} />
                  <span>Buscar</span>
                </button>
              </div>
            </div>

            {isLoadingDriveSheets ? (
              <div className="py-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                <span>Buscando hojas de cálculo, documentos y formularios en tu Google Drive...</span>
              </div>
            ) : driveSpreadsheets.length === 0 ? (
              <div className="py-6 text-center text-xs text-neutral-500 dark:text-slate-400">
                No se encontraron documentos recientes o no has iniciado sesión en Google Drive. Podés pegar el link arriba o pulsar "Buscar" para conectar.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {driveSpreadsheets.map((sheet) => {
                  const isDoc = sheet.docType === 'doc';
                  const isForm = sheet.docType === 'form';
                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() =>
                        onLoadRemoteGoogleSheet(sheet.id, undefined, sheet.docType)
                      }
                      disabled={isLoadingRemoteSheet}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                        isDarkMode
                          ? 'bg-slate-800/70 hover:bg-slate-800 border-slate-700 hover:border-emerald-500/60'
                          : 'bg-neutral-50/70 hover:bg-emerald-50/50 border-neutral-200 hover:border-emerald-400'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isForm ? (
                          <FileCheck className="w-4 h-4 text-purple-500 shrink-0" />
                        ) : isDoc ? (
                          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                        ) : (
                          <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold truncate">{sheet.name}</span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                                isForm
                                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                  : isDoc
                                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {isForm ? 'Forms' : isDoc ? 'Docs' : 'Sheets'}
                            </span>
                          </div>
                          {sheet.modifiedTime && (
                            <div className="text-[10px] text-neutral-400">
                              Modificado: {new Date(sheet.modifiedTime).toLocaleDateString('es-AR')}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold shrink-0">
                        Abrir
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODO 3: PEGADO RÁPIDO DE 2 COLUMNAS / CELDAS COPIADAS (ALTERNATIVA 3) */}
      {sourceType === 'paste' && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isDarkMode ? 'bg-indigo-950/25 border-indigo-800/60' : 'bg-indigo-50/60 border-indigo-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                  Elegí qué formato estás pegando desde tu Google Sheet o Excel:
                </span>
              </div>
              {pastePreviewStats.rowCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  Detectadas {pastePreviewStats.rowCount} fila(s) · {pastePreviewStats.colCount} columna(s)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('absences');
                  onChangeQuickPastePreset('name_and_abs');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'name_and_abs'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">2 Columnas: Alumno + Faltas</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'name_and_abs' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Ej: García, Juan [Tab] 3 (actualiza total de inasistencias)
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('absences');
                  onChangeQuickPastePreset('last_first_abs');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'last_first_abs'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">3 Cols: Apellido + Nombre + Faltas</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'last_first_abs' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Une Apellido y Nombre e importa la cantidad de faltas
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('disposition');
                  onChangeQuickPastePreset('name_and_disp');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'name_and_disp'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">2 Columnas: Alumno + Disposición</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'name_and_disp' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Ej: García, Juan [Tab] 8,5 (con o sin títulos)
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('disposition');
                  onChangeQuickPastePreset('last_first_disp');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'last_first_disp'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">3 Cols: Apellido + Nombre + Disp.</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'last_first_disp' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Une automáticamente Apellido (Col A) y Nombre (Col B)
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('both');
                  onChangeQuickPastePreset('name_abs_disp');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'name_abs_disp'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">3 Cols: Alumno + Faltas + Disp.</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'name_abs_disp' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Carga el total de inasistencias y la disposición juntos
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('absences');
                  onChangeQuickPastePreset('only_abs_ordered');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'only_abs_ordered'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">1 Columna de Faltas (Orden de lista)</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'only_abs_ordered' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Pegá solo la columna de cantidad de faltas en orden alfabético
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAttendanceTargetMode('disposition');
                  onChangeQuickPastePreset('only_disp_ordered');
                }}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'only_disp_ordered'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">1 Columna de Disp. (Orden de lista)</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'only_disp_ordered' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Pegá solo la columna de notas de Disposición en orden alfabético
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeQuickPastePreset('auto')}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  quickPastePreset === 'auto'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div className="font-bold">Tabla Libre / Varias Columnas</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    quickPastePreset === 'auto' ? 'text-blue-100' : 'text-neutral-400'
                  }`}
                >
                  Pegá cualquier bloque de celdas y mapealo en el paso siguiente
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
              Seleccioná las celdas en tu Google Sheet o Excel, copialas (Ctrl+C) y pegalas aquí (Ctrl+V). Acepta números de faltas, decimales con coma (8,5), puntos o escala conceptual (MB, B, R):
            </label>
            <textarea
              rows={8}
              value={pasteText}
              onChange={(e) => onChangePasteText(e.target.value)}
              placeholder={
                quickPastePreset === 'name_and_abs'
                  ? `Ejemplo de Cantidad de Faltas (con o sin fila de títulos):\nGarcía, Ana\t2\nLópez, Juan\t0\nMartínez, Sofía\t4`
                  : quickPastePreset === 'last_first_abs'
                  ? `Ejemplo con Apellido y Nombre separados + Cantidad de Faltas:\nGarcía\tAna\t2\nLópez\tJuan\t0`
                  : quickPastePreset === 'only_abs_ordered'
                  ? `Pegá directamente la columna de cantidad de faltas en el orden alfabético del curso:\n2\n0\n4\n1`
                  : quickPastePreset === 'name_and_disp'
                  ? `Ejemplo (con o sin fila de títulos):\nGarcía, Ana\t9,5\nLópez, Juan\t8\nMartínez, Sofía\t10`
                  : quickPastePreset === 'last_first_disp'
                  ? `Ejemplo con Apellido y Nombre separados:\nGarcía\tAna\t9,5\nLópez\tJuan\t8`
                  : quickPastePreset === 'only_disp_ordered'
                  ? `Pegá directamente la columna de notas en el orden alfabético del curso:\n9,5\n8\n10\n7,5`
                  : `Ejemplo:\nApellido y Nombre\tAusencias\tDisposición\nGarcía, Ana\t1\t9,5\nLópez, Juan\t3\t8`
              }
              className={`w-full p-3 font-mono text-xs rounded-xl border outline-hidden ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-750 text-slate-200'
                  : 'bg-white border-neutral-300 text-neutral-800'
              }`}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onParsePaste}
              disabled={!pasteText.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <span>Procesar y Verificar Datos</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
