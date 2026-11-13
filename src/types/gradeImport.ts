import { GradeCategory, StudentGradesMap } from './grades';
import { GradeHistoryEntry } from '../utils/excelExport';

export interface ParsedStudentRow {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  matchedFromRaw: string;
  matchScore: number; // 0 to 1
  currentScore?: string;
  importedScore: string;
  editedScore: string;
  isValid: boolean;
  isIncluded: boolean;
  status: 'new' | 'update' | 'same' | 'missing_in_file' | 'invalid';
  note?: string;
}

export type DetectedColumnKind =
  | 'grade'
  | 'absences'
  | 'lates'
  | 'disposition'
  | 'disposition_deduction'
  | 'ignore';

export type QuickPastePreset =
  | 'auto'
  | 'name_and_disp'
  | 'last_first_disp'
  | 'name_and_abs'
  | 'last_first_abs'
  | 'name_abs_disp'
  | 'only_disp_ordered'
  | 'only_abs_ordered';

export interface DetectedColumnConfig {
  colKey: string; // Raw column header in Excel/Sheets
  isIncluded: boolean;
  kind: DetectedColumnKind;
  // For 'grade' columns:
  targetCategoryMode: 'existing' | 'new';
  targetCategoryId: string;
  newCategoryName: string;
  targetSubcategoryMode: 'existing' | 'new';
  targetSubcategoryId: string;
  subcategoryName: string;
}

export interface MultiVerifiedStudentRow {
  rowId: string;
  studentId: string; // Either existing student.id or `new-st-...`
  isNewStudent: boolean;
  studentName: string;
  firstName: string;
  lastName: string;
  studentEmail: string;
  matchedFromRaw: string;
  matchedRawRowIndex?: number;
  matchScore: number;
  isIncluded: boolean;
  // Values keyed by colKey
  valuesByCol: Record<
    string,
    {
      currentVal: string;
      importedVal: string;
      editedVal: string;
      isValid: boolean;
      status: 'new' | 'update' | 'same' | 'empty' | 'invalid';
    }
  >;
}

export interface MultiImportApplyPayload {
  term: '1c' | '2c';
  updatedCategories: GradeCategory[];
  updatedGradesMap: StudentGradesMap;
  historyEntries: GradeHistoryEntry[];
  attendanceUpdates: Record<
    string,
    {
      absences?: number;
      lates?: number;
      disposition?: number;
    }
  >;
  newStudentsToCreate: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
  sourceLabel: string;
}
