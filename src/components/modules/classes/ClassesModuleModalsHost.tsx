/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ClassesModuleModalsHost: Dedicated Modal Orchestrator for the Course Workspace.
 * Isolates all 18+ course modals (Conduct, Absences, Student Profile, Google Drive/Sheets,
 * Calendar Sync, Notifications, Reports, Backup, Roll Call) out of ClassesModule.tsx.
 */

import React, { Suspense, lazy } from 'react';
import { History } from 'lucide-react';
import { Course, Student, StudentDispositionData } from '../../../types';
import { storageGateway } from '../../../services/storageGateway';
import { DEFAULT_ABSENCE_PRESETS } from '../../../hooks/useCourseNotifications';
import {
  DirectMessageModal,
  AddStudentModal,
  DobleEntradaModal,
  HeaderExportExcelModal,
} from './CourseUtilityModals';
import { DriveFolderModal, SheetsConnectModal } from './DriveSheetsModals';
import { CalendarSyncModal, EditCourseDetailsModal } from './CourseCalendarAndEditModals';
import { RemovedStudentsModals } from './RemovedStudentsModals';
import { SelectiveStudentSyncModal } from './SelectiveStudentSyncModal';
import {
  ConductRecordModal,
  ManageConductOptionsModal,
  StudentIndividualHistoryModal,
  SendDispositionToGradesModal,
} from './ConductAndHistoryModals';
import {
  EditStudentDispositionModal,
  EditStudentAbsencesModal,
} from './EditDispositionAndAbsencesModals';
import { IndividualAbsenceNotificationModal } from './AbsenceAndConductNotificationModals';

const ImportGradesModal = lazy(() =>
  import('../ImportGradesModal').then((m) => ({ default: m.ImportGradesModal }))
);
const CourseReportModal = lazy(() =>
  import('../CourseReportModal').then((m) => ({ default: m.CourseReportModal }))
);
const AttendanceSettingsModal = lazy(() =>
  import('./AttendanceSettingsModal').then((m) => ({ default: m.AttendanceSettingsModal }))
);
const BackupRestoreModal = lazy(() =>
  import('./BackupRestoreModal').then((m) => ({ default: m.BackupRestoreModal }))
);
const QuickRollCallModal = lazy(() =>
  import('./QuickRollCallModal').then((m) => ({ default: m.QuickRollCallModal }))
);
const StudentProfileObservationsModal = lazy(() =>
  import('./StudentProfileObservationsModal').then((m) => ({
    default: m.StudentProfileObservationsModal,
  }))
);
const BatchAbsenceNotificationModal = lazy(() =>
  import('./BatchAbsenceNotificationModal').then((m) => ({
    default: m.BatchAbsenceNotificationModal,
  }))
);
const NotificationPresetsConfigModal = lazy(() =>
  import('./NotificationPresetsConfigModal').then((m) => ({
    default: m.NotificationPresetsConfigModal,
  }))
);

export interface ClassesModuleModalsHostProps {
  activeCourse: Course | undefined;
  courses: Course[];
  students: Student[];
  courseStudents: Student[];
  filteredStudents: Student[];
  user: any;
  token: string | null;
  loginWithGoogle: (email?: string) => Promise<string | null>;
  isDarkMode: boolean;
  attendanceTerm: '1c' | '2c' | 'annual';
  activeConcreteTerm: '1c' | '2c';
  attendanceSettings: any;
  handleSaveAttendanceSettings: (newSettings: any, updatedSchedule?: string) => void;
  isAttendanceSettingsModalOpen: boolean;
  setIsAttendanceSettingsModalOpen: (v: boolean) => void;
  isBackupModalOpen: boolean;
  setIsBackupModalOpen: (v: boolean) => void;
  isQuickRollCallOpen: boolean;
  setIsQuickRollCallOpen: (v: boolean) => void;
  courseReportModalOpen: boolean;
  setCourseReportModalOpen: (v: boolean) => void;
  courseReportModalTab: 'course' | 'individual';
  setCourseReportModalTab: (v: 'course' | 'individual') => void;
  courseReportModalStudentId: string;
  setCourseReportModalStudentId: (v: string) => void;
  onRefreshData: () => void;
  setToastMessage: (msg: string | null) => void;
  dispositionSync: any;
  rosterAndSchedule: any;
  sheetsAndDriveSync: any;
  notifications: any;
  observations: any;
  actions: any;
}

export const ClassesModuleModalsHost: React.FC<ClassesModuleModalsHostProps> = ({
  activeCourse,
  courses,
  students,
  courseStudents,
  filteredStudents,
  user,
  token,
  loginWithGoogle,
  isDarkMode,
  attendanceTerm,
  activeConcreteTerm,
  attendanceSettings,
  handleSaveAttendanceSettings,
  isAttendanceSettingsModalOpen,
  setIsAttendanceSettingsModalOpen,
  isBackupModalOpen,
  setIsBackupModalOpen,
  isQuickRollCallOpen,
  setIsQuickRollCallOpen,
  courseReportModalOpen,
  setCourseReportModalOpen,
  courseReportModalTab,
  setCourseReportModalTab,
  courseReportModalStudentId,
  setCourseReportModalStudentId,
  onRefreshData,
  setToastMessage,
  dispositionSync,
  rosterAndSchedule,
  sheetsAndDriveSync,
  notifications,
  observations,
  actions,
}) => {
  const {
    dispositionMap,
    historyList,
    courseHistory,
    getStudentMetrics,
  } = dispositionSync;

  const {
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
  } = rosterAndSchedule;

  const {
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
  } = sheetsAndDriveSync;

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
  } = notifications;

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
    exportedProfileDoc,
    setExportedProfileDoc,
    profileDocError,
  } = observations;

  const {
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
  } = actions;

  return (
    <>
      {/* Modales de Conducta, Historial Individual y Envío de Disposición a Calificaciones */}
      <ConductRecordModal
        conductRecordModal={conductRecordModal}
        setConductRecordModal={setConductRecordModal}
        attendanceTerm={attendanceTerm}
        getStudentMetrics={getStudentMetrics}
        teacherConductOptions={teacherConductOptions}
        handleConfirmConductRecord={handleConfirmConductRecord}
        isDarkMode={isDarkMode}
      />

      <ManageConductOptionsModal
        isOpen={isManageConductModalOpen}
        onClose={() => setIsManageConductModalOpen(false)}
        teacherConductOptions={teacherConductOptions}
        newConductInput={newConductInput}
        setNewConductInput={setNewConductInput}
        newConductType={newConductType}
        setNewConductType={setNewConductType}
        handleAddConductOption={handleAddConductOption}
        editingConductOpt={editingConductOpt}
        setEditingConductOpt={setEditingConductOpt}
        editConductInput={editConductInput}
        setEditConductInput={setEditConductInput}
        handleEditConductOption={handleEditConductOption}
        handleDeleteConductOption={handleDeleteConductOption}
        isReasonCustomized={isReasonCustomized}
        editingTemplateForReason={editingTemplateForReason}
        setEditingTemplateForReason={setEditingTemplateForReason}
        reasonTemplateDraft={reasonTemplateDraft}
        setReasonTemplateDraft={setReasonTemplateDraft}
        getTemplateForReason={getTemplateForReason}
        handleResetTemplateForReason={handleResetTemplateForReason}
        handleSaveTemplateForReason={handleSaveTemplateForReason}
        isDarkMode={isDarkMode}
      />

      <StudentIndividualHistoryModal
        selectedStudentForHistory={selectedStudentForHistory}
        setSelectedStudentForHistory={setSelectedStudentForHistory}
        getStudentMetrics={getStudentMetrics}
        handleOpenEditAbsences={handleOpenEditAbsences}
        handleDeleteLatestAbsence={handleDeleteLatestAbsence}
        handleDeleteLatestLate={handleDeleteLatestLate}
        handleOpenEditDisposition={handleOpenEditDisposition}
        handleResetSingleStudentDisposition={handleResetSingleStudentDisposition}
        historyList={historyList}
        handleOpenNotifyModal={handleOpenNotifyModal}
        handleDeleteHistoryEntry={handleDeleteHistoryEntry}
        isDarkMode={isDarkMode}
      />

      <SendDispositionToGradesModal
        isOpen={isSendDispositionModalOpen}
        onClose={() => setIsSendDispositionModalOpen(false)}
        activeCourse={activeCourse}
        courseStudents={courseStudents}
        attendanceTerm={attendanceTerm}
        getStudentMetrics={getStudentMetrics}
        handleSendDispositionToGrades={handleSendDispositionToGrades}
        isDarkMode={isDarkMode}
      />

      {/* Modales de Edición Manual de Disposición e Inasistencias */}
      <EditStudentDispositionModal
        editingDispositionStudent={editingDispositionStudent}
        setEditingDispositionStudent={setEditingDispositionStudent}
        activeCourse={activeCourse}
        editingDispositionTerm={editingDispositionTerm}
        handleChangeEditingTerm={handleChangeEditingTerm}
        getStudentMetrics={getStudentMetrics}
        editingDispositionScore={editingDispositionScore}
        setEditingDispositionScore={setEditingDispositionScore}
        editingDispositionReason={editingDispositionReason}
        setEditingDispositionReason={setEditingDispositionReason}
        filteredStudents={filteredStudents}
        handleNavigateEditStudent={handleNavigateEditStudent}
        handleSaveStudentDisposition={handleSaveStudentDisposition}
        isDarkMode={isDarkMode}
      />

      <EditStudentAbsencesModal
        editingAbsenceStudent={editingAbsenceStudent}
        setEditingAbsenceStudent={setEditingAbsenceStudent}
        activeCourse={activeCourse}
        editingAbsenceTerm={editingAbsenceTerm}
        handleChangeEditingAbsenceTerm={handleChangeEditingAbsenceTerm}
        getStudentMetrics={getStudentMetrics}
        editingAbsenceCount={editingAbsenceCount}
        setEditingAbsenceCount={setEditingAbsenceCount}
        editingAbsenceDate={editingAbsenceDate}
        setEditingAbsenceDate={setEditingAbsenceDate}
        editingAbsenceReason={editingAbsenceReason}
        setEditingAbsenceReason={setEditingAbsenceReason}
        editingAbsenceSendNotif={editingAbsenceSendNotif}
        setEditingAbsenceSendNotif={setEditingAbsenceSendNotif}
        editingAbsenceChannel={editingAbsenceChannel}
        setEditingAbsenceChannel={setEditingAbsenceChannel}
        editingAbsenceMessageText={editingAbsenceMessageText}
        setEditingAbsenceMessageText={setEditingAbsenceMessageText}
        savedPresets={savedPresets}
        notifSettings={notifSettings}
        defaultAbsencePresets={DEFAULT_ABSENCE_PRESETS}
        formatTemplateForStudent={formatTemplateForStudent}
        filteredStudents={filteredStudents}
        isSavingAbsenceEdit={isSavingAbsenceEdit}
        handleNavigateEditAbsenceStudent={handleNavigateEditAbsenceStudent}
        handleSaveStudentAbsences={handleSaveStudentAbsences}
        isDarkMode={isDarkMode}
      />

      {/* Ficha del Estudiante y Observaciones Docente */}
      {selectedStudentForProfile && (
        <Suspense fallback={null}>
          <StudentProfileObservationsModal
            selectedStudentForProfile={selectedStudentForProfile}
            setSelectedStudentForProfile={setSelectedStudentForProfile}
            activeCourse={activeCourse}
            user={user}
            isDarkMode={isDarkMode}
            isEditingStudentEmail={isEditingStudentEmail}
            setIsEditingStudentEmail={setIsEditingStudentEmail}
            editedStudentEmail={editedStudentEmail}
            setEditedStudentEmail={setEditedStudentEmail}
            handleSaveEditedStudentEmail={handleSaveEditedStudentEmail}
            handleOpenDirectMessageModal={handleOpenDirectMessageModal}
            getStudentMetrics={getStudentMetrics}
            attendanceTerm={attendanceTerm}
            attendanceSettings={attendanceSettings}
            handleOpenEditAbsences={handleOpenEditAbsences}
            setIsAttendanceSettingsModalOpen={setIsAttendanceSettingsModalOpen}
            handleOpenExportProfileDocConfirm={handleOpenExportProfileDocConfirm}
            isExportingProfileDoc={isExportingProfileDoc}
            showProfileDocConfirm={showProfileDocConfirm}
            setShowProfileDocConfirm={setShowProfileDocConfirm}
            profileDocTitle={profileDocTitle}
            setProfileDocTitle={setProfileDocTitle}
            profileDocLinkToObs={profileDocLinkToObs}
            setProfileDocLinkToObs={setProfileDocLinkToObs}
            profileDocError={profileDocError}
            handleConfirmExportProfileToGoogleDoc={handleConfirmExportProfileToGoogleDoc}
            exportedProfileDoc={exportedProfileDoc}
            setExportedProfileDoc={setExportedProfileDoc}
            newObservationText={newObservationText}
            setNewObservationText={setNewObservationText}
            newObservationUrl={newObservationUrl}
            setNewObservationUrl={setNewObservationUrl}
            handleSaveObservation={handleSaveObservation}
            studentObservations={studentObservations}
            handleDeleteObservation={handleDeleteObservation}
            filteredStudents={filteredStudents}
            handleNavigateProfileStudent={handleNavigateProfileStudent}
            setCourseReportModalStudentId={setCourseReportModalStudentId}
            setCourseReportModalTab={setCourseReportModalTab}
            setCourseReportModalOpen={setCourseReportModalOpen}
            onDeleteStudent={setStudentToRemove}
          />
        </Suspense>
      )}

      <RemovedStudentsModals
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        studentToRemove={studentToRemove}
        setStudentToRemove={setStudentToRemove}
        isRemovedStudentsModalOpen={isRemovedStudentsModalOpen}
        setIsRemovedStudentsModalOpen={setIsRemovedStudentsModalOpen}
        removedStudentsList={removedStudentsList}
        setRemovedStudentIds={setRemovedStudentIds}
        setRemovedStudentsList={setRemovedStudentsList}
        setToastMessage={setToastMessage}
        onRefreshData={onRefreshData}
      />

      <SelectiveStudentSyncModal
        isOpen={isSelectiveSyncModalOpen}
        onClose={() => setIsSelectiveSyncModalOpen(false)}
        targetCourse={activeCourse || null}
        allCourses={courses}
        token={token}
        userEmail={user?.email}
        onLoginWithGoogle={loginWithGoogle}
        isDarkMode={isDarkMode}
        onSyncCompleted={(msg) => {
          onRefreshData();
          setToastMessage(msg);
          setTimeout(() => setToastMessage(null), 4500);
        }}
      />

      <CalendarSyncModal
        isOpen={isCalendarModalOpen}
        calendarModalCourse={calendarModalCourse}
        onClose={() => {
          setIsCalendarModalOpen(false);
          setCalendarModalCourse(null);
        }}
        isDarkMode={isDarkMode}
        handleSaveCalendarSelection={handleSaveCalendarSelection}
        selectedCalendarForSlots={selectedCalendarForSlots}
        setSelectedCalendarForSlots={setSelectedCalendarForSlots}
        handleOpenCalendarSyncModal={handleOpenCalendarSyncModal}
        availableCalendarsForSlots={availableCalendarsForSlots}
        isLoadingSlots={isLoadingSlots}
        calendarSlots={calendarSlots}
        calendarScheduleSelection={calendarScheduleSelection}
        setCalendarScheduleSelection={setCalendarScheduleSelection}
        syncToGoogleFromModal={syncToGoogleFromModal}
        setSyncToGoogleFromModal={setSyncToGoogleFromModal}
        isSavingCalendarSelection={isSavingCalendarSelection}
      />

      <EditCourseDetailsModal
        isOpen={isEditCourseModalOpen}
        editCourseData={editCourseData}
        setEditCourseData={setEditCourseData}
        onClose={() => {
          setIsEditCourseModalOpen(false);
          setEditCourseData(null);
        }}
        isDarkMode={isDarkMode}
        handleSaveCourseDetails={handleSaveCourseDetails}
        isSavingCourseDetails={isSavingCourseDetails}
      />

      <IndividualAbsenceNotificationModal
        absenceNotifModal={absenceNotifModal}
        setAbsenceNotifModal={setAbsenceNotifModal}
        activeCourse={activeCourse}
        setIsNotifConfigModalOpen={setIsNotifConfigModalOpen}
        getTemplateForReason={getTemplateForReason}
        dispositionMap={dispositionMap}
        formatTemplateForStudent={formatTemplateForStudent}
        savedPresets={savedPresets}
        conductReasonTemplates={conductReasonTemplates}
        allKnownReasonKeys={allKnownReasonKeys}
        notifSettings={notifSettings}
        isReasonCustomized={isReasonCustomized}
        handleSaveTemplateForReason={handleSaveTemplateForReason}
        saveReasonAsDefaultOnSend={saveReasonAsDefaultOnSend}
        setSaveReasonAsDefaultOnSend={setSaveReasonAsDefaultOnSend}
        extractGenericTemplate={extractGenericTemplate}
        handleSavePreset={handleSavePreset}
        handleSaveNotifSettings={handleSaveNotifSettings}
        setToastMessage={setToastMessage}
        sendNotificationForItem={sendNotificationForItem}
        handleMarkOmitNotification={handleMarkOmitNotification}
        isDarkMode={isDarkMode}
      />

      {batchAbsenceModal.isOpen && (
        <Suspense fallback={null}>
          <BatchAbsenceNotificationModal
            batchAbsenceModal={batchAbsenceModal}
            setBatchAbsenceModal={setBatchAbsenceModal}
            activeCourse={activeCourse}
            pendingAllItems={pendingAllItems}
            students={students}
            setIsNotifConfigModalOpen={setIsNotifConfigModalOpen}
            savedPresets={savedPresets}
            handleSavePreset={handleSavePreset}
            getBatchMessageForItem={getBatchMessageForItem}
            handleSendBatchNotifications={handleSendBatchNotifications}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      {isNotifConfigModalOpen && (
        <Suspense fallback={null}>
          <NotificationPresetsConfigModal
            isOpen={isNotifConfigModalOpen}
            onClose={() => setIsNotifConfigModalOpen(false)}
            notifConfigActiveTab={notifConfigActiveTab}
            setNotifConfigActiveTab={setNotifConfigActiveTab}
            conductReasonTemplates={conductReasonTemplates}
            savedPresets={savedPresets}
            searchReasonQuery={searchReasonQuery}
            setSearchReasonQuery={setSearchReasonQuery}
            isNewReasonFormOpen={isNewReasonFormOpen}
            setIsNewReasonFormOpen={setIsNewReasonFormOpen}
            newReasonName={newReasonName}
            setNewReasonName={setNewReasonName}
            newReasonTemplateText={newReasonTemplateText}
            setNewReasonTemplateText={setNewReasonTemplateText}
            getTemplateForReason={getTemplateForReason}
            handleSaveTemplateForReason={handleSaveTemplateForReason}
            allKnownReasonKeys={allKnownReasonKeys}
            isReasonCustomized={isReasonCustomized}
            reasonCardDrafts={reasonCardDrafts}
            setReasonCardDrafts={setReasonCardDrafts}
            handleResetTemplateForReason={handleResetTemplateForReason}
            newConfigPreset={newConfigPreset}
            setNewConfigPreset={setNewConfigPreset}
            handleSavePreset={handleSavePreset}
            handleDeletePreset={handleDeletePreset}
            notifSettings={notifSettings}
            setNotifSettings={setNotifSettings}
            handleSaveNotifSettings={handleSaveNotifSettings}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      <DriveFolderModal
        isOpen={driveFolderModalOpen}
        onClose={() => setDriveFolderModalOpen(false)}
        activeCourse={activeCourse}
        courseDriveStructure={courseDriveStructure}
        isDarkMode={isDarkMode}
      />

      <SheetsConnectModal
        isOpen={showSheetsConnectModal}
        onClose={() => setShowSheetsConnectModal(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        sheetConfig={sheetConfig}
        isSyncingSheet={isSyncingSheet}
        isOpeningSheet={isOpeningSheet}
        handleManualSheetsSync={handleManualSheetsSync}
        customFolderInput={customFolderInput}
        setCustomFolderInput={setCustomFolderInput}
        handleSaveCustomDriveFolder={handleSaveCustomDriveFolder}
        isLinkingCustomFolder={isLinkingCustomFolder}
        customSheetInput={customSheetInput}
        setCustomSheetInput={setCustomSheetInput}
        handleLinkCustomSpreadsheet={handleLinkCustomSpreadsheet}
        isLinkingCustomSheet={isLinkingCustomSheet}
        sheetsModalFeedback={sheetsModalFeedback}
        handlePullFromGoogleSheet={handlePullFromGoogleSheet}
        isPullingFromSheet={isPullingFromSheet}
        handleConnectGoogleForSheets={handleConnectGoogleForSheets}
        handleOpenInSheetsNew={handleOpenInSheetsNew}
        handleDownloadCourseCsv={handleDownloadCourseCsv}
      />

      <HeaderExportExcelModal
        isOpen={isHeaderExportExcelModalOpen}
        onClose={() => setIsHeaderExportExcelModalOpen(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        handleExportAllCourseExcel={handleExportAllCourseExcel}
        HistoryIcon={History}
      />

      {isHeaderImportModalOpen && activeCourse && (
        <Suspense fallback={null}>
          <ImportGradesModal
            isOpen={isHeaderImportModalOpen}
            onClose={() => setIsHeaderImportModalOpen(false)}
            courseId={activeCourse.id}
            courseName={activeCourse.name}
            students={courseStudents}
            categories1c={getCategoriesForImport('1c')}
            categories2c={getCategoriesForImport('2c')}
            gradesMap1c={getGradesMapForImport('1c')}
            gradesMap2c={getGradesMapForImport('2c')}
            currentTerm={activeConcreteTerm}
            isDarkMode={isDarkMode}
            initialSourceType={headerImportSourceType}
            importContext={headerImportContext}
            currentDispositionMap1c={(() => {
              const map: Record<
                string,
                { totalAbsences: number; totalLates?: number; totalDisposition: number }
              > = {};
              courseStudents.forEach((s) => {
                const m = getStudentMetrics(s.id, '1c');
                map[s.id] = {
                  totalAbsences: m.totalAbsences,
                  totalLates: m.totalLates || 0,
                  totalDisposition: m.totalDisposition,
                };
              });
              return map;
            })()}
            currentDispositionMap2c={(() => {
              const map: Record<
                string,
                { totalAbsences: number; totalLates?: number; totalDisposition: number }
              > = {};
              courseStudents.forEach((s) => {
                const m = getStudentMetrics(s.id, '2c');
                map[s.id] = {
                  totalAbsences: m.totalAbsences,
                  totalLates: m.totalLates || 0,
                  totalDisposition: m.totalDisposition,
                };
              });
              return map;
            })()}
            onApplyGrades={handleApplyImportFromClassesModule}
            onApplyMultiImport={handleApplyMultiImportFromClassesModule}
            historyEntries={storageGateway.getCourseGradeHistory(activeCourse.id)}
          />
        </Suspense>
      )}

      <DobleEntradaModal
        isOpen={isDobleEntradaModalOpen}
        onClose={() => setIsDobleEntradaModalOpen(false)}
        activeCourse={activeCourse}
        dobleEntradaDiffs={dobleEntradaDiffs}
        isDarkMode={isDarkMode}
      />

      <AddStudentModal
        isOpen={isAddStudentModalOpen}
        onClose={() => setIsAddStudentModalOpen(false)}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        addStudentTab={addStudentTab}
        setAddStudentTab={setAddStudentTab}
        addStudentLastName={addStudentLastName}
        setAddStudentLastName={setAddStudentLastName}
        addStudentFirstName={addStudentFirstName}
        setAddStudentFirstName={setAddStudentFirstName}
        addStudentEmail={addStudentEmail}
        setAddStudentEmail={setAddStudentEmail}
        addStudentPhone={addStudentPhone}
        setAddStudentPhone={setAddStudentPhone}
        addStudentNotes={addStudentNotes}
        setAddStudentNotes={setAddStudentNotes}
        batchStudentsText={batchStudentsText}
        setBatchStudentsText={setBatchStudentsText}
        isSavingManualStudent={isSavingManualStudent}
        handleSaveSingleStudent={handleSaveSingleStudent}
        handleSaveBatchStudents={handleSaveBatchStudents}
      />

      <DirectMessageModal
        directMessageModal={directMessageModal}
        setDirectMessageModal={setDirectMessageModal}
        activeCourse={activeCourse}
        isDarkMode={isDarkMode}
        handleSendDirectMessage={handleSendDirectMessage}
      />

      {courseReportModalOpen && activeCourse && (
        <Suspense fallback={null}>
          <CourseReportModal
            isOpen={courseReportModalOpen}
            onClose={() => setCourseReportModalOpen(false)}
            courseId={activeCourse.id}
            courseName={activeCourse.name}
            students={courseStudents}
            isDarkMode={isDarkMode}
            score1cMap={{}}
            score2cMap={{}}
            annualOverrides={{}}
            driveFolderId={activeCourse.driveFolderId}
            driveFolderUrl={activeCourse.driveFolderUrl}
            initialTab={courseReportModalTab}
            initialStudentId={courseReportModalStudentId}
          />
        </Suspense>
      )}

      {isAttendanceSettingsModalOpen && activeCourse && (
        <Suspense fallback={null}>
          <AttendanceSettingsModal
            isOpen={isAttendanceSettingsModalOpen}
            onClose={() => setIsAttendanceSettingsModalOpen(false)}
            course={activeCourse}
            currentSettings={attendanceSettings}
            onSaveSettings={handleSaveAttendanceSettings}
            students={courseStudents}
            studentMetricsMap={(() => {
              const map: Record<string, StudentDispositionData> = {};
              courseStudents.forEach((s) => {
                map[s.id] = getStudentMetrics(s.id, attendanceTerm);
              });
              return map;
            })()}
            currentTerm={attendanceTerm}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      {isBackupModalOpen && activeCourse && (
        <Suspense fallback={null}>
          <BackupRestoreModal
            isOpen={isBackupModalOpen}
            onClose={() => setIsBackupModalOpen(false)}
            course={activeCourse}
            students={courseStudents}
            courseHistory={courseHistory}
            studentObservations={studentObservations}
            onRestoreObservations={(merged) => setStudentObservations(merged)}
            onRestoreSuccess={(msg) => {
              setToastMessage(msg);
              setTimeout(() => setToastMessage(null), 4000);
              onRefreshData();
            }}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      {isQuickRollCallOpen && activeCourse && (
        <Suspense fallback={null}>
          <QuickRollCallModal
            isOpen={isQuickRollCallOpen}
            onClose={() => setIsQuickRollCallOpen(false)}
            courseId={activeCourse.id}
            courseName={activeCourse.name}
            students={courseStudents}
            attendanceTerm={attendanceTerm}
            attendanceSettings={attendanceSettings}
            historyList={historyList}
            getStudentMetrics={getStudentMetrics}
            teacherConductOptions={teacherConductOptions}
            onAddAbsence={handleAddAbsence}
            onRecordLateArrival={handleRecordLateArrival}
            onDeleteLatestAbsence={handleDeleteLatestAbsence}
            onDeleteLatestLate={handleDeleteLatestLate}
            onRecordDispositionAction={handleRecordDispositionAction}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}
    </>
  );
};
