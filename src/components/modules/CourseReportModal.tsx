import React, { useState, useMemo } from 'react';
import {
  Printer,
  Download,
  Cloud,
  ExternalLink,
  X,
  CheckCircle2,
  FileText,
  Users,
  Award,
  AlertTriangle,
  School,
  Calendar,
  Check,
  Folder,
  Loader2,
  UserCheck,
  SlidersHorizontal,
  CheckSquare,
  Square,
  PenLine,
  Sparkles,
  MessageSquare,
  HeartHandshake,
  Eye,
  EyeOff,
  Save,
} from 'lucide-react';
import { Student, StudentObservation } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { DEFAULT_CATEGORIES } from './GradebookMatrix';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { driveService } from '../../services/workspace/driveService';
import {
  getCourseAttendanceSettings,
  computeStudentAttendanceTrafficLight,
} from '../../utils/attendanceCalculations';

export interface ExamGradeDetailItem {
  id: string;
  categoryName: string;
  itemName: string;
  score: string;
}

export interface CourseReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  students: Student[];
  isDarkMode: boolean;
  score1cMap: Record<string, { scoreStr: string; num: number | null }>;
  score2cMap: Record<string, { scoreStr: string; num: number | null }>;
  annualOverrides: Record<string, string>;
  driveFolderId?: string;
  driveFolderUrl?: string;
  initialTab?: 'course' | 'individual';
  initialStudentId?: string;
  initialPreset?: 'all' | 'attendance' | 'grades' | 'disposition';
}

export const CourseReportModal: React.FC<CourseReportModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  students,
  isDarkMode,
  score1cMap,
  score2cMap,
  annualOverrides,
  driveFolderId,
  driveFolderUrl,
  initialTab = 'course',
  initialStudentId,
  initialPreset = 'all',
}) => {
  const { user } = useWorkspaceAuth();
  const [activeTab, setActiveTab] = useState<'course' | 'individual'>(initialTab);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId || 'all');
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [showDriveConfirmModal, setShowDriveConfirmModal] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [driveSavedResult, setDriveSavedResult] = useState<{
    success: boolean;
    name: string;
    url: string;
    isLiveGoogle: boolean;
    folderName: string;
  } | null>(null);
  const [courseObservation, setCourseObservation] = useState<string>(() => {
    try {
      return localStorage.getItem(`fds_report_course_observation_${courseId}`) || '';
    } catch {
      return '';
    }
  });

  const handleUpdateCourseObservation = (text: string) => {
    setCourseObservation(text);
    try {
      localStorage.setItem(`fds_report_course_observation_${courseId}`, text);
    } catch (err) {
      console.error('Error saving course report observation:', err);
    }
  };

  // Customization of report elements (Docente puede elegir qué poner clickeando las opciones)
  const [includeGrades, setIncludeGrades] = useState<boolean>(
    initialPreset === 'attendance' || initialPreset === 'disposition' ? false : true
  );
  const [includeExamDetails, setIncludeExamDetails] = useState<boolean>(
    initialPreset === 'attendance' || initialPreset === 'disposition' ? false : true
  );
  const [includeAttendance, setIncludeAttendance] = useState<boolean>(
    initialPreset === 'grades' || initialPreset === 'disposition' ? false : true
  );
  const [includeDisposition, setIncludeDisposition] = useState<boolean>(
    initialPreset === 'grades' || initialPreset === 'attendance' ? false : true
  );
  const [includeObservations, setIncludeObservations] = useState<boolean>(true);
  const [includeFamilySignature, setIncludeFamilySignature] = useState<boolean>(
    initialPreset !== 'all'
  );
  const effectiveReason = 'Informe de Trayectoria';

  const selectedElementsCount =
    (includeGrades ? 1 : 0) +
    (includeAttendance ? 1 : 0) +
    (includeDisposition ? 1 : 0) +
    (includeObservations ? 1 : 0);

  // Load attendance, disposition and observations maps
  const disp1cMap = useMemo(() => {
    try {
      const raw =
        localStorage.getItem(`fds_disposition_data_${courseId}_1c`) ||
        localStorage.getItem('fds_disposition_data_1c');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId]);

  const disp2cMap = useMemo(() => {
    try {
      const raw =
        localStorage.getItem(`fds_disposition_data_${courseId}_2c`) ||
        localStorage.getItem('fds_disposition_data_2c');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId]);

  // Load Categories and Grades Maps from Pestaña Calificaciones (1°C and 2°C)
  const categories1c = useMemo<GradeCategory[]>(() => {
    try {
      const raw =
        localStorage.getItem(`fds_grades_categories_${courseId}_1c`) ||
        localStorage.getItem(`fds_grades_categories_${courseId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_CATEGORIES;
  }, [courseId]);

  const categories2c = useMemo<GradeCategory[]>(() => {
    try {
      const raw = localStorage.getItem(`fds_grades_categories_${courseId}_2c`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_CATEGORIES.map((cat) => ({
      ...cat,
      id: `c2-${cat.id}`,
      subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
    }));
  }, [courseId]);

  const gradesData1c = useMemo<StudentGradesMap>(() => {
    try {
      const raw =
        localStorage.getItem(`fds_grades_data_${courseId}_1c`) ||
        localStorage.getItem(`fds_grades_data_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId]);

  const gradesData2c = useMemo<StudentGradesMap>(() => {
    try {
      const raw = localStorage.getItem(`fds_grades_data_${courseId}_2c`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId]);

  const calcMode1c = useMemo<'average_of_categories' | 'manual_final'>(() => {
    try {
      const raw =
        localStorage.getItem(`fds_grades_final_calc_${courseId}_1c`) ||
        localStorage.getItem(`fds_grades_final_calc_${courseId}`);
      if (raw === 'average_of_categories' || raw === 'manual_final') return raw;
    } catch {}
    return 'manual_final';
  }, [courseId]);

  const calcMode2c = useMemo<'average_of_categories' | 'manual_final'>(() => {
    try {
      const raw = localStorage.getItem(`fds_grades_final_calc_${courseId}_2c`);
      if (raw === 'average_of_categories' || raw === 'manual_final') return raw;
    } catch {}
    return 'manual_final';
  }, [courseId]);

  // Load Student Profile observations from Ficha del Alumno as default fallback
  const profileObservationsMap = useMemo<Record<string, StudentObservation[]>>(() => {
    try {
      const merged: Record<string, StudentObservation[]> = {};
      const keysToCheck = [
        'fds_student_observations',
        `fds_student_observations_${courseId}`,
        'student_observations',
      ];
      for (const key of keysToCheck) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed);
          }
        }
      }
      return merged;
    } catch {
      return {};
    }
  }, [courseId]);

  // Dedicated observations for reports / certificates
  const [reportObservations, setReportObservations] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(`fds_report_student_observations_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const handleUpdateStudentReportObservation = (studentId: string, text: string) => {
    setReportObservations((prev) => {
      const updated = { ...prev, [studentId]: text };
      try {
        localStorage.setItem(`fds_report_student_observations_${courseId}`, JSON.stringify(updated));
      } catch (err) {
        console.error('Error saving report observation:', err);
      }
      return updated;
    });
  };

  const parseScoreNumber = (val: unknown): number | null => {
    if (val === undefined || val === null) return null;
    const str = String(val).trim().replace(',', '.');
    if (str === '') return null;
    const num = Number(str);
    return !isNaN(num) ? num : null;
  };

  // Helper to compute term final score from GradebookMatrix data
  const computeTermScoreForStudent = (
    stId: string,
    cats: GradeCategory[],
    gradesMap: StudentGradesMap,
    calcMode: 'average_of_categories' | 'manual_final'
  ): { scoreStr: string; num: number | null } => {
    const stGrades = gradesMap[stId] || {};
    if (calcMode === 'manual_final' && stGrades['__final__'] !== undefined && stGrades['__final__'] !== '') {
      const val = String(stGrades['__final__']).trim();
      const num = parseScoreNumber(val);
      return { scoreStr: val, num };
    }

    const numericScores: number[] = [];
    cats.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        const num = parseScoreNumber(stGrades[cat.id]);
        if (num !== null) {
          numericScores.push(num);
        }
      } else {
        cat.subcategories.forEach((sub) => {
          const num = parseScoreNumber(stGrades[sub.id]);
          if (num !== null) {
            numericScores.push(num);
          }
        });
      }
    });

    if (numericScores.length > 0) {
      const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
      const str = avg.toFixed(1).replace('.0', '');
      return { scoreStr: str, num: avg };
    }

    // Fallback if manual __final__ exists even when mode was average
    if (stGrades['__final__'] !== undefined && stGrades['__final__'] !== '') {
      const val = String(stGrades['__final__']).trim();
      const num = parseScoreNumber(val);
      return { scoreStr: val, num };
    }

    return { scoreStr: '', num: null };
  };

  // Helper to extract all individual Exam / TP items for a student in a term
  const extractStudentExamDetails = (
    stId: string,
    cats: GradeCategory[],
    gradesMap: StudentGradesMap
  ): ExamGradeDetailItem[] => {
    const stGrades = gradesMap[stId] || {};
    const items: ExamGradeDetailItem[] = [];
    cats.forEach((cat) => {
      if (cat.subcategories.length === 0) {
        const rawScore = stGrades[cat.id];
        items.push({
          id: cat.id,
          categoryName: cat.name,
          itemName: cat.name,
          score: rawScore !== undefined && String(rawScore).trim() !== '' ? String(rawScore).trim() : '—',
        });
      } else {
        cat.subcategories.forEach((sub) => {
          const rawScore = stGrades[sub.id];
          items.push({
            id: sub.id,
            categoryName: cat.name,
            itemName: sub.name,
            score: rawScore !== undefined && String(rawScore).trim() !== '' ? String(rawScore).trim() : '—',
          });
        });
      }
    });
    return items;
  };

  // Fallback loading of grades and annual overrides if opened outside of GradebookMatrix
  const effectiveScore1cMap = useMemo(() => {
    if (score1cMap && Object.keys(score1cMap).length > 0) return score1cMap;
    const result: Record<string, { scoreStr: string; num: number | null }> = {};
    students.forEach((st) => {
      const calc = computeTermScoreForStudent(st.id, categories1c, gradesData1c, calcMode1c);
      if (calc.scoreStr !== '') {
        result[st.id] = calc;
      }
    });
    return result;
  }, [score1cMap, students, categories1c, gradesData1c, calcMode1c]);

  const effectiveScore2cMap = useMemo(() => {
    if (score2cMap && Object.keys(score2cMap).length > 0) return score2cMap;
    const result: Record<string, { scoreStr: string; num: number | null }> = {};
    students.forEach((st) => {
      const calc = computeTermScoreForStudent(st.id, categories2c, gradesData2c, calcMode2c);
      if (calc.scoreStr !== '') {
        result[st.id] = calc;
      }
    });
    return result;
  }, [score2cMap, students, categories2c, gradesData2c, calcMode2c]);

  const effectiveOverrides = useMemo(() => {
    if (annualOverrides && Object.keys(annualOverrides).length > 0) return annualOverrides;
    try {
      const raw = localStorage.getItem(`fds_grades_annual_override_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [annualOverrides, courseId]);

  const courseAttendanceSettings = useMemo(
    () => getCourseAttendanceSettings(courseId),
    [courseId]
  );

  // Consolidate full student annual data + detailed exam/TP grades
  const consolidatedStudents = useMemo(() => {
    return students.map((st) => {
      const s1 = effectiveScore1cMap[st.id] || { scoreStr: '', num: null };
      const s2 = effectiveScore2cMap[st.id] || { scoreStr: '', num: null };
      const override = effectiveOverrides[st.id];

      const examDetails1c = extractStudentExamDetails(st.id, categories1c, gradesData1c);
      const examDetails2c = extractStudentExamDetails(st.id, categories2c, gradesData2c);

      let calcAvgStr = '';
      let calcAvgNum: number | null = null;

      if (s1.num !== null && s2.num !== null) {
        calcAvgNum = (s1.num + s2.num) / 2;
        calcAvgStr = calcAvgNum.toFixed(1).replace('.0', '');
      } else if (s1.num !== null) {
        calcAvgNum = s1.num;
        calcAvgStr = s1.scoreStr;
      } else if (s2.num !== null) {
        calcAvgNum = s2.num;
        calcAvgStr = s2.scoreStr;
      }

      const finalVal = override !== undefined && override !== '' ? override : calcAvgStr;
      const finalNum = parseScoreNumber(finalVal);

      let condition = 'Pendiente';
      if (finalNum !== null) {
        if (finalNum >= 7) condition = 'Aprobado';
        else if (finalNum >= 6) condition = 'Aprobado (Regular)';
        else condition = 'Compensación Diciembre / Feb';
      }

      // Attendance & disposition
      const abs1 = disp1cMap[st.id]?.totalAbsences ?? 0;
      const abs2 = disp2cMap[st.id]?.totalAbsences ?? 0;
      const totalAbs = abs1 + abs2;

      const lat1 = disp1cMap[st.id]?.totalLates ?? 0;
      const lat2 = disp2cMap[st.id]?.totalLates ?? 0;
      const totalLat = lat1 + lat2;

      const disp1 = disp1cMap[st.id]?.totalDisposition ?? 10;
      const disp2 = disp2cMap[st.id]?.totalDisposition ?? 10;
      const avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));

      const trafficLight = computeStudentAttendanceTrafficLight(
        st.id,
        totalAbs,
        totalLat,
        'annual',
        courseAttendanceSettings
      );
      const estimatedAttendance = trafficLight.percentage;

      // Dedicated observation for official report / certificate (falls back to Student Profile observations if not customized yet)
      const customReportObs = reportObservations[st.id];
      const profileObsList = profileObservationsMap[st.id] || [];
      const fallbackProfileObsText =
        profileObsList.length > 0
          ? profileObsList
              .map((o) => `• [${o.date}] ${o.text || ''}${o.reportUrl ? ` (${o.reportUrl})` : ''}`)
              .join('\n')
          : '';
      const observation = customReportObs !== undefined ? customReportObs : fallbackProfileObsText;

      return {
        student: st,
        score1c: s1.scoreStr,
        score1cNum: s1.num,
        score2c: s2.scoreStr,
        score2cNum: s2.num,
        examDetails1c,
        examDetails2c,
        calcAvgStr,
        calcAvgNum,
        finalVal,
        finalNum,
        condition,
        abs1,
        abs2,
        totalAbs,
        lat1,
        lat2,
        totalLat,
        disp1,
        disp2,
        avgDisp,
        estimatedAttendance,
        observation,
      };
    });
  }, [
    students,
    effectiveScore1cMap,
    effectiveScore2cMap,
    effectiveOverrides,
    categories1c,
    categories2c,
    gradesData1c,
    gradesData2c,
    disp1cMap,
    disp2cMap,
    courseAttendanceSettings,
    reportObservations,
    profileObservationsMap,
  ]);

  // Overall Statistics
  const stats = useMemo(() => {
    const total = consolidatedStudents.length;
    const withFinal = consolidatedStudents.filter((s) => s.finalNum !== null);
    const approved = consolidatedStudents.filter((s) => s.finalNum !== null && s.finalNum >= 6);
    const inComp = consolidatedStudents.filter((s) => s.finalNum !== null && s.finalNum < 6);

    const avgScore =
      withFinal.length > 0
        ? (withFinal.reduce((acc, s) => acc + (s.finalNum || 0), 0) / withFinal.length).toFixed(1)
        : '—';

    const avgAttendance =
      total > 0
        ? Math.round(
            consolidatedStudents.reduce((acc, s) => acc + s.estimatedAttendance, 0) / total
          )
        : 100;

    const totalCourseAbsences = consolidatedStudents.reduce((acc, s) => acc + s.totalAbs, 0);

    return {
      total,
      approvedCount: approved.length,
      approvedPercent: total > 0 ? Math.round((approved.length / total) * 100) : 0,
      compCount: inComp.length,
      avgScore,
      avgAttendance,
      totalCourseAbsences,
    };
  }, [consolidatedStudents]);

  if (!isOpen) return null;

  const teacherName = user?.name || 'Profesor a cargo';
  const schoolName = user?.school || 'FDS - Educación Secundaria';
  const currentDate = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Students to show in individual mode
  const displayedStudents =
    selectedStudentId === 'all'
      ? consolidatedStudents
      : consolidatedStudents.filter((s) => s.student.id === selectedStudentId);


  // Generate self-contained standalone HTML document for download or Drive upload
  const generateHtmlDocument = (type: 'course' | 'individual') => {
    const isCourse = type === 'course';
    const title = `Informe — ${courseName}`;

    let bodyContent = '';

    if (isCourse) {
      // Build course KPIs conditionally
      let kpiBoxes = '';
      if (includeGrades) {
        kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">Aprobados</div>
            <div class="stat-val text-green">${stats.approvedCount} (${stats.approvedPercent}%)</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">En Compensación</div>
            <div class="stat-val text-red">${stats.compCount}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Promedio General</div>
            <div class="stat-val text-purple">${stats.avgScore}</div>
          </div>
        `;
      }
      if (includeAttendance) {
        kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">Asistencia Promedio</div>
            <div class="stat-val">${stats.avgAttendance}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Total Inasistencias</div>
            <div class="stat-val text-red">${stats.totalCourseAbsences}</div>
          </div>
        `;
      }
      if (includeDisposition) {
        const avgDispTotal =
          consolidatedStudents.length > 0
            ? (
                consolidatedStudents.reduce((acc, s) => acc + s.avgDisp, 0) /
                consolidatedStudents.length
              ).toFixed(1)
            : '10';
        kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">Disposición Promedio</div>
            <div class="stat-val text-purple">${avgDispTotal} / 10</div>
          </div>
        `;
      }

      bodyContent = `
        <div class="report-page">
          <div class="header">
            <div class="school-brand">
              <h2>${schoolName}</h2>
              <p class="subtitle">${effectiveReason.toUpperCase()} — CICLO LECTIVO 2026</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${courseName}</div>
              <div><strong>Docente:</strong> ${teacherName}</div>
              <div><strong>Fecha de emisión:</strong> ${currentDate}</div>
              <div><strong>Matrícula Total:</strong> ${stats.total} estudiantes</div>
            </div>
          </div>

          ${kpiBoxes ? `<div class="stats-row">${kpiBoxes}</div>` : ''}

          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 30px;">#</th>
                <th>Estudiante</th>
                ${
                  includeGrades
                    ? `
                  <th style="text-align: center;">1° Cuatr.</th>
                  <th style="text-align: center;">2° Cuatr.</th>
                  <th style="text-align: center;">Promedio</th>
                  <th style="text-align: center;">Nota Definitiva</th>
                `
                    : ''
                }
                ${
                  includeAttendance
                    ? `
                  <th style="text-align: center;">Faltas 1°C</th>
                  <th style="text-align: center;">Faltas 2°C</th>
                  <th style="text-align: center;">Faltas Anuales</th>
                `
                    : ''
                }
                ${includeDisposition ? `<th style="text-align: center;">Disposición</th>` : ''}
                ${includeGrades ? `<th style="text-align: center;">Condición Final</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${consolidatedStudents
                .map(
                  (row, idx) => `
                <tr>
                  <td style="text-align: center; color: #666;">${idx + 1}</td>
                  <td><strong>${row.student.lastName}, ${row.student.firstName}</strong></td>
                  ${
                    includeGrades
                      ? `
                    <td style="text-align: center;">${row.score1c || '—'}</td>
                    <td style="text-align: center;">${row.score2c || '—'}</td>
                    <td style="text-align: center; font-weight: bold;">${row.calcAvgStr || '—'}</td>
                    <td style="text-align: center; font-weight: bold; font-size: 13px; color: #1e3a8a;">${row.finalVal || '—'}</td>
                  `
                      : ''
                  }
                  ${
                    includeAttendance
                      ? `
                    <td style="text-align: center;">${row.abs1}</td>
                    <td style="text-align: center;">${row.abs2}</td>
                    <td style="text-align: center; font-weight: bold;">${row.totalAbs}</td>
                  `
                      : ''
                  }
                  ${includeDisposition ? `<td style="text-align: center;">${row.avgDisp}/10</td>` : ''}
                  ${
                    includeGrades
                      ? `
                    <td style="text-align: center;">
                      <span class="badge ${
                        row.condition.includes('Aprobado') ? 'badge-approved' : 'badge-comp'
                      }">
                        ${row.condition}
                      </span>
                    </td>
                  `
                      : ''
                  }
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>

          ${
            includeObservations
              ? `
            <div class="observations-box">
              <h4>Observaciones Pedagógicas y Síntesis del Curso:</h4>
              <p>${courseObservation}</p>
            </div>
          `
              : ''
          }

          <div style="margin-top: 36px; padding-top: 14px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div><strong>Documento Oficial Institucional</strong> — Ciclo Lectivo 2026</div>
            <div>Docente responsable: <strong>${teacherName}</strong> — ${schoolName}</div>
          </div>
        </div>
      `;
    } else {
      // Individual student reports (1 page per student)
      bodyContent = displayedStudents
        .map(
          (row) => `
        <div class="student-page">
          <div class="header">
            <div class="school-brand">
              <h2>${schoolName}</h2>
              <p class="subtitle">${effectiveReason.toUpperCase()} — CICLO 2026</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${courseName}</div>
              <div><strong>Docente:</strong> ${teacherName}</div>
              <div><strong>Fecha:</strong> ${currentDate}</div>
            </div>
          </div>

          <div class="student-card-info">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 16px; font-weight: bold; color: #1e293b;">
                  Estudiante: ${row.student.lastName}, ${row.student.firstName}
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                  Email institucional: ${row.student.email || '—'}
                </div>
              </div>
              ${
                includeGrades
                  ? `
                <div style="text-align: right;">
                  <span class="badge ${
                    row.condition.includes('Aprobado') ? 'badge-approved' : 'badge-comp'
                  }" style="font-size: 12px; padding: 4px 10px;">
                    ${row.condition}
                  </span>
                </div>
              `
                  : ''
              }
            </div>
          </div>

          ${
            includeGrades
              ? `
            <div class="section-title">1. Rendimiento Académico y Calificaciones</div>
            <table class="data-table" style="margin-bottom: 12px;">
              <thead>
                <tr>
                  <th style="text-align: center;">1° Cuatrimestre</th>
                  <th style="text-align: center;">2° Cuatrimestre</th>
                  <th style="text-align: center;">Promedio Ponderado</th>
                  <th style="text-align: center; background: #e0e7ff;">Calificación Final Definitiva</th>
                  <th style="text-align: center;">Condición de Acreditación</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${row.score1c || '—'}</td>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${row.score2c || '—'}</td>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${row.calcAvgStr || '—'}</td>
                  <td style="text-align: center; font-size: 18px; font-weight: bold; color: #1e40af; background: #eef2ff;">
                    ${row.finalVal || '—'}
                  </td>
                  <td style="text-align: center;">
                    <span class="badge ${row.condition.includes('Aprobado') ? 'badge-approved' : 'badge-comp'}" style="font-size: 12px; padding: 4px 10px;">
                      ${row.condition}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            ${
              includeExamDetails && (row.examDetails1c.length > 0 || row.examDetails2c.length > 0)
                ? `
              <div style="font-size: 11.5px; font-weight: bold; color: #334155; margin: 8px 0 6px 0;">
                Detalle de Evaluaciones, Exámenes y Trabajos Prácticos:
              </div>
              <table class="data-table" style="margin-bottom: 16px;">
                <thead>
                  <tr>
                    <th style="width: 22%;">Período</th>
                    <th style="width: 28%;">Categoría</th>
                    <th style="width: 32%;">Examen / Trabajo Práctico</th>
                    <th style="width: 18%; text-align: center;">Calificación</th>
                  </tr>
                </thead>
                <tbody>
                  ${row.examDetails1c
                    .map(
                      (item) => `
                    <tr>
                      <td><strong>1° Cuatrimestre</strong></td>
                      <td>${item.categoryName}</td>
                      <td>${item.itemName}</td>
                      <td style="text-align: center; font-weight: bold; color: #1e3a8a;">${item.score}</td>
                    </tr>
                  `
                    )
                    .join('')}
                  ${row.examDetails2c
                    .map(
                      (item) => `
                    <tr>
                      <td><strong>2° Cuatrimestre</strong></td>
                      <td>${item.categoryName}</td>
                      <td>${item.itemName}</td>
                      <td style="text-align: center; font-weight: bold; color: #4338ca;">${item.score}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            `
                : ''
            }
          `
              : ''
          }

          ${
            includeAttendance && includeDisposition
              ? `
            <div class="section-title">${includeGrades ? '2' : '1'}. Asistencia, Puntualidad y Convivencia Escolar</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">Faltas 1° Cuatr.</th>
                  <th style="text-align: center;">Faltas 2° Cuatr.</th>
                  <th style="text-align: center;">Total Inasistencias</th>
                  <th style="text-align: center;">Tardanzas</th>
                  <th style="text-align: center;">% Asistencia Estimada</th>
                  <th style="text-align: center;">Nota de Disposición y Trabajo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${row.abs1}</td>
                  <td style="text-align: center;">${row.abs2}</td>
                  <td style="text-align: center; font-weight: bold;">${row.totalAbs}</td>
                  <td style="text-align: center;">${row.totalLat}</td>
                  <td style="text-align: center; font-weight: bold; color: ${row.estimatedAttendance < 75 ? '#b91c1c' : '#15803d'};">
                    ${row.estimatedAttendance}%
                  </td>
                  <td style="text-align: center; font-weight: bold; color: #7c3aed;">
                    ${row.avgDisp} / 10
                  </td>
                </tr>
              </tbody>
            </table>
          `
              : includeAttendance && !includeDisposition
              ? `
            <div class="section-title">${includeGrades ? '2' : '1'}. Registro de Asistencia y Puntualidad Escolar</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">Faltas 1° Cuatrimestre</th>
                  <th style="text-align: center;">Faltas 2° Cuatrimestre</th>
                  <th style="text-align: center; background: #fee2e2;">Total Inasistencias Acumuladas</th>
                  <th style="text-align: center;">Tardanzas Registradas</th>
                  <th style="text-align: center;">% Asistencia Presencial</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${row.abs1}</td>
                  <td style="text-align: center;">${row.abs2}</td>
                  <td style="text-align: center; font-weight: bold; font-size: 15px; color: #b91c1c; background: #fff1f2;">
                    ${row.totalAbs} inasistencias
                  </td>
                  <td style="text-align: center;">${row.totalLat}</td>
                  <td style="text-align: center; font-weight: bold; color: ${row.estimatedAttendance < 75 ? '#b91c1c' : '#15803d'};">
                    ${row.estimatedAttendance}%
                  </td>
                </tr>
              </tbody>
            </table>
          `
              : !includeAttendance && includeDisposition
              ? `
            <div class="section-title">${includeGrades ? '2' : '1'}. Disposición para el Trabajo y Convivencia Áulica</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">Disposición 1° Cuatrimestre</th>
                  <th style="text-align: center;">Disposición 2° Cuatrimestre</th>
                  <th style="text-align: center; background: #ede9fe;">Puntaje Promedio de Disposición</th>
                  <th style="text-align: center;">Valoración de Compromiso y Tareas</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${row.disp1} / 10</td>
                  <td style="text-align: center;">${row.disp2} / 10</td>
                  <td style="text-align: center; font-weight: bold; font-size: 16px; color: #6d28d9; background: #f5f3ff;">
                    ${row.avgDisp} / 10
                  </td>
                  <td style="text-align: center; font-weight: 600; color: ${row.avgDisp >= 8 ? '#15803d' : row.avgDisp >= 6 ? '#d97706' : '#b91c1c'};">
                    ${row.avgDisp >= 8 ? 'Favorable y participativo' : row.avgDisp >= 6 ? 'Regular / Ajustar entrega de tareas' : 'Requiere mayor compromiso en clase'}
                  </td>
                </tr>
              </tbody>
            </table>
          `
              : ''
          }

          ${
            includeObservations
              ? `
            <div class="observations-box" style="margin-top: 14px;">
              <h4>${includeGrades && (includeAttendance || includeDisposition) ? '3' : includeGrades || includeAttendance || includeDisposition ? '2' : '1'}. Observaciones Pedagógicas y Síntesis:</h4>
              <p style="white-space: pre-wrap;">${row.observation || '—'}</p>
            </div>
          `
              : ''
          }

          ${
            includeFamilySignature
              ? `
            <div style="margin-top: 30px; padding: 14px; border: 1px dashed #94a3b8; border-radius: 8px; background: #f8fafc;">
              <div style="font-size: 11px; font-weight: bold; color: #1e3a8a; margin-bottom: 12px; text-transform: uppercase;">
                Acta de Notificación Institucional y Firma de Conformidad
              </div>
              <div style="display: flex; justify-content: space-between; gap: 30px; font-size: 11px;">
                <div style="flex: 1; padding-top: 28px; border-top: 1px solid #475569; text-align: center;">
                  <div><strong>Firma del Docente</strong></div>
                  <div style="color: #64748b; margin-top: 2px;">${teacherName} — ${schoolName}</div>
                </div>
                <div style="flex: 1; padding-top: 28px; border-top: 1px solid #475569; text-align: center;">
                  <div><strong>Firma del Adulto Responsable / Tutor</strong></div>
                  <div style="color: #64748b; margin-top: 2px;">Aclaración: _____________________ DNI: _______________</div>
                </div>
              </div>
            </div>
          `
              : ''
          }

          <div style="margin-top: 36px; padding-top: 14px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div><strong>Constancia Oficial de Trayectoria</strong> — ${courseName}</div>
            <div>Docente a cargo: <strong>${teacherName}</strong> — Ciclo Lectivo 2026</div>
          </div>
        </div>
      `
        )
        .join('');
    }

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 14mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      margin: 0;
      padding: 20px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
      .student-page {
        page-break-after: always;
        break-after: page;
        min-height: 98vh;
        box-sizing: border-box;
      }
    }
    .report-page, .student-page {
      background: white;
      max-width: 900px;
      margin: 0 auto 30px auto;
      padding: 30px 40px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      border-radius: 8px;
      box-sizing: border-box;
    }
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .school-brand h2 {
      margin: 0;
      font-size: 20px;
      color: #1e3a8a;
      letter-spacing: -0.5px;
    }
    .school-brand .subtitle {
      margin: 4px 0 0 0;
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .meta-box {
      font-size: 12px;
      color: #334155;
      line-height: 1.5;
      text-align: right;
    }
    .student-card-info {
      background: #f1f5f9;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 18px;
      border-left: 4px solid #2563eb;
    }
    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #1e293b;
      margin: 14px 0 6px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
      text-align: center;
    }
    .stat-label {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
    }
    .stat-val {
      font-size: 18px;
      font-weight: bold;
      margin-top: 2px;
    }
    .text-green { color: #16a34a; }
    .text-red { color: #dc2626; }
    .text-purple { color: #7c3aed; }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      margin-bottom: 14px;
    }
    .data-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 600;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      text-align: left;
    }
    .data-table td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      color: #334155;
    }
    .data-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10.5px;
      font-weight: 600;
    }
    .badge-approved {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #86efac;
    }
    .badge-comp {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fca5a5;
    }
    .observations-box {
      background: #fffbeb;
      border: 1px solid #fef3c7;
      border-left: 4px solid #f59e0b;
      border-radius: 6px;
      padding: 12px 14px;
      margin-top: 16px;
    }
    .observations-box h4 {
      margin: 0 0 4px 0;
      font-size: 12px;
      color: #92400e;
    }
    .observations-box p {
      margin: 0;
      font-size: 12px;
      color: #78350f;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .signatures-row {
      display: flex;
      justify-content: space-around;
      margin-top: 40px;
      padding-top: 10px;
    }
    .signature-line {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      width: 250px;
    }
    .signature-line .line {
      border-top: 1px solid #94a3b8;
      margin-bottom: 6px;
    }
    .sig-name {
      font-size: 10px;
      color: #475569;
      margin-top: 3px;
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  };

  // Robust Print Handler using native browser print and download fallback
  const handlePrint = () => {
    setIsPrinting(true);
    setTimeout(() => {
      try {
        window.print();
      } catch (err) {
        console.warn('Native window.print failed, falling back to download:', err);
        handleDownloadHtml();
      } finally {
        setIsPrinting(false);
      }
    }, 100);
  };

  // Download locally (.html printable file)
  const handleDownloadHtml = () => {
    const html = generateHtmlDocument(activeTab);
    const singleStudent =
      activeTab === 'individual' && selectedStudentId !== 'all'
        ? consolidatedStudents.find((s) => s.student.id === selectedStudentId)
        : null;
    const fileName =
      activeTab === 'course'
        ? `Informe_Consolidado_${courseName.replace(/\s+/g, '_')}_2026.html`
        : singleStudent
        ? `Ficha_Trayectoria_${singleStudent.student.lastName}_${singleStudent.student.firstName}_${courseName.replace(/\s+/g, '_')}.html`
        : `Boletines_Individuales_${courseName.replace(/\s+/g, '_')}_2026.html`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Compute the target Google Doc title
  const getTargetGoogleDocTitle = () => {
    if (activeTab === 'course') {
      return `📊 Informe Consolidado Anual - ${courseName}`;
    }
    if (selectedStudentId !== 'all') {
      const single = consolidatedStudents.find((s) => s.student.id === selectedStudentId);
      if (single) {
        return `📄 Ficha de Trayectoria - ${single.student.lastName}, ${single.student.firstName} (${courseName})`;
      }
    }
    return `🎓 Fichas Individuales de Trayectoria - ${courseName}`;
  };

  // Save directly as a native editable Google Doc (.gdoc) in the course's Google Drive folder
  const executeSaveToDrive = async () => {
    setShowDriveConfirmModal(false);
    setIsSavingToDrive(true);
    setDriveSavedResult(null);

    try {
      // 1. Resolve or prepare the folder structure for the course (including "Informes" subfolder)
      const folderStructure = await driveService.setupCourseFolderStructure(
        courseName,
        driveFolderId
      );
      const targetFolderId = folderStructure.reportsFolder?.id || folderStructure.mainFolder.id;
      const targetFolderName = folderStructure.reportsFolder
        ? `${folderStructure.mainFolder.name} / ${folderStructure.reportsFolder.name}`
        : folderStructure.mainFolder.name;

      // 2. Generate HTML report and convert to native Google Doc (.gdoc)
      const htmlContent = generateHtmlDocument(activeTab);
      const docTitle = getTargetGoogleDocTitle();

      // 3. Upload file to Google Drive folder with convertToGoogleDoc = true
      const result = await driveService.uploadReportFile(
        docTitle,
        htmlContent,
        targetFolderId,
        'text/html',
        undefined,
        true
      );

      setDriveSavedResult({
        success: true,
        name: result.name,
        url: result.url,
        isLiveGoogle: result.isLiveGoogle,
        folderName: targetFolderName,
      });
    } catch (err) {
      console.error('Error saving report as Google Doc to Google Drive:', err);
      setDriveSavedResult({
        success: false,
        name: '',
        url: '',
        isLiveGoogle: false,
        folderName: '',
      });
    } finally {
      setIsSavingToDrive(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-5xl rounded-2xl border shadow-2xl flex flex-col max-h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Top Modal Header */}
        <div
          className={`px-5 py-3.5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50/50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <School className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">
                  Informe de Trayectoria y Ficha
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  {courseName}
                </span>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  • Ciclo 2026
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowDriveConfirmModal(true)}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-70"
              title="Guardar el informe de seguimiento actual directamente en Google Drive como un archivo Google Doc (.gdoc) nativo y editable"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Save className="w-3.5 h-3.5 text-white" />
              )}
              <span>{isSavingToDrive ? 'Guardando en Drive...' : 'Guardar en Drive (.gdoc)'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Descargar copia del informe en HTML independiente para abrir e imprimir en tu navegador"
            >
              <Download className="w-3.5 h-3.5 text-blue-500" />
              <span>Descargar HTML</span>
            </button>

            <a
              href={`?course=${courseId}&view=course_detail&openReport=true&reportTab=${activeTab}${selectedStudentId !== 'all' ? `&studentId=${selectedStudentId}` : ''}${user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border-slate-700'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border-neutral-300 shadow-2xs'
              }`}
              title="Abrir este informe en una pestaña o ventana independiente"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">Abrir en otra pestaña</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switch bar & controls */}
        <div
          className={`px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850/80 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          {/* Tabs */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('course')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'course'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Informe del Curso Completo</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('individual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'individual'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Ficha por Alumno (1 Pág.)</span>
            </button>
          </div>

          {/* Student picker when in individual mode */}
          {activeTab === 'individual' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                Estudiante a visualizar:
              </label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              >
                <option value="all">Todos los alumnos (Lote de 1 página c/u)</option>
                {consolidatedStudents.map((s) => (
                  <option key={s.student.id} value={s.student.id}>
                    {s.student.lastName}, {s.student.firstName} ({s.finalVal || 'Sin nota'})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Panel de selección interactiva de elementos */}
        <div
          className={`px-5 py-3 border-b text-xs transition-colors shrink-0 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
          }`}
        >
          {/* Botones / Checkboxes interactivos con clic directo */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Calificaciones */}
            <button
              type="button"
              onClick={() => setIncludeGrades(!includeGrades)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                includeGrades
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700 shadow-2xs font-bold'
                  : isDarkMode
                  ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                  : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
              }`}
            >
              {includeGrades ? (
                <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span>Calificaciones</span>
              <span className="text-[10px] opacity-75 font-normal">(1°C, 2°C, Final)</span>
            </button>

            {/* 1b. Notas de Exámenes y TPs (solo en ficha individual cuando Calificaciones está activo) */}
            {includeGrades && activeTab === 'individual' && (
              <button
                type="button"
                onClick={() => setIncludeExamDetails(!includeExamDetails)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  includeExamDetails
                    ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 shadow-2xs font-bold'
                    : isDarkMode
                    ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                    : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
                }`}
                title="Extraer e incluir el desglose de todas las notas de Exámenes y Trabajos Prácticos de la pestaña Calificaciones"
              >
                {includeExamDetails ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                )}
                <span>Notas de Exámenes y TPs</span>
                <span className="text-[10px] opacity-75 font-normal">(Desglose completo)</span>
              </button>
            )}

            {/* 2. Asistencia */}
            <button
              type="button"
              onClick={() => setIncludeAttendance(!includeAttendance)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                includeAttendance
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs font-bold'
                  : isDarkMode
                  ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                  : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
              }`}
            >
              {includeAttendance ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span>Asistencia</span>
              <span className="text-[10px] opacity-75 font-normal">(Faltas y %)</span>
            </button>

            {/* 3. Disposición */}
            <button
              type="button"
              onClick={() => setIncludeDisposition(!includeDisposition)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                includeDisposition
                  ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700 shadow-2xs font-bold'
                  : isDarkMode
                  ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                  : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
              }`}
            >
              {includeDisposition ? (
                <CheckSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span>Disposición</span>
              <span className="text-[10px] opacity-75 font-normal">(Puntaje y actitud)</span>
            </button>

            {/* 4. Observaciones */}
            <button
              type="button"
              onClick={() => setIncludeObservations(!includeObservations)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                includeObservations
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 shadow-2xs font-bold'
                  : isDarkMode
                  ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                  : 'bg-neutral-100 text-neutral-400 border-neutral-200 opacity-70'
              }`}
            >
              {includeObservations ? (
                <CheckSquare className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span>Observaciones</span>
            </button>

            {/* 5. Talón de firma de familias */}
            <button
              type="button"
              onClick={() => setIncludeFamilySignature(!includeFamilySignature)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                includeFamilySignature
                  ? 'bg-neutral-800 text-white dark:bg-slate-700 dark:text-white border-neutral-800 dark:border-slate-600 shadow-2xs font-bold'
                  : isDarkMode
                  ? 'bg-slate-850 text-slate-500 border-slate-800 opacity-60'
                  : 'bg-neutral-100 text-neutral-500 border-neutral-200 opacity-75'
              }`}
              title="Incluye talón con línea para firma del docente y notificación/firma del padre, madre o tutor"
            >
              {includeFamilySignature ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span>Talón de Firma Familias</span>
            </button>
          </div>
        </div>

        {/* Live Drive Result Notification Banner */}
        {driveSavedResult && (
          <div
            className={`px-5 py-2.5 border-b text-xs flex items-center justify-between gap-3 animate-in fade-in ${
              driveSavedResult.success
                ? isDarkMode
                  ? 'bg-emerald-950/60 border-emerald-900 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : isDarkMode
                ? 'bg-rose-950/60 border-rose-900 text-rose-300'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>
                Google Doc editable <strong>"{driveSavedResult.name}"</strong> creado en tu Google Drive (carpeta{' '}
                <strong>"{driveSavedResult.folderName}"</strong>)
              </span>
            </div>
            {driveSavedResult.url && (
              <a
                href={driveSavedResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-bold underline hover:opacity-80 shrink-0"
              >
                <span>Abrir en Google Docs</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Document Preview & Printable Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-100 dark:bg-slate-950/70">
          <div id="printable-report" className="max-w-4xl mx-auto space-y-8">
            {activeTab === 'course' ? (
              /* ========================================================= */
              /* INFORME CONSOLIDADO DEL CURSO                             */
              /* ========================================================= */
              <div className="bg-white text-neutral-900 p-6 sm:p-8 rounded-xl border border-neutral-300 shadow-sm print:border-none print:shadow-none print:p-0">
                {/* Header */}
                <div className="border-b-2 border-blue-600 pb-4 mb-5 flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-blue-900 tracking-tight">
                      {schoolName}
                    </h1>
                    <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mt-1">
                      {effectiveReason} — Ciclo Lectivo 2026
                    </p>
                  </div>
                  <div className="text-xs text-neutral-600 sm:text-right space-y-0.5">
                    <div>
                      <strong>Materia:</strong> {courseName}
                    </div>
                    <div>
                      <strong>Docente:</strong> {teacherName}
                    </div>
                    <div>
                      <strong>Fecha de emisión:</strong> {currentDate}
                    </div>
                    <div>
                      <strong>Matrícula:</strong> {stats.total} estudiantes
                    </div>
                  </div>
                </div>

                {/* Warning if no elements are selected */}
                {selectedElementsCount === 0 && (
                  <div className="p-4 mb-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Has desmarcado todos los elementos. Marcá al menos <strong>Calificaciones</strong>, <strong>Asistencia</strong> o <strong>Disposición</strong> en la barra superior para generar el reporte.
                    </span>
                  </div>
                )}

                {/* KPI Strip (Conditional) */}
                {(includeGrades || includeAttendance || includeDisposition) && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {includeGrades && (
                      <>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                            Aprobados
                          </span>
                          <span className="text-lg font-bold text-emerald-600">
                            {stats.approvedCount}{' '}
                            <span className="text-xs font-medium text-neutral-500">
                              ({stats.approvedPercent}%)
                            </span>
                          </span>
                        </div>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                            En Compensación
                          </span>
                          <span className="text-lg font-bold text-rose-600">
                            {stats.compCount}
                          </span>
                        </div>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                            Promedio Anual Curso
                          </span>
                          <span className="text-lg font-bold text-purple-600">
                            {stats.avgScore}
                          </span>
                        </div>
                      </>
                    )}
                    {includeAttendance && (
                      <>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                            Asistencia Promedio
                          </span>
                          <span className="text-lg font-bold text-blue-600">
                            {stats.avgAttendance}%
                          </span>
                        </div>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                            Total Inasistencias
                          </span>
                          <span className="text-lg font-bold text-rose-600">
                            {stats.totalCourseAbsences}
                          </span>
                        </div>
                      </>
                    )}
                    {includeDisposition && (
                      <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                        <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                          Disposición Promedio
                        </span>
                        <span className="text-lg font-bold text-purple-600">
                          {(
                            consolidatedStudents.reduce((acc, s) => acc + s.avgDisp, 0) /
                            (consolidatedStudents.length || 1)
                          ).toFixed(1)}{' '}
                          / 10
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Table with conditional columns */}
                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-left text-xs border border-neutral-300">
                    <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                      <tr>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300 w-8">#</th>
                        <th className="py-2.5 px-3 border-r border-neutral-300">Estudiante</th>
                        {includeGrades && (
                          <>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">1° Cuatr.</th>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">2° Cuatr.</th>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">Promedio</th>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300 bg-blue-50/60 font-bold">
                              Nota Definitiva
                            </th>
                          </>
                        )}
                        {includeAttendance && (
                          <>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas 1°C</th>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas 2°C</th>
                            <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas Totales</th>
                          </>
                        )}
                        {includeDisposition && (
                          <th className="py-2.5 px-2 text-center border-r border-neutral-300">Disposición</th>
                        )}
                        {includeGrades && (
                          <th className="py-2.5 px-3 text-center">Condición Final</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {consolidatedStudents.map((row, idx) => (
                        <tr key={row.student.id} className="hover:bg-neutral-50/60">
                          <td className="py-2 px-2 text-center text-neutral-500 border-r border-neutral-200 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3 border-r border-neutral-200 font-medium text-neutral-900">
                            {row.student.lastName}, {row.student.firstName}
                          </td>
                          {includeGrades && (
                            <>
                              <td className="py-2 px-2 text-center border-r border-neutral-200">
                                {row.score1c || '—'}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-neutral-200">
                                {row.score2c || '—'}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-neutral-200 font-bold text-neutral-800">
                                {row.calcAvgStr || '—'}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-neutral-200 bg-blue-50/30 font-bold text-blue-900 text-sm">
                                {row.finalVal || '—'}
                              </td>
                            </>
                          )}
                          {includeAttendance && (
                            <>
                              <td className="py-2 px-2 text-center border-r border-neutral-200">
                                {row.abs1}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-neutral-200">
                                {row.abs2}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-neutral-200 font-semibold text-neutral-900">
                                {row.totalAbs}
                              </td>
                            </>
                          )}
                          {includeDisposition && (
                            <td className="py-2 px-2 text-center border-r border-neutral-200 font-semibold text-purple-700">
                              {row.avgDisp}/10
                            </td>
                          )}
                          {includeGrades && (
                            <td className="py-2 px-3 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  row.condition.includes('Aprobado')
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : 'bg-rose-100 text-rose-800 border-rose-300'
                                }`}
                              >
                                {row.condition}
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Course Pedagogical Observations (Conditional) */}
                {includeObservations && (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-8">
                    <h4 className="text-xs font-bold text-amber-900 mb-2">
                      Observaciones Pedagógicas y Síntesis:
                    </h4>
                    <div className="print:hidden">
                      <textarea
                        value={courseObservation}
                        onChange={(e) => handleUpdateCourseObservation(e.target.value)}
                        rows={4}
                        className="w-full text-xs bg-white border border-amber-300 rounded-md p-2.5 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed transition shadow-sm resize-y"
                        placeholder="Escribí acá las observaciones pedagógicas y síntesis del curso..."
                      />
                    </div>
                    <div className="hidden print:block">
                      <p className="text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap">
                        {courseObservation || '—'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Official Institutional Verification Footer */}
                <div className="pt-6 mt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 gap-2">
                  <p>
                    <strong className="text-neutral-700">Informe Institucional del Curso</strong> — {courseName}
                  </p>
                  <p>
                    Docente responsable: <strong className="text-neutral-700">{teacherName}</strong> — {schoolName}
                  </p>
                </div>
              </div>
            ) : (
              /* ========================================================= */
              /* BOLETINES INDIVIDUALES DE 1 PÁGINA POR ESTUDIANTE         */
              /* ========================================================= */
              <div>
                {selectedElementsCount === 0 && (
                  <div className="p-4 mb-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Has desmarcado todos los bloques. Activá al menos <strong>Calificaciones</strong>, <strong>Asistencia</strong> o <strong>Disposición</strong> en la barra superior para ver la ficha del alumno.
                    </span>
                  </div>
                )}

                {displayedStudents.map((row) => (
                  <div
                    key={row.student.id}
                    className="print-page-break bg-white text-neutral-900 p-6 sm:p-8 rounded-xl border border-neutral-300 shadow-sm print:border-none print:shadow-none print:p-0 mb-8"
                  >
                    {/* Header */}
                    <div className="border-b-2 border-blue-600 pb-3 mb-4 flex justify-between items-start">
                      <div>
                        <h2 className="text-lg font-bold text-blue-900 tracking-tight">
                          {schoolName}
                        </h2>
                        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mt-0.5">
                          {effectiveReason} — Ciclo 2026
                        </p>
                      </div>
                      <div className="text-xs text-neutral-600 text-right space-y-0.5">
                        <div>
                          <strong>Materia:</strong> {courseName}
                        </div>
                        <div>
                          <strong>Docente:</strong> {teacherName}
                        </div>
                        <div>
                          <strong>Fecha:</strong> {currentDate}
                        </div>
                      </div>
                    </div>

                    {/* Student Info Card */}
                    <div className="bg-slate-100 p-3.5 rounded-lg border-l-4 border-blue-600 mb-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-base font-bold text-neutral-900">
                            {row.student.lastName}, {row.student.firstName}
                          </h3>
                          <p className="text-xs text-neutral-500 font-mono">
                            {row.student.email || 'Estudiante Regular'}
                          </p>
                        </div>
                        {includeGrades && (
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-neutral-400 block">
                              Condición
                            </span>
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                                row.condition.includes('Aprobado')
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : 'bg-rose-100 text-rose-800 border-rose-300'
                              }`}
                            >
                              {row.condition}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 1. Academics Block (Conditional) */}
                    {includeGrades && (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                          1. Rendimiento Académico y Calificaciones
                        </h4>
                        <table className="w-full text-xs border border-neutral-300 mb-3">
                          <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                            <tr>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                1° Cuatrimestre
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                2° Cuatrimestre
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Promedio Ponderado
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300 bg-blue-100 font-bold text-blue-900">
                                Calificación Final Definitiva
                              </th>
                              <th className="py-2 px-3 text-center">Condición de Acreditación</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                                {row.score1c || '—'}
                              </td>
                              <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                                {row.score2c || '—'}
                              </td>
                              <td className="py-3 px-3 text-center border-r border-neutral-200 font-bold text-sm">
                                {row.calcAvgStr || '—'}
                              </td>
                              <td className="py-3 px-3 text-center border-r border-neutral-200 bg-blue-50 font-bold text-xl text-blue-700">
                                {row.finalVal || '—'}
                              </td>
                              <td className="py-3 px-3 text-center font-bold text-xs">
                                {row.condition}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Detailed Breakdown of Exam & TP Grades from Pestaña Calificaciones */}
                        {includeExamDetails && (row.examDetails1c.length > 0 || row.examDetails2c.length > 0) && (
                          <div className="mt-2.5">
                            <div className="text-[11px] font-bold text-indigo-900 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                              <Award className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Desglose de Evaluaciones, Exámenes y Trabajos Prácticos (Calificaciones)</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {/* 1° Cuatrimestre */}
                              <div className="border border-neutral-300 rounded-lg overflow-hidden">
                                <div className="bg-blue-50/80 border-b border-neutral-300 px-3 py-1.5 font-bold text-[11px] text-blue-900 flex items-center justify-between">
                                  <span>1° Cuatrimestre</span>
                                  <span>Nota 1°C: {row.score1c || '—'}</span>
                                </div>
                                <table className="w-full text-[11px]">
                                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
                                    <tr>
                                      <th className="py-1.5 px-2.5 text-left font-semibold">Examen / TP</th>
                                      <th className="py-1.5 px-2 text-left font-semibold">Categoría</th>
                                      <th className="py-1.5 px-2.5 text-center font-semibold w-16">Nota</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-neutral-200">
                                    {row.examDetails1c.map((item) => (
                                      <tr key={`1c-${item.id}`}>
                                        <td className="py-1.5 px-2.5 font-medium text-neutral-800">{item.itemName}</td>
                                        <td className="py-1.5 px-2 text-neutral-500 text-[10px]">{item.categoryName}</td>
                                        <td className="py-1.5 px-2.5 text-center font-bold text-blue-800 bg-blue-50/30">
                                          {item.score}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* 2° Cuatrimestre */}
                              <div className="border border-neutral-300 rounded-lg overflow-hidden">
                                <div className="bg-indigo-50/80 border-b border-neutral-300 px-3 py-1.5 font-bold text-[11px] text-indigo-900 flex items-center justify-between">
                                  <span>2° Cuatrimestre</span>
                                  <span>Nota 2°C: {row.score2c || '—'}</span>
                                </div>
                                <table className="w-full text-[11px]">
                                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
                                    <tr>
                                      <th className="py-1.5 px-2.5 text-left font-semibold">Examen / TP</th>
                                      <th className="py-1.5 px-2 text-left font-semibold">Categoría</th>
                                      <th className="py-1.5 px-2.5 text-center font-semibold w-16">Nota</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-neutral-200">
                                    {row.examDetails2c.map((item) => (
                                      <tr key={`2c-${item.id}`}>
                                        <td className="py-1.5 px-2.5 font-medium text-neutral-800">{item.itemName}</td>
                                        <td className="py-1.5 px-2 text-neutral-500 text-[10px]">{item.categoryName}</td>
                                        <td className="py-1.5 px-2.5 text-center font-bold text-indigo-800 bg-indigo-50/30">
                                          {item.score}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 2. Attendance & Disposition Blocks (Conditional) */}
                    {includeAttendance && includeDisposition ? (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                          {includeGrades ? '2' : '1'}. Asistencia, Puntualidad y Convivencia Escolar
                        </h4>
                        <table className="w-full text-xs border border-neutral-300">
                          <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                            <tr>
                              <th className="py-2 px-2 text-center border-r border-neutral-300">
                                Faltas 1°C
                              </th>
                              <th className="py-2 px-2 text-center border-r border-neutral-300">
                                Faltas 2°C
                              </th>
                              <th className="py-2 px-2 text-center border-r border-neutral-300 font-bold">
                                Total Inasistencias
                              </th>
                              <th className="py-2 px-2 text-center border-r border-neutral-300">
                                Tardanzas
                              </th>
                              <th className="py-2 px-2 text-center border-r border-neutral-300 font-bold">
                                % Asistencia Estimada
                              </th>
                              <th className="py-2 px-2 text-center font-bold text-purple-700">
                                Disposición y Trabajo
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                                {row.abs1}
                              </td>
                              <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                                {row.abs2}
                              </td>
                              <td className="py-2.5 px-2 text-center border-r border-neutral-200 font-bold text-neutral-900">
                                {row.totalAbs}
                              </td>
                              <td className="py-2.5 px-2 text-center border-r border-neutral-200">
                                {row.totalLat}
                              </td>
                              <td
                                className={`py-2.5 px-2 text-center border-r border-neutral-200 font-bold ${
                                  row.estimatedAttendance < 75 ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {row.estimatedAttendance}%
                              </td>
                              <td className="py-2.5 px-2 text-center font-bold text-purple-700">
                                {row.avgDisp} / 10
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : includeAttendance && !includeDisposition ? (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                          {includeGrades ? '2' : '1'}. Registro de Asistencia y Puntualidad Escolar
                        </h4>
                        <table className="w-full text-xs border border-neutral-300">
                          <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                            <tr>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Faltas 1° Cuatrimestre
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Faltas 2° Cuatrimestre
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300 bg-rose-50 font-bold text-rose-900">
                                Total Inasistencias Acumuladas
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Tardanzas Registradas
                              </th>
                              <th className="py-2 px-3 text-center font-bold">
                                % Asistencia Presencial
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                                {row.abs1}
                              </td>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                                {row.abs2}
                              </td>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 font-bold text-base text-rose-700 bg-rose-50/50">
                                {row.totalAbs} faltas
                              </td>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                                {row.totalLat}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-center font-bold text-sm ${
                                  row.estimatedAttendance < 75 ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {row.estimatedAttendance}%
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : !includeAttendance && includeDisposition ? (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                          {includeGrades ? '2' : '1'}. Disposición para el Trabajo y Convivencia Áulica
                        </h4>
                        <table className="w-full text-xs border border-neutral-300">
                          <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                            <tr>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Disposición 1° Cuatr.
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300">
                                Disposición 2° Cuatr.
                              </th>
                              <th className="py-2 px-3 text-center border-r border-neutral-300 bg-purple-50 font-bold text-purple-900">
                                Puntaje Promedio de Disposición
                              </th>
                              <th className="py-2 px-3 text-center font-bold">
                                Valoración de Compromiso Áulico
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                                {row.disp1} / 10
                              </td>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 text-sm">
                                {row.disp2} / 10
                              </td>
                              <td className="py-2.5 px-3 text-center border-r border-neutral-200 font-bold text-base text-purple-700 bg-purple-50/50">
                                {row.avgDisp} / 10
                              </td>
                              <td
                                className={`py-2.5 px-3 text-center font-semibold text-xs ${
                                  row.avgDisp >= 8
                                    ? 'text-emerald-700'
                                    : row.avgDisp >= 6
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {row.avgDisp >= 8
                                  ? 'Favorable y participativo'
                                  : row.avgDisp >= 6
                                  ? 'Regular / Ajustar entrega de tareas'
                                  : 'Requiere mayor compromiso en clase'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {/* 3. Pedagogical Observations for Report (Conditional) */}
                    {includeObservations && (
                      <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-5">
                        <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                          <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-amber-700" />
                            {includeGrades && (includeAttendance || includeDisposition)
                              ? '3'
                              : includeGrades || includeAttendance || includeDisposition
                              ? '2'
                              : '1'}
                            . Observaciones Pedagógicas y Síntesis:
                          </h4>
                        </div>

                        {/* Screen View: Editable Textarea */}
                        <div className="print:hidden">
                          <textarea
                            value={row.observation}
                            onChange={(e) =>
                              handleUpdateStudentReportObservation(row.student.id, e.target.value)
                            }
                            rows={4}
                            className="w-full text-xs bg-white border border-amber-300 rounded-md p-2.5 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed transition shadow-sm resize-y"
                            placeholder="Escribí acá las observaciones pedagógicas y síntesis para este estudiante..."
                          />
                        </div>

                        {/* Print View: Clean printed text without input controls */}
                        <div className="hidden print:block">
                          <p className="text-xs text-neutral-800 leading-relaxed font-sans whitespace-pre-wrap">
                            {row.observation || '—'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 4. Family Signature Slip / Notificación Institucional (Conditional) */}
                    {includeFamilySignature && (
                      <div className="mt-6 pt-3 border-t border-dashed border-neutral-400 bg-neutral-50/50 p-3 rounded-lg">
                        <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wide mb-2">
                          Acta de Notificación Institucional a la Familia
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-4">
                          <div className="border border-neutral-300 rounded-lg p-3 bg-white">
                            <div className="font-semibold text-neutral-700 mb-6">
                              Constancia del Docente
                            </div>
                            <div className="border-t border-neutral-400 pt-1 text-[11px] text-neutral-600">
                              Firma del Docente: <strong>{teacherName}</strong>
                            </div>
                            <div className="text-[10px] text-neutral-400 mt-0.5">{schoolName}</div>
                          </div>
                          <div className="border border-neutral-300 rounded-lg p-3 bg-white">
                            <div className="font-semibold text-neutral-700 mb-6">
                              Notificación del Adulto Responsable / Tutor
                            </div>
                            <div className="border-t border-neutral-400 pt-1 text-[11px] text-neutral-600">
                              Firma: _________________________________________
                            </div>
                            <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                              <span>Aclaración: ___________________________</span>
                              <span>DNI: _______________</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Official Document Footer */}
                    <div className="pt-5 mt-4 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-neutral-500 gap-2">
                      <div>
                        <strong className="text-neutral-700">Constancia Oficial de Trayectoria</strong> — {courseName}
                      </div>
                      <div>
                        Docente: <strong className="text-neutral-700">{teacherName}</strong> — Ciclo Lectivo 2026
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800 text-slate-400' : 'bg-neutral-50 border-neutral-200 text-neutral-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-amber-500" />
            <span>
              Carpeta de Drive vinculada:{' '}
              <strong className="text-neutral-800 dark:text-slate-200">
                📚 {courseName}
              </strong>
            </span>
            {driveFolderUrl && (
              <a
                href={driveFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline flex items-center gap-0.5 font-medium ml-1"
              >
                <span>Ver carpeta</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-1.5 rounded-lg border font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => setShowDriveConfirmModal(true)}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Guardar en Drive (.gdoc)</span>
            </button>
          </div>
        </div>

        {/* Confirmation Dialog before creating/updating Google Doc in Drive */}
        {showDriveConfirmModal && (
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
                    Se creará un documento editable de <strong>Google Docs (.gdoc)</strong> en la carpeta de la materia <strong>"{courseName}"</strong> con el siguiente nombre:
                  </p>
                  <div
                    className={`mt-2 p-2.5 rounded-xl border text-xs font-semibold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    {getTargetGoogleDocTitle()}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDriveConfirmModal(false)}
                  className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                    isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={executeSaveToDrive}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirmar y Crear Google Doc</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
