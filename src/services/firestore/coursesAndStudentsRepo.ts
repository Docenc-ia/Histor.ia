/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { Course, Student, TeacherProfile } from '../../types';
import {
  ALL_DBS,
  FIRESTORE_TIMEOUT_MS,
  READ_CACHE_TTL_MS,
  OperationType,
  isFirestoreAvailable,
  executeWithTimeout,
  handleFirestoreError,
  getActiveUserId,
  getCandidateUserIds,
  getTargetWriteUserIds,
  isPrimaryOwnerAccount,
  sanitizeForFirestore,
  computePayloadFingerprint,
  isPayloadDirty,
  markPayloadSynced,
  removeFingerprintPrefix,
  BatchOperation,
  commitBatchOperationsInChunks,
} from './firestoreClient';

let coursesReadCache: { userId: string; timestamp: number; data: Course[] } | null = null;
let studentsReadCache: { userId: string; timestamp: number; data: Student[] } | null = null;

export function invalidateCoursesAndStudentsCaches(): void {
  coursesReadCache = null;
  studentsReadCache = null;
}

export const coursesAndStudentsRepo = {
  /**
   * Save teacher profile to Firestore under /users/{userId} (skips if unchanged)
   */
  async saveTeacherProfile(profile: Partial<TeacherProfile> & { id?: string; email?: string }): Promise<void> {
    if (!profile?.email && !profile?.id) return;
    if (!isFirestoreAvailable()) return;
    const userId = profile.id || getActiveUserId();
    const coreProfile = {
      uid: String(userId).slice(0, 128),
      email: String(profile.email || '').slice(0, 256),
      name: String(profile.name || 'Docente Titular').slice(0, 256),
      avatar: String(profile.avatar || '').slice(0, 1024),
      role: String(profile.role || 'Docente Titular').slice(0, 128),
      school: String(profile.school || 'FDS - Educación Secundaria').slice(0, 256),
    };
    const payload = {
      ...coreProfile,
      updatedAt: new Date().toISOString(),
    };
    const writeIds = getTargetWriteUserIds(userId);
    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        const fpKey = `teacher_profile:${uid}`;
        const check = isPayloadDirty(fpKey, coreProfile);
        if (!check.dirty) continue;

        const path = `users/${uid}`;
        executeWithTimeout(setDoc(doc(targetDb, 'users', uid), payload, { merge: true }), FIRESTORE_TIMEOUT_MS, true)
          .then((res) => {
            if (res !== null) markPayloadSynced(fpKey, check.fingerprint);
          })
          .catch((err) => {
            handleFirestoreError(err, OperationType.WRITE, path);
          });
      }
    }
  },

  /**
   * Save courses to Firestore using Compact v2 Document (1 write instead of N+1 writes)
   */
  async saveCourses(userId: string, courses: Course[]): Promise<void> {
    if (!userId || !Array.isArray(courses) || !isFirestoreAvailable()) return;
    const cleanCourses = courses.filter((c) => c && c.id);
    coursesReadCache = { userId, timestamp: Date.now(), data: cleanCourses };
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    const compactCore = {
      version: 2,
      migratedFromLegacy: true,
      items: cleanCourses,
    };
    const compactPayload = sanitizeForFirestore({
      ...compactCore,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      try {
        const batch = writeBatch(targetDb);
        let opsCount = 0;
        const pendingMarks: Array<{ key: string; fp: string }> = [];

        for (const uid of writeIds) {
          const compactKey = `courses_compact:${uid}`;
          const compactCheck = isPayloadDirty(compactKey, compactCore);
          if (compactCheck.dirty) {
            batch.set(
              doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
              { value: compactPayload, updatedAt: nowIso },
              { merge: true }
            );
            opsCount++;
            pendingMarks.push({ key: compactKey, fp: compactCheck.fingerprint });
          }
        }

        if (opsCount > 0) {
          const res = await executeWithTimeout(batch.commit(), FIRESTORE_TIMEOUT_MS, true);
          if (res !== null) {
            pendingMarks.forEach((m) => markPayloadSynced(m.key, m.fp));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/settings/courses_compact_v2`);
      }
    }
  },

  /**
   * Load courses from Firestore using Compact v2 Document (1 read instead of N reads)
   */
  async loadCourses(userId: string): Promise<Course[]> {
    if (!isFirestoreAvailable()) return [];
    if (
      coursesReadCache &&
      coursesReadCache.userId === userId &&
      Date.now() - coursesReadCache.timestamp < READ_CACHE_TTL_MS &&
      coursesReadCache.data.length > 0
    ) {
      return coursesReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
    const coursesMap = new Map<string, Course>();

    try {
      const compactQueries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          compactQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'))).catch(() => null)
          );
        }
      }

      const compactSnaps = await Promise.all(compactQueries);
      let hasMigratedDoc = false;

      for (const snap of compactSnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const raw = snap.data();
        const val = raw?.value || raw;
        const items = Array.isArray(val?.items) ? val.items : [];
        if (val?.migratedFromLegacy || items.length > 0) {
          hasMigratedDoc = true;
        }
        for (const c of items) {
          if (c && c.id && (c.name || c.subject)) {
            coursesMap.set(c.id, c);
          }
        }
      }

      if (!hasMigratedDoc) {
        const queries: Promise<any>[] = [];
        for (const targetDb of ALL_DBS) {
          for (const uid of candidateIds) {
            queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'courses'))).catch(() => null));
          }
        }

        const snaps = await Promise.all(queries);
        for (const snap of snaps) {
          if (!snap) continue;
          snap.forEach((docSnap: any) => {
            const data = docSnap.data() as Course;
            if (data && data.id && (data.name || data.subject)) {
              coursesMap.set(data.id, data);
            }
          });
        }
      }

      const courses = Array.from(coursesMap.values());
      if (courses.length > 0) {
        coursesReadCache = { userId, timestamp: Date.now(), data: courses };
        for (const uid of writeIds) {
          for (const c of courses) {
            markPayloadSynced(`course_doc:${uid}:${c.id}`, computePayloadFingerprint(c));
          }
          if (hasMigratedDoc) {
            markPayloadSynced(
              `courses_compact:${uid}`,
              computePayloadFingerprint({ version: 2, migratedFromLegacy: true, items: courses })
            );
          }
        }
      }

      if (!hasMigratedDoc && courses.length > 0) {
        const nowIso = new Date().toISOString();
        const compactCore = {
          version: 2,
          migratedFromLegacy: true,
          items: courses,
        };
        const compactPayload = sanitizeForFirestore({
          ...compactCore,
          updatedAt: nowIso,
        });
        for (const targetDb of ALL_DBS) {
          for (const uid of writeIds) {
            executeWithTimeout(
              setDoc(
                doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
                { value: compactPayload, updatedAt: nowIso },
                { merge: true }
              )
            )
              .then((res) => {
                if (res !== null) {
                  markPayloadSynced(`courses_compact:${uid}`, computePayloadFingerprint(compactCore));
                }
              })
              .catch(() => {});
          }
        }
      }

      return courses;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/courses`);
      return [];
    }
  },

  /**
   * Delete a course from Firestore across linked accounts and compact store
   */
  async deleteCourse(userId: string, courseId: string): Promise<void> {
    if (!courseId || !isFirestoreAvailable()) return;
    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    const knownCoursesMap = new Map<string, Course>();
    (coursesReadCache?.data || []).forEach((c) => {
      if (c?.id) knownCoursesMap.set(c.id, c);
    });
    if (typeof window !== 'undefined') {
      try {
        const localKeys = isPrimaryOwnerAccount()
          ? [`docencia_courses_${userId}`, 'docencia_courses', 'docencia_persisted_courses']
          : [`docencia_courses_${userId}`];
        for (const k of localKeys) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              for (const c of parsed) {
                if (c?.id) knownCoursesMap.set(c.id, c);
              }
            }
          }
        }
      } catch (_) {}
    }

    invalidateCoursesAndStudentsCaches();

    try {
      const remainingCourses = Array.from(knownCoursesMap.values()).filter(
        (c) => c.id !== courseId && c.classroomCourseId !== courseId
      );
      coursesReadCache = { userId, timestamp: Date.now(), data: remainingCourses };

      for (const targetDb of ALL_DBS) {
        const batch = writeBatch(targetDb);
        for (const uid of writeIds) {
          batch.set(
            doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
            {
              value: sanitizeForFirestore({
                version: 2,
                migratedFromLegacy: true,
                items: remainingCourses,
                updatedAt: nowIso,
              }),
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
        await executeWithTimeout(batch.commit());
      }
    } catch (_) {}

    for (const targetDb of ALL_DBS) {
      for (const uid of candidateIds) {
        removeFingerprintPrefix(`course_doc:${uid}:${courseId}`);
        removeFingerprintPrefix(`courses_compact:${uid}`);
        executeWithTimeout(deleteDoc(doc(targetDb, 'users', uid, 'courses', courseId))).catch(() => {});
      }
    }
  },

  /**
   * Clear all courses for a user from Firestore
   */
  async clearAllCourses(userId: string): Promise<void> {
    if (!userId || !isFirestoreAvailable()) return;
    invalidateCoursesAndStudentsCaches();
    removeFingerprintPrefix('course_doc:');
    removeFingerprintPrefix('courses_compact:');
    removeFingerprintPrefix('student_doc:');
    removeFingerprintPrefix('students_compact:');
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'settings', 'courses_compact_v2'),
            {
              value: {
                version: 2,
                migratedFromLegacy: true,
                items: [],
                updatedAt: nowIso,
              },
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ).catch(() => {});

        executeWithTimeout(
          setDoc(
            doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
            {
              value: {
                version: 2,
                migratedFromLegacy: true,
                items: [],
                updatedAt: nowIso,
              },
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ).catch(() => {});
      }
    }

    for (const targetDb of ALL_DBS) {
      for (const uid of writeIds) {
        try {
          const snap = await executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'courses')));
          if (!snap || snap.empty) continue;
          const deleteOps: BatchOperation[] = [];
          snap.forEach((docSnap: any) => {
            deleteOps.push({ type: 'delete', ref: docSnap.ref });
          });
          await commitBatchOperationsInChunks(targetDb, deleteOps);
        } catch (_) {}
      }
    }
  },

  /**
   * Save students roster for a course to Firestore globally using Incremental Dirty-Tracking
   * and per-course sharding + chunked batching to scale safely beyond 500 students and 1 MB doc limits.
   */
  async saveStudents(userId: string, courseId: string, students: Student[]): Promise<void> {
    if (!userId || !courseId || !Array.isArray(students) || !isFirestoreAvailable()) return;
    const writeIds = getTargetWriteUserIds(userId);
    const nowIso = new Date().toISOString();

    const makeCompositeKey = (cId: string | undefined, sId: string) => `${cId || 'global'}::${sId}`;

    const currentStudentsMap = new Map<string, Student>();
    if (typeof window !== 'undefined') {
      try {
        const candidateStorageKeys = isPrimaryOwnerAccount()
          ? [
              `docencia_students_${userId}`,
              `docencia_local_students_${userId}`,
              'docencia_students',
              'docencia_persisted_students',
              'docencia_local_students',
            ]
          : [`docencia_students_${userId}`, `docencia_local_students_${userId}`];
        for (const k of candidateStorageKeys) {
          const rawLocal = localStorage.getItem(k);
          if (rawLocal) {
            const parsedLocal = JSON.parse(rawLocal);
            if (Array.isArray(parsedLocal)) {
              for (const s of parsedLocal) {
                if (s?.id) currentStudentsMap.set(makeCompositeKey(s.courseId, s.id), s);
              }
            }
          }
        }
      } catch (_) {}
    }
    (studentsReadCache?.data || []).forEach((s) => {
      if (s?.id) currentStudentsMap.set(makeCompositeKey(s.courseId, s.id), s);
    });

    for (const [compKey, st] of Array.from(currentStudentsMap.entries())) {
      if (st.courseId === courseId) {
        currentStudentsMap.delete(compKey);
      }
    }
    const normalizedCourseStudents: Student[] = [];
    for (const st of students) {
      if (st?.id) {
        const normalized = { ...st, courseId };
        currentStudentsMap.set(makeCompositeKey(courseId, st.id), normalized);
        normalizedCourseStudents.push(normalized);
      }
    }

    const fullCleanStudents = Array.from(currentStudentsMap.values());
    studentsReadCache = { userId, timestamp: Date.now(), data: fullCleanStudents };

    const safeCourseDocKey = String(courseId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
    const courseShardCore = {
      version: 2,
      courseId,
      items: normalizedCourseStudents,
    };
    const courseShardPayload = sanitizeForFirestore({
      ...courseShardCore,
      updatedAt: nowIso,
    });

    // Only include full roster in global compact document if under 450 students to stay well below Firestore's 1 MB limit
    const compactCore = {
      version: 2,
      migratedFromLegacy: true,
      shardedByCourse: fullCleanStudents.length > 450,
      items: fullCleanStudents.length <= 450 ? fullCleanStudents : [],
    };
    const compactPayload = sanitizeForFirestore({
      ...compactCore,
      updatedAt: nowIso,
    });

    for (const targetDb of ALL_DBS) {
      try {
        const operations: BatchOperation[] = [];

        for (const uid of writeIds) {
          // 1. Per-course compact shard (scales indefinitely across any number of courses)
          const shardKey = `students_course_shard:${uid}:${safeCourseDocKey}`;
          const shardCheck = isPayloadDirty(shardKey, courseShardCore);
          if (shardCheck.dirty) {
            operations.push({
              type: 'set',
              ref: doc(targetDb, 'users', uid, 'settings', `students_course_${safeCourseDocKey}_v2`),
              data: { value: courseShardPayload, updatedAt: nowIso },
              merge: true,
              fingerprintKey: shardKey,
              fingerprint: shardCheck.fingerprint,
            });
          }

          // 2. Global compact v2 document (when total roster fits safely under 1MB)
          const compactKey = `students_compact:${uid}`;
          const compactCheck = isPayloadDirty(compactKey, compactCore);
          if (compactCheck.dirty) {
            operations.push({
              type: 'set',
              ref: doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
              data: { value: compactPayload, updatedAt: nowIso },
              merge: true,
              fingerprintKey: compactKey,
              fingerprint: compactCheck.fingerprint,
            });
          }

          // 3. Individual dirty student documents (chunked automatically in 450-op batches)
          for (const normalizedStudent of normalizedCourseStudents) {
            const itemKey = `student_doc:${uid}:${courseId}:${normalizedStudent.id}`;
            const itemCheck = isPayloadDirty(itemKey, normalizedStudent);
            if (!itemCheck.dirty) continue;

            const safeDocId = `${courseId}_${normalizedStudent.id}`.replace(/[/\\]/g, '_');
            const ref = doc(targetDb, 'users', uid, 'students', safeDocId);
            operations.push({
              type: 'set',
              ref,
              data: sanitizeForFirestore({
                ...normalizedStudent,
                updatedAt: nowIso,
              }),
              merge: true,
              fingerprintKey: itemKey,
              fingerprint: itemCheck.fingerprint,
            });
          }
        }

        if (operations.length > 0) {
          await commitBatchOperationsInChunks(targetDb, operations, FIRESTORE_TIMEOUT_MS, true);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${userId}/settings/students_compact_v2`);
      }
    }
  },

  /**
   * Load students from Firestore using Compact v2 Document (1 read instead of N reads)
   */
  async loadStudents(userId: string, courseId?: string): Promise<Student[]> {
    if (!isFirestoreAvailable()) return [];
    if (
      studentsReadCache &&
      studentsReadCache.userId === userId &&
      Date.now() - studentsReadCache.timestamp < READ_CACHE_TTL_MS &&
      studentsReadCache.data.length > 0
    ) {
      return courseId
        ? studentsReadCache.data.filter((s) => s.courseId === courseId)
        : studentsReadCache.data;
    }

    const candidateIds = getCandidateUserIds(userId);
    const writeIds = getTargetWriteUserIds(userId);
    const studentsMap = new Map<string, Student>();
    const makeCompositeKey = (cId: string | undefined, sId: string) => `${cId || 'global'}::${sId}`;

    try {
      const compactQueries: Promise<any>[] = [];
      for (const targetDb of ALL_DBS) {
        for (const uid of candidateIds) {
          compactQueries.push(
            executeWithTimeout(getDoc(doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'))).catch(() => null)
          );
        }
      }

      const compactSnaps = await Promise.all(compactQueries);
      let hasMigratedDoc = false;

      for (const snap of compactSnaps) {
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;
        const raw = snap.data();
        const val = raw?.value || raw;
        const items = Array.isArray(val?.items) ? val.items : [];
        if ((val?.migratedFromLegacy && !val?.shardedByCourse) || items.length > 0) {
          hasMigratedDoc = true;
        }
        for (const s of items) {
          if (s && s.id && (s.firstName || s.lastName || s.email)) {
            studentsMap.set(makeCompositeKey(s.courseId, s.id), s);
          }
        }
      }

      if (!hasMigratedDoc) {
        const queries: Promise<any>[] = [];
        for (const targetDb of ALL_DBS) {
          for (const uid of candidateIds) {
            queries.push(executeWithTimeout(getDocs(collection(targetDb, 'users', uid, 'students'))).catch(() => null));
          }
        }

        const snaps = await Promise.all(queries);
        for (const snap of snaps) {
          if (!snap) continue;
          snap.forEach((docSnap: any) => {
            const data = docSnap.data() as Student;
            if (data && data.id) {
              studentsMap.set(makeCompositeKey(data.courseId, data.id), data);
            }
          });
        }
      }

      const allStudents = Array.from(studentsMap.values());
      if (allStudents.length > 0) {
        studentsReadCache = { userId, timestamp: Date.now(), data: allStudents };
        for (const uid of writeIds) {
          for (const st of allStudents) {
            markPayloadSynced(`student_doc:${uid}:${st.courseId || 'global'}:${st.id}`, computePayloadFingerprint(st));
          }
          if (hasMigratedDoc) {
            markPayloadSynced(
              `students_compact:${uid}`,
              computePayloadFingerprint({ version: 2, migratedFromLegacy: true, items: allStudents })
            );
          }
        }
      }

      if (!hasMigratedDoc && allStudents.length > 0) {
        const nowIso = new Date().toISOString();
        const compactCore = {
          version: 2,
          migratedFromLegacy: true,
          items: allStudents,
        };
        const compactPayload = sanitizeForFirestore({
          ...compactCore,
          updatedAt: nowIso,
        });
        for (const targetDb of ALL_DBS) {
          for (const uid of writeIds) {
            executeWithTimeout(
              setDoc(
                doc(targetDb, 'users', uid, 'settings', 'students_compact_v2'),
                { value: compactPayload, updatedAt: nowIso },
                { merge: true }
              )
            )
              .then((res) => {
                if (res !== null) {
                  markPayloadSynced(`students_compact:${uid}`, computePayloadFingerprint(compactCore));
                }
              })
              .catch(() => {});
          }
        }
      }

      return courseId ? allStudents.filter((s) => s.courseId === courseId) : allStudents;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}/students`);
      return [];
    }
  },
};
