import React from 'react';
import {
  FolderClosed,
  ExternalLink,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import { Course } from '../../../types';
import {
  CourseFolderStructure,
  formatCourseDriveFolderName,
  getDirectDriveFolderUrl,
} from '../../../services/workspace/driveService';

interface DriveFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourse: Course;
  courseDriveStructure:
    | (CourseFolderStructure & {
        gradesSheetUrl?: string;
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
      sheetUrl: undefined,
      sheetLabel: '',
      badgeColor: 'text-emerald-500',
      btnClasses:
        'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      key: 'disposition',
      name: courseDriveStructure.dispositionFolder?.name || 'Disposición',
      description: 'Seguimiento de puntaje de disposición y participación en clase',
      folderUrl: dispositionFolderUrl,
      sheetUrl: undefined,
      sheetLabel: '',
      badgeColor: 'text-teal-500',
      btnClasses:
        'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
    },
    {
      key: 'libro',
      name: courseDriveStructure.libroDeTemasFolder?.name || 'Libro de Temas',
      description: 'Tabla oficial de clases, unidades, contenidos, carácter y documentos (.gdoc)',
      folderUrl: libroDeTemasFolderUrl,
      sheetUrl: undefined,
      sheetLabel: '',
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
      sheetUrl: undefined,
      sheetLabel: '',
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
