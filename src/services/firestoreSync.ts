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
export function getActiveUserId(): string | null {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('docencia_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) return parsed.id;
      }
      const email = sessionStorage.getItem('docencia_teacher_email');
      if (email) return 'teacher_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    } catch (_) {}
  }
  return null;
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
        history.push(data);

        const studentId = data.studentId;
        if (studentId) {
          if (!disposition[studentId]) {
            disposition[studentId] = { totalAbsences: 0, totalLates: 0, totalDisposition: 10 };
          }
          if (data.category === 'Ausencia') {
            disposition[studentId].totalAbsences += 1;
          } else if (data.category === 'Llegada tarde') {
            disposition[studentId].totalLates = (disposition[studentId].totalLates || 0) + 1;
          } else if (data.category === 'Disposición') {
            disposition[studentId].totalDisposition = Math.max(0, disposition[studentId].totalDisposition - 1);
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
};
