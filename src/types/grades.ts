export type SubcategoryScaleMode =
  | 'general'
  | 'custom'
  | 'convert_100'
  | 'sum_group';

export interface GradeScaleSettings {
  minScore: number;
  maxScore: number;
  passingScore: number;
  regularScore: number | null;
}

export type EvaluationInstancesCombineMode = 'average' | 'sum' | 'separate';

export interface GradeEvaluationInstance {
  id: string;
  name: string; // ej. "Oral", "Escrita", "Práctica", "Parte 2"
  customTitle?: string;
  date?: string;
  minScore?: number;
  maxScore?: number;
  passingScore?: number;
  scaleMode?: SubcategoryScaleMode;
  convertToGeneralOnAverage?: boolean;
}

export interface GradeIntensification {
  id: string;
  name: string;
  customTitle?: string;
  date?: string;
  passingScore?: number; // nota mínima para quedar aprobado con línea (—) por defecto
}

export interface GradeSubcategory {
  id: string;
  name: string;
  date?: string;
  minScore?: number; // default: escala general (ej. 1)
  maxScore?: number; // default: escala general (ej. 10), o 5, 100, etc.
  passingScore?: number; // nota mínima de aprobación propia para esta columna (ej. 3.5 sobre 5)
  scaleMode?: SubcategoryScaleMode; // default: 'general'
  convertToGeneralOnAverage?: boolean; // para 'custom': si true, escala proporcionalmente al promedio general
  sumGroupId?: string; // para 'sum_group': ID compartido por las evaluaciones que se suman entre sí
  primaryInstanceName?: string; // etiqueta de la 1° subcolumna cuando hay instancias (ej. "Escrita")
  instances?: GradeEvaluationInstance[]; // instancias adicionales para TODOS los alumnos (ej. "Oral")
  instancesCombineMode?: EvaluationInstancesCombineMode; // 'average' (default) | 'sum' | 'separate'
  intensifications?: GradeIntensification[];
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
