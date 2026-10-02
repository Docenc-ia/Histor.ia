/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  getDocFromServer,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Course, Student } from '../types';
import { auth } from './workspace/googleAuth';
import { isSameCalendarDay } from '../utils/dateUtils';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID if configured
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Test connection on boot as recommended by Firebase guidelines
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline:', error.message);
    }
    return false;
  }
}

// Helper to get active user ID
export function getActiveUserId(): string {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('docencia_user_profile') || localStorage.getItem('docencia_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) return parsed.id;
      }
      const email = sessionStorage.getItem('docencia_teacher_email') || localStorage.getItem('docencia_teacher_email');
      if (email) return 'teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    } catch (_) {}
  }
  return 'default_teacher';
}

export const firestoreSync = {
  /**
   * Save all courses to Firestore under /users/{userId}/courses/{courseId}
   */
  async saveCourses(userId: string, courses: Course[]): Promise<void> {
    if (!userId || !Array.isArray(courses)) return;
    try {
      const batch = writeBatch(db);
      for (const course of courses) {
        const ref = doc(db, 'users', userId, 'courses', course.id);
        batch.set(ref, {
          ...course,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      await batch.commit();
    } catch (err) {
      console.warn('Error saving courses to Firestore:', err);
    }
  },

  /**
   * Load courses from Firestore
   */
  async loadCourses(userId: string): Promise<Course[]> {
    if (!userId) return [];
    try {
      const coursesCol = collection(db, 'users', userId, 'courses');
      const snap = await getDocs(coursesCol);
      const courses: Course[] = [];
      snap.forEach((docSnap) => {
        courses.push(docSnap.data() as Course);
      });
      return courses;
    } catch (err) {
      console.warn('Error loading courses from Firestore:', err);
      return [];
    }
  },

  /**
   * Delete a course from Firestore
   */
  async deleteCourse(userId: string, courseId: string): Promise<void> {
    if (!userId || !courseId) return;
    try {
      const ref = doc(db, 'users', userId, 'courses', courseId);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('Error deleting course from Firestore:', err);
    }
  },

  /**
   * Save students roster for a course to Firestore
   */
  async saveStudents(userId: string, courseId: string, students: Student[]): Promise<void> {
    if (!userId || !courseId || !Array.isArray(students)) return;
    try {
      const batch = writeBatch(db);
      for (const st of students) {
        const ref = doc(db, 'users', userId, 'students', st.id);
        batch.set(ref, {
          ...st,
          courseId,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      await batch.commit();
    } catch (err) {
      console.warn('Error saving students to Firestore:', err);
    }
  },

  /**
   * Load students from Firestore
   */
  async loadStudents(userId: string, courseId?: string): Promise<Student[]> {
    if (!userId) return [];
    try {
      const studentsCol = collection(db, 'users', userId, 'students');
      const snap = await getDocs(studentsCol);
      const students: Student[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Student;
        if (!courseId || data.courseId === courseId) {
          students.push(data);
        }
      });
      return students;
    } catch (err) {
      console.warn('Error loading students from Firestore:', err);
      return [];
    }
  },

  /**
   * Save attendance records for a course and date
   */
  async saveAttendance(
    userId: string,
    courseId: string,
    date: string,
    records: { studentId: string; status: string }[]
  ): Promise<void> {
    if (!userId || !courseId || !date) return;
    try {
      const docId = `${courseId}_${date}`;
      const ref = doc(db, 'users', userId, 'attendance', docId);
      await setDoc(ref, {
        courseId,
        date,
        records: JSON.stringify(records),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      console.warn('Error saving attendance to Firestore:', err);
    }
  },

  /**
   * Save a student disposition / absence incident
   */
  async saveDisposition(userId: string, record: any): Promise<void> {
    if (!userId || !record?.id) return;
    try {
      const ref = doc(db, 'users', userId, 'disposition', record.id);
      await setDoc(ref, {
        ...record,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      console.warn('Error saving disposition to Firestore:', err);
    }
  },

  /**
   * Delete a student disposition / absence incident from Firestore
   */
  async deleteDisposition(userId: string, recordId: string): Promise<void> {
    if (!userId || !recordId) return;
    try {
      const ref = doc(db, 'users', userId, 'disposition', recordId);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('Error deleting disposition from Firestore:', err);
    }
  },

  /**
   * Delete any absence records for a student recorded today in Firestore
   */
  async deleteTodayAbsencesForStudent(userId: string, studentId: string, targetDate: Date = new Date()): Promise<string[]> {
    if (!userId || !studentId) return [];
    try {
      const col = collection(db, 'users', userId, 'disposition');
      const snap = await getDocs(col);
      const deletedIds: string[] = [];
      const deletePromises: Promise<void>[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (
          data.studentId === studentId &&
          data.category === 'Ausencia' &&
          isSameCalendarDay(data.date, data.timestamp, targetDate)
        ) {
          deletedIds.push(docSnap.id);
          deletePromises.push(deleteDoc(docSnap.ref));
        }
      });

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
      return deletedIds;
    } catch (err) {
      console.warn('Error deleting today absences from Firestore:', err);
      return [];
    }
  },

  /**
   * Delete disposition documents for a single student from Firestore (when resetting / clearing disposition)
   */
  async deleteStudentDispositionDocs(userId: string, studentId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !studentId) return [];
    try {
      const col = collection(db, 'users', userId, 'disposition');
      const snap = await getDocs(col);
      const deletedIds: string[] = [];
      const deletePromises: Promise<void>[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.studentId === studentId) {
          const isDisp = data.category === 'Disposición' || (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
          if (clearAll || isDisp) {
            deletedIds.push(docSnap.id);
            deletePromises.push(deleteDoc(docSnap.ref));
          }
        }
      });

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
      return deletedIds;
    } catch (err) {
      console.warn('Error deleting student disposition docs from Firestore:', err);
      return [];
    }
  },

  /**
   * Delete disposition documents for an entire course from Firestore
   */
  async deleteCourseDispositionDocs(userId: string, courseId: string, clearAll: boolean = false): Promise<string[]> {
    if (!userId || !courseId) return [];
    try {
      const col = collection(db, 'users', userId, 'disposition');
      const snap = await getDocs(col);
      const deletedIds: string[] = [];
      const deletePromises: Promise<void>[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.courseId === courseId) {
          const isDisp = data.category === 'Disposición' || (!data.category && data.action !== 'Ausencia' && data.action !== 'Llegada tarde');
          if (clearAll || isDisp) {
            deletedIds.push(docSnap.id);
            deletePromises.push(deleteDoc(docSnap.ref));
          }
        }
      });

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
      return deletedIds;
    } catch (err) {
      console.warn('Error deleting course disposition docs from Firestore:', err);
      return [];
    }
  },

  /**
   * Load disposition history from Firestore
   */
  async loadDisposition(userId: string): Promise<{ disposition: Record<string, any>; history: any[] }> {
    if (!userId) return { disposition: {}, history: [] };
    try {
      const col = collection(db, 'users', userId, 'disposition');
      const snap = await getDocs(col);
      const history: any[] = [];
      const disposition: Record<string, { totalAbsences: number; totalLates?: number; totalDisposition: number }> = {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const item: any = { id: docSnap.id, ...data };
        if (data.category === 'Ausencia' || data.category === 'Llegada tarde') {
          item.pointsChange = 0;
        }
        history.push(item);

        const studentId = data.studentId;
        if (studentId && studentId !== 'all') {
          if (!disposition[studentId]) {
            disposition[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
          }
          const isAbsence =
            data.category === 'Ausencia' ||
            data.action === 'Ausencia' ||
            data.action?.toLowerCase().includes('ausencia') ||
            data.action?.toLowerCase().includes('falta');

          const isLate =
            data.category === 'Llegada tarde' ||
            data.action === 'Llegada tarde' ||
            data.action?.toLowerCase().includes('llegada tarde') ||
            data.action?.toLowerCase().includes('tardanza') ||
            data.action?.toLowerCase().includes('tarde');

          if (isAbsence) {
            disposition[studentId].totalAbsences += 1;
          } else if (isLate) {
            disposition[studentId].totalLates = (disposition[studentId].totalLates || 0) + 1;
          } else if (
            data.category === 'Disposición' ||
            (!isAbsence && !isLate && data.category !== 'Sistema' && data.category !== 'Calificación')
          ) {
            const pts = data.pointsChange && data.pointsChange < 0 ? Math.abs(data.pointsChange) : 1;
            disposition[studentId].totalDisposition = Math.max(0, disposition[studentId].totalDisposition - pts);
          }
        }
      });

      history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return { disposition, history };
    } catch (err) {
      console.warn('Error loading disposition from Firestore:', err);
      return { disposition: {}, history: [] };
    }
  },

  /**
   * Save a cuatrimestre closure snapshot (final grades, absences, lates, history)
   */
  async saveTermSnapshot(
    userId: string,
    courseId: string,
    term: string,
    snapshotData: any
  ): Promise<void> {
    if (!userId || !courseId || !term) return;
    try {
      const docId = `${courseId}_${term}`;
      const ref = doc(db, 'users', userId, 'snapshots', docId);
      await setDoc(ref, {
        ...snapshotData,
        courseId,
        term,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      console.warn('Error saving term snapshot to Firestore:', err);
    }
  },

  /**
   * Load cuatrimestre closure snapshots for a course
   */
  async loadTermSnapshots(
    userId: string,
    courseId: string
  ): Promise<Record<string, any>> {
    if (!userId || !courseId) return {};
    try {
      const col = collection(db, 'users', userId, 'snapshots');
      const snap = await getDocs(col);
      const snapshots: Record<string, any> = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.courseId === courseId && data.term) {
          snapshots[data.term] = data;
        }
      });
      return snapshots;
    } catch (err) {
      console.warn('Error loading term snapshots from Firestore:', err);
      return {};
    }
  },
};
