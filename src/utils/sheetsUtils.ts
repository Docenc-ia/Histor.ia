/**
 * Utilities for Google Sheets integration, validation, and safe clipboard export
 */

/**
 * Validates if an ID is a genuine Google Spreadsheets ID (44 characters typically)
 * and NOT a simulated/local identifier like 'sheet-disp-c-1' or 'libreta-101'.
 */
export const isRealGoogleSpreadsheetId = (id?: string | null): boolean => {
  if (!id || typeof id !== 'string') return false;
  const cleanId = id.trim();
  if (
    cleanId.startsWith('sheet-') ||
    cleanId.startsWith('libreta-') ||
    cleanId.startsWith('mock-') ||
    cleanId.startsWith('fake-') ||
    cleanId.startsWith('disp-') ||
    cleanId.startsWith('folder-')
  ) {
    return false;
  }
  // Authentic Google Sheet / Drive IDs are alphanumeric strings (usually 25-50 characters)
  return cleanId.length >= 25 && /^[a-zA-Z0-9_-]+$/.test(cleanId);
};

/**
 * Extracts a real Google Spreadsheet ID from either a full Google Sheets URL
 * (e.g. https://docs.google.com/spreadsheets/d/12yId5S8Zj5.../edit) or a raw ID string.
 */
export const extractSpreadsheetIdFromInput = (input?: string | null): string | null => {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1] && isRealGoogleSpreadsheetId(urlMatch[1])) {
    return urlMatch[1];
  }
  if (isRealGoogleSpreadsheetId(trimmed)) {
    return trimmed;
  }
  return null;
};

/**
 * Returns a valid Google Sheets URL if the ID is real, or null if it is simulated
 */
export const getSafeGoogleSpreadsheetUrl = (id?: string | null): string | null => {
  if (!isRealGoogleSpreadsheetId(id)) return null;
  return `https://docs.google.com/spreadsheets/d/${id!.trim()}/edit`;
};

/**
 * Formats tabular data into Tab-Separated Values (TSV) which pastes natively into Google Sheets and Excel
 */
export const formatTsv = (headers: string[], rows: (string | number | undefined | null)[][]): string => {
  const cleanHeader = headers.join('\t');
  const cleanRows = rows.map((r) =>
    r
      .map((c) => {
        if (c === undefined || c === null) return '';
        const str = String(c).replace(/[\t\r\n]/g, ' ');
        return str;
      })
      .join('\t')
  );
  return [cleanHeader, ...cleanRows].join('\n');
};

/**
 * Copies tabular data to the user's clipboard in TSV format
 */
export const copyTableToClipboard = async (
  headers: string[],
  rows: (string | number | undefined | null)[][]
): Promise<boolean> => {
  try {
    const tsv = formatTsv(headers, rows);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(tsv);
      return true;
    } else {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = tsv;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    }
  } catch (err) {
    console.warn('Could not copy to clipboard:', err);
    return false;
  }
};
