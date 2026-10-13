import React from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  ExternalLink,
  Settings,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface GoogleSyncManagerProps {
  courseName: string;
  isSyncingSheet: boolean;
  isLiveGoogle: boolean;
  lastSyncedAt?: string;
  isOpeningSheet: boolean;
  isTokenExpired?: boolean;
  onOpenGoogleSheet: () => void;
  onManualSheetsSync: () => void;
  onOpenConnectModal: () => void;
  onRenewToken?: () => void;
  isDarkMode: boolean;
  className?: string;
}

export const GoogleSyncManager: React.FC<GoogleSyncManagerProps> = ({
  courseName,
  isSyncingSheet,
  isLiveGoogle,
  lastSyncedAt,
  isOpeningSheet,
  isTokenExpired = false,
  onOpenGoogleSheet,
  onManualSheetsSync,
  onOpenConnectModal,
  onRenewToken,
  isDarkMode,
  className = '',
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Session expired friendly prompt */}
      {isTokenExpired && (
        <div
          role="alert"
          className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in slide-in-from-top-1 ${
            isDarkMode
              ? 'bg-amber-950/50 border-amber-800 text-amber-200'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="font-semibold">
              Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.
            </span>
          </div>
          {onRenewToken && (
            <button
              type="button"
              onClick={onRenewToken}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer active:scale-95 transition-all self-end sm:self-auto shrink-0 shadow-2xs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reconectar sesión</span>
            </button>
          )}
        </div>
      )}

      {/* Main Google Sheets bar */}
      <div
        className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-neutral-900'}`}>
                Google Sheets: {courseName}
              </h4>
              {isSyncingSheet ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Sincronizando...
                </span>
              ) : isTokenExpired ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  Sesión expirada
                </span>
              ) : isLiveGoogle ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  En vivo en Google Drive
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  Guardado local
                </span>
              )}
            </div>
            {lastSyncedAt && (
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Última actualización: {lastSyncedAt}.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
          <button
            type="button"
            onClick={onOpenGoogleSheet}
            disabled={isOpeningSheet}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
            title="Abrir o sincronizar en Google Sheets"
          >
            {isOpeningSheet ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5" />
            )}
            <span>Abrir Google Sheet</span>
          </button>
          <button
            type="button"
            onClick={onManualSheetsSync}
            disabled={isSyncingSheet}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-300'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
            <span>Sincronizar Ahora</span>
          </button>
          <button
            type="button"
            onClick={onOpenConnectModal}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-300'
            }`}
            title="Configurar y vincular hoja existente de Google Sheets"
          >
            <Settings className="w-3.5 h-3.5 text-emerald-500" />
            <span>Vincular Sheet</span>
          </button>
        </div>
      </div>
    </div>
  );
};
