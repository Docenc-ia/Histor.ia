/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lazy-loaded System Modals for Header (Full Backup & Restore + Edit Teacher Profile).
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  User,
  Check,
  Cloud,
  RefreshCw,
  Download,
  Upload,
  FileSpreadsheet,
  ShieldCheck,
} from 'lucide-react';
import { Course, Student, TeacherProfile } from '../../types';
import { CloudSyncStatusInfo } from '../../services/firestoreSync';
import { backupService } from '../../services/backupService';

export interface HeaderSystemModalsProps {
  isDarkMode: boolean;
  user: TeacherProfile | null;
  courses: Course[];
  students: Student[];
  cloudStatus: CloudSyncStatusInfo;
  isManualSyncingCloud: boolean;
  onManualCloudResync: () => Promise<void>;
  isFullBackupOpen: boolean;
  onCloseFullBackup: () => void;
  isEditProfileOpen: boolean;
  onCloseEditProfile: () => void;
  onUpdateUserProfile: (profile: Partial<TeacherProfile>) => Promise<void>;
}

export const HeaderSystemModals: React.FC<HeaderSystemModalsProps> = ({
  isDarkMode,
  user,
  courses,
  students,
  cloudStatus,
  isManualSyncingCloud,
  onManualCloudResync,
  isFullBackupOpen,
  onCloseFullBackup,
  isEditProfileOpen,
  onCloseEditProfile,
  onUpdateUserProfile,
}) => {
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [isRestoringFullBackup, setIsRestoringFullBackup] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const [editName, setEditName] = useState(user?.name || '');
  const [editSchool, setEditSchool] = useState(user?.school || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    if (user) {
      setEditName(user.name || '');
      setEditSchool(user.school || '');
      setEditEmail(user.email || '');
    }
  }, [user]);

  useEffect(() => {
    if (isFullBackupOpen) {
      setBackupFeedback(null);
    }
  }, [isFullBackupOpen]);

  const handleDownloadFullBackupJson = () => {
    try {
      backupService.downloadFullBackupJson({ user, courses, students });
      setBackupFeedback('✓ Copia de seguridad completa (.json) descargada con éxito.');
      setTimeout(() => setBackupFeedback(null), 5000);
    } catch {
      setBackupFeedback('Error al generar el archivo de respaldo.');
    }
  };

  const handleDownloadFullExcelSummary = async () => {
    try {
      await backupService.downloadFullExcelSummary({ user, courses, students });
      setBackupFeedback('✓ Planilla Excel unificada descargada con éxito.');
      setTimeout(() => setBackupFeedback(null), 5000);
    } catch (err: any) {
      setBackupFeedback(err?.message || 'Error al exportar planilla Excel.');
    }
  };

  const handleRestoreFullBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRestoringFullBackup(true);
    setBackupFeedback(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        await backupService.restoreFullBackupFromJsonString(content);
        setBackupFeedback('✓ ¡Respaldo completo restaurado y sincronizado en la nube con éxito!');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (err: any) {
        setBackupFeedback(err.message || 'Error al restaurar el archivo de respaldo.');
      } finally {
        setIsRestoringFullBackup(false);
        if (restoreInputRef.current) restoreInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      {/* Modal: Copia de Seguridad Completa en 1 Clic (JSON / Excel + Restauración) */}
      {isFullBackupOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-7 max-w-lg w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Copia de Seguridad del Ciclo Lectivo</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Respaldo unificado en 1 clic además de tu sincronización en Firestore
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseFullBackup}
                className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-slate-800 ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Estado actual en la nube */}
            <div
              className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                isDarkMode
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Cloud className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="text-xs">
                  <div className="font-bold">Respaldo automático en Firebase Firestore activo</div>
                  <div className="opacity-80 text-[11px]">
                    {cloudStatus.lastSyncedAt
                      ? `Última sincronización en la nube: ${cloudStatus.lastSyncedAt}`
                      : 'Tus cursos, alumnos, asistencias, notas y configuraciones están sincronizados.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onManualCloudResync}
                disabled={isManualSyncingCloud}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isManualSyncingCloud ? 'animate-spin' : ''}`} />
                <span>Sincronizar</span>
              </button>
            </div>

            {backupFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold ${
                  backupFeedback.startsWith('✓')
                    ? isDarkMode
                      ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                      : 'bg-blue-50 border-blue-200 text-blue-800'
                    : isDarkMode
                    ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                {backupFeedback}
              </div>
            )}

            {/* Botones de Descarga en 1 Clic */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleDownloadFullBackupJson}
                className="w-full p-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-left flex items-center justify-between gap-3 shadow-xs transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="text-xs sm:text-sm font-bold">
                      1. Descargar Copia de Seguridad Integral (.JSON)
                    </div>
                    <div className="text-[11px] text-indigo-100">
                      Incluye todas las materias, alumnos, asistencias, notas, semáforo y calendarios
                    </div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleDownloadFullExcelSummary}
                className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-emerald-300'
                    : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs sm:text-sm font-bold">
                      2. Descargar Planilla Excel Unificada (.XLSX)
                    </div>
                    <div className="text-[11px] opacity-80">
                      Exporta en un solo archivo Excel el resumen general de todos tus alumnos
                    </div>
                  </div>
                </div>
              </button>

              {/* Restaurar desde archivo JSON */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                  isDarkMode
                    ? 'bg-slate-800/50 border-slate-700 text-slate-200'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Upload className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">
                      Restaurar desde archivo de respaldo (.JSON)
                    </div>
                    <div className="text-[11px] opacity-75">
                      Carga un archivo descargado previamente y lo sube a tu nube de Firestore
                    </div>
                  </div>
                </div>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFullBackupFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isRestoringFullBackup}
                  onClick={() => restoreInputRef.current?.click()}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-white'
                      : 'bg-white hover:bg-neutral-100 border-neutral-300 text-neutral-800'
                  }`}
                >
                  {isRestoringFullBackup ? 'Restaurando...' : 'Elegir archivo'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onCloseFullBackup}
                className={`px-4 py-2 text-xs font-semibold rounded-xl ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Perfil del Docente */}
      {isEditProfileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`rounded-3xl p-6 sm:p-8 max-w-md w-full border shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-neutral-200 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/10 text-blue-600 flex items-center justify-center">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Datos del Docente</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                    Personaliza tu nombre, correo e institución
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseEditProfile}
                className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-slate-800 ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setIsSavingProfile(true);
                try {
                  await onUpdateUserProfile({
                    name: editName.trim() || user?.name,
                    school: editSchool.trim() || user?.school,
                    email: editEmail.trim() || user?.email,
                  });
                  onCloseEditProfile();
                } finally {
                  setIsSavingProfile(false);
                }
              }}
              className="space-y-4 text-left"
            >
              <div>
                <label
                  className={`text-xs font-semibold block mb-1 ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  Nombre y Apellido del Docente
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="ej: Prof. Jorge Cano"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label
                  className={`text-xs font-semibold block mb-1 ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ej: docente@colegio.edu.ar"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label
                  className={`text-xs font-semibold block mb-1 ${
                    isDarkMode ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  Institución / Escuela
                </label>
                <input
                  type="text"
                  value={editSchool}
                  onChange={(e) => setEditSchool(e.target.value)}
                  placeholder="ej: Colegio San Martín"
                  className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border outline-none ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:bg-white focus:border-blue-500'
                  }`}
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onCloseEditProfile}
                  className={`px-4 py-2 text-xs font-medium rounded-xl transition-all ${
                    isDarkMode
                      ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingProfile ? (
                    <span>Guardando...</span>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar Perfil</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
