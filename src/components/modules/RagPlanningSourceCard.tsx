import React, { useState, useRef } from 'react';
import {
  Upload,
  Link2,
  FileText,
  CheckCircle2,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  FileCode,
  Plus,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';

export interface PlanningSourceItem {
  id: string;
  name: string;
  size?: string;
  type: 'pdf' | 'docx' | 'text' | 'link';
  url?: string;
  extractedText: string;
}

interface RagPlanningSourceCardProps {
  id: string;
  title: string;
  badge: string;
  badgeColorClass: string;
  icon: React.ReactNode;
  description: string;
  placeholder: string;
  value: string;
  onChange: (val: string) => void;
  sources: PlanningSourceItem[];
  onSourcesChange: (sources: PlanningSourceItem[]) => void;
  acceptedFileTypes?: string;
  fileTypeDescription: string;
  docType: 'template' | 'normative' | 'bibliography';
  isDarkMode: boolean;
  onFeedback: (msg: { type: 'info' | 'success' | 'warning'; text: string }) => void;
}

export const RagPlanningSourceCard: React.FC<RagPlanningSourceCardProps> = ({
  id,
  title,
  badge,
  badgeColorClass,
  icon,
  description,
  placeholder,
  value,
  onChange,
  sources,
  onSourcesChange,
  acceptedFileTypes = '.docx,.doc,.pdf,.txt,.rtf,.md',
  fileTypeDescription,
  docType,
  isDarkMode,
  onFeedback,
}) => {
  const [linkInput, setLinkInput] = useState<string>('');
  const [isParsingFile, setIsParsingFile] = useState<boolean>(false);
  const [isParsingLink, setIsParsingLink] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [showRawText, setShowRawText] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to append new source item and update consolidated text
  const addSourceItem = (item: PlanningSourceItem) => {
    const updatedSources = [...sources, item];
    onSourcesChange(updatedSources);

    // Append to value or set initial
    const header =
      item.type === 'link'
        ? `\n\n[FUENTE ENLACE: ${item.name} (${item.url || ''})]:\n`
        : `\n\n[FUENTE ARCHIVO: ${item.name} ${item.size ? `(${item.size})` : ''}]:\n`;

    const newContent = value.trim()
      ? `${value.trim()}${header}${item.extractedText.trim()}`
      : `${header.trim()}\n${item.extractedText.trim()}`;

    onChange(newContent);
    setShowRawText(true);
  };

  // Process a single file
  const processOneFile = async (file: File): Promise<PlanningSourceItem | null> => {
    const lowerName = file.name.toLowerCase();

    // Plain text files
    if (lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.csv')) {
      const text = await file.text();
      return {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: `${(file.size / 1024).toFixed(0)} KB`,
        type: 'text',
        extractedText: text,
      };
    }

    // Word (.docx) or PDF (.pdf) via backend parser
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string) || '';
          const result = await api.parseDocument({
            fileName: file.name,
            mimeType: file.type,
            base64Data,
            docType,
          });

          resolve({
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: result.fileName || file.name,
            size: result.fileSize || `${(file.size / 1024).toFixed(0)} KB`,
            type: result.type === 'link' ? 'docx' : result.type,
            extractedText: result.text || '',
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsDataURL(file);
    });
  };

  // Handle files selected (supports multiple files!)
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsParsingFile(true);

    const files = Array.from(fileList);
    let successCount = 0;

    for (const file of files) {
      try {
        const item = await processOneFile(file);
        if (item) {
          addSourceItem(item);
          successCount++;
        }
      } catch (err: any) {
        console.error('Error procesando archivo:', file.name, err);
        onFeedback({
          type: 'warning',
          text: `No se pudo procesar "${file.name}": ${err?.message || 'Error desconocido'}`,
        });
      }
    }

    setIsParsingFile(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (successCount > 0) {
      onFeedback({
        type: 'success',
        text: `✓ ${successCount === 1 ? 'Documento incorporado' : `${successCount} documentos incorporados`} a la planificación.`,
      });
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  // Handle link submission (supports Google Docs, Drive, Web links)
  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = linkInput.trim();
    if (!cleanUrl) return;

    try {
      setIsParsingLink(true);
      const res = await api.parseDocument({
        linkUrl: cleanUrl,
        docType,
      });

      const newItem: PlanningSourceItem = {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: res.fileName || 'Documento en línea',
        url: res.url || cleanUrl,
        type: 'link',
        extractedText: res.text || `[Documento Vinculado: ${cleanUrl}]`,
      };

      addSourceItem(newItem);
      setLinkInput('');
      onFeedback({
        type: 'success',
        text: `✓ Enlace vinculado exitosamente a las fuentes.`,
      });
    } catch (err: any) {
      console.error('Error al vincular enlace:', err);
      onFeedback({
        type: 'warning',
        text: err?.message || 'No se pudo vincular el enlace.',
      });
    } finally {
      setIsParsingLink(false);
    }
  };

  // Remove a single source item
  const handleRemoveSource = (idToRemove: string) => {
    const updated = sources.filter((s) => s.id !== idToRemove);
    onSourcesChange(updated);

    // Reconstruct value from remaining sources
    if (updated.length === 0) {
      onChange('');
    } else {
      const reconstructed = updated
        .map((item) => {
          const header =
            item.type === 'link'
              ? `[FUENTE ENLACE: ${item.name} (${item.url || ''})]:\n`
              : `[FUENTE ARCHIVO: ${item.name} ${item.size ? `(${item.size})` : ''}]:\n`;
          return `${header}${item.extractedText.trim()}`;
        })
        .join('\n\n');
      onChange(reconstructed);
    }

    onFeedback({
      type: 'info',
      text: 'Fuente eliminada de la planificación.',
    });
  };

  return (
    <div
      id={`source-card-${id}`}
      className={`border rounded-xl p-4 space-y-3.5 transition-colors ${
        isDarkMode
          ? 'border-slate-750 bg-slate-800/60'
          : 'border-neutral-200 bg-neutral-50/70 shadow-2xs'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <h3
            className={`text-xs font-bold tracking-tight ${
              isDarkMode ? 'text-slate-100' : 'text-neutral-900'
            }`}
          >
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {sources.length > 0 && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                isDarkMode ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              {sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'}
            </span>
          )}
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${badgeColorClass}`}
          >
            {badge}
          </span>
        </div>
      </div>

      <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
        {description}
      </p>

      {/* SEPARATED ACTIONS CONTAINER: Cargar Documento AND/OR Pegar Link */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5">
        {/* PANEL 1: Cargar Documento(s) */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-3 flex flex-col justify-between transition-all ${
            isDragOver
              ? 'border-blue-500 bg-blue-500/10'
              : isDarkMode
              ? 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
              : 'border-neutral-300 bg-white/90 hover:border-blue-300'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedFileTypes}
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />

          <div className="space-y-1.5 mb-2.5">
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                  docType === 'bibliography'
                    ? isDarkMode
                      ? 'bg-purple-950 text-purple-400'
                      : 'bg-purple-100 text-purple-700'
                    : isDarkMode
                    ? 'bg-blue-950 text-blue-400'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
              </div>
              <span
                className={`text-xs font-semibold ${
                  isDarkMode ? 'text-slate-200' : 'text-neutral-800'
                }`}
              >
                Cargar documento(s)
              </span>
            </div>
            <p className={`text-[10.5px] leading-tight ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              {fileTypeDescription}
            </p>
          </div>

          <button
            type="button"
            disabled={isParsingFile}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full py-1.5 px-3 text-xs font-semibold rounded-lg shadow-2xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
              docType === 'bibliography'
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isParsingFile ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Extrayendo archivo...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Subir archivo (Word o PDF)</span>
              </>
            )}
          </button>
        </div>

        {/* PANEL 2: Pegar Enlace(s) */}
        <div
          className={`border rounded-xl p-3 flex flex-col justify-between transition-colors ${
            isDarkMode
              ? 'border-slate-700 bg-slate-900/50'
              : 'border-neutral-300 bg-white/90'
          }`}
        >
          <div className="space-y-1.5 mb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                  isDarkMode ? 'bg-emerald-950 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
              </div>
              <span
                className={`text-xs font-semibold ${
                  isDarkMode ? 'text-slate-200' : 'text-neutral-800'
                }`}
              >
                Pegar enlace(s)
              </span>
            </div>
            <p className={`text-[10.5px] leading-tight ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Google Docs, archivos de Google Drive o páginas oficiales.
            </p>
          </div>

          <form onSubmit={handleLinkSubmit} className="flex items-center gap-1.5">
            <input
              type="url"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://docs.google.com/..."
              className={`flex-1 min-w-0 text-xs px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500'
                  : 'bg-neutral-50 border-neutral-300 text-neutral-800 placeholder-neutral-400'
              }`}
            />
            <button
              type="submit"
              disabled={isParsingLink || !linkInput.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-all shrink-0 cursor-pointer flex items-center gap-1"
            >
              {isParsingLink ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              <span>Vincular</span>
            </button>
          </form>
        </div>
      </div>

      {/* LIST OF LOADED SOURCES (Files and/or Links) */}
      {sources.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${
                isDarkMode ? 'text-slate-300' : 'text-neutral-700'
              }`}
            >
              Fuentes incorporadas ({sources.length}):
            </span>
            <button
              type="button"
              onClick={() => {
                onSourcesChange([]);
                onChange('');
                onFeedback({ type: 'info', text: 'Se vaciaron las fuentes.' });
              }}
              className="text-[10.5px] text-rose-600 hover:underline cursor-pointer"
            >
              Quitar todas
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {sources.map((src) => (
              <div
                key={src.id}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  isDarkMode
                    ? 'bg-slate-900/90 border-slate-700 text-slate-200'
                    : 'bg-white border-neutral-200 text-neutral-800 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {src.type === 'pdf' ? (
                    <FileCode className="w-4 h-4 text-red-500 shrink-0" />
                  ) : src.type === 'docx' ? (
                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                  ) : src.type === 'link' ? (
                    <ExternalLink className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                  )}

                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold truncate">{src.name}</span>
                      {src.size && (
                        <span className="text-[10px] opacity-60 font-mono">({src.size})</span>
                      )}
                    </div>
                    {src.url && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-blue-500 hover:underline truncate block"
                      >
                        {src.url}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[9.5px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1 ${
                      isDarkMode
                        ? 'bg-emerald-950/70 text-emerald-300'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                    Listo
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(src.id)}
                    title="Eliminar esta fuente"
                    className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consolidated Text Editor / Manual Writing Box */}
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between text-[11px]">
          <span
            className={`font-semibold ${
              isDarkMode ? 'text-slate-300' : 'text-neutral-700'
            }`}
          >
            Contenido consolidado para la IA:
          </span>
          <button
            type="button"
            onClick={() => setShowRawText(!showRawText)}
            className={`flex items-center gap-1 text-[10.5px] font-medium transition-colors cursor-pointer ${
              isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
            }`}
          >
            {showRawText ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{showRawText ? 'Minimizar texto' : 'Ver y editar texto'}</span>
          </button>
        </div>

        {showRawText && (
          <div className="space-y-1">
            <textarea
              rows={3}
              value={value}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              className={`w-full text-xs border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500'
                  : 'bg-white border-neutral-300 text-neutral-800 placeholder-neutral-400'
              }`}
            />
            <div className="flex items-center justify-between text-[10px] px-1 opacity-60">
              <span>
                {value.trim()
                  ? `${value.length} caracteres extraídos de ${sources.length} ${sources.length === 1 ? 'fuente' : 'fuentes'}`
                  : 'Puedes escribir directamente o usar los botones de arriba para cargar documentos y/o links.'}
              </span>
              {value.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="hover:underline hover:text-rose-500 cursor-pointer"
                >
                  Limpiar texto
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
