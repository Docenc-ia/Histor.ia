import React, { useState } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Calendar,
  Clock,
  GraduationCap,
  Sparkles,
  Download,
  BookOpen,
  Award,
  Users,
  ExternalLink,
  Info,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';

interface TeacherGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCalendarSettings?: () => void;
  onOpenClassroomSync?: () => void;
}

export const TeacherGuideModal: React.FC<TeacherGuideModalProps> = ({
  isOpen,
  onClose,
  onOpenCalendarSettings,
  onOpenClassroomSync,
}) => {
  const { isDarkMode, user } = useWorkspaceAuth();
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<'share' | 'semaforo' | 'calendar' | 'backup'>('share');

  if (!isOpen) return null;

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://docenc.ia';

  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(appUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  const handleExportBackup = () => {
    try {
      const backupData: Record<string, any> = {
        app: 'Docenc.ia',
        version: '2026.1',
        exportedAt: new Date().toISOString(),
        teacher: user?.email || 'Docente',
        storage: {},
      };

      if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('fds_') || key.startsWith('docencia_'))) {
            try {
              backupData.storage[key] = JSON.parse(localStorage.getItem(key) || 'null');
            } catch (_) {
              backupData.storage[key] = localStorage.getItem(key);
            }
          }
        }
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Docencia_Respaldo_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error al exportar respaldo:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div
        className={`relative w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150 ${
          isDarkMode ? 'bg-[#10172A] border-slate-800 text-slate-100' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isDarkMode ? 'border-slate-800 bg-slate-900/60' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Guía para Docentes y Compartir</h2>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Todo lo necesario para aprovechar Docenc.ia y compartirlo con tus colegas
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-xl transition-colors cursor-pointer ${
              isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60'
            }`}
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          className={`flex items-center gap-2 px-6 pt-3 border-b overflow-x-auto text-xs font-semibold ${
            isDarkMode ? 'border-slate-800 bg-slate-900/30' : 'border-neutral-200 bg-white'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('share')}
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'share'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <Share2 className="w-4 h-4" />
            <span>Compartir con Colegas</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('semaforo')}
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'semaforo'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Semáforo de Asistencia</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'calendar'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4 text-amber-500" />
            <span>Semanas y Calendario</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'backup'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4 text-purple-500" />
            <span>Copia de Respaldo</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: COMPARTIR CON COLEGAS */}
          {activeTab === 'share' && (
            <div className="space-y-6">
              <div
                className={`p-5 rounded-2xl border ${
                  isDarkMode ? 'bg-blue-950/30 border-blue-800/60' : 'bg-blue-50/80 border-blue-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Enlace de acceso a la aplicación
                    </span>
                    <p className="text-sm font-semibold text-neutral-800 dark:text-slate-100 break-all select-all">
                      {appUrl}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer shrink-0 active:scale-95"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-300" />
                        <span>¡Enlace copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar Enlace</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span>¿Cómo pueden ingresar tus compañeros docentes?</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    className={`p-4 rounded-2xl border ${
                      isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 font-bold text-xs flex items-center justify-center mb-2">
                      1
                    </div>
                    <h4 className="text-xs font-bold mb-1">Google Workspace</h4>
                    <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Inician sesión directamente con su cuenta escolar de Gmail o Google Workspace para sincronizar con Classroom.
                    </p>
                  </div>

                  <div
                    className={`p-4 rounded-2xl border ${
                      isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-500 font-bold text-xs flex items-center justify-center mb-2">
                      2
                    </div>
                    <h4 className="text-xs font-bold mb-1">Correo Institucional</h4>
                    <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Pueden ingresar escribiendo su correo y contraseña sin necesidad de configuración previa.
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={`p-4 rounded-2xl border text-xs space-y-2 ${
                  isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-neutral-800 dark:text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Seguridad y Privacidad de los Datos</span>
                </div>
                <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  Cada docente trabaja en su propio entorno privado. Las asistencias, calificaciones y observaciones de tus materias están protegidas y no se mezclan con las de otros profesores.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: SEMÁFORO DE ASISTENCIA */}
          {activeTab === 'semaforo' && (
            <div className="space-y-5">
              <div
                className={`p-4 rounded-2xl border ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <h3 className="text-sm font-bold mb-2">Criterios Oficiales de Asistencia y Regularidad</h3>
                <p className={`text-xs leading-relaxed mb-4 ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  Para que la planilla sea limpia y fácil de leer durante la clase, el porcentaje no sobrecarga la vista principal. En su lugar, el número de faltas se colorea de acuerdo a los siguientes tres estados:
                </p>

                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">
                        Verde • Sin Riesgo (&gt; 80% de asistencia)
                      </span>
                      <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                        El alumno mantiene una asistencia regular holgada. El botón de faltas se muestra en verde indicando tranquilidad.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <span className="w-3.5 h-3.5 rounded-full bg-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <span className="font-bold text-amber-700 dark:text-amber-300">
                        Amarillo • Al Límite (75% a 80% de asistencia)
                      </span>
                      <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                        El alumno está cerca del límite reglamentario (le quedan 0 o 1 falta antes de perder la regularidad).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <span className="w-3.5 h-3.5 rounded-full bg-red-500 shrink-0 mt-0.5 animate-pulse" />
                    <div className="text-xs">
                      <span className="font-bold text-red-700 dark:text-red-300">
                        Rojo • Riesgo (&lt; 75% de asistencia)
                      </span>
                      <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-slate-300' : 'text-neutral-600'}`}>
                        No cuenta con el mínimo de asistencia o ha excedido las inasistencias máximas permitidas.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`p-4 rounded-2xl border text-xs space-y-2 ${
                  isDarkMode ? 'bg-blue-950/20 border-blue-800/40' : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-blue-700 dark:text-blue-300">
                  <Info className="w-4 h-4 text-blue-500" />
                  <span>¿Dónde ver el total exacto y el porcentaje?</span>
                </div>
                <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                  Hacé <strong>clic sobre el nombre del alumno</strong> en la planilla. Se abrirá la <strong>Ficha Pedagógica y Observaciones</strong> con la tarjeta completa: porcentaje exacto, total de clases dictadas y asistidas, inasistencias del 1° y 2° cuatrimestre, inasistencias restantes y nota de disposición.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: CALENDARIO Y SEMANAS */}
          {activeTab === 'calendar' && (
            <div className="space-y-5">
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  <span>Ubicación en la Barra Lateral</span>
                </h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  Las opciones de calendario están ubicadas en la barra lateral bajo la sección <strong>VINCULACIÓN CALENDAR</strong> (ubicada directamente arriba de Vinculación Classroom):
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div
                    className={`p-3.5 rounded-xl border ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <span className="font-bold text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1.5 mb-1">
                      <Calendar className="w-3.5 h-3.5" />
                      Google Calendar Oficial
                    </span>
                    <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Vista semanal de tu cronograma escolar, mesas de examen y eventos institucionales.
                    </p>
                  </div>

                  <div
                    className={`p-3.5 rounded-xl border ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <span className="font-bold text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                      <Clock className="w-3.5 h-3.5" />
                      Horarios y Semanas de Clase
                    </span>
                    <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                      Permite ajustar la cantidad de semanas del 1° y 2° cuatrimestre y las clases por semana para calcular el semáforo con precisión.
                    </p>
                  </div>
                </div>

                {onOpenCalendarSettings && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenCalendarSettings();
                      }}
                      className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Abrir Configuración de Semanas Ahora</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: COPIA DE RESPALDO */}
          {activeTab === 'backup' && (
            <div className="space-y-5">
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Download className="w-4 h-4 text-purple-500" />
                  <span>Descargar Copia de Seguridad</span>
                </h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
                  Podés descargar en cualquier momento un archivo <code>.json</code> completo con todas tus materias, listas de estudiantes, asistencias, notas y observaciones.
                </p>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer active:scale-95"
                  >
                    <Download className="w-4 h-4" />
                    <span>Exportar Respaldo (.JSON)</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-t ${
            isDarkMode ? 'border-slate-800 bg-slate-900/60' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <span className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Docenc.ia • Diseñado para la labor docente diaria
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
