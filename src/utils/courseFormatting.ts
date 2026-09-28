import { Course } from '../types';

/**
 * Standardizes course labels across the sidebar, navigation, and dropdowns
 * to follow the school format requested by the teacher:
 * "Materia (Orientación y División)"
 *
 * Examples:
 *  - "Historia (S2 Nat)"
 *  - "Historia (S1 Soc1)"
 *  - "Matemática (S5 Eco)"
 */
export function formatCourseSidebarLabel(course: Course | null | undefined): string {
  if (!course) return '';

  const name = (course.name || '').trim();
  const subject = (course.subject || '').trim();
  const orientation = (course.orientation || '').trim();
  const division = (course.division || '').trim();
  const section = (course.section || '').trim();
  const grade = (course.grade || '').trim();

  // 1. If course name is already in the format "Materia (Orientación y División)"
  // e.g., "Historia (S2 Nat)" or "Historia (S1 Soc1)"
  const parenMatch = name.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const subjPart = parenMatch[1].trim();
    const groupPart = parenMatch[2].trim();
    return `${subjPart} (${groupPart})`;
  }

  // 2. If explicit division and orientation exist (e.g. division: "S2", orientation: "Nat")
  if (division && orientation) {
    const mainSubject = subject || name;
    return `${mainSubject} (${division} ${orientation})`;
  }

  // 3. If explicit division or section with standard secondary codes (e.g. "S2 Nat", "S1 Soc1")
  const combinedGroup = [division, orientation].filter(Boolean).join(' ').trim() || section;
  if (
    combinedGroup &&
    (combinedGroup.match(/^[Ss]\d+/) ||
      combinedGroup.match(/\b(Nat|Soc|Soc\d+|Eco|Arte|Hum|Exa|Bio|Com|Tec)/i))
  ) {
    const mainSubject = subject || name.replace(/[-–—]\s*[Ss]\d+.*$/, '').trim();
    return `${mainSubject} (${combinedGroup})`;
  }

  // 4. Check if course name has hyphen separator like "Historia - S2 Nat" or "Historia - S1 Soc1"
  const dashMatch = name.match(/^([^-–—]+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim();

    // Check if right looks like "S2 Nat", "S1 Soc1", etc.
    if (right.match(/^[Ss]\d+/) || right.match(/\b(Nat|Soc|Soc\d+|Eco|Arte)/i)) {
      return `${left} (${right})`;
    }

    // Check if left is grade/level like "4to Año A" and right is orientation "Ciencias Naturales"
    if (
      (left.toLowerCase().includes('año') ||
        left.toLowerCase().includes('grado') ||
        left.match(/^[Ss]\d+/i)) &&
      subject
    ) {
      const divMatch =
        left.match(/[Ss]\d+/i)?.[0] ||
        left.match(/\d+[°º]?\s*[a-zA-Z]?/)?.[0]?.replace(/\s+/g, '') ||
        left;
      let orientShort = 'Nat';
      const rLower = right.toLowerCase();
      if (rLower.includes('natural')) orientShort = 'Nat';
      else if (rLower.includes('social')) orientShort = 'Soc';
      else if (rLower.includes('econom')) orientShort = 'Eco';
      else if (rLower.includes('comput') || rLower.includes('infor')) orientShort = 'Info';
      else if (rLower.includes('matem')) orientShort = 'Mat';
      else orientShort = right.slice(0, 4);

      // Clean subject (take primary subject name e.g. "Biología" or "Matemática")
      const primarySubj = subject.split(' ')[0] || subject;
      return `${primarySubj} (${divMatch} ${orientShort})`;
    }

    // Default hyphen format: Subject - Group -> Subject (Group)
    return `${left} (${right})`;
  }

  // 5. Check if course name ends with S<num> <orient> pattern, e.g., "Historia S2 Nat" or "Historia S1 Soc1"
  const sPatternMatch = name.match(/^(.+?)\s+([Ss]\d+\s+[A-Za-z0-9]+)$/);
  if (sPatternMatch) {
    return `${sPatternMatch[1].trim()} (${sPatternMatch[2].trim()})`;
  }

  // 6. Check section or grade with secondary division (S1, S2, etc.)
  if (section) {
    const mainSubject = subject || name;
    return `${mainSubject} (${section})`;
  }

  if (
    grade &&
    (grade.match(/^[Ss]\d+/) ||
      grade.includes('°') ||
      grade.toLowerCase().includes('secundaria'))
  ) {
    const cleanGrade = grade.replace(/secundaria\s*[-–—]?\s*/i, '').trim();
    const mainSubject = subject || name;
    if (cleanGrade) {
      return `${mainSubject} (${cleanGrade})`;
    }
  }

  // 7. Fallback if both subject and name exist and differ
  if (subject && name && subject !== name) {
    return `${subject} (${name})`;
  }

  return name || subject || 'Materia';
}
