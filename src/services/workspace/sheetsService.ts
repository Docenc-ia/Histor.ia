/**
 * Google Sheets Integration Service
 * Endpoint: https://sheets.googleapis.com/v4/spreadsheets
 * Scope: https://www.googleapis.com/auth/spreadsheets
 */

import { getCachedAccessToken } from './googleAuth';
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
          if (folderId) {
            await driveService.moveFileToFolder(sheetData.spreadsheetId, folderId);
          }
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
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

      // If there is only one default sheet like "Sheet1" or "Hoja 1", and "Alumnos y Disposición" is requested, rename it
      if (
        sheetTitles.includes('Alumnos y Disposición') &&
        !existingTitles.includes('Alumnos y Disposición') &&
        existingSheets.length > 0 &&
        (existingSheets[0].title === 'Sheet1' ||
          existingSheets[0].title === 'Hoja 1' ||
          existingSheets[0].title.startsWith('Hoja'))
      ) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: existingSheets[0].sheetId,
              title: 'Alumnos y Disposición',
            },
            fields: 'title',
          },
        });
        existingTitles.push('Alumnos y Disposición');
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
   * Updates immediately when an absence or disposition is logged or removed
   */
  async syncDispositionSheet(
    course: { id: string; name: string },
    students: Student[],
    dispositionMap: Record<string, StudentDispositionData>,
    historyList: StudentHistoryItem[],
    existingSpreadsheetId?: string,
    folderId?: string,
    providedToken?: string
  ): Promise<DispositionSheetResult> {
    const token = providedToken || getCachedAccessToken();
    const sheetTitle = `📋 Registro de Clase, Ausencias y Disposición - ${course.name}`;

    // 1. Table: "Alumnos y Disposición" (Ordenados alfabéticamente por apellido)
    const sortedStudents = [...students].sort((a, b) => {
      const lastA = (a.lastName || '').trim();
      const lastB = (b.lastName || '').trim();
      const cmp = lastA.localeCompare(lastB, 'es', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.firstName || '').trim().localeCompare((b.firstName || '').trim(), 'es', { sensitivity: 'base' });
    });

    const summaryHeaders = [
      'Apellido y Nombre',
      'Email Institucional',
      'Total Ausencias',
      'Llegadas Tarde',
      'Disposición (Escala 10)',
      'Última Incidencia / Motivo',
      'Estado Disposición',
    ];

    const summaryRows = sortedStudents.map((student) => {
      const absences = dispositionMap[student.id]?.totalAbsences ?? 0;
      const lates = dispositionMap[student.id]?.totalLates ?? 0;
      const score = dispositionMap[student.id]?.totalDisposition ?? 10;
      
      const studentHistory = historyList
        .filter((h) => h.studentId === student.id)
        .sort((a, b) => b.timestamp - a.timestamp);
      
      const lastIncident = studentHistory.length > 0
        ? `${studentHistory[0].action} (${studentHistory[0].date} ${studentHistory[0].time})`
        : 'Sin incidencias registradas';

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

    // 2. Table: "Historial de Incidencias"
    const historyHeaders = [
      'Fecha',
      'Hora',
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

      const messageSentTick = item.messageSent ? '✓' : 'Pendiente';
      const messageContent = item.messageText || (item.messageSent ? '(Sin texto adicional)' : '-');

      return [
        item.date,
        item.time,
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
          // Ensure both tabs exist in the existing spreadsheet
          await this.ensureSheetsExist(existingSpreadsheetId, token, [
            'Alumnos y Disposición',
            'Historial de Incidencias',
          ]);

          // Clear old data from both sheets safely with URL encoding
          try {
            await Promise.all([
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'Alumnos y Disposición'!A1:Z500")}:clear`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                }
              ),
              fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}/values/${encodeURIComponent("'Historial de Incidencias'!A1:Z2000")}:clear`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
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

          // Batch update both sheets with current active rows
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
                    range: "'Alumnos y Disposición'!A1",
                    values: [summaryHeaders, ...summaryRows],
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
              summaryRowsCount: summaryRows.length,
              historyRowsCount: historyRows.length,
            };
          }
        }

        // Create new spreadsheet if not existing or update failed
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
                  title: 'Alumnos y Disposición',
                  gridProperties: {
                    rowCount: Math.max(50, summaryRows.length + 10),
                    columnCount: 10,
                  },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: summaryHeaders.map((h) => ({
                          userEnteredValue: { stringValue: h },
                        })),
                      },
                      ...summaryRows.map((row) => ({
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
                    columnCount: 10,
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
          if (folderId) {
            await driveService.moveFileToFolder(sheetData.spreadsheetId, folderId);
          }
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
            isLiveGoogle: true,
            updatedAt: new Date().toLocaleTimeString(),
            summaryRowsCount: summaryRows.length,
            historyRowsCount: historyRows.length,
          };
        }
      } catch (err) {
        console.warn('Live Google Sheets call failed:', err);
      }
    }

    // Fallback/Simulated ID for local storage and fast interactive access
    const isReal = isRealGoogleSpreadsheetId(existingSpreadsheetId);
    const fallbackId = isReal ? existingSpreadsheetId! : `sheet-disp-${course.id}`;
    return {
      spreadsheetId: fallbackId,
      url: isReal ? `https://docs.google.com/spreadsheets/d/${fallbackId}/edit` : '',
      isLiveGoogle: isReal,
      updatedAt: new Date().toLocaleTimeString(),
      summaryRowsCount: summaryRows.length,
      historyRowsCount: historyRows.length,
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
    const token = providedToken || getCachedAccessToken();
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
    const token = providedToken || getCachedAccessToken();
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
            if (folderId) {
              await driveService.moveFileToFolder(sheetIdToUse, folderId);
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
