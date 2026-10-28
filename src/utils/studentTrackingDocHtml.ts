import { Course, Student, StudentDispositionData, StudentHistoryItem, StudentObservation } from '../types';
import { GradeCategory, DEFAULT_CATEGORIES } from '../types/grades';
import { getUserStorageKey } from '../services/api';

export function buildStudentTrackingDocHtml(
  firstArg:
    | {
        student: Student;
        activeCourse?: Course;
        attendanceTerm?: '1c' | '2c' | 'annual';
        studentObservations?: Record<string, StudentObservation[]>;
        historyList?: StudentHistoryItem[];
        tl: any;
        disp: number;
        m1: StudentDispositionData;
        m2: StudentDispositionData;
      }
    | Student,
  tlArg?: any,
  dispArg?: number,
  m1Arg?: StudentDispositionData,
  m2Arg?: StudentDispositionData,
  extraContext?: {
    activeCourse?: Course;
    attendanceTerm?: '1c' | '2c' | 'annual';
    studentObservations?: Record<string, StudentObservation[]>;
    historyList?: StudentHistoryItem[];
  }
): string {
  let student: Student;
  let activeCourse: Course | undefined;
  let attendanceTerm: '1c' | '2c' | 'annual';
  let studentObservations: Record<string, StudentObservation[]>;
  let historyList: StudentHistoryItem[];
  let tl: any;
  let disp: number;
  let m1: StudentDispositionData;
  let m2: StudentDispositionData;

  if ('student' in (firstArg as any) && 'tl' in (firstArg as any)) {
    const p = firstArg as any;
    student = p.student;
    activeCourse = p.activeCourse;
    attendanceTerm = p.attendanceTerm || 'annual';
    studentObservations = p.studentObservations || {};
    historyList = p.historyList || [];
    tl = p.tl;
    disp = p.disp ?? 10;
    m1 = p.m1;
    m2 = p.m2;
  } else {
    student = firstArg as Student;
    tl = tlArg;
    disp = dispArg ?? 10;
    m1 = m1Arg || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    m2 = m2Arg || { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
    activeCourse = extraContext?.activeCourse;
    attendanceTerm = extraContext?.attendanceTerm || 'annual';
    studentObservations = extraContext?.studentObservations || {};
    historyList = extraContext?.historyList || [];
  }

  const targetCourseId = activeCourse?.id || student.courseId;
  const observations = (studentObservations[student.id] || []).filter(
    (obs) => !obs.courseId || !targetCourseId || obs.courseId === targetCourseId
  );
  const termLabel =
    attendanceTerm === 'annual'
      ? 'Ciclo Lectivo Anual'
      : attendanceTerm === '1c'
      ? '1° Cuatrimestre'
      : '2° Cuatrimestre';

  const currentDateStr = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const statusBadgeColor =
    tl.status === 'alert'
      ? '#dc2626'
      : tl.status === 'warning'
      ? '#d97706'
      : '#059669';

  const statusBg =
    tl.status === 'alert'
      ? '#fef2f2'
      : tl.status === 'warning'
      ? '#fffbeb'
      : '#ecfdf5';

  // Cargar notas de exámenes y TPs de la pestaña Calificaciones (1°C y 2°C)
  const loadTermExamsForDoc = (term: '1c' | '2c') => {
    if (!activeCourse) return [];
    try {
      const catRaw =
        localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}_${term}`)) ||
        localStorage.getItem(`fds_grades_categories_${activeCourse.id}_${term}`) ||
        (term === '1c'
          ? localStorage.getItem(getUserStorageKey(`fds_grades_categories_${activeCourse.id}`)) ||
            localStorage.getItem(`fds_grades_categories_${activeCourse.id}`)
          : null) ||
        localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}_${term}`) ||
        (term === '1c' ? localStorage.getItem(`fds_gradebook_categories_v1_${activeCourse.id}`) : null);
      const cats: GradeCategory[] = catRaw ? JSON.parse(catRaw) : DEFAULT_CATEGORIES;

      const gradesRaw =
        localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}_${term}`)) ||
        localStorage.getItem(`fds_grades_data_${activeCourse.id}_${term}`) ||
        (term === '1c'
          ? localStorage.getItem(getUserStorageKey(`fds_grades_data_${activeCourse.id}`)) ||
            localStorage.getItem(`fds_grades_data_${activeCourse.id}`)
          : null) ||
        localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}_${term}`) ||
        (term === '1c' ? localStorage.getItem(`fds_gradebook_grades_v1_${activeCourse.id}`) : null);
      const gMap: Record<string, Record<string, string | number>> = gradesRaw ? JSON.parse(gradesRaw) : {};
      const stGrades = gMap[student.id] || {};

      const items: { id: string; name: string; weight: number; score: number | null }[] = [];
      for (const cat of cats) {
        if (cat.id === 'cat-conceptual' || /disposici[oó]n|conducta/i.test(cat.name)) continue;
        if (!cat.subcategories || cat.subcategories.length === 0) {
          const rawVal = stGrades[cat.id];
          const parsedNum =
            rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
              ? Number(String(rawVal).replace(',', '.'))
              : NaN;
          items.push({
            id: cat.id,
            name: cat.name,
            weight: (cat as any).weight ?? 0,
            score: !isNaN(parsedNum) ? parsedNum : null,
          });
        } else {
          for (const sub of cat.subcategories) {
            if (/disposici[oó]n|conducta/i.test(sub.name)) continue;
            const rawVal = stGrades[sub.id];
            const parsedNum =
              rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                ? Number(String(rawVal).replace(',', '.'))
                : NaN;
            items.push({
              id: sub.id,
              name: sub.name,
              weight: (sub as any).weight ?? (cat as any).weight ?? 0,
              score: !isNaN(parsedNum) ? parsedNum : null,
            });
          }
        }
      }
      return items;
    } catch {
      return [];
    }
  };

  const exams1c = loadTermExamsForDoc('1c');
  const exams2c = loadTermExamsForDoc('2c');

  const computeWeightedAvg = (items: { weight: number; score: number | null }[]) => {
    const valid = items.filter((i) => i.score !== null);
    if (valid.length === 0) return null;
    const totalWeight = valid.reduce((acc, cur) => acc + (cur.weight || 1), 0);
    if (totalWeight <= 0) return null;
    const sum = valid.reduce((acc, cur) => acc + (cur.score || 0) * (cur.weight || 1), 0);
    return Number((sum / totalWeight).toFixed(2));
  };

  const avg1c = computeWeightedAvg(exams1c);
  const avg2c = computeWeightedAvg(exams2c);
  const finalAvg =
    avg1c !== null && avg2c !== null
      ? Number(((avg1c + avg2c) / 2).toFixed(2))
      : avg1c !== null
      ? avg1c
      : avg2c;

  const studentHistoryEvents = historyList
    .filter((h) => h.studentId === student.id && (!activeCourse || h.courseId === activeCourse.id))
    .slice(0, 25);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Ficha de Seguimiento - ${student.lastName}, ${student.firstName}</title>
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      font-size: 11pt;
      margin: 24px;
    }
    h1 {
      font-size: 16pt;
      color: #1e3a8a;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    h2 {
      font-size: 12pt;
      color: #1e40af;
      border-bottom: 2px solid #cbd5e1;
      padding-bottom: 4px;
      margin-top: 20px;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 10px;
      font-size: 10pt;
      text-align: left;
      vertical-align: top;
    }
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <table style="border: none; border-bottom: 3px solid #2563eb; margin-bottom: 16px;">
    <tr>
      <td style="border: none; padding: 0 0 10px 0;">
        <h1>Ficha de Seguimiento Académico y Pedagógico</h1>
        <div style="font-size: 10pt; color: #64748b;">Documento editable de seguimiento individual • Ciclo Lectivo ${new Date().getFullYear()}</div>
      </td>
      <td style="border: none; padding: 0 0 10px 0; text-align: right; font-size: 10pt; color: #475569;">
        <div><strong>Fecha de emisión:</strong> ${currentDateStr}</div>
        <div><strong>Período evaluado:</strong> ${termLabel}</div>
      </td>
    </tr>
  </table>

  <table>
    <tr>
      <th style="width: 35%;">Estudiante</th>
      <th style="width: 35%;">Materia / Espacio Curricular</th>
      <th style="width: 30%;">Curso / Aula / Contacto</th>
    </tr>
    <tr>
      <td><strong>${student.lastName}, ${student.firstName}</strong></td>
      <td><strong>${activeCourse?.name || 'Materia'}</strong> (${activeCourse?.grade || ''} ${activeCourse?.division || ''})</td>
      <td>${activeCourse?.room || activeCourse?.schedule || 'Turno Regular'}<br/><span style="font-size: 9pt; color: #64748b;">${student.email || 'Sin correo registrado'}</span></td>
    </tr>
  </table>

  <h2>1. Resumen de Asistencia, Regularidad y Disposición</h2>
  <table>
    <tr>
      <td colspan="4" style="background-color: ${statusBg}; border-color: ${statusBadgeColor};">
        <strong style="color: ${statusBadgeColor}; font-size: 11pt;">● Estado de Regularidad: ${tl.statusLabel} (${tl.percentage}% de asistencia)</strong><br/>
        <span style="font-size: 9.5pt; color: #334155;">
          Límite permitido: <strong>${tl.maxAllowedAbsences} inasistencias</strong> • 
          ${
            tl.remainingAbsences >= 0
              ? `Margen disponible: <strong>${tl.remainingAbsences} faltas</strong>`
              : `<strong style="color: #dc2626;">Excedido por ${Math.abs(tl.remainingAbsences)} faltas</strong>`
          }
        </span>
      </td>
    </tr>
    <tr>
      <th style="width: 25%; text-align: center;">Clases Dictadas</th>
      <th style="width: 25%; text-align: center;">Inasistencias Totales</th>
      <th style="width: 25%; text-align: center;">Llegadas Tarde</th>
      <th style="width: 25%; text-align: center;">Disposición / Conducta</th>
    </tr>
    <tr>
      <td style="text-align: center;">
        <strong style="font-size: 13pt;">${tl.totalClasses}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">${tl.attendedClasses} asistidas</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: ${tl.totalAbsences > 0 ? '#dc2626' : '#059669'};">${m1.totalAbsences + m2.totalAbsences}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalAbsences} | 2°C: ${m2.totalAbsences}</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: #d97706;">${(m1.totalLates || 0) + (m2.totalLates || 0)}</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalLates || 0} | 2°C: ${m2.totalLates || 0}</span>
      </td>
      <td style="text-align: center;">
        <strong style="font-size: 13pt; color: ${disp >= 8 ? '#059669' : disp >= 6 ? '#d97706' : '#dc2626'};">${disp} / 10</strong><br/>
        <span style="font-size: 9pt; color: #64748b;">1°C: ${m1.totalDisposition}/10 | 2°C: ${m2.totalDisposition}/10</span>
      </td>
    </tr>
  </table>

  <h2>2. Rendimiento Académico, Exámenes y Trabajos Prácticos</h2>
  <table>
    <tr>
      <th style="width: 33%; text-align: center;">Promedio 1° Cuatrimestre</th>
      <th style="width: 33%; text-align: center;">Promedio 2° Cuatrimestre</th>
      <th style="width: 34%; text-align: center;">Promedio General / Final</th>
    </tr>
    <tr>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${avg1c !== null ? (avg1c >= 7 ? '#059669' : avg1c >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${avg1c !== null ? avg1c : 'Sin calificar'}
      </td>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${avg2c !== null ? (avg2c >= 7 ? '#059669' : avg2c >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${avg2c !== null ? avg2c : 'Sin calificar'}
      </td>
      <td style="text-align: center; font-weight: bold; font-size: 12pt; color: ${finalAvg !== null ? (finalAvg >= 7 ? '#059669' : finalAvg >= 4 ? '#d97706' : '#dc2626') : '#94a3b8'};">
        ${finalAvg !== null ? finalAvg : 'En curso'}
      </td>
    </tr>
  </table>

  <table>
    <tr>
      <th colspan="2" style="width: 50%; background-color: #eef2ff; color: #312e81;">1° Cuatrimestre (Exámenes / TPs)</th>
      <th colspan="2" style="width: 50%; background-color: #eef2ff; color: #312e81;">2° Cuatrimestre (Exámenes / TPs)</th>
    </tr>
    <tr>
      <th style="width: 35%;">Instancia Evaluativa</th>
      <th style="width: 15%; text-align: center;">Nota</th>
      <th style="width: 35%;">Instancia Evaluativa</th>
      <th style="width: 15%; text-align: center;">Nota</th>
    </tr>
    ${(() => {
      const maxRows = Math.max(exams1c.length, exams2c.length, 1);
      let rowsHtml = '';
      for (let i = 0; i < maxRows; i++) {
        const e1 = exams1c[i];
        const e2 = exams2c[i];
        const c1Color = e1 && e1.score !== null ? (e1.score >= 7 ? '#059669' : e1.score >= 4 ? '#d97706' : '#dc2626') : '#94a3b8';
        const c2Color = e2 && e2.score !== null ? (e2.score >= 7 ? '#059669' : e2.score >= 4 ? '#d97706' : '#dc2626') : '#94a3b8';
        rowsHtml += `
          <tr>
            <td>${e1 ? `${e1.name} <span style="color:#64748b;font-size:9pt;">(${e1.weight}%)</span>` : '-'}</td>
            <td style="text-align: center; font-weight: bold; color: ${c1Color};">${e1 ? (e1.score !== null ? e1.score : 'S/C') : '-'}</td>
            <td>${e2 ? `${e2.name} <span style="color:#64748b;font-size:9pt;">(${e2.weight}%)</span>` : '-'}</td>
            <td style="text-align: center; font-weight: bold; color: ${c2Color};">${e2 ? (e2.score !== null ? e2.score : 'S/C') : '-'}</td>
          </tr>
        `;
      }
      return rowsHtml;
    })()}
  </table>

  <h2>3. Observaciones Pedagógicas y Acuerdos Registrados</h2>
  ${
    observations.length === 0
      ? `<p style="color: #64748b; font-style: italic;">No se registran observaciones particulares previas. El docente puede redactar observaciones adicionales a continuación:</p>`
      : `<table>
          <tr>
            <th style="width: 18%;">Fecha</th>
            <th style="width: 82%;">Detalle de la Observación / Informe</th>
          </tr>
          ${observations
            .map(
              (obs: any) => `
            <tr>
              <td><strong>${obs.date}</strong></td>
              <td>
                ${obs.text || 'Sin detalle de texto'}
                ${obs.reportUrl ? `<br/><a href="${obs.reportUrl}" style="color: #2563eb; font-size: 9pt;">Enlace adjunto: ${obs.reportUrl}</a>` : ''}
              </td>
            </tr>
          `
            )
            .join('')}
        </table>`
  }

  <h2>4. Registro Cronológico de Seguimiento en Clase</h2>
  ${
    studentHistoryEvents.length === 0
      ? `<p style="color: #64748b; font-style: italic;">No se registran novedades de asistencia o disposición en el historial reciente.</p>`
      : `<table>
          <tr>
            <th style="width: 18%;">Fecha</th>
            <th style="width: 18%;">Categoría</th>
            <th style="width: 64%;">Detalle / Motivo</th>
          </tr>
          ${studentHistoryEvents
            .map(
              (ev) => `
            <tr>
              <td>${ev.date}</td>
              <td><strong>${ev.category}</strong> (${ev.term === '2c' ? '2°C' : '1°C'})</td>
              <td>${ev.action}${ev.pointsChange ? ` (${ev.pointsChange > 0 ? `+${ev.pointsChange}` : ev.pointsChange} pts)` : ''}</td>
            </tr>
          `
            )
            .join('')}
        </table>`
  }

  <h2>5. Espacio Editable para Intervención Docente y Acuerdos</h2>
  <table>
    <tr>
      <td style="height: 85px; background-color: #fafafa; color: #475569;">
        <strong>Observaciones / Compromisos acordados (espacio editable en Google Docs):</strong><br/><br/>
        • Fortalezas observadas:<br/>
        • Aspectos a mejorar / contenidos pendientes:<br/>
        • Acuerdos con el estudiante y la familia:
      </td>
    </tr>
  </table>

  <table style="border: none; margin-top: 36px;">
    <tr>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Firma y Aclaración Docente</strong>
      </td>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Firma Estudiante / Familia</strong>
      </td>
      <td style="border: none; border-top: 1px dashed #64748b; text-align: center; width: 33%; padding-top: 8px;">
        <strong>Equipo Directivo / Preceptoría</strong>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
