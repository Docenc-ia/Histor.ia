import { LibroDeTemasMetadata, ScheduledRow } from '../components/modules/LibroDeTemasMatrix';

export function buildOfficialLibroDeTemasHtml(params: {
  filteredRows: ScheduledRow[];
  metadata: LibroDeTemasMetadata;
  activeWeekdaysLabel: string;
  scheduleSummaryText: string;
}): string {
  const { filteredRows, metadata, activeWeekdaysLabel, scheduleSummaryText } = params;

  const rowsHtml = filteredRows
    .map((row) => {
      const isHol = row.entry.isHoliday;
      const bgRow = isHol ? '#f8fafc' : '#ffffff';
      const textStyle = isHol ? 'color:#475569;font-style:italic;' : 'color:#0f172a;';
      return `<tr style="background-color:${bgRow};${textStyle}">
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:36px;">${row.day}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:36px;">${row.month}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-family:monospace;font-size:8.5pt;width:80px;">${row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-')}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;font-weight:bold;width:54px;">${row.computedClassNumber}</td>
          <td style="border:1px solid #1e293b;padding:6px 4px;text-align:center;width:58px;">${
            isHol ? '-' : row.entry.unitNumber || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 8px;text-align:left;width:340px;">${
            (row.entry.contents || '').replace(/\n/g, '<br/>')
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;width:120px;">${
            isHol ? '-' : row.entry.classCharacter || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 8px;text-align:left;width:160px;">${
            (row.entry.observations || '').replace(/\n/g, '<br/>')
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;font-style:italic;width:95px;">${
            row.entry.teacherSignature || ''
          }</td>
          <td style="border:1px solid #1e293b;padding:6px 6px;text-align:center;width:95px;">${
            row.entry.authoritySignature || ''
          }</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Libro de Temas - ${metadata.asignatura}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:20px;font-size:10pt;">
  <!-- ENCABEZADO OFICIAL DEL LIBRO DE TEMAS -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:2px solid #0f172a;">
    <tr>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:40%;font-size:10.5pt;">
        <strong>ASIGNATURA:</strong> ${metadata.asignatura}
      </td>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:30%;font-size:10.5pt;">
        <strong>PROF. TITULAR:</strong> ${metadata.profTitular}
      </td>
      <td style="padding:8px 12px;border:1px solid #0f172a;width:30%;font-size:10.5pt;">
        <strong>DÍAS DE CLASE:</strong> ${activeWeekdaysLabel}${scheduleSummaryText ? ` (${scheduleSummaryText})` : ''}
      </td>
    </tr>
  </table>

  <!-- TABLA OFICIAL DEL LIBRO DE TEMAS -->
  <table style="width:100%;border-collapse:collapse;border:2px solid #0f172a;font-size:9.5pt;">
    <thead>
      <tr style="background-color:#e2e8f0;color:#0f172a;">
        <th colspan="3" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">FECHA</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Clase<br/>N°</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Unidad<br/>N°</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 8px;text-align:center;font-weight:bold;letter-spacing:1px;">CONTENIDOS</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 6px;text-align:center;font-weight:bold;">Carácter de<br/>la clase</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 8px;text-align:center;font-weight:bold;letter-spacing:0.5px;">OBSERVACIONES</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Firma del<br/>Profesor</th>
        <th rowspan="2" style="border:1px solid #0f172a;padding:6px 4px;text-align:center;font-weight:bold;">Firma de la<br/>Autoridad</th>
      </tr>
      <tr style="background-color:#f1f5f9;color:#0f172a;">
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Día</th>
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Mes</th>
        <th style="border:1px solid #0f172a;padding:4px;text-align:center;font-size:8.5pt;">Hora</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}
