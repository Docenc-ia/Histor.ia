export interface GradeSubcategory {
  id: string;
  name: string;
  date?: string;
  maxScore?: number; // default 10
}

export interface GradeCategory {
  id: string;
  name: string;
  color?: string;
  calculationType?: 'simple_average' | 'weighted' | 'manual';
  weight?: number;
  subcategories: GradeSubcategory[];
}

export interface CourseGradebookConfig {
  courseId: string;
  categories: GradeCategory[];
  overallCalculationType: 'average_of_categories' | 'weighted_categories' | 'manual_final';
}

// Student grades: studentId -> subcategoryId -> score (number or string like "7.5", "A", or empty)
// También soporta studentId -> categoryId -> score (si el docente pone una nota general manual de categoría)
// Y studentId -> '__final__' -> score (para nota final manual si el docente no quiere promedio matemático)
export type StudentGradesMap = Record<string, Record<string, string>>;
