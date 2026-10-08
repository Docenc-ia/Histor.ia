import React, { useState } from 'react';
import {
  Table,
  Plus,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Save,
  Search,
  Filter,
} from 'lucide-react';
import { Course, Student, GradeEntry } from '../../types';
import { sheetsService } from '../../services/workspace/sheetsService';
import { driveService } from '../../services/workspace/driveService';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';

interface GradebookModuleProps {
  courses: Course[];
  students: Student[];
  grades: GradeEntry[];
  selectedCourseId?: string;
  onSelectCourse: (id: string) => void;
  onRefreshData: () => void;
}

export const GradebookModule: React.FC<GradebookModuleProps> = ({
  courses,
  students,
  grades,
  selectedCourseId,
  onSelectCourse,
  onRefreshData,
}) => {
  const { isDarkMode, token } = useWorkspaceAuth();
  const activeCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];
  const courseStudents = students.filter((s) => s.courseId === activeCourse?.id);

  // Available evaluations for this course
  const defaultEvaluations = [
    'Parcial Unidad 1: La Célula',
    'TP N°1: Observación Microscopio',
    'Evaluación Diagnóstica',
    'Participación en Aula',
  ];

  const [evaluations, setEvaluations] = useState<string[]>(defaultEvaluations);
  const [newEvalName, setNewEvalName] = useState('');
  const [showAddEvalModal, setShowAddEvalModal] = useState(false);
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedTerm, setSelectedTerm] = useState<'1er Trimestre' | '2do Trimestre' | '3er Trimestre'>('1er Trimestre');
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Local editing cache of grades: studentId_evalTitle -> score
  const [gradeMatrix, setGradeMatrix] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    grades.forEach((g) => {
      initial[`${g.studentId}_${g.evaluationTitle}`] = g.score;
    });
    return initial;
  });

  const filteredStudents = courseStudents.filter((s) =>
    `${s.lastName} ${s.firstName}`.toLowerCase().includes(searchStudent.toLowerCase())
  );

  const handleScoreChange = (studentId: string, evalTitle: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      setGradeMatrix((prev) => ({
        ...prev,
        [`${studentId}_${evalTitle}`]: num,
      }));
    } else if (value === '') {
      setGradeMatrix((prev) => {
        const copy = { ...prev };
        delete copy[`${studentId}_${evalTitle}`];
        return copy;
      });
    }
  };

  const handleSaveGrade = async (studentId: string, evalTitle: string, score: number) => {
    if (!activeCourse) return;
    try {
      await api.updateGrade({
        studentId,
        courseId: activeCourse.id,
        evaluationTitle: evalTitle,
        term: selectedTerm,
        score,
        maxScore: 10,
      });

      // Background sync to course's Google Sheet if user has authenticated token
      const activeToken = token;
      if (activeToken && activeCourse.gradesSheetId && isRealGoogleSpreadsheetId(activeCourse.gradesSheetId)) {
        sheetsService
          .syncGradebookToSheet(
            activeCourse.name,
            courseStudents,
            evaluations,
            grades,
            activeCourse.gradesFolderId
          )
          .catch(() => {});
      }
    } catch (err) {
      console.error('Error saving grade:', err);
    }
  };

  const handleAddEvaluation = () => {
    if (newEvalName.trim() && !evaluations.includes(newEvalName.trim())) {
      setEvaluations([...evaluations, newEvalName.trim()]);
      setNewEvalName('');
      setShowAddEvalModal(false);
    }
  };

  const handleSyncGoogleSheets = async () => {
    if (!activeCourse) return;
    setIsSyncingSheets(true);
    try {
      // 1. Ensure course dedicated Drive folder exists
      let targetFolderId = activeCourse.gradesFolderId || activeCourse.driveFolderId;
      if (!targetFolderId || targetFolderId.startsWith('f-') || targetFolderId.startsWith('folder-')) {
        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            activeCourse.name,
            undefined,
            token || undefined
          );
          targetFolderId = folderStruct.gradesFolder.id || folderStruct.mainFolder.id;
          activeCourse.gradesFolderId = folderStruct.gradesFolder.id;
          activeCourse.gradesFolderUrl = folderStruct.gradesFolder.url;
          activeCourse.driveFolderId = folderStruct.mainFolder.id;
          activeCourse.driveFolderUrl = folderStruct.mainFolder.url;
          api.updateCourse(activeCourse.id, {
            gradesFolderId: folderStruct.gradesFolder.id,
            gradesFolderUrl: folderStruct.gradesFolder.url,
            driveFolderId: folderStruct.mainFolder.id,
            driveFolderUrl: folderStruct.mainFolder.url,
          }).catch(() => {});
        } catch (_) {}
      }

      // 2. Sync grades to course sheet
      const result = await sheetsService.syncGradebookToSheet(
        activeCourse.name,
        courseStudents,
        evaluations,
        grades,
        targetFolderId
      );

      if (result.spreadsheetId && isRealGoogleSpreadsheetId(result.spreadsheetId)) {
        activeCourse.gradesSheetId = result.spreadsheetId;
        activeCourse.gradesSheetUrl = result.url || `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`;
        await api.updateCourse(activeCourse.id, {
          gradesSheetId: result.spreadsheetId,
          gradesSheetUrl: activeCourse.gradesSheetUrl,
        }).catch(() => {});
        setToastMessage(`✓ Planilla de calificaciones de "${activeCourse.name}" guardada en su carpeta de Drive`);
      } else {
        setToastMessage(`Planilla vinculada con Google Sheets`);
      }
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err: any) {
      alert('Error al sincronizar con Google Sheets: ' + err.message);
    } finally {
      setIsSyncingSheets(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!activeCourse) return;
    sheetsService.exportToCsv(activeCourse.name, courseStudents, evaluations, grades);
  };

  // Stats calculation
  const studentAverages = courseStudents.map((student) => {
    const scores = evaluations
      .map((ev) => gradeMatrix[`${student.id}_${ev}`])
      .filter((s) => typeof s === 'number');
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  });

  const validAverages = studentAverages.filter((avg) => avg > 0);
  const courseMean = validAverages.length > 0
    ? (validAverages.reduce((a, b) => a + b, 0) / validAverages.length).toFixed(2)
    : '0.0';
  const passingCount = studentAverages.filter((avg) => avg >= 6).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            <Table className={`w-6 h-6 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
            Registro de Calificaciones (Google Sheets)
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Matriz de notas, ponderación automática y sincronización bidireccional con hojas de cálculo
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddEvalModal(true)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border shadow-xs transition-colors ${
              isDarkMode
                ? 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-750'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
            }`}
          >
            <Plus className={`w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`} />
            Añadir Columna de Evaluación
          </button>
          <button
            onClick={handleSyncGoogleSheets}
            disabled={isSyncingSheets}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0F9D58] hover:bg-[#0b8043] text-white text-xs font-semibold rounded-lg shadow-xs transition-all disabled:opacity-60"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {isSyncingSheets ? 'Sincronizando...' : 'Sincronizar Google Sheets'}
          </button>
          <button
            onClick={handleDownloadCsv}
            className={`p-2 rounded-lg border transition-colors ${
              isDarkMode
                ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border-slate-750'
                : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 border-neutral-200'
            }`}
            title="Descargar archivo CSV compatible con Sheets"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Courses Selector */}
      <div className={`flex items-center gap-2 overflow-x-auto pb-2 border-b ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>
        {courses.map((course) => (
          <button
            key={course.id}
            onClick={() => onSelectCourse(course.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
              activeCourse?.id === course.id
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : isDarkMode
                ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border-slate-750'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border-neutral-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeCourse?.id === course.id ? '#ffffff' : course.color }} />
            <span>{course.name}</span>
          </button>
        ))}
      </div>

      {toastMessage && (
        <div
          className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border animate-in fade-in ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Course Summary Stat Chips */}
      <div
        className={`grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border text-xs shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div>
          <span className={`font-bold block text-[10px] uppercase ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`}>
            Estudiantes Calificados
          </span>
          <span className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            {courseStudents.length}
          </span>
        </div>
        <div>
          <span className={`font-bold block text-[10px] uppercase ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`}>
            Promedio del Curso
          </span>
          <span className={`text-base font-bold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
            {courseMean} / 10
          </span>
        </div>
        <div>
          <span className={`font-bold block text-[10px] uppercase ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`}>
            Aprobados (≥ 6.0)
          </span>
          <span className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            {passingCount} estudiantes
          </span>
        </div>
        <div>
          <span className={`font-bold block text-[10px] uppercase ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`}>
            Periodo Activo
          </span>
          <select
            value={selectedTerm}
            onChange={(e: any) => setSelectedTerm(e.target.value)}
            className={`font-bold bg-transparent border-none p-0 focus:ring-0 cursor-pointer ${
              isDarkMode ? 'text-slate-200 bg-slate-900' : 'text-neutral-800'
            }`}
          >
            <option value="1er Trimestre" className={isDarkMode ? 'bg-slate-900 text-white' : ''}>1er Trimestre</option>
            <option value="2do Trimestre" className={isDarkMode ? 'bg-slate-900 text-white' : ''}>2do Trimestre</option>
            <option value="3er Trimestre" className={isDarkMode ? 'bg-slate-900 text-white' : ''}>3er Trimestre</option>
          </select>
        </div>
      </div>

      {/* Spreadsheet Matrix Table */}
      <div
        className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
        }`}
      >
        <div
          className={`p-3 border-b flex items-center justify-between gap-3 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-neutral-50/80 border-neutral-200'
          }`}
        >
          <div className="relative flex items-center">
            <Search className={`absolute left-3 w-3.5 h-3.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-400'}`} />
            <input
              type="text"
              placeholder="Filtrar estudiante..."
              value={searchStudent}
              onChange={(e) => setSearchStudent(e.target.value)}
              className={`pl-8 pr-3 py-1.5 text-xs rounded-lg focus:outline-none w-56 border transition-colors ${
                isDarkMode
                  ? 'bg-slate-800 text-white placeholder-slate-500 border-slate-750 focus:border-emerald-500'
                  : 'bg-white text-neutral-900 border-neutral-200 focus:ring-1 focus:ring-emerald-500'
              }`}
            />
          </div>
          <span className={`text-[11px] italic hidden sm:block ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
            Edita las calificaciones directamente en cada celda (0 a 10)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead
              className={`font-semibold uppercase text-[11px] border-b ${
                isDarkMode
                  ? 'bg-slate-800/80 text-slate-300 border-slate-750'
                  : 'bg-[#f1f3f4] text-neutral-600 border-neutral-200'
              }`}
            >
              <tr>
                <th className={`py-3 px-4 border-r w-12 text-center ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>N°</th>
                <th className={`py-3 px-4 border-r min-w-[200px] ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}>Estudiante</th>
                {evaluations.map((evalName, index) => (
                  <th
                    key={index}
                    className={`py-3 px-3 border-r text-center min-w-[130px] ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}
                    title={evalName}
                  >
                    <span className="line-clamp-1">{evalName}</span>
                  </th>
                ))}
                <th
                  className={`py-3 px-4 border-r text-center min-w-[100px] ${
                    isDarkMode
                      ? 'border-slate-800 bg-emerald-950/40 text-emerald-300'
                      : 'border-neutral-200 bg-emerald-50/50 text-emerald-800'
                  }`}
                >
                  Promedio
                </th>
                <th className="py-3 px-4 text-center min-w-[100px]">Estado</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800' : 'divide-neutral-100'}`}>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={evaluations.length + 4} className={`py-8 text-center ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>
                    No se encontraron estudiantes para este curso.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student, idx) => {
                  const scores = evaluations
                    .map((ev) => gradeMatrix[`${student.id}_${ev}`])
                    .filter((s) => typeof s === 'number');
                  const avg = scores.length > 0
                    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
                    : '-';
                  const isPassing = avg !== '-' && parseFloat(avg) >= 6;

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-neutral-50'}`}
                    >
                      <td className={`py-2.5 px-3 border-r text-center font-mono ${isDarkMode ? 'border-slate-800 text-slate-500' : 'border-neutral-200 text-neutral-400'}`}>
                        {idx + 1}
                      </td>
                      <td className={`py-2.5 px-4 border-r font-medium ${isDarkMode ? 'border-slate-800 text-slate-100' : 'border-neutral-200 text-neutral-800'}`}>
                        {student.lastName}, {student.firstName}
                      </td>

                      {evaluations.map((evalName, i) => {
                        const cellKey = `${student.id}_${evalName}`;
                        const val = gradeMatrix[cellKey];
                        return (
                          <td
                            key={i}
                            className={`py-1 px-1.5 border-r text-center ${isDarkMode ? 'border-slate-800' : 'border-neutral-200'}`}
                          >
                            <input
                              type="number"
                              min="0"
                              max="10"
                              step="0.5"
                              value={val !== undefined ? val : ''}
                              onChange={(e) => handleScoreChange(student.id, evalName, e.target.value)}
                              onBlur={(e) => {
                                const score = parseFloat(e.target.value);
                                if (!isNaN(score)) {
                                  handleSaveGrade(student.id, evalName, score);
                                }
                              }}
                              placeholder="-"
                              className={`w-full text-center py-1.5 rounded font-semibold text-xs border border-transparent transition-colors ${
                                isDarkMode
                                  ? 'text-slate-100 bg-transparent hover:bg-slate-800 focus:bg-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                                  : 'text-neutral-800 bg-transparent hover:bg-blue-50/50 focus:bg-white focus:border-emerald-300 focus:ring-1 focus:ring-emerald-500'
                              }`}
                            />
                          </td>
                        );
                      })}

                      <td
                        className={`py-2.5 px-3 border-r text-center font-bold ${
                          isDarkMode
                            ? 'border-slate-800 bg-emerald-950/40 text-emerald-300'
                            : 'border-neutral-200 bg-emerald-50/30 text-emerald-800'
                        }`}
                      >
                        {avg}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        {avg === '-' ? (
                          <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-neutral-400'}`}>Sin notas</span>
                        ) : isPassing ? (
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${
                              isDarkMode
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            Aprobado
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${
                              isDarkMode
                                ? 'bg-red-950/60 text-red-300 border-red-800/60'
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}
                          >
                            En Proceso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal to add an evaluation column */}
      {showAddEvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div
            className={`rounded-2xl p-6 max-w-md w-full shadow-2xl border space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-750 text-slate-200' : 'bg-white border-neutral-200'
            }`}
          >
            <h3 className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
              Añadir Columna de Evaluación
            </h3>
            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
              Ingresa el nombre del examen, trabajo práctico o instrumento evaluativo que se reflejará en la planilla de Google Sheets.
            </p>
            <div>
              <label className={`block text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-neutral-700'}`}>
                Nombre de la Evaluación
              </label>
              <input
                type="text"
                value={newEvalName}
                onChange={(e) => setNewEvalName(e.target.value)}
                placeholder="Ej: Parcial N°2 Genética, TP Integrador..."
                className={`w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-800'
                }`}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddEvalModal(false)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  isDarkMode
                    ? 'text-slate-300 hover:bg-slate-800'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddEvaluation}
                disabled={!newEvalName.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs disabled:opacity-60"
              >
                Crear Columna
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
