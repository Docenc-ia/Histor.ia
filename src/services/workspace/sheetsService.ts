/**
 * Google Sheets Integration Service
 * Endpoint: https://sheets.googleapis.com/v4/spreadsheets
 * Scope: https://www.googleapis.com/auth/spreadsheets
 */

import {
  getCachedAccessToken,
  isValidGoogleAccessToken,
  fetchGoogleApiWithRetry,
} from './googleAuth';
import { Student } from '../../types';
import { GradeCategory } from '../../types/grades';
import { driveService } from './driveService';
import { isRealGoogleSpreadsheetId } from '../../utils/sheetsUtils';
import { getUserStorageKey, getUserScopedItem, setUserScopedItem } from '../storageHelpers';
import { api } from '../api';
import {
  syncPreliminaryValuationSheetHelper,
  fetchArbitrarySpreadsheetDataHelper,
  convert2DArrayToTableObjectsHelper,
} from './sheetsHelpers';

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
        const localSaved = getUserScopedItem(`fds_grades_sheet_${courseId}`);
        if (localSaved) {
          const parsed = JSON.parse(localSaved);
          if (parsed?.spreadsheetId && isRealGoogleSpreadsheetId(parsed.spreadsheetId)) {
            const isActive = await driveService.verifyFileIsActive(parsed.spreadsheetId, token || undefined);
            if (isActive) {
              return parsed.spreadsheetId;
            } else {
              localStorage.removeItem(getUserStorageKey(`fds_grades_sheet_${courseId}`));
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
            setUserScopedItem(
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
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetIdToUse}/edit`;
            if (typeof window !== 'undefined') {
              const payloadStr = JSON.stringify({ spreadsheetId: sheetIdToUse, url: sheetUrl, lastSyncedAt: new Date().toLocaleTimeString() });
              setUserScopedItem(`fds_grades_sheet_${course.id}`, payloadStr);
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
          const targetSheetId = sheetIdToUse;
          await Promise.all([
            (async () => {
              try {
                const folders = await driveService.setupCourseFolderStructure(
                  course.name,
                  folderId,
                  token
                );
                const targetGradesFolderId =
                  folders.gradesFolder?.id || folders.mainFolder?.id || folderId;
                if (
                  targetGradesFolderId &&
                  !targetGradesFolderId.startsWith('folder-') &&
                  !targetGradesFolderId.startsWith('f-')
                ) {
                  await driveService.moveFileToFolder(targetSheetId, targetGradesFolderId, token);
                }
              } catch (_) {}
            })(),
            this.ensureSheetsExist(targetSheetId, token, [tabName]),
          ]);

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
    raw2D: any[][];
    headerRowIndex: number;
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
  convert2DArrayToTableObjects(
    rawValues: any[][],
    explicitHeaderRowIndex?: number
  ): {
    headers: string[];
    rows: Array<Record<string, any>>;
    headerRowIndex: number;
  } {
    return convert2DArrayToTableObjectsHelper(rawValues, explicitHeaderRowIndex);
  },
};
