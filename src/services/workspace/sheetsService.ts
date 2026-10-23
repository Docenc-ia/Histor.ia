/**
 * Google Sheets Integration Service
 * Endpoint: https://sheets.googleapis.com/v4/spreadsheets
 * Scope: https://www.googleapis.com/auth/spreadsheets
 */

import {
  getCachedAccessToken,
  setCachedAccessToken,
  isValidGoogleAccessToken,
  notifyGoogleSessionExpired,
  fetchGoogleApiWithRetry,
  renewGoogleSessionSilently,
  requestGoogleAccessToken,
} from './googleAuth';
import { Student, GradeEntry, StudentHistoryItem, StudentDispositionData } from '../../types';
import { GradeCategory, StudentGradesMap } from '../../types/grades';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import { getUserStorageKey } from '../storageHelpers';
import { api } from '../api';
import {
  exportGradebookToCsv,
  exportDispositionToCsv,
  syncPreliminaryValuationSheetHelper,
  syncLibroDeTemasToSheetHelper,
  fetchArbitrarySpreadsheetDataHelper,
  convert2DArrayToTableObjectsHelper,
} from './sheetsHelpers';

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

export interface SheetPullDiff {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  term: '1c' | '2c';
  termLabel: string;
  field: 'totalAbsences' | 'totalLates' | 'totalDisposition';
  fieldLabel: string;
  oldValue: number;
  newValue: number;
}

export interface SheetPullResult {
  success: boolean;
  changesCount: number;
  changes: SheetPullDiff[];
  updatedMap1c: Record<string, StudentDispositionData>;
  updatedMap2c: Record<string, StudentDispositionData>;
  message: string;
  spreadsheetId?: string;
  sheetUrl?: string;
}

export interface GradePullDiff {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  term: '1c' | '2c';
  termLabel: string;
  columnId: string;
  columnName: string;
  oldGrade: string;
  newGrade: string;
}

export interface GradeSheetPullResult {
  success: boolean;
  changesCount: number;
  changes: GradePullDiff[];
  updatedGradesMap: Record<string, Record<string, string>>;
  message: string;
  spreadsheetId?: string;
  url?: string;
}

export const sheetsService = {
  /**
   * Helper to resolve or find the specific Google Spreadsheet ID associated with a courseId.
   * Retrieves dynamically by courseId from persistent storage or searches the course's Drive folder,
   * completely avoiding static paths or shared sheets.
   */
  async resolveCourseSpreadsheetId(
    courseId: string,
    courseName?: string,
    existingId?: string,
    folderId?: string,
    providedToken?: string
  ): Promise<string | undefined> {
    const token = providedToken || getCachedAccessToken();

    // 1. If explicit real Google Spreadsheet ID is already provided and not trashed
    if (existingId && isRealGoogleSpreadsheetId(existingId)) {
      const isActive = await driveService.verifyFileIsActive(existingId, token || undefined);
      if (isActive) {
        return existingId;
      }
    }

    // 2. Fetch specific spreadsheet associated with this courseId from persistent storage
    if (courseId) {
      try {
        const stored = await api.getCourseDispositionSheet(courseId);
        if (stored?.spreadsheetId && isRealGoogleSpreadsheetId(stored.spreadsheetId)) {
          const isActive = await driveService.verifyFileIsActive(stored.spreadsheetId, token || undefined);
          if (isActive) {
            return stored.spreadsheetId;
          }
        }
      } catch (_) {}
    }

    // 3. Search Google Drive within the course folder if user is authenticated
    if (token) {
      try {
        const driveSheet = await driveService.findCourseSpreadsheet(folderId, courseName, token, 'Asistencia');
        if (driveSheet?.id && isRealGoogleSpreadsheetId(driveSheet.id)) {
          if (courseId) {
            await api
              .saveCourseDispositionSheet(courseId, {
                spreadsheetId: driveSheet.id,
                url: driveSheet.url,
                lastSyncedAt: new Date().toISOString(),
              })
              .catch(() => {});
          }
          return driveSheet.id;
        }
      } catch (_) {}
    }

    return undefined;
  },

  /**
   * Helper to resolve or find the dedicated Calificaciones Google Spreadsheet ID associated with a courseId.
   * Ensures Calificaciones is a separate document from Asistencia y Disposición and verifies it is not in Drive trash.
   */
  async resolveGradesSpreadsheetId(
    courseId: string,
    courseName?: string,
    existingId?: string,
    folderId?: string,
    providedToken?: string
  ): Promise<string | undefined> {
    const token = providedToken || getCachedAccessToken();

    if (existingId && isRealGoogleSpreadsheetId(existingId)) {
      const isActive = await driveService.verifyFileIsActive(existingId, token || undefined);
      if (isActive) {
        return existingId;
      }
    }

    if (courseId && typeof window !== 'undefined') {
      try {
        const localSaved = localStorage.getItem(`fds_grades_sheet_${courseId}`);
        if (localSaved) {
          const parsed = JSON.parse(localSaved);
          if (parsed?.spreadsheetId && isRealGoogleSpreadsheetId(parsed.spreadsheetId)) {
            const isActive = await driveService.verifyFileIsActive(parsed.spreadsheetId, token || undefined);
            if (isActive) {
              return parsed.spreadsheetId;
            } else {
              localStorage.removeItem(`fds_grades_sheet_${courseId}`);
            }
          }
        }
      } catch (_) {}
    }

    if (token) {
      try {
        const driveSheet = await driveService.findCourseSpreadsheet(folderId, courseName, token, 'Calificaciones');
        if (driveSheet?.id && isRealGoogleSpreadsheetId(driveSheet.id)) {
          if (courseId && typeof window !== 'undefined') {
            localStorage.setItem(
              `fds_grades_sheet_${courseId}`,
              JSON.stringify({ spreadsheetId: driveSheet.id, url: driveSheet.url })
            );
          }
          return driveSheet.id;
        }
      } catch (_) {}
    }

    return undefined;
  },

  /**
   * Export or synchronize Student Gradebook with Google Sheets
   */
  async syncGradebookToSheet(
    course: { id: string; name: string } | string,
    students: Student[],
    evaluations: string[],
    grades: GradeEntry[],
    folderId?: string,
    existingSpreadsheetId?: string,
    providedToken?: string
  ): Promise<{ spreadsheetId: string; url?: string; isLiveGoogle?: boolean }> {
    const token = providedToken && isValidGoogleAccessToken(providedToken) ? providedToken : getCachedAccessToken();
    const courseId: string = typeof course === 'object' && course ? course.id : '';
    const courseName: string = typeof course === 'object' && course ? course.name : typeof course === 'string' && course ? course : 'Materia';
    const sheetTitle = `📊 Calificaciones - ${courseName}`;

    // Resolve dedicated grades spreadsheet specifically tied to courseId
    let targetSpreadsheetId: string | undefined = undefined;
    if (courseId) {
      targetSpreadsheetId = await this.resolveGradesSpreadsheetId(
        courseId,
        courseName,
        existingSpreadsheetId,
        folderId,
        token || undefined
      );
    } else if (existingSpreadsheetId && isRealGoogleSpreadsheetId(existingSpreadsheetId)) {
      targetSpreadsheetId = existingSpreadsheetId;
    }

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
        if (targetSpreadsheetId && isRealGoogleSpreadsheetId(targetSpreadsheetId)) {
          // Update existing course spreadsheet
          await this.ensureSheetsExist(targetSpreadsheetId, token, ['Calificaciones']);
          const updateRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent("'Calificaciones'!A1")}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: [headerRow, ...rows] }),
            }
          );
          if (updateRes.ok) {
            const url = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
            if (courseId) {
              api.updateCourse(courseId, { gradesSheetId: targetSpreadsheetId, gradesSheetUrl: url }).catch(() => {});
            }
            return {
              spreadsheetId: targetSpreadsheetId,
              url,
              isLiveGoogle: true,
            };
          }
        }

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
                properties: { title: 'Calificaciones' },
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
          const url = `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`;
          if (courseId) {
            api.updateCourse(courseId, { gradesSheetId: sheetData.spreadsheetId, gradesSheetUrl: url }).catch(() => {});
          }
          return {
            spreadsheetId: sheetData.spreadsheetId,
            url,
            isLiveGoogle: true,
          };
        }
      } catch (err) {
        console.warn('Live Google Sheets call failed, falling back to simulated link:', err);
      }
    }

    const fallbackId = targetSpreadsheetId || `sheet-grades-${courseId || Date.now().toString().slice(-4)}`;
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
    exportGradebookToCsv(courseName, students, evaluations, grades);
  },

  /**
   * Helper to ensure specific sheets (tabs) exist in an existing Google Spreadsheet and have sufficient rows
   */
  async ensureSheetsExist(
    spreadsheetId: string,
    token: string,
    sheetTitles: string[],
    minRows: number = 500
  ): Promise<void> {
    try {
      const metaRes = await fetchGoogleApiWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties))`,
        {},
        token
      );
      if (!metaRes.ok) return;
      const meta = await metaRes.json();
      const existingSheets: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } }[] =
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
                  rowCount: Math.max(1000, minRows),
                  columnCount: 20,
                },
              },
            },
          });
        }
      }

      // Ensure existing sheets have sufficient rows and columns so writing never exceeds grid limits
      for (const sheet of existingSheets) {
        if (sheetTitles.includes(sheet.title)) {
          const currentRows = sheet.gridProperties?.rowCount || 0;
          const currentCols = sheet.gridProperties?.columnCount || 0;
          if (currentRows < minRows || currentCols < 15) {
            requests.push({
              updateSheetProperties: {
                properties: {
                  sheetId: sheet.sheetId,
                  gridProperties: {
                    rowCount: Math.max(currentRows, minRows),
                    columnCount: Math.max(currentCols, 20),
                  },
                },
                fields: 'gridProperties(rowCount,columnCount)',
              },
            });
          }
        }
      }

      if (requests.length > 0) {
        await fetchGoogleApiWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests }),
          },
          token
        );
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
      const studentHistory1c = historyList
        .filter((h) => h.studentId === student.id && (!h.courseId || h.courseId === course.id) && (h.term === '1c' || !h.term))
        .sort((a, b) => b.timestamp - a.timestamp);

      const historyAbs1c = studentHistory1c.filter(
        (h) =>
          (h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta')) &&
          h.category !== 'Sistema' &&
          !h.action?.toLowerCase().includes('actualizada') &&
          !h.action?.toLowerCase().includes('verificación') &&
          !h.action?.toLowerCase().includes('ajuste')
      ).length;

      const historyLates1c = studentHistory1c.filter(
        (h) =>
          (h.category === 'Llegada tarde' ||
            h.action === 'Llegada tarde' ||
            h.action?.toLowerCase().includes('llegada tarde') ||
            h.action?.toLowerCase().includes('tarde') ||
            h.action?.toLowerCase().includes('tardanza')) &&
          h.category !== 'Sistema'
      ).length;

      const absences = map1c[student.id]?.totalAbsences !== undefined && map1c[student.id]?.totalAbsences !== null
        ? Number(map1c[student.id].totalAbsences)
        : historyAbs1c;

      const lates = map1c[student.id]?.totalLates !== undefined && map1c[student.id]?.totalLates !== null
        ? Number(map1c[student.id].totalLates)
        : historyLates1c;

      const score = map1c[student.id]?.totalDisposition ?? 10;

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
      const studentHistory2c = historyList
        .filter((h) => h.studentId === student.id && (!h.courseId || h.courseId === course.id) && h.term === '2c')
        .sort((a, b) => b.timestamp - a.timestamp);

      const historyAbs2c = studentHistory2c.filter(
        (h) =>
          (h.category === 'Ausencia' ||
            h.action === 'Ausencia' ||
            h.action?.toLowerCase().includes('ausencia') ||
            h.action?.toLowerCase().includes('falta')) &&
          h.category !== 'Sistema' &&
          !h.action?.toLowerCase().includes('actualizada') &&
          !h.action?.toLowerCase().includes('verificación') &&
          !h.action?.toLowerCase().includes('ajuste')
      ).length;

      const historyLates2c = studentHistory2c.filter(
        (h) =>
          (h.category === 'Llegada tarde' ||
            h.action === 'Llegada tarde' ||
            h.action?.toLowerCase().includes('llegada tarde') ||
            h.action?.toLowerCase().includes('tarde') ||
            h.action?.toLowerCase().includes('tardanza')) &&
          h.category !== 'Sistema'
      ).length;

      const absences = map2c[student.id]?.totalAbsences !== undefined && map2c[student.id]?.totalAbsences !== null
        ? Number(map2c[student.id].totalAbsences)
        : historyAbs2c;

      const lates = map2c[student.id]?.totalLates !== undefined && map2c[student.id]?.totalLates !== null
        ? Number(map2c[student.id].totalLates)
        : historyLates2c;

      const score = map2c[student.id]?.totalDisposition ?? 10;

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

    const historyRows = historyList
      .filter((h) => !h.courseId || h.courseId === course.id)
      .map((item) => {
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

      const isOmittedOrNone =
        item.omitNotification ||
        item.notificationMethod === 'omitted' ||
        item.notificationMethod === 'none' ||
        item.notifiedAt === 'No enviar' ||
        item.notifiedAt === 'Omitido';

      let messageSentTick = '-';
      if (item.category === 'Ausencia' || item.category === 'Disposición') {
        if (item.messageSent) {
          messageSentTick = '✓';
        } else if (isOmittedOrNone) {
          messageSentTick = 'No enviar';
        } else {
          messageSentTick = 'Pendiente';
        }
      }

      const messageContent =
        item.messageText ||
        (item.messageSent ? '(Sin texto adicional)' : isOmittedOrNone ? '(Sin mensaje)' : '-');

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

    // Resolve spreadsheet specifically for course.id (dynamic lookup instead of static path or placeholder)
    let targetSpreadsheetId = await this.resolveCourseSpreadsheetId(
      course.id,
      course.name,
      existingSpreadsheetId,
      folderId,
      token || undefined
    );

    // Real Google Sheets API call if access token is available
    if (token) {
      try {
        if (targetSpreadsheetId && isRealGoogleSpreadsheetId(targetSpreadsheetId)) {
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

          const minRequiredRows = Math.max(500, historyPayload.length + 50);

          // Ensure all 4 tabs exist in the existing spreadsheet and have enough rows
          await this.ensureSheetsExist(
            targetSpreadsheetId,
            token,
            [
              '1° Cuatrimestre',
              '2° Cuatrimestre',
              'Resumen Anual',
              'Historial de Incidencias',
            ],
            minRequiredRows
          );

          // Clear old data safely from tabs using open ranges
          try {
            await Promise.all([
              fetchGoogleApiWithRetry(
                `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent("'1° Cuatrimestre'!A:G")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                },
                token
              ),
              fetchGoogleApiWithRetry(
                `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent("'2° Cuatrimestre'!A:G")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                },
                token
              ),
              fetchGoogleApiWithRetry(
                `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent("'Resumen Anual'!A:I")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                },
                token
              ),
              fetchGoogleApiWithRetry(
                `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent("'Historial de Incidencias'!A:K")}:clear`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                },
                token
              ),
            ]);
          } catch (e) {
            console.warn('Notice clearing sheet cells before batch update:', e);
          }

          const updateData = [
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
          ];

          // Batch update all 4 sheets with current active rows (auto-retries on 401)
          let updateRes = await fetchGoogleApiWithRetry(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values:batchUpdate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                valueInputOption: 'USER_ENTERED',
                data: updateData,
              }),
            },
            token
          );

          // If batch update failed, try individual updates so one tab never blocks the others
          if (!updateRes.ok) {
            for (const item of updateData) {
              try {
                await fetchGoogleApiWithRetry(
                  `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(item.range)}?valueInputOption=USER_ENTERED`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values: item.values }),
                  },
                  token
                );
              } catch (_) {}
            }
          }

          if (updateRes.ok) {
            const updatedAtStr = new Date().toLocaleTimeString();
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
            // Immediately guarantee association with course.id
            api
              .saveCourseDispositionSheet(course.id, {
                spreadsheetId: targetSpreadsheetId,
                url: sheetUrl,
                lastSyncedAt: updatedAtStr,
              })
              .catch(() => {});
            return {
              spreadsheetId: targetSpreadsheetId,
              url: sheetUrl,
              isLiveGoogle: true,
              updatedAt: updatedAtStr,
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
              notifyGoogleSessionExpired('sheets_unauthorized');
              return {
                spreadsheetId: targetSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
                isLiveGoogle: false,
                updatedAt: new Date().toLocaleTimeString(),
                summaryRowsCount: summaryRows1c.length,
                historyRowsCount: historyRows.length,
                error: 'Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.',
                errorCode: 'UNAUTHORIZED',
              };
            }

            if (errStatus === 403) {
              return {
                spreadsheetId: targetSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
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
                spreadsheetId: targetSpreadsheetId,
                url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
                isLiveGoogle: false,
                updatedAt: new Date().toLocaleTimeString(),
                summaryRowsCount: summaryRows1c.length,
                historyRowsCount: historyRows.length,
                error: 'No se encontró la hoja de cálculo en Google Drive.',
                errorCode: 'NOT_FOUND',
              };
            }

            return {
              spreadsheetId: targetSpreadsheetId,
              url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
              isLiveGoogle: false,
              updatedAt: new Date().toLocaleTimeString(),
              summaryRowsCount: summaryRows1c.length,
              historyRowsCount: historyRows.length,
              error: errDetail,
              errorCode: 'SYNC_FAILED',
            };
          }
        }

        // Create new spreadsheet with all 4 sheets if no real existing ID was provided (auto-retries on 401)
        const createRes = await fetchGoogleApiWithRetry('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
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
          const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`;
          const updatedAtStr = new Date().toLocaleTimeString();

          // Immediately save generated sheet associated with this courseId
          api
            .saveCourseDispositionSheet(course.id, {
              spreadsheetId: sheetData.spreadsheetId,
              url: sheetUrl,
              lastSyncedAt: updatedAtStr,
            })
            .catch(() => {});
          api
            .updateCourse(course.id, {
              dispositionSheetId: sheetData.spreadsheetId,
              dispositionSheetUrl: sheetUrl,
            })
            .catch(() => {});

          return {
            spreadsheetId: sheetData.spreadsheetId,
            url: sheetUrl,
            isLiveGoogle: true,
            updatedAt: updatedAtStr,
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

          if (createStatus === 401) {
            notifyGoogleSessionExpired('sheets_create_unauthorized');
          }
          return {
            spreadsheetId: `sheet-disp-${course.id}`,
            url: '',
            isLiveGoogle: false,
            updatedAt: new Date().toLocaleTimeString(),
            summaryRowsCount: summaryRows1c.length,
            historyRowsCount: historyRows.length,
            error: createStatus === 401 ? 'Tu sesión de Google expiró. Hacé clic aquí para reconectar sin perder lo que escribiste.' : createErr,
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
   * Doble Entrada (Two-Way Sync):
   * Lee la hoja de Google Sheets vinculada al curso y detecta cualquier modificación
   * en Ausencias, Llegadas Tarde o Puntaje de Disposición realizada directamente en Google Sheets.
   */
  async pullDispositionSheetFromGoogle(
    course: { id: string; name: string },
    students: Student[],
    currentMap1c: Record<string, StudentDispositionData>,
    currentMap2c: Record<string, StudentDispositionData>,
    spreadsheetId?: string,
    providedToken?: string
  ): Promise<SheetPullResult> {
    const token =
      providedToken && isValidGoogleAccessToken(providedToken)
        ? providedToken
        : getCachedAccessToken();

    if (!spreadsheetId || !isRealGoogleSpreadsheetId(spreadsheetId)) {
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedMap1c: currentMap1c,
        updatedMap2c: currentMap2c,
        message: 'No hay una hoja real de Google Sheets vinculada a esta materia.',
      };
    }

    if (!token) {
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedMap1c: currentMap1c,
        updatedMap2c: currentMap2c,
        message: 'Se requiere iniciar sesión con Google para leer datos en tiempo real.',
        spreadsheetId,
      };
    }

    try {
      // Leer valores de 1° Cuatrimestre y 2° Cuatrimestre
      const range1c = encodeURIComponent("'1° Cuatrimestre'!A2:E200");
      const range2c = encodeURIComponent("'2° Cuatrimestre'!A2:E200");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${range1c}&ranges=${range2c}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Google Sheets API error: ${res.status}`);
      }

      const data = await res.json();
      const valueRanges = data.valueRanges || [];
      const rows1c: any[][] = valueRanges[0]?.values || [];
      const rows2c: any[][] = valueRanges[1]?.values || [];

      const changes: SheetPullDiff[] = [];
      const updatedMap1c: Record<string, StudentDispositionData> = { ...currentMap1c };
      const updatedMap2c: Record<string, StudentDispositionData> = { ...currentMap2c };

      // Helper para buscar alumno por email o nombre
      const matchStudent = (nameInSheet: string, emailInSheet: string): Student | undefined => {
        const cleanEmail = (emailInSheet || '').trim().toLowerCase();
        if (cleanEmail) {
          const byEmail = students.find((s) => (s.email || '').trim().toLowerCase() === cleanEmail);
          if (byEmail) return byEmail;
        }

        const cleanName = (nameInSheet || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, ' ')
          .trim();

        return students.find((s) => {
          const sLast = (s.lastName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const sFirst = (s.firstName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          return (
            (cleanName.includes(sLast) && cleanName.includes(sFirst)) ||
            `${sLast} ${sFirst}` === cleanName ||
            `${sFirst} ${sLast}` === cleanName
          );
        });
      };

      // Procesar 1° Cuatrimestre
      rows1c.forEach((row) => {
        const nameCell = String(row[0] || '');
        const emailCell = String(row[1] || '');
        const student = matchStudent(nameCell, emailCell);
        if (!student) return;

        const currentData = updatedMap1c[student.id] || {
          studentId: student.id,
          totalDisposition: 10,
          totalAbsences: 0,
          totalLates: 0,
        };

        const sheetAbs = parseInt(String(row[2] || '0').trim(), 10);
        const sheetLates = parseInt(String(row[3] || '0').trim(), 10);
        const sheetDisp = parseFloat(String(row[4] || '10').replace(',', '.').trim());

        let changed = false;
        const newStudentData = { ...currentData };

        if (!isNaN(sheetAbs) && sheetAbs >= 0 && sheetAbs !== currentData.totalAbsences) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '1c',
            termLabel: '1° Cuatrimestre',
            field: 'totalAbsences',
            fieldLabel: 'Ausencias',
            oldValue: currentData.totalAbsences,
            newValue: sheetAbs,
          });
          newStudentData.totalAbsences = sheetAbs;
          changed = true;
        }

        if (!isNaN(sheetLates) && sheetLates >= 0 && sheetLates !== currentData.totalLates) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '1c',
            termLabel: '1° Cuatrimestre',
            field: 'totalLates',
            fieldLabel: 'Llegadas Tarde',
            oldValue: currentData.totalLates,
            newValue: sheetLates,
          });
          newStudentData.totalLates = sheetLates;
          changed = true;
        }

        if (!isNaN(sheetDisp) && sheetDisp >= 0 && sheetDisp <= 10 && sheetDisp !== currentData.totalDisposition) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '1c',
            termLabel: '1° Cuatrimestre',
            field: 'totalDisposition',
            fieldLabel: 'Disposición',
            oldValue: currentData.totalDisposition,
            newValue: sheetDisp,
          });
          newStudentData.totalDisposition = sheetDisp;
          changed = true;
        }

        if (changed) {
          updatedMap1c[student.id] = newStudentData;
        }
      });

      // Procesar 2° Cuatrimestre
      rows2c.forEach((row) => {
        const nameCell = String(row[0] || '');
        const emailCell = String(row[1] || '');
        const student = matchStudent(nameCell, emailCell);
        if (!student) return;

        const currentData = updatedMap2c[student.id] || {
          studentId: student.id,
          totalDisposition: 10,
          totalAbsences: 0,
          totalLates: 0,
        };

        const sheetAbs = parseInt(String(row[2] || '0').trim(), 10);
        const sheetLates = parseInt(String(row[3] || '0').trim(), 10);
        const sheetDisp = parseFloat(String(row[4] || '10').replace(',', '.').trim());

        let changed = false;
        const newStudentData = { ...currentData };

        if (!isNaN(sheetAbs) && sheetAbs >= 0 && sheetAbs !== currentData.totalAbsences) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '2c',
            termLabel: '2° Cuatrimestre',
            field: 'totalAbsences',
            fieldLabel: 'Ausencias',
            oldValue: currentData.totalAbsences,
            newValue: sheetAbs,
          });
          newStudentData.totalAbsences = sheetAbs;
          changed = true;
        }

        if (!isNaN(sheetLates) && sheetLates >= 0 && sheetLates !== currentData.totalLates) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '2c',
            termLabel: '2° Cuatrimestre',
            field: 'totalLates',
            fieldLabel: 'Llegadas Tarde',
            oldValue: currentData.totalLates,
            newValue: sheetLates,
          });
          newStudentData.totalLates = sheetLates;
          changed = true;
        }

        if (!isNaN(sheetDisp) && sheetDisp >= 0 && sheetDisp <= 10 && sheetDisp !== currentData.totalDisposition) {
          changes.push({
            studentId: student.id,
            studentName: `${student.lastName}, ${student.firstName}`,
            studentEmail: student.email,
            term: '2c',
            termLabel: '2° Cuatrimestre',
            field: 'totalDisposition',
            fieldLabel: 'Disposición',
            oldValue: currentData.totalDisposition,
            newValue: sheetDisp,
          });
          newStudentData.totalDisposition = sheetDisp;
          changed = true;
        }

        if (changed) {
          updatedMap2c[student.id] = newStudentData;
        }
      });

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      const msg =
        changes.length > 0
          ? `✓ Doble Entrada: Se sincronizaron ${changes.length} cambio(s) detectados en Google Sheets.`
          : '✓ Google Sheet al día: Los datos de asistencia y disposición coinciden exactamente.';

      return {
        success: true,
        changesCount: changes.length,
        changes,
        updatedMap1c,
        updatedMap2c,
        message: msg,
        spreadsheetId,
        sheetUrl,
      };
    } catch (err: any) {
      console.warn('Error en Doble Entrada (pull de Google Sheets):', err);
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedMap1c: currentMap1c,
        updatedMap2c: currentMap2c,
        message: `Error al conectar con Google Sheets: ${err?.message || 'Error de red'}`,
        spreadsheetId,
      };
    }
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

      const isOmittedOrNone =
        item.omitNotification ||
        item.notificationMethod === 'omitted' ||
        item.notificationMethod === 'none' ||
        item.notifiedAt === 'No enviar' ||
        item.notifiedAt === 'Omitido';

      const sentStatus = item.messageSent
        ? 'Enviado'
        : isOmittedOrNone
        ? 'No enviar'
        : (item.category === 'Ausencia' || item.category === 'Disposición' ? 'Pendiente' : '-');

      return [
        item.date,
        item.time,
        item.studentName,
        item.category,
        item.action,
        impact,
        studentScore,
        sentStatus,
        item.messageText || (isOmittedOrNone ? '(Sin mensaje)' : '-'),
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
        let sheetIdToUse = await this.resolveGradesSpreadsheetId(
          course.id,
          course.name,
          existingSpreadsheetId,
          folderId,
          token || undefined
        );

        if (!sheetIdToUse || sheetIdToUse.startsWith('sheet-disp-') || sheetIdToUse.startsWith('sheet-grades-')) {
          // If no existing grades sheet, create a new dedicated one for course grades
          const createRes = await fetchGoogleApiWithRetry('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: { title: `📊 Calificaciones - ${course.name}` },
              sheets: [
                {
                  properties: {
                    title: tabName,
                    gridProperties: { rowCount: Math.max(50, rows.length + 10), columnCount: headers.length + 2 },
                  },
                },
              ],
            }),
          }, token);
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
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetIdToUse}/edit`;
            if (typeof window !== 'undefined') {
              const payloadStr = JSON.stringify({ spreadsheetId: sheetIdToUse, url: sheetUrl, lastSyncedAt: new Date().toLocaleTimeString() });
              localStorage.setItem(`fds_grades_sheet_${course.id}`, payloadStr);
              localStorage.setItem(getUserStorageKey(`fds_grades_sheet_${course.id}`), payloadStr);
            }
            api
              .updateCourse(course.id, {
                gradesSheetId: sheetIdToUse,
                gradesSheetUrl: sheetUrl,
              })
              .catch(() => {});
          }
        }

        if (sheetIdToUse && isRealGoogleSpreadsheetId(sheetIdToUse)) {
          await this.ensureSheetsExist(sheetIdToUse, token, [tabName]);

          // Clear previous data in tab
          try {
            await fetchGoogleApiWithRetry(
              `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1:Z500`)}:clear`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              },
              token
            );
          } catch (_) {}

          // Write updated grades matrix
          const updateRes = await fetchGoogleApiWithRetry(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdToUse}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: [headers, ...rows] }),
            },
            token
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
   * Doble Entrada para Calificaciones (Two-Way Sync):
   * Lee la pestaña correspondiente del cuatrimestre ("Calificaciones - 1° Cuatrimestre" o "Calificaciones - 2° Cuatrimestre")
   * y detecta cualquier nota modificada directamente en Google Sheets por el docente para incorporarla a la app.
   */
  async pullGradebookMatrixFromGoogle(
    course: { id: string; name: string },
    term: '1c' | '2c',
    students: Student[],
    categories: GradeCategory[],
    currentGradesMap: Record<string, Record<string, string>>,
    spreadsheetId?: string,
    providedToken?: string
  ): Promise<GradeSheetPullResult> {
    const token =
      providedToken && isValidGoogleAccessToken(providedToken)
        ? providedToken
        : getCachedAccessToken();

    const termLabel = term === '1c' ? '1° Cuatrimestre' : '2° Cuatrimestre';
    const tabName = `Calificaciones - ${termLabel}`;

    if (!spreadsheetId || !isRealGoogleSpreadsheetId(spreadsheetId)) {
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedGradesMap: currentGradesMap,
        message: 'No hay una hoja real de Google Sheets vinculada a esta materia.',
      };
    }

    if (!token) {
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedGradesMap: currentGradesMap,
        message: 'Se requiere iniciar sesión con Google para leer calificaciones en tiempo real.',
        spreadsheetId,
      };
    }

    try {
      const range = encodeURIComponent(`'${tabName}'!A1:ZZ500`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        return {
          success: true,
          changesCount: 0,
          changes: [],
          updatedGradesMap: currentGradesMap,
          message: 'La pestaña de calificaciones aún no existe o no tiene datos cargados.',
          spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        };
      }

      const data = await res.json();
      const rows: any[][] = data.values || [];
      if (rows.length < 2) {
        return {
          success: true,
          changesCount: 0,
          changes: [],
          updatedGradesMap: currentGradesMap,
          message: 'La pestaña de calificaciones no contiene filas con notas.',
          spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        };
      }

      // Flatten assessment columns
      const assessmentColumns: { id: string; header: string }[] = [];
      categories.forEach((cat) => {
        if (!cat.subcategories || cat.subcategories.length === 0) {
          assessmentColumns.push({ id: cat.id, header: cat.name });
        } else {
          cat.subcategories.forEach((sub) => {
            assessmentColumns.push({
              id: sub.id,
              header: `${cat.name} - ${sub.name}`,
            });
          });
        }
      });

      // Map columns from sheet header
      const headerRow = rows[0] || [];
      const colIndexToAssessment: Record<number, { id: string; header: string }> = {};

      headerRow.forEach((hVal, idx) => {
        if (idx < 2) return; // 0: Name, 1: Email
        const hClean = String(hVal || '').trim().toLowerCase();
        if (
          hClean.includes('promedio') ||
          hClean.includes('condición') ||
          hClean.includes('condicion') ||
          hClean.includes('actualización') ||
          hClean.includes('actualizacion')
        ) {
          return;
        }

        const match = assessmentColumns.find((ac) => {
          const acClean = ac.header.trim().toLowerCase();
          return (
            acClean === hClean ||
            hClean.endsWith(acClean) ||
            hClean.includes(acClean) ||
            acClean.includes(hClean)
          );
        });

        if (match) {
          colIndexToAssessment[idx] = match;
        }
      });

      // Match student helper
      const matchStudent = (nameInSheet: string, emailInSheet: string): Student | undefined => {
        const cleanEmail = (emailInSheet || '').trim().toLowerCase();
        if (cleanEmail) {
          const byEmail = students.find((s) => (s.email || '').trim().toLowerCase() === cleanEmail);
          if (byEmail) return byEmail;
        }

        const cleanName = (nameInSheet || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, ' ')
          .trim();

        return students.find((s) => {
          const sLast = (s.lastName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const sFirst = (s.firstName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          return (
            (cleanName.includes(sLast) && cleanName.includes(sFirst)) ||
            `${sLast} ${sFirst}` === cleanName ||
            `${sFirst} ${sLast}` === cleanName
          );
        });
      };

      const changes: GradePullDiff[] = [];
      const updatedGradesMap: Record<string, Record<string, string>> = {};

      // Clone existing grades
      Object.keys(currentGradesMap).forEach((stId) => {
        updatedGradesMap[stId] = { ...(currentGradesMap[stId] || {}) };
      });

      // Process rows from index 1
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const nameCell = String(row[0] || '');
        const emailCell = String(row[1] || '');
        const student = matchStudent(nameCell, emailCell);
        if (!student) continue;

        if (!updatedGradesMap[student.id]) {
          updatedGradesMap[student.id] = {};
        }

        Object.entries(colIndexToAssessment).forEach(([colIdxStr, colInfo]) => {
          const colIdx = Number(colIdxStr);
          const rawCellVal = row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';
          const currentVal = String(updatedGradesMap[student.id][colInfo.id] || '').trim();

          const normalizedCell = rawCellVal.replace(',', '.');
          const normalizedCurr = currentVal.replace(',', '.');

          if (normalizedCell !== normalizedCurr && rawCellVal !== '') {
            changes.push({
              studentId: student.id,
              studentName: `${student.lastName}, ${student.firstName}`,
              studentEmail: student.email,
              term,
              termLabel,
              columnId: colInfo.id,
              columnName: colInfo.header,
              oldGrade: currentVal,
              newGrade: rawCellVal,
            });
            updatedGradesMap[student.id][colInfo.id] = rawCellVal;
          }
        });
      }

      return {
        success: true,
        changesCount: changes.length,
        changes,
        updatedGradesMap,
        message:
          changes.length > 0
            ? `Se sincronizaron ${changes.length} nota(s) modificada(s) desde Google Sheets.`
            : 'No se detectaron modificaciones en Google Sheets.',
        spreadsheetId,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      };
    } catch (err) {
      console.warn('Error al leer calificaciones de Google Sheets:', err);
      return {
        success: false,
        changesCount: 0,
        changes: [],
        updatedGradesMap: currentGradesMap,
        message: 'Ocurrió un error al leer la hoja de Google Sheets.',
      };
    }
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
    exportDispositionToCsv(courseName, students, dispositionMap, historyList);
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
    return syncPreliminaryValuationSheetHelper(
      courseName,
      termLabel,
      students,
      assessmentHeaders,
      gradesMap,
      valuations,
      existingSpreadsheetId
    );
  },

  /**
   * Create or update the dedicated "Libro de Temas" Google Spreadsheet inside the course's Drive folder,
   * reproducing the complete table of topics from the course's Libro de Temas state.
   */
  async syncLibroDeTemasToSheet(
    course: { id: string; name: string; subject?: string; schedule?: string },
    teacherName?: string,
    folderId?: string,
    existingSpreadsheetId?: string,
    providedToken?: string
  ): Promise<{ spreadsheetId: string; url?: string; isLiveGoogle: boolean }> {
    return syncLibroDeTemasToSheetHelper(
      this.ensureSheetsExist.bind(this),
      course,
      teacherName,
      folderId,
      existingSpreadsheetId,
      providedToken
    );
  },

  /**
   * Read an existing Google Spreadsheet (by URL or ID) so the teacher can import grades, categories,
   * or attendance/disposition data with pre-verification in the UI.
   */
  async fetchArbitrarySpreadsheetData(
    spreadsheetIdOrUrl: string,
    targetSheetTitle?: string,
    providedToken?: string
  ): Promise<{
    spreadsheetId: string;
    title: string;
    sheetNames: string[];
    selectedSheet: string;
    headers: string[];
    rows: Array<Record<string, any>>;
  }> {
    return fetchArbitrarySpreadsheetDataHelper(
      spreadsheetIdOrUrl,
      targetSheetTitle,
      providedToken
    );
  },

  /**
   * Smartly finds the header row in a 2D array (skipping empty rows or title banners)
   * and converts the subsequent rows into objects keyed by column header.
   */
  convert2DArrayToTableObjects(rawValues: any[][]): {
    headers: string[];
    rows: Array<Record<string, any>>;
  } {
    return convert2DArrayToTableObjectsHelper(rawValues);
  },
};
