import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { useWorkspaceAuth } from '../../../context/WorkspaceAuthContext';

interface GoogleSessionExpiryBannerProps {
  className?: string;
  onRenewed?: () => void;
}

export const GoogleSessionExpiryBanner: React.FC<GoogleSessionExpiryBannerProps> = ({
  className = '',
  onRenewed,
}) => {
  const { isTokenExpired, renewGoogleSession, dismissTokenExpiryBanner, isDarkMode } = useWorkspaceAuth();
  const [isRenewing, setIsRenewing] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  if (!isTokenExpired && !successNotice) {
    return null;
  }

  const handleRenew = async () => {
    setIsRenewing(true);
    try {
      const ok = await renewGoogleSession();
      if (ok) {
        setSuccessNotice(true);
        if (onRenewed) onRenewed();
        setTimeout(() => {
          setSuccessNotice(false);
        }, 4000);
      }
    } finally {
      setIsRenewing(false);
    }
  };

  if (successNotice) {
    return (
      <div
        className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium animate-in fade-in duration-200 ${
          isDarkMode
            ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        } ${className}`}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>¡Sesión de Google reconectada exitosamente! Todos tus cambios y registros continúan guardados.</span>
        </div>
        <button
          type="button"
          onClick={() => setSuccessNotice(false)}
          className="p-1 rounded-md hover:bg-emerald-500/20 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`p-3.5 rounded-xl border shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-200 ${
        isDarkMode
          ? 'bg-amber-950/50 border-amber-700/80 text-amber-100'
          : 'bg-amber-50/95 border-amber-300 text-amber-950'
      } ${className}`}
    >
      <div className="flex items-start sm:items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs sm:text-sm font-bold">
            Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.
          </p>
          <p className="text-[11px] opacity-80 mt-0.5">
            Los tokens de Google duran 60 minutos. Tus notas, faltas y cambios actuales están seguros en memoria local.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <button
          type="button"
          onClick={handleRenew}
          disabled={isRenewing}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-50 text-white shadow-xs transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRenewing ? 'animate-spin' : ''}`} />
          <span>{isRenewing ? 'Reconectando...' : 'Reconectar ahora'}</span>
        </button>
        <button
          type="button"
          onClick={dismissTokenExpiryBanner}
          className="p-1.5 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer opacity-70 hover:opacity-100"
          title="Ocultar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
