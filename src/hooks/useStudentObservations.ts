import { useState, useEffect } from 'react';
import { Student, StudentObservation } from '../types';
import { getUserScopedItem, setUserScopedItem } from '../services/api';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';
import { flushOfflineSyncQueue } from '../services/offlineSyncQueue';

interface UseStudentObservationsParams {
  userEmail?: string;
  userId?: string;
  activeCourseId?: string;
}

export function useStudentObservations({
  userEmail,
  userId,
  activeCourseId,
}: UseStudentObservationsParams) {
  const [isEditingStudentEmail, setIsEditingStudentEmail] = useState(false);
  const [editedStudentEmail, setEditedStudentEmail] = useState('');

  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<Student | null>(null);
  const [newObservationText, setNewObservationText] = useState('');
  const [newObservationUrl, setNewObservationUrl] = useState('');
  const [studentObservations, setStudentObservations] = useState<Record<string, StudentObservation[]>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = getUserScopedItem('fds_student_observations');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return {};
  });

  // Google Doc export state for Student Profile
  const [showProfileDocConfirm, setShowProfileDocConfirm] = useState(false);
  const [profileDocTitle, setProfileDocTitle] = useState('');
  const [profileDocLinkToObs, setProfileDocLinkToObs] = useState(true);
  const [isExportingProfileDoc, setIsExportingProfileDoc] = useState(false);
  const [exportedProfileDoc, setExportedProfileDoc] = useState<{
    id: string;
    name: string;
    webViewLink: string;
    studentId: string;
  } | null>(null);
  const [profileDocError, setProfileDocError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadCloudObservations = async () => {
      const uid = getActiveUserId();
      if (!uid) return;
      try {
        const cloudMap = await firestoreSync.loadStudentObservationsMap(uid);
        if (!isMounted || !cloudMap || typeof cloudMap !== 'object') return;
        setStudentObservations((prev) => {
          const merged: Record<string, StudentObservation[]> = { ...prev };
          let changed = false;
          for (const [stId, cloudList] of Object.entries(cloudMap)) {
            if (!Array.isArray(cloudList)) continue;
            const localList = merged[stId] || [];
            const existingIds = new Set(localList.map((o) => o.id));
            const newItems = cloudList.filter((o) => o && o.id && !existingIds.has(o.id));
            if (newItems.length > 0 || (localList.length === 0 && cloudList.length > 0)) {
              merged[stId] = [...localList, ...newItems].sort(
                (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
              );
              changed = true;
            }
          }
          if (changed && typeof window !== 'undefined') {
            setUserScopedItem('fds_student_observations', JSON.stringify(merged));
          }
          return changed ? merged : prev;
        });
      } catch (_) {}
    };

    loadCloudObservations();

    const handleNetworkRestored = () => {
      flushOfflineSyncQueue(async (action) => {
        const uid = getActiveUserId();
        if (!uid) return false;
        try {
          if (action.type === 'observation_save' && action.payload?.obs) {
            await firestoreSync.saveStudentObservation(uid, action.payload.obs, action.payload.map);
            return true;
          } else if (action.type === 'observation_delete' && action.payload?.map) {
            await firestoreSync.saveStudentObservationsMap(uid, action.payload.map);
            return true;
          }
        } catch (_) {
          return false;
        }
        return true;
      });
      loadCloudObservations();
    };

    window.addEventListener('docencia_network_restored', handleNetworkRestored);
    window.addEventListener('docencia_trigger_queue_flush', handleNetworkRestored);

    return () => {
      isMounted = false;
      window.removeEventListener('docencia_network_restored', handleNetworkRestored);
      window.removeEventListener('docencia_trigger_queue_flush', handleNetworkRestored);
    };
  }, [userEmail, userId, activeCourseId]);

  return {
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
  };
}
