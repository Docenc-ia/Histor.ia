import { Student } from '../types';
import { ExamGradeDetailItem } from '../components/modules/CourseReportModal';
import {
  DispositionReasonDetailItem,
  getConditionForScore,
  type ReportGradesPeriod,
} from './courseReportAggregator';
import { getTerminologySettings, getDerivedPeriodLabels } from './terminologySettings';
import { escapeHtml } from './htmlEscape';

export interface ConsolidatedStudentReportRow {
  student: Student;
  score1c: string;
  score1cNum: number | null;
  score2c: string;
  score2cNum: number | null;
  examDetails1c: ExamGradeDetailItem[];
  examDetails2c: ExamGradeDetailItem[];
  dispositionReasons?: DispositionReasonDetailItem[];
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
  schoolYear?: string;
  minAttendancePercent?: number;
  effectiveReason: string;
  stats: CourseReportStats;
  consolidatedStudents: ConsolidatedStudentReportRow[];
  displayedStudents: ConsolidatedStudentReportRow[];
  courseObservation: string;
  includeGrades: boolean;
  gradesPeriod?: ReportGradesPeriod;
  includeExamDetails: boolean;
  includeAttendance: boolean;
  includeDisposition: boolean;
  includeDispositionReasons?: boolean;
  includeObservations: boolean;
  includeFamilySignature: boolean;
}

export function generateCourseReportHtml({
  type,
  courseName,
  schoolName,
  teacherName,
  currentDate,
  schoolYear,
  minAttendancePercent = 75,
  effectiveReason,
  stats,
  consolidatedStudents,
  displayedStudents,
  courseObservation,
  includeGrades,
  gradesPeriod = 'both',
  includeExamDetails,
  includeAttendance,
  includeDisposition,
  includeDispositionReasons = true,
  includeObservations,
  includeFamilySignature,
}: GenerateCourseReportHtmlParams): string {
  const isCourse = type === 'course';
  const show1c = gradesPeriod === 'both' || gradesPeriod === '1c';
  const show2c = gradesPeriod === 'both' || gradesPeriod === '2c';
  const safeCourseName = escapeHtml(courseName);
  const safeSchoolName = escapeHtml(schoolName);
  const safeTeacherName = escapeHtml(teacherName);
  const safeCurrentDate = escapeHtml(currentDate);
  const safeSchoolYear = escapeHtml(schoolYear || String(new Date().getFullYear()));
  const safeEffectiveReason = escapeHtml(effectiveReason.toUpperCase());
  const safeCourseObservation = escapeHtml(courseObservation);
  const getConditionBadgeClass = (condition: string) =>
    condition.includes('Aprobado')
      ? 'badge-approved'
      : condition === 'Pendiente'
      ? 'badge-pending'
      : 'badge-comp';
  const getRowCondition = (row: ConsolidatedStudentReportRow) =>
    gradesPeriod === '1c'
      ? getConditionForScore(row.score1cNum)
      : gradesPeriod === '2c'
      ? getConditionForScore(row.score2cNum)
      : row.condition;
  const title = `Informe — ${safeCourseName}`;
  const termSettings = getTerminologySettings();
  const attendanceLabel = escapeHtml(termSettings.attendanceLabel);
  const dispositionLabel = escapeHtml(termSettings.dispositionLabel);
  const { initialDispositionScore } = termSettings;
  const rawPeriodLabels = getDerivedPeriodLabels(termSettings.periodNameSingular);
  const term1FullLabel = escapeHtml(rawPeriodLabels.term1FullLabel);
  const term2FullLabel = escapeHtml(rawPeriodLabels.term2FullLabel);
  const term1ShortLabel = escapeHtml(rawPeriodLabels.term1ShortLabel);
  const term2ShortLabel = escapeHtml(rawPeriodLabels.term2ShortLabel);
  const periodSubtitleSuffix =
    includeGrades && gradesPeriod === '1c'
      ? ` · ${term1FullLabel.toUpperCase()}`
      : includeGrades && gradesPeriod === '2c'
      ? ` · ${term2FullLabel.toUpperCase()}`
      : '';

  let bodyContent = '';

  if (isCourse) {
    let kpiBoxes = '';
    if (includeGrades) {
      const avgLabel =
        gradesPeriod === '1c'
          ? `Promedio ${term1ShortLabel}`
          : gradesPeriod === '2c'
          ? `Promedio ${term2ShortLabel}`
          : 'Promedio General';
      kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">Aprobados</div>
            <div class="stat-val text-green">${escapeHtml(stats.approvedCount)} (${escapeHtml(stats.approvedPercent)}%)</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">En Compensación</div>
            <div class="stat-val text-red">${escapeHtml(stats.compCount)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">${avgLabel}</div>
            <div class="stat-val text-purple">${escapeHtml(stats.avgScore)}</div>
          </div>
        `;
    }
    if (includeAttendance) {
      kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">${attendanceLabel} Promedio</div>
            <div class="stat-val">${escapeHtml(stats.avgAttendance)}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Total Inasistencias</div>
            <div class="stat-val text-red">${escapeHtml(stats.totalCourseAbsences)}</div>
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
          : String(initialDispositionScore ?? 10);
      kpiBoxes += `
          <div class="stat-box">
            <div class="stat-label">${dispositionLabel} Promedio</div>
            <div class="stat-val text-purple">${escapeHtml(avgDispTotal)} / 10</div>
          </div>
        `;
    }

    bodyContent = `
        <div class="report-page">
          <div class="header">
            <div class="school-brand">
              <h2>${safeSchoolName}</h2>
              <p class="subtitle">${safeEffectiveReason}${periodSubtitleSuffix} — CICLO LECTIVO ${safeSchoolYear}</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${safeCourseName}</div>
              <div><strong>Docente:</strong> ${safeTeacherName}</div>
              <div><strong>Fecha de emisión:</strong> ${safeCurrentDate}</div>
              <div><strong>Matrícula Total:</strong> ${escapeHtml(stats.total)} estudiantes</div>
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
                    ? gradesPeriod === 'both'
                      ? `
                  <th style="text-align: center;">${term1FullLabel}</th>
                  <th style="text-align: center;">${term2FullLabel}</th>
                  <th style="text-align: center;">Promedio</th>
                  <th style="text-align: center;">Nota Definitiva</th>
                `
                      : `
                  <th style="text-align: center;">Nota ${gradesPeriod === '1c' ? term1FullLabel : term2FullLabel}</th>
                `
                    : ''
                }
                ${
                  includeAttendance
                    ? `
                  <th style="text-align: center;">Faltas ${term1ShortLabel}</th>
                  <th style="text-align: center;">Faltas ${term2ShortLabel}</th>
                  <th style="text-align: center;">Faltas Anuales</th>
                `
                    : ''
                }
                ${includeDisposition ? `<th style="text-align: center;">${dispositionLabel}</th>` : ''}
                ${
                  includeGrades
                    ? `<th style="text-align: center;">${
                        gradesPeriod === 'both'
                          ? 'Condición Final'
                          : `Condición (${gradesPeriod === '1c' ? term1ShortLabel : term2ShortLabel})`
                      }</th>`
                    : ''
                }
              </tr>
            </thead>
            <tbody>
              ${consolidatedStudents
                .map((row, idx) => {
                  const rowCondition = getRowCondition(row);
                  const singleTermScore = gradesPeriod === '1c' ? row.score1c : row.score2c;
                  return `
                <tr>
                  <td style="text-align: center; color: #666;">${idx + 1}</td>
                  <td><strong>${escapeHtml(row.student.lastName)}, ${escapeHtml(row.student.firstName)}</strong></td>
                  ${
                    includeGrades
                      ? gradesPeriod === 'both'
                        ? `
                    <td style="text-align: center;">${escapeHtml(row.score1c || '—')}</td>
                    <td style="text-align: center;">${escapeHtml(row.score2c || '—')}</td>
                    <td style="text-align: center; font-weight: bold;">${escapeHtml(row.calcAvgStr || '—')}</td>
                    <td style="text-align: center; font-weight: bold; font-size: 13px; color: #1e3a8a;">${escapeHtml(row.finalVal || '—')}</td>
                  `
                        : `
                    <td style="text-align: center; font-weight: bold; font-size: 13px; color: #1e3a8a;">${escapeHtml(singleTermScore || '—')}</td>
                  `
                      : ''
                  }
                  ${
                    includeAttendance
                      ? `
                    <td style="text-align: center;">${escapeHtml(row.abs1)}</td>
                    <td style="text-align: center;">${escapeHtml(row.abs2)}</td>
                    <td style="text-align: center; font-weight: bold;">${escapeHtml(row.totalAbs)}</td>
                  `
                      : ''
                  }
                  ${includeDisposition ? `<td style="text-align: center;">${escapeHtml(row.avgDisp)}/10</td>` : ''}
                  ${
                    includeGrades
                      ? `
                    <td style="text-align: center;">
                      <span class="badge ${getConditionBadgeClass(rowCondition)}">
                        ${escapeHtml(rowCondition)}
                      </span>
                    </td>
                  `
                      : ''
                  }
                </tr>
              `;
                })
                .join('')}
            </tbody>
          </table>

          ${
            includeObservations
              ? `
            <div class="observations-box">
              <h4>Observaciones Pedagógicas y Síntesis del Curso:</h4>
              <p>${safeCourseObservation}</p>
            </div>
          `
              : ''
          }

          <div style="margin-top: 36px; padding-top: 14px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div><strong>Documento Oficial Institucional</strong> — Ciclo Lectivo ${safeSchoolYear}</div>
            <div>Docente responsable: <strong>${safeTeacherName}</strong> — ${safeSchoolName}</div>
          </div>
        </div>
      `;
  } else {
    bodyContent = displayedStudents
      .map((row) => {
        const rowCondition = getRowCondition(row);
        const visibleExamDetails1c = show1c ? row.examDetails1c : [];
        const visibleExamDetails2c = show2c ? row.examDetails2c : [];
        const hasVisibleExamDetails =
          visibleExamDetails1c.length > 0 || visibleExamDetails2c.length > 0;
        const singleTermScore = gradesPeriod === '1c' ? row.score1c : row.score2c;
        const singleTermLabel = gradesPeriod === '1c' ? term1FullLabel : term2FullLabel;

        return `
        <div class="student-page">
          <div class="header">
            <div class="school-brand">
              <h2>${safeSchoolName}</h2>
              <p class="subtitle">${safeEffectiveReason}${periodSubtitleSuffix} — CICLO ${safeSchoolYear}</p>
            </div>
            <div class="meta-box">
              <div><strong>Materia:</strong> ${safeCourseName}</div>
              <div><strong>Docente:</strong> ${safeTeacherName}</div>
              <div><strong>Fecha:</strong> ${safeCurrentDate}</div>
            </div>
          </div>

          <div class="student-card-info">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 16px; font-weight: bold; color: #1e293b;">
                  Estudiante: ${escapeHtml(row.student.lastName)}, ${escapeHtml(row.student.firstName)}
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                  Email institucional: ${escapeHtml(row.student.email || '—')}
                </div>
              </div>
              ${
                includeGrades
                  ? `
                <div style="text-align: right;">
                  <span class="badge ${getConditionBadgeClass(rowCondition)}" style="font-size: 12px; padding: 4px 10px;">
                    ${escapeHtml(rowCondition)}
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
            <div class="section-title">1. Rendimiento Académico y Calificaciones${
              gradesPeriod === 'both' ? '' : ` (${singleTermLabel})`
            }</div>
            ${
              gradesPeriod === 'both'
                ? `
            <table class="data-table" style="margin-bottom: 12px;">
              <thead>
                <tr>
                  <th style="text-align: center;">${term1FullLabel}</th>
                  <th style="text-align: center;">${term2FullLabel}</th>
                  <th style="text-align: center;">Promedio Ponderado</th>
                  <th style="text-align: center; background: #e0e7ff;">Calificación Final Definitiva</th>
                  <th style="text-align: center;">Condición de Acreditación</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${escapeHtml(row.score1c || '—')}</td>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${escapeHtml(row.score2c || '—')}</td>
                  <td style="text-align: center; font-size: 14px; font-weight: bold;">${escapeHtml(row.calcAvgStr || '—')}</td>
                  <td style="text-align: center; font-size: 18px; font-weight: bold; color: #1e40af; background: #eef2ff;">
                    ${escapeHtml(row.finalVal || '—')}
                  </td>
                  <td style="text-align: center;">
                    <span class="badge ${getConditionBadgeClass(rowCondition)}" style="font-size: 12px; padding: 4px 10px;">
                      ${escapeHtml(rowCondition)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            `
                : `
            <table class="data-table" style="margin-bottom: 12px;">
              <thead>
                <tr>
                  <th style="text-align: center; background: #e0e7ff;">Calificación ${singleTermLabel}</th>
                  <th style="text-align: center;">Condición</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center; font-size: 18px; font-weight: bold; color: #1e40af; background: #eef2ff;">
                    ${escapeHtml(singleTermScore || '—')}
                  </td>
                  <td style="text-align: center;">
                    <span class="badge ${getConditionBadgeClass(rowCondition)}" style="font-size: 12px; padding: 4px 10px;">
                      ${escapeHtml(rowCondition)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            `
            }
            ${
              includeExamDetails && hasVisibleExamDetails
                ? `
              <div style="font-size: 11.5px; font-weight: bold; color: #334155; margin: 8px 0 6px 0;">
                Detalle de Evaluaciones, Exámenes y Trabajos Prácticos:
              </div>
              <table class="data-table" style="margin-bottom: 16px;">
                <thead>
                  <tr>
                    ${gradesPeriod === 'both' ? '<th style="width: 22%;">Período</th>' : ''}
                    <th style="width: 28%;">Categoría</th>
                    <th style="width: ${gradesPeriod === 'both' ? '32%' : '54%'};">Examen / Trabajo Práctico</th>
                    <th style="width: 18%; text-align: center;">Calificación</th>
                  </tr>
                </thead>
                <tbody>
                  ${visibleExamDetails1c
                    .map(
                      (item) => `
                    <tr>
                      ${gradesPeriod === 'both' ? `<td><strong>${term1FullLabel}</strong></td>` : ''}
                      <td>${escapeHtml(item.categoryName)}</td>
                      <td>${escapeHtml(item.itemName)}</td>
                      <td style="text-align: center; font-weight: bold; color: #1e3a8a;">${escapeHtml(item.score)}</td>
                    </tr>
                  `
                    )
                    .join('')}
                  ${visibleExamDetails2c
                    .map(
                      (item) => `
                    <tr>
                      ${gradesPeriod === 'both' ? `<td><strong>${term2FullLabel}</strong></td>` : ''}
                      <td>${escapeHtml(item.categoryName)}</td>
                      <td>${escapeHtml(item.itemName)}</td>
                      <td style="text-align: center; font-weight: bold; color: #4338ca;">${escapeHtml(item.score)}</td>
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
            <div class="section-title">${includeGrades ? '2' : '1'}. ${attendanceLabel}, Puntualidad y ${dispositionLabel}</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">Faltas ${term1ShortLabel}</th>
                  <th style="text-align: center;">Faltas ${term2ShortLabel}</th>
                  <th style="text-align: center;">Total Inasistencias</th>
                  <th style="text-align: center;">Tardanzas</th>
                  <th style="text-align: center;">% ${attendanceLabel} Estimada</th>
                  <th style="text-align: center;">Nota de ${dispositionLabel}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${escapeHtml(row.abs1)}</td>
                  <td style="text-align: center;">${escapeHtml(row.abs2)}</td>
                  <td style="text-align: center; font-weight: bold;">${escapeHtml(row.totalAbs)}</td>
                  <td style="text-align: center;">${escapeHtml(row.totalLat)}</td>
                  <td style="text-align: center; font-weight: bold; color: ${row.estimatedAttendance < minAttendancePercent ? '#b91c1c' : '#15803d'};">
                    ${escapeHtml(row.estimatedAttendance)}%
                  </td>
                  <td style="text-align: center; font-weight: bold; color: #7c3aed;">
                    ${escapeHtml(row.avgDisp)} / 10
                  </td>
                </tr>
              </tbody>
            </table>
          `
              : includeAttendance && !includeDisposition
                ? `
            <div class="section-title">${includeGrades ? '2' : '1'}. Registro de ${attendanceLabel} y Puntualidad Escolar</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">Faltas ${term1FullLabel}</th>
                  <th style="text-align: center;">Faltas ${term2FullLabel}</th>
                  <th style="text-align: center; background: #fee2e2;">Total Inasistencias Acumuladas</th>
                  <th style="text-align: center;">Tardanzas Registradas</th>
                  <th style="text-align: center;">% ${attendanceLabel} Presencial</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${escapeHtml(row.abs1)}</td>
                  <td style="text-align: center;">${escapeHtml(row.abs2)}</td>
                  <td style="text-align: center; font-weight: bold; font-size: 15px; color: #b91c1c; background: #fff1f2;">
                    ${escapeHtml(row.totalAbs)} inasistencias
                  </td>
                  <td style="text-align: center;">${escapeHtml(row.totalLat)}</td>
                  <td style="text-align: center; font-weight: bold; color: ${row.estimatedAttendance < minAttendancePercent ? '#b91c1c' : '#15803d'};">
                    ${escapeHtml(row.estimatedAttendance)}%
                  </td>
                </tr>
              </tbody>
            </table>
          `
                : !includeAttendance && includeDisposition
                  ? `
            <div class="section-title">${includeGrades ? '2' : '1'}. ${dispositionLabel}</div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="text-align: center;">${dispositionLabel} ${term1FullLabel}</th>
                  <th style="text-align: center;">${dispositionLabel} ${term2FullLabel}</th>
                  <th style="text-align: center; background: #ede9fe;">Promedio de ${dispositionLabel}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: center;">${escapeHtml(row.disp1)} / 10</td>
                  <td style="text-align: center;">${escapeHtml(row.disp2)} / 10</td>
                  <td style="text-align: center; font-weight: bold; font-size: 16px; color: #6d28d9; background: #f5f3ff;">
                    ${escapeHtml(row.avgDisp)} / 10
                  </td>
                </tr>
              </tbody>
            </table>
          `
                  : ''
          }

          ${
            includeDisposition &&
            includeDispositionReasons &&
            row.dispositionReasons &&
            row.dispositionReasons.length > 0
              ? `
            <div style="font-size: 11.5px; font-weight: bold; color: #581c87; margin: 8px 0 6px 0;">
              Detalle de motivos por los cuales se bajó ${dispositionLabel} (Fecha y Motivo):
            </div>
            <table class="data-table" style="margin-bottom: 16px;">
              <thead>
                <tr>
                  <th style="width: 18%; text-align: center;">Fecha</th>
                  <th style="width: 16%; text-align: center;">Período</th>
                  <th style="width: 50%;">Motivo por el cual se bajó ${dispositionLabel}</th>
                  <th style="width: 16%; text-align: center;">Puntaje</th>
                </tr>
              </thead>
              <tbody>
                ${row.dispositionReasons
                  .map(
                    (item) => `
                  <tr>
                    <td style="text-align: center; font-weight: 600;">${escapeHtml(item.date)}</td>
                    <td style="text-align: center;">${item.term === '2c' ? term2ShortLabel : term1ShortLabel}</td>
                    <td>${escapeHtml(item.reason)}</td>
                    <td style="text-align: center; font-weight: bold; color: #b91c1c;">
                      ${item.pointsChange > 0 ? `+${escapeHtml(item.pointsChange)}` : escapeHtml(item.pointsChange)} pto
                    </td>
                  </tr>
                `
                  )
                  .join('')}
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
              <p style="white-space: pre-wrap;">${escapeHtml(row.observation || '—')}</p>
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
                  <div style="color: #64748b; margin-top: 2px;">${safeTeacherName} — ${safeSchoolName}</div>
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
            <div><strong>Constancia Oficial de Trayectoria</strong> — ${safeCourseName}</div>
            <div>Docente a cargo: <strong>${safeTeacherName}</strong> — Ciclo Lectivo ${safeSchoolYear}</div>
          </div>
        </div>
      `;
      })
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
    .badge-pending {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
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
