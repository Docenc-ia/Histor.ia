import React, { useState, useEffect } from 'react';
import { X, Clock, CheckCircle2, AlertCircle, RefreshCw, Layers, ExternalLink, Terminal } from 'lucide-react';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface AsyncJobsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AsyncJobsModal: React.FC<AsyncJobsModalProps> = ({ isOpen, onClose }) => {
  const { isDarkMode } = useWorkspaceAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchJobs = async () => {
    try {
      setIsLoading(true);
      const data = await api.getAsyncJobs();
      setJobs(data);
      if (data.length > 0 && !selectedJob) {
        setSelectedJob(data[0]);
      }
    } catch (err) {
      console.error('Error al cargar tareas en segundo plano:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
      const interval = setInterval(fetchJobs, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className={`rounded-2xl border shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isDarkMode
              ? 'bg-slate-800/80 border-slate-700'
              : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                isDarkMode ? 'bg-blue-950/80 text-blue-400' : 'bg-blue-100 text-blue-700'
              }`}
            >
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Cola de Procesamiento en Segundo Plano (Async Jobs)
              </h2>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Monitoreo de tareas pesadas de IA: RAG de planificaciones, generación de manuales y correcciones masivas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-all ${
              isDarkMode
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Job List */}
          <div
            className={`md:col-span-5 border-r overflow-y-auto p-3 space-y-2 max-h-[60vh] ${
              isDarkMode ? 'border-slate-800' : 'border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between px-1 mb-1">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                Tareas ({jobs.length})
              </span>
              <button
                onClick={fetchJobs}
                className="text-[11px] text-blue-500 hover:text-blue-400 flex items-center gap-1 font-medium"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>

            {jobs.map((job) => {
              const isSelected = selectedJob?.id === job.id;
              const isCompleted = job.status === 'finalizado';
              const isProcessing = job.status === 'procesando';

              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all space-y-2 ${
                    isSelected
                      ? isDarkMode
                        ? 'border-blue-500 bg-blue-950/40 shadow-xs'
                        : 'border-blue-500 bg-blue-50/70 shadow-xs'
                      : isDarkMode
                      ? 'border-slate-800 hover:bg-slate-800/60'
                      : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-semibold truncate ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                      {job.title}
                    </p>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0 ${
                        isCompleted
                          ? isDarkMode ? 'bg-emerald-950/80 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                          : isProcessing
                          ? isDarkMode ? 'bg-blue-950/80 text-blue-300 animate-pulse' : 'bg-blue-100 text-blue-800 animate-pulse'
                          : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-neutral-100 text-neutral-800'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>

                  {isProcessing && (
                    <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-blue-200'}`}>
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${job.progress || 25}%` }}
                      />
                    </div>
                  )}

                  <div className={`flex items-center justify-between text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    <span className="truncate">{job.currentStep}</span>
                    <span className="shrink-0 font-mono">{job.progress}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Job Details & Terminal Logs */}
          <div className="md:col-span-7 p-4 overflow-y-auto max-h-[60vh] space-y-4">
            {selectedJob ? (
              <div className="space-y-4 text-xs">
                <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
                  <div>
                    <h3 className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                      {selectedJob.title}
                    </h3>
                    <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      ID: {selectedJob.id}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      selectedJob.status === 'finalizado'
                        ? isDarkMode ? 'bg-emerald-950/80 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                        : isDarkMode ? 'bg-blue-950/80 text-blue-300' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {selectedJob.status} ({selectedJob.progress}%)
                  </span>
                </div>

                <div className="space-y-1">
                  <span className={`text-[11px] font-semibold uppercase ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Paso Actual:
                  </span>
                  <p className={`p-2.5 rounded-lg font-medium ${isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-neutral-100 text-neutral-800'}`}>
                    {selectedJob.currentStep}
                  </p>
                </div>

                {selectedJob.result && (
                  <div
                    className={`p-3 border rounded-xl space-y-1.5 ${
                      isDarkMode
                        ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-200'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wider block ${isDarkMode ? 'text-emerald-400' : 'text-emerald-800'}`}>
                      Resultado Disponible
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedJob.result.docUrl && (
                        <a
                          href={selectedJob.result.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline font-semibold"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir Documento Generado en Google Docs
                        </a>
                      )}
                      {selectedJob.result.driveUrl && (
                        <a
                          href={selectedJob.result.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-purple-400 hover:underline font-semibold"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ver Manual en Google Drive
                        </a>
                      )}
                      {selectedJob.result.sheetsUrl && (
                        <a
                          href={selectedJob.result.sheetsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline font-semibold"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ver Planilla en Google Sheets
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Real-time Logs Console */}
                <div className="space-y-1.5">
                  <span className={`text-[11px] font-semibold uppercase flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    <Terminal className="w-3.5 h-3.5 text-neutral-400" />
                    Registro de Eventos y Pipeline Asíncrono:
                  </span>
                  <div className="p-3 bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl font-mono text-[11px] space-y-1 max-h-48 overflow-y-auto">
                    {selectedJob.logs?.map((log: string, li: number) => (
                      <p key={li} className="text-emerald-400">
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`p-8 text-center ${isDarkMode ? 'text-slate-600' : 'text-neutral-400'}`}>
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Selecciona una tarea para ver sus detalles</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-3 border-t text-right ${
            isDarkMode
              ? 'bg-slate-800/80 border-slate-700'
              : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          <button
            onClick={onClose}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              isDarkMode
                ? 'bg-slate-700 hover:bg-slate-600 text-white'
                : 'bg-neutral-900 hover:bg-neutral-800 text-white'
            }`}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
