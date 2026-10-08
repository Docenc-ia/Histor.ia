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
} from 'lucide-react';
import { Student } from '../../types';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { driveService } from '../../services/workspace/driveService';

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
}) => {
  const { user } = useWorkspaceAuth();
  const [activeTab, setActiveTab] = useState<'course' | 'individual'>(initialTab);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId || 'all');
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveSavedResult, setDriveSavedResult] = useState<{
    success: boolean;
    name: string;
    url: string;
    isLiveGoogle: boolean;
    folderName: string;
  } | null>(null);
  const [courseObservation, setCourseObservation] = useState<string>(
    'El grupo de estudiantes ha completado las actividades curriculares correspondientes al ciclo lectivo 2026. Se detallan a continuación las calificaciones definitivas, registros de asistencia y condiciones de acreditación conforme a las normativas pedagógicas vigentes.'
  );

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

  // Dedicated observations for reports / certificates (strictly isolated from private course notes)
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

  // Fallback loading of grades and annual overrides if opened outside of GradebookMatrix
  const effectiveScore1cMap = useMemo(() => {
    if (score1cMap && Object.keys(score1cMap).length > 0) return score1cMap;
    const result: Record<string, { scoreStr: string; num: number | null }> = {};
    try {
      const gradesRaw =
        localStorage.getItem(`fds_grades_data_${courseId}_1c`) ||
        localStorage.getItem(`fds_grades_data_${courseId}`);
      if (gradesRaw) {
        const grades = JSON.parse(gradesRaw);
        students.forEach((st) => {
          const stGrades = grades[st.id] || {};
          const nums = Object.values(stGrades)
            .map((v: any) => parseFloat(v))
            .filter((v: number) => !isNaN(v) && v > 0);
          if (nums.length > 0) {
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            const str = avg.toFixed(1).replace('.0', '');
            result[st.id] = { scoreStr: str, num: avg };
          }
        });
      }
    } catch {}
    return result;
  }, [score1cMap, courseId, students]);

  const effectiveScore2cMap = useMemo(() => {
    if (score2cMap && Object.keys(score2cMap).length > 0) return score2cMap;
    const result: Record<string, { scoreStr: string; num: number | null }> = {};
    try {
      const gradesRaw = localStorage.getItem(`fds_grades_data_${courseId}_2c`);
      if (gradesRaw) {
        const grades = JSON.parse(gradesRaw);
        students.forEach((st) => {
          const stGrades = grades[st.id] || {};
          const nums = Object.values(stGrades)
            .map((v: any) => parseFloat(v))
            .filter((v: number) => !isNaN(v) && v > 0);
          if (nums.length > 0) {
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            const str = avg.toFixed(1).replace('.0', '');
            result[st.id] = { scoreStr: str, num: avg };
          }
        });
      }
    } catch {}
    return result;
  }, [score2cMap, courseId, students]);

  const effectiveOverrides = useMemo(() => {
    if (annualOverrides && Object.keys(annualOverrides).length > 0) return annualOverrides;
    try {
      const raw = localStorage.getItem(`fds_grades_annual_override_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [annualOverrides, courseId]);

  // Consolidate full student annual data
  const consolidatedStudents = useMemo(() => {
    return students.map((st) => {
      const s1 = effectiveScore1cMap[st.id] || { scoreStr: '', num: null };
      const s2 = effectiveScore2cMap[st.id] || { scoreStr: '', num: null };
      const override = effectiveOverrides[st.id];

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
      const finalNum = finalVal !== '' && !isNaN(Number(finalVal)) ? Number(finalVal) : null;

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

      const estimatedAttendance = Math.max(
        0,
        Math.min(100, Math.round(100 - totalAbs * 2.5 - totalLat * 0.8))
      );

      // Dedicated observation for official report / certificate (strictly separated from private course notes)
      const customReportObs = reportObservations[st.id];
      const defaultReportObs =
        finalNum !== null && finalNum >= 7
          ? 'Demostró un desempeño favorable y constante cumplimiento en las tareas y actividades propuestas.'
          : finalNum !== null && finalNum >= 6
          ? 'Alcanzó los contenidos prioritarios con regularidad. Se sugiere profundizar lecturas y repaso de temas clave.'
          : 'Requiere instancia de intensificación de aprendizajes en los contenidos pendientes del ciclo.';

      const observation = customReportObs !== undefined ? customReportObs : defaultReportObs;

      return {
        student: st,
        score1c: s1.scoreStr,
        score1cNum: s1.num,
        score2c: s2.scoreStr,
        score2cNum: s2.num,
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
  }, [students, effectiveScore1cMap, effectiveScore2cMap, effectiveOverrides, disp1cMap, disp2cMap, reportObservations]);

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

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Generate self-contained standalone HTML document for download or Drive upload
  const generateHtmlDocument = (type: 'course' | 'individual') => {
    const isCourse = type === 'course';
    const title = isCourse
      ? `Informe Consolidado — ${courseName}`
      : `Boletines de Rendimiento (1 Pág.) — ${courseName}`;

    let bodyContent = '';

    if (isCourse) {
      bodyContent = `
        <div class="report-page">
          <div class="header">
            <div class="school-brand">
              <h2>${schoolName}</h2>
              <p class="subtitle">INFORME INSTITUCIONAL DE RENDIMIENTO ACADÉMICO Y ASISTENCIA — CICLO LECTIVO 2026</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${courseName}</div>
              <div><strong>Docente:</strong> ${teacherName}</div>
              <div><strong>Fecha de emisión:</strong> ${currentDate}</div>
              <div><strong>Matrícula Total:</strong> ${stats.total} estudiantes</div>
            </div>
          </div>

          <div class="stats-row">
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
            <div class="stat-box">
              <div class="stat-label">Asistencia Promedio</div>
              <div class="stat-val">${stats.avgAttendance}%</div>
            </div>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 30px;">#</th>
                <th>Estudiante</th>
                <th style="text-align: center;">1° Cuatr.</th>
                <th style="text-align: center;">2° Cuatr.</th>
                <th style="text-align: center;">Promedio</th>
                <th style="text-align: center;">Nota Definitiva</th>
                <th style="text-align: center;">Faltas Anuales</th>
                <th style="text-align: center;">Disposición</th>
                <th style="text-align: center;">Condición Final</th>
              </tr>
            </thead>
            <tbody>
              ${consolidatedStudents
                .map(
                  (row, idx) => `
                <tr>
                  <td style="text-align: center; color: #666;">${idx + 1}</td>
                  <td><strong>${row.student.lastName}, ${row.student.firstName}</strong></td>
                  <td style="text-align: center;">${row.score1c || '—'}</td>
                  <td style="text-align: center;">${row.score2c || '—'}</td>
                  <td style="text-align: center; font-weight: bold;">${row.calcAvgStr || '—'}</td>
                  <td style="text-align: center; font-weight: bold; font-size: 13px; color: #1e3a8a;">${row.finalVal || '—'}</td>
                  <td style="text-align: center;">${row.totalAbs}</td>
                  <td style="text-align: center;">${row.avgDisp}/10</td>
                  <td style="text-align: center;">
                    <span class="badge ${
                      row.condition.includes('Aprobado') ? 'badge-approved' : 'badge-comp'
                    }">
                      ${row.condition}
                    </span>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>

          <div class="observations-box">
            <h4>Observaciones Pedagógicas y Síntesis del Curso:</h4>
            <p>${courseObservation}</p>
          </div>

          <div style="margin-top: 36px; padding-top: 14px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div><strong>Documento Oficial de Cierre Institucional</strong> — Ciclo Lectivo 2026</div>
            <div>Docente responsable: <strong>${teacherName}</strong> — ${schoolName}</div>
          </div>
        </div>
      `;
    } else {
      // Individual student reports (1 page per student)
      bodyContent = displayedStudents
        .map(
          (row, idx) => `
        <div class="student-page">
          <div class="header">
            <div class="school-brand">
              <h2>${schoolName}</h2>
              <p class="subtitle">INFORME INDIVIDUAL DE TRAYECTORIA Y CALIFICACIONES — CICLO 2026</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${courseName}</div>
              <div><strong>Docente:</strong> ${teacherName}</div>
              <div><strong>Fecha de emisión:</strong> ${currentDate}</div>
            </div>
          </div>

          <div class="student-card-info">
            <div style="font-size: 16px; font-weight: bold; color: #1e293b;">
              Estudiante: ${row.student.lastName}, ${row.student.firstName}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
              Email institucional: ${row.student.email || '—'}
            </div>
          </div>

          <div class="section-title">1. Rendimiento Académico y Calificaciones</div>
          <table class="data-table" style="margin-bottom: 16px;">
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

          <div class="section-title">2. Asistencia, Puntualidad y Convivencia Escolar</div>
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

          <div class="observations-box" style="margin-top: 14px;">
            <h4>3. Observación Pedagógica del Docente (Constancia / Informe):</h4>
            <p>${row.observation || 'Sin observaciones adicionales registradas.'}</p>
          </div>

          <div style="margin-top: 36px; padding-top: 14px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div><strong>Constancia Oficial de Situación Aúlica y Trayectoria</strong> — ${courseName}</div>
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

  // Download locally (.html printable file)
  const handleDownloadHtml = () => {
    const html = generateHtmlDocument(activeTab);
    const fileName =
      activeTab === 'course'
        ? `Informe_Consolidado_${courseName.replace(/\s+/g, '_')}_2026.html`
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

  // Save directly to Google Drive of the course
  const handleSaveToDrive = async () => {
    setIsSavingToDrive(true);
    setDriveSavedResult(null);

    try {
      // 1. Resolve or prepare the folder structure for the course
      const folderStructure = await driveService.setupCourseFolderStructure(
        courseName,
        driveFolderId
      );
      const targetFolderId = folderStructure.mainFolder.id;
      const targetFolderName = folderStructure.mainFolder.name;

      // 2. Generate HTML report
      const htmlContent = generateHtmlDocument(activeTab);
      const fileName =
        activeTab === 'course'
          ? `📊 Informe Consolidado Anual - ${courseName}.html`
          : `🎓 Boletines por Alumno (1 Pág) - ${courseName}.html`;

      // 3. Upload file to Google Drive folder
      const result = await driveService.uploadReportFile(
        fileName,
        htmlContent,
        targetFolderId,
        'text/html'
      );

      setDriveSavedResult({
        success: true,
        name: result.name,
        url: result.url,
        isLiveGoogle: result.isLiveGoogle,
        folderName: targetFolderName,
      });
    } catch (err) {
      console.error('Error saving report to Google Drive:', err);
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
                  Reportes e Informes de Cierre de Materia
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  {courseName}
                </span>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  • Ciclo 2026
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Genera el informe consolidado de la materia o las fichas individuales de 1 página por alumno para imprimir o guardar en Google Drive.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
              title="Imprimir o guardar como PDF en tu navegador"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToDrive}
              disabled={isSavingToDrive}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-emerald-700 border-emerald-300'
              }`}
              title="Guardar archivo en la carpeta de Google Drive de este curso"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-emerald-500" />
              )}
              <span>{isSavingToDrive ? 'Guardando...' : 'Guardar en Drive'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className={`p-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Descargar copia (.html)"
            >
              <Download className="w-4 h-4" />
            </button>

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
                Reporte guardado exitosamente en Google Drive en la carpeta{' '}
                <strong>"{driveSavedResult.folderName}"</strong>
              </span>
            </div>
            {driveSavedResult.url && (
              <a
                href={driveSavedResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-bold underline hover:opacity-80"
              >
                <span>Abrir en Google Drive</span>
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
                      Informe Institucional de Rendimiento Académico y Asistencia — Ciclo Lectivo 2026
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

                {/* KPI Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
                  <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-center">
                    <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                      Asistencia Promedio
                    </span>
                    <span className="text-lg font-bold text-blue-600">
                      {stats.avgAttendance}%
                    </span>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-left text-xs border border-neutral-300">
                    <thead className="bg-neutral-100 border-b border-neutral-300 font-semibold text-neutral-700">
                      <tr>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300 w-8">#</th>
                        <th className="py-2.5 px-3 border-r border-neutral-300">Estudiante</th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300">1° Cuatr.</th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300">2° Cuatr.</th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300">Promedio</th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300 bg-blue-50/60 font-bold">
                          Nota Definitiva
                        </th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300">Faltas</th>
                        <th className="py-2.5 px-2 text-center border-r border-neutral-300">Disp.</th>
                        <th className="py-2.5 px-3 text-center">Condición Final</th>
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
                          <td className="py-2 px-2 text-center border-r border-neutral-200">
                            {row.totalAbs}
                          </td>
                          <td className="py-2 px-2 text-center border-r border-neutral-200">
                            {row.avgDisp}/10
                          </td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Course Pedagogical Observations */}
                <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-8">
                  <h4 className="text-xs font-bold text-amber-900 mb-1">
                    Observaciones Pedagógicas y Síntesis del Curso:
                  </h4>
                  <textarea
                    value={courseObservation}
                    onChange={(e) => setCourseObservation(e.target.value)}
                    rows={3}
                    className="w-full text-xs bg-transparent border-0 focus:outline-none text-neutral-800 leading-relaxed resize-none"
                    placeholder="Escribe comentarios institucionales sobre el curso..."
                  />
                </div>

                {/* Official Institutional Verification Footer (Sin firmas manuscritas) */}
                <div className="pt-6 mt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 gap-2">
                  <p>
                    <strong className="text-neutral-700">Informe Consolidado Oficial del Curso</strong> — {courseName}
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
                {displayedStudents.map((row, idx) => (
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
                          Informe Individual de Trayectoria y Calificaciones — Ciclo 2026
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
                    <div className="bg-slate-100 p-3 rounded-lg border-l-4 border-blue-600 mb-4 flex justify-between items-center">
                      <div>
                        <h3 className="text-base font-bold text-neutral-900">
                          {row.student.lastName}, {row.student.firstName}
                        </h3>
                        <p className="text-xs text-neutral-500 font-mono">
                          {row.student.email || 'Estudiante Regular'}
                        </p>
                      </div>
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
                    </div>

                    {/* Academics Block */}
                    <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                      1. Rendimiento Académico y Calificaciones
                    </h4>
                    <table className="w-full text-xs border border-neutral-300 mb-4">
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

                    {/* Attendance & Disposition Block */}
                    <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2">
                      2. Asistencia, Puntualidad y Convivencia Escolar
                    </h4>
                    <table className="w-full text-xs border border-neutral-300 mb-4">
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

                    {/* Pedagogical Observations for Report / Constancia */}
                    <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-6">
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                        <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-amber-700" />
                          3. Observación Pedagógica del Docente (Constancia / Informe):
                        </h4>
                        <span className="text-[10px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 font-medium print:hidden">
                          🔒 Exclusivo de este informe (no modifica notas privadas de la lista)
                        </span>
                      </div>

                      {/* Screen View: Editable Textarea with Quick Presets */}
                      <div className="print:hidden space-y-2">
                        <textarea
                          value={row.observation}
                          onChange={(e) =>
                            handleUpdateStudentReportObservation(row.student.id, e.target.value)
                          }
                          rows={3}
                          className="w-full text-xs bg-white border border-amber-300 rounded-md p-2.5 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed transition shadow-sm resize-y"
                          placeholder="Escribe la observación oficial que figurará en el informe o constancia para el alumno/directivo..."
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
                          <span className="text-emerald-700 font-medium flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Guardado para Drive y versión impresa
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateStudentReportObservation(
                                  row.student.id,
                                  'Demostró un desempeño favorable y constante cumplimiento en las tareas y actividades propuestas.'
                                )
                              }
                              className="px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded border border-emerald-200 text-[10px] font-medium transition"
                            >
                              Aprobado
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateStudentReportObservation(
                                  row.student.id,
                                  'Requiere instancia de intensificación de aprendizajes en los contenidos pendientes del ciclo.'
                                )
                              }
                              className="px-2 py-0.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded border border-rose-200 text-[10px] font-medium transition"
                            >
                              Intensificación
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateStudentReportObservation(row.student.id, '')
                              }
                              className="px-2 py-0.5 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 rounded text-[10px] transition"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Print View: Clean printed text without input controls */}
                      <div className="hidden print:block">
                        <p className="text-xs text-neutral-800 leading-relaxed font-sans">
                          {row.observation || 'Sin observaciones adicionales registradas.'}
                        </p>
                      </div>
                    </div>

                    {/* Official Document Footer (Sin firmas manuscritas) */}
                    <div className="pt-6 mt-4 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-neutral-500 gap-2">
                      <div>
                        <strong className="text-neutral-700">Constancia Oficial de Situación Aúlica</strong> — {courseName}
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
              onClick={handleSaveToDrive}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cloud className="w-3.5 h-3.5" />
              )}
              <span>Guardar en Drive del Curso</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
