import { Student } from '../types';
import { ExamGradeDetailItem } from '../components/modules/CourseReportModal';

export interface ConsolidatedStudentReportRow {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  examDetails1c: ExamGradeDetailItem[];
  examDetails2c: ExamGradeDetailItem[];
  calcAvgStr: string;
  calcAvgNum: number | null;
  finalVal: string;
  finalNum: number | null;
  condition: string;
  abs1: number;
  abs2: number;
  totalAbs: number;
  lat1: number;
  lat2: number;
  totalLat: number;
  disp1: number;
  disp2: number;
  avgDisp: number;
  estimatedAttendance: number;
  observation: string;
}

export interface CourseReportStats {
  total: number;
  approvedCount: number;
  approvedPercent: number;
  compCount: number;
  avgScore: string;
  avgAttendance: number;
  totalCourseAbsences: number;
}

export interface GenerateCourseReportHtmlParams {
  type: 'course' | 'individual';
  courseName: string;
  schoolName: string;
  teacherName: string;
  currentDate: string;
  effectiveReason: string;
  stats: CourseReportStats;
  consolidatedStudents: ConsolidatedStudentReportRow[];
  displayedStudents: ConsolidatedStudentReportRow[];
  courseObservation: string;
  includeGrades: boolean;
  includeExamDetails: boolean;
  includeAttendance: boolean;
  includeDisposition: boolean;
  includeObservations: boolean;
  includeFamilySignature: boolean;
}

export function generateCourseReportHtml({
  type,
  courseName,
  schoolName,
  teacherName,
  currentDate,
  effectiveReason,
  stats,
  consolidatedStudents,
  displayedStudents,
  courseObservation,
  includeGrades,
  includeExamDetails,
  includeAttendance,
  includeDisposition,
  includeObservations,
  includeFamilySignature,
}: GenerateCourseReportHtmlParams): string {
  const isCourse = type === 'course';
  const title = `Informe — ${courseName}`;

  let bodyContent = '';

  if (isCourse) {
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
}
