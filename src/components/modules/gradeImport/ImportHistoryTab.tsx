import React from 'react';
import { Download } from 'lucide-react';
import {
  GradeHistoryEntry,
  exportGradeHistoryToExcel,
} from '../../../utils/excelExport';

interface ImportHistoryTabProps {
  courseName: string;
  historyEntries: GradeHistoryEntry[];
  isDarkMode: boolean;
  onBackToUpload: () => void;
}

export const ImportHistoryTab: React.FC<ImportHistoryTabProps> = ({
  courseName,
  historyEntries,
  isDarkMode,
  onBackToUpload,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="p-5 flex-1 overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-sm">Historial de Importaciones de la Materia</h4>
          <button
            type="button"
            onClick={() => exportGradeHistoryToExcel(courseName, historyEntries)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar Historial a Excel</span>
          </button>
        </div>
        {historyEntries.map((item) => (
          <div
            key={item.id}
            className={`p-3.5 rounded-xl border text-xs space-y-1 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-750' : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>
                {item.categoryName} — {item.evaluationName} ({item.termLabel})
              </span>
              <span className="text-neutral-400">
                {item.date} {item.time}
              </span>
            </div>
            <p className="text-neutral-500 dark:text-slate-400">{item.description}</p>
          </div>
        ))}
      </div>
      <div
        className={`px-5 py-3 border-t flex justify-between ${
          isDarkMode ? 'bg-slate-850 border-slate-750' : 'bg-neutral-50 border-neutral-200'
        }`}
      >
        <button
          type="button"
          onClick={onBackToUpload}
          className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
        >
          ← Volver a Importar
        </button>
      </div>
    </div>
  );
};
