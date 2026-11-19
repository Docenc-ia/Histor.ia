import React from 'react';
import { Check, FileText } from 'lucide-react';
import { formatCourseDriveFolderName } from '../../../services/workspace/driveService';

export interface SaveToDriveConfirmDialogProps {
  isDarkMode: boolean;
  courseName: string;
  targetGoogleDocTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SaveToDriveConfirmDialog: React.FC<SaveToDriveConfirmDialogProps> = ({
  isDarkMode,
  courseName,
  targetGoogleDocTitle,
  onCancel,
  onConfirm,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold">
              ¿Crear archivo Google Doc editable en Google Drive?
            </h3>
            <p className="text-xs text-neutral-500 dark:text-slate-400 mt-1 leading-relaxed">
              Se creará un documento editable de <strong>Google Docs (.gdoc)</strong> en la subcarpeta <strong>"{formatCourseDriveFolderName(courseName)} / Informes"</strong> con el siguiente nombre:
            </p>
            <div
              className={`mt-2 p-2.5 rounded-xl border text-xs font-semibold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              {targetGoogleDocTitle}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Confirmar y Crear Google Doc</span>
          </button>
        </div>
      </div>
    </div>
  );
};
