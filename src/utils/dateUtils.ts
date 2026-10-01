/**
 * Date and time utility functions for class attendance and disposition tracking.
 */

export function isSameCalendarDay(
  entryDate?: any,
  entryTimestamp?: any,
  target: Date = new Date()
): boolean {
  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth() + 1; // 1-12
  const targetDay = target.getDate(); // 1-31

  // 1. Check entryTimestamp if present
  if (entryTimestamp !== undefined && entryTimestamp !== null) {
    let tDate: Date | null = null;
    if (typeof entryTimestamp === 'number') {
      tDate = new Date(entryTimestamp);
    } else if (typeof entryTimestamp === 'string') {
      const num = Number(entryTimestamp);
      if (!isNaN(num) && entryTimestamp.trim() !== '') {
        tDate = new Date(num);
      } else {
        tDate = new Date(entryTimestamp);
      }
    } else if (typeof entryTimestamp.toDate === 'function') {
      // Firestore Timestamp
      tDate = entryTimestamp.toDate();
    } else if (typeof entryTimestamp.seconds === 'number') {
      // Firestore Timestamp object representation
      tDate = new Date(entryTimestamp.seconds * 1000);
    } else if (entryTimestamp instanceof Date) {
      tDate = entryTimestamp;
    }

    if (tDate && !isNaN(tDate.getTime())) {
      if (
        tDate.getFullYear() === targetYear &&
        tDate.getMonth() + 1 === targetMonth &&
        tDate.getDate() === targetDay
      ) {
        return true;
      }
    }
  }

  // 2. Check entryDate string if present
  if (entryDate !== undefined && entryDate !== null) {
    const str = String(entryDate).trim();
    if (!str) return false;

    // Pattern A: YYYY-MM-DD or YYYY/MM/DD
    const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10);
      const d = parseInt(isoMatch[3], 10);
      if (y === targetYear && m === targetMonth && d === targetDay) {
        return true;
      }
    }

    // Pattern B: DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1], 10);
      const m = parseInt(dmyMatch[2], 10);
      const y = parseInt(dmyMatch[3], 10);
      if (y === targetYear && m === targetMonth && d === targetDay) {
        return true;
      }
    }

    // Pattern C: Native Date parse fallback
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      if (
        parsed.getFullYear() === targetYear &&
        parsed.getMonth() + 1 === targetMonth &&
        parsed.getDate() === targetDay
      ) {
        return true;
      }
    }
  }

  return false;
}

export function formatLocalDateDMY(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatLocalTimeHMS(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
