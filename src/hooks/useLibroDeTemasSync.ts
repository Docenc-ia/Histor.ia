import React from 'react';
import { driveService } from '../services/workspace/driveService';
import { buildOfficialLibroDeTemasHtml as buildLibroHtml } from '../utils/libroDeTemasHtml';
import { touchCourseDataLru } from '../utils/lruCourseCache';
import {
  LibroDeTemasEntry,
  LibroDeTemasMetadata,
  ScheduledRow,
} from '../components/modules/LibroDeTemasMatrix';
import { DriveSaveFormat, SavedDriveFileResult } from '../utils/driveFormatExporters';

export interface UseLibroDeTemasSyncProps {
  courseId: string;
  courseName: string;
  driveFolderId?: string;
  todayStr: string;
  metadata: LibroDeTemasMetadata;
  entriesMap: Record<string, LibroDeTemasEntry>;
  characterOptions: string[];
  filteredRows: ScheduledRow[];
  activeWeekdaysLabel: string;
  scheduleSummaryText: string;
  setExportedDocLink: React.Dispatch<
    React.SetStateAction<{ url: string; name: string } | null>
  >;
  onOpenBackupModal?: () => void;
}

export function useLibroDeTemasSync({
  courseId,
  courseName,
  driveFolderId,
  todayStr,
  metadata,
  entriesMap,
  characterOptions,
  filteredRows,
  activeWeekdaysLabel,
  scheduleSummaryText,
  setExportedDocLink,
  onOpenBackupModal,
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

  // Imprimir folio oficial en formato horizontal y alojar copia en subcarpeta "Libro de Temas"
  const handlePrintLibro = () => {
    const html = buildOfficialLibroDeTemasHtml();
    const safeCourse = courseName.replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
    driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Libro de Temas',
        fileName: `Folio_Impreso_Libro_de_Temas_${safeCourse}_${todayStr}.html`,
        content: html,
        mimeType: 'text/html',
        existingMainFolderId: driveFolderId,
      })
      .catch(() => {});

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

  const handleSaveLibroInFormat = async (
    format: DriveSaveFormat,
    customTitle: string
  ): Promise<SavedDriveFileResult | null> => {
    const cleanTitle =
      customTitle.trim() || `Libro de Temas - ${courseName} (${todayStr})`;

    if (format === 'gdoc') {
      const htmlContent = buildOfficialLibroDeTemasHtml();
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Libro de Temas',
        fileName: cleanTitle,
        content: htmlContent,
        mimeType: 'text/html',
        existingMainFolderId: driveFolderId,
        convertToGoogleFormat: 'doc',
      });
      if (!uploaded) return null;
      setExportedDocLink({ url: uploaded.url, name: uploaded.name });
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'gdoc',
        formatLabel: 'Google Docs (.gdoc editable)',
        category: 'Libro de Temas',
      };
    }

    if (format === 'sheets' || format === 'csv') {
      const escapeCsv = (val: unknown) => {
        const s = val === null || val === undefined ? '' : String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      const metaLine = [
        'ASIGNATURA:',
        metadata.asignatura,
        'PROF. TITULAR:',
        metadata.profTitular,
        'DÍAS DE CLASE:',
        activeWeekdaysLabel,
      ]
        .map(escapeCsv)
        .join(',');
      const headers = [
        'Fecha (ISO)',
        'Día / Mes',
        'Horario / Módulo',
        'Clase N°',
        'Unidad N°',
        'CONTENIDOS',
        'Carácter de la clase',
        'OBSERVACIONES',
        'Firma del Profesor',
        'Firma de la Autoridad',
      ]
        .map(escapeCsv)
        .join(',');
      const rows = filteredRows.map((row) => {
        const isHol = Boolean(row.entry.isHoliday);
        return [
          row.dateStr,
          `${row.day}/${row.month}`,
          row.timeLabel || (row.totalSlotsForDay > 1 ? `${row.slotIndex + 1}° Hora` : '-'),
          row.computedClassNumber,
          isHol ? '-' : row.entry.unitNumber || '',
          row.entry.contents || '',
          isHol ? '-' : row.entry.classCharacter || '',
          row.entry.observations || '',
          row.entry.teacherSignature || '',
          row.entry.authoritySignature || '',
        ]
          .map(escapeCsv)
          .join(',');
      });
      const csvContent = '\uFEFF' + [metaLine, '', headers, ...rows].join('\n');
      if (format === 'csv') {
        const fileNameCsv = cleanTitle.toLowerCase().endsWith('.csv')
          ? cleanTitle
          : `${cleanTitle}.csv`;
        try {
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileNameCsv;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (_) {}
        const uploadedCsv = await driveService.uploadFileToCourseCategory({
          courseName,
          category: 'Libro de Temas',
          fileName: fileNameCsv,
          content: csvContent,
          mimeType: 'text/csv',
          existingMainFolderId: driveFolderId,
          convertToGoogleFormat: false,
        });
        if (!uploadedCsv) return null;
        return {
          id: uploadedCsv.id,
          name: uploadedCsv.name,
          url: uploadedCsv.url,
          folderUrl: uploadedCsv.folderUrl,
          format: 'csv',
          formatLabel: 'Archivo CSV (.csv)',
          category: 'Libro de Temas',
        };
      }
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Libro de Temas',
        fileName: cleanTitle,
        content: csvContent,
        mimeType: 'text/csv',
        existingMainFolderId: driveFolderId,
        convertToGoogleFormat: 'sheet',
      });
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'sheets',
        formatLabel: 'Google Sheets (.gsheet)',
        category: 'Libro de Temas',
      };
    }

    if (format === 'xlsx') {
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
      const fileName = cleanTitle.toLowerCase().endsWith('.xlsx')
        ? cleanTitle
        : `${cleanTitle}.xlsx`;
      XLSX.writeFile(wb, fileName);

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const uploaded = await driveService.uploadFileToCourseCategory({
        courseName,
        category: 'Libro de Temas',
        fileName,
        content: buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        existingMainFolderId: driveFolderId,
      });
      if (!uploaded) return null;
      return {
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.url,
        folderUrl: uploaded.folderUrl,
        format: 'xlsx',
        formatLabel: 'Microsoft Excel (.xlsx)',
        category: 'Libro de Temas',
      };
    }

    // format === 'html'
    const html = buildOfficialLibroDeTemasHtml();
    const fileNameHtml = cleanTitle.toLowerCase().endsWith('.html')
      ? cleanTitle
      : `${cleanTitle}.html`;
    const uploaded = await driveService.uploadFileToCourseCategory({
      courseName,
      category: 'Libro de Temas',
      fileName: fileNameHtml,
      content: html,
      mimeType: 'text/html',
      existingMainFolderId: driveFolderId,
      convertToGoogleFormat: false,
    });

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
        setTimeout(() => document.body.removeChild(iframe), 1500);
      }, 300);
    }

    if (!uploaded) return null;
    return {
      id: uploaded.id,
      name: uploaded.name,
      url: uploaded.url,
      folderUrl: uploaded.folderUrl,
      format: 'html',
      formatLabel: 'Reporte Imprimible HTML / PDF',
      category: 'Libro de Temas',
    };
  };

  return {
    handleSaveLibroInFormat,
    handlePrintLibro,
    handleOpenOrDownloadBackup,
  };
}
