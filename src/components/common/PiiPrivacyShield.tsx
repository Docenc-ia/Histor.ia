import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';

// ISO/IEC 27001 A.7.7 (Clear Screen) & A.8.11 (Data Masking):
// Automatically masks student PII (names, emails, avatars, grades, absences, observations)
// when the browser tab loses visibility or after 2 minutes of classroom inactivity,
// and allows instant manual toggling ("Modo Proyector / Privacidad") from the Header.
const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes of inactivity
const ACTIVITY_THROTTLE_MS = 1000;

export type PiiMaskReason = 'manual' | 'idle' | 'hidden' | null;

let currentManualLock = false;
let currentMaskReason: PiiMaskReason = null;
const listeners = new Set<(masked: boolean, reason: PiiMaskReason) => void>();

function applyDomMaskState(masked: boolean, reason: PiiMaskReason) {
  currentMaskReason = masked ? reason : null;
  if (typeof document !== 'undefined') {
    if (masked) {
      document.documentElement.setAttribute('data-pii-masked', 'true');
      document.documentElement.setAttribute('data-pii-reason', reason || 'auto');
    } else {
      document.documentElement.removeAttribute('data-pii-masked');
      document.documentElement.removeAttribute('data-pii-reason');
    }
  }
  listeners.forEach((fn) => {
    try {
      fn(masked, currentMaskReason);
    } catch (_) {}
  });
}

export function toggleManualPiiMask(forceState?: boolean): boolean {
  if (typeof forceState === 'boolean') {
    currentManualLock = forceState;
  } else if (currentManualLock) {
    currentManualLock = false;
  } else if (currentMaskReason === 'idle' || currentMaskReason === 'hidden') {
    // If privacy was active due to inactivity/hidden tab and user clicked the button, turn it off instead of locking it on
    currentManualLock = false;
  } else {
    currentManualLock = true;
  }
  applyDomMaskState(currentManualLock, currentManualLock ? 'manual' : null);
  return currentManualLock;
}

export function subscribePiiMaskState(
  cb: (masked: boolean, reason: PiiMaskReason) => void
): () => void {
  listeners.add(cb);
  cb(Boolean(currentMaskReason), currentMaskReason);
  return () => {
    listeners.delete(cb);
  };
}

export const PiiPrivacyShield: React.FC<{ isDarkMode?: boolean }> = ({ isDarkMode }) => {
  const [maskState, setMaskState] = useState<{ masked: boolean; reason: PiiMaskReason }>({
    masked: false,
    reason: null,
  });

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const scheduleIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      if (!currentManualLock) {
        applyDomMaskState(true, 'idle');
      }
    }, IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePiiMaskState((masked, reason) => {
      setMaskState({ masked, reason });
      if (!masked) {
        lastActivityRef.current = Date.now();
        scheduleIdleTimer();
      }
    });

    const handleUserActivity = (ev?: Event) => {
      // Manual Privacy Mode can ONLY be deactivated by clicking the Privacy button (or Alt+P), NEVER by mouse movement or other activity
      if (currentManualLock || currentMaskReason === 'manual') {
        return;
      }

      // Avoid race condition where pointerdown on the Privacy toggle button unmasks an idle lock 1ms before click runs
      if (ev && ev.type === 'pointerdown') {
        const target = ev.target as HTMLElement | null;
        if (target?.closest?.('[data-pii-toggle="true"], [data-pii-unmask="true"]')) {
          return;
        }
      }

      const now = Date.now();
      // If currently masked due to inactivity or tab switch (NOT manual lock), unmask on mouse movement / activity
      if (currentMaskReason === 'idle' || currentMaskReason === 'hidden') {
        lastActivityRef.current = now;
        applyDomMaskState(false, null);
        scheduleIdleTimer();
        return;
      }
      // Throttle timer resets during normal active work
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivityRef.current = now;
      scheduleIdleTimer();
    };

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (currentManualLock) return;
      if (document.hidden) {
        applyDomMaskState(true, 'hidden');
      } else if (currentMaskReason === 'hidden') {
        lastActivityRef.current = Date.now();
        applyDomMaskState(false, null);
        scheduleIdleTimer();
      }
    };

    const handleWindowBlur = () => {
      // If user switches to another OS window while projecting, start a faster 15s grace timer
      if (currentManualLock) return;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!currentManualLock && typeof document !== 'undefined' && !document.hasFocus()) {
          applyDomMaskState(true, 'idle');
        }
      }, 15000);
    };

    const handleWindowFocus = () => {
      if (currentManualLock) return;
      if (currentMaskReason === 'idle') {
        lastActivityRef.current = Date.now();
        applyDomMaskState(false, null);
      }
      scheduleIdleTimer();
    };

    const handleKeyDownShortcut = (e: KeyboardEvent) => {
      // Alt + P shortcut to toggle Classroom Projector / Privacy Mode
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        toggleManualPiiMask();
        return;
      }
      handleUserActivity(e);
    };

    scheduleIdleTimer();

    window.addEventListener('pointermove', handleUserActivity, { passive: true });
    window.addEventListener('pointerdown', handleUserActivity, { passive: true });
    window.addEventListener('wheel', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleKeyDownShortcut, { passive: false });
    window.addEventListener('blur', handleWindowBlur, { passive: true });
    window.addEventListener('focus', handleWindowFocus, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubscribe();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointermove', handleUserActivity);
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('wheel', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      window.removeEventListener('keydown', handleKeyDownShortcut);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [scheduleIdleTimer]);

  if (!maskState.masked) return null;

  return (
    <div className="no-print fixed bottom-5 left-1/2 -translate-x-1/2 z-50 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div
        className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl border shadow-xl backdrop-blur-md text-xs font-medium ${
          isDarkMode
            ? 'bg-slate-900/95 border-indigo-500/50 text-slate-100 shadow-indigo-950/50'
            : 'bg-white/95 border-indigo-300 text-slate-800 shadow-indigo-500/10'
        }`}
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-indigo-600 text-white shrink-0">
          <EyeOff className="w-4 h-4" />
        </span>
        <div className="flex flex-col">
          <span className="font-bold flex items-center gap-1.5">
            <span>Protección de Privacidad Activa</span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">
              <ShieldCheck className="w-3 h-3" /> ISO 27001
            </span>
          </span>
          <span className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            {maskState.reason === 'manual'
              ? 'Activado por clic: volvé a hacer clic en "Datos Ocultos" o en "Mostrar datos" para desactivarlo.'
              : 'Activado por inactividad: mové el mouse o tocá una tecla para volver a ver los datos.'}
          </span>
        </div>
        <button
          type="button"
          data-pii-unmask="true"
          onClick={() => toggleManualPiiMask(false)}
          className="ml-2 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer shrink-0"
          title="Volver a mostrar los datos de los estudiantes (Atajo: Alt + P)"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Mostrar datos</span>
        </button>
      </div>
    </div>
  );
};
