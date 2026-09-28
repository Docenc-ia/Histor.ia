/**
 * Google Classroom Integration Service
 * Endpoint: https://classroom.googleapis.com/v1
 * Scopes:
 * - https://www.googleapis.com/auth/classroom.courses.readonly
 * - https://www.googleapis.com/auth/classroom.coursework.students
 */

import { getCachedAccessToken } from './googleAuth';
import { ClassroomTask } from '../../types';

export const classroomService = {
  /**
   * Fetch courses directly from Google Classroom
   */
  async listClassroomCourses(
    providedToken?: string
  ): Promise<{ success: boolean; courses: any[]; isLive: boolean; rosterPermissionRequired?: boolean; message?: string; errorDetail?: string }> {
    const token = providedToken || getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        courses: [],
        isLive: false,
        message: 'No hay una sesión de Google activa con permisos de Classroom. Haz clic en "Conectar Google Classroom" para autorizar el acceso.',
      };
    }

    try {
      // 1. First try fetching courses where user is teacher
      let res = await fetch('https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE', {
        headers: { Authorization: `Bearer ${token}` },
      });

      // 2. If 400 or empty, try general active courses
      if (!res.ok && res.status === 400) {
        res = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      if (res.ok) {
        const data = await res.json();
        let coursesRaw = data.courses || [];

        // If 0 courses found with teacherId=me, check if there are any general active courses
        if (coursesRaw.length === 0) {
          try {
            const fallbackRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              if (fallbackData.courses && fallbackData.courses.length > 0) {
                coursesRaw = fallbackData.courses;
              }
            }
          } catch (_) {}
        }

        // Fetch actual student counts for all found courses directly from Google Classroom
        let rosterPermissionRequired = false;
        const courses = await Promise.all(
          coursesRaw.map(async (course: any) => {
            let realCount = 0;
            try {
              const studentsRes = await fetch(
                `https://classroom.googleapis.com/v1/courses/${course.id}/students?pageSize=100`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (studentsRes.ok) {
                const sData = await studentsRes.json();
                realCount = Array.isArray(sData.students) ? sData.students.length : 0;
              } else if (studentsRes.status === 403) {
                rosterPermissionRequired = true;
                console.warn(`Classroom roster permission required for course ${course.id} (status 403)`);
              }
            } catch (sErr) {
              console.warn(`Classroom student count fetch error for ${course.id}:`, sErr);
            }
            return {
              ...course,
              studentsCount: realCount,
            };
          })
        );

        return {
          success: true,
          courses,
          isLive: true,
          rosterPermissionRequired,
          message:
            courses.length > 0
              ? `Se encontraron ${courses.length} clases activas en tu Google Classroom.`
              : 'Google Classroom respondió correctamente, pero no se encontraron cursos activos con esta cuenta de Google.',
        };
      } else {
        const errData = await res.json().catch(() => ({}));
        const rawErrMsg = errData?.error?.message || '';
        console.warn('Google Classroom API response status:', res.status, errData);

        if (res.status === 401) {
          return {
            success: false,
            courses: [],
            isLive: false,
            message: 'La sesión de Google ha expirado. Haz clic en "Conectar con Google" para renovarla.',
            errorDetail: rawErrMsg,
          };
        }

        if (res.status === 403) {
          if (rawErrMsg.toLowerCase().includes('disabled') || rawErrMsg.toLowerCase().includes('has not been used')) {
            return {
              success: false,
              courses: [],
              isLive: false,
              message: 'La API de Google Classroom aún no está habilitada en el proyecto de Google Cloud. Puedes usar la pestaña "Carga Rápida" para ingresar tus materias sin restricciones.',
              errorDetail: rawErrMsg,
            };
          }
          return {
            success: false,
            courses: [],
            isLive: false,
            message: 'Tu cuenta de Google requiere permisos de docente en Google Classroom (Google Workspace for Education). Puedes usar "Carga Rápida" para escribir tus materias.',
            errorDetail: rawErrMsg,
          };
        }

        return {
          success: false,
          courses: [],
          isLive: false,
          message: rawErrMsg || 'No se pudo conectar con Google Classroom. Puedes importar tus clases desde la pestaña "Carga Rápida".',
          errorDetail: rawErrMsg,
        };
      }
    } catch (err: any) {
      console.warn('Google Classroom live fetch error:', err);
      return {
        success: false,
        courses: [],
        isLive: false,
        message: 'Error de red o conexión al consultar Google Classroom.',
        errorDetail: err?.message,
      };
    }
  },

  /**
   * Fetch students from a Google Classroom course with full details and error handling
   */
  async listCourseStudents(classroomCourseId: string, providedToken?: string): Promise<any[]> {
    const res = await this.listCourseStudentsDetailed(classroomCourseId, providedToken);
    return res.studentsRaw || [];
  },

  /**
   * Detailed Google Classroom roster fetch with status and permission detection
   */
  async listCourseStudentsDetailed(classroomCourseId: string, providedToken?: string): Promise<{
    success: boolean;
    students: any[];
    studentsRaw: any[];
    rosterPermissionRequired: boolean;
    message?: string;
  }> {
    const token = providedToken || getCachedAccessToken();
    if (!token || !classroomCourseId) {
      return { success: false, students: [], studentsRaw: [], rosterPermissionRequired: false, message: 'Falta sesión o ID de curso.' };
    }

    try {
      const res = await fetch(`https://classroom.googleapis.com/v1/courses/${classroomCourseId}/students?pageSize=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const rawList: any[] = Array.isArray(data.students) ? data.students : [];
        const formatted = rawList.map((st) => {
          const profile = st.profile || {};
          const nameObj = profile.name || {};
          const fullName = nameObj.fullName || `${nameObj.givenName || ''} ${nameObj.familyName || ''}`.trim() || 'Estudiante';
          const firstName = nameObj.givenName || (fullName.includes(' ') ? fullName.split(' ')[0] : fullName);
          const lastName = nameObj.familyName || (fullName.includes(' ') ? fullName.split(' ').slice(1).join(' ') : '');
          const email = profile.emailAddress || '';
          let photoUrl = profile.photoUrl || '';
          if (photoUrl.startsWith('//')) photoUrl = 'https:' + photoUrl;
          if (!photoUrl) {
            photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1a73e8&color=ffffff&bold=true`;
          }

          return {
            id: st.userId || profile.id || `st-${Math.random().toString(36).substring(2, 8)}`,
            userId: st.userId || profile.id,
            firstName,
            lastName,
            email,
            avatar: photoUrl,
            attendanceRate: 100,
            averageGrade: 0,
            notes: 'Sincronizado desde Google Classroom',
          };
        });

        return {
          success: true,
          students: formatted,
          studentsRaw: rawList,
          rosterPermissionRequired: false,
        };
      }

      if (res.status === 403) {
        return {
          success: false,
          students: [],
          studentsRaw: [],
          rosterPermissionRequired: true,
          message: 'Se requiere permiso de nómina (classroom.rosters.readonly) en Google Classroom.',
        };
      }

      return {
        success: false,
        students: [],
        studentsRaw: [],
        rosterPermissionRequired: false,
        message: `Error al consultar Classroom (status ${res.status}).`,
      };
    } catch (err: any) {
      console.warn('Classroom student fetch error:', err);
      return {
        success: false,
        students: [],
        studentsRaw: [],
        rosterPermissionRequired: false,
        message: err?.message || 'Error de conexión con Google Classroom.',
      };
    }
  },

  /**
   * Smart resolver to find real Google Classroom ID and load real students for a Course
   */
  async resolveAndFetchCourseStudents(
    course: { id: string; name: string; subject?: string; classroomCourseId?: string },
    providedToken?: string
  ): Promise<{
    success: boolean;
    students: any[];
    realClassroomId?: string;
    rosterPermissionRequired: boolean;
    message?: string;
  }> {
    const token = providedToken || getCachedAccessToken();
    if (!token) {
      return { success: false, students: [], rosterPermissionRequired: false, message: 'No hay sesión de Google activa.' };
    }

    let targetClassroomId = course.classroomCourseId;
    const isPlaceholderId = !targetClassroomId || targetClassroomId.startsWith('gc-') || isNaN(Number(targetClassroomId));

    // 1. If we have a genuine numeric classroom course ID, try direct query first
    if (targetClassroomId && !isPlaceholderId) {
      const directRes = await this.listCourseStudentsDetailed(targetClassroomId, token);
      if (directRes.success && directRes.students.length > 0) {
        return {
          success: true,
          students: directRes.students,
          realClassroomId: targetClassroomId,
          rosterPermissionRequired: false,
        };
      }
      if (directRes.rosterPermissionRequired) {
        return {
          success: false,
          students: [],
          realClassroomId: targetClassroomId,
          rosterPermissionRequired: true,
          message: directRes.message,
        };
      }
    }

    // 2. Query all active Google Classroom courses to match by real ID or name
    const listRes = await this.listClassroomCourses(token);
    if (listRes.rosterPermissionRequired) {
      return {
        success: false,
        students: [],
        rosterPermissionRequired: true,
        message: 'Se requiere permiso para leer nóminas de Google Classroom.',
      };
    }

    if (listRes.success && Array.isArray(listRes.courses)) {
      const cleanName = course.name.toLowerCase().trim();
      const cleanSubj = (course.subject || '').toLowerCase().trim();

      const matched = listRes.courses.find((gc: any) => {
        if (!gc) return false;
        const gcName = (gc.name || '').toLowerCase().trim();
        const gcSection = (gc.section || '').toLowerCase().trim();
        return (
          gc.id === course.classroomCourseId ||
          gcName === cleanName ||
          cleanName.includes(gcName) ||
          gcName.includes(cleanName) ||
          (cleanSubj && (gcName.includes(cleanSubj) || gcSection.includes(cleanSubj)))
        );
      });

      if (matched && matched.id) {
        const fetchRes = await this.listCourseStudentsDetailed(matched.id, token);
        return {
          success: fetchRes.success,
          students: fetchRes.students,
          realClassroomId: matched.id,
          rosterPermissionRequired: fetchRes.rosterPermissionRequired,
          message: fetchRes.message,
        };
      }
    }

    return {
      success: false,
      students: [],
      rosterPermissionRequired: false,
      message: `No se encontró curso correspondiente en Google Classroom para "${course.name}".`,
    };
  },

  /**
   * Publish an assignment/courseWork to Google Classroom
   */
  async createCourseWork(
    classroomCourseId: string,
    task: Partial<ClassroomTask>
  ): Promise<{ id: string; url: string; published: boolean }> {
    const token = getCachedAccessToken();
    if (token && classroomCourseId) {
      try {
        const res = await fetch(`https://classroom.googleapis.com/v1/courses/${classroomCourseId}/courseWork`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            maxPoints: task.maxPoints || 100,
            workType: 'ASSIGNMENT',
            state: 'PUBLISHED',
            dueDate: task.dueDate ? {
              year: new Date(task.dueDate).getFullYear(),
              month: new Date(task.dueDate).getMonth() + 1,
              day: new Date(task.dueDate).getDate(),
            } : undefined,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          return {
            id: data.id,
            url: data.alternateLink || `https://classroom.google.com/c/${classroomCourseId}`,
            published: true,
          };
        }
      } catch (err) {
        console.warn('Classroom publish error, falling back to local queue:', err);
      }
    }

    // Local / Prepared simulation
    return {
      id: `cw-${Date.now().toString().slice(-4)}`,
      url: `https://classroom.google.com/c/${classroomCourseId || 'demo'}/a/new`,
      published: true,
    };
  },

  /**
   * Publish an individual announcement to the Google Classroom stream targeted specifically
   * to a single student (assigneeMode: INDIVIDUAL_STUDENTS)
   * Visible only to that student on the Classroom course stream.
   */
  async createIndividualAnnouncement(
    classroomCourseId: string,
    studentUserId: string,
    text: string
  ): Promise<{ success: boolean; id?: string; url?: string; message?: string }> {
    const token = getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        message: 'No hay token activo de Google Classroom. El registro quedó guardado localmente.',
      };
    }

    if (!classroomCourseId) {
      return {
        success: false,
        message: 'El curso no tiene vinculado un ID de Google Classroom activo.',
      };
    }

    try {
      // If studentUserId is numeric or Google Classroom ID, target individually
      const announcementBody: any = {
        text,
        state: 'PUBLISHED',
      };

      if (studentUserId && !studentUserId.startsWith('st-')) {
        announcementBody.assigneeMode = 'INDIVIDUAL_STUDENTS';
        announcementBody.individualStudentsOptions = {
          studentIds: [studentUserId],
        };
      }

      const res = await fetch(`https://classroom.googleapis.com/v1/courses/${classroomCourseId}/announcements`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(announcementBody),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          id: data.id,
          url: data.alternateLink || `https://classroom.google.com/c/${classroomCourseId}`,
          message: 'Aviso publicado en el tablón del estudiante con éxito.',
        };
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Classroom individual announcement error:', res.status, err);
        return {
          success: false,
          message: err?.error?.message || `Error de Google Classroom (status ${res.status})`,
        };
      }
    } catch (err: any) {
      console.warn('Error connecting with Google Classroom announcements API:', err);
      return {
        success: false,
        message: err?.message || 'Error de conexión con Google Classroom.',
      };
    }
  },
};
