import React from 'react';
import { driveService } from '../services/workspace/driveService';
import {
  getCachedAccessToken,
  requestGoogleAccessToken,
  isValidGoogleAccessToken,
  fetchGoogleApiWithRetry,
} from '../services/workspace/googleAuth';
import { isRealGoogleSpreadsheetId } from '../utils/sheetsUtils';
import { SchoolHolidayItem } from '../utils/schoolHolidays';
import { api } from '../services/api';
import { buildOfficialLibroDeTemasHtml as buildLibroHtml } from '../utils/libroDeTemasHtml';
import { touchCourseDataLru } from '../utils/lruCourseCache';
import {
  LibroDeTemasEntry,
  LibroDeTemasMetadata,
  LibroDeTemasSheetInfo,
  ScheduledRow,
} from '../components/modules/LibroDeTemasMatrix';

export interface UseLibroDeTemasSyncProps {
  courseId: string;
  courseName: string;
  driveFolderId?: string;
  todayStr: string;
  metadata: LibroDeTemasMetadata;
  entriesMap: Record<string, LibroDeTemasEntry>;
  setEntriesMap: React.Dispatch<React.SetStateAction<Record<string, LibroDeTemasEntry>>>;
  characterOptions: string[];
  scheduledRows: ScheduledRow[];
  filteredRows: ScheduledRow[];
  activeWeekdaysLabel: string;
  scheduleSummaryText: string;
  holidaysByDate: Record<string, SchoolHolidayItem>;
  sheetInfo: LibroDeTemasSheetInfo | null;
  setSheetInfo: React.Dispatch<React.SetStateAction<LibroDeTemasSheetInfo | null>>;
  isSyncingSheet: boolean;
  setIsSyncingSheet: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOpeningSheet: React.Dispatch<React.SetStateAction<boolean>>;
  driveDocTitle: string;
  setIsExportingDoc: React.Dispatch<React.SetStateAction<boolean>>;
  setExportedDocLink: React.Dispatch<
    React.SetStateAction<{ url: string; name: string } | null>
  >;
  setShowDriveConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  onOpenBackupModal?: () => void;
  persistLibroData: (
    nextMetadata: LibroDeTemasMetadata,
    nextEntries: Record<string, LibroDeTemasEntry>,
    nextCharacterOptions?: string[],
    immediateCloud?: boolean,
    nextSheetInfo?: LibroDeTemasSheetInfo | null
  ) => void;
}

export function useLibroDeTemasSync({
  courseId,
  courseName,
  driveFolderId,
  todayStr,
  metadata,
  entriesMap,
  setEntriesMap,
  characterOptions,
  scheduledRows,
  filteredRows,
  activeWeekdaysLabel,
  scheduleSummaryText,
  holidaysByDate,
  sheetInfo,
  setSheetInfo,
  isSyncingSheet,
  setIsSyncingSheet,
  setIsOpeningSheet,
  driveDocTitle,
  setIsExportingDoc,
  setExportedDocLink,
  setShowDriveConfirm,
  setToastMsg,
  onOpenBackupModal,
  persistLibroData,
}: UseLibroDeTemasSyncProps) {
  React.useEffect(() => {
    if (courseId) {
      touchCourseDataLru(courseId, `fds_libro_temas_${courseId}`);
    }
  }, [courseId]);

  const buildOfficialLibroDeTemasHtml = () =>
    buildLibroHtml({
      filteredRows,
      metadata,
      activeWeekdaysLabel,
      scheduleSummaryText,
    });

  // Exportar a Google Drive como Google Doc nativo (.gdoc)
  const handleExportToGoogleDoc = async () => {
    setIsExportingDoc(true);
    try {
      const htmlContent = buildOfficialLibroDeTemasHtml();
      const docName =
        driveDocTitle.trim() ||
        `Libro de Temas - ${courseName} (${todayStr})`;

      let targetFolderId = driveFolderId;
      if (!targetFolderId) {
        const structure = await driveService.ensureCourseFolderStructure(courseName);
        targetFolderId = structure.mainFolder.id;
      }

      const uploaded = await driveService.uploadReportFile(
        docName,
        htmlContent,
        targetFolderId,
        true // Convert to editable Google Doc (.gdoc)
      );

      if (uploaded) {
        const editUrl = uploaded.url.includes('drive.google.com/my-drive')
          ? uploaded.url
          : `https://docs.google.com/document/d/${uploaded.id}/edit`;
        setExportedDocLink({ url: editUrl, name: uploaded.name });
        setShowDriveConfirm(false);
        setToastMsg(
          'Libro de Temas exportado a Google Drive como documento editable (.gdoc).'
        );
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (_) {
      setToastMsg('No se pudo exportar el Libro de Temas a Google Drive.');
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setIsExportingDoc(false);
    }
  };

  // Imprimir folio oficial en formato horizontal
  const handlePrintLibro = () => {
    const html = buildOfficialLibroDeTemasHtml();
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(
        html.replace(
          '</head>',
          `<style>@page { size: A4 landscape; margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style></head>`
        )
      );
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    }
  };

  // Función interna para enviar instantánea del Libro de Temas a un Google Sheet existente (usada por la cola automática)
  const pushLibroSnapshotToSheets = async (
    targetSpreadsheetId: string,
    metaToPush: LibroDeTemasMetadata,
    entriesToPush: Record<string, LibroDeTemasEntry>
  ) => {
    const token = getCachedAccessToken();
    if (!token || !isValidGoogleAccessToken(token) || !isRealGoogleSpreadsheetId(targetSpreadsheetId)) {
      return;
    }

    const tabName = 'Libro de Temas';
    const nowStr = `${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`;
    const metaRow = [
      'ASIGNATURA:',
      metaToPush.asignatura,
      'PROF. TITULAR:',
      metaToPush.profTitular,
      'DÍAS DE CLASE:',
      activeWeekdaysLabel,
      'ÚLTIMA SINCRONIZACIÓN:',
      nowStr,
      '',
      '',
    ];
    const emptyRow = ['', '', '', '', '', '', '', '', '', ''];
    const headerRow = [
      'Fecha (ISO)',
      'FECHA (Día / Mes)',
      'Horario / Módulo',
      'Clase N°',
      'Unidad N°',
      'CONTENIDOS',
      'Carácter de la clase',
      'OBSERVACIONES',
      'Firma del Profesor',
      'Firma de la Autoridad',
    ];

    const dataRows = scheduledRows.map((row) => {
      const entry =
        entriesToPush[row.rowKey] ||
        (row.slotIndex === 0 ? entriesToPush[row.dateStr] : undefined) ||
        row.entry;
      const isHol = Boolean(entry.isHoliday);
      return [
        row.dateStr,
        `${row.day}/${row.month}`,
        row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-'),
        row.computedClassNumber,
        isHol ? '-' : entry.unitNumber || '',
        entry.contents || '',
        isHol ? '-' : entry.classCharacter || '',
        entry.observations || '',
        entry.teacherSignature || '',
        entry.authoritySignature || '',
      ];
    });

    try {
      await fetchGoogleApiWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1:Z600`)}:clear`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
        token
      );
    } catch (_) {}

    const updateRes = await fetchGoogleApiWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [metaRow, emptyRow, headerRow, ...dataRows],
        }),
      },
      token
    );

    if (updateRes.ok) {
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
      const nextSheetInfo: LibroDeTemasSheetInfo = {
        spreadsheetId: targetSpreadsheetId,
        url: sheetUrl,
        lastSyncedAt: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setSheetInfo(nextSheetInfo);
    }
  };

  // Crear o sincronizar el Libro de Temas con Google Sheets en la carpeta de Drive de la materia
  const handleSyncWithSheets = async (openAfterSync = false) => {
    if (isSyncingSheet) return;
    setIsSyncingSheet(true);
    if (openAfterSync) setIsOpeningSheet(true);

    try {
      let token = getCachedAccessToken();
      if (!token || !isValidGoogleAccessToken(token)) {
        try {
          token = await requestGoogleAccessToken();
        } catch (_) {}
      }

      if (!token || !isValidGoogleAccessToken(token)) {
        setToastMsg(
          'Se requiere autorización de tu cuenta de Google para crear y sincronizar la hoja en Google Sheets.'
        );
        setTimeout(() => setToastMsg(null), 4000);
        return;
      }

      const tabName = 'Libro de Temas';
      const sheetTitle = `📖 Libro de Temas - ${courseName}`;
      let targetSpreadsheetId =
        sheetInfo?.spreadsheetId && isRealGoogleSpreadsheetId(sheetInfo.spreadsheetId)
          ? sheetInfo.spreadsheetId
          : undefined;

      let workingEntries = { ...entriesMap };
      let pulledChangesCount = 0;

      // 1. Doble entrada (Pull): Si ya existe la hoja de Google Sheets, leer cambios hechos por el docente en Sheets
      if (targetSpreadsheetId) {
        try {
          const range = encodeURIComponent(`'${tabName}'!A3:J500`);
          const getRes = await fetchGoogleApiWithRetry(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${range}`,
            { method: 'GET' },
            token
          );

          if (getRes.ok) {
            const data = await getRes.json();
            const rawRows: any[][] = data.values || [];
            const headerRowInSheet: any[] = rawRows[0] || [];
            const sheetRows: any[][] = rawRows.slice(1);

            const hasTimeCol =
              headerRowInSheet.length >= 10 ||
              String(headerRowInSheet[2] || '').toLowerCase().includes('hora') ||
              String(headerRowInSheet[2] || '').toLowerCase().includes('módulo') ||
              String(headerRowInSheet[2] || '').toLowerCase().includes('modulo');
            const colOffset = hasTimeCol ? 1 : 0;

            const dateOccurrenceCounter: Record<string, number> = {};

            sheetRows.forEach((r) => {
              const dateIso = String(r[0] || '').trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return;

              const occurrenceIdx = dateOccurrenceCounter[dateIso] ?? 0;
              dateOccurrenceCounter[dateIso] = occurrenceIdx + 1;

              const timeCell = hasTimeCol ? String(r[2] ?? '').trim() : '';
              const unitCell = String(r[3 + colOffset] ?? '').trim();
              const contentsCell = String(r[4 + colOffset] ?? '').trim();
              const characterCell = String(r[5 + colOffset] ?? '').trim();
              const obsCell = String(r[6 + colOffset] ?? '').trim();
              const profSigCell = String(r[7 + colOffset] ?? '').trim();
              const authSigCell = String(r[8 + colOffset] ?? '').trim();

              const matchingScheduled =
                scheduledRows.find(
                  (sr) =>
                    sr.dateStr === dateIso &&
                    ((timeCell && sr.timeLabel === timeCell) || sr.slotIndex === occurrenceIdx)
                ) || scheduledRows.find((sr) => sr.dateStr === dateIso);

              const targetRowKey = matchingScheduled
                ? matchingScheduled.rowKey
                : occurrenceIdx === 0
                ? dateIso
                : `${dateIso}__${occurrenceIdx}`;

              const existing = workingEntries[targetRowKey] ||
                (occurrenceIdx === 0 ? workingEntries[dateIso] : undefined) ||
                matchingScheduled?.entry || {
                  date: dateIso,
                  slotIndex: occurrenceIdx,
                  timeLabel: timeCell !== '-' ? timeCell : undefined,
                  isHoliday: Boolean(holidaysByDate[dateIso]),
                  holidayName: holidaysByDate[dateIso]?.name,
                  unitNumber: holidaysByDate[dateIso] ? '-' : '1',
                  contents: holidaysByDate[dateIso]
                    ? `Feriado: ${holidaysByDate[dateIso].name}`
                    : '',
                  classCharacter: holidaysByDate[dateIso]
                    ? '-'
                    : characterOptions[0] || 'Teórico - Práctica',
                  observations: '',
                  teacherSignature: '',
                  authoritySignature: '',
                };

              let rowChanged = false;
              const updatedEntry: LibroDeTemasEntry = { ...existing };

              if (!existing.isHoliday) {
                if (unitCell && unitCell !== '-' && unitCell !== existing.unitNumber) {
                  updatedEntry.unitNumber = unitCell;
                  rowChanged = true;
                }
                if (contentsCell !== existing.contents && contentsCell !== '') {
                  updatedEntry.contents = contentsCell;
                  rowChanged = true;
                }
                if (characterCell && characterCell !== '-' && characterCell !== existing.classCharacter) {
                  updatedEntry.classCharacter = characterCell;
                  rowChanged = true;
                }
              }

              if (obsCell !== existing.observations && obsCell !== '') {
                updatedEntry.observations = obsCell;
                rowChanged = true;
              }
              if (profSigCell !== existing.teacherSignature && profSigCell !== '') {
                updatedEntry.teacherSignature = profSigCell;
                rowChanged = true;
              }
              if (authSigCell !== existing.authoritySignature && authSigCell !== '') {
                updatedEntry.authoritySignature = authSigCell;
                rowChanged = true;
              }

              if (rowChanged) {
                workingEntries[targetRowKey] = updatedEntry;
                if (occurrenceIdx === 0) {
                  workingEntries[dateIso] = updatedEntry;
                }
                pulledChangesCount++;
              }
            });

            if (pulledChangesCount > 0) {
              setEntriesMap(workingEntries);
            }
          } else if (getRes.status === 404) {
            targetSpreadsheetId = undefined;
          }
        } catch (_) {}
      }

      // 2. Si no existe aún el Google Sheet para el Libro de Temas de esta materia, crearlo dentro de la carpeta de Drive de la materia
      if (!targetSpreadsheetId) {
        const createRes = await fetchGoogleApiWithRetry(
          'https://sheets.googleapis.com/v4/spreadsheets',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: { title: sheetTitle },
              sheets: [
                {
                  properties: {
                    title: tabName,
                    gridProperties: {
                      rowCount: Math.max(120, scheduledRows.length + 20),
                      columnCount: 10,
                      frozenRowCount: 3,
                    },
                  },
                },
              ],
            }),
          },
          token
        );

        if (!createRes.ok) {
          throw new Error('No se pudo crear la hoja de Google Sheets');
        }

        const createdData = await createRes.json();
        targetSpreadsheetId = createdData.spreadsheetId;

        try {
          const folderStruct = await driveService.setupCourseFolderStructure(
            courseName,
            driveFolderId,
            token
          );
          const targetFolderToMove =
            folderStruct.libroDeTemasFolder?.id ||
            folderStruct.mainFolder?.id ||
            driveFolderId;

          if (targetFolderToMove && !targetFolderToMove.startsWith('folder-') && !targetFolderToMove.startsWith('f-')) {
            await driveService.moveFileToFolder(targetSpreadsheetId!, targetFolderToMove, token);
          }

          if (folderStruct.mainFolder?.id && !folderStruct.mainFolder.id.startsWith('folder-')) {
            api
              .updateCourse(courseId, {
                driveFolderId: folderStruct.mainFolder.id,
                driveFolderUrl: folderStruct.mainFolder.url,
              })
              .catch(() => {});
          }
        } catch (folderErr) {
          console.warn('Error ubicando Sheet de Libro de Temas en carpeta de Drive:', folderErr);
        }
      }

      // 3. Construir las filas actualizadas para escribir en el Sheet
      const nowStr = `${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`;
      const metaRow = [
        'ASIGNATURA:',
        metadata.asignatura,
        'PROF. TITULAR:',
        metadata.profTitular,
        'DÍAS DE CLASE:',
        activeWeekdaysLabel,
        'ÚLTIMA SINCRONIZACIÓN:',
        nowStr,
        '',
        '',
      ];
      const emptyRow = ['', '', '', '', '', '', '', '', '', ''];
      const headerRow = [
        'Fecha (ISO)',
        'FECHA (Día / Mes)',
        'Horario / Módulo',
        'Clase N°',
        'Unidad N°',
        'CONTENIDOS',
        'Carácter de la clase',
        'OBSERVACIONES',
        'Firma del Profesor',
        'Firma de la Autoridad',
      ];

      const dataRows = scheduledRows.map((row) => {
        const entry =
          workingEntries[row.rowKey] ||
          (row.slotIndex === 0 ? workingEntries[row.dateStr] : undefined) ||
          row.entry;
        const isHol = Boolean(entry.isHoliday);
        return [
          row.dateStr,
          `${row.day}/${row.month}`,
          row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-'),
          row.computedClassNumber,
          isHol ? '-' : entry.unitNumber || '',
          entry.contents || '',
          isHol ? '-' : entry.classCharacter || '',
          entry.observations || '',
          entry.teacherSignature || '',
          entry.authoritySignature || '',
        ];
      });

      try {
        await fetchGoogleApiWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1:Z600`)}:clear`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          },
          token
        );
      } catch (_) {}

      const updateRes = await fetchGoogleApiWithRetry(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [metaRow, emptyRow, headerRow, ...dataRows],
          }),
        },
        token
      );

      if (updateRes.ok && targetSpreadsheetId) {
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`;
        const nextSheetInfo: LibroDeTemasSheetInfo = {
          spreadsheetId: targetSpreadsheetId,
          url: sheetUrl,
          lastSyncedAt: new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setSheetInfo(nextSheetInfo);
        persistLibroData(metadata, workingEntries, characterOptions, true, nextSheetInfo);

        if (openAfterSync) {
          window.open(sheetUrl, '_blank', 'noopener,noreferrer');
        }

        setToastMsg(
          pulledChangesCount > 0
            ? `¡Sincronizado con Google Sheets! Se incorporaron ${pulledChangesCount} cambio(s) desde Sheets.`
            : '¡Libro de Temas sincronizado con Google Sheets en la carpeta de Drive de la materia!'
        );
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (err) {
      console.warn('Error sincronizando Libro de Temas con Google Sheets:', err);
      setToastMsg('No se pudo sincronizar con Google Sheets. Verificá tu conexión de Google.');
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setIsSyncingSheet(false);
      setIsOpeningSheet(false);
    }
  };

  // Abrir directamente la planilla en Google Sheets (o crearla en la carpeta de la materia si aún no existe)
  const handleOpenGoogleSheet = async () => {
    if (sheetInfo?.spreadsheetId && isRealGoogleSpreadsheetId(sheetInfo.spreadsheetId)) {
      const url =
        sheetInfo.url || `https://docs.google.com/spreadsheets/d/${sheetInfo.spreadsheetId}/edit`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await handleSyncWithSheets(true);
  };

  // Copia de seguridad (abre el modal general del curso o descarga respaldo JSON directo)
  const handleOpenOrDownloadBackup = () => {
    if (onOpenBackupModal) {
      onOpenBackupModal();
      return;
    }
    try {
      const payload = {
        app: 'Docenc.ia',
        version: '2.0',
        exportDate: new Date().toISOString(),
        course: { id: courseId, name: courseName },
        libroDeTemas: {
          metadata,
          entries: entriesMap,
          characterOptions,
          sheetInfo,
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Respaldo_LibroDeTemas_${courseName.replace(/\s+/g, '_')}_${todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {}
  };

  // Descargar Libro de Temas en formato Excel (.xlsx)
  const handleDownloadLibro = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const aoa: any[][] = [
        [
          'ASIGNATURA:',
          metadata.asignatura,
          '',
          'PROF. TITULAR:',
          metadata.profTitular,
          '',
          'DÍAS DE CLASE:',
          activeWeekdaysLabel,
          '',
        ],
        [],
        [
          'Día',
          'Mes',
          'Horario / Módulo',
          'Clase N°',
          'Unidad N°',
          'CONTENIDOS',
          'Carácter de la clase',
          'OBSERVACIONES',
          'Firma del Profesor',
          'Firma de la Autoridad',
        ],
        ...filteredRows.map((row) => {
          const isHol = Boolean(row.entry.isHoliday);
          return [
            row.day,
            row.month,
            row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-'),
            row.computedClassNumber,
            isHol ? '-' : row.entry.unitNumber || '',
            row.entry.contents || '',
            isHol ? '-' : row.entry.classCharacter || '',
            row.entry.observations || '',
            row.entry.teacherSignature || '',
            row.entry.authoritySignature || '',
          ];
        }),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 6 },
        { wch: 16 },
        { wch: 10 },
        { wch: 10 },
        { wch: 48 },
        { wch: 22 },
        { wch: 28 },
        { wch: 20 },
        { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Libro de Temas');

      const safeCourse = courseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      XLSX.writeFile(wb, `Libro_de_Temas_${safeCourse}_${todayStr}.xlsx`);

      setToastMsg('Libro de Temas descargado en formato Excel (.xlsx).');
      setTimeout(() => setToastMsg(null), 3500);
    } catch (err) {
      console.warn('Error descargando Libro de Temas:', err);
    }
  };

  return {
    pushLibroSnapshotToSheets,
    handleSyncWithSheets,
    handleOpenGoogleSheet,
    handleExportToGoogleDoc,
    handlePrintLibro,
    handleDownloadLibro,
    handleOpenOrDownloadBackup,
  };
}
