import React from 'react';
import {
  FolderClosed,
  ExternalLink,
  FileSpreadsheet,
  X,
  Info,
  RefreshCw,
  Check,
  ArrowLeftRight,
  Loader2,
  Copy,
  Download,
  ChevronRight,
} from 'lucide-react';
import { Course } from '../../../types';
import {
  CourseFolderStructure,
  formatCourseDriveFolderName,
  getDirectDriveFolderUrl,
} from '../../../services/workspace/driveService';
import { isRealGoogleSpreadsheetId } from '../../../utils/sheetsUtils';
import { GoogleSessionExpiryBanner } from './GoogleSessionExpiryBanner';

interface DriveFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  courseDriveStructure:
    | (CourseFolderStructure & {
        attendanceSheetUrl?: string;
        gradesSheetUrl?: string;
        libroDeTemasSheetUrl?: string;
      })
    | null;
  isDarkMode: boolean;
}

export const DriveFolderModal: React.FC<DriveFolderModalProps> = ({
  isOpen,
  onClose,
  activeCourse,
  courseDriveStructure,
  isDarkMode,
}) => {
  if (!isOpen || !courseDriveStructure) return null;

  const mainFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.mainFolder.id,
    courseDriveStructure.mainFolder.url
  );
  const gradesFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.gradesFolder?.id,
    courseDriveStructure.gradesFolder?.url || mainFolderUrl
  );
  const attendanceFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.attendanceFolder?.id,
    courseDriveStructure.attendanceFolder?.url || mainFolderUrl
  );
  const dispositionFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.dispositionFolder?.id,
    courseDriveStructure.dispositionFolder?.url || mainFolderUrl
  );
  const libroDeTemasFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.libroDeTemasFolder?.id,
    courseDriveStructure.libroDeTemasFolder?.url || mainFolderUrl
  );
  const reportsFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.reportsFolder?.id,
    courseDriveStructure.reportsFolder?.url || mainFolderUrl
  );
  const incidentsFolderUrl = getDirectDriveFolderUrl(
    courseDriveStructure.incidentsFolder?.id,
    courseDriveStructure.incidentsFolder?.url || mainFolderUrl
  );

  const subfolders = [
    {
      key: 'grades',
      name: courseDriveStructure.gradesFolder?.name || 'Calificaciones',
      description: 'Planilla matriz de categorías, evaluaciones y promedios cuatrimestrales',
      folderUrl: gradesFolderUrl,
      sheetUrl: courseDriveStructure.gradesSheetUrl,
      sheetLabel: 'Abrir Sheet',
      badgeColor: 'text-blue-500',
      btnClasses:
        'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    },
    {
      key: 'attendance',
      name: courseDriveStructure.attendanceFolder?.name || 'Asistencia',
      description: 'Planilla de registro de asistencia, ausencias y llegadas tarde',
      folderUrl: attendanceFolderUrl,
      sheetUrl: courseDriveStructure.attendanceSheetUrl,
      sheetLabel: 'Abrir Sheet',
      badgeColor: 'text-emerald-500',
      btnClasses:
        'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      key: 'disposition',
      name: courseDriveStructure.dispositionFolder?.name || 'Disposición',
      description: 'Seguimiento de puntaje de disposición y participación en clase',
      folderUrl: dispositionFolderUrl,
      sheetUrl: courseDriveStructure.attendanceSheetUrl,
      sheetLabel: 'Abrir Sheet',
      badgeColor: 'text-teal-500',
      btnClasses:
        'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
    },
    {
      key: 'libro',
      name: courseDriveStructure.libroDeTemasFolder?.name || 'Libro de Temas',
      description: 'Tabla oficial de clases, unidades, contenidos, carácter y documentos (.gdoc)',
      folderUrl: libroDeTemasFolderUrl,
      sheetUrl: courseDriveStructure.libroDeTemasSheetUrl,
      sheetLabel: 'Abrir Sheet',
      badgeColor: 'text-indigo-500',
      btnClasses:
        'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      key: 'reports',
      name: courseDriveStructure.reportsFolder?.name || 'Informes',
      description: 'Informes consolidados del curso y fichas pedagógicas individuales (.gdoc)',
      folderUrl: reportsFolderUrl,
      sheetUrl: undefined,
      sheetLabel: '',
      badgeColor: 'text-purple-500',
      btnClasses:
        'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    },
    {
      key: 'incidents',
      name: courseDriveStructure.incidentsFolder?.name || 'Historial de Incidencias',
      description: 'Auditoría cronológica de inasistencias, tardanzas y eventos de disposición',
      folderUrl: incidentsFolderUrl,
      sheetUrl: courseDriveStructure.attendanceSheetUrl,
      sheetLabel: 'Abrir Sheet',
      badgeColor: 'text-amber-500',
      btnClasses:
        'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <FolderClosed className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Carpeta de Google Drive del Curso</h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                {formatCourseDriveFolderName(activeCourse.name)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-neutral-200 dark:hover:bg-slate-800 text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto">
          <p className="text-neutral-600 dark:text-slate-300">
            Tu carpeta en <strong>Google Drive</strong> está identificada con{' '}
            <strong>"por Docenc.ia"</strong> y organizada automáticamente con las{' '}
            <strong>6 subcarpetas principales</strong> de la materia:
          </p>

          {/* Carpeta Principal */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <FolderClosed className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-neutral-900 dark:text-white text-xs block truncate">
                  📁 {courseDriveStructure.mainFolder.name}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                  Carpeta raíz del curso en tu Google Drive (acceso directo)
                </span>
              </div>
            </div>
            <a
              href={mainFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors shadow-2xs shrink-0"
            >
              <span>Abrir Carpeta</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* 6 Subcarpetas Principales */}
          <div className="space-y-2 pl-3 border-l-2 border-amber-300 dark:border-amber-700">
            {subfolders.map((sub, idx) => (
              <div
                key={sub.key}
                className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700/80' : 'bg-white border-neutral-200 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderClosed className={`w-4 h-4 ${sub.badgeColor} shrink-0`} />
                  <div className="min-w-0">
                    <span className="font-bold text-neutral-900 dark:text-white block truncate">
                      {idx + 1}. 📁 {sub.name}
                    </span>
                    <span className="text-[11px] text-neutral-500 dark:text-slate-400 block">
                      {sub.description}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  {sub.sheetUrl && (
                    <a
                      href={sub.sheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold hover:underline shrink-0 ${sub.btnClasses}`}
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      <span>{sub.sheetLabel}</span>
                    </a>
                  )}
                  <a
                    href={sub.folderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold hover:underline shrink-0 ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <span>Abrir Subcarpeta</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-4 border-t flex justify-end gap-2 shrink-0 ${
            isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cerrar
          </button>
          <a
            href={mainFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
          >
            <span>Abrir "{courseDriveStructure.mainFolder.name}" en Drive</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

interface SheetsConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  isDarkMode: boolean;
  sheetConfig: any;
  isSyncingSheet: boolean;
  isOpeningSheet: boolean;
  handleManualSheetsSync: () => void;
  customFolderInput: string;
  setCustomFolderInput: (v: string) => void;
  handleSaveCustomDriveFolder: () => void;
  isLinkingCustomFolder: boolean;
  customSheetInput: string;
  setCustomSheetInput: (v: string) => void;
  handleLinkCustomSpreadsheet: () => void;
  isLinkingCustomSheet: boolean;
  sheetsModalFeedback: string | null;
  handlePullFromGoogleSheet: (manual?: boolean) => void;
  isPullingFromSheet: boolean;
  handleConnectGoogleForSheets: () => void;
  handleOpenInSheetsNew: () => void;
  handleDownloadCourseCsv: () => void;
}

export const SheetsConnectModal: React.FC<SheetsConnectModalProps> = ({
  isOpen,
  onClose,
  activeCourse,
  isDarkMode,
  sheetConfig,
  isSyncingSheet,
  isOpeningSheet,
  handleManualSheetsSync,
  customFolderInput,
  setCustomFolderInput,
  handleSaveCustomDriveFolder,
  isLinkingCustomFolder,
  customSheetInput,
  setCustomSheetInput,
  handleLinkCustomSpreadsheet,
  isLinkingCustomSheet,
  sheetsModalFeedback,
  handlePullFromGoogleSheet,
  isPullingFromSheet,
  handleConnectGoogleForSheets,
  handleOpenInSheetsNew,
  handleDownloadCourseCsv,
}) => {
  if (!isOpen || !activeCourse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-emerald-50/70 border-emerald-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Abrir en Google Sheets</h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">{activeCourse.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-neutral-100 text-neutral-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 ${
              isDarkMode
                ? 'bg-slate-850/80 border-slate-750 text-slate-300'
                : 'bg-neutral-50 border-neutral-200 text-neutral-600'
            }`}
          >
            <Info className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className={`font-semibold mb-0.5 ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Planilla de Google Sheets para {activeCourse.name}
              </p>
              <p className="leading-relaxed">
                Sincroniza en vivo la nómina de estudiantes, ausencias, tardanzas y notas de conducta con Google Sheets en tu Google Drive.
              </p>
            </div>
          </div>

          {/* Status of Currently Linked Sheet */}
          {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) && (
            <div
              className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                isDarkMode
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="font-bold text-xs">Hoja vinculada al curso</span>
                </div>
                {sheetConfig.lastSyncedAt && (
                  <span className="text-[10px] opacity-80">Última sync: {sheetConfig.lastSyncedAt}</span>
                )}
              </div>
              <p className="font-mono text-[11px] truncate opacity-90 select-all">
                {sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const url = sheetConfig.url || `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`;
                    window.open(url, '_blank');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir Planilla</span>
                </button>
                <button
                  type="button"
                  onClick={handleManualSheetsSync}
                  disabled={isSyncingSheet}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'border-emerald-700/60 hover:bg-emerald-900/40 text-emerald-200'
                      : 'border-emerald-300 hover:bg-emerald-100 text-emerald-800'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSheet ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Google Drive Folder Location & Configuration */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-slate-50 border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`flex items-center gap-1.5 font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                <FolderClosed className="w-4 h-4 text-amber-500" />
                <span>Carpeta en Google Drive</span>
              </div>
              {(activeCourse.driveFolderId || activeCourse.driveFolderUrl) && (
                <a
                  href={getDirectDriveFolderUrl(
                    activeCourse.attendanceFolderId || activeCourse.driveFolderId,
                    activeCourse.attendanceFolderUrl || activeCourse.driveFolderUrl
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline font-semibold cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Abrir carpeta en Drive</span>
                </a>
              )}
            </div>

            <div className="text-[11px] text-neutral-600 dark:text-slate-400 leading-relaxed">
              Ubicación actual:{' '}
              <strong className={isDarkMode ? 'text-slate-200' : 'text-neutral-800'}>
                {formatCourseDriveFolderName(activeCourse.name)} / Asistencia
              </strong>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customFolderInput}
                onChange={(e) => setCustomFolderInput(e.target.value)}
                placeholder="Nombre de carpeta o link/ID de Google Drive"
                className={`flex-1 px-3 py-2 text-xs rounded-xl border outline-none font-mono transition-colors ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-amber-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-amber-500'
                }`}
              />
              <button
                type="button"
                onClick={handleSaveCustomDriveFolder}
                disabled={isLinkingCustomFolder || !customFolderInput.trim()}
                className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer shrink-0"
              >
                {isLinkingCustomFolder ? 'Guardando...' : 'Asignar Carpeta'}
              </button>
            </div>
          </div>

          {/* Paste / Link Existing Google Sheet */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              isDarkMode ? 'bg-slate-850/60 border-slate-750' : 'bg-slate-50 border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Vincular Hoja Existente de Google Sheets
              </span>
              <span className="text-[10px] text-neutral-500 dark:text-slate-400">Pega el link o ID</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customSheetInput}
                onChange={(e) => setCustomSheetInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/... o ID"
                className={`flex-1 px-3 py-2 text-xs rounded-xl border outline-none font-mono transition-colors ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-emerald-500'
                }`}
              />
              <button
                type="button"
                onClick={handleLinkCustomSpreadsheet}
                disabled={isLinkingCustomSheet || !customSheetInput.trim()}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer shrink-0"
              >
                {isLinkingCustomSheet ? 'Vinculando...' : 'Vincular'}
              </button>
            </div>
          </div>

          {sheetsModalFeedback && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{sheetsModalFeedback}</span>
            </div>
          )}

          {/* Doble Entrada: Traer cambios realizados directamente en el Sheet */}
          {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId) && (
            <div
              className={`p-3.5 rounded-xl border space-y-2 ${
                isDarkMode ? 'bg-blue-950/20 border-blue-800/40 text-blue-200' : 'bg-blue-50/70 border-blue-200 text-blue-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <ArrowLeftRight className="w-4 h-4 text-blue-500" />
                  <span>Doble Entrada: Sincronización Bidireccional</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                  Activa
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-slate-300">
                Si modificas ausencias, tardanzas o notas de conducta en las celdas de tu Google Sheet, este botón lee la hoja y vuelca los cambios automáticamente en la app.
              </p>
              <button
                type="button"
                onClick={() => handlePullFromGoogleSheet(true)}
                disabled={isPullingFromSheet}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-colors"
              >
                <ArrowLeftRight className={`w-3.5 h-3.5 ${isPullingFromSheet ? 'animate-spin' : ''}`} />
                <span>{isPullingFromSheet ? 'Leyendo cambios en Google Sheets...' : 'Comprobar y Traer Cambios del Sheet (Doble Entrada)'}</span>
              </button>
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            {/* Option 1: Connect Google */}
            <button
              type="button"
              onClick={handleConnectGoogleForSheets}
              disabled={isOpeningSheet}
              className="w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                {isOpeningSheet ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <div>
                  <span className="block text-xs font-bold">
                    {sheetConfig?.spreadsheetId && isRealGoogleSpreadsheetId(sheetConfig.spreadsheetId)
                      ? 'Conectar Google y Sincronizar Hoja'
                      : 'Conectar Google y Crear Hoja en Drive'}
                  </span>
                  <span className="block text-[10px] text-emerald-100 font-normal">
                    Conecta tu cuenta institucional con permisos para editar Google Sheets
                  </span>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-emerald-100" />
            </button>

            {/* Option 2: sheets.new with copied data */}
            <button
              type="button"
              onClick={handleOpenInSheetsNew}
              className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                <div>
                  <span className="block text-xs font-bold">Abrir Hoja Nueva con Datos Copiados</span>
                  <span className="block text-[10px] text-neutral-500 dark:text-slate-400 font-normal">
                    Abre sheets.new y copia los datos al portapapeles (pegar con Ctrl+V)
                  </span>
                </div>
              </div>
              <Copy className="w-4 h-4 text-neutral-400" />
            </button>

            {/* Option 3: Download CSV */}
            <button
              type="button"
              onClick={handleDownloadCourseCsv}
              className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Download className="w-4 h-4 text-blue-500" />
                <div>
                  <span className="block text-xs font-bold">Descargar archivo CSV</span>
                  <span className="block text-[10px] text-neutral-500 dark:text-slate-400 font-normal">
                    Descarga toda la nómina y el historial listo para Excel
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-3.5 border-t flex justify-end ${
            isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
