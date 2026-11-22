import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Download,
  ExternalLink,
  X,
  CheckCircle2,
  FileText,
  AlertCircle,
  School,
  Folder,
  Loader2,
  UserCheck,
  Save,
} from 'lucide-react';
import { Student, StudentDispositionData, StudentObservation } from '../../types';
import { GradeCategory, StudentGradesMap, DEFAULT_CATEGORIES } from '../../types/grades';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { deriveSchoolFromEmail } from '../../services/workspace/googleAuth';
import {
  driveService,
  formatCourseDriveFolderName,
  getDirectDriveFolderUrl,
} from '../../services/workspace/driveService';
import {
  getAllDispositionStorage,
  getStorageItemForUser,
  setStorageItemForUser,
} from '../../services/storageHelpers';
import { firestoreSync, getActiveUserId } from '../../services/firestoreSync';
import {
  getCourseAttendanceSettings,
} from '../../utils/attendanceCalculations';
import { generateCourseReportHtml } from '../../utils/courseReportHtml';
import {
  buildConsolidatedReportStudents,
  computeCourseReportStats,
  filterCourseDispositionMap,
  resolveEffectiveTermScoresMap,
  type ReportGradesPeriod,
} from '../../utils/courseReportAggregator';
import { useTerminologySettings } from '../../utils/terminologySettings';
import { ReportElementsToolbar } from './courseReport/ReportElementsToolbar';
import { CourseConsolidatedReportView } from './courseReport/CourseConsolidatedReportView';
import { StudentIndividualReportList } from './courseReport/StudentIndividualReportList';
import { SaveToDriveConfirmDialog } from './courseReport/SaveToDriveConfirmDialog';

export interface ExamGradeDetailItem {
  id: string;
  categoryName: string;
  itemName: string;
  score: string;
}

export interface CourseReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  students: Student[];
  isDarkMode: boolean;
  score1cMap: Record<string, { scoreStr: string; num: number | null }>;
  score2cMap: Record<string, { scoreStr: string; num: number | null }>;
  annualOverrides: Record<string, string>;
  getStudentMetrics?: (
    studentId: string,
    targetTerm?: '1c' | '2c' | 'annual' | 'all'
  ) => StudentDispositionData;
  driveFolderId?: string;
  driveFolderUrl?: string;
  initialTab?: 'course' | 'individual';
  initialStudentId?: string;
  initialPreset?: 'all' | 'attendance' | 'grades' | 'disposition';
  initialGradesPeriod?: ReportGradesPeriod;
}

export const CourseReportModal: React.FC<CourseReportModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseName,
  students,
  isDarkMode,
  score1cMap,
  score2cMap,
  annualOverrides,
  getStudentMetrics,
  driveFolderId,
  driveFolderUrl,
  initialTab = 'course',
  initialStudentId,
  initialPreset = 'all',
  initialGradesPeriod = 'both',
}) => {
  const { user } = useWorkspaceAuth();
  const {
    attendanceLabel,
    dispositionLabel,
    term1FullLabel,
    term2FullLabel,
    term1ShortLabel,
    term2ShortLabel,
  } = useTerminologySettings();
  const [activeTab, setActiveTab] = useState<'course' | 'individual'>(initialTab);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId || 'all');
  const [gradesPeriod, setGradesPeriod] = useState<ReportGradesPeriod>(initialGradesPeriod);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [showDriveConfirmModal, setShowDriveConfirmModal] = useState(false);
  const [driveSavedResult, setDriveSavedResult] = useState<{
    success: boolean;
    name: string;
    url: string;
    isLiveGoogle: boolean;
    folderName: string;
    errorMessage?: string;
  } | null>(null);

  // Sync active tab, selected student, grades period, and clear stale Drive status whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSelectedStudentId(initialStudentId || 'all');
      setGradesPeriod(initialGradesPeriod);
      setDriveSavedResult(null);
    }
  }, [isOpen, initialTab, initialStudentId, initialGradesPeriod]);
  const [courseObservation, setCourseObservation] = useState<string>(() => {
    try {
      return getStorageItemForUser(`fds_report_course_observation_${courseId}`) || '';
    } catch {
      return '';
    }
  });

  const courseObsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCourseObsRef = useRef<string | null>(null);
  const studentObsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStudentObsMapRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    return () => {
      const userId = getActiveUserId();
      if (courseObsTimerRef.current) {
        clearTimeout(courseObsTimerRef.current);
        courseObsTimerRef.current = null;
      }
      if (userId && pendingCourseObsRef.current !== null) {
        const textToFlush = pendingCourseObsRef.current;
        pendingCourseObsRef.current = null;
        firestoreSync.saveUserSetting(userId, `course_obs_${courseId}`, textToFlush).catch(() => {});
      }
      if (studentObsTimerRef.current) {
        clearTimeout(studentObsTimerRef.current);
        studentObsTimerRef.current = null;
      }
      if (userId && pendingStudentObsMapRef.current !== null) {
        const mapToFlush = pendingStudentObsMapRef.current;
        pendingStudentObsMapRef.current = null;
        firestoreSync
          .saveUserSetting(userId, `student_report_obs_${courseId}`, mapToFlush)
          .catch(() => {});
      }
    };
  }, [courseId]);

  const handleUpdateCourseObservation = (text: string) => {
    setCourseObservation(text);
    try {
      setStorageItemForUser(`fds_report_course_observation_${courseId}`, text);
      pendingCourseObsRef.current = text;
      if (courseObsTimerRef.current) {
        clearTimeout(courseObsTimerRef.current);
      }
      courseObsTimerRef.current = setTimeout(() => {
        courseObsTimerRef.current = null;
        pendingCourseObsRef.current = null;
        const userId = getActiveUserId();
        if (userId) {
          firestoreSync.saveUserSetting(userId, `course_obs_${courseId}`, text).catch(() => {});
        }
      }, 450);
    } catch (err) {
      console.error('Error saving course report observation:', err);
    }
  };

  // Customization of report elements (Docente puede elegir qué poner clickeando las opciones)
  const [includeGrades, setIncludeGrades] = useState<boolean>(
    initialPreset === 'attendance' || initialPreset === 'disposition' ? false : true
  );
  const [includeExamDetails, setIncludeExamDetails] = useState<boolean>(
    initialPreset === 'attendance' || initialPreset === 'disposition' ? false : true
  );
  const [includeAttendance, setIncludeAttendance] = useState<boolean>(
    initialPreset === 'grades' || initialPreset === 'disposition' ? false : true
  );
  const [includeDisposition, setIncludeDisposition] = useState<boolean>(
    initialPreset === 'grades' || initialPreset === 'attendance' ? false : true
  );
  const [includeDispositionReasons, setIncludeDispositionReasons] = useState<boolean>(
    initialPreset === 'grades' || initialPreset === 'attendance' ? false : true
  );
  const [excludedDispositionReasonIds, setExcludedDispositionReasonIds] = useState<Set<string>>(
    () => new Set<string>()
  );
  const [includeObservations, setIncludeObservations] = useState<boolean>(true);
  const [includeFamilySignature, setIncludeFamilySignature] = useState<boolean>(
    initialPreset !== 'all'
  );
  const effectiveReason = 'Informe de Trayectoria';

  const handleToggleDispositionReason = (reasonId: string) => {
    if (!includeDispositionReasons) {
      setIncludeDispositionReasons(true);
    }
    setExcludedDispositionReasonIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(reasonId)) {
        next.delete(reasonId);
      } else {
        next.add(reasonId);
      }
      return next;
    });
  };

  const handleSelectAllStudentDispositionReasons = (reasonIds: string[], selectAll: boolean) => {
    if (selectAll && !includeDispositionReasons) {
      setIncludeDispositionReasons(true);
    }
    setExcludedDispositionReasonIds((prev) => {
      const next = new Set<string>(prev);
      reasonIds.forEach((id) => {
        if (selectAll) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  };

  const selectedElementsCount =
    (includeGrades ? 1 : 0) +
    (includeAttendance ? 1 : 0) +
    (includeDisposition ? 1 : 0) +
    (includeObservations ? 1 : 0);

  const dispositionHistory = useMemo(() => {
    try {
      const storedHistory = getAllDispositionStorage().history || [];
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const item of storedHistory) {
        if (!item || !item.id) continue;
        if (!seen.has(String(item.id))) {
          seen.add(String(item.id));
          merged.push(item);
        }
      }
      return merged;
    } catch {
      return [];
    }
  }, [courseId, isOpen]);

  // Load attendance, disposition and observations maps strictly scoped to courseId
  const disp1cMap = useMemo(() => {
    try {
      const raw = getStorageItemForUser(`fds_disposition_data_${courseId}_1c`);
      if (raw) {
        const parsed = filterCourseDispositionMap(JSON.parse(raw), courseId);
        if (Object.keys(parsed).length > 0) return parsed;
      }
      const globalDisp = getAllDispositionStorage().disposition || {};
      return filterCourseDispositionMap(globalDisp, courseId);
    } catch {
      return {};
    }
  }, [courseId, isOpen]);

  const disp2cMap = useMemo(() => {
    try {
      const raw = getStorageItemForUser(`fds_disposition_data_${courseId}_2c`);
      if (raw) {
        const parsed = filterCourseDispositionMap(JSON.parse(raw), courseId);
        if (Object.keys(parsed).length > 0) return parsed;
      }
      const global2cRaw = getStorageItemForUser('fds_disposition_data_2c');
      return global2cRaw ? filterCourseDispositionMap(JSON.parse(global2cRaw), courseId) : {};
    } catch {
      return {};
    }
  }, [courseId, isOpen]);

  // Load Categories and Grades Maps from Pestaña Calificaciones (1°C and 2°C)
  const categories1c = useMemo<GradeCategory[]>(() => {
    try {
      const raw =
        getStorageItemForUser(`fds_grades_categories_${courseId}_1c`) ||
        getStorageItemForUser(`fds_grades_categories_${courseId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_CATEGORIES;
  }, [courseId, isOpen]);

  const categories2c = useMemo<GradeCategory[]>(() => {
    try {
      const raw = getStorageItemForUser(`fds_grades_categories_${courseId}_2c`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_CATEGORIES.map((cat) => ({
      ...cat,
      id: `c2-${cat.id}`,
      subcategories: cat.subcategories.map((sub) => ({ ...sub, id: `c2-${sub.id}` })),
    }));
  }, [courseId, isOpen]);

  const gradesData1c = useMemo<StudentGradesMap>(() => {
    try {
      const raw =
        getStorageItemForUser(`fds_grades_data_${courseId}_1c`) ||
        getStorageItemForUser(`fds_grades_data_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId, isOpen]);

  const gradesData2c = useMemo<StudentGradesMap>(() => {
    try {
      const raw = getStorageItemForUser(`fds_grades_data_${courseId}_2c`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [courseId, isOpen]);

  const calcMode1c = useMemo<'average_of_categories' | 'manual_final'>(() => {
    try {
      const raw =
        getStorageItemForUser(`fds_grades_final_calc_${courseId}_1c`) ||
        getStorageItemForUser(`fds_grades_final_calc_${courseId}`);
      if (raw === 'average_of_categories' || raw === 'manual_final') return raw;
    } catch {}
    return 'manual_final';
  }, [courseId, isOpen]);

  const calcMode2c = useMemo<'average_of_categories' | 'manual_final'>(() => {
    try {
      const raw = getStorageItemForUser(`fds_grades_final_calc_${courseId}_2c`);
      if (raw === 'average_of_categories' || raw === 'manual_final') return raw;
    } catch {}
    return 'manual_final';
  }, [courseId, isOpen]);

  // Load Student Profile observations from Ficha del Alumno as default fallback
  const profileObservationsMap = useMemo<Record<string, StudentObservation[]>>(() => {
    try {
      const merged: Record<string, StudentObservation[]> = {};
      const keysToCheck = [
        'fds_student_observations',
        `fds_student_observations_${courseId}`,
        'student_observations',
      ];
      for (const key of keysToCheck) {
        const raw = getStorageItemForUser(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed);
          }
        }
      }
      return merged;
    } catch {
      return {};
    }
  }, [courseId, isOpen]);

  // Dedicated observations for reports / certificates
  const [reportObservations, setReportObservations] = useState<Record<string, string>>(() => {
    try {
      const raw = getStorageItemForUser(`fds_report_student_observations_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Hydrate observations from local storage and Firestore cloud when courseId changes, preventing cross-course race conditions
  useEffect(() => {
    let isMounted = true;
    const targetCourseId = courseId;

    try {
      setCourseObservation(
        getStorageItemForUser(`fds_report_course_observation_${targetCourseId}`) || ''
      );
    } catch {
      setCourseObservation('');
    }

    try {
      const rawStudentObs = getStorageItemForUser(
        `fds_report_student_observations_${targetCourseId}`
      );
      setReportObservations(rawStudentObs ? JSON.parse(rawStudentObs) : {});
    } catch {
      setReportObservations({});
    }

    const userId = getActiveUserId();
    if (!userId || !targetCourseId) {
      return () => {
        isMounted = false;
      };
    }

    firestoreSync
      .loadUserSetting<string>(userId, `course_obs_${targetCourseId}`)
      .then((cloudObs) => {
        if (!isMounted || !cloudObs || typeof cloudObs !== 'string') return;
        setCourseObservation((prev) => prev || cloudObs);
        setStorageItemForUser(`fds_report_course_observation_${targetCourseId}`, cloudObs);
      })
      .catch(() => {});

    firestoreSync
      .loadUserSetting<Record<string, string>>(userId, `student_report_obs_${targetCourseId}`)
      .then((cloudMap) => {
        if (!isMounted || !cloudMap || typeof cloudMap !== 'object') return;
        setReportObservations((prev) => {
          const merged = { ...cloudMap, ...prev };
          setStorageItemForUser(
            `fds_report_student_observations_${targetCourseId}`,
            JSON.stringify(merged)
          );
          return merged;
        });
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  const handleUpdateStudentReportObservation = (studentId: string, text: string) => {
    setReportObservations((prev) => {
      const updated = { ...prev, [studentId]: text };
      try {
        setStorageItemForUser(
          `fds_report_student_observations_${courseId}`,
          JSON.stringify(updated)
        );
        pendingStudentObsMapRef.current = updated;
        if (studentObsTimerRef.current) {
          clearTimeout(studentObsTimerRef.current);
        }
        studentObsTimerRef.current = setTimeout(() => {
          studentObsTimerRef.current = null;
          pendingStudentObsMapRef.current = null;
          const userId = getActiveUserId();
          if (userId) {
            firestoreSync
              .saveUserSetting(userId, `student_report_obs_${courseId}`, updated)
              .catch(() => {});
          }
        }, 450);
      } catch (err) {
        console.error('Error saving report observation:', err);
      }
      return updated;
    });
  };

  // Fallback loading of grades and annual overrides if opened outside of GradebookMatrix
  const effectiveScore1cMap = useMemo(
    () =>
      resolveEffectiveTermScoresMap(
        score1cMap,
        students,
        categories1c,
        gradesData1c,
        calcMode1c
      ),
    [score1cMap, students, categories1c, gradesData1c, calcMode1c]
  );

  const effectiveScore2cMap = useMemo(
    () =>
      resolveEffectiveTermScoresMap(
        score2cMap,
        students,
        categories2c,
        gradesData2c,
        calcMode2c
      ),
    [score2cMap, students, categories2c, gradesData2c, calcMode2c]
  );

  const effectiveOverrides = useMemo(() => {
    if (annualOverrides && Object.keys(annualOverrides).length > 0) return annualOverrides;
    try {
      const raw = getStorageItemForUser(`fds_grades_annual_override_${courseId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [annualOverrides, courseId, isOpen]);

  const courseAttendanceSettings = useMemo(
    () => getCourseAttendanceSettings(courseId),
    [courseId, isOpen]
  );

  // Consolidate full student annual data + detailed exam/TP grades + disposition deduction reasons
  const consolidatedStudents = useMemo(
    () =>
      buildConsolidatedReportStudents({
        courseId,
        students,
        effectiveScore1cMap,
        effectiveScore2cMap,
        effectiveOverrides,
        categories1c,
        categories2c,
        gradesData1c,
        gradesData2c,
        disp1cMap,
        disp2cMap,
        dispositionHistory,
        getStudentMetrics,
        courseAttendanceSettings,
        reportObservations,
        profileObservationsMap,
      }),
    [
      courseId,
      students,
      effectiveScore1cMap,
      effectiveScore2cMap,
      effectiveOverrides,
      categories1c,
      categories2c,
      gradesData1c,
      gradesData2c,
      disp1cMap,
      disp2cMap,
      dispositionHistory,
      getStudentMetrics,
      courseAttendanceSettings,
      reportObservations,
      profileObservationsMap,
    ]
  );

  // Overall Statistics (period-aware when 1°C or 2°C is selected)
  const stats = useMemo(
    () => computeCourseReportStats(consolidatedStudents, gradesPeriod),
    [consolidatedStudents, gradesPeriod]
  );

  if (!isOpen) return null;

  const teacherName = user?.name || 'Profesor/a a cargo';
  const schoolName = user?.school || deriveSchoolFromEmail(user?.email) || 'Institución Educativa';
  const currentSchoolYear = String(new Date().getFullYear());
  const minAttendancePercent = Math.max(
    0,
    Math.min(100, Math.round(100 - (courseAttendanceSettings.maxAbsencePercent || 25)))
  );
  const currentDate = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Students to show in individual mode
  const displayedStudents =
    selectedStudentId === 'all'
      ? consolidatedStudents
      : consolidatedStudents.filter((s) => s.student.id === selectedStudentId);

  const displayedStudentsForHtml = displayedStudents.map((row) => ({
    ...row,
    dispositionReasons: includeDispositionReasons
      ? row.dispositionReasons.filter((r) => !excludedDispositionReasonIds.has(r.id))
      : [],
  }));

  const periodFileSuffix =
    includeGrades && gradesPeriod === '1c'
      ? '_1C'
      : includeGrades && gradesPeriod === '2c'
      ? '_2C'
      : '';
  const periodTitleSuffix =
    includeGrades && gradesPeriod === '1c'
      ? ` (${term1ShortLabel})`
      : includeGrades && gradesPeriod === '2c'
      ? ` (${term2ShortLabel})`
      : '';

  // Generate self-contained standalone HTML document for download or Drive upload
  const generateHtmlDocument = (type: 'course' | 'individual') =>
    generateCourseReportHtml({
      type,
      courseName,
      schoolName,
      teacherName,
      currentDate,
      schoolYear: currentSchoolYear,
      minAttendancePercent,
      effectiveReason,
      stats,
      consolidatedStudents,
      displayedStudents: displayedStudentsForHtml,
      courseObservation,
      includeGrades,
      gradesPeriod,
      includeExamDetails,
      includeAttendance,
      includeDisposition,
      includeDispositionReasons,
      includeObservations,
      includeFamilySignature,
    });

  // Download locally (.html printable file) and host in Informes subfolder in Google Drive
  const handleDownloadHtml = () => {
    const html = generateHtmlDocument(activeTab);
    const singleStudent =
      activeTab === 'individual' && selectedStudentId !== 'all'
        ? consolidatedStudents.find((s) => s.student.id === selectedStudentId)
        : null;
    const fileName =
      activeTab === 'course'
        ? `Informe_Consolidado_${courseName.replace(/\s+/g, '_')}${periodFileSuffix}_${currentSchoolYear}.html`
        : singleStudent
        ? `Ficha_Trayectoria_${singleStudent.student.lastName}_${singleStudent.student.firstName}_${courseName.replace(/\s+/g, '_')}${periodFileSuffix}.html`
        : `Boletines_Individuales_${courseName.replace(/\s+/g, '_')}${periodFileSuffix}_${currentSchoolYear}.html`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    driveService
      .uploadFileToCourseCategory({
        courseName,
        category: 'Informes',
        fileName,
        content: html,
        mimeType: 'text/html',
        existingMainFolderId: driveFolderId,
      })
      .catch(() => {});
  };

  // Compute the target Google Doc title
  const getTargetGoogleDocTitle = () => {
    if (activeTab === 'course') {
      return `Informe Consolidado${periodTitleSuffix || ' Anual'} - ${courseName}`;
    }
    if (selectedStudentId !== 'all') {
      const single = consolidatedStudents.find((s) => s.student.id === selectedStudentId);
      if (single) {
        return `Ficha de Trayectoria${periodTitleSuffix} - ${single.student.lastName}, ${single.student.firstName} (${courseName})`;
      }
    }
    return `Fichas Individuales de Trayectoria${periodTitleSuffix} - ${courseName}`;
  };

  // Save directly as a native editable Google Doc (.gdoc) in the course's Google Drive folder
  const executeSaveToDrive = async () => {
    setShowDriveConfirmModal(false);
    setIsSavingToDrive(true);
    setDriveSavedResult(null);

    try {
      // 1. Resolve or prepare the folder structure for the course (including "Informes" subfolder)
      const folderStructure = await driveService.setupCourseFolderStructure(
        courseName,
        driveFolderId
      );
      const targetFolderId = folderStructure.reportsFolder?.id || folderStructure.mainFolder.id;
      const targetFolderName = folderStructure.reportsFolder
        ? `${folderStructure.mainFolder.name} / ${folderStructure.reportsFolder.name}`
        : folderStructure.mainFolder.name;

      // 2. Generate HTML report and convert to native Google Doc (.gdoc)
      const htmlContent = generateHtmlDocument(activeTab);
      const docTitle = getTargetGoogleDocTitle();

      // 3. Upload file to Google Drive folder with convertToGoogleDoc = true
      const result = await driveService.uploadReportFile(
        docTitle,
        htmlContent,
        targetFolderId,
        'text/html',
        undefined,
        true
      );

      setDriveSavedResult({
        success: true,
        name: result.name,
        url: result.url,
        isLiveGoogle: result.isLiveGoogle,
        folderName: targetFolderName,
      });
    } catch (err: any) {
      console.error('Error saving report as Google Doc to Google Drive:', err);
      setDriveSavedResult({
        success: false,
        name: '',
        url: '',
        isLiveGoogle: false,
        folderName: '',
        errorMessage:
          err?.message ||
          'No se pudo guardar el informe en Google Drive. Verificá tu conexión e intentá nuevamente.',
      });
    } finally {
      setIsSavingToDrive(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div
        className={`w-full max-w-5xl rounded-2xl border shadow-2xl flex flex-col max-h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Top Modal Header */}
        <div
          className={`px-5 py-3.5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50/50 border-neutral-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <School className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">
                  Informe de Trayectoria y Ficha
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  {courseName}
                </span>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  • Ciclo {currentSchoolYear}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowDriveConfirmModal(true)}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-70"
              title="Guardar el informe de seguimiento actual directamente en Google Drive como un archivo Google Doc (.gdoc) nativo y editable"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Save className="w-3.5 h-3.5 text-white" />
              )}
              <span>{isSavingToDrive ? 'Guardando en Drive...' : 'Guardar en Drive (.gdoc)'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
              title="Descargar copia del informe en HTML independiente para abrir e imprimir en tu navegador"
            >
              <Download className="w-3.5 h-3.5 text-blue-500" />
              <span>Descargar HTML</span>
            </button>

            <a
              href={`?course=${courseId}&view=course_detail&openReport=true&reportTab=${activeTab}${selectedStudentId !== 'all' ? `&studentId=${selectedStudentId}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border-slate-700'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border-neutral-300 shadow-2xs'
              }`}
              title="Abrir este informe en una pestaña o ventana independiente"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">Abrir en otra pestaña</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switch bar & controls */}
        <div
          className={`px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isDarkMode ? 'bg-slate-850/80 border-slate-800' : 'bg-neutral-50 border-neutral-200'
          }`}
        >
          {/* Tabs */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('course')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'course'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Informe del Curso Completo</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('individual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'individual'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Ficha por Alumno (1 Pág.)</span>
            </button>
          </div>

          {/* Student picker when in individual mode */}
          {activeTab === 'individual' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                Estudiante a visualizar:
              </label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              >
                <option value="all">Todos los alumnos (Lote de 1 página c/u)</option>
                {consolidatedStudents.map((s) => {
                  const displayScore =
                    gradesPeriod === '1c'
                      ? s.score1c
                      : gradesPeriod === '2c'
                      ? s.score2c
                      : s.finalVal;
                  return (
                    <option key={s.student.id} value={s.student.id}>
                      {s.student.lastName}, {s.student.firstName} ({displayScore || 'Sin nota'})
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {/* Panel de selección interactiva de elementos */}
        <ReportElementsToolbar
          isDarkMode={isDarkMode}
          activeTab={activeTab}
          attendanceLabel={attendanceLabel}
          dispositionLabel={dispositionLabel}
          term1ShortLabel={term1ShortLabel}
          term2ShortLabel={term2ShortLabel}
          includeGrades={includeGrades}
          onToggleGrades={() => setIncludeGrades(!includeGrades)}
          gradesPeriod={gradesPeriod}
          onChangeGradesPeriod={setGradesPeriod}
          includeExamDetails={includeExamDetails}
          onToggleExamDetails={() => setIncludeExamDetails(!includeExamDetails)}
          includeAttendance={includeAttendance}
          onToggleAttendance={() => setIncludeAttendance(!includeAttendance)}
          includeDisposition={includeDisposition}
          onToggleDisposition={() => setIncludeDisposition(!includeDisposition)}
          includeDispositionReasons={includeDispositionReasons}
          onToggleDispositionReasons={() => setIncludeDispositionReasons(!includeDispositionReasons)}
          includeObservations={includeObservations}
          onToggleObservations={() => setIncludeObservations(!includeObservations)}
          includeFamilySignature={includeFamilySignature}
          onToggleFamilySignature={() => setIncludeFamilySignature(!includeFamilySignature)}
        />

        {/* Live Drive Result Notification Banner */}
        {driveSavedResult && (
          <div
            className={`px-5 py-2.5 border-b text-xs flex items-center justify-between gap-3 animate-in fade-in ${
              driveSavedResult.success
                ? isDarkMode
                  ? 'bg-emerald-950/60 border-emerald-900 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : isDarkMode
                ? 'bg-rose-950/60 border-rose-900 text-rose-300'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {driveSavedResult.success ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Google Doc editable <strong>"{driveSavedResult.name}"</strong> creado en tu Google Drive (carpeta{' '}
                    <strong>"{driveSavedResult.folderName}"</strong>)
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>
                    {driveSavedResult.errorMessage ||
                      'No se pudo guardar el informe en Google Drive. Verificá tu sesión de Google e intentá nuevamente.'}
                  </span>
                </>
              )}
            </div>
            {driveSavedResult.success && driveSavedResult.url && (
              <a
                href={driveSavedResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold underline hover:opacity-80 shrink-0"
              >
                <span>Abrir en Google Docs</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Document Preview & Printable Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-100 dark:bg-slate-950/70">
          <div id="printable-report" className="max-w-4xl mx-auto space-y-8">
            {activeTab === 'course' ? (
              <CourseConsolidatedReportView
                schoolName={schoolName}
                effectiveReason={effectiveReason}
                currentSchoolYear={currentSchoolYear}
                courseName={courseName}
                teacherName={teacherName}
                currentDate={currentDate}
                attendanceLabel={attendanceLabel}
                dispositionLabel={dispositionLabel}
                term1FullLabel={term1FullLabel}
                term2FullLabel={term2FullLabel}
                term1ShortLabel={term1ShortLabel}
                term2ShortLabel={term2ShortLabel}
                gradesPeriod={gradesPeriod}
                selectedElementsCount={selectedElementsCount}
                includeGrades={includeGrades}
                includeAttendance={includeAttendance}
                includeDisposition={includeDisposition}
                includeObservations={includeObservations}
                stats={stats}
                consolidatedStudents={consolidatedStudents}
                courseObservation={courseObservation}
                onUpdateCourseObservation={handleUpdateCourseObservation}
              />
            ) : (
              <StudentIndividualReportList
                schoolName={schoolName}
                effectiveReason={effectiveReason}
                currentSchoolYear={currentSchoolYear}
                courseName={courseName}
                teacherName={teacherName}
                currentDate={currentDate}
                minAttendancePercent={minAttendancePercent}
                attendanceLabel={attendanceLabel}
                dispositionLabel={dispositionLabel}
                term1FullLabel={term1FullLabel}
                term2FullLabel={term2FullLabel}
                term1ShortLabel={term1ShortLabel}
                term2ShortLabel={term2ShortLabel}
                gradesPeriod={gradesPeriod}
                selectedElementsCount={selectedElementsCount}
                includeGrades={includeGrades}
                includeExamDetails={includeExamDetails}
                includeAttendance={includeAttendance}
                includeDisposition={includeDisposition}
                includeDispositionReasons={includeDispositionReasons}
                excludedDispositionReasonIds={excludedDispositionReasonIds}
                includeObservations={includeObservations}
                includeFamilySignature={includeFamilySignature}
                displayedStudents={displayedStudents}
                onToggleDispositionReason={handleToggleDispositionReason}
                onSelectAllStudentDispositionReasons={handleSelectAllStudentDispositionReasons}
                onUpdateStudentReportObservation={handleUpdateStudentReportObservation}
              />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0 ${
            isDarkMode ? 'bg-slate-850 border-slate-800 text-slate-400' : 'bg-neutral-50 border-neutral-200 text-neutral-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-amber-500" />
            <span>
              Carpeta de Drive vinculada:{' '}
              <strong className="text-neutral-800 dark:text-slate-200">
                {formatCourseDriveFolderName(courseName)} / Informes
              </strong>
            </span>
            {(driveFolderId || driveFolderUrl) && (
              <a
                href={getDirectDriveFolderUrl(driveFolderId, driveFolderUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline flex items-center gap-0.5 font-medium ml-1"
              >
                <span>Ver carpeta</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-1.5 rounded-lg border font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
              }`}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => setShowDriveConfirmModal(true)}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {isSavingToDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Guardar en Drive (.gdoc)</span>
            </button>
          </div>
        </div>

        {/* Confirmation Dialog before creating/updating Google Doc in Drive */}
        {showDriveConfirmModal && (
          <SaveToDriveConfirmDialog
            isDarkMode={isDarkMode}
            courseName={courseName}
            targetGoogleDocTitle={getTargetGoogleDocTitle()}
            onCancel={() => setShowDriveConfirmModal(false)}
            onConfirm={executeSaveToDrive}
          />
        )}
      </div>
    </div>
  );
};
