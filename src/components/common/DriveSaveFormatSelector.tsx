import React, { useState } from 'react';
import {
  FolderOpen,
  FileSpreadsheet,
  FileText,
  Download,
  Printer,
  CheckCircle2,
  ExternalLink,
  Loader2,
  X,
  ChevronDown,
} from 'lucide-react';
import {
  CourseDriveCategory,
  formatCourseDriveFolderName,
} from '../../services/workspace/driveService';
import { DriveSaveFormat, SavedDriveFileResult } from '../../utils/driveFormatExporters';

export interface DriveSaveScopeOption {
  id: string;
  label: string;
  shortDesc?: string;
  category: CourseDriveCategory;
  alsoShortcutInCategories?: CourseDriveCategory[];
  defaultTitle: string;
}

export interface DriveSaveFormatSelectorProps {
  courseName: string;
  category: CourseDriveCategory;
  alsoShortcutInCategories?: CourseDriveCategory[];
  defaultTitle: string;
  buttonLabel?: string;
  compact?: boolean;
  scopeOptions?: DriveSaveScopeOption[];
  defaultScopeId?: string;
  onSaveFormat: (
    format: DriveSaveFormat,
    customTitle: string,
    scopeId?: string
  ) => Promise<SavedDriveFileResult | null>;
}

export const DriveSaveFormatSelector: React.FC<DriveSaveFormatSelectorProps> = ({
  courseName,
  category,
  alsoShortcutInCategories,
  defaultTitle,
  buttonLabel = 'Guardar en Drive',
  compact = false,
  scopeOptions,
  defaultScopeId,
  onSaveFormat,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DriveSaveFormat>('gdoc');
  const initialScopeId = defaultScopeId || scopeOptions?.[0]?.id;
  const [selectedScopeId, setSelectedScopeId] = useState<string | undefined>(initialScopeId);
  const activeScope = scopeOptions?.find((s) => s.id === selectedScopeId) || scopeOptions?.[0];

  const effectiveDefaultTitle = activeScope ? activeScope.defaultTitle : defaultTitle;
  const effectiveCategory = activeScope ? activeScope.category : category;
  const effectiveShortcuts = activeScope
    ? activeScope.alsoShortcutInCategories
    : alsoShortcutInCategories;

  const [customTitle, setCustomTitle] = useState(effectiveDefaultTitle);
  const [isSaving, setIsSaving] = useState(false);
  const [savedResult, setSavedResult] = useState<SavedDriveFileResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mainFolderLabel = formatCourseDriveFolderName(courseName);
  const targetSubfolderText =
    effectiveShortcuts && effectiveShortcuts.length > 0
      ? `${effectiveCategory} (y acceso en ${effectiveShortcuts.join(', ')})`
      : effectiveCategory;

  const handleToggle = () => {
    if (!isOpen) {
      const resetScope =
        scopeOptions?.find((s) => s.id === (selectedScopeId || initialScopeId)) ||
        scopeOptions?.[0];
      setCustomTitle(resetScope ? resetScope.defaultTitle : defaultTitle);
      setErrorMsg(null);
    }
    setIsOpen((prev) => !prev);
  };

  const handleSelectScope = (scopeOpt: DriveSaveScopeOption) => {
    const allDefaults = new Set([
      defaultTitle,
      ...(scopeOptions?.map((s) => s.defaultTitle) || []),
    ]);
    setSelectedScopeId(scopeOpt.id);
    if (!customTitle.trim() || allDefaults.has(customTitle.trim())) {
      setCustomTitle(scopeOpt.defaultTitle);
    }
  };

  const handleExecuteSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const res = await onSaveFormat(
        selectedFormat,
        customTitle.trim() || effectiveDefaultTitle,
        selectedScopeId
      );
      if (res) {
        setSavedResult(res);
        setIsOpen(false);
      } else {
        setErrorMsg(
          'No se pudo guardar en Google Drive. Verificá que hayas iniciado sesión con tu cuenta de Google Workspace.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al guardar el archivo en Google Drive.');
    } finally {
      setIsSaving(false);
    }
  };

  const formatOptions: Array<{
    id: DriveSaveFormat;
    label: string;
    shortDesc: string;
    badge: string;
    icon: React.ReactNode;
    activeClass: string;
  }> = [
    {
      id: 'sheets',
      label: 'Google Sheets',
      shortDesc: 'Planilla de cálculo interactiva en Drive',
      badge: '.gsheet',
      icon: <FileSpreadsheet className="w-4 h-4 text-emerald-600" />,
      activeClass: 'border-emerald-500 bg-emerald-50/90 text-emerald-900 ring-1 ring-emerald-500',
    },
    {
      id: 'gdoc',
      label: 'Google Docs',
      shortDesc: 'Documento de texto y tablas editable en Drive',
      badge: '.gdoc',
      icon: <FileText className="w-4 h-4 text-blue-600" />,
      activeClass: 'border-blue-500 bg-blue-50/90 text-blue-900 ring-1 ring-blue-500',
    },
    {
      id: 'xlsx',
      label: 'Microsoft Excel',
      shortDesc: 'Sube .xlsx a la subcarpeta de Drive + descarga',
      badge: '.xlsx',
      icon: <Download className="w-4 h-4 text-teal-600" />,
      activeClass: 'border-teal-500 bg-teal-50/90 text-teal-900 ring-1 ring-teal-500',
    },
    {
      id: 'csv',
      label: 'Archivo CSV',
      shortDesc: 'Sube .csv a la subcarpeta de Drive + descarga',
      badge: '.csv',
      icon: <Download className="w-4 h-4 text-purple-600" />,
      activeClass: 'border-purple-500 bg-purple-50/90 text-purple-900 ring-1 ring-purple-500',
    },
    {
      id: 'html',
      label: 'Reporte Imprimible / PDF',
      shortDesc: 'Guarda copia en Drive y abre vista de impresión',
      badge: 'HTML/PDF',
      icon: <Printer className="w-4 h-4 text-indigo-600" />,
      activeClass: 'border-indigo-500 bg-indigo-50/90 text-indigo-900 ring-1 ring-indigo-500',
    },
  ];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isSaving}
        title={`Guardar en Google Drive (${mainFolderLabel} / ${effectiveCategory})`}
        className={`flex items-center gap-1.5 rounded-xl font-bold transition-all border shadow-xs cursor-pointer disabled:opacity-50 ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs'
        } ${
          isOpen
            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
            : 'bg-blue-50/80 hover:bg-blue-100 text-blue-700 border-blue-200/80'
        }`}
      >
        {isSaving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5" />
        )}
        <span>{isSaving ? 'Guardando...' : buttonLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Menú desplegable / panel para elegir qué guardar y en qué formato */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <div className="flex items-center gap-2.5">
                <FolderOpen className="w-5 h-5 text-blue-100 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold leading-tight">
                    Guardar en Google Drive
                  </h4>
                  <p className="text-[11px] text-blue-100 font-medium mt-0.5">
                    Destino: {mainFolderLabel} &rarr; <strong>{targetSubfolderText}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {scopeOptions && scopeOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    ¿Qué querés guardar en Google Drive?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {scopeOptions.map((scopeOpt) => {
                      const isScopeActive = activeScope?.id === scopeOpt.id;
                      return (
                        <button
                          key={scopeOpt.id}
                          type="button"
                          onClick={() => handleSelectScope(scopeOpt)}
                          className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            isScopeActive
                              ? 'border-blue-600 bg-blue-50/90 text-blue-950 ring-1 ring-blue-600'
                              : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span className="text-xs font-bold leading-tight">
                            {scopeOpt.label}
                          </span>
                          {scopeOpt.shortDesc && (
                            <span className="text-[10px] opacity-75 mt-0.5 leading-snug">
                              {scopeOpt.shortDesc}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Nombre del archivo en Google Drive:
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={effectiveDefaultTitle}
                  className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  ¿En qué formato querés guardarlo?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {formatOptions.map((opt) => {
                    const active = selectedFormat === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedFormat(opt.id)}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          active
                            ? opt.activeClass
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">{opt.icon}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold truncate">{opt.label}</span>
                            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-white/80 border border-current/20 shrink-0">
                              {opt.badge}
                            </span>
                          </div>
                          <p className="text-[11px] opacity-80 leading-snug mt-0.5">
                            {opt.shortDesc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isSaving}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSave}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Guardando en {effectiveCategory}...</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>
                        Guardar{activeScope ? ` ${activeScope.label}` : ''} como{' '}
                        {formatOptions.find((f) => f.id === selectedFormat)?.label}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal/Toast de éxito con acceso directo al archivo recién creado */}
      {savedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white border border-emerald-200 shadow-2xl overflow-hidden text-left">
            <div className="flex items-center justify-between px-5 py-3.5 bg-emerald-600 text-white">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-100 shrink-0" />
                <h4 className="text-sm font-bold">
                  ¡Archivo guardado en Google Drive!
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSavedResult(null)}
                className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 space-y-1">
                <div className="text-xs font-bold text-emerald-950 break-words">
                  {savedResult.name}
                </div>
                <div className="text-[11px] font-medium text-emerald-800">
                  Formato: <strong>{savedResult.formatLabel}</strong>
                </div>
                <div className="text-[11px] text-emerald-700">
                  Ubicación: <strong>{mainFolderLabel}</strong> &rarr;{' '}
                  <strong>{savedResult.category}</strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {savedResult.folderUrl && (
                  <a
                    href={savedResult.folderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Abrir subcarpeta {savedResult.category}</span>
                  </a>
                )}
                <a
                  href={savedResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSavedResult(null)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
                >
                  <span>Abrir archivo ahora</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
