import React, { useState } from 'react';
import {
  FolderClosed,
  Plus,
  ExternalLink,
  Search,
  CheckCircle2,
  HardDrive,
  Upload,
  FileText,
  Table,
  Presentation,
  File,
  Check,
  Share2,
} from 'lucide-react';
import { DriveResource, Course } from '../../types';
import { driveService } from '../../services/workspace/driveService';
import { api } from '../../services/api';

interface DriveModuleProps {
  files: DriveResource[];
  courses: Course[];
  selectedCourseId?: string;
  onOpenNewModal: (type: 'course' | 'plan' | 'task' | 'file') => void;
  onRefreshData: () => void;
}

export const DriveModule: React.FC<DriveModuleProps> = ({
  files,
  courses,
  selectedCourseId,
  onOpenNewModal,
  onRefreshData,
}) => {
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const folders = [
    'Guías y Actividades',
    'Administración y Calificaciones',
    'Clases Magistrales',
    'Rúbricas e Instrumentos',
  ];

  const filteredFiles = files.filter((f) => {
    const matchesFolder = selectedFolder === 'all' || f.folder === selectedFolder;
    const matchesSearch = f.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFolder && matchesSearch;
  });

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'doc':
        return <FileText className="w-5 h-5 text-[#4285F4]" />;
      case 'sheet':
        return <Table className="w-5 h-5 text-[#0F9D58]" />;
      case 'slide':
        return <Presentation className="w-5 h-5 text-[#FBBC05]" />;
      default:
        return <File className="w-5 h-5 text-[#EA4335]" />;
    }
  };

  const handleCreateCourseDriveFolder = async (courseName: string) => {
    setIsCreatingFolder(true);
    try {
      const result = await driveService.createCourseFolder(courseName);
      setToastMessage(`Carpeta de Google Drive creada: "${result.name}"`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      alert('Error al crear carpeta en Drive: ' + err.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
            <FolderClosed className="w-6 h-6 text-amber-500" />
            Biblioteca en Google Drive
          </h2>
          <p className="text-xs text-neutral-500">
            Archivos didácticos, guías de clase y carpetas compartidas con estudiantes en Google Workspace
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenNewModal('file')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#4285F4] hover:bg-[#3367d6] text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
          >
            <Upload className="w-4 h-4" />
            Subir a Drive
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Drive Storage & Quick Folders */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Drive Storage Status */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-neutral-500 mb-1">
              <HardDrive className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold uppercase tracking-wide">Espacio Workspace</span>
            </div>
            <p className="text-sm font-bold text-neutral-800">1.8 GB utilizados</p>
            <p className="text-[11px] text-neutral-400">Almacenamiento institucional ilimitado</p>
          </div>
          <div className="w-full h-1.5 bg-neutral-100 rounded-full mt-3 overflow-hidden">
            <div className="w-1/6 h-full bg-blue-600 rounded-full" />
          </div>
        </div>

        {/* Quick Folder shortcuts */}
        <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {folders.map((folder) => {
            const isSelected = selectedFolder === folder;
            const count = files.filter((f) => f.folder === folder).length;
            return (
              <button
                key={folder}
                onClick={() => setSelectedFolder(isSelected ? 'all' : folder)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-amber-50/70 border-amber-400 shadow-xs ring-1 ring-amber-400/20'
                    : 'bg-white border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <FolderClosed
                  className={`w-5 h-5 mb-1.5 ${isSelected ? 'text-amber-600' : 'text-neutral-400'}`}
                />
                <h4 className="text-xs font-bold text-neutral-800 truncate">{folder}</h4>
                <span className="text-[11px] text-neutral-400">{count} archivos</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Files List / Explorer */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-xs">
        <div className="p-3 bg-neutral-50 border-b border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Buscar archivo en Drive..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-white text-xs border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            {selectedFolder !== 'all' && (
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                Filtrado por: <strong className="text-neutral-800">{selectedFolder}</strong>
                <button
                  onClick={() => setSelectedFolder('all')}
                  className="text-blue-600 hover:underline ml-1 font-semibold"
                >
                  (quitar)
                </button>
              </span>
            )}
            <span className="text-xs text-neutral-400">{filteredFiles.length} elementos</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#f8fafd] text-neutral-500 font-semibold uppercase text-[11px] border-b border-neutral-200">
              <tr>
                <th className="py-3 px-4">Nombre del Documento</th>
                <th className="py-3 px-4">Carpeta</th>
                <th className="py-3 px-4">Tamaño</th>
                <th className="py-3 px-4">Última Modificación</th>
                <th className="py-3 px-4 text-center">Classroom</th>
                <th className="py-3 px-4 text-right">Abrir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredFiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-400">
                    No se encontraron archivos en esta carpeta.
                  </td>
                </tr>
              ) : (
                filteredFiles.map((file) => (
                  <tr key={file.id} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        {getFileIcon(file.type)}
                        <span className="font-semibold text-neutral-800 line-clamp-1">{file.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-neutral-500">{file.folder}</td>
                    <td className="py-3 px-4 text-neutral-400 font-mono text-[11px]">{file.size}</td>
                    <td className="py-3 px-4 text-neutral-400">
                      {new Date(file.modifiedTime).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {file.sharedWithClassroom ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <Check className="w-2.5 h-2.5" /> Vinculado
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-400">Solo Drive</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <a
                        href={file.googleDriveUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <span>Abrir</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
