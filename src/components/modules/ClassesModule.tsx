import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import {
  Users,
  CheckCircle2,
  FileSpreadsheet,
  Download,
  AlertCircle,
  RefreshCw,
  History,
  BookOpen,
  Copy,
  ChevronRight,
  ExternalLink,
  Loader2,
  Settings,
  Award,
  FileText,
  Pencil,
} from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { CourseWorkspaceProvider } from '../../context/CourseWorkspaceContext';
import { storageGateway } from '../../services/storageGateway';
import { ClassesModuleModalsHost } from './classes/ClassesModuleModalsHost';

const GradebookMatrix = lazy(() =>
  import('./GradebookMatrix').then((m) => ({ default: m.GradebookMatrix }))
);
const LibroDeTemasMatrix = lazy(() =>
  import('./LibroDeTemasMatrix').then((m) => ({ default: m.LibroDeTemasMatrix }))
);
const CourseHistoryTabView = lazy(() =>
  import('./classes/CourseHistoryTabView').then((m) => ({ default: m.CourseHistoryTabView }))
);
import { Course, Student } from '../../types';
import { api } from '../../services/api';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { AttendanceHeader } from './classes/AttendanceHeader';
import { CourseHeaderCard } from './classes/CourseHeaderCard';
import { useCourseNotifications } from '../../hooks/useCourseNotifications';
import { useStudentObservations } from '../../hooks/useStudentObservations';
import {
  AttendanceSettings,
  getCourseAttendanceSettings,
  saveCourseAttendanceSettings,
  loadCourseAttendanceSettingsFromCloud,
  computeCourseAttendanceSummary,
  getCurrentCalendarTerm,
} from '../../utils/attendanceCalculations';
import { useCourseRosterAndSchedule } from '../../hooks/useCourseRosterAndSchedule';
import { useCourseDispositionSync } from '../../hooks/useCourseDispositionSync';
import { useGoogleSheetsAndDriveSync } from '../../hooks/useGoogleSheetsAndDriveSync';
import { useCourseAttendanceAndDispositionActions } from '../../hooks/useCourseAttendanceAndDispositionActions';
import { CourseRosterTabView } from './classes/CourseRosterTabView';
import { deduplicateHistory } from '../../utils/studentMetricsCalculator';
import { navigationService, CourseSubTabType } from '../../services/navigationService';
import { subscribeAppEvents } from '../../utils/appEventBus';
import { areCourseListsEqual, areStudentListsEqual } from '../../utils/entityEquality';
import { useTerminologySettings } from '../../utils/terminologySettings';

interface ClassesModuleProps {
  courses: Course[];
  students: Student[];
  selectedCourseId?: string;
  initialSubTab?: CourseSubTabType;
  externalSearchQuery?: string;
  onExternalSearchChange?: (query: string) => void;
  onSelectCourse?: (id: string) => void;
  onRefreshData: () => void;
  onNavigate: (tab: string, filterCourseId?: string) => void;
  onOpenNewModal?: (type: 'course' | 'plan' | 'task' | 'file') => void;
}

function areClassesModulePropsEqual(
  prev: ClassesModuleProps,
  next: ClassesModuleProps
): boolean {
  if (
    prev.selectedCourseId !== next.selectedCourseId ||
    prev.initialSubTab !== next.initialSubTab ||
    prev.externalSearchQuery !== next.externalSearchQuery ||
    prev.onExternalSearchChange !== next.onExternalSearchChange ||
    prev.onSelectCourse !== next.onSelectCourse ||
    prev.onRefreshData !== next.onRefreshData ||
    prev.onNavigate !== next.onNavigate ||
    prev.onOpenNewModal !== next.onOpenNewModal
  ) {
    return false;
  }

  if (!areCourseListsEqual(prev.courses, next.courses)) {
    return false;
  }

  if (!areStudentListsEqual(prev.students, next.students)) {
    return false;
  }

  return true;
}

const ClassesModuleComponent: React.FC<ClassesModuleProps> = ({
  courses,
  students,
  selectedCourseId,
  initialSubTab,
  externalSearchQuery,
  onExternalSearchChange,
  onSelectCourse,
  onRefreshData,
  onNavigate,
  onOpenNewModal,
}) => {
  const { isDarkMode, token, user, loginWithGoogle, requestAccessToken, isTokenExpired, renewGoogleSession } = useWorkspaceAuth();
  const { combinedTabLabel } = useTerminologySettings();
  const activeCourse =
    courses.find((c) => c.id === selectedCourseId) ||
    courses.find((c) => selectedCourseId && c.classroomCourseId === selectedCourseId) ||
    (selectedCourseId ? navigationService.getLastActiveCourseSnapshot(selectedCourseId) : null) ||
    courses[0];

  // Active view: 'roster' (Alumnos/as) vs 'libro_temas' (Libro de Temas) vs 'grades' (Calificaciones) vs 'history' (Bitácora / Historial Google Sheets)
  const [activeTabState, setActiveTabState] = useState<CourseSubTabType>(
    initialSubTab || navigationService.getState().subTab || 'roster'
  );

  const setActiveTab = React.useCallback((nextTab: CourseSubTabType) => {
    setActiveTabState(nextTab);
    navigationService.setSubTab(nextTab);
  }, []);

  const activeTab = activeTabState;

  useEffect(() => {
    if (initialSubTab && initialSubTab !== activeTabState) {
      setActiveTabState(initialSubTab);
    }
  }, [initialSubTab, activeTabState]);

  const [localSearchQuery, setLocalSearchQuery] = useState(externalSearchQuery || '');
  useEffect(() => {
    if (externalSearchQuery !== undefined && externalSearchQuery !== localSearchQuery) {
      setLocalSearchQuery(externalSearchQuery);
    }
  }, [externalSearchQuery]);

  const searchQuery = localSearchQuery;
  const setSearchQuery = React.useCallback(
    (val: React.SetStateAction<string>) => {
      setLocalSearchQuery((prev) => {
        const nextVal = typeof val === 'function' ? val(prev) : val;
        onExternalSearchChange?.(nextVal);
        return nextVal;
      });
    },
    [onExternalSearchChange]
  );

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Centralized toast timer so rapid consecutive notifications never truncate each other early
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3800);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Semáforo de asistencia, semanas de clase y calendario escolar
  const [isAttendanceSettingsModalOpen, setIsAttendanceSettingsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isQuickRollCallOpen, setIsQuickRollCallOpen] = useState(false);
  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettings>(() =>
    getCourseAttendanceSettings(activeCourse?.id, activeCourse?.schedule)
  );

  useEffect(() => {
    if (activeCourse) {
      setAttendanceSettings(getCourseAttendanceSettings(activeCourse.id, activeCourse.schedule));
      let mounted = true;
      loadCourseAttendanceSettingsFromCloud(activeCourse.id, activeCourse.schedule)
        .then((cloudSettings) => {
          if (mounted && cloudSettings) {
            setAttendanceSettings(cloudSettings);
          }
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }
  }, [activeCourse?.id, activeCourse?.schedule]);

  // Listen to open attendance settings triggered from Sidebar via appEventBus
  useEffect(() => {
    const unsubOpen = subscribeAppEvents(
      ['docencia_open_attendance_settings'],
      () => setIsAttendanceSettingsModalOpen(true),
      0
    );
    const unsubGlobalUpdate = subscribeAppEvents(
      ['docencia_global_attendance_settings_updated'],
      () => {
        if (activeCourse) {
          setAttendanceSettings(getCourseAttendanceSettings(activeCourse.id, activeCourse.schedule));
        }
      },
      40
    );
    return () => {
      unsubOpen();
      unsubGlobalUpdate();
    };
  }, [activeCourse?.id, activeCourse?.schedule]);

  // Academic term for Attendance & Disposition & Grades: '1c' | '2c' | 'annual'
  // Defaults automatically to the current cuatrimestre according to the school calendar (1°C or 2°C),
  // while allowing the teacher to freely move/switch between 1°C, 2°C and Resumen Anual.
  const [hasManuallySelectedTerm, setHasManuallySelectedTerm] = useState(false);
  const [attendanceTerm, setAttendanceTerm] = useState<'1c' | '2c' | 'annual'>(() =>
    getCurrentCalendarTerm(attendanceSettings)
  );

  // Keep default term aligned with calendar settings unless the teacher manually moved it
  useEffect(() => {
    if (!hasManuallySelectedTerm) {
      setAttendanceTerm(getCurrentCalendarTerm(attendanceSettings));
    }
  }, [
    attendanceSettings.termStartDate1c,
    attendanceSettings.termEndDate1c,
    attendanceSettings.termStartDate2c,
    attendanceSettings.termEndDate2c,
    hasManuallySelectedTerm,
  ]);

  const activeConcreteTerm: '1c' | '2c' =
    attendanceTerm === '1c' || attendanceTerm === '2c'
      ? attendanceTerm
      : getCurrentCalendarTerm(attendanceSettings);

  const setAttendanceTermHandler = (term: '1c' | '2c' | 'annual') => {
    setHasManuallySelectedTerm(true);
    setAttendanceTerm(term);
    storageGateway.setCourseActiveTerm(term, activeCourse?.id);
  };

  const teacherEmail = user?.email || 'profesor';

  const {
    dispositionMap,
    setDispositionMap,
    dispositionMap2c,
    setDispositionMap2c,
    historyList,
    setHistoryList,
    saveTermDisposition,
    getStudentMetrics,
    courseHistory,
  } = useCourseDispositionSync({
    activeCourse,
    courses,
    students,
    attendanceTerm,
    teacherEmail,
  });

  const {
    removedStudentIds,
    setRemovedStudentIds,
    removedStudentsList,
    setRemovedStudentsList,
    isRemovedStudentsModalOpen,
    setIsRemovedStudentsModalOpen,
    courseStudents,
    isSyncingClassroomRoster,
    setIsSyncingClassroomRoster,
    needsRosterPermission,
    setNeedsRosterPermission,
    studentToRemove,
    setStudentToRemove,
    isSelectiveSyncModalOpen,
    setIsSelectiveSyncModalOpen,
    isCalendarModalOpen,
    setIsCalendarModalOpen,
    calendarModalCourse,
    setCalendarModalCourse,
    calendarScheduleSelection,
    setCalendarScheduleSelection,
    syncToGoogleFromModal,
    setSyncToGoogleFromModal,
    isSavingCalendarSelection,
    selectedCalendarForSlots,
    setSelectedCalendarForSlots,
    availableCalendarsForSlots,
    calendarSlots,
    isLoadingSlots,
    isEditCourseModalOpen,
    setIsEditCourseModalOpen,
    editCourseData,
    setEditCourseData,
    isSavingCourseDetails,
    isAddStudentModalOpen,
    setIsAddStudentModalOpen,
    addStudentFirstName,
    setAddStudentFirstName,
    addStudentLastName,
    setAddStudentLastName,
    addStudentEmail,
    setAddStudentEmail,
    addStudentPhone,
    setAddStudentPhone,
    addStudentNotes,
    setAddStudentNotes,
    isSavingManualStudent,
    addStudentTab,
    setAddStudentTab,
    batchStudentsText,
    setBatchStudentsText,
    directMessageModal,
    setDirectMessageModal,
    handleSyncRoster,
    handleOpenCalendarSyncModal,
    handleSaveCalendarSelection,
    handleOpenEditCourseDetailsModal,
    handleSaveCourseDetails,
    handleOpenAddStudentModal,
    handleSaveSingleStudent,
    handleSaveBatchStudents,
    handleOpenDirectMessageModal,
    handleSendDirectMessage,
  } = useCourseRosterAndSchedule({
    courses,
    students,
    activeCourse,
    token,
    attendanceSettings,
    setAttendanceSettings,
    activeConcreteTerm,
    dispositionMap,
    dispositionMap2c,
    historyList,
    setHistoryList,
    deduplicateHistory,
    saveTermDisposition,
    onRefreshData,
    setToastMessage,
  });

  const {
    sheetConfig,
    isSyncingSheet,
    isOpeningSheet,
    showSheetsConnectModal,
    setShowSheetsConnectModal,
    sheetsModalFeedback,
    setSheetsModalFeedback,
    customSheetInput,
    setCustomSheetInput,
    isLinkingCustomSheet,
    customFolderInput,
    setCustomFolderInput,
    isLinkingCustomFolder,
    isPullingFromSheet,
    dobleEntradaDiffs,
    isDobleEntradaModalOpen,
    setIsDobleEntradaModalOpen,
    isHeaderExportExcelModalOpen,
    setIsHeaderExportExcelModalOpen,
    isHeaderImportModalOpen,
    setIsHeaderImportModalOpen,
    headerImportSourceType,
    setHeaderImportSourceType,
    headerImportContext,
    setHeaderImportContext,
    isSettingUpDriveFolder,
    driveFolderModalOpen,
    setDriveFolderModalOpen,
    courseDriveStructure,
    setCourseDriveStructure,
    triggerSheetsSync,
    handleManualSheetsSync,
    handleLinkCustomSpreadsheet,
    handleSaveCustomDriveFolder,
    handleOpenGoogleSheet,
    handleConnectGoogleForSheets,
    handlePullFromGoogleSheet,
    handleExportAllCourseExcel,
    getCategoriesForImport,
    getGradesMapForImport,
    handleApplyImportFromClassesModule,
    handleApplyMultiImportFromClassesModule,
    handleOpenInSheetsNew,
    handleDownloadCourseCsv,
    handleOpenCourseDriveFolder,
  } = useGoogleSheetsAndDriveSync({
    activeCourse,
    students,
    courseStudents,
    dispositionMap,
    setDispositionMap,
    dispositionMap2c,
    setDispositionMap2c,
    historyList,
    setHistoryList,
    courseHistory,
    activeConcreteTerm,
    token,
    requestAccessToken,
    getStudentMetrics,
    deduplicateHistory,
    onRefreshData,
    setActiveTab,
    setToastMessage,
  });

  const showToastWithTimeout = (msg: string, durationMs = 3500) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), durationMs);
  };

  const {
    savedPresets,
    conductReasonTemplates,
    notifSettings,
    setNotifSettings,
    teacherConductOptions,
    notifConfigActiveTab,
    setNotifConfigActiveTab,
    searchReasonQuery,
    setSearchReasonQuery,
    isNewReasonFormOpen,
    setIsNewReasonFormOpen,
    newReasonName,
    setNewReasonName,
    newReasonTemplateText,
    setNewReasonTemplateText,
    reasonCardDrafts,
    setReasonCardDrafts,
    isNotifConfigModalOpen,
    setIsNotifConfigModalOpen,
    newConfigPreset,
    setNewConfigPreset,
    absenceNotifModal,
    setAbsenceNotifModal,
    batchAbsenceModal,
    setBatchAbsenceModal,
    editingConductOpt,
    setEditingConductOpt,
    editConductInput,
    setEditConductInput,
    editingTemplateForReason,
    setEditingTemplateForReason,
    reasonTemplateDraft,
    setReasonTemplateDraft,
    saveReasonAsDefaultOnSend,
    setSaveReasonAsDefaultOnSend,
    isManageConductModalOpen,
    setIsManageConductModalOpen,
    newConductInput,
    setNewConductInput,
    newConductType,
    setNewConductType,
    allKnownReasonKeys,
    handleSavePreset,
    handleDeletePreset,
    formatTemplateForStudent,
    extractGenericTemplate,
    getTemplateForReason,
    handleAddConductOption,
    handleDeleteConductOption,
    handleEditConductOption,
    handleSaveTemplateForReason,
    handleResetTemplateForReason,
    isReasonCustomized,
    handleSaveNotifSettings,
  } = useCourseNotifications({
    teacherEmail,
    activeCourse,
    onShowToast: showToastWithTimeout,
  });

  const {
    isEditingStudentEmail,
    setIsEditingStudentEmail,
    editedStudentEmail,
    setEditedStudentEmail,
    selectedStudentForProfile,
    setSelectedStudentForProfile,
    newObservationText,
    setNewObservationText,
    newObservationUrl,
    setNewObservationUrl,
    studentObservations,
    setStudentObservations,
    showProfileDocConfirm,
    setShowProfileDocConfirm,
    profileDocTitle,
    setProfileDocTitle,
    profileDocLinkToObs,
    setProfileDocLinkToObs,
    isExportingProfileDoc,
    setIsExportingProfileDoc,
    exportedProfileDoc,
    setExportedProfileDoc,
    profileDocError,
    setProfileDocError,
  } = useStudentObservations({
    userEmail: user?.email,
    userId: user?.id,
    activeCourseId: activeCourse?.id,
    enabled: activeTab === 'roster' || activeTab === 'history' || isBackupModalOpen,
  });

  const [historySubTab, setHistorySubTab] = useState<'incidents' | 'summary'>('incidents');

  // Permanent history controls (always visible in roster tab & history tab)
  const [permHistorySearch, setPermHistorySearch] = useState('');
  const [permHistoryCategory, setPermHistoryCategory] = useState<'all' | 'Ausencia' | 'Llegada tarde' | 'Disposición' | 'Calificación' | 'Sistema'>('all');
  const [permHistoryDate, setPermHistoryDate] = useState<string>('all');
  const [isPermHistoryCollapsed, setIsPermHistoryCollapsed] = useState(false);

  // Course and Student report modal state
  const [courseReportModalOpen, setCourseReportModalOpen] = useState<boolean>(false);
  const [courseReportModalTab, setCourseReportModalTab] = useState<'course' | 'individual'>('course');
  const [courseReportModalStudentId, setCourseReportModalStudentId] = useState<string>('all');

  // Auto-open modal if specified in URL query params (?openReport=true or ?studentId=...) or sessionStorage ('docencia_focus_student_id')
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlStudentId = params.get('studentId');
      const urlOpenReport = params.get('openReport') === 'true' || params.get('report') === 'true';
      const urlReportTab = params.get('reportTab');

      if (urlOpenReport) {
        if (urlReportTab === 'course' || urlReportTab === 'individual') {
          setCourseReportModalTab(urlReportTab);
        }
        if (urlStudentId) {
          setCourseReportModalStudentId(urlStudentId);
        }
        setCourseReportModalOpen(true);
        return;
      }

      const focusStudentId = sessionStorage.getItem('docencia_focus_student_id') || urlStudentId;
      if (focusStudentId && courseStudents.length > 0) {
        const target = courseStudents.find((s) => s.id === focusStudentId);
        if (target) {
          sessionStorage.removeItem('docencia_focus_student_id');
          sessionStorage.removeItem('docencia_focus_student_name');
          setSelectedStudentForProfile(target);
        }
      }
    } catch (_) {}
  }, [courseStudents, setSelectedStudentForProfile]);

  const filteredStudents = courseStudents.filter((s) =>
    `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Course attendance summary and traffic light calculations
  const currentAttendanceSummary = useMemo(() => {
    if (!activeCourse) return undefined;
    const studentMetricsList = courseStudents.map((s) => {
      const m = getStudentMetrics(s.id, attendanceTerm);
      return {
        studentId: s.id,
        totalAbsences: m.totalAbsences,
        totalLates: m.totalLates || 0,
      };
    });
    return computeCourseAttendanceSummary(
      studentMetricsList,
      attendanceTerm,
      attendanceSettings
    );
  }, [activeCourse, courseStudents, dispositionMap, dispositionMap2c, historyList, attendanceTerm, attendanceSettings]);

  const handleSaveAttendanceSettings = (newSettings: AttendanceSettings, updatedSchedule?: string) => {
    if (!activeCourse) return;
    saveCourseAttendanceSettings(activeCourse.id, newSettings);
    setAttendanceSettings(newSettings);
    if (updatedSchedule && updatedSchedule !== activeCourse.schedule) {
      api
        .updateCourse(activeCourse.id, { schedule: updatedSchedule })
        .then(() => {
          onRefreshData?.();
        })
        .catch(() => {});
    }
    setToastMessage('¡Parámetros del semáforo y semanas guardados exitosamente!');
  };

  const {
    selectedStudentIds,
    setSelectedStudentIds,
    selectedPendingHistoryIds,
    setSelectedPendingHistoryIds,
    pendingAbsenceItems,
    pendingConductItems,
    pendingAllItems,
    conductRecordModal,
    setConductRecordModal,
    selectedStudentForHistory,
    setSelectedStudentForHistory,
    editingDispositionStudent,
    setEditingDispositionStudent,
    editingDispositionScore,
    setEditingDispositionScore,
    editingDispositionTerm,
    setEditingDispositionTerm,
    editingDispositionReason,
    setEditingDispositionReason,
    editingAbsenceStudent,
    setEditingAbsenceStudent,
    editingAbsenceCount,
    setEditingAbsenceCount,
    editingAbsenceTerm,
    setEditingAbsenceTerm,
    editingAbsenceDate,
    setEditingAbsenceDate,
    editingAbsenceReason,
    setEditingAbsenceReason,
    editingAbsenceSendNotif,
    setEditingAbsenceSendNotif,
    editingAbsenceChannel,
    setEditingAbsenceChannel,
    editingAbsenceMessageText,
    setEditingAbsenceMessageText,
    isSavingAbsenceEdit,
    isSendDispositionModalOpen,
    setIsSendDispositionModalOpen,
    pulsingStudentId,
    handleAddAbsence,
    sendNotificationForItem,
    getBatchMessageForItem,
    handleOpenBatchFromPending,
    handleOpenBatchFromSelectedStudents,
    handleOpenBatchFromSelectedHistory,
    handleSendBatchNotifications,
    toggleSelectStudent,
    toggleSelectAllStudents,
    toggleSelectPendingHistory,
    toggleSelectAllPendingHistory,
    handleMarkOmitNotification,
    handleBatchMarkOmitNotification,
    handleMarkAllPendingAsOmitted,
    handleRecordDispositionAction,
    handleConfirmConductRecord,
    handleDeleteHistoryEntry,
    handleDeleteLatestAbsence,
    handleDeleteLatestLate,
    handleRecordLateArrival,
    handleOpenNotifyModal,
    handleCopyForGoogleSheets,
    handleExportHistoryCsv,
    handleExportHistoryExcel,
    handleOpenEditDisposition,
    handleChangeEditingTerm,
    handleNavigateEditStudent,
    handleSaveStudentDisposition,
    handleOpenEditAbsences,
    handleChangeEditingAbsenceTerm,
    handleNavigateEditAbsenceStudent,
    handleSaveStudentAbsences,
    handleSaveEditedStudentEmail,
    handleOpenStudentProfile,
    handleNavigateProfileStudent,
    handleSaveObservation,
    handleDeleteObservation,
    buildStudentTrackingDocHtml,
    handleOpenExportProfileDocConfirm,
    handleConfirmExportProfileToGoogleDoc,
    handlePrintStudentProfile,
    handleResetSingleStudentDisposition,
    handleResetCourseDisposition,
    handleSendDispositionToGrades,
  } = useCourseAttendanceAndDispositionActions({
    activeCourse,
    students,
    courseStudents,
    filteredStudents,
    dispositionMap,
    setDispositionMap,
    dispositionMap2c,
    setDispositionMap2c,
    historyList,
    setHistoryList,
    courseHistory,
    attendanceTerm,
    activeConcreteTerm,
    notifSettings,
    savedPresets,
    batchAbsenceModal,
    setBatchAbsenceModal,
    setAbsenceNotifModal,
    formatTemplateForStudent,
    getTemplateForReason,
    handleAddConductOption,
    getStudentMetrics,
    saveTermDisposition,
    deduplicateHistory,
    triggerSheetsSync,
    sheetConfig,
    courseDriveStructure,
    setCourseDriveStructure,
    token,
    onRefreshData,
    setActiveTab,
    setToastMessage,
    setCourseReportModalStudentId,
    setCourseReportModalTab,
    setCourseReportModalOpen,
    studentObservationsProps: {
      selectedStudentForProfile,
      setSelectedStudentForProfile,
      editedStudentEmail,
      setIsEditingStudentEmail,
      newObservationText,
      setNewObservationText,
      newObservationUrl,
      setNewObservationUrl,
      studentObservations,
      setStudentObservations,
      profileDocTitle,
      setProfileDocTitle,
      profileDocLinkToObs,
      setShowProfileDocConfirm,
      setIsExportingProfileDoc,
      setExportedProfileDoc,
      setProfileDocError,
    },
  });


  const distinctCourseDates = useMemo(() => {
    const dates = new Set<string>();
    courseHistory.forEach((h) => {
      if (h.date) dates.add(h.date);
    });
    return Array.from(dates);
  }, [courseHistory]);

  const filteredPendingMessages = useMemo(() => {
    return pendingAllItems.filter((item) => {
      if (permHistoryCategory !== 'all') {
        if (permHistoryCategory === 'Ausencia' && item.category !== 'Ausencia') return false;
        if (permHistoryCategory === 'Disposición' && item.category !== 'Disposición') return false;
      }
      if (permHistorySearch.trim()) {
        const query = permHistorySearch.toLowerCase().trim();
        const matchesName = (item.studentName || '').toLowerCase().includes(query);
        const matchesAction = (item.action || '').toLowerCase().includes(query);
        const matchesDate = (item.date || '').toLowerCase().includes(query);
        if (!matchesName && !matchesAction && !matchesDate) return false;
      }
      return true;
    });
  }, [pendingAllItems, permHistoryCategory, permHistorySearch]);

  const averageDisposition = useMemo(() => {
    if (courseStudents.length === 0) return 10;
    const sum = courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + metrics.totalDisposition;
    }, 0);
    return (sum / courseStudents.length).toFixed(1);
  }, [courseStudents, dispositionMap]);

  const totalCourseAbsences = useMemo(() => {
    return courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + metrics.totalAbsences;
    }, 0);
  }, [courseStudents, dispositionMap]);

  const totalCourseLates = useMemo(() => {
    return courseStudents.reduce((acc, st) => {
      const metrics = getStudentMetrics(st.id);
      return acc + (metrics.totalLates || 0);
    }, 0);
  }, [courseStudents, dispositionMap]);

  return (
    <CourseWorkspaceProvider
      activeCourse={activeCourse}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      attendanceTerm={attendanceTerm}
      activeConcreteTerm={activeConcreteTerm}
      setAttendanceTerm={setAttendanceTermHandler}
      attendanceSettings={attendanceSettings}
      setAttendanceSettings={setAttendanceSettings}
      currentAttendanceSummary={currentAttendanceSummary}
      courseStudents={courseStudents}
      filteredStudents={filteredStudents}
      courseHistory={courseHistory}
      getStudentMetrics={getStudentMetrics}
    >
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER                                                    */}
      {/* ------------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-neutral-800'}`}>
            <Users className="w-6 h-6 text-blue-500" />
            Estudiantes
          </h2>
        </div>
      </div>

      {activeCourse && (
        <>
          {/* ------------------------------------------------------------- */}
          {/* ACTIVE COURSE HEADER CARD & WORKSPACE LINKS                   */}
          {/* ------------------------------------------------------------- */}
          <CourseHeaderCard
            activeCourse={activeCourse}
            isDarkMode={isDarkMode}
            userEmail={user?.email}
            isSettingUpDriveFolder={isSettingUpDriveFolder}
            onOpenCalendarSyncModal={handleOpenCalendarSyncModal}
            onOpenEditCourseDetailsModal={handleOpenEditCourseDetailsModal}
            onOpenCourseDriveFolder={handleOpenCourseDriveFolder}
            onOpenCourseReport={() => {
              setCourseReportModalStudentId('all');
              setCourseReportModalTab('course');
              setCourseReportModalOpen(true);
            }}
            onSyncRoster={handleSyncRoster}
            isSyncingRoster={isSyncingClassroomRoster}
          />

          {/* Roster Permission Notice if Google 403 */}
          {needsRosterPermission && (
            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in ${
                isDarkMode
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <p className="font-bold">Permiso de nómina de Google Classroom requerido</p>
                  <p className="text-[11px] opacity-90">
                    Google requiere autorización del permiso de lectura de estudiantes (classroom.rosters.readonly) para importar los estudiantes reales de tus clases.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setIsSyncingClassroomRoster(true);
                    await loginWithGoogle(user?.email);
                    setNeedsRosterPermission(false);
                    await handleSyncRoster();
                  } catch (e) {
                    console.warn('Re-auth error:', e);
                  } finally {
                    setIsSyncingClassroomRoster(false);
                  }
                }}
                disabled={isSyncingClassroomRoster}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition-all shrink-0 cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingClassroomRoster ? 'animate-spin' : ''}`} />
                <span>Autorizar y Cargar Estudiantes Reales</span>
              </button>
            </div>
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center justify-between gap-3 border animate-in fade-in ${
                isDarkMode
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{toastMessage}</span>
              </div>
              {toastMessage.includes('Calificaciones') && activeTab !== 'grades' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('grades')}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer transition-all shrink-0 flex items-center gap-1"
                >
                  <span>Ver en Calificaciones</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* VIEW SWITCHER TABS & ACTION BUTTONS                           */}
          {/* ------------------------------------------------------------- */}
          {/* ------------------------------------------------------------- */}
          {/* RENGLÓN SUPERIOR DE PESTAÑAS (A LO LARGO)                     */}
          {/* ------------------------------------------------------------- */}
          <div
            className={`p-1.5 rounded-xl border grid grid-cols-1 sm:grid-cols-4 gap-2 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-100 border-neutral-200'
            }`}
          >
            <div
              onClick={() => setActiveTab('roster')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveTab('roster');
              }}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'roster'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">{combinedTabLabel}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsManageConductModalOpen(true);
                }}
                className={`p-1 rounded-md transition-colors cursor-pointer ${
                  activeTab === 'roster'
                    ? 'text-white/80 hover:text-white hover:bg-white/20'
                    : 'text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400'
                }`}
                title="Cambiar el nombre de Asistencia o Disposición (ej: Concepto, Participación en clase)"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('libro_temas')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'libro_temas'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>Libro de Temas</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('grades')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'grades'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <Award className="w-4 h-4 shrink-0" />
              <span>Calificaciones</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-2.5 px-4 rounded-lg font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
              }`}
            >
              <History className="w-4 h-4 shrink-0" />
              <span>Historial</span>
              {courseHistory.length > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'history'
                      ? 'bg-white/20 text-white'
                      : 'bg-blue-500/20 text-blue-600 dark:text-blue-300'
                  }`}
                >
                  {courseHistory.length}
                </span>
              )}
            </button>
          </div>

          {/* ------------------------------------------------------------- */}
          {/* BARRA DE HERRAMIENTAS Y CONTROL DE PERÍODO (AttendanceHeader) */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <AttendanceHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedStudentCount={selectedStudentIds.length}
              onOpenBatchSelected={handleOpenBatchFromSelectedStudents}
              pendingCount={selectedStudentIds.length === 0 ? pendingAllItems.length : 0}
              onOpenBatchPending={() => handleOpenBatchFromPending('all')}
              onOpenAddStudentModal={handleOpenAddStudentModal}
              onOpenSendDispositionModal={() => setIsSendDispositionModalOpen(true)}
              onOpenNotifConfigModal={() => setIsNotifConfigModalOpen(true)}
              isSyncingSheet={isSyncingSheet}
              isPullingFromSheet={isPullingFromSheet}
              lastSyncedAt={sheetConfig?.lastSyncedAt}
              onManualSheetsSync={handleManualSheetsSync}
              isOpeningSheet={isOpeningSheet}
              onOpenGoogleSheet={handleOpenGoogleSheet}
              onOpenImportExcel={() => {
                setHeaderImportContext('attendance');
                setHeaderImportSourceType('file');
                setIsHeaderImportModalOpen(true);
              }}
              onOpenImportSheets={() => {
                setHeaderImportContext('attendance');
                setHeaderImportSourceType('sheets');
                setIsHeaderImportModalOpen(true);
              }}
              attendanceTerm={attendanceTerm}
              onSelectTerm={setAttendanceTermHandler}
              attendanceSummary={currentAttendanceSummary}
              onOpenAttendanceSettings={() => setIsAttendanceSettingsModalOpen(true)}
              onOpenBackupModal={() => setIsBackupModalOpen(true)}
              onOpenQuickRollCall={() => setIsQuickRollCallOpen(true)}
              isDarkMode={isDarkMode}
            />
          )}

          {activeTab === 'history' && (
            <div
              className={`p-3.5 rounded-xl border transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-800 dark:text-slate-100">
                  Historial
                </h3>
                <span className="text-xs text-neutral-500 dark:text-slate-400 font-medium">
                  {courseHistory.length} registros en la bitácora
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* COLUMNA 1: Informes y Reportes, Abrir en Google Sheets */}
                <div className="flex flex-col gap-2 justify-center">
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setCourseReportModalTab('course');
                        setCourseReportModalOpen(true);
                      }}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        isDarkMode
                          ? 'bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border-blue-700/60'
                          : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                      }`}
                      title="Generar informe oficial del curso o boletines individuales de 1 página para imprimir o guardar en Google Drive"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-500" />
                      <span>Informes y Reportes</span>
                    </button>
                    <a
                      href={`?course=${activeCourse.id}&view=course_detail&openReport=true${user?.email ? `&authEmail=${encodeURIComponent(user.email)}` : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                        isDarkMode
                          ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border-slate-700'
                          : 'bg-white hover:bg-blue-50 text-blue-700 border-neutral-200'
                      }`}
                      title="Abrir Informes y Reportes en otra pestaña o ventana"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenGoogleSheet}
                    disabled={isOpeningSheet}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Abrir o crear hoja oficial en Google Sheets"
                  >
                    {isOpeningSheet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span>Abrir en Google Sheets</span>
                  </button>
                </div>

                {/* COLUMNA 2: Vincular Sheet y Copiar datos */}
                <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 sm:border-x border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0 sm:px-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSheetsModalFeedback(null);
                      setShowSheetsConnectModal(true);
                    }}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Configurar y vincular hoja existente de Google Sheets"
                  >
                    <Settings className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Vincular Sheet</span>
                  </button>

                  <button
                    onClick={handleCopyForGoogleSheets}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Copia los datos tabulados para pegar con Ctrl+V directamente en Google Sheets"
                  >
                    <Copy className="w-3.5 h-3.5 text-blue-500" />
                    <span>Copiar datos</span>
                  </button>
                </div>

                {/* COLUMNA 3: Exportar Excel y Descargar CSV */}
                <div className="flex flex-col gap-2 justify-center border-t sm:border-t-0 border-neutral-200 dark:border-slate-800 pt-2 sm:pt-0">
                  <button
                    type="button"
                    onClick={handleExportHistoryExcel}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Descargar historial en formato Excel (.xlsx) nativo"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Exportar Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportHistoryCsv}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                        : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                    }`}
                    title="Descargar historial en formato CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-purple-500" />
                    <span>Descargar CSV</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 1: STUDENT ROSTER (1C / 2C / ANNUAL VIEW)                 */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'roster' && (
            <CourseRosterTabView
              activeCourse={activeCourse}
              courseStudents={courseStudents}
              filteredStudents={filteredStudents}
              attendanceTerm={attendanceTerm}
              activeConcreteTerm={activeConcreteTerm}
              attendanceSettings={attendanceSettings}
              currentAttendanceSummary={currentAttendanceSummary}
              userEmail={user?.email}
              isDarkMode={isDarkMode}
              isSyncingSheet={isSyncingSheet}
              isSyncingClassroomRoster={isSyncingClassroomRoster}
              selectedStudentIds={selectedStudentIds}
              setSelectedStudentIds={setSelectedStudentIds}
              toggleSelectStudent={toggleSelectStudent}
              toggleSelectAllStudents={toggleSelectAllStudents}
              removedStudentsList={removedStudentsList}
              setIsRemovedStudentsModalOpen={setIsRemovedStudentsModalOpen}
              setIsSendDispositionModalOpen={setIsSendDispositionModalOpen}
              setIsManageConductModalOpen={setIsManageConductModalOpen}
              setIsAttendanceSettingsModalOpen={setIsAttendanceSettingsModalOpen}
              teacherConductOptions={teacherConductOptions}
              pulsingStudentId={pulsingStudentId}
              studentObservations={studentObservations}
              historyList={historyList}
              courseHistory={courseHistory}
              pendingAllItems={pendingAllItems}
              pendingAbsenceItems={pendingAbsenceItems}
              pendingConductItems={pendingConductItems}
              filteredPendingMessages={filteredPendingMessages}
              isPermHistoryCollapsed={isPermHistoryCollapsed}
              setIsPermHistoryCollapsed={setIsPermHistoryCollapsed}
              permHistoryCategory={permHistoryCategory as any}
              setPermHistoryCategory={setPermHistoryCategory as any}
              permHistorySearch={permHistorySearch}
              setPermHistorySearch={setPermHistorySearch}
              selectedPendingHistoryIds={selectedPendingHistoryIds}
              setSelectedPendingHistoryIds={setSelectedPendingHistoryIds}
              getStudentMetrics={getStudentMetrics}
              handleManualSheetsSync={handleManualSheetsSync}
              handleOpenStudentProfile={handleOpenStudentProfile}
              handleOpenEditAbsences={handleOpenEditAbsences}
              handleOpenEditDisposition={handleOpenEditDisposition}
              handleOpenAddStudentModal={handleOpenAddStudentModal}
              handleSyncRoster={handleSyncRoster}
              handleAddAbsence={handleAddAbsence}
              handleRecordLateArrival={handleRecordLateArrival}
              handleDeleteLatestAbsence={handleDeleteLatestAbsence}
              handleDeleteLatestLate={handleDeleteLatestLate}
              handleRecordDispositionAction={handleRecordDispositionAction}
              onOpenConductModal={(s, mode) =>
                setConductRecordModal({
                  isOpen: true,
                  student: s,
                  mode,
                  points: 1,
                  customReason: '',
                  saveToOptions: false,
                })
              }
              setSelectedStudentForHistory={setSelectedStudentForHistory}
              setStudentToRemove={setStudentToRemove}
              handleOpenBatchFromSelectedStudents={handleOpenBatchFromSelectedStudents}
              handleBatchMarkOmitNotification={handleBatchMarkOmitNotification}
              handleOpenBatchFromSelectedHistory={handleOpenBatchFromSelectedHistory}
              toggleSelectAllPendingHistory={toggleSelectAllPendingHistory}
              toggleSelectPendingHistory={toggleSelectPendingHistory}
              handleOpenNotifyModal={handleOpenNotifyModal}
              handleMarkOmitNotification={handleMarkOmitNotification}
              handleDeleteHistoryEntry={handleDeleteHistoryEntry}
              handleMarkAllPendingAsOmitted={handleMarkAllPendingAsOmitted}
              handleOpenBatchFromPending={handleOpenBatchFromPending}
              setActiveTab={setActiveTab}
              setToastMessage={setToastMessage}
            />
          )}

{/* TAB 1.5: LIBRO DE TEMAS (COORDINADO CON EL CALENDARIO)        */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'libro_temas' && (
            <ErrorBoundary
              key={`eb-libro-${activeCourse.id}`}
              fallbackTitle="Se produjo un inconveniente al cargar el Libro de Temas"
            >
              <Suspense fallback={null}>
                <LibroDeTemasMatrix
                  courseId={activeCourse.id}
                  courseName={activeCourse.name}
                  courseSubject={activeCourse.subject}
                  courseSchedule={activeCourse.schedule}
                  teacherName={user?.name}
                  attendanceSettings={attendanceSettings}
                  onUpdateAttendanceSettings={(next) => setAttendanceSettings(next)}
                  onRefreshCourse={onRefreshData}
                  onOpenAttendanceSettingsModal={() => setIsAttendanceSettingsModalOpen(true)}
                  onOpenBackupModal={() => setIsBackupModalOpen(true)}
                  isDarkMode={isDarkMode}
                  driveFolderId={activeCourse.driveFolderId}
                  driveFolderUrl={activeCourse.driveFolderUrl}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 2: CALIFICACIONES (CATEGORÍAS Y SUBCATEGORÍAS CUSTOM)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'grades' && (
            <ErrorBoundary
              key={`eb-grades-${activeCourse.id}`}
              fallbackTitle="Se produjo un inconveniente al cargar la Planilla de Calificaciones"
            >
              <Suspense fallback={null}>
                <GradebookMatrix
                  courseId={activeCourse.id}
                  courseName={activeCourse.name}
                  students={courseStudents}
                  isDarkMode={isDarkMode}
                  activeTerm={attendanceTerm}
                  onTermChange={setAttendanceTermHandler}
                  driveFolderId={activeCourse.driveFolderId}
                  driveFolderUrl={activeCourse.driveFolderUrl}
                  onDeleteStudent={setStudentToRemove}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 3: AUDITORÍA E HISTORIAL GENERAL (HOJA GOOGLE SHEETS)     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'history' && (
            <Suspense fallback={null}>
              <CourseHistoryTabView
                activeCourse={activeCourse}
                courseStudents={courseStudents}
                courseHistory={courseHistory}
                pendingAllItems={pendingAllItems}
                selectedPendingHistoryIds={selectedPendingHistoryIds}
                setSelectedPendingHistoryIds={setSelectedPendingHistoryIds}
                historySubTab={historySubTab}
                setHistorySubTab={setHistorySubTab}
                isSyncingSheet={isSyncingSheet}
                sheetConfig={sheetConfig}
                isOpeningSheet={isOpeningSheet}
                isTokenExpired={isTokenExpired}
                handleOpenGoogleSheet={handleOpenGoogleSheet}
                handleManualSheetsSync={handleManualSheetsSync}
                setSheetsModalFeedback={setSheetsModalFeedback}
                setShowSheetsConnectModal={setShowSheetsConnectModal}
                renewGoogleSession={renewGoogleSession}
                isDarkMode={isDarkMode}
                handleBatchMarkOmitNotification={handleBatchMarkOmitNotification}
                handleOpenBatchFromSelectedHistory={handleOpenBatchFromSelectedHistory}
                toggleSelectAllPendingHistory={toggleSelectAllPendingHistory}
                toggleSelectPendingHistory={toggleSelectPendingHistory}
                handleOpenNotifyModal={handleOpenNotifyModal}
                handleMarkOmitNotification={handleMarkOmitNotification}
                handleDeleteHistoryEntry={handleDeleteHistoryEntry}
                handleMarkAllPendingAsOmitted={handleMarkAllPendingAsOmitted}
                handleOpenBatchFromPending={handleOpenBatchFromPending}
                setToastMessage={setToastMessage}
                getStudentMetrics={getStudentMetrics}
              />
            </Suspense>
          )}
        </>
      )}

      <ClassesModuleModalsHost
        activeCourse={activeCourse}
        courses={courses}
        students={students}
        courseStudents={courseStudents}
        filteredStudents={filteredStudents}
        user={user}
        token={token}
        loginWithGoogle={loginWithGoogle}
        isDarkMode={isDarkMode}
        attendanceTerm={attendanceTerm}
        activeConcreteTerm={activeConcreteTerm}
        attendanceSettings={attendanceSettings}
        handleSaveAttendanceSettings={handleSaveAttendanceSettings}
        isAttendanceSettingsModalOpen={isAttendanceSettingsModalOpen}
        setIsAttendanceSettingsModalOpen={setIsAttendanceSettingsModalOpen}
        isBackupModalOpen={isBackupModalOpen}
        setIsBackupModalOpen={setIsBackupModalOpen}
        isQuickRollCallOpen={isQuickRollCallOpen}
        setIsQuickRollCallOpen={setIsQuickRollCallOpen}
        courseReportModalOpen={courseReportModalOpen}
        setCourseReportModalOpen={setCourseReportModalOpen}
        courseReportModalTab={courseReportModalTab}
        setCourseReportModalTab={setCourseReportModalTab}
        courseReportModalStudentId={courseReportModalStudentId}
        setCourseReportModalStudentId={setCourseReportModalStudentId}
        onRefreshData={onRefreshData}
        setToastMessage={setToastMessage}
        dispositionSync={{
          dispositionMap,
          historyList,
          courseHistory,
          getStudentMetrics,
        }}
        rosterAndSchedule={{
          removedStudentsList,
          setRemovedStudentIds,
          setRemovedStudentsList,
          isRemovedStudentsModalOpen,
          setIsRemovedStudentsModalOpen,
          studentToRemove,
          setStudentToRemove,
          isSelectiveSyncModalOpen,
          setIsSelectiveSyncModalOpen,
          isCalendarModalOpen,
          setIsCalendarModalOpen,
          calendarModalCourse,
          setCalendarModalCourse,
          calendarScheduleSelection,
          setCalendarScheduleSelection,
          syncToGoogleFromModal,
          setSyncToGoogleFromModal,
          isSavingCalendarSelection,
          selectedCalendarForSlots,
          setSelectedCalendarForSlots,
          availableCalendarsForSlots,
          calendarSlots,
          isLoadingSlots,
          isEditCourseModalOpen,
          setIsEditCourseModalOpen,
          editCourseData,
          setEditCourseData,
          isSavingCourseDetails,
          isAddStudentModalOpen,
          setIsAddStudentModalOpen,
          addStudentFirstName,
          setAddStudentFirstName,
          addStudentLastName,
          setAddStudentLastName,
          addStudentEmail,
          setAddStudentEmail,
          addStudentPhone,
          setAddStudentPhone,
          addStudentNotes,
          setAddStudentNotes,
          isSavingManualStudent,
          addStudentTab,
          setAddStudentTab,
          batchStudentsText,
          setBatchStudentsText,
          directMessageModal,
          setDirectMessageModal,
          handleOpenCalendarSyncModal,
          handleSaveCalendarSelection,
          handleSaveCourseDetails,
          handleSaveSingleStudent,
          handleSaveBatchStudents,
          handleOpenDirectMessageModal,
          handleSendDirectMessage,
        }}
        sheetsAndDriveSync={{
          sheetConfig,
          isSyncingSheet,
          isOpeningSheet,
          showSheetsConnectModal,
          setShowSheetsConnectModal,
          sheetsModalFeedback,
          customSheetInput,
          setCustomSheetInput,
          isLinkingCustomSheet,
          customFolderInput,
          setCustomFolderInput,
          isLinkingCustomFolder,
          isPullingFromSheet,
          dobleEntradaDiffs,
          isDobleEntradaModalOpen,
          setIsDobleEntradaModalOpen,
          isHeaderExportExcelModalOpen,
          setIsHeaderExportExcelModalOpen,
          isHeaderImportModalOpen,
          setIsHeaderImportModalOpen,
          headerImportSourceType,
          headerImportContext,
          driveFolderModalOpen,
          setDriveFolderModalOpen,
          courseDriveStructure,
          handleManualSheetsSync,
          handleLinkCustomSpreadsheet,
          handleSaveCustomDriveFolder,
          handleConnectGoogleForSheets,
          handlePullFromGoogleSheet,
          handleExportAllCourseExcel,
          getCategoriesForImport,
          getGradesMapForImport,
          handleApplyImportFromClassesModule,
          handleApplyMultiImportFromClassesModule,
          handleOpenInSheetsNew,
          handleDownloadCourseCsv,
        }}
        notifications={{
          savedPresets,
          conductReasonTemplates,
          notifSettings,
          setNotifSettings,
          teacherConductOptions,
          notifConfigActiveTab,
          setNotifConfigActiveTab,
          searchReasonQuery,
          setSearchReasonQuery,
          isNewReasonFormOpen,
          setIsNewReasonFormOpen,
          newReasonName,
          setNewReasonName,
          newReasonTemplateText,
          setNewReasonTemplateText,
          reasonCardDrafts,
          setReasonCardDrafts,
          isNotifConfigModalOpen,
          setIsNotifConfigModalOpen,
          newConfigPreset,
          setNewConfigPreset,
          absenceNotifModal,
          setAbsenceNotifModal,
          batchAbsenceModal,
          setBatchAbsenceModal,
          editingConductOpt,
          setEditingConductOpt,
          editConductInput,
          setEditConductInput,
          editingTemplateForReason,
          setEditingTemplateForReason,
          reasonTemplateDraft,
          setReasonTemplateDraft,
          saveReasonAsDefaultOnSend,
          setSaveReasonAsDefaultOnSend,
          isManageConductModalOpen,
          setIsManageConductModalOpen,
          newConductInput,
          setNewConductInput,
          newConductType,
          setNewConductType,
          allKnownReasonKeys,
          handleSavePreset,
          handleDeletePreset,
          formatTemplateForStudent,
          extractGenericTemplate,
          getTemplateForReason,
          handleAddConductOption,
          handleDeleteConductOption,
          handleEditConductOption,
          handleSaveTemplateForReason,
          handleResetTemplateForReason,
          isReasonCustomized,
          handleSaveNotifSettings,
        }}
        observations={{
          isEditingStudentEmail,
          setIsEditingStudentEmail,
          editedStudentEmail,
          setEditedStudentEmail,
          selectedStudentForProfile,
          setSelectedStudentForProfile,
          newObservationText,
          setNewObservationText,
          newObservationUrl,
          setNewObservationUrl,
          studentObservations,
          setStudentObservations,
          showProfileDocConfirm,
          setShowProfileDocConfirm,
          profileDocTitle,
          setProfileDocTitle,
          profileDocLinkToObs,
          setProfileDocLinkToObs,
          isExportingProfileDoc,
          exportedProfileDoc,
          setExportedProfileDoc,
          profileDocError,
        }}
        actions={{
          pendingAllItems,
          conductRecordModal,
          setConductRecordModal,
          selectedStudentForHistory,
          setSelectedStudentForHistory,
          editingDispositionStudent,
          setEditingDispositionStudent,
          editingDispositionScore,
          setEditingDispositionScore,
          editingDispositionTerm,
          editingDispositionReason,
          setEditingDispositionReason,
          editingAbsenceStudent,
          setEditingAbsenceStudent,
          editingAbsenceCount,
          setEditingAbsenceCount,
          editingAbsenceTerm,
          editingAbsenceDate,
          setEditingAbsenceDate,
          editingAbsenceReason,
          setEditingAbsenceReason,
          editingAbsenceSendNotif,
          setEditingAbsenceSendNotif,
          editingAbsenceChannel,
          setEditingAbsenceChannel,
          editingAbsenceMessageText,
          setEditingAbsenceMessageText,
          isSavingAbsenceEdit,
          isSendDispositionModalOpen,
          setIsSendDispositionModalOpen,
          handleAddAbsence,
          sendNotificationForItem,
          getBatchMessageForItem,
          handleSendBatchNotifications,
          handleMarkOmitNotification,
          handleRecordDispositionAction,
          handleConfirmConductRecord,
          handleDeleteHistoryEntry,
          handleDeleteLatestAbsence,
          handleDeleteLatestLate,
          handleRecordLateArrival,
          handleOpenNotifyModal,
          handleOpenEditDisposition,
          handleChangeEditingTerm,
          handleNavigateEditStudent,
          handleSaveStudentDisposition,
          handleOpenEditAbsences,
          handleChangeEditingAbsenceTerm,
          handleNavigateEditAbsenceStudent,
          handleSaveStudentAbsences,
          handleSaveEditedStudentEmail,
          handleNavigateProfileStudent,
          handleSaveObservation,
          handleDeleteObservation,
          handleOpenExportProfileDocConfirm,
          handleConfirmExportProfileToGoogleDoc,
          handleResetSingleStudentDisposition,
          handleSendDispositionToGrades,
        }}
      />
    </div>
    </CourseWorkspaceProvider>
  );
};

export const ClassesModule = React.memo(
  ClassesModuleComponent,
  areClassesModulePropsEqual
);
ClassesModule.displayName = 'ClassesModule';

export default ClassesModule;


