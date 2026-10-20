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

export const DEFAULT_CATEGORIES: GradeCategory[] = [
  {
    id: 'cat-eval',
    name: 'Evaluaciones',
    color: 'bg-blue-500',
    subcategories: [
      { id: 'sub-escrita', name: 'Evaluación Escrita', maxScore: 10 },
      { id: 'sub-oral', name: 'Evaluación Oral', maxScore: 10 },
    ],
  },
  {
    id: 'cat-tp',
    name: 'Trabajos Prácticos',
    color: 'bg-emerald-500',
    subcategories: [
      { id: 'sub-tp1', name: 'TP N° 1 Individual', maxScore: 10 },
      { id: 'sub-tp2', name: 'TP N° 2 Grupal', maxScore: 10 },
    ],
  },
  {
    id: 'cat-part',
    name: 'Desempeño y Tareas',
    color: 'bg-purple-500',
    subcategories: [
      { id: 'sub-cuaderno', name: 'Carpeta / Guías', maxScore: 10 },
    ],
  },
];
