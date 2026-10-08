/**
 * Google Sheets Integration Service
 * Endpoint: https://sheets.googleapis.com/v4/spreadsheets
 * Scope: https://www.googleapis.com/auth/spreadsheets
 */

import {
  getCachedAccessToken,
  setCachedAccessToken,
  isValidGoogleAccessToken,
  requestGoogleAccessToken,
} from './googleAuth';
import { Student, GradeEntry, StudentHistoryItem, StudentDispositionData } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';

export interface DispositionSheetResult {
  spreadsheetId: string;
  url: string;
  isLiveGoogle: boolean;
  updatedAt: string;
  summaryRowsCount: number;
  historyRowsCount: number;
  error?: string;
  errorCode?: 'NO_TOKEN' | 'UNAUTHORIZED' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'SYNC_FAILED' | string;
}

export const sheetsService = {
  /**
   * Export or synchronize Student Gradebook with Google Sheets
   */
  async syncGradebookToSheet(
    courseName: string,
    students: Student[],
    evaluations: string[],
    grades: GradeEntry[],
    folderId?: string
  ): Promise<{ spreadsheetId: string; url?: string; isLiveGoogle?: boolean }> {
    const token = getCachedAccessToken();
    const sheetTitle = `📊 Planilla de Calificaciones - ${courseName}`;

    // Build the 2D values array
    // Headers: [ 'Alumno', 'Email', ...evaluations, 'Promedio Final', 'Estado' ]
    const headerRow = ['Apellido y Nombre', 'Correo Institucional', ...evaluations, 'Promedio', 'Condición'];
    const rows = students.map((student) => {
      const studentGrades = evaluations.map((evalTitle) => {
        const entry = grades.find(
          (g) => g.studentId === student.id && g.evaluationTitle === evalTitle
        );
        return entry ? entry.score : '';
      });

      const validScores = studentGrades.filter((s) => typeof s === 'number') as number[];
      const avg = validScores.length > 0
        ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)
        : '-';
      const condition = validScores.length > 0 && parseFloat(avg as string) >= 6 ? 'Aprobado' : 'En proceso';

      return [`${student.lastName}, ${student.firstName}`, student.email, ...studentGrades, avg, condition];
    });

    if (token) {
      try {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [
              {
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      { values: headerRow.map((h) => ({ userEnteredValue: { stringValue: h } })) },
                      ...rows.map((row) => ({
                        values: row.map((cell) => ({
                          userEnteredValue: typeof cell === 'number' ? { numberValue: cell } : { stringValue: String(cell) },
                        })),
                      })),
                    ],
                  },
                ],
              },
            ],
          }),
        });

        if (createRes.ok) {
          const sheetData = await createRes.json();
          let targetFolderId = folderId;
          if (!targetFolderId) {
            try {
              const folders = await driveService.setupCourseFolderStructure(courseName, undefined, token);
              targetFolderId = folders.gradesFolder.id || folders.mainFolder.id;
            } catch (_) {}
          }
          if (targetFolderId) {
            await driveService.moveFileToFolder(sheetData.spreadsheetId, targetFolderId, token);
          }
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
            isLiveGoogle: true,
          };
        }
      } catch (err) {
        console.warn('Live Google Sheets call failed, falling back to simulated link:', err);
      }
    }

    const fallbackId = `sheet-${Date.now().toString().slice(-4)}`;
    return {
      spreadsheetId: fallbackId,
      url: undefined,
      isLiveGoogle: false,
    };
  },

  /**
   * Generates a downloadable CSV directly formatted for Google Sheets import
   */
  exportToCsv(
    courseName: string,
    students: Student[],
    evaluations: string[],
    grades: GradeEntry[]
  ) {
    const headers = ['Apellido y Nombre', 'Correo Institucional', ...evaluations, 'Promedio', 'Condición'];
    const rows = students.map((student) => {
      const studentGrades = evaluations.map((evalTitle) => {
        const entry = grades.find((g) => g.studentId === student.id && g.evaluationTitle === evalTitle);
        return entry ? entry.score : '';
      });
      const validScores = studentGrades.filter((s) => typeof s === 'number') as number[];
      const avg = validScores.length > 0 ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2) : '-';
      const condition = validScores.length > 0 && parseFloat(avg as string) >= 6 ? 'Aprobado' : 'En proceso';

      return [
        `"${student.lastName}, ${student.firstName}"`,
        `"${student.email}"`,
        ...studentGrades.map((g) => `"${g}"`),
        `"${avg}"`,
        `"${condition}"`,
      ].join(',');
    });

    const csvContent = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Calificaciones_${courseName.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Helper to ensure specific sheets (tabs) exist in an existing Google Spreadsheet
   */
  async ensureSheetsExist(
    spreadsheetId: string,
    token: string,
    sheetTitles: string[]
  ): Promise<void> {
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!metaRes.ok) return;
      const meta = await metaRes.json();
      const existingSheets: { sheetId: number; title: string }[] =
        meta.sheets?.map((s: any) => s.properties) || [];
      const existingTitles = existingSheets.map((s) => s.title);

      const requests: any[] = [];

      // If there is only one default sheet like "Sheet1" or "Hoja 1", and desired title is requested, rename it
      if (
        sheetTitles.length > 0 &&
        existingSheets.length > 0 &&
        (existingSheets[0].title === 'Sheet1' ||
          existingSheets[0].title === 'Hoja 1' ||
          existingSheets[0].title.startsWith('Hoja')) &&
        !existingTitles.includes(sheetTitles[0])
      ) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: existingSheets[0].sheetId,
              title: sheetTitles[0],
            },
            fields: 'title',
          },
        });
        existingTitles.push(sheetTitles[0]);
      }

      // Add missing sheet tabs
      for (const title of sheetTitles) {
        if (!existingTitles.includes(title)) {
          requests.push({
            addSheet: {
              properties: {
                title,
                gridProperties: {
                  rowCount: 500,
                  columnCount: 15,
                },
              },
            },
          });
        }
      }

      if (requests.length > 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
        });
      }
    } catch (e) {
      console.warn('Notice verifying sheets structure:', e);
    }
  },

  /**
   * Real-time synchronization of Class Attendance, Disposition & History with Google Sheets
   * Creates/Updates separate sheets for 1° Cuatrimestre, 2° Cuatrimestre, Resumen Anual and Historial de Incidencias
   */
  async syncDispositionSheet(
    course: { id: string; name: string },
    students: Student[],
    dispositionMap: Record<string, StudentDispositionData>,
    historyList: StudentHistoryItem[],
    existingSpreadsheetId?: string,
    folderId?: string,
    providedToken?: string,
    dispositionMap2c?: Record<string, StudentDispositionData>
  ): Promise<DispositionSheetResult> {
    let token = providedToken && isValidGoogleAccessToken(providedToken) ? providedToken : getCachedAccessToken();
    const sheetTitle = `📋 Registro de Asistencia y Disposición - ${course.name}`;

    // Sort students alphabetically by last name, then first name
    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    const map1c = dispositionMap || {};
    const map2c = dispositionMap2c || {};

    // 1. Table: "1° Cuatrimestre"
    const summaryHeaders1c = [
      'Apellido y Nombre',
      'Email Institucional',
      'Ausencias 1C',
      'Llegadas Tarde 1C',
      'Disposición 1C (Escala 10)',
      'Última Incidencia 1C',
      'Estado 1C',
    ];

    const summaryRows1c = sortedStudents.map((student) => {
      const absences = map1c[student.id]?.totalAbsences ?? 0;
      const lates = map1c[student.id]?.totalLates ?? 0;
      const score = map1c[student.id]?.totalDisposition ?? 10;

      const studentHistory1c = historyList
        .filter((h) => h.studentId === student.id && (h.term === '1c' || !h.term))
        .sort((a, b) => b.timestamp - a.timestamp);

      const lastIncident = studentHistory1c.length > 0
        ? `${studentHistory1c[0].action} (${studentHistory1c[0].date} ${studentHistory1c[0].time})`
        : 'Sin incidencias en 1C';

      const condition = score >= 8
        ? 'Excelente (>=8)'
        : score >= 6
        ? 'Regular (6-7)'
        : 'Requiere atención (<6)';

      return [
        `${student.lastName}, ${student.firstName}`,
        student.email,
        absences,
        lates,
        score,
        lastIncident,
        condition,
      ];
    });

    // 2. Table: "2° Cuatrimestre"
    const summaryHeaders2c = [
      'Apellido y Nombre',
      'Email Institucional',
      'Ausencias 2C',
      'Llegadas Tarde 2C',
      'Disposición 2C (Escala 10)',
      'Última Incidencia 2C',
      'Estado 2C',
    ];

    const summaryRows2c = sortedStudents.map((student) => {
      const absences = map2c[student.id]?.totalAbsences ?? 0;
      const lates = map2c[student.id]?.totalLates ?? 0;
      const score = map2c[student.id]?.totalDisposition ?? 10;

      const studentHistory2c = historyList
        .filter((h) => h.studentId === student.id && h.term === '2c')
        .sort((a, b) => b.timestamp - a.timestamp);

      const lastIncident = studentHistory2c.length > 0
        ? `${studentHistory2c[0].action} (${studentHistory2c[0].date} ${studentHistory2c[0].time})`
        : 'Sin incidencias en 2C';

      const condition = score >= 8
        ? 'Excelente (>=8)'
        : score >= 6
        ? 'Regular (6-7)'
        : 'Requiere atención (<6)';

      return [
        `${student.lastName}, ${student.firstName}`,
        student.email,
        absences,
        lates,
        score,
        lastIncident,
        condition,
      ];
    });

    // 3. Table: "Resumen Anual" (Consolidado de ambos cuatrimestres)
    const annualHeaders = [
      'Apellido y Nombre',
      'Email Institucional',
      'Total Ausencias Anual',
      'Total Tardanzas Anual',
      'Promedio Disposición Anual',
      'Disposición 1C',
      'Disposición 2C',
      '% Asistencia Estimada',
      'Condición Anual',
    ];

    const annualRows = sortedStudents.map((student) => {
      const abs1 = map1c[student.id]?.totalAbsences ?? 0;
      const abs2 = map2c[student.id]?.totalAbsences ?? 0;
      const totalAbs = abs1 + abs2;

      const lat1 = map1c[student.id]?.totalLates ?? 0;
      const lat2 = map2c[student.id]?.totalLates ?? 0;
      const totalLat = lat1 + lat2;

      const disp1 = map1c[student.id]?.totalDisposition ?? 10;
      const disp2 = map2c[student.id]?.totalDisposition ?? 10;
      const avgDisp = Number(((disp1 + disp2) / 2).toFixed(1));

      // Asistencia estimada sobre base típica de clases
      const estimatedAttendance = Math.max(0, Math.min(100, Math.round(100 - (totalAbs * 2.5) - (totalLat * 0.8))));
      const cond = estimatedAttendance < 75 || avgDisp < 6
        ? 'Alerta pedagógica'
        : avgDisp >= 8 && estimatedAttendance >= 85
        ? 'Excelente'
        : 'Regular';

      return [
        `${student.lastName}, ${student.firstName}`,
        student.email,
        totalAbs,
        totalLat,
        avgDisp,
        disp1,
        disp2,
        `${estimatedAttendance}%`,
        cond,
      ];
    });

    // 4. Table: "Historial de Incidencias"
    const historyHeaders = [
      'Fecha',
      'Hora',
      'Cuatrimestre',
      'Estudiante',
      'Categoría',
      'Motivo de Conducta',
      'Impacto',
      'Disposición Resultante',
      'Mensaje enviado',
      'Mensaje',
      'ID Registro',
    ];

    const historyRows = historyList.map((item) => {
      const is2c = item.term === '2c';
      const termLabel = is2c ? '2° Cuatrimestre' : '1° Cuatrimestre';
      const studentMap = is2c ? map2c : map1c;
      const studentScore = studentMap[item.studentId]?.totalDisposition ?? 10;
      const isItemAbsence =
        item.category === 'Ausencia' ||
        item.action === 'Ausencia' ||
        item.action?.toLowerCase().includes('ausencia') ||
        item.action?.toLowerCase().includes('falta');
      const isItemLate =
        item.category === 'Llegada tarde' ||
        item.action === 'Llegada tarde' ||
        item.action?.toLowerCase().includes('llegada tarde') ||
        item.action?.toLowerCase().includes('tarde') ||
        item.action?.toLowerCase().includes('tardanza');

      const impact = isItemAbsence
        ? 'Ausencia'
        : isItemLate
        ? 'Tardanza'
        : item.pointsChange !== undefined && item.pointsChange !== 0
        ? (item.pointsChange > 0 ? `+${item.pointsChange} pto` : `${item.pointsChange} pto`)
        : '-';

      const messageSentTick = item.messageSent ? '✓' : 'Pendiente';
      const messageContent = item.messageText || (item.messageSent ? '(Sin texto adicional)' : '-');

      return [
        item.date,
        item.time,
        termLabel,
        item.studentName,
        item.category,
        item.action,
        impact,
        studentScore,
        messageSentTick,
        messageContent,
        item.id,
      ];
    });

    // Real Google Sheets API call if access token is available
    if (token) {
      try {
        if (existingSpreadsheetId && isRealGoogleSpreadsheetId(existingSpreadsheetId)) {
          // Ensure all 4 tabs exist in the existing spreadsheet
          await this.ensureSheetsExist(existingSpreadsheetId, token, [
            '1° Cuatrimestre',
            '2° Cuatrimestre',
            'Resumen Anual',
            'Historial de Incidencias',
          ]);

          // Clear old data safely from tabs
          try {
            await Promise.all([
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'1° Cuatrimestre'!A1:Z500")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                }
              ),
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'2° Cuatrimestre'!A1:Z500")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                }
              ),
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'Resumen Anual'!A1:Z500")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                }
              ),
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'Historial de Incidencias'!A1:Z3000")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                }
              ),
            ]);
          } catch (e) {
            console.warn('Notice clearing sheet cells before batch update:', e);
          }

          const historyPayload =
            historyRows.length > 0
              ? historyRows
              : [
                  [
                    new Date().toLocaleDateString('es-AR'),
                    new Date().toLocaleTimeString('es-AR'),
                    '1° Cuatrimestre',
                    'Toda la clase',
                    'Sistema',
                    'Sin incidencias registradas aún en el curso',
                    '-',
                    10,
                    '-',
                    '-',
                    '-',
                  ],
                ];

          // Batch update all 4 sheets with current active rows
          const updateRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values:batchUpdate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                valueInputOption: 'USER_ENTERED',
                data: [
                  {
                    range: "'1° Cuatrimestre'!A1",
                    values: [summaryHeaders1c, ...summaryRows1c],
                  },
                  {
                    range: "'2° Cuatrimestre'!A1",
                    values: [summaryHeaders2c, ...summaryRows2c],
                  },
                  {
                    range: "'Resumen Anual'!A1",
                    values: [annualHeaders, ...annualRows],
                  },
                  {
                    range: "'Historial de Incidencias'!A1",
                    values: [historyHeaders, ...historyPayload],
                  },
                ],
              }),
            }
          );

          if (updateRes.ok) {
            return {
              spreadsheetId: existingSpreadsheetId,
              url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
              isLiveGoogle: true,
              updatedAt: new Date().toLocaleTimeString(),
              summaryRowsCount: summaryRows1c.length,
              historyRowsCount: historyRows.length,
            };
          } else {
            const errStatus = updateRes.status;
            let errDetail = 'Error al actualizar Google Sheets';
            try {
              const errJson = await updateRes.json();
              errDetail = errJson?.error?.message || errDetail;
            } catch (_) {}

            if (errStatus === 401) {
              setCachedAccessToken(null);
              // Attempt to recover automatically with a fresh OAuth access token
              try {
                const freshToken = await requestGoogleAccessToken(true);
                if (freshToken && isValidGoogleAccessToken(freshToken)) {
                  const retryRes = await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values:batchUpdate`,
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${freshToken}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        valueInputOption: 'USER_ENTERED',
                        data: [
                          {
                            range: "'1° Cuatrimestre'!A1",
                            values: [summaryHeaders1c, ...summaryRows1c],
                          },
                          {
                            range: "'2° Cuatrimestre'!A1",
                            values: [summaryHeaders2c, ...summaryRows2c],
                          },
                          {
                            range: "'Resumen Anual'!A1",
                            values: [annualHeaders, ...annualRows],
                          },
                          {
                            range: "'Historial de Incidencias'!A1",
                            values: [historyHeaders, ...historyPayload],
                          },
                        ],
                      }),
                    }
                  );
                  if (retryRes.ok) {
                    return {
                      spreadsheetId: existingSpreadsheetId,
                      url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
                      isLiveGoogle: true,
                      updatedAt: new Date().toLocaleTimeString(),
                      summaryRowsCount: summaryRows1c.length,
                      historyRowsCount: historyRows.length,
                    };
                  }
                }
              } catch (_) {}

              return {
                spreadsheetId: existingSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
                isLiveGoogle: false,
                updatedAt: new Date().toLocaleTimeString(),
                summaryRowsCount: summaryRows1c.length,
                historyRowsCount: historyRows.length,
                error: 'Tu sesión de Google expiró. Por favor vuelve a conectar tu cuenta institucional.',
                errorCode: 'UNAUTHORIZED',
              };
            }

            if (errStatus === 403) {
              return {
                spreadsheetId: existingSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
                isLiveGoogle: false,
                updatedAt: new Date().toLocaleTimeString(),
                summaryRowsCount: summaryRows1c.length,
                historyRowsCount: historyRows.length,
                error: 'Permiso denegado. Asegúrate de que tu cuenta de Google tenga permisos de edición en la planilla.',
                errorCode: 'PERMISSION_DENIED',
              };
            }

            if (errStatus === 404) {
              return {
                spreadsheetId: existingSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
                isLiveGoogle: false,
                updatedAt: new Date().toLocaleTimeString(),
                summaryRowsCount: summaryRows1c.length,
                historyRowsCount: historyRows.length,
                error: 'No se encontró la hoja de cálculo en Google Drive.',
                errorCode: 'NOT_FOUND',
              };
            }

            return {
              spreadsheetId: existingSpreadsheetId,
              url: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
              isLiveGoogle: false,
              updatedAt: new Date().toLocaleTimeString(),
              summaryRowsCount: summaryRows1c.length,
              historyRowsCount: historyRows.length,
              error: errDetail,
              errorCode: 'SYNC_FAILED',
            };
          }
        }

        // Create new spreadsheet with all 4 sheets if no real existing ID was provided
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [
              {
                properties: {
                  title: '1° Cuatrimestre',
                  gridProperties: {
                    rowCount: Math.max(50, summaryRows1c.length + 10),
                    columnCount: 10,
                  },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: summaryHeaders1c.map((h) => ({
                          userEnteredValue: { stringValue: h },
                        })),
                      },
                      ...summaryRows1c.map((row) => ({
                        values: row.map((cell) => ({
                          userEnteredValue:
                            typeof cell === 'number'
                              ? { numberValue: cell }
                              : { stringValue: String(cell) },
                        })),
                      })),
                    ],
                  },
                ],
              },
              {
                properties: {
                  title: '2° Cuatrimestre',
                  gridProperties: {
                    rowCount: Math.max(50, summaryRows2c.length + 10),
                    columnCount: 10,
                  },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: summaryHeaders2c.map((h) => ({
                          userEnteredValue: { stringValue: h },
                        })),
                      },
                      ...summaryRows2c.map((row) => ({
                        values: row.map((cell) => ({
                          userEnteredValue:
                            typeof cell === 'number'
                              ? { numberValue: cell }
                              : { stringValue: String(cell) },
                        })),
                      })),
                    ],
                  },
                ],
              },
              {
                properties: {
                  title: 'Resumen Anual',
                  gridProperties: {
                    rowCount: Math.max(50, annualRows.length + 10),
                    columnCount: 12,
                  },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: annualHeaders.map((h) => ({
                          userEnteredValue: { stringValue: h },
                        })),
                      },
                      ...annualRows.map((row) => ({
                        values: row.map((cell) => ({
                          userEnteredValue:
                            typeof cell === 'number'
                              ? { numberValue: cell }
                              : { stringValue: String(cell) },
                        })),
                      })),
                    ],
                  },
                ],
              },
              {
                properties: {
                  title: 'Historial de Incidencias',
                  gridProperties: {
                    rowCount: Math.max(100, historyRows.length + 15),
                    columnCount: 12,
                  },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: historyHeaders.map((h) => ({
                          userEnteredValue: { stringValue: h },
                        })),
                      },
                      ...(historyRows.length > 0
                        ? historyRows
                        : [
                            [
                              new Date().toLocaleDateString('es-AR'),
                              new Date().toLocaleTimeString('es-AR'),
                              '1° Cuatrimestre',
                              'Toda la clase',
                              'Sistema',
                              'Sin incidencias registradas aún en el curso',
                              '-',
                              10,
                              '-',
                              '-',
                              '-',
                            ],
                          ]
                      ).map((row) => ({
                        values: row.map((cell) => ({
                          userEnteredValue:
                            typeof cell === 'number'
                              ? { numberValue: cell }
                              : { stringValue: String(cell) },
                        })),
                      })),
                    ],
                  },
                ],
              },
            ],
          }),
        });

        if (createRes.ok) {
          const sheetData = await createRes.json();
          let targetFolderId = folderId;
          if (!targetFolderId) {
            try {
              const folders = await driveService.setupCourseFolderStructure(course.name, undefined, token);
              targetFolderId = folders.attendanceFolder.id || folders.mainFolder.id;
            } catch (_) {}
          }
          if (targetFolderId) {
            await driveService.moveFileToFolder(sheetData.spreadsheetId, targetFolderId, token);
          }
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
            isLiveGoogle: true,
            updatedAt: new Date().toLocaleTimeString(),
            summaryRowsCount: summaryRows1c.length,
            historyRowsCount: historyRows.length,
          };
        } else {
          const createStatus = createRes.status;
          let createErr = 'No se pudo crear la hoja en Google Drive';
          try {
            const errJson = await createRes.json();
            createErr = errJson?.error?.message || createErr;
          } catch (_) {}

          return {
            spreadsheetId: `sheet-disp-${course.id}`,
            url: '',
            isLiveGoogle: false,
            updatedAt: new Date().toLocaleTimeString(),
            summaryRowsCount: summaryRows1c.length,
            historyRowsCount: historyRows.length,
            error: createErr,
            errorCode: createStatus === 401 ? 'UNAUTHORIZED' : createStatus === 403 ? 'PERMISSION_DENIED' : 'SYNC_FAILED',
          };
        }
      } catch (err: any) {
        console.warn('Live Google Sheets call failed:', err);
        return {
          spreadsheetId: isRealGoogleSpreadsheetId(existingSpreadsheetId) ? existingSpreadsheetId! : `sheet-disp-${course.id}`,
          url: isRealGoogleSpreadsheetId(existingSpreadsheetId) ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit` : '',
          isLiveGoogle: false,
          updatedAt: new Date().toLocaleTimeString(),
          summaryRowsCount: summaryRows1c.length,
          historyRowsCount: historyRows.length,
          error: err?.message || 'Error de red o conexión con Google Sheets',
          errorCode: 'NETWORK_ERROR',
        };
      }
    }

    // If no token was provided or found
    const isReal = isRealGoogleSpreadsheetId(existingSpreadsheetId);
    const fallbackId = isReal ? existingSpreadsheetId! : `sheet-disp-${course.id}`;
    return {
      spreadsheetId: fallbackId,
      url: isReal ? `https://docs.google.com/spreadsheets/d/${fallbackId}/edit` : '',
      isLiveGoogle: false,
      updatedAt: new Date().toLocaleTimeString(),
      summaryRowsCount: summaryRows1c.length,
      historyRowsCount: historyRows.length,
      error: 'No hay sesión de Google activa con permisos de edición.',
      errorCode: 'NO_TOKEN',
    };
  },

  /**
   * Save and archive a full snapshot of the term's closing notes, absences, lates, and history in Google Sheets
   */
  async saveCuatrimestreSnapshotToSheet(
    course: { id: string; name: string },
    term: '1c' | '2c',
    students: Student[],
    dispositionMap: Record<string, StudentDispositionData>,
    historyList: StudentHistoryItem[],
    existingSpreadsheetId?: string,
    folderId?: string,
    providedToken?: string
  ): Promise<{ success: boolean; spreadsheetId?: string; url?: string; tabName: string }> {
    const token = providedToken && isValidGoogleAccessToken(providedToken) ? providedToken : getCachedAccessToken();
    const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    const tabName = `Cierre ${termLabel}`;

    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    const now = new Date();
    const formattedDate = `${now.toLocaleDateString('es-AR')} ${now.toLocaleTimeString('es-AR')}`;

    const titleRow = [`🎓 ACTA DE CIERRE DE DISPOSICIÓN Y ASISTENCIA - ${termLabel.toUpperCase()}`];
    const subtitleRow = [`Materia: ${course.name} | Fecha de Cierre: ${formattedDate} | Total Estudiantes: ${sortedStudents.length}`];
    const emptyRow: string[] = [];

    const summaryHeaders = [
      '#',
      'Apellido y Nombre',
      'Email Institucional',
      'Nota Disposición Final (1-10)',
      'Total Ausencias',
      'Total Llegadas Tarde',
      'Incidencias Registradas',
      'Condición Final',
      'Estado en Calificaciones',
    ];

    const studentRows = sortedStudents.map((student, idx) => {
      const absences = dispositionMap[student.id]?.totalAbsences ?? 0;
      const lates = dispositionMap[student.id]?.totalLates ?? 0;
      const score = dispositionMap[student.id]?.totalDisposition ?? 10;
      const studentHistory = historyList.filter((h) => h.studentId === student.id);
      const condition = score >= 8 ? 'Excelente (>=8)' : score >= 6 ? 'Regular (6-7)' : 'Requiere atención (<6)';

      return [
        idx + 1,
        `${student.lastName}, ${student.firstName}`,
        student.email,
        score,
        absences,
        lates,
        studentHistory.length,
        condition,
        'Vinculado a Libreta',
      ];
    });

    const sectionHistoryTitle = ['--- BITÁCORA DETALLADA DE INCIDENCIAS DEL CUATRIMESTRE ---'];
    const historyHeaders = [
      'Fecha',
      'Hora',
      'Estudiante',
      'Categoría',
      'Motivo / Registro',
      'Impacto',
      'Disposición Resultante',
      'Notificación',
      'Mensaje Enviado',
    ];

    const historyRows = historyList.map((item) => {
      const studentScore = dispositionMap[item.studentId]?.totalDisposition ?? 10;
      const isItemAbsence =
        item.category === 'Ausencia' ||
        item.action === 'Ausencia' ||
        item.action?.toLowerCase().includes('ausencia') ||
        item.action?.toLowerCase().includes('falta');
      const isItemLate =
        item.category === 'Llegada tarde' ||
        item.action === 'Llegada tarde' ||
        item.action?.toLowerCase().includes('llegada tarde') ||
        item.action?.toLowerCase().includes('tarde') ||
        item.action?.toLowerCase().includes('tardanza');

      const impact = isItemAbsence
        ? 'Ausencia'
        : isItemLate
        ? 'Tardanza'
        : item.pointsChange !== undefined && item.pointsChange !== 0
        ? (item.pointsChange > 0 ? `+${item.pointsChange} pto` : `${item.pointsChange} pto`)
        : '-';

      return [
        item.date,
        item.time,
        item.studentName,
        item.category,
        item.action,
        impact,
        studentScore,
        item.messageSent ? 'Enviado' : 'Pendiente',
        item.messageText || '-',
      ];
    });

    const fullTabRows = [
      titleRow,
      subtitleRow,
      emptyRow,
      summaryHeaders,
      ...studentRows,
      emptyRow,
      sectionHistoryTitle,
      historyHeaders,
      ...(historyRows.length > 0
        ? historyRows
        : [['-', '-', 'Toda la clase', 'Sistema', 'Sin incidencias registradas en este período', '-', '-', '-', '-']]),
    ];

    if (token) {
      try {
        let sheetIdToUse = existingSpreadsheetId;
        if (!sheetIdToUse || sheetIdToUse.startsWith('sheet-disp-')) {
          const syncRes = await this.syncDispositionSheet(
            course,
            students,
            dispositionMap,
            historyList,
            undefined,
            folderId,
            token
          );
          sheetIdToUse = syncRes.spreadsheetId;
        }

        if (sheetIdToUse && !sheetIdToUse.startsWith('sheet-disp-')) {
          await this.ensureSheetsExist(sheetIdToUse, token, [tabName]);

          // Clear previous content of tab if re-closing safely with URL encoding
          try {
            await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1:Z2000`)}:clear`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              }
            );
          } catch (_) {}

          // Write complete archive
          const updateRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: fullTabRows }),
            }
          );

          if (updateRes.ok) {
            return {
              success: true,
              spreadsheetId: sheetIdToUse,
              url: `https://docs.google.com/spreadsheets/d/${sheetIdToUse}/edit`,
              tabName,
            };
          }
        }
      } catch (err) {
        console.warn('Error saving cuatrimestre closure to Google Sheets:', err);
      }
    }

    return {
      success: true,
      spreadsheetId: existingSpreadsheetId,
      url: existingSpreadsheetId && isRealGoogleSpreadsheetId(existingSpreadsheetId)
        ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`
        : undefined,
      tabName,
    };
  },

  /**
   * Save and synchronize the complete Gradebook Matrix for a specific term (1° or 2° Cuatrimestre) to Google Sheets
   * Creates or updates a dedicated tab "Calificaciones - 1° Cuatrimestre" or "Calificaciones - 2° Cuatrimestre"
   */
  async syncGradebookMatrixToSheet(
    course: { id: string; name: string },
    term: '1c' | '2c',
    students: Student[],
    categories: GradeCategory[],
    gradesMap: Record<string, Record<string, string>>,
    existingSpreadsheetId?: string,
    folderId?: string,
    providedToken?: string
  ): Promise<{
    spreadsheetId: string;
    url: string;
    tabName: string;
    isLiveGoogle: boolean;
    updatedAt: string;
  }> {
    const token = providedToken && isValidGoogleAccessToken(providedToken) ? providedToken : getCachedAccessToken();
    const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    const tabName = `Calificaciones - ${termLabel}`;

    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    // Flatten all subcategories from categories
    const assessmentColumns: { id: string; header: string; maxScore?: number }[] = [];
    categories.forEach((cat) => {
      if (!cat.subcategories || cat.subcategories.length === 0) {
        assessmentColumns.push({ id: cat.id, header: cat.name });
      } else {
        cat.subcategories.forEach((sub) => {
          assessmentColumns.push({
            id: sub.id,
            header: `${cat.name} - ${sub.name}`,
            maxScore: sub.maxScore,
          });
        });
      }
    });

    const now = new Date();
    const formattedTimestamp = `${now.toLocaleDateString('es-AR')} ${now.toLocaleTimeString('es-AR')}`;

    const headers = [
      'Apellido y Nombre',
      'Correo Institucional',
      ...assessmentColumns.map((col) => col.header),
      'Promedio Final',
      'Condición',
      'Última Actualización',
    ];

    const rows = sortedStudents.map((st) => {
      const stGrades = gradesMap[st.id] || {};
      const scoreValues = assessmentColumns.map((col) => stGrades[col.id] || '');

      const validNumScores = scoreValues
        .filter((s) => s !== '' && !isNaN(Number(s)))
        .map((s) => Number(s));

      const avg =
        validNumScores.length > 0
          ? (validNumScores.reduce((acc, curr) => acc + curr, 0) / validNumScores.length).toFixed(2)
          : '-';

      const condition =
        validNumScores.length > 0
          ? parseFloat(avg) >= 6
            ? 'Aprobado'
            : 'En proceso'
          : 'Sin calificaciones';

      return [
        `${st.lastName}, ${st.firstName}`,
        st.email || '',
        ...scoreValues,
        avg,
        condition,
        formattedTimestamp,
      ];
    });

    if (token) {
      try {
        let sheetIdToUse = existingSpreadsheetId;
        if (!sheetIdToUse || sheetIdToUse.startsWith('sheet-disp-')) {
          // If no existing sheet, create a new one for course grades
          const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: { title: `📊 Planilla de Calificaciones (${termLabel}) - ${course.name}` },
              sheets: [
                {
                  properties: {
                    title: tabName,
                    gridProperties: { rowCount: Math.max(50, rows.length + 10), columnCount: headers.length + 2 },
                  },
                },
              ],
            }),
          });
          if (createRes.ok) {
            const sheetData = await createRes.json();
            sheetIdToUse = sheetData.spreadsheetId;
            let targetFolderId = folderId;
            if (!targetFolderId) {
              try {
                const folders = await driveService.setupCourseFolderStructure(course.name, undefined, token);
                targetFolderId = folders.gradesFolder.id || folders.mainFolder.id;
              } catch (_) {}
            }
            if (targetFolderId) {
              await driveService.moveFileToFolder(sheetIdToUse, targetFolderId, token);
            }
          }
        }

        if (sheetIdToUse && !sheetIdToUse.startsWith('sheet-disp-')) {
          await this.ensureSheetsExist(sheetIdToUse, token, [tabName]);

          // Clear previous data in tab
          try {
            await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1:Z500`)}:clear`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              }
            );
          } catch (_) {}

          // Write updated grades matrix
          const updateRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: [headers, ...rows] }),
            }
          );

          if (updateRes.ok) {
            return {
              spreadsheetId: sheetIdToUse,
              url: `https://docs.google.com/spreadsheets/d/${sheetIdToUse}/edit`,
              tabName,
              isLiveGoogle: true,
              updatedAt: new Date().toLocaleTimeString(),
            };
          }
        }
      } catch (err) {
        console.warn('Error syncing gradebook matrix to Google Sheets:', err);
      }
    }

    const isReal = isRealGoogleSpreadsheetId(existingSpreadsheetId);
    const fallbackId = isReal ? existingSpreadsheetId! : `sheet-grades-${course.id}-${term}`;
    return {
      spreadsheetId: fallbackId,
      url: isReal ? `https://docs.google.com/spreadsheets/d/${fallbackId}/edit` : undefined,
      tabName,
      isLiveGoogle: isReal,
      updatedAt: new Date().toLocaleTimeString(),
    };
  },

  /**
   * Generates a downloadable CSV directly formatted for Google Sheets import
   */
  exportDispositionCsv(
    courseName: string,
    students: Student[],
    dispositionMap: Record<string, StudentDispositionData>,
    historyList: StudentHistoryItem[]
  ) {
    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    const summaryHeaders = ['Apellido y Nombre', 'Email', 'Total Ausencias', 'Llegadas Tarde', 'Disposición (1-10)', 'Última Incidencia', 'Estado'];
    const summaryRows = sortedStudents.map((student) => {
      const absences = dispositionMap[student.id]?.totalAbsences ?? 0;
      const lates = dispositionMap[student.id]?.totalLates ?? 0;
      const score = dispositionMap[student.id]?.totalDisposition ?? 10;
      const studentHistory = historyList
        .filter((h) => h.studentId === student.id)
        .sort((a, b) => b.timestamp - a.timestamp);
      const last = studentHistory[0] ? `${studentHistory[0].action} (${studentHistory[0].date})` : 'Sin registros';
      const cond = score >= 8 ? 'Excelente' : score >= 6 ? 'Regular' : 'Requiere atención (<6)';
      return [`"${student.lastName}, ${student.firstName}"`, `"${student.email}"`, absences, lates, score, `"${last}"`, `"${cond}"`].join(',');
    });

    const historyHeaders = ['Fecha', 'Hora', 'Estudiante', 'Categoría', 'Motivo de Conducta', 'Impacto', 'Disposición Resultante', 'Mensaje enviado', 'Mensaje'];
    const historyRows = historyList.map((h) => {
      const score = dispositionMap[h.studentId]?.totalDisposition ?? 10;
      const sentTick = h.messageSent ? '✓' : 'Pendiente';
      const cleanMsg = (h.messageText || (h.messageSent ? '(Sin texto adicional)' : '-')).replace(/"/g, '""');

      const isItemAbsence =
        h.category === 'Ausencia' ||
        h.action === 'Ausencia' ||
        h.action?.toLowerCase().includes('ausencia') ||
        h.action?.toLowerCase().includes('falta');
      const isItemLate =
        h.category === 'Llegada tarde' ||
        h.action === 'Llegada tarde' ||
        h.action?.toLowerCase().includes('llegada tarde') ||
        h.action?.toLowerCase().includes('tarde') ||
        h.action?.toLowerCase().includes('tardanza');

      const impact = isItemAbsence
        ? 'Ausencia'
        : isItemLate
        ? 'Tardanza'
        : h.pointsChange !== undefined && h.pointsChange !== 0
        ? (h.pointsChange > 0 ? `+${h.pointsChange} pto` : `${h.pointsChange} pto`)
        : '-';

      return [`"${h.date}"`, `"${h.time}"`, `"${h.studentName}"`, `"${h.category}"`, `"${h.action}"`, `"${impact}"`, score, `"${sentTick}"`, `"${cleanMsg}"`].join(',');
    });

    const csvContent = [
      '# HOJA 1: RESUMEN Y DISPOSICIÓN DE ALUMNOS',
      summaryHeaders.join(','),
      ...summaryRows,
      '',
      '# HOJA 2: HISTORIAL DE INCIDENCIAS DETALLADAS',
      historyHeaders.join(','),
      ...historyRows,
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Registro_Asistencia_Disposicion_${courseName.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Export or synchronize Preliminary Valuation (Valoración Preliminar) with Google Sheets
   * Includes all selected assessment columns, averages, qualitative rating (TEA/TEP/TED), and observations.
   */
  async syncPreliminaryValuationSheet(
    courseName: string,
    termLabel: string,
    students: Student[],
    assessmentHeaders: Array<{ id: string; name: string; categoryName: string }>,
    gradesMap: Record<string, Record<string, string>>,
    valuations: Record<string, { trajectory: string; observation: string }>,
    existingSpreadsheetId?: string
  ): Promise<{
    spreadsheetId: string;
    url: string;
    isLiveGoogle: boolean;
    updatedAt: string;
  }> {
    const token = getCachedAccessToken();
    const sheetTitle = `📋 Valoración Preliminar (${termLabel}) - ${courseName}`;

    // Header row: Alumno, Correo, [Notas seleccionadas...], Promedio, TEA/TEP, Descripción, Observación
    const headers = [
      'Apellido y Nombre',
      'Correo Institucional',
      ...assessmentHeaders.map((a) => (a.categoryName ? `${a.name} (${a.categoryName})` : a.name)),
      'Promedio Preliminar',
      'Valoración Cualitativa',
      'Descripción Trayecto',
      'Observación Pedagógica',
    ];

    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    const rows = sortedStudents.map((student) => {
      const stGrades = gradesMap[student.id] || {};
      const scoreCols = assessmentHeaders.map((a) => stGrades[a.id] || '');

      const numScores = scoreCols
        .filter((s) => s !== '' && !isNaN(Number(s)))
        .map((s) => Number(s));

      const avgStr =
        numScores.length > 0
          ? (numScores.reduce((acc, curr) => acc + curr, 0) / numScores.length).toFixed(1)
          : '-';

      const v = valuations[student.id];
      const traj = v?.trajectory || 'Sin asignar';
      let trajDesc = '';
      if (traj === 'TEA') trajDesc = 'Trayecto Educativo en Alcanzado';
      else if (traj === 'TEP') trajDesc = 'Trayecto Educativo en Proceso';
      else if (traj === 'TED') trajDesc = 'Trayecto Educativo Discontinuo';
      const obs = v?.observation || '';

      return [
        `${student.lastName}, ${student.firstName}`,
        student.email || '',
        ...scoreCols,
        avgStr,
        traj,
        trajDesc,
        obs,
      ];
    });

    if (token && isValidGoogleAccessToken(token)) {
      try {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [
              {
                properties: {
                  title: `Valoración Preliminar`,
                  gridProperties: { frozenRowCount: 1 },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: headers.map((h) => ({
                          userEnteredValue: { stringValue: h },
                          userEnteredFormat: {
                            textFormat: { bold: true },
                            backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
                          },
                        })),
                      },
                      ...rows.map((row) => ({
                        values: row.map((cell) => {
                          const isNum =
                            typeof cell === 'number' ||
                            (!isNaN(Number(cell)) && cell !== '' && cell !== '-');
                          return {
                            userEnteredValue: isNum
                              ? { numberValue: Number(cell) }
                              : { stringValue: String(cell) },
                          };
                        }),
                      })),
                    ],
                  },
                ],
              },
            ],
          }),
        });

        if (createRes.ok) {
          const sheetData = await createRes.json();
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
            isLiveGoogle: true,
            updatedAt: new Date().toLocaleTimeString(),
          };
        }
      } catch (err) {
        console.warn('Live Google Sheets call failed for preliminary valuation:', err);
      }
    }

    const isReal = isRealGoogleSpreadsheetId(existingSpreadsheetId);
    const fallbackId = isReal ? existingSpreadsheetId! : `sheet-val-${Date.now().toString().slice(-4)}`;
    return {
      spreadsheetId: fallbackId,
      url: isReal ? `https://docs.google.com/spreadsheets/d/${fallbackId}/edit` : undefined,
      isLiveGoogle: isReal,
      updatedAt: new Date().toLocaleTimeString(),
    };
  },
};
